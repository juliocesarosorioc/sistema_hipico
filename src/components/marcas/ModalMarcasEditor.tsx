"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Button";
import { getHorseColor } from "@/lib/horseColors";
import { HorseBadge } from "@/components/ui/HorseChips";
import { hoyLocal } from "@/lib/gaceta/programa";
import { SemaforoCarreras } from "@/components/gestion/SemaforoCarreras";
import { listarCarrerasPorDia, listarHipodromos, type OpcionHipodromo } from "@/lib/tablas/rpc";
import { nombrePropioHipodromo } from "@/lib/hipodromos/nombre";
import {
  buscarEjemplar,
  calcularRivales,
  cambiarEstadoMarcas,
  eliminarConfigMarcas,
  etiquetaCaballo,
  guardarConfigMarcas,
  listarPizarraMarcas,
  revisarConfig,
  separarNumeros,
  type PizarraMarca,
} from "@/lib/marcas";
import { FACTOR_BRUTO, FACTOR_GANANCIA, PROPORCION } from "@/lib/marcas/jerarquia";

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";
const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

export type ModalMarcasEditorProps = {
  /** Carrera desde la que se abrio, si se abrio desde una fila. */
  hipodromoInicial?: string;
  carreraInicial?: number;
  onCerrar: () => void;
  onToast: (msg: string, tipo?: "success" | "warning" | "error" | "info") => void;
  /** Avisa al modulo de que la configuracion cambio, para que refresque. */
  onCambio?: () => void;
};

type Columna = "marca" | "nv" | "debutante";

/**
 * MODULO MARCAS — editor de configuracion (marcas, NV y debutantes).
 *
 * Redisenado con el flujo de Gestión de Jugadas:
 *   1. Día → Hipódromo (catálogo) → Semáforo de carreras → carrera activa.
 *   2. Panel lateral de EJEMPLARES registrados: se agregan por clic (a la
 *      columna en curso) o se ARRASTRAN al drop de la columna destino.
 *   3. Entrada manual por números con separador "/" ("1/2/3"), validada
 *      contra la carrera registrada.
 *   4. Columnas MARCAS · NV · DEBUTANTES con chips de color hípico
 *      (uniforme = SIN jerarquía visual; el orden en MARCAS se edita
 *      arrastrando el chip con el número — los nombres son solo guía).
 *   5. Informe compacto 120/100 al pie de la carga.
 *
 * La jerarquia se previsualiza aqui pero la VERDAD la calcula el servidor
 * (`club_vender_marca`): si divergieran, la caja veria un matchup y la banca
 * aceptaria otro.
 */
export function ModalMarcasEditor({
  hipodromoInicial,
  carreraInicial,
  onCerrar,
  onToast,
  onCambio,
}: ModalMarcasEditorProps) {
  const [dia, setDia] = useState(hoyLocal());
  const [hipodromo, setHipodromo] = useState(
    String(hipodromoInicial ?? "").trim().toUpperCase() || "LA RINCONADA"
  );
  const [carreraSel, setCarreraSel] = useState<number>(carreraInicial ?? 0);

  /** Catálogo de hipódromos para el selector (mismo origen que Gestión). */
  const [catalogoHipodromos, setCatalogoHipodromos] = useState<OpcionHipodromo[]>([]);
  /** Carreras registradas para [dia + hipodromo] — alimenta el semáforo. */
  const [carrerasPorDia, setCarrerasPorDia] = useState<number[]>([]);

  const [pizarra, setPizarra] = useState<PizarraMarca[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Borrador local. Se recarga desde la pizarra cada vez que cambia la carrera
  // seleccionada, para no mezclar configuraciones de dos carreras distintas.
  const [marcas, setMarcas] = useState<string[]>([]);
  const [nv, setNv] = useState<string[]>([]);
  const [debutantes, setDebutantes] = useState<string[]>([]);
  const [debutantesValen, setDebutantesValen] = useState(true);
  const [nuevo, setNuevo] = useState("");
  const [columna, setColumna] = useState<Columna>("marca");
  /** Chip de MARCAS que se está arrastrando para reordenar (swap). */
  const [arrastre, setArrastre] = useState<number | null>(null);

  useEffect(() => {
    let v = true;
    void listarHipodromos().then((hs) => {
      if (v) setCatalogoHipodromos(hs);
    });
    return () => {
      v = false;
    };
  }, []);

  /** Pizarra oficial de marcas para [dia + hipodromo]. */
  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await listarPizarraMarcas({ dia, hipodromo });
    setCargando(false);
    if (!r.ok) {
      setPizarra([]);
      return onToast(r.error ?? "No se pudo cargar la pizarra de Marcas.", "error");
    }
    setPizarra(r.filas);
  }, [dia, hipodromo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Semáforo: carreras registradas en la BD para [dia + hipodromo].
  useEffect(() => {
    let v = true;
    setCarrerasPorDia([]);
    setCarreraSel(0);
    if (!dia || !hipodromo) return;
    listarCarrerasPorDia(dia, hipodromo)
      .then((c) => {
        if (!v) return;
        setCarrerasPorDia(c);
        // Si el hipódromo tiene carreras, se activa la primera registrada (o la
        // pedida al abrir desde una fila del panel).
        if (c.length > 0) {
          const inicial = carreraInicial && c.includes(carreraInicial) ? carreraInicial : c[0];
          setCarreraSel(inicial);
        }
      })
      .catch(() => {
        if (v) setCarreraSel(carreraInicial ?? 0);
      });
    return () => {
      v = false;
    };
  }, [dia, hipodromo, carreraInicial]);

  /** Todas las carreras de la pizarra del hipódromo en curso. */
  const carrerasDeHipo = useMemo(
    () => pizarra.filter((f) => f.hipodromo.trim().toUpperCase() === hipodromo.trim().toUpperCase()),
    [pizarra, hipodromo]
  );

  const fila = useMemo(
    () => carrerasDeHipo.find((f) => f.carrera === carreraSel) ?? null,
    [carrerasDeHipo, carreraSel]
  );

  // El borrador se arma desde la configuracion guardada de la carrera activa.
  useEffect(() => {
    const c = fila?.config;
    setMarcas(separarNumeros(c?.marcas));
    setNv(separarNumeros(c?.nv));
    setDebutantes(separarNumeros(c?.debutantes));
    setDebutantesValen(c?.debutantes_valen !== false);
    setNuevo("");
    setArrastre(null);
  }, [fila]);

  const caballos = useMemo(() => fila?.caballos ?? [], [fila]);
  const etiqueta = fila ? `${fila.hipodromo} N${fila.carrera}` : "—";

  const revision = useMemo(
    () => revisarConfig(caballos, marcas, nv, debutantes),
    [caballos, marcas, nv, debutantes]
  );

  /** El mismo texto que se manda a la RPC, ya normalizado. */
  const marcasTexto = marcas.join("/");
  const nvTexto = nv.join("/");
  const debutantesTexto = debutantes.join("/");

  /**
   * Agrega un número a una columna con la validación compartida: tiene que
   * correr en la carrera y no estar ya en ninguna columna.
   */
  const agregarNumero = (n: string, c: Columna) => {
    const num = String(n ?? "").trim();
    if (!num) return;
    if (!buscarEjemplar(caballos, num)) {
      return onToast(`El Nº ${num} no está registrado en la carrera ${etiqueta}.`, "warning");
    }
    if (marcas.includes(num) || nv.includes(num) || debutantes.includes(num)) {
      return onToast(`El Nº ${num} ya está en alguna columna.`, "warning");
    }
    if (c === "marca") setMarcas((m) => [...m, num]);
    else if (c === "nv") setNv((m) => [...m, num]);
    else setDebutantes((m) => [...m, num]);
  };

  /** Entrada manual: "1/2/3" — separador "/", se valida vs la carrera. */
  const agregarManual = () => {
    const nums = separarNumeros(nuevo);
    if (!nums.length) return onToast("Escriba al menos un número (ej. 1/2/3).", "warning");
    // Se valida contra las listas REALES + los ya aceptados en este mismo lote,
    // para no aceptar duplicados dentro de "1/1/2" usando el estado viejo.
    const usados = new Set([...marcas, ...nv, ...debutantes]);
    const validos: string[] = [];
    const invalidos: string[] = [];
    for (const n of nums) {
      if (usados.has(n)) {
        invalidos.push(`${n} (ya marcado)`);
        continue;
      }
      if (!buscarEjemplar(caballos, n)) {
        invalidos.push(`${n} (no corre en ${etiqueta})`);
        continue;
      }
      validos.push(n);
      usados.add(n);
    }
    if (columna === "marca") setMarcas((a) => [...a, ...validos]);
    else if (columna === "nv") setNv((a) => [...a, ...validos]);
    else setDebutantes((a) => [...a, ...validos]);
    setNuevo("");
    const etiquetaCol = columna === "marca" ? "MARCAS" : columna === "nv" ? "NV" : "DEBUTANTES";
    if (invalidos.length) onToast(`No se agregaron: ${invalidos.join(" · ")}.`, "warning");
    else onToast(`✔ ${validos.join(" · ")} agregado(s) a ${etiquetaCol}.`, "success");
  };

  // =========================================================================
  // DRAG & DROP
  // =========================================================================
  const arrastrarEjemplar = (num: string) => (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData("text/plain", String(num));
    e.dataTransfer.effectAllowed = "move";
  };

  /** Drop sobre el fondo de una columna: agrega el ejemplar externo, y si es
   *  un chip de MARCAS arrastrado, lo manda al final (fin de la jerarquía). */
  const soltarEnColumna = (c: Columna) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const num = e.dataTransfer.getData("text/plain");
    if (num) {
      agregarNumero(num, c);
    } else if (c === "marca" && arrastre != null) {
      setMarcas((a) => {
        const copia = [...a];
        const [m] = copia.splice(arrastre, 1);
        return [...copia, m];
      });
    }
    setArrastre(null);
  };

  /** Drop sobre un chip de MARCAS: intercambia posiciones (jerarquía). */
  const soltarSobreChip = (i: number) => (e: DragEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const num = e.dataTransfer.getData("text/plain");
    if (num && num !== marcas[i]) {
      agregarNumero(num, "marca");
    } else if (arrastre != null && arrastre !== i) {
      setMarcas((a) => {
        const copia = [...a];
        [copia[arrastre], copia[i]] = [copia[i], copia[arrastre]];
        return copia;
      });
    }
    setArrastre(null);
  };

  const guardar = async () => {
    if (!fila) return onToast("Seleccione una carrera.", "warning");
    if (!marcas.length) return onToast("Defina al menos una marca (favorito).", "warning");
    if (!revision.valida) return onToast(revision.mensaje ?? "Revise la configuración.", "warning");
    setGuardando(true);
    const r = await guardarConfigMarcas({
      hipodromo: fila.hipodromo,
      fecha: dia,
      carrera: fila.carrera,
      marcas: marcasTexto,
      nv: nvTexto,
      debutantes: debutantesTexto,
      debutantes_valen: debutantesValen,
    });
    setGuardando(false);
    if (!r.ok) return onToast(r.error ?? "No se pudo guardar la configuración.", "error");
    onToast(
      `🏷️ ${etiqueta} guardada · ${marcas.length} marca(s)${debutantes.length ? ` · ${debutantes.length} debutante(s)` : ""}.`,
      "success"
    );
    await cargar();
    onCambio?.();
  };

  const borrar = async () => {
    if (!fila?.config?.id) return;
    if (
      !window.confirm(
        `¿Borrar la configuración de ${etiqueta}?\n\n` +
          `Esto NO toca los tickets ya vendidos: cada ticket guarda su propio snapshot ` +
          `de marcas, NV y rivales, y se liquida con ese.`
      )
    )
      return;
    const r = await eliminarConfigMarcas(fila.config.id);
    if (!r.ok) return onToast(r.error ?? "No se pudo borrar la configuración.", "error");
    onToast(`🗑️ Configuración de ${etiqueta} borrada.`, "success");
    await cargar();
    onCambio?.();
  };

  const alternarEstado = async () => {
    if (!fila?.config?.id) return onToast("Primero guarde la configuración.", "warning");
    const nuevoEstado = fila.config.estado === "Abierta" ? "Cerrada" : "Abierta";
    const r = await cambiarEstadoMarcas(fila.config.id, nuevoEstado);
    if (!r.ok) return onToast(r.error ?? "No se pudo cambiar el estado.", "error");
    onToast(
      nuevoEstado === "Abierta" ? `▶️ ${etiqueta} abierta para ventas.` : `⏸️ ${etiqueta} cerrada.`,
      "success"
    );
    await cargar();
  };

  /** Chips uniformes (SIN jerarquía visual): solo el número + nombre como guía. */
  const ChipUniforme = ({
    n,
    c,
    i,
    onQuitar,
  }: {
    n: string;
    c: Columna;
    i: number;
    onQuitar: () => void;
  }) => {
    const ej = buscarEjemplar(caballos, n);
    const g = getHorseColor(n);
    const draggable = c === "marca";
    return (
      <span
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                setArrastre(i);
                e.dataTransfer.setData("text/plain", "");
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        onDragOver={draggable ? (e) => e.preventDefault() : undefined}
        onDrop={draggable ? soltarSobreChip(i) : undefined}
        title={ej?.nombre ? `${n} · ${ej.nombre}` : `Numero ${n}`}
        className={`inline-flex items-center gap-1 rounded-md border px-1 py-0.5 text-[11px] font-bold leading-none ${
          ej?.retirado
            ? "border-red-300 bg-red-50 text-red-700"
            : `${g.border} ${g.bg} ${g.text}`
        } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        <HorseBadge num={n} size="sm" retirado={ej?.retirado} />
        <button
          type="button"
          onClick={onQuitar}
          title="Quitar"
          className="px-0.5 font-black opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </span>
    );
  };

  /** Informe compacto 120/100: por cada marca, contra quién juega y el factor. */
  const informe = useMemo(
    () =>
      marcas.map((m, i) => {
        const a = calcularRivales(m, marcasTexto, nvTexto, debutantesTexto, debutantesValen);
        return { n: m, i, a };
      }),
    [marcas, marcasTexto, nvTexto, debutantesTexto, debutantesValen]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3" onClick={onCerrar}>
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 bg-cyan-700 px-4 py-2.5 text-white">
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wide">🏷️ Editor de Marcas</h3>
            <p className="text-[10px] font-semibold text-cyan-100">
              Día → Hipódromo → Carrera (semáforo) · se juega {PROPORCION} para ganar 100
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg px-3 py-1 text-sm font-black text-white hover:bg-cyan-800"
          >
            ✕
          </button>
        </div>

        {/* Paso 1 y 2: Día y Hipódromo */}
        <div className="grid gap-2 border-b border-cyan-100 bg-cyan-50/70 p-3 sm:grid-cols-2">
          <div>
            <span className={inputLbl}>1 · Día</span>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} />
          </div>
          <div>
            <span className={inputLbl}>2 · Hipódromo</span>
            <select value={hipodromo} onChange={(e) => setHipodromo(e.target.value)} className={inputCls}>
              {catalogoHipodromos.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Paso 3: Semáforo de carreras */}
        <div className="px-4 pt-3">
          <SemaforoCarreras
            hipodromo={hipodromo}
            fecha={dia}
            carreras={carrerasPorDia}
            activa={carreraSel}
            onSeleccionar={setCarreraSel}
          />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 px-3 py-2 text-[10px] font-semibold leading-relaxed text-cyan-900">
            📌 El <b>orden</b> de las marcas es la jerarquía: el último juega contra quienes tiene a la
            izquierda y el primero no se puede jugar (no tiene rival). <b>Arrastrá el chip</b> para reordenar.
            Los no marcados juegan contra <b>todas</b> las marcas. El <b>NV</b> queda bloqueado siempre. Los{" "}
            <b>debutantes</b> se juegan normal mientras el switch esté en <b>valen</b>; apagado, se comportan
            <b> exactamente como un NV</b>.
          </div>

          {cargando ? (
            <p className="px-3 py-6 text-center text-xs font-bold text-slate-500">Cargando pizarra…</p>
          ) : !carrerasDeHipo.length ? (
            <p className="rounded-lg bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700">
              ⚠️ No hay carreras registradas en la pizarra central para {nombrePropioHipodromo(hipodromo, catalogoHipodromos)} · {dia}. Regístrelas en
              Carreras del Día.
            </p>
          ) : !fila ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs font-bold text-slate-500">Seleccione una carrera del semáforo.</p>
          ) : (
            <>
              {caballos.length === 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700">
                  ⚠️ {etiqueta} no tiene ejemplares registrados. Sin ejemplares no se puede configurar Marcas: la
                  validación los necesita para no aceptar un rival que no corre.
                </p>
              )}

              {/* Entrada manual y por clic */}
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1">
                  <span className={inputLbl}>
                    Agregar por número (una o varias con "/") · ej. 1/2/3
                  </span>
                  <div className="flex gap-2">
                    <input
                      value={nuevo}
                      onChange={(e) => setNuevo(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          agregarManual();
                        }
                      }}
                      placeholder="1/2/3"
                      className={inputCls}
                    />
                    <select
                      value={columna}
                      onChange={(e) => setColumna(e.target.value as Columna)}
                      className={`${inputCls} w-36`}
                    >
                      <option value="marca">Marca</option>
                      <option value="nv">NV</option>
                      <option value="debutante">Debutante</option>
                    </select>
                    <Button variant="default" onClick={agregarManual} disabled={!nuevo.trim()}>
                      Agregar
                    </Button>
                  </div>
                </div>
              </div>

              {/* Ejemplares + las tres columnas */}
              <div className="flex flex-col gap-2 lg:flex-row">
                <aside className="shrink-0 rounded-xl border border-line bg-white p-1.5 shadow-sm lg:w-[24%]">
                  <p className="px-1 pb-1 text-[9px] font-black uppercase leading-none tracking-wide text-slate-500">
                    🐎 Ejemplares de {etiqueta} · {caballos.length} · clic = agregar · arrastrar = soltar en columna
                  </p>
                  <ul className="max-h-56 divide-y divide-line/60 overflow-y-auto">
                    {caballos.map((c) => (
                      <li key={`${c.numero}-${c.nombre ?? "nn"}`}>
                        <button
                          type="button"
                          draggable
                          onDragStart={arrastrarEjemplar(c.numero)}
                          onClick={() => agregarNumero(c.numero, columna)}
                          title={`${etiquetaCaballo(c)}${c.retirado ? " · RETIRADO" : ""}`}
                          className={`flex w-full cursor-grab items-center gap-1.5 px-1 py-0 text-left leading-none hover:bg-cyan-50 active:cursor-grabbing ${
                            c.retirado ? "bg-red-50/60" : ""
                          } ${marcas.includes(c.numero) || nv.includes(c.numero) || debutantes.includes(c.numero) ? "opacity-40" : ""}`}
                        >
                          <HorseBadge num={c.numero} size="sm" retirado={c.retirado} />
                          <span
                            className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase leading-none ${
                              c.retirado ? "text-red-500 line-through" : "text-slate-700"
                            }`}
                          >
                            {c.nombre || <span className="text-slate-400">Nº {c.numero} (sin nombre)</span>}
                          </span>
                          {c.retirado && (
                            <span className="shrink-0 rounded bg-red-100 px-1 text-[8px] font-black text-red-600">
                              RET
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>

                <div className="grid min-w-0 flex-1 gap-2 lg:grid-cols-3">
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={soltarEnColumna("marca")}
                    className="rounded-lg border-2 border-amber-200 bg-amber-50/60 p-2"
                  >
                    <span className={inputLbl}>🏅 Marcas · {marcas.length} · el último es el que más juega</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {marcas.length === 0 && <span className="text-[11px] font-semibold text-slate-400">Sin marcas</span>}
                      {marcas.map((m, i) => (
                        <ChipUniforme
                          key={m}
                          n={m}
                          c="marca"
                          i={i}
                          onQuitar={() => setMarcas((a) => a.filter((x) => x !== m))}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">
                      Marcado: {marcasTexto || "—"}
                    </p>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={soltarEnColumna("nv")}
                    className="rounded-lg border-2 border-red-200 bg-red-50/50 p-2"
                  >
                    <span className={inputLbl}>🚫 NV · {nv.length} · no se pueden jugar</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {nv.length === 0 && <span className="text-[11px] font-semibold text-slate-400">Sin NV</span>}
                      {nv.map((m, i) => (
                        <ChipUniforme
                          key={m}
                          n={m}
                          c="nv"
                          i={i}
                          onQuitar={() => setNv((a) => a.filter((x) => x !== m))}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] font-semibold text-slate-500">
                      Bloqueados: {nvTexto || "—"}
                    </p>
                  </div>

                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={soltarEnColumna("debutante")}
                    className="rounded-lg border-2 border-violet-200 bg-violet-50/50 p-2"
                  >
                    <span className={inputLbl}>🐣 Debutantes · {debutantes.length}</span>

                    <label className="mt-1 flex cursor-pointer items-start gap-2 rounded border border-violet-200 bg-white/70 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={debutantesValen}
                        onChange={(e) => setDebutantesValen(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-violet-600"
                      />
                      <span className="text-[10px] font-bold leading-tight text-violet-900">
                        {debutantesValen ? "Debutantes VALEN" : "Debutantes NO valen"}
                        <span className="block font-semibold text-violet-700">
                          {debutantesValen
                            ? "Se juegan como cualquier caballo."
                            : `Bloqueados como NV: ${debutantes.join(" · ") || "sin debutantes"}.`}
                        </span>
                      </span>
                    </label>

                    <div className="mt-1 flex flex-wrap gap-1">
                      {debutantes.length === 0 && (
                        <span className="text-[11px] font-semibold text-slate-400">Sin debutantes</span>
                      )}
                      {debutantes.map((m, i) => (
                        <ChipUniforme
                          key={m}
                          n={m}
                          c="debutante"
                          i={i}
                          onQuitar={() => setDebutantes((a) => a.filter((x) => x !== m))}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {!revision.valida && revision.mensaje && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">
                  ⚠️ {revision.mensaje}
                </p>
              )}

              {/* Informe compacto 120/100 */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2">
                <span className={inputLbl}>
                  📄 Informe 120/100 · se juega {PROPORCION} para ganar 100
                </span>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-bold text-indigo-800">
                  <span>Ganancia neta = {Math.round(FACTOR_GANANCIA * 100 * 100) / 100}% del monto</span>
                  <span>
                    Pago bruto = {Math.round(FACTOR_BRUTO * 10000) / 10000}$ por cada 1$ (monto + ganancia)
                  </span>
                </div>
                {informe.length === 0 ? (
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">
                    Defina las marcas para ver contra quién juega cada una.
                  </p>
                ) : (
                  <div className="mt-1 grid gap-1 sm:grid-cols-2">
                    {informe.map(({ n, a }) => (
                      <div
                        key={n}
                        className={`flex items-center gap-2 rounded px-2 py-0.5 text-[11px] font-semibold ${
                          a.valido ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                        }`}
                      >
                        <HorseBadge num={n} size="sm" />
                        <span className="truncate">{a.mensaje}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="success" onClick={() => void guardar()} disabled={guardando || !revision.valida}>
                  {guardando ? "Guardando…" : "💾 Guardar"}
                </Button>
                {fila.config && (
                  <>
                    <Button variant="outline" onClick={() => void alternarEstado()}>
                      {fila.config.estado === "Abierta" ? "⏸️ Cerrar ventas" : "▶️ Abrir ventas"}
                    </Button>
                    <Button variant="danger" onClick={() => void borrar()}>
                      🗑️ Borrar
                    </Button>
                  </>
                )}
                <span className="text-[10px] font-bold uppercase text-slate-500">
                  Estado:{" "}
                  <span className={fila.config?.estado === "Abierta" ? "text-emerald-600" : "text-slate-500"}>
                    {fila.config ? fila.config.estado : "Sin configurar"}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModalMarcasEditor;