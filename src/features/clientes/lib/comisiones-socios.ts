/**
 * ============================================================================
 * SERVICIO: Comisiones de Socios por Clientes y Devoluciones de Jugadas
 * ============================================================================
 * Maneja los dos parámetros independientes:
 *   1. Devolución al cliente por sí mismo (clientes.devolucion, ej. 1.00%, 1.25%, 1.50%).
 *   2. Comisión / Devolución que el socio devenga por cada uno de sus clientes
 *      afiliados (clientes.comision_socio_pct), calculada a partir de una fecha
 *      configurable (clientes.fecha_inicio_comision_socio).
 *
 * Regla contable: Se imputa en el saldo del socio a favor, no altera el cobro/pago
 * del ticket nominal, y se refleja segmentado en su reporte individual con desglose.
 */

import { supabase } from "@/core/supabase";

export interface ReglaDevolucionCliente {
  nombre: string;
  devolucionPropiaPct: number;
  esSocio?: boolean;
  socioAsignado?: string | null;
  comisionSocioPct?: number | null;
  fechaInicioComision?: string; // YYYY-MM-DD
}

/** Forma mínima de un cliente para resolver la relación «socio_asignado». */
export type ClienteSocioLike = {
  id?: string | number | null;
  nombre?: string | null;
  seudonimo?: string | null;
  es_socio?: boolean | null;
  socio_asignado?: string | null;
  devolucion?: number | string | null;
  comision_socio_pct?: number | string | null;
  fecha_inicio_comision_socio?: string | null;
};

/** Referencia de socio tolerante a id, nombre y seudónimo. */
export type SocioRefLike = {
  id?: string | number | null;
  nombre?: string | null;
  seudonimo?: string | null;
};

/**
 * Parámetros predeterminados oficiales establecidos para la semana (2026-10-29 a 2026-10-30 y vigentes)
 */
export const PARAMETROS_PREDETERMINADOS_DEVOLUCION: ReglaDevolucionCliente[] = [
  // ARRAEZ: devolución de 1% por sí mismo
  { nombre: "ARRAEZ", devolucionPropiaPct: 1.00 },

  // EDDIE: 1.25% por sí mismo, 1.25% por GAETANO, 1.00% por RUCIO
  { nombre: "EDDIE", devolucionPropiaPct: 1.25, esSocio: true },
  { nombre: "GAETANO", devolucionPropiaPct: 1.25, socioAsignado: "EDDIE", comisionSocioPct: 1.25, fechaInicioComision: "2026-10-29" },
  { nombre: "RUCIO", devolucionPropiaPct: 1.00, socioAsignado: "EDDIE", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },

  // FORTUNA: 1.00% por sí mismo
  { nombre: "FORTUNA", devolucionPropiaPct: 1.00 },

  // INFANTINO: 1.00% por sí mismo
  { nombre: "INFANTINO", devolucionPropiaPct: 1.00 },

  // MEMPHIS: 1.00% por sí mismo, 1.00% por NEWCASTLE
  { nombre: "MEMPHIS", devolucionPropiaPct: 1.00, esSocio: true },
  { nombre: "NEWCASTLE", devolucionPropiaPct: 1.00, socioAsignado: "MEMPHIS", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },

  // PARTNER: 1.50% por sí mismo, 1.00% por ARELY, 1.00% por AYARI, 1.25% por BG, 1.00% por ROCA
  { nombre: "PARTNER", devolucionPropiaPct: 1.50, esSocio: true },
  { nombre: "ARELY", devolucionPropiaPct: 1.00, socioAsignado: "PARTNER", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },
  { nombre: "AYARI", devolucionPropiaPct: 1.00, socioAsignado: "PARTNER", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },
  { nombre: "BG", devolucionPropiaPct: 1.25, socioAsignado: "PARTNER", comisionSocioPct: 1.25, fechaInicioComision: "2026-10-29" },
  { nombre: "ROCA", devolucionPropiaPct: 1.00, socioAsignado: "PARTNER", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },

  // RUSSO: 1.00% por sí mismo
  { nombre: "RUSSO", devolucionPropiaPct: 1.00 },

  // SAM: 1.50% por sí mismo
  { nombre: "SAM", devolucionPropiaPct: 1.50 },

  // THOR: 1.00% por sí mismo, 1.00% por SPEEDY
  { nombre: "THOR", devolucionPropiaPct: 1.00, esSocio: true },
  { nombre: "SPEEDY", devolucionPropiaPct: 1.00, socioAsignado: "THOR", comisionSocioPct: 1.00, fechaInicioComision: "2026-10-29" },
];

export interface DetalleJugadaComisionSocio {
  id: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  nombreJugada?: string;
  caballo?: string;
  montoJugado: number;
  comisionPct: number;
  montoComision: number;
  estado?: string;
}

export interface ComisionClienteParaSocio {
  clienteId?: string | number;
  clienteNombre: string;
  comisionPct: number;
  totalJugado: number;
  totalComision: number;
  fechaInicio: string;
  jugadas: DetalleJugadaComisionSocio[];
}

export interface ResumenComisionesSocio {
  socioNombre: string;
  devolucionPropiaPct: number;
  totalDevolucionPropia: number;
  totalComisionesClientes: number;
  totalGeneralDevoluciones: number;
  desglosePorCliente: ComisionClienteParaSocio[];
}

export interface ItemReporteDestinatario {
  socio: string;
  devolucionPropiaPct: number;
  totalDevolucionPropia: number;
  clientes: Array<{
    cliente: string;
    pct: number;
    totalJugado: number;
    comisionSocio: number;
    jugadasCount: number;
    jugadas: DetalleJugadaComisionSocio[];
  }>;
  totalSocio: number;
}

export interface ReporteDestinatariosDevolucionData {
  fechaDesde: string;
  fechaHasta: string;
  items: ItemReporteDestinatario[];
  granTotalDevolucionPropia: number;
  granTotalComisionesSocios: number;
  granTotal: number;
}

function normalizar(s?: string | null): string {
  if (!s) return "";
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolverSocioRef(
  socioNombre: string,
  socioId: string | number | null | undefined,
  clientes: ClienteSocioLike[]
): SocioRefLike {
  const norm = normalizar(socioNombre);
  const porId =
    socioId != null
      ? clientes.find((c) => String(c.id ?? "") === String(socioId))
      : undefined;
  const porNombre = clientes.find(
    (c) =>
      normalizar(c.nombre) === norm ||
      normalizar(c.seudonimo) === norm
  );
  const ref = porId ?? porNombre;
  return {
    id: ref?.id ?? socioId ?? undefined,
    nombre: ref?.nombre ?? socioNombre,
    seudonimo: ref?.seudonimo ?? socioNombre,
  };
}

/**
 * Determina si un cliente pertenece/está afiliado a un socio.
 *
 * `clientes.socio_asignado` históricamente guardó el NOMBRE, pero el valor
 * canónico actual es el **ID** del socio (`valorSocioAsignado`). Esta función
 * acepta ambos para que la comisión no se pierda al migrar los datos.
 */
export function esClienteAfiliadoAlSocio(
  cliente: Pick<ClienteSocioLike, "id" | "socio_asignado"> | null | undefined,
  socio: SocioRefLike | null | undefined,
  clientesParaResolver: ClienteSocioLike[] = []
): boolean {
  const valor = String(cliente?.socio_asignado ?? "").trim();
  if (!valor || !socio) return false;

  if (socio.id != null && valor === String(socio.id)) return true;

  const aliasSocio = new Set(
    [socio.nombre, socio.seudonimo].map(normalizar).filter(Boolean)
  );
  if (aliasSocio.has(normalizar(valor))) return true;

  // Si `socio_asignado` guarda el ID, resolvemos ese cliente y comparamos
  // sus nombres/seudónimos con los del socio.
  const referencia = clientesParaResolver.find((c) => String(c.id ?? "") === valor);
  if (referencia) {
    const aliasReferencia = [referencia.nombre, referencia.seudonimo]
      .map(normalizar)
      .filter(Boolean);
    if (aliasReferencia.some((n) => aliasSocio.has(n))) return true;
  }

  return false;
}

/**
 * Obtiene la regla predeterminada o configurada para un cliente
 */
export function buscarReglaDevolucionCliente(nombre: string): ReglaDevolucionCliente | undefined {
  const norm = normalizar(nombre);
  return PARAMETROS_PREDETERMINADOS_DEVOLUCION.find((r) => normalizar(r.nombre) === norm);
}

/**
 * Calcula todas las comisiones devengadas por un socio por jugadas de sus clientes afiliados
 */
export function calcularComisionesSocioPorClientes(params: {
  socioNombre: string;
  /** ID canónico del socio (recomendado). Permite resolver afiliados guardados por ID. */
  socioId?: string | number | null;
  fechaDesde?: string;
  fechaHasta?: string;
  tickets?: any[];
  clientes?: ClienteSocioLike[];
}): ResumenComisionesSocio {
  const socioNorm = normalizar(params.socioNombre);
  const tickets = params.tickets || [];
  const clientes = params.clientes || [];
  const socioRef = resolverSocioRef(params.socioNombre, params.socioId, clientes);

  // Buscar todos los clientes que tienen a este socio asignado
  const clientesAfiliados: Array<{
    id?: string | number;
    nombre: string;
    comisionPct: number;
    fechaInicio: string;
  }> = [];

  // Primero de la lista viva de clientes
  for (const c of clientes) {
    if (esClienteAfiliadoAlSocio(c, socioRef, clientes)) {
      const nom = c.seudonimo || c.nombre || "";
      const regla = buscarReglaDevolucionCliente(nom);
      const comPct = Number(c.comision_socio_pct ?? regla?.comisionSocioPct ?? 1.00);
      const fIni = c.fecha_inicio_comision_socio || regla?.fechaInicioComision || "2026-10-29";
      clientesAfiliados.push({
        id: c.id ?? undefined,
        nombre: nom,
        comisionPct: comPct,
        fechaInicio: fIni,
      });
    }
  }

  // Si no vinieron en la lista viva, tomar de los parámetros predeterminados
  const nombresSocio = new Set(
    [socioRef.nombre, socioRef.seudonimo, params.socioNombre].map(normalizar).filter(Boolean)
  );
  for (const r of PARAMETROS_PREDETERMINADOS_DEVOLUCION) {
    if (nombresSocio.has(normalizar(r.socioAsignado))) {
      if (!clientesAfiliados.some((ca) => normalizar(ca.nombre) === normalizar(r.nombre))) {
        clientesAfiliados.push({
          nombre: r.nombre,
          comisionPct: r.comisionSocioPct ?? 1.00,
          fechaInicio: r.fechaInicioComision || "2026-10-29",
        });
      }
    }
  }

  // Devolución propia del socio
  const socioRegla = buscarReglaDevolucionCliente(params.socioNombre);
  const socioClienteObj =
    (params.socioId != null
      ? clientes.find((c) => String(c.id ?? "") === String(params.socioId))
      : undefined) ??
    clientes.find(
      (c) => normalizar(c.seudonimo) === socioNorm || normalizar(c.nombre) === socioNorm
    );
  const devPropiaPct = Number(socioClienteObj?.devolucion ?? socioRegla?.devolucionPropiaPct ?? 1.00);

  // Calcular jugadas propias del socio para su devolución propia
  let montoJugadoPropio = 0;
  for (const t of tickets) {
    if (t.anulada) continue;
    const tCli = normalizar(t.cliente_juega_nombre || t.clienteJuega || t.cliente_nombre);
    const fechaT = String(t.fecha_carrera || t.fecha || "").slice(0, 10);
    if (tCli === socioNorm) {
      if (params.fechaDesde && fechaT < params.fechaDesde) continue;
      if (params.fechaHasta && fechaT > params.fechaHasta) continue;
      const m = Number(t.monto_jugado ?? t.monto ?? t.monto_decidido ?? 0);
      montoJugadoPropio += m;
    }
  }
  const totalDevPropia = Math.round(montoJugadoPropio * (devPropiaPct / 100) * 100) / 100;

  // Calcular comisiones por cada cliente afiliado
  const desglosePorCliente: ComisionClienteParaSocio[] = [];
  let totalComisionesClientes = 0;

  for (const af of clientesAfiliados) {
    const afNorm = normalizar(af.nombre);
    let totalJugadoAf = 0;
    const jugadas: DetalleJugadaComisionSocio[] = [];

    for (const t of tickets) {
      if (t.anulada) continue;
      const tCli = normalizar(t.cliente_juega_nombre || t.clienteJuega || t.cliente_nombre);
      const fechaT = String(t.fecha_carrera || t.fecha || "").slice(0, 10);

      if (tCli === afNorm) {
        // Validación de fecha inicio de cálculo para el socio
        if (fechaT < af.fechaInicio) continue;
        if (params.fechaDesde && fechaT < params.fechaDesde) continue;
        if (params.fechaHasta && fechaT > params.fechaHasta) continue;

        const montoJ = Number(t.monto_jugado ?? t.monto ?? t.monto_decidido ?? 0);
        if (montoJ > 0) {
          const comisionMonto = Math.round(montoJ * (af.comisionPct / 100) * 100) / 100;
          totalJugadoAf += montoJ;
          jugadas.push({
            id: t.id || `t-${Math.random()}`,
            fecha: fechaT,
            hipodromo: t.hipodromo || "USA",
            carrera: t.carrera || 1,
            nombreJugada: t.nombre_jugada || t.modalidad || "Jugada",
            caballo: t.caballo || t.ejemplar || "",
            montoJugado: montoJ,
            comisionPct: af.comisionPct,
            montoComision: comisionMonto,
            estado: t.estado || "Vigente",
          });
        }
      }
    }

    const totalComisionAf = Math.round(totalJugadoAf * (af.comisionPct / 100) * 100) / 100;
    totalComisionesClientes += totalComisionAf;

    desglosePorCliente.push({
      clienteId: af.id,
      clienteNombre: af.nombre,
      comisionPct: af.comisionPct,
      totalJugado: totalJugadoAf,
      totalComision: totalComisionAf,
      fechaInicio: af.fechaInicio,
      jugadas,
    });
  }

  return {
    socioNombre: params.socioNombre,
    devolucionPropiaPct: devPropiaPct,
    totalDevolucionPropia: totalDevPropia,
    totalComisionesClientes: Math.round(totalComisionesClientes * 100) / 100,
    totalGeneralDevoluciones: Math.round((totalDevPropia + totalComisionesClientes) * 100) / 100,
    desglosePorCliente,
  };
}

/**
 * Compila el reporte global completo de Destinatarios de Devolución
 */
export function calcularReporteDestinatariosDevolucion(params?: {
  fechaDesde?: string;
  fechaHasta?: string;
  tickets?: any[];
  clientes?: any[];
}): ReporteDestinatariosDevolucionData {
  const fDesde = params?.fechaDesde || "2026-10-29";
  const fHasta = params?.fechaHasta || "2026-10-30";
  const tickets = params?.tickets || [];
  const clientes = params?.clientes || [];

  // Lista única de destinatarios (Socios y Jugadores con devolución propia)
  const destinatarios = [
    { nombre: "ARRAEZ", pctPropio: 1.00 },
    { nombre: "EDDIE", pctPropio: 1.25, esSocio: true },
    { nombre: "FORTUNA", pctPropio: 1.00 },
    { nombre: "INFANTINO", pctPropio: 1.00 },
    { nombre: "MEMPHIS", pctPropio: 1.00, esSocio: true },
    { nombre: "PARTNER", pctPropio: 1.50, esSocio: true },
    { nombre: "RUSSO", pctPropio: 1.00 },
    { nombre: "SAM", pctPropio: 1.50 },
    { nombre: "THOR", pctPropio: 1.00, esSocio: true },
  ];

  const items: ItemReporteDestinatario[] = [];
  let granTotalPropia = 0;
  let granTotalComisiones = 0;

  for (const dest of destinatarios) {
    const res = calcularComisionesSocioPorClientes({
      socioNombre: dest.nombre,
      fechaDesde: fDesde,
      fechaHasta: fHasta,
      tickets,
      clientes,
    });

    const clientesList = res.desglosePorCliente.map((d) => ({
      cliente: d.clienteNombre,
      pct: d.comisionPct,
      totalJugado: d.totalJugado,
      comisionSocio: d.totalComision,
      jugadasCount: d.jugadas.length,
      jugadas: d.jugadas,
    }));

    granTotalPropia += res.totalDevolucionPropia;
    granTotalComisiones += res.totalComisionesClientes;

    items.push({
      socio: dest.nombre,
      devolucionPropiaPct: res.devolucionPropiaPct,
      totalDevolucionPropia: res.totalDevolucionPropia,
      clientes: clientesList,
      totalSocio: res.totalGeneralDevoluciones,
    });
  }

  return {
    fechaDesde: fDesde,
    fechaHasta: fHasta,
    items,
    granTotalDevolucionPropia: Math.round(granTotalPropia * 100) / 100,
    granTotalComisionesSocios: Math.round(granTotalComisiones * 100) / 100,
    granTotal: Math.round((granTotalPropia + granTotalComisiones) * 100) / 100,
  };
}

/**
 * Genera el texto plano idéntico al formato solicitado por el usuario para WhatsApp
 */
export function formatearReporteDestinatariosTexto(data: ReporteDestinatariosDevolucionData): string {
  const lineas: string[] = [
    `Destinatarios de Devolucion - ${data.fechaDesde} a ${data.fechaHasta}`,
    "────────────────────────────────",
    "",
  ];

  for (const it of data.items) {
    const pctPropioStr = it.devolucionPropiaPct.toFixed(2).replace(".", ",");
    const montoPropioStr = it.totalDevolucionPropia > 0 ? ` $${it.totalDevolucionPropia.toFixed(2)}` : "";

    if (it.clientes.length === 0) {
      // Caso sin clientes afiliados (ej. ARRAEZ, FORTUNA, INFANTINO, RUSSO, SAM)
      lineas.push(`🔀 ${it.socio} devolución de ${pctPropioStr.replace(",00", "")}% por si mismo${montoPropioStr}`);
      lineas.push("");
    } else {
      // Caso socio con clientes (ej. EDDIE, MEMPHIS, PARTNER, THOR)
      lineas.push(`🔀 ${it.socio}`);
      lineas.push(`  • (${pctPropioStr}%) ${it.socio} por si mismo${montoPropioStr}`);
      for (const cl of it.clientes) {
        const pctClStr = cl.pct.toFixed(2).replace(".", ",");
        const montoClStr = cl.comisionSocio > 0 ? ` $${cl.comisionSocio.toFixed(2)}` : "";
        lineas.push(`  • (${pctClStr}%) por ${cl.cliente}:${montoClStr}`);
      }
      lineas.push("");
    }
  }

  if (data.granTotal > 0) {
    lineas.push("────────────────────────────────");
    lineas.push(`Total General Devoluciones & Comisiones: $${data.granTotal.toFixed(2)}`);
  }

  return lineas.join("\n");
}

/**
 * Persiste los parámetros predeterminados en Supabase o almacén local
 */
export async function aplicarParametrosOficialesDevolucion(grupoId?: string): Promise<{ ok: boolean; actualizados: number }> {
  let count = 0;
  if (!supabase) return { ok: true, actualizados: 0 };

  try {
    // Resolver los IDs canónicos de los socios para guardarlos en
    // `socio_asignado` (el contrato actual es el ID, no el nombre).
    const { data: todos } = await supabase
      .from("clientes")
      .select("id, nombre, seudonimo");
    const sociosPorNombre = new Map<string, string>();
    for (const c of (todos ?? []) as Array<{ id?: unknown; nombre?: unknown; seudonimo?: unknown }>) {
      if (c.id == null) continue;
      for (const alias of [c.nombre, c.seudonimo]) {
        const n = normalizar(alias as string | null);
        if (n) sociosPorNombre.set(n, String(c.id));
      }
    }

    for (const r of PARAMETROS_PREDETERMINADOS_DEVOLUCION) {
      const updateData: Record<string, any> = {
        devolucion: r.devolucionPropiaPct,
      };
      if (r.esSocio) {
        updateData.es_socio = true;
      }
      if (r.socioAsignado) {
        updateData.socio_asignado =
          sociosPorNombre.get(normalizar(r.socioAsignado)) ?? r.socioAsignado;
        updateData.comision_socio_pct = r.comisionSocioPct ?? 1.00;
        updateData.fecha_inicio_comision_socio = r.fechaInicioComision || "2026-10-29";
      }

      let q = supabase
        .from("clientes")
        .update(updateData)
        .or(`nombre.ilike.${r.nombre},seudonimo.ilike.${r.nombre}`);

      if (grupoId) {
        q = q.eq("grupo_id", grupoId);
      }

      const { data, error } = await q.select("id");
      if (!error && data) {
        count += data.length;
      }
    }
    return { ok: true, actualizados: count };
  } catch {
    return { ok: false, actualizados: 0 };
  }
}

/**
 * Carga los tickets necesarios para el cálculo de comisiones y devoluciones
 */
export async function cargarTodosTicketsParaComisiones(): Promise<any[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("tickets_apuestas")
      .select("*")
      .order("fecha_registro", { ascending: false })
      .limit(10000);
    if (error) throw error;
    return (data ?? []) as any[];
  } catch (e) {
    console.error("Error al cargar tickets para comisiones:", e);
    return [];
  }
}

