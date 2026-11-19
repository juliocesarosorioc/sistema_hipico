/**
 * Data de estudio del lenguaje humanizado del bot.
 * Se usa para enseñar forma extrañas detectadas en `registro_revision_llm`
 * y para precargar el diccionario de aprendizaje sin depender de SQL manual.
 */
export interface TerminoLenguajeBot {
  termino_original: string;
  jugada_corregida: string;
  intencion_detectada: string;
  motivo_rechazo: string;
  nivel_confianza: number;
}

export const LENGUAJE_HUMANIZADO_SEED: TerminoLenguajeBot[] = [
  {
    termino_original: "voy todo",
    jugada_corregida: "Juego Todo",
    intencion_detectada: "APOSTAR_TODO_SALDO",
    motivo_rechazo: "LENGUAJE_HUMANIZADO",
    nivel_confianza: 0.98,
  },
  {
    termino_original: "le meto todo",
    jugada_corregida: "Juego Todo",
    intencion_detectada: "APOSTAR_TODO_SALDO",
    motivo_rechazo: "LENGUAJE_HUMANIZADO",
    nivel_confianza: 0.94,
  },
  {
    termino_original: "le voy a meter 30",
    jugada_corregida: "Juego 30",
    intencion_detectada: "APOSTAR_MONTO",
    motivo_rechazo: "LENGUAJE_HUMANIZADO",
    nivel_confianza: 0.92,
  },
  {
    termino_original: "ponganle 30",
    jugada_corregida: "Juego 30",
    intencion_detectada: "APOSTAR_MONTO",
    motivo_rechazo: "LENGUAJE_HUMANIZADO",
    nivel_confianza: 0.9,
  },
  {
    termino_original: "30k",
    jugada_corregida: "30.000",
    intencion_detectada: "MONTO_ABREVIADO",
    motivo_rechazo: "ABREVIATURA_MIL",
    nivel_confianza: 1,
  },
  {
    termino_original: "30mil",
    jugada_corregida: "30.000",
    intencion_detectada: "MONTO_ABREVIADO",
    motivo_rechazo: "ABREVIATURA_MIL",
    nivel_confianza: 1,
  },
  {
    termino_original: "30 mil",
    jugada_corregida: "30.000",
    intencion_detectada: "MONTO_ABREVIADO",
    motivo_rechazo: "ABREVIATURA_MIL",
    nivel_confianza: 1,
  },
  {
    termino_original: "j 30",
    jugada_corregida: "J 30",
    intencion_detectada: "CONCRETAR_MONTO",
    motivo_rechazo: "CONCRECION_ABREVIADA",
    nivel_confianza: 1,
  },
  {
    termino_original: "por 30",
    jugada_corregida: "J 30",
    intencion_detectada: "CONCRETAR_MONTO",
    motivo_rechazo: "CONCRECION_ABREVIADA",
    nivel_confianza: 0.9,
  },
  {
    termino_original: "ponte",
    jugada_corregida: "Ponte",
    intencion_detectada: "CONCRETAR_PROPUESTA",
    motivo_rechazo: "VERBO_CONCRECION",
    nivel_confianza: 0.97,
  },
  {
    termino_original: "se fue",
    jugada_corregida: "Retiro de jugadas abiertas",
    intencion_detectada: "RETIRAR_PROPUESTAS",
    motivo_rechazo: "COMANDO_RETIRO",
    nivel_confianza: 0.96,
  },
  {
    termino_original: "sf",
    jugada_corregida: "Retiro de jugadas abiertas",
    intencion_detectada: "RETIRAR_PROPUESTAS",
    motivo_rechazo: "COMANDO_RETIRO",
    nivel_confianza: 0.95,
  },
  {
    termino_original: "no va mas",
    jugada_corregida: "Cerrar carrera",
    intencion_detectada: "CERRAR_CARRERA",
    motivo_rechazo: "COMANDO_CIERRE",
    nivel_confianza: 0.95,
  },
  {
    termino_original: "carrera trancada",
    jugada_corregida: "Cerrar carrera",
    intencion_detectada: "CERRAR_CARRERA",
    motivo_rechazo: "COMANDO_CIERRE",
    nivel_confianza: 0.93,
  },
  {
    termino_original: "a premio",
    jugada_corregida: "A Premio",
    intencion_detectada: "JUGADA_A_PREMIO",
    motivo_rechazo: "TERMINO_INSTITUCIONAL",
    nivel_confianza: 1,
  },
  {
    termino_original: "pelo a pelo",
    jugada_corregida: "PP",
    intencion_detectada: "PARIDAD",
    motivo_rechazo: "TERMINO_INSTITUCIONAL",
    nivel_confianza: 0.97,
  },
  {
    termino_original: "por saldo de",
    jugada_corregida: "Concreción por saldo parcial",
    intencion_detectada: "SALDO_PARCIAL",
    motivo_rechazo: "SALDO_PARCIAL",
    nivel_confianza: 0.96,
  },
];
