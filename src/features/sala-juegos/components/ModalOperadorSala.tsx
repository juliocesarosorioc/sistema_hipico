"use client";

import React, { useState } from "react";
import { salaApi } from "../lib/sala-api";

interface PropsModalOperador {
  sala: any;
  grupoId: string;
  grupoNombre: string;
  onCerrar: () => void;
  onActualizado: () => void;
  onAbrirPrejugadas: () => void;
}

export function ModalOperadorSala({
  sala,
  grupoId,
  grupoNombre,
  onCerrar,
  onActualizado,
  onAbrirPrejugadas,
}: PropsModalOperador) {
  const [tab, setTab] = useState<"carrera" | "retirados" | "liquidacion" | "publicidad">("carrera");
  const [cargando, setCargando] = useState(false);
  const [msgFeedback, setMsgFeedback] = useState<string | null>(null);

  // Apertura
  const [hipodromo, setHipodromo] = useState(sala.hipodromo_activo || "LA RINCONADA");
  const [numeroCarrera, setNumeroCarrera] = useState(sala.numero_carrera_activa || 1);
  const [distancia, setDistancia] = useState(sala.distancia_activa || 1200);

  // Retirados
  const [ejemplarRetirado, setEjemplarRetirado] = useState("");

  // Liquidación
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [p3, setP3] = useState("");
  const [p4, setP4] = useState("");
  const [p5, setP5] = useState("");

  // Publicidad
  const [pubTitulo, setPubTitulo] = useState("");
  const [pubContenido, setPubContenido] = useState("");
  const [pubEnlace, setPubEnlace] = useState("");
  const [pubFijado, setPubFijado] = useState(false);

  const ejecutarAccion = async (subaccion: string, extraPayload: Record<string, any> = {}) => {
    setCargando(true);
    setMsgFeedback(null);
    try {
      const res = await salaApi.accionOperador(subaccion, {
        salaId: sala.id,
        grupoId,
        ...extraPayload,
      });

      if (!res.ok) {
        setMsgFeedback(`❌ Error: ${res.error || "Operación fallida"}`);
      } else {
        setMsgFeedback("✅ Operación completada con éxito.");
        onActualizado();
        if (subaccion === "liquidar" && res.data?.preguntaOperador) {
          setMsgFeedback(`✅ Liquidación completada.\n${res.data.preguntaOperador}`);
        }
      }
    } catch (err: any) {
      setMsgFeedback(`❌ Error de conexión: ${err?.message || err}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="bg-[#111b21] border border-[#202c33] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>🛠️</span> Panel de Control del Operador
            </h3>
            <p className="text-xs text-gray-400">
              {sala.nombre_sala} | Grupo: <span className="text-emerald-400 font-semibold">{grupoNombre}</span>
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-white px-2 py-1 text-sm rounded">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#202c33] bg-[#0b141a] px-3 pt-2 gap-1 text-xs font-semibold">
          <button
            onClick={() => setTab("carrera")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "carrera" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🏇 Apertura / Cierre
          </button>
          <button
            onClick={() => setTab("retirados")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "retirados" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🚫 Retirados
          </button>
          <button
            onClick={() => setTab("liquidacion")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "liquidacion" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            🏁 Liquidación
          </button>
          <button
            onClick={() => setTab("publicidad")}
            className={`px-3 py-2 rounded-t-lg transition ${
              tab === "publicidad" ? "bg-[#111b21] text-emerald-400 border-t-2 border-emerald-500" : "text-gray-400 hover:text-white"
            }`}
          >
            📢 Publicidad
          </button>
        </div>

        {/* Feedback message */}
        {msgFeedback && (
          <div className="mx-5 mt-4 p-3 bg-emerald-950/60 border border-emerald-700/60 rounded-xl text-xs font-mono text-emerald-300 whitespace-pre-wrap">
            {msgFeedback}
          </div>
        )}

        {/* Tab Content */}
        <div className="p-5 flex-1 overflow-y-auto text-xs space-y-4">
          {tab === "carrera" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-3.5 rounded-xl border border-gray-800 flex items-center justify-between">
                <div>
                  <span className="text-gray-400 text-[11px] block">Estado Actual de la Sala</span>
                  <span
                    className={`font-bold text-sm uppercase ${
                      sala.estado_carrera === "abierta"
                        ? "text-emerald-400"
                        : sala.estado_carrera === "cerrada"
                        ? "text-amber-400"
                        : "text-blue-400"
                    }`}
                  >
                    ● {sala.estado_carrera || "CERRADA"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onAbrirPrejugadas}
                  className="bg-[#202c33] hover:bg-[#2a3942] border border-gray-700 text-amber-300 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5"
                >
                  <span>📋</span>
                  <span>Reporte Prejugadas (PNG)</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Hipódromo</label>
                  <input
                    type="text"
                    value={hipodromo}
                    onChange={(e) => setHipodromo(e.target.value.toUpperCase())}
                    placeholder="LA RINCONADA"
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Nº Carrera</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={numeroCarrera}
                    onChange={(e) => setNumeroCarrera(parseInt(e.target.value, 10))}
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 font-medium mb-1">Distancia (m)</label>
                  <input
                    type="number"
                    step="50"
                    value={distancia}
                    onChange={(e) => setDistancia(parseInt(e.target.value, 10))}
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-bold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  disabled={cargando}
                  onClick={() =>
                    ejecutarAccion("abrir-carrera", {
                      hipodromo,
                      numeroCarrera,
                      distancia,
                    })
                  }
                  className="bg-[#00a884] hover:bg-emerald-500 text-black font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
                >
                  <span>🏇</span>
                  <span>Abrir Carrera (Doble Vista + Destacado Oficial)</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => ejecutarAccion("cerrar-carrera")}
                    className="flex-1 bg-amber-600/30 hover:bg-amber-600/40 border border-amber-500/50 text-amber-300 font-bold py-2.5 rounded-lg transition"
                  >
                    🔒 Cerrar Carrera
                  </button>
                  <button
                    type="button"
                    disabled={cargando}
                    onClick={() => ejecutarAccion("reabrir-carrera")}
                    className="flex-1 bg-[#202c33] hover:bg-[#2a3942] text-gray-300 font-bold py-2.5 rounded-lg transition"
                  >
                    🔓 Reabrir
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "retirados" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-4 rounded-xl border border-gray-800">
                <h4 className="font-bold text-white mb-1">Retirado Oficial en Vivo</h4>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Al procesar un retirado, el sistema bloquea inmediatamente nuevas jugadas con ese ejemplar, anula las
                  pactadas existentes y reintegra los saldos en el libro mayor.
                </p>
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Número de Ejemplar Retirado</label>
                <input
                  type="text"
                  value={ejemplarRetirado}
                  onChange={(e) => setEjemplarRetirado(e.target.value.toUpperCase())}
                  placeholder="Ej. 5 o 5A"
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-3 text-white font-bold text-base"
                />
              </div>

              <button
                type="button"
                disabled={cargando || !ejemplarRetirado.trim()}
                onClick={() => {
                  ejecutarAccion("retirado", { ejemplar: ejemplarRetirado.trim() });
                  setEjemplarRetirado("");
                }}
                className="w-full bg-red-600/30 hover:bg-red-600/40 border border-red-500/50 text-red-300 font-bold py-3 rounded-xl transition flex items-center justify-center gap-2"
              >
                <span>🚫</span>
                <span>Procesar Retirado Oficial #{ejemplarRetirado || "?"}</span>
              </button>
            </div>
          )}

          {tab === "liquidacion" && (
            <div className="space-y-4">
              <div className="bg-[#0b141a] p-4 rounded-xl border border-gray-800">
                <h4 className="font-bold text-white mb-1">Liquidación con Netting Condicional (5%)</h4>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Evalúa universalmente los tickets (1P, 2P, 3P, Llaves y Match). Aplica la comisión del 5% únicamente sobre
                  el balance bruto positivo si los cruces están habilitados. Genera la relación con 🟢 POSITIVOS y 🔴 NEGATIVOS.
                </p>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <div>
                  <label className="block text-emerald-400 font-bold mb-1 text-center">1º (Ganador)</label>
                  <input
                    type="text"
                    value={p1}
                    onChange={(e) => setP1(e.target.value)}
                    placeholder="#"
                    className="w-full bg-[#0b141a] border border-emerald-500 rounded-lg p-2.5 text-center text-white font-bold text-base"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1 text-center">2º</label>
                  <input
                    type="text"
                    value={p2}
                    onChange={(e) => setP2(e.target.value)}
                    placeholder="#"
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-center text-white font-bold text-base"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1 text-center">3º</label>
                  <input
                    type="text"
                    value={p3}
                    onChange={(e) => setP3(e.target.value)}
                    placeholder="#"
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-center text-white font-bold text-base"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1 text-center">4º</label>
                  <input
                    type="text"
                    value={p4}
                    onChange={(e) => setP4(e.target.value)}
                    placeholder="#"
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-center text-white font-bold text-base"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 font-medium mb-1 text-center">5º</label>
                  <input
                    type="text"
                    value={p5}
                    onChange={(e) => setP5(e.target.value)}
                    placeholder="#"
                    className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-center text-white font-bold text-base"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={cargando || !p1.trim()}
                onClick={() =>
                  ejecutarAccion("liquidar", {
                    pizarra: {
                      primero: p1.trim(),
                      segundo: p2.trim() || undefined,
                      tercero: p3.trim() || undefined,
                      cuarto: p4.trim() || undefined,
                      quinto: p5.trim() || undefined,
                    },
                  })
                }
                className="w-full bg-[#00a884] hover:bg-emerald-500 text-black font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 text-sm"
              >
                <span>🏁</span>
                <span>Liquidar Carrera y Publicar Resultados</span>
              </button>
            </div>
          )}

          {tab === "publicidad" && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-gray-300 font-medium mb-1">Título de la Publicidad</label>
                <input
                  type="text"
                  value={pubTitulo}
                  onChange={(e) => setPubTitulo(e.target.value)}
                  placeholder="Ej. Promoción de Recargas o Super Match"
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Texto del Mensaje</label>
                <textarea
                  value={pubContenido}
                  onChange={(e) => setPubContenido(e.target.value)}
                  placeholder="Mensaje a transmitir en tiempo real en la sala..."
                  rows={3}
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-medium mb-1">Enlace / Botón de Acción (Opcional)</label>
                <input
                  type="url"
                  value={pubEnlace}
                  onChange={(e) => setPubEnlace(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-[#0b141a] border border-gray-700 rounded-lg p-2.5 text-white font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="pubFijado"
                  checked={pubFijado}
                  onChange={(e) => setPubFijado(e.target.checked)}
                  className="rounded text-emerald-500"
                />
                <label htmlFor="pubFijado" className="text-gray-300 cursor-pointer">
                  Fijar en el tope de la sala (Banner destacado permanente)
                </label>
              </div>

              <button
                type="button"
                disabled={cargando || !pubTitulo.trim() || !pubContenido.trim()}
                onClick={() => {
                  ejecutarAccion("publicidad", {
                    titulo: pubTitulo.trim(),
                    contenido: pubContenido.trim(),
                    enlace: pubEnlace.trim() || null,
                    fijado: pubFijado,
                  });
                  setPubTitulo("");
                  setPubContenido("");
                  setPubEnlace("");
                }}
                className="w-full bg-[#00a884] hover:bg-emerald-500 text-black font-bold py-2.5 rounded-lg transition"
              >
                Publicar en Tiempo Real
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
