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
import {
  resolverContraparteModalidad,
  USUARIOS_SISTEMA_MODALIDADES,
} from "@/features/liquidacion/lib/etiquetas-reporte";

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
  fecha_carrera?: string | null;
  fecha_registro?: string | null;
  anulada?: boolean | null;
  anulada_motivo?: string | null;
  anulada_por?: string | null;
  anulada_at?: string | null;
  pagado_en?: string | null;
  pagado_por?: string | null;
  es_adelantada?: boolean | null;
  cantidad_tablas?: number | null;
  premio_por_tabla?: number | null;
  pts_ejemplar?: number | null;
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
  hipodromo?: string | null;
  carrera?: number | null;
  fecha_carrera?: string | null;
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
  comision_porcentaje?: number | null;
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
  "Cambio de carrera o modalidad de jugada",
  "Ajuste de condición / puestos acordados",
  "Solicitud o reclamo de jugador verificado",
  "Anulación solicitada antes de la partida",
  "Otro (introducir libremente)",
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
  const directa = texto(j.fecha_carrera).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(directa)) return directa;
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
  return [...mapa.values()].sort((a, b) => {
    const fh = (b.fecha_carrera ?? "").localeCompare(a.fecha_carrera ?? "");
    if (fh !== 0) return fh;
    const cmpHip = a.hipodromo.localeCompare(b.hipodromo, "es");
    if (cmpHip !== 0) return cmpHip;
    return Number(a.carrera) - Number(b.carrera);
  });
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
    if (jugadas.length > 0) {
      try {
        const ids = jugadas.map((j) => j.id).filter(Boolean);
        const { data: extras } = await sb
          .from("tickets_apuestas")
          .select(
            "id, hipodromo, carrera, fecha_carrera, es_adelantada, cliente_juega_id, cliente_juega_nombre, cliente_consigue_nombre, anulada, cantidad_tablas, premio_por_tabla, pts_ejemplar, nota_auditoria"
          )
          .in("id", ids as never[]);
        if (Array.isArray(extras) && extras.length > 0) {
          const mapaExtras = new Map<string, Record<string, unknown>>();
          for (const ex of extras) {
            const row = ex as Record<string, unknown>;
            mapaExtras.set(String(row.id ?? ""), row);
          }
          jugadas = jugadas.map((j) => {
            const ex = mapaExtras.get(String(j.id));
            const notaJ = leerNotaAuditoria(ex?.nota_auditoria ?? j.nota_auditoria);
            const nombreJuegaDirecto =
              texto(ex?.cliente_juega_nombre) ||
              texto(j.cliente_juega_nombre) ||
              texto(notaJ.cliente_nombre) ||
              texto(notaJ.jugador);
            const contraparteCanonica = resolverContraparteModalidad(
              j.nombre_jugada,
              texto(ex?.cliente_consigue_nombre) || j.cliente_consigue_nombre,
              origenDeJugada(j) || texto(notaJ.origen)
            );
            const base = {
              ...j,
              hipodromo: texto(ex?.hipodromo) || j.hipodromo,
              carrera: ex?.carrera != null ? num(ex.carrera) : num(j.carrera),
              fecha_carrera: texto(ex?.fecha_carrera).slice(0, 10) || j.fecha_carrera || null,
              cliente_juega_nombre: nombreJuegaDirecto || j.cliente_juega_nombre,
              cliente_consigue_nombre: contraparteCanonica || j.cliente_consigue_nombre,
            };
            if (!ex) return base;
            return {
              ...base,
              es_adelantada:
                typeof ex.es_adelantada === "boolean"
                  ? ex.es_adelantada
                  : j.es_adelantada ?? Boolean(notaJ.es_adelantada),
              cliente_juega_id: (ex.cliente_juega_id as string | number | null | undefined) ?? j.cliente_juega_id ?? null,
              anulada: typeof ex.anulada === "boolean" ? ex.anulada : Boolean(j.anulada),
              cantidad_tablas: ex.cantidad_tablas != null ? num(ex.cantidad_tablas) : j.cantidad_tablas ?? null,
              premio_por_tabla: ex.premio_por_tabla != null ? num(ex.premio_por_tabla) : j.premio_por_tabla ?? null,
              pts_ejemplar: ex.pts_ejemplar != null ? num(ex.pts_ejemplar) : j.pts_ejemplar ?? null,
            };
          });
        }
      } catch {
        // Si la tabla no tiene `es_adelantada`, se conserva el respaldo por `nota_auditoria`.
      }
      // Si algún ticket tiene cliente_juega_id pero le falta cliente_juega_nombre, resolver desde clientes
      const idsSinNombre = [
        ...new Set(
          jugadas
            .filter((j) => !texto(j.cliente_juega_nombre) && j.cliente_juega_id != null)
            .map((j) => String(j.cliente_juega_id))
        ),
      ];
      if (idsSinNombre.length > 0) {
        try {
          const { data: cliRows } = await sb
            .from("clientes")
            .select("id, nombre")
            .in("id", idsSinNombre as never[]);
          if (Array.isArray(cliRows) && cliRows.length > 0) {
            const mapaCli = new Map<string, string>();
            for (const c of cliRows as Array<{ id?: unknown; nombre?: unknown }>) {
              if (c.id != null && texto(c.nombre)) {
                mapaCli.set(String(c.id), texto(c.nombre));
              }
            }
            jugadas = jugadas.map((j) => {
              if (!texto(j.cliente_juega_nombre) && j.cliente_juega_id != null) {
                const resuelto = mapaCli.get(String(j.cliente_juega_id));
                if (resuelto) return { ...j, cliente_juega_nombre: resuelto };
              }
              return j;
            });
          }
        } catch {
          /* best-effort */
        }
      }
      // Normalizar contraparte para modalidades del sistema (MARCAS, TF, REMATES, DUPLETA, POLLAS)
      // y corregir en segundo plano cualquier fila heredada en BD que tuviera otro nombre (ej. SAM)
      // o que hubiera quedado con `estado = "Anulada"` sin anulación administrativa.
      const porCorregirEnBd: Array<{ id: string; contraparte: string }> = [];
      const idsEstadoMalAnulada: string[] = [];
      const idsSincronizarAnulada: string[] = [];
      jugadas = jugadas.map((j) => {
        const anuladaAdmin =
          Boolean(j.anulada) ||
          Boolean(j.anulada_at) ||
          Boolean(j.anulada_motivo);
        if (anuladaAdmin && (!j.anulada || !texto(j.estado).toLowerCase().startsWith("anul")) && j.id != null) {
          idsSincronizarAnulada.push(String(j.id));
        }
        const esFalsaAnulada =
          !anuladaAdmin &&
          (texto(j.estado).toUpperCase() === "ANULADA" || texto(j.estado).toUpperCase() === "ANULADO");
        if (esFalsaAnulada && j.id != null) {
          idsEstadoMalAnulada.push(String(j.id));
        }
        const contraparteCanonica = resolverContraparteModalidad(
          j.nombre_jugada,
          j.cliente_consigue_nombre,
          origenDeJugada(j)
        );
        if (
          (USUARIOS_SISTEMA_MODALIDADES as readonly string[]).includes(contraparteCanonica) &&
          texto(j.cliente_consigue_nombre).toUpperCase() !== contraparteCanonica
        ) {
          porCorregirEnBd.push({ id: String(j.id), contraparte: contraparteCanonica });
        }
        return {
          ...j,
          ...(anuladaAdmin ? { anulada: true, estado: "Anulada" } : {}),
          ...(esFalsaAnulada ? { estado: "Perdedor" } : {}),
          cliente_consigue_nombre: contraparteCanonica || j.cliente_consigue_nombre,
        };
      });
      if (idsSincronizarAnulada.length > 0) {
        void Promise.resolve(
          sb
            .from("tickets_apuestas")
            .update({ anulada: true, estado: "Anulada", premio_pagar: 0, monto_decidido: 0 })
            .in("id", idsSincronizarAnulada)
        ).catch(() => {});
      }
      if (idsEstadoMalAnulada.length > 0) {
        void Promise.resolve(
          sb
            .from("tickets_apuestas")
            .update({ estado: "Perdedor" })
            .in("id", idsEstadoMalAnulada)
        ).catch(() => {});
      }
      if (porCorregirEnBd.length > 0) {
        void Promise.all(
          porCorregirEnBd.map(({ id, contraparte }) =>
            sb
              .from("tickets_apuestas")
              .update({
                cliente_consigue_nombre: contraparte,
                banquero_nombre: contraparte,
                cliente_consigue_id: null,
                banquero_cliente_id: null,
              })
              .eq("id", id)
          )
        ).catch(() => {});
      }
    }
    const carreraNum = num(carrera);
    const hipoBuscado = texto(hipodromo).toUpperCase().replace(/\s+/g, "");
    jugadas = jugadas.filter((j) => {
      if (num(j.carrera) !== carreraNum) return false;
      const hipoFila = texto(j.hipodromo).toUpperCase().replace(/\s+/g, "");
      if (hipoBuscado && hipoFila && hipoFila !== hipoBuscado) return false;
      // Si el nombre de la jugada tiene explícitamente otra carrera (ej. "TABLA FIJA (LA RINCONADA C3)" en C1), excluirla
      const mCarreraNombre = /\bC(\d{1,2})\b/i.exec(texto(j.nombre_jugada));
      if (mCarreraNombre && Number(mCarreraNombre[1]) !== carreraNum) return false;
      if (fecha && (fechaCarreraDeJugada(j) ?? "") !== String(fecha).slice(0, 10)) return false;
      return true;
    });
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

  // Condición sine qua non: toda jugada debe conservar un ejemplar válido.
  // Puede estar identificado por número (ejemplar_numero), por caballo (número o nombre), o ambos.
  const numFinal =
    payload.ejemplar_numero !== undefined
      ? payload.ejemplar_numero
      : antes.ejemplar_numero;
  const numStr = numFinal != null ? String(numFinal).trim() : "";
  const tieneNumeroValido = numStr !== "" && /\d/.test(numStr) && Number(numStr) > 0;

  const cabFinal = String(
    payload.caballo !== undefined
      ? (payload.caballo ?? "")
      : (antes.caballo ?? "")
  ).trim();
  const tieneCaballoValido = cabFinal !== "" && (/\d/.test(cabFinal) || cabFinal.length >= 2 || tieneNumeroValido);

  if (!tieneNumeroValido && !tieneCaballoValido) {
    return {
      ok: false,
      error: "⚠️ No puede guardarse una jugada sin ejemplar (condición sine qua non).",
    };
  }

  // Si tiene número válido y caballo está vacío, asegurar que caballo guarde el número
  if (tieneNumeroValido && (!payload.caballo || String(payload.caballo).trim() === "")) {
    payload.caballo = numStr;
  }
  // Si tiene caballo con dígitos y ejemplar_numero no vino en el payload, derivarlo
  if (payload.ejemplar_numero === undefined && cabFinal) {
    const m = cabFinal.match(/\b\d+\b/);
    if (m) payload.ejemplar_numero = Number(m[0]);
  }

  // Sincronizar nota_auditoria si cambia fecha_carrera o es_adelantada
  if ("fecha_carrera" in payload || "es_adelantada" in payload) {
    const notaObj = { ...leerNotaAuditoria(antes.nota_auditoria) };
    if ("fecha_carrera" in payload && payload.fecha_carrera) {
      notaObj.fecha_carrera = String(payload.fecha_carrera).slice(0, 10);
    }
    if ("es_adelantada" in payload) {
      notaObj.es_adelantada = Boolean(payload.es_adelantada);
    }
    payload.nota_auditoria = JSON.stringify(notaObj);
  }

  // Resolver IDs de clientes si se modificó cliente_juega_nombre o cliente_consigue_nombre sin pasar el ID
  if ("cliente_juega_nombre" in payload && !("cliente_juega_id" in payload) && payload.cliente_juega_nombre) {
    try {
      const { data: cJuega } = await supabase
        .from("clientes")
        .select("id, nombre")
        .ilike("nombre", String(payload.cliente_juega_nombre).trim())
        .limit(1)
        .maybeSingle();
      if (cJuega?.id != null) {
        payload.cliente_juega_id = String(cJuega.id);
      }
    } catch {
      /* ignore */
    }
  }


  if ("cliente_consigue_nombre" in payload && !("cliente_consigue_id" in payload) && payload.cliente_consigue_nombre) {
    try {
      const { data: cDa } = await supabase
        .from("clientes")
        .select("id, nombre")
        .ilike("nombre", String(payload.cliente_consigue_nombre).trim())
        .limit(1)
        .maybeSingle();
      if (cDa?.id != null) {
        payload.cliente_consigue_id = String(cDa.id);
      }
    } catch {
      /* ignore */
    }
  }

  // Sincronizar columnas de grupo si cambia grupo_cobro_nombre o grupo_cobro_id
  if ("grupo_cobro_nombre" in payload && payload.grupo_cobro_nombre) {
    if (!("grupo" in payload)) payload.grupo = payload.grupo_cobro_nombre;
    if (!("grupo_comision_nombre" in payload)) payload.grupo_comision_nombre = payload.grupo_cobro_nombre;
  }
  if ("grupo_cobro_id" in payload && payload.grupo_cobro_id) {
    if (!("grupo_comision_id" in payload)) payload.grupo_comision_id = payload.grupo_cobro_id;
  }

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

  let { error } = await supabase.from("tickets_apuestas").update(payload).eq("id", id);
  if (error && /(fecha_carrera|es_adelantada|banquero_nombre|does not exist|42703)/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    const copia = { ...payload };
    delete copia.fecha_carrera;
    delete copia.es_adelantada;
    delete copia.banquero_nombre;
    const rFallback = await supabase.from("tickets_apuestas").update(copia).eq("id", id);
    error = rFallback.error;
  }
  if (error) return { ok: false, error: error.message };

  // Ajustar el saldo por el stake (monto_jugado) si cambió el monto o cambió el Jugador 1 (cliente_juega_id)
  if (!antes.anulada) {
    const montoViejo = num(antes.monto_jugado);
    const montoNuevo = payload.monto_jugado !== undefined ? num(payload.monto_jugado) : montoViejo;
    const idViejo = antes.cliente_juega_id != null ? String(antes.cliente_juega_id).trim() : "";
    const idNuevo =
      payload.cliente_juega_id !== undefined
        ? String(payload.cliente_juega_id ?? "").trim()
        : idViejo;

    try {
      if (idViejo && idNuevo && idViejo === idNuevo) {
        const diff = montoNuevo - montoViejo;
        if (Math.abs(diff) >= 0.01) {
          const { data: cli } = await supabase
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idViejo as never)
            .maybeSingle();
          if (cli) {
            const actual = num((cli as Record<string, unknown>).saldo_actual);
            await supabase
              .from("clientes")
              .update({ saldo_actual: actual - diff })
              .eq("id", idViejo as never);
          }
        }
      } else {
        if (idViejo && montoViejo > 0) {
          const { data: cliV } = await supabase
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idViejo as never)
            .maybeSingle();
          if (cliV) {
            const actualV = num((cliV as Record<string, unknown>).saldo_actual);
            await supabase
              .from("clientes")
              .update({ saldo_actual: actualV + montoViejo })
              .eq("id", idViejo as never);
          }
        }
        if (idNuevo && montoNuevo > 0) {
          const { data: cliN } = await supabase
            .from("clientes")
            .select("saldo_actual")
            .eq("id", idNuevo as never)
            .maybeSingle();
          if (cliN) {
            const actualN = num((cliN as Record<string, unknown>).saldo_actual);
            await supabase
              .from("clientes")
              .update({ saldo_actual: actualN - montoNuevo })
              .eq("id", idNuevo as never);
          }
        }
      }
    } catch {
      /* best-effort en ajuste de stake */
    }
  }

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
  const yaEstabaAnulada =
    Boolean(antes.anulada) ||
    Boolean(antes.anulada_at) ||
    Boolean(antes.anulada_motivo) ||
    (texto(antes.estado).toLowerCase().startsWith("anul") && num(antes.premio_pagar) <= 0);
  if (yaEstabaAnulada) {
    // Idempotente: si la jugada ya estaba anulada en BD (pero seguía visible en alguna vista),
    // aseguramos que `anulada = true` y `estado = "Anulada"` queden sincronizados sin duplicar el reembolso.
    await supabase
      .from("tickets_apuestas")
      .update({
        anulada: true,
        estado: "Anulada",
        premio_pagar: 0,
        monto_decidido: 0,
        anulada_motivo: antes.anulada_motivo || motivo.trim(),
        anulada_por: antes.anulada_por || usuario || null,
        anulada_at: antes.anulada_at || new Date().toISOString(),
      })
      .eq("id", id);
    return { ok: true };
  }

  let yaReembolsoRpc = false;
  if (texto(antes.estado) === "Pendiente" && /^\d+$/.test(String(id).trim())) {
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("club_anular_jugada", {
        p_ticket_id: Number(id),
        p_usuario: usuario || null,
        p_motivo: motivo.trim(),
      });
      if (!rpcErr && (rpcData as Record<string, unknown> | null)?.ok) {
        yaReembolsoRpc = true;
      }
    } catch {
      /* fallback a update directo */
    }
  }

  let { error } = await supabase
    .from("tickets_apuestas")
    .update({
      anulada: true,
      estado: "Anulada",
      premio_pagar: 0,
      monto_decidido: 0,
      anulada_motivo: motivo.trim(),
      anulada_por: usuario || null,
      anulada_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error && /(anulada_motivo|anulada_por|anulada_at|does not exist|42703)/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    const rFallback = await supabase
      .from("tickets_apuestas")
      .update({ anulada: true, estado: "Anulada", premio_pagar: 0, monto_decidido: 0 })
      .eq("id", id);
    error = rFallback.error;
  }
  if (error && !yaReembolsoRpc) return { ok: false, error: error.message };

  // Reintegrar el monto apostado al saldo_actual del cliente que jugó (la venta lo debitó al cargar),
  // salvo que ya lo haya reintegrado la RPC `club_anular_jugada` o el retiro previo (`estado = "Retirado"`).
  const montoJugado = num(antes.monto_jugado);
  const clienteJuegaId = antes.cliente_juega_id;
  const yaReembolsadoPorRetiro = texto(antes.estado).toLowerCase() === "retirado";
  if (!yaReembolsoRpc && !yaReembolsadoPorRetiro && montoJugado > 0 && clienteJuegaId != null && String(clienteJuegaId).trim() !== "") {
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

  const estadoRestaurado = texto(antes.estado).toLowerCase().startsWith("anul") ? "Pendiente" : (antes.estado ?? "Pendiente");
  let { error } = await supabase
    .from("tickets_apuestas")
    .update({ anulada: false, estado: estadoRestaurado, anulada_motivo: null, anulada_por: null, anulada_at: null })
    .eq("id", id);
  if (error && /(anulada_motivo|anulada_por|anulada_at|does not exist|42703)/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    const rFallback = await supabase
      .from("tickets_apuestas")
      .update({ anulada: false, estado: estadoRestaurado })
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
