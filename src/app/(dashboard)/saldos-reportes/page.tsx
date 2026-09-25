"use client";

import React, { useState } from "react";

// DATA DE PRUEBA BASADA EXACTAMENTE EN TUS CAPTURAS (SAM - 24/09/2026)
const reporteMock = {
  semana: "Del 21/09/2026 al 27/09/2026",
  dias: [
    {
      fecha: "2026-09-24",
      totalDia: -1401.50,
      hipodromos: [
        {
          nombre: "Belmont Park",
          carreras: [
            {
              numero: 4,
              pizarra: "9.2.7.1",
              totalCarrera: -165.00,
              jugadas: [
                { id: 1, rol: "Consigue", jugada: "2Y2N", caballo: "2", monto: "$60,00", resultado: -30.00 },
                { id: 2, rol: "Consigue", jugada: "2Y2N", caballo: "2", monto: "$300,00", resultado: -150.00 },
                { id: 3, rol: "Juega", jugada: "2Y2N", caballo: "2", monto: "$30,00", resultado: 14.25 },
                { id: 4, rol: "Consigue", jugada: "2N", caballo: "2", monto: "$500,00", resultado: 0.00 },
                { id: 5, rol: "Juega", jugada: "🔀 CRUCE", caballo: "", monto: "$0,00", resultado: 0.75 },
              ]
            }
          ]
        },
        {
          nombre: "Belterra Park",
          carreras: [
            {
              numero: 4,
              pizarra: "4",
              totalCarrera: -100.00,
              jugadas: [
                { id: 6, rol: "Consigue", jugada: "1Y2N", caballo: "4", monto: "$50,00", resultado: -50.00 },
                { id: 7, rol: "Consigue", jugada: "1Y2N", caballo: "4", monto: "$100,00", resultado: -100.00 },
                { id: 8, rol: "Juega", jugada: "1Y2N", caballo: "4", monto: "$50,00", resultado: 47.50 },
                { id: 9, rol: "Juega", jugada: "🔀 CRUCE", caballo: "", monto: "$0,00", resultado: 2.50 },
              ]
            }
          ]
        },
        {
          nombre: "Remington Park",
          carreras: [
            {
              numero: 5,
              pizarra: "3.7.4.1",
              totalCarrera: -250.00,
              jugadas: [
                { id: 10, rol: "Consigue", jugada: "PP", caballo: "4X8", monto: "$50,00", resultado: -50.00 },
                { id: 11, rol: "Consigue", jugada: "PP", caballo: "8X4", monto: "$50,00", resultado: 47.50 },
                { id: 12, rol: "Juega", jugada: "3Y4N", caballo: "8", monto: "$30,00", resultado: -30.00 },
                { id: 13, rol: "Juega", jugada: "🔀 CRUCE", caballo: "", monto: "$0,00", resultado: 2.50 },
              ]
            }
          ]
        }
      ]
    }
  ]
};

// Función auxiliar para dar formato a la moneda y los colores
const formatMoney = (amount: number) => {
  const isNegative = amount < 0;
  const colorClass = isNegative ? "text-red-600 font-bold" : "text-green-600 font-bold";
  const sign = isNegative ? "" : "+";
  // Convertimos a formato ej: -100,00 o +47,50
  const value = amount.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  return <span className={colorClass}>{sign}{value}</span>;
};

export default function SaldosReportes() {
  const [grupoSeleccionado, setGrupoSeleccionado] = useState("SAM");

  return (
    <div className="p-4 max-w-5xl mx-auto min-h-screen bg-gray-100 font-sans text-sm">
      
      {/* CABECERA */}
      <div className="bg-blue-800 text-white p-3 rounded-t-lg flex justify-between items-center shadow">
        <div className="flex items-center space-x-2">
          <span className="text-xl">📊</span>
          <h1 className="font-bold text-lg">{grupoSeleccionado}</h1>
        </div>
        <span className="font-mono bg-blue-900 px-3 py-1 rounded border border-blue-700">2026-09-24</span>
      </div>

      {/* CONTENEDOR DEL REPORTE */}
      <div className="bg-white border-x border-b border-gray-300 rounded-b-lg shadow-sm">
        
        {reporteMock.dias.map((dia, diaIdx) => (
          <div key={diaIdx} className="pb-4">
            
            {dia.hipodromos.map((hipodromo, hipIdx) => (
              <div key={hipIdx} className="mb-4">
                
                {hipodromo.carreras.map((carrera, carIdx) => (
                  <div key={carIdx} className="border border-gray-300 rounded mx-2 mt-3 overflow-hidden">
                    
                    {/* CABECERA DE LA CARRERA */}
                    <div className="bg-blue-50 border-b border-gray-300 p-2 flex justify-between items-center text-gray-800">
                      <div className="font-bold">
                        {hipodromo.nombre} — Carrera {carrera.numero}
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-gray-500">Pizarra: <strong className="text-black">{carrera.pizarra}</strong></span>
                        <div className={`px-2 py-1 rounded text-white font-bold text-xs ${carrera.totalCarrera < 0 ? 'bg-red-500' : 'bg-green-600'}`}>
                          {carrera.totalCarrera.toLocaleString("es-VE", { minimumFractionDigits: 2 })} USD
                        </div>
                      </div>
                    </div>

                    {/* TABLA DE JUGADAS (DISEÑO DENSO) */}
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-gray-600">
                          <th className="py-1 px-3 w-24">Rol</th>
                          <th className="py-1 px-3">Jugada</th>
                          <th className="py-1 px-3 w-20 text-center">Caballo</th>
                          <th className="py-1 px-3 w-24 text-right">Monto</th>
                          <th className="py-1 px-3 w-28 text-right">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {carrera.jugadas.map((jugada) => (
                          <tr key={jugada.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            <td className="py-1 px-3">
                              <span className="bg-gray-500 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded-full">
                                {jugada.rol}
                              </span>
                            </td>
                            <td className="py-1 px-3 font-medium text-gray-800">{jugada.jugada}</td>
                            <td className="py-1 px-3 text-center font-bold text-gray-700">{jugada.caballo}</td>
                            <td className="py-1 px-3 text-right text-gray-600">{jugada.monto}</td>
                            <td className="py-1 px-3 text-right">
                              {formatMoney(jugada.resultado)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                  </div>
                ))}
              </div>
            ))}

            {/* TOTAL DEL DÍA */}
            <div className="mx-2 mt-4 bg-red-100 border border-red-200 text-red-800 p-3 rounded flex justify-between font-bold items-center shadow-sm">
              <div className="flex items-center">
                <span className="mr-2">📉</span> Total apuestas del día:
              </div>
              <div className="text-lg">
                {dia.totalDia.toLocaleString("es-VE", { minimumFractionDigits: 2 })} USD
              </div>
            </div>

          </div>
        ))}

        {/* RESUMEN FINAL / FOOTER */}
        <div className="bg-gray-50 p-4 border-t border-gray-300 text-center text-xs text-gray-500">
          <p>✨ Sistema Dream — Saldos generados en tiempo real</p>
        </div>

      </div>
    </div>
  );
}