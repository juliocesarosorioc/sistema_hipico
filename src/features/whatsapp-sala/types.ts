export interface ContextoSala {
  sala: any;
  salaId: string;
  grupoId: string;
  codigoSala?: string;
  carreraAbierta: boolean;
  carreraActivaId: string | null;
  tiempoVencimientoMin: number;
  apuestaMinima: number;
  retirados: string[];
  topeMarcas?: number;
}

export interface ClienteResuelto {
  id: string;
  grupo_id?: string;
  nombre: string;
  seudonimo?: string | null;
  saldo_actual: number;
  saldo_retenido: number;
  saldo_disponible: number;
  libre: boolean;
  aval: number;
  whatsapp_jid?: string | null;
  whatsapp_lid?: string | null;
  codigo_pais?: string | null;
  telefono?: string | null;
  telefono_normalizado?: string | null;
  telefonoClienteCompleto?: string | null;
  nombreJugador: string;
  esOperadorRemitente?: boolean;
  rawCliente: any;
}

export type TipoJugadaIntent =
  | "PROPUESTA"
  | "PROPUESTA_BLOQUE"
  | "PROPUESTA_CON_RECORTE_SALDO"
  | "PROPUESTA_CON_CRUCE"
  | "SUGERENCIA_CRUCE"
  | "PROPUESTA_ERROR"
  | "CONCRECION"
  | "AMPLIACION_CUPO"
  | "RETIRO_PROPUESTA_ESPECIFICA"
  | "RETIRO_PROPUESTAS"
  | "CONSULTA_SALDO"
  | "CONSULTA_CUENTA"
  | "SOLICITUD_CAJERO"
  | "LISTADO_SALDOS"
  | "PLANO_OFICIAL"
  | "CIERRE_CARRERA"
  | "APERTURA_CARRERA"
  | "HIPODROMO_ACTIVO"
  | "RETIRO_EJEMPLAR"
  | "RECARGA_OPERADOR"
  | "AVAL_OPERADOR"
  | "SENTENCIA_PIZARRA"
  | "RECTIFICACION_PIZARRA"
  | "AJUSTE_SALDO_OPERADOR"
  | "ACEPTACION_SIN_CITA"
  | "CHARLA"
  | "RESPUESTA_ENTRENADA"
  | "PEDAGOGICO"
  | "SIN_SALDO"
  | "EXCESO_SALDO"
  | "APUESTA_MINIMA"
  | "CARRERA_CERRADA"
  | "FUERA_DE_TIEMPO"
  | "PROPUESTA_AGOTADA"
  | "PROPUESTA_SE_FUE"
  | "SIN_SALDO_PROPONENTE"
  | "NADA_AQUI"
  | "CONCRECION_ERROR"
  | "IGNORADO"
  | "IGNORADO_OPERADOR"
  | "NO_AUTORIZADO"
  | "REINTENTO_DESCARTADO"
  | "SIN_REGISTRO";

export interface JugadaParseada {
  esIntencionDeJugada: boolean;
  tipoIntent: TipoJugadaIntent;
  valido: boolean;
  modalidad?: string;
  ejemplarTexto?: string;
  caballosBandoA?: string[];
  caballosBandoB?: string[];
  esMatch?: boolean;
  proporcion?: string;
  monto: number;
  montoNormalizado?: number;
  accionProponente?: "JUEGA" | "CONSIGUE";
  jugadaEstandarizada?: string;
  excedioSaldo?: boolean;
  montoDisponibleValido?: number;
  bloques?: any[];
  esComandoOp?: boolean;
  comandoOpNombre?: string;
  comandoOpArgs?: any;
  respuestaDirecta?: any;
  motivoRechazo?: string;
  msgPrivadoBot?: string;
  mensajePedagogicoPrivado?: string;
  confianza?: number;
  requiereOperador?: boolean;
  sugerenciasUnClic?: string[];
  quotedPropuestaId?: string | null;
}

export interface ResultadoSaldo {
  saldoActual: number;
  aval: number;
  saldoRetenido: number;
  saldoDisponible: number;
  esLibre: boolean;
  montoSolicitado: number;
  montoEfectivo: number;
  excedioSaldo: boolean;
  alertaExceso?: {
    msgPublico: string;
    msgPrivado: string;
  } | null;
  alertaSinSaldo?: {
    msgPublico: string;
    msgPrivado: string;
  } | null;
  validoParaApostar: boolean;
}

export interface PayloadNotificacion {
  whatsapp_jid?: string | null;
  telefono?: string | null;
  mensaje: string;
  tipo?: string;
  cliente_id?: string | null;
}

export interface RespuestaGrupoItem {
  texto: string;
  quotedMsgId?: string | null;
  aceptanteId?: string | null;
  aceptanteNombre?: string | null;
  montoConcretado?: number;
  eraParcial?: boolean;
}

export interface ResultadoConcrecion {
  ok: boolean;
  tipo: string;
  nada_aqui?: boolean;
  error?: string;
  msg_publico?: string | null;
  msg_publico_bot?: string | null;
  respuestaPublica?: string | null;
  respuestaGrupo?: string | null;
  respuestas_grupo?: RespuestaGrupoItem[];
  mensajePrivadoAutor?: string | null;
  msg_privado_bot?: string | null;
  msg_privado_aceptante?: string | null;
  msg_privado_proponente?: string | null;
  alertaPrivada?: string | null;
  notificaciones_privadas?: PayloadNotificacion[];
  senderJid?: string | null;
  proponenteJid?: string | null;
  clienteTelefono?: string | null;
  datos?: {
    propuestaId?: string;
    montoConcretado?: number;
    montoPendienteAmpliacion?: number;
    remanenteDisponible?: number;
    excedioSaldo?: boolean;
    jugadoresAmpliados?: Array<{
      aceptanteId: string;
      aceptanteNombre: string;
      montoConcretado: number;
      montoAdicional: number;
      eraParcial: boolean;
      mensaje: string;
    }>;
  };
}

export interface RespaldoSalaDesconectada {
  groupJid?: string | null;
  groupNombre?: string | null;
  desconectadoEn?: string;
}

export interface ResultadoSentencia {
  ok: boolean;
  textoResultado: string;
  positivos: string[];
  negativos: string[];
  pizarra: string[];
  enviadoWhatsApp: boolean;
  error?: string;
}
