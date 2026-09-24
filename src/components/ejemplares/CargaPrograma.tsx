"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ToastHost } from "@/components/ui/ToastHost";
import { BuscadorPadron, type OpcionPadron } from "@/components/ejemplares/BuscadorPadron";
import { useAuthStore } from "@/store/useAuthStore";
import { registrarEjemplares, listarPadronSimple } from "@/lib/gaceta/padron";
import {
  guardarPrograma,
  hoyLocal,
  leerProgramaPorFecha,
  listarHipodromosCatalogo,
  type CarreraPrograma,
  type ProgramaDia,
} from "@/lib/gaceta/programa";

const SUPERFICIES = ["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"];

type Caballo = CarreraPrograma["caballos"][number];

const plantaCaballo = (numero: number): Caballo => ({
  numero,
  nombre: "",
  nacionalidad: "VE",
  valor: 0,
  ejemplar_id: null,
});

const pluma = "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * "Carga de Programa" — paridad funcional con el legacy (programa_dia.js /
 * ensamblaje). Selecciona fecha + hipódromo, arma la matriz de carreras del día
 * y sus ejemplares (auto-completado contra el padrón `ejemplares`) y hace un
 * UPSERT masivo en `programa_dia`. El estado local refleja al instante lo cargado.
 */
export function CargaPrograma() {
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [hipodromo, setHipodromo] = useState("");
  const [catalogo, setCatalogo] = useState<Array<{ id: string | number; nombre: string }>>([]);
  const [padron, setPadron] = useState<OpcionPadron[]>([]);
  const [programa, setPrograma] = useState<ProgramaDia | null>(null);
  const [carreras, setCarreras] = useState<CarreraPrograma[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState<string>("");
  const usuario = useAuthStore((s) => s.usuario);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const cargarPrograma = useCallback(async (f: string) => {
    const res = await leerProgramaPorFecha(f);
    setPrograma(res.ok ? (res.data ?? null) : null);
  }, []);

  // Inicial: catálogo de hipódromos + padrón de ejemplares + programa de la fecha.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [hipos, pad, prog] = await Promise.all([
        listarHipodromosCatalogo(),
        listarPadronSimple(),
        leerProgramaPorFecha(hoyLocal()),
      ]);
      if (!vivo) return;
      setCatalogo(hipos);
      setPadron(pad);
      setPrograma(prog.ok ? (prog.data ?? null) : null);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Al cambiar el hipódromo seleccionado, mostraremos sus carreras del día.
  useEffect(() => {
    const seleccion = hipodromo.trim().toUpperCase();
    setCarreras(seleccion ? (programa?.carreras ?? []).filter((c) => c.hipodromo === seleccion) : []);
  }, [programa, hipodromo]);

  const opcionesHipodromo = useMemo(
    () =>
      catalogo.map((h) => ({
        value: h.nombre.toUpperCase(),
        label: h.nombre.toUpperCase(),
      })),
    [catalogo]
  );

  const opcionesPadron = useMemo(() => ({ opciones: padron }), [padron]);

  const totalEjemplares = useMemo(
    () => carreras.reduce((a, c) => a + (c.caballos || []).filter((cb) => cb.nombre).length, 0),
    [carreras]
  );

  const setCarrera = (i: number, patch: Partial<CarreraPrograma>) =>
    setCarreras((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const setCaballo = (i: number, j: number, patch: Partial<Caballo>) =>
    setCarreras((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, caballos: c.caballos.map((cb, jj) => (jj === j ? { ...cb, ...patch } : cb)) } : c))
    );

  const quitarCaballo = (i: number, j: number) =>
    setCarreras((prev) => prev.map((c, idx) => (idx === i ? { ...c, caballos: c.caballos.filter((_, jj) => jj !== j) } : c)));

  const agregarCarrera = () => {
    const n = carreras.length ? Math.max(...carreras.map((c) => c.carrera ?? 0)) + 1 : 1;
    setCarreras((prev) => [...prev, { hipodromo: hipodromo.trim().toUpperCase(), fecha, carrera: n, distancia: 0, superficie: "ARENA", premio: 0, caballos: [plantaCaballo(1)] }]);
  };

  const agregarEjemplar = (i: number) =>
    setCarreras((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const n = c.caballos.length ? Math.max(...c.caballos.map((cb) => Number(cb.numero) || 0)) + 1 : 1;
        return { ...c, caballos: [...c.caballos, plantaCaballo(n)] };
      })
    );

  const guardar = async () => {
    const hipo = hipodromo.trim().toUpperCase();
    if (!hipo) return toast("Seleccione o escriba el hipódromo.", "warning");
    if (!carreras.length) return toast("Agregue al menos una carrera al programa.", "warning");

    const pref = carreras.map((c) => ({
      ...c,
      hipodromo: hipo,
      fecha,
      caballos: (c.caballos || []).filter((cb) => cb.nombre.trim()),
    }));
    if (!pref.some((c) => c.caballos.length)) return toast("Cada carrera debe tener al menos un ejemplar con nombre.", "warning");

    setGuardando(true);
    // 1) Vinculación masiva al padrón `ejemplares` (crea los no registrados).
    const tot = await registrarEjemplares(pref as unknown as Array<Record<string, unknown>>);
    // 2) UPSERT masivo en `programa_dia` (merge con carreras de otros hipódromos).
    const otras = (programa?.carreras ?? []).filter((c) => c.hipodromo !== hipo);
    const merged = [...otras, ...pref];
    const hipodromos = [...new Set([...(programa?.hipodromos ?? []), hipo].map((h) => String(h).toUpperCase().trim()).filter(Boolean))];
    const res = await guardarPrograma({ fecha, hipodromos, carreras: merged }, usuario);
    setGuardando(false);

    if (!res.ok) return toast(res.error ?? "Error al guardar el programa.", "error");
    if (res.data) setPrograma(res.data);
    setGuardado(`Programa guardado · ${pref.length} carrera(s) · ${totalEjemplares} ejemplar(es) · ${new Date().toLocaleTimeString("es-VE")}`);
    toast(
      `✅ Programa guardado: ${pref.length} carrera(s), ${totalEjemplares} ejemplar(es). Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s)${tot.fallidos ? `, ${tot.fallidos} fallido(s)` : ""}.`,
      "success"
    );
    if (pref.some((c) => c.caballos.length)) setCarreras(pref);
  };

  return (
    <section className="flex flex-col gap-4">
      {/* Cabecera */}
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">📅 Carga de Programa</h2>
        <p className="text-[11px] text-slate-500">
          Cree las carreras del día y sus ejemplares (vinculados al padrón); se persisten en la tabla compartida <b>programa_dia</b>.
        </p>
      </div>

      {/* Filtros principales */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            id="fecha-programa"
            label="Fecha de la jornada"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyLocal())}
          />
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Hipódromo</span>
            <SearchableSelect options={opcionesHipodromo} value={hipodromo} onChange={setHipodromo} placeholder="Buscar o escribir hipódromo…" />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <div className="flex-1" />
            <Button variant="outline" size="md" onClick={() => void cargarPrograma(fecha)}>
              ⟳ Recargar
            </Button>
          </div>
        </div>
        {programa && (
          <p className="mt-3 rounded-lg border border-primary-200 bg-primary-500/5 px-3 py-2 text-[11px] font-semibold text-primary-700">
            📌 Programa existente para el <b>{programa.fecha}</b>: {programa.hipodromos.join(", ") || "sin hipódromos"} ·{" "}
            {programa.carreras.length} carrera(s). Abajo se muestran las de <b>{hipodromo || "…"}</b>.
          </p>
        )}
        {guardado && <p className="mt-2 text-[11px] font-bold text-success-600">✔ {guardado}</p>}
      </Card>

      {/* Matriz de carreras */}
      {!hipodromo.trim() ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-bold text-slate-600">🏇 Seleccione fecha y hipódromo para comenzar</p>
          <p className="mt-1 text-xs text-slate-500">Se desplegará la matriz de carreras y ejemplares del día.</p>
        </Card>
      ) : cargando ? (
        <Card className="p-8 text-center text-xs font-semibold text-slate-500">Cargando catálogos…</Card>
      ) : (
        <>
          {carreras.length === 0 && (
            <Card className="p-6 text-center">
              <p className="text-xs text-slate-500 italic">Sin carreras para {hipodromo.toUpperCase()} en {fecha}.</p>
              <Button variant="default" size="md" className="mt-3" onClick={agregarCarrera}>
                ＋ Crear primera carrera
              </Button>
            </Card>
          )}

          {carreras.map((c, i) => (
            <Card key={`${c.carrera ?? i}-${i}`} className="overflow-hidden">
              {/* Cabecera de la carrera */}
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surfaceAlt/60 px-4 py-2.5">
                <h3 className="mr-2 text-xs font-black uppercase tracking-wider text-primary-700">
                  Carrera {c.carrera ?? i + 1}ª
                </h3>
                <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">
                  {(c.caballos || []).filter((cb) => cb.nombre).length} ejemplares
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Input label="" hint="" aria-label="Distancia"
                    type="number" placeholder="Dist. m" value={c.distancia || ""}
                    onChange={(e) => setCarrera(i, { distancia: Number(e.target.value) || 0 })}
                    className="!py-1.5 !text-xs w-24" />
                  <select
                    aria-label="Superficie"
                    value={c.superficie || "ARENA"}
                    onChange={(e) => setCarrera(i, { superficie: e.target.value })}
                    className={pluma + " w-28"}
                  >
                    {SUPERFICIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Input label="" hint="" aria-label="Premio"
                    type="number" placeholder="Premio $" value={c.premio || ""}
                    onChange={(e) => setCarrera(i, { premio: Number(e.target.value) || 0 })}
                    className="!py-1.5 !text-xs w-28" />
                  <Button variant="danger" size="sm" onClick={() => setCarreras((prev) => prev.filter((_, idx) => idx !== i))}>
                    🗑
                  </Button>
                </div>
              </div>

              {/* Ejemplares inscritos */}
              <div className="p-3">
                {(c.caballos || []).length === 0 ? (
                  <p className="py-2 text-center text-[11px] italic text-slate-400">Esta carrera no tiene ejemplares todavía.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="hidden grid-cols-[3rem_1fr_5rem_1.5rem] gap-2 px-1 text-[9px] font-black uppercase tracking-widest text-slate-400 sm:grid">
                      <span>Chaleco</span>
                      <span>Ejemplar (padrón)</span>
                      <span>Valor</span>
                      <span />
                    </div>
                    {(c.caballos || []).map((cb, j) => {
                      const vinc = cb.ejemplar_id != null && cb.nombre.length > 0;
                      return (
                        <div key={`${i}-${j}`} className="grid grid-cols-[3rem_1fr_5rem_1.5rem] items-center gap-2">
                          <Input label="" hint="" aria-label="Número de chaleco"
                            type="number" min={1} value={cb.numero}
                            onChange={(e) => setCaballo(i, j, { numero: Number(e.target.value) || 0 })}
                            className="!py-1.5 !px-2 !text-xs text-center" />
                          <BuscadorPadron
                            opciones={opcionesPadron.opciones}
                            valor={typeof cb.nombre === "string" ? cb.nombre : String(cb.nombre)}
                            vinculado={vinc}
                            onChange={(r) => setCaballo(i, j, { nombre: r.nombre, nacionalidad: r.nacionalidad, ejemplar_id: r.ejemplar_id })}
                          />
                          <Input label="" hint="" aria-label="Valor del ejemplar"
                            type="number" min={0} step="0.01" placeholder="0"
                            value={cb.valor ?? ""}
                            onChange={(e) => setCaballo(i, j, { valor: Number(e.target.value) || 0 })}
                            className="!py-1.5 !px-2 !text-xs text-right" />
                          <button
                            type="button"
                            onClick={() => quitarCaballo(i, j)}
                            className="rounded-md border border-red-300 p-1.5 text-[10px] text-red-500 transition-colors hover:bg-red-50"
                            title="Quitar ejemplar"
                            aria-label="Quitar ejemplar"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => agregarEjemplar(i)}>
                  ＋ Agregar ejemplar
                </Button>
              </div>
            </Card>
          ))}

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="md" onClick={agregarCarrera}>
              ＋ Agregar carrera
            </Button>
            {carreras.length > 0 && (
              <Button variant="ghost" size="md" onClick={() => setCarreras([])}>
                Vaciar matriz
              </Button>
            )}
            <Button variant="success" size="lg" className="ml-auto" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? "Guardando programa…" : "💾 Guardar Programa"}
            </Button>
          </div>
        </>
      )}

      <ToastHost />
    </section>
  );
}

export default CargaPrograma;