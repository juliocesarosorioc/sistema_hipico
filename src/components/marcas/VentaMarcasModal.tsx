"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useTaquillaStore } from "@/store/useTaquillaStore"; // Conexión a tu taquilla central

// Función auxiliar para extraer números
const extraerNumeros = (str: string) => {
  return str.split(/[\/, -]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
};

type Props = {
  hipodromo: string;
  carrera: string;
  fecha: string;
  marcasIniciales: string;
  contraIniciales: string;
  onCerrar: () => void;
};

export function VentaMarcasModal({ hipodromo, carrera, fecha, marcasIniciales, contraIniciales, onCerrar }: Props) {
  // Estado de configuración de la carrera (Editable)
  const [marcadas, setMarcadas] = useState(marcasIniciales);
  const [contra, setContra] = useState(contraIniciales);
  const [nv, setNv] = useState(""); // Caballos que No Valen

  // Estado de la venta
  const [caballoJugado, setCaballoJugado] = useState("");
  const [monto, setMonto] = useState("");
  const [grupo, setGrupo] = useState("");
  const [cliente, setCliente] = useState("");

  // Estado de validación
  const [estadoJugada, setEstadoJugada] = useState<{ tipo: string; color: string; mensaje: string } | null>(null);

  // Conexión a la Taquilla Central
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);

  // Efecto para validar en tiempo real el caballo introducido
  useEffect(() => {
    if (!caballoJugado) {
      setEstadoJugada(null);
      return;
    }
    const num = parseInt(caballoJugado, 10);
    const arrMarcadas = extraerNumeros(marcadas);
    const arrContra = extraerNumeros(contra);
    const arrNv = extraerNumeros(nv);

    if (arrNv.includes(num)) {
      setEstadoJugada({ tipo: "BLOQUEADO", color: "text-red-600 bg-red-100", mensaje: "🚫 Caballo Inválido (NV). No se puede jugar." });
    } else if (arrMarcadas.includes(num)) {
      setEstadoJugada({ tipo: "A FAVOR", color: "text-emerald-700 bg-emerald-100", mensaje: "✅ Juega A FAVOR de las Marcas." });
    } else if (arrContra.includes(num) || (!arrMarcadas.includes(num) && !arrNv.includes(num))) {
      setEstadoJugada({ tipo: "EN CONTRA", color: "text-amber-700 bg-amber-100", mensaje: "⚔️ Juega EN CONTRA de las Marcas." });
    }
  }, [caballoJugado, marcadas, contra, nv]);

  const procesarVenta = () => {
    if (estadoJugada?.tipo === "BLOQUEADO") return alert("No puedes vender un caballo NV (No Vale).");
    if (!caballoJugado || !monto || !grupo || !cliente) return alert("Por favor completa todos los campos de la venta.");

    // Aquí enviamos el ticket a la taquilla central
    agregarTicket({
      comando: `MARCA ${hipodromo} C${carrera} N${caballoJugado} (${estadoJugada?.tipo})`,
      monto: parseFloat(monto),
      gananciaProyectada: parseFloat(monto) * 1.20, // 120/100
      comision: (parseFloat(monto) * 1.20) * 0.05, // 5% de comisión estándar
    });

    // En un sistema real, aquí también harías el insert a Supabase para crear Grupo/Cliente si no existen.
    
    alert(`✅ Jugada de $${monto} al caballo ${caballoJugado} registrada para ${cliente} (${grupo}).`);
    onCerrar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm no-print">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col md:flex-row">
        
        {/* PANEL IZQUIERDO: CONFIGURACIÓN AL VUELO */}
        <div className="bg-slate-50 p-6 md:w-1/2 border-r border-slate-200">
          <div className="mb-4 border-b border-slate-200 pb-2">
            <h3 className="text-sm font-black uppercase text-slate-800">⚙️ Configuración Carrera {carrera}</h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase">{hipodromo} · {fecha}</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase text-emerald-700">Marcas (Izquierda)</label>
              <input value={marcadas} onChange={(e) => setMarcadas(e.target.value)} placeholder="Ej: 2/5/7" className="w-full mt-1 border border-emerald-300 rounded px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
              <p className="text-[9px] text-slate-400 mt-0.5">Caballos a favor.</p>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-amber-700">Contra (Derecha)</label>
              <input value={contra} onChange={(e) => setContra(e.target.value)} placeholder="Ej: 1,4,8" className="w-full mt-1 border border-amber-300 rounded px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-amber-500 outline-none" />
              <p className="text-[9px] text-slate-400 mt-0.5">Rivales principales.</p>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-red-700">NV (No Valen)</label>
              <input value={nv} onChange={(e) => setNv(e.target.value)} placeholder="Ej: 3,9" className="w-full mt-1 border border-red-300 rounded px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none" />
              <p className="text-[9px] text-slate-400 mt-0.5">Caballos bloqueados para la venta.</p>
            </div>
          </div>
        </div>

        {/* PANEL DERECHO: VENTA Y JUGADORES */}
        <div className="p-6 md:w-1/2 bg-white flex flex-col">
          <div className="flex justify-between items-center mb-4 border-b border-slate-200 pb-2">
            <h3 className="text-sm font-black uppercase text-indigo-900">🎟️ Vender Marca</h3>
            <button onClick={onCerrar} className="text-slate-400 hover:text-red-500 font-bold">✕</button>
          </div>

          <div className="space-y-3 flex-grow">
            {/* Jugada y Monto */}
            <div className="flex gap-3">
              <div className="w-1/3">
                <label className="text-[10px] font-black uppercase text-slate-500">Caballo</label>
                <input type="number" value={caballoJugado} onChange={(e) => setCaballoJugado(e.target.value)} placeholder="Nº" className="w-full mt-1 border border-slate-300 rounded px-3 py-2 text-lg text-center font-black focus:border-indigo-500 outline-none" />
              </div>
              <div className="w-2/3">
                <label className="text-[10px] font-black uppercase text-slate-500">Monto ($)</label>
                <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" className="w-full mt-1 border border-slate-300 rounded px-3 py-2 text-lg text-right text-green-700 font-black focus:border-indigo-500 outline-none" />
              </div>
            </div>

            {/* Alerta de Validación Dinámica */}
            <div className={`h-8 flex items-center justify-center rounded text-xs font-bold ${estadoJugada ? estadoJugada.color : 'bg-slate-100 text-slate-400'}`}>
              {estadoJugada ? estadoJugada.mensaje : 'Ingresa un caballo para validar...'}
            </div>

            {/* Grupo y Cliente (Buscador/Creador) */}
            <div className="pt-2 border-t border-slate-100">
              <label className="text-[10px] font-black uppercase text-slate-500">Grupo (Agencia)</label>
              <input value={grupo} onChange={(e) => setGrupo(e.target.value.toUpperCase())} placeholder="Buscar o crear grupo..." className="w-full mt-1 border border-slate-300 rounded px-3 py-1.5 text-sm font-bold uppercase focus:border-indigo-500 outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-500">Cliente (Jugador)</label>
              <input value={cliente} onChange={(e) => setCliente(e.target.value.toUpperCase())} placeholder="Buscar o crear cliente..." className="w-full mt-1 border border-slate-300 rounded px-3 py-1.5 text-sm font-bold uppercase focus:border-indigo-500 outline-none" />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCerrar}>Cancelar</Button>
            <Button variant="success" onClick={procesarVenta} disabled={estadoJugada?.tipo === "BLOQUEADO" || !caballoJugado}>
              ✅ Registrar Jugada
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}