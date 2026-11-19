/**
 * Estructuración de las jugadas de la Sala con el MISMO pipeline de la Taquilla.
 *
 * El bot no inventa una fila: arma la línea hablada, la pasa por
 * `expandirLineasDobleSplit` + `normalizarLineaRapida` (catálogo real de
 * clientes y ejemplares de la carrera) y proyecta el lote en orden con
 * `proyectarFilasEnOrden` (saldo, aval, libre, tope y neteo de cruces).
 *
 * Módulo de servidor puro: no escribe; solo arma la carga que después se
 * registra con las condiciones de `club_vender_jugada`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandirLineasDobleSplit } from "@/features/taquilla/lib/expandirDobleSplit";
import {
  normalizarLineaRapida,
  type CaballoRef,
  type ClienteRef,
} from "@/features/taquilla/lib/normalizar";
import { parsearLineaRapida } from "@/features/taquilla/lib/validar";
import {
  proyectarFilasEnOrden,
  type ClienteConSaldo,
  type FilaDeCarga,
  type ProyeccionEnCurso,
} from "@/features/taquilla/lib/saldosEnCurso";
import type { JugadaActivaSimulacion } from "@/features/taquilla/lib/cruces-y-tapas";

export type ContextoEstructuraSala = {
  fecha: string;
  hipodromo: string;
  carrera: number;
  comisionPct: number;
  moneda: string;
  permiteCruces: boolean;
  clientes: ClienteConSaldo[];
  caballos: CaballoRef[];
  jugadasPreviasCarrera: JugadaActivaSimulacion[];
};

export type LineaEstructuradaSala = {
  linea: string;
  fila: FilaDeCarga;
  confianza?: Record<string, string>;
  correcciones: string[];
};

function limpiar(texto: unknown): string {
  return String(texto ?? "").replace(/\s+/g, " ").trim();
}

function norm(texto: unknown): string {
  return limpiar(texto).toLocaleUpperCase("es-VE");
}

function esBanca(texto: unknown): boolean {
  return ["", "BANCA", "CASA", "SISTEMA"].includes(norm(texto));
}

/** Resuelve un nombre del normalizador contra la fila real del cliente del grupo. */
export function resolverClienteSala(
  clientes: ClienteConSaldo[],
  texto: string
): ClienteConSaldo | null {
  const buscado = norm(texto);
  if (!buscado || esBanca(buscado)) return null;
  return (
    clientes.find((c) => norm(c.nombre) === buscado) ??
    clientes.find((c) => {
      const raw = c as ClienteConSaldo & { seudonimo?: string | null };
      return norm(raw.seudonimo) === buscado;
    }) ??
    null
  );
}

/** Catálogos y reglas vigentes de la sala, leídos con el cliente inyectado. */
export async function cargarContextoEstructuraSala(
  supabase: SupabaseClient,
  params: {
    grupoId: string;
    sala: Record<string, unknown>;
    fecha: string;
    hipodromo: string;
    carrera: number;
    comisionPct?: number | null;
    moneda?: string | null;
  }
): Promise<ContextoEstructuraSala> {
  const fecha = String(params.fecha || "").slice(0, 10);
  const hipodromo = limpiar(params.hipodromo).toLocaleUpperCase("es-VE") || "HIPODROMO";
  const carrera = Number(params.carrera) || 1;

  let comisionPct = Number(params.comisionPct);
  let moneda = limpiar(params.moneda).toLocaleUpperCase("es-VE");
  let permiteCruces = true;
  try {
    const { data: grp } = await supabase
      .from("grupos_venta")
      .select("comision_default, moneda, permite_cruces, cruce_mismo_ejemplar, cruce_diferente_ejemplar")
      .eq("id", params.grupoId)
      .maybeSingle();
    if (!Number.isFinite(comisionPct)) comisionPct = Number((grp as any)?.comision_default ?? 5);
    if (!moneda) moneda = limpiar((grp as any)?.moneda).toLocaleUpperCase("es-VE") || "USD";
    const mismo = (grp as any)?.cruce_mismo_ejemplar;
    const distinto = (grp as any)?.cruce_diferente_ejemplar;
    permiteCruces = (grp as any)?.permite_cruces !== false && (mismo !== false || distinto !== false);
  } catch {
    if (!Number.isFinite(comisionPct)) comisionPct = 5;
    if (!moneda) moneda = "USD";
  }

  let clientes: ClienteConSaldo[] = [];
  try {
    const { data } = await supabase
      .from("clientes")
      .select("id, nombre, seudonimo, saldo_actual, aval, libre, modo_juego, grupo_id")
      .eq("grupo_id", params.grupoId)
      .limit(500);
    clientes = ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
      ...(c as unknown as ClienteConSaldo),
      id: String(c.id),
      nombre: limpiar(c.nombre || c.seudonimo),
    })) as Array<ClienteConSaldo & { seudonimo?: string | null }>;
  } catch {
    clientes = [];
  }

  let caballos: CaballoRef[] = [];
  try {
    let query = supabase
      .from("carreras")
      .select("id, caballos, retirados")
      .eq("fecha", fecha)
      .eq("carrera", carrera)
      .ilike("hipodromo", hipodromo);
    const carreraId = limpiar((params.sala as any)?.carrera_activa_id);
    if (carreraId) {
      const { data: porId } = await supabase
        .from("carreras")
        .select("id, caballos, retirados")
        .eq("id", carreraId)
        .maybeSingle();
      if (porId) {
        query = supabase.from("carreras").select("id, caballos, retirados").eq("id", carreraId);
      }
    }
    const { data: carreraRow } = await query.limit(1).maybeSingle();
    const retirados = new Set(
      Array.isArray((carreraRow as any)?.retirados)
        ? (carreraRow as any).retirados.map((x: unknown) => String(x).trim()).filter(Boolean)
        : Array.isArray((params.sala as any)?.retirados)
        ? (params.sala as any).retirados.map((x: unknown) => String(x).trim()).filter(Boolean)
        : []
    );
    const lista = Array.isArray((carreraRow as any)?.caballos) ? (carreraRow as any).caballos : [];
    caballos = lista
      .map((c: any) => ({
        numero: String(c?.numero ?? "").trim(),
        nombre: limpiar(c?.nombre),
      }))
      .filter((c: CaballoRef) => c.numero && !retirados.has(String(c.numero)));
  } catch {
    caballos = [];
  }

  let jugadasPreviasCarrera: JugadaActivaSimulacion[] = [];
  try {
    const { data: previas } = await supabase
      .from("tickets_apuestas")
      .select("id, nombre_jugada, caballo, monto_jugado, estado, anulada, es_adelantada, cliente_juega_nombre, cliente_consigue_nombre, nota_auditoria")
      .eq("fecha_carrera", fecha)
      .eq("carrera", carrera)
      .ilike("hipodromo", hipodromo)
      .limit(300);
    jugadasPreviasCarrera = ((previas ?? []) as Array<Record<string, unknown>>)
      .filter((t) => !t.anulada && !t.es_adelantada && !/^(ANULADA|RETIRADO)/i.test(String(t.estado ?? "")))
      .map((t) => ({
        id: String(t.id),
        jugador: limpiar(t.cliente_juega_nombre) || "JUGADOR",
        tercio: limpiar(t.cliente_consigue_nombre),
        jugada: limpiar(t.nombre_jugada),
        caballo: limpiar(t.caballo),
        monto: Number(t.monto_jugado) || 0,
        estado: String(t.estado ?? ""),
        nota_auditoria: t.nota_auditoria,
      }));
  } catch {
    jugadasPreviasCarrera = [];
  }

  return {
    fecha,
    hipodromo,
    carrera,
    comisionPct: Number.isFinite(comisionPct) ? comisionPct : 5,
    moneda: moneda || "USD",
    permiteCruces,
    clientes,
    caballos,
    jugadasPreviasCarrera,
  };
}

/** Pasa una línea hablada por el normalizador de Carga Rápida de la Taquilla. */
export function estructurarLineasSala(
  lineas: string[],
  ctx: ContextoEstructuraSala
): LineaEstructuradaSala[] {
  const expandidas = expandirLineasDobleSplit(lineas.map((l) => String(l ?? "")));
  const crudas = expandidas.length > 0 ? expandidas.map((e) => e.linea) : lineas.map((l) => String(l ?? ""));
  const catalogo: { clientes: ClienteRef[]; caballos?: CaballoRef[] } = {
    clientes: ctx.clientes.map((c) => ({ nombre: limpiar(c.nombre) })).filter((c) => c.nombre),
    caballos: ctx.caballos,
  };
  const out: LineaEstructuradaSala[] = [];

  for (const linea of crudas) {
    const limpia = limpiar(linea);
    if (!limpia || limpia.startsWith("#")) continue;
    let fila: FilaDeCarga | null = null;
    let confianza: Record<string, string> | undefined;
    let correcciones: string[] = [];

    const normalizado = normalizarLineaRapida(limpia, catalogo);
    if (normalizado && normalizado.ok) {
      fila = {
        jugada: normalizado.jugada,
        caballo: normalizado.caballo,
        monto: normalizado.monto,
        cliente1: normalizado.cliente1,
        cliente2: normalizado.cliente2,
      };
      confianza = normalizado.confianza as unknown as Record<string, string>;
      correcciones = normalizado.correcciones;
    } else {
      const legacy = parsearLineaRapida(limpia);
      if (legacy && legacy.ok) {
        fila = {
          jugada: legacy.jugada,
          caballo: legacy.caballo,
          monto: legacy.monto,
          cliente1: legacy.cliente1,
          cliente2: legacy.cliente2,
        };
        correcciones = [normalizado && !normalizado.ok ? normalizado.motivo : ""];
      }
    }
    if (fila) {
      out.push({
        linea: limpia,
        fila,
        confianza,
        correcciones: correcciones.filter(Boolean),
      });
    }
  }
  return out;
}

/** Fila canónica derivada de un ticket de la Sala, con la misma carga que la Taquilla. */
export function estructuraDesdeTicketSala(
  datos: {
    clienteJuega: string;
    clienteDa: string;
    jugada: string;
    caballo: string;
    monto: number;
  },
  ctx: ContextoEstructuraSala
): LineaEstructuradaSala | null {
  const jugador = limpiar(datos.clienteJuega) || "JUGADOR";
  const dador = esBanca(datos.clienteDa) ? "CASA" : limpiar(datos.clienteDa);
  const jugada = limpiar(datos.jugada).toLocaleUpperCase("es-VE") || "1P";
  const caballo = limpiar(datos.caballo);
  const monto = String(Number(datos.monto) || 0);
  const linea = `${jugador} ${jugada} ${caballo} ${dador} ${monto}`.replace(/\s+/g, " ").trim();

  const estructuradas = estructurarLineasSala([linea], ctx);
  if (estructuradas.length === 1) {
    const e = estructuradas[0];
    return {
      ...e,
      fila: {
        ...e.fila,
        jugada: e.fila.jugada || jugada,
        caballo: e.fila.caballo || caballo,
        monto: e.fila.monto || monto,
        cliente1: resolverClienteSala(ctx.clientes, e.fila.cliente1)?.nombre ?? jugador,
        cliente2: esBanca(e.fila.cliente2) ? "CASA" : resolverClienteSala(ctx.clientes, e.fila.cliente2)?.nombre ?? dador,
      },
    };
  }

  if (!caballo || !/\d/.test(caballo)) return null;
  return {
    linea,
    fila: {
      jugada,
      caballo,
      monto,
      cliente1: resolverClienteSala(ctx.clientes, jugador)?.nombre ?? jugador,
      cliente2: esBanca(dador) ? "CASA" : resolverClienteSala(ctx.clientes, dador)?.nombre ?? dador,
    },
    correcciones: [],
  };
}

/** Proyección en orden con saldo, aval, libre y neteo de cruces de la Taquilla. */
export function proyectarCargaSala(
  filas: FilaDeCarga[],
  ctx: ContextoEstructuraSala
): ProyeccionEnCurso<ClienteConSaldo>[] {
  return proyectarFilasEnOrden(
    filas,
    (texto) => resolverClienteSala(ctx.clientes, texto),
    ctx.comisionPct,
    {
      permiteCruces: ctx.permiteCruces,
      jugadasPreviasCarrera: ctx.jugadasPreviasCarrera,
    }
  );
}
