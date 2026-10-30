/**
 * Motor de Inteligencia y Base de Conocimiento Especializada en sistema_hipico.
 * 
 * Atiende dudas frecuentes de operadores y dueños de grupo,
 * y detecta incidencias complejas para escalarlas a tickets de soporte humano.
 */

import { ConsultaIaRespuesta, CategoriaTicket, PrioridadTicket } from "../types/soporte";
import {
  crearSesionAgente,
  procesarTurnoAgente,
  detectarIntencionContableInicial,
  type EstadoAgenteTransaccional,
  type RespuestaTurnoAgente,
} from "@/features/ia-copiloto/lib/agente-transaccional";
import type { EstadoOperativoCarrera } from "@/features/portal/lib/bloqueo-jugadas";
import { listarClientes } from "@/features/clientes/lib/clientes";
import { listarGruposAdmin } from "@/features/grupos/lib/grupos";
import { cargarCarrerasDelDia } from "@/features/carreras/lib/carreras-dia";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { formatoMoneda } from "@/shared/lib/vzla";

let sesionCopilotoGlobal: EstadoAgenteTransaccional = crearSesionAgente();

export function obtenerSesionCopilotoGlobal(): EstadoAgenteTransaccional {
  return sesionCopilotoGlobal;
}

export function reiniciarSesionCopilotoGlobal(
  opciones?: Parameters<typeof crearSesionAgente>[0]
): EstadoAgenteTransaccional {
  sesionCopilotoGlobal = crearSesionAgente(opciones);
  return sesionCopilotoGlobal;
}

export async function consultarCopilotoTransaccional(
  mensaje: string,
  opciones?: {
    jugador?: string;
    operador?: string;
    comprobanteUrl?: string | null;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
  }
): Promise<RespuestaTurnoAgente> {
  const res = await procesarTurnoAgente(sesionCopilotoGlobal, {
    texto: mensaje,
    ...opciones,
  });
  sesionCopilotoGlobal = res.estado;
  return res;
}

export { detectarIntencionContableInicial };

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
    respuesta: `Hola 👋 Soy tu **🤖 Agente de IA del Sistema Hípico**.
Suministro toda la información del sistema en tiempo real y también puedes **dictarme por voz (🎙️)** para que interprete consultas, saldos, carreras o jugadas:
1. 📊 **Resumen e Información del Sistema**: Pídeme *"Resumen del sistema"*, *"Saldos de clientes"*, *"Carreras de hoy"* o *"Saldo de [nombre]"*.
2. 🎙️ **Dictado e Interpretación de Jugadas**: Díctame por ejemplo *"Carlos juega 1P al 4 por 100 con Pedro"* o *"10 a 8 caballo 3 por 50"*.
3. 🐎 **Reglas de Puestos, PP y Premios**: Sintaxis de \`1P\`..\`6Y7N\`, \`10a7\`, \`PP\` (nunca se muestra 10/10 en el reporte) y ejemplares retirados (\`0,00 Empate\`).
4. 💵 **Contabilidad y Saldos Comprometidos**: Descuento inmediato en cuenta puente \`2.1.02.003\` al cargar jugadas en cualquier modal.
5. 🏁 **Liquidación y Reportes**: Pizarra oficial, resultados exclusivos de la carrera liquidada y devoluciones.`,
    resuelto: true,
    sugerenciaEscalamiento: false,
    categoriaDetectada: "duda_plataforma",
    prioridadDetectada: "baja",
  };
}

const MAPA_NUMEROS_VOZ: Record<string, string> = {
  uno: "1",
  primero: "1",
  dos: "2",
  segundo: "2",
  tres: "3",
  tercero: "3",
  cuatro: "4",
  cuarto: "4",
  cinco: "5",
  quinto: "5",
  seis: "6",
  sexto: "6",
  siete: "7",
  septimo: "7",
  séptimo: "7",
  ocho: "8",
  octavo: "8",
  nueve: "9",
  noveno: "9",
  diez: "10",
  once: "11",
  doce: "12",
  trece: "13",
  catorce: "14",
  quince: "15",
  veinte: "20",
  treinta: "30",
  cuarenta: "40",
  cincuenta: "50",
  cien: "100",
  ciento: "100",
  doscientos: "200",
  quinientos: "500",
  mil: "1000",
};

/**
 * Normaliza transcripciones de dictado por voz a nomenclatura oficial del sistema hípico.
 */
export function normalizarDictadoVoz(texto: string): string {
  let out = String(texto ?? "").trim();
  if (!out) return "";

  out = out.replace(
    /\b(uno|primero|dos|segundo|tres|tercero|cuatro|cuarto|cinco|quinto|seis|sexto|siete|septimo|séptimo|ocho|octavo|nueve|noveno|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|cien|doscientos|quinientos|mil)\b/gi,
    (m) => MAPA_NUMEROS_VOZ[m.toLowerCase()] ?? m
  );

  out = out
    .replace(/\bpara\s+para\b/gi, "PP")
    .replace(/\b10\s*(\/|a|de)\s*10\b/gi, "PP")
    .replace(/\b([1-6])\s*puestos?\b/gi, "$1P")
    .replace(/\b([1-6])\s*p\b/gi, "$1P")
    .replace(/\b([1-6])\s*y\s*([2-7])\s*n\b/gi, "$1Y$2N")
    .replace(/\b10\s*a\s*(\d+(?:[.,]\d+)?)\b/gi, "10A$1");

  return out;
}

/**
 * Motor en vivo del Agente de IA: suministra toda la información del sistema
 * (clientes, saldos comprometidos, grupos, carreras del día, pizarras) e interpreta dictados.
 */
export async function consultarAgenteIaEnVivo(
  mensajeOriginal: string,
  rolUsuario: string = "operador",
  fueDictado = false
): Promise<ConsultaIaRespuesta> {
  const mensaje = normalizarDictadoVoz(mensajeOriginal);
  const textoLimpio = mensaje.toLowerCase();

  try {
    // 1. Interpretación de dictado de jugada o pizarra si el usuario dicta una apuesta o llegada
    const matchPizarra = mensaje.match(/(?:pizarra|llegada|orden)[:\s]+(\d+(?:\s*[-,\s]\s*\d+){1,6})/i);
    if (matchPizarra) {
      const nums = matchPizarra[1]
        .split(/[-,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        respuesta:
          `🎙️ **Interpretación del Agente de IA (Pizarra Oficial)**:\n` +
          `• **Orden de llegada detectado**: ${nums.map((n, i) => `${i + 1}º: #${n}`).join(" · ")}\n` +
          `• **Comando listo para el Agente de Pizarra**: \`Pizarra: ${nums.join(" - ")}\`\n` +
          `Puedes ejecutarlo directamente en el botón **🤖 Agente Pizarra** al lado de **🏆 Liquidar Carrera**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
      };
    }

    // 2. Consulta general o resumen total del sistema ("toda la información del sistema", "resumen", "estado del sistema")
    if (
      /toda la informaci[oó]n|informaci[oó]n del sistema|resumen del sistema|estado del sistema|resumen general|estad[ií]sticas|cu[aá]ntos clientes|carreras de hoy/i.test(
        textoLimpio
      )
    ) {
      const fechaHoy = hoyLocal();
      const [clientes, grupos, carreras] = await Promise.all([
        listarClientes(true).catch(() => []),
        listarGruposAdmin(true).catch(() => []),
        cargarCarrerasDelDia(fechaHoy).catch(() => []),
      ]);

      const totalClientes = clientes.length;
      const conSaldoPositivo = clientes.filter((c) => Number(c.saldo_actual ?? 0) > 0.005);
      const conSaldoNegativo = clientes.filter((c) => Number(c.saldo_actual ?? 0) < -0.005);
      const sumaFavor = conSaldoPositivo.reduce((a, c) => a + Number(c.saldo_actual ?? 0), 0);
      const sumaContra = conSaldoNegativo.reduce((a, c) => a + Math.abs(Number(c.saldo_actual ?? 0)), 0);
      const sumaAvales = clientes.reduce((a, c) => a + Number(c.aval ?? 0), 0);

      const carrerasHoy = carreras.filter((c) => c.fecha === fechaHoy);
      const liquidadasHoy = carrerasHoy.filter(
        (c) => c.aplicado_a_tablas === true || String(c.estado ?? "").toLowerCase() === "liquidada"
      );
      const hipodromosHoy = [...new Set(carrerasHoy.map((c) => String(c.hipodromo ?? "").toUpperCase()).filter(Boolean))];

      return {
        respuesta:
          `🤖 **Informe Integral del Sistema Hípico (${fechaHoy})**:\n\n` +
          `👥 **Cartera y Contabilidad de Clientes**:\n` +
          `• **Clientes registrados**: ${totalClientes} (${grupos.length} grupo(s) activo(s))\n` +
          `• **Saldos a favor (Ganadores)**: ${conSaldoPositivo.length} cliente(s) por **+${formatoMoneda("USD", sumaFavor)}**\n` +
          `• **Saldos en contra / Comprometidos**: ${conSaldoNegativo.length} cliente(s) por **-${formatoMoneda("USD", sumaContra)}**\n` +
          `• **Avales totales autorizados**: **${formatoMoneda("USD", sumaAvales)}**\n` +
          `• **Regla Contable Activa**: Descuento inmediato en cuenta \`2.1.02.003\` (*Saldos Comprometidos por Jugadas en Curso*) al cargar cualquier jugada.\n\n` +
          `🏇 **Jornada Hípica de Hoy (${fechaHoy})**:\n` +
          `• **Hipódromos activos (${hipodromosHoy.length})**: ${hipodromosHoy.length ? hipodromosHoy.join(", ") : "Sin carreras cargadas hoy"}\n` +
          `• **Carreras registradas**: ${carrerasHoy.length} (${liquidadasHoy.length} liquidada(s) · ${carrerasHoy.length - liquidadasHoy.length} abierta(s))`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
      };
    }

    // 3. Consulta de saldo o datos de un cliente específico
    const matchCliente = textoLimpio.match(
      /(?:saldo de|cu[aá]nto tiene|estado de|buscar cliente|cliente|informaci[oó]n de)\s+([a-záéíóúñ0-9_\-\s]{2,35})/i
    );
    if (matchCliente) {
      const buscado = matchCliente[1]
        .replace(/\b(por favor|en el sistema|actual|hoy)\b/gi, "")
        .trim()
        .toUpperCase();
      if (buscado.length >= 2) {
        const clientes = await listarClientes(true).catch(() => []);
        const coincidencias = clientes.filter((c) => {
          const nom = String(c.nombre ?? "").toUpperCase();
          const seu = String(c.seudonimo ?? "").toUpperCase();
          return nom.includes(buscado) || seu.includes(buscado);
        });
        if (coincidencias.length > 0) {
          const detalle = coincidencias
            .slice(0, 5)
            .map((c) => {
              const saldo = Number(c.saldo_actual ?? 0);
              const aval = Number(c.aval ?? 0);
              const disp = saldo + aval;
              const dev = Number(c.devolucion ?? 0);
              return (
                `• **${c.seudonimo || c.nombre}** (${String(c.modo_juego ?? "aval").toUpperCase()}):\n` +
                `  Resultado / Saldo Actual: **${saldo > 0 ? "+" : ""}${formatoMoneda("USD", saldo)}** · Aval: **${formatoMoneda("USD", aval)}** · Disponible: **${formatoMoneda("USD", disp)}**${dev > 0 ? ` · Devolución: **${dev}%**` : ""}`
              );
            })
            .join("\n");
          return {
            respuesta: `🤖 **Información en Vivo de Cliente(s) («${buscado}»)**:\n${detalle}`,
            resuelto: true,
            sugerenciaEscalamiento: false,
            categoriaDetectada: "ajuste_saldo",
            prioridadDetectada: "baja",
          };
        }
      }
    }

    // 4. Si fue dictado por voz y contiene estructura de jugada, interpretarla claramente
    const matchJugadaDictada = mensaje.match(
      /\b(1P|2P|3P|4P|5P|6P|[1-6]Y[2-7]N|PP|10A\d+(?:[.,]\d+)?|WIN|PLACE|SHOW|WPS)\b/i
    );
    if (matchJugadaDictada) {
      const tipoJugada = matchJugadaDictada[1].toUpperCase();
      const nums = mensaje.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
      return {
        respuesta:
          `🎙️ **Jugada Interpretada por el Agente de IA**:\n` +
          `• **Texto recibido**: "${mensajeOriginal}"\n` +
          `• **Normalización Hípica**: \`${mensaje.toUpperCase()}\`\n` +
          `• **Modalidad detectada**: **${tipoJugada}**${nums.length ? ` · Valores numéricos: ${nums.join(", ")}` : ""}\n` +
          `• Puedes pegarla directamente en **⚡ Carga Rápida (TEXTO)** dentro del módulo **🐎🎲 Apuestas**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
      };
    }
  } catch {
    // Fallback limpio al motor base si hay error de red
  }

  const base = consultarAsistenteIa(mensaje, rolUsuario);
  if (fueDictado && mensaje !== mensajeOriginal) {
    return {
      ...base,
      respuesta: `🎙️ *Interpretado: "${mensaje}"*\n\n${base.respuesta}`,
    };
  }
  return base;
}
