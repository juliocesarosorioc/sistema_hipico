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

  const punteros = carrera.ranking.filter((r) => r.ejemplar.estilo === "E1");
  const colocados = carrera.ranking.filter((r) => r.ejemplar.estilo === "E2");
  const rematadores = carrera.ranking.filter((r) => r.ejemplar.estilo === "E3");

  const formatearCab = (r: (typeof carrera.ranking)[0]) => {
    const pp = r.ejemplar.puestoPista || r.ejemplar.numero;
    return `#${r.ejemplar.numero} ${r.ejemplar.nombre} (PP: ${pp})`;
  };

  const listaPunteros = punteros.map(formatearCab).join(", ");
  const listaColocados = colocados.map(formatearCab).join(", ");
  const listaRematadores = rematadores.map(formatearCab).join(", ");

  let planteamiento = "";
  if (punteros.length >= 3) {
    planteamiento = `Carrera con tren violento en los primeros 400m y 800m. Los ejemplares velocistas ${listaPunteros} buscarán cerrar hacia la baranda interior desde la partida, lo que generará fuerte desgaste en punta. Esta lucha beneficiará el remate de ${listaRematadores || "los atropelladores"} en los 250m finales.`;
  } else if (punteros.length === 1) {
    planteamiento = `Poco desgaste inicial esperado. El puntero ${listaPunteros} cuenta con ventaja táctica para tomar el riel con desahogo y marcar el ritmo de la carrera, mientras ${listaColocados || "los perseguidores"} correrán a la expectativa.`;
  } else if (punteros.length > 1) {
    planteamiento = `Duelo en la vanguardia entre ${listaPunteros}, quienes buscarán la baranda interior en el giro del codo. Detrás de ellos, ${listaColocados} vendrán colocados acechando para lanzar su ataque a la entrada de la recta final.`;
  } else {
    planteamiento = `Carrera sin puntero nato definido. Se proyecta que ${formatearCab(carrera.ranking[0])} asumirá la iniciativa táctica pegado a la baranda, seguido de cerca por ${listaColocados || "el lote"}, mientras que ${listaRematadores || "los rematadores"} definirán en los metros decisivos.`;
  }

  const analisisFav = primero
    ? `Defiende el primer orden de proyección con ${primero.probabilidadSMIC}% de probabilidad y score actuarial de ${primero.scoreGodetTotal} pts. ${formatearCab(primero)} saldrá desde la puerta PP: ${primero.ejemplar.puestoPista || primero.ejemplar.numero}. ${
        primero.favorecidoTendenciaTarde ? "Se encuentra ampliamente favorecido por la tendencia de la tarde observada en cancha. " : ""
      }${
        primero.bonoPesoOptimo ? "Presenta peso físico óptimo en balanza respecto a su histórico. " : ""
      }${
        primero.ejemplar.ultimoTraqueo ? `Viene de excelente ejercicio: ${primero.ejemplar.ultimoTraqueo.tiempo} con remate de ${primero.ejemplar.ultimoTraqueo.remate ?? "12"} (${primero.ejemplar.ultimoTraqueo.calificacion}).` : ""
      }`
    : "Sin favorito claro.";

  const enemigo = segundo
    ? `El principal rival es ${formatearCab(segundo)} (${segundo.probabilidadSMIC}%), quien proyecta cruzar a ${primero?.cuerposVentaja ?? "1.0"} cuerpos y posee ${segundo.ejemplar.efectividadJineteEntrenador ? `un ${(segundo.ejemplar.efectividadJineteEntrenador * 100).toFixed(0)}% de efectividad en su yunta` : "condiciones para comprometer la llegada"}.`
    : "Lote abierto.";

  const lance = sorpresa
    ? `Lance de excelente dividendo: ${formatearCab(sorpresa)} (Morning Line ${sorpresa.ejemplar.morningLine}). Posee capacidad de remate para meterse en la trifecta o dar el batacazo.`
    : undefined;

  const conclusion = primero?.esLinea5y6
    ? `Recomendación: LÍNEA FIJA imperdible para ${formatearCab(primero)}. Su superioridad actuarial y tren favorable le otorgan amplia ventaja hacia la meta.`
    : primero?.esMorocha5y6 && segundo
    ? `Recomendación: DUPLA OBLIGATORIA entre ${formatearCab(primero)} y ${formatearCab(segundo)}.`
    : `Recomendación: Cuadro abierto. Incluir a ${primero ? formatearCab(primero) : "primer favorito"} en primer orden con cobertura de ${segundo ? formatearCab(segundo) : "segundo orden"}${tercero ? ` y ${formatearCab(tercero)}` : ""}.`;

  const hipoNombre = String(carrera.hipodromo || "LA RINCONADA").trim().toUpperCase();

  return {
    titulo: `INFORME PROSPECTIVO · ${hipoNombre} C${carrera.carreraNumero} (${carrera.distancia}M)`,
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
