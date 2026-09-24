"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { BANCOS_VZLA, formatearCuenta } from "@/lib/vzla";
import {
  actualizarGrupo,
  agregarClientesGrupo,
  asignarPrincipalUnico,
  crearGrupo,
  eliminarGrupoRpc,
  guardarConveniosGrupo,
  listarClientesLigeros,
  listarConveniosGrupo,
  listarGruposAdmin,
  listarMembresias,
  listarTiposJugadas,
  quitarClientesGrupo,
  toggleGrupoActivo,
  type ClienteLigero,
  type ConvenioRow,
  type GrupoRow,
  type MembresiaClienteGrupo,
  type TipoJugadaRow,
} from "@/lib/grupos";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: string | number | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isNaN(n) ? 0 : n;
};

const strNum = (v: string | number | null | undefined): string => {
  const n = num(v);
  return n ? String(n) : "";
};

// "0102 · BANCO DE VENEZUELA / N° 1234" -> { banco, numero }
function desglosarCuenta(cuenta: string | null | undefined): { banco: string; numero: string } {
  const t = String(cuenta ?? "").trim();
  if (!t) return { banco: "", numero: "" };
  const idx = t.indexOf("N°");
  const numero = idx === -1 ? "" : formatearCuenta(t.slice(idx + 2));
  const banco = idx === -1 ? t : t.slice(0, idx).replace(/\s*\/?\s*$/, "");
  return { banco, numero };
}

function componerCuenta(banco: string, numero: string): string | null {
  const b = String(banco ?? "").trim();
  const n = formatearCuenta(numero);
  if (!b) return null;
  return n ? `${b} / N° ${n}` : b;
}

const DETALLE_TIPO = (nombre: string): string => {
  const n = String(nombre || "").toUpperCase();
  if (/TABLA/.test(n)) return "comisión por tablas fijas";
  if (/WIN|GANADOR|GANANCIA/.test(n)) return "win · ganador";
  if (/PLACE|LUGAR/.test(n)) return "place · 1.º/2.º";
  if (/SHOW|MOSTRAR/.test(n)) return "show · 1.º/2.º/3.º";
  if (/PUESTOS|EXACTA|PERFECTA/.test(n)) return "puestos · exacta";
  if (/MARCAS|TRIFECTA/.test(n)) return "marcas · trifecta";
  return "comisión por ticket";
};

type FilasConvenioEditable = {
  tipo_jugada_id: string | number;
  comision: string;
  comision_base: string;
  permite_cruces: boolean;
};

/**
 * GruposModule — Grupos de Venta y Convenios (clon 1:1 de js/grupos.js).
 *  - Crear / listar / editar / activar / eliminar grupos (grupos_venta).
 *  - Clientes por grupo: grupo_id principal + pertenencias adicionales
 *    en clientes_grupos (un cliente puede estar en VARIOS grupos).
 *  - Convenios por tipo de jugada y grupo (convenio_tipo_grupo).
 */
export function GruposModule() {
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [clientes, setClientes] = useState<ClienteLigero[]>([]);
  const [membresias, setMembresias] = useState<MembresiaClienteGrupo[]>([]);
  const [tipos, setTipos] = useState<TipoJugadaRow[]>([]);
  const [cargando, setCargando] = useState(true);

  const [filtro, setFiltro] = useState("");
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [grupoConvenio, setGrupoConvenio] = useState("");
  const [convenios, setConvenios] = useState<FilasConvenioEditable[]>([]);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const [editando, setEditando] = useState<GrupoRow | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [formNombre, setFormNombre] = useState("");
  const [formMoneda, setFormMoneda] = useState("USD");
  const [formMonedaCuadre, setFormMonedaCuadre] = useState("USD");
  const [formCupo, setFormCupo] = useState("100");
  const [formComision, setFormComision] = useState("2.5");
  const [formResponsable, setFormResponsable] = useState("");
  const [formBanco, setFormBanco] = useState("");
  const [formNumeroCuenta, setFormNumeroCuenta] = useState("");
  const [formPrincipal, setFormPrincipal] = useState(false);

  const recargar = useCallback(async () => {
    setCargando(true);
    const [gs, cs, ms, ts] = await Promise.all([
      listarGruposAdmin(true),
      listarClientesLigeros(true),
      listarMembresias(true),
      listarTiposJugadas(),
    ]);
    setGrupos(gs);
    setClientes(cs);
    setMembresias(ms);
    setTipos(ts);
    setCargando(false);
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const miembrosDe = useCallback(
    (grupoId: string): (ClienteLigero & { adicional: boolean })[] => {
      const principales = clientes.filter((c) => String(c.grupo_id) === String(grupoId));
      const extraIds = new Set(
        (membresias.filter((m) => String(m.grupo_id) === String(grupoId)) || [])
          .map((m) => String(m.cliente_id))
          .filter((id) => !principales.some((p) => String(p.id) === id))
      );
      const vistos = new Set<string>();
      const out: (ClienteLigero & { adicional: boolean })[] = [];
      for (const c of principales) {
        if (vistos.has(String(c.id))) continue;
        vistos.add(String(c.id));
        out.push({ ...c, adicional: false });
      }
      for (const c of clientes) {
        if (extraIds.has(String(c.id)) && !vistos.has(String(c.id))) {
          vistos.add(String(c.id));
          out.push({ ...c, adicional: true });
        }
      }
      return out;
    },
    [clientes, membresias]
  );

  const listaMiembros = useMemo(() => (origen ? miembrosDe(origen) : []), [origen, miembrosDe]);

  const conteoPorGrupo = useMemo(() => {
    const mapa = new Map<string, number>();
    const contadores = new Map<string, number>();
    for (const g of grupos) contadores.set(String(g.id), 0);
    for (const c of clientes) {
      if (c.grupo_id != null) contadores.set(String(c.grupo_id), (contadores.get(String(c.grupo_id)) ?? 0) + 1);
    }
    for (const m of membresias) {
      const id = String(m.grupo_id);
      const esPrincipal = clientes.some((c) => String(c.id) === String(m.cliente_id) && String(c.grupo_id) === id);
      if (!esPrincipal) contadores.set(id, (contadores.get(id) ?? 0) + 1);
    }
    return contadores;
  }, [clientes, membresias, grupos]);

  const visiblesGrupos = useMemo(() => {
    const f = filtro.trim().toUpperCase();
    return grupos.filter((g) => !f || g.nombre.toUpperCase().includes(f));
  }, [grupos, filtro]);

  const gruposActivos = useMemo(() => grupos.filter((g) => g.activo !== false), [grupos]);

  const guardarNuevo = async () => {
    const nombre = formNombre.trim().toUpperCase();
    if (!nombre) return toast("Indique el nombre del grupo.", "warning");
    setGuardando(true);
    const cuenta = componerCuenta(formBanco, formNumeroCuenta);
    const r = await crearGrupo({
      nombre,
      moneda: formMoneda,
      moneda_cuadre: formMonedaCuadre,
      cupo_tabla: parseInt(formCupo) || 100,
      comision_default: num(formComision) || 2.5,
      responsable: formResponsable.trim().toUpperCase() || null,
      cuenta_bancaria: cuenta,
      es_principal: formPrincipal,
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al crear el grupo.", "error");
    toast(`Grupo "${nombre}" creado.`, "success");
    setFormNombre("");
    setFormResponsable("");
    setFormNumeroCuenta("");
    setFormBanco("");
    setFormPrincipal(false);
    void recargar();
  };

  const toggleGrupo = async (g: GrupoRow) => {
    const nuevo = g.activo !== true;
    const r = await toggleGrupoActivo(g.id, nuevo);
    if (!r.ok) return toast(r.error ?? "Error al cambiar estado.", "error");
    toast(`Grupo "${g.nombre}" ${nuevo ? "activo" : "desactivado"}.`, nuevo ? "success" : "warning");
    void recargar();
  };

  const eliminarGrupo = async (g: GrupoRow) => {
    if (!confirm(`Eliminar el grupo "${g.nombre}"?\nSus clientes pasarán al grupo PRINCIPAL.`)) return;
    const r = await eliminarGrupoRpc(g.id);
    if (!r.ok) return toast(r.error ?? "Error al eliminar.", "error");
    toast(`Grupo "${g.nombre}" eliminado.`, "success");
    void recargar();
  };

  const guardarEdicion = async () => {
    if (!editando) return;
    const { id } = editando;
    const nombre = editando.nombre.trim().toUpperCase();
    if (!nombre) return toast("Indique el nombre del grupo.", "warning");
    const datos = {
      nombre,
      moneda: editando.moneda ?? "USD",
      moneda_cuadre: editando.moneda_cuadre ?? "USD",
      cupo_tabla: parseInt(editando.cupo_tabla?.toString() ?? "100") || 100,
      comision_default: num(editando.comision_default),
      responsable: String(editando.responsable ?? "").trim().toUpperCase() || null,
      cuenta_bancaria: editando.cuenta_bancaria || null,
      es_principal: editando.es_principal === true,
    };
    setGuardando(true);
    const r = await actualizarGrupo(id, datos as Record<string, unknown>);
    if (r.ok && datos.es_principal) {
      await asignarPrincipalUnico(id);
    }
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al guardar.", "error");
    toast(`Grupo "${nombre}" actualizado.`, "success");
    setEditando(null);
    void recargar();
  };

  const agregarSeleccionados = async () => {
    if (!destino) return toast("Seleccione el grupo destino.", "warning");
    const ids = [...seleccion];
    if (!ids.length) return toast("Marque al menos un cliente.", "warning");
    const r = await agregarClientesGrupo(ids, destino);
    if (!r.ok) return toast(r.error ?? "Error al agregar clientes.", "error");
    const nombreDestino = grupos.find((g) => String(g.id) === String(destino))?.nombre ?? destino;
    if (r.agregados === 0) return toast("Los marcados ya pertenecen al grupo destino.", "warning");
    toast(`Clientes agregados como pertenencia adicional al grupo "${nombreDestino}".`, "success");
    setSeleccion(new Set());
    void recargar();
  };

  const agregarTodos = async () => {
    if (!destino) return toast("Seleccione el grupo destino.", "warning");
    if (!listaMiembros.length) return toast("El grupo origen no tiene clientes.", "warning");
    const ids = listaMiembros.map((c) => c.id);
    const r = await agregarClientesGrupo(ids, destino);
    if (!r.ok) return toast(r.error ?? "Error al agregar clientes.", "error");
    if (r.agregados === 0) return toast("Todos los clientes ya pertenecen al grupo destino.", "warning");
    toast(`${r.agregados} cliente(s) agregado(s) al grupo destino.`, "success");
    setSeleccion(new Set());
    void recargar();
  };

  const quitarSeleccionados = async () => {
    if (!origen) return toast("Seleccione el grupo origen.", "warning");
    const ids = [...seleccion];
    if (!ids.length) return toast("Marque clientes para quitar.", "warning");
    const soloAdicionales = listaMiembros.filter((m) => m.adicional && seleccion.has(String(m.id))).map((m) => m.id);
    if (!soloAdicionales.length)
      return toast("Los marcados son clientes PRINCIPALES del grupo (no se quitan por aquí).", "warning");
    const r = await quitarClientesGrupo(soloAdicionales, origen);
    if (!r.ok) return toast(r.error ?? "Error al quitar.", "error");
    toast(`${soloAdicionales.length} pertenencia(s) adicional(es) quitada(s).`, "success");
    setSeleccion(new Set());
    void recargar();
  };

  const cargarConvenios = async (grupoId: string) => {
    setGrupoConvenio(grupoId);
    if (!grupoId) {
      setConvenios([]);
      return;
    }
    const cs = await listarConveniosGrupo(grupoId);
    const mapa = new Map<string, ConvenioRow>();
    cs.forEach((c) => mapa.set(String(c.tipo_jugada_id), c));
    const filas = tipos.map((t) => {
      const c = mapa.get(String(t.id));
      return {
        tipo_jugada_id: t.id,
        comision: c != null && c.comision != null ? String(c.comision) : "",
        comision_base: c != null && c.comision_base != null ? String(c.comision_base) : "",
        permite_cruces: c != null ? c.permite_cruces !== false : true,
      };
    });
    setConvenios(filas);
  };

  const guardarConvenios = async () => {
    if (!grupoConvenio) return toast("Seleccione el grupo para guardar sus convenios.", "warning");
    if (!tipos.length) return toast("No hay tipos de jugada activos.", "warning");
    const filas = convenios.map((f) => ({
      tipo_jugada_id: f.tipo_jugada_id,
      comision: num(f.comision) > 0 ? num(f.comision) : null,
      comision_base: num(f.comision_base) > 0 ? num(f.comision_base) : null,
      permite_cruces: f.permite_cruces,
    }));
    const r = await guardarConveniosGrupo(grupoConvenio, filas);
    if (!r.ok) return toast(r.error ?? "Error al guardar convenios.", "error");
    toast(`Convenios guardados (${filas.length} tipo(s) de jugada).`, "success");
  };

  const inp =
    "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";
  const etiqueta = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black text-slate-800">
          <i className="fas fa-layer-group mr-2 text-amber-500"></i> Grupos de Venta y Convenios
        </h1>
        <Button variant="outline" size="sm" onClick={() => void recargar()}>
          <i className="fas fa-sync-alt mr-1"></i> Recargar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------------- Crear / Listar Grupos ---------------- */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-white p-4">
            <h3 className="mb-3 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">
              <i className="fas fa-plus-circle mr-1 text-amber-500"></i> Crear Grupo de Venta
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className={etiqueta}>Nombre del Grupo</label>
                <input
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value.toUpperCase())}
                  placeholder="Ej: SUCURSAL COSTA"
                  className={inp + " font-black uppercase"}
                />
              </div>
              <div>
                <label className={etiqueta}>Moneda de Venta</label>
                <select value={formMoneda} onChange={(e) => setFormMoneda(e.target.value)} className={inp + " font-bold"}>
                  <option value="USD">USD ($)</option>
                  <option value="VES">VES (Bs)</option>
                </select>
              </div>
              <div>
                <label className={etiqueta}>Moneda de Cuadre</label>
                <select value={formMonedaCuadre} onChange={(e) => setFormMonedaCuadre(e.target.value)} className={inp + " font-bold"}>
                  <option value="USD">USD ($)</option>
                  <option value="VES">VES (Bs)</option>
                </select>
              </div>
              <div>
                <label className={etiqueta}>Cupos por Tabla</label>
                <input
                  value={formCupo}
                  onChange={(e) => setFormCupo(e.target.value)}
                  type="number"
                  min={1}
                  className={inp + " font-bold text-center"}
                />
              </div>
              <div className="col-span-3">
                <label className={etiqueta}>
                  Comisión por Tablas Fijas % <span className="text-amber-600">(convenio con el grupo)</span>
                </label>
                <input
                  value={formComision}
                  onChange={(e) => setFormComision(e.target.value)}
                  type="number"
                  step="0.01"
                  min={0}
                  className={inp + " font-bold text-center"}
                />
              </div>
              <div className="col-span-3">
                <label className={etiqueta}>Responsable del Grupo</label>
                <input
                  value={formResponsable}
                  onChange={(e) => setFormResponsable(e.target.value.toUpperCase())}
                  placeholder="Nombre de la persona encargada"
                  className={inp + " uppercase"}
                />
              </div>
              <div className="col-span-3">
                <label className={etiqueta}>Banco para el Cuadre</label>
                <select value={formBanco} onChange={(e) => setFormBanco(e.target.value)} className={inp + " uppercase"}>
                  <option value="">Seleccione el banco...</option>
                  {BANCOS_VZLA.map((b) => (
                    <option key={b.codigo} value={`${b.codigo} · ${b.nombre}`}>
                      {b.codigo} · {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <label className={etiqueta}>
                  Número de Cuenta <span className="normal-case text-slate-400">(opcional)</span>
                </label>
                <input
                  value={formNumeroCuenta}
                  onChange={(e) => setFormNumeroCuenta(formatearCuenta(e.target.value))}
                  placeholder="Ej: 0102 1234567890"
                  maxLength={20}
                  className={inp + " uppercase"}
                />
              </div>
              <label className="col-span-3 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formPrincipal}
                  onChange={(e) => setFormPrincipal(e.target.checked)}
                  className="rounded accent-amber-500"
                />
                Es el grupo Principal (concentra la contabilidad)
              </label>
              <div className="col-span-3">
                <Button variant="default" className="w-full" onClick={() => void guardarNuevo()} disabled={guardando}>
                  {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-plus-circle mr-1"></i>}
                  Crear Grupo y su Convenio
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white p-4">
            <h3 className="mb-2 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">
              <i className="fas fa-list mr-1 text-slate-400"></i> Grupos Registrados
            </h3>
            <div className="mb-2 flex items-center gap-2">
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                type="search"
                placeholder="Buscar grupo..."
                className={inp + " flex-1"}
              />
              <span className="whitespace-nowrap text-[10px] font-black text-slate-500">
                Total: <span className="text-amber-600">{grupos.length}</span> · Activos:{" "}
                <span className="text-emerald-600">{grupos.filter((g) => g.activo !== false).length}</span>
              </span>
            </div>
            <div className="flex max-h-[24rem] flex-col gap-2 overflow-y-auto pr-1">
              {visiblesGrupos.length === 0 ? (
                <p className="text-xs italic text-slate-400">
                  {grupos.length === 0 ? "Sin grupos. Cree el primero." : "Ningún grupo coincide con la búsqueda."}
                </p>
              ) : (
                visiblesGrupos.map((g) => {
                  const esVes = String(g.moneda ?? "").toUpperCase() === "VES";
                  const cuentas = desglosarCuenta(g.cuenta_bancaria);
                  return (
                    <div key={String(g.id)} className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800"> {g.nombre} </span>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[9px] font-black ${esVes ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {g.moneda ?? "USD"}
                        </span>
                        <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-700" title="Moneda de cuadre">
                          Cuadre: {g.moneda_cuadre || g.moneda || "USD"}
                        </span>
                        {g.es_principal ? (
                          <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-black text-white">PRINCIPAL</span>
                        ) : null}
                        <div className="mt-0.5 truncate text-[10px] text-slate-500">
                          {g.responsable ? (
                            <>
                              <i className="fas fa-user-tie mr-0.5 text-slate-400"></i>
                              <b>{g.responsable}</b>
                            </>
                          ) : (
                            <span className="italic">Sin responsable</span>
                          )}
                          {cuentas.numero ? (
                            <>
                              {" "}
                              · <i className="fas fa-university mr-0.5 text-slate-400"></i>
                              {cuentas.numero}
                            </>
                          ) : null}
                        </div>
                        <span className="text-[10px] text-slate-500">
                          Cupos/tabla: <b>{g.cupo_tabla ?? 100}</b> · Convenio Tablas Fijas:{" "}
                          <b className="text-amber-600">{strNum(g.comision_default) || "2.5"}%</b> · Clientes:{" "}
                          <b>{conteoPorGrupo.get(String(g.id)) ?? 0}</b>
                        </span>
                      </div>
                      <button
                        className="rounded px-2 py-1 text-xs font-bold bg-slate-200 text-slate-700 hover:bg-slate-300"
                        onClick={() => setEditando(g)}
                        title="Editar grupo"
                      >
                        <i className="fas fa-edit"></i>
                      </button>
                      <button
                        className={`rounded px-2 py-1 text-xs font-bold ${g.activo !== false ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        onClick={() => void toggleGrupo(g)}
                        title={g.activo !== false ? "Desactivar" : "Activar"}
                      >
                        <i className={`fas ${g.activo !== false ? "fa-toggle-on" : "fa-toggle-off"}`}></i>
                      </button>
                      {g.es_principal ? null : (
                        <button
                          className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                          onClick={() => void eliminarGrupo(g)}
                          title="Eliminar"
                        >
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ---------------- Clientes por Grupo ---------------- */}
        <div className="h-fit rounded-2xl border border-line bg-white p-4">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">
            <i className="fas fa-user-tag mr-1 text-slate-400"></i> Clientes por Grupo (un cliente puede estar en
            VARIOS grupos)
            <p className="mt-1 text-[10px] font-normal normal-case text-slate-400">
              El <b>Grupo Origen</b> muestra los miembros actuales del grupo. Marque clientes y use{" "}
              <b>Agregar al destino</b> (pertenencia adicional) o <b>Quitar del origen</b>.
            </p>
          </h3>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className={etiqueta}>Grupo Origen</label>
              <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={inp + " font-bold"}>
                <option value="">Seleccione...</option>
                {gruposActivos.map((g) => (
                  <option key={String(g.id)} value={String(g.id)}>
                    {g.nombre} ({g.moneda ?? "USD"})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Grupo Destino</label>
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={inp + " font-bold"}>
                <option value="">Seleccione...</option>
                {gruposActivos.map((g) => (
                  <option key={String(g.id)} value={String(g.id)}>
                    {g.nombre} ({g.moneda ?? "USD"})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-600">
            <span>Clientes del grupo origen:</span>
            <span className="text-amber-600">{listaMiembros.length}</span>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-line bg-slate-50 p-2">
            {!origen ? (
              <p className="text-xs italic text-slate-400">Seleccione un grupo origen.</p>
            ) : listaMiembros.length === 0 ? (
              <p className="text-xs italic text-slate-400">No hay clientes en este grupo.</p>
            ) : (
              listaMiembros.map((m) => (
                <label key={String(m.id)} className="flex items-center gap-2 rounded border border-line bg-white px-2 py-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-primary-600"
                    checked={seleccion.has(String(m.id))}
                    onChange={() =>
                      setSeleccion((s) => {
                        const n = new Set(s);
                        const k = String(m.id);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                  />
                  <span className="font-semibold text-slate-700">{m.nombre}</span>
                  {m.adicional ? (
                    <span className="rounded bg-cyan-100 px-1 py-0.5 text-[9px] font-black text-cyan-700">adicional</span>
                  ) : (
                    <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-black text-slate-700">principal</span>
                  )}
                </label>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Button variant="default" size="sm" className="flex-1" onClick={() => void agregarSeleccionados()}>
              <i className="fas fa-arrow-right mr-1"></i> Agregar al destino
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => void agregarTodos()}>
              <i className="fas fa-forward mr-1"></i> Agregar todos
            </Button>
            <Button variant="danger" size="sm" className="flex-1" onClick={() => void quitarSeleccionados()}>
              <i className="fas fa-user-minus mr-1"></i> Quitar del origen
            </Button>
          </div>
        </div>

        {/* ---------------- Convenios por Tipo de Jugada y Grupo ---------------- */}
        <div className="h-fit rounded-2xl border border-line bg-white p-4">
          <h3 className="mb-2 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">
            <i className="fas fa-handshake mr-1 text-amber-500"></i> Convenios por Tipo de Jugada y Grupo
            <p className="mt-1 text-[10px] font-normal normal-case text-slate-400">
              Comisión y condiciones particulares que recibe el grupo según el tipo de jugada. El % de{" "}
              <b>Tablas Fijas</b> usa el valor del grupo; los demás tipos definen su propio convenio.
            </p>
          </h3>
          <div className="mb-2">
            <label className={etiqueta}>Grupo</label>
            <select
              value={grupoConvenio}
              onChange={(e) => void cargarConvenios(e.target.value)}
              className={inp + " font-bold"}
            >
              <option value="">Seleccione un grupo...</option>
              {gruposActivos.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.nombre} ({g.moneda ?? "USD"})
                </option>
              ))}
            </select>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {!grupoConvenio ? (
              <p className="text-xs italic text-slate-400">Seleccione un grupo para ver sus convenios.</p>
            ) : tipos.length === 0 ? (
              <p className="text-xs italic text-slate-400">No hay tipos de jugada activos.</p>
            ) : (
              convenios.map((f) => (
                <div key={String(f.tipo_jugada_id)} className="flex items-center gap-2 rounded-lg border border-line bg-white px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold uppercase text-slate-700">
                      {tipos.find((t) => String(t.id) === String(f.tipo_jugada_id))?.nombre ?? "—"}
                    </span>
                    <span className="block truncate text-[9px] text-slate-400">
                      {DETALLE_TIPO(tipos.find((t) => String(t.id) === String(f.tipo_jugada_id))?.nombre ?? "")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <label className="text-[9px] font-black uppercase text-slate-500">%</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={f.comision}
                      onChange={(e) =>
                        setConvenios((cs) => cs.map((x) => (String(x.tipo_jugada_id) === String(f.tipo_jugada_id) ? { ...x, comision: e.target.value } : x)))
                      }
                      className="w-14 rounded border border-line px-1 py-0.5 text-right text-[11px] font-bold text-amber-700 outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <label className="ml-1 text-[9px] font-black uppercase text-slate-500">Base $</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={f.comision_base}
                      onChange={(e) =>
                        setConvenios((cs) => cs.map((x) => (String(x.tipo_jugada_id) === String(f.tipo_jugada_id) ? { ...x, comision_base: e.target.value } : x)))
                      }
                      className="w-14 rounded border border-line px-1 py-0.5 text-right text-[11px] font-bold text-slate-700 outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <label className="ml-1 flex cursor-pointer items-center gap-1" title="Permite cruces / combinaciones en este tipo">
                      <input
                        type="checkbox"
                        className="rounded accent-primary-600"
                        checked={f.permite_cruces}
                        onChange={(e) =>
                          setConvenios((cs) => cs.map((x) => (String(x.tipo_jugada_id) === String(f.tipo_jugada_id) ? { ...x, permite_cruces: e.target.checked } : x)))
                        }
                      />
                      <span className="text-[9px] font-black uppercase text-slate-500">Cruces</span>
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
          <Button variant="success" className="mt-2 w-full" onClick={() => void guardarConvenios()}>
            <i className="fas fa-save mr-1"></i> Guardar Convenios del Grupo
          </Button>
        </div>
      </div>

      {/* ---------------- Modal Editar Grupo ---------------- */}
      {editando ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditando(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white flex items-center justify-between">
              <span>
                <i className="fas fa-edit mr-2"></i> Editar Grupo y Convenio
              </span>
              <button className="text-slate-300 hover:text-white" onClick={() => setEditando(null)} aria-label="Cerrar">
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div>
                <label className={etiqueta}>Nombre</label>
                <input
                  value={editando.nombre}
                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value.toUpperCase() })}
                  className={inp + " font-black uppercase"}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={etiqueta}>Moneda Venta</label>
                  <select
                    value={editando.moneda ?? "USD"}
                    onChange={(e) => setEditando({ ...editando, moneda: e.target.value })}
                    className={inp + " font-bold"}
                  >
                    <option value="USD">USD</option>
                    <option value="VES">VES</option>
                  </select>
                </div>
                <div>
                  <label className={etiqueta}>Moneda Cuadre</label>
                  <select
                    value={editando.moneda_cuadre ?? "USD"}
                    onChange={(e) => setEditando({ ...editando, moneda_cuadre: e.target.value })}
                    className={inp + " font-bold"}
                  >
                    <option value="USD">USD</option>
                    <option value="VES">VES</option>
                  </select>
                </div>
                <div>
                  <label className={etiqueta}>Cupos/Tabla</label>
                  <input
                    type="number"
                    min={1}
                    value={editando.cupo_tabla ?? 100}
                    onChange={(e) => setEditando({ ...editando, cupo_tabla: parseInt(e.target.value) || 100 })}
                    className={inp + " font-bold text-center"}
                  />
                </div>
              </div>
              <div>
                <label className={etiqueta}>Comisión por Tablas Fijas %</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={strNum(editando.comision_default)}
                  onChange={(e) => setEditando({ ...editando, comision_default: num(e.target.value) })}
                  className={inp + " font-bold text-center"}
                />
              </div>
              <div>
                <label className={etiqueta}>Responsable</label>
                <input
                  value={editando.responsable ?? ""}
                  onChange={(e) => setEditando({ ...editando, responsable: e.target.value.toUpperCase() })}
                  className={inp + " uppercase"}
                />
              </div>
              <div>
                <label className={etiqueta}>Banco (Cuadre)</label>
                <select
                  value={desglosarCuenta(editando.cuenta_bancaria).banco}
                  onChange={(e) =>
                    setEditando({
                      ...editando,
                      cuenta_bancaria: componerCuenta(e.target.value, desglosarCuenta(editando.cuenta_bancaria).numero),
                    })
                  }
                  className={inp + " uppercase"}
                >
                  <option value="">Seleccione el banco...</option>
                  {BANCOS_VZLA.map((b) => (
                    <option key={b.codigo} value={`${b.codigo} · ${b.nombre}`}>
                      {b.codigo} · {b.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={etiqueta}>
                  Número de Cuenta <span className="normal-case text-slate-400">(opcional)</span>
                </label>
                <input
                  value={desglosarCuenta(editando.cuenta_bancaria).numero}
                  onChange={(e) =>
                    setEditando({
                      ...editando,
                      cuenta_bancaria: componerCuenta(
                        desglosarCuenta(editando.cuenta_bancaria).banco,
                        formatearCuenta(e.target.value)
                      ),
                    })
                  }
                  className={inp + " uppercase"}
                  maxLength={20}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={editando.es_principal === true}
                  onChange={(e) => setEditando({ ...editando, es_principal: e.target.checked })}
                  className="rounded accent-amber-500"
                />
                Es el grupo Principal
              </label>
            </div>
            <div className="flex justify-end gap-3 border-t border-line bg-slate-50 p-4">
              <Button variant="outline" size="sm" onClick={() => setEditando(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => void guardarEdicion()} disabled={guardando}>
                {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Guardar
                Grupo
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastHost />
    </div>
  );
}