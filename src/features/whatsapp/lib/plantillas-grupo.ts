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
    contenido: "{numero_jugada}✅ Aquí Jugaron",
    variables: [
      ...VARS_ENCABEZADO,
      "{numero_jugada}",
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
    contenido: "{numero_jugada}✅ Aquí Jugaron ⚠️Solo {monto} por pozo de \"{saldo_de}\"",
    variables: [...VARS_ENCABEZADO, "{numero_jugada}", "{juega}", "{da}", "{monto}", "{saldo_de}"],
  },
  {
    clave: "tope_saldo_publico",
    titulo: "Aviso Público de Tope de Saldo",
    descripcion: "Mensaje en grupo cuando un jugador intenta apostar por encima de su saldo disponible.",
    contenido: "{encabezado}\n⚠️{jugador} solo dispone de {saldo} - Proponga solo su disponible.",
    variables: [...VARS_ENCABEZADO, "{jugador}", "{saldo}"],
  },
  {
    clave: "pedagogia_exceso_dm",
    titulo: "Pedagogía DM por Exceso de Saldo",
    descripcion: "Mensaje Privado al jugador indicándole su disponible.",
    contenido:
      "⚠️Hola {jugador}, por favor, solo juega tu disponible que actualmente es {saldo_disponible}. ¡Gracias!",
    variables: ["{jugador}", "{saldo_disponible}"],
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
      "{encabezado}\n{fecha}\n*{hipodromo}, {carrera} Carrera*\nRetirado: {retirados}\n" +
      "📊 Pizarra Oficial: *{pizarra}*\n\n" +
      "*📑 Resumen de Liquidación ({total_jugadas} Jugadas):*\n{resumen}\n\n" +
      "🔄BALANCE TOTAL:\n\n" +
      "🟢 *POSITIVOS (+)*\n{positivos}\n🔴 *NEGATIVOS (-)*\n{negativos}",
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
  {
    clave: "bienvenida_individual",
    titulo: "Bienvenida Individual del Jugador",
    descripcion:
      "Se envía por DM la primera vez que el jugador escribe al grupo. Presenta la sala y su saldo disponible.",
    contenido:
      "👋 ¡Hola {jugador}! Te damos la bienvenida a {grupo} (Sala {codigo_sala}). Tu saldo disponible es {saldo_disponible}.\n\n" +
      "🤖 Este grupo es manejado con un bot. Para jugar, escribí siempre:Qué haces (Juego/Consigo), Qué juegas, Ejemplar(es) y Monto.\n\n" +
      "✅ Ejemplos válidos (también en cualquier orden o en líneas separadas):\n" +
      "• Juego 1P del 5 con 100\n" +
      "• Juego a5 el 4 con 100  (= Juego 10/5 el 4 con 100)\n" +
      "• Juego 1/2n del 5 con 100  (= 1&2n · 1 y 2 n · 1 /2n)\n" +
      "• Juego 1/2n y 2n del 5 con 100  (= Juego 1/2-2n del 5 con 100)\n" +
      "• Juego 3x5 10a8 con 100\n\n" +
      "⚠️ Respetá el orden de llegada: 10/2, 10/3, 10/3.5, 10a4, 10/5, 10@5.5, 1p, 1/2n, 2n, 2/3n… Si no indicás proporción en un mano a mano, se sobreentiende pp=10/10.",
    variables: ["{nombre}", "{jugador}", "{codigo_sala}", "{grupo}", "{saldo_disponible}"],
  },
  {
    clave: "cierre_sin_pizarra",
    titulo: "Cierre de Carrera sin Pizarra",
    descripcion: "Aviso de cierre cuando la carrera no tiene pizarra oficial sentenciada.",
    contenido: "🔒 *{hipodromo} CARRERA {carrera} CERRADA* — Sin pizarra oficial. ¡Suerte a todos!",
    variables: ["{hipodromo}", "{carrera}"],
  },
  {
    clave: "recarga_instrucciones",
    titulo: "Instrucciones de Recarga",
    descripcion: "DM con los pasos para recargar saldo, enviado cuando el jugador lo solicita.",
    contenido:
      "💳 Hola {nombre}, para recargar tu saldo escribí *RECARGA* y te enviaremos los datos de la transferencia. ¡Gracias!",
    variables: ["{nombre}"],
  },
  {
    clave: "mensaje_grupo",
    titulo: "Mensaje Libre al Grupo",
    descripcion: "Redacción libre para enviar al grupo de WhatsApp desde el panel.",
    contenido: "",
    variables: [],
  },
  {
    clave: "mensaje_individual",
    titulo: "Mensaje Libre Individual (DM)",
    descripcion: "Redacción libre para enviar por mensaje privado desde el panel.",
    contenido: "",
    variables: [],
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
