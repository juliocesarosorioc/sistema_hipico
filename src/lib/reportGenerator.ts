/**
 * Motor de reportes de texto (paridad con el flujo real de WhatsApp del club).
 *
 *  - Plantilla 1 · Relación de Jugadas (pre-carrera):
 *      Cabecera + cuerpo TERCIOS ("Juega X ... da Y") + pie estricto.
 *  - Plantilla 2 · Relación de Resultados (post-liquidación):
 *      Cabecera con Pizarra + jugadas numeradas con balance financiero según la
 *      regla del bettingEngine (comisión 5% SOLO sobre ganancia bruta) y cierre
 *      🟢 POSITIVOS (+) / 🔴 NEGATIVOS (-) por cliente.
 *  - Plantilla 3 · Reporte de Disponibilidad (saldos):
 *      Lista en dos columnas (nombre \t saldo) con separador de miles.
 *
 * Formato de montos local (es-VE): 40,00 / 2.951.
 */
import { supabase } from "@/lib/supabase";
import { COMISION_CASA } from "@/lib/bettingEngine";

// ============================================================
// Tipos
// ============================================================

export type MetaCarrera = {
  /** Nombre del grupo o hipódromo que encabeza la relación (🏇🏆...🏆🏇). */
  grupo?: string;
  /** Fecha de la relación (por defecto hoy). */
  fecha?: Date;
  hipodromo: string;
  carrera: number | string;
  retirados?: string;
  pizarra?: string;
};

export type JugadaRelacion = {
  /** Cliente que FINANCIA la jugada ("Juega"). */
  clienteJuega: string;
  /** Sigla del tipo de jugada (1P, 2T, 1/2, SEÑAL…). */
  jugada: string;
  /** Número/ejemplar apostado. */
  caballo: string;
  /** Monto financiado, en la moneda del ticket. */
  monto: number;
  /** Cliente que COBRA si acierta ("da [Cliente2]"). Opcional (jugada sola). */
  clienteConsigue?: string;
  cantidadTablas?: number;
  premioPorTabla?: number;
  /** Premio potencial bruto (tokenTable columna premio_potencial). */
  premioPotencial?: number;
  /** Comisión en porcentaje (por defecto COMISION_CASA.rate → 5%). */
  comisionPct?: number;
  /** Si la jugada acertó (aplica a la Relación de Resultados). */
  ganador?: boolean;
};

export type SaldoCliente = {
  nombre?: string | null;
  saldo?: number | string | null;
};

export type FiltroCarrera = {
  hipodromo: string;
  carrera: number | string;
  /** Si true, solo tickets estado = Pendiente (relación pre-carrera). */
  soloPendientes?: boolean;
};

// ============================================================
// Formato local es-VE (40,00 / 2.951)
// ============================================================

const VE2 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const VE0 = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fmtMonto(n: number | string | null | undefined): string {
  const num = Number(n);
  return VE2.format(Number.isFinite(num) ? num : 0);
}

/** Número entero con separador de miles: 2.951. */
export function fmtMiles(n: number | string | null | undefined): string {
  const num = Number(n);
  return VE0.format(Number.isFinite(num) ? num : 0);
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// ============================================================
// Pie estricto (se mantiene a toda costa en jugadas y resultados)
// ============================================================

export function pieEstricto(totalJugadas: number): string {
  return [
    `------------------------------`,
    `Total jugadas: ${totalJugadas}`,
    `------------------------------`,
    `PLANO REFERENCIAL`,
    `La guía es el chat`,
    `(se gana y se cobra con el chat)`,
    `USTED ES SU PROPIO CORREDOR`,
    `RECLAMOS AL PRIVADO`,
    `VERIFICAR SUS JUGADAS POR FAVOR`,
    `NO DIGA: ❌MALO❌; CASA FALTA...`,
    `TILDE SU JUGADA Y SE REVISARÁ`,
  ].join("\n");
}

export function cabeceraCarrera(meta: MetaCarrera): string {
  const fecha = meta.fecha ?? new Date();
  const weekday = cap(fecha.toLocaleDateString("es-VE", { weekday: "long" }));
  const dia = fecha.toLocaleDateString("es-VE", { day: "numeric" });
  const mes = cap(fecha.toLocaleDateString("es-VE", { month: "long" }));
  const anio = fecha.toLocaleDateString("es-VE", { year: "numeric" });
  const retirados = meta.retirados?.trim()
    ? meta.retirados.trim()
    : "NO HUBO RETIROS";
  const pizarra = meta.pizarra?.trim() ? meta.pizarra.trim() : ".....";
  return [
    `🏇🏆${meta.grupo ?? meta.hipodromo}🏆🏇`,
    `${weekday}, ${dia} de ${mes} de ${anio}`,
    `${meta.hipodromo}, ${meta.carrera} Carrera`,
    `Ret: ${retirados}`,
    `Pizarra: ${pizarra}`,
  ].join("\n");
}

// ============================================================
// Plantilla 1 · Relación de Jugadas (pre-carrera)
// ============================================================

export function relacionJugadas(meta: MetaCarrera, jugadas: JugadaRelacion[]): string {
  const lineas = jugadas.map(
    (j) =>
      `Juega ${j.clienteJuega} ${j.jugada} (${j.caballo}) con ${fmtMonto(j.monto)}${
        j.clienteConsigue ? ` da ${j.clienteConsigue}` : ""
      }.`
  );
  return [cabeceraCarrera(meta), "", ...lineas, "", pieEstricto(jugadas.length)].join("\n");
}

// ============================================================
// Plantilla 2 · Relación de Resultados (post-liquidación)
// ============================================================

export type BalanceJugada = {
  jugada: JugadaRelacion;
  premioPotencial: number;
  gananciaBruta: number;
  comision: number;
  gananciaNeta: number;
};

/**
 * Regla del bettingEngine aplicada a una jugada:
 *   premioPotencial = premio a pagar (o cantidad × premio_por_tabla) si acertó, si no 0.
 *   gananciaBruta   = premioPotencial − monto (solo si > 0).
 *   comision        = gananciaBruta × (comisionPct ?? 5%) — SOLO sobre ganancia bruta.
 *   gananciaNeta    = gananciaBruta − comision  → lo que cobra el "Consigue".
 *   pérdida         = monto financiado          → lo que arriesgó el "Juega".
 */
export function balanceJugada(j: JugadaRelacion): BalanceJugada {
  const premioPotencial = j.ganador
    ? Math.max(0, num(j.premioPotencial) || num(j.cantidadTablas) * num(j.premioPorTabla))
    : 0;
  const gananciaBruta = Math.max(0, premioPotencial - num(j.monto));
  const comision =
    gananciaBruta > 0
      ? gananciaBruta * (num(j.comisionPct) > 0 ? num(j.comisionPct) : COMISION_CASA.rate * 100) / 100
      : 0;
  return {
    jugada: j,
    premioPotencial,
    gananciaBruta,
    comision,
    gananciaNeta: gananciaBruta - comision,
  };
}

export function relacionResultados(meta: MetaCarrera, jugadas: JugadaRelacion[]): string {
  const cuerpo: string[] = [];
  const balances = new Map<string, number>();

  const acumular = (nombre: string, valor: number) => {
    if (!nombre) return;
    balances.set(nombre, (balances.get(nombre) ?? 0) + valor);
  };

  jugadas.forEach((j, i) => {
    const b = balanceJugada(j);
    // Leg "Juega": siempre pierde lo financiado.
    const perdida = num(j.monto);
    // Leg "Consigue": cobra la ganancia neta (si no hay consigue, la cobra el propio jugador).
    const beneficiario = j.clienteConsigue || "";
    cuerpo.push(`${i + 1}) ${j.jugada} (${j.caballo}) con ${fmtMonto(j.monto)}`);
    cuerpo.push(`Juega ${j.clienteJuega} $ -${fmtMonto(perdida)}`);
    acumular(j.clienteJuega, -perdida);
    if (beneficiario) {
      cuerpo.push(`Consigue ${beneficiario} $ +${fmtMonto(b.gananciaNeta)}`);
      acumular(beneficiario, b.gananciaNeta);
    } else {
      acumular(j.clienteJuega, b.gananciaNeta);
    }
  });

  const positivos = [...balances.entries()]
    .filter(([, v]) => v > 0.0001)
    .sort((a, b) => b[1] - a[1]);
  const negativos = [...balances.entries()]
    .filter(([, v]) => v < -0.0001)
    .sort((a, b) => a[1] - b[1]);

  const cierre: string[] = ["🟢 POSITIVOS (+)"];
  if (positivos.length === 0) cierre.push("—");
  else positivos.forEach(([nombre, valor], i) => cierre.push(`${i + 1}) ${nombre} ${fmtMiles(valor)}`));
  cierre.push("🔴 NEGATIVOS (-)");
  if (negativos.length === 0) cierre.push("—");
  else negativos.forEach(([nombre, valor], i) => cierre.push(`${i + 1}) ${nombre} ${fmtMiles(Math.abs(valor))}`));

  return [cabeceraCarrera(meta), "", ...cuerpo, "", ...cierre, "", pieEstricto(jugadas.length)].join("\n");
}

// ============================================================
// Plantilla 3 · Reporte de Disponibilidad (saldos)
// ============================================================

export function reporteDisponibilidad(clientes: SaldoCliente[]): string {
  const cabe = `🏇🏆 TERCIOS DISPONIBLE 🏆🏇`;
  const listado = clientes.map((c) => `${String(c.nombre ?? "—")}\t${fmtMiles(num(c.saldo))}`).join("\n");
  return [cabe, "", listado].join("\n");
}

// ============================================================
// Datos reales: jugadas de una carrera (tickets_apuestas)
// ============================================================

export type TicketApuestaJugada = {
  id: string;
  nombre_jugada?: string | null;
  caballo?: string | null;
  cantidad_tablas?: number | string | null;
  monto_jugado?: number | string | null;
  premio_potencial?: number | string | null;
  premio_por_tabla?: number | string | null;
  comision_porcentaje?: number | string | null;
  estado?: string | null;
  cliente_juega_nombre?: string | null;
  cliente_consigue_nombre?: string | null;
};

function mapearJugada(r: TicketApuestaJugada): JugadaRelacion {
  return {
    clienteJuega: String(r.cliente_juega_nombre ?? "—"),
    jugada: String(r.nombre_jugada ?? "").trim(),
    caballo: String(r.caballo ?? "").trim(),
    monto: num(r.monto_jugado),
    clienteConsigue: r.cliente_consigue_nombre ? String(r.cliente_consigue_nombre) : undefined,
    cantidadTablas: num(r.cantidad_tablas),
    premioPorTabla: num(r.premio_por_tabla),
    premioPotencial: num(r.premio_potencial),
    comisionPct: num(r.comision_porcentaje) || undefined,
    ganador: num(r.premio_potencial) > 0,
  };
}

export async function cargarJugadasDeCarrera(
  filtro: FiltroCarrera
): Promise<JugadaRelacion[]> {
  if (!supabase) return [];
  try {
    let q = supabase
      .from("tickets_apuestas")
      .select(
        "id, nombre_jugada, caballo, cantidad_tablas, monto_jugado, premio_potencial, premio_por_tabla, comision_porcentaje, estado, cliente_juega_nombre, cliente_consigue_nombre"
      )
      .eq("hipodromo", String(filtro.hipodromo).trim().toUpperCase())
      .eq("carrera", num(filtro.carrera))
      .order("created_at", { ascending: true });
    if (filtro.soloPendientes) {
      q = q.eq("estado", "Pendiente");
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? [])
      .map((r) => mapearJugada(r as unknown as TicketApuestaJugada))
      .filter((j) => j.clienteJuega !== "—" && (j.jugada || j.caballo) && j.monto > 0);
  } catch {
    return [];
  }
}