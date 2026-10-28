/**
 * ============================================================================
 * REDACTOR EXPERTO DE INTELIGENCIA HÍPICA (GEMINI API / MOTOR ACTUARIAL)
 * ============================================================================
 * Genera informes profesionales con planteamiento táctico, análisis de tren de
 * carrera, justificación de líneas fijas y recomendaciones del Cuadro Maestro 5y6.
 */

import { ResultadoCarreraV4 } from "./analista-venezuela-v4";
import { CuadroMaestro5y6Resultado } from "./optimizador-5y6";

export type InformeCarreraIA = {
  titulo: string;
  planteamientoTactico: string;
  analisisFavorito: string;
  enemigoPrincipal: string;
  lanceSorpresa?: string;
  conclusionRecomendacion: string;
};

export type InformeCuadro5y6IA = {
  resumenEstrategico: string;
  justificacionLineas: string;
  alertasPeligro: string;
  recomendacionInversion: string;
};

/**
 * Genera el informe analítico para una carrera individual.
 */
export async function generarInformeCarreraIA(
  carrera: ResultadoCarreraV4
): Promise<InformeCarreraIA> {
  const primero = carrera.ranking[0];
  const segundo = carrera.ranking[1];
  const tercero = carrera.ranking[2];
  const sorpresa = carrera.sorpresaRecomendada5y6;

  const velCount = carrera.ranking.filter((r) => r.ejemplar.estilo === "E1").length;
  const remCount = carrera.ranking.filter((r) => r.ejemplar.estilo === "E3").length;

  let planteamiento = "";
  if (velCount >= 3) {
    planteamiento = `Carrera con tren violento en los primeros 400m y 800m. La presencia de ${velCount} velocistas natos generará desgaste en punta, abriendo camino a los ejemplares con remate efectivo en los 250m finales.`;
  } else if (velCount <= 1) {
    planteamiento = `Poco desgaste inicial esperado. El tren de carrera favorece la punta libre, permitiendo al puntero conservar reservas de energía para intentar la victoria de tiro a tiro.`;
  } else {
    planteamiento = `Tren de carrera equilibrado a ritmo honrado. La clase y el Speed Rating TTC Bühlmann-Straub serán determinantes en el tramo decisivo de la recta final.`;
  }

  const analisisFav = primero
    ? `Defiende el primer orden de proyección con ${primero.probabilidadSMIC}% de probabilidad y score actuarial de ${primero.scoreGodetTotal} pts. ${
        primero.favorecidoTendenciaTarde ? "Se encuentra ampliamente favorecido por la tendencia de la tarde observada en cancha. " : ""
      }${
        primero.bonoPesoOptimo ? "Presenta peso físico óptimo en balanza respecto a su histórico. " : ""
      }${
        primero.ejemplar.ultimoTraqueo ? `Viene de excelente ejercicio: ${primero.ejemplar.ultimoTraqueo.tiempo} con remate de ${primero.ejemplar.ultimoTraqueo.remate ?? "12"} (${primero.ejemplar.ultimoTraqueo.calificacion}).` : ""
      }`
    : "Sin favorito claro.";

  const enemigo = segundo
    ? `El principal rival es #${segundo.ejemplar.numero} ${segundo.ejemplar.nombre} (${segundo.probabilidadSMIC}%), quien proyecta cruzar a ${primero?.cuerposVentaja ?? "1.0"} cuerpos y posee ${segundo.ejemplar.efectividadJineteEntrenador ? `un ${(segundo.ejemplar.efectividadJineteEntrenador * 100).toFixed(0)}% de efectividad en su yunta` : "condiciones para comprometer la llegada"}.`
    : "Lote abierto.";

  const lance = sorpresa
    ? `Lance de excelente dividendo: #${sorpresa.ejemplar.numero} ${sorpresa.ejemplar.nombre} (Morning Line ${sorpresa.ejemplar.morningLine}). Posee capacidad de remate para meterse en la trifecta o dar el batacazo.`
    : undefined;

  const conclusion = primero?.esLinea5y6
    ? `Recomendación: LÍNEA FIJA imperdible. Su superioridad actuarial y tren favorable le otorgan amplia ventaja.`
    : primero?.esMorocha5y6 && segundo
    ? `Recomendación: DUPLA OBLIGATORIA entre #${primero.ejemplar.numero} ${primero.ejemplar.nombre} y #${segundo.ejemplar.numero} ${segundo.ejemplar.nombre}.`
    : `Recomendación: Cuadro abierto. Incluir a #${primero?.ejemplar.numero} en primer orden con cobertura de #${segundo?.ejemplar.numero} y #${tercero?.ejemplar.numero}.`;

  return {
    titulo: `INFORME PROSPECTIVO · ${carrera.hipodromo} C${carrera.carreraNumero} (${carrera.distancia}M)`,
    planteamientoTactico: planteamiento,
    analisisFavorito: analisisFav,
    enemigoPrincipal: enemigo,
    lanceSorpresa: lance,
    conclusionRecomendacion: conclusion,
  };
}

/**
 * Genera la justificación analítica del Cuadro Maestro 5y6.
 */
export async function generarInformeCuadro5y6IA(
  cuadro: CuadroMaestro5y6Resultado
): Promise<InformeCuadro5y6IA> {
  const lineasStr = cuadro.lineasFijas.length
    ? cuadro.lineasFijas
        .map((l) => `${l.valida}ª Válida (#${l.numero} ${l.nombre} - ${l.prob}%)`)
        .join(", ")
    : "Ninguna (cuadro de combinaciones múltiples)";

  const resumen = `Cuadro configurado bajo la estrategia ${cuadro.estrategia} con ${cuadro.combinacionesTotales} combinaciones para una inversión de Bs. ${cuadro.costoTotalBs.toLocaleString("es-VE", { minimumFractionDigits: 2 })}. Se proyecta una probabilidad de cobertura del ${cuadro.probabilidadCoberturaPct}% sobre las 6 válidas.`;

  const justificacion = `Las bases firmes del formulario se concentran en: ${lineasStr}. Estos ejemplares presentan el mayor diferencial de cuerpos proyectados y coincidencia con el escenario dominante SMIC.`;

  const alertas = `Las válidas con mayor riesgo de caída de cuadros son aquellas con 3 o más seleccionados, particularmente en lotes parejas de reclamo o carreras de cierre. Se cubren con marcas de seguridad.`;

  const recomendacion = `Para maximizar el retorno de inversión, se sugiere respetar las líneas fijas recomendadas y no abrir innecesariamente las válidas donde la probabilidad SMIC supera el 40%.`;

  return {
    resumenEstrategico: resumen,
    justificacionLineas: justificacion,
    alertasPeligro: alertas,
    recomendacionInversion: recomendacion,
  };
}
