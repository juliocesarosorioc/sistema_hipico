import React from 'react';
import { EmptyState } from '@/shared/components/ui/EmptyState';

/**
 * ============================================================================
 * REPORTE DE CARRERA — plantilla de liquidación (sin datos de prueba)
 * ============================================================================
 *
 * Antes este componente tenía un `mockData` clavado en el archivo ("La
 * Rinconada · 13ma carrera") y NO recibía datos por props. Eso servía de vista
 * previa, pero metía cifras y nombres inventados en la plataforma y hacía
 * imposible reutilizar la plantilla con datos reales.
 *
 * Ahora es una plantilla PURA:
 *   · recibe `datos` opcionalmente;
 *   · si no hay datos (o vienen vacíos) muestra un EmptyState profesional en
 *     vez de una tabla colapsada o de números falsos;
 *   · cuando haya jugadas, se arma igual que antes (misma pinta, densa).
 *
 * `ReporteCarreraDatos` es el contrato de entrada: el flujo de liquidación de
 * Gestión de Jugadas puede llenarlo sin tocar este archivo.
 */

export type LlegadaCaballo = {
  numero: number | string;
  puesto: string;
  /** Clases tailwind del disco del número (color por número). */
  color: string;
};

export type JugadaVivo = {
  juega: string;
  jugo: string;
  aposto: string | number;
  da: string;
  resultado: number;
};

export type Adelantada = {
  juega: string;
  descripcion?: string;
  resultado: number;
};

export type ResumenFila = {
  id: number | string;
  nombre: string;
  monto: number;
};

export type ReporteCarreraDatos = {
  encabezado: {
    hipodromo: string;
    carrera: string;
    fecha: string;
    llegada: LlegadaCaballo[];
  };
  jugadasVivo: JugadaVivo[];
  adelantadas: {
    tablas: Adelantada[];
    marcas: Adelantada[];
    tercios: Adelantada[];
  };
  resumen: {
    ganan: ResumenFila[];
    pierden: ResumenFila[];
  };
};

// Componente de Utilidad para formatear moneda y color
const FormatoDinero = ({ monto }: { monto: number }) => {
  const isPositive = monto > 0;
  const isZero = monto === 0;
  const colorClass = isPositive ? "text-green-600" : isZero ? "text-green-600" : "text-red-600";
  const signo = isPositive ? "+" : "";

  return (
    <span className={`font-bold ${colorClass}`}>
      {signo}{monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
    </span>
  );
};

/** ¿La estructura tiene algo que mostrar? Evita renderizar tablas vacías. */
function tieneDatos(d: ReporteCarreraDatos | null | undefined): d is ReporteCarreraDatos {
  if (!d) return false;
  const llegada = d.encabezado?.llegada?.length ?? 0;
  const vivo = d.jugadasVivo?.length ?? 0;
  const adelantadas =
    (d.adelantadas?.tablas?.length ?? 0) +
    (d.adelantadas?.marcas?.length ?? 0) +
    (d.adelantadas?.tercios?.length ?? 0);
  const resumen = (d.resumen?.ganan?.length ?? 0) + (d.resumen?.pierden?.length ?? 0);
  return llegada + vivo + adelantadas + resumen > 0;
}

export default function ReporteCarrera({ datos }: { datos?: ReporteCarreraDatos | null }) {
  if (!tieneDatos(datos)) {
    return (
      <div className="max-w-5xl mx-auto" id="reporte-imprimible">
        <EmptyState
          icono="🎟️"
          titulo="No hay jugadas registradas en esta carrera"
          descripcion="Seleccioná una carrera en Gestión de Jugadas y cargá su resultado para generar el reporte de liquidación."
        />
      </div>
    );
  }

  const { encabezado, jugadasVivo, adelantadas, resumen } = datos;

  // Dividir jugadas en vivo en dos columnas para el layout denso
  const mitadIndex = Math.ceil(jugadasVivo.length / 2);
  const jugadasCol1 = jugadasVivo.slice(0, mitadIndex);
  const jugadasCol2 = jugadasVivo.slice(mitadIndex);

  return (
    <div className="max-w-5xl mx-auto bg-white shadow-lg overflow-hidden text-sm font-sans" id="reporte-imprimible">

      {/* 1. ENCABEZADO */}
      <div className="bg-[#1a3822] text-white p-6 pb-4">
        <h3 className="text-emerald-500 text-xs font-bold tracking-widest uppercase mb-1">Hipismo Zenyatta</h3>
        <h1 className="text-3xl font-extrabold mb-1">
          {encabezado.hipodromo} <span className="font-normal text-emerald-100">•</span> {encabezado.carrera}
        </h1>
        <p className="text-slate-300 text-xs">{encabezado.fecha}</p>
      </div>

      {/* 2. PIZARRA DE LLEGADA */}
      <div className="flex items-center px-6 py-4 border-b-4 border-[#8B4513]">
        <span className="text-xs font-bold tracking-widest text-slate-500 mr-6 uppercase">Llegada</span>
        <div className="flex gap-4">
          {encabezado.llegada.map((caballo, idx) => (
            <div key={idx} className="flex flex-col items-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold shadow-sm ${caballo.color}`}>
                {caballo.numero}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 font-bold">{caballo.puesto}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. JUGADAS EN VIVO (Grid a 2 columnas) */}
      <div className="bg-slate-50 p-6 grid grid-cols-1 md:grid-cols-2 gap-6 relative">
        {/* Columna Izquierda */}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-semibold">JUEGA</th>
              <th className="text-left pb-2 font-semibold">JUGÓ</th>
              <th className="text-right pb-2 font-semibold">APOSTÓ</th>
              <th className="text-left pb-2 font-semibold pl-4">DA</th>
              <th className="text-right pb-2 font-semibold">RESULTADO</th>
            </tr>
          </thead>
          <tbody>
            {jugadasCol1.map((j, i) => (
              <tr key={i} className="border-b border-slate-200 bg-white">
                <td className="py-2 font-bold text-slate-800">{j.juega}</td>
                <td className="py-2 font-bold text-slate-800">{j.jugo}</td>
                <td className="py-2 text-right text-slate-600">{j.aposto}</td>
                <td className="py-2 pl-4 text-slate-600">{j.da}</td>
                <td className="py-2 text-right"><FormatoDinero monto={j.resultado} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Columna Derecha */}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-200">
              <th className="text-left pb-2 font-semibold">JUEGA</th>
              <th className="text-left pb-2 font-semibold">JUGÓ</th>
              <th className="text-right pb-2 font-semibold">APOSTÓ</th>
              <th className="text-left pb-2 font-semibold pl-4">DA</th>
              <th className="text-right pb-2 font-semibold">RESULTADO</th>
            </tr>
          </thead>
          <tbody>
            {jugadasCol2.map((j, i) => (
              <tr key={i} className="border-b border-slate-200 bg-white">
                <td className="py-2 font-bold text-slate-800">{j.juega}</td>
                <td className="py-2 font-bold text-slate-800">{j.jugo}</td>
                <td className="py-2 text-right text-slate-600">{j.aposto}</td>
                <td className="py-2 pl-4 text-slate-600">{j.da}</td>
                <td className="py-2 text-right"><FormatoDinero monto={j.resultado} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4. PARADAS ADELANTADAS */}
      <div className="px-6 pb-6">
        <div className="bg-[#1a3822] text-white text-[11px] font-bold tracking-widest px-3 py-1.5 uppercase rounded-t shadow-sm">
          Parada Adelantadas
        </div>

        {/* Tablas Fijas */}
        <div className="bg-slate-100 text-slate-500 text-[10px] font-bold tracking-widest px-3 py-1 border-b border-slate-200 uppercase">
          Tablas Fijas
        </div>
        {adelantadas.tablas.map((t, i) => (
          <div key={i} className="flex justify-between px-3 py-2 border-b border-slate-100 text-xs font-bold bg-white">
            <span className="w-1/3 text-slate-800">{t.juega}</span>
            <span className="w-1/3 text-slate-500 font-normal">{t.descripcion}</span>
            <span className="w-1/3 text-right"><FormatoDinero monto={t.resultado} /></span>
          </div>
        ))}

        {/* Marcas Adelantadas */}
        <div className="bg-slate-100 text-slate-500 text-[10px] font-bold tracking-widest px-3 py-1 border-b border-slate-200 uppercase">
          Marcas Adelantadas
        </div>
        {adelantadas.marcas.map((m, i) => (
          <div key={i} className="flex justify-between px-3 py-2 border-b border-slate-100 text-xs font-bold bg-white">
            <span className="w-1/3 text-slate-800">{m.juega}</span>
            <span className="w-1/3 text-slate-500 font-normal">{m.descripcion}</span>
            <span className="w-1/3 text-right"><FormatoDinero monto={m.resultado} /></span>
          </div>
        ))}

        {/* Jugadas Entre Tercios Adelantadas (A 2 columnas) */}
        <div className="bg-slate-100 text-slate-500 text-[10px] font-bold tracking-widest px-3 py-1 border-b border-slate-200 uppercase">
          Jugadas entre tercios adelantadas
        </div>
        <div className="grid grid-cols-2 bg-white text-xs font-bold">
          <div className="border-r border-slate-100">
            {adelantadas.tercios.slice(0, 2).map((t, i) => (
              <div key={i} className="flex justify-between px-3 py-2 border-b border-slate-100 text-slate-800">
                <span>{t.juega}</span>
                <FormatoDinero monto={t.resultado} />
              </div>
            ))}
          </div>
          <div>
            {adelantadas.tercios.slice(2, 4).map((t, i) => (
              <div key={i} className="flex justify-between px-3 py-2 border-b border-slate-100 text-slate-800">
                <span>{t.juega}</span>
                <FormatoDinero monto={t.resultado} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. RESUMEN: GANAN / PIERDEN */}
      <div className="px-6 pb-4 grid grid-cols-2 gap-4">

        {/* Ganan */}
        <div className="border border-green-200 rounded-lg overflow-hidden bg-white">
          <div className="bg-green-600 text-white text-xs font-bold px-3 py-2 tracking-wide uppercase flex items-center">
            <span className="mr-2">✅</span> Ganan
          </div>
          <div className="grid grid-cols-2 gap-x-4 p-3 text-xs">
            {resumen.ganan.map((g, i) => (
              <div key={i} className="flex justify-between py-1 border-b border-slate-50">
                <div className="flex items-center">
                  <span className="bg-slate-200 text-slate-500 rounded-full w-4 h-4 flex items-center justify-center text-[9px] mr-2">{g.id}</span>
                  <span className="font-bold text-slate-800">{g.nombre}</span>
                </div>
                <FormatoDinero monto={g.monto} />
              </div>
            ))}
          </div>
        </div>

        {/* Pierden */}
        <div className="border border-red-200 rounded-lg overflow-hidden bg-white">
          <div className="bg-red-700 text-white text-xs font-bold px-3 py-2 tracking-wide uppercase flex items-center">
            <span className="mr-2">❌</span> Pierden
          </div>
          <div className="grid grid-cols-2 gap-x-4 p-3 text-xs">
            {resumen.pierden.map((p, i) => (
              <div key={i} className="flex justify-between py-1 border-b border-slate-50">
                <div className="flex items-center">
                  <span className="bg-slate-200 text-slate-500 rounded-full w-4 h-4 flex items-center justify-center text-[9px] mr-2">{p.id}</span>
                  <span className="font-bold text-slate-800">{p.nombre}</span>
                </div>
                <FormatoDinero monto={p.monto} />
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 6. OBSERVACIONES Y RECOMENDACIONES (FOOTER) */}
      <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-between text-[11px] text-slate-500">
        <span>Tilde su jugada y se revisará</span>
        <span>{jugadasVivo.length + adelantadas.tablas.length + adelantadas.marcas.length + adelantadas.tercios.length} jugadas · Reclamos al privado</span>
      </div>

    </div>
  );
}
