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
import {
  esMarca,
  esTablaFija,
  extraerNumeroTablaFija,
  extraerPareoMarca,
  extraerPrecioUnitarioTabla,
  formatearPrecioCorto,
  resolverContraparteModalidad,
} from "@/features/liquidacion/lib/etiquetas-reporte";
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
    const jugoStr = String(f.jugo ?? "").trim();
    const jugadaTxt = esMarca(jugoStr)
      ? extraerPareoMarca({ jugada: jugoStr, caballo: f.caballo }).etiquetaTexto
      : esTablaFija(jugoStr) || /^TABLA\b|^TF\b/i.test(jugoStr)
        ? `${extraerNumeroTablaFija({ jugada: jugoStr, caballo: f.caballo })} a ${formatearPrecioCorto(
            f.precioTabla && f.precioTabla > 0 ? f.precioTabla : aposto1
          )}`
        : f.caballo
          ? `${jugoStr} (${f.caballo})`.trim()
          : jugoStr;

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

export type FiltroSaldosWhatsapp =
  | "sin_ceros"
  | "positivos"
  | "negativos"
  | "todos"
  | "min1"
  | "min1_libres"
  | "min001_libres";

export type ItemSaldoWhatsapp = {
  nombre: string;
  saldoContable: number;
  aval: number;
  riesgoEnCurso?: number;
  disponible: number;
  libre?: boolean;
  modoJuego?: "aval" | "libre" | "pozo" | string;
  tuvoMovimiento?: boolean;
};

export function obtenerModalidadWhatsapp(c: ItemSaldoWhatsapp): "aval" | "libre" | "pozo" {
  const modo = String(c.modoJuego ?? "").toLowerCase().trim();
  if (modo === "pozo") return "pozo";
  if (modo === "libre" || Boolean(c.libre)) return "libre";
  if (modo === "aval" || Number(c.aval) > 0) return "aval";
  return "pozo";
}

export function iconoModalidadWhatsapp(c: ItemSaldoWhatsapp): string {
  const mod = obtenerModalidadWhatsapp(c);
  if (mod === "pozo") return "💰";
  if (mod === "libre") return "🔓";
  return "💎";
}

/**
 * Determina si un jugador avalado está próximo a agotar su aval:
 * - Tiene aval asignado (`aval > 0`)
 * - Ya ha consumido parte de su aval (`saldoContable < 0` o `riesgoEnCurso > 0`)
 * - El disponible restante sobre su aval es <= 30% del aval o <= 200.
 */
export function estaProximoAAgotarAvalWhatsapp(c: ItemSaldoWhatsapp): boolean {
  if (obtenerModalidadWhatsapp(c) !== "aval") return false;
  const aval = redondearCentavos(Math.max(0, Number(c.aval) || 0));
  if (aval <= 0) return false;
  const saldo = redondearCentavos(Number(c.saldoContable) || 0);
  const riesgo = redondearCentavos(Math.max(0, Number(c.riesgoEnCurso) || 0));
  // Disponible real del avalado: saldoContable + aval - riesgoEnCurso
  const dispCalculado = redondearCentavos(saldo + aval - riesgo);
  const disp = Number.isFinite(c.disponible)
    ? redondearCentavos(c.disponible)
    : dispCalculado;
  const haUsadoAval = saldo < -0.004 || riesgo > 0.004 || disp < aval - 0.004;
  if (!haUsadoAval) return false;
  const umbralAlerta = Math.max(200, redondearCentavos(aval * 0.3));
  return disp <= umbralAlerta;
}

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
    precioTabla?: number;
    cantidadTablas?: number;
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
      precioTabla?: number;
      cantidadTablas?: number;
      da?: string;
      queda?: number;
      observacionExceso?: string | null;
    },
    idx: number
  ) => {
    const quedaTxt =
      typeof j.queda === "number" && Number.isFinite(j.queda)
        ? j.queda > 0
          ? ` · Queda *${formatearMontoSinMoneda(j.queda)}*`
          : ` · *S/S*`
        : "";
    const obsTxt = j.observacionExceso ? ` [${j.observacionExceso}]` : "";
    if (esMarca(j.jugada)) {
      const pareoTxt = extraerPareoMarca({ jugada: j.jugada, caballo: j.caballo }).etiquetaTexto;
      return `${idx + 1}) Juega ${j.juega} MARCA ${pareoTxt} con ${formatearMontoSinMoneda(j.monto)}${quedaTxt}${obsTxt}`;
    }
    if (esTablaFija(j.jugada) || /^TABLA\b|^TF\b/i.test(j.jugada)) {
      const numCab = extraerNumeroTablaFija({ jugada: j.jugada, caballo: j.caballo });
      const precio = extraerPrecioUnitarioTabla({ ...j, monto_jugado: j.monto });
      const daResuelto = resolverContraparteModalidad(j.jugada, j.da);
      return `${idx + 1}) Juega ${j.juega} TABLA FIJA DEL ${numCab} a ${formatearPrecioCorto(precio)} c/u ${formatearMontoSinMoneda(j.monto)} da ${daResuelto}${quedaTxt}${obsTxt}`;
    }
    const cab = j.caballo ? ` (${j.caballo})` : "";
    const daResuelto = resolverContraparteModalidad(j.jugada, j.da);
    const da = daResuelto ? ` da ${daResuelto}` : "";
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
 * Genera el texto para WhatsApp del Reporte de Saldos Actualizados:
 * - Ícono por modalidad: 💎 Avalado, 🔓 Libre, 💰 Con Pozo.
 * - Oculta siempre los saldos en 0 (`|saldoContable| < 0.01`).
 * - Opciones de filtro:
 *   - `sin_ceros` / `todos`: mayores a 0 y menores a 0 (ocultando los 0).
 *   - `positivos`: solo quienes tengan saldo > 0 (ocultando 0 y < 0).
 *   - `negativos`: solo quienes tengan saldo < 0 (ocultando 0 y > 0).
 * - Regla de Avalados (💎): no se expone el cupo de aval como saldo; se muestra
 *   únicamente el ícono 💎 y su saldo real (+ o -). Cuando se aproxime a agotar
 *   su aval, se agrega `Disp. XXXX`.
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
  const filtro = params.filtro ?? "sin_ceros";
  const separar = params.separarPositivosNegativos !== false;

  const obtenerSaldoReal = (c: ItemSaldoWhatsapp): number =>
    redondearCentavos(Number(c.saldoContable) || 0);

  const obtenerDisponibleAval = (c: ItemSaldoWhatsapp): number => {
    const saldo = obtenerSaldoReal(c);
    const aval = redondearCentavos(Math.max(0, Number(c.aval) || 0));
    const riesgo = redondearCentavos(Math.max(0, Number(c.riesgoEnCurso) || 0));
    if (Number.isFinite(c.disponible)) {
      return Math.max(0, redondearCentavos(c.disponible));
    }
    return Math.max(0, redondearCentavos(saldo + aval - riesgo));
  };

  const filtrados = params.clientes.filter((c) => {
    const saldo = obtenerSaldoReal(c);
    const absSaldo = Math.abs(saldo);
    const proximoAgotarAval = estaProximoAAgotarAvalWhatsapp(c);

    // Ocultar siempre los 0 (salvo avalado con riesgo en curso próximo a agotar su aval en vista general)
    if (absSaldo < 0.01 && !proximoAgotarAval) return false;

    if (filtro === "positivos") return saldo >= 0.01;
    if (filtro === "negativos") return saldo <= -0.01 || (absSaldo < 0.01 && proximoAgotarAval);
    if (filtro === "sin_ceros" || filtro === "todos" || filtro === "min001_libres") {
      return absSaldo >= 0.01 || proximoAgotarAval;
    }
    if (filtro === "min1") return absSaldo >= 1 || proximoAgotarAval;
    if (filtro === "min1_libres") {
      return absSaldo >= 1 || proximoAgotarAval || (Boolean(c.libre) && Boolean(c.tuvoMovimiento) && absSaldo >= 0.01);
    }
    return absSaldo >= 0.01;
  });

  const lineas: string[] = [];
  lineas.push(`🏇🏆 SALDOS ACTUALIZADOS · ${limpiarSimbolosMoneda(params.grupo || "GRUPO")} 🏆🏇`);
  if (params.hipodromo && params.carrera) {
    lineas.push(`${params.hipodromo} · Carrera ${params.carrera}${params.fecha ? ` · ${params.fecha}` : ""}`);
  }
  lineas.push("💎 Avalado · 🔓 Libre · 💰 Pozo");
  lineas.push("------------------------------");

  const fmtCliente = (c: ItemSaldoWhatsapp, idx: number) => {
    const icono = iconoModalidadWhatsapp(c);
    const modalidad = obtenerModalidadWhatsapp(c);
    const saldo = obtenerSaldoReal(c);
    const signo = saldo > 0 ? "+" : "";
    const tieneSaldo = Math.abs(saldo) >= 0.01;
    const saldoTxt = tieneSaldo ? `*${signo}${formatearMontoSinMoneda(saldo)}*` : "";

    let extraAvalTxt = "";
    if (modalidad === "aval" && estaProximoAAgotarAvalWhatsapp(c)) {
      const disp = obtenerDisponibleAval(c);
      extraAvalTxt = tieneSaldo
        ? ` · Disp. ${formatearMontoSinMoneda(disp)}`
        : `*Disp. ${formatearMontoSinMoneda(disp)}*`;
    }

    const riesgoNum = Number(c.riesgoEnCurso) || 0;
    const riesgoTxt =
      riesgoNum > 0 && !extraAvalTxt
        ? ` (En riesgo: ${formatearMontoSinMoneda(riesgoNum)})`
        : "";

    const cuerpoMonto = [saldoTxt, extraAvalTxt].filter(Boolean).join("");
    return `${idx + 1}) ${icono} ${c.nombre}: ${cuerpoMonto}${riesgoTxt}`;
  };

  if (filtro === "positivos") {
    const positivos = [...filtrados].sort(
      (a, b) => obtenerSaldoReal(b) - obtenerSaldoReal(a) || a.nombre.localeCompare(b.nombre, "es")
    );
    lineas.push("🟢 SALDOS POSITIVOS (+)");
    if (positivos.length === 0) lineas.push("—");
    else positivos.forEach((c, i) => lineas.push(fmtCliente(c, i)));
  } else if (filtro === "negativos") {
    const negativos = [...filtrados].sort(
      (a, b) => obtenerSaldoReal(a) - obtenerSaldoReal(b) || a.nombre.localeCompare(b.nombre, "es")
    );
    lineas.push("🔴 SALDOS NEGATIVOS (-)");
    if (negativos.length === 0) lineas.push("—");
    else negativos.forEach((c, i) => lineas.push(fmtCliente(c, i)));
  } else if (separar) {
    const positivos = filtrados
      .filter((c) => obtenerSaldoReal(c) >= 0.01)
      .sort((a, b) => obtenerSaldoReal(b) - obtenerSaldoReal(a) || a.nombre.localeCompare(b.nombre, "es"));
    const negativos = filtrados
      .filter((c) => obtenerSaldoReal(c) < 0.01)
      .sort((a, b) => obtenerSaldoReal(a) - obtenerSaldoReal(b) || a.nombre.localeCompare(b.nombre, "es"));

    lineas.push("🟢 SALDOS POSITIVOS (+)");
    if (positivos.length === 0) lineas.push("—");
    else positivos.forEach((c, i) => lineas.push(fmtCliente(c, i)));

    lineas.push("");
    lineas.push("🔴 SALDOS NEGATIVOS (-)");
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
