/**
 * REPORTE DE CARRERA COMO IMAGEN Y GENERADOR UNIFICADO DE 7 COLUMNAS + WHATSAPP
 *
 * 1. Captura la plantilla `ReporteCarrera` (`#reporte-imprimible`) con html2canvas
 *    y la descarga como PNG/JPG sin márgenes ni bordes en los logos.
 * 2. Construye la estructura oficial de 7 columnas:
 *    `1. Quien Juega | 2. Apostó | 3. Resultado | 4. Jugada | 5. Quien Da | 6. Apostó | 7. Resultado`
 * 3. Genera los textos auditables para el Visor Interactivo de WhatsApp (`#reporteArea`):
 *    - Reporte de Prejugadas (Preliminar WhatsApp) separado en En Vivo vs. Adelantadas
 *    - Reporte de Saldos Actualizados con filtros (`todos`, `min1`, `min1_libres`, `min001_libres`)
 *      y opción de separar `🟢 POSITIVOS (+)` / `🔴 NEGATIVOS (-)`.
 */
import { capturarNodo, guardarLienzos, type ImgFormato } from "@/features/impresion/lib/exportar";
import { formatearMontoSinMoneda, limpiarSimbolosMoneda, redondearCentavos } from "@/shared/lib/dinero";
import { agruparAdelantadasPorSeccion } from "@/features/liquidacion/lib/reporte-carrera";
import { resolverContraparteModalidad } from "@/features/liquidacion/lib/etiquetas-reporte";
import type { JugadaVivo, ObservacionOrdenExceso } from "@/features/saldos/components/ReporteCarrera";

export const COLUMNAS_REPORTE_7 = [
  "Quien Juega",
  "Apostó",
  "Resultado",
  "Jugada",
  "Quien Da",
  "Apostó",
  "Resultado",
] as const;

export type FilaReporte7Columnas = {
  quienJuega: string;
  apostoJuega: number;
  resultadoJuega: number;
  jugada: string;
  quienDa: string;
  apostoDa: number | null;
  resultadoDa: number | null;
  esAdelantada: boolean;
};

/**
 * Convierte las filas de `JugadaVivo` a la estructura estricta de 7 columnas.
 * Si la carrera aún no está liquidada (`liquidada === false`), las columnas 3 y 7
 * muestran el monto en riesgo en negativo (`-apostoJuega` y `-apostoDa`).
 */
export function construirFilas7Columnas(
  filas: JugadaVivo[],
  liquidada: boolean
): FilaReporte7Columnas[] {
  return filas.map((f) => {
    const aposto1 = redondearCentavos(
      typeof f.aposto === "number" ? f.aposto : parseFloat(String(f.aposto ?? "").replace(",", ".")) || 0
    );
    const aposto2 = f.apostoDa != null ? redondearCentavos(f.apostoDa) : null;
    const res1 = liquidada && f.resultado !== null ? redondearCentavos(f.resultado) : -Math.abs(aposto1);
    const res2 = !f.da
      ? null
      : liquidada && f.resultadoDa !== undefined && f.resultadoDa !== null
        ? redondearCentavos(f.resultadoDa)
        : liquidada && f.resultado !== null
          ? redondearCentavos(-f.resultado)
          : aposto2 != null
            ? -Math.abs(aposto2)
            : null;
    const jugadaTxt = f.caballo ? `${f.jugo} (${f.caballo})`.trim() : String(f.jugo ?? "").trim();

    return {
      quienJuega: f.juega,
      apostoJuega: aposto1,
      resultadoJuega: res1,
      jugada: jugadaTxt,
      quienDa: f.da || "—",
      apostoDa: aposto2,
      resultadoDa: res2,
      esAdelantada: Boolean(f.esAdelantada),
    };
  });
}

export type FiltroSaldosWhatsapp = "todos" | "min1" | "min1_libres" | "min001_libres";

export type ItemSaldoWhatsapp = {
  nombre: string;
  saldoContable: number;
  aval: number;
  riesgoEnCurso: number;
  disponible: number;
  libre?: boolean;
  tuvoMovimiento?: boolean;
};

/**
 * Genera el texto para WhatsApp del Reporte de Prejugadas (Preliminar) separando
 * estrictamente las jugadas En Vivo y las Jugadas Adelantadas, más las observaciones
 * de exceso de saldo/aval y sin ningún símbolo de moneda.
 */
export function generarTextoPrejugadasWhatsapp(params: {
  grupo: string;
  hipodromo: string;
  carrera: number | string;
  fecha: string;
  retirados?: string;
  jugadasEnVivo: Array<{
    juega: string;
    jugada: string;
    caballo: string;
    monto: number;
    da?: string;
    queda?: number;
    observacionExceso?: string | null;
  }>;
  jugadasAdelantadas?: Array<{
    juega: string;
    jugada: string;
    caballo: string;
    monto: number;
    da?: string;
    queda?: number;
    observacionExceso?: string | null;
  }>;
  observacionesExceso?: ObservacionOrdenExceso[];
}): string {
  const Lineas: string[] = [];
  Lineas.push(`🐎 ${limpiarSimbolosMoneda(params.grupo || params.hipodromo)} 🐎`);
  Lineas.push(`FECHA: ${params.fecha}`);
  Lineas.push(`HIPÓDROMO Y CARRERA: ${params.hipodromo}, ${params.carrera} Carrera`);
  Lineas.push(`Ret: ${params.retirados?.trim() || "NO HUBO RETIROS"}`);
  Lineas.push(`Pizarra: .....`);
  Lineas.push("");

  const formatearLinea = (
    j: {
      juega: string;
      jugada: string;
      caballo: string;
      monto: number;
      da?: string;
      queda?: number;
      observacionExceso?: string | null;
    },
    idx: number
  ) => {
    const cab = j.caballo ? ` (${j.caballo})` : "";
    const daResuelto = resolverContraparteModalidad(j.jugada, j.da);
    const da = daResuelto ? ` da ${daResuelto}` : "";
    const quedaTxt =
      typeof j.queda === "number" && Number.isFinite(j.queda)
        ? j.queda > 0
          ? ` · Queda *${formatearMontoSinMoneda(j.queda)}*`
          : ` · *S/S*`
        : "";
    const obsTxt = j.observacionExceso ? ` [${j.observacionExceso}]` : "";
    return `${idx + 1}) Juega ${j.juega} ${j.jugada}${cab} con ${formatearMontoSinMoneda(j.monto)}${da}${quedaTxt}${obsTxt}`;
  };

  Lineas.push("⚡ JUGADAS EN VIVO (CARRERA ACTUAL)");
  if (params.jugadasEnVivo.length === 0) {
    Lineas.push("Sin jugadas en vivo registradas.");
  } else {
    params.jugadasEnVivo.forEach((j, i) => Lineas.push(formatearLinea(j, i)));
  }

  const adelantadas = params.jugadasAdelantadas ?? [];
  if (adelantadas.length > 0) {
    Lineas.push("");
    Lineas.push("⏳ JUGADAS ADELANTADAS (PRE-JUGADAS)");
    const secciones = agruparAdelantadasPorSeccion(adelantadas);
    for (const sec of secciones) {
      Lineas.push(`▪ ${sec.titulo.toUpperCase()} (${sec.filas.length}):`);
      sec.filas.forEach((j, i) => Lineas.push(formatearLinea(j, i)));
    }
  }

  const obs = params.observacionesExceso ?? [];
  if (obs.length > 0) {
    Lineas.push("");
    Lineas.push("📋 OBSERVACIONES DE LÍMITE DE SALDO Y ORDEN DE JUEGO:");
    for (const o of obs) {
      if (o.resumenMencion) {
        Lineas.push(`• ${o.resumenMencion}`);
      } else {
        Lineas.push(
          `• Orden #${o.orden} ${o.jugador} (${o.jugada}): solicitó ${formatearMontoSinMoneda(o.montoSolicitado)} → aceptado ${formatearMontoSinMoneda(o.montoAceptado)} (${o.motivo})`
        );
      }
    }
  }

  Lineas.push("------------------------------");
  Lineas.push(`Total jugadas: ${params.jugadasEnVivo.length + adelantadas.length}`);
  Lineas.push("PLANO REFERENCIAL · La guía es el chat · RECLAMOS AL PRIVADO");

  return limpiarSimbolosMoneda(Lineas.join("\n"));
}

/**
 * Genera el texto para WhatsApp del Reporte de Saldos Actualizados con soporte de filtros
 * (`todos`, `min1`, `min1_libres`, `min001_libres`) y separación de positivos/negativos.
 */
export function generarTextoSaldosWhatsapp(params: {
  grupo: string;
  hipodromo?: string;
  carrera?: number | string;
  fecha?: string;
  clientes: ItemSaldoWhatsapp[];
  filtro?: FiltroSaldosWhatsapp;
  separarPositivosNegativos?: boolean;
}): string {
  const filtro = params.filtro ?? "todos";
  const separar = params.separarPositivosNegativos !== false;

  const filtrados = params.clientes.filter((c) => {
    const absSaldo = Math.abs(redondearCentavos(c.disponible));
    if (filtro === "todos") return true;
    if (filtro === "min1") return absSaldo >= 1;
    if (filtro === "min1_libres") return absSaldo >= 1 || (Boolean(c.libre) && Boolean(c.tuvoMovimiento));
    if (filtro === "min001_libres") return absSaldo >= 0.01 || (Boolean(c.libre) && Boolean(c.tuvoMovimiento));
    return true;
  });

  const lineas: string[] = [];
  lineas.push(`🏇🏆 SALDOS ACTUALIZADOS · ${limpiarSimbolosMoneda(params.grupo || "GRUPO")} 🏆🏇`);
  if (params.hipodromo && params.carrera) {
    lineas.push(`${params.hipodromo} · Carrera ${params.carrera}${params.fecha ? ` · ${params.fecha}` : ""}`);
  }
  lineas.push("------------------------------");

  const fmtCliente = (c: ItemSaldoWhatsapp, idx: number) => {
    const disp = redondearCentavos(c.disponible);
    const signo = disp > 0 ? "+" : "";
    const riesgoTxt = c.riesgoEnCurso > 0 ? ` (En riesgo: ${formatearMontoSinMoneda(c.riesgoEnCurso)})` : "";
    return `${idx + 1}) ${c.nombre}: *${signo}${formatearMontoSinMoneda(disp)}*${riesgoTxt}`;
  };

  if (separar) {
    const positivos = filtrados
      .filter((c) => redondearCentavos(c.disponible) >= 0)
      .sort((a, b) => b.disponible - a.disponible || a.nombre.localeCompare(b.nombre, "es"));
    const negativos = filtrados
      .filter((c) => redondearCentavos(c.disponible) < 0)
      .sort((a, b) => a.disponible - b.disponible || a.nombre.localeCompare(b.nombre, "es"));

    lineas.push("🟢 POSITIVOS / DISPONIBLES (+)");
    if (positivos.length === 0) lineas.push("—");
    else positivos.forEach((c, i) => lineas.push(fmtCliente(c, i)));

    lineas.push("");
    lineas.push("🔴 NEGATIVOS / EN DEUDA (-)");
    if (negativos.length === 0) lineas.push("—");
    else negativos.forEach((c, i) => lineas.push(fmtCliente(c, i)));
  } else {
    const ordenados = [...filtrados].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (ordenados.length === 0) lineas.push("—");
    else ordenados.forEach((c, i) => lineas.push(fmtCliente(c, i)));
  }

  lineas.push("------------------------------");
  lineas.push(`Total clientes listados: ${filtrados.length}`);
  return limpiarSimbolosMoneda(lineas.join("\n"));
}

/**
 * Captura el reporte visible (`#reporte-imprimible`) y lo descarga como imagen.
 */
export async function exportarReporteCarreraImagen(
  formato: ImgFormato,
  nombreBase: string
): Promise<boolean> {
  const el = document.getElementById("reporte-imprimible");
  if (!el) return false;
  try {
    const canvas = await capturarNodo(el, 2); // 300dpi efectivos sobre la hoja @150dpi
    await guardarLienzos([canvas], formato, nombreBase);
    return true;
  } catch {
    return false;
  }
}
