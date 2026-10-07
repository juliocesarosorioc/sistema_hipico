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
 */
import { supabase } from "@/lib/supabase";
import { TIMEOUT_SESION_MS } from "@/lib/auth/sesion";
import { construirEstadoCuenta, type ClienteRow, type NivelAcordeon, type NotificacionRow, type TicketApuesta } from "@/lib/clientes";
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
  resumen: { saldo: number; incentivo: number; disponible: number };
  arbolTickets: NivelAcordeon;
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
  } else {
    return { ok: false, error: "Faltan datos para entrar." };
  }
  const cliente = de<ClienteRow>(r.data, "cliente");
  if (!r.ok || !cliente) return { ok: false, error: r.error ?? ERROR };

  // La caché se escribe ANTES de `construirSesion`, porque esa función pide los
  // tickets con `accionPortal("datos")`, y `accionPortal` lee el token de la
  // caché. Si se guardara después, la primera carga pediría datos sin token,
  // saldría con cero tickets, y el resumen aparecería en 0 hasta el refresh.
  if (typeof window !== "undefined") {
    // Se guarda el cliente que devolvió la función, que ya vino sin
    // `portal_clave` ni `portal_token`. Junto va el token que la función
    // necesita para resolver la sesión en los llamados siguientes.
    const token = opts.linkToken ?? opts.token ?? "";
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
  const tickets = await listarTicketsCliente(cliente.id);
  if (tickets === null) return null;
  const pct = num(cliente.devolucion);
  const arbolTickets = construirEstadoCuenta(tickets, pct);
  return {
    cliente,
    resumen: { saldo: arbolTickets.monto, incentivo: arbolTickets.dec, disponible: arbolTickets.monto - arbolTickets.dec },
    arbolTickets,
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
export async function guardarImagenReclamo(
  clienteId: string | number,
  archivo: File
): Promise<{ ruta?: string; error?: string }> {
  if (!supabase) return { error: "Sin conexión a Supabase" };
  if (archivo.size > 8 * 1024 * 1024) return { error: "La imagen es muy pesada (máximo 8 MB)." };

  const c = cacheGuardada();
  if (!c) return { error: "Tu sesión del portal expiró. Entrá de nuevo." };

  const prep = await accionPortal("subir-imagen", { nombre: archivo.name });
  if (!prep.ok || !prep.data) return { error: prep.error ?? "No se pudo preparar la imagen." };

  const ruta = de<string>(prep.data, "ruta");
  const url = de<string>(prep.data, "url");
  if (!ruta || !url) return { error: "No se pudo preparar la imagen." };
  // El upload va a la URL firmada con la llave anon, pero la firma vale para
  // un solo objeto: sin la sesión del portal no se puede usar para otra cosa.
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
 * Convierte el path guardado en la base en una URL temporal y la abre.
 *
 * `tickets_jugadas.imagen_soporte` guardaba una URL pública; ahora guarda solo
 * el path, porque el bucket es privado. Quien lo muestra (la consola de Tickets
 * del staff y el propio cliente) tiene que pedir la firma antes de abrirlo, y
 * por eso no alcanza con un `href` con el valor de la columna.
 */
export async function resolverImagenReclamo(ruta: string): Promise<string | null> {
  // Si todavía quedó una URL absoluta de la versión anterior, se respeta: los
  // tickets viejos apuntan al bucket y no se pueden volver a firmar.
  if (/^https?:\/\//i.test(ruta)) return ruta;
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
 * el movimiento real (jugada_id) y adjuntando la imagen pegada con Ctrl+V
 * (subida al bucket `reclamos`). El admin lo atiende desde la consola Tickets.
 */
export async function disputarJugada(datos: DisputaJugada): Promise<{ ok: boolean; error?: string }> {
  let imagen: string | null = null;
  if (datos.image) {
    const up = await guardarImagenReclamo(datos.cliente.id, datos.image);
    if (up.error) return { ok: false, error: `Imagen: ${up.error}` };
    imagen = up.ruta ?? null;
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
// Actualización de datos (notifica al admin)
// ---------------------------------------------------------------------------

export async function actualizarDatosCliente(
  cliente: ClienteRow,
  datos: Partial<Pick<ClienteRow, "telefono" | "codigo_pais" | "email" | "cedula_rif" | "direccion" | "metodo_pago">>
): Promise<{ ok: boolean; error?: string }> {
  const r = await accionPortal("datos-cliente", { ...datos });
  return { ok: r.ok, error: r.error };
}