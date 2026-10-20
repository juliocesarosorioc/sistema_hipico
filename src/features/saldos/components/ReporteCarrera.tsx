import React from 'react';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { colorDiscoNumero, numerosDeCaballo } from '@/features/saldos/lib/discos';
import { ladosDePareo } from '@/features/taquilla/lib/nomenclatura';
import type { FiltroModalidadTiempo } from '@/features/jugadas/lib/modalidad-tiempo';

/**
 * ============================================================================
 * REPORTE DE CARRERA — plantilla de liquidación (sin datos de prueba)
 * ============================================================================
 *
 * Componente PURO de presentación:
 *   · recibe `datos` opcionalmente;
 *   · si no hay datos (o vienen vacíos) muestra un EmptyState profesional en
 *     vez de una tabla colapsada o de números falsos;
 *   · cuando hay jugadas, se arma denso y COMPACTO para que todo el resumen de
 *     la carrera entre en una sola hoja/pantalla y se ajuste al n° de jugadas.
 *
 * `ReporteCarreraDatos` es el contrato de entrada: lo llena
 * `armarReporteCarrera` (features/liquidacion) sin tocar este archivo.
 */

export type LlegadaCaballo = {
  numero: number | string;
  puesto: string;
  /** Clases tailwind del disco del número (color por número). */
  color: string;
};

export type JugadaVivo = {
  /** Cliente que juega. */
  juega: string;
  /** APOSTÓ — monto que arriesga el que JUEGA. */
  aposto: string | number;
  /** Texto de la jugada (ej. "10A9", "2Y2N", "TABLA 2"). */
  jugo: string;
  /** Ejemplar(es) de la jugada, para pintar el disco de color (ej. "5", "3x7"). */
  caballo?: string;
  /** DA / el que consigue o va a los otros ejemplares ("" si no tiene par). */
  da: string;
  /** APOSTÓ — monto que arriesga el que DA (null si la jugada no tiene par). */
  apostoDa: number | null;
  /** Neto del cliente; null = pendiente de liquidar (no se pinta hasta decidirse). */
  resultado: number | null;
  /**
   * Modalidad de TIEMPO: `true` = ⏳ ADELANTADA (cargada antes de que corra la
   * carrera) y la fila lleva su badge distintivo; `false`/ausente = ⚡ en vivo.
   */
  esAdelantada?: boolean;
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
  /** Ítem 10: cuánto arriesgó (financió) este jugador en la carrera. */
  riesgo?: number;
  /** Ítem 10: true si arriesgó más de lo que dispone (saldo + aval). */
  excede?: boolean;
};

/** Ítem 10: jugador que arriesgó más de su disponible — va a la nota al pie. */
export type NotaExcedido = {
  nombre: string;
  riesgo: number;
  disponible: number;
};

export type ReporteCarreraDatos = {
  encabezado: {
    /** Grupo hípico dueño del reporte (encabezado). */
    grupo?: string;
    /** Logo del grupo en PNG (Data URL) para la cabecera. */
    logoGrupo?: string | null;
    hipodromo: string;
    /** Logo del hipódromo en PNG (Data URL) para la cabecera. */
    logoHipodromo?: string | null;
    carrera: string;
    fecha: string;
    llegada: LlegadaCaballo[];
  };
  /**
   * ¿La carrera ya se pagó/liquidó? Cuando es `false` el reporte muestra SOLO
   * las jugadas: se ocultan la pizarra oficial, las ganadoras adelantadas y el
   * resumen Ganan/Pierden (y la columna Resultado). Por defecto `true` para no
   * cambiar a los consumidores que siempre muestran carreras liquidadas.
   */
  liquidada?: boolean;
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
  /** Ítem 10: nota al pie con quienes arriesgaron más de lo que disponen. */
  notaExcedidos?: NotaExcedido[];
  /**
   * Filtro segmentado de modalidad de tiempo con el que se armó este reporte
   * (`TODAS` = sin filtro). No es responsabilidad de este componente filtrar:
   * los datos ya vienen filtrados de `armarReporteCarrera`; acá solo se ROTULA
   * qué filtro está activo para que quien mira/entienda la hoja sepa que está
   * viendo una porción de las jugadas de la carrera.
   */
  filtroModalidad?: FiltroModalidadTiempo;
};

// Componente de Utilidad para formatear moneda y color
const FormatoDinero = ({ monto }: { monto: number | null | undefined }) => {
  if (monto === null || monto === undefined || !Number.isFinite(monto)) {
    return <span className="font-bold text-slate-400">—</span>;
  }
  const isPositive = monto > 0;
  const isZero = monto === 0;
  const colorClass = isPositive ? "text-green-600" : isZero ? "text-slate-500" : "text-red-600";
  const signo = isPositive ? "+" : "";

  return (
    <span className={`font-bold ${colorClass}`}>
      {signo}{monto.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
    </span>
  );
};

/** Discos de color de una lista de ejemplares ("5" → 1 disco, "3,7" → 2). */
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

/**
 * Discos de los ejemplares de una jugada. En un PAREO ("1X8") se separan con una
 * «×» los ejemplares de cada lado (el del que JUEGA y el del que DA), para que se
 * distinga quién juega uno y quién el otro: "1 × 8".
 */
function Discos({ caballo }: { caballo?: string }) {
  const lados = ladosDePareo(String(caballo ?? ""));
  if (lados) {
    return (
      <span className="inline-flex items-center gap-0.5 align-middle">
        <DiscosSimples caballo={lados.juega} />
        <span className="px-0.5 text-[9px] font-black text-slate-400">×</span>
        <DiscosSimples caballo={lados.da} />
      </span>
    );
  }
  return <DiscosSimples caballo={caballo} />;
}

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

const TH = "text-left pb-1 font-semibold text-[9px] uppercase tracking-wide text-slate-400";

/** Cabecera + filas de la tabla "en vivo" para una mitad de las jugadas. */
function TablaJugadas({ filas, mostrarResultado }: { filas: JugadaVivo[]; mostrarResultado: boolean }) {
  return (
    <table className="w-full text-[10px] leading-tight">
      <thead>
        <tr className="border-b border-slate-300">
          <th className={TH}>Juega</th>
          <th className={`${TH} text-right`} title="Monto que arriesga el que juega">Apostó</th>
          <th className={`${TH} pl-2`}>Jugada</th>
          <th className={`${TH} pl-2`}>Da</th>
          <th className={`${TH} text-right`} title="Monto que arriesga el que da">Apostó</th>
          {mostrarResultado ? <th className={`${TH} text-right`}>Resultado</th> : null}
        </tr>
      </thead>
      <tbody>
        {filas.map((j, i) => (
          <tr key={i} className="border-b border-slate-100 bg-white">
            <td className="py-[3px] pr-1 font-bold text-slate-800 whitespace-nowrap">{j.juega}</td>
            <td className="py-[3px] text-right text-slate-600 tabular-nums whitespace-nowrap">{j.aposto}</td>
            <td className="py-[3px] pl-2 text-slate-700 whitespace-nowrap">
              <span className="font-semibold">{j.jugo}</span> <Discos caballo={j.caballo} />
              {/* Badge distintivo de la modalidad de TIEMPO (⏳ adelantada).
                  Se pinta junto a la jugada, como en los previews de venta. */}
              {j.esAdelantada ? (
                <span
                  title="Jugada adelantada: se cargó ANTES de que corra la carrera."
                  className="ml-1 rounded bg-amber-400/20 px-1 py-px text-[8px] font-black uppercase leading-none tracking-wide text-amber-700 ring-1 ring-amber-500/40"
                >
                  ⏳ ADELANTADA
                </span>
              ) : null}
            </td>
            <td className="py-[3px] pl-2 text-slate-600 whitespace-nowrap">{j.da || '—'}</td>
            <td className="py-[3px] text-right text-slate-600 tabular-nums whitespace-nowrap">
              {j.apostoDa === null || j.apostoDa === undefined ? '—' : j.apostoDa}
            </td>
            {/* RESULTADO: solo con la carrera liquidada y la jugada decidida. */}
            {mostrarResultado ? (
              <td className="py-[3px] text-right whitespace-nowrap">
                {j.resultado !== null && <FormatoDinero monto={j.resultado} />}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Una sub-sección de "Parada Adelantadas" (Tablas Fijas / Marcas / Tercios). */
function SubSeccion({ titulo, filas }: { titulo: string; filas: Adelantada[] }) {
  if (!filas.length) return null;
  return (
    <>
      <div className="bg-slate-100 text-slate-400 text-[8px] font-bold tracking-widest px-2 py-[2px] uppercase border-b border-slate-200">
        {titulo}
      </div>
      {filas.map((t, i) => (
        <div key={i} className="flex justify-between items-center px-2 py-[3px] border-b border-slate-100 text-[10px] font-bold bg-white">
          <span className="w-2/5 text-slate-800 truncate">{t.juega}</span>
          <span className="w-2/5 flex items-center gap-1 text-slate-500 font-normal truncate">
            {/* Solo los DISCOS: ya dibujan los ejemplares y la «×» del enfrentamiento
                ("4 × 1"). Antes se pintaba además la descripción como texto, que
                traía su propia «×» y duplicaba los números. */}
            <Discos caballo={t.descripcion} />
          </span>
          <span className="text-right"><FormatoDinero monto={t.resultado} /></span>
        </div>
      ))}
    </>
  );
}

/** Lista de clientes del resumen (Ganan o Pierden) a 2 columnas. */
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

/** Ítem 10: nota al pie con quienes arriesgaron más de su disponible. */
function NotaExcedidos({ filas }: { filas: NotaExcedido[] }) {
  if (!filas.length) return null;
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="mx-4 mb-2 rounded border border-amber-400 bg-amber-50 px-2 py-1.5 text-[9px] text-amber-900">
      <p className="font-black uppercase tracking-wide">
        * Arriesgó más de lo que dispone — a comunicar a todos los jugadores
      </p>
      <ul className="mt-1 space-y-[1px]">
        {filas.map((n, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-800">{n.nombre}</span>
            <span className="tabular-nums">
              arriesgó {fmt(n.riesgo)} · dispone {fmt(n.disponible)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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

  const { encabezado, jugadasVivo, adelantadas, resumen, notaExcedidos } = datos;
  /** Solo con la carrera pagada/liquidada se muestran pizarra y resultados. */
  const liquidada = datos.liquidada !== false;

  // Dividir jugadas en vivo en dos columnas para el layout denso
  const mitadIndex = Math.ceil(jugadasVivo.length / 2);
  const jugadasCol1 = jugadasVivo.slice(0, mitadIndex);
  const jugadasCol2 = jugadasVivo.slice(mitadIndex);
  const totalAdelantadas = adelantadas.tablas.length + adelantadas.marcas.length + adelantadas.tercios.length;

  return (
    <div className="max-w-5xl mx-auto bg-white shadow-lg overflow-hidden text-[11px] leading-tight font-sans" id="reporte-imprimible">

      {/* 1. ENCABEZADO — franja azul ejecutiva con logos de hipódromo y grupo */}
      <div className="bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600 text-white border-b border-blue-500/30 shadow-md px-4 py-2.5 flex items-center gap-3">
        <div className="w-14 h-14 shrink-0 rounded-xl bg-white/95 p-1 shadow-inner flex items-center justify-center overflow-hidden">
          {encabezado.logoHipodromo ? (
            <img
              src={encabezado.logoHipodromo}
              alt={`Logo de ${encabezado.hipodromo}`}
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain p-1"
            />
          ) : (
            <span className="text-2xl leading-none" aria-hidden="true">🏇</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-blue-200 text-[9px] font-bold tracking-widest uppercase">Reporte de Liquidación</h3>
          <h1 className="text-lg font-extrabold leading-tight truncate">
            {encabezado.hipodromo} <span className="font-normal text-blue-200">•</span> {encabezado.carrera}
          </h1>
          <p className="text-blue-100 text-[10px]">{encabezado.fecha}</p>
          {/* Rótulo del filtro segmentado de modalidad de tiempo activo en la
              cabecera del Reporte de Liquidación: aclara que la hoja muestra
              solo una porción de las jugadas de la carrera. */}
          {datos.filtroModalidad && datos.filtroModalidad !== "TODAS" ? (
            <p
              className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-white/15 px-1.5 py-px text-[9px] font-black uppercase tracking-wide text-amber-200 ring-1 ring-amber-300/40"
              title="Filtro de modalidad de tiempo aplicado al reporte"
            >
              {datos.filtroModalidad === "ADELANTADA"
                ? "⏳ Solo jugadas adelantadas"
                : "⚡ Solo jugadas en vivo"}{" "}
              · {jugadasVivo.length} visibles
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
          <div className="w-14 h-14 shrink-0 rounded-xl bg-white/95 p-1 shadow-inner flex items-center justify-center overflow-hidden">
            {encabezado.logoGrupo ? (
              <img
                src={encabezado.logoGrupo}
                alt={`Logo de ${encabezado.grupo || "Grupo Hípico"}`}
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <span className="text-2xl leading-none" aria-hidden="true">🏇</span>
            )}
          </div>
        </div>
      </div>

      {/* 2. PIZARRA DE LLEGADA — solo si la carrera ya se liquidó */}
      {liquidada ? (
        <div className="flex items-center px-4 py-2 border-b-2 border-blue-800/40">
          <span className="text-[9px] font-bold tracking-widest text-slate-500 mr-4 uppercase">Llegada</span>
          <div className="flex gap-3">
            {encabezado.llegada.map((caballo, idx) => (
              <div key={idx} className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg font-black shadow-sm border ${colorDiscoNumero(caballo.numero)}`}>
                  {caballo.numero}
                </div>
                <span className="text-[9px] text-slate-500 mt-0.5 font-bold">{caballo.puesto}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 3. JUGADAS EN VIVO (Grid a 2 columnas) */}
      <div className="bg-slate-50 px-4 py-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        <TablaJugadas filas={jugadasCol1} mostrarResultado={liquidada} />
        <TablaJugadas filas={jugadasCol2} mostrarResultado={liquidada} />
      </div>

      {/* 4. PARADAS ADELANTADAS — solo con la carrera liquidada */}
      {liquidada && totalAdelantadas > 0 && (
        <div className="px-4 pb-2">
          <div className="bg-blue-800 text-white text-[9px] font-bold tracking-widest px-2 py-1 uppercase rounded-t">
            Parada Adelantadas
          </div>
          <SubSeccion titulo="Tablas Fijas" filas={adelantadas.tablas} />
          <SubSeccion titulo="Marcas Adelantadas" filas={adelantadas.marcas} />
          <SubSeccion titulo="Jugadas entre tercios adelantadas" filas={adelantadas.tercios} />
        </div>
      )}

      {/* 5. RESUMEN: GANAN / PIERDEN — solo con la carrera liquidada */}
      {liquidada ? (
        <div className="px-4 pb-2 grid grid-cols-2 gap-3">
          <div className="border border-green-200 rounded-lg overflow-hidden bg-white">
            <div className="bg-green-600 text-white text-[10px] font-bold px-2 py-1 tracking-wide uppercase flex items-center">
              <span className="mr-1.5">✅</span> Ganan
            </div>
            <ListaResumen filas={resumen.ganan} />
          </div>

          <div className="border border-red-200 rounded-lg overflow-hidden bg-white">
            <div className="bg-red-700 text-white text-[10px] font-bold px-2 py-1 tracking-wide uppercase flex items-center">
              <span className="mr-1.5">❌</span> Pierden
            </div>
            <ListaResumen filas={resumen.pierden} />
          </div>
        </div>
      ) : null}

      {/* 5b. NOTA AL PIE: QUIENES ARRIESGARON MÁS DE LO QUE DISPONEN (ítem 10) */}
      <NotaExcedidos filas={notaExcedidos ?? []} />

      {/* 6. OBSERVACIONES Y RECOMENDACIONES (FOOTER) */}
      <div className="px-4 py-1.5 bg-slate-50 border-t border-slate-200 flex justify-between text-[9px] text-slate-500">
        <span>Tilde su jugada y se revisará</span>
        <span>{jugadasVivo.length + totalAdelantadas} jugadas · Reclamos al privado</span>
      </div>

    </div>
  );
}
