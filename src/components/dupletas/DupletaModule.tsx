"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarTablasPublicadas } from "@/lib/tablas/rpc";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { listarClientesVenta, type ClienteVenta } from "@/lib/grupos";
import { colorDeNumeroGac } from "@/lib/gaceta/ui";
import { Flag, normalizarNacionalidad } from "@/components/ui/BanderaPais";
import { claveCelda, guardarDupleta, listarDupletasGuardadas, type CaballoDupleta, type DupletaEstado } from "@/lib/dupletas";
import { exportarPaginas, type ImgFormato } from "@/lib/impresion/exportar";

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";
const inputSel =
  "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

const esHipoAmericano = (h: string) => /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(h);
const casaDe = (h: string) => (esHipoAmericano(h) ? "USA" : "VE");

/** True si el ejemplar es de otra nacionalidad que el hipódromo (mostrar bandera). */
const banderaNoCasa = (nac?: string | null, hipo = "") => normalizarNacionalidad(nac) !== casaDe(hipo);

export function DupletaModule() {
  const [carreras, setCarreras] = useState<TablaFijaRow[]>([]);
  const [guardadas, setGuardadas] = useState<DupletaEstado[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);

  const [hipodromo, setHipodromo] = useState("");
  const [dia, setDia] = useState("");
  const [carrera1, setCarrera1] = useState("");
  const [carrera2, setCarrera2] = useState("");
  const [premio, setPremio] = useState("200");
  const [precio, setPrecio] = useState("10");

  const [matriz, setMatriz] = useState<DupletaEstado | null>(null);
  const tablaRef = useRef<HTMLTableElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [ajuste, setAjuste] = useState<{ w: number; h: number; escala: number } | null>(null);

  // Ancho uniforme de cada columna horizontal: caben el nombre del caballo en UNA línea.
  const anchoCol = useMemo(() => {
    if (!matriz || typeof document === "undefined") return 120;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 120;
    ctx.font = "900 13px Inter, ui-sans-serif, system-ui, sans-serif";
    let w = 88;
    for (const c of matriz.caballos1) {
      const txt = ctx.measureText(String(c.nombre || "").trim()).width * 1.12;
      const band = banderaNoCasa(c.nacionalidad, matriz.hipodromo) ? 22 : 0;
      w = Math.max(w, Math.ceil(txt + band + 16));
    }
    return w;
  }, [matriz]);

  // Ajusta la tabla al área visible para nunca tener barras de desplazamiento.
  useEffect(() => {
    if (!matriz || !tablaRef.current || !areaRef.current) return;
    const area = areaRef.current;
    const tabla = tablaRef.current;
    let vivos = 0;
    const medir = () => {
      const f = ++vivos;
      const cw = area.clientWidth;
      const ch = area.clientHeight;
      const nw = tabla.scrollWidth;
      const nh = tabla.scrollHeight;
      if (!cw || !ch || !nw || !nh) return;
      const escala = Math.min(1, cw / nw, ch / nh);
      if (f !== vivos) return;
      setAjuste({ w: nw, h: nh, escala });
    };
    const raf = requestAnimationFrame(medir);
    const ro = new ResizeObserver(medir);
    ro.observe(area);
    document.fonts?.ready?.then(medir).catch(() => undefined);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [matriz, anchoCol]);
  const [modal, setModal] = useState<{ c1: string; c2: string } | null>(null);
  const [q, setQ] = useState("");
  const [abiertoCli, setAbiertoCli] = useState(false);
  const [precioCelda, setPrecioCelda] = useState("");
  const [guardando, setGuardando] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  useEffect(() => {
    let v = true;
    void listarTablasPublicadas().then((cs) => v && setCarreras(cs));
    void listarDupletasGuardadas().then((gs) => v && setGuardadas(gs));
    void listarClientesVenta().then((cl) => v && setClientes(cl));
    return () => {
      v = false;
    };
  }, []);

  const hipodromos = useMemo(
    () =>
      [...new Set(carreras.map((c) => String(c.hipodromo || "").trim().toUpperCase()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [carreras]
  );

  const dias = useMemo(() => {
    const hs = carreras.filter((c) => String(c.hipodromo || "").trim().toUpperCase() === hipodromo);
    return [...new Set(hs.map((c) => c.fecha || "").filter(Boolean))].sort().reverse();
  }, [carreras, hipodromo]);

  const carrerasDelDia = useMemo(
    () =>
      carreras
        .filter((c) => String(c.hipodromo || "").trim().toUpperCase() === hipodromo && (c.fecha || "") === dia)
        .sort((a, b) => (Number(a.carrera) || 0) - (Number(b.carrera) || 0)),
    [carreras, hipodromo, dia]
  );

  const ejemplaresDe = (carrera: string): CaballoDupleta[] => {
    const fila = carrerasDelDia.find((c) => String(c.carrera) === String(carrera));
    return (fila?.caballos ?? [])
      .map((c) => ({
        numero: String(c.numero ?? ""),
        nombre: String(c.nombre || "").trim().toUpperCase(),
        nacionalidad: c.nacionalidad ?? null,
        retirado: Boolean(c.retirado),
      }))
      .filter((c) => c.nombre);
  };

  const generar = () => {
    if (!hipodromo) return toast("Elija el hipódromo.", "warning");
    if (!dia) return toast("Elija el día.", "warning");
    if (!carrera1 || !carrera2) return toast("Seleccione las dos carreras de la dupleta.", "warning");
    if (String(carrera1) === String(carrera2)) return toast("Carrera 1 y Carrera 2 deben ser distintas.", "warning");
    const cab1 = ejemplaresDe(carrera1);
    const cab2 = ejemplaresDe(carrera2);
    if (!cab1.length || !cab2.length) return toast("Una de las carreras no tiene ejemplares publicados.", "warning");
    const p = Number(premio) || 0;
    const pr = Number(precio) || 0;
    setMatriz({
      hipodromo: hipodromo.toUpperCase(),
      fecha: dia,
      carrera1: Number(carrera1) || carrera1,
      carrera2: Number(carrera2) || carrera2,
      premio: p,
      precio: pr,
      caballos1: cab1,
      caballos2: cab2,
      celdas: {},
      updatedAt: new Date().toISOString(),
    });
    toast(`✅ Matriz C${carrera1}×C${carrera2} generada: ${cab1.length}×${cab2.length} = ${cab1.length * cab2.length} cuadros.`, "success");
  };

  const abrirCelda = (c1: string, c2: string) => {
    if (!matriz) return;
    const celda = matriz.celdas[claveCelda(c1, c2)];
    setPrecioCelda(String(celda?.precio ?? matriz.precio ?? ""));
    setQ(celda?.cliente_nombre ?? "");
    setModal({ c1, c2 });
  };

  const venderCelda = () => {
    if (!matriz || !modal) return;
    const precioFinal = Number(precioCelda) || matriz.precio || 0;
    const nombre = q.trim().toUpperCase();
    if (!nombre) return toast("Escriba o busque el nombre del cliente.", "warning");
    const cliente = clientes.find((cl) => cl.nombre.toUpperCase() === nombre);
    setMatriz({
      ...matriz,
      celdas: {
        ...matriz.celdas,
        [claveCelda(modal.c1, modal.c2)]: { vendida: true, cliente_id: cliente?.id ?? null, cliente_nombre: nombre, precio: precioFinal },
      },
    });
    toast(`✅ Vendido ${nombre} · $${precioFinal.toLocaleString("es-VE", { maximumFractionDigits: 2 })}.`, "success");
    setModal(null);
    setQ("");
  };

  const quitarVenta = () => {
    if (!matriz || !modal) return;
    const celdas = { ...matriz.celdas };
    delete celdas[claveCelda(modal.c1, modal.c2)];
    setMatriz({ ...matriz, celdas });
    toast("Venta anulada de la combinación.", "info");
    setModal(null);
    setQ("");
  };

  const toggleRetirado = (eje: 1 | 2, numero: string) => {
    if (!matriz) return;
    const lista = (eje === 1 ? matriz.caballos1 : matriz.caballos2).map((c) => ({ ...c }));
    const i = lista.findIndex((c) => String(c.numero) === String(numero));
    if (i === -1) return;
    lista[i] = { ...lista[i], retirado: !lista[i].retirado };
    setMatriz({ ...matriz, [eje === 1 ? "caballos1" : "caballos2"]: lista });
  };

  const guardar = async () => {
    if (!matriz) return toast("Genere la matriz antes de guardar.", "warning");
    setGuardando(true);
    const r = await guardarDupleta({ ...matriz, updatedAt: new Date().toISOString() });
    setGuardando(false);
    if (r.ok) {
      toast(`💾 Dupleta ${matriz.hipodromo} C${matriz.carrera1}×C${matriz.carrera2} guardada en Supabase.`, "success");
      setGuardadas(await listarDupletasGuardadas());
    } else {
      toast(`Error al guardar: ${r.error}. Ejecute sql/crear_tabla_dupletas.sql`, "error");
    }
  };

  const clienteFiltrados = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return clientes;
    return clientes.filter((c) => c.nombre.toUpperCase().includes(t));
  }, [clientes, q]);

  const vendidas = matriz ? Object.values(matriz.celdas).filter((c) => c.vendida) : [];
  const totalVentas = vendidas.reduce((a, c) => a + (c.precio ?? matriz?.precio ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-600">🎯 Dupleta — Matriz de apuestas cruzadas</h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className={inputLbl}>Hipódromo</span>
            <select value={hipodromo} onChange={(e) => { setHipodromo(e.target.value); setDia(""); setCarrera1(""); setCarrera2(""); }} className={inputSel}>
              <option value="">— elegir —</option>
              {hipodromos.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={inputLbl}>Día</span>
            <select value={dia} onChange={(e) => { setDia(e.target.value); setCarrera1(""); setCarrera2(""); }} disabled={!hipodromo} className={inputSel}>
              <option value="">— elegir —</option>
              {dias.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={inputLbl}>Carrera 1 de la Dupleta</span>
            <select value={carrera1} onChange={(e) => setCarrera1(e.target.value)} disabled={!dia} className={inputSel}>
              <option value="">— elegir —</option>
              {carrerasDelDia.map((c) => (
                <option key={String(c.carrera)} value={String(c.carrera)}>Carrera {c.carrera} ({c.distancia_carrera ? `${c.distancia_carrera} m` : "—"})</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={inputLbl}>Carrera 2 de la Dupleta</span>
            <select value={carrera2} onChange={(e) => setCarrera2(e.target.value)} disabled={!dia} className={inputSel}>
              <option value="">— elegir —</option>
              {carrerasDelDia.map((c) => (
                <option key={String(c.carrera)} value={String(c.carrera)}>Carrera {c.carrera} ({c.distancia_carrera ? `${c.distancia_carrera} m` : "—"})</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={inputLbl}>💵 Premio (PAGA X)</span>
            <input type="number" value={premio} onChange={(e) => setPremio(e.target.value)} placeholder="200" className={inputSel} />
          </label>
          <label className="block">
            <span className={inputLbl}>Precio por cuadro</span>
            <input type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="10" className={inputSel} />
          </label>
          <Button variant="default" size="md" onClick={generar}>🧮 Generar Matriz</Button>
          <Button variant="success" size="md" onClick={() => void guardar()} disabled={guardando || !matriz}>
            {guardando ? "Guardando…" : "💾 Guardar en Supabase"}
          </Button>
          <label className="block min-w-[220px]">
            <span className={inputLbl}>Dupletas guardadas</span>
            <select
              className={inputSel}
              disabled={!guardadas.length}
              onChange={(e) => {
                const g = guardadas.find((x) => claveCelda(String(x.carrera1), String(x.carrera2)) + x.hipodromo + x.fecha === e.target.value);
                if (g) {
                  setMatriz(g);
                  setHipodromo(g.hipodromo);
                  setDia(g.fecha);
                  setCarrera1(String(g.carrera1));
                  setCarrera2(String(g.carrera2));
                  toast(`📂 Cargada ${g.hipodromo} C${g.carrera1}×C${g.carrera2}.`, "info");
                }
                e.target.value = "";
              }}
            >
              <option value="">— cargar —</option>
              {guardadas.map((g) => (
                <option key={claveCelda(String(g.carrera1), String(g.carrera2)) + g.hipodromo + g.fecha} value={claveCelda(String(g.carrera1), String(g.carrera2)) + g.hipodromo + g.fecha}>
                  {g.hipodromo} · {g.fecha} · C{g.carrera1}×C{g.carrera2} · {Object.values(g.celdas).filter((c) => c.vendida).length} ventas
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {matriz && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
              {matriz.hipodromo} · {matriz.fecha} · Carrera {matriz.carrera1} × Carrera {matriz.carrera2} — PAGA {matriz.premio.toLocaleString("es-VE")}
            </h4>
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">
                🧾 {vendidas.length} cuadro(s) vendido(s) · {totalVentas.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
              </span>
              <Button variant="outline" size="sm" onClick={() => void exportarMatriz("PNG")}>🖼️ PNG</Button>
              <Button variant="default" size="sm" onClick={() => void exportarMatriz("PDF")}>📄 PDF</Button>
            </span>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-line bg-white shadow-sm" style={{ height: "calc(100vh - 300px)" }}>
            <div ref={areaRef} className="absolute inset-0 flex items-start justify-start">
              <div style={ajuste ? { width: Math.round(ajuste.w * ajuste.escala), height: Math.round(ajuste.h * ajuste.escala), transform: `scale(${ajuste.escala})`, transformOrigin: "top left" } : undefined}>
                <table ref={tablaRef} className="min-w-max border-separate border-spacing-0 text-[10px] leading-tight">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-40 min-w-[120px] border-b border-r border-slate-300 bg-indigo-600 p-1 text-left align-bottom text-[9px] font-black text-white">
                    <span className="block">DUPLETA</span>
                    <span className="block text-[14px] text-emerald-300">PAGA {matriz.premio.toLocaleString("es-VE")}</span>
                    <span className="mt-0.5 block text-[7px] font-bold uppercase text-indigo-200">clic en ejemplar = retira</span>
                  </th>
                  {matriz.caballos1.map((cb, i1) => {
                    const col = colorDeNumeroGac(cb.numero);
                    return (
                      <th key={`h1-${cb.numero}`} className={`sticky top-0 z-30 border-b border-r border-slate-300 p-0.5 align-bottom ${i1 % 2 ? "bg-indigo-700" : "bg-indigo-600"}`} style={{ width: anchoCol, maxWidth: anchoCol }}>
                        <button
                          type="button"
                          onClick={() => toggleRetirado(1, cb.numero)}
                          title={cb.retirado ? "Quitar retirado" : "Marcar retirado"}
                          className={`flex h-full w-full flex-col items-center justify-center rounded px-0.5 py-0.5 ${cb.retirado ? "bg-yellow-400 text-slate-900" : "text-white"}`}
                        >
                          <span className="flex items-center justify-center gap-1">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] font-black" style={{ backgroundColor: col.bg, color: col.fg }}>
                              {cb.numero}
                            </span>
                            {cb.retirado && <span className="text-[13px] font-black">✖</span>}
                          </span>
                          <span className="block whitespace-nowrap text-[13px] leading-tight">
                            {cb.nombre}
                            {banderaNoCasa(cb.nacionalidad, matriz.hipodromo) && (
                              <Flag nac={cb.nacionalidad} size={17} withName={false} className="ml-1" />
                            )}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matriz.caballos2.map((cb2, i2) => {
                  const izq = colorDeNumeroGac(cb2.numero);
                  return (
                    <tr key={`f-${cb2.numero}`}>
                      <th className={`sticky left-0 z-20 w-[120px] max-w-[120px] border-b border-r border-slate-300 p-0.5 align-top text-left ${i2 % 2 ? "bg-indigo-100" : "bg-indigo-50"}`}>
                        <button
                          type="button"
                          onClick={() => toggleRetirado(2, cb2.numero)}
                          title={cb2.retirado ? "Quitar retirado" : "Marcar retirado"}
                          className={`flex w-full items-start justify-start gap-1 rounded px-0.5 py-0.5 text-left ${cb2.retirado ? "bg-yellow-400 text-slate-900" : "text-slate-800"}`}
                        >
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] font-black" style={{ backgroundColor: izq.bg, color: izq.fg }}>
                            {cb2.numero}
                          </span>
                          {cb2.retirado && <span className="text-[13px] font-black">✖</span>}
                          <span className="min-w-0 flex-1 break-words text-[13px] leading-tight">
                            {cb2.nombre}
                            {banderaNoCasa(cb2.nacionalidad, matriz.hipodromo) && (
                              <Flag nac={cb2.nacionalidad} size={17} withName={false} className="ml-1" />
                            )}
                          </span>
                        </button>
                      </th>
                      {matriz.caballos1.map((cb1, i1) => {
                        const bloqueada = cb1.retirado || cb2.retirado;
                        const celda = matriz.celdas[claveCelda(cb1.numero, cb2.numero)];
                        const mezcla = !bloqueada && !celda?.vendida && (i1 + i2) % 2 === 1;
                        return (
                          <td key={`c-${cb1.numero}-${cb2.numero}`} className={`w-[72px] min-w-[72px] border-b border-r border-slate-400 p-0.5 ${bloqueada ? "bg-slate-200" : celda?.vendida ? "bg-orange-400" : mezcla ? "bg-slate-100" : "bg-white"}`}>
                            {bloqueada ? (
                              <div className="flex h-11 items-center justify-center text-[6px] font-black tracking-[0.35em] text-slate-500" style={{ writingMode: "vertical-rl" }}>
                                N O V A L E
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => abrirCelda(cb1.numero, cb2.numero)}
                                title={`${cb1.nombre} × ${cb2.nombre}`}
                                className={`block h-11 w-full text-center transition-colors ${mezcla ? "hover:bg-indigo-50" : "hover:bg-indigo-100"} ${celda?.vendida ? "text-slate-900" : "text-slate-600"}`}
                              >
                                <span className="block text-[18px] font-black leading-none">
                                  {celda?.vendida ? (celda.precio ?? matriz.precio).toLocaleString("es-VE", { maximumFractionDigits: 2 }) : matriz.precio.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                                </span>
                                <span className="block truncate text-[11px] font-bold leading-tight">{celda?.vendida ? (celda.cliente_nombre || "—") : "clic ▼"}</span>
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              </table>
              </div>
            </div>
          </div>

          <p className="mt-2 text-[10px] italic text-slate-500">
            💡 Las filas/columnas amarillas o grises corresponden a ejemplares retirados y no se venden (N O V A L E). Cada cuadro se vende con un clic; la dupleta se guarda en la tabla `dupletas` de Supabase y se recarga en cualquier sesión.
          </p>
        </div>
      )}

      {modal && matriz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-1 text-sm font-black uppercase text-slate-800">Venta de Combinación</h4>
            <p className="mb-3 text-xs font-bold text-slate-500">
              {matriz.caballos1.find((c) => String(c.numero) === modal.c1)?.nombre} × {matriz.caballos2.find((c) => String(c.numero) === modal.c2)?.nombre}
            </p>

            <label className="mb-2 block">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Cliente</span>
              <div className="relative">
                <input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setAbiertoCli(true); }}
                  onFocus={() => setAbiertoCli(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAbiertoCli(false);
                  }}
                  placeholder="Buscar cliente…"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                {abiertoCli && clienteFiltrados.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
                    {clienteFiltrados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setQ(c.nombre); setAbiertoCli(false); }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-700 transition-colors hover:bg-primary-500/10"
                        >
                          <span className="truncate">{c.nombre}</span>
                          <span className="ml-2 shrink-0 text-[9px] font-black text-slate-400">${saldoDe(c)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            <label className="mb-4 block">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Precio del cuadro</span>
              <input
                type="number"
                value={precioCelda}
                onChange={(e) => setPrecioCelda(e.target.value)}
                placeholder={`${matriz.precio}`}
                className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button variant="success" size="md" className="flex-1" onClick={venderCelda}>💸 Vender</Button>
              {matriz.celdas[claveCelda(modal.c1, modal.c2)]?.vendida && (
                <Button variant="danger" size="md" onClick={quitarVenta}>✖ Quitar venta</Button>
              )}
              <Button variant="ghost" size="md" onClick={() => { setModal(null); setQ(""); }}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );

  function saldoDe(c: ClienteVenta): string {
    const s = c.saldo_actual != null ? Number(c.saldo_actual) : 0;
    return s.toLocaleString("es-VE", { maximumFractionDigits: 2 });
  }

  /** Exporta la matriz en UNA hoja horizontal (A4 paisaje): pdf o png. */
  async function exportarMatriz(formato: ImgFormato) {
    if (!matriz || !tablaRef.current) return;
    const tabla = tablaRef.current;
    let root: HTMLDivElement | null = null;
    try {
      // medidas naturales de la `<table>` (todo el contenido, sin scroll).
      const natW = tabla.scrollWidth;
      const natH = tabla.scrollHeight;

      // Hoja A4 paisaje @150dpi (210×148 mm) con cabecera.
      const PAGE_W = 1240;
      const PAGE_H = 877;
      const PAD = 28;
      const FONDO = 58;
      const areaW = PAGE_W - PAD * 2;
      const areaH = PAGE_H - PAD * 2 - FONDO;
      const escala = Math.min(areaW / natW, areaH / natH, 1);

      root = document.createElement("div");
      root.style.cssText = "position:absolute;left:-99999px;top:0;z-index:-1;";
      const page = document.createElement("div");
      page.className = "im-pagina";
      page.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;background:#fff;box-sizing:border-box;padding:${PAD}px;display:flex;flex-direction:column;`;

      const header = document.createElement("div");
      header.style.cssText = `height:${FONDO}px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px;`;
      const titulo = document.createElement("div");
      titulo.style.cssText =
        "width:60px;height:60px;background:#4f46e5;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:15px;letter-spacing:0.06em;";
      titulo.textContent = "DUPLETA";
      const info = document.createElement("div");
      info.style.cssText = "flex:1;min-width:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;";
      const infoT = document.createElement("div");
      infoT.style.cssText = "font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#0f172a;";
      infoT.textContent = `${matriz.hipodromo} · ${matriz.fecha} · Carrera ${matriz.carrera1} × Carrera ${matriz.carrera2}`;
      const infoS = document.createElement("div");
      infoS.style.cssText = "font-size:12px;font-weight:700;color:#64748b;margin-top:3px;";
      infoS.textContent = `PAGA ${matriz.premio.toLocaleString("es-VE")} · ${vendidas.length} cuadro(s) vendido(s) · ${totalVentas.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`;
      info.append(infoT, infoS);
      header.append(titulo, info);

      const wrapper = document.createElement("div");
      wrapper.style.cssText = `width:${Math.round(natW * escala)}px;height:${Math.round(natH * escala)}px;overflow:hidden;transform:scale(${escala});transform-origin:top left;background:#fff;`;
      const clon = tabla.cloneNode(true) as HTMLElement;
      wrapper.appendChild(clon);

      page.append(header, wrapper);
      root.appendChild(page);
      document.body.appendChild(root);

      const base = `dupleta_${matriz.hipodromo.replace(/[^a-z0-9]+/gi, "_")}_C${matriz.carrera1}xC${matriz.carrera2}`;
      await exportarPaginas(root, formato, base, { orientacion: "horizontal" });
      root.remove();
    } catch {
      root?.remove?.();
      toast("No se pudo exportar la dupleta.", "error");
    }
  }
}

export default DupletaModule;