// ============================================================================
// EDGE FUNCTION: portal-auth
//
// Todo el portal del cliente pasa por acá. En el navegador queda la UI; la
// comparación de credenciales y las consultas quedan del lado del servidor.
//
// ---------------------------------------------------------------------------
// POR QUÉ
// ---------------------------------------------------------------------------
// La versión anterior hacía `select *` a la tabla `clientes` con la llave anon
// y después, en JavaScript, buscaba la fila cuyo `portal_token` y
// `portal_clave` coincidieran. Eso no era una verificación: la llave anon
// —que va incrustada en el bundle y lee cualquiera que abra devtools— bajaba
// la tabla entera. Con el token y la clave de acceso del portal de TODOS los
// clientes, más nombre, cédula, teléfono, correo, dirección, saldo y forma de
// pago. La contraseña venía en el mismo SELECT que la respuesta, así que no
// protegía nada.
//
// Acá la comparación se hace con SERVICE ROLE, que sí puede leer la tabla
// completa, y lo que sale del servidor es un veredicto. El cliente nunca
// recibe `portal_clave` ni `portal_token` de vuelta.
//
// También se arregla un agujero que venía de paso: `reclamarJugada` hacía
// `update tickets_apuestas set estado='EN_REVISION' where id = ?` SIN filtrar
// por cliente. Con la llave anon al alcance, cualquier cliente del sistema
// podía marcar como reclamada una apuesta que no era suya. Acá toda escritura
// se ancla al `cliente_id` que salió de la validación del token, no al que
// manda el navegador.
//
// ---------------------------------------------------------------------------
// INSTALAR (requiere el CLI de Supabase, no está en el repo)
// ---------------------------------------------------------------------------
//   npx supabase login
//   npx supabase functions deploy portal-auth
//
// La autorización NO viene del JWT: el cliente del portal no tiene sesión de
// Supabase, así que va con la llave anon. Por lo tanto la policy de
// invocación tiene que admitir `anon`, y la protección real es lo de adentro:
// comparación en tiempo constante, mensajes de error idénticos, límite de
// intentos y alcance forzado al cliente del token.
//
// ---------------------------------------------------------------------------
// LÍMITE DE INTENTOS Y ANTI-BOT
// ---------------------------------------------------------------------------
// Acá hay un tope por IP para que el token no se pueda recorrer a fuerza bruta
// desde una sola dirección. Es por memoria del proceso de Deno, no es un rate
// limit distribuido: se reinicia cuando la función se recicla. Para algo que
// valga de verdad hay que ponerlo en la base (tabla de intentos) o adelante de
// la función. Sigue anotado en PLANIFICACION.md como pendiente de ese lado.
//
// Encima de eso, si el club configura `TURNSTILE_SECRET` (Cloudflare Turnstile)
// o `RECAPTCHA_SECRET` (Google reCAPTCHA v3) en los secrets de la función, la
// acción `entrar` exige un token anti-bot verificado contra el proveedor. Si NO
// está configurado, la función sigue funcionando por token/clave —el honeypot
// del navegador y el tope por IP siguen puestos— y nadie confunde "sin captcha
// configurado" con "captcha verificado".
// ============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY = 64 * 1024;
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;
/** Intentos de cambio de PIN permitidos por IP (más estricto que el login). */
const MAX_INTENTOS_PIN = 5;
const BUCKET = "reclamos";

/**
 * Verificación anti-bot opcional vía Cloudflare Turnstile o Google reCAPTCHA v3.
 * Sin secreto configurado, `verificarCaptcha` devuelve "sin-config" y el tope por
 * IP sigue siendo la única barrera: la función NO se cae por no tener captcha.
 */
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") ?? "";
const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET") ?? "";

type Fila = Record<string, unknown>;

/** Intentos fallidos por IP: [marca de tiempo, ...]. */
const intentos = new Map<string, number[]>();
/** Intentos de cambio de PIN por IP: [marca de tiempo, ...]. */
const intentosPin = new Map<string, number[]>();
let ultimoRecolecta = 0;

/**
 * Tope de intentos reutilizable. Login y cambio de PIN comparten la mecánica
 * pero con cubos SEPARADOS: agotar el login no debe bloquear el alta de PIN ni
 * al revés.
 */
function topeExcedido(cubo: Map<string, number[]>, ip: string, max: number): boolean {
  const ahora = Date.now();
  const previos = (cubo.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length >= max) {
    cubo.set(ip, previos);
    return true;
  }
  cubo.set(ip, [...previos, ahora]);
  return false;
}

function excedido(ip: string): boolean {
  const ahora = Date.now();
  // Poda perezosa: cada tanto se limpian las entradas viejas de los dos cubos.
  if (ahora - ultimoRecolecta > VENTANA_MS) {
    ultimoRecolecta = ahora;
    for (const cubo of [intentos, intentosPin]) {
      for (const [k, v] of cubo) {
        const vivos = v.filter((t) => ahora - t < VENTANA_MS);
        if (vivos.length) cubo.set(k, vivos);
        else cubo.delete(k);
      }
    }
  }
  return topeExcedido(intentos, ip, MAX_INTENTOS);
}

/**
 * Verifica el token anti-bot contra el proveedor configurado.
 *
 *   · "ok"        → hay proveedor y el token pasó.
 *   · "fallo"     → hay proveedor y el token NO pasó (se rechaza).
 *   · "sin-config"→ no hay proveedor; no se puede exigir (sigue el tope por IP).
 *
 * Nunca lanza: un proveedor caído no puede dejar el portal afuera. Si la
 * verificación falla por RED y venía token (el navegador lo consiguió), se
 * devuelve "ok" para no castigar al cliente por un timeout del proveedor; el
 * tope por IP sigue siendo la red de seguridad.
 */
async function verificarCaptcha(token: string, ip: string): Promise<"ok" | "fallo" | "sin-config"> {
  if (!TURNSTILE_SECRET && !RECAPTCHA_SECRET) return "sin-config";
  if (!token) return "fallo";
  try {
    const url = TURNSTILE_SECRET
      ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      : "https://www.google.com/recaptcha/api/siteverify";
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET || RECAPTCHA_SECRET,
      response: token,
      remoteip: ip,
    });
    const r = await fetch(url, { method: "POST", body });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true ? "ok" : "fallo";
  } catch {
    return "ok";
  }
}

/**
 * CORS.
 *
 * El portal del cliente se sirve desde OTRO origen (GitHub Pages, p.ej.
 * `https://usuario.github.io`) y llama a esta función. El navegador manda
 * primero un preflight `OPTIONS`: si la función no responde ese OPTIONS con
 * status OK y los headers `Access-Control-Allow-*`, el navegador bloquea la
 * llamada real con "Response to preflight request doesn't pass access control
 * check" — que era justo lo que pasaba y dejaba el portal en
 * "El servicio del portal no respondió".
 *
 * Se admite cualquier origen (`*`) A PROPÓSITO: la protección NO es el origen,
 * es el `portal_token` que se valida dentro de la función. Cualquiera puede
 * llamar a la función (igual que con la llave anon), pero sin token/clave
 * válidos no obtiene ningún dato.
 */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-max-age": "86400",
};

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

const ERROR_LOGIN = "Credenciales inválidas o portal deshabilitado para el cliente.";

/**
 * Compara en tiempo constante.
 *
 * `===` corta en el primer carácter que difiere: el tiempo que tarda dice
 * cuántos caracteres correctos acertó el atacante. Con un token de 6-8
 * caracteres eso convierte la fuerza bruta en algo medible. También compara
 * hasta la longitud mayor, para que dos cadenas de distinto largo tarden lo
 * mismo y la longitud no se pueda leer del tiempo.
 */
function igual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const max = Math.max(ab.length, bb.length);
  for (let i = 0; i < max; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** El cliente tal como se lo devuelve al portal: sin token ni clave. */
function clientePublico(c: Fila): Fila {
  const { portal_token: _t, portal_clave: _c, ...resto } = c;
  return resto;
}

const texto = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);
const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Los cuatro estados que admite la bitácora personal. */
const ESTADOS_BITACORA = ["PENDIENTE", "GANÓ", "PERDIÓ", "ANULADA"];

/**
 * Normaliza el arreglo de formas de pago que llega del navegador (PROMPT #7).
 *
 * El navegador NO es la fuente de verdad: cada fila se reduce a
 * `{ metodo, moneda, principal, datos }` con valores recortados, `datos` se
 * limpia a string/número/booleano, y se garantiza UNA sola principal. Si el
 * formato no es el esperado devuelve `null` y la acción se rechaza en vez de
 * escribir cualquier cosa en el jsonb.
 */
function sanitizarFormasPago(v: unknown): Array<Fila> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<Fila> = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const o = item as Fila;
    const metodo = texto(o.metodo, 60);
    if (!metodo) continue;
    const crudo = o.datos;
    let datos: Fila | null = null;
    if (crudo && typeof crudo === "object" && !Array.isArray(crudo)) {
      datos = {};
      for (const [k, val] of Object.entries(crudo as Fila)) {
        if (k.length > 40) continue;
        if (typeof val === "string") datos[k] = texto(val, 160);
        else if (typeof val === "number") datos[k] = texto(val, 60);
        else if (typeof val === "boolean") datos[k] = val;
      }
      if (!Object.keys(datos).length) datos = null;
    }
    out.push({ metodo, moneda: (texto(o.moneda, 8) || "USD").toUpperCase(), principal: o.principal === true, datos });
    if (out.length > 10) return null;
  }
  // Exactamente una principal, sin importar lo que mande el navegador.
  if (out.length) {
    let idx = out.findIndex((f) => f.principal === true);
    if (idx < 0) idx = 0;
    out.forEach((f, i) => (f.principal = i === idx));
  }
  return out;
}

/**
 * Rango de fechas que admite la ventana de reclamos del grupo.
 *
 * Reproduce la parte de calendario de `src/features/portal/lib/ventana-reclamos.ts`
 * (el navegador la usa para el `min`/`max` del selector de fecha). Acá es la
 * comprobación de servidor: aunque el navegador mande otra fecha, se rechaza.
 *
 *   SOLO_DIA_EN_CURSO → [hoy, hoy]
 *   SEMANA_EN_CURSO   → la semana fiscal del grupo (dia_inicio..dia_fin, 1=Lun)
 */
function rangoVentana(
  hoyIso: string,
  ventana: string,
  diaInicio: number | null,
  diaFin: number | null
): { piso: string; tope: string } {
  if (String(ventana).toUpperCase() !== "SEMANA_EN_CURSO") {
    return { piso: hoyIso, tope: hoyIso };
  }
  const ini = diaInicio && diaInicio >= 1 && diaInicio <= 7 ? diaInicio : 1;
  const fin = diaFin && diaFin >= 1 && diaFin <= 7 ? diaFin : 7;
  const [y, m, d] = hoyIso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const js = base.getUTCDay();
  const df = js === 0 ? 7 : js;
  const retro = (df - ini + 7) % 7;
  const inicio = sumarDiasIso(hoyIso, -retro);
  const span = fin >= ini ? fin - ini : 7 - ini + fin;
  return { piso: inicio, tope: sumarDiasIso(inicio, span) };
}

function sumarDiasIso(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/**
 * Lee el rol del JWT de la petición, sin verificar la firma.
 *
 * Ojo: NO es una autorización. Solo sirve para distinguir "viene el staff" de
 * "viene el cliente del portal" y dejar que cada uno tome su camino. La
 * decisión de seguridad la sigue tomando la base: el service role ignora RLS
 * sí o sí, así que quien llega hasta acá con un JWT falsificado no obtiene
 * nada que el rol `anon` no tuviera ya. Confiar en este campo como prueba de
 * identidad sería el error.
 */
/**
 * Dice si el request viene del STAFF AUTENTICADO, y solo de `leer-imagen`.
 *
 * ANTES: se leía `payload.role` del JWT con un simple `atob`. Eso NO es
 * verificar nada: la firma no se comprueba, así que cualquiera que escriba
 * `{"role":"authenticated"}.falso.falso` en el header entraba como staff. El
 * service_role de la función no lo salva, porque el salto lo decidía ESTE
 * código, no la base.
 *
 * AHORA: se le pregunta a Supabase Auth (`auth.getUser(jwt)`), que es quien
 * tiene la clave pública y puede decir la verdad. Un JWT forjado o vencido
 * vuelve `user: null` y la acción se rechaza.
 *
 * Y un paso más: que el JWT sea válido NO dice que el usuario sea del staff.
 * Cualquier cuenta de Auth —incluido un cliente que se haya registrado— pasa
 * `getUser`. Por eso después se consulta la matriz: la cuenta tiene que existir
 * en `usuario_sistema`, estar `activo`, y tener la capacidad de ver tickets. Se
 * pregunta con `tiene_capacidad`, que es `security definer` y ya aplica toda la
 * precedencia del maestro (principal → excepción → base del tipo), en vez de
 * reimplementarla aquí y que se desincronice.
 *
 * Si la BD de seguridad todavía no está aplicada, el RPC no existe, el `.rpc`
 * devuelve error y esto devuelve `false`: el staff no entra y el portal sigue
 * funcionando por token. Cierra por omisión.
 *
 * Sale un registro por request de staff, lo cual es lo aceptable: el staff es
 * quien usa `leer-imagen`, y ese camino no es el caliente.
 */
async function esStaffAutenticado(
  db: SupabaseClient,
  req: Request
): Promise<boolean> {
  const h = req.headers.get("authorization") ?? "";
  const jwt = h.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length !== 3) return false;
  try {
    const { data, error } = await db.auth.getUser(jwt);
    const user = data?.user;
    if (error || !user) return false;
    const { data: puede, error: eRbac } = await db.rpc("tiene_capacidad", {
      u: user.id,
      clave: "tickets:ruta_tickets",
    });
    // `data === true` a secas: un string "true" o un objeto no cuentan.
    return !eRbac && puede === true;
  } catch {
    return false;
  }
}

/** Resuelve el cliente desde el token y el id de enlace, o null. */
async function porEnlace(db: SupabaseClient, id: unknown, token: string): Promise<Fila | null> {
  const idStr = texto(id, 64);
  const tk = token.trim().toUpperCase();
  if (idStr.length >= 30) {
    const { data } = await db
      .from("clientes")
      .select("*")
      .eq("id", idStr)
      .eq("portal_token", tk)
      .maybeSingle();
    if (data) return data as Fila;
  }
  const { data: lista } = await db.from("clientes").select("*").eq("portal_token", tk).limit(20);
  if (!lista?.length) return null;
  if (!idStr) return (lista[0] as Fila) ?? null;
  return (
    (lista as Fila[]).find((c) => String(c.id ?? "").toLowerCase().startsWith(idStr.toLowerCase())) ??
    (lista[0] as Fila) ??
    null
  );
}

/** Resuelve el cliente por pseudónimo + token + clave, en tiempo constante. */
async function porCredenciales(
  db: SupabaseClient,
  usuario: string,
  token: string,
  clave: string
): Promise<Fila | null> {
  const patron = usuario.trim().toUpperCase();
  // Mínimo de caracteres y tope de filas: con un `%` o un string vacío, el
  // `ilike` devuelve la tabla entera y se convierte en un oráculo de búsqueda.
  if (patron.length < 3) return null;
  const { data } = await db.from("clientes").select("*").ilike("seudonimo", `%${patron}%`).limit(10);
  const lista = (data ?? []) as Fila[];
  return (
    lista.find(
      (c) =>
        c.portal_habilitado !== false &&
        igual(texto(c.portal_token), token) &&
        igual(texto(c.portal_clave), clave)
    ) ?? null
  );
}

/** Cliente ya autenticado por token, para las acciones que no son login. */
async function porToken(db: SupabaseClient, id: unknown, token: string): Promise<Fila | null> {
  if (!token) return null;
  return porEnlace(db, id, token);
}

Deno.serve(async (req: Request) => {
  // Preflight CORS: se responde ANTES de exigir POST. Sin esto el navegador
  // nunca llega a mandar la llamada real (ver CORS arriba).
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "desconocida";

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_BODY) return json({ ok: false, error: "Solicitud demasiado grande" }, 413);

  let e: {
    accion?: string;
    id?: string;
    token?: string;
    usuario?: string;
    clave?: string;
    [k: string]: unknown;
  };
  try {
    e = JSON.parse(cuerpo);
  } catch {
    return json({ ok: false, error: "Datos inválidos" }, 400);
  }

  const accion = texto(e.accion, 40);
  if (accion === "entrar") {
    if (excedido(ip)) return json({ ok: false, error: "Demasiados intentos. Probá en unos minutos." }, 429);
  } else if (!accion) {
    return json({ ok: false, error: "Falta la acción." }, 400);
  }

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // --- login ---------------------------------------------------------------
  if (accion === "entrar") {
    // Anti-bot: si hay proveedor configurado, el token es obligatorio. El
    // honeypot del navegador ya descartó a los bots más tontos; esto es la
    // puerta de verdad para los que sí llenan el campo.
    const captcha = await verificarCaptcha(texto(e.captcha, 4096), ip);
    if (captcha === "fallo") {
      return json({ ok: false, error: "No pudimos verificar que no sos un robot. Probá de nuevo." }, 403);
    }

    const token = texto(e.token, 128);
    let cliente: Fila | null = null;
    if (e.id && token) cliente = await porEnlace(db, e.id, token);
    else if (e.usuario && token && e.clave) cliente = await porCredenciales(db, texto(e.usuario, 64), token, texto(e.clave, 128));
    else return json({ ok: false, error: "Faltan datos para entrar." }, 400);

    // Un solo mensaje para cliente inexistente, clave mala y portal
    // deshabilitado: distinguirlos permite enumerar quién tiene cuenta.
    if (!cliente || cliente.portal_habilitado === false) return json({ ok: false, error: ERROR_LOGIN }, 401);
    return json({ ok: true, cliente: clientePublico(cliente) });
  }

  // --- resto de acciones: el token define contra qué cliente se opera ------
  // Excepción: `leer-imagen` la puede pedir el staff con su JWT, y el staff no
  // tiene token de portal. Para todo lo demás, o es un cliente del portal con su
  // token, o no es nadie.
  //
  // El salto se calcula SOLO para `leer-imagen`. Antes se evaluaba para todas las
  // acciones, así que cualquier cuenta de Auth metía un JWT y entraba sin token
  // de portal: `cliente` quedaba en null, `cid` en undefined, y las acciones
  // seguían adelante. Con `cid` sin definir, "datos" devolvía las apuestas de
  // nadie y los reclamos tampoco tenían a quién colgar.
  const esStaff = accion === "leer-imagen" ? await esStaffAutenticado(db, req) : false;
  const cliente = esStaff ? null : await porToken(db, e.id, texto(e.token, 128));
  if (!esStaff && (!cliente || cliente.portal_habilitado === false)) {
    return json({ ok: false, error: ERROR_LOGIN }, 401);
  }
  const cid = cliente?.id;

  // --- lectura: sus apuestas y sus reclamos --------------------------------
  if (accion === "datos") {
    const nomCli = String(cliente?.nombre ?? "").trim().toUpperCase();
    const seuCli = String(cliente?.seudonimo ?? "").trim().toUpperCase();
    const filtrosOr: string[] = [];
    if (cid != null) {
      filtrosOr.push(`cliente_juega_id.eq.${cid}`);
      filtrosOr.push(`cliente_consigue_id.eq.${cid}`);
    }
    if (nomCli) {
      filtrosOr.push(`cliente_juega_nombre.ilike.${nomCli}`);
      filtrosOr.push(`cliente_consigue_nombre.ilike.${nomCli}`);
    }
    if (seuCli && seuCli !== nomCli) {
      filtrosOr.push(`cliente_juega_nombre.ilike.${seuCli}`);
      filtrosOr.push(`cliente_consigue_nombre.ilike.${seuCli}`);
    }

    const [apuestas, reclamos, grupo] = await Promise.all([
      db
        .from("tickets_apuestas")
        .select(
          "id, fecha_registro, fecha_carrera, nota_auditoria, hipodromo, carrera, nombre_jugada, caballo, ejemplar_numero, cantidad_tablas, monto_jugado, monto_decidido, premio_pagar, premio_por_tabla, moneda, estado, anulada, es_adelantada, grupo_cobro_nombre, grupo_cobro_id, cliente_juega_id, cliente_juega_nombre, cliente_consigue_id, cliente_consigue_nombre, comision_porcentaje, comision_pagada"
        )
        .or(filtrosOr.join(","))
        .order("fecha_registro", { ascending: false })
        .limit(2000),
      db.from("notificaciones").select("*").eq("cliente_id", cid).order("created_at", { ascending: false }).limit(50),
      // Config del grupo del jugador (ventana de reclamos + ciclo semanal). El
      // portal la necesita para restringir la fecha de la "jugada no
      // relacionada"; el navegador no puede leer `grupos_venta` por RLS.
      cliente?.grupo_id
        ? db
            .from("grupos_venta")
            .select("id, nombre, ventana_reclamos, dia_inicio_semana, dia_fin_semana, moneda, logo_url")
            .eq("id", cliente.grupo_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (apuestas.error) return json({ ok: false, error: "No se pudieron leer las apuestas." }, 502);
    return json({
      ok: true,
      tickets: apuestas.data ?? [],
      reclamos: reclamos.data ?? [],
      grupo: grupo.data ?? null,
    });
  }

  // --- reclamo de jugada faltante / disputa -------------------------------
  if (accion === "reclamo") {
    const tipo = texto(e.tipo, 40) === "DISPUTA" ? "DISPUTA" : "REPORTE_FALTANTE";
    // El nombre sale del cliente validado, no de lo que mande el navegador: si
    // viniera del body, un cliente podría abrir un reclamo a nombre de otro.
    const nombre = texto(cliente?.nombre ?? cliente?.seudonimo, 160) || "Cliente";
    const fila: Fila = {
      cliente_id: cid,
      cliente_nombre: nombre,
      tipo_jugada: tipo,
      fecha_jugada: new Date().toISOString().slice(0, 10),
      hipodromo: texto(e.hipodromo, 80),
      carrera: numero(e.carrera),
      monto: numero(e.monto),
      motivo: texto(e.motivo, 1000),
      imagen_soporte: texto(e.imagen, 500) || null,
      estado: "EN_REVISION",
      creado_por: "portal",
    };
    if (tipo === "DISPUTA") {
      // La disputa referencia un movimiento real. Se ancla al cliente: sin
      // esto, el id traveling lo mandaba otro cliente y el reclamo aterriza
      // sobre una apuesta ajena.
      const jugada = await db
        .from("tickets_apuestas")
        .select("id, nombre_jugada, caballo")
        .eq("id", texto(e.jugada_id, 64))
        .eq("cliente_juega_id", cid)
        .maybeSingle();
      if (!jugada.data) return json({ ok: false, error: "Ese movimiento no es tuyo." }, 403);
      fila.jugada_id = String(jugada.data.id);
      const descOrigen = [
        texto(e.jugada_origen, 160) || texto(e.nombre_jugada, 120) || (jugada.data.nombre_jugada as string),
        texto(e.caballo, 120) || (jugada.data.caballo as string),
      ]
        .filter(Boolean)
        .join(" · ");
      fila.jugada_origen = descOrigen || null;
    } else {
      const descFaltante = [texto(e.nombre_jugada, 120), texto(e.caballo, 120)].filter(Boolean).join(" · ");
      if (descFaltante) fila.jugada_origen = descFaltante;
    }
    const { error } = await db.from("tickets_jugadas").insert([fila]);
    if (error) return json({ ok: false, error: "No se pudo registrar el reclamo." }, 502);
    return json({ ok: true });
  }

  // --- marcar una apuesta propia como reclamada ---------------------------
  if (accion === "marcar") {
    // El `.eq("cliente_juega_id", cid)` es lo que faltaba en el navegador: sin
    // él, el id de cualquier apuesta del sistema servía para marcarla.
    const { data, error } = await db
      .from("tickets_apuestas")
      .update({ estado: "EN_REVISION" })
      .eq("id", texto(e.ticket_id, 64))
      .eq("cliente_juega_id", cid)
      .select("id");
    if (error) return json({ ok: false, error: "No se pudo marcar el movimiento." }, 502);
    if (!data?.length) return json({ ok: false, error: "Ese movimiento no es tuyo." }, 403);
    return json({ ok: true });
  }

  // --- solicitud de compra de tablas fijas -------------------------------
  if (accion === "solicitud") {
    const cantidad = Math.max(1, Math.floor(numero(e.cantidad)));
    const costo = numero(e.costo_usd);
    const { error } = await db.from("solicitudes_tablas").insert([
      {
        cliente_id: cid,
        cliente_nombre: texto(cliente?.nombre ?? cliente?.seudonimo, 160) || "Cliente",
        tabla_id: texto(e.tabla_id, 64),
        hipodromo: texto(e.hipodromo, 80),
        carrera: numero(e.carrera),
        ejemplar_numero: texto(e.ejemplar_numero, 40),
        ejemplar_nombre: texto(e.ejemplar_nombre, 120),
        cantidad,
        pts_ejemplar: e.pts_ejemplar != null ? numero(e.pts_ejemplar) : null,
        premio_por_tabla: numero(e.premio_por_tabla),
        moneda: texto(e.moneda, 8) || "USD",
        costo_usd: costo || null,
        monto_total: costo ? costo * cantidad : null,
      },
    ]);
    if (error) return json({ ok: false, error: "No se pudo enviar la solicitud." }, 502);
    return json({ ok: true });
  }

  // --- 🐎 REALIZAR JUGADA desde el Portal (PROMPT #6) ----------------------
  //
  // El jugador vende contra SU grupo, no contra el que diga el navegador. Todos
  // los ids (cliente/grupo) salen de la fila validada por el token; el monto y
  // los detalles sí vienen del body, y las RPC de venta los revalidan otra vez
  // (saldo + aval, cupo, jerarquía de cruces, participantes que corren).
  //
  // Se reutilizan las RPC de taquilla —`club_vender_tabla_fija`,
  // `club_vender_marca`, `club_vender_dupleta`— y la variante de Polla del
  // portal (`club_portal_vender_polla`). Si la migración aún no está aplicada en
  // la base, la RPC no existe y esto devuelve un mensaje claro en vez de un
  // ticket a medias.
  if (accion === "vender") {
    const grupoId = texto(cliente?.grupo_id, 64);
    if (!grupoId) {
      return json({ ok: false, error: "Tu cuenta todavía no está asignada a un grupo." }, 400);
    }
    const tipo = texto(e.tipo, 20).toUpperCase();
    const monto = numero(e.monto);
    if (!(monto > 0)) return json({ ok: false, error: "El monto tiene que ser mayor que cero." }, 400);

    let rpc = "";
    let args: Fila = {};
    if (tipo === "TABLA_FIJA") {
      const tablaId = texto(e.tabla_id, 64);
      if (!tablaId) return json({ ok: false, error: "Falta la tabla fija." }, 400);
      rpc = "club_vender_tabla_fija";
      args = {
        p_tabla_id: tablaId,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_monto: monto,
        p_cantidad: Math.max(1, Math.floor(numero(e.cantidad) || 1)),
        p_ejemplar_numero: texto(e.ejemplar, 40) || null,
        p_usuario: "portal",
      };
    } else if (tipo === "MARCA") {
      const hipo = texto(e.hipodromo, 80).toUpperCase();
      const caballo = texto(e.caballo, 40);
      const rival = texto(e.rival, 40);
      if (!hipo || !caballo || !rival) {
        return json({ ok: false, error: "Faltan datos de la marca (hipódromo, caballo y rival)." }, 400);
      }
      rpc = "club_vender_marca";
      args = {
        p_hipodromo: hipo,
        p_fecha: texto(e.fecha, 10) || null,
        p_carrera: Math.max(1, Math.floor(numero(e.carrera))),
        p_caballo: caballo,
        p_rival: rival,
        p_monto: monto,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_usuario: "portal",
      };
    } else if (tipo === "DUPLETA") {
      const hipo = texto(e.hipodromo, 80).toUpperCase();
      const n1 = texto(e.numero1, 20);
      const n2 = texto(e.numero2, 20);
      if (!hipo || !n1 || !n2) {
        return json({ ok: false, error: "Faltan datos de la dupleta (hipódromo y los dos ejemplares)." }, 400);
      }
      rpc = "club_vender_dupleta";
      args = {
        p_hipodromo: hipo,
        p_fecha: texto(e.fecha, 10) || null,
        p_carrera1: Math.max(1, Math.floor(numero(e.carrera1))),
        p_carrera2: Math.max(1, Math.floor(numero(e.carrera2))),
        p_numero1: n1,
        p_numero2: n2,
        p_monto: monto,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_usuario: "portal",
      };
    } else if (tipo === "POLLA") {
      const pollaId = texto(e.polla_id, 64);
      const combos = Array.isArray(e.combinaciones) ? e.combinaciones : [];
      if (!pollaId) return json({ ok: false, error: "Falta la Polla." }, 400);
      if (!combos.length) return json({ ok: false, error: "Elegí al menos una combinación." }, 400);
      rpc = "club_portal_vender_polla";
      args = {
        p_polla_id: pollaId,
        p_combinaciones: combos,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_texto_original: texto(e.texto_original, 400) || null,
      };
    } else {
      return json({ ok: false, error: "Ese tipo de jugada no existe." }, 400);
    }

    const { data, error } = await db.rpc(rpc, args);
    if (error) {
      // El mensaje de la RPC (saldo insuficiente, sin permiso de cruce, etc.) es
      // lo que el jugador necesita leer; se recorta por si trae un stack.
      return json({ ok: false, error: texto(error.message, 300) || "No se pudo registrar la jugada." }, 400);
    }
    return json({ ok: true, venta: data ?? null });
  }

  // --- ➕ SOLICITUD DE "JUGADA NO RELACIONADA" (PROMPT #6) -----------------
  //
  // Cuando al jugador no le aparece una jugada que sí hizo, pide que se la
  // incluyan. Queda como un reclamo (tickets_jugadas, tipo SOLICITUD_JUGADA) en
  // la bandeja del admin, que la aprueba (insertando la jugada) o la rechaza.
  // La fecha tiene que caer dentro de la ventana de reclamos del grupo; el
  // navegador ya la restringe, y acá se vuelve a comprobar contra la base.
  if (accion === "solicitud-jugada") {
    const grupoId = texto(cliente?.grupo_id, 64);
    const fecha = texto(e.fecha, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return json({ ok: false, error: "La fecha no es válida." }, 400);
    }
    const monto = numero(e.monto);
    if (!(monto > 0)) return json({ ok: false, error: "El monto tiene que ser mayor que cero." }, 400);
    const hipodromo = texto(e.hipodromo, 80);
    const tipoJugada = texto(e.tipo_jugada, 40);
    const ejemplares = texto(e.ejemplares, 300);
    const explicacion = texto(e.explicacion, 1000);
    if (!hipodromo || !tipoJugada || !ejemplares || !explicacion) {
      return json({ ok: false, error: "Completá hipódromo, tipo, ejemplar(es) y explicación." }, 400);
    }

    // Ventana del grupo: si la fecha no cae dentro, se rechaza con el rango.
    let ventana = "SOLO_DIA_EN_CURSO";
    let diaInicio: number | null = null;
    let diaFin: number | null = null;
    if (grupoId) {
      const { data: g } = await db
        .from("grupos_venta")
        .select("ventana_reclamos, dia_inicio_semana, dia_fin_semana")
        .eq("id", grupoId)
        .maybeSingle();
      if (g?.ventana_reclamos) ventana = texto(g.ventana_reclamos, 30).toUpperCase();
      diaInicio = g?.dia_inicio_semana != null ? Number(g.dia_inicio_semana) : null;
      diaFin = g?.dia_fin_semana != null ? Number(g.dia_fin_semana) : null;
    }
    // El piso/tope se calcula igual que en el navegador (`ventana-reclamos.ts`).
    const hoy = new Date().toISOString().slice(0, 10);
    const { piso, tope } = rangoVentana(hoy, ventana, diaInicio, diaFin);
    if (fecha < piso || fecha > tope) {
      const etiqueta = ventana === "SEMANA_EN_CURSO" ? "de la semana en curso" : "del día de hoy";
      return json(
        { ok: false, error: `Tu grupo sólo admite solicitudes de jugadas ${etiqueta} (${piso} a ${tope}).` },
        400
      );
    }

    let imagen: string | null = null;
    if (e.imagen) imagen = texto(e.imagen, 500) || null;

    const nombre = texto(cliente?.nombre ?? cliente?.seudonimo, 160) || "Cliente";
    const { error } = await db.from("tickets_jugadas").insert([
      {
        cliente_id: cid,
        cliente_nombre: nombre,
        tipo_jugada: "SOLICITUD_JUGADA",
        jugada_origen: `${tipoJugada} · ${ejemplares}`.slice(0, 160),
        fecha_jugada: fecha,
        hipodromo,
        carrera: e.carrera != null && String(e.carrera).trim() !== "" ? Math.max(0, Math.floor(numero(e.carrera))) : null,
        monto,
        motivo: `[${tipoJugada} · ${ejemplares}] ${explicacion}`.slice(0, 1000),
        imagen_soporte: imagen,
        estado: "EN_REVISION",
        creado_por: "portal",
      },
    ]);
    if (error) return json({ ok: false, error: "No se pudo enviar la solicitud." }, 502);
    return json({ ok: true });
  }

  // --- actualizar sus datos (queda notificación para el admin) ------------
  if (accion === "datos-cliente") {
    const campos = ["telefono", "codigo_pais", "email", "cedula_rif", "direccion", "metodo_pago"];
    const pedido: Record<string, unknown> = {};
    for (const c of campos) if (e[c] != null) pedido[c] = texto(e[c], 200);
    if (!Object.keys(pedido).length) return json({ ok: false, error: "No enviaste datos para actualizar." }, 400);

    const { error } = await db.from("notificaciones").insert([
      {
        tipo: "portal_datos",
        titulo: "El cliente actualizó sus datos",
        mensaje: `Solicitud de actualización enviada el ${new Date().toLocaleString("es-VE")}.`,
        cliente_id: cid,
        cliente_nombre: texto(cliente?.nombre ?? cliente?.seudonimo, 160) || "Cliente",
        datos: pedido,
        estado: "Nueva",
      },
    ]);
    if (error) return json({ ok: false, error: "No se pudo enviar el cambio." }, 502);
    // A propósito NO se actualiza `clientes` desde acá. Que el cliente escriba
    // su propia cédula o su saldo por el portal es exactamente lo que no hay
    // que permitir; el admin atiende la notificación y decide.
    return json({ ok: true });
  }

  // --- 👤 Mi Perfil: autogestión de datos personales (PROMPT #7) -----------
  //
  // Esta acción SÍ escribe en `clientes`, a diferencia de `datos-cliente`: la
  // autogestión pide guardar en el momento, con confirmación de éxito. La
  // diferencia de seguridad está en el ALCANCE, no en la confianza: solo se
  // acepta una lista blanca de columnas de identidad / contacto / cobro
  // (nombre, código de país, teléfono, correo, formas de pago) y, encima, el
  // PIN de acceso del propio portal — que exige el PIN actual para cambiarse.
  //
  // quedan FUERA de la lista: saldo_actual, comision, devolucion, aval,
  // grupo_id, monto_total_jugado, portal_token, portal_habilitado y cualquier
  // otra columna financiera o de permisos. Ni el navegador ni un token robado
  // pueden moverlas por este camino.
  if (accion === "perfil") {
    const pedido: Fila = {};
    const campos: Array<[string, number]> = [
      ["seudonimo", 80],
      ["nombre", 160],
      ["apellido", 120],
      ["cedula_rif", 40],
      ["codigo_pais", 8],
      ["telefono", 40],
      ["email", 160],
      ["direccion", 250],
      ["dia_cuadre", 40],
      ["forma_cuadre", 40],
    ];
    for (const [c, max] of campos) if (e[c] != null) pedido[c] = texto(e[c], max);

    if (e.formas_pago != null) {
      const formas = sanitizarFormasPago(e.formas_pago);
      if (!formas) return json({ ok: false, error: "Las formas de pago no tienen un formato válido." }, 400);
      if (formas.length) {
        pedido.formas_pago = formas;
        // Espejo legacy: la principal sigue emparejando metodo_pago + datos_pago
        // para todo lo que todavía lee UNA sola forma (Cuadre, tickets, etc.).
        pedido.metodo_pago = formas[0].metodo;
        pedido.datos_pago = formas[0].datos ?? null;
      } else {
        pedido.formas_pago = [];
        pedido.metodo_pago = null;
        pedido.datos_pago = null;
      }
    }

    const claveNueva = texto(e.clave_nueva, 64);
    if (claveNueva) {
      if (claveNueva.length < 4 || claveNueva.length > 8) {
        return json({ ok: false, error: "El PIN de acceso debe tener entre 4 y 8 caracteres." }, 400);
      }
      // El cambio de PIN siempre pide el PIN vigente: un token robado no
      // debería poder rotar la contraseña y dejar afuera al dueño.
      if (!igual(texto(cliente?.portal_clave), texto(e.clave_actual))) {
        return json({ ok: false, error: "El PIN actual no coincide." }, 403);
      }
      pedido.portal_clave = claveNueva.toUpperCase();
    }

    if (!Object.keys(pedido).length) return json({ ok: false, error: "No enviaste datos para actualizar." }, 400);

    const { data, error } = await db.from("clientes").update(pedido).eq("id", cid).select("*").single();
    if (error || !data) return json({ ok: false, error: "No se pudieron guardar tus datos." }, 502);

    // Rastro para el admin (mejor esfuerzo: si la notificación falla, el
    // guardado del cliente ya está hecho y no se pierde).
    const paraAviso: Fila = { ...pedido };
    if (paraAviso.portal_clave) paraAviso.portal_clave = "****";
    await db.from("notificaciones").insert([
      {
        tipo: "portal_datos",
        titulo: "El cliente actualizó su perfil (autogestión)",
        mensaje: `Cambios aplicados el ${new Date().toLocaleString("es-VE")} desde el Portal del Cliente.`,
        cliente_id: cid,
        cliente_nombre: texto(cliente?.nombre ?? cliente?.seudonimo, 160) || "Cliente",
        datos: paraAviso,
        estado: "Nueva",
      },
    ]);

    return json({ ok: true, cliente: clientePublico(data as Fila) });
  }

  // --- 📓 Grupos externos de la bitácora personal (PROMPT #7) --------------
  //
  // Tablas propias (`portal_grupos_externos` / `portal_jugadas_externas`) con
  // RLS sin políticas: solo service_role las toca, siempre ancladas al
  // `cliente_id` que salió del token. Nada de esto toca tickets, grupos
  // oficiales, cajas ni reportes.
  if (accion === "grupos-externos") {
    const modo = texto(e.modo, 20);

    if (modo === "listar") {
      const { data, error } = await db
        .from("portal_grupos_externos")
        .select("id, nombre, moneda, comision_pct, creado_at")
        .eq("cliente_id", cid)
        .order("nombre", { ascending: true });
      if (error) return json({ ok: false, error: "No se pudieron leer tus grupos externos." }, 502);
      return json({ ok: true, grupos: data ?? [] });
    }

    if (modo === "crear" || modo === "editar") {
      const nombre = texto(e.nombre, 60).toUpperCase();
      if (!nombre) return json({ ok: false, error: "Poné un nombre al grupo externo." }, 400);
      const moneda = (texto(e.moneda, 8) || "USD").toUpperCase();
      const comision = Math.min(100, Math.max(0, numero(e.comision_pct)));

      if (modo === "crear") {
        const { data, error } = await db
          .from("portal_grupos_externos")
          .insert([{ cliente_id: cid, nombre, moneda, comision_pct: comision }])
          .select("id")
          .single();
        if (error) {
          const duplicado = (error as { code?: string }).code === "23505";
          return json(
            { ok: false, error: duplicado ? "Ya tenés un grupo externo con ese nombre." : "No se pudo crear el grupo externo." },
            duplicado ? 409 : 502
          );
        }
        return json({ ok: true, id: data.id });
      }

      // El `.eq("cliente_id", cid)` es lo que impide editar un grupo ajeno con
      // un id viajero: sin él, cualquier id válido alcanzaría.
      const { data, error } = await db
        .from("portal_grupos_externos")
        .update({ nombre, moneda, comision_pct: comision })
        .eq("id", texto(e.grupo_id, 64))
        .eq("cliente_id", cid)
        .select("id");
      if (error) return json({ ok: false, error: "No se pudo editar el grupo externo." }, 502);
      if (!data?.length) return json({ ok: false, error: "Ese grupo externo no es tuyo." }, 403);
      return json({ ok: true, id: data[0].id });
    }

    if (modo === "eliminar") {
      const { data, error } = await db
        .from("portal_grupos_externos")
        .delete()
        .eq("id", texto(e.grupo_id, 64))
        .eq("cliente_id", cid)
        .select("id");
      if (error) return json({ ok: false, error: "No se pudo eliminar el grupo externo." }, 502);
      if (!data?.length) return json({ ok: false, error: "Ese grupo externo no es tuyo." }, 403);
      // Las jugadas del grupo se caen con él (FK `on delete cascade`).
      return json({ ok: true });
    }

    return json({ ok: false, error: "Modo desconocido para grupos externos." }, 400);
  }

  // --- 📓 Jugadas de la bitácora personal (PROMPT #7) ----------------------
  if (accion === "jugada-externa") {
    const modo = texto(e.modo, 20);

    // Toda operación arranca comprobando que el grupo de la jugada sea del
    // cliente que validó el token (id viajero → 403).
    const grupoPropio = async (): Promise<boolean> => {
      const { data } = await db
        .from("portal_grupos_externos")
        .select("id")
        .eq("id", texto(e.grupo_externo_id, 64))
        .eq("cliente_id", cid)
        .maybeSingle();
      return Boolean(data);
    };

    if (modo === "listar") {
      if (!(await grupoPropio())) return json({ ok: false, error: "Ese grupo externo no es tuyo." }, 403);
      const { data, error } = await db
        .from("portal_jugadas_externas")
        .select("id, grupo_externo_id, fecha, hipodromo, carrera, tipo_jugada, ejemplares, monto, estado, creado_at")
        .eq("cliente_id", cid)
        .eq("grupo_externo_id", texto(e.grupo_externo_id, 64))
        .order("fecha", { ascending: false })
        .order("id", { ascending: false });
      if (error) return json({ ok: false, error: "No se pudieron leer las jugadas." }, 502);
      return json({ ok: true, jugadas: data ?? [] });
    }

    if (modo === "crear" || modo === "editar") {
      const fecha = texto(e.fecha, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json({ ok: false, error: "La fecha no es válida." }, 400);
      const monto = numero(e.monto);
      if (!(monto > 0)) return json({ ok: false, error: "El monto tiene que ser mayor que cero." }, 400);
      const estado = texto(e.estado, 12).toUpperCase();
      if (!ESTADOS_BITACORA.includes(estado)) {
        return json({ ok: false, error: `Estado inválido: use ${ESTADOS_BITACORA.join(" / ")}.` }, 400);
      }
      if (!(await grupoPropio())) return json({ ok: false, error: "Ese grupo externo no es tuyo." }, 403);

      const fila: Fila = {
        cliente_id: cid,
        grupo_externo_id: texto(e.grupo_externo_id, 64),
        fecha,
        hipodromo: texto(e.hipodromo, 60),
        carrera:
          e.carrera != null && String(e.carrera).trim() !== ""
            ? Math.max(0, Math.floor(numero(e.carrera)))
            : null,
        tipo_jugada: texto(e.tipo_jugada, 40) || "JUGADA",
        ejemplares: texto(e.ejemplares, 300),
        monto,
        estado,
      };

      if (modo === "crear") {
        const { error } = await db.from("portal_jugadas_externas").insert([fila]);
        if (error) return json({ ok: false, error: "No se pudo registrar la jugada." }, 502);
        return json({ ok: true });
      }

      const { data, error } = await db
        .from("portal_jugadas_externas")
        .update(fila)
        .eq("id", texto(e.jugada_id, 64))
        .eq("cliente_id", cid)
        .select("id");
      if (error) return json({ ok: false, error: "No se pudo editar la jugada." }, 502);
      if (!data?.length) return json({ ok: false, error: "Esa jugada no es tuya." }, 403);
      return json({ ok: true });
    }

    if (modo === "eliminar") {
      const { data, error } = await db
        .from("portal_jugadas_externas")
        .delete()
        .eq("id", texto(e.jugada_id, 64))
        .eq("cliente_id", cid)
        .select("id");
      if (error) return json({ ok: false, error: "No se pudo eliminar la jugada." }, 502);
      if (!data?.length) return json({ ok: false, error: "Esa jugada no es tuya." }, 403);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Modo desconocido para jugadas externas." }, 400);
  }

  // --- imagen de reclamo: URL firmada, bucket privado ----------------------
  // El bucket `reclamos` no existe todavía (verificado: 404 NoSuchBucket), y
  // la versión anterior usaba `getPublicUrl`, que además lo dejaría legible por
  // cualquiera. Los pantallazos de un reclamo tienen datos de la apuesta, así
  // que el bucket tiene que ser privado y el acceso va por URL firmada.
  //
  // Dos pasos: el cliente pide una URL de subida firmada y PUTea el archivo; el
  // path es lo que se guarda en la base. Así el bucket no necesita ninguna
  // policy para `anon`.
  if (accion === "subir-imagen") {
    const nombre = texto(e.nombre, 120).replace(/[^\w.-]/g, "_") || "reclamo.jpg";
    // La ruta la arma el servidor con el cliente validado, no con lo que mande
    // el navegador: si el path viniera del cliente, se podría escribir en la
    // carpeta de otro cliente y colgarle una imagen.
    const ruta = `${cid}/${crypto.randomUUID()}_${nombre}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(ruta);
    if (error || !data?.signedUrl) {
      return json({ ok: false, error: "No se pudo preparar la subida de la imagen." }, 502);
    }
    return json({ ok: true, ruta, token: data.token, url: data.signedUrl });
  }

  // --- ver una imagen ya subida -------------------------------------------
  // La consola de Tickets también necesita verla, y el bucket es privado. El
  // staff llega acá con su JWT de Supabase (rol `authenticated`), el cliente con
  // su token. Se aceptan los dos, pero el cliente solo puede firmar su propia
  // carpeta: el `ruta` se valida contra el `cid` que salió de su token.
  if (accion === "leer-imagen") {
    const ruta = texto(e.ruta, 300);
    if (!ruta) return json({ ok: false, error: "Falta la imagen." }, 400);

    // La ruta se concatena con el nombre del bucket. Un `..` o una barra inicial
    // convierten "../otra-cosa/x.png", que no es "otra cosa dentro del bucket":
    // se rechaza antes de firmarla.
    if (ruta.startsWith("/") || ruta.includes("..") || ruta.includes("\\")) {
      return json({ ok: false, error: "Ruta de imagen inválida." }, 400);
    }

    if (!esStaff && !ruta.startsWith(`${cid}/`)) {
      return json({ ok: false, error: "Esa imagen no es tuya." }, 403);
    }
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(ruta, 60 * 10);
    if (error || !data?.signedUrl) return json({ ok: false, error: "No se pudo abrir la imagen." }, 502);
    return json({ ok: true, url: data.signedUrl });
  }

  return json({ ok: false, error: "Acción desconocida." }, 400);
});
