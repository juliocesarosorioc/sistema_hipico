"use client";

import React from "react";

// Utilidad para pintar los cuadritos de los caballos con la paleta hípica
const getColorCaballo = (num: string) => {
  const n = parseInt(num, 10);
  const colores: Record<number, { bg: string; fg: string; border?: string }> = {
    1: { bg: "#dc2626", fg: "#ffffff" }, // Rojo
    2: { bg: "#ffffff", fg: "#000000", border: "1px solid #ccc" }, // Blanco
    3: { bg: "#2563eb", fg: "#ffffff" }, // Azul
    4: { bg: "#facc15", fg: "#000000" }, // Amarillo
    5: { bg: "#16a34a", fg: "#ffffff" }, // Verde
    6: { bg: "#000000", fg: "#ffffff" }, // Negro
    7: { bg: "#f97316", fg: "#ffffff" }, // Naranja
    8: { bg: "#fbcfe8", fg: "#000000" }, // Rosado
  };
  return colores[n] || { bg: "#94a3b8", fg: "#ffffff" };
};

// Datos extraídos de la interfaz
const transacciones = [
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "SOLDADO", sub: "Aval", monto: "+$2.000,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "ARELY", sub: "Aval", monto: "+$2.000,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "RUCIO", sub: "Aval", monto: "+$2.000,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "AYARI", sub: "Aval", monto: "+$2.000,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "LAMINE", sub: "Aval", monto: "+$500,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "LARRY", sub: "Aval", monto: "+$500,00" },
  { hora: "13:28:14", tipo: "DEP AVAL", cliente: "CAMACHO", sub: "Aval", monto: "+$500,00" },
];

const carreras = [
  {
    hipodromo: "Valencia",
    carrera: "1era Carrera",
    hora: "13:38",
    resultados: ["1", "5", "2", "3", "6"],
    lineas: 2,
    jugadas: [
      "2Y2N 5 40 Valverde Every",
      "2Y2N 5 30 Valverde Eddie"
    ],
    balances: [
      { nombre: "EDDIE", monto: "$15", color: "text-red-600" },
      { nombre: "EVERY", monto: "$20", color: "text-red-600" },
      { nombre: "VALVERDE", monto: "+$33.25", color: "text-green-600" },
    ]
  },
  {
    hipodromo: "Gulfstream Park",
    carrera: "3era Carrera",
    hora: "13:35",
    resultados: ["1", "5", "4", "7"],
    lineas: 8,
    jugadas: [
      "PP 2x4 40 Partner Chino",
      "PP 2x4 50 Partner Ayari",
      "PP 2x4 30 Partner Gaetano",
      "PP 2x4 180 Partner Rucio",
      "4P 1 300 Sam Shaflan",
      "3Y4N 2 50 Ayari Roca",
      "3Y4N 2 30 Ayari Thor",
      "🔀 CRUCE  0 Ayari"
    ],
    balances: [
      { nombre: "AYARI", monto: "$30", color: "text-red-600" },
      { nombre: "CHINO", monto: "+$58", color: "text-green-600" },
      { nombre: "GAETANO", monto: "+$28.50", color: "text-green-600" },
      { nombre: "PARTNER", monto: "$300", color: "text-red-600" },
      { nombre: "ROCA", monto: "+$47.50", color: "text-green-600" },
      { nombre: "RUCIO", monto: "+$171", color: "text-green-600" },
      { nombre: "SAM", monto: "+$285", color: "text-green-600" },
      { nombre: "SHAFLAN", monto: "$300", color: "text-red-600" },
      { nombre: "THOR", monto: "+$28.50", color: "text-green-600" },
    ]
  },
  {
    hipodromo: "Belmont Park",
    carrera: "3era Carrera",
    hora: "13:20",
    resultados: ["3", "2", "4"],
    lineas: 1,
    jugadas: [
      "3N 4 200 Sam Partner"
    ],
    balances: [
      { nombre: "PARTNER", monto: "+$0", color: "text-green-600" },
      { nombre: "SAM", monto: "+$0", color: "text-green-600" },
    ]
  },
  {
    hipodromo: "Keeneland",
    carrera: "1era Carrera",
    hora: "13:04",
    resultados: ["4"],
    lineas: 1,
    jugadas: [
      "10A8 4 30 Sam Every"
    ],
    balances: [
      { nombre: "EVERY", monto: "$24", color: "text-red-600" },
      { nombre: "SAM", monto: "+$22.80", color: "text-green-600" },
    ]
  }
];

export default function HistorialReporte() {
  return (
    <div className="min-h-screen bg-[#eef2f7] font-sans text-slate-800">
      
      {/* Cabecera Principal */}
      <header className="bg-[#1f2937] text-white px-4 py-3 flex items-center gap-2 shadow-md">
        <span className="flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
        <span className="text-lg">🇦🇷</span>
        <h1 className="text-[15px] font-bold tracking-wide">ARGENTINA — Historial de Transacciones</h1>
      </header>

      {/* Barra de Resumen Financiero */}
      <div className="bg-white border-b border-gray-300 px-4 py-2 flex gap-6 text-[11px] font-bold shadow-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-green-600 rounded-full"></div>
          <span className="text-gray-500">Depósitos:</span>
          <span className="text-green-600">7 (+$9.500,00)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
          <span className="text-gray-500">Retiros:</span>
          <span className="text-red-600">0 (-$0,00)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
          <span className="text-gray-500">Transferencias:</span>
          <span className="text-orange-500">0 ($0,00)</span>
        </div>
      </div>

      {/* Contenedor Principal (Grid de 2 columnas) */}
      <div className="p-4 flex flex-col lg:flex-row gap-4 max-w-[1600px] mx-auto">
        
        {/* Columna Izquierda: Historial de Transacciones (30%) */}
        <div className="lg:w-[32%] flex flex-col gap-4">
          <div className="bg-white shadow-sm border border-gray-200 rounded-sm overflow-hidden">
            {/* Cabecera de la tabla de transacciones */}
            <div className="bg-[#1f2937] text-gray-300 text-[10px] font-bold flex px-3 py-2 uppercase">
              <div className="w-[20%]">Hora</div>
              <div className="w-[25%]">Tipo</div>
              <div className="w-[30%]">Cliente</div>
              <div className="w-[25%] text-right">Monto USD</div>
            </div>
            
            {/* Lista de transacciones */}
            <div className="flex flex-col">
              {transacciones.map((t, idx) => (
                <div key={idx} className="flex items-center px-3 py-3 border-b border-gray-100 text-[11px] hover:bg-gray-50">
                  <div className="w-[20%] text-gray-500 font-mono">{t.hora}</div>
                  <div className="w-[25%]">
                    <span className="bg-[#3b82f6] text-white px-2 py-0.5 rounded-[3px] font-bold text-[9px]">{t.tipo}</span>
                  </div>
                  <div className="w-[30%] flex flex-col leading-tight">
                    <span className="font-bold text-green-700 uppercase">{t.cliente}</span>
                    <span className="text-[9px] text-gray-400 italic">· {t.sub}</span>
                  </div>
                  <div className="w-[25%] text-right font-bold text-green-600 text-[12px]">
                    {t.monto}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cuadro Resumen de Totales del Día */}
          <div className="bg-white shadow-sm border border-gray-200 rounded-sm p-4 text-[12px] font-bold">
            <div className="flex justify-between mb-3">
              <span className="text-gray-500 uppercase text-[10px]">Depósitos <span className="text-green-600 text-[12px] ml-1">+$9.500,00</span></span>
              <span className="text-gray-500 uppercase text-[10px]">Retiros <span className="text-red-600 text-[12px] ml-1">-$0,00</span></span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 uppercase text-[10px]">Transferencias <span className="text-orange-500 text-[12px] ml-1">$0,00</span></span>
              <span className="text-gray-500 uppercase text-[10px]">Neto del Día <span className="text-green-600 text-[12px] ml-1">+$9.500,00</span></span>
            </div>
            <div className="text-center text-[9px] text-gray-400 font-normal mt-4 pt-2 border-t border-gray-100">
              7 transacciones · actualizado 13:45:04
            </div>
          </div>
        </div>

        {/* Columna Derecha: Carreras Registradas Hoy (70%) */}
        <div className="lg:w-[68%] flex flex-col gap-4">
          
          <div className="bg-[#1f2937] text-gray-300 text-[11px] font-bold px-4 py-2 flex items-center gap-2 rounded-sm shadow-sm tracking-widest uppercase">
            <span className="opacity-70 text-[14px]">▦</span> Carreras Registradas Hoy
          </div>

          {/* Tarjetas de Carreras */}
          <div className="flex flex-col gap-4">
            {carreras.map((c, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-sm shadow-sm overflow-hidden">
                
                {/* Cabecera Azul de la Carrera */}
                <div className="bg-[#2563eb] text-white px-3 py-2 flex justify-between items-center">
                  <div className="text-[12px] font-bold flex items-center gap-2">
                    <span>🏇</span> {c.hipodromo} — {c.carrera}
                  </div>
                  <div className="text-[11px] font-bold">{c.hora}</div>
                </div>

                {/* Sub-cabecera con los cuadros de llegada */}
                <div className="bg-white border-b border-gray-200 px-3 py-1.5 flex items-center gap-2 text-[11px]">
                  <div className="flex gap-0.5">
                    {c.resultados.map((res, j) => {
                      const col = getColorCaballo(res);
                      return (
                        <div key={j} className="flex items-center">
                          <span 
                            className="w-3.5 h-3.5 flex items-center justify-center text-[9px] font-bold shadow-sm"
                            style={{ backgroundColor: col.bg, color: col.fg, border: col.border || 'none' }}
                          >
                            {res}
                          </span>
                          {j < c.resultados.length - 1 && <span className="text-gray-400 mx-0.5 font-bold">.</span>}
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-gray-400 font-medium ml-2">{c.lineas} líneas</span>
                </div>

                {/* Contenido (Jugadas a la izquierda, Resultados a la derecha) */}
                <div className="flex flex-col md:flex-row">
                  
                  {/* Panel Jugadas */}
                  <div className="md:w-[75%] p-3 border-r border-gray-100">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[10px] font-bold text-gray-400 tracking-wider">JUGADAS</span>
                      <button className="bg-indigo-50 border border-indigo-200 text-indigo-600 text-[10px] px-2 py-0.5 rounded font-bold hover:bg-indigo-100 flex items-center gap-1 transition-colors">
                        <span>📋</span> Copiar
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-gray-600 leading-[1.6] whitespace-pre-wrap">
                      {c.jugadas.map((jugada, idx) => (
                        <div key={idx}>{jugada}</div>
                      ))}
                    </div>
                  </div>

                  {/* Panel Resultados (Balances) */}
                  <div className="md:w-[25%] p-3 bg-gray-50/30">
                    <div className="text-[10px] font-bold text-gray-400 tracking-wider mb-3">RESULTADOS</div>
                    <div className="flex flex-col gap-2">
                      {c.balances.map((bal, idx) => (
                        <div key={idx} className="flex justify-between items-center text-[10px] font-bold uppercase">
                          <span className="text-gray-500">{bal.nombre}</span>
                          <span className={`${bal.color} text-[11px] font-black`}>{bal.monto}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}