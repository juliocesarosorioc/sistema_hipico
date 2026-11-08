"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/core/supabase";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { useCarrerasDiaStore, type CarreraDelDia } from "@/shared/store/useCarrerasDiaStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { diaDeLaTabla } from "@/features/tablas/components/MonitorTablas";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";
import {
  resolverEstadoSemaforo,
  COLORES_SEMAFORO as COLORES,
  type EstadoCarrera,
} from "@/features/gestion/lib/semaforo-core";

export type { EstadoCarrera };
export { COLORES };

type Props = {
  hipodromo: string;
  fecha: string;
  /** Números de carrera existentes para [fecha + hipódromo] (fuente: BD). */
  carreras: number[];
  /** Carrera resaltada. `null` = ninguna elegida aún (no se resalta sola). */
  activa: number | null;
  onSeleccionar: (carrera: number, info?: { abierta: boolean; estado: EstadoCarrera }) => void;
  /** Modo Manual (bypass Gaceta): habilita elegir carreras no registradas. */
  manual?: boolean;
  /** Números de carrera que tienen jugadas cargadas (sesión o BD del módulo padre). */
  carrerasConJugadas?: number[];
  /** Números de carrera que ya están liquidadas (módulo padre / estado en vivo). */
  carrerasLiquidadas?: number[];
  /** Números de carrera que tienen caballos precargados/registrados. */
  carrerasConCaballos?: number[];
  /** Acción adicional alineada a la derecha en la fila de carreras (p. ej. Liquidar Carrera). */
  accionDerecha?: ReactNode;
  className?: string;
};

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/** Ancho del semáforo en modo manual: 12 carreras por defecto (siempre clicables). */
const MANUAL_TOTAL = 12;

/**
 * Semáforo de carreras contextualizado por fecha (clon dinámico del legacy):
 *  - Se alimenta de `carreras` (consulta a la BD para [fecha + hipódromo]).
 *  - SOLO se habilitan los botones de las carreras que existen ese día.
 *  - Modo Manual (manual=true): TODAS las carreras quedan habilitadas para
 *    registrar jugadas en una carrera vacía sin depender de la Gaceta IA.
 *  - Sin carreras registradas → semáforo vacío/inactivo con aviso.
 *  - gris = sin registro · verde = Registrada (sin jugadas) ·
 *    amarillo = Con jugadas · rojo = Liquidada.
 *
 * El estado de LIQUIDACIÓN se lee del registro CENTRAL
 * (`useRegistroCentralOpts` → `resultados_carreras`), la fuente compartida: el
 * ledger local (`useCarrerasDiaStore`) solo lo escribe quien finaliza en ESA
 * pestaña, así que una carrera liquidada desde otra sesión/dispositivo se veía
 * verde. El central también aporta `aplicado_a_tablas` y los ganadores.
 */
export function SemaforoCarreras({
  hipodromo,
  fecha,
  carreras,
  activa,
  onSeleccionar,
  manual,
  carrerasConJugadas,
  carrerasLiquidadas,
  carrerasConCaballos,
  accionDerecha,
  className = "",
}: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);
  const activos = useHipodromosActivos();
  const hipoLimpio = String(hipodromo ?? "").trim();
  const claveHipo = claveHipodromo(hipoLimpio);
  const tieneHipodromo = Boolean(hipoLimpio && claveHipo && hipoLimpio.toUpperCase() !== "SIN_HIPODROMO");
  const hipo = tieneHipodromo ? hipoKey(hipoLimpio) : "";
  const nombreMostrar = tieneHipodromo ? nombrePropioHipodromo(hipoLimpio, activos) : "";
  // Registro central (matriz `carreras` + resultados embebidos): la fuente de la
  // liquidación compartida. El hook deduplica la consulta con el módulo padre.
  const { carrerasDe } = useRegistroCentralOpts(fecha);
  const centrales = useMemo(() => (tieneHipodromo ? carrerasDe(hipoLimpio) : []), [carrerasDe, hipoLimpio, tieneHipodromo]);

  // Carreras con jugadas persistidas en BD (`tickets_apuestas`) para [fecha + hipódromo].
  // Garantiza que al reversar una liquidación o recargar la página, las carreras que
  // tienen jugadas cargadas se pinten en AMARILLO (`con_jugadas`).
  const [carrerasBdConJugadas, setCarrerasBdConJugadas] = useState<number[]>([]);
  // Carreras liquidadas detectadas directamente en la base de datos central (`resultados_carreras`).
  const [carrerasBdLiquidadas, setCarrerasBdLiquidadas] = useState<number[]>([]);
  const [recargaVersion, setRecargaVersion] = useState(0);

  useEffect(() => {
    const handleActualizar = () => {
      setRecargaVersion((v) => v + 1);
    };
    window.addEventListener("hipico:carreras-actualizadas", handleActualizar);
    return () => {
      window.removeEventListener("hipico:carreras-actualizadas", handleActualizar);
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    const sb = supabase;
    const dia = String(fecha ?? "").slice(0, 10);
    if (!sb || !dia || !tieneHipodromo) {
      setCarrerasBdConJugadas([]);
      setCarrerasBdLiquidadas([]);
      return () => { vivo = false; };
    }
    void (async () => {
      try {
        const [ticketsRes, resultadosRes] = await Promise.all([
          sb
            .from("tickets_apuestas")
            .select("carrera, hipodromo, estado, anulada, nota_auditoria, fecha_carrera, fecha_registro")
            .ilike("hipodromo", `%${hipoLimpio}%`)
            .order("id", { ascending: false })
            .limit(3000),
          sb
            .from("resultados_carreras")
            .select("carrera, hipodromo, ganadores, orden_llegada, aplicado_a_tablas")
            .eq("fecha", dia),
        ]);

        if (!vivo) return;

        const setLiq = new Set<number>();
        if (resultadosRes.data && Array.isArray(resultadosRes.data)) {
          for (const r of resultadosRes.data as Array<Record<string, unknown>>) {
            if (claveHipodromo(String(r.hipodromo ?? "")) !== claveHipo) continue;
            const tieneGan = Array.isArray(r.ganadores) && r.ganadores.length > 0;
            const tieneLleg = Array.isArray(r.orden_llegada) && r.orden_llegada.length > 0;
            const tieneTab = r.aplicado_a_tablas === true;
            if (tieneGan || tieneLleg || tieneTab) {
              const num = Number(r.carrera);
              if (Number.isFinite(num) && num > 0) setLiq.add(num);
            }
          }
        }
        setCarrerasBdLiquidadas([...setLiq]);

        const setNums = new Set<number>();
        for (const r of (ticketsRes.data ?? []) as Array<Record<string, unknown>>) {
          if (Boolean(r.anulada)) continue;
          const est = String(r.estado ?? "").trim().toLowerCase();
          if (est.startsWith("anul")) continue;
          if (claveHipodromo(String(r.hipodromo ?? "")) !== claveHipo) continue;
          let fechaTicket = String(r.fecha_carrera ?? r.fecha_registro ?? "").slice(0, 10);
          try {
            const nota = typeof r.nota_auditoria === "string" ? JSON.parse(r.nota_auditoria) : r.nota_auditoria;
            if (!r.fecha_carrera && nota && typeof nota === "object" && (nota as Record<string, unknown>).fecha_carrera) {
              fechaTicket = String((nota as Record<string, unknown>).fecha_carrera).slice(0, 10);
            }
          } catch {
            /* ignore */
          }
          if (fechaTicket && fechaTicket !== dia) continue;
          const num = Number(r.carrera);
          if (Number.isFinite(num) && num > 0) setNums.add(num);
        }
        setCarrerasBdConJugadas([...setNums]);
      } catch {
        // best-effort
      }
    })();
    return () => { vivo = false; };
  }, [fecha, hipodromo, centrales, carrerasConJugadas?.length, carrerasLiquidadas?.length, recargaVersion, tieneHipodromo, hipoLimpio, claveHipo]);

  const porCarrera = (n: number): { estado: EstadoCarrera; tieneVentas: boolean; tieneCaballos: boolean } => {
    if (!tieneHipodromo) return { estado: "inactiva", tieneVentas: false, tieneCaballos: false };

    const tabla = tablas.find(
      (t) => hipoKey(t.hipodromo) === hipo && t.carrera === n && diaDeLaTabla(t) === fecha
    );
    const registro = carrerasDia.find(
      (c: CarreraDelDia) => hipoKey(c.hipodromo) === hipo && c.carrera === n && c.fecha === fecha
    );
    const central = centrales.find((c) => Number(c.carrera) === n);

    // Detección estricta de ejemplares/caballos precargados (> 0)
    const contarCaballos = (arr: unknown): number => {
      if (!Array.isArray(arr)) return 0;
      return arr.filter((c) => {
        if (!c) return false;
        if (typeof c === "string" || typeof c === "number") return String(c).trim().length > 0;
        if (typeof c === "object") {
          const num = String((c as Record<string, unknown>).numero ?? (c as Record<string, unknown>).pp ?? "").trim();
          const nom = String((c as Record<string, unknown>).nombre ?? "").trim();
          return Boolean(num || nom);
        }
        return false;
      }).length;
    };

    const cantCaballos = Math.max(
      contarCaballos(central?.caballos),
      contarCaballos(tabla?.caballos),
      contarCaballos((registro as unknown as { caballos?: unknown })?.caballos)
    );
    const tieneCaballos = cantCaballos > 0 || Boolean(carrerasConCaballos?.includes(n));

    // Detección estricta de jugadas activas (tickets no anulados)
    const jugadasEnMemoria =
      tickets.some(
        (tk) =>
          tk.carrera === n &&
          Boolean(tk.hipodromo && hipoKey(tk.hipodromo) === hipo) &&
          Boolean(tk.fecha && tk.fecha === fecha)
      ) ||
      (Number((tabla as { cantidad_vendida?: number } | undefined)?.cantidad_vendida ?? 0) > 0) ||
      (registro?.ventas?.length ?? 0) > 0;

    const tieneJugadas =
      jugadasEnMemoria ||
      (carrerasConJugadas != null
        ? n === activa
          ? carrerasConJugadas.includes(n)
          : carrerasConJugadas.includes(n) || carrerasBdConJugadas.includes(n)
        : carrerasBdConJugadas.includes(n));

    // Detección de liquidación y reversión:
    // Si la carrera fue reabierta / reversada (programada sin ganadores ni aplicado_a_tablas),
    // o no está en la lista de liquidadas provista por el padre, NO está liquidada.
    const estCentral = String(central?.estado ?? "").toLowerCase();
    const centralReabierta =
      (central != null &&
        estCentral === "programada" &&
        !central.aplicado_a_tablas &&
        (central.ganadores?.length ?? 0) === 0) ||
      (registro != null &&
        String(registro.estado ?? "").toLowerCase() === "programada" &&
        !registro.aplicado_a_tablas &&
        (registro.ganadores?.length ?? 0) === 0);

    const liquidada = centralReabierta
      ? false
      : carrerasLiquidadas != null
        ? carrerasLiquidadas.includes(n)
        : Boolean(tabla?.cerrada) ||
          String(tabla?.estado ?? "").toLowerCase() === "cerrada" ||
          String(registro?.estado ?? "").toLowerCase() === "liquidada" ||
          estCentral === "liquidada" ||
          estCentral === "cerrada" ||
          central?.aplicado_a_tablas === true ||
          (central?.ganadores?.length ?? 0) > 0 ||
          carrerasBdLiquidadas.includes(n);

    // MÁQUINA DE ESTADOS DETERMINÍSTICA ESTRICTA (4 ESTADOS):
    // 1. ROJO: Si se liquidaron las jugadas es ROJO.
    // 2. AMARILLO: Si hay jugadas y no está liquidada es AMARILLO (al reversar vuelve aquí).
    // 3. VERDE: Si tiene caballos registrados (precargado) y NO hay jugadas es VERDE (al borrar jugadas vuelve aquí).
    // 4. GRIS: Si no tiene ni registros de jugadas ni caballos es GRIS (al borrar caballos vuelve aquí).
    const estado = resolverEstadoSemaforo({
      liquidada,
      tieneJugadas,
      tieneCaballos,
    });

    return { estado, tieneVentas: tieneJugadas, tieneCaballos };
  };

  // Si no hay hipódromo seleccionado, no deben aparecer carreras ni cambiar ningún color
  if (!tieneHipodromo) {
    return (
      <div className={`rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-2.5 transition ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <span className="text-sm">🏟️</span>
            <span>Seleccione un <b>hipódromo</b> para visualizar y gestionar sus carreras</span>
          </p>
          {accionDerecha ? <div className="shrink-0">{accionDerecha}</div> : null}
        </div>
      </div>
    );
  }

  const todosNumeros = [
    ...carreras,
    ...(carrerasConCaballos ?? []),
    ...carrerasBdConJugadas,
    ...(carrerasConJugadas ?? []),
    ...(carrerasLiquidadas ?? []),
    ...carrerasBdLiquidadas,
  ];
  const maxCarrera = todosNumeros.length ? Math.max(...todosNumeros) : 0;
  const total = manual ? Math.max(MANUAL_TOTAL, maxCarrera, activa ?? 0) : maxCarrera;

  if (total === 0) {
    return (
      <div className={`rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-2.5 transition ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <span className="text-sm">⚠️</span>
            <span>No hay carreras registradas para <b>{nombreMostrar}</b> el {fecha}.</span>
          </p>
          {accionDerecha ? <div className="shrink-0">{accionDerecha}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-line bg-surface p-2.5 sm:p-3 shadow-xs ${className}`}>
      {/* Encabezado y Leyenda Responsive */}
      <div className="mb-1.5 sm:mb-2 flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-semibold text-slate-600">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="font-black uppercase tracking-wide text-slate-800 text-[11px] sm:text-xs">
            {nombreMostrar} <span className="text-slate-400 font-normal">·</span> C{activa ?? "—"} <span className="text-slate-400 font-normal">·</span> {fecha}
          </span>
          {manual && (
            <span className="rounded-full bg-blue-600/15 px-2 py-0.5 font-black uppercase text-blue-700 text-[10px] tracking-tight">
              ✍️ Modo Manual ({total} carreras)
            </span>
          )}
        </div>
        
        <div className="hidden sm:flex flex-wrap items-center gap-2.5 text-[10px]">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-xs border border-slate-400 bg-slate-300" /> Sin registro ni caballos (Gris)</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-xs bg-emerald-600" /> Precargado con caballos (Verde)</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-xs bg-amber-400 ring-1 ring-amber-500" /> Con jugadas · Sin liquidar (Amarillo)</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-xs bg-red-600" /> Liquidada (Rojo)</span>
        </div>
      </div>

      {/* TIRA DE CARRERAS (Full width en móvil, táctil y sin botones tapando) */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-2 min-h-[48px] w-full">
        <div className="flex items-center gap-1.5 shrink-0 flex-nowrap px-2">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const { estado, tieneVentas, tieneCaballos } = porCarrera(n);
            const existe = manual || carreras.includes(n) || tieneVentas || tieneCaballos || estado === "abierta";
            const c = COLORES[estado];
            const activaEsta = activa !== null && n === activa;
            const manualSinRegistro = manual && !carreras.includes(n) && estado === "inactiva";
            return (
              <button
                key={n}
                type="button"
                onClick={() => existe && onSeleccionar(n, { abierta: manual ? true : estado !== "inactiva", estado })}
                disabled={!existe}
                title={existe ? (manualSinRegistro ? `C${n} (Modo Manual sin registro previo)` : c.label) : `C${n} · No hay carrera registrada para ${fecha}`}
                className={`grid h-9 w-9 sm:h-8 sm:w-8 shrink-0 place-items-center rounded-xl border-2 text-xs font-black transition-all shadow-xs ${
                  !existe
                    ? `cursor-not-allowed ${COLORES.inactiva.chip} opacity-80`
                    : `hover:brightness-95 active:scale-95 ${c.chip}`
                } ${activaEsta ? "ring-2 ring-indigo-600 ring-offset-2 ring-offset-surface shadow-md" : ""}`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* En Desktop: accionDerecha en la misma fila a la derecha */}
        {accionDerecha ? (
          <div className="hidden sm:flex items-center gap-1.5 shrink-0 ml-auto whitespace-nowrap pl-2">
            {accionDerecha}
          </div>
        ) : null}
      </div>

      {/* En Móvil: accionDerecha en su propia barra dedicada abajo (sin desplazamiento lateral) */}
      {accionDerecha ? (
        <div className="sm:hidden mt-2 pt-2 border-t border-line/60 w-full">
          {accionDerecha}
        </div>
      ) : null}
    </div>
  );
}

export default SemaforoCarreras;