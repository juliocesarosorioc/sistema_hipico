"use client";

import { useState, useEffect } from "react";
import { Button } from "@/shared/components/ui/Button";

export type PasoOperador = {
  id: string;
  num: number;
  titulo: string;
  subtitulo: string;
  icono: string;
  color: string;
  bgGradiente: string;
  explicacion: string[];
  tips: string[];
  preguntaComprension: string;
  simulacion?: "apuestas" | "registro_cliente" | "registro_jugada" | "carga_resultados" | "liquidacion" | "decision_cierre";
};

const PASOS_OPERADOR: PasoOperador[] = [
  {
    id: "apuestas_modulo",
    num: 1,
    titulo: "Módulo de Apuestas y Gestión de Jugadas",
    subtitulo: "El corazón operativo de la taquilla: teclado rápido y control total",
    icono: "🎟️",
    color: "text-indigo-400",
    bgGradiente: "from-indigo-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "La barra superior fija: Hipódromo activo, Carrera (1, 2, 3...), Fecha de jornada y Comisión del grupo.",
      "Diseño Keyboard-First: Puedes operar la taquilla sin tocar el ratón:",
      "  • Enter: Valida y agrega jugadas a la grilla.",
      "  • Ctrl+Y / Ctrl+R: Abre la Carga de Resultados y Liquidación.",
      "  • F2 / Barra de búsqueda: Búsqueda rápida de clientes y caballos.",
      "Cada ticket ingresado valida en milisegundos el saldo y aval disponible del cliente antes de aceptarse."
    ],
    tips: [
      "Siempre verifica que el Hipódromo y la Carrera seleccionados coincidan con la carrera por disputarse.",
      "La grilla de jugadas te muestra en tiempo real el monto total recaudado y la ganancia proyectada del grupo."
    ],
    preguntaComprension: "Comprendo el funcionamiento general del módulo de apuestas, los atajos de teclado y la barra superior.",
    simulacion: "apuestas"
  },
  {
    id: "registro_jugador",
    num: 2,
    titulo: "Registro Rápido de Jugadores / Clientes",
    subtitulo: "Da de alta a un jugador nuevo en segundos sin abandonar la taquilla",
    icono: "👤",
    color: "text-emerald-400",
    bgGradiente: "from-emerald-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "No necesitas salir a otra pantalla para crear un cliente nuevo:",
      "1. En el campo 'Cliente', escribe el nombre o teléfono del jugador nuevo.",
      "2. Si no existe, presiona '➕ Registrar nuevo cliente'.",
      "3. Asigna su saldo inicial o su 'Aval' (límite de crédito autorizado).",
      "4. Elige si es 'Libre' (juega sin restricción de cupo) o 'Con Tope'.",
      "5. Guarda y de inmediato queda seleccionado en la jugada en curso."
    ],
    tips: [
      "El número de WhatsApp te permite enviarle su comprobante de ticket al instante.",
      "El saldo del cliente se actualiza automáticamente con cada jugada, recarga o dividendo cobrado."
    ],
    preguntaComprension: "He aprendido cómo registrar clientes rápidamente desde la misma taquilla y cómo configurar su aval y saldo.",
    simulacion: "registro_cliente"
  },
  {
    id: "demo_jugadas",
    num: 3,
    titulo: "Demostración: Registrar Jugadas en una Carrera",
    subtitulo: "Prueba práctica paso a paso de emisión de boletos",
    icono: "🐎",
    color: "text-cyan-400",
    bgGradiente: "from-cyan-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Paso a paso de una jugada:",
      "1. Selecciona el caballo (ej. Caballo #3).",
      "2. Selecciona el cliente (ej. Carlos M.).",
      "3. Indica el monto de la apuesta (ej. $50).",
      "4. Selecciona la modalidad (Ganador, Place, Tabla Fija).",
      "5. Presiona 'Registrar Jugada' y se agrega a la lista de boletos activos con su número único."
    ],
    tips: [
      "Puedes cargar múltiples jugadas continuas presionando Enter.",
      "Si el cliente sobrepasa su aval, el sistema emitirá una alerta visible antes de registrar."
    ],
    preguntaComprension: "Comprendo el flujo completo para registrar y confirmar jugadas de clientes en la carrera activa.",
    simulacion: "registro_jugada"
  },
  {
    id: "demo_resultados",
    num: 4,
    titulo: "Demostración: Carga de Resultados Oficiales",
    subtitulo: "Ingreso del orden de llegada (1º al 5º lugar) y empates",
    icono: "🏁",
    color: "text-amber-400",
    bgGradiente: "from-amber-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Cuando los jueces confirman la llegada:",
      "1. Presiona '🏁 Cargar Resultados' o usa Ctrl+Y.",
      "2. Ingresa los números de los caballos que llegaron en 1º, 2º, 3º, 4º y 5º lugar.",
      "3. En caso de empate (Dead Heat), marca la casilla de empate para repartir el dividendo sin fraccionamiento erróneo.",
      "4. Ingresa el dividendo oficial pagado por boleto.",
      "5. Revisa la pizarra preliminar antes del cierre definitivo."
    ],
    tips: [
      "Cargar el resultado oficial congela inmediatamente la carrera para impedir apuestas tardías.",
      "Si un caballo fue retirado a última hora, márcalo como 'Retirado' para reembolso automático."
    ],
    preguntaComprension: "Entiendo cómo ingresar el orden de llegada oficial, los empates y verificar la pizarra de resultados.",
    simulacion: "carga_resultados"
  },
  {
    id: "demo_liquidacion",
    num: 5,
    titulo: "Demostración: Liquidar Carrera y Ver Resultados",
    subtitulo: "El motor financiero: acredita premios y calcula el cobro neto",
    icono: "✅",
    color: "text-purple-400",
    bgGradiente: "from-purple-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Al presionar 'Confirmar Resultados y Liquidar':",
      "1. El sistema evalúa todas las jugadas registradas en la carrera.",
      "2. Los tickets ganadores se marcan en verde y se les suma el dividendo exacto a su saldo.",
      "3. Los tickets no acertados se marcan como liquidados.",
      "4. Se calcula el Cobro Neto del grupo descontando la comisión establecida.",
      "5. Se genera el reporte oficial listo para imprimir, descargar en JPG o compartir por WhatsApp."
    ],
    tips: [
      "El recálculo contable es atómico: ningún saldo queda a medias ni duplicado.",
      "El reporte final muestra el detalle cliente por cliente de cuánto ganó o perdió en la carrera."
    ],
    preguntaComprension: "Comprendo el proceso de liquidación automática, acreditación de premios y generación del reporte de resultados.",
    simulacion: "liquidacion"
  },
  {
    id: "decision_cierre",
    num: 6,
    titulo: "Cierre de Resultados: ¿Corregir o Nueva Carrera?",
    subtitulo: "El flujo de decisión post-cierre que mantiene tu taquilla limpia",
    icono: "🔄",
    color: "text-rose-400",
    bgGradiente: "from-rose-950/80 via-slate-900 to-slate-950",
    explicacion: [
      "Al cerrar el reporte de resultados de una carrera, el sistema te muestra el cuadro de decisión:",
      "¿Desea salir y registrar carrera nueva o corregir carrera?",
      "",
      "Opción 1 · '🔧 Corregir Carrera':",
      "  • Si los jueces modificaron un orden por reclamo o hubo un error humano.",
      "  • Regresas a la pantalla conservando las opciones vigentes (hipódromo, carrera, jugadas).",
      "",
      "Opción 2 · '➕ Salir y Registrar Carrera Nueva':",
      "  • Si la carrera concluyó exitosamente.",
      "  • Limpia todos los parámetros y jugadas de la carrera anterior.",
      "  • Avanza automáticamente a la siguiente carrera (ej. Carrera 2) listo para vender."
    ],
    tips: [
      "Nunca tienes que borrar las jugadas manualmente una por una: 'Salir y nueva' lo hace en 1 segundo.",
      "Si corriges una carrera ya liquidada, el sistema revierte los pagos anteriores y aplica la nueva llegada con auditoría."
    ],
    preguntaComprension: "He comprendido el funcionamiento del modal post-cierre: cómo corregir manteniendo opciones o limpiar para una carrera nueva.",
    simulacion: "decision_cierre"
  }
];

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  nombreOperador?: string;
};

export function GuiaInteractivaOperador({ abierto, onCerrar, nombreOperador }: Props) {
  const [pasoIndex, setPasoIndex] = useState(0);
  const [aceptados, setAceptados] = useState<Record<string, boolean>>({});
  const [completado, setCompletado] = useState(false);

  // Estados interactivos para las demostraciones dentro de la guía
  const [demoCaballo, setDemoCaballo] = useState("3");
  const [demoCliente, setDemoCliente] = useState("CARLOS MENDOZA");
  const [demoMonto, setDemoMonto] = useState("50");
  const [demoJugadas, setDemoJugadas] = useState<Array<{ caballo: string; cliente: string; monto: number }>>([
    { caballo: "3", cliente: "CARLOS MENDOZA", monto: 50 },
    { caballo: "5", cliente: "JUAN PEREZ", monto: 20 },
  ]);
  const [demoPizarra, setDemoPizarra] = useState({ primero: "3", segundo: "1", tercero: "5" });
  const [demoLiquidada, setDemoLiquidada] = useState(false);
  const [demoDecision, setDemoDecision] = useState<string | null>(null);

  const paso = PASOS_OPERADOR[pasoIndex];
  const estaAceptado = Boolean(aceptados[paso.id]);
  const total = PASOS_OPERADOR.length;
  const pct = Math.round(((pasoIndex + 1) / total) * 100);

  useEffect(() => {
    try {
      const guardado = localStorage.getItem("operador_guia_aceptaciones");
      if (guardado) setAceptados(JSON.parse(guardado));
    } catch {
      /* sinop */
    }
  }, []);

  if (!abierto) return null;

  const alternarAceptacion = () => {
    const nuevo = !estaAceptado;
    const mapa = { ...aceptados, [paso.id]: nuevo };
    setAceptados(mapa);
    try {
      localStorage.setItem("operador_guia_aceptaciones", JSON.stringify(mapa));
    } catch {
      /* sinop */
    }
  };

  const avanzar = () => {
    if (!estaAceptado) return;
    if (pasoIndex < total - 1) {
      setPasoIndex((i) => i + 1);
    } else {
      setCompletado(true);
      try {
        localStorage.setItem("operador_guia_completada", "true");
      } catch {
        /* sinop */
      }
    }
  };

  const retroceder = () => {
    if (pasoIndex > 0) setPasoIndex((i) => i - 1);
  };

  const agregarDemoJugada = () => {
    if (!demoMonto || Number(demoMonto) <= 0) return;
    setDemoJugadas((prev) => [
      ...prev,
      { caballo: demoCaballo, cliente: demoCliente, monto: Number(demoMonto) }
    ]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden text-white my-auto flex flex-col max-h-[92vh]">
        
        {/* Cabecera */}
        <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-600/30 text-indigo-400 font-black text-lg border border-indigo-500/30">
              🏇
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white">
                  Guía Operativa del Sistema de Apuestas
                </h2>
                <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-black text-indigo-300 border border-indigo-500/30">
                  Operadores
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400">
                {nombreOperador ? `Operador: ${nombreOperador}` : "Entrenamiento interactivo con simulaciones prácticas"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Barra de progreso interactiva */}
        <div className="bg-slate-950/60 px-5 py-2.5 border-b border-slate-800/80">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5">
            <span>Paso {pasoIndex + 1} de {total}: {paso.titulo}</span>
            <span className="font-mono text-indigo-400 font-extrabold">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex justify-between items-center mt-2.5 gap-1">
            {PASOS_OPERADOR.map((p, idx) => {
              const comp = Boolean(aceptados[p.id]);
              const act = idx === pasoIndex;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPasoIndex(idx)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-black transition flex items-center justify-center gap-1 border ${
                    act
                      ? "border-indigo-400 bg-indigo-600/40 text-white shadow"
                      : comp
                      ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                      : "border-slate-800 bg-slate-900/60 text-slate-500 hover:bg-slate-800"
                  }`}
                  title={`${p.num}. ${p.titulo}`}
                >
                  <span>{comp ? "✓" : p.num}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {!completado ? (
            <>
              {/* Tarjeta de Título */}
              <div className={`rounded-2xl border border-slate-700 bg-gradient-to-br ${paso.bgGradiente} p-5 shadow-lg`}>
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900/90 border border-slate-700 text-3xl shadow-inner">
                    {paso.icono}
                  </div>
                  <div>
                    <span className="text-[10px] font-black tracking-widest uppercase text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/60">
                      Fase {paso.num} de {total}
                    </span>
                    <h3 className={`text-lg sm:text-xl font-black mt-1 ${paso.color}`}>
                      {paso.titulo}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
                      {paso.subtitulo}
                    </p>
                  </div>
                </div>
              </div>

              {/* Explicación */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <span>📖</span> Instrucciones Operativas:
                </h4>
                <ul className="space-y-2 text-xs sm:text-sm text-slate-200">
                  {paso.explicacion.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="text-indigo-400 font-bold mt-0.5">▸</span>
                      <span className="leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* SIMULACIÓN INTERACTIVA SEGÚN EL PASO */}
              {paso.simulacion === "registro_jugada" && (
                <div className="rounded-2xl border border-indigo-500/40 bg-slate-950 p-4 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-black uppercase text-indigo-400 flex items-center gap-2">
                      <span>🎮</span> Demostración en Vivo: Registrar Jugada
                    </span>
                    <span className="text-[10px] bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded-full font-mono font-bold">
                      Carrera 1 · La Rinconada
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Ejemplar</label>
                      <select
                        value={demoCaballo}
                        onChange={(e) => setDemoCaballo(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                      >
                        <option value="1">#1 PRINCIPE AARON</option>
                        <option value="2">#2 LUNA LLENA</option>
                        <option value="3">#3 GRAN TATO</option>
                        <option value="4">#4 CANDELERO</option>
                        <option value="5">#5 SPEEDY</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Cliente</label>
                      <input
                        type="text"
                        value={demoCliente}
                        onChange={(e) => setDemoCliente(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Monto ($)</label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          value={demoMonto}
                          onChange={(e) => setDemoMonto(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white"
                        />
                        <button
                          type="button"
                          onClick={agregarDemoJugada}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-black shrink-0 transition"
                        >
                          + Apostar
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Tabla de boletos simulados */}
                  <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-2.5 space-y-1.5 max-h-36 overflow-y-auto">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">Tickets en Grilla ({demoJugadas.length})</span>
                    {demoJugadas.map((j, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                        <span className="font-bold text-indigo-300">Ticket #{1001 + i}</span>
                        <span className="font-mono text-white">Caballo #{j.caballo}</span>
                        <span className="text-slate-400">{j.cliente}</span>
                        <span className="font-black text-emerald-400 font-mono">${j.monto}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {paso.simulacion === "carga_resultados" && (
                <div className="rounded-2xl border border-amber-500/40 bg-slate-950 p-4 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-black uppercase text-amber-400 flex items-center gap-2">
                      <span>🎮</span> Demostración en Vivo: Carga de Pizarra
                    </span>
                    <span className="text-[10px] bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                      Oficial Jueces
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-black uppercase text-amber-400 block mb-1">🥇 1º Lugar</span>
                      <select
                        value={demoPizarra.primero}
                        onChange={(e) => setDemoPizarra({ ...demoPizarra, primero: e.target.value })}
                        className="bg-slate-950 border border-slate-700 rounded-lg p-1 text-xs text-white font-black text-center w-full"
                      >
                        <option value="3">#3 GRAN TATO</option>
                        <option value="1">#1 PRINCIPE AARON</option>
                        <option value="5">#5 SPEEDY</option>
                      </select>
                    </div>

                    <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-black uppercase text-slate-300 block mb-1">🥈 2º Lugar</span>
                      <select
                        value={demoPizarra.segundo}
                        onChange={(e) => setDemoPizarra({ ...demoPizarra, segundo: e.target.value })}
                        className="bg-slate-950 border border-slate-700 rounded-lg p-1 text-xs text-white font-black text-center w-full"
                      >
                        <option value="1">#1 PRINCIPE AARON</option>
                        <option value="3">#3 GRAN TATO</option>
                        <option value="5">#5 SPEEDY</option>
                      </select>
                    </div>

                    <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] font-black uppercase text-amber-600 block mb-1">🥉 3º Lugar</span>
                      <select
                        value={demoPizarra.tercero}
                        onChange={(e) => setDemoPizarra({ ...demoPizarra, tercero: e.target.value })}
                        className="bg-slate-950 border border-slate-700 rounded-lg p-1 text-xs text-white font-black text-center w-full"
                      >
                        <option value="5">#5 SPEEDY</option>
                        <option value="1">#1 PRINCIPE AARON</option>
                        <option value="3">#3 GRAN TATO</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 italic">
                    💡 La pizarra cargada determina automáticamente todos los ganadores y perdedores sin margen de error.
                  </p>
                </div>
              )}

              {paso.simulacion === "liquidacion" && (
                <div className="rounded-2xl border border-purple-500/40 bg-slate-950 p-4 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-black uppercase text-purple-400 flex items-center gap-2">
                      <span>🎮</span> Demostración en Vivo: Liquidación Automática
                    </span>
                    <button
                      type="button"
                      onClick={() => setDemoLiquidada(!demoLiquidada)}
                      className={`text-xs px-3 py-1 rounded-xl font-black transition ${
                        demoLiquidada ? "bg-emerald-600 text-white" : "bg-purple-600 text-white hover:bg-purple-500"
                      }`}
                    >
                      {demoLiquidada ? "✓ Liquidada (Simular Reabrir)" : "⚡ Ejecutar Liquidar"}
                    </button>
                  </div>

                  {demoLiquidada ? (
                    <div className="space-y-2 animate-in fade-in">
                      <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 flex justify-between items-center">
                        <div>
                          <span className="font-black text-emerald-400 block">GANADOR: Ticket #1001 (Caballo #3)</span>
                          <span className="text-[11px] text-emerald-300">Cliente: CARLOS MENDOZA · Pagado: $110.00</span>
                        </div>
                        <span className="text-lg">🎉</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex justify-between">
                        <span>NO ACERTADO: Ticket #1002 (Caballo #5)</span>
                        <span className="text-rose-400 font-bold">-$20.00</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-3">
                      Presiona el botón <b>'⚡ Ejecutar Liquidar'</b> para ver cómo el sistema calcula los ganadores y actualiza saldos al instante.
                    </p>
                  )}
                </div>
              )}

              {paso.simulacion === "decision_cierre" && (
                <div className="rounded-2xl border border-rose-500/40 bg-slate-950 p-4 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-black uppercase text-rose-400 flex items-center gap-2">
                      <span>🎮</span> Demostración del Modal de Decisión Post-Cierre
                    </span>
                    <span className="text-[10px] bg-rose-900/60 text-rose-300 px-2 py-0.5 rounded-full font-bold">
                      Diálogo Activo
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                    <p className="text-xs font-black text-white text-center">
                      ¿Desea salir y registrar carrera nueva o corregir carrera?
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setDemoDecision("corregir")}
                        className={`p-3 rounded-xl border text-xs font-black transition flex flex-col items-center gap-1 ${
                          demoDecision === "corregir"
                            ? "border-amber-400 bg-amber-500/20 text-amber-300 shadow-md"
                            : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <span>🔧</span>
                        <span>Corregir carrera</span>
                        <span className="text-[10px] font-normal text-slate-400">Conserva datos vigentes</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDemoDecision("nueva")}
                        className={`p-3 rounded-xl border text-xs font-black transition flex flex-col items-center gap-1 ${
                          demoDecision === "nueva"
                            ? "border-indigo-400 bg-indigo-600/40 text-white shadow-md"
                            : "border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        <span>➕</span>
                        <span>Salir y nueva</span>
                        <span className="text-[10px] font-normal text-slate-400">Limpia grilla y avanza C2</span>
                      </button>
                    </div>

                    {demoDecision && (
                      <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 animate-in fade-in">
                        {demoDecision === "corregir" ? (
                          <span className="text-amber-300">
                            ✓ Has seleccionado <b>Corregir carrera</b>: El modal de apuestas se mantiene con la carrera actual, sus caballos y boletos intactos para hacer correcciones.
                          </span>
                        ) : (
                          <span className="text-indigo-300">
                            ✓ Has seleccionado <b>Salir y nueva</b>: Todos los campos de jugada se limpian por completo y el contador avanza a la siguiente carrera listo para recibir apuestas.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tips */}
              <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-4 space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider text-amber-300 flex items-center gap-2">
                  <span>💡</span> Tips para el Operador:
                </h4>
                <ul className="space-y-1.5 text-xs text-amber-200/90">
                  {paso.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-amber-400 font-bold">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Casilla de Aceptación */}
              <div className="rounded-2xl border-2 border-indigo-500/40 bg-indigo-950/30 p-4 sm:p-5 transition hover:border-indigo-400">
                <label className="flex items-start gap-3.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={estaAceptado}
                    onChange={alternarAceptacion}
                    className="mt-1 h-5 w-5 rounded border-indigo-400 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="flex-1">
                    <span className="text-xs sm:text-sm font-extrabold text-white block">
                      {paso.preguntaComprension}
                    </span>
                    <span className="text-[11px] text-indigo-300 mt-1 block">
                      {estaAceptado
                        ? "✅ Has confirmado tu comprensión de esta fase operativa. ¡Puedes continuar!"
                        : "⚠️ Marca esta casilla para validar que has comprendido el procedimiento y habilitar el botón siguiente."}
                    </span>
                  </div>
                </label>
              </div>
            </>
          ) : (
            /* Pantalla de Certificación */
            <div className="text-center py-6 px-4 space-y-5 animate-in zoom-in-95 duration-200">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-indigo-500/20 border-2 border-indigo-500 text-5xl">
                🏆
              </div>
              <div>
                <h3 className="text-2xl font-black text-white">¡Operador Certificado!</h3>
                <p className="text-sm text-slate-300 mt-1 max-w-md mx-auto">
                  Has completado la inducción y comprendido a cabalidad todas las funciones de la taquilla, registro de jugadores, liquidación y control de carreras.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-950 p-4 max-w-md mx-auto text-left space-y-2 text-xs text-slate-300">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Manejo fluido de atajos y módulo de apuestas
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Registro rápido de jugadores y límites de aval
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Carga de pizarras y empates Dead Heat
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Liquidación atómica y generación de reportes
                </div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <span>✓</span> Cierre de carrera y decisión de corrección / nueva carrera
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" onClick={() => { setPasoIndex(0); setCompletado(false); }} className="text-xs">
                  🔄 Volver a repasar
                </Button>
                <Button variant="default" onClick={onCerrar} className="text-xs bg-indigo-600 hover:bg-indigo-500">
                  🎟️ Comenzar a Operar Taquilla
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
              {pasoIndex === total - 1 ? "Finalizar Inducción 🏆" : "Siguiente Fase ▶"}
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
