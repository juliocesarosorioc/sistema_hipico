"use client";

/**
 * CUADERNO DE JUGADAS POR CLIENTE — libro manual entre varios grupos.
 *
 * El admin anota a mano las jugadas de un cliente repartidas entre VARIOS
 * grupos, incluidos grupos que NO están registrados en el sistema. Sirve para
 * llevar el control de un cliente "de palabra" sin crear tickets ni mover
 * saldos: es un cuaderno, no una venta.
 *
 * Muestra, por cliente:
 *   · totales (jugado / premios / neto / pendiente),
 *   · el balance POR GRUPO, y
 *   · el balance POR SEMANA (lunes a domingo).
 *
 * Misma firma de selector que `EstadoCuentaAcordeon` (clientes + clienteEstado
 * + onActivo) para reusar la pestaña y el botón 📒 de la cartera.
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Guard } from "@/shared/components/ui/Guard";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import {
  eliminarCuaderno,
  guardarCuaderno,
  listarCuaderno,
  type CuadernoFila,
} from "@/features/clientes/lib/cuaderno";
import {
  ESTADOS_CUADERNO,
  etiquetaSemana,
  num,
  resumenCuaderno,
  type CuadernoEstado,
  type ResumenCuaderno,
} from "@/features/clientes/lib/cuadernoResumen";
import type { ClienteRow } from "@/features/clientes/lib/clientes";
import { formatoMoneda } from "@/shared/lib/vzla";
import { useAuthStore } from "@/shared/store/useAuthStore";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Draft = {
  id?: string | number;
  fecha: string;
  grupoSel: string; // id de grupos_venta, o "" para grupo libre
  grupoLibre: string;
  hipodromo: string;
  carrera: string;
  tipo: string;
  caballo: string;
  monto: string;
  premio: string;
  estado: CuadernoEstado;
  nota: string;
};

const draftInicial = (): Draft => ({
  fecha: hoyLocal(),
  grupoSel: "",
  grupoLibre: "",
  hipodromo: "",
  carrera: "",
  tipo: "",
  caballo: "",
  monto: "",
  premio: "",
  estado: "Pendiente",
  nota: "",
});

const COLOR_ESTADO: Record<string, string> = {
  Pendiente: "bg-amber-100 text-amber-700",
  Ganada: "bg-emerald-100 text-emerald-700",
  Perdida: "bg-rose-100 text-rose-700",
  Reembolsada: "bg-slate-200 text-slate-600",
};

/** Color del neto: verde si el cliente ganó (la casa debe), rojo si la casa ganó. */
const claseNeto = (n: number): string =>
  n > 0 ? "text-danger-600" : n < 0 ? "text-emerald-700" : "text-slate-500";

function TarjetaResumen({ r }: { r: ResumenCuaderno }) {
  const items: [string, string, string][] = [
    ["Jugado", formatoMoneda("USD", r.apostado), "text-slate-800"],
    ["Premios", formatoMoneda("USD", r.premios), "text-emerald-700"],
    ["Neto", formatoMoneda("USD", r.neto), claseNeto(r.neto)],
    ["Pendiente", formatoMoneda("USD", r.pendiente), "text-amber-700"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([lbl, val, cls]) => (
        <div key={lbl} className="rounded-2xl border border-line bg-white px-3 py-2 shadow-sm">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{lbl}</div>
          <div className={`font-mono text-sm font-black tabular-nums ${cls}`}>{val}</div>
        </div>
      ))}
    </div>
  );
}

type Props = {
  clientes: ClienteRow[];
  clienteEstado: ClienteRow | null;
  onActivo: (c: ClienteRow | null) => void;
};

export function CuadernoCliente({ clientes, clienteEstado, onActivo }: Props) {
  const usuario = useAuthStore((s) => s.usuario || s.email || null);

  const [filas, setFilas] = useState<CuadernoFila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [draft, setDraft] = useState<Draft>(draftInicial());
  const [formAbierto, setFormAbierto] = useState(false);

  // Catálogo de grupos registrados (para el selector); los libres se escriben a mano.
  useEffect(() => {
    void listarGruposVenta().then(setGrupos).catch(() => setGrupos([]));
  }, []);

  const cargar = async (clienteId: string | number) => {
    setCargando(true);
    const fs = await listarCuaderno(clienteId);
    setFilas(fs);
    setCargando(false);
  };

  useEffect(() => {
    if (clienteEstado) void cargar(clienteEstado.id);
    else setFilas([]);
    setFormAbierto(false);
    setDraft(draftInicial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteEstado?.id ?? null]);

  const resumen = useMemo(() => resumenCuaderno(filas), [filas]);

  const abrirNuevo = () => {
    setDraft(draftInicial());
    setFormAbierto(true);
  };

  const abrirEdicion = (f: CuadernoFila) => {
    setDraft({
      id: f.id,
      fecha: String(f.fecha ?? "").slice(0, 10) || hoyLocal(),
      grupoSel: f.grupo_id != null ? String(f.grupo_id) : "",
      grupoLibre: f.grupo_id != null ? "" : String(f.grupo_nombre ?? ""),
      hipodromo: String(f.hipodromo ?? ""),
      carrera: f.carrera != null ? String(f.carrera) : "",
      tipo: String(f.tipo ?? ""),
      caballo: String(f.caballo ?? ""),
      monto: String(f.monto ?? ""),
      premio: String(f.premio ?? ""),
      estado: (f.estado as CuadernoEstado) ?? "Pendiente",
      nota: String(f.nota ?? ""),
    });
    setFormAbierto(true);
  };

  const guardar = async () => {
    if (!clienteEstado) return;
    const esLibre = draft.grupoSel === "";
    const reg = esLibre ? null : grupos.find((g) => String(g.id) === draft.grupoSel) ?? null;
    const grupoNombre = esLibre ? draft.grupoLibre : reg?.nombre ?? "";
    if (!grupoNombre.trim()) {
      return toast("Indique el grupo (registrado o escriba el nombre).", "warning");
    }
    if (!draft.fecha) return toast("Indique la fecha de la jugada.", "warning");
    setGuardando(true);
    const r = await guardarCuaderno(
      {
        id: draft.id,
        cliente_id: clienteEstado.id,
        grupo_id: esLibre ? null : reg?.id ?? null,
        grupo_nombre: grupoNombre,
        fecha: draft.fecha,
        hipodromo: draft.hipodromo,
        carrera: draft.carrera,
        tipo: draft.tipo || "JUGADA",
        caballo: draft.caballo,
        monto: num(draft.monto),
        premio: num(draft.premio),
        estado: draft.estado,
        nota: draft.nota,
      },
      usuario
    );
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo guardar el apunte.", "error");
    toast(draft.id ? "Apunte actualizado." : "Apunte agregado al cuaderno.", "success");
    setFormAbierto(false);
    setDraft(draftInicial());
    await cargar(clienteEstado.id);
  };

  const borrar = async (f: CuadernoFila) => {
    if (!clienteEstado) return;
    const r = await eliminarCuaderno(f.id);
    if (!r.ok) return toast(r.error ?? "No se pudo borrar el apunte.", "error");
    toast("Apunte borrado.", "success");
    await cargar(clienteEstado.id);
  };

  const th = "sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-left text-[9px] font-black uppercase leading-tight tracking-wider text-slate-500";
  const td = "px-2 py-1 align-middle leading-tight";
  const inp =
    "w-full border border-line rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Cliente</label>
          <select
            className="w-full border border-line rounded-xl px-3 py-2 text-sm font-bold text-slate-800 bg-white outline-none focus:ring-1 focus:ring-primary-500"
            value={clienteEstado ? String(clienteEstado.id) : ""}
            onChange={(e) => {
              const c = clientes.find((x) => String(x.id) === e.target.value) ?? null;
              onActivo(c);
            }}
          >
            <option value="">— Seleccione un cliente —</option>
            {clientes.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {c.nombre || c.seudonimo}
                {c.es_socio ? " ★Socio" : ""}
              </option>
            ))}
          </select>
        </div>
        {clienteEstado ? (
          <Guard permiso="clientes:fn_guardar_cliente" disabled>
            <Button variant="default" size="sm" onClick={abrirNuevo}>
              <span className="mr-1">➕</span> Nueva jugada
            </Button>
          </Guard>
        ) : null}
      </div>

      {!clienteEstado ? (
        <div className="rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-slate-400">
          <span className="mb-2 block text-3xl">📒</span>
          <p className="text-xs font-bold">Seleccione un cliente para abrir su cuaderno de jugadas.</p>
          <p className="mt-1 text-[11px]">
            El cuaderno es un libro manual: no crea tickets ni mueve saldos.
          </p>
        </div>
      ) : (
        <>
          <TarjetaResumen r={resumen.totales} />

          {formAbierto ? (
            <div className="rounded-2xl border border-line bg-white p-3 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  {draft.id ? "Editar apunte" : "Nuevo apunte"}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setFormAbierto(false);
                    setDraft(draftInicial());
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600"
                  aria-label="Cerrar formulario"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Fecha</span>
                  <input type="date" value={draft.fecha} onChange={(e) => setDraft({ ...draft, fecha: e.target.value })} className={inp} />
                </label>
                <label className="block sm:col-span-1">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Grupo</span>
                  <select
                    value={draft.grupoSel}
                    onChange={(e) => setDraft({ ...draft, grupoSel: e.target.value })}
                    className={inp}
                  >
                    <option value="">✍️ Otro (no registrado)…</option>
                    {grupos.map((g) => (
                      <option key={String(g.id)} value={String(g.id)}>
                        {g.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.grupoSel === "" ? (
                  <label className="block sm:col-span-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nombre del grupo</span>
                    <input
                      value={draft.grupoLibre}
                      onChange={(e) => setDraft({ ...draft, grupoLibre: e.target.value.toUpperCase() })}
                      placeholder="ej. GRUPO DEL NEGRO"
                      className={inp + " uppercase"}
                    />
                  </label>
                ) : (
                  <div className="hidden sm:block" />
                )}
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Hipódromo</span>
                  <input value={draft.hipodromo} onChange={(e) => setDraft({ ...draft, hipodromo: e.target.value.toUpperCase() })} className={inp + " uppercase"} />
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Carrera</span>
                  <input value={draft.carrera} onChange={(e) => setDraft({ ...draft, carrera: e.target.value })} inputMode="numeric" className={inp} />
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Tipo</span>
                  <input value={draft.tipo} onChange={(e) => setDraft({ ...draft, tipo: e.target.value.toUpperCase() })} placeholder="GANADOR, EXACTA, 5Y6…" className={inp + " uppercase"} />
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Caballo</span>
                  <input value={draft.caballo} onChange={(e) => setDraft({ ...draft, caballo: e.target.value })} className={inp} />
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Monto</span>
                  <input value={draft.monto} onChange={(e) => setDraft({ ...draft, monto: e.target.value })} inputMode="decimal" className={inp + " font-mono text-right"} />
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Estado</span>
                  <select value={draft.estado} onChange={(e) => setDraft({ ...draft, estado: e.target.value as CuadernoEstado })} className={inp}>
                    {ESTADOS_CUADERNO.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Premio</span>
                  <input
                    value={draft.premio}
                    onChange={(e) => setDraft({ ...draft, premio: e.target.value })}
                    inputMode="decimal"
                    disabled={draft.estado !== "Ganada"}
                    className={inp + " font-mono text-right disabled:bg-slate-100 disabled:text-slate-400"}
                  />
                </label>
                <label className="col-span-2 block sm:col-span-3">
                  <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nota</span>
                  <input value={draft.nota} onChange={(e) => setDraft({ ...draft, nota: e.target.value })} className={inp} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormAbierto(false);
                    setDraft(draftInicial());
                  }}
                >
                  Cancelar
                </Button>
                <Guard permiso="clientes:fn_guardar_cliente" disabled>
                  <Button variant="success" size="sm" disabled={guardando} onClick={() => void guardar()}>
                    <span className="mr-1">💾</span> {guardando ? "Guardando…" : draft.id ? "Actualizar" : "Agregar"}
                  </Button>
                </Guard>
              </div>
            </div>
          ) : null}

          {/* Balance por grupo y por semana */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white shadow-sm">
              <div className="border-b border-line px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                Balance por grupo
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Grupo</th>
                    <th className={th + " text-right"}>Jugado</th>
                    <th className={th + " text-right"}>Neto</th>
                    <th className={th + " text-right"}>Pend.</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.porGrupo.map((g) => (
                    <tr key={g.grupo} className="border-b border-line/70 last:border-0">
                      <td className={td + " font-bold text-slate-700"}>
                        {g.grupo}
                        {!grupos.some((x) => String(x.nombre).toUpperCase() === g.grupo.toUpperCase()) ? (
                          <span className="ml-1 text-[9px] text-slate-400" title="Grupo no registrado en el sistema">
                            ✍️
                          </span>
                        ) : null}
                      </td>
                      <td className={td + " text-right font-mono tabular-nums text-slate-700"}>{formatoMoneda("USD", g.apostado)}</td>
                      <td className={td + " text-right font-mono font-black tabular-nums " + claseNeto(g.neto)}>{formatoMoneda("USD", g.neto)}</td>
                      <td className={td + " text-right font-mono tabular-nums text-amber-700"}>{formatoMoneda("USD", g.pendiente)}</td>
                    </tr>
                  ))}
                  {resumen.porGrupo.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                        Sin grupos todavía.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-line bg-white shadow-sm">
              <div className="border-b border-line px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">
                Balance por semana (lunes a domingo)
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className={th}>Semana</th>
                    <th className={th + " text-right"}>Jugado</th>
                    <th className={th + " text-right"}>Neto</th>
                    <th className={th + " text-right"}>Pend.</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.porSemana.map((s) => (
                    <tr key={s.inicio} className="border-b border-line/70 last:border-0">
                      <td className={td + " font-mono text-slate-700"}>{etiquetaSemana(s.inicio)}</td>
                      <td className={td + " text-right font-mono tabular-nums text-slate-700"}>{formatoMoneda("USD", s.apostado)}</td>
                      <td className={td + " text-right font-mono font-black tabular-nums " + claseNeto(s.neto)}>{formatoMoneda("USD", s.neto)}</td>
                      <td className={td + " text-right font-mono tabular-nums text-amber-700"}>{formatoMoneda("USD", s.pendiente)}</td>
                    </tr>
                  ))}
                  {resumen.porSemana.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                        Sin semanas todavía.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {/* Apuntes */}
          <div className="max-h-[calc(100vh-30rem)] min-h-40 overflow-auto rounded-2xl border border-line bg-white shadow-sm">
            <table className="w-full text-[11px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={th + " w-24"}>Fecha</th>
                  <th className={th}>Grupo</th>
                  <th className={th}>Hipódromo / Carrera</th>
                  <th className={th}>Tipo / Caballo</th>
                  <th className={th + " text-right"}>Monto</th>
                  <th className={th + " text-center"}>Estado</th>
                  <th className={th + " text-right"}>Premio</th>
                  <th className={th + " text-right"}>Neto</th>
                  <th className={th + " w-16 text-center"}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const monto = num(f.monto);
                  const premio = num(f.premio);
                  const neto = f.estado === "Ganada" ? premio - monto : f.estado === "Reembolsada" ? 0 : -monto;
                  return (
                    <tr key={String(f.id)} className="border-b border-line/70 last:border-0 hover:bg-primary-50/40">
                      <td className={td + " font-mono text-slate-700"}>{String(f.fecha).slice(0, 10)}</td>
                      <td className={td + " font-bold text-slate-700"}>{f.grupo_nombre}</td>
                      <td className={td}>
                        <span className="text-slate-700">{f.hipodromo || "—"}</span>
                        {f.carrera ? <span className="ml-1 text-slate-400">C{f.carrera}</span> : null}
                      </td>
                      <td className={td}>
                        <span className="text-slate-700">{f.tipo || "JUGADA"}</span>
                        {f.caballo ? <span className="ml-1 text-slate-400">{f.caballo}</span> : null}
                      </td>
                      <td className={td + " text-right font-mono tabular-nums text-slate-700"}>{formatoMoneda("USD", monto)}</td>
                      <td className={td + " text-center"}>
                        <span className={`inline-block rounded px-1 py-0.5 text-[9px] font-black uppercase leading-none ${COLOR_ESTADO[f.estado] ?? "bg-slate-200 text-slate-600"}`}>
                          {f.estado}
                        </span>
                      </td>
                      <td className={td + " text-right font-mono tabular-nums text-emerald-700"}>{premio ? formatoMoneda("USD", premio) : "—"}</td>
                      <td className={td + " text-right font-mono font-black tabular-nums " + claseNeto(neto)}>{formatoMoneda("USD", neto)}</td>
                      <td className={td + " text-center"}>
                        <div className="flex items-center justify-center gap-0.5">
                          <Guard permiso="clientes:fn_guardar_cliente" disabled>
                            <button
                              type="button"
                              title="Editar apunte"
                              aria-label="Editar apunte"
                              onClick={() => abrirEdicion(f)}
                              className="flex h-6 w-6 items-center justify-center rounded text-[12px] leading-none transition hover:bg-primary-100"
                            >
                              ✏️
                            </button>
                          </Guard>
                          <Guard permiso="clientes:fn_guardar_cliente" disabled>
                            <button
                              type="button"
                              title="Borrar apunte"
                              aria-label="Borrar apunte"
                              onClick={() => void borrar(f)}
                              className="flex h-6 w-6 items-center justify-center rounded text-[12px] leading-none transition hover:bg-danger-100"
                            >
                              🗑️
                            </button>
                          </Guard>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {cargando ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                      <span className="mr-2">⏳</span>Cargando cuaderno…
                    </td>
                  </tr>
                ) : filas.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                      <span className="mr-2">📒</span>Sin apuntes. Use «Nueva jugada» para agregar el primero.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="text-[10px] text-slate-400">
            El Cuaderno es un libro manual: <b>no crea tickets ni mueve saldos</b>. Se registra aparte y se cuadra a mano.
            Los grupos con <span className="text-slate-500">✍️</span> no están registrados en el sistema.
          </p>
        </>
      )}
    </div>
  );
}
