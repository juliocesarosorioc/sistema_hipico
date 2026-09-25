"use client";

import Link from "next/link";

export default function InicioDashboard() {
  // Módulos a renderizar (Igual a la imagen que proporcionaste)
  const modulos = [
    { titulo: "Apuestas", desc: "Gestión de apuestas", href: "/taquilla", colorBtn: "bg-blue-600" },
    { titulo: "Saldos/Reportes", desc: "Gestión de saldos/Reportes", href: "/saldos-reportes", colorBtn: "bg-gray-800" },
    { titulo: "Clientes", desc: "Gestión de clientes", href: "/clientes", colorBtn: "bg-cyan-500" },
    { titulo: "Hipodromos", desc: "Gestión de hipodromos", href: "/hipodromos", colorBtn: "bg-gray-500" },
    { titulo: "Depositos", desc: "Gestión de depositos", href: "#", colorBtn: "bg-green-600" },
    { titulo: "Retiros", desc: "Gestión de retiros", href: "#", colorBtn: "bg-red-500" },
    { titulo: "Transferencias", desc: "Gestión de transferencias", href: "#", colorBtn: "bg-yellow-500" },
    { titulo: "Monedas", desc: "Gestión de monedas", href: "#", colorBtn: "bg-gray-500" },
    { titulo: "Bancos", desc: "Gestión de bancos", href: "#", colorBtn: "bg-gray-500" },
    { titulo: "Winner/Place/Show", desc: "Gestión de ganadores", href: "#", colorBtn: "bg-gray-500" },
    { titulo: "Pollas", desc: "Gestión de Pollas", href: "#", colorBtn: "bg-gray-500" },
    { titulo: "Auditoría", desc: "Registro de todas las acciones", href: "#", colorBtn: "bg-gray-900" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 bg-gray-50 min-h-screen">
      
      {/* WIDGET DE SEMANA ACTIVA */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center space-x-3 mb-2">
          <span className="text-xl">📅</span>
          <h2 className="text-xl font-bold text-gray-800">Semana Activa</h2>
          <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full uppercase">Abierta</span>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Del <strong className="text-gray-700">21/09/2026</strong> al <strong className="text-gray-700">27/09/2026</strong> · Abierta por: <strong className="text-gray-700">Administrador</strong>
        </p>

        {/* Días de la semana */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex flex-col items-center justify-center bg-green-600 text-white rounded-lg w-16 h-16 shadow">
            <span className="text-xs font-semibold">Lun</span><span className="text-sm font-bold">21/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-green-600 text-white rounded-lg w-16 h-16 shadow">
            <span className="text-xs font-semibold">Mar</span><span className="text-sm font-bold">22/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-green-600 text-white rounded-lg w-16 h-16 shadow">
            <span className="text-xs font-semibold">Mié</span><span className="text-sm font-bold">23/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-blue-600 text-white rounded-lg w-16 h-16 shadow border-2 border-blue-300">
            <span className="text-xs font-semibold">Jue</span><span className="text-sm font-bold">24/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-gray-100 text-gray-400 rounded-lg w-16 h-16 border border-gray-200">
            <span className="text-xs font-semibold">Vie</span><span className="text-sm">25/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-gray-100 text-gray-400 rounded-lg w-16 h-16 border border-gray-200">
            <span className="text-xs font-semibold">Sáb</span><span className="text-sm">26/09</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-gray-100 text-gray-400 rounded-lg w-16 h-16 border border-gray-200">
            <span className="text-xs font-semibold">Dom</span><span className="text-sm">27/09</span>
          </div>

          {/* Leyenda */}
          <div className="flex items-center space-x-4 ml-4 text-xs text-gray-600">
            <span className="flex items-center"><span className="w-3 h-3 bg-green-600 rounded-full mr-1"></span> Cerrado</span>
            <span className="flex items-center"><span className="w-3 h-3 bg-blue-600 rounded-full mr-1"></span> Hoy</span>
            <span className="flex items-center"><span className="w-3 h-3 bg-red-500 rounded-full mr-1"></span> Sin cerrar</span>
            <span className="flex items-center"><span className="w-3 h-3 bg-gray-200 rounded-full mr-1"></span> Pendiente</span>
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex flex-wrap gap-3">
          <button className="bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-semibold py-2 px-4 rounded border border-yellow-500 transition text-sm flex items-center">
            📋 Cierre del Día
          </button>
          <button className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded transition text-sm flex items-center">
            🔒 Cerrar Semana
          </button>
          <button className="bg-white hover:bg-gray-50 text-blue-600 font-semibold py-2 px-4 rounded border border-blue-200 transition text-sm flex items-center">
            📅 Editar Fecha Fin
          </button>
          <button className="bg-white hover:bg-gray-50 text-blue-600 font-semibold py-2 px-4 rounded border border-blue-200 transition text-sm flex items-center">
            📅 Editar Fecha Inicio
          </button>
          <button className="bg-white hover:bg-gray-50 text-gray-600 font-semibold py-2 px-4 rounded border border-gray-300 transition text-sm flex items-center ml-auto">
            🕒 Semanas Anteriores
          </button>
        </div>
      </div>

      {/* TÍTULO PRINCIPAL */}
      <div>
        <h1 className="text-3xl font-normal text-gray-800 mb-1">Bienvenido al Sistema Dream</h1>
        <p className="text-gray-500">Selecciona un módulo en el menú</p>
      </div>

      {/* GRID DE MÓDULOS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {modulos.map((mod, index) => (
          <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center text-center hover:shadow-md transition">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">{mod.titulo}</h3>
            <p className="text-sm text-gray-500 mb-6 flex-grow">{mod.desc}</p>
            <Link 
              href={mod.href}
              className={`${mod.colorBtn} hover:opacity-90 text-white font-medium py-2 px-6 rounded transition w-full max-w-[140px]`}
              onClick={(e) => {
                if (mod.href === "#") {
                  e.preventDefault();
                  alert("Módulo en desarrollo para próxima actualización");
                }
              }}
            >
              Abrir
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}