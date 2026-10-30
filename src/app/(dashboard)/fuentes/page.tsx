"use client";

import React, { useState } from "react";

export default function RenderizadoFuentesPage() {
  const [textoPrueba, setTextoPrueba] = useState("Club del Dinero — Sistema Hípico $1.250,50 USD 🏇 C3 Pk5");
  const [tamanoFuente, setTamanoFuente] = useState(16);

  const pesosInter = [
    { peso: "300", clase: "font-light", nombre: "Light (300)" },
    { peso: "400", clase: "font-normal", nombre: "Regular (400)" },
    { peso: "500", clase: "font-medium", nombre: "Medium (500)" },
    { peso: "600", clase: "font-semibold", nombre: "SemiBold (600)" },
    { peso: "700", clase: "font-bold", nombre: "Bold (700)" },
    { peso: "800", clase: "font-extrabold", nombre: "ExtraBold (800)" },
    { peso: "900", clase: "font-black", nombre: "Black (900)" },
  ];

  const pesosOutfit = [
    { peso: "400", clase: "font-normal", nombre: "Regular (400)" },
    { peso: "500", clase: "font-medium", nombre: "Medium (500)" },
    { peso: "600", clase: "font-semibold", nombre: "SemiBold (600)" },
    { peso: "700", clase: "font-bold", nombre: "Bold (700)" },
    { peso: "800", clase: "font-extrabold", nombre: "ExtraBold (800)" },
    { peso: "900", clase: "font-black", nombre: "Black (900)" },
  ];

  const pesosMono = [
    { peso: "400", clase: "font-normal", nombre: "Regular (400)" },
    { peso: "500", clase: "font-medium", nombre: "Medium (500)" },
    { peso: "600", clase: "font-semibold", nombre: "SemiBold (600)" },
    { peso: "700", clase: "font-bold", nombre: "Bold (700)" },
    { peso: "800", clase: "font-extrabold", nombre: "ExtraBold (800)" },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight font-heading flex items-center gap-2">
            <span>🔤</span> Renderizado Oficial de Fuentes de la Plataforma
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Visualización tipográfica de las fuentes cargadas: <strong>Inter</strong> (interfaz principal), <strong>Outfit</strong> (títulos y marcas) y <strong>JetBrains Mono</strong> (cifras tabulares, cuotas y finanzas).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Fuentes Renderizadas
          </span>
        </div>
      </div>

      {/* Probador en Vivo */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-xs font-black uppercase text-slate-700 tracking-wider">
            ✍️ Probador de Texto en Vivo
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
            <span>Tamaño: {tamanoFuente}px</span>
            <input
              type="range"
              min="12"
              max="36"
              value={tamanoFuente}
              onChange={(e) => setTamanoFuente(Number(e.target.value))}
              className="accent-primary-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"
            />
          </div>
        </div>

        <input
          value={textoPrueba}
          onChange={(e) => setTextoPrueba(e.target.value)}
          placeholder="Escriba aquí para probar las fuentes..."
          className="w-full rounded-xl border border-line bg-surfaceAlt px-4 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-primary-500 focus:bg-white transition"
        />
      </div>

      {/* 1. INTER (Fuente Principal) */}
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 font-heading">
              1. Inter (Fuente Principal UI & Contenido)
            </h2>
            <p className="text-xs text-slate-400">
              Uso: Formularios, tablas, etiquetas, diálogos y navegación general.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
            font-sans / &apos;Inter&apos;
          </span>
        </div>

        <div className="space-y-3 divide-y divide-slate-100">
          {pesosInter.map((p) => (
            <div key={p.peso} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6">
              <span className="w-36 shrink-0 font-mono text-xs font-bold text-slate-400">
                {p.nombre}
              </span>
              <p
                style={{ fontSize: `${tamanoFuente}px` }}
                className={`text-slate-900 font-sans ${p.clase} leading-snug break-words`}
              >
                {textoPrueba}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 2. OUTFIT (Fuente de Encabezados y Títulos) */}
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 font-heading">
              2. Outfit (Encabezados, Títulos y Marca)
            </h2>
            <p className="text-xs text-slate-400">
              Uso: Títulos de secciones, métricas de alto impacto, headers de módulos y branding.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-cyan-600 bg-cyan-50 px-2.5 py-1 rounded-md">
            font-heading / &apos;Outfit&apos;
          </span>
        </div>

        <div className="space-y-3 divide-y divide-slate-100">
          {pesosOutfit.map((p) => (
            <div key={p.peso} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6">
              <span className="w-36 shrink-0 font-mono text-xs font-bold text-slate-400">
                {p.nombre}
              </span>
              <p
                style={{ fontSize: `${tamanoFuente + 2}px` }}
                className={`text-slate-900 font-heading ${p.clase} leading-snug break-words tracking-tight`}
              >
                {textoPrueba}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 3. JETBRAINS MONO (Monospace Financiero y Cuotas) */}
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 font-heading">
              3. JetBrains Mono (Cifras Tabulares, Saldos y Tickets)
            </h2>
            <p className="text-xs text-slate-400">
              Uso: Montos en USD/Bs, pizarras de llegada, hashes, Ray ID y cuotas de dividendos.
            </p>
          </div>
          <span className="font-mono text-xs font-bold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-md">
            font-mono / &apos;JetBrains Mono&apos;
          </span>
        </div>

        <div className="space-y-3 divide-y divide-slate-100">
          {pesosMono.map((p) => (
            <div key={p.peso} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-6">
              <span className="w-36 shrink-0 font-mono text-xs font-bold text-slate-400">
                {p.nombre}
              </span>
              <p
                style={{ fontSize: `${tamanoFuente}px` }}
                className={`text-slate-900 font-mono tabular-nums ${p.clase} leading-snug break-words`}
              >
                {textoPrueba}
              </p>
            </div>
          ))}
        </div>

        {/* Demo Tabular Numérica */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <div className="text-xs font-black uppercase text-slate-600 tracking-wider">
            Demostración de Cifras Tabulares Alineadas:
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs font-bold text-slate-800 tabular-nums">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] text-slate-400 block">Saldo Actual</span>
              <span className="text-emerald-700 text-sm font-black">$ 14.850,00</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] text-slate-400 block">Riesgo en Curso</span>
              <span className="text-danger-600 text-sm font-black">-$ 1.250,00</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] text-slate-400 block">Cuota Dividendo</span>
              <span className="text-amber-700 text-sm font-black">3.45 x 1</span>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200">
              <span className="text-[10px] text-slate-400 block">Ray ID Turnstile</span>
              <span className="text-slate-600 text-[11px] font-mono">8ec73f1092a4e21b</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
