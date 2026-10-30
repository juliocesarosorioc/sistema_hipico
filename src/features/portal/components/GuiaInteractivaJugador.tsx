"use client";

import { useState, useEffect } from "react";
import { Button } from "@/shared/components/ui/Button";

export type PasoGuia = {
  id: string;
  numero: number;
  titulo: string;
  subtitulo: string;
  icono: string;
  color: string;
  bgGradiente: string;
  explicacion: string[];
  tips: string[];
  preguntaComprension: string;
  simulacion?: {
    tipo: "saldo" | "jugada" | "reporte" | "pagos" | "tickets" | "semana";
    tituloSimulacion: string;
  };
};

const PASOS_GUIA: PasoGuia[] = [
  {
    id: "saldo",
    numero: 1,
    titulo: "Tu Saldo y Límites de Juego",
    subtitulo: "Aprende a interpretar tu balance, disponible y aval",
    icono: "💰",
    color: "text-emerald-400",
    bgGradiente: "from-emerald-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "En la cabecera de tu portal encuentras la cápsula con tu gráfico de torta en tiempo real.",
      "🟢 Saldo Disponible: El dinero exacto que tienes para realizar nuevas jugadas hoy.",
      "🟡 Saldo en Riesgo / Jugado: El monto comprometido en carreras en curso que aún no se han corrido ni liquidado.",
      "🔵 Aval / Cupo: Si juegas a crédito autorizado por tu grupo, este es tu límite máximo permitido."
    ],
    tips: [
      "Si ganas una carrera, el premio se suma de inmediato a tu Disponible.",
      "Si una carrera se anula o tu caballo es retirado, el dinero se te reintegra automáticamente."
    ],
    preguntaComprension: "He comprendido cómo se calcula mi saldo disponible, mi riesgo y cómo se acreditan mis premios.",
    simulacion: {
      tipo: "saldo",
      tituloSimulacion: "Simulador de Balance en Vivo"
    }
  },
  {
    id: "jugada",
    numero: 2,
    titulo: "Cómo Realizar Jugadas",
    subtitulo: "Aprende a seleccionar hipódromo, carrera y caballos",
    icono: "🐎",
    color: "text-indigo-400",
    bgGradiente: "from-indigo-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Usa el botón morado '🐎 Realizar Jugada' para abrir la taquilla móvil.",
      "1. Elige el Hipódromo activo (La Rinconada, Gulfstream Park, etc.).",
      "2. Selecciona la Carrera y la modalidad (Ganador, Place, Tablas Fijas, etc.).",
      "3. Marca tu ejemplar favorito e indica el monto a apostar.",
      "4. Presiona 'Confirmar Jugada' y recibirás tu número de ticket oficial al instante."
    ],
    tips: [
      "Las jugadas se bloquean automáticamente cuando la carrera entra en 'Partida / Corriendo'.",
      "Siempre verifica el número de caballo y el monto antes de pulsar confirmar."
    ],
    preguntaComprension: "Comprendo los pasos para seleccionar mi caballo, el monto y cómo confirmar mi boleto de apuesta.",
    simulacion: {
      tipo: "jugada",
      tituloSimulacion: "Simulación de Emisión de Ticket"
    }
  },
  {
    id: "reporte",
    numero: 3,
    titulo: "Reporte del Día y Resultados",
    subtitulo: "Consulta tus carreras, dividendos y balance de la jornada",
    icono: "📊",
    color: "text-amber-400",
    bgGradiente: "from-amber-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "La pestaña '📊 Reporte del Día' es tu centro de resultados de la fecha.",
      "Te muestra gráficos de barras con lo jugado, ganado y tu balance neto del día.",
      "Cada carrera detalla el orden oficial de llegada, dividendos por boleto y el estado de tu jugada.",
      "Si quedaste positivo verás tu ganancia en verde, y si quedaste negativo en ámbar/rojo."
    ],
    tips: [
      "Los resultados oficiales se cargan minutos después de cruzar el disco y confirmarse los jueces.",
      "Puedes filtrar por hipódromo o ver todas tus carreras juntas."
    ],
    preguntaComprension: "Entiendo cómo interpretar el reporte del día, los dividendos oficiales y mi balance neto ganado o jugado.",
    simulacion: {
      tipo: "reporte",
      tituloSimulacion: "Ejemplo de Liquidación de Carrera"
    }
  },
  {
    id: "pagos",
    numero: 4,
    titulo: "Reportar Pagos y Recargas",
    subtitulo: "Notifica depósitos bancarios, Pago Móvil o Zelle fácilmente",
    icono: "💳",
    color: "text-cyan-400",
    bgGradiente: "from-cyan-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "En la pestaña '💳 Mis Pagos y Comprobantes' puedes reportar transferencias a la banca.",
      "1. Presiona 'Reportar Pago / Recarga'.",
      "2. Selecciona la cuenta bancaria de destino (del grupo).",
      "3. Coloca el monto transferido, los últimos 4 o 6 dígitos de la referencia y adjunta la captura o comprobante.",
      "4. El operador valida el depósito y tu Saldo Disponible se incrementa al momento."
    ],
    tips: [
      "Guarda siempre el comprobante digital hasta que el pago figure con estatus 'APROBADO'.",
      "Si reportas por Pago Móvil, incluye el número de teléfono emisor y fecha exacta."
    ],
    preguntaComprension: "He comprendido cómo notificar mis transferencias o pagos para que se acrediten en mi cuenta.",
    simulacion: {
      tipo: "pagos",
      tituloSimulacion: "Flujo de Validación de Pagos"
    }
  },
  {
    id: "tickets",
    numero: 5,
    titulo: "Historial de Tickets y Boletos",
    subtitulo: "Transparencia total: cada jugada tiene respaldo auditable",
    icono: "🎟️",
    color: "text-purple-400",
    bgGradiente: "from-purple-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "En '🎟️ Jugadas' accedes al registro histórico inalterable de todos tus tickets.",
      "Cada ticket posee: Código único, fecha y hora exacta de registro, hipódromo, carrera y monto.",
      "Estatus claros:",
      "  • PENDIENTE: Carrera aún no disputada.",
      "  • GANADOR: ¡Cobraste! El dividendo ya está en tu saldo.",
      "  • NO ACERTADO: Jugada no ganadora.",
      "  • RETIRADO / ANULADO: Saldo devuelto íntegramente a tu cuenta."
    ],
    tips: [
      "Puedes tocar cualquier ticket para desplegar el desglose de caballos, taquilla emisora y reglas pactadas.",
      "Todos los tickets quedan respaldados en la base de datos central inmutable."
    ],
    preguntaComprension: "Comprendo el significado de los estados de mis tickets y cómo verificar su validez.",
    simulacion: {
      tipo: "tickets",
      tituloSimulacion: "Anatomía de un Boleto Oficial"
    }
  },
  {
    id: "soporte",
    numero: 6,
    titulo: "Reclamos y Soporte en Vivo",
    subtitulo: "Canal directo con la administración ante cualquier duda",
    icono: "🎫",
    color: "text-rose-400",
    bgGradiente: "from-rose-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "En '🎫 Mis Tickets / Soporte' puedes abrir una incidencia directa si necesitas revisión de una carrera.",
      "Cuentas con una 'Ventana de Reclamos' habilitada por tu grupo para solicitar revisiones.",
      "Puedes adjuntar fotos, indicar el número de ticket y escribir tu consulta.",
      "Recibirás seguimiento y resolución directa con notificación de respuesta del operador."
    ],
    tips: [
      "Reporta cualquier duda dentro de la ventana de tiempo estipulada para la jornada.",
      "Para dudas inmediatas, también dispones del enlace directo a WhatsApp de tu banca."
    ],
    preguntaComprension: "Entiendo cómo abrir un ticket de soporte o reclamo y dónde recibir la respuesta del operador.",
    simulacion: {
      tipo: "tickets",
      tituloSimulacion: "Centro de Soporte y Reclamos"
    }
  },
  {
    id: "semanas",
    numero: 7,
    titulo: "Ciclo Semanal y Liquidación",
    subtitulo: "Consulta balances pasados y semanas liquidadas",
    icono: "📅",
    color: "text-blue-400",
    bgGradiente: "from-blue-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "En la barra superior tienes el selector de 'Semana del Ciclo'.",
      "Cada grupo liquida en un periodo semanal definido (por ejemplo, de Lunes a Domingo).",
      "Puedes seleccionar cualquier semana anterior para auditar exactamente:",
      "  • Total jugado en esa semana.",
      "  • Total cobrado en premios.",
      "  • Pagos realizados o cobros recibidos.",
      "Cuentas claras conservan amistades: toda la información queda archivada para tu tranquilidad."
    ],
    tips: [
      "Al inicio de cada semana tu contador de balance semanal se reinicia de acuerdo al cuadre pactado con el grupo.",
      "Tu disponible neto siempre refleja el estado de tu cuenta real."
    ],
    preguntaComprension: "Confirmo que comprendo todas las funciones de mi portal, cómo jugar, reportar pagos y consultar mis cuentas.",
    simulacion: {
      tipo: "semana",
      tituloSimulacion: "Selector Histórico de Semanas"
    }
  }
];

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  clienteId?: string | number;
  nombreJugador?: string;
};

export function GuiaInteractivaJugador({ abierto, onCerrar, clienteId, nombreJugador }: Props) {
  const [pasoIndex, setPasoIndex] = useState(0);
  const [aceptados, setAceptados] = useState<Record<string, boolean>>({});
  const [completado, setCompletado] = useState(false);

  const pasoActual = PASOS_GUIA[pasoIndex];
  const estaAceptado = Boolean(aceptados[pasoActual.id]);
  const totalPasos = PASOS_GUIA.length;
  const progresoPct = Math.round(((pasoIndex + 1) / totalPasos) * 100);

  // Cargar estado previo de comprensión de localStorage
  useEffect(() => {
    if (!clienteId) return;
    try {
      const guardado = localStorage.getItem(`portal_guia_aceptaciones_${clienteId}`);
      if (guardado) {
        const parsed = JSON.parse(guardado);
        setAceptados(parsed);
      }
      const yaCompletada = localStorage.getItem(`portal_guia_completada_${clienteId}`);
      if (yaCompletada === "true") {
        setCompletado(true);
      }
    } catch {
      /* sinop */
    }
  }, [clienteId]);

  if (!abierto) return null;

  const alternarAceptacion = () => {
    const nuevoEstado = !estaAceptado;
    const nuevoMapa = { ...aceptados, [pasoActual.id]: nuevoEstado };
    setAceptados(nuevoMapa);
    if (clienteId) {
      try {
        localStorage.setItem(`portal_guia_aceptaciones_${clienteId}`, JSON.stringify(nuevoMapa));
      } catch {
        /* sinop */
      }
    }
  };

  const avanzar = () => {
    if (!estaAceptado) return;
    if (pasoIndex < totalPasos - 1) {
      setPasoIndex((p) => p + 1);
    } else {
      // Finalización
      setCompletado(true);
      if (clienteId) {
        try {
          localStorage.setItem(`portal_guia_completada_${clienteId}`, "true");
        } catch {
          /* sinop */
        }
      }
    }
  };

  const retroceder = () => {
    if (pasoIndex > 0) {
      setPasoIndex((p) => p - 1);
    }
  };

  const reiniciarGuia = () => {
    setPasoIndex(0);
    setCompletado(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden text-white my-auto flex flex-col max-h-[92vh]">
        {/* Barra superior con Progreso */}
        <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600/30 text-indigo-400 font-black text-sm border border-indigo-500/30">
              🎓
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-black tracking-tight text-white flex items-center gap-2">
                Guía Interactiva del Jugador
                {completado && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300 border border-emerald-500/30">
                    Certificado
                  </span>
                )}
              </h2>
              <p className="text-[11px] font-medium text-slate-400">
                {nombreJugador ? `Bienvenido, ${nombreJugador}` : "Aprende el funcionamiento paso a paso"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Cerrar guía"
          >
            ✕
          </button>
        </div>

        {/* Barra de progreso interactiva */}
        <div className="bg-slate-950/50 px-5 py-2.5 border-b border-slate-800/80">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5">
            <span>Paso {pasoIndex + 1} de {totalPasos}: {pasoActual.titulo}</span>
            <span className="font-mono text-indigo-400 font-extrabold">{progresoPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 rounded-full"
              style={{ width: `${progresoPct}%` }}
            />
          </div>

          {/* Mini botones de pasos para saltar si ya fueron leídos */}
          <div className="flex justify-between items-center mt-2.5 gap-1">
            {PASOS_GUIA.map((p, idx) => {
              const completadoPaso = Boolean(aceptados[p.id]);
              const esActual = idx === pasoIndex;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPasoIndex(idx)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-black transition flex items-center justify-center gap-1 border ${
                    esActual
                      ? "border-indigo-400 bg-indigo-600/40 text-white shadow"
                      : completadoPaso
                      ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                      : "border-slate-800 bg-slate-900/60 text-slate-500 hover:bg-slate-800"
                  }`}
                  title={`${p.numero}. ${p.titulo}`}
                >
                  <span>{completadoPaso ? "✓" : p.numero}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenido principal scrolleable */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {!completado ? (
            <>
              {/* Tarjeta de Encabezado del Paso */}
              <div className={`rounded-2xl border border-slate-700 bg-gradient-to-br ${pasoActual.bgGradiente} p-4 sm:p-5 shadow-lg`}>
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900/90 border border-slate-700 text-3xl shadow-inner">
                    {pasoActual.icono}
                  </div>
                  <div>
                    <span className="text-[10px] font-black tracking-widest uppercase text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/60">
                      Módulo {pasoActual.numero} de {totalPasos}
                    </span>
                    <h3 className={`text-lg sm:text-xl font-black mt-1 ${pasoActual.color}`}>
                      {pasoActual.titulo}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 mt-0.5 leading-relaxed">
                      {pasoActual.subtitulo}
                    </p>
                  </div>
                </div>
              </div>

              {/* Explicación Detallada */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <span>📖</span> ¿Cómo funciona esta opción?
                </h4>
                <ul className="space-y-2.5 text-xs sm:text-sm text-slate-200">
                  {pasoActual.explicacion.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="text-indigo-400 font-bold mt-0.5">▸</span>
                      <span className="leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Tips y Recomendaciones Clave */}
              <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-4 space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <span>💡</span> Tips para sacarle el máximo provecho:
                </h4>
                <ul className="space-y-1.5 text-xs text-amber-200/90">
                  {pasoActual.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 font-bold">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Casilla interactiva de Aceptación y Comprensión */}
              <div className="rounded-2xl border-2 border-indigo-500/40 bg-indigo-950/30 p-4 sm:p-5 transition hover:border-indigo-400">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={estaAceptado}
                    onChange={alternarAceptacion}
                    className="mt-1 h-5 w-5 rounded border-indigo-400 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <span className="text-xs sm:text-sm font-extrabold text-white block">
                      {pasoActual.preguntaComprension}
                    </span>
                    <span className="text-[11px] text-indigo-300 mt-1 block">
                      {estaAceptado
                        ? "✅ Has confirmado tu comprensión de este paso. ¡Puedes avanzar!"
                        : "⚠️ Marca esta casilla para confirmar que entendiste el funcionamiento y habilitar el botón siguiente."}
                    </span>
                  </div>
                </label>
              </div>
            </>
          ) : (
            /* Pantalla de Felicitaciones y Certificación */
            <div className="text-center py-6 px-4 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-500/20 border-2 border-emerald-500 text-5xl">
                🏆
              </div>
              <div>
                <h3 className="text-2xl font-black text-white">¡Felicitaciones!</h3>
                <p className="text-sm text-slate-300 mt-1 max-w-md mx-auto">
                  Has completado la guía interactiva y confirmado la comprensión de todas las funciones de tu portal de jugador.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 max-w-md mx-auto text-left space-y-2 text-xs text-slate-300">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Saldo y Gestión de Riesgo comprendido
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Realización de jugadas y boletos aprendido
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Reportes de pago y comprobantes verificado
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Consulta de resultados y tickets asimilado
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Sistema de reclamos y soporte activo
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" onClick={reiniciarGuia} className="text-xs">
                  🔄 Volver a repasar la guía
                </Button>
                <Button variant="default" onClick={onCerrar} className="text-xs bg-indigo-600 hover:bg-indigo-500">
                  🏇 Ir a mi Portal y Comenzar a Jugar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Pie de navegación con botones Anterior / Siguiente */}
        {!completado && (
          <div className="bg-slate-950 px-5 py-3.5 border-t border-slate-800 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={retroceder}
              disabled={pasoIndex === 0}
              className="text-xs text-slate-300 hover:text-white border-slate-700 disabled:opacity-30"
            >
              ◀ Anterior
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant={estaAceptado ? "default" : "outline"}
                onClick={avanzar}
                disabled={!estaAceptado}
                className={`text-xs font-black transition ${
                  estaAceptado
                    ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30"
                    : "border-slate-700 text-slate-500 opacity-60 cursor-not-allowed"
                }`}
              >
                {pasoIndex === totalPasos - 1 ? "Finalizar y Certificar 🏆" : "Siguiente Paso ▶"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
