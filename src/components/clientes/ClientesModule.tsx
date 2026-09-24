"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { ModalEditarCliente } from "@/components/clientes/ModalEditarCliente";
import { ModalPortalCliente } from "@/components/clientes/ModalPortalCliente";
import { DatosPagoForm } from "@/components/clientes/DatosPagoForm";
import { EstadoCuentaAcordeon } from "@/components/clientes/EstadoCuentaAcordeon";
import { NotificacionesPortal } from "@/components/clientes/NotificacionesPortal";
import {
  aplicarDevolucionMasiva,
  cargarTicketsCliente,
  convertirSocio,
  crearCliente,
  eliminarCliente,
  listarClientes,
  type ClienteRow,
} from "@/lib/clientes";
import {
  codigosPaisUnicos,
  componerTelefono,
  desglosarTelefono,
  esBancoVzla,
  formatoMoneda,
  resumenDatosPago,
  listMetodosPago,
  type DatosPago,
} from "@/lib/vzla";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const modoOpts = [
  { value: "aval", label: "Con Aval" },
  { value: "libre", label: "Libre" },
  { value: "pozo", label: "Pozo" },
];

type Tab = "cartera" | "estado" | "notificaciones";

/**
 * ClientesModule — Gestión de Clientes (clon de js/clientes.js, tarea 5).
 * Pestañas:
 *  - Cartera   : tabla paginada + búsqueda + registro + edición + portal + devoluciones masivas.
 *  - Estado    : estado de cuenta dinámico jerárquico (acordeón).
 *  - Notificaciones: solicitudes de datos del portal + reclamos de jugadas.
 */
export function ClientesModule() {
  const [tab, setTab] = useState<Tab>("cartera");
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [cargando, setCargando] = useState(true);

  const [filtro, setFiltro] = useState("");
  const [soloSocios, setSoloSocios] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(10);

  const [abrirNuevo, setAbrirNuevo] = useState(false);
  const [editando, setEditando] = useState<ClienteRow | null>(null);
  const [portalDe, setPortalDe] = useState<ClienteRow | null>(null);
  const [borrando, setBorrando] = useState<ClienteRow | null>(null);

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [abrirDev, setAbrirDev] = useState(false);
  const [pctDev, setPctDev] = useState("");
  const [afectados, setAfectados] = useState(0);

  const [clienteEstado, setClienteEstado] = useState<ClienteRow | null>(null);
  const [socioConvertir, setSocioConvertir] = useState("");

  const recargar = async () => {
    setCargando(true);
    const cs = await listarClientes(true);
    setClientes(cs);
    setCargando(false);
  };

  useEffect(() => {
    void recargar();
  }, []);

  const visibles = useMemo(() => {
    let v = clientes;
    if (soloSocios) v = v.filter((c) => c.es_socio === true);
    const f = filtro.trim().toLowerCase();
    if (f) {
      v = v.filter((c) =>
        [c.nombre, c.seudonimo, c.apellido, c.telefono, c.email, c.cedula_rif]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(f))
      );
    }
    return v;
  }, [clientes, filtro, soloSocios]);

  const totalPaginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const paginado = useMemo(() => {
    const ini = (pagina - 1) * porPagina;
    return visibles.slice(ini, ini + porPagina);
  }, [visibles, pagina, porPagina]);

  const toggleSel = (id: string | number) => {
    setSeleccion((s) => {
      const n = new Set(s);
      const k = String(id);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const confirmarEliminar = async (c: ClienteRow) => {
    const r = await eliminarCliente(c.id);
    if (!r.ok) return toast(r.error ?? "Error al eliminar.", "error");
    toast(`Cliente "${c.nombre}" eliminado.`, "success");
    setBorrando(null);
    setSeleccion(new Set());
    void recargar();
  };

  const aplicarMasiva = async () => {
    const pct = num(pctDev);
    if (seleccion.size === 0) return toast("Seleccione al menos un cliente.", "warning");
    const r = await aplicarDevolucionMasiva([...seleccion], pct);
    if (!r.ok) return toast(r.error ?? "Error al aplicar devoluciones.", "error");
    toast(`Devolución ${pct}% aplicada a ${seleccion.size} cliente(s).`, "success");
    setAbrirDev(false);
    setSeleccion(new Set());
    void recargar();
  };

  const socioAplicar = async () => {
    const nom = socioConvertir.trim().toUpperCase();
    if (!nom) return toast("Indique el nombre del socio.", "warning");
    const r = await convertirSocio(nom);
    if (!r.ok) return toast(r.error ?? "Error al convertir.", "error");
    toast(`"${nom}" ahora es socio.`, "success");
    setSocioConvertir("");
    void recargar();
  };

  const td = "px-3 py-2 align-middle";
  const th = "px-3 py-2 text-left text-[9px] font-black uppercase tracking-wider text-slate-500";

  return (
    <div className="space-y-4">
      {/* Encabezado + pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black text-slate-800">
          <i className="fas fa-users mr-2 text-primary-600"></i> Gestión de Clientes
        </h1>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => setAbrirNuevo(true)}>
            <i className="fas fa-plus"></i> Nuevo Cliente
          </Button>
          <Button variant="outline" size="sm" onClick={() => (seleccion.size ? setAbrirDev(true) : toast("Seleccione clientes en la tabla.", "warning"))}>
            <i className="fas fa-percent"></i> Devoluciones Masivas
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {(
          [
            ["cartera", "Cartera"],
            ["estado", "Estado de Cuenta"],
            ["notificaciones", "Notificaciones del Portal"],
          ] as [Tab, string][]
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              tab === k ? "bg-primary-600 text-white shadow" : "text-slate-600 hover:bg-white"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "cartera" ? (
        <>
          {/* Barra de búsqueda / filtros */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                value={filtro}
                onChange={(e) => {
                  setFiltro(e.target.value);
                  setPagina(1);
                }}
                placeholder="Buscar por nombre, teléfono, email o cédula…"
                className="w-72 border border-line rounded-lg py-2 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-bold text-slate-600">
              <input type="checkbox" checked={soloSocios} onChange={(e) => setSoloSocios(e.target.checked)} className="h-4 w-4 accent-primary-600" />
              Solo socios
            </label>
            <div className="ml-auto flex gap-2 items-center">
              <input
                value={socioConvertir}
                onChange={(e) => setSocioConvertir(e.target.value.toUpperCase())}
                placeholder="Convertir en socio…"
                className="w-48 border border-line rounded-lg px-3 py-2 text-xs uppercase outline-none focus:ring-1 focus:ring-primary-500 bg-surface"
              />
              <Button variant="success" size="sm" onClick={socioAplicar}>
                <i className="fas fa-crown"></i> Socio
              </Button>
            </div>
          </div>

          {/* Tabla */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
            <table className="w-full text-xs table-fixed">
              <thead className="bg-slate-50 border-b border-line">
                <tr>
                  <th className={th + " w-8"}>
                    <input
                      type="checkbox"
                      className="accent-primary-600"
                      onChange={(e) => {
                        const n = new Set<string>();
                        if (e.target.checked) paginado.forEach((c) => n.add(String(c.id)));
                        setSeleccion(n);
                      }}
                      checked={paginado.length > 0 && paginado.every((c) => seleccion.has(String(c.id)))}
                    />
                  </th>
                  <th className={th}>Cliente</th>
                  <th className={th}>Contacto</th>
                  <th className={th}>Modo / Aval</th>
                  <th className={th}>Tasa / % Dev.</th>
                  <th className={th}>Pago</th>
                  <th className={th + " w-52"}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginado.map((c) => (
                  <tr key={String(c.id)} className="border-b border-line last:border-0 hover:bg-slate-50">
                    <td className={td}>
                      <input
                        type="checkbox"
                        className="accent-primary-600"
                        checked={seleccion.has(String(c.id))}
                        onChange={() => toggleSel(c.id)}
                      />
                    </td>
                    <td className={td}>
                      <div className="font-bold text-slate-800 truncate">{c.nombre || c.seudonimo || "—"}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
                        {c.es_socio ? <span className="text-amber-600">
                          <i className="fas fa-crown"></i> Socio
                        </span> : null}
                        {c.grupo_id ? <span className="text-indigo-500">· Grupo</span> : null}
                        {c.modo_juego ? <span>· {c.modo_juego}</span> : null}
                      </div>
                    </td>
                    <td className={td}>
                      {c.telefono ? <div className="font-mono">{c.telefono}</div> : null}
                      {c.email ? <div className="text-[10px] text-slate-500 truncate">{c.email}</div> : null}
                      {c.cedula_rif ? <div className="text-[10px] text-slate-500">{c.cedula_rif}</div> : null}
                    </td>
                    <td className={td}>
                      <span className="font-bold text-slate-700">{formatoMoneda("USD", num(c.aval))}</span>
                      <span className="text-[10px] text-slate-400 block">{c.libre ? "Libre" : "Con Aval"}</span>
                    </td>
                    <td className={td}>
                      {num(c.tasa_cuadre) ? (
                        <div className="font-mono text-right">Bs {String(c.tasa_cuadre)}</div>
                      ) : null}
                      <div className="text-[10px] font-black text-purple-600 text-right">{num(c.devolucion) ? `${num(c.devolucion)}%` : "—"}</div>
                    </td>
                    <td className={td}>
                      <span className="font-bold text-slate-700 truncate block">{c.metodo_pago || "—"}</span>
                      <span className="text-[10px] text-slate-500">{resumenDatosPago(c.datos_pago) || ""}</span>
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" title="Editar" onClick={() => setEditando(c)}>
                          <i className="fas fa-user-edit"></i>
                        </Button>
                        <Button variant="outline" size="sm" title="Portal de consulta" onClick={() => setPortalDe(c)}>
                          <i className="fas fa-link text-cyan-600"></i>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Estado de cuenta"
                          onClick={() => {
                            setClienteEstado(c);
                            setTab("estado");
                          }}
                        >
                          <i className="fas fa-list-alt text-indigo-600"></i>
                        </Button>
                        <Button variant="ghost" size="sm" title="Eliminar" onClick={() => setBorrando(c)}>
                          <i className="fas fa-trash text-danger-600"></i>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginado.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                      {cargando ? <i className="fas fa-spinner fa-spin mr-2"></i> : <i className="fas fa-inbox mr-2"></i>}
                      {cargando ? "Cargando cartera…" : "Sin clientes que coincidan."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {visibles.length} cliente(s) · {seleccion.size} seleccionado(s)
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                <i className="fas fa-chevron-left"></i>
              </Button>
              <span className="font-bold text-slate-700">
                {pagina} / {totalPaginas}
              </span>
              <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                <i className="fas fa-chevron-right"></i>
              </Button>
            </div>
          </div>
        </>
      ) : tab === "estado" ? (
        <EstadoCuentaAcordeon
          clientes={clientes}
          clienteEstado={clienteEstado}
          onCargarTickets={cargarTicketsCliente}
          onActivo={(c) => setClienteEstado(c)}
        />
      ) : (
        <NotificacionesPortal />
      )}

      {/* Modales */}
      {abrirNuevo ? <ModalNuevoCliente onClose={() => setAbrirNuevo(false)} onGuardado={() => void recargar()} /> : null}
      {editando ? <ModalEditarCliente cliente={editando} onClose={() => setEditando(null)} onGuardado={() => void recargar()} /> : null}
      {portalDe ? <ModalPortalCliente cliente={portalDe} onClose={() => setPortalDe(null)} onGuardado={() => void recargar()} /> : null}

      {/* Confirmar eliminación */}
      {borrando ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBorrando(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-800">
              <i className="fas fa-triangle-exclamation mr-2 text-danger-600"></i> Eliminar cliente
            </h3>
            <p className="text-xs text-slate-600">
              ¿Seguro que deseas eliminar a <b>{borrando.nombre}</b>? Esta acción no puede deshacerse.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setBorrando(null)}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={() => void confirmarEliminar(borrando)}>
                <i className="fas fa-trash mr-1"></i> Eliminar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Devoluciones masivas */}
      {abrirDev ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAbrirDev(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-black text-slate-800">
              <i className="fas fa-percent mr-2 text-primary-600"></i> Devoluciones masivas
            </h3>
            <p className="text-xs text-slate-600">
              Aplicar el mismo porcentaje de <b>Devolución / Incentivo</b> a los <b>{seleccion.size}</b> cliente(s) seleccionados.
            </p>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
              Porcentaje (%) actual: {afectados || 0}
            </label>
            <input
              autoFocus
              value={pctDev}
              onChange={(e) => {
                setPctDev(e.target.value);
                setAfectados(num(e.target.value));
              }}
              inputMode="decimal"
              placeholder="ej. 10"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono font-black text-right outline-none focus:ring-1 focus:ring-primary-500"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAbrirDev(false)}>
                Cancelar
              </Button>
              <Button variant="default" size="sm" onClick={() => void aplicarMasiva()}>
                <i className="fas fa-check mr-1"></i> Aplicar {num(pctDev)}%
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastHost />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal "Nuevo Cliente" (registro rápido, clon del legacy)
// ---------------------------------------------------------------------------

function ModalNuevoCliente({ onClose, onGuardado }: { onClose: () => void; onGuardado: () => void }) {
  const [seudonimo, setSeudonimo] = useState("");
  const [nombres, setNombres] = useState("");
  const [apellido, setApellido] = useState("");
  const [codigoPais, setCodigoPais] = useState("+58");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [cedulaRif, setCedulaRif] = useState("");
  const [modo, setModo] = useState("aval");
  const [devolucion, setDevolucion] = useState("");
  const [metodo, setMetodo] = useState("");
  const [datosPago, setDatosPago] = useState<Record<string, unknown>>({});
  const [esSocio, setEsSocio] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (!seudonimo.trim()) return toast("El seudónimo es obligatorio.", "warning");
    const nombre = [nombres, apellido].filter(Boolean).join(" ").toUpperCase() || seudonimo.toUpperCase();
    setGuardando(true);
    const r = await crearCliente({
      nombre,
      seudonimo: seudonimo.toUpperCase(),
      apellido: apellido || null,
      modo_juego: modo,
      libre: modo === "libre",
      es_socio: esSocio || null,
      telefono: componerTelefono(codigoPais, telefono) || null,
      codigo_pais: codigoPais,
      email: email.trim() || null,
      cedula_rif: cedulaRif.trim().toUpperCase() || null,
      devolucion: num(devolucion),
      metodo_pago: metodo || null,
      datos_pago: !metodo || !Object.keys(datosPago).length ? null : (datosPago as unknown as DatosPago),
    });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? "Error al crear.", "error");
    toast(`Cliente "${nombre}" creado.`, "success");
    onGuardado();
    onClose();
  };

  const inpTxt = "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white flex items-center justify-between">
          <span>
            <i className="fas fa-user-plus mr-2"></i> Nuevo Cliente
          </span>
          <button className="text-slate-300 hover:text-white" onClick={onClose} aria-label="Cerrar">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Seudónimo *</label>
              <input value={seudonimo} onChange={(e) => setSeudonimo(e.target.value.toUpperCase())} className={inpTxt + " font-black uppercase"} autoFocus />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Nombres</label>
              <input value={nombres} onChange={(e) => setNombres(e.target.value.toUpperCase())} className={inpTxt + " uppercase"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Apellido</label>
              <input value={apellido} onChange={(e) => setApellido(e.target.value.toUpperCase())} className={inpTxt + " uppercase"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Código de país</label>
              <select value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} className={inpTxt + " font-bold"}>
                {codigosPaisUnicos().map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} {p.pais}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Teléfono</label>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inpTxt + " font-mono"} placeholder="412 123 4567" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inpTxt} type="email" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Cédula / RIF</label>
              <input value={cedulaRif} onChange={(e) => setCedulaRif(e.target.value.toUpperCase())} className={inpTxt + " font-mono uppercase"} placeholder="V-12.345.678" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Modo de juego</label>
              <select value={modo} onChange={(e) => setModo(e.target.value)} className={inpTxt + " font-bold"}>
                {modoOpts.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Devolución / Incentivo %</label>
              <input value={devolucion} onChange={(e) => setDevolucion(e.target.value)} className={inpTxt + " font-mono font-bold text-right text-purple-700"} inputMode="decimal" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-1">
                <input type="checkbox" checked={esSocio} onChange={(e) => setEsSocio(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                <span className="text-[10px] font-black uppercase text-amber-600">
                  <i className="fas fa-crown mr-1"></i>Es socio
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Método de pago</label>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inpTxt + " font-bold"}>
              <option value="">— Seleccione —</option>
              {listMetodosPago(true).map((m) => (
                <option key={m} value={m}>
                  {esBancoVzla(m) ? m : m}
                </option>
              ))}
            </select>
          </div>

          {metodo ? <DatosPagoForm prefijo="nuevo" metodo={metodo} onChange={(dp) => setDatosPago(dp as unknown as Record<string, unknown>)} /> : null}
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-line flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Crear
          </Button>
        </div>
      </div>
    </div>
  );
}