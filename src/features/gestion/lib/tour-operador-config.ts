/**
 * ============================================================================
 * CONFIGURACIÓN CENTRALIZADA Y ADAPTABLE: TOUR OPERATIVO PASO A PASO
 * ============================================================================
 * Permite agregar, eliminar o reordenar pasos fácilmente para reflejar nuevas
 * pantallas, botones o flujos sin romper la lógica del recorrido.
 */

export interface PasoTourOperador {
  id: string;
  num: number;
  titulo: string;
  subtitulo: string;
  icono: string;
  /** Selector CSS del elemento a resaltar (con efecto spotlight) en la interfaz */
  selector?: string;
  posicion?: "bottom" | "top" | "left" | "right" | "center";
  badge: string;
  color: string;
  bgGradiente: string;
  explicacion: string[];
  acciones: string[];
  tip: string;
  /** Simulación o atajo que ilustra la operación en la tarjeta */
  atajo?: string;
}

export const PASOS_TOUR_OPERADOR: PasoTourOperador[] = [
  {
    id: "fecha_registro",
    num: 1,
    titulo: "1 · Fecha de Registro",
    subtitulo: "Establece el día operativo de las carreras y apuestas",
    icono: "📅",
    selector: '[data-tour="tour-fecha"]',
    posicion: "bottom",
    badge: "Paso 1: Calendario",
    color: "text-amber-400",
    bgGradiente: "from-amber-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "La fecha seleccionada determina qué carreras, tablas fijas y apuestas se muestran en pantalla.",
      "Por defecto, el sistema se inicializa con la fecha local de hoy (horario oficial de la sala).",
      "Si vas a registrar jugadas para una jornada de mañana o del fin de semana, cámbiala primero aquí para vincular los tickets al día correcto."
    ],
    acciones: [
      "Haz clic en el campo '1 · Fecha 📅'.",
      "Selecciona la fecha del calendario o escribe directamente (formato AAAA-MM-DD).",
      "El sistema recargará automáticamente los hipódromos con actividad para ese día."
    ],
    tip: "Nunca cargues jugadas en vivo con una fecha desfasada; la fecha es la clave contable que agrupa las liquidaciones semanales y diarias.",
    atajo: "Hoy Local automático"
  },
  {
    id: "seleccion_hipodromo",
    num: 2,
    titulo: "2 · Selección de Hipódromo",
    subtitulo: "Elige o busca el óvalo de carreras activo",
    icono: "🗺️",
    selector: '[data-tour="tour-hipodromo"]',
    posicion: "bottom",
    badge: "Paso 2: Hipódromo",
    color: "text-blue-400",
    bgGradiente: "from-blue-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Muestra el catálogo oficial de hipódromos activos (nacionales e internacionales).",
      "Incluye buscador predictivo por nombre propio (ej. La Rinconada, Gulfstream Park, Valencia, Churchill Downs).",
      "Al seleccionar el hipódromo, el sistema consulta el registro central para saber qué carreras ya están programadas para ese día."
    ],
    acciones: [
      "Escribe las primeras letras del hipódromo en el buscador desplegable.",
      "Selecciona el hipódromo deseado de la lista filtrada.",
      "El semáforo de carreras inferior se actualizará de inmediato con las carreras del óvalo."
    ],
    tip: "El catálogo de hipódromos es estrictamente controlado: el extractor de gaceta no puede crear hipódromos nuevos para evitar duplicaciones o errores ortográficos.",
    atajo: "Filtro en tiempo real"
  },
  {
    id: "seleccion_carrera",
    num: 3,
    titulo: "3 · Selección de Carrera (Precargada vs Manual)",
    subtitulo: "Elige la carrera en el semáforo o activa el modo manual si es de último minuto",
    icono: "🚦",
    selector: '[data-tour="tour-carrera-semaforo"]',
    posicion: "bottom",
    badge: "Paso 3: Carrera Activa",
    color: "text-emerald-400",
    bgGradiente: "from-emerald-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Semáforo de Carreras: Cada botón representa una carrera (C1, C2, C3...).",
      "• Si la carrera está precargada (con gaceta o programa): El botón aparece activo y al seleccionarlo se cargan de inmediato sus ejemplares participantes.",
      "• Si la carrera NO está precargada: Puedes activar la casilla '✍️ Modo Manual' para digitar el número de carrera y cargar boletos sin que el sistema te bloquee esperando una gaceta."
    ],
    acciones: [
      "Haz clic sobre el número de carrera en el semáforo (ej. C1).",
      "Si la carrera no aparece en el semáforo, marca la casilla '✍️ Modo Manual'.",
      "Indica el número de carrera manualmente en el selector numérico."
    ],
    tip: "Los colores del semáforo te alertan: Gris = sin jugadas, Azul = con jugadas activas, Verde = cerrada/liquidada.",
    atajo: "Click directo en C1..CN"
  },
  {
    id: "ejemplares_retirados",
    num: 4,
    titulo: "4 · Gestión de Ejemplares Retirados",
    subtitulo: "Marca retiros desde el padrón con un clic o escríbelos en el campo de texto",
    icono: "⛔",
    selector: '[data-tour="tour-retirados"]',
    posicion: "bottom",
    badge: "Paso 4: Retirados",
    color: "text-rose-400",
    bgGradiente: "from-rose-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Un caballo retirado jamás debe generar pérdidas ni cobros indebidos. Tienes dos formas rápidas de marcarlo:",
      "1. Si los caballos están precargados: En el panel de '🐎 Ejemplares Inscritos', haz clic sobre el número del caballo; se marcará en rojo con raya como retirado.",
      "2. Si no están precargados o prefieres teclado: Escribe los números en el campo 'Retirados · C{carrera}' separados por coma (ej. '2,5') y presiona '⛔ Aplicar' (o pulsa Enter)."
    ],
    acciones: [
      "Escribe los números separados por coma en el campo 'Retirados' (ej. 3, 7).",
      "Presiona '⛔ Aplicar' para propagar el retiro a toda la base de datos.",
      "O haz clic directo sobre la ficha del ejemplar en el panel lateral."
    ],
    tip: "Si un cliente ya tenía una jugada sobre ese caballo antes de retirarse, el sistema la convertirá automáticamente en Empate (resultado 0.00 / devolución de capital) al liquidar.",
    atajo: "Enter en input Retirados"
  },
  {
    id: "ajuste_comision",
    num: 5,
    titulo: "5 · Comisión de la Carrera (COM %)",
    subtitulo: "Configura el porcentaje que la casa retiene sobre las ganancias",
    icono: "⚙️",
    selector: '[data-tour="tour-comision"]',
    posicion: "bottom",
    badge: "Paso 5: Comisión",
    color: "text-cyan-400",
    bgGradiente: "from-cyan-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "El campo 'COM %' define el porcentaje que la taquilla/grupo cobra sobre la ganancia bruta de las jugadas ganadoras.",
      "Por defecto toma la comisión oficial configurada para el grupo de venta (ej. 5% o 10%).",
      "Puedes dejar el valor por defecto o modificarlo puntualmente para esta carrera según promociones o acuerdos de banca."
    ],
    acciones: [
      "Verifica el porcentaje visible en el campo 'COM %'.",
      "Si necesitas ajustarlo, escribe el nuevo porcentaje (ej. 7).",
      "El recálculo de premios netos se aplicará de forma automática con este porcentaje."
    ],
    tip: "La comisión solo se deduce de la ganancia limpia del jugador ganador, nunca del capital que apostó.",
    atajo: "COM % por grupo"
  },
  {
    id: "modalidad_tiempo",
    num: 6,
    titulo: "6 · Modalidad de Tiempo: En Vivo vs Adelantada",
    subtitulo: "Define si la apuesta es para la carrera inmediata o para una carrera futura",
    icono: "⏱️",
    selector: '[data-tour="tour-modalidad-tiempo"]',
    posicion: "bottom",
    badge: "Paso 6: Tiempo de Juego",
    color: "text-yellow-400",
    bgGradiente: "from-yellow-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "El conmutador de tiempo te permite separar contable y visualmente dos tipos de apuestas:",
      "• ⚡ En Vivo: La jugada es para la carrera que está por disputarse en minutos. Entra a la grilla activa de la carrera en curso.",
      "• ⏳ Adelantada (Pre-jugada): La jugada es tomada con anticipación para una carrera posterior del mismo día o para otro día (ej. jugadas de la noche, clásicos anticipados).",
      "Las jugadas adelantadas quedan protegidas y etiquetadas para que no se liquiden accidentalmente si se corre una carrera previa."
    ],
    acciones: [
      "Haz clic en el selector '⚡ En Vivo / ⏳ Adelantada'.",
      "Selecciona '⚡ En Vivo' para carreras inmediatas.",
      "Selecciona '⏳ Adelantada' para jugadas futuras."
    ],
    tip: "El reporte de WhatsApp separa automáticamente las jugadas 'En Vivo' de las 'Adelantadas' para que los jugadores en el grupo de chat no se confundan.",
    atajo: "Toggle 1 toque"
  },
  {
    id: "confirmacion_contexto",
    num: 7,
    titulo: "7 · Confirmación Visual de Carrera e Hipódromo",
    subtitulo: "Verificación de seguridad antes de emitir boletos",
    icono: "🎯",
    selector: '[data-tour="tour-confirmacion-contexto"]',
    posicion: "bottom",
    badge: "Paso 7: Confirmar",
    color: "text-purple-400",
    bgGradiente: "from-purple-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "A la derecha de la barra de Carga Individual, la taquilla muestra en letras claras y visibles la carrera activa:",
      "Ejemplo: 'C1 · LA RINCONADA · Retirados: 2, 5'.",
      "Es el indicador de seguridad que te confirma que no estás cargando por error un boleto en un hipódromo o carrera incorrectos."
    ],
    acciones: [
      "Echa un vistazo rápido a la etiqueta a la derecha antes de registrar.",
      "Confirma que el número de carrera y el nombre del hipódromo coincidan con la orden del cliente."
    ],
    tip: "Siempre acostumbra la vista a mirar esta franja antes de presionar Guardar.",
    atajo: "Verificación visual"
  },
  {
    id: "carga_rapida_taquilla",
    num: 8,
    titulo: "8 · Carga Rápida y Envío a Taquilla",
    subtitulo: "Ingreso por comando rápido, validación de aval y emisión a la base de datos",
    icono: "⚡",
    selector: '[data-tour="tour-carga-rapida-taquilla"]',
    posicion: "top",
    badge: "Paso 8: Emisión",
    color: "text-indigo-400",
    bgGradiente: "from-indigo-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Aquí opera la velocidad del operador de taquilla:",
      "1. En el campo de comando rápido escribe la jugada en nomenclatura natural:",
      "   • '100 2n' (100 al segundo caballo)",
      "   • '50 3p' (50 a tercero)",
      "   • '200 1 y 2n' (200 combinados a 1º y 2º)",
      "2. El motor valida en 15 milisegundos si el cliente tiene saldo o aval autorizado.",
      "3. Si todo está correcto, presiona '⚡ Normalizar' y luego '💾 Guardar y Registrar en Taquilla'.",
      "La jugada se almacena en la tabla de tickets con estado 'Pendiente' y queda registrada de forma oficial."
    ],
    acciones: [
      "Escribe el comando en la grilla (ej. 100 2n).",
      "Selecciona el Cliente 1 (apostador) y Cliente 2 (dador si aplica).",
      "Presiona Enter o el botón '💾 Guardar y Registrar en Taquilla'."
    ],
    tip: "Si el cliente sobrepasa su límite de aval o crédito, el sistema te avisará con una alerta y no te dejará emitir la jugada a menos que sea cliente 'Libre'.",
    atajo: "Enter para agregar fila"
  },
  {
    id: "preliminar_prejugadas",
    num: 9,
    titulo: "9 · Preliminar y Reportes Pre-Carrera WhatsApp",
    subtitulo: "Visualiza el plano de compromisos y compártelo antes de la partida",
    icono: "📋",
    selector: '[data-tour="tour-preliminar-prejugadas"]',
    posicion: "top",
    badge: "Paso 9: Pre-Carrera",
    color: "text-teal-400",
    bgGradiente: "from-teal-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Antes de que suene la campana de largada, debes enviar a los jugadores el resumen de lo que tienen apostado:",
      "• Botón '📋 Preliminar' (o atajo Ctrl+Q): Abre el plano completo con las jugadas organizadas por caballo, cliente y monto.",
      "• Botón '📋 Ver Reporte de Prejugadas (WhatsApp + Imagen)': Genera el mensaje formateado con emojis listo para copiar o enviar directamente al grupo de WhatsApp.",
      "Incluye los números de dorsal, nombres de clientes y el desglose de jugadas en vivo y adelantadas."
    ],
    acciones: [
      "Presiona '📋 Preliminar' (Ctrl+Q) para revisar en pantalla.",
      "O haz clic en '📋 Ver Reporte de Prejugadas (WhatsApp)'.",
      "Copia el texto generado o usa el botón de envío a WhatsApp."
    ],
    tip: "Publicar el preliminar antes de la largada da total transparencia a tu sala y evita reclamos posteriores.",
    atajo: "Ctrl+Q"
  },
  {
    id: "liquidar_carrera",
    num: 10,
    titulo: "10 · Carga de Resultados y Liquidación",
    subtitulo: "Ingresa el orden oficial (1º al 5º), empates y cierra la carrera",
    icono: "🏆",
    selector: '[data-tour="tour-liquidar-carrera"]',
    posicion: "bottom",
    badge: "Paso 10: Liquidación",
    color: "text-amber-400",
    bgGradiente: "from-amber-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Cuando los jueces confirman la pizarra oficial:",
      "1. Presiona el botón verde '🏆 Liquidar Carrera' (o pulsa Ctrl+Y / Ctrl+R).",
      "2. Ingresa los dorsales del 1º al 5º lugar (ej. 4 - 2 - 8 - 1 - 6).",
      "3. Si hubo empate (Dead Heat), marca la casilla 'Empate' en la posición respectiva.",
      "4. Ingresa el dividendo oficial por cada modalidad.",
      "5. Presiona 'Confirmar Resultados y Liquidar': En ese instante el motor acredita los premios netos a los ganadores y actualiza sus saldos."
    ],
    acciones: [
      "Haz clic en '🏆 Liquidar Carrera' (Ctrl+Y).",
      "Digita los números ganadores en la pizarra.",
      "Verifica los dividendos y confirma la liquidación."
    ],
    tip: "La liquidación es atómica e inmediata: ningún cliente queda con saldo a medias ni duplicado.",
    atajo: "Ctrl+Y / Ctrl+R"
  },
  {
    id: "editar_reliquidar",
    num: 11,
    titulo: "11 · Edición de Jugadas y Reliquidación",
    subtitulo: "Corrige reclamos o modificaciones de jueces sin perder la integridad",
    icono: "✏️",
    selector: '[data-tour="tour-editar-reliquidar"]',
    posicion: "top",
    badge: "Paso 11: Corrección",
    color: "text-rose-400",
    bgGradiente: "from-rose-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "¿Hubo un distanciamiento de jueces por reclamo, un error de tipeo o un caballo retirado tardío?",
      "No te preocupes:",
      "• Presiona '✏️ Editar jugadas' en la barra inferior.",
      "• Puedes corregir el monto, cambiar de cliente o anular boletos con un motivo auditado.",
      "• Al confirmar la corrección sobre una carrera ya cerrada, el sistema ejecuta una reliquidación simétrica: revierte los dividendos anteriores y aplica el nuevo resultado sin descuadrar la caja."
    ],
    acciones: [
      "Haz clic en '✏️ Editar jugadas' (barra inferior).",
      "Selecciona la jugada a modificar o anular.",
      "Escribe el motivo del cambio y confirma para reliquidar."
    ],
    tip: "Cada edición deja un registro de auditoría con fecha, hora y usuario para máxima seguridad del dueño.",
    atajo: "Auditoría garantizada"
  },
  {
    id: "reporte_final_whatsapp",
    num: 12,
    titulo: "12 · Reporte Final y Envío a WhatsApp",
    subtitulo: "Genera el resumen de premios, cobros netos y saldos para el grupo",
    icono: "🧾",
    selector: '[data-tour="tour-reporte-final-whatsapp"]',
    posicion: "top",
    badge: "Paso 12: Cierre y Envío",
    color: "text-emerald-400",
    bgGradiente: "from-emerald-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Una vez liquidada la carrera:",
      "• Botón '🧾 Reporte Final': Abre el estado de cuenta oficial de la carrera con ganadores, perdedores, comisiones y cobro neto de la casa.",
      "• Botón '🏁 Ver Preliminar de Resultados WhatsApp': Prepara el texto oficial de la llegada para enviarlo al grupo.",
      "• Botón '💰 Ver Reporte de Saldos Actualizados WhatsApp': Genera la lista de saldos vivos de todos los clientes para informar cómo quedó cada jugador tras la carrera."
    ],
    acciones: [
      "Haz clic en '🧾 Reporte Final' para ver el cuadro contable.",
      "Haz clic en '🏁 Ver Preliminar de Resultados WhatsApp' para copiar o enviar al chat.",
      "Haz clic en '💰 Reporte de Saldos WhatsApp' para publicar los saldos actualizados."
    ],
    tip: "Los mensajes para WhatsApp vienen con formato enriquecido (negritas, listas y emojis) para lectura clara en teléfonos móviles.",
    atajo: "Ctrl+G"
  },
  {
    id: "reporte_visual_disponibilidad",
    num: 13,
    titulo: "13 · Reporte Visual de Disponibilidad",
    subtitulo: "Consulta gráfica instantánea de cupos, saldos y avales de tus clientes",
    icono: "📊",
    selector: '[data-tour="tour-reporte-visual-disponibilidad"]',
    posicion: "top",
    badge: "Paso 13: Disponibilidad",
    color: "text-indigo-400",
    bgGradiente: "from-indigo-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Para saber en un abrir y cerrar de ojos quién puede seguir apostando:",
      "• El botón con icono de gráfica '📊 Reporte Visual de Disponibilidad y Alerta de Saldos' despliega una cartela visual a pantalla completa.",
      "• Muestra barras de crédito por cliente en verde (disponible alto), amarillo (cerca del cupo) y rojo (sin aval o en riesgo).",
      "• Te permite monitorear el riesgo total en curso de toda tu cartera de jugadores en tiempo real."
    ],
    acciones: [
      "Haz clic en el botón '📊 Reporte Visual de Disponibilidad'.",
      "Examina la barra de cada cliente (Saldo + Aval - Riesgo).",
      "Puedes exportar o compartir la visualización si necesitas justificar aumentos de crédito."
    ],
    tip: "Usa este reporte antes de carreras importantes para saber qué clientes necesitan recargar saldo antes de apostar.",
    atajo: "Gráfica interactiva"
  }
];
