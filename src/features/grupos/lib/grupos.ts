/**
 * Grupos de venta y clientes/jugadores para la Venta Rápida de Tablas Fijas.
 * Clon del legacy (js/tablas.js cargarGrupos / cargarClientesVenta):
 * SELECT directo con orden es_principal DESC y fallback a la RPC segura
 * club_listar_grupos cuando el RLS bloquea el acceso (misma cadena del legacy).
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad, grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { claveDeUsuario, guardarUsuarioSistema, leerUsuariosDelSistema } from "@/features/seguridad/lib/accesos";
import { disponibleParaJugar, esSinTope, explicarDisponible } from "@/features/taquilla/lib/reparto";

export type GrupoVenta = {
  id: string | number;
  nombre: string;
  moneda?: string | null;
  cupo_tabla?: number | null;
  /**
   * Tasa de comision del grupo, en PORCENTAJE (2.5 = 2,5%). La columna existe
   * y GrupoRow la expone, pero faltaba aqui, y sin ella las pantallas de venta
   * no tenian de donde sacar la comision y usaban un 5% fijo a pelo. Con eso
   * un grupo al 2,5 (el default al crear) pagaba el doble de lo pactado.
   */
  comision_default?: number | null;
  es_principal?: boolean | null;
  activo?: boolean | null;
  /** Jerarquía de cruces: switch general del grupo (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Ciclo de facturación semanal (1=Lunes … 7=Domingo). Default L→D. */
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
};

export type ClienteVenta = {
  id: string | number;
  nombre: string;
  saldo_actual?: number | null;
  aval?: number | null;
  libre?: boolean | null;
  modo_juego?: string | null;
  grupo_id?: string | number | null;
  /** Jerarquía de cruces: override por cliente (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Unión de clientes_grupos + grupo_id por cliente (misma regla del legacy). */
  grupos: (string | number)[];
};

// La lista de VENTA (solo activos) y la de GESTION (todos) son distintas y
// comparten estructura: si se guardaran en la misma variable, cargar la vista
// de gestion metia los inactivos en la venta y cargar la venta escondia los
// inactivos de la gestion. Se cachean por separado.
let cacheGruposVenta: GrupoVenta[] | null = null;
let cacheGruposAdmin: GrupoRow[] | null = null;
let cacheClientes: ClienteVenta[] | null = null;
/** Grupo con el que se llenó `cacheClientes` (para invalidarla al cambiarlo). */
let cacheClientesGrupo: string | null | undefined = undefined;
let ultimoErrorGrupos: string | null = null;

/** Ultimo error de carga de grupos (null si el ultimo intento tuvo exito).
 *  Permite que las pantallas avisen cuando la lista llega vacia por RLS/red
 *  en vez de mostrar "0 grupos" como si no hubiera ninguno. */
export function errorCargaGrupos(): string | null {
  return ultimoErrorGrupos;
}

export function limpiarCacheClientesVenta(): void {
  cacheClientes = null;
  cacheClientesGrupo = undefined;
}

function invalidarCacheGrupos(): void {
  cacheGruposVenta = null;
  cacheGruposAdmin = null;
  limpiarCacheClientesVenta();
}

/** Lista los grupos de venta ACTIVOS (SELECT directo + fallback RPC). */
export async function listarGruposVenta(): Promise<GrupoVenta[]> {
  if (cacheGruposVenta) return cacheGruposVenta;
  if (!supabase) return [];
  let grupos: GrupoVenta[] | null = null;
  // 1) SELECT directo. Se pide `*` (y no columnas nombradas) para tolerar
  //    migraciones incompletas: una columna que falte no tumba el listado.
  try {
    const { data, error } = await supabase
      .from("grupos_venta")
      .select("*")
      .order("es_principal", { ascending: false });
    if (error) throw error;
    // RLS no da error: filtra filas y responde 200 con []. Una lista vacia NO
    // significa "no hay grupos", asi que si llega vacio se prueba el RPC.
    if (data && data.length) grupos = data as GrupoVenta[];
  } catch {
    /* se intenta el RPC */
  }
  // 2) RPC security definer (salta el RLS).
  if (grupos === null) {
    try {
      const { data, error } = await supabase.rpc("club_listar_grupos");
      if (!error && Array.isArray(data)) grupos = data as GrupoVenta[];
    } catch {
      /* sin RPC ni SELECT */
    }
  }
  // Si AMBOS caminos fallan no se cachea: un fallo transitorio de RLS/red no
  // debe dejar la lista vacia para siempre; el proximo llamado reintenta.
  if (grupos === null) {
    ultimoErrorGrupos = "No se pudieron cargar los grupos de venta (permisos o conexión).";
    return [];
  }
  ultimoErrorGrupos = null;
  const activos = grupos.filter((g) => g.activo !== false);
  cacheGruposVenta = activos;
  return activos;
}

/**
 * Grupo con el que la sesión REGISTRA una venta.
 *
 *   · Usuario de un grupo (operador/admin de banca) → SU grupo (`grupoVigente`),
 *     que además es el único que el RLS le deja tocar. La venta nunca se le
 *     ofrece elegir otro.
 *   · Usuario principal (el dueño que ve todos) → el grupo que tenga elegido en
 *     el filtro superior "🗂️ Grupo" (`grupoActivoVigente`).
 *
 * Devuelve "" cuando el principal está mirando "Todos los grupos": ahí no hay un
 * grupo determinado y la pantalla de venta debe pedirlo explícitamente.
 */
export function grupoDeVentaVigente(): string {
  const propio = grupoVigente();
  if (propio) return String(propio);
  const activo = grupoActivoVigente();
  return activo ? String(activo) : "";
}

/**
 * Comisión GENERAL de las "Jugadas entre Tercios" de un grupo, en PORCENTAJE
 * (`comision_default`: 2.5 = 2,5%). Es la ÚNICA comisión de las jugadas de
 * taquilla; los demás productos (tablas fijas, remates, dupletas, marcas,
 * pollas) se negocian aparte con cada grupo.
 *
 * Centraliza la fuente: las pantallas de venta y la liquidación toman de aquí
 * el % en vez de un "5" a pelo (con el 5 fijo, un grupo al 2,5 pagaba el doble
 * de lo pactado). Devuelve `null` si el grupo no está en la lista, para que el
 * llamador decida el respaldo en vez de inventar una tasa.
 */
export function comisionJugadasDeGrupo(
  grupos: GrupoVenta[],
  grupoId: string | number | null | undefined
): number | null {
  if (grupoId == null) return null;
  const g = grupos.find((x) => String(x.id) === String(grupoId));
  const v = g?.comision_default;
  return v != null && isFinite(Number(v)) ? Number(v) : null;
}

/**
 * Porcentaje de comisión escrito en un formulario de texto. El `0` es un valor
 * VÁLIDO (grupo sin comisión) y NUNCA debe caer al default: el patrón viejo
 * `parseFloat(v) || 2.5` convertía un 0% pactado en 2,5%. Solo un campo vacío,
 * no numérico o negativo usa `porDefecto`.
 */
export function porcentajeDeEntrada(
  valor: string | number | null | undefined,
  porDefecto = 5
): number {
  const t = String(valor ?? "").trim().replace(",", ".");
  if (!t) return porDefecto;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : porDefecto;
}

/** Lista clientes con sus saldos y grupos (clientes + clientes_grupos). */
export async function listarClientesVenta(): Promise<ClienteVenta[]> {
  const activo = grupoActivoVigente();
  if (cacheClientes && cacheClientesGrupo === activo) return cacheClientes;
  if (!supabase) return [];
  try {
    let q = supabase
      .from("clientes")
      .select("id, nombre, saldo_actual, aval, libre, modo_juego, grupo_id, permite_cruces");
    // Filtro del super administrador (los demás los filtra el RLS de la base).
    if (activo) q = q.eq("grupo_id", activo);
    const { data: cli, error: e1 } = await q;
    if (e1) throw e1;
    const { data: cg, error: e2 } = await supabase
      .from("clientes_grupos")
      .select("grupo_id, cliente_id");
    if (e2) throw e2;
    const clientes = (cli ?? []).map((c) => ({
      id: String(c.id),
      nombre: String(c.nombre ?? ""),
      saldo_actual: c.saldo_actual != null ? Number(c.saldo_actual) : null,
      aval: c.aval != null ? Number(c.aval) : null,
      libre: Boolean(c.libre),
      modo_juego: c.modo_juego ? String(c.modo_juego) : null,
      grupo_id: c.grupo_id ?? null,
      permite_cruces: c.permite_cruces != null ? Boolean(c.permite_cruces) : null,
      grupos: [
        ...new Set([
          ...((cg ?? []).filter((x) => String(x.cliente_id) === String(c.id)).map((x) => String(x.grupo_id))),
          ...(c.grupo_id ? [String(c.grupo_id)] : []),
        ].filter(Boolean)),
      ],
    }));
    cacheClientes = clientes;
    cacheClientesGrupo = activo;
    return clientes;
  } catch {
    // No se cachea un fallo (RLS/red): devolver vacio y permitir reintento.
    return [];
  }
}

/** Jugadores de un grupo (misma regla que poblarJugadoresDelGrupo del legacy). */
export async function jugadoresDeGrupo(grupoId: string | number): Promise<ClienteVenta[]> {
  const clientes = await listarClientesVenta();
  return clientes.filter((c) => (c.grupos || []).map(String).includes(String(grupoId)));
}

/** Saldo en mano del jugador (`clientes.saldo_actual`), 0 si no se encontró. */
export function saldoDeCliente(c: ClienteVenta | null | undefined): number {
  return c && c.saldo_actual != null ? Number(c.saldo_actual) : 0;
}

/** Aval Guarantee del jugador (`clientes.aval`), 0 si no tiene o no se encontró. */
export function avalDeCliente(c: ClienteVenta | null | undefined): number {
  const n = c && c.aval != null ? Number(c.aval) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Modo "libre": el cliente juega por encima de su saldo y sin tope.
 *
 * Delega en el modulo PURO de la taquilla porque la regla tiene que ser UNA
 * sola: si aqui se reimplementa, un dia cambia en un lado y el navegador topa
 * con un numero distinto al de la RPC, y el caja autoriza de mas (la RPC lo
 * rechaza y se pierde la venta) o topa donde si habia credito (no se vende).
 */
export function esClienteLibre(c: ClienteVenta | null | undefined): boolean {
  return esSinTope(c);
}

/**
 * CUANTO PUEDE JUGAR el cliente = saldo en mano + aval.
 *
 * El aval es crédito negado, no efectivo: le permite jugar por encima de su
 * saldo, pero el saldo queda debitado en negativo y esa deuda se cobra. Un
 * cliente con saldo -200 y aval 300 tiene $100 disponibles, no $0.
 *
 * Misma regla que aplican `club_vender_marca` y `club_vender_tabla`.
 * Un cliente "libre" no tiene tope, asi que devuelve Infinity.
 */
export function limiteDeJugar(c: ClienteVenta | null | undefined): number {
  return esSinTope(c) ? Number.POSITIVE_INFINITY : disponibleParaJugar(c);
}

/**
 * Como leemos el disponible al operador. Cuando sale del aval (y mas aun si el
 * saldo esta en mora) tiene que quedar explicito: si solo se muestra el total,
 * el caja cree que hay efectivo y se sorprende cuando el cliente no aparece.
 */
export function textoDisponible(c: ClienteVenta | null | undefined): string {
  return esSinTope(c) ? "libre" : explicarDisponible(c);
}

// ===========================================================================
// ADMINISTRACIÓN DE GRUPOS (clon de js/grupos.js) — datos reales de Supabase
// ===========================================================================

export type GrupoRow = {
  id: string | number;
  nombre: string;
  moneda?: string | null;
  moneda_cuadre?: string | null;
  cupo_tabla?: number | null;
  comision_default?: number | null;
  /**
   * Comisión por convenio de PRODUCTO (% sobre el monto decidido) que el grupo
   * principal paga al grupo del cliente. `comision_default` sigue siendo la de
   * "entre tercios"; estas son las de los demás productos y, en NULL, HEREDAN
   * de `comision_default`. Requieren `sql/grupos_comisiones_convenio.sql`.
   */
  comision_marcas?: number | null;
  comision_tablas?: number | null;
  comision_remates?: number | null;
  comision_polla?: number | null;
  comision_wps?: number | null;
  comision_dupletas?: number | null;
  responsable?: string | null;
  cuenta_bancaria?: string | null;
  es_principal?: boolean | null;
  activo?: boolean | null;
  /** Jerarquía de cruces: switch general del grupo (default TRUE = permitido). */
  permite_cruces?: boolean | null;
  /** Ciclo de facturación semanal (1=Lunes … 7=Domingo). Default L→D. */
  dia_inicio_semana?: number | null;
  dia_fin_semana?: number | null;
  /**
   * Inicio de la semana que se está operando. NULL = se deduce de hoy.
   *
   * Solo el usuario principal la escribe (RPC `club_fijar_semana_vigente`, ver
   * sql/semana_vigente.sql). Si la columna todavía no está aplicada, la lectura
   * sigue funcionando: la app deduce la semana del ciclo como antes.
   */
  semana_vigente_inicio?: string | null;
  created_at?: string | null;
};

export type ClienteLigero = {
  id: string | number;
  nombre: string;
  grupo_id?: string | number | null;
};

export type MembresiaClienteGrupo = {
  id?: string | number;
  cliente_id: string | number;
  grupo_id: string | number;
  es_principal?: boolean | null;
  activo?: boolean | null;
};

export type ConvenioRow = {
  id?: string | number;
  tipo_jugada_id: string | number;
  grupo_id: string | number;
  comision?: string | number | null;
  comision_base?: string | number | null;
  comision_porcentaje?: number | null;
  permite_cruces?: boolean | null;
};

/** Lista TODOS los grupos (gestión); a diferencia de listarGruposVenta no filtra activos. */
export async function listarGruposAdmin(force = false): Promise<GrupoRow[]> {
  if (cacheGruposAdmin && !force) return cacheGruposAdmin;
  if (!supabase) return [];
  let grupos: GrupoRow[] | null = null;
  // `select *` (y no la lista de columnas) para tolerar migraciones
  // incompletas: si falta una columna, antes tumbaba TODO el listado.
  try {
    const { data, error } = await supabase
      .from("grupos_venta")
      .select("*")
      .order("es_principal", { ascending: false });
    if (error) throw error;
    // RLS no da error: filtra filas y responde 200 con []. Una lista vacia NO
    // significa "no hay grupos": si llega vacia se prueba el RPC (misma regla
    // que `listarGruposVenta`). Antes `if (data)` aceptaba `[]` y nunca caia al
    // RPC, asi que con la policy equivocada la gestion veia "0 grupos".
    if (data && data.length) grupos = data as GrupoRow[];
  } catch {
    /* se intenta el RPC */
  }
  if (grupos === null) {
    try {
      const { data, error } = await supabase.rpc("club_listar_grupos");
      if (!error && Array.isArray(data)) grupos = data as unknown as GrupoRow[];
    } catch {
      /* sin acceso */
    }
  }
  if (grupos === null) {
    ultimoErrorGrupos = "No se pudieron cargar los grupos (permisos o conexión).";
    return [];
  }
  ultimoErrorGrupos = null;
  cacheGruposAdmin = grupos;
  return grupos;
}

export async function crearGrupo(datos: Partial<GrupoRow>): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const filaOk = { ...datos, activo: true } as Record<string, unknown>;
  try {
    exigirCapacidad("grupos:fn_guardar_grupo");
    const { error } = await supabase.from("grupos_venta").insert([filaOk]);
    if (error) {
      // Fallback a la RPC del legacy (js/grupos.js:200): club_guardar_grupo
      // recibe UN parámetro jsonb `p_datos` (no parámetros escalares).
      const rpc = await supabase.rpc("club_guardar_grupo", {
        p_datos: {
          nombre: String(datos.nombre ?? ""),
          moneda: datos.moneda ?? "USD",
          cupo_tabla: datos.cupo_tabla ?? 100,
          comision_default: datos.comision_default ?? 5,
          // Comisión por convenio de producto: se manda tal cual (null = hereda).
          // Si el SQL todavía no está aplicado, la RPC vieja ignora estas claves
          // y el grupo se crea igual (sin perder el alta).
          comision_marcas: datos.comision_marcas ?? null,
          comision_tablas: datos.comision_tablas ?? null,
          comision_remates: datos.comision_remates ?? null,
          comision_polla: datos.comision_polla ?? null,
          comision_wps: datos.comision_wps ?? null,
          comision_dupletas: datos.comision_dupletas ?? null,
          responsable: datos.responsable ?? null,
          cuenta_bancaria: datos.cuenta_bancaria ?? null,
          es_principal: Boolean(datos.es_principal),
          activo: true,
          permite_cruces: datos.permite_cruces !== false,
        },
      });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    invalidarCacheGrupos();
    void registrarAuditoria("GRUPO", "CREAR", datos.nombre ? `Grupo creado: ${datos.nombre}` : "Grupo creado");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Errores típicos de "la función/RPC todavía no está aplicada en la base". */
const RPC_AUSENTE = /does not exist|not found|PGRST202|PGRST204|schema cache/i;

export async function actualizarGrupo(
  id: string | number,
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("grupos:fn_guardar_grupo");

    // Los días del ciclo NO pueden escribirse con un UPDATE suelto: `grupos_venta`
    // tiene RLS de solo lectura (sql/semana_vigente.sql) y la RPC del legacy
    // `club_actualizar_grupo` ni siquiera toca esas columnas. Se escriben por su
    // RPC propia (security definer + valida 1..7, ver sql/actualizar_ciclo_grupo.sql).
    // Si el SQL todavía no está aplicado (función ausente), los días vuelven al
    // resto y se respeta el comportamiento anterior.
    const tieneCiclo = "dia_inicio_semana" in patch || "dia_fin_semana" in patch;
    const resto: Record<string, unknown> = { ...patch };
    if (tieneCiclo) {
      delete resto.dia_inicio_semana;
      delete resto.dia_fin_semana;
      const r = await supabase.rpc("club_actualizar_ciclo_grupo", {
        p_grupo_id: String(id),
        p_dia_inicio: Number(patch.dia_inicio_semana) || null,
        p_dia_fin: Number(patch.dia_fin_semana) || null,
      });
      if (r.error && !RPC_AUSENTE.test(r.error.message)) {
        return { ok: false, error: r.error.message };
      }
      if (r.error && RPC_AUSENTE.test(r.error.message)) {
        resto.dia_inicio_semana = patch.dia_inicio_semana;
        resto.dia_fin_semana = patch.dia_fin_semana;
      }
    }

    if (Object.keys(resto).length > 0) {
      // Intento 1: UPDATE directo. PostgREST NO reporta error cuando el RLS
      // esconde la fila: responde 200 con 0 filas. Por eso se pide la fila de
      // vuelta y "0 filas" se trata como fallo (antes cantaba éxito sin guardar
      // nada y nunca caía a la RPC de respaldo).
      const { data, error } = await supabase
        .from("grupos_venta")
        .update(resto)
        .eq("id", id)
        .select("id");
      const filas = Array.isArray(data) ? data.length : data ? 1 : 0;
      if (error || filas === 0) {
        // Intento 2: RPC del legacy (js/grupos.js:366): club_actualizar_grupo
        // recibe (p_id, p_datos jsonb) — solo se envían los campos presentes.
        const datos: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(resto)) {
          if (v !== undefined) datos[k] = v;
        }
        const rpc = await supabase.rpc("club_actualizar_grupo", { p_id: id, p_datos: datos });
        if (rpc.error) return { ok: false, error: rpc.error.message };
      }
    }

    // Los días del ciclo solo los escribe la RPC nueva (club_actualizar_ciclo_grupo).
    // Si no está aplicada (sql/actualizar_ciclo_grupo.sql) o el RLS escondió el
    // UPDATE, la cadena anterior canta éxito sin guardar nada y el grupo vuelve
    // a "Lunes" al recargar. Se verifica leyendo la fila de vuelta y, si el día
    // pedido no quedó, se devuelve un error claro en vez de un falso éxito.
    if (tieneCiclo) {
      const pidioInicio = patch.dia_inicio_semana !== undefined && patch.dia_inicio_semana !== null
        ? Number(patch.dia_inicio_semana)
        : null;
      const pidioFin = patch.dia_fin_semana !== undefined && patch.dia_fin_semana !== null
        ? Number(patch.dia_fin_semana)
        : null;
      if (pidioInicio != null || pidioFin != null) {
        const leidas = await supabase
          .from("grupos_venta")
          .select("dia_inicio_semana, dia_fin_semana")
          .eq("id", id)
          .maybeSingle();
        // Si la lectura de vuelta falla (RLS) no se puede verificar: se respeta
        // el resultado silencioso de la cadena anterior en vez de inventar un
        // error. Solo se falla cuando YA se pudo leer la fila y el día pedido
        // no quedó guardado.
        if (!leidas.error && leidas.data) {
          const fila = leidas.data as { dia_inicio_semana?: number | null; dia_fin_semana?: number | null };
          const inicioOk = pidioInicio == null || Number(fila.dia_inicio_semana) === pidioInicio;
          const finOk = pidioFin == null || Number(fila.dia_fin_semana) === pidioFin;
          if (!inicioOk || !finOk) {
            return {
              ok: false,
              error:
                "El día de la semana no se guardó. Falta aplicar sql/actualizar_ciclo_grupo.sql en el SQL Editor de Supabase (crea la RPC club_actualizar_ciclo_grupo).",
            };
          }
        }
      }
    }

    invalidarCacheGrupos();
    void registrarAuditoria("GRUPO", "ACTUALIZAR", `Grupo ${id} actualizado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Registro best-effort de operaciones en `auditoria` (misma tabla del legacy). */
export async function registrarAuditoria(
  modulo: string,
  accion: string,
  detalle: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("auditoria").insert([
      { modulo, accion, detalle: String(detalle).slice(0, 500), fecha: new Date().toISOString() },
    ] as Record<string, unknown>[]);
  } catch {
    /* la tabla o el RLS pueden impedirlo; no bloquea la operación */
  }
}

/** Activa/desactiva un grupo (la tarjeta se oculta en opciones de venta). */
export async function toggleGrupoActivo(id: string | number, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("grupos_venta").update({ activo }).eq("id", id);
    if (error) {
      const rpc = await supabase.rpc("club_toggle_grupo", { p_id: id, p_activo: activo });
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    invalidarCacheGrupos();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Garantiza UN solo grupo principal: desmarca los demás. */
export async function asignarPrincipalUnico(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("grupos_venta").update({ es_principal: false }).neq("id", id).eq("es_principal", true);
    if (error) {
      // Fallback: la RPC del legacy (paquete_pendientes.sql:624) reasigna el
      // principal en una sola transacción, sin depender de permisos de tabla.
      const rpc = await supabase.rpc("club_garantizar_grupo_principal");
      if (rpc.error) return { ok: false, error: rpc.error.message };
    }
    invalidarCacheGrupos();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Elimina un grupo (regla del legacy): re-mueve sus clientes al grupo
 * principal, limpia pertenencias de clientes_grupos y borra el registro.
 */
export async function eliminarGrupoRpc(id: string | number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("grupos:btn_eliminar");
    // La RPC (js/grupos.js → club_eliminar_grupo) hace TODO el re-movimiento a
    // clientes/clientes_grupos en una transacción. Se usa como fallback cuando
    // el borrado directo está bloqueado por RLS/permisos.
    const { error: e3 } = await supabase.from("grupos_venta").delete().eq("id", id);
    if (e3) {
      const rpc = await supabase.rpc("club_eliminar_grupo", { p_id: id });
      if (rpc.error) return { ok: false, error: rpc.error.message };
      invalidarCacheGrupos();
      void registrarAuditoria("GRUPO", "ELIMINAR", `Grupo ${id} eliminado.`);
      return { ok: true };
    }
    // Borrado directo OK: se replican los pasos de reasignación del legacy.
    const principal = (await listarGruposAdmin(true)).find((g) => g.es_principal);
    if (principal && String(principal.id) !== String(id)) {
      const { error: e1 } = await supabase.from("clientes").update({ grupo_id: principal.id }).eq("grupo_id", id);
      if (e1) return { ok: false, error: e1.message };
    }
    const { error: e2 } = await supabase.from("clientes_grupos").delete().eq("grupo_id", id);
    if (e2) return { ok: false, error: e2.message };
    invalidarCacheGrupos();
    void registrarAuditoria("GRUPO", "ELIMINAR", `Grupo ${id} eliminado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Clientes por grupo (grupo_id principal + pertenencias adicionales)
// ---------------------------------------------------------------------------

export async function listarClientesLigeros(force = false): Promise<ClienteLigero[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("clientes").select("id, nombre, grupo_id").order("nombre");
    if (error) throw error;
    return (data ?? []) as ClienteLigero[];
  } catch {
    return [];
  }
}

export async function listarMembresias(force = false): Promise<MembresiaClienteGrupo[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("clientes_grupos")
      .select("id, cliente_id, grupo_id, es_principal, activo");
    if (error) throw error;
    return (data ?? []) as MembresiaClienteGrupo[];
  } catch {
    return [];
  }
}

/** Agrega clientes como pertenencia ADICIONAL a un grupo (cliente_grupos).
 *  Regla del legacy: nunca duplica a los principales del destino ni a
 *  adicionales existentes, y excluye el propio grupo destino. */
export async function agregarClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; agregados: number; error?: string; sinTabla?: boolean }> {
  if (!supabase) return { ok: false, agregados: 0, error: "Sin conexión a Supabase" };
  try {
    // La pagina /grupos solo exige grupos:ruta_grupos (LECTURA): sin esta
    // comprobacion, un usuario de solo lectura podria alterar las
    // pertenencias. Las RPC son security definer, asi que la base no frena
    // el abuso: el control va aqui (mismo criterio que moverClientesGrupo).
    exigirCapacidad("grupos:modal_miembros");
    const idsSet = new Set(clienteIds.map((x) => String(x)));
    idsSet.delete(String(grupoId));
    if (!idsSet.size) return { ok: true, agregados: 0 };
    const filas = [...idsSet].map((cliente_id) => ({
      cliente_id,
      grupo_id: grupoId,
      es_principal: false,
      activo: true,
    }));
    let yaExisten = new Set<string>();
    let principalesDestino = new Set<string>();
    try {
      const [p, e] = await Promise.all([
        supabase.from("clientes").select("id").eq("grupo_id", String(grupoId) as never),
        (async () => {
          const { data, error } = await supabase.from("clientes_grupos").select("cliente_id").eq("grupo_id", String(grupoId) as never);
          return error ? null : data;
        })(),
      ]);
      if (p && !p.error && Array.isArray(p.data)) principalesDestino = new Set(p.data.map((x) => String(x.id)));
      if (e && Array.isArray(e)) yaExisten = new Set(e.map((x) => String(x.cliente_id)));
    } catch {
      /* tabla clientes_grupos posiblemente ausente → fallback directo */
    }
    const nuevas = filas.filter((f) => !yaExisten.has(String(f.cliente_id)) && !principalesDestino.has(String(f.cliente_id)));
    if (!nuevas.length) return { ok: true, agregados: 0 };
    const { error } = await supabase.from("clientes_grupos").insert(nuevas as Record<string, unknown>[]);
    if (error) {
      // Fallback sin tabla clientes_grupos (mismo comportamiento del legacy):
      // se mueve el grupo_id principal del cliente (schema sin multi-grupo).
      if (/relation .* does not exist|PGRST205/i.test(error.message)) {
        const { error: e2 } = await supabase.from("clientes").update({ grupo_id: grupoId }).in("id", [...idsSet]);
        if (e2) return { ok: false, agregados: 0, error: e2.message };
        cacheClientes = null;
        return { ok: true, agregados: nuevas.length, sinTabla: true };
      }
      // Fallback a la RPC security definer (sql/grupos_asignacion_rpc.sql):
      // el RLS bloquea el insert directo, la RPC corre como duena de la tabla.
      const rpc = await supabase.rpc("club_agregar_clientes_grupo", {
        p_cliente_ids: [...idsSet],
        p_grupo_id: grupoId,
      });
      if (rpc.error) return { ok: false, agregados: 0, error: rpc.error.message };
      cacheClientes = null;
      const dato = (rpc.data ?? {}) as Record<string, unknown>;
      return { ok: true, agregados: Number(dato.agregados ?? nuevas.length) };
    }
    cacheClientes = null;
    return { ok: true, agregados: nuevas.length };
  } catch (e) {
    return { ok: false, agregados: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Quita pertenencias ADICIONALES del grupo (nunca el grupo_id principal del cliente). */
export async function quitarClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    // Misma capacidad que agregarClientesGrupo: escribir en clientes_grupos
    // es "grupos:modal_miembros", no basta con poder VER la pagina.
    exigirCapacidad("grupos:modal_miembros");
    const { error } = await supabase
      .from("clientes_grupos")
      .delete()
      .eq("grupo_id", grupoId)
      .in("cliente_id", clienteIds);
    if (error) {
      // Fallback a la RPC security definer (sql/grupos_asignacion_rpc.sql):
      // la RPC NUNCA borra la pertenencia de un cliente que tenga ese grupo
      // como grupo_id PRINCIPAL, misma garantia que el comentario de arriba.
      const rpc = await supabase.rpc("club_quitar_clientes_grupo", {
        p_cliente_ids: clienteIds,
        p_grupo_id: grupoId,
      });
      if (rpc.error) return { ok: false, error: rpc.error.message };
      cacheClientes = null;
      return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Movimiento sin tabla clientes_grupos (fallback): asigna grupo_id principal. */
export async function moverClientesGrupo(
  clienteIds: (string | number)[],
  grupoId: string | number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("grupos:modal_miembros");
    const { error } = await supabase.from("clientes").update({ grupo_id: grupoId }).in("id", clienteIds);
    if (error) {
      // Fallback a la RPC security definer (sql/grupos_asignacion_rpc.sql).
      const rpc = await supabase.rpc("club_mover_clientes_grupo", {
        p_cliente_ids: clienteIds,
        p_grupo_id: grupoId,
      });
      if (rpc.error) return { ok: false, error: rpc.error.message };
      cacheClientes = null;
      return { ok: true };
    }
    cacheClientes = null;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Convenios por tipo de jugada y grupo (convenio_tipo_grupo)
// ---------------------------------------------------------------------------

export type TipoJugadaRow = {
  id: string | number;
  nombre: string;
  activo?: boolean | null;
  comision_porcentaje?: number | null;
  comision_base?: string | null;
  permite_cruces?: boolean | null;
};

export async function listarTiposJugadas(soloActivos = true): Promise<TipoJugadaRow[]> {
  if (!supabase) return [];
  try {
    const q = supabase.from("tipos_jugadas").select("*");
    const r = soloActivos ? await q.eq("activo", true).order("nombre") : await q.order("nombre");
    if (r.error) throw r.error;
    return (r.data ?? []) as TipoJugadaRow[];
  } catch {
    return [];
  }
}

export async function listarConveniosGrupo(grupoId: string | number): Promise<ConvenioRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("convenio_tipo_grupo").select("*").eq("grupo_id", grupoId);
    if (error) throw error;
    return (data ?? []) as ConvenioRow[];
  } catch {
    return [];
  }
}

/** UPSERT de convenios (clave única tipo_jugada_id + grupo_id, como el legacy). */
export async function guardarConveniosGrupo(
  grupoId: string | number,
  filas: Array<{
    tipo_jugada_id: string | number;
    comision: number | null;
    comision_base: number | null;
    permite_cruces: boolean;
  }>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const payload = filas.map((f) => ({
      tipo_jugada_id: f.tipo_jugada_id,
      grupo_id: grupoId,
      comision: f.comision != null ? String(f.comision) : "5%",
      comision_base: f.comision_base != null ? String(f.comision_base) : "PREMIO",
      comision_porcentaje: f.comision ?? 0,
      permite_cruces: f.permite_cruces,
    }));
    const { error } = await supabase
      .from("convenio_tipo_grupo")
      .upsert(payload, { onConflict: "tipo_jugada_id,grupo_id" });
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("CONVENIO", "GUARDAR", `Convenios del grupo ${grupoId}: ${filas.length} tipo(s).`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// H1 · Cupos por grupo de una Tabla Fija (tabla_grupos)
// ---------------------------------------------------------------------------

export type CupoTablaGrupo = {
  id?: string | number;
  tabla_id: string | number;
  grupo_id: string | number;
  grupo_nombre?: string | null;
  cupos?: number | null;
  max?: number | null;
  cantidad_vendida?: number;
};

/** Cupos por grupo de una tabla (tabla_grupos, orden alfabético por grupo). */
export async function listarCuposTabla(tablaId: string | number): Promise<CupoTablaGrupo[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tabla_grupos")
      .select("id, tabla_id, grupo_id, grupo_nombre, cupos, max, cantidad_vendida")
      .eq("tabla_id", String(tablaId));
    if (error) throw error;
    return (data ?? []) as CupoTablaGrupo[];
  } catch {
    return [];
  }
}

/** UPSERT de cupos por grupo de una tabla (clave única tabla_id+grupo_id). */
export async function guardarCuposTabla(
  tablaId: string | number,
  filas: Array<{ grupo_id: string | number; cupos: number | null; max: number | null }>
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  const payload = filas.map((f) => ({
    tabla_id: String(tablaId),
    grupo_id: f.grupo_id,
    cupos: f.cupos ?? 0,
    max: f.max,
  }));
  try {
    const { error } = await supabase
      .from("tabla_grupos")
      .upsert(payload, { onConflict: "tabla_id,grupo_id" });
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TABLA_GRUPOS", "GUARDAR", `Cupos de la tabla ${tablaId}: ${filas.length} grupo(s).`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// H4 · CRUD de Tipos de Jugada (tipos_jugadas)
// ---------------------------------------------------------------------------

/** Crea un tipo de jugada (con activo=true). */
export async function crearTipoJugada(nombre: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase
      .from("tipos_jugadas")
      .insert([{ nombre: String(nombre ?? "").trim().toUpperCase(), activo: true, comision_porcentaje: 0 }]);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "CREAR", `Tipo de jugada creado: ${nombre}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Actualiza nombre / % por defecto de un tipo de jugada. */
export async function actualizarTipoJugada(
  id: string | number,
  patch: { nombre?: string; comision_porcentaje?: number | null; permite_cruces?: boolean | null }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const datos: Record<string, unknown> = {};
    if (patch.nombre != null) datos.nombre = String(patch.nombre).trim().toUpperCase();
    if (patch.comision_porcentaje != null) datos.comision_porcentaje = patch.comision_porcentaje;
    if (patch.permite_cruces != null) datos.permite_cruces = patch.permite_cruces;
    if (!Object.keys(datos).length) return { ok: true };
    const { error } = await supabase.from("tipos_jugadas").update(datos).eq("id", id);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "ACTUALIZAR", `Tipo de jugada ${id} actualizado.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Activa/desactiva un tipo de jugada (los inactivos no se listan en convenios). */
export async function toggleTipoJugadaActivo(id: string | number, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    const { error } = await supabase.from("tipos_jugadas").update({ activo }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    void registrarAuditoria("TIPOS_JUGADAS", "TOGGLE", `Tipo de jugada ${id} → ${activo ? "activo" : "inactivo"}.`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===========================================================================
// ECOSISTEMA DE GRUPO (NIVEL 1 → 3) — alta de una franquicia completa
// ===========================================================================
// Crea de una sola vez:
//   1. El GRUPO de venta (grupos_venta)               → NIVEL 1
//   2. La cuenta del ADMIN / dueño de la banca        → NIVEL 2
//   3. Las cuentas de los OPERADORES (taquillas)      → NIVEL 3
//
// Por qué pasa por una edge function: crear cuentas de Supabase Auth exige
// `service_role`, que jamás puede vivir en el bundle del navegador. La función
// `crear-grupo` (supabase/functions/crear-grupo) valida que quien llama sea el
// usuario principal y recién ahí usa la llave de servicio. Si todavía no está
// desplegada, esta función cae a un modo degradado: crea el grupo y las filas
// de `usuario_sistema` (así la franquicia ya existe) pero avisa que las
// credenciales de login quedaron pendientes.

export type NuevoUsuarioDeGrupo = {
  /** Nombre de acceso (sin correo): se normaliza con `claveDeUsuario`. */
  usuario: string;
  nombre?: string;
  /** "admin" (NIVEL 2) u "operador" (NIVEL 3). */
  tipo: string;
  /** Clave inicial. La cuenta se crea con `email_confirm: true`. */
  clave: string;
  /** Si se omite, se deriva <usuario>@sistemahipico.local. */
  correo?: string;
};

export type EcosistemaGrupoEntrada = {
  grupo: {
    nombre: string;
    moneda?: string | null;
    moneda_cuadre?: string | null;
    comision_default?: number | null;
    /** Comisión por convenio de cada producto (null = hereda `comision_default`). */
    comision_marcas?: number | null;
    comision_tablas?: number | null;
    comision_remates?: number | null;
    comision_polla?: number | null;
    comision_wps?: number | null;
    comision_dupletas?: number | null;
    cupo_tabla?: number | null;
    responsable?: string | null;
    cuenta_bancaria?: string | null;
  };
  admin: NuevoUsuarioDeGrupo;
  operadores: NuevoUsuarioDeGrupo[];
};

export type UsuarioDeGrupoCreado = {
  usuario: string;
  correo: string;
  tipo: string;
  clave: string;
};

export type EcosistemaGrupoResultado = {
  ok: boolean;
  error?: string;
  grupoId?: string;
  grupoNombre?: string;
  creados?: UsuarioDeGrupoCreado[];
  /** Presente cuando se creó en modo degradado (sin cuentas de Auth). */
  aviso?: string;
};

/** Dominio local con el que se siembran las cuentas de personal (ver crear_usuario_gunbold.sql). */
const DOMINIO_LOGIN = "sistemahipico.local";

/** Correo de login del usuario: el explícito si lo hay, si no <usuario>@dominio. */
export function correoDeLogin(usuario: string, correo?: string): string {
  const limpio = String(correo ?? "").trim();
  if (limpio) return limpio;
  return `${claveDeUsuario(usuario)}@${DOMINIO_LOGIN}`;
}

export async function crearEcosistemaGrupo(
  entrada: EcosistemaGrupoEntrada
): Promise<EcosistemaGrupoResultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  const nombreGrupo = String(entrada?.grupo?.nombre ?? "").trim().toUpperCase();
  if (!nombreGrupo) return { ok: false, error: "Indicá el nombre del grupo." };

  const usuarios = [entrada?.admin, ...(entrada?.operadores ?? [])].filter(
    (u): u is NuevoUsuarioDeGrupo => Boolean(u)
  );
  if (!usuarios.length) return { ok: false, error: "Falta el usuario administrador del grupo." };
  if (usuarios[0]?.tipo !== "admin") {
    return { ok: false, error: "El primer usuario debe ser el administrador del grupo." };
  }

  const vistos = new Set<string>();
  for (const u of usuarios) {
    const clave = claveDeUsuario(u.usuario);
    if (!clave) return { ok: false, error: "Cada usuario necesita su nombre de acceso." };
    if (vistos.has(clave)) return { ok: false, error: `El usuario "${u.usuario}" está repetido.` };
    vistos.add(clave);
    if (String(u.clave ?? "").length < 6) {
      return { ok: false, error: `La clave de "${u.usuario}" debe tener al menos 6 caracteres.` };
    }
    if (u.tipo !== "admin" && u.tipo !== "operador") {
      return { ok: false, error: `Tipo de usuario inválido para "${u.usuario}".` };
    }
  }

  // No se pisa una cuenta existente: eso le robaría el acceso (y el grupo) a
  // otra banca. La colisión se detecta antes de tocar la base.
  try {
    const existentes = await leerUsuariosDelSistema();
    const ocupados = new Set(existentes.map((u) => claveDeUsuario(u.id)));
    const choque = usuarios.map((u) => u.usuario).find((x) => ocupados.has(claveDeUsuario(x)));
    if (choque) return { ok: false, error: `El usuario "${choque}" ya existe. Elegí otro.` };
  } catch {
    /* si no se pudo leer, lo vuelve a validar la edge function */
  }

  // 1) Camino principal: edge function con service_role (crea grupo + Auth).
  try {
    const inv = await supabase.functions.invoke("crear-grupo", { body: entrada });
    const data = inv.data as Partial<EcosistemaGrupoResultado> | null;
    if (data && typeof data === "object" && data.ok === true) {
      return data as EcosistemaGrupoResultado;
    }
    if (data && typeof data === "object" && data.ok === false) {
      // La función corrió y rechazó: el error es de negocio, no de despliegue.
      return { ok: false, error: data.error ?? "No se pudo crear el grupo." };
    }
    if (!inv.error) return { ok: false, error: "Respuesta inesperada del servicio de creación." };
  } catch {
    /* función no desplegada o sin red: se sigue con el modo degradado */
  }

  // 2) Modo degradado: grupo + filas de usuario_sistema (sin cuentas de Auth).
  try {
    exigirCapacidad("seguridad:fn_asignar_tipo");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  let grupoId = "";
  const rpc = await supabase.rpc("club_guardar_grupo", {
    p_datos: {
      nombre: nombreGrupo,
      moneda: entrada.grupo.moneda ?? "USD",
      moneda_cuadre: entrada.grupo.moneda_cuadre ?? "USD",
      cupo_tabla: entrada.grupo.cupo_tabla ?? 100,
      comision_default: entrada.grupo.comision_default ?? 5,
      comision_marcas: entrada.grupo.comision_marcas ?? null,
      comision_tablas: entrada.grupo.comision_tablas ?? null,
      comision_remates: entrada.grupo.comision_remates ?? null,
      comision_polla: entrada.grupo.comision_polla ?? null,
      comision_wps: entrada.grupo.comision_wps ?? null,
      comision_dupletas: entrada.grupo.comision_dupletas ?? null,
      responsable: entrada.grupo.responsable ?? null,
      cuenta_bancaria: entrada.grupo.cuenta_bancaria ?? null,
      es_principal: false,
    },
  });
  if (!rpc.error && rpc.data) grupoId = String(rpc.data);

  if (!grupoId) {
    const creado = await crearGrupo({
      nombre: nombreGrupo,
      moneda: entrada.grupo.moneda ?? "USD",
      comision_default: entrada.grupo.comision_default ?? 5,
      comision_marcas: entrada.grupo.comision_marcas ?? null,
      comision_tablas: entrada.grupo.comision_tablas ?? null,
      comision_remates: entrada.grupo.comision_remates ?? null,
      comision_polla: entrada.grupo.comision_polla ?? null,
      comision_wps: entrada.grupo.comision_wps ?? null,
      comision_dupletas: entrada.grupo.comision_dupletas ?? null,
      cupo_tabla: entrada.grupo.cupo_tabla ?? 100,
      responsable: entrada.grupo.responsable ?? null,
    });
    if (!creado.ok) return { ok: false, error: creado.error ?? "No se pudo crear el grupo." };
    const lista = await listarGruposAdmin(true);
    const enc = lista.find((g) => String(g.nombre ?? "").trim().toUpperCase() === nombreGrupo);
    grupoId = enc ? String(enc.id) : "";
  }
  if (!grupoId) return { ok: false, error: "El grupo se creó pero no se pudo leer su identificador." };

  const creados: UsuarioDeGrupoCreado[] = [];
  for (const u of usuarios) {
    const clave = claveDeUsuario(u.usuario);
    const r = await guardarUsuarioSistema({
      id: clave,
      nombre: u.nombre ?? clave,
      tipo: u.tipo,
      activo: true,
      grupoId,
    });
    if (!r.ok) {
      return {
        ok: false,
        error: `El grupo se creó, pero falló el usuario "${u.usuario}": ${r.error ?? "error desconocido"}`,
      };
    }
    creados.push({ usuario: clave, correo: correoDeLogin(clave, u.correo), tipo: u.tipo, clave: u.clave });
  }

  invalidarCacheGrupos();
  void registrarAuditoria("GRUPO", "CREAR", `Grupo ${nombreGrupo} creado con ${creados.length} usuarios (sin Auth).`);

  return {
    ok: true,
    grupoId,
    grupoNombre: nombreGrupo,
    creados,
    aviso:
      "El grupo y sus usuarios quedaron creados, pero las cuentas de login no: " +
      "desplegá la edge function `crear-grupo` y reintentá para generar las credenciales.",
  };
}