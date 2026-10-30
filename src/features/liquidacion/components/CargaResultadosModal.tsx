"use client";

import { getHorseColor } from "@/shared/lib/horseColors";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import { validarPizarraSinDuplicados } from "@/features/liquidacion/lib/posiciones";
export { validarPizarraSinDuplicados };
import type { EjemplarTabla } from "@/features/tablas/lib/tipos";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";
import { CLAVES_WPS, ETIQUETAS_WPS, PREFIJO_WPS, pagoPorUno } from "@/features/motores/lib/wps";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";
import { Button } from "@/shared/components/ui/Button";

export type PizarraResultados = {
  pizarra: PizarraCarrera;
  empates: number[];
  llenas: number; // cuántas posiciones de llegada se cargaron
  /** Dividendos oficiales por $1 — POR CABALLO (claves "win:7", "place:7",
   *  "show:7"), solo para los pools que paga cada caballo según su lugar
   *  (1°→W+P+S · 2°→P+S · 3°→S). */
  dividendos?: Record<string, number> | null;
  /** Matriz de las jugadas AMERICANAS W/P/S, también por $1, en las claves
   *  "wps_WW", "wps_WP", "wps_WS", "wps_PP", "wps_PS" y "wps_SS". Va aparte de
   *  los dividendos por caballo porque el pago depende de las DOS cosas a la
   *  vez (qué se apostó × en qué puesto llegó): un mismo caballo 1º paga
   *  distinto según si la jugada era W, P o S, y eso las claves por posición no
   *  lo pueden expresar. Ver `src/lib/motores/wps.ts`. */
  matrizWps?: Record<string, number> | null;
  /** Premio por tabla: NO se carga aquí — se calcula automáticamente con lo que
   *  paga la tabla × la cantidad jugada (los retiros ajustan en el motor). */
  premio_por_tabla?: number | null;
};

const ORDENES = [
  { orden: 1, nombre: "primero" },
  { orden: 2, nombre: "segundo" },
  { orden: 3, nombre: "tercero" },
  { orden: 4, nombre: "cuarto" },
  { orden: 5, nombre: "quinto" },
  { orden: 6, nombre: "sexto" },
  { orden: 7, nombre: "septimo" },
  { orden: 8, nombre: "octavo" },
] as const;

/**
 * Mínimo absoluto de lugares de llegada en la pizarra. La cantidad NO está
 * limitada por arriba ni obligada a un número fijo: el `minLugares` es solo la
 * cantidad recomendada para poder calcular las jugadas de puestos (Venezuela 5,
 * Americanas/WPS 4) y nunca bloquea la confirmación.
 */
const LUGARES_MIN = 1;

/** Cantidad de puestos por defecto en la pizarra (Venezuela). */
export const PUESTOS_MIN = 5;

type Fila = { numero: string; empate: boolean };

type Pool = "win" | "place" | "show";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  hipodromo: string;
  carrera: string;
  /** Ejemplares de la tabla (opcional): prefija los números 1..N en orden. */
  caballos?: EjemplarTabla[] | null;
  /**
   * Lugares de llegada recomendados para calcular las jugadas de puestos
   * (Venezuela: 5 · Americanas/WPS: 4). Solo muestra advertencia si se cargan
   * menos; el mínimo real de la pizarra es 1.
   */
  minLugares?: number;
  /**
   * Resultados YA cargados para esta carrera: precarga el formulario con la
   * llegada, empates, dividendos y matriz W/P/S, dejando TODO editable. Es lo
   * que evita volver a tipear la pizarra completa cuando ya existe (y ya se
   * pagó): el operador solo ajusta lo que cambió.
   */
  inicial?: PizarraResultados | null;
  /**
   * La carrera activa YA está liquidada. En ese caso, si el operador CAMBIA
   * algún valor de la llegada cargada, la pantalla exige un motivo y la
   * plataforma vuelve a recalcular toda la liquidación. Editar el resultado de
   * una carrera que ya pagó mueve dinero real: sin rastro de por qué se cambió
   * no hay forma de auditar una diferencia de caja.
   */
  editandoLiquidada?: boolean;
  onConfirmar: (r: PizarraResultados, motivo?: string) => void;
};

/**
 * Módulo de Liquidación — Carga de Resultados compacta, con posiciones de
 * llegada SIN tope (mínimo 1) y checkbox de Empate (Dead Heat) por posición.
 * El WIN/PLACE/SHOW es POR CABALLO: cada ejemplar muestra los pools que paga
 * según su lugar (1°→W+P+S, 2°→P+S, 3°→S) y los caballos empatados comparten
 * su pool. Solo se cargan dividendos por caballo (opcional).
 *
 * Los puestos se pagan por el orden final de la pizarra. TABLAS y
 * REMATES pagan al caballo que CRUZÓ LA RAYA primero (por defecto el 1º
 * oficial); si un ganador es bajado/descalificado se puede estipular su número.
 * El premio por tabla se calcula automáticamente (valor que paga × cantidad).
 */
export function CargaResultadosModal({
  abierto,
  onCerrar,
  hipodromo,
  carrera,
  caballos,
  minLugares = PUESTOS_MIN,
  inicial,
  editandoLiquidada = false,
  onConfirmar,
}: Props) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [motivo, setMotivo] = useState("");
  const [usoDividendos, setUsoDividendos] = useState(false);
  const [dividendos, setDividendos] = useState<Record<string, string>>({});
  const [usoMatrizWps, setUsoMatrizWps] = useState(false);
  // Se captura TAL COMO lo imprime el tablero ("paga $12 por $2") y se convierte
  // a pago por $1 al guardar, para no pedirle a la casa una cuenta que no hace.
  const [matrizWps, setMatrizWps] = useState<Record<string, string>>({});
  const [mismoRaya, setMismoRaya] = useState(true);
  const [rayaNumero, setRayaNumero] = useState("");
  const [filasRaya, setFilasRaya] = useState<string[]>([]);
  const [alertaDuplicado, setAlertaDuplicado] = useState<string | null>(null);
  const hipodromosActivos = useHipodromosActivos();
  const nombreHipo = nombrePropioHipodromo(hipodromo, hipodromosActivos);
  // Casillas de posición en orden (1°, 2°, 3°…): Enter/↓ y ↑ mueven el cursor
  // entre ejemplares para cargar la llegada de corrido sin tocar el mouse.
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!abierto) return;
    setUsoDividendos(false);
    setDividendos({});
    setUsoMatrizWps(false);
    setMatrizWps({});
    setMismoRaya(true);
    setRayaNumero("");
    setFilasRaya(Array.from({ length: minLugares }, () => ""));
    setMotivo("");
    setAlertaDuplicado(null);

    // Precarga: si ya hay resultados cargados para esta carrera (aunque sea de
    // otra sesión, traídos del central), se rellena TODO el formulario en vez
    // de pedirle que vuelva a tipear la llegada completa. Sigue siendo editable.
    const p = inicial?.pizarra as Record<string, unknown> | undefined;
    if (inicial && p && (inicial.llenas ?? 0) > 0) {
      const nums = ORDENES.map(({ nombre }) => String(p[nombre] ?? "").trim());
      const ultimaConContenido = nums.reduce((acc, v, i) => (v ? i + 1 : acc), 0);
      const nFilas = Math.max(ultimaConContenido, minLugares);
      const empatesIni = inicial.empates ?? [];
      setFilas(
        Array.from({ length: nFilas }, (_, i) => ({
          numero: nums[i] ?? "",
          empate: empatesIni.includes(i + 1),
        }))
      );

      // Raya: cambia si el 1º de la pizarra o el orden de llegada en raya difiere del orden oficial.
      const ordenRayaIni = Array.isArray(p.orden_llegada_raya)
        ? (p.orden_llegada_raya as unknown[]).map((x) => String(x ?? "").trim())
        : [];
      const raya = String(p.primero_raya ?? ordenRayaIni[0] ?? "").trim();
      const hayDiferenciaRaya =
        (raya && raya !== nums[0]) ||
        (ordenRayaIni.filter(Boolean).length > 0 &&
          ordenRayaIni.filter(Boolean).join(",") !== nums.filter(Boolean).join(","));

      if (hayDiferenciaRaya) {
        setMismoRaya(false);
        setRayaNumero(raya || nums[0] || "");
        setFilasRaya(
          Array.from({ length: nFilas }, (_, i) => ordenRayaIni[i] ?? (i === 0 ? raya : nums[i] ?? ""))
        );
      } else {
        setFilasRaya(Array.from({ length: nFilas }, (_, i) => nums[i] ?? ""));
      }

      if (inicial.dividendos && Object.keys(inicial.dividendos).length) {
        setDividendos(
          Object.fromEntries(Object.entries(inicial.dividendos).map(([k, v]) => [k, String(v)]))
        );
        setUsoDividendos(true);
      }

      // La matriz viene "wps_WW" (por $1) y en pantalla se captura por $2.
      if (inicial.matrizWps && Object.keys(inicial.matrizWps).length) {
        const m: Record<string, string> = {};
        for (const [k, v] of Object.entries(inicial.matrizWps)) {
          if (!k.startsWith(PREFIJO_WPS)) continue;
          const clave = k.slice(PREFIJO_WPS.length);
          m[clave] = String(Math.round(Number(v) * 100) / 50); // por $1 → por $2
        }
        if (Object.keys(m).length) {
          setMatrizWps(m);
          setUsoMatrizWps(true);
        }
      }
      return;
    }

    // Carrera sin resultados previos: inicia limpio en blanco.
    //
    // A propósito NO se precargan los números de los ejemplares de la tabla. El
    // operador cargaba la llegada y el formulario ya traía 1, 2, 3, 4, 5… (los
    // números de los caballos en el orden en que están en la tabla), así que
    // parecía una llegada real y había que borrarla a mano antes de tipear la
    // verdadera. Una llegada es un dato que el operador declara, no un valor por
    // defecto: el formulario abre con las casillas vacías.
    setFilas(Array.from({ length: minLugares }, () => ({ numero: "", empate: false })));
  }, [abierto, caballos, minLugares, inicial]);

  /** Pools que paga cada caballo según su lugar de llegada, uniendo las
   *  posiciones que comparten Empate (Dead Heat): un empate en la posición P
   *  une P con P+1 en el mismo lugar, así los caballos empatados comparten
   *  exactamente los puestos que corresponden a ese lugar. */
  const poolsPorFila = useMemo(() => {
    const n = filas.length;
    const padre = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
      while (padre[x] !== x) {
        padre[x] = padre[padre[x]];
        x = padre[x];
      }
      return x;
    };
    filas.forEach((r, i) => {
      if (!r.empate || i + 1 >= n) return;
      const a = find(i);
      const b = find(i + 1);
      if (a !== b) padre[b] = a;
    });
    return filas.map((_, i) => {
      let menor = i;
      for (let j = 0; j < n; j++) if (find(j) === find(i)) menor = Math.min(menor, j);
      const lugar = menor + 1;
      return { win: lugar <= 1, place: lugar <= 2, show: lugar <= 3 };
    });
  }, [filas]);

  /**
   * Arma la pizarra final con TODO lo cargado en pantalla. Se separa de
   * `confirmar` porque la detección de cambios (editar una carrera ya
   * liquidada) necesita exactamente lo mismo que se va a guardar, y dos
   * versiones distintas terminarían divergiendo: una cosa es "no cambiaste
   * nada" y otra la pizarra que sale.
   */
  const construirResultado = (): PizarraResultados => {
    const ordenNombres = new Map<number, string>(ORDENES.map((o) => [o.orden, o.nombre]));
    const pizarra = {} as Record<string, string>;
    const empates: number[] = [];
    let nLlenas = 0;
    filas.forEach((r, i) => {
      if (!r.numero.trim()) return;
      nLlenas += 1;
      const nombre = ordenNombres.get(i + 1);
      if (nombre) pizarra[nombre] = r.numero.trim();
      if (r.empate) empates.push(i + 1);
    });
    let ordenRayaFinal: string[] | undefined = undefined;
    if (!mismoRaya) {
      const listaRaya = filasRaya.map((x) => x.trim()).filter(Boolean);
      const primRaya = (rayaNumero.trim() || listaRaya[0] || "").trim();
      if (primRaya) pizarra.primero_raya = primRaya;
      if (listaRaya.length > 0) {
        ordenRayaFinal = listaRaya;
      } else if (primRaya) {
        const oficiales = filas.map((r) => r.numero.trim()).filter(Boolean);
        ordenRayaFinal = [primRaya, ...oficiales.filter((x) => x !== primRaya)];
      }
    }

    const divFinal: Record<string, number> = {};
    if (usoDividendos) {
      const write = (pool: Pool, numero: string) => {
        const v = parseFloat(dividendos[`${pool}:${numero}`] ?? "");
        if (Number.isFinite(v) && v > 0) divFinal[`${pool}:${numero}`] = v;
      };
      filas.forEach((r, i) => {
        const n = r.numero.trim();
        if (!n) return;
        const pools = poolsPorFila[i];
        if (pools.win) write("win", n);
        if (pools.place) write("place", n);
        if (pools.show) write("show", n);
      });
    }
    const matrizFinal: Record<string, number> = {};
    if (usoMatrizWps) {
      CLAVES_WPS.forEach((clave) => {
        const porUno = pagoPorUno(parseFloat(matrizWps[clave] ?? ""));
        if (porUno > 0) matrizFinal[PREFIJO_WPS + clave] = porUno;
      });
    }
    return {
      pizarra: {
        ...pizarra,
        empates: empates.length ? empates : undefined,
        ...(ordenRayaFinal && ordenRayaFinal.length ? { orden_llegada_raya: ordenRayaFinal } : {}),
      } as PizarraCarrera,
      empates,
      llenas: nLlenas,
      dividendos: usoDividendos && Object.keys(divFinal).length ? divFinal : null,
      matrizWps: usoMatrizWps && Object.keys(matrizFinal).length ? matrizFinal : null,
    };
  };

  /**
   * Firma estable de una pizarra para comparar "cambió algo?". Se normaliza a
   * texto con las posiciones en orden y las listas ordenadas: comparar dos
   * objetos por identidad siempre daría "cambió" y comparar claves sueltas se
   * olvidaría de los empates o de la raya.
   */
  const firmaDe = (r: PizarraResultados | null | undefined): string => {
    if (!r) return "";
    const p = (r.pizarra ?? {}) as Record<string, unknown>;
    const pos = ORDENES.map(({ nombre }) => String(p[nombre] ?? "").trim()).join(",");
    const raya = String(p.primero_raya ?? "").trim();
    const ordenRaya = Array.isArray(p.orden_llegada_raya)
      ? (p.orden_llegada_raya as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean).join(",")
      : "";
    const emp = [...(r.empates ?? [])].sort((a, b) => a - b).join(",");
    const div = Object.entries(r.dividendos ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
    const wps = Object.entries(r.matrizWps ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(";");
    return `${pos}|raya:${raya}|ordenRaya:${ordenRaya}|emp:${emp}|div:${div}|wps:${wps}`;
  };

  const retiradosSet = useMemo(() => {
    const s = new Set<string>();
    for (const c of caballos ?? []) {
      if ((c as { retirado?: boolean }).retirado) {
        const n = String(c.numero ?? "").trim().replace(/^0+(?=\d)/, "");
        if (n) s.add(n);
      }
    }
    return s;
  }, [caballos]);

  const validacionPizarra = useMemo(
    () =>
      validarPizarraSinDuplicados(
        filas.map((f) => f.numero),
        retiradosSet
      ),
    [filas, retiradosSet]
  );

  if (!abierto) return null;

  /** Hay resultados ya cargados precargados (modo edición). */
  const precargado = Boolean(inicial && inicial.llenas > 0);

  /**
   * ¿Se CAMBIÓ algún valor de una carrera que YA está liquidada? Sólo en ese
   * caso se pide el motivo y se recalcula: si el operador abre el resultado de
   * una carrera pagada y no toca nada, confirmar no debe pedirle explicaciones
   * ni mover un centavo.
   */
  const cambioEnLiquidada =
    editandoLiquidada && precargado && firmaDe(construirResultado()) !== firmaDe(inicial);

  /** Falta el motivo: el cambio no se puede confirmar sin justificación. */
  const faltaMotivo = cambioEnLiquidada && !motivo.trim();

  const llenas = filas.filter((r) => r.numero.trim()).length;
  const primerNumero = filas.find((r) => r.numero.trim())?.numero ?? "";

  const setNumero = (i: number, v: string) => {
    const limpio = v.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    if (!limpio) {
      setAlertaDuplicado(null);
      setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: "" } : r)));
      return;
    }
    const yaOcupadoEn = filas.findIndex(
      (r, j) => j !== i && r.numero.trim().replace(/^0+(?=\d)/, "") === limpio
    );
    if (yaOcupadoEn !== -1) {
      setAlertaDuplicado(`⚠️ El ejemplar #${limpio} ya está asignado en otra posición de la pizarra (${yaOcupadoEn + 1}°)`);
      // Bloquea la entrada duplicada y limpia la casilla repetida inmediatamente
      setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: "" } : r)));
      return;
    }
    if (retiradosSet.has(limpio)) {
      setAlertaDuplicado(`⚠️ El ejemplar #${limpio} está RETIRADO y no puede asignarse en la pizarra`);
      setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: "" } : r)));
      return;
    }
    setAlertaDuplicado(null);
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, numero: limpio } : r)));
  };
  const toggleEmpate = (i: number) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, empate: !r.empate } : r)));

  /** Lleva el cursor (focus) a la casilla de la posición `i` y selecciona su
   *  contenido, así lo que se teclee reemplaza el número anterior. */
  const enfocarPosicion = (i: number) => {
    const el = inputsRef.current[i];
    if (!el) return;
    el.focus();
    el.select();
  };

  /** ENTER o ↓ pasan a la posición siguiente; ↑ vuelve a la anterior. En la
   *  última casilla ENTER agrega un lugar nuevo y se posiciona en él, para
   *  seguir cargando la llegada de corrido. */
  const teclaPosicion = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      if (i + 1 < filas.length) {
        enfocarPosicion(i + 1);
      } else {
        setFilas((f) => [...f, { numero: String((caballos ?? [])[f.length]?.numero ?? ""), empate: false }]);
        window.setTimeout(() => enfocarPosicion(i + 1), 0);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i > 0) enfocarPosicion(i - 1);
    }
  };
  const setDiv = (k: string, v: string) => setDividendos((d) => ({ ...d, [k]: v.replace(/[^\d.]/g, "") }));
  const setMatriz = (k: string, v: string) => setMatrizWps((m) => ({ ...m, [k]: v.replace(/[^\d.]/g, "") }));

  const confirmar = () => {
    const r = construirResultado();
    if (!r.pizarra.primero) return;
    if (!validacionPizarra.ok) {
      setAlertaDuplicado(validacionPizarra.mensaje);
      return;
    }
    // Cambiar el resultado de una carrera YA liquidada mueve plata: se exige el
    // motivo. Se vuelve a comprobar acá (y no solo en el botón) para que no haya
    // forma de confirmar un cambio sin justificación.
    if (cambioEnLiquidada && !motivo.trim()) return;
    onConfirmar(r, cambioEnLiquidada ? motivo.trim() : undefined);
  };

  const PoolInput = ({ pool, numero }: { pool: Pool; numero: string }) => (
    <label
      title={`Dividendo ${pool === "win" ? "WIN" : pool === "place" ? "PLACE" : "SHOW"} del ${
        pool === "win" ? "1º" : pool === "place" ? "2º" : "3º"
      } (${numero}) por $1`}
      className="flex items-center gap-0.5 rounded border border-indigo-100 bg-indigo-50/60 px-1 py-0.5"
    >
      <span className="text-[8px] font-black uppercase leading-none text-indigo-400">{pool.slice(0, 1)}</span>
      <input
        value={dividendos[`${pool}:${numero}`] ?? ""}
        onChange={(e) => setDiv(`${pool}:${numero}`, e.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        className="w-12 rounded bg-white px-1 py-0.5 text-center font-mono text-[11px] font-black text-slate-900 placeholder:text-slate-300 outline-none focus:ring-1 focus:ring-indigo-400"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 print:hidden">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-slate-800 px-3 py-2.5 text-white">
          <h3 className="text-[11px] font-black uppercase tracking-wider">
            🏁 Carga de Resultados — <span className="normal-case">{nombreHipo}</span> C{carrera}
          </h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-slate-300 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1.5 border-b border-line bg-warning-500/10 px-3 py-1.5 text-[9px] font-semibold text-warning-700">
          ⚠️ Empate (Dead Heat): los caballos empatados comparten su pool (1°→W+P+S · 2°→P+S · 3°→S · CERO fraccionamiento).
        </div>

        {precargado && (
          <div className="flex items-center gap-1.5 border-b border-line bg-emerald-500/10 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-emerald-700">
            ✏️ Editando resultados ya cargados — solo cambiá lo que haga falta.
          </div>
        )}

        {editandoLiquidada && (
          <div className="border-b border-line bg-rose-500/10 px-3 py-1.5 text-[9px] font-bold text-rose-700">
            🔒 Carrera LIQUIDADA. Si cambiás algún valor hay que indicar el porqué y la plataforma vuelve a
            recalcular TODA la liquidación.
          </div>
        )}

        {/* Orden de Llegada (Raya) vs Orden Oficial (Pizarra Oficial) */}
        <div className="border-b border-line bg-cyan-50/70 px-3 py-2">
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-800 cursor-pointer">
            <input
              type="checkbox"
              checked={mismoRaya}
              onChange={(e) => {
                const checked = e.target.checked;
                setMismoRaya(checked);
                if (!checked) {
                  setFilasRaya((prev) => {
                    const base = filas.map((f) => f.numero.trim());
                    const tieneDatos = prev.some((x) => x.trim() !== "");
                    const next = tieneDatos
                      ? Array.from({ length: filas.length }, (_, idx) => prev[idx] ?? base[idx] ?? "")
                      : base;
                    if (!rayaNumero.trim() && next[0]) setRayaNumero(next[0]);
                    return next;
                  });
                }
              }}
              className="h-3.5 w-3.5 accent-cyan-600"
            />
            Orden de Llegada (Raya) = Orden Oficial (sin distanciamiento)
          </label>
          {mismoRaya ? (
            <p className="mt-0.5 text-[9px] italic text-slate-500">
              Por defecto el Orden de Llegada es igual al Orden Oficial. Si hubo distanciamiento, desmarcá esta casilla:
              <b> Tablas Fijas y Remates</b> se liquidan por el Orden de Llegada (Raya) y las demás jugadas por el Orden Oficial.
            </p>
          ) : (
            <div className="mt-2 space-y-2 rounded-xl border border-amber-300 bg-amber-50/80 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9.5px] font-black uppercase tracking-wider text-amber-900">
                  🏇 Orden de Llegada en Raya (Tablas Fijas y Remates)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const copia = filas.map((f) => f.numero.trim());
                    setFilasRaya(copia);
                    setRayaNumero(copia[0] ?? "");
                  }}
                  className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[8.5px] font-bold text-amber-800 hover:bg-amber-100"
                >
                  🔄 Copiar Orden Oficial
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: Math.max(filas.length, minLugares) }, (_, idx) => {
                  const val = idx === 0 ? (filasRaya[0] || rayaNumero) : (filasRaya[idx] ?? "");
                  return (
                    <label key={idx} className="flex flex-col items-center gap-0.5">
                      <span className="text-[8.5px] font-black uppercase text-amber-800">
                        {idx + 1}° Raya
                      </span>
                      <div className="flex items-center gap-1">
                        <span
                          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-black"
                          style={{
                            backgroundColor: val ? colorDeNumero(val) : "#e2e8f0",
                            color: val ? textoDeNumero(val) : "#94a3b8",
                          }}
                        >
                          {val || idx + 1}
                        </span>
                        <input
                          value={val}
                          onChange={(e) => {
                            const limpio = e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
                            if (idx === 0) setRayaNumero(limpio);
                            setFilasRaya((prev) => {
                              const len = Math.max(prev.length, filas.length, minLugares);
                              const arr = Array.from({ length: len }, (_, k) => prev[k] ?? "");
                              arr[idx] = limpio;
                              return arr;
                            });
                          }}
                          inputMode="numeric"
                          placeholder={idx === 0 ? primerNumero || "1º" : `${idx + 1}º`}
                          className="w-10 rounded-md border border-amber-300 bg-white px-1 py-0.5 text-center font-mono text-[11px] font-black text-slate-900 outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-[8.5px] font-semibold text-amber-800">
                ⚖️ <b>1° en Raya ({rayaNumero || filasRaya[0] || "—"})</b> gana Tablas Fijas y Remates · Las demás jugadas (Puestos, Marcas, WPS, Dupletas) se liquidan con la Pizarra Oficial de abajo.
              </p>
            </div>
          )}
        </div>

        <div className="divide-y divide-line px-3">
          {(alertaDuplicado || validacionPizarra.mensaje) && (
            <div
              role="alert"
              className="my-1.5 flex items-center justify-between gap-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[10px] font-black text-rose-700"
            >
              <span>{alertaDuplicado ?? validacionPizarra.mensaje}</span>
              {alertaDuplicado && (
                <button
                  type="button"
                  onClick={() => setAlertaDuplicado(null)}
                  className="text-rose-500 hover:text-rose-800"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          {llenas < minLugares && (
            <p className="flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 text-[9px] font-semibold text-amber-700">
              ℹ️ Para calcular jugadas de puestos se recomienda cargar al menos {minLugares} lugares (tenés {llenas}).
            </p>
          )}
          {filas.map((r, i) => {
            const pools = poolsPorFila[i];
            return (
              <div key={i} className="py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className="grid h-6 w-8 shrink-0 place-items-center rounded-md text-[11px] font-black"
                    style={{
                      backgroundColor: r.numero ? colorDeNumero(r.numero) : "#e2e8f0",
                      color: r.numero ? textoDeNumero(r.numero) : "#94a3b8",
                    }}
                  >
                    {r.numero || i + 1}
                  </span>
                  <span className="w-8 shrink-0 text-[10px] font-bold text-slate-600">{i + 1}°</span>
                  <input
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    value={r.numero}
                    onChange={(e) => setNumero(i, e.target.value)}
                    onKeyDown={(e) => teclaPosicion(i, e)}
                    inputMode="numeric"
                    placeholder={caballos?.[i] ? String(caballos[i].numero) : "Nº"}
                    style={r.numero.trim() ? { borderColor: getHorseColor(r.numero).hex } : undefined}
                    className="w-16 rounded-lg border-2 bg-surface px-1.5 py-1 text-center text-xs font-black text-slate-900 placeholder:text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  />
                  <span className="flex flex-wrap gap-0.5">
                    {r.numero.trim() && pools.win && (
                      <span className="rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-black uppercase text-emerald-700">W</span>
                    )}
                    {r.numero.trim() && pools.place && (
                      <span className="rounded bg-sky-100 px-1 py-0.5 text-[8px] font-black uppercase text-sky-700">P</span>
                    )}
                    {r.numero.trim() && pools.show && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] font-black uppercase text-amber-700">S</span>
                    )}
                  </span>
                  <label className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                    <input type="checkbox" checked={r.empate} onChange={() => toggleEmpate(i)} className="h-3.5 w-3.5 accent-amber-500" />
                    Empate
                  </label>
                </div>
                {r.numero.trim() && usoDividendos && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 pl-10">
                    {pools.win && <PoolInput pool="win" numero={r.numero.trim()} />}
                    {pools.place && <PoolInput pool="place" numero={r.numero.trim()} />}
                    {pools.show && <PoolInput pool="show" numero={r.numero.trim()} />}
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex gap-1.5 py-1.5">
            <button
              type="button"
              onClick={() => setFilas((f) => f.slice(0, -1))}
              disabled={filas.length <= LUGARES_MIN}
              className="flex-1 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              − Quitar {filas.length}° lugar
            </button>
            <button
              type="button"
              onClick={() =>
                setFilas((f) => [...f, { numero: String((caballos ?? [])[f.length]?.numero ?? ""), empate: false }])
              }
              className="flex-1 rounded-lg border border-dashed border-primary-400 bg-primary-500/5 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-primary-600 transition-colors hover:bg-primary-500/10"
            >
              ＋ Añadir {filas.length + 1}° lugar
            </button>
          </div>
          <p className="pb-1.5 text-center text-[9px] italic text-slate-400">
            ⌨️ ENTER o ↓ pasa al ejemplar del puesto siguiente · ↑ vuelve al anterior.
          </p>
        </div>

        {/* Dividendos POR CABALLO (opcional) — WIN/PLACE/SHOW */}
        <div className="border-t border-line bg-indigo-50/50 px-3 py-2">
          <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
            <input
              type="checkbox"
              checked={usoDividendos}
              onChange={(e) => setUsoDividendos(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Cargar dividendos por caballo (opcional) · comisión 5% sobre premio bruto
          </label>
          {usoDividendos && (
            <p className="mt-1 text-[9px] italic text-slate-500">
              Cada caballo carga solo el dividendo de los pools que paga según su lugar: 1°→W+P+S · 2°→P+S · 3°→S. Los
              empatados del 1º comparten todo el pool WPS.
            </p>
          )}

          {/* MATRIZ AMERICANA W/P/S — distinta de los pools por caballo: acá el
              pago depende de qué se apostó (fila) y del puesto alcanzado
              (columna), no solo del puesto. */}
          <label className="mt-2.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
            <input
              type="checkbox"
              checked={usoMatrizWps}
              onChange={(e) => setUsoMatrizWps(e.target.checked)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            Cargar matriz americana W / P / S (opcional)
          </label>
          {usoMatrizWps && (
            <>
              <p className="mt-1 text-[9px] italic text-slate-500">
                Se ingresa como lo publica el tablero (<b>paga $ por $2</b>) y se guarda el equivalente por $1. Dejarla
                en blanco no la inventa: esa jugada queda <b>pendiente</b> hasta que la casa la cargue, nunca perdida.
              </p>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {CLAVES_WPS.map((clave) => {
                  const porDos = matrizWps[clave] ?? "";
                  const porUno = pagoPorUno(parseFloat(porDos || ""));
                  return (
                    <label
                      key={clave}
                      title={`${ETIQUETAS_WPS[clave]} · se guarda como ${PREFIJO_WPS}${clave} = ${porUno || "?"} por $1`}
                      className="flex items-center justify-between gap-1 rounded border border-indigo-100 bg-white px-1.5 py-1"
                    >
                      <span className="min-w-0">
                        <span className="block text-[9px] font-black uppercase leading-none text-indigo-600">
                          {clave}
                        </span>
                        <span className="block truncate text-[8px] leading-none text-slate-400">
                          {ETIQUETAS_WPS[clave]}
                        </span>
                      </span>
                      <input
                        value={porDos}
                        onChange={(e) => setMatriz(clave, e.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="w-12 shrink-0 rounded bg-indigo-50/60 px-1 py-0.5 text-center font-mono text-[11px] font-black text-slate-900 placeholder:text-slate-300 outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-[8px] italic text-slate-400">
                WW/WP/WS = playbook de W/P/S que llega 1º · PP/PS = que llega 2º · SS = que llega 3º.
              </p>
            </>
          )}
        </div>

        <div className="border-t border-line bg-gray-50 px-3 py-2">
          {cambioEnLiquidada && (
            <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2">
              <label
                htmlFor="motivo-cambio-resultado"
                className="mb-1 block text-[9px] font-black uppercase tracking-wider text-rose-700"
              >
                ⚠️ Cambiaste un resultado ya liquidado — ¿por qué?
              </label>
              <textarea
                id="motivo-cambio-resultado"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                placeholder="Ej.: el 1º fue descalificado y pasó a ser el 5º. Orden de la comisión de carreras."
                className="w-full resize-none rounded-md border border-rose-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:ring-1 focus:ring-rose-400"
              />
              <p className="mt-1 text-[9px] font-semibold text-rose-700">
                Al confirmar se REVERSARÁ la liquidación y se recalculará TODA la carrera contra el resultado nuevo. Queda
                registrado en la auditoría.
              </p>
            </div>
          )}
          <p className="mb-1.5 text-[9px] italic text-slate-500">
            Puestos (WIN/PLACE/SHOW) pagan por el orden de llegada oficial. TABLAS y REMATES pagan al que cruzó la
            raya primero; el premio de la tabla se calcula automáticamente (lo que paga × cantidad, con ajuste proporcional por
            retiros).
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border-t border-slate-200 bg-slate-50/90 p-3 shadow-inner">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 shadow-2xs"
            >
              Cancelar (Esc)
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={faltaMotivo || !validacionPizarra.ok || llenas === 0}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-black tracking-wide text-white transition-all shadow-md ${
                !validacionPizarra.ok || llenas === 0 || faltaMotivo
                  ? "pointer-events-none opacity-40 bg-slate-400 shadow-none ring-0"
                  : "bg-gradient-to-r from-emerald-600 via-green-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 hover:scale-[1.02] active:scale-[0.98] shadow-emerald-600/30 ring-4 ring-emerald-400/40"
              }`}
              title={
                !validacionPizarra.ok
                  ? validacionPizarra.mensaje ?? "Hay ejemplares duplicados en la pizarra"
                  : faltaMotivo
                    ? "Escribí el motivo del cambio para poder recalcular la liquidación"
                    : "Liquidar y pagar todas las jugadas de esta carrera según los resultados cargados"
              }
            >
              <span className="text-base leading-none">{cambioEnLiquidada ? "🔄" : "🏆"}</span>
              <span>{cambioEnLiquidada ? "Guardar y Recalcular" : "Liquidar Carrera"}</span>
              <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-bold tracking-normal opacity-90">
                ↵ Enter
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CargaResultadosModal;