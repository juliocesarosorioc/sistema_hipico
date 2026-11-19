/**
 * ============================================================================
 * MOTOR DE PLANTILLAS PERSONALIZABLES DE WHATSAPP POR GRUPO (SAAS MULTI-TENANT)
 * ============================================================================
 */
import {
  conectorGrupo,
  encabezadoGrupo,
  nombreGrupoMensaje,
  type ContextoEncabezadoGrupo,
} from "./encabezados-grupo";

export interface PlantillaGrupoItem {
  clave: string;
  titulo: string;
  descripcion: string;
  contenido: string;
  variables: string[];
}

const VARS_ENCABEZADO = ["{encabezado}", "{grupo}", "{conector}"];

export const PLANTILLAS_GRUPO_DEFAULT: PlantillaGrupoItem[] = [
  {
    clave: "confirmacion_jugada",
    titulo: "Confirmación de Jugada Concretada",
    descripcion: "Emitido en el grupo cuando dos jugadores casan una jugada 100%.",
    contenido:
      "{encabezado}\n✅ Aquí jugaron: *{juega} Juega {modalidad} {proporcion} da {da} {monto}*\n🔹 Juega: {juega} (Riesgo {riesgo_juega})\n🔸 Da: {da} (Riesgo {riesgo_da})",
    variables: [
      ...VARS_ENCABEZADO,
      "{juega}",
      "{da}",
      "{modalidad}",
      "{proporcion}",
      "{monto}",
      "{riesgo_juega}",
      "{riesgo_da}",
    ],
  },
  {
    clave: "concrecion_saldo_parcial",
    titulo: "Concreción por Saldo Parcial",
    descripcion:
      "Bot de concreción cuando dos jugadores pactan por el saldo disponible de uno o ambos.",
    contenido:
      "{encabezado}\n(Check) Aquí Jugaron \"{juega}\" y \"{da}\" \"{monto}\" por saldo de \"{saldo_de}\"",
    variables: [...VARS_ENCABEZADO, "{juega}", "{da}", "{monto}", "{saldo_de}"],
  },
  {
    clave: "tope_saldo_publico",
    titulo: "Aviso Público de Tope de Saldo",
    descripcion: "Mensaje en grupo cuando un jugador intenta apostar por encima de su saldo disponible.",
    contenido: "{encabezado}\n⚠️ *{jugador}* dispone de {saldo} para jugar",
    variables: [...VARS_ENCABEZADO, "{jugador}", "{saldo}"],
  },
  {
    clave: "pedagogia_exceso_dm",
    titulo: "Pedagogía DM por Exceso de Saldo",
    descripcion: "Mensaje Privado al jugador indicándole el recorte y su saldo actual.",
    contenido:
      "⚠️ Hola {jugador}, tu jugada se procesó por {monto_procesado} ya que es lo que dispones para realizarla. Tu saldo actual es {saldo_actual}.\n\nTe invitamos a jugar hasta el tope exacto de tu saldo disponible ({saldo_disponible}).",
    variables: ["{jugador}", "{monto_procesado}", "{saldo_actual}", "{saldo_disponible}"],
  },
  {
    clave: "sin_saldo_dm",
    titulo: "Aviso DM Sin Saldo",
    descripcion: "Mensaje Privado al jugador cuando no tiene saldo disponible.",
    contenido:
      "⚠️ Hola {jugador}, no dispones de saldo para realizar jugadas. Tu saldo disponible es {saldo}. Por favor realiza una recarga para continuar jugando.",
    variables: ["{jugador}", "{saldo}"],
  },
  {
    clave: "apertura_carrera",
    titulo: "Apertura de Carrera",
    descripcion: "Publicado en el grupo al abrir una carrera.",
    contenido:
      "{encabezado}\n🟢 *{hipodromo} CARRERA {carrera} ABIERTA* — Hagan sus jugadas.{retirados}",
    variables: [...VARS_ENCABEZADO, "{hipodromo}", "{carrera}", "{retirados}"],
  },
  {
    clave: "cierre_carrera",
    titulo: "Cierre de Carrera (Tranca)",
    descripcion: "Publicado en el grupo al cerrar o trancar una carrera.",
    contenido: "{encabezado}\n🔒 *{hipodromo} CARRERA {carrera} CERRADA* — No más jugadas. Suerte a todos.",
    variables: [...VARS_ENCABEZADO, "{hipodromo}", "{carrera}"],
  },
  {
    clave: "plano_encabezado",
    titulo: "Encabezado Oficial del Plano",
    descripcion: "Encabezado institucional emitido al solicitar el plano de jugadas.",
    contenido:
      "{encabezado}\n{fecha}\n{hipodromo}, {carrera} Carrera\nRetirado: {retirados}",
    variables: [...VARS_ENCABEZADO, "{fecha}", "{hipodromo}", "{carrera}", "{retirados}"],
  },
  {
    clave: "resultado_liquidacion",
    titulo: "Resultado y Liquidación Oficial",
    descripcion: "Publicado en el grupo al sentenciar o rectificar una carrera.",
    contenido:
      "{encabezado}\n{fecha}\n{hipodromo}, {carrera} Carrera\nRetirado: {retirados}\n" +
      "📊 Pizarra Oficial: *{pizarra}*\n\n" +
      "📑 RESUMEN DE LIQUIDACIÓN ({total_jugadas} JUGADAS):\n{resumen}\n\n" +
      "🔄BALANCE TOTAL (Compensando Ganancias vs. Pérdidas antes de con cruces el monto total):\n" +
      "POSITIVOS\n{positivos}\nNEGATIVOS\n{negativos}",
    variables: [
      ...VARS_ENCABEZADO,
      "{fecha}",
      "{hipodromo}",
      "{carrera}",
      "{retirados}",
      "{pizarra}",
      "{total_jugadas}",
      "{resumen}",
      "{positivos}",
      "{negativos}",
    ],
  },
  {
    clave: "correccion_pedagogica_dm",
    titulo: "Corrección Pedagógica de Sintaxis",
    descripcion: "Enviado por DM cuando un jugador escribe una jugada con formato incorrecto.",
    contenido:
      "🤖 Corrección Pedagógica: No pude procesar tu jugada \"{texto}\".\n\n✅ *Ejemplos correctos:*\n• Puesto: \"Juego 1P 5 20.000\"\n• A Premio: \"Juego 3x5 10a8 100\"\n• Llave: \"Juego 1P 2-5 500\"",
    variables: ["{texto}"],
  },
];

/** Variables de identidad de grupo listas para cualquier plantilla. */
export function variablesEncabezadoGrupo(
  sala: any,
  contexto: ContextoEncabezadoGrupo
): Record<string, string> {
  return {
    encabezado: encabezadoGrupo(sala, contexto),
    grupo: nombreGrupoMensaje(sala),
    conector: conectorGrupo(contexto),
  };
}

/**
 * Reemplaza variables en una plantilla de texto de forma segura.
 */
export function aplicarVariablesPlantilla(
  plantillaTexto: string,
  variables: Record<string, string | number | null | undefined>
): string {
  if (!plantillaTexto) return "";
  let resultado = plantillaTexto;
  for (const [k, v] of Object.entries(variables)) {
    const valStr = v == null ? "" : String(v);
    const keyConLlaves = k.startsWith("{") && k.endsWith("}") ? k : `{${k}}`;
    resultado = resultado.split(keyConLlaves).join(valStr);
  }
  return resultado;
}
