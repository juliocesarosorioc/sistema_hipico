"use client";

import React from "react";

export default function PlanoPreliminar() {
  const planoTexto = * 🏇 ARGENTINA 🏇 *
Sabado, 10 de Octubre de 2026
, 1era Carrera
Ret:
Pizarra: .....

*TERCIOS*
----------------------------
Total jugadas: 0

----------------------------
*PLANO REFERENCIAL*
*La guía es el chat*
(se gana y se cobra con el chat)
*USTED ES SU PROPIO CORREDOR*
*RECLAMOS AL PRIVADO*
NO DIGA: ❌MALO❌; CASA FALTA...
*TILDE SU JUGADA Y SE REVISARÁ*;

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans p-4">
      
      {/* 1. BARRA DE FILTROS SUPERIOR */}
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 pb-3 mb-4 text-[11px] text-gray-700">
        <div className="flex items-center gap-2">
          <span className="font-bold text-gray-900">Orden resumen:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" defaultChecked className="rounded border-gray-300 text-blue-500 focus:ring-blue-500" /> 
            Separar
          </label>
          <div className="flex items-center gap-1 ml-1">
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full inline-block"></span> positivos /
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full inline-block ml-1"></span> negativos
          </div>
        </div>
        <div className="w-px h-4 bg-gray-300 hidden md:block"></div>
        <div className="flex items-center gap-3">
          <span className="font-bold text-gray-900">Saldos:</span>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" className="rounded border-gray-300 text-blue-500 focus:ring-blue-500" /> 
            Iconos ✅/⚠️
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="filtro_saldos" className="text-blue-500 focus:ring-blue-500" /> 
            Todos
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="filtro_saldos" className="text-blue-500 focus:ring-blue-500" /> 
            ≥ 
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="filtro_saldos" defaultChecked className="text-blue-500 focus:ring-blue-500" /> 
            <span className="font-bold text-blue-600">≥  + libres con movimiento</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="filtro_saldos" className="text-blue-500 focus:ring-blue-500" /> 
            ≥ ,01 + libres con movimiento
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+Q</span>
          <button className="bg-[#facc15] hover:bg-yellow-500 text-yellow-900 px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-yellow-400 shadow-sm transition-colors">
            📄 Generar Preliminar
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+Y</span>
          <button className="bg-white hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-gray-300 shadow-sm transition-colors">
            🏁 Preliminar Resultado
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+R</span>
          <button className="bg-[#10b981] hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-emerald-600 shadow-sm transition-colors">
            🚀 Registrar y Finalizar Carrera
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+F</span>
          <button className="bg-[#8b5cf6] hover:bg-violet-600 text-white px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-violet-600 shadow-sm transition-colors">
            💰 Saldos Clientes
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+B</span>
          <button className="bg-[#06b6d4] hover:bg-cyan-600 text-white px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-cyan-600 shadow-sm transition-colors">
            🔍 Buscar Cliente
          </button>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+V</span>
          <div className="px-3 py-1.5"></div>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-gray-400 mb-0.5 font-medium">Ctrl+M</span>
          <button className="bg-white hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded text-[12px] font-bold flex items-center gap-1.5 border border-gray-300 shadow-sm transition-colors">
            📝 Texto libre
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded shadow-sm">
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
          <h2 className="text-[15px] font-black text-gray-800 uppercase tracking-wider">
            Plano Preliminar
          </h2>
          <div className="flex gap-2">
            <button className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-[12px] font-bold hover:bg-gray-50 transition-colors shadow-sm">
              Copiar Texto
            </button>
            <button className="bg-white border border-red-300 text-red-500 px-3 py-1.5 rounded text-[12px] font-bold hover:bg-red-50 transition-colors flex items-center gap-1 shadow-sm">
              <span className="text-red-400 text-sm leading-none">✕</span> Cerrar
            </button>
          </div>
        </div>
        <div className="p-4">
          <pre className="font-mono text-[13px] text-gray-800 whitespace-pre-wrap leading-[1.6]">
            {planoTexto}
          </pre>
        </div>
      </div>
    </div>
  );
}