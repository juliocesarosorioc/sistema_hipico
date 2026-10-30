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
import {
  guardarBloqueosJugadas,
  leerBloqueosJugadas,
  MODALIDADES_PORTAL_META,
  type EstadoOperativoCarrera,
  type ModalidadPortalJugada,
} from "@/features/portal/lib/bloqueo-jugadas";
import {
  actualizarCliente,
  crearCliente,
  limpiarCacheClientes,
  listarClientes,
} from "@/features/clientes/lib/clientes";
import { limpiarCacheClientesVenta, listarGruposAdmin } from "@/features/grupos/lib/grupos";
import { cargarCarrerasDelDia } from "@/features/carreras/lib/carreras-dia";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { formatoMoneda } from "@/shared/lib/vzla";
import { useAuthStore } from "@/shared/store/useAuthStore";

export interface RutaModuloPlataforma {
  id: string;
  icono: string;
  etiqueta: string;
  ruta: string;
  patrones: RegExp[];
}

export const CATALOGO_RUTAS_PLATAFORMA: ReadonlyArray<RutaModuloPlataforma> = [
  { id: "apuestas", icono: "🐎🎲", etiqueta: "Apuestas (En Vivo y Adelantada)", ruta: "/apuestas", patrones: [/\bapuestas?\b/i, /\bgesti[oó]n\s+de\s+jugadas\b/i] },
  { id: "tablas_fijas", icono: "📋", etiqueta: "Tablas Fijas", ruta: "/tablas-fijas", patrones: [/\btablas?\s*fijas?\b/i] },
  { id: "marcas", icono: "🏷️", etiqueta: "Marcas / 5y6", ruta: "/marcas", patrones: [/\bmarcas?\b/i, /\b5\s*y\s*6\b/i] },
  { id: "dupleta", icono: "🔗", etiqueta: "Dupletas", ruta: "/dupleta", patrones: [/\bdupletas?\b/i] },
  { id: "remates", icono: "🔨", etiqueta: "Remates", ruta: "/remates", patrones: [/\bremates?\b/i] },
  { id: "pollas", icono: "🎱", etiqueta: "Pollas", ruta: "/pollas", patrones: [/\bpollas?\b/i] },
  { id: "taquilla", icono: "🏇", etiqueta: "Taquilla / WPS", ruta: "/taquilla", patrones: [/\btaquilla\b/i, /\bwps\b/i] },
  { id: "clientes", icono: "👥", etiqueta: "Gestión de Clientes", ruta: "/clientes", patrones: [/\bgesti[oó]n\s+de\s+clientes\b/i, /\bcartera\s+de\s+clientes\b/i, /\bmodulo\s+clientes\b/i] },
  { id: "saldos_reportes", icono: "💰", etiqueta: "Saldos y Reportes", ruta: "/saldos-reportes", patrones: [/\bsaldos\s+y\s+reportes\b/i, /\breporte\s+de\s+saldos\b/i] },
  { id: "reporte_diario", icono: "📊", etiqueta: "Reporte Diario", ruta: "/reporte-diario", patrones: [/\breporte\s+diario\b/i] },
  { id: "contabilidad", icono: "📒", etiqueta: "Contabilidad Central", ruta: "/contabilidad", patrones: [/\bcontabilidad\b/i, /\basientos\b/i, /\blibro\s+diario\b/i] },
  { id: "caja", icono: "🏦", etiqueta: "Caja y Tesorería", ruta: "/contabilidad/caja", patrones: [/\bcaja\b/i, /\btesorer[ií]a\b/i] },
  { id: "bancos", icono: "🏛️", etiqueta: "Bancos y Conciliación", ruta: "/contabilidad/bancos", patrones: [/\bbancos?\b/i, /\bconciliaci[oó]n\b/i] },
  { id: "ingresos", icono: "📈", etiqueta: "Ingresos y Comisiones", ruta: "/contabilidad/ingresos", patrones: [/\bingresos?\b/i] },
  { id: "monedas", icono: "💱", etiqueta: "Monedas y Tasas", ruta: "/contabilidad/monedas", patrones: [/\bmonedas?\b/i, /\btasas?\s+de\s+cambio\b/i] },
  { id: "grupos", icono: "🏢", etiqueta: "Grupos Hípicos", ruta: "/grupos", patrones: [/\bgrupos\s+h[ií]picos\b/i, /\bconvenios\b/i, /\bmodulo\s+grupos\b/i] },
  { id: "crear_grupo", icono: "➕🏢", etiqueta: "Crear Grupo", ruta: "/crear-grupo", patrones: [/\bcrear\s+grupo\b/i] },
  { id: "carreras", icono: "🏁", etiqueta: "Carreras y Gaceta IA", ruta: "/carreras", patrones: [/\bmodulo\s+carreras\b/i, /\bgaceta\b/i] },
  { id: "hipodromos", icono: "🏟️", etiqueta: "Hipódromos", ruta: "/hipodromos", patrones: [/\bhip[oó]dromos\b/i] },
  { id: "ejemplares", icono: "🐎", etiqueta: "Ejemplares", ruta: "/ejemplares", patrones: [/\bejemplares\b/i] },
  { id: "proyecciones", icono: "🧠", etiqueta: "Proyecciones IA", ruta: "/inteligencia-hipica/proyecciones", patrones: [/\bproyecciones\b/i, /\binteligencia\s+h[ií]pica\b/i] },
  { id: "reglas", icono: "📜", etiqueta: "Reglas de Jugadas", ruta: "/reglas-jugadas", patrones: [/\breglas\s+de\s+jugadas\b/i] },
  { id: "whatsapp", icono: "📲", etiqueta: "WhatsApp / Mensajería", ruta: "/whatsapp", patrones: [/\bmodulo\s+whatsapp\b/i] },
  { id: "seguridad", icono: "🛡️", etiqueta: "Seguridad y Permisos", ruta: "/seguridad", patrones: [/\bseguridad\b/i, /\bpermisos\b/i] },
  { id: "operadores", icono: "🧑‍💻", etiqueta: "Operadores", ruta: "/operadores", patrones: [/\boperadores\b/i] },
  { id: "diagnostico", icono: "🩺", etiqueta: "Diagnóstico", ruta: "/diagnostico", patrones: [/\bdiagn[oó]stico\b/i] },
  { id: "portal", icono: "🌐", etiqueta: "Portal de Clientes", ruta: "/portal", patrones: [/\bportal\s+de\s+clientes\b/i] },
];

export interface AccionOperativaPlataforma {
  id: string;
  categoria: "apuestas" | "clientes_contabilidad" | "portal";
  icono: string;
  etiqueta: string;
  descripcion: string;
  comandoChat: string;
  evento?: { accion: string; [k: string]: unknown };
  rutaRequerida?: string;
}

export const CATALOGO_ACCIONES_PLATAFORMA: ReadonlyArray<AccionOperativaPlataforma> = [
  // 1. Apuestas y Liquidación
  {
    id: "liquidar_carrera",
    categoria: "apuestas",
    icono: "🏆",
    etiqueta: "Liquidar Carrera",
    descripcion: "Abre la carga de resultados oficiales y liquida la carrera",
    comandoChat: "Abrir liquidar carrera",
    evento: { accion: "abrir_liquidar_carrera" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "cambio_pizarra",
    categoria: "apuestas",
    icono: "🤖",
    etiqueta: "Cambio de Pizarra",
    descripcion: "Abre el modal del Agente de Pizarra Oficial (Variación y Rectificación)",
    comandoChat: "Abrir cambio de pizarra",
    evento: { accion: "abrir_agente_pizarra" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "reporte_final",
    categoria: "apuestas",
    icono: "🧾",
    etiqueta: "Reporte Final",
    descripcion: "Abre el reporte oficial de liquidación de la carrera",
    comandoChat: "Abrir reporte de liquidación",
    evento: { accion: "abrir_reporte_liquidacion" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "carga_rapida",
    categoria: "apuestas",
    icono: "⚡",
    etiqueta: "Carga Rápida (Texto)",
    descripcion: "Abre el procesador masivo de jugadas por texto",
    comandoChat: "Abrir carga rápida",
    evento: { accion: "abrir_carga_rapida" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "control_cruces",
    categoria: "apuestas",
    icono: "🔀",
    etiqueta: "Control de Cruces",
    descripcion: "Abre el panel de configuración de cruces de la carrera",
    comandoChat: "Abrir control de cruces",
    evento: { accion: "abrir_control_cruces" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "recalcular_carrera",
    categoria: "apuestas",
    icono: "🔄",
    etiqueta: "Recalcular Carrera",
    descripcion: "Rehace toda la liquidación de la carrera contra la pizarra vigente",
    comandoChat: "Recalcular carrera actual",
    evento: { accion: "recalcular_carrera" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "reversar_liquidacion",
    categoria: "apuestas",
    icono: "⏪",
    etiqueta: "Reversar Liquidación",
    descripcion: "Revierte los pagos/cobros y devuelve la carrera a estado Abierta",
    comandoChat: "Abrir reversar liquidación",
    evento: { accion: "abrir_reversar" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "editar_jugadas",
    categoria: "apuestas",
    icono: "✏️",
    etiqueta: "Editar / Anular Jugadas",
    descripcion: "Corrige o anula jugadas guardadas de la carrera",
    comandoChat: "Abrir editar jugadas",
    evento: { accion: "abrir_editar_jugadas" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "historial_liquidaciones",
    categoria: "apuestas",
    icono: "📊",
    etiqueta: "Historial de Resultados",
    descripcion: "Abre el historial de carreras y liquidaciones",
    comandoChat: "Abrir historial de liquidaciones",
    evento: { accion: "abrir_historial" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "sincronizar_saldos",
    categoria: "apuestas",
    icono: "🔄",
    etiqueta: "Sincronizar Saldos",
    descripcion: "Recarga saldos comprometidos, avales y jugadas desde la base de datos",
    comandoChat: "Sincronizar saldos en vivo",
    evento: { accion: "recargar_saldos" },
  },
  // 2. Clientes, Saldos y Contabilidad
  {
    id: "nuevo_cliente_rapido",
    categoria: "clientes_contabilidad",
    icono: "👤+",
    etiqueta: "Nuevo Cliente Rápido",
    descripcion: "Registra un nuevo cliente con código, teléfono y aval autorizado",
    comandoChat: "Abrir nuevo cliente rápido",
    evento: { accion: "abrir_nuevo_cliente" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "gestion_rapida_saldos",
    categoria: "clientes_contabilidad",
    icono: "💵",
    etiqueta: "Gestión Rápida de Saldos",
    descripcion: "Incrementa o disminuye el saldo de un cliente con comprobante",
    comandoChat: "Abrir gestión rápida de saldos",
    evento: { accion: "abrir_saldo_rapido" },
    rutaRequerida: "/apuestas",
  },
  {
    id: "pago_ganador_ia",
    categoria: "clientes_contabilidad",
    icono: "💸",
    etiqueta: "Registrar Pago a Ganador",
    descripcion: "Inicia el registro contable de pago a ganador con asiento de partida doble",
    comandoChat: "Registrar pago a ganador",
  },
  {
    id: "cobro_cliente_ia",
    categoria: "clientes_contabilidad",
    icono: "💰",
    etiqueta: "Registrar Cobro / Depósito",
    descripcion: "Inicia el registro contable de cobro o depósito de cliente",
    comandoChat: "Le cobré a un cliente",
  },
  {
    id: "resumen_sistema_ia",
    categoria: "clientes_contabilidad",
    icono: "📈",
    etiqueta: "Informe Integral del Sistema",
    descripcion: "Consulta en vivo clientes, saldos a favor/contra, avales y carreras del día",
    comandoChat: "Resumen del sistema",
  },
  // 3. Portal de Clientes
  {
    id: "desbloquear_todo_portal",
    categoria: "portal",
    icono: "🔓",
    etiqueta: "Desbloquear Todas (Portal)",
    descripcion: "Habilita todas las modalidades de jugada en el Portal de Clientes",
    comandoChat: "Desbloquear todas las jugadas del portal",
  },
  {
    id: "bloquear_todo_portal",
    categoria: "portal",
    icono: "🔒",
    etiqueta: "Bloquear Todas (Portal)",
    descripcion: "Bloquea preventivamente todas las modalidades en el Portal de Clientes",
    comandoChat: "Bloquear todas las jugadas del portal",
  },
];

export function emitirEventoAccionAgente(detalle: { accion: string; [k: string]: unknown }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("agente-ia-accion", { detail: detalle }));
}

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
    // 1. Interpretación de dictado de pizarra o comando de Cambio de Pizarra
    const matchPizarra = mensaje.match(/(?:pizarra|llegada|orden)[:\s]+(\d+(?:\s*[-,\s]\s*\d+){1,6})/i);
    if (matchPizarra) {
      const nums = matchPizarra[1]
        .split(/[-,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const cmdPizarra = `Pizarra: ${nums.join(" - ")}`;
      return {
        respuesta:
          `🤖 **Acción Activada — Cambio de Pizarra Oficial**:\n` +
          `• **Orden de llegada detectado**: ${nums.map((n, i) => `${i + 1}º: #${n}`).join(" · ")}\n` +
          `• **Comando transferido al Agente de Pizarra**: \`${cmdPizarra}\`\n` +
          `Se ha abierto automáticamente el modal **🤖 Cambio de Pizarra** con la llegada cargada.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_agente_pizarra", comando: cmdPizarra },
      };
    }

    if (/\b(anular\s+pizarra|variaci[oó]n\s+de\s+pizarra|cambio\s+de\s+pizarra|abrir\s+cambio\s+de\s+pizarra|agente\s+de\s+pizarra)\b/i.test(textoLimpio)) {
      const esAnulacion = /anular\s+pizarra/i.test(textoLimpio);
      return {
        respuesta:
          `🤖 **Acción Ejecutada — 🤖 Cambio de Pizarra**:\n` +
          (esAnulacion
            ? `Se abrió el modal **🤖 Cambio de Pizarra** con la instrucción \`Anular pizarra por variación\` lista para ejecutar.`
            : `Se abrió el modal **🤖 Cambio de Pizarra** para registrar o rectificar el orden oficial de llegada.`),
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: {
          accion: "abrir_agente_pizarra",
          comando: esAnulacion ? "Anular pizarra por variación" : undefined,
        },
      };
    }

    // 1B. Acciones operativas directas de Apuestas y Modales
    if (/\b(abrir\s+liquidar\s+carrera|liquidar\s+carrera\s+actual|ir\s+a\s+liquidar\s+carrera)\b/i.test(textoLimpio)) {
      return {
        respuesta: `🏆 **Acción Ejecutada**: Abriendo el panel **Liquidar Carrera** en el módulo de Apuestas.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_liquidar_carrera" },
      };
    }

    if (/\b(abrir\s+reporte\s+(?:de\s+)?liquidaci[oó]n|abrir\s+reporte\s+final|ver\s+reporte\s+final)\b/i.test(textoLimpio)) {
      return {
        respuesta: `🧾 **Acción Ejecutada**: Abriendo el **Reporte Final de Liquidación** de la carrera activa.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_reporte_liquidacion" },
      };
    }

    if (/\b(recalcular\s+carrera(?:\s+actual)?|rehacer\s+liquidaci[oó]n)\b/i.test(textoLimpio)) {
      return {
        respuesta: `🔄 **Acción Ejecutada**: Ejecutando **Recalcular Carrera** contra la pizarra oficial vigente.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "recalcular_carrera" },
      };
    }

    if (/\b(abrir\s+reversar(?:\s+liquidaci[oó]n)?|reversar\s+liquidaci[oó]n|revertir\s+carrera)\b/i.test(textoLimpio)) {
      return {
        respuesta: `⏪ **Acción Ejecutada**: Abriendo confirmación de **Reversar Liquidación** de la carrera actual.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_reversar" },
      };
    }

    if (/\b(abrir\s+control\s+de\s+cruces|configurar\s+cruces)\b/i.test(textoLimpio)) {
      return {
        respuesta: `🔀 **Acción Ejecutada**: Abriendo el panel **Control de Cruces** de la carrera actual.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_control_cruces" },
      };
    }

    if (/\b(abrir\s+carga\s+r[aá]pida|procesador\s+de\s+texto)\b/i.test(textoLimpio)) {
      return {
        respuesta: `⚡ **Acción Ejecutada**: Abriendo **Carga Rápida (Texto)** en el módulo de Apuestas.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_carga_rapida" },
      };
    }

    if (/\b(abrir\s+editar\s+jugadas|editar\s+jugadas|anular\s+jugadas\s+guardadas)\b/i.test(textoLimpio)) {
      return {
        respuesta: `✏️ **Acción Ejecutada**: Abriendo el modal **Editar / Anular Jugadas Guardadas**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "disputa_jugada",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_editar_jugadas" },
      };
    }

    if (/\b(abrir\s+historial(?:\s+de\s+liquidaciones)?|ver\s+historial\s+de\s+resultados)\b/i.test(textoLimpio)) {
      return {
        respuesta: `📊 **Acción Ejecutada**: Abriendo el **Historial de Resultados y Liquidaciones**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "carrera_liquidacion",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_historial" },
      };
    }

    if (/\b(abrir\s+nuevo\s+cliente(?:\s+r[aá]pido)?|registrar\s+cliente\s+r[aá]pido)\b/i.test(textoLimpio)) {
      return {
        respuesta: `👤+ **Acción Ejecutada**: Abriendo el registro de **Nuevo Cliente Rápido**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_nuevo_cliente" },
      };
    }

    if (/\b(abrir\s+gesti[oó]n\s+r[aá]pida\s+de\s+saldos|ajuste\s+r[aá]pido\s+de\s+saldo)\b/i.test(textoLimpio)) {
      return {
        respuesta: `💵 **Acción Ejecutada**: Abriendo **Gestión Rápida de Saldos** con soporte de comprobante.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "ajuste_saldo",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_saldo_rapido" },
      };
    }

    if (/\b(sincronizar\s+saldos|recargar\s+saldos|actualizar\s+saldos\s+en\s+vivo)\b/i.test(textoLimpio)) {
      limpiarCacheClientes();
      limpiarCacheClientesVenta();
      return {
        respuesta: `🔄 **Acción Ejecutada**: Caché de clientes y saldos comprometidos sincronizada en vivo con la base de datos.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "ajuste_saldo",
        prioridadDetectada: "baja",
        eventoAccion: { accion: "recargar_saldos" },
      };
    }

    // 1C. Bloqueo / Desbloqueo del Portal de Clientes en Vivo
    if (/\b(desbloquear|habilitar|activar)\s+todas?\s+las?\s+jugadas?\b/i.test(textoLimpio)) {
      await guardarBloqueosJugadas({
        marcas: false,
        tablas_fijas: false,
        puestos: false,
        remates: false,
        dupletas: false,
        pollas: false,
      });
      return {
        respuesta:
          `🔓 **Acción Ejecutada en Portal de Clientes**:\n` +
          `Se han **desbloqueado todas las modalidades de jugada** (Marcas, Tablas Fijas, Puestos, Remates, Dupletas y Pollas).`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
      };
    }

    if (/\b(bloquear|cerrar|desactivar)\s+todas?\s+las?\s+jugadas?\b/i.test(textoLimpio)) {
      await guardarBloqueosJugadas({
        marcas: true,
        tablas_fijas: true,
        puestos: true,
        remates: true,
        dupletas: true,
        pollas: true,
      });
      return {
        respuesta:
          `🔒 **Acción Ejecutada en Portal de Clientes**:\n` +
          `Se han **bloqueado preventivamente todas las modalidades de jugada** en el Portal de Clientes.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
      };
    }

    const matchBloqueoModalidad = textoLimpio.match(
      /\b(bloquear|desbloquear|habilitar|cerrar)\s+(?:la\s+venta\s+de\s+|jugadas?\s+de\s+)?(marcas?|tablas?\s*fijas?|puestos?|remates?|dupletas?|pollas?)\b/i
    );
    if (matchBloqueoModalidad) {
      const verbo = matchBloqueoModalidad[1].toLowerCase();
      const bloquear = verbo === "bloquear" || verbo === "cerrar";
      const modRaw = matchBloqueoModalidad[2].toLowerCase();
      const claveMod: ModalidadPortalJugada = modRaw.startsWith("marca")
        ? "marcas"
        : modRaw.startsWith("tabla")
        ? "tablas_fijas"
        : modRaw.startsWith("puesto")
        ? "puestos"
        : modRaw.startsWith("remate")
        ? "remates"
        : modRaw.startsWith("dupleta")
        ? "dupletas"
        : "pollas";
      const actual = await leerBloqueosJugadas();
      await guardarBloqueosJugadas({
        ...actual,
        [claveMod]: bloquear,
      });
      const meta = MODALIDADES_PORTAL_META.find((m) => m.id === claveMod);
      return {
        respuesta:
          `${bloquear ? "🔒" : "🔓"} **Acción Ejecutada en Portal de Clientes**:\n` +
          `La modalidad **${meta?.icono ?? ""} ${meta?.etiqueta ?? claveMod}** ha sido **${bloquear ? "BLOQUEADA" : "DESBLOQUEADA"}** en tiempo real.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
      };
    }

    // 1D. Crear Cliente Rápido por Voz / Texto ("crear cliente PEDRO PEREZ aval 500 devolucion 10")
    const matchCrearCliente = mensaje.match(
      /\b(?:crear|registrar|nuevo)\s+cliente\s+([a-záéíóúñ0-9_\-\s]{2,35}?)(?=\s+(?:aval|saldo|devoluci[oó]n|tel[eé]fono|$))(.*)$/i
    );
    if (matchCrearCliente) {
      const nombreNuevo = matchCrearCliente[1].trim().toUpperCase();
      const resto = matchCrearCliente[2] ?? "";
      const matchAval = resto.match(/aval\s+(\d+(?:[.,]\d+)?)/i);
      const matchSaldo = resto.match(/saldo\s+(-?\d+(?:[.,]\d+)?)/i);
      const matchDev = resto.match(/devoluci[oó]n\s+(\d+(?:[.,]\d+)?)/i);
      const matchTel = resto.match(/tel[eé]fono\s+([+\d\s\-]{6,20})/i);

      const avalVal = matchAval ? Number(matchAval[1].replace(",", ".")) : 0;
      const saldoVal = matchSaldo ? Number(matchSaldo[1].replace(",", ".")) : 0;
      const devVal = matchDev ? Number(matchDev[1].replace(",", ".")) : 0;
      const telVal = matchTel ? matchTel[1].trim() : null;
      const seudonimo = nombreNuevo.replace(/\s+/g, "_").slice(0, 20);

      const creado = await crearCliente({
        nombre: nombreNuevo,
        seudonimo,
        telefono: telVal,
        aval: Number.isFinite(avalVal) ? avalVal : 0,
        saldo_actual: Number.isFinite(saldoVal) ? saldoVal : 0,
        devolucion: Number.isFinite(devVal) ? devVal : 0,
        modo_juego: "aval",
      });
      limpiarCacheClientes();
      limpiarCacheClientesVenta();
      return {
        respuesta: creado.ok
          ? `✅ **Cliente Creado en Vivo por el Agente de IA**:\n` +
            `• **Nombre / Código**: **${nombreNuevo}** (\`${seudonimo}\`)\n` +
            `• **Resultado / Saldo Inicial**: **${formatoMoneda("USD", Number.isFinite(saldoVal) ? saldoVal : 0)}**\n` +
            `• **Aval Autorizado**: **${formatoMoneda("USD", Number.isFinite(avalVal) ? avalVal : 0)}**\n` +
            `• **Devolución**: **${Number.isFinite(devVal) ? devVal : 0}%**`
          : `⚠️ No se pudo crear el cliente: ${creado.error ?? "error desconocido"}.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "ajuste_saldo",
        prioridadDetectada: "baja",
        eventoAccion: { accion: "recargar_saldos" },
      };
    }

    // 1E. Modificar Aval, Devolución o Saldo de un Cliente en Vivo
    const matchModificarCliente = mensaje.match(
      /\b(?:cambiar|asignar|modificar|actualizar|subir|bajar|incrementar|sumar|descontar|restar)\s+(aval|devoluci[oó]n|saldo)\s+(?:de\s+|del\s+cliente\s+)?([a-záéíóúñ0-9_\-\s]{2,35}?)\s+(?:a|en|por)\s+(-?\d+(?:[.,]\d+)?)/i
    );
    if (matchModificarCliente) {
      const verbo = mensaje.trim().split(/\s+/)[0].toLowerCase();
      const campoRaw = matchModificarCliente[1].toLowerCase();
      const buscado = matchModificarCliente[2].trim().toUpperCase();
      const valorNum = Number(matchModificarCliente[3].replace(",", "."));
      if (Number.isFinite(valorNum)) {
        const clientes = await listarClientes(true).catch(() => []);
        const objetivo = clientes.find((c) => {
          const nom = String(c.nombre ?? "").toUpperCase();
          const seu = String(c.seudonimo ?? "").toUpperCase();
          return nom === buscado || seu === buscado || nom.includes(buscado) || seu.includes(buscado);
        });
        if (objetivo) {
          if (campoRaw.startsWith("aval")) {
            await actualizarCliente(objetivo.id, { aval: Math.max(0, valorNum) });
          } else if (campoRaw.startsWith("devoluci")) {
            await actualizarCliente(objetivo.id, { devolucion: Math.max(0, Math.min(100, valorNum)) });
          } else {
            const saldoActual = Number(objetivo.saldo_actual ?? 0);
            const nuevoSaldo =
              verbo === "incrementar" || verbo === "sumar" || verbo === "subir"
                ? Math.round((saldoActual + Math.abs(valorNum)) * 100) / 100
                : verbo === "descontar" || verbo === "restar" || verbo === "bajar"
                ? Math.round((saldoActual - Math.abs(valorNum)) * 100) / 100
                : Math.round(valorNum * 100) / 100;
            await actualizarCliente(objetivo.id, { saldo_actual: nuevoSaldo });
          }
          limpiarCacheClientes();
          limpiarCacheClientesVenta();
          return {
            respuesta:
              `✅ **Actualización Ejecutada en Vivo por el Agente de IA**:\n` +
              `• **Cliente**: **${objetivo.seudonimo || objetivo.nombre}**\n` +
              `• **Campo actualizado**: **${campoRaw.toUpperCase()}** → **${campoRaw.startsWith("devoluci") ? `${valorNum}%` : formatoMoneda("USD", valorNum)}**`,
            resuelto: true,
            sugerenciaEscalamiento: false,
            categoriaDetectada: "ajuste_saldo",
            prioridadDetectada: "baja",
            eventoAccion: { accion: "recargar_saldos" },
          };
        }
      }
    }

    // 1F. Retirar Ejemplar en Vivo ("retirar ejemplar 4 en GULFSTREAM C5")
    const matchRetiro = mensaje.match(
      /\bretirar\s+(?:el\s+)?(?:ejemplar|caballo)\s+#?(\d+)\s+en\s+([a-záéíóúñ0-9\s]{2,30}?)\s+(?:c|carrera\s*)(\d+)\b/i
    );
    if (matchRetiro) {
      const numEjemplar = Number(matchRetiro[1]);
      const hip = matchRetiro[2].trim().toUpperCase();
      const numCarrera = Number(matchRetiro[3]);
      if (numEjemplar > 0 && numCarrera > 0) {
        const resRetiro = await aplicarRetirosCarrera({
          fecha: hoyLocal(),
          hipodromo: hip,
          carrera: numCarrera,
          numeros: [numEjemplar],
        });
        return {
          respuesta:
            `🐎🚫 **Retiro Oficial Ejecutado por el Agente de IA**:\n` +
            `• **Carrera**: **${hip} · C${numCarrera}** (${hoyLocal()})\n` +
            `• **Ejemplar retirado**: **#${numEjemplar}**\n` +
            `• **Jugadas actualizadas a RETIRADO**: ${resRetiro.reembolsos} jugada(s).`,
          resuelto: true,
          sugerenciaEscalamiento: false,
          categoriaDetectada: "carrera_liquidacion",
          prioridadDetectada: "baja",
          eventoAccion: { accion: "recargar_saldos" },
        };
      }
    }

    // 1G. Cambiar Grupo de Trabajo Activo ("cambiar a grupo ARGENTINA" o "activar grupo principal")
    const matchGrupo = mensaje.match(
      /\b(?:cambiar\s+a\s+grupo|activar\s+grupo|seleccionar\s+grupo)\s+([a-záéíóúñ0-9_\-\s]{2,35})/i
    );
    if (matchGrupo) {
      const nombreGrupo = matchGrupo[1].trim().toUpperCase();
      if (nombreGrupo === "PRINCIPAL" || nombreGrupo === "TODOS") {
        useAuthStore.getState().setGrupoActivo(null);
        return {
          respuesta: `🌐 **Grupo Activo Cambiado**: Ahora estás operando en **🌐 Principal («Todos los grupos»)**.`,
          resuelto: true,
          sugerenciaEscalamiento: false,
          categoriaDetectada: "duda_plataforma",
          prioridadDetectada: "baja",
          eventoAccion: { accion: "recargar_saldos" },
        };
      }
      const grupos = await listarGruposAdmin(true).catch(() => []);
      const encontrado = grupos.find((g) => String(g.nombre ?? "").toUpperCase().includes(nombreGrupo));
      if (encontrado) {
        useAuthStore.getState().setGrupoActivo(String(encontrado.id));
        return {
          respuesta: `🏢 **Grupo Activo Cambiado**: Ahora estás operando en el grupo **${encontrado.nombre.toUpperCase()}**.`,
          resuelto: true,
          sugerenciaEscalamiento: false,
          categoriaDetectada: "duda_plataforma",
          prioridadDetectada: "baja",
          eventoAccion: { accion: "recargar_saldos" },
        };
      }
    }

    // 1H. Navegación directa a cualquier módulo de la plataforma ("ir a ...", "abrir ...", "mostrar ...")
    if (/\b(ir\s+a|abrir|mostrar|ll[eé]vame\s+a|navegar\s+a|entrar\s+a)\b/i.test(textoLimpio)) {
      for (const mod of CATALOGO_RUTAS_PLATAFORMA) {
        if (mod.patrones.some((p) => p.test(textoLimpio))) {
          return {
            respuesta: `🧭 **Navegación Directa Activada**: Abriendo el módulo **${mod.icono} ${mod.etiqueta}** (\`${mod.ruta}\`).`,
            resuelto: true,
            sugerenciaEscalamiento: false,
            categoriaDetectada: "duda_plataforma",
            prioridadDetectada: "baja",
            rutaNavegacion: mod.ruta,
          };
        }
      }
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

    // 4. Si fue dictado por voz o comando directo de jugada, interpretarla y enviarla a Carga Rápida
    const esPreguntaExplicativa = /[¿?]|c[oó]mo|qu[eé]\s+significa|explica/i.test(textoLimpio);
    const matchJugadaDictada = mensaje.match(
      /\b(1P|2P|3P|4P|5P|6P|[1-6]Y[2-7]N|PP|10A\d+(?:[.,]\d+)?|WIN|PLACE|SHOW|WPS)\b/i
    );
    if (!esPreguntaExplicativa && matchJugadaDictada) {
      const tipoJugada = matchJugadaDictada[1].toUpperCase();
      const nums = mensaje.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
      return {
        respuesta:
          `🎙️ **Jugada Interpretada y Enviada a Carga Rápida**:\n` +
          `• **Texto recibido**: "${mensajeOriginal}"\n` +
          `• **Normalización Hípica**: \`${mensaje.toUpperCase()}\`\n` +
          `• **Modalidad detectada**: **${tipoJugada}**${nums.length ? ` · Valores numéricos: ${nums.join(", ")}` : ""}\n` +
          `• Se ha cargado automáticamente en **⚡ Carga Rápida (Texto)** dentro de **🐎🎲 Apuestas**.`,
        resuelto: true,
        sugerenciaEscalamiento: false,
        categoriaDetectada: "duda_plataforma",
        prioridadDetectada: "baja",
        rutaNavegacion: "/apuestas",
        eventoAccion: { accion: "abrir_carga_rapida", texto: mensaje.toUpperCase() },
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
