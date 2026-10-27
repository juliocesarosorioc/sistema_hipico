"use client";

import { useEffect, useMemo, useState } from "react";
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

type Props = {
  hipodromo: string;
  fecha: string;
  /** Números de carrera existentes para [fecha + hipódromo] (fuente: BD). */
  carreras: number[];
  /** Carrera resaltada. `null` = ninguna elegida aún (no se resalta sola). */
  activa: number | null;
  onSeleccionar: (carrera: number) => void;
  /** Modo Manual (bypass Gaceta): habilita elegir carreras no registradas. */
  manual?: boolean;
  /** Números de carrera que tienen jugadas cargadas (sesión o BD del módulo padre). */
  carrerasConJugadas?: number[];
};

export type EstadoCarrera = "inactiva" | "abierta" | "con_jugadas" | "cerrada";

const COLORES: Record<EstadoCarrera, { chip: string; label: string; txt: string }> = {
  // Sin carrera registrada y sin jugadas = AZUL.
  inactiva: { chip: "border-sky-500/60 bg-sky-500/15 text-sky-700", label: "Sin registro", txt: "text-sky-700" },
  // Registrada SIN jugadas = VERDE.
  abierta: { chip: "border-emerald-500/60 bg-emerald-500/15 text-emerald-700", label: "Registrada", txt: "text-emerald-700" },
  // Con jugadas cargadas (no liquidada) = AMARILLO.
  con_jugadas: { chip: "border-warning-500/70 bg-warning-500/20 text-warning-700", label: "Con jugadas", txt: "text-warning-700" },
  // Liquidada = ROJO.
  cerrada: { chip: "border-danger-500/70 bg-danger-500/15 text-danger-600", label: "Liquidada", txt: "text-danger-600" },
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
export function SemaforoCarreras({ hipodromo, fecha, carreras, activa, onSeleccionar, manual, carrerasConJugadas }: Props) {
  const tablas = useTablasFijasStore((s) => s.tablas);
  const tickets = useTaquillaStore((s) => s.tickets);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);
  const activos = useHipodromosActivos();
  const hipo = hipoKey(hipodromo);
  const nombreMostrar = nombrePropioHipodromo(hipodromo, activos);
  // Registro central (matriz `carreras` + resultados embebidos): la fuente de la
  // liquidación compartida. El hook deduplica la consulta con el módulo padre.
  const { carrerasDe } = useRegistroCentralOpts(fecha);
  const centrales = useMemo(() => carrerasDe(hipodromo), [carrerasDe, hipodromo]);

  // Carreras con jugadas persistidas en BD (`tickets_apuestas`) para [fecha + hipódromo].
  // Garantiza que al reversar una liquidación o recargar la página, las carreras que
  // tienen jugadas cargadas se pinten en AMARILLO (`con_jugadas`).
  const [carrerasBdConJugadas, setCarrerasBdConJugadas] = useState<number[]>([]);
  useEffect(() => {
    let vivo = true;
    const sb = supabase;
    const dia = String(fecha ?? "").slice(0, 10);
    const claveHipo = claveHipodromo(hipodromo);
    if (!sb || !dia || !claveHipo) {
      setCarrerasBdConJugadas([]);
      return () => { vivo = false; };
    }
    void (async () => {
      try {
        const { data } = await sb
          .from("tickets_apuestas")
          .select("carrera, hipodromo, estado, anulada, nota_auditoria, fecha_registro")
          .ilike("hipodromo", `%${hipodromo.trim()}%`)
          .order("id", { ascending: false })
          .limit(3000);
        if (!vivo) return;
        const setNums = new Set<number>();
        for (const r of (data ?? []) as Array<Record<string, unknown>>) {
          if (Boolean(r.anulada)) continue;
          const est = String(r.estado ?? "").trim().toLowerCase();
          if (est.startsWith("anul")) continue;
          if (claveHipodromo(String(r.hipodromo ?? "")) !== claveHipo) continue;
          let fechaTicket = String(r.fecha_registro ?? "").slice(0, 10);
          try {
            const nota = typeof r.nota_auditoria === "string" ? JSON.parse(r.nota_auditoria) : r.nota_auditoria;
            if (nota && typeof nota === "object" && (nota as Record<string, unknown>).fecha_carrera) {
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
  }, [fecha, hipodromo, centrales, carrerasConJugadas?.length]);

  const porCarrera = (n: number): { estado: EstadoCarrera; tieneVentas: boolean } => {
    // TODO el cruce va acotado a `fecha`: una tabla o un registro del día
    // anterior con el mismo (hipódromo, carrera) jamás puede pintar el chip de HOY.
    const tabla = tablas.find(
      (t) => hipoKey(t.hipodromo) === hipo && t.carrera === n && diaDeLaTabla(t) === fecha
    );
    const registro = carrerasDia.find(
      (c: CarreraDelDia) => hipoKey(c.hipodromo) === hipo && c.carrera === n && c.fecha === fecha
    );
    // El estado CENTRAL manda: `aplicado_a_tablas`/`ganadores` los escribe la
    // liquidación en `resultados_carreras`, compartida por todos. Si el central
    // explícitamente indica que la carrera está "programada" (p. ej. tras reversar
    // la liquidación), una copia vieja en localStorage (`tabla.cerrada` o `registro.estado`)
    // NO debe forzarla a roja.
    const central = centrales.find((c) => Number(c.carrera) === n);
    const esPlaceholderManualSinCaballos =
      central != null &&
      String(central.origen ?? "").toLowerCase() === "manual" &&
      (central.caballos?.length ?? 0) === 0 &&
      !central.hora &&
      !central.distancia;
    const registrada = (carreras.includes(n) && !esPlaceholderManualSinCaballos) || Boolean(tabla);

    const estCentral = String(central?.estado ?? "").toLowerCase();
    const centralReabierta =
      central != null &&
      estCentral === "programada" &&
      !central.aplicado_a_tablas &&
      (central.ganadores?.length ?? 0) === 0;

    const liquidada = centralReabierta
      ? false
      : Boolean(tabla?.cerrada) ||
        String(tabla?.estado ?? "").toLowerCase() === "cerrada" ||
        String(registro?.estado ?? "").toLowerCase() === "liquidada" ||
        estCentral === "liquidada" ||
        estCentral === "cerrada" ||
        central?.aplicado_a_tablas === true ||
        (central?.ganadores?.length ?? 0) > 0;

    const conVentas =
      tickets.some(
        (tk) =>
          tk.carrera === n &&
          Boolean(tk.hipodromo && hipoKey(tk.hipodromo) === hipo) &&
          Boolean(tk.fecha && tk.fecha === fecha)
      ) ||
      Boolean(carrerasConJugadas?.includes(n)) ||
      carrerasBdConJugadas.includes(n) ||
      (Number((tabla as { cantidad_vendida?: number } | undefined)?.cantidad_vendida ?? 0) > 0) ||
      (registro?.ventas?.length ?? 0) > 0;

    if (liquidada) return { estado: "cerrada", tieneVentas: conVentas };
    if (conVentas) return { estado: "con_jugadas", tieneVentas: true };
    if (registrada) return { estado: "abierta", tieneVentas: false };
    return { estado: "inactiva", tieneVentas: false };
  };

  const todosNumeros = [...carreras, ...carrerasBdConJugadas, ...(carrerasConJugadas ?? [])];
  const maxCarrera = todosNumeros.length ? Math.max(...todosNumeros) : 0;
  const total = manual ? Math.max(MANUAL_TOTAL, maxCarrera, activa ?? 0) : maxCarrera;
  const vacio = !manual && maxCarrera === 0;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
        <span className="font-black uppercase tracking-wide"><span className="normal-case">{nombreMostrar}</span> · CARRERAS DEL {fecha}</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Sin registro</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Registrada (sin jugadas)</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-warning-500" /> Con jugadas</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-danger-500" /> Liquidada</span>
        {manual && (
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-black uppercase text-sky-700">
            ✍️ Modo Manual — carreras sin Gaceta habilitadas
          </span>
        )}
      </div>
      {vacio ? (
        <p className="rounded-xl border border-dashed border-line bg-gray-50 px-3 py-2 text-center text-[11px] font-semibold text-slate-400">
          Sin carreras registradas para {fecha} · {nombreMostrar} — el semáforo queda inactivo.
          {manual && " En Modo Manual la carrera activa queda habilitada para cargar jugadas."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const { estado, tieneVentas } = porCarrera(n);
            const existe = manual || carreras.includes(n) || tieneVentas;
            const c = COLORES[estado];
            const activaEsta = activa !== null && n === activa;
            const manualSinRegistro = manual && !carreras.includes(n) && estado === "inactiva";
            return (
              <button
                key={n}
                type="button"
                onClick={() => existe && onSeleccionar(n)}
                disabled={!existe}
                title={existe ? (manualSinRegistro ? `C${n} (sin carrera registrada)` : c.label) : `C${n} sin registro para ${fecha}`}
                className={`grid h-9 w-9 place-items-center rounded-lg border-2 text-xs font-black transition-transform ${
                  !existe
                    ? `cursor-not-allowed ${COLORES.inactiva.chip} opacity-75`
                    : `hover:scale-105 ${c.chip}`
                } ${activaEsta ? "ring-4 ring-indigo-500 ring-offset-2" : ""}`}
              >
                {n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SemaforoCarreras;