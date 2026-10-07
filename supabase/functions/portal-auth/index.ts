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
// LÍMITE DE INTENTOS
// ---------------------------------------------------------------------------
// El login del portal no tiene CAPTCHA todavía. Acá hay un tope por IP para
// que el token no se pueda recorrer a fuerza bruta desde una sola dirección.
// Es por memoria del proceso de Deno, no es un rate limit distribuido: se
// reinicia cuando la función se recicla. Para algo que valga de verdad hay que
// ponerlo en la base (tabla de intentos) o adelante de la función. Está
// anotado en PLANIFICACION.md como pendiente, no como hecho.
// ============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY = 64 * 1024;
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;
const BUCKET = "reclamos";

type Fila = Record<string, unknown>;

/** Intentos fallidos por IP: [marca de tiempo, ...]. */
const intentos = new Map<string, number[]>();
let ultimoRecolecta = 0;

function excedido(ip: string): boolean {
  const ahora = Date.now();
  // Poda perezosa: cada tanto se limpian las entradas viejas.
  if (ahora - ultimoRecolecta > VENTANA_MS) {
    ultimoRecolecta = ahora;
    for (const [k, v] of intentos) {
      const vivos = v.filter((t) => ahora - t < VENTANA_MS);
      if (vivos.length) intentos.set(k, vivos);
      else intentos.delete(k);
    }
  }
  const previos = (intentos.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (previos.length >= MAX_INTENTOS) {
    intentos.set(ip, previos);
    return true;
  }
  intentos.set(ip, [...previos, ahora]);
  return false;
}

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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
  const { data } = await db
    .from("clientes")
    .select("*")
    .eq("id", texto(id, 64))
    .eq("portal_token", token)
    .maybeSingle();
  return (data as Fila | null) ?? null;
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
        c.portal_habilitado === true &&
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
    const token = texto(e.token, 128);
    let cliente: Fila | null = null;
    if (e.id && token) cliente = await porEnlace(db, e.id, token);
    else if (e.usuario && token && e.clave) cliente = await porCredenciales(db, texto(e.usuario, 64), token, texto(e.clave, 128));
    else return json({ ok: false, error: "Faltan datos para entrar." }, 400);

    // Un solo mensaje para cliente inexistente, clave mala y portal
    // deshabilitado: distinguirlos permite enumerar quién tiene cuenta.
    if (!cliente || cliente.portal_habilitado !== true) return json({ ok: false, error: ERROR_LOGIN }, 401);
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
  if (!esStaff && (!cliente || cliente.portal_habilitado !== true)) {
    return json({ ok: false, error: ERROR_LOGIN }, 401);
  }
  const cid = cliente?.id;

  // --- lectura: sus apuestas y sus reclamos --------------------------------
  if (accion === "datos") {
    // fecha_registro y no created_at: tickets_apuestas no tiene created_at
    // (verificado en vivo), y pedirlo rompía la consulta.
    const [apuestas, reclamos] = await Promise.all([
      db
        .from("tickets_apuestas")
        .select(
          "id, fecha_registro, hipodromo, carrera, nombre_jugada, caballo, cantidad_tablas, monto_jugado, monto_decidido, premio_pagar, premio_por_tabla, moneda, estado, grupo_cobro_nombre, grupo_cobro_id"
        )
        .eq("cliente_juega_id", cid)
        .order("fecha_registro", { ascending: false })
        .limit(500),
      db.from("notificaciones").select("*").eq("cliente_id", cid).order("created_at", { ascending: false }).limit(50),
    ]);
    if (apuestas.error) return json({ ok: false, error: "No se pudieron leer las apuestas." }, 502);
    return json({ ok: true, tickets: apuestas.data ?? [], reclamos: reclamos.data ?? [] });
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
        .select("id, nombre_jugada")
        .eq("id", texto(e.jugada_id, 64))
        .eq("cliente_juega_id", cid)
        .maybeSingle();
      if (!jugada.data) return json({ ok: false, error: "Ese movimiento no es tuyo." }, 403);
      fila.jugada_id = String(jugada.data.id);
      fila.jugada_origen = (jugada.data.nombre_jugada as string) ?? null;
      fila.nombre_jugada = texto(e.nombre_jugada, 120) || (jugada.data.nombre_jugada as string) || null;
      fila.caballo = texto(e.caballo, 120) || null;
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
  if (  accion === "leer-imagen") {
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
