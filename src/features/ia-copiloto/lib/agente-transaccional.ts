/**
 * ============================================================================
 * AGENTE IA COPILOTO TRANSACCIONAL (`agente-transaccional.ts`)
 * ============================================================================
 *
 * Orquesta en tiempo real:
 *  1. Control de Estado de Carreras (Bloqueo Estricto Post-Cierre / Partida):
 *     Rechaza cualquier jugada, propuesta o aceptación P2P cuando la carrera
 *     está en estado `'CERRADA'`, `'LIQUIDADA'` o ya dio la partida con:
 *     `"⛔ Esta carrera ya se encuentra cerrada. No se permiten más jugadas ni propuestas."`
 *
 *  2. Máquina de Estados Conversacional (FSM) para Contabilidad (Cobros y Pagos):
 *     - Caso `"Le pagué a Pedro"` (`PAGO_A_GANADOR`):
 *       1. ¿A cuál cliente (Pedro)?
 *       2. ¿Cuál es el monto pagado?
 *       3. ¿Por qué método (Pago Móvil, Zelle, Transferencia)?
 *       4. ¿Cuál es la referencia bancaria y el comprobante (captura/imagen)?
 *     - Caso `"Le cobré a Pedro"` / `"Pedro depositó"` (`PAGO_DE_CLIENTE`):
 *       1. ¿Quién es el cliente (Pedro)?
 *       2. ¿Cuál es el monto recibido?
 *       3. ¿Por qué método y número de referencia?
 *       4. ¿Adjunto de comprobante?
 *     - Confirmación Obligatoria antes de persistir en BD y generar Partida Doble:
 *       `"¿Confirmas que deseas registrar este cobro/pago por [Monto] para [Cliente]? (Sí / No)"`
 *
 *  3. Incrementos y Descuentos de Saldo en Caliente con Notificación:
 *     - Si un usuario se queda sin fondos: `"⛔ [Nombre] sin saldo disponible."`
 *     - Si se ajusta una propuesta por límite de saldo: `"⚠️ Atento '[Nombre]', disponible [Monto]."`
 */

import {
  MENSAJE_CARRERA_CERRADA,
  esCarreraCerradaOEnPartida,
  verificarEstadoCarreraParaJugada,
  marcarEstadoCarreraEnMemoria,
  type EstadoOperativoCarrera,
} from "@/features/portal/lib/bloqueo-jugadas";
import {
  crearMesa,
  disponibleDe,
  fijarEstadoCarreraMesa,
  procesarMensajeMesa,
  actualizarSaldoMesaEnCaliente,
  frases,
  type EstadoMesa,
  type PropuestaPuesto,
  type ConcrecionPuesto,
} from "@/features/portal/lib/propuestas-puestos";
import {
  ejecutarOperacionContableConfirmada,
  type DireccionFlujoPago,
  type PagoComprobanteRow,
} from "@/features/contabilidad/lib/pagos-comprobantes";
import type { AsientoContableRegistrado } from "@/features/contabilidad/lib/plan-cuentas";

export { MENSAJE_CARRERA_CERRADA };

export const PREGUNTAS_PAGO_GANADOR = {
  cliente: "¿A cuál cliente (Pedro)?",
  monto: "¿Cuál es el monto pagado?",
  metodo: "¿Por qué método (Pago Móvil, Zelle, Transferencia)?",
  referenciaYComprobante: "¿Cuál es la referencia bancaria y el comprobante (captura/imagen)?",
} as const;

export const PREGUNTAS_COBRO_CLIENTE = {
  cliente: "¿Quién es el cliente (Pedro)?",
  monto: "¿Cuál es el monto recibido?",
  metodoYReferencia: "¿Por qué método y número de referencia?",
  comprobante: "¿Adjunto de comprobante?",
} as const;

export type PasoFlujoContable =
  | "ESPERANDO_CLIENTE"
  | "ESPERANDO_MONTO"
  | "ESPERANDO_METODO"
  | "ESPERANDO_METODO_Y_REFERENCIA"
  | "ESPERANDO_REFERENCIA_Y_COMPROBANTE"
  | "ESPERANDO_COMPROBANTE"
  | "ESPERANDO_CONFIRMACION";

export interface DatosRecolectadosContables {
  cliente?: string;
  monto?: number;
  metodo?: string;
  referencia?: string;
  comprobante?: string;
  banco?: string | null;
}

export interface FlujoContableEnCurso {
  tipo: DireccionFlujoPago;
  paso: PasoFlujoContable;
  datos: DatosRecolectadosContables;
}

export interface EstadoAgenteTransaccional {
  hipodromo: string;
  carrera: number;
  fecha?: string;
  estadoCarrera: EstadoOperativoCarrera;
  horaPartida?: string | Date | number | null;
  mesa: EstadoMesa;
  flujoContable: FlujoContableEnCurso | null;
  asientosRegistrados: AsientoContableRegistrado[];
  pagosRegistrados: PagoComprobanteRow[];
  notificacionesEmitidas: string[];
  historialMensajes: Array<{
    remitente: "usuario" | "agente";
    autor?: string;
    texto: string;
  }>;
}

export interface RespuestaTurnoAgente {
  estado: EstadoAgenteTransaccional;
  ok: boolean;
  bloqueado: boolean;
  tipoAccion:
    | "BLOQUEO_CARRERA_CERRADA"
    | "PREGUNTA_CONTABLE_PASO"
    | "SOLICITUD_CONFIRMACION_CONTABLE"
    | "REGISTRO_CONTABLE_COMPLETADO"
    | "OPERACION_CONTABLE_CANCELADA"
    | "JUGADA_O_PROPUESTA"
    | "CAMBIO_ESTADO_CARRERA"
    | "ACLARATORIA";
  mensaje: string;
  mensajes: string[];
  notificacionesSaldo: string[];
  preguntaConfirmacion?: string;
  asiento?: AsientoContableRegistrado;
  pago?: PagoComprobanteRow;
  propuesta?: PropuestaPuesto;
  concrecion?: ConcrecionPuesto;
  nuevoSaldoCliente?: number;
}

const fmtMonto = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

/**
 * Crea una sesión limpia del Agente IA Copiloto con los saldos iniciales y el estado de la carrera.
 */
export function crearSesionAgente(opciones?: {
  saldosIniciales?: Record<string, number>;
  hipodromo?: string;
  carrera?: number;
  fecha?: string;
  estadoCarrera?: EstadoOperativoCarrera;
  horaPartida?: string | Date | number | null;
}): EstadoAgenteTransaccional {
  const estadoCarrera = opciones?.estadoCarrera ?? "ABIERTA";
  const cerrada = esCarreraCerradaOEnPartida({
    estado: estadoCarrera,
    horaPartida: opciones?.horaPartida ?? null,
  });
  return {
    hipodromo: opciones?.hipodromo ?? "LA RINCONADA",
    carrera: opciones?.carrera ?? 1,
    fecha: opciones?.fecha,
    estadoCarrera,
    horaPartida: opciones?.horaPartida ?? null,
    mesa: crearMesa(opciones?.saldosIniciales ?? {}, {
      estadoCarrera,
      carreraCerrada: cerrada,
      horaPartida: opciones?.horaPartida ?? null,
    }),
    flujoContable: null,
    asientosRegistrados: [],
    pagosRegistrados: [],
    notificacionesEmitidas: [],
    historialMensajes: [],
  };
}

/**
 * Actualiza el estado de la carrera activa en la sesión del Agente y en la memoria central.
 */
export function actualizarEstadoCarreraAgente(
  estado: EstadoAgenteTransaccional,
  nuevoEstado: EstadoOperativoCarrera,
  opciones?: { horaPartida?: string | Date | number | null }
): EstadoAgenteTransaccional {
  const horaPartida = opciones?.horaPartida !== undefined ? opciones.horaPartida : estado.horaPartida;
  marcarEstadoCarreraEnMemoria({
    hipodromo: estado.hipodromo,
    carrera: estado.carrera,
    fecha: estado.fecha,
    estado: nuevoEstado,
    horaPartida: typeof horaPartida === "string" ? horaPartida : null,
  });
  return {
    ...estado,
    estadoCarrera: nuevoEstado,
    horaPartida,
    mesa: fijarEstadoCarreraMesa(estado.mesa, nuevoEstado, { horaPartida }),
  };
}

/**
 *Construye la pregunta de confirmación obligatoria antes de insertar en BD.
 */
export function construirPreguntaConfirmacionContable(
  tipo: DireccionFlujoPago,
  monto: number,
  cliente: string
): string {
  const etiqueta = tipo === "PAGO_A_GANADOR" ? "pago" : "cobro";
  return `¿Confirmas que deseas registrar este ${etiqueta} por ${fmtMonto(monto)} para ${cliente}? (Sí / No)`;
}

export function construirResumenConfirmacionContable(
  flujo: FlujoContableEnCurso
): { resumenTexto: string; pregunta: string } {
  const { tipo, datos } = flujo;
  const monto = Number(datos.monto ?? 0);
  const cliente = String(datos.cliente ?? "Cliente").trim();
  const metodo = String(datos.metodo ?? "Pago Móvil").trim();
  const referencia = String(datos.referencia ?? "S/R").trim();
  const comprobante = String(datos.comprobante ?? "Adjunto").trim();
  const titulo =
    tipo === "PAGO_A_GANADOR"
      ? "📋 *Resumen de Pago a Ganador (Egreso)*"
      : "📋 *Resumen de Cobro / Depósito de Cliente (Ingreso)*";

  const pregunta = construirPreguntaConfirmacionContable(tipo, monto, cliente);
  const preguntaDual = `¿Confirmas que deseas registrar este cobro/pago por ${fmtMonto(monto)} para ${cliente}? (Sí / No)`;

  const lineas = [
    titulo,
    `• Cliente: ${cliente}`,
    `• Monto: ${fmtMonto(monto)}`,
    `• Método: ${metodo}`,
    `• Referencia: ${referencia}`,
    `• Comprobante: ${comprobante}`,
    "",
    pregunta,
    `(${preguntaDual})`,
  ];

  return {
    resumenTexto: lineas.join("\n"),
    pregunta,
  };
}

// ============================================================================
// EXTRACTORES LINGÜÍSTICOS PARA EL FLUJO CONVERSACIONAL CONTABLE
// ============================================================================

const METODOS_CONOCIDOS: Array<{ regex: RegExp; canonico: string }> = [
  { regex: /\bpago\s*m[oó]vil\b|\bpm\b/i, canonico: "Pago Móvil" },
  { regex: /\bzelle\b/i, canonico: "Zelle" },
  { regex: /\btransferencia(?:\s+bancaria)?\b|\btransf\b/i, canonico: "Transferencia" },
  { regex: /\befectivo\b|\bcash\b|\bdivisas?\b/i, canonico: "Efectivo" },
  { regex: /\bbinance\b|\busdt\b|\bcripto\b/i, canonico: "USDT / Binance" },
];

function extraerMetodoPago(texto: string): string | undefined {
  for (const m of METODOS_CONOCIDOS) {
    if (m.regex.test(texto)) return m.canonico;
  }
  return undefined;
}

function extraerComprobanteDeTexto(texto: string, comprobanteAdjunto?: string | null): string | undefined {
  if (comprobanteAdjunto && String(comprobanteAdjunto).trim()) {
    return String(comprobanteAdjunto).trim();
  }
  const t = texto.trim();
  const mData = /(data:image\/[^\s,;]+)/i.exec(t);
  if (mData) return mData[1];
  const mUrl = /(https?:\/\/[^\s,;]+)/i.exec(t);
  if (mUrl) return mUrl[1];
  const mArchivo = /\b([a-z0-9_-]+\.(?:png|jpe?g|webp|pdf|gif))\b/i.exec(t);
  if (mArchivo) return mArchivo[1];
  const mEtiqueta = /\b(?:comprobante|captura|capture|imagen|foto|adjunto|recibo)\s*(?:[:=]|es)?\s*([a-z0-9_./:-]+)?/i.exec(
    t
  );
  if (mEtiqueta) {
    return mEtiqueta[1] ? mEtiqueta[1].trim() : "comprobante_adjunto.jpg";
  }
  return undefined;
}

function extraerReferenciaDeTexto(texto: string): string | undefined {
  const t = texto.trim();
  // "ref 123456", "referencia #998877", "nro 445566"
  const mExplicita = /\b(?:ref(?:erencia)?|nro|n[uú]mero|operaci[oó]n|comprobante)\s*#?\s*[:=]?\s*([A-Z0-9-]{4,25})\b/i.exec(
    t
  );
  if (mExplicita) return mExplicita[1];

  // Secuencia numérica de 4 o más dígitos que no sea parte de un archivo
  const sinArchivos = t.replace(/\b[a-z0-9_-]+\.(?:png|jpe?g|webp|pdf|gif)\b/gi, "");
  const mDigitos = /\b(\d{4,20})\b/.exec(sinArchivos);
  if (mDigitos) return mDigitos[1];

  return undefined;
}

function extraerMontoDeTexto(texto: string): number | undefined {
  const t = texto.trim();
  // Evitar confundir una referencia explícita con el monto
  const limpio = t
    .replace(/\b(?:ref(?:erencia)?|nro|n[uú]mero)\s*#?\s*[:=]?\s*[A-Z0-9-]{4,25}\b/gi, "")
    .replace(/\b[a-z0-9_-]+\.(?:png|jpe?g|webp|pdf|gif)\b/gi, "");

  const mMonto = /(?:por|monto|de|con|\$|bs\.?|usd)?\s*(\d+(?:[.,]\d{1,2})?)\b/i.exec(limpio);
  if (!mMonto) return undefined;
  const val = Number(mMonto[1].replace(",", "."));
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

function limpiarNombreCliente(raw: string): string | undefined {
  const limpio = raw
    .replace(
      /\b(?:por|con|de|del|monto|bs|usd|dolares|pago\s*m[oó]vil|zelle|transferencia|efectivo|ref(?:erencia)?|comprobante|captura|capture|imagen|adjunto)\b.*$/i,
      ""
    )
    .replace(/\b\d+(?:[.,]\d+)?\b.*$/, "")
    .replace(/^[\s:,-]+|[\s:.,?!-]+$/g, "")
    .trim();

  if (!limpio) return undefined;
  if (/^(?:un\s+cliente|cliente|ganador|alguien|el|la|los|las)$/i.test(limpio)) {
    return undefined;
  }
  return limpio;
}

/**
 * Detecta si el mensaje inicia una actividad contable ("Le pagué a Pedro",
 * "Le cobré a Pedro", "Pedro depositó") y extrae los parámetros iniciales presentes.
 */
export function detectarIntencionContableInicial(
  texto: string,
  comprobanteAdjunto?: string | null
): {
  esContable: boolean;
  tipo?: DireccionFlujoPago;
  datosIniciales?: DatosRecolectadosContables;
} {
  const t = texto.trim();
  if (!t) return { esContable: false };

  // 1. Caso "Le pagué a Pedro" / "Le pagué" / "Pagué a Pedro" / "Hice un pago"
  const mPagoA =
    /^(?:le\s+pagu[eé]|pagu[eé]|hic[e]\s+un\s+pago|registrar\s+pago|pagar\s+a\s+ganador)(?:\s+(?:a|al\s+cliente|al\s+ganador)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?))?(.*)$/i.exec(
      t
    );
  if (mPagoA) {
    const cliente = mPagoA[1] ? limpiarNombreCliente(mPagoA[1]) : undefined;
    const resto = mPagoA[2] || "";
    const metodo = extraerMetodoPago(resto);
    const referencia = extraerReferenciaDeTexto(resto);
    const comprobante = extraerComprobanteDeTexto(resto, comprobanteAdjunto);
    // Para monto en el texto inicial, quitar la referencia antes de buscar número
    const restoSinRef = referencia ? resto.replace(referencia, "") : resto;
    const monto = extraerMontoDeTexto(restoSinRef);

    return {
      esContable: true,
      tipo: "PAGO_A_GANADOR",
      datosIniciales: {
        cliente,
        monto,
        metodo,
        referencia,
        comprobante,
      },
    };
  }

  // 2. Caso "Le cobré a Pedro" / "Cobré a Pedro" / "Le cobré"
  const mCobroA =
    /^(?:le\s+cobr[eé]|cobr[eé]|registrar\s+cobro|recib[ií]\s+(?:un\s+)?(?:pago|abono|dep[oó]sito))(?:\s+(?:a|de|del\s+cliente)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?))?(.*)$/i.exec(
      t
    );
  if (mCobroA) {
    const cliente = mCobroA[1] ? limpiarNombreCliente(mCobroA[1]) : undefined;
    const resto = mCobroA[2] || "";
    const metodo = extraerMetodoPago(resto);
    const referencia = extraerReferenciaDeTexto(resto);
    const comprobante = extraerComprobanteDeTexto(resto, comprobanteAdjunto);
    const restoSinRef = referencia ? resto.replace(referencia, "") : resto;
    const monto = extraerMontoDeTexto(restoSinRef);

    return {
      esContable: true,
      tipo: "PAGO_DE_CLIENTE",
      datosIniciales: {
        cliente,
        monto,
        metodo,
        referencia,
        comprobante,
      },
    };
  }

  // 3. Caso "Pedro depositó" / "Pedro abonó" / "Depositó Pedro"
  const mDepositoSujeto =
    /^([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?)\s+(?:deposit[oó]|abon[oó]|transfiri[oó])(.*)$/i.exec(t);
  if (mDepositoSujeto) {
    const candidato = limpiarNombreCliente(mDepositoSujeto[1]);
    if (candidato && !/^(?:el|la|me|se|ya)$/i.test(candidato)) {
      const resto = mDepositoSujeto[2] || "";
      const metodo = extraerMetodoPago(resto);
      const referencia = extraerReferenciaDeTexto(resto);
      const comprobante = extraerComprobanteDeTexto(resto, comprobanteAdjunto);
      const restoSinRef = referencia ? resto.replace(referencia, "") : resto;
      const monto = extraerMontoDeTexto(restoSinRef);

      return {
        esContable: true,
        tipo: "PAGO_DE_CLIENTE",
        datosIniciales: {
          cliente: candidato,
          monto,
          metodo,
          referencia,
          comprobante,
        },
      };
    }
  }

  const mDepositoVerbo = /^(?:deposit[oó]|abon[oó])(?:\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+)?))?(.*)$/i.exec(
    t
  );
  if (mDepositoVerbo) {
    const cliente = mDepositoVerbo[1] ? limpiarNombreCliente(mDepositoVerbo[1]) : undefined;
    const resto = mDepositoVerbo[2] || "";
    const metodo = extraerMetodoPago(resto);
    const referencia = extraerReferenciaDeTexto(resto);
    const comprobante = extraerComprobanteDeTexto(resto, comprobanteAdjunto);
    const restoSinRef = referencia ? resto.replace(referencia, "") : resto;
    const monto = extraerMontoDeTexto(restoSinRef);

    return {
      esContable: true,
      tipo: "PAGO_DE_CLIENTE",
      datosIniciales: {
        cliente,
        monto,
        metodo,
        referencia,
        comprobante,
      },
    };
  }

  return { esContable: false };
}

/**
 * Determina el siguiente paso que falta en el flujo contable y devuelve la pregunta exacta.
 */
function evaluarSiguientePasoContable(flujo: FlujoContableEnCurso): {
  flujoActualizado: FlujoContableEnCurso;
  pregunta?: string;
  listoParaConfirmar: boolean;
} {
  const { tipo, datos } = flujo;

  if (tipo === "PAGO_A_GANADOR") {
    if (!datos.cliente) {
      return {
        flujoActualizado: { ...flujo, paso: "ESPERANDO_CLIENTE" },
        pregunta: PREGUNTAS_PAGO_GANADOR.cliente,
        listoParaConfirmar: false,
      };
    }
    if (!datos.monto || datos.monto <= 0) {
      return {
        flujoActualizado: { ...flujo, paso: "ESPERANDO_MONTO" },
        pregunta: PREGUNTAS_PAGO_GANADOR.monto,
        listoParaConfirmar: false,
      };
    }
    if (!datos.metodo) {
      return {
        flujoActualizado: { ...flujo, paso: "ESPERANDO_METODO" },
        pregunta: PREGUNTAS_PAGO_GANADOR.metodo,
        listoParaConfirmar: false,
      };
    }
    if (!datos.referencia || !datos.comprobante) {
      return {
        flujoActualizado: { ...flujo, paso: "ESPERANDO_REFERENCIA_Y_COMPROBANTE" },
        pregunta: PREGUNTAS_PAGO_GANADOR.referenciaYComprobante,
        listoParaConfirmar: false,
      };
    }
    return {
      flujoActualizado: { ...flujo, paso: "ESPERANDO_CONFIRMACION" },
      listoParaConfirmar: true,
    };
  }

  // PAGO_DE_CLIENTE ("Le cobré a Pedro" / "Pedro depositó")
  if (!datos.cliente) {
    return {
      flujoActualizado: { ...flujo, paso: "ESPERANDO_CLIENTE" },
      pregunta: PREGUNTAS_COBRO_CLIENTE.cliente,
      listoParaConfirmar: false,
    };
  }
  if (!datos.monto || datos.monto <= 0) {
    return {
      flujoActualizado: { ...flujo, paso: "ESPERANDO_MONTO" },
      pregunta: PREGUNTAS_COBRO_CLIENTE.monto,
      listoParaConfirmar: false,
    };
  }
  if (!datos.metodo || !datos.referencia) {
    return {
      flujoActualizado: { ...flujo, paso: "ESPERANDO_METODO_Y_REFERENCIA" },
      pregunta: PREGUNTAS_COBRO_CLIENTE.metodoYReferencia,
      listoParaConfirmar: false,
    };
  }
  if (!datos.comprobante) {
    return {
      flujoActualizado: { ...flujo, paso: "ESPERANDO_COMPROBANTE" },
      pregunta: PREGUNTAS_COBRO_CLIENTE.comprobante,
      listoParaConfirmar: false,
    };
  }
  return {
    flujoActualizado: { ...flujo, paso: "ESPERANDO_CONFIRMACION" },
    listoParaConfirmar: true,
  };
}

/**
 * Procesa la respuesta del operador cuando hay un flujo contable activo en la FSM.
 */
function absorberRespuestaEnFlujo(
  flujo: FlujoContableEnCurso,
  texto: string,
  comprobanteAdjunto?: string | null
): FlujoContableEnCurso {
  const t = texto.trim();
  const datos: DatosRecolectadosContables = { ...flujo.datos };

  if (flujo.paso === "ESPERANDO_CLIENTE") {
    const sinPrefijo = t.replace(/^(?:a|al\s+cliente|cliente|es|fue\s+a)\s+/i, "").trim();
    const cli = limpiarNombreCliente(sinPrefijo) || sinPrefijo;
    if (cli) datos.cliente = cli;
    const m = extraerMontoDeTexto(t);
    if (m && !datos.monto) datos.monto = m;
    const met = extraerMetodoPago(t);
    if (met && !datos.metodo) datos.metodo = met;
  } else if (flujo.paso === "ESPERANDO_MONTO") {
    const m = extraerMontoDeTexto(t);
    if (m) datos.monto = m;
    const met = extraerMetodoPago(t);
    if (met && !datos.metodo) datos.metodo = met;
    const ref = extraerReferenciaDeTexto(t.replace(String(m ?? ""), ""));
    if (ref && !datos.referencia) datos.referencia = ref;
  } else if (flujo.paso === "ESPERANDO_METODO") {
    const met = extraerMetodoPago(t) || t.replace(/^por\s+/i, "").trim();
    if (met) datos.metodo = met;
    const ref = extraerReferenciaDeTexto(t);
    if (ref && !datos.referencia) datos.referencia = ref;
    const comp = extraerComprobanteDeTexto(t, comprobanteAdjunto);
    if (comp && !datos.comprobante) datos.comprobante = comp;
  } else if (flujo.paso === "ESPERANDO_REFERENCIA_Y_COMPROBANTE") {
    const ref = extraerReferenciaDeTexto(t);
    const comp = extraerComprobanteDeTexto(t, comprobanteAdjunto);
    if (ref) {
      datos.referencia = ref;
    } else if (!datos.referencia && t) {
      // Si el usuario escribió un código alfanumérico directo
      const token = t.split(/[\s,]+/)[0];
      if (token) datos.referencia = token;
    }
    if (comp) {
      datos.comprobante = comp;
    } else if (datos.referencia && !/\bsin\s+comprobante\b/i.test(t)) {
      // En el paso 4 combinado ("¿Cuál es la referencia bancaria y el comprobante?"),
      // si suministró la referencia o texto de soporte, registramos el comprobante asociado.
      datos.comprobante = comprobanteAdjunto || "comprobante_captura.jpg";
    }
  } else if (flujo.paso === "ESPERANDO_METODO_Y_REFERENCIA") {
    const met = extraerMetodoPago(t);
    const ref = extraerReferenciaDeTexto(t);
    if (met) datos.metodo = met;
    if (ref) datos.referencia = ref;
    if (!datos.metodo && !ref && t) {
      datos.metodo = t;
    } else if (datos.metodo && !datos.referencia && t) {
      const limpioRef = t
        .replace(new RegExp(datos.metodo, "i"), "")
        .replace(/\b(?:ref(?:erencia)?|por|con|nro|#|:)\b/gi, "")
        .trim();
      if (limpioRef) datos.referencia = limpioRef;
    } else if (!datos.metodo && datos.referencia) {
      datos.metodo = "Pago Móvil";
    }
    const comp = extraerComprobanteDeTexto(t, comprobanteAdjunto);
    if (comp && !datos.comprobante) datos.comprobante = comp;
  } else if (flujo.paso === "ESPERANDO_COMPROBANTE") {
    const comp = extraerComprobanteDeTexto(t, comprobanteAdjunto) || (t ? t : undefined);
    if (comp) datos.comprobante = comp;
  }

  return {
    ...flujo,
    datos,
  };
}

function esRespuestaAfirmativa(texto: string): boolean {
  const t = texto.trim();
  return /^(?:s[ií]|s[ií]\s+confirmo|confirmo|confirmar|confirmado|ok|dale|aprobado|aprobar|correcto|exacto|proceder|registrar)$/i.test(
    t
  );
}

function esRespuestaNegativa(texto: string): boolean {
  const t = texto.trim();
  return /^(?:no|cancelar|anular|abortar|detener|salir|negativo|no\s+confirmar)$/i.test(t);
}

/**
 * Procesa un turno conversacional del operador o jugador en el Agente IA Copiloto.
 */
export async function procesarTurnoAgente(
  estado: EstadoAgenteTransaccional,
  entrada: {
    texto: string;
    jugador?: string;
    operador?: string;
    comprobanteUrl?: string | null;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
  }
): Promise<RespuestaTurnoAgente> {
  const texto = String(entrada.texto ?? "").trim();
  const autor = String(entrada.jugador || entrada.operador || "Operador").trim();

  let siguienteEstado: EstadoAgenteTransaccional = {
    ...estado,
    asientosRegistrados: [...estado.asientosRegistrados],
    pagosRegistrados: [...estado.pagosRegistrados],
    notificacionesEmitidas: [...estado.notificacionesEmitidas],
    historialMensajes: [
      ...estado.historialMensajes,
      { remitente: "usuario", autor, texto },
    ],
  };

  if (entrada.estadoCarrera) {
    siguienteEstado = actualizarEstadoCarreraAgente(siguienteEstado, entrada.estadoCarrera, {
      horaPartida: entrada.horaPartida,
    });
  } else if (entrada.cerrada === true) {
    siguienteEstado = actualizarEstadoCarreraAgente(siguienteEstado, "CERRADA", {
      horaPartida: entrada.horaPartida,
    });
  }

  // --------------------------------------------------------------------------
  // 1. SI HAY UN FLUJO CONTABLE ACTIVO EN LA FSM, CONTINUARLO PASO A PASO
  // --------------------------------------------------------------------------
  if (siguienteEstado.flujoContable) {
    const flujo = siguienteEstado.flujoContable;

    // Si el operador cancela explícitamente en cualquier paso
    if (esRespuestaNegativa(texto)) {
      siguienteEstado.flujoContable = null;
      const msgCancel =
        "❌ Operación contable cancelada. No se registró ningún movimiento en la base de datos.";
      siguienteEstado.historialMensajes.push({ remitente: "agente", texto: msgCancel });
      return {
        estado: siguienteEstado,
        ok: false,
        bloqueado: false,
        tipoAccion: "OPERACION_CONTABLE_CANCELADA",
        mensaje: msgCancel,
        mensajes: [msgCancel],
        notificacionesSaldo: [],
      };
    }

    // Paso de Confirmación Obligatoria
    if (flujo.paso === "ESPERANDO_CONFIRMACION") {
      if (esRespuestaAfirmativa(texto)) {
        const cliente = String(flujo.datos.cliente || "Cliente").trim();
        const monto = Number(flujo.datos.monto || 0);
        const metodo = String(flujo.datos.metodo || "Pago Móvil").trim();
        const referencia = String(flujo.datos.referencia || `REF-${Date.now()}`).trim();
        const comprobante = String(
          flujo.datos.comprobante || entrada.comprobanteUrl || "comprobante_verificado.jpg"
        ).trim();

        const saldoActual = disponibleDe(siguienteEstado.mesa, cliente);
        const resOp = await ejecutarOperacionContableConfirmada({
          clienteNombre: cliente,
          direccionFlujo: flujo.tipo,
          metodoPago: metodo,
          referenciaBancaria: referencia,
          monto,
          comprobanteUrl: comprobante,
          saldoActualCliente: saldoActual,
          operador: entrada.operador || autor,
        });

        if (!resOp.ok) {
          const msgErr = `⚠️ Error al registrar la operación contable: ${resOp.error}`;
          siguienteEstado.flujoContable = null;
          siguienteEstado.historialMensajes.push({ remitente: "agente", texto: msgErr });
          return {
            estado: siguienteEstado,
            ok: false,
            bloqueado: false,
            tipoAccion: "ACLARATORIA",
            mensaje: msgErr,
            mensajes: [msgErr],
            notificacionesSaldo: [],
          };
        }

        // Actualizar saldo en caliente en la Mesa del Agente
        const actMesa = actualizarSaldoMesaEnCaliente(siguienteEstado.mesa, {
          jugador: cliente,
          monto,
          operacion: flujo.tipo === "PAGO_A_GANADOR" ? "DESCUENTO" : "ABONO",
        });

        siguienteEstado.mesa = actMesa.estado;
        siguienteEstado.flujoContable = null;
        if (resOp.asiento) {
          siguienteEstado.asientosRegistrados.push(resOp.asiento);
        }
        if (resOp.pago) {
          siguienteEstado.pagosRegistrados.push(resOp.pago);
        }

        const notificacionesSaldo = [...actMesa.notificaciones];
        siguienteEstado.notificacionesEmitidas.push(...notificacionesSaldo);

        const etiquetaExito =
          flujo.tipo === "PAGO_A_GANADOR"
            ? `✅ Pago a ganador registrado en Partida Doble para ${actMesa.jugador} por ${fmtMonto(monto)} (${metodo} · Ref ${referencia}). Disponible actual: ${fmtMonto(actMesa.nuevoSaldo)}.`
            : `✅ Cobro/depósito registrado y acreditado en Partida Doble para ${actMesa.jugador} por ${fmtMonto(monto)} (${metodo} · Ref ${referencia}). Disponible actual: ${fmtMonto(actMesa.nuevoSaldo)}.`;

        const todosMensajes = [etiquetaExito, ...notificacionesSaldo];
        const textoFinal = todosMensajes.join("\n");
        siguienteEstado.historialMensajes.push({ remitente: "agente", texto: textoFinal });

        return {
          estado: siguienteEstado,
          ok: true,
          bloqueado: false,
          tipoAccion: "REGISTRO_CONTABLE_COMPLETADO",
          mensaje: textoFinal,
          mensajes: todosMensajes,
          notificacionesSaldo,
          asiento: resOp.asiento,
          pago: resOp.pago,
          nuevoSaldoCliente: actMesa.nuevoSaldo,
        };
      }

      // Si el usuario adjuntó un comprobante adicional antes de decir "Sí"
      const compExtra = extraerComprobanteDeTexto(texto, entrada.comprobanteUrl);
      if (compExtra) {
        flujo.datos.comprobante = compExtra;
      }
      const { resumenTexto, pregunta } = construirResumenConfirmacionContable(flujo);
      siguienteEstado.flujoContable = { ...flujo };
      siguienteEstado.historialMensajes.push({ remitente: "agente", texto: resumenTexto });
      return {
        estado: siguienteEstado,
        ok: true,
        bloqueado: false,
        tipoAccion: "SOLICITUD_CONFIRMACION_CONTABLE",
        mensaje: resumenTexto,
        mensajes: [resumenTexto],
        preguntaConfirmacion: pregunta,
        notificacionesSaldo: [],
      };
    }

    // Absorber el dato suministrado en el paso actual y preguntar el siguiente
    const flujoConDato = absorberRespuestaEnFlujo(flujo, texto, entrada.comprobanteUrl);
    const evaluacion = evaluarSiguientePasoContable(flujoConDato);
    siguienteEstado.flujoContable = evaluacion.flujoActualizado;

    if (evaluacion.listoParaConfirmar) {
      const { resumenTexto, pregunta } = construirResumenConfirmacionContable(
        evaluacion.flujoActualizado
      );
      siguienteEstado.historialMensajes.push({ remitente: "agente", texto: resumenTexto });
      return {
        estado: siguienteEstado,
        ok: true,
        bloqueado: false,
        tipoAccion: "SOLICITUD_CONFIRMACION_CONTABLE",
        mensaje: resumenTexto,
        mensajes: [resumenTexto],
        preguntaConfirmacion: pregunta,
        notificacionesSaldo: [],
      };
    }

    const preguntaPaso = evaluacion.pregunta!;
    siguienteEstado.historialMensajes.push({ remitente: "agente", texto: preguntaPaso });
    return {
      estado: siguienteEstado,
      ok: true,
      bloqueado: false,
      tipoAccion: "PREGUNTA_CONTABLE_PASO",
      mensaje: preguntaPaso,
      mensajes: [preguntaPaso],
      notificacionesSaldo: [],
    };
  }

  // --------------------------------------------------------------------------
  // 2. DETECTAR NUEVO FLUJO CONTABLE ("Le pagué a Pedro" / "Le cobré a Pedro")
  // --------------------------------------------------------------------------
  const intencionContable = detectarIntencionContableInicial(texto, entrada.comprobanteUrl);
  if (intencionContable.esContable && intencionContable.tipo) {
    const flujoInicial: FlujoContableEnCurso = {
      tipo: intencionContable.tipo,
      paso: "ESPERANDO_CLIENTE",
      datos: { ...(intencionContable.datosIniciales ?? {}) },
    };

    const evaluacion = evaluarSiguientePasoContable(flujoInicial);
    siguienteEstado.flujoContable = evaluacion.flujoActualizado;

    if (evaluacion.listoParaConfirmar) {
      const { resumenTexto, pregunta } = construirResumenConfirmacionContable(
        evaluacion.flujoActualizado
      );
      siguienteEstado.historialMensajes.push({ remitente: "agente", texto: resumenTexto });
      return {
        estado: siguienteEstado,
        ok: true,
        bloqueado: false,
        tipoAccion: "SOLICITUD_CONFIRMACION_CONTABLE",
        mensaje: resumenTexto,
        mensajes: [resumenTexto],
        preguntaConfirmacion: pregunta,
        notificacionesSaldo: [],
      };
    }

    const preguntaPaso = evaluacion.pregunta!;
    siguienteEstado.historialMensajes.push({ remitente: "agente", texto: preguntaPaso });
    return {
      estado: siguienteEstado,
      ok: true,
      bloqueado: false,
      tipoAccion: "PREGUNTA_CONTABLE_PASO",
      mensaje: preguntaPaso,
      mensajes: [preguntaPaso],
      notificacionesSaldo: [],
    };
  }

  // --------------------------------------------------------------------------
  // 3. COMANDOS DE CIERRE / APERTURA DE CARRERA POR CHAT
  // --------------------------------------------------------------------------
  if (/^(?:cerrar\s+carrera|carrera\s+cerrada|dieron\s+la\s+partida|partida\s+oficial)$/i.test(texto)) {
    siguienteEstado = actualizarEstadoCarreraAgente(siguienteEstado, "CERRADA");
    const msg = MENSAJE_CARRERA_CERRADA;
    siguienteEstado.historialMensajes.push({ remitente: "agente", texto: msg });
    return {
      estado: siguienteEstado,
      ok: true,
      bloqueado: true,
      tipoAccion: "CAMBIO_ESTADO_CARRERA",
      mensaje: msg,
      mensajes: [msg],
      notificacionesSaldo: [],
    };
  }

  // --------------------------------------------------------------------------
  // 4. CONTROL ESTRICTO DE ESTADO DE CARRERA ANTES DE JUGADAS / PROPUESTAS / P2P
  // --------------------------------------------------------------------------
  const verifCarrera = await verificarEstadoCarreraParaJugada({
    hipodromo: siguienteEstado.hipodromo,
    carrera: siguienteEstado.carrera,
    fecha: siguienteEstado.fecha,
    estado: entrada.estadoCarrera ?? siguienteEstado.estadoCarrera,
    cerrada: entrada.cerrada ?? siguienteEstado.mesa.carreraCerrada,
    horaPartida: entrada.horaPartida ?? siguienteEstado.horaPartida,
    ahora: entrada.ahora,
  });

  if (!verifCarrera.permitida || verifCarrera.cerrada) {
    siguienteEstado = actualizarEstadoCarreraAgente(siguienteEstado, "CERRADA");
    siguienteEstado.historialMensajes.push({
      remitente: "agente",
      texto: MENSAJE_CARRERA_CERRADA,
    });
    return {
      estado: siguienteEstado,
      ok: false,
      bloqueado: true,
      tipoAccion: "BLOQUEO_CARRERA_CERRADA",
      mensaje: MENSAJE_CARRERA_CERRADA,
      mensajes: [MENSAJE_CARRERA_CERRADA],
      notificacionesSaldo: [],
    };
  }

  // --------------------------------------------------------------------------
  // 5. PROCESAR PROPUESTAS Y CONCRECIONES P2P CON CONTROL DE SALDO EN CALIENTE
  // --------------------------------------------------------------------------
  const resMesa = procesarMensajeMesa(siguienteEstado.mesa, {
    jugador: autor,
    texto,
    formatoConIcono: true,
  });

  siguienteEstado.mesa = resMesa.estado;
  const notificacionesSaldo: string[] = [];

  for (const m of resMesa.mensajes) {
    if (m.startsWith("⛔") || m.startsWith("⚠️") || m.includes("sin saldo disponible") || m.includes("Atento")) {
      notificacionesSaldo.push(m);
    }
  }

  // Si tras publicar o concretar una jugada el jugador quedó exactamente en 0, notificar también
  const saldoRestante = disponibleDe(siguienteEstado.mesa, autor);
  if (resMesa.ok && saldoRestante <= 0) {
    const alertaCero = frases.sinSaldoConIcono(autor);
    if (!notificacionesSaldo.includes(alertaCero)) {
      notificacionesSaldo.push(alertaCero);
    }
  }

  siguienteEstado.notificacionesEmitidas.push(...notificacionesSaldo);

  const mensajesSalida =
    resMesa.mensajes.length > 0
      ? [...resMesa.mensajes]
      : resMesa.propuesta
        ? [
            `✅ Propuesta #${resMesa.propuesta.id} publicada: ${resMesa.propuesta.autor} (${resMesa.propuesta.rol}) ${resMesa.propuesta.jugada} ej. ${resMesa.propuesta.caballos} por ${fmtMonto(resMesa.propuesta.montoOriginal)}. Disponible: ${fmtMonto(saldoRestante)}.`,
          ]
        : resMesa.concrecion
          ? [
              `🤝 Jugada concretada: ${resMesa.concrecion.jugador} amarra ${fmtMonto(resMesa.concrecion.monto)} con ${resMesa.concrecion.autor} en ${resMesa.concrecion.jugada} (${resMesa.concrecion.caballos}). Disponible: ${fmtMonto(saldoRestante)}.`,
            ]
          : [];

  for (const n of notificacionesSaldo) {
    if (!mensajesSalida.includes(n)) {
      mensajesSalida.push(n);
    }
  }

  const textoRespuesta = mensajesSalida.join("\n");
  siguienteEstado.historialMensajes.push({ remitente: "agente", texto: textoRespuesta });

  return {
    estado: siguienteEstado,
    ok: resMesa.ok,
    bloqueado: resMesa.bloqueado,
    tipoAccion: resMesa.ok || resMesa.bloqueado ? "JUGADA_O_PROPUESTA" : "ACLARATORIA",
    mensaje: textoRespuesta,
    mensajes: mensajesSalida,
    notificacionesSaldo,
    propuesta: resMesa.propuesta,
    concrecion: resMesa.concrecion,
    nuevoSaldoCliente: saldoRestante,
  };
}
