import React, { useState } from 'react';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { colorDiscoNumero, numerosDeCaballo } from '@/features/saldos/lib/discos';
import { etiquetaJugada, ladosDePareo } from '@/features/taquilla/lib/nomenclatura';
import { jugadaInvolucraRetirado } from '@/features/carreras/lib/retiros-nucleo';
import {
  esMarca,
  esTablaFija,
  extraerNumeroTablaFija,
  extraerPareoMarca,
  formatearPrecioCorto,
} from '@/features/liquidacion/lib/etiquetas-reporte';
import type { FiltroModalidadTiempo } from '@/features/jugadas/lib/modalidad-tiempo';
import {
  esJugadaAdelantadaReporte,
  segmentarJugadasReporte,
  agruparAdelantadasPorSeccion,
  categoriaJugadaAdelantada,
} from '@/features/liquidacion/lib/reporte-carrera';

export {
  esJugadaAdelantadaReporte,
  segmentarJugadasReporte,
  agruparAdelantadasPorSeccion,
  categoriaJugadaAdelantada,
};

export type LlegadaCaballo = {
  numero: number | string;
  puesto: string;
  color: string;
};

export type JugadaVivo = {
  juega: string;
  aposto: string | number;
  jugo: string;
  caballo?: string;
  /** Precio unitario del ejemplar en Tabla Fija (ej. 38 en "5 a 38"). */
  precioTabla?: number;
  da: string;
  apostoDa: number | null;
  resultado: number | null;
  resultadoDa?: number | null;
  esAdelantada?: boolean;
  /** true cuando el ejemplar de la jugada fue retirado oficialmente. */
  esRetirado?: boolean;
  /** true cuando una Marca no se decidió en la pizarra oficial. */
  sinDecision?: boolean;
  /** Hora de carga de la jugada (HH:mm). */
  horaCarga?: string | null;
};

export type Adelantada = JugadaVivo & {
  descripcion?: string;
};

export type ResumenFila = {
  id: number | string;
  nombre: string;
  monto: number;
  riesgo?: number;
  excede?: boolean;
};

export type NotaExcedido = {
  nombre: string;
  riesgo: number;
  disponible: number;
};

export type ObservacionOrdenExceso = {
  orden: number;
  jugador: string;
  contraparte?: string;
  telefonoJugador?: string | null;
  telefonoContraparte?: string | null;
  jugada: string;
  montoSolicitado: number;
  montoAceptado: number;
  montoExcedido: number;
  disponibleAntes: number;
  motivo: string;
  resumenMencion?: string;
};

export type ReporteCarreraDatos = {
  encabezado: {
    grupo?: string;
    logoGrupo?: string | null;
    hipodromo: string;
    logoHipodromo?: string | null;
    carrera: string;
    fecha: string;
    llegada: LlegadaCaballo[];
    llegadaRaya?: LlegadaCaballo[];
    retirados?: (number | string)[];
  };
  liquidada?: boolean;
  jugadasVivo: JugadaVivo[];
  adelantadas: {
    tablas: Adelantada[];
    marcas: Adelantada[];
    tercios: Adelantada[];
    otras?: Adelantada[];
  };
  resumen: {
    ganan: ResumenFila[];
    pierden: ResumenFila[];
  };
  notaExcedidos?: NotaExcedido[];
  observacionesOrdenExceso?: ObservacionOrdenExceso[];
  filtroModalidad?: FiltroModalidadTiempo;
  /** Asientos contables internos "Bono por Cruce de jugadas" (no se renderizan en las tablas, solo se contabilizan en el resultado final). */
  asientosBonoCruce?: Array<{
    concepto: "Bono por Cruce de jugadas";
    cliente: string;
    brutoGanado: number;
    brutoPerdido: number;
    baseCruce: number;
    bonoCruce: number;
  }>;
};

const FormatoDinero = ({ monto }: { monto: number | null | undefined }) => {
  if (monto === null || monto === undefined || !Number.isFinite(monto)) {
    return <span className="font-bold text-slate-400">—</span>;
  }
  const isPositive = monto > 0;
  const isZero = monto === 0;
  const colorClass = isPositive ? "text-green-600" : isZero ? "text-slate-500" : "text-red-600";
  const signo = isPositive ? "+" : "";

  return (
    <span className={`font-bold tabular-nums ${colorClass}`}>
      {signo}{monto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
};

function DiscosSimples({ caballo }: { caballo?: string }) {
  const nums = numerosDeCaballo(caballo);
  if (!nums.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {nums.map((n, i) => (
        <span
          key={i}
          className={`inline-flex items-center justify-center w-4 h-4 rounded-md text-[9px] font-bold leading-none ${colorDiscoNumero(n)}`}
        >
          {n}
        </span>
      ))}
    </span>
  );
}

function Discos({ caballo }: { caballo?: string }) {
  const lados = ladosDePareo(String(caballo ?? ""));
  if (lados) {
    return (
      <span className="inline-flex items-center gap-0.5 align-middle">
        <DiscosSimples caballo={lados.juega} />
        <span className="px-0.5 text-[9px] font-black text-slate-600">x</span>
        <DiscosSimples caballo={lados.da} />
      </span>
    );
  }
  return <DiscosSimples caballo={caballo} />;
}

function tieneDatos(d: ReporteCarreraDatos | null | undefined): d is ReporteCarreraDatos {
  if (!d) return false;
  const llegada = d.encabezado?.llegada?.length ?? 0;
  const vivo = d.jugadasVivo?.length ?? 0;
  const adelantadas =
    (d.adelantadas?.tablas?.length ?? 0) +
    (d.adelantadas?.marcas?.length ?? 0) +
    (d.adelantadas?.tercios?.length ?? 0) +
    (d.adelantadas?.otras?.length ?? 0);
  const resumen = (d.resumen?.ganan?.length ?? 0) + (d.resumen?.pierden?.length ?? 0);
  return llegada + vivo + adelantadas + resumen > 0;
}

const TH = "text-left pb-1 font-semibold text-[9px] uppercase tracking-wide text-slate-400 h-[20px] align-middle";

function TablaJugadas({
  filas,
  mostrarResultado,
  retirados,
}: {
  filas: JugadaVivo[];
  mostrarResultado: boolean;
  retirados?: (number | string)[];
}) {
  return (
    <table className="w-full table-fixed text-[10px] leading-tight">
      <colgroup>
        <col className="w-[18%]" />
        <col className="w-[10%]" />
        <col className="w-[13%]" />
        <col className="w-[20%]" />
        <col className="w-[16%]" />
        <col className="w-[10%]" />
        <col className="w-[13%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-slate-300 h-[22px]">
          <th className={TH} title="Columna 1: Quien Juega (Jugador 1)">Quien Juega</th>
          <th className={`${TH} text-right`} title="Columna 2: Monto que arriesga el que juega">Apostó</th>
          <th className={`${TH} text-right pl-1`} title="Columna 3: Resultado Jugador 1 (Riesgo negativo por decidir / Decidido)">Resultado</th>
          <th className={`${TH} pl-2`} title="Columna 4: Modalidad y ejemplar(es)">Jugada</th>
          <th className={`${TH} pl-2`} title="Columna 5: Quien Da (Jugador 2)">Quien Da</th>
          <th className={`${TH} text-right`} title="Columna 6: Monto que arriesga el que da">Apostó</th>
          <th className={`${TH} text-right pl-1`} title="Columna 7: Resultado Jugador 2 (Riesgo negativo por decidir / Decidido)">Resultado</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((j, i) => {
          const aposto1Num = typeof j.aposto === 'number' ? j.aposto : parseFloat(String(j.aposto ?? '').replace(',', '.')) || 0;
          const jugoStr = String(j.jugo ?? "").trim();
          const involucraRetirado = Boolean(
            j.esRetirado ||
              (retirados && retirados.length > 0 && jugadaInvolucraRetirado(j.caballo, null, jugoStr, retirados))
          );
          const res1 = involucraRetirado
            ? 0
            : mostrarResultado
              ? j.resultado
              : aposto1Num > 0
                ? -Math.abs(aposto1Num)
                : null;
          const res2 = !j.da
            ? null
            : involucraRetirado
              ? 0
              : mostrarResultado
                ? (j.resultadoDa !== undefined ? j.resultadoDa : (j.resultado !== null ? -j.resultado : null))
                : j.apostoDa != null && j.apostoDa > 0
                  ? -Math.abs(j.apostoDa)
                  : null;
          const esMarcaSinDecision =
            mostrarResultado &&
            !involucraRetirado &&
            (Boolean(j.sinDecision) || (esMarca(jugoStr) && res1 === 0));
          const esEmpateNoDecidido = mostrarResultado && !involucraRetirado && res1 === 0 && !esMarcaSinDecision;
          return (
            <tr key={i} className="border-b border-slate-100 bg-white h-[26px]">
              <td className="py-[3px] pr-1 font-bold text-slate-800 whitespace-nowrap truncate align-middle">
                <span>{j.juega}</span>
              </td>
              <td className="py-[3px] text-right text-slate-600 tabular-nums whitespace-nowrap align-middle">{j.aposto}</td>
              <td className="py-[3px] pl-1 text-right whitespace-nowrap align-middle">
                {esMarcaSinDecision ? (
                  <span className="inline-block rounded bg-slate-200 px-1 py-0.5 text-[8.5px] font-black uppercase text-slate-700">
                    SIN DECISIÓN
                  </span>
                ) : involucraRetirado ? (
                  <span className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase text-rose-700">
                    RETIRADO
                  </span>
                ) : esEmpateNoDecidido ? (
                  <span className="font-bold tabular-nums text-slate-600">0,00 (Empate)</span>
                ) : res1 !== null ? (
                  <FormatoDinero monto={res1} />
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="py-[3px] pl-2 text-slate-700 whitespace-nowrap truncate align-middle">
                {(() => {
                  if (esMarca(jugoStr)) {
                    const pareoCab = extraerPareoMarca({
                      jugada: jugoStr,
                      caballo: j.caballo,
                    }).caballoPareo;
                    return <Discos caballo={pareoCab || j.caballo} />;
                  }
                  if (esTablaFija(jugoStr) || /^TABLA\b|^TF\b/i.test(jugoStr)) {
                    const numCab = extraerNumeroTablaFija({
                      jugada: jugoStr,
                      caballo: j.caballo,
                    });
                    const precio = j.precioTabla && j.precioTabla > 0 ? j.precioTabla : aposto1Num;
                    return (
                      <span className="inline-flex items-center gap-1 align-middle">
                        <Discos caballo={numCab || j.caballo} />
                        <span className="font-bold text-slate-800">
                          a {formatearPrecioCorto(precio)}
                        </span>
                      </span>
                    );
                  }
                  return (
                    <>
                      <span className="font-semibold">{etiquetaJugada(j.jugo)}</span> <Discos caballo={j.caballo} />
                    </>
                  );
                })()}
              </td>
              <td className="py-[3px] pl-2 text-slate-600 whitespace-nowrap truncate align-middle">{j.da || '—'}</td>
              <td className="py-[3px] text-right text-slate-600 tabular-nums whitespace-nowrap align-middle">
                {j.apostoDa === null || j.apostoDa === undefined ? '—' : j.apostoDa}
              </td>
              <td className="py-[3px] pl-1 text-right whitespace-nowrap align-middle">
                {esMarcaSinDecision ? (
                  <span className="inline-block rounded bg-slate-200 px-1 py-0.5 text-[8.5px] font-black uppercase text-slate-700">
                    SIN DECISIÓN
                  </span>
                ) : involucraRetirado && j.da ? (
                  <span className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase text-rose-700">
                    RETIRADO
                  </span>
                ) : esEmpateNoDecidido && j.da ? (
                  <span className="font-bold tabular-nums text-slate-600">0,00 (Empate)</span>
                ) : res2 !== null ? (
                  <FormatoDinero monto={res2} />
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SubSeccion({
  titulo,
  filas,
  mostrarResultado,
}: {
  titulo: string;
  filas: Adelantada[];
  mostrarResultado: boolean;
}) {
  if (!filas.length) return null;
  return (
    <div className="mb-2">
      <div className="bg-slate-100 text-slate-500 text-[8px] font-bold tracking-widest px-2 py-[2px] uppercase border-b border-slate-200">
        {titulo}
      </div>
      <div className="divide-y divide-slate-100">
        {filas.map((t, i) => (
          <div key={i} className="flex items-center justify-between px-2 py-1 text-[10px] bg-white">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-800">{t.juega}</span>
              <Discos caballo={t.descripcion} />
            </div>
            {mostrarResultado ? <FormatoDinero monto={t.resultado} /> : <FormatoDinero monto={-Math.abs(Number(t.aposto || 0))} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListaResumen({ filas }: { filas: ResumenFila[] }) {
  if (!filas.length) {
    return <div className="px-3 py-2 text-[10px] text-slate-400 italic">Sin movimientos</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 p-2 text-[10px]">
      {filas.map((g, i) => (
        <div key={i} className="flex items-center justify-between gap-1 py-[2px] border-b border-slate-50">
          <div className="flex items-center min-w-0">
            <span className="bg-slate-200 text-slate-500 rounded w-3.5 h-3.5 flex items-center justify-center text-[8px] mr-1 shrink-0">{g.id}</span>
            <span className="font-bold text-slate-800 truncate">{g.nombre}</span>
            {g.excede && (
              <span className="ml-0.5 shrink-0 font-black text-red-600" title="Arriesgó más de lo que dispone">*</span>
            )}
            {typeof g.riesgo === "number" && (
              <span
                className="ml-1 shrink-0 text-[8px] font-semibold text-slate-400 tabular-nums whitespace-nowrap"
                title="Arriesgó (monto que financió en la carrera)"
              >
                arriesgó {g.riesgo.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <FormatoDinero monto={g.monto} />
        </div>
      ))}
    </div>
  );
}

function NotaExcedidos({
  filas,
  observacionesOrden,
}: {
  filas: NotaExcedido[];
  observacionesOrden?: ObservacionOrdenExceso[];
}) {
  if (!filas.length && (!observacionesOrden || !observacionesOrden.length)) return null;
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="mx-4 mb-2 rounded border border-amber-400 bg-amber-50 px-2.5 py-2 text-[9px] text-amber-900">
      <p className="font-black uppercase tracking-wide flex items-center gap-1">
        <span>📋</span> OBSERVACIONES DE LÍMITE DE SALDO Y ORDEN DE JUEGO
      </p>
      {filas.length > 0 && (
        <ul className="mt-1 space-y-[2px]">
          {filas.map((n, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-800">* {n.nombre}</span>
              <span className="tabular-nums">
                arriesgó {fmt(n.riesgo)} · dispone {fmt(n.disponible)} (Excedido {fmt(Math.max(0, n.riesgo - n.disponible))})
              </span>
            </li>
          ))}
        </ul>
      )}
      {observacionesOrden && observacionesOrden.length > 0 && (
        <div className="mt-1.5 border-t border-amber-300/70 pt-1 space-y-1">
          {observacionesOrden.map((obs, idx) => (
            <div key={idx} className="rounded bg-white/80 px-2 py-1 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-[9px]">
              <span className="font-bold text-slate-900">
                #{obs.orden} ·{" "}
                {obs.resumenMencion ? (
                  <span className="font-semibold text-slate-800">{obs.resumenMencion}</span>
                ) : (
                  <>
                    {obs.telefonoJugador ? <span className="text-indigo-700 font-mono">@{obs.telefonoJugador} </span> : null}
                    {obs.jugador}
                    {obs.contraparte ? (
                      <>
                        {" "}con{" "}
                        {obs.telefonoContraparte ? <span className="text-indigo-700 font-mono">@{obs.telefonoContraparte} </span> : null}
                        {obs.contraparte}
                      </>
                    ) : null}{" "}
                    ({obs.jugada})
                  </>
                )}
              </span>
              <span className="tabular-nums font-bold text-amber-950">
                Pidió {fmt(obs.montoSolicitado)} → Juegan {fmt(obs.montoAceptado)} ({obs.motivo})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReporteCarrera({ datos }: { datos?: ReporteCarreraDatos | null }) {
  const [adelantadasAbierto, setAdelantadasAbierto] = useState(false);

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

  const { encabezado, jugadasVivo, adelantadas, resumen, notaExcedidos, observacionesOrdenExceso } = datos;
  const liquidada = datos.liquidada !== false;

  const { enVivo: jugadasEnVivoFiltradas, adelantadas: jugadasAdelantadasFiltradas } =
    segmentarJugadasReporte(jugadasVivo, adelantadas);

  const mitadIndex = Math.ceil(jugadasEnVivoFiltradas.length / 2);
  const jugadasCol1 = jugadasEnVivoFiltradas.slice(0, mitadIndex);
  const jugadasCol2 = jugadasEnVivoFiltradas.slice(mitadIndex);

  const seccionesAdelantadas = agruparAdelantadasPorSeccion(jugadasAdelantadasFiltradas);
  const totalAdelantadas = jugadasAdelantadasFiltradas.length;

  return (
    <div className="max-w-5xl mx-auto bg-white shadow-lg overflow-hidden text-[11px] leading-tight font-sans" id="reporte-imprimible">

      {/* 1. ENCABEZADO (Logos sin borde ni margen) */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600 text-white border-b border-blue-500/30 shadow-md px-4 py-2.5 flex items-center gap-3">
        <div className="w-14 h-14 shrink-0 rounded-xl border-0 p-0 m-0 bg-transparent shadow-none flex items-center justify-center overflow-hidden">
          {encabezado.logoHipodromo ? (
            <img
              src={encabezado.logoHipodromo}
              alt={`Logo de ${encabezado.hipodromo}`}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain border-0 p-0 m-0 bg-transparent shadow-none"
            />
          ) : (
            <span className="text-2xl leading-none" aria-hidden="true">🏇</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-blue-200 text-[9px] font-bold tracking-widest uppercase">
            {liquidada ? "Reporte de Liquidación" : "Reporte Preliminar de Jugadas (En Riesgo)"}
          </h3>
          <h1 className="text-lg font-extrabold leading-tight truncate">
            {encabezado.hipodromo} <span className="font-normal text-blue-200">•</span> {encabezado.carrera}
          </h1>
          <p className="text-blue-100 text-[10px]">{encabezado.fecha}</p>
          {datos.filtroModalidad && datos.filtroModalidad !== "TODAS" ? (
            <p
              className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-white/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wide text-amber-200 ring-1 ring-amber-300/40"
              title="Filtro de modalidad de tiempo aplicado al reporte"
            >
              {datos.filtroModalidad === "ADELANTADA"
                ? `⏳ Solo jugadas adelantadas · ${jugadasVivo.length} visibles`
                : `⚡ Solo jugadas en vivo · ${jugadasVivo.length} visibles`}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-100 leading-tight">
              {encabezado.grupo || "Grupo Hípico"}
            </p>
            <p className="text-[8px] font-semibold uppercase tracking-widest text-blue-300">Grupo</p>
          </div>
          <div className="w-14 h-14 shrink-0 rounded-xl border-0 p-0 m-0 bg-transparent shadow-none flex items-center justify-center overflow-hidden">
            {encabezado.logoGrupo ? (
              <img
                src={encabezado.logoGrupo}
                alt={`Logo de ${encabezado.grupo || "Grupo Hípico"}`}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain border-0 p-0 m-0 bg-transparent shadow-none"
              />
            ) : (
              <span className="text-2xl leading-none" aria-hidden="true">🏇</span>
            )}
          </div>
        </div>
      </div>

      {/* 2. PIZARRA DE LLEGADA */}
      {(() => {
        const llegadaRaya = encabezado.llegadaRaya ?? [];
        const retiradosLista = (encabezado.retirados ?? [])
          .map((x) => String(x ?? "").trim())
          .filter(Boolean);
        const hayOrdenDiferente =
          llegadaRaya.length > 0 &&
          encabezado.llegada.length > 0 &&
          llegadaRaya.map((x) => String(x.numero)).join(",") !==
            encabezado.llegada.map((x) => String(x.numero)).join(",");

        return (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b-2 border-blue-800/40 bg-gradient-to-r from-slate-50 via-white to-slate-50">
            <div className="flex flex-wrap items-center gap-4">
              {/* Pizarra Oficial (siempre visible) */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black tracking-widest text-blue-900 uppercase flex items-center gap-1">
                    <span>🏁</span> Pizarra Oficial
                  </span>
                  <span className="text-[8px] font-semibold text-slate-400 uppercase tracking-wider">
                    {hayOrdenDiferente ? "Puestos · Marcas · WPS" : "Orden Oficial de Llegada"}
                  </span>
                </div>
                {encabezado.llegada.length > 0 ? (
                  <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
                    {encabezado.llegada.map((caballo, idx) => (
                      <div key={idx} className="flex flex-col items-center">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg font-black shadow-sm border ${colorDiscoNumero(caballo.numero)}`}
                          title={`Puesto Oficial ${caballo.puesto}: Ejemplar #${caballo.numero}`}
                        >
                          {caballo.numero}
                        </div>
                        <span className="text-[9px] text-slate-600 mt-0.5 font-black uppercase">{caballo.puesto}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[9.5px] font-bold text-amber-800 border border-amber-200">
                    <span>⏳</span> En espera de resultado oficial de pizarra
                  </span>
                )}
                {retiradosLista.length > 0 && (
                  <div className="flex items-center gap-1.5 pl-2.5 border-l border-rose-200">
                    <span className="text-[10px] font-black tracking-wider text-rose-700 uppercase">
                      RET:
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {retiradosLista.map((num, idx) => (
                        <div
                          key={`ret-${idx}-${num}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-black shadow-sm border ${colorDiscoNumero(num)}`}
                          title={`Retirado: Ejemplar #${num}`}
                        >
                          {num}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Orden de Llegada en Raya (solo cuando difiere de la Pizarra Oficial por distanciamiento) */}
              {hayOrdenDiferente && (
                <div className="flex items-center gap-3 rounded-lg bg-amber-50/80 border border-amber-200 px-3 py-1.5">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black tracking-widest text-amber-900 uppercase flex items-center gap-1">
                      <span>🏇</span> Orden de Llegada (Raya)
                    </span>
                    <span className="text-[8px] font-bold text-amber-700 uppercase tracking-wider">
                      ⚖️ Distanciamiento · Tablas Fijas / Remates
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-2 border-l border-amber-200">
                    {llegadaRaya.map((caballo, idx) => (
                      <div key={idx} className="flex flex-col items-center">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-black shadow-sm border ${colorDiscoNumero(caballo.numero)}`}
                          title={`Cruza la Raya ${caballo.puesto}: Ejemplar #${caballo.numero}`}
                        >
                          {caballo.numero}
                        </div>
                        <span className="text-[8.5px] text-amber-800 mt-0.5 font-black uppercase">{caballo.puesto}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-500">
              {hayOrdenDiferente && (
                <span className="rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 border border-amber-300 font-black">
                  ⚖️ Distanciamiento Oficial
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* 3. TABLA DE 7 COLUMNAS (JUGADAS EN VIVO — SIN ADELANTADAS) */}
      {jugadasEnVivoFiltradas.length > 0 && (
        <div className="px-4 pt-2 pb-1">
          <div className="bg-slate-800 text-white text-[9px] font-bold tracking-widest px-2 py-1 uppercase rounded-t flex items-center justify-between">
            <span>⚡ Jugadas en Vivo</span>
            <span className="text-[8px] font-semibold text-slate-300">{jugadasEnVivoFiltradas.length} jugada(s)</span>
          </div>
          <div className="bg-slate-50 px-2 py-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 border border-t-0 border-slate-200 rounded-b">
            <TablaJugadas filas={jugadasCol1} mostrarResultado={liquidada} retirados={encabezado.retirados} />
            {jugadasCol2.length > 0 ? <TablaJugadas filas={jugadasCol2} mostrarResultado={liquidada} retirados={encabezado.retirados} /> : null}
          </div>
        </div>
      )}

      {/* 4. SECCIÓN DE JUGADAS ADELANTADAS (ACORDEÓN OCULTO POR DEFECTO) */}
      {totalAdelantadas > 0 && (
        <div className="px-4 pb-2 pt-1">
          <button
            type="button"
            onClick={() => setAdelantadasAbierto((v) => !v)}
            aria-expanded={adelantadasAbierto}
            className={`w-full bg-blue-800 hover:bg-blue-700 transition-colors text-white text-[9px] font-bold tracking-widest px-2.5 py-1.5 uppercase flex items-center justify-between cursor-pointer ${
              adelantadasAbierto ? "rounded-t" : "rounded"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span>{adelantadasAbierto ? "▾" : "▸"}</span>
              <span>⏳ Jugadas Adelantadas</span>
            </span>
            <span className="text-[8px] font-semibold text-blue-200">
              {totalAdelantadas} jugada(s) · {adelantadasAbierto ? "Ocultar ▲" : "Mostrar ▼"}
            </span>
          </button>
          {adelantadasAbierto && (
            <div className="bg-amber-50/30 border border-t-0 border-slate-200 rounded-b divide-y divide-slate-200">
              {seccionesAdelantadas.map((sec) => {
                const mitadAdelIndex = Math.ceil(sec.filas.length / 2);
                const adelantadasCol1 = sec.filas.slice(0, mitadAdelIndex);
                const adelantadasCol2 = sec.filas.slice(mitadAdelIndex);
                return (
                  <div key={sec.categoria} className="px-2 py-2">
                    <div className="mb-1.5 flex items-center justify-between rounded bg-slate-100 px-2 py-0.5 border border-slate-200">
                      <span className="text-[8.5px] font-black uppercase tracking-wider text-slate-700">
                        {sec.titulo}
                      </span>
                      <span className="text-[8px] font-bold text-slate-500">{sec.filas.length} jugada(s)</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                      <TablaJugadas filas={adelantadasCol1} mostrarResultado={liquidada} retirados={encabezado.retirados} />
                      {adelantadasCol2.length > 0 ? <TablaJugadas filas={adelantadasCol2} mostrarResultado={liquidada} retirados={encabezado.retirados} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 5. RESUMEN: GANAN (POSITIVOS) / PIERDEN (NEGATIVOS) */}
      {liquidada ? (
        <div className="px-4 pb-2 grid grid-cols-2 gap-3">
          <div className="border border-green-200 rounded-lg overflow-hidden bg-white">
            <div className="bg-green-600 text-white text-[10px] font-bold px-2 py-1 tracking-wide uppercase flex items-center">
              <span className="mr-1.5">🟢</span> Ganan / Positivos (+)
            </div>
            <ListaResumen filas={resumen.ganan} />
          </div>

          <div className="border border-red-200 rounded-lg overflow-hidden bg-white">
            <div className="bg-red-700 text-white text-[10px] font-bold px-2 py-1 tracking-wide uppercase flex items-center">
              <span className="mr-1.5">🔴</span> Pierden / Negativos (-)
            </div>
            <ListaResumen filas={resumen.pierden} />
          </div>
        </div>
      ) : null}

      {/* 5b. OBSERVACIONES DE LÍMITE DE SALDO Y ORDEN DE JUEGO */}
      <NotaExcedidos filas={notaExcedidos ?? []} observacionesOrden={observacionesOrdenExceso} />

      {/* 6. FOOTER */}
      <div className="px-4 py-1.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[9px] text-slate-500">
        <span>Tilde su jugada y se revisará · © {new Date().getFullYear()} <strong>Inversiones Club Sensación, C.A.</strong> — Propiedad Intelectual Protegida</span>
        <span>{jugadasEnVivoFiltradas.length} en vivo · {totalAdelantadas} adelantadas · Reclamos al privado</span>
      </div>

    </div>
  );
}
