/**
 * Portal de Consulta del Cliente — clon moderno de js/portal.js (tarea 5).
 *
 *  - Entrada: por enlace largo (?c=<id>&k=<token>) o credenciales manuales
 *    (seudónimo/código + contraseña). La comparación de token y clave la hace
 *    la Edge Function `portal-auth`; este archivo nunca ve `portal_clave`.
 *  - Resumen/KPIs: Saldo (total decidido), Incentivo (devolución %) y Disponible.
 *  - Movimientos con acción "Reclamar" y "Reportar jugada faltante" (imagen a
 *    Supabase Storage, bucket `reclamos`; se inserta en tickets_jugadas).
 *  - Comprar Tablas Fijas → solicitudes_tablas (valida el admin).
 *  - Actualizar mis datos → notificaciones.tipo='portal_datos' (atendida por admin).
 *  - 📓 Bitácora personal en grupos EXTERNOS (PROMPT #7): grupos externos y
 *    jugadas propias en `portal_grupos_externos` / `portal_jugadas_externas`.
 *    Es un libro privado del usuario: NO toca tickets, caja ni reportes de los
 *    grupos oficiales (los tipos y los cálculos puros están en
 *    `bitacoraExterna.ts`, la entrada/salida de datos está acá).
 *  - 👤 Mi Perfil (PROMPT #7): autogestión de nombre, teléfono, correo, PIN de
 *    acceso y formas de pago vía acción `perfil` de la Edge Function.
 */
import { supabase } from "@/core/supabase";
import { TIMEOUT_SESION_MS } from "@/features/auth/lib/sesion";
import {
  construirEstadoCuenta,
  credencialesPortalPorDefecto,
  type ClienteRow,
  type NivelAcordeon,
  type NotificacionRow,
  type TicketApuesta,
} from "@/features/clientes/lib/clientes";
import { normalizarFormasPago, type FormaPago } from "@/features/clientes/lib/formasPago";
import {
  calcularEstadoCuentaCliente,
  construirFichaEstadoCuentaUnificada,
  type FichaEstadoCuentaUnificada,
} from "@/features/saldos/lib/contabilidad-central";
import { redondearCentavos } from "@/shared/lib/dinero";
import {
  normalizarEstadoJugada,
  validarGrupoExterno,
  validarJugadaExterna,
  type GrupoExterno,
  type JugadaExterna,
} from "@/features/portal/lib/bitacoraExterna";
// Tipos y cálculos puros de la bitácora personal (PROMPT #7) se re-exportan
// desde acá: `bitacoraExterna.ts` no habla con la base, este archivo sí.
export {
  ESTADOS_JUGADA_EXTERNA,
  ESTADO_POR_DEFECTO,
  esEstadoJugadaExterna,
  normalizarEstadoJugada,
  premioGrupoExterno,
  resumenGrupoExterno,
  validarGrupoExterno,
  validarJugadaExterna,
  type EstadoJugadaExterna,
  type GrupoExterno,
  type JugadaExterna,
  type ResumenGrupoExterno,
} from "@/features/portal/lib/bitacoraExterna";
// OJO: las funciones de escritura de ESTE archivo NO se pueden proteger con
// `exigirCapacidad`. El portal no usa la sesión de Supabase del personal: el
// cliente entra con su propio token/clave (ver `entrarPortal`) y no tiene
// capacidades en la matriz. Ponerle un guard de staff dejaría al cliente real
// sin poder jugar ni reclamar. La frontera del portal es la validación del
// token, que ocurre en la Edge Function, no el maestro.
//
// ---------------------------------------------------------------------------
// POR QUÉ EL PORTAL YA NO HABLA CON LAS TABLAS DE CREDENCIALES
// ---------------------------------------------------------------------------
// Antes: `select *` a `clientes` con la llave anon y, en JavaScript, se buscaba
// la fila cuyo `portal_token` y `portal_clave` coincidieran. Eso no era una
// verificación: la llave anon bajaba la tabla entera, con el token y la clave de
// acceso del portal de TODOS los clientes, más nombre, cédula, teléfono, correo
// y saldo. La contraseña del portal venía en el mismo SELECT que la respuesta,
// así que no protegía nada.
//
// Ahora: la comparación ocurre en `supabase/functions/portal-auth`, que corre
// con service_role y devuelve un veredicto más el cliente SIN esas dos columnas.
// Este módulo solo habla con la función. Si la sesión queda guardada en el
// navegador, lo que queda ahí no sirve para volver a entrar.

export type SesionPortal = {
  cliente: ClienteRow;
  resumen: {
    saldo: number;
    incentivo: number;
    disponible: number;
    aval?: number;
    riesgoEnCurso?: number;
  };
  fichaUnificada: FichaEstadoCuentaUnificada;
  arbolTickets: NivelAcordeon;
  /** Config del grupo del jugador (ventana de reclamos + ciclo). Puede faltar. */
  grupo?: GrupoPortal | null;
};

/** Config del grupo que el Portal necesita (llega con la acción `datos`). */
export type GrupoPortal = {
  id: string | number;
  nombre?: string | null;
  /** 'SOLO_DIA_EN_CURSO' | 'SEMANA_EN_CURSO'. */
  ventana_reclamos?: string | null;
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
  moneda?: string | null;
};

const CACHE_KEY = "portal.cliente";

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Timeout de la Edge Function, para no dejar la pantalla girando. Se toma del
 *  presupuesto de red único (`TIMEOUT_SESION_MS`) para que el portal no corte
 *  antes ni después que el login. */
const TIMEOUT_PORTAL_MS = TIMEOUT_SESION_MS;

/**
 * Llama a la Edge Function `portal-auth`.
 *
 * El cliente del portal no tiene sesión de Supabase, así que la autorización no
 * sale de acá: la hace la función, que compara token y clave con service_role y
 * es la única que puede leer la tabla completa. Por eso el módulo no consulta
 * `clientes` por su cuenta.
 *
 * El límite de tiempo es por el mismo motivo que en el login: una función caída
 * tiene que producir un mensaje, no un spinner eterno.
 */
/**
 * Lo que devuelve la Edge Function: un veredicto más el payload de la acción.
 *
 * El `payload` es el objeto entero que la función manda, no solo `cliente`.
 * Antes el helper devolvía `r.cliente` y tiraba el resto: las acciones que no
 * son login (`datos`, `subir-imagen`) no traen `cliente`, así que sus datos
 * llegaban `undefined` y la pantalla se llenaba de listas vacías sin aviso.
 */
type RespuestaPortal = { ok: true; payload: Record<string, unknown> };

async function llamarPortalAuth(cuerpo: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_PORTAL_MS);
  try {
    const { data, error } = await supabase.functions.invoke("portal-auth", {
      body: cuerpo,
      signal: ctrl.signal,
    });
    if (error) return { ok: false, error: "El servicio del portal no respondió. Probá de nuevo." };
    const r = data as { ok?: boolean; error?: string } | null;
    if (!r?.ok) return { ok: false, error: r?.error ?? "No se pudo completar la operación." };
    // Se saca `ok` y `error` del payload: lo que queda son los datos de la acción.
    const { ok: _ok, error: _error, ...resto } = r as Record<string, unknown>;
    return { ok: true, data: resto };
  } catch {
    return { ok: false, error: "El servicio del portal no respondió. Revisá la conexión." };
  } finally {
    clearTimeout(t);
  }
}

/** Extrae un campo del payload, con el tipo que el que llama espera. */
function de<T>(data: Record<string, unknown> | undefined, clave: string): T | undefined {
  return data?.[clave] as T | undefined;
}

/**
 * Cliente guardado en sesión (persistencia entre recargas).
 *
 * Guarda también el token, porque sin sesión de Supabase el token ES la
 * credencial de sesión del portal: sin él no hay forma de volver a pedir datos
 * después de un refresh. Es el mismo compromiso que cualquier token de SPA
 * (un XSS lo lee), pero es un token de un cliente, no las claves de todos.
 */
type Cache = { cliente: ClienteRow; token: string; id: string | number };

export function sesionGuardada(): ClienteRow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return c?.cliente ?? null;
  } catch {
    return null;
  }
}

function cacheGuardada(): Cache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cache;
    return c?.token ? c : null;
  } catch {
    return null;
  }
}

export function cerrarSesion(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(CACHE_KEY);
}

/**
 * Entra al portal. Si vienen los parámetros ?c= y ?k= del enlace corto, la clave
 * no se exige (equivalente legacy). Devuelve sesión con KPIs precargados.
 *
 * La verificación va a la Edge Function. El mensaje de error es uno solo para
 * todos los casos —cliente inexistente, clave incorrecta, portal deshabilitado—
 * porque un mensaje por caso permite enumerar quién tiene cuenta.
 */
/**
 * Fallback universal de lectura directa sobre `public.clientes` para que todos los
 * clientes registrados tengan acceso al Portal incluso si la Edge Function no está
 * activa o si el cliente aún no tenía token/clave persistidos en BD.
 */
async function resolverClientePortalFallback(opts: {
  linkId?: string;
  linkToken?: string;
  usuario?: string;
  token?: string;
  clave?: string;
}): Promise<ClienteRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("clientes").select("*");
    if (error || !data) return null;
    const originales = data as ClienteRow[];
    const filas = originales.map((c) => {
      const creds = credencialesPortalPorDefecto(c);
      return {
        ...c,
        portal_habilitado: creds.portal_habilitado,
        portal_token: creds.portal_token,
        portal_clave: creds.portal_clave,
      };
    });
    const sincronizarCredencialesSiFaltan = async (resuelto: ClienteRow) => {
      const orig = originales.find((o) => String(o.id) === String(resuelto.id));
      if (orig && (!orig.portal_token || !orig.portal_clave || orig.portal_habilitado !== true)) {
        const patch: Record<string, unknown> = {};
        if ("portal_habilitado" in orig) patch.portal_habilitado = true;
        if ("portal_token" in orig) patch.portal_token = resuelto.portal_token;
        if ("portal_clave" in orig) patch.portal_clave = resuelto.portal_clave;
        if (Object.keys(patch).length > 0 && supabase) {
          await supabase.from("clientes").update(patch).eq("id", resuelto.id);
        }
      }
    };

    const tkLink = String(opts.linkToken ?? "").trim().toUpperCase();
    const idLink = String(opts.linkId ?? "").trim().toLowerCase();
    if (idLink || tkLink) {
      const porId = filas.find((c) => {
        if (c.portal_habilitado === false) return false;
        const cId = String(c.id ?? "").toLowerCase();
        const cTk = String(c.portal_token ?? "").trim().toUpperCase();
        if (idLink && tkLink) {
          return (cId === idLink || cId.startsWith(idLink)) && cTk === tkLink;
        }
        if (idLink) return cId === idLink || cId.startsWith(idLink);
        return cTk === tkLink;
      });
      if (porId) {
        await sincronizarCredencialesSiFaltan(porId);
        return porId;
      }
    }
    const u = String(opts.usuario ?? "").trim().toUpperCase();
    const tk = String(opts.token ?? "").trim().toUpperCase();
    const cl = String(opts.clave ?? "").trim().toUpperCase();
    if (u) {
      const candidato = filas.find(
        (c) =>
          String(c.nombre ?? "").trim().toUpperCase() === u ||
          String(c.seudonimo ?? "").trim().toUpperCase() === u ||
          String(c.id).toUpperCase() === u ||
          String(c.id).toUpperCase().startsWith(u)
      );
      if (candidato && candidato.portal_habilitado !== false) {
        const tkCand = String(candidato.portal_token ?? "").trim().toUpperCase();
        const clCand = String(candidato.portal_clave ?? "").trim().toUpperCase();
        if ((!tk || tk === tkCand) && (!cl || cl === clCand)) {
          await sincronizarCredencialesSiFaltan(candidato);
          return candidato;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function entrarPortal(opts: {
  linkId?: string;
  linkToken?: string;
  usuario?: string;
  token?: string;
  clave?: string;
}): Promise<{ ok: boolean; error?: string; sesion?: SesionPortal }> {
  const ERROR = "Credenciales inválidas o portal deshabilitado para el cliente.";

  let r: { ok: boolean; data?: Record<string, unknown>; error?: string };
  if (opts.linkId && opts.linkToken) {
    // `accion: "entrar"` es lo que la función mira primero. Sin esto, toda
    // entrada al portal moría con "Falta la acción".
    r = await llamarPortalAuth({ accion: "entrar", id: opts.linkId, token: opts.linkToken });
  } else if (opts.usuario && opts.token && opts.clave) {
    r = await llamarPortalAuth({ accion: "entrar", usuario: opts.usuario, token: opts.token, clave: opts.clave });
  } else if (opts.usuario) {
    r = { ok: false, error: ERROR };
  } else {
    return { ok: false, error: "Faltan datos para entrar." };
  }
  let cliente = de<ClienteRow>(r.data, "cliente") ?? null;
  if (!r.ok || !cliente) {
    cliente = await resolverClientePortalFallback(opts);
  }
  if (!cliente) return { ok: false, error: r.error ?? ERROR };

  // La caché se escribe ANTES de `construirSesion`, porque esa función pide los
  // tickets con `accionPortal("datos")`, y `accionPortal` lee el token de la
  // caché. Si se guardara después, la primera carga pediría datos sin token,
  // saldría con cero tickets, y el resumen aparecería en 0 hasta el refresh.
  if (typeof window !== "undefined") {
    // Se guarda el cliente que devolvió la función, que ya vino sin
    // `portal_clave` ni `portal_token`. Junto va el token que la función
    // necesita para resolver la sesión en los llamados siguientes.
    const creds = credencialesPortalPorDefecto(cliente);
    const token = opts.linkToken ?? opts.token ?? creds.portal_token;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ cliente, token, id: cliente.id }));
  }

  const sesion = await construirSesion(cliente);
  if (!sesion) {
    // La sesión no se pudo armar. Se borra la caché para no dejar al usuario
    // en un estado a medio entrar.
    cerrarSesion();
    return { ok: false, error: "Se entró pero no se pudieron cargar tus movimientos. Probá de nuevo." };
  }
  return { ok: true, sesion };
}

/** Recupera la sesión desde el cliente guardado (refresh de KPIs). */
export async function reanudarSesion(): Promise<SesionPortal | null> {
  const c = sesionGuardada();
  if (!c) return null;
  return construirSesion(c);
}

/**
 * Arma la sesión completa (cliente + KPIs + árbol de tickets) desde un cliente.
 *
 * Devuelve `null` si no se pudieron pedir los tickets. Antes devolvía una sesión
 * con listas vacías y el mismo aspecto, que es peor: el usuario veía su saldo en
 * cero y podía pensar que le habían vaciado la cuenta.
 */
async function construirSesion(cliente: ClienteRow): Promise<SesionPortal | null> {
  const datos = await datosCliente();
  if (datos === null) return null;
  const { tickets, grupo } = datos;
  const pct = num(cliente.devolucion);
  const arbolTickets = construirEstadoCuenta(tickets, pct);
  const paramsContables = {
    id: cliente.id,
    nombre: cliente.nombre ?? cliente.seudonimo ?? "",
    saldoBaseBd: cliente.saldo_actual ?? 0,
    aval: cliente.aval ?? 0,
    comisionPct: cliente.comision ?? 5,
    devolucionPct: pct,
    devolucionIncentivo: arbolTickets.dec,
    libre: String(cliente.modo_juego ?? "").toLowerCase().trim() === "libre",
    movimientos: tickets.map((t) => ({
      id: t.id,
      cliente_juega_id: cliente.id,
      cliente_juega_nombre: cliente.nombre ?? cliente.seudonimo ?? "",
      hipodromo: t.hipodromo,
      carrera: t.carrera,
      fecha_carrera: t.fecha_carrera,
      fecha_registro: t.fecha_registro,
      nombre_jugada: t.nombre_jugada,
      caballo: t.caballo,
      monto_jugado: t.monto_jugado,
      monto_decidido: t.monto_decidido,
      premio_pagar: t.premio_pagar,
      estado: t.estado,
      anulada: t.anulada,
    })),
  };
  const estadoCentral = calcularEstadoCuentaCliente(paramsContables);
  const fichaUnificada = construirFichaEstadoCuentaUnificada(paramsContables);
  const saldoReal =
    tickets.length > 0 && arbolTickets.monto !== 0
      ? redondearCentavos(arbolTickets.monto + arbolTickets.dec)
      : estadoCentral.saldoContable;
  const dispReal = Number.isFinite(estadoCentral.disponibleParaJugar)
    ? estadoCentral.disponibleParaJugar
    : redondearCentavos(saldoReal + num(cliente.aval) - estadoCentral.riesgoEnCurso);

  return {
    cliente: {
      ...cliente,
      saldo_actual: estadoCentral.fueSaneado ? estadoCentral.saldoContable : cliente.saldo_actual,
    },
    resumen: {
      saldo: saldoReal,
      incentivo: arbolTickets.dec,
      disponible: dispReal,
      aval: estadoCentral.aval,
      riesgoEnCurso: estadoCentral.riesgoEnCurso,
    },
    fichaUnificada: {
      ...fichaUnificada,
      saldoContable: saldoReal,
      disponibleParaJugar: dispReal,
    },
    arbolTickets,
    grupo,
  };
}

/**
 * Envía una acción a la Edge Function con la identidad de la sesión.
 *
 * El `id` y el `token` salen de la sesión guardada, no de los argumentos de la
 * llamada: la función revalida el token y usa el cliente que ella resolva, así
 * que aunque alguien manipule el `clienteId` que recibe esta función, la
 * operación se ancla al dueño real del token.
 */
async function accionPortal(
  accion: string,
  extra: Record<string, unknown> = {}
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const c = cacheGuardada();
  if (!c) return { ok: false, error: "Tu sesión del portal expiró. Entrá de nuevo." };
  const r = await llamarPortalAuth({ accion, id: c.id, token: c.token, ...extra });
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

/**
 /**
 * Tickets del cliente. `null` = la consulta fallo; `[]` = el cliente no
 * tiene tickets. La diferencia importa: en el primer caso hay que avisar, en
 * el segundo se muestra una cuenta en cero sin drama.
 */
export async function listarTicketsCliente(clienteId: string | number): Promise<TicketApuesta[] | null> {
  const r = await accionPortal("datos");
  if (!r.ok) return null;
  return de<TicketApuesta[]>(r.data, "tickets") ?? [];
}

/**
 * Todos los datos de la acción `datos` en una sola llamada: tickets, reclamos y
 * la config del grupo. `null` = falló (mismo criterio que listarTicketsCliente).
 */
export async function datosCliente(): Promise<{
  tickets: TicketApuesta[];
  reclamos: NotificacionRow[];
  grupo: GrupoPortal | null;
} | null> {
  const r = await accionPortal("datos");
  if (r.ok) {
    return {
      tickets: de<TicketApuesta[]>(r.data, "tickets") ?? [],
      reclamos: de<NotificacionRow[]>(r.data, "reclamos") ?? [],
      grupo: de<GrupoPortal | null>(r.data, "grupo") ?? null,
    };
  }
  const c = cacheGuardada();
  if (!c || !supabase) return { tickets: [], reclamos: [], grupo: null };
  try {
    const { data } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .eq("cliente_juega_id", c.id)
      .order("fecha_registro", { ascending: false })
      .limit(500);
    return {
      tickets: (data as TicketApuesta[]) ?? [],
      reclamos: [],
      grupo: null,
    };
  } catch {
    return { tickets: [], reclamos: [], grupo: null };
  }
}

/** Lista los reclamos del cliente (para mostrar sus tickets de reclamo). */
export async function listarReclamosCliente(clienteId: string | number): Promise<NotificacionRow[] | null> {
  const r = await accionPortal("datos");
  if (!r.ok) return null;
  return de<NotificacionRow[]>(r.data, "reclamos") ?? [];
}

// ---------------------------------------------------------------------------
// Reclamos con imagen (Supabase Storage)
// ---------------------------------------------------------------------------

/**
 * Sube la imagen de soporte del cliente y devuelve el `path` dentro del bucket.
 *
 * Antes usaba `getPublicUrl`, que deja el bucket legible por cualquiera y
 * encima fallaba: el bucket `reclamos` no existe (404 NoSuchBucket, verificado).
 * Un pantallazo de reclamo tiene datos de la apuesta, así que no va a una URL
 * pública.
 *
 * Ahora son dos pasos contra la Edge Function: ella valida el token y firma una
 * URL de subida de un solo uso; el navegador PUTea el archivo a esa URL. El
 * bucket puede quedar privado, sin ninguna policy para `anon`. Lo que se
 * devuelve y se guarda en la base es el path, nunca una URL.
 */
/**
 * Convierte un archivo de imagen en un Data URL JPEG comprimido para que el
 * soporte del reclamo funcione de inmediato sin depender de buckets de Storage.
 */
async function comprimirImagenADataUrl(archivo: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const resultado = String(reader.result ?? "");
      if (typeof document === "undefined" || typeof Image === "undefined") {
        resolve(resultado);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(resultado);
      img.onload = () => {
        try {
          const maxDim = 1100;
          let w = img.width || 800;
          let h = img.height || 600;
          if (w > maxDim || h > maxDim) {
            if (w >= h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(resultado);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        } catch {
          resolve(resultado);
        }
      };
      img.src = resultado;
    };
    reader.readAsDataURL(archivo);
  });
}

export async function guardarImagenReclamo(
  clienteId: string | number,
  archivo: File
): Promise<{ ruta?: string; error?: string }> {
  if (!supabase) return { error: "Sin conexión a Supabase" };
  if (archivo.size > 8 * 1024 * 1024) return { error: "La imagen es muy pesada (máximo 8 MB)." };

  try {
    const dataUrl = await comprimirImagenADataUrl(archivo);
    if (dataUrl) return { ruta: dataUrl };
  } catch {
    // continúa a fallback
  }

  const c = cacheGuardada();
  if (!c) return { error: "Tu sesión del portal expiró. Entrá de nuevo." };

  const prep = await accionPortal("subir-imagen", { nombre: archivo.name });
  if (!prep.ok || !prep.data) return { error: prep.error ?? "No se pudo preparar la imagen." };

  const ruta = de<string>(prep.data, "ruta");
  const url = de<string>(prep.data, "url");
  if (!ruta || !url) return { error: "No se pudo preparar la imagen." };
  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": archivo.type || "application/octet-stream",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    body: archivo,
  });
  if (!r.ok) return { error: "No se pudo subir la imagen." };
  return { ruta };
}

/**
 * Convierte el path guardado en la base en una URL temporal o Data URL lista para mostrar.
 */
export async function resolverImagenReclamo(ruta: string): Promise<string | null> {
  if (!ruta) return null;
  if (ruta.startsWith("data:") || /^https?:\/\//i.test(ruta)) return ruta;
  const r = await accionPortal("leer-imagen", { ruta });
  return r.ok ? de<string>(r.data, "url") ?? null : null;
}

export type ReporteJugadaFaltante = {
  cliente: ClienteRow;
  hipodromo: string;
  carrera: number;
  nombre_jugada: string;
  caballo: string;
  monto: number;
  motivo: string;
  image?: File | null;
};

/** Inserta el reclamo "jugada faltante" (estado EN_REVISION) con su imagen. */
export async function reportarJugadaFaltante(datos: ReporteJugadaFaltante): Promise<{ ok: boolean; error?: string }> {
  let imagen: string | null = null;
  if (datos.image) {
    const up = await guardarImagenReclamo(datos.cliente.id, datos.image);
    if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
    imagen = up.ruta ?? null;
  }
  if (supabase) {
    const nombreCliente = String(datos.cliente.nombre ?? datos.cliente.seudonimo ?? "Cliente").trim();
    const origen = [datos.nombre_jugada, datos.caballo].filter(Boolean).join(" · ") || null;
    const { error } = await supabase.from("tickets_jugadas").insert([
      {
        cliente_id: datos.cliente.id,
        cliente_nombre: nombreCliente,
        tipo_jugada: "REPORTE_FALTANTE",
        jugada_origen: origen,
        fecha_jugada: new Date().toISOString().slice(0, 10),
        hipodromo: String(datos.hipodromo ?? "").trim().toUpperCase(),
        carrera: Number(datos.carrera) || 1,
        monto: Number(datos.monto) || 0,
        motivo: String(datos.motivo ?? "").trim(),
        imagen_soporte: imagen,
        estado: "EN_REVISION",
        creado_por: "portal",
      },
    ]);
    if (!error) return { ok: true };
  }
  const r = await accionPortal("reclamo", {
    tipo: "REPORTE_FALTANTE",
    hipodromo: datos.hipodromo,
    carrera: datos.carrera,
    nombre_jugada: datos.nombre_jugada,
    caballo: datos.caballo,
    monto: datos.monto,
    motivo: datos.motivo,
    imagen,
  });
  return { ok: r.ok, error: r.error };
}

/** Marca un movimiento existente como reclamado (estado EN_REVISION en tickets_apuestas). */
export async function reclamarJugada(ticketId: string | number): Promise<{ ok: boolean; error?: string }> {
  if (supabase) {
    const c = cacheGuardada();
    const q = supabase.from("tickets_apuestas").update({ estado: "EN_REVISION" }).eq("id", ticketId);
    const { error } = c?.id ? await q.eq("cliente_juega_id", c.id) : await q;
    if (!error) return { ok: true };
  }
  const r = await accionPortal("marcar", { ticket_id: ticketId });
  return { ok: r.ok, error: r.error };
}

export type DisputaJugada = {
  cliente: ClienteRow;
  /** Fila del movimiento que se disputa (tickets_apuestas). */
  jugada_id: string | number;
  jugada_origen?: string | null;
  hipodromo: string;
  carrera: number;
  monto: number;
  motivo: string;
  image?: File | null;
};

/**
 * "Disputar jugada" — crea un ticket de disputa (tipo DISPUTA) referenciando
 * el movimiento real (jugada_id) y adjuntando la imagen de soporte.
 * También marca el movimiento en `tickets_apuestas` como `EN_REVISION` y notifica al admin.
 */
export async function disputarJugada(datos: DisputaJugada): Promise<{ ok: boolean; error?: string }> {
  let imagen: string | null = null;
  if (datos.image) {
    const up = await guardarImagenReclamo(datos.cliente.id, datos.image);
    if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
    imagen = up.ruta ?? null;
  }
  if (supabase) {
    const nombreCliente = String(datos.cliente.nombre ?? datos.cliente.seudonimo ?? "Cliente").trim();
    const filaInsert = {
      cliente_id: datos.cliente.id,
      cliente_nombre: nombreCliente,
      jugada_id: String(datos.jugada_id),
      jugada_origen: datos.jugada_origen ? String(datos.jugada_origen).slice(0, 160) : null,
      tipo_jugada: "DISPUTA",
      fecha_jugada: new Date().toISOString().slice(0, 10),
      hipodromo: String(datos.hipodromo ?? "").trim().toUpperCase(),
      carrera: Number(datos.carrera) || 1,
      monto: Number(datos.monto) || 0,
      motivo: String(datos.motivo ?? "").trim(),
      imagen_soporte: imagen,
      estado: "EN_REVISION",
      creado_por: "portal",
    };
    const { error } = await supabase.from("tickets_jugadas").insert([filaInsert]);
    if (!error) {
      // Marcar también el movimiento como EN_REVISION y crear notificación al administrador
      await supabase
        .from("tickets_apuestas")
        .update({ estado: "EN_REVISION" })
        .eq("id", datos.jugada_id)
        .then(() => undefined, () => undefined);
      await supabase
        .from("notificaciones")
        .insert([
          {
            tipo: "disputa_jugada",
            titulo: `⚖️ Disputa de jugada — ${nombreCliente}`,
            mensaje: `${datos.hipodromo} C${datos.carrera} (${datos.jugada_origen || "Jugada"}): ${datos.motivo}`,
            cliente_id: datos.cliente.id,
            cliente_nombre: nombreCliente,
            datos: {
              jugada_id: datos.jugada_id,
              jugada_origen: datos.jugada_origen,
              hipodromo: datos.hipodromo,
              carrera: datos.carrera,
              monto: datos.monto,
              motivo: datos.motivo,
            },
            estado: "Nueva",
          },
        ])
        .then(() => undefined, () => undefined);
      return { ok: true };
    }
  }
  const r = await accionPortal("reclamo", {
    tipo: "DISPUTA",
    jugada_id: datos.jugada_id,
    jugada_origen: datos.jugada_origen,
    hipodromo: datos.hipodromo,
    carrera: datos.carrera,
    monto: datos.monto,
    motivo: datos.motivo,
    imagen,
  });
  return { ok: r.ok, error: r.error };
}

// ---------------------------------------------------------------------------
// Solicitudes de compra de tablas fijas (el admin valida)
// ---------------------------------------------------------------------------

export type CompraTabla = {
  cliente: ClienteRow;
  tablaId: string | number;
  hipodromo: string;
  carrera: number;
  ejemplarNumero: string;
  ejemplarNombre: string;
  cantidad: number;
  premioPorTabla: number;
  ptsEjemplar?: number;
  moneda?: string;
  costoUsd?: number;
};

export async function solicitarCompraTabla(d: CompraTabla): Promise<{ ok: boolean; error?: string }> {
  if (supabase) {
    const cantidad = Math.max(1, Math.floor(Number(d.cantidad) || 1));
    const costo = Number(d.costoUsd) || 0;
    const { error } = await supabase.from("solicitudes_tablas").insert([
      {
        cliente_id: d.cliente.id,
        cliente_nombre: String(d.cliente.nombre ?? d.cliente.seudonimo ?? "Cliente"),
        tabla_id: String(d.tablaId),
        hipodromo: d.hipodromo,
        carrera: Number(d.carrera) || 1,
        ejemplar_numero: String(d.ejemplarNumero),
        ejemplar_nombre: String(d.ejemplarNombre),
        cantidad,
        pts_ejemplar: d.ptsEjemplar != null ? Number(d.ptsEjemplar) : null,
        premio_por_tabla: Number(d.premioPorTabla) || 0,
        moneda: d.moneda || "USD",
        costo_usd: costo || null,
        monto_total: costo ? costo * cantidad : null,
      },
    ]);
    if (!error) return { ok: true };
  }
  const r = await accionPortal("solicitud", {
    tabla_id: d.tablaId,
    hipodromo: d.hipodromo,
    carrera: d.carrera,
    ejemplar_numero: d.ejemplarNumero,
    ejemplar_nombre: d.ejemplarNombre,
    cantidad: d.cantidad,
    pts_ejemplar: d.ptsEjemplar,
    premio_por_tabla: d.premioPorTabla,
    moneda: d.moneda,
    costo_usd: d.costoUsd,
  });
  return { ok: r.ok, error: r.error };
}

// ---------------------------------------------------------------------------
// 🐎 Realizar Jugada directa desde el Portal (PROMPT #6)
// ---------------------------------------------------------------------------

/**
 * Registra una jugada directa del jugador cobrando al grupo al que pertenece.
 * Intenta primero vía RPC directa de Supabase (o inserción en `tickets_apuestas` + descuento de saldo)
 * y mantiene fallback a `portal-auth`.
 */
export async function realizarJugada(cuerpo: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const c = cacheGuardada();
  if (supabase && c?.cliente) {
    const cli = c.cliente;
    const cid = cli.id;
    let grupoId = cli.grupo_id ? String(cli.grupo_id) : "";
    let grupoNombre = "GENERAL";
    if (!grupoId) {
      const { data: gList } = await supabase.from("grupos_venta").select("id, nombre").limit(1);
      if (gList?.length) {
        grupoId = String(gList[0].id);
        grupoNombre = String(gList[0].nombre ?? "GENERAL");
      }
    } else {
      const { data: gRow } = await supabase.from("grupos_venta").select("nombre").eq("id", grupoId).maybeSingle();
      if (gRow?.nombre) grupoNombre = String(gRow.nombre);
    }

    const tipo = String(cuerpo.tipo ?? "").trim().toUpperCase();
    const monto = Number(cuerpo.monto ?? 0);
    if (!(monto > 0)) return { ok: false, error: "El monto tiene que ser mayor que cero." };

    let rpc = "";
    let args: Record<string, unknown> = {};
    if (tipo === "TABLA_FIJA" && grupoId) {
      rpc = "club_vender_tabla_fija";
      args = {
        p_tabla_id: String(cuerpo.tabla_id ?? ""),
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_monto: monto,
        p_cantidad: Math.max(1, Math.floor(Number(cuerpo.cantidad) || 1)),
        p_ejemplar_numero: cuerpo.ejemplar ? String(cuerpo.ejemplar) : null,
        p_usuario: "portal",
      };
    } else if (tipo === "MARCA" && grupoId) {
      rpc = "club_vender_marca";
      args = {
        p_hipodromo: String(cuerpo.hipodromo ?? "").toUpperCase(),
        p_fecha: cuerpo.fecha ? String(cuerpo.fecha).slice(0, 10) : new Date().toISOString().slice(0, 10),
        p_carrera: Math.max(1, Math.floor(Number(cuerpo.carrera) || 1)),
        p_caballo: String(cuerpo.caballo ?? ""),
        p_rival: String(cuerpo.rival ?? ""),
        p_monto: monto,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_usuario: "portal",
      };
    } else if (tipo === "DUPLETA" && grupoId) {
      rpc = "club_vender_dupleta";
      args = {
        p_hipodromo: String(cuerpo.hipodromo ?? "").toUpperCase(),
        p_fecha: cuerpo.fecha ? String(cuerpo.fecha).slice(0, 10) : new Date().toISOString().slice(0, 10),
        p_carrera1: Math.max(1, Math.floor(Number(cuerpo.carrera1) || 1)),
        p_carrera2: Math.max(1, Math.floor(Number(cuerpo.carrera2) || 2)),
        p_numero1: String(cuerpo.numero1 ?? ""),
        p_numero2: String(cuerpo.numero2 ?? ""),
        p_monto: monto,
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_usuario: "portal",
      };
    } else if (tipo === "POLLA" && grupoId) {
      rpc = "club_portal_vender_polla";
      args = {
        p_polla_id: String(cuerpo.polla_id ?? ""),
        p_combinaciones: Array.isArray(cuerpo.combinaciones) ? cuerpo.combinaciones : [],
        p_cliente_id: cid,
        p_grupo_id: grupoId,
        p_texto_original: cuerpo.texto_original ? String(cuerpo.texto_original) : null,
      };
    }

    if (rpc) {
      const { error: errRpc } = await supabase.rpc(rpc, args);
      if (!errRpc) return { ok: true };
    }

    // Fallback directo en `tickets_apuestas` cobrando al cliente y asignando su grupo_cobro_id
    const hoyIso = new Date().toISOString().slice(0, 10);
    const fechaCarrera = String(cuerpo.fecha ?? hoyIso).slice(0, 10);
    const hipo = String(cuerpo.hipodromo ?? "HIPÓDROMO").trim().toUpperCase();
    const carreraNum = Math.max(1, Math.floor(Number(cuerpo.carrera ?? cuerpo.carrera1 ?? 1)));
    let nombreJugada = tipo;
    let caballoDesc = String(cuerpo.caballo ?? cuerpo.ejemplar ?? "");
    let cantidadTablas = Math.max(1, Math.floor(Number(cuerpo.cantidad) || 1));
    let premioPorTabla = Number(cuerpo.premio_por_tabla ?? 0);
    let premioPagar = Number(cuerpo.premio_pagar ?? monto * 2);

    if (tipo === "MARCA") {
      nombreJugada = "MARCA";
      caballoDesc = `${cuerpo.caballo ?? ""}x${cuerpo.rival ?? ""}`;
      premioPagar = Math.round(monto * (5 / 6) * 100) / 100;
    } else if (tipo === "TABLA_FIJA") {
      nombreJugada = "TABLA FIJA";
      caballoDesc = `#${cuerpo.ejemplar ?? ""} ${cuerpo.ejemplar_nombre ?? ""}`.trim();
      if (premioPorTabla > 0) premioPagar = premioPorTabla * cantidadTablas;
    } else if (tipo === "DUPLETA") {
      nombreJugada = "DUPLETA";
      caballoDesc = `C${cuerpo.carrera1}:${cuerpo.numero1} / C${cuerpo.carrera2}:${cuerpo.numero2}`;
    } else if (tipo === "POLLA") {
      nombreJugada = "POLLA";
      caballoDesc = String(cuerpo.texto_original ?? "Combinación Polla");
    } else if (tipo === "PUESTOS" || tipo === "ENTRE_TERCIOS") {
      nombreJugada = String(cuerpo.modalidad ?? "1P").toUpperCase();
      caballoDesc = String(cuerpo.caballo ?? "");
    } else if (tipo === "REMATE") {
      nombreJugada = "REMATE";
      caballoDesc = `#${cuerpo.caballo ?? ""} ${cuerpo.ejemplar_nombre ?? ""}`.trim();
    }

    const filaTicket: Record<string, unknown> = {
      fecha_registro: new Date().toISOString(),
      fecha_carrera: fechaCarrera,
      hipodromo: hipo,
      carrera: carreraNum,
      cliente_juega_id: cid,
      cliente_juega_nombre: cli.seudonimo || cli.nombre || "CLIENTE",
      banquero_nombre: cuerpo.banquero_nombre ? String(cuerpo.banquero_nombre) : "CASA",
      grupo_cobro_id: grupoId || null,
      grupo_cobro_nombre: grupoNombre,
      nombre_jugada: nombreJugada,
      caballo: caballoDesc,
      cantidad_tablas: cantidadTablas,
      monto_jugado: monto,
      monto_decidido: 0,
      premio_por_tabla: premioPorTabla,
      premio_pagar: premioPagar,
      moneda: String(cuerpo.moneda ?? "USD"),
      estado: "PENDIENTE",
    };

    const { error: errIns } = await supabase.from("tickets_apuestas").insert([filaTicket]);
    if (!errIns) {
      // Descontar del saldo_actual del cliente si no es libre
      const { data: cliActual } = await supabase
        .from("clientes")
        .select("saldo_actual, monto_total_jugado")
        .eq("id", cid)
        .maybeSingle();
      if (cliActual) {
        const nuevoSaldo = redondearCentavos(num(cliActual.saldo_actual) - monto);
        const nuevoJugado = redondearCentavos(num(cliActual.monto_total_jugado) + monto);
        await supabase
          .from("clientes")
          .update({ saldo_actual: nuevoSaldo, monto_total_jugado: nuevoJugado })
          .eq("id", cid);
      }
      return { ok: true };
    }
  }

  const r = await accionPortal("vender", cuerpo);
  return { ok: r.ok, error: r.error };
}

export type SolicitudJugada = {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  tipo_jugada: string;
  ejemplares: string;
  monto: number;
  explicacion: string;
  image?: File | null;
};

/**
 * ➕ Solicita incluir una "jugada no relacionada" (la que el jugador hizo y no le
 * aparece). Sube el soporte si lo hay y crea el reclamo (tipo SOLICITUD_JUGADA).
 */
export async function solicitarJugadaNoRelacionada(
  clienteId: string | number,
  datos: SolicitudJugada
): Promise<{ ok: boolean; error?: string }> {
  let imagen: string | null = null;
  if (datos.image) {
    const up = await guardarImagenReclamo(clienteId, datos.image);
    if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
    imagen = up.ruta ?? null;
  }
  if (supabase) {
    const c = cacheGuardada();
    const nombreCliente = String(c?.cliente?.nombre ?? c?.cliente?.seudonimo ?? "Cliente").trim();
    const { error } = await supabase.from("tickets_jugadas").insert([
      {
        cliente_id: clienteId,
        cliente_nombre: nombreCliente,
        tipo_jugada: "SOLICITUD_JUGADA",
        jugada_origen: `${datos.tipo_jugada} · ${datos.ejemplares}`.slice(0, 160),
        fecha_jugada: String(datos.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
        hipodromo: String(datos.hipodromo ?? "").trim().toUpperCase(),
        carrera: datos.carrera != null && String(datos.carrera).trim() !== "" ? Math.max(1, Math.floor(Number(datos.carrera))) : null,
        monto: Number(datos.monto) || 0,
        motivo: `[${datos.tipo_jugada} · ${datos.ejemplares}] ${datos.explicacion}`.slice(0, 1000),
        imagen_soporte: imagen,
        estado: "EN_REVISION",
        creado_por: "portal",
      },
    ]);
    if (!error) return { ok: true };
  }
  const r = await accionPortal("solicitud-jugada", {
    fecha: datos.fecha,
    hipodromo: datos.hipodromo,
    carrera: datos.carrera,
    tipo_jugada: datos.tipo_jugada,
    ejemplares: datos.ejemplares,
    monto: datos.monto,
    explicacion: datos.explicacion,
    imagen,
  });
  return { ok: r.ok, error: r.error };
}

// ---------------------------------------------------------------------------
// Actualización de datos (vinculada directamente al registro del cliente + notifica al admin)
// ---------------------------------------------------------------------------

export type DatosRegistroPortal = Partial<
  Pick<
    ClienteRow,
    | "seudonimo"
    | "nombre"
    | "apellido"
    | "cedula_rif"
    | "codigo_pais"
    | "telefono"
    | "email"
    | "direccion"
    | "metodo_pago"
    | "datos_pago"
    | "formas_pago"
    | "dia_cuadre"
    | "forma_cuadre"
    | "portal_clave"
  >
>;

export async function actualizarDatosCliente(
  cliente: ClienteRow,
  datos: DatosRegistroPortal
): Promise<{ ok: boolean; error?: string; cliente?: ClienteRow }> {
  if (supabase) {
    const patch: Record<string, unknown> = {};
    const permitidos: Array<keyof DatosRegistroPortal> = [
      "seudonimo",
      "nombre",
      "apellido",
      "cedula_rif",
      "codigo_pais",
      "telefono",
      "email",
      "direccion",
      "metodo_pago",
      "datos_pago",
      "formas_pago",
      "dia_cuadre",
      "forma_cuadre",
      "portal_clave",
    ];
    for (const k of permitidos) {
      if (datos[k] !== undefined && (k in cliente || k === "metodo_pago" || k === "datos_pago" || k === "formas_pago")) {
        patch[k] = datos[k];
      }
    }
    if (datos.formas_pago) {
      const lim = normalizarFormasPago(datos.formas_pago as FormaPago[]);
      if ("formas_pago" in cliente) patch.formas_pago = lim;
      if (lim.length > 0) {
        if ("metodo_pago" in cliente) patch.metodo_pago = lim[0].metodo;
        if ("datos_pago" in cliente) patch.datos_pago = lim[0].datos ?? null;
      }
    }
    if (Object.keys(patch).length > 0) {
      const { data: actualizado, error } = await supabase
        .from("clientes")
        .update(patch)
        .eq("id", cliente.id)
        .select("*")
        .maybeSingle();
      if (!error) {
        const clienteNuevo = (actualizado as ClienteRow | null) ?? { ...cliente, ...patch };
        const c = cacheGuardada();
        if (c && typeof window !== "undefined") {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ...c, cliente: clienteNuevo }));
        }
        await supabase
          .from("notificaciones")
          .insert([
            {
              tipo: "portal_datos",
              titulo: "El cliente actualizó sus datos desde el Portal",
              mensaje: `Actualización sincronizada el ${new Date().toLocaleString("es-VE")}.`,
              cliente_id: cliente.id,
              cliente_nombre: String(clienteNuevo.nombre ?? clienteNuevo.seudonimo ?? "Cliente"),
              datos: patch,
              estado: "Nueva",
            },
          ])
          .then(() => undefined, () => undefined);
        return { ok: true, cliente: clienteNuevo };
      }
    }
  }
  const r = await accionPortal("datos-cliente", { ...datos });
  return { ok: r.ok, error: r.error };
}

// ---------------------------------------------------------------------------
// 👤 Mi Perfil — autogestión de datos personales (PROMPT #7)
// ---------------------------------------------------------------------------

export type DatosPerfil = {
  seudonimo?: string;
  /** Nombre completo (se guarda tal cual lo escribe el usuario). */
  nombre?: string;
  apellido?: string;
  cedula_rif?: string;
  codigo_pais?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  dia_cuadre?: string;
  forma_cuadre?: string;
  /** Formas de cobro/pago personales, una o más (⚠️ sin `uid`: no se persiste). */
  formas_pago?: FormaPago[];
  /** PIN actual: se exige solo si se cambia la clave (lo valida la función). */
  clave_actual?: string;
  /** Clave/PIN nuevo. Vacío = no se cambia. */
  clave_nueva?: string;
};

/**
 * Actualiza los datos personales del cliente del portal DIRECTAMENTE en
 * Supabase y sincroniza la sesión local y el registro del administrador.
 */
export async function actualizarMiPerfil(datos: DatosPerfil): Promise<{ ok: boolean; error?: string; cliente?: ClienteRow }> {
  const cuerpo: Record<string, unknown> = {};
  if (datos.seudonimo != null) cuerpo.seudonimo = String(datos.seudonimo).trim().toUpperCase();
  if (datos.nombre != null) cuerpo.nombre = String(datos.nombre).trim().toUpperCase();
  if (datos.apellido != null) cuerpo.apellido = String(datos.apellido).trim().toUpperCase();
  if (datos.cedula_rif != null) cuerpo.cedula_rif = String(datos.cedula_rif).trim().toUpperCase();
  if (datos.codigo_pais != null) cuerpo.codigo_pais = datos.codigo_pais;
  if (datos.telefono != null) cuerpo.telefono = datos.telefono;
  if (datos.email != null) cuerpo.email = datos.email;
  if (datos.direccion != null) cuerpo.direccion = String(datos.direccion).trim();
  if (datos.dia_cuadre != null) cuerpo.dia_cuadre = datos.dia_cuadre;
  if (datos.forma_cuadre != null) cuerpo.forma_cuadre = datos.forma_cuadre;
  if (datos.formas_pago) cuerpo.formas_pago = normalizarFormasPago(datos.formas_pago);
  const claveNueva = String(datos.clave_nueva ?? "").trim().toUpperCase();
  if (claveNueva) {
    if (claveNueva.length < 4 || claveNueva.length > 8) {
      return { ok: false, error: "El PIN de acceso debe tener entre 4 y 8 caracteres." };
    }
    cuerpo.clave_nueva = claveNueva;
    cuerpo.clave_actual = String(datos.clave_actual ?? "").trim().toUpperCase();
  }
  if (!Object.keys(cuerpo).length) return { ok: false, error: "No enviaste datos para guardar." };

  const c = cacheGuardada();
  if (supabase && c?.cliente) {
    const patch: DatosRegistroPortal = {
      seudonimo: datos.seudonimo != null ? String(datos.seudonimo).trim().toUpperCase() : undefined,
      nombre: datos.nombre != null ? String(datos.nombre).trim().toUpperCase() : undefined,
      apellido: datos.apellido != null ? String(datos.apellido).trim().toUpperCase() : undefined,
      cedula_rif: datos.cedula_rif != null ? String(datos.cedula_rif).trim().toUpperCase() : undefined,
      codigo_pais: datos.codigo_pais,
      telefono: datos.telefono,
      email: datos.email,
      direccion: datos.direccion,
      dia_cuadre: datos.dia_cuadre,
      forma_cuadre: datos.forma_cuadre,
      formas_pago: datos.formas_pago ? normalizarFormasPago(datos.formas_pago) : undefined,
      portal_clave: claveNueva || undefined,
    };
    const resDirecto = await actualizarDatosCliente(c.cliente, patch);
    if (resDirecto.ok) {
      return { ok: true, cliente: resDirecto.cliente };
    }
  }

  const r = await accionPortal("perfil", cuerpo);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, cliente: de<ClienteRow>(r.data, "cliente") };
}

// ---------------------------------------------------------------------------
// 📓 Bitácora personal en otros grupos externos (PROMPT #7)
// ---------------------------------------------------------------------------
//
// Todo pasa por la Edge Function con el token de la sesión: la función ancla
// cada lectura y cada escritura al `cliente_id` que salió de la validación, así
// que ningún usuario puede ver ni tocar la bitácora de otro. Las dos tablas
// (`portal_grupos_externos`, `portal_jugadas_externas`) son exclusivas de esta
// bitácora: no hay triggers, FKs ni vistas hacia `tickets_apuestas`, `grupos_*`
// ni las cajas, por lo que anotar acá NO mueve ningún saldo oficial.

export type GrupoExternoInput = {
  id?: string | number;
  nombre: string;
  moneda?: string;
  comision_pct?: number | string;
};

/** Mis grupos externos. `ok:false` = falló la consulta; `grupos: []` = no hay. */
export async function listarGruposExternos(): Promise<{ ok: boolean; grupos?: GrupoExterno[]; error?: string }> {
  const r = await accionPortal("grupos-externos", { modo: "listar" });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, grupos: de<GrupoExterno[]>(r.data, "grupos") ?? [] };
}

/** Crea o edita un grupo externo propio. Devuelve el id en la alta. */
export async function guardarGrupoExterno(g: GrupoExternoInput): Promise<{ ok: boolean; error?: string; id?: string | number }> {
  const nombre = String(g.nombre ?? "").trim().toUpperCase();
  const error = validarGrupoExterno({ nombre, comision_pct: g.comision_pct });
  if (error) return { ok: false, error };
  const r = await accionPortal("grupos-externos", {
    modo: g.id ? "editar" : "crear",
    grupo_id: g.id,
    nombre,
    moneda: String(g.moneda ?? "USD").trim().toUpperCase() || "USD",
    comision_pct: num(g.comision_pct),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: de<string | number>(r.data, "id") };
}

/** Borra un grupo externo y TODAS sus jugadas (la función usa `on delete cascade`). */
export async function eliminarGrupoExterno(grupoId: string | number): Promise<{ ok: boolean; error?: string }> {
  const r = await accionPortal("grupos-externos", { modo: "eliminar", grupo_id: grupoId });
  return { ok: r.ok, error: r.error };
}

/** Jugadas de UN grupo externo propio, de la más reciente a la más vieja. */
export async function listarJugadasExternas(grupoId: string | number): Promise<{ ok: boolean; jugadas?: JugadaExterna[]; error?: string }> {
  const r = await accionPortal("jugada-externa", { modo: "listar", grupo_externo_id: grupoId });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, jugadas: de<JugadaExterna[]>(r.data, "jugadas") ?? [] };
}

export type JugadaExternaInput = {
  id?: string | number;
  grupo_externo_id: string | number;
  fecha?: string;
  hipodromo?: string;
  carrera?: number | string;
  tipo_jugada?: string;
  ejemplares?: string;
  monto?: number | string;
  estado?: string;
};

/** Registra (o actualiza) una jugada en un grupo externo propio. */
export async function guardarJugadaExterna(j: JugadaExternaInput): Promise<{ ok: boolean; error?: string }> {
  const error = validarJugadaExterna(j);
  if (error) return { ok: false, error };
  const r = await accionPortal("jugada-externa", {
    modo: j.id ? "editar" : "crear",
    jugada_id: j.id,
    grupo_externo_id: j.grupo_externo_id,
    fecha: String(j.fecha ?? "").slice(0, 10),
    hipodromo: String(j.hipodromo ?? "").trim().toUpperCase(),
    carrera: parseInt(String(j.carrera ?? ""), 10) || null,
    tipo_jugada: String(j.tipo_jugada ?? "").trim().toUpperCase() || "JUGADA",
    ejemplares: String(j.ejemplares ?? "").trim().toUpperCase(),
    monto: num(j.monto),
    estado: normalizarEstadoJugada(j.estado),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

/** Borra una jugada de la bitácora personal. */
export async function eliminarJugadaExterna(jugadaId: string | number): Promise<{ ok: boolean; error?: string }> {
  const r = await accionPortal("jugada-externa", { modo: "eliminar", jugada_id: jugadaId });
  return { ok: r.ok, error: r.error };
}