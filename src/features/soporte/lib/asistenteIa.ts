/**
 * Motor de Inteligencia y Base de Conocimiento Especializada en sistema_hipico.
 * 
 * Atiende dudas frecuentes de operadores y dueños de grupo,
 * y detecta incidencias complejas para escalarlas a tickets de soporte humano.
 */

import { ConsultaIaRespuesta, CategoriaTicket, PrioridadTicket } from "../types/soporte";

interface ReglaConocimiento {
  patrones: RegExp[];
  categoria: CategoriaTicket;
  prioridad: PrioridadTicket;
  respuesta: string;
  resuelto: boolean;
  requiereEscalamiento: boolean;
}

const BASE_CONOCIMIENTO: ReglaConocimiento[] = [
  // 1. REGLAS DE PUESTOS Y MULTIPLICADORES
  {
    patrones: [/puesto[s]?/i, /1p|2p|3p|4p|5p|6p/i, /1y2n|2y3n|3y3n/i, /tabla.*puesto/i, /multiplicador/i],
    categoria: "duda_plataforma",
    prioridad: "baja",
    respuesta: `🐎 **Lógica Oficial de Puestos y Multiplicadores**:
• Las jugadas de puestos abarcan 44 combinaciones oficiales (desde **1P**, pasando por **1Y2N**, **2P**, **2Y3N**, hasta **6Y7NY7N**).
• **Varios ejemplares en la jugada** (ej. \`1y2\`, \`3y4\`, \`2,5\`): El sistema toma automáticamente la **mejor posición de llegada** entre todos los caballos indicados.
  - *Ejemplo*: En \`1P\` con \`1y2\`, si el #1 o el #2 llega en 1° lugar, la jugada resulta ganadora (+1) y quien dio la jugada pierde (-1).
• **Jugadas a Premio** (\`10a7\`, \`10A3.5\`, \`10/7\`, \`10/3,5\`):
  - Se normalizan a \`10A<factor>\`. El multiplicador de ganancia es \`(factor * 10) / 100\`.
  - Si el ejemplar llega 1° (sin empate), paga el porcentaje pactado; si no llega 1°, se pierde -1.
• **Para-Para (PP)**: Mano a mano entre 2 ejemplares (\`4x8\`). Gana el que cruce primero la meta.
• **Retirados (RET)**: Si algún ejemplar está retirado en la carrera, la jugada se anula (\`RET\`, neto 0).`,
    resuelto: true,
    requiereEscalamiento: false,
  },

  // 2. WPS (WIN, PLACE, SHOW) E INCENTIVOS DE VENEZUELA
  {
    patrones: [/wps/i, /win.*place/i, /place/i, /show/i, /dividendo/i, /incentivo[s]?/i, /boleto.*100/i],
    categoria: "duda_plataforma",
    prioridad: "baja",
    respuesta: `🏇 **Módulo WPS (Win · Place · Show) e Incentivos**:
• **Formatos de Carga Rápida en Apuestas**:
  - \`Jugador win Ejemplar Monto\` (ej: \`Carlos win 4 100\`)
  - \`Jugador place Ejemplar Monto\` (ej: \`Carlos place 2 50\`)
  - \`Jugador show Ejemplar Monto\` (ej: \`Carlos show 5 30\`)
  - \`Jugador WPS Ejemplar Monto\` (ej: \`Carlos WPS 3 20\`): Carga automáticamente las 3 modalidades con el monto especificado en cada una.
• **Incentivos a Dividendos por Grupo**:
  - Cada dueño de grupo puede configurar incentivos para su grupo (suma fija o rangos escalonados, ej: de 2,10 a 2,50 llévalo a 2,50).
  - Cálculo oficial: \`(Dividendo + Incentivo) × Monto en riesgo\`.
• **Tabla Oficial de Venezuela (Boleto 100,00 Bs. INH)**:
  - Integra la conversión exacta desde 1-9 (Bs. 110) hasta 99 (Bs. 10.000). Puedes consultarla directamente en la pestaña "Tabla Venezuela" del modal WPS.`,
    resuelto: true,
    requiereEscalamiento: false,
  },

  // 3. SALDOS: LIBRE vs AVALADO vs POZO
  {
    patrones: [/saldo[s]?/i, /aval/i, /avalado/i, /pozo/i, /libre[s]?/i, /cupo/i, /limite.*credito/i],
    categoria: "ajuste_saldo",
    prioridad: "media",
    respuesta: `💵 **Gestión y Clasificación de Saldos de Clientes**:
• 🟢 **Jugadores Libres**: Operan bajo modalidad de efectivo/contado regular sin garante intermedio.
• 🛡️ **Jugadores Avalados**: Cuentan con un garante (avalador) y un límite de crédito asignado. Sus jugadas están respaldadas por el aval del grupo.
• 🪙 **Jugadores con Pozo**: Poseen fondos positivos retenidos o acumulados a su favor (bolsa protegida).
• **Filtros en Reportes de Saldos**:
  - Puedes filtrar por Saldo Actual (Positivo/Negativo) Aval, Saldo Libre, y Saldo Positivo de Pozo con sus respectivos íconos de identificación.
• *Nota*: Si necesitas realizar un ajuste manual de saldo por comprobante, usa el botón "💵 Gestión Rápida de Saldos" en la barra superior.`,
    resuelto: true,
    requiereEscalamiento: false,
  },

  // 4. CONTROL DE CRUCES Y BLOQUEO DEL GRUPO PRINCIPAL
  {
    patrones: [/cruce[s]?/i, /tapa[s]?/i, /grupo.*principal/i, /todos.*los.*grupos/i, /bloqueo.*principal/i, /no.*puedo.*cargar/i],
    categoria: "duda_plataforma",
    prioridad: "media",
    respuesta: `⚡ **Control de Cruces y Bloqueo de Grupo Principal**:
• **Acceso a Control de Cruces**:
  - Se activa desde el botón **"⚡ Cruces de esta Carrera"** en la barra superior de 🐎🎲 Apuestas.
  - Permite monitorear el balanceo de banca, riesgos máximos y nivel de exposición por ejemplar.
• **Regla de Seguridad de Grupo Principal**:
  - El usuario/grupo **Principal («Todos los grupos»)** es exclusivamente de supervisión y gestión global.
  - **No puede registrar jugadas directamente**: El sistema bloquea la carga hasta que selecciones un grupo activo específico en el desplegable superior.`,
    resuelto: true,
    requiereEscalamiento: false,
  },

  // 5. LIQUIDACIÓN, PIZARRA Y RETIRADOS
  {
    patrones: [/liquidar/i, /liquidacion/i, /pizarra/i, /oficial/i, /retirado[s]?/i, /deshacer.*liquidacion/i, /reabrir/i],
    categoria: "carrera_liquidacion",
    prioridad: "media",
    respuesta: `🏁 **Liquidación de Carreras y Pizarra Oficial**:
• **Carga de Pizarra**:
  - Ingresa en el módulo de Carreras o Liquidación y registra las posiciones del 1° al 7° lugar según el resultado oficial.
  - Si hay empate en algún lugar (Dead Heat), márcalo en la casilla de empate para que el sistema asigne las mismas posiciones efectivas.
• **Caballos Retirados (RET)**:
  - Marca los retirados antes o durante la liquidación; todas las jugadas vinculadas se declaran nulas (reembolso o neto 0).
• **Reversión**:
  - Si hubo una corrección oficial del comisariato, puedes reabrir la carrera para rectificar la pizarra y recalcular los saldos.`,
    resuelto: true,
    requiereEscalamiento: false,
  },

  // 6. PROBLEMAS TÉCNICOS, DISPUTAS O SOLICITUD DE HABLAR CON ADMINISTRADOR / HUMANO
  {
    patrones: [/humano/i, /administrador/i, /hablar.*alguien/i, /persona/i, /dueno/i, /jefe/i, /reclamo/i, /estafa/i, /dinero.*mal/i, /error.*grave/i, /ticket/i, /escalar/i, /incidencia/i],
    categoria: "error_sistema",
    prioridad: "urgente",
    respuesta: `🚨 **Atención Personalizada Requerida**:
He detectado que tu consulta requiere la revisión directa de un Administrador del Sistema o del Dueño de tu Grupo.

Puedes generar un **Ticket de Incidencia Oficial** con un solo clic a continuación. El administrador recibirá una alerta prioritaria en su panel para resolver tu caso y darte respuesta inmediata.`,
    resuelto: false,
    requiereEscalamiento: true,
  },
];

/**
 * Procesa la consulta del usuario con el motor de IA y base de conocimiento.
 */
export function consultarAsistenteIa(
  mensaje: string,
  rolUsuario: string = "operador"
): ConsultaIaRespuesta {
  const textoLimpio = mensaje.trim().toLowerCase();

  // 1. Detectar si el usuario pide explícitamente soporte humano, un administrador o reporta un problema crítico
  const esPeticionHumanoOReclamo =
    /humano|persona|administrador|admin|dueño|jefe|reclamo|estafa|descuadre|escalar|incidencia|problema grave|quiero hablar/i.test(
      textoLimpio
    );

  if (esPeticionHumanoOReclamo) {
    const reglaHumano = BASE_CONOCIMIENTO.find((r) => r.requiereEscalamiento);
    if (reglaHumano) {
      return {
        respuesta: reglaHumano.respuesta,
        resuelto: false,
        sugerenciaEscalamiento: true,
        categoriaDetectada: reglaHumano.categoria,
        prioridadDetectada: "urgente",
      };
    }
  }

  // 2. Revisar base de conocimiento general
  for (const regla of BASE_CONOCIMIENTO) {
    const coincide = regla.patrones.some((patron) => patron.test(textoLimpio));
    if (coincide) {
      return {
        respuesta: regla.respuesta,
        resuelto: regla.resuelto,
        sugerenciaEscalamiento: regla.requiereEscalamiento,
        categoriaDetectada: regla.categoria,
        prioridadDetectada: regla.prioridad,
      };
    }
  }

  // 3. Respuesta por defecto si parece un error técnico no categorizado
  const esErrorTecnico = /error|fallo|bug|reclamo|dinero|descuadre|problema|urgente/i.test(textoLimpio);
  if (esErrorTecnico) {
    return {
      respuesta: `⚠️ **Consulta Especializada Detectada**:
No tengo una respuesta predefinida exacta para este detalle técnico o financiero específico.

Te recomiendo **abrir un Ticket de Incidencia** para que el Administrador Principal o el Dueño de tu Grupo verifique el estado en la base de datos y te responda a la brevedad.`,
      resuelto: false,
      sugerenciaEscalamiento: true,
      categoriaDetectada: "error_sistema",
      prioridadDetectada: "alta",
    };
  }

  return {
    respuesta: `Hola 👋 Soy tu **Asistente Inteligente del Sistema Hípico**.
Puedo guiarte en:
1. 🐎 **Carga de Puestos y Premios**: Sintaxis de \`1P\`..\`6Y7N\`, \`10a7\`, \`10A3.5\`, \`PP\`.
2. 🏇 **Módulo WPS**: Formatos \`win\`, \`place\`, \`show\`, \`WPS\` e incentivos por grupo.
3. 💵 **Saldos**: Diferencia entre Saldo Libre, Avalado y Pozo.
4. ⚡ **Cruces y Bloqueos**: Uso del control de cruces y selección de grupo activo.
5. 🏁 **Liquidación**: Pizarra, empates y retirados.

Si tu duda es sobre un caso particular o requieres intervención técnica, puedes indicarme *"Hablar con administrador"* o presionar el botón de **Escalar a Ticket**.`,
    resuelto: true,
    sugerenciaEscalamiento: false,
    categoriaDetectada: "duda_plataforma",
    prioridadDetectada: "baja",
  };
}
