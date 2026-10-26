/**
 * Monitor de Jugadas — lectura de progreso + corrección/anulación auditada.
 *
 *  - `v_jugadas_monitor` (sql/jugadas_monitor.sql) agrega los tickets por
 *    (hipódromo, carrera, fecha de carrera) y marca si el resultado está
 *    cargado en `resultados_carreras`.
 *  - El detalle sale de `tickets_apuestas` filtrando por hipódromo + carrera.
 *  - Editar / Anular / Restaurar / Marcar pagada escriben el ticket y dejan
 *    rastro en `jugadas_auditoria` (motivo, snapshot antes/después, imagen).
 *
 * La fecha de la carrera NO es `fecha_registro` (timestamp de venta): se lee de
 * `nota_auditoria::jsonb->>'fecha_carrera'`, que sellan los RPC de venta.
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad, grupoActivoVigente, tieneCapacidad } from "@/features/seguridad/lib/vigente";
import { nombreDeEjemplarEnMatriz } from "@/features/liquidacion/lib/resolver-ejemplar";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type FilaMonitorJugada = {
  hipodromo: string;
  carrera: number;
  fecha_carrera: string | null;
  total_jugadas: number;
  total_monto: number;
  total_premio: number;
  en_juego: number;
  por_pagar: number;
  liquidadas: number;
  anuladas: number;
  monto_vigente: number;
  premio_ganador: number;
  usuarios: string[] | null;
  origenes: string | null;
  resultado_cargado: boolean;
};

export type JugadaAdmin = {
  id: string;
  hipodromo: string;
  carrera: number;
  nombre_jugada?: string | null;
  caballo?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  monto_decidido?: number | null;
  premio_pagar?: number | null;
  comision_porcentaje?: number | null;
  estado?: string | null;
  cliente_juega_id?: string | number | null;
  cliente_consigue_id?: string | number | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
  moneda?: string | null;
  nota_auditoria?: string | null;
  fecha_registro?: string | null;
  anulada?: boolean | null;
  anulada_motivo?: string | null;
  anulada_por?: string | null;
  anulada_at?: string | null;
  pagado_en?: string | null;
  pagado_por?: string | null;
  es_adelantada?: boolean | null;
};

export type AuditoriaJugada = {
  id: number | string;
  ticket_id: string;
  hipodromo?: string | null;
  carrera?: number | null;
  accion: string;
  motivo?: string | null;
  detalle?: unknown;
  imagen?: string | null;
  usuario?: string | null;
  creado_at?: string | null;
};

export type EditablesJugada = {
  nombre_jugada?: string | null;
  caballo?: string | null;
  /**
   * Nombre OFICIAL del ejemplar. Al cambiar el número, se sincroniza con el
   * padrón de la carrera (ver `resolver-ejemplar.ts`); el campo existe para
   * poder guardarlo y dejar la jugada con el nombre real del nuevo número.
   */
  nombre_ejemplar?: string | null;
  /** Jugador 1: quién JUEGA la apuesta (`cliente_juega_nombre`). */
  cliente_juega_id?: string | null;
  cliente_juega_nombre?: string | null;
  /** Jugador 2: quién PAGA / banquero (`cliente_consigue_nombre` / banquero). */
  cliente_consigue_id?: string | null;
  cliente_consigue_nombre?: string | null;
  banquero_nombre?: string | null;
  /** Grupo al que pertenece la jugada (se puede reasignar desde el editor). */
  grupo_cobro_id?: string | null;
  grupo_cobro_nombre?: string | null;
  ejemplar_numero?: number | null;
  monto_jugado?: number | null;
  monto_decidido?: number | null;
  premio_pagar?: number | null;
  estado?: string | null;
  /**
   * Modalidad de tiempo (ver `modalidad-tiempo.ts`): `true` = ⏳ adelantada
   * (cargada antes de la carrera), `false` = ⚡ en vivo. Se edita desde el
   * Reporte de Ventas (`ModalAccionJugadaReporte`).
   */
  es_adelantada?: boolean | null;
};

export type Resultado = { ok: boolean; error?: string };

export const MOTIVOS_ANULACION = [
  "Error de carga del operador",
  "Reclamo del cliente atendido",
  "Jugada duplicada",
  "Ejemplar retirado",
  "Carrera anulada",
  "Saldo insuficiente / venta inválida",
  "Orden administrativa",
  "Otro (detallar)",
] as const;

/**
 * NOTAS PREDEFINIDAS DE AUDITORÍA para la EDICIÓN de una jugada cargada. Son los
 * motivos de corrección más frecuentes del mostrador; el operador elige uno de
 * un toque y, si hace falta, agrega texto adicional. La nota completa se guarda
 * en el motivo auditado (misma vía que `MOTIVOS_ANULACION`).
 */
export const NOTAS_PREDEFINIDAS_EDICION = [
  "Corrección de monto por error de transcripción",
  "Cambio de jugador / cliente asignado",
  "Corrección de número de ejemplar",
  "Ajuste de condición / puestos acordados",
  "Anulación solicitada antes de la partida",
] as const;

/**
 * Compone el motivo auditado a partir de una nota predefinida y un detalle
 * opcional: "Nota · detalle". Si no hay nota, devuelve el detalle tal cual (así
 * el operador puede escribir un motivo libre sin elegir nota).
 */
export function componerNota(predefinida: string, detalle: string): string {
  const p = String(predefinida ?? "").trim();
  const d = String(detalle ?? "").trim();
  if (p && d) return `${p} · ${d}`;
  return p || d;
}

const COLS_DETALLE_BASE =
  "id, hipodromo, carrera, cliente_juega_id, nombre_jugada, caballo, ejemplar_numero, monto_jugado, monto_decidido, premio_pagar, comision_porcentaje, estado, cliente_juega_nombre, cliente_consigue_nombre, moneda, nota_auditoria, fecha_registro, anulada, anulada_motivo, anulada_por, anulada_at, pagado_en, pagado_por";
const COLS_DETALLE = COLS_DETALLE_BASE;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string {
  return String(v ?? "").trim();
}

/** `nota_auditoria` es TEXT con un JSON serializado: se parsea siempre. */
export function leerNotaAuditoria(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  const s = String(raw ?? "").trim();
  if (!s || !/^[\[{]/.test(s)) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function usuarioDeJugada(j: JugadaAdmin): string {
  return texto(leerNotaAuditoria(j.nota_auditoria).usuario);
}

export function origenDeJugada(j: JugadaAdmin): string {
  return texto(leerNotaAuditoria(j.nota_auditoria).origen);
}

export function fechaCarreraDeJugada(j: JugadaAdmin): string | null {
  const f = texto(leerNotaAuditoria(j.nota_auditoria).fecha_carrera).slice(0, 10);
  if (f) return f;
  // Respaldo duro: una jugada nunca debe quedar sin fecha. Si el JSON no trae
  // fecha de carrera (filas heredadas), se usa la fecha en que se registró.
  return texto(j.fecha_registro).slice(0, 10) || null;
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/**
 * Une las filas del monitor por (hipódromo, carrera, fecha de carrera).
 *
 * `v_jugadas_monitor` ahora trae `grupo_cobro_id` en la clave (para poder filtrar
 * por grupo), así que una misma carrera puede devolver VARIAS filas —una por
 * grupo de cobro—. El monitor se muestra por carrera: acá se consolidan sumando
 * los totales, uniendo los usuarios, juntando los orígenes y marcando el
 * resultado como cargado si CUALQUIERA de las filas lo tiene.
 */
function agruparMonitor(filas: FilaMonitorJugada[]): FilaMonitorJugada[] {
  const mapa = new Map<string, FilaMonitorJugada>();
  for (const f of filas) {
    const k = `${f.hipodromo}|${f.carrera}|${f.fecha_carrera ?? ""}`;
    const prev = mapa.get(k);
    if (!prev) {
      mapa.set(k, { ...f, usuarios: f.usuarios ? [...f.usuarios] : null });
      continue;
    }
    prev.total_jugadas += f.total_jugadas;
    prev.total_monto += f.total_monto;
    prev.total_premio += f.total_premio;
    prev.en_juego += f.en_juego;
    prev.por_pagar += f.por_pagar;
    prev.liquidadas += f.liquidadas;
    prev.anuladas += f.anuladas;
    prev.monto_vigente += f.monto_vigente;
    prev.premio_ganador += f.premio_ganador;
    prev.resultado_cargado = prev.resultado_cargado || f.resultado_cargado;
    if (!prev.fecha_carrera && f.fecha_carrera) prev.fecha_carrera = f.fecha_carrera;
    const setUsuarios = new Set([...(prev.usuarios ?? []), ...(f.usuarios ?? [])]);
    prev.usuarios = setUsuarios.size ? [...setUsuarios] : null;
    const orig = new Set(
      [prev.origenes, f.origenes]
        .filter(Boolean)
        .flatMap((s) => String(s).split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    );
    prev.origenes = orig.size ? [...orig].join(", ") : null;
  }
  return [...mapa.values()];
}

/**
 * ¿El error de PostgREST es "esa columna no existe" porque la vista es VIEJA?
 *
 * `grupo_cobro_id` se agregó a `v_jugadas_monitor` / `v_jugadas_carrera` en
 * `sql/jugadas_monitor.sql`, que se ejecuta A MANO en Supabase. Si la base aún
 * conserva la vista anterior, el filtro por grupo del administrador falla con un
 * 400 (PostgREST 42703 o "schema cache"). Detectarlo permite degradar al listado
 * completo en vez de romper la pantalla.
 */
function esColumnaFaltanteGrupo(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const txt = `${error.code ?? ""} ${error.message ?? ""}`;
  return /grupo_cobro_id/i.test(txt) && /(does not exist|schema cache|42703|PGRST20)/i.test(txt);
}

/** Aviso único cuando la vista de la base todavía no trae `grupo_cobro_id`. */
const AVISO_VISTA_VIEJA =
  "La base del Monitor está desactualizada: le falta la columna grupo_cobro_id. " +
  "Ejecutá sql/jugadas_monitor.sql en el SQL Editor de Supabase para habilitar el filtro por grupo. " +
  "Mientras tanto se muestran TODOS los grupos.";

export async function listarMonitorJugadas(): Promise<{
  ok: boolean;
  filas: FilaMonitorJugada[];
  error?: string;
  aviso?: string;
}> {
  if (!supabase) return { ok: false, filas: [], error: "Sin conexión a Supabase." };
  const sb = supabase;
  try {
    // Filtro del super administrador ("ver un grupo"). Un usuario con grupo ya
    // viene acotado por el RLS de la vista (security_invoker = true).
    const activo = grupoActivoVigente();
    const consultar = (porGrupo: boolean) => {
      let q = sb.from("v_jugadas_monitor").select("*").order("hipodromo").order("carrera");
      if (porGrupo && activo) q = q.eq("grupo_cobro_id", activo);
      return q;
    };
    let { data, error } = await consultar(Boolean(activo));
    let aviso: string | undefined;
    if (error && activo && esColumnaFaltanteGrupo(error)) {
      // La vista de la base no fue recreada con `sql/jugadas_monitor.sql`: se
      // reintenta SIN el filtro del administrador para no romper el monitor con
      // un 400, y se avisa que hay que actualizar la base.
      const r2 = await consultar(false);
      data = r2.data;
      error = r2.error;
      aviso = AVISO_VISTA_VIEJA;
    }
    if (error) throw error;
    const filas: FilaMonitorJugada[] = (data ?? []).map((r) => {
      const x = r as Record<string, unknown>;
      return {
        hipodromo: texto(x.hipodromo),
        carrera: num(x.carrera),
        fecha_carrera: x.fecha_carrera ? String(x.fecha_carrera).slice(0, 10) : null,
        total_jugadas: num(x.total_jugadas),
        total_monto: num(x.total_monto),
        total_premio: num(x.total_premio),
        en_juego: num(x.en_juego),
        por_pagar: num(x.por_pagar),
        liquidadas: num(x.liquidadas),
        anuladas: num(x.anuladas),
        monto_vigente: num(x.monto_vigente),
        premio_ganador: num(x.premio_ganador),
        usuarios: Array.isArray(x.usuarios) ? (x.usuarios as unknown[]).map(String) : null,
        origenes: x.origenes ? String(x.origenes) : null,
        resultado_cargado: x.resultado_cargado === true,
      };
    });
    return { ok: true, filas: agruparMonitor(filas), aviso };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aplica = /does not exist|schema cache|PGRST20[45]/i.test(msg)
      ? "Falta aplicar sql/jugadas_monitor.sql en Supabase."
      : msg;
    return { ok: false, filas: [], error: aplica };
  }
}

export async function listarJugadasDeCarrera(
  hipodromo: string,
  carrera: number | string,
  fecha?: string | null
): Promise<{ ok: boolean; jugadas: JugadaAdmin[]; error?: string; aviso?: string }> {
  if (!supabase) return { ok: false, jugadas: [], error: "Sin conexión a Supabase." };
  const sb = supabase;
  try {
    // Filtro del super administrador ("ver un grupo"). Un usuario con grupo ya
    // viene acotado por el RLS de la vista (security_invoker = true).
    const activo = grupoActivoVigente();
    const consultar = (porGrupo: boolean, cols = COLS_DETALLE) => {
      let q = sb
        .from("v_jugadas_carrera")
        .select(cols)
        .eq("hipodromo", texto(hipodromo).toUpperCase())
        .eq("carrera", num(carrera))
        .order("fecha_registro")
        .limit(1000);
      if (porGrupo && activo) q = q.eq("grupo_cobro_id", activo);
      return q;
    };
    let { data, error } = await consultar(Boolean(activo), COLS_DETALLE);
    let aviso: string | undefined;
    if (error && activo && esColumnaFaltanteGrupo(error)) {
      // Vista vieja en la base (sin `grupo_cobro_id`): se reintenta sin el filtro
      // del administrador para no romper el detalle con un 400.
      const r2 = await consultar(false, COLS_DETALLE_BASE);
      data = r2.data;
      error = r2.error;
      aviso = AVISO_VISTA_VIEJA;
    }
    if (error) throw error;
    let jugadas = (data ?? []) as unknown as JugadaAdmin[];
    if (fecha) jugadas = jugadas.filter((j) => (fechaCarreraDeJugada(j) ?? "") === String(fecha).slice(0, 10));
    if (jugadas.length > 0) {
      try {
        const ids = jugadas.map((j) => j.id).filter(Boolean);
        const { data: extras } = await sb
          .from("tickets_apuestas")
          .select("id, es_adelantada, cliente_juega_id, anulada")
          .in("id", ids as never[]);
        if (Array.isArray(extras) && extras.length > 0) {
          const mapaExtras = new Map<string, Record<string, unknown>>();
          for (const ex of extras) {
            const row = ex as Record<string, unknown>;
            mapaExtras.set(String(row.id ?? ""), row);
          }
          jugadas = jugadas.map((j) => {
            const ex = mapaExtras.get(String(j.id));
            if (!ex) return j;
            return {
              ...j,
              es_adelantada:
                typeof ex.es_adelantada === "boolean"
                  ? ex.es_adelantada
                  : j.es_adelantada ?? Boolean(leerNotaAuditoria(j.nota_auditoria).es_adelantada),
              cliente_juega_id: (ex.cliente_juega_id as string | number | null | undefined) ?? j.cliente_juega_id ?? null,
              anulada: typeof ex.anulada === "boolean" ? ex.anulada : Boolean(j.anulada),
            };
          });
        }
      } catch {
        // Si la tabla no tiene `es_adelantada`, se conserva el respaldo por `nota_auditoria`.
      }
    }
    return { ok: true, jugadas, aviso };
  } catch (e) {
    return { ok: false, jugadas: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function leerJugada(id: string | number): Promise<JugadaAdmin | null> {
  if (!supabase) return null;
  const rDirecto = await supabase.from("tickets_apuestas").select("*").eq("id", id).maybeSingle();
  if (!rDirecto.error && rDirecto.data) {
    return rDirecto.data as unknown as JugadaAdmin;
  }
  const { data, error } = await supabase.from("v_jugadas_carrera").select(COLS_DETALLE_BASE).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as JugadaAdmin;
}

export async function listarAuditoriaJugadas(ticketId?: string | number): Promise<AuditoriaJugada[]> {
  if (!supabase) return [];
  try {
    let q = supabase
      .from("jugadas_auditoria")
      .select("id, ticket_id, hipodromo, carrera, accion, motivo, detalle, imagen, usuario, creado_at")
      .order("creado_at", { ascending: false })
      .limit(300);
    if (ticketId != null) q = q.eq("ticket_id", String(ticketId));
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AuditoriaJugada[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Escrituras auditadas
// ---------------------------------------------------------------------------

async function auditar(
  jugada: JugadaAdmin | null,
  ticketId: string | number,
  accion: string,
  motivo: string,
  detalle: unknown,
  imagen: string | null,
  usuario: string
): Promise<string | null> {
  if (!supabase) return "Sin conexión a Supabase.";
  try {
    const { error } = await supabase.from("jugadas_auditoria").insert({
      ticket_id: String(ticketId),
      hipodromo: jugada?.hipodromo ?? null,
      carrera: jugada?.carrera ?? null,
      accion,
      motivo: motivo.trim() || null,
      detalle: detalle ?? null,
      imagen: imagen ?? null,
      usuario: usuario || null,
    });
    return error?.message ?? null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Corrige los campos editables de una jugada. Deja snapshot antes/después. */
export async function editarJugada(
  id: string | number,
  cambios: EditablesJugada,
  motivo: string,
  usuario: string
): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  if (
    !tieneCapacidad("jugadas:fn_editar_jugada") &&
    !tieneCapacidad("gestion_jugadas:btn_editar_jugada") &&
    !tieneCapacidad("jugadas:fn_anular_jugada")
  ) {
    try {
      exigirCapacidad("jugadas:fn_editar_jugada");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cambios)) {
    if (v !== undefined) payload[k] = v === "" ? null : v;
  }
  if (Object.keys(payload).length === 0) return { ok: false, error: "No hay cambios para guardar." };

  // -------------------------------------------------------------------------
  // SINCRONIZACIÓN nº → nombre del ejemplar (BUG CRÍTICO)
  // -------------------------------------------------------------------------
  // Cuando cambia el Nº de ejemplar, el nombre del caballo debe salir del padrón
  // de la carrera, no quedarse con el ANTERIOR ("ETNA'S NAPPER(USA)" con el Nº5).
  // Si el editor no mandó ya un `caballo` nuevo (o lo mandó igual al número), acá
  // se resuelve el nombre OFICIAL por (fecha, hipódromo, nº de carrera) y se
  // inyecta. Vale para TODOS los editores, porque todos pasan por `editarJugada`.
  if ("ejemplar_numero" in payload) {
    const numNuevo = payload.ejemplar_numero == null ? "" : String(payload.ejemplar_numero);
    const numViejo = antes.ejemplar_numero == null ? "" : String(antes.ejemplar_numero);
    const cambioNumero = numNuevo !== numViejo;
    // Solo si el editor NO fijó ya un nombre distinto por su cuenta.
    const caballoEditor = payload.caballo !== undefined ? String(payload.caballo ?? "") : null;
    const caballoEsNumeroOVacio = caballoEditor === null || caballoEditor === "" || /^[0-9]+$/.test(caballoEditor);
    if (cambioNumero && /^[0-9]+$/.test(numNuevo) && caballoEsNumeroOVacio) {
      const nombre = await nombreDeEjemplarEnMatriz({
        fecha: fechaCarreraDeJugada(antes) ?? "",
        hipodromo: texto(antes.hipodromo),
        carrera: num(antes.carrera),
        numero: numNuevo,
      });
      if (nombre) payload.caballo = nombre;
    }
  }

  const { error } = await supabase.from("tickets_apuestas").update(payload).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "EDITAR", motivo, { antes, despues: payload }, null, usuario);
  return fallo ? { ok: true, error: `Cambio aplicado, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function anularJugada(
  id: string | number,
  motivo: string,
  imagen: string | null,
  usuario: string
): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  if (!motivo.trim()) return { ok: false, error: "Indicá el motivo de la anulación." };
  if (
    !tieneCapacidad("jugadas:fn_anular_jugada") &&
    !tieneCapacidad("jugadas:fn_editar_jugada") &&
    !tieneCapacidad("gestion_jugadas:btn_editar_jugada")
  ) {
    try {
      exigirCapacidad("jugadas:fn_anular_jugada");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };
  if (antes.anulada) return { ok: false, error: "Esa jugada ya estaba anulada." };

  let { error } = await supabase
    .from("tickets_apuestas")
    .update({
      anulada: true,
      anulada_motivo: motivo.trim(),
      anulada_por: usuario || null,
      anulada_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error && /(anulada_motivo|anulada_por|anulada_at|does not exist|42703)/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    const rFallback = await supabase
      .from("tickets_apuestas")
      .update({ anulada: true })
      .eq("id", id);
    error = rFallback.error;
  }
  if (error) return { ok: false, error: error.message };

  // Reintegrar el monto apostado al saldo_actual del cliente que jugó (la venta lo debitó al cargar).
  const montoJugado = num(antes.monto_jugado);
  const clienteJuegaId = antes.cliente_juega_id;
  if (montoJugado > 0 && clienteJuegaId != null && String(clienteJuegaId).trim() !== "") {
    try {
      const { data: cli } = await supabase
        .from("clientes")
        .select("saldo_actual")
        .eq("id", clienteJuegaId as never)
        .maybeSingle();
      if (cli) {
        const saldoActual = num((cli as Record<string, unknown>).saldo_actual);
        await supabase
          .from("clientes")
          .update({ saldo_actual: saldoActual + montoJugado })
          .eq("id", clienteJuegaId as never);
      }
    } catch {
      // Si el cliente no se puede actualizar por RLS, la anulación del ticket igual queda firme.
    }
  }

  const fallo = await auditar(antes, id, "ANULAR", motivo, { antes }, imagen, usuario);
  return fallo ? { ok: true, error: `Anulada, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function restaurarJugada(id: string | number, motivo: string, usuario: string): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  if (
    !tieneCapacidad("jugadas:fn_restaurar_jugada") &&
    !tieneCapacidad("jugadas:fn_editar_jugada") &&
    !tieneCapacidad("gestion_jugadas:btn_editar_jugada") &&
    !tieneCapacidad("jugadas:fn_anular_jugada")
  ) {
    try {
      exigirCapacidad("jugadas:fn_restaurar_jugada");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };

  let { error } = await supabase
    .from("tickets_apuestas")
    .update({ anulada: false, anulada_motivo: null, anulada_por: null, anulada_at: null })
    .eq("id", id);
  if (error && /(anulada_motivo|anulada_por|anulada_at|does not exist|42703)/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    const rFallback = await supabase
      .from("tickets_apuestas")
      .update({ anulada: false })
      .eq("id", id);
    error = rFallback.error;
  }
  if (error) return { ok: false, error: error.message };

  if (antes.anulada) {
    const montoJugado = num(antes.monto_jugado);
    const clienteJuegaId = antes.cliente_juega_id;
    if (montoJugado > 0 && clienteJuegaId != null && String(clienteJuegaId).trim() !== "") {
      try {
        const { data: cli } = await supabase
          .from("clientes")
          .select("saldo_actual")
          .eq("id", clienteJuegaId as never)
          .maybeSingle();
        if (cli) {
          const saldoActual = num((cli as Record<string, unknown>).saldo_actual);
          await supabase
            .from("clientes")
            .update({ saldo_actual: saldoActual - montoJugado })
            .eq("id", clienteJuegaId as never);
        }
      } catch {
        // Ignorar si no aplica
      }
    }
  }

  const fallo = await auditar(antes, id, "RESTAURAR", motivo, { antes }, null, usuario);
  return fallo ? { ok: true, error: `Restaurada, pero la auditoría falló: ${fallo}` } : { ok: true };
}

export async function marcarJugadaPagada(id: string | number, usuario: string): Promise<Resultado> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  try {
    exigirCapacidad("jugadas:fn_marcar_pagada");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const antes = await leerJugada(id);
  if (!antes) return { ok: false, error: "La jugada no existe." };
  if (antes.pagado_en) return { ok: false, error: "Esa jugada ya figura como pagada." };

  const { error } = await supabase
    .from("tickets_apuestas")
    .update({ pagado_en: new Date().toISOString(), pagado_por: usuario || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const fallo = await auditar(antes, id, "MARCAR_PAGADO", "Pago registrado desde el monitor", { antes }, null, usuario);
  return fallo ? { ok: true, error: `Pagada, pero la auditoría falló: ${fallo}` } : { ok: true };
}
