"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Guard } from "@/shared/components/ui/Guard";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { ModalCliente } from "@/features/clientes/components/ModalCliente";
import { ModalCreacionRapidaCliente } from "@/features/clientes/components/ModalCreacionRapidaCliente";
import { ModalPortalCliente } from "@/features/clientes/components/ModalPortalCliente";
import { EstadoCuentaAcordeon } from "@/features/clientes/components/EstadoCuentaAcordeon";
import { CuadernoCliente } from "@/features/clientes/components/CuadernoCliente";
import { NotificacionesPortal } from "@/features/clientes/components/NotificacionesPortal";
import { PanelBloqueoJugadasAdmin } from "@/features/portal/components/PanelBloqueoJugadasAdmin";
import { ModalPagoAGanadorYConciliacion } from "@/features/contabilidad/components/ModalPagoAGanadorYConciliacion";
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import {
  aplicarDevolucionMasiva,
  cargarTicketsCliente,
  convertirSocio,
  eliminarCliente,
  errorClientes,
  etiquetaModoJuego,
  formasPagoDe,
  limpiarCacheClientes,
  listarClientes,
  resumenFormaPago,
  type ClienteRow,
} from "@/features/clientes/lib/clientes";
import { formatoMoneda } from "@/shared/lib/vzla";
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { useAuthStore } from "@/shared/store/useAuthStore";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Afiliados de un socio/agencia (clientes cuyo socio_asignado coincide con este nombre). */
const afiliadosDe = (c: ClienteRow, lista: ClienteRow[]): number =>
  lista.filter((s) => String(s.socio_asignado || "").toUpperCase() === String(c.nombre || c.seudonimo || "").toUpperCase()).length;

const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"];

type Tab = "cartera" | "estado" | "cuaderno" | "cuadre" | "notificaciones";

/**
 * ClientesModule — Gestión de Clientes (clon de js/clientes.js, tarea 5).
 * Pestañas:
 *  - Cartera   : tabla paginada + búsqueda + registro + edición + portal + devoluciones masivas.
 *  - Estado    : estado de cuenta dinámico jerárquico (acordeón).
 *  - Cuaderno  : libro manual de jugadas del cliente entre varios grupos (ver CuadernoCliente).
 *  - Notificaciones: solicitudes de datos del portal + reclamos de jugadas.
 */
export function ClientesModule() {
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const miGrupoId = useAuthStore((s) => s.grupoId);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const veTodos = useAuthStore((s) => s.veTodosLosGrupos);
  const tipoUsuario = useAuthStore((s) => s.tipoUsuario);
  const perfiles = useAuthStore((s) => s.perfiles);

  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [grupoConsultado, setGrupoConsultado] = useState<string>(() => {
    return grupoActivo || miGrupoId || "";
  });

  const esAdminDeGrupo = useMemo(() => {
    if (esPrincipal) return true;
    const t = (tipoUsuario?.nombre || "").toLowerCase();
    const p = perfiles.join(" ").toLowerCase();
    return (
      t.includes("admin") ||
      t.includes("dueño") ||
      t.includes("dueno") ||
      t.includes("banquero") ||
      p.includes("admin") ||
      p.includes("dueño") ||
      p.includes("dueno") ||
      Boolean(miGrupoId)
    );
  }, [esPrincipal, tipoUsuario, perfiles, miGrupoId]);

  useEffect(() => {
    let activo = true;
    listarGruposVenta().then((gs) => {
      if (!activo) return;
      const validos = gs.filter((g) => g.activo !== false);
      setGrupos(validos);
      if (esPrincipal) {
        if (grupoActivo) {
          setGrupoConsultado(grupoActivo);
        } else if (validos.length > 0) {
          const principal = validos.find((g) => g.es_principal) || validos[0];
          setGrupoConsultado(String(principal.id));
          useAuthStore.getState().setGrupoActivo(String(principal.id));
        }
      } else if (miGrupoId) {
        setGrupoConsultado(miGrupoId);
      }
    });
    return () => {
      activo = false;
    };
  }, [esPrincipal, grupoActivo, miGrupoId]);

  useEffect(() => {
    if (esPrincipal && grupoActivo && grupoActivo !== grupoConsultado) {
      setGrupoConsultado(grupoActivo);
    }
  }, [esPrincipal, grupoActivo, grupoConsultado]);
  const [tab, setTab] = useState<Tab>("cartera");
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [filtro, setFiltro] = useState("");
  const [soloSocios, setSoloSocios] = useState(false);
  const [pagina, setPagina] = useState(1);
  // Filas compactas: 25 entran de una vez en pantalla y el bloque scrollea solo,
  // así se revisa la cartera completa sin paginar cada dos rencuentros.
  const [porPagina, setPorPagina] = useState(25);

  const [abrirNuevo, setAbrirNuevo] = useState(false);
  const [abrirNuevoRapido, setAbrirNuevoRapido] = useState(false);
  const [editando, setEditando] = useState<ClienteRow | null>(null);
  const [portalDe, setPortalDe] = useState<ClienteRow | null>(null);
  const [borrando, setBorrando] = useState<ClienteRow | null>(null);

  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [abrirDev, setAbrirDev] = useState(false);
  const [pctDev, setPctDev] = useState("");
  const [afectados, setAfectados] = useState(0);

  const [clienteEstado, setClienteEstado] = useState<ClienteRow | null>(null);
  const [socioConvertir, setSocioConvertir] = useState("");

  const [modalPagoGanadorAbierto, setModalPagoGanadorAbierto] = useState(false);
  const [clientePagoGanadorId, setClientePagoGanadorId] = useState<string | null>(null);
  const [vistaInicialPagos, setVistaInicialPagos] = useState<"pagar_ganadores" | "conciliacion">("pagar_ganadores");

  const recargar = async (gid?: string) => {
    setCargando(true);
    const target = gid !== undefined ? gid : grupoConsultado;
    const cs = await listarClientes(true, target || null);
    setClientes(cs);
    setErrorCarga(errorClientes());
    setCargando(false);
  };

  useEffect(() => {
    void recargar(grupoConsultado);

    const handleActualizar = () => {
      limpiarCacheClientes();
      void recargar(grupoConsultado);
    };

    window.addEventListener("hipico:saldos-actualizados", handleActualizar);
    window.addEventListener("hipico_tickets_actualizados", handleActualizar);
    window.addEventListener("focus", handleActualizar);

    return () => {
      window.removeEventListener("hipico:saldos-actualizados", handleActualizar);
      window.removeEventListener("hipico_tickets_actualizados", handleActualizar);
      window.removeEventListener("focus", handleActualizar);
    };
  }, [grupoConsultado]);

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

  // Fila compacta: una sola línea de alto (py-1) para que entren muchos
  // jugadores a la vista. Antes cada celda era un bloque de hasta tres líneas
  // (nombre + sub-info, teléfono + email + cédula) y la cartera se "?:" larga.
  const td = "px-2 py-1 align-middle leading-tight";
  const th =
    "sticky top-0 z-10 bg-slate-50 px-2 py-1.5 text-left text-[9px] font-black uppercase leading-tight tracking-wider text-slate-500";

  return (
    <div className="space-y-4">
      {/* Encabezado + pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-black text-slate-800">
            <span className="mr-2 text-primary-600">👥</span> Gestión de Clientes
          </h1>
          {esPrincipal ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs">
              <span className="font-bold text-amber-900">📁 Grupo:</span>
              <select
                value={grupoConsultado}
                onChange={(e) => {
                  const nuevo = e.target.value;
                  setGrupoConsultado(nuevo);
                  useAuthStore.getState().setGrupoActivo(nuevo);
                }}
                className="bg-transparent font-black text-amber-950 outline-none cursor-pointer"
              >
                {grupos.map((g) => (
                  <option key={String(g.id)} value={String(g.id)}>
                    {g.nombre} {g.es_principal ? "★" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
              <span>📁 Mi Grupo:</span>
              <span className="font-black text-slate-900">
                {grupos.find((g) => String(g.id) === String(miGrupoId))?.nombre || "Grupo asignado"}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAbrirNuevoRapido(true)}
            className="!border-indigo-400 !bg-indigo-50 !font-black !text-indigo-800 hover:!bg-indigo-100"
            title="Registrar nuevo cliente rápido con teléfono, código de usuario y saldo autorizado"
          >
            <span>👤+</span> Alta Rápida
          </Button>
          <Guard permiso="clientes:btn_crear" disabled>
            <Button variant="default" size="sm" onClick={() => setAbrirNuevo(true)}>
              <span >➕</span> Nuevo Cliente
            </Button>
          </Guard>
          <Guard permiso="clientes:modal_reclamos" disabled>
            <Button variant="outline" size="sm" onClick={() => (seleccion.size ? setAbrirDev(true) : toast("Seleccione clientes en la tabla.", "warning"))}>
              <span >％</span> Devoluciones Masivas
            </Button>
          </Guard>
        </div>
      </div>

      <PanelBloqueoJugadasAdmin compacto />

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {(
          [
            ["cartera", "Cartera"],
            ["estado", "Estado de Cuenta"],
            ["cuaderno", "📒 Cuaderno"],
            ["cuadre", "Cuadre Semanal"],
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
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
            <Button variant="outline" size="sm" title="Recargar cartera" onClick={() => void recargar()}>
              <span >🔄</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setClientePagoGanadorId(null);
                setVistaInicialPagos("pagar_ganadores");
                setModalPagoGanadorAbierto(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs"
            >
              <span>🏆 Pagar Ganadores</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVistaInicialPagos("conciliacion");
                setModalPagoGanadorAbierto(true);
              }}
              className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 font-bold text-xs"
            >
              <span>🔔 Conciliar Pagos</span>
            </Button>
            <div className="ml-auto flex gap-2 items-center">
              <Guard permiso="clientes:btn_editar" disabled>
                <input
                  value={socioConvertir}
                  onChange={(e) => setSocioConvertir(e.target.value.toUpperCase())}
                  placeholder="Convertir en socio…"
                  className="w-48 border border-line rounded-lg px-3 py-2 text-xs uppercase outline-none focus:ring-1 focus:ring-primary-500 bg-surface"
                />
                <Button variant="success" size="sm" onClick={socioAplicar}>
                  <span >👑</span> Socio
                </Button>
              </Guard>
            </div>
          </div>

          {/* Tabla compacta: una línea por jugador, scrollear dentro del bloque */}
          <div className="max-h-[calc(100vh-19rem)] min-h-64 overflow-auto rounded-2xl border border-line bg-white shadow-sm">
            <table className="w-full table-fixed text-[11px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={th + " w-7"}>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary-600"
                      onChange={(e) => {
                        const n = new Set<string>();
                        if (e.target.checked) paginado.forEach((c) => n.add(String(c.id)));
                        setSeleccion(n);
                      }}
                      checked={paginado.length > 0 && paginado.every((c) => seleccion.has(String(c.id)))}
                      aria-label="Seleccionar la página"
                    />
                  </th>
                  <th className={th + " w-[26%] min-w-[14rem]"}>Jugador</th>
                  <th className={th + " w-[11%]"}>Contacto</th>
                  <th className={th + " w-16 text-center"} title="Modo de juego">Modo</th>
                  <th className={th + " w-24 text-right"} title="Saldo actual en USD">Saldo</th>
                  <th className={th + " w-28 text-right"} title="Monto total ganador o perdedor en carrera con devolución incluida">Resultado</th>
                  <th className={th + " w-20 text-right text-amber-600"} title="Aval / límite de pérdida en USD">Aval</th>
                  <th className={th + " w-14 text-right text-purple-600"} title="Devolución / incentivo %">Dev.</th>
                  <th className={th + " w-24 text-emerald-600"} title="Día y tasa de cuadre">Cuadre</th>
                  <th className={th + " w-24 text-amber-600"} title="Socio asignado">Socio</th>
                  <th className={th + " w-14 text-center"} title="Puerto y saldo visible al socio">Flags</th>
                  <th className={th + " w-[9.5rem] text-center"}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginado.map((c) => (
                  <tr key={String(c.id)} className="border-b border-line/70 last:border-0 hover:bg-primary-50/40">
                    <td className={td}>
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary-600"
                        checked={seleccion.has(String(c.id))}
                        onChange={() => toggleSel(c.id)}
                        aria-label={`Seleccionar ${c.seudonimo || c.nombre}`}
                      />
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1.5">
                        {c.es_socio ? (
                          <span className="shrink-0 text-[9px] text-amber-500" title="Es socio">👑</span>
                        ) : null}
                        <span className="font-bold text-slate-800 break-words leading-snug" title={c.nombre || c.seudonimo || ""}>
                          {c.seudonimo || c.nombre || "—"}
                        </span>
                        {c.grupo_id ? (
                          <span className="shrink-0 text-[9px] text-indigo-400" title="Pertenece a un grupo">🗃️</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="truncate font-mono text-[10px] text-slate-700">{c.telefono || "—"}</div>
                      <div className="truncate text-[10px] leading-tight text-slate-400">
                        {c.email || c.cedula_rif || ""}
                      </div>
                    </td>
                    <td className={td + " text-center"}>
                      <span
                        className={`inline-block rounded px-1 py-0.5 text-[9px] font-black uppercase leading-none ${
                          c.modo_juego === "libre"
                            ? "bg-slate-200 text-slate-600"
                            : c.modo_juego === "pozo"
                              ? "bg-cyan-100 text-cyan-700"
                              : c.modo_juego === "cuadre"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {etiquetaModoJuego(c.modo_juego)}
                      </span>
                    </td>
                    <td className={td + " text-right"}>
                      <span
                        className={`font-mono font-black tabular-nums ${
                          num(c.saldo_actual) > 0
                            ? "text-emerald-700"
                            : num(c.saldo_actual) < 0
                              ? "text-danger-600"
                              : "text-slate-400"
                        }`}
                        title={
                          c.disponible != null
                            ? `Saldo: ${formatoMoneda("USD", num(c.saldo_actual))} | Disponible con aval: ${formatoMoneda("USD", num(c.disponible))}`
                            : undefined
                        }
                      >
                        {formatoMoneda("USD", num(c.saldo_actual))}
                      </span>
                    </td>
                    <td className={td + " text-right"}>
                      {(() => {
                        const resTotal = num(c.resultado ?? c.resultado_acumulado ?? 0);
                        return (
                          <span
                            className={`font-mono font-black tabular-nums ${
                              resTotal > 0
                                ? "text-emerald-700"
                                : resTotal < 0
                                  ? "text-danger-600"
                                  : "text-slate-400"
                            }`}
                            title="Resultado neto de jugadas en carrera con devolución/incentivo incluida"
                          >
                            {resTotal > 0 ? "+" : ""}
                            {formatoMoneda("USD", resTotal)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={td + " text-right"}>
                      <span className="font-mono font-black tabular-nums text-amber-700">
                        {formatoMoneda("USD", num(c.aval))}
                      </span>
                    </td>
                    <td className={td + " text-right"}>
                      <span className="font-mono font-black tabular-nums text-purple-700">
                        {num(c.devolucion) ? `${num(c.devolucion)}%` : "—"}
                      </span>
                    </td>
                    <td className={td}>
                      {c.dia_cuadre ? (
                        <div className="truncate leading-tight">
                          <span className="font-bold text-slate-700">{c.dia_cuadre}</span>
                          {num(c.tasa_cuadre) ? (
                            <span className="ml-1 font-mono text-[10px] text-slate-500">· Bs{num(c.tasa_cuadre)}</span>
                          ) : null}
                          {c.forma_cuadre ? (
                            <span className="ml-1 text-[9px] text-emerald-500" title={`Cuadra por ${c.forma_cuadre}`}>🤝</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className={td}>
                      {c.socio_asignado ? (
                        <span className="truncate block font-bold text-amber-700">{c.socio_asignado}</span>
                      ) : c.es_socio ? (
                        <span className="text-[10px] text-slate-400">
                          Agencia <span className="text-[9px]">👥</span> {afiliadosDe(c, clientes)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className={td + " text-center"}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={c.portal_habilitado ? "text-cyan-600" : "text-slate-300"}
                          title={c.portal_habilitado ? "Portal habilitado" : "Portal deshabilitado"}
                        >
                          {c.portal_habilitado ? "🔗" : "🔒"}
                        </span>
                        <span
                          className={c.mostrar_saldo_socio ? "text-emerald-600" : "text-slate-300"}
                          title={c.mostrar_saldo_socio ? "Muestra saldo al socio" : "Oculto al socio"}
                        >
                          {c.mostrar_saldo_socio ? "\u{1F441}\uFE0F" : "\u{1F648}"}
                        </span>
                      </span>
                    </td>
                    <td className={td + " text-center"}>
                      <div className="flex items-center justify-center gap-0.5">
                        {num(c.saldo_actual) > 0.005 ? (
                          <button
                            type="button"
                            title="Pagar ganancia / liquidar saldo a favor"
                            aria-label="Pagar ganancia"
                            onClick={() => {
                              setClientePagoGanadorId(String(c.id));
                              setVistaInicialPagos("pagar_ganadores");
                              setModalPagoGanadorAbierto(true);
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition bg-emerald-50 hover:bg-emerald-200 text-emerald-800"
                          >
                            💸
                          </button>
                        ) : null}
                        <Guard permiso="clientes:btn_editar" disabled>
                          <button
                            type="button"
                            title="Editar cliente"
                            aria-label="Editar cliente"
                            onClick={() => setEditando(c)}
                            className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition hover:bg-primary-100"
                          >
                            ✏️
                          </button>
                        </Guard>
                        <button
                          type="button"
                          title="Portal de consulta"
                          aria-label="Portal de consulta"
                          onClick={() => setPortalDe(c)}
                          className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition hover:bg-cyan-100"
                        >
                          📛
                        </button>
                        <button
                          type="button"
                          title="Estado de cuenta"
                          aria-label="Estado de cuenta"
                          onClick={() => {
                            setClienteEstado(c);
                            setTab("estado");
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition hover:bg-indigo-100"
                        >
                          📋
                        </button>
                        <button
                          type="button"
                          title="Cuaderno de jugadas (libro manual, no toca saldos)"
                          aria-label="Cuaderno de jugadas"
                          onClick={() => {
                            setClienteEstado(c);
                            setTab("cuaderno");
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition hover:bg-amber-100"
                        >
                          📒
                        </button>
                        <Guard permiso="clientes:btn_eliminar" disabled>
                          <button
                            type="button"
                            title="Eliminar cliente"
                            aria-label="Eliminar cliente"
                            onClick={() => setBorrando(c)}
                            className="flex h-6 w-6 items-center justify-center rounded text-[13px] leading-none transition hover:bg-danger-100"
                          >
                            🗑️
                          </button>
                        </Guard>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginado.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-10 text-center text-slate-400">
                      {cargando ? (
                        <>
                          <span className="mr-2">⏳</span>Cargando cartera…
                        </>
                      ) : errorCarga ? (
                        <span className="text-danger-600">
                          <span className="mr-2">⚠️</span>
                          No se pudo leer la cartera: {errorCarga}
                        </span>
                      ) : (
                        <>
                          <span className="mr-2">📥</span>Sin clientes que coincidan.
                        </>
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-2">
              <span>
                {visibles.length} cliente(s) · {seleccion.size} seleccionado(s)
              </span>
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                <span>Filas</span>
                <select
                  value={porPagina}
                  onChange={(e) => {
                    setPorPagina(Number(e.target.value));
                    setPagina(1);
                  }}
                  className="rounded border border-line bg-surface px-1.5 py-1 text-[11px] font-bold text-slate-700 outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {[25, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                <span >◀</span>
              </Button>
              <span className="font-bold text-slate-700">
                {pagina} / {totalPaginas}
              </span>
              <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                <span >▶</span>
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
      ) : tab === "cuadre" ? (
        <CuadreSemanal clientes={clientes} />
      ) : tab === "cuaderno" ? (
        <CuadernoCliente
          clientes={clientes}
          clienteEstado={clienteEstado}
          onActivo={(c) => setClienteEstado(c)}
        />
      ) : (
        <NotificacionesPortal />
      )}

      {/* Modales */}
      {abrirNuevoRapido ? (
        <ModalCreacionRapidaCliente
          abierto={abrirNuevoRapido}
          grupoIdDefault={grupoConsultado}
          onClose={() => setAbrirNuevoRapido(false)}
          onClienteCreado={() => void recargar(grupoConsultado)}
        />
      ) : null}
      {abrirNuevo ? <ModalCliente grupoIdPorDefecto={grupoConsultado} onClose={() => setAbrirNuevo(false)} onGuardado={() => void recargar(grupoConsultado)} /> : null}
      {editando ? <ModalCliente cliente={editando} grupoIdPorDefecto={grupoConsultado} onClose={() => setEditando(null)} onGuardado={() => void recargar(grupoConsultado)} /> : null}
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
              <span className="mr-2 text-danger-600">⚠️</span> Eliminar cliente
            </h3>
            <p className="text-xs text-slate-600">
              ¿Seguro que deseas eliminar a <b>{borrando.nombre}</b>? Esta acción no puede deshacerse.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setBorrando(null)}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={() => void confirmarEliminar(borrando)}>
                <span className="mr-1">🗑️</span> Eliminar
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
              <span className="mr-2 text-primary-600">％</span> Devoluciones masivas
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
                <span className="mr-1">✅</span> Aplicar {num(pctDev)}%
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ModalPagoAGanadorYConciliacion
        abierto={modalPagoGanadorAbierto}
        onCerrar={() => {
          setModalPagoGanadorAbierto(false);
          setClientePagoGanadorId(null);
        }}
        grupoId={grupoActivoVigente() || null}
        clientePreseleccionadoId={clientePagoGanadorId}
        vistaInicial={vistaInicialPagos}
        onPagoCompletado={() => {
          void recargar();
        }}
      />

      <ToastHost />
    </div>
  );
}


// ---------------------------------------------------------------------------
// Reporte de Cuadre Semanal por Cliente (clon del legacy §7)
// ---------------------------------------------------------------------------

/**
 * Celda "Método de Pago" del Cuadre: lista TODAS las formas de pago del
 * cliente (PROMPT #7), la ⭐ principal primero. Esta es la pantalla con la que
 * se paga y se cobra cada semana, así que alcanza con verlas acá: el detalle
 * (banco, teléfono, titular, moneda) está en el `title` de cada chip.
 */
function celdaFormasPago(c: ClienteRow): React.ReactNode {
  const formas = formasPagoDe(c);
  if (!formas.length) return <span className="text-slate-300">—</span>;
  const principal = formas.find((f) => f.principal) ?? formas[0];
  const restantes = formas.filter((f) => f !== principal);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span
        className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-black text-cyan-700"
        title={resumenFormaPago(principal)}
      >
        ⭐ {principal.metodo}
        {principal.moneda ? ` · ${principal.moneda}` : ""}
      </span>
      {restantes.map((f, i) => (
        <span
          key={String(f.uid ?? i)}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500"
          title={resumenFormaPago(f)}
        >
          {f.moneda ? `${f.moneda} · ` : ""}
          {f.metodo}
        </span>
      ))}
    </span>
  );
}

function CuadreSemanal({ clientes }: { clientes: ClienteRow[] }) {
  const [diaFiltro, setDiaFiltro] = useState("");
  const [generado, setGenerado] = useState(false);

  const lista = useMemo(
    () => clientes.filter((c) => !diaFiltro || String(c.dia_cuadre) === diaFiltro),
    [clientes, diaFiltro]
  );

  const totalDebeTasa = lista.reduce(
    (acc, c) => acc + (num(c.tasa_cuadre) > 0 ? num(c.saldo_actual) * num(c.tasa_cuadre) : 0),
    0
  );

  const th = "px-3 py-2 text-left text-[9px] font-black uppercase tracking-wider text-slate-500";
  const td = "px-3 py-2 align-middle";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Día de cuadre</label>
          <select
            value={diaFiltro}
            onChange={(e) => {
              setDiaFiltro(e.target.value);
              setGenerado(false);
            }}
            className="border border-line rounded-xl px-3 py-2 text-xs font-bold bg-white outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="">TODOS LOS DÍAS</option>
            {DIAS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <Button variant="default" size="sm" onClick={() => setGenerado(true)}>
          <span className="mr-1">🧾</span> Generar Reporte
        </Button>
        {generado ? (
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
            {lista.length} cliente(s) · Debe total: {formatoMoneda("BS", totalDebeTasa)}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-line">
            <tr>
              <th className={th}>Cliente</th>
              <th className={th}>Día</th>
              <th className={th}>Método de Pago</th>
              <th className={th}>Forma de Cuadre</th>
              <th className={th + " text-right"}>Tasa Cuadre</th>
              <th className={th + " text-right"}>Saldo USD</th>
              <th className={th + " text-right text-amber-600"}>Debe a la Tasa</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const tasa = num(c.tasa_cuadre);
              const saldo = num(c.saldo_actual);
              const debeTasa = tasa > 0 ? saldo * tasa : 0;
              return (
                <tr key={String(c.id)} className="border-b border-line last:border-0 hover:bg-emerald-50/40">
                  <td className={td + " font-bold text-slate-800"}>
                    {c.nombre || c.seudonimo}
                    {c.es_socio ? <span className="ml-1 text-[9px] font-black text-amber-600">…Socio</span> : null}
                  </td>
                  <td className={td + " font-bold text-emerald-700"}>{c.dia_cuadre || "—"}</td>
                  <td className={td}>{celdaFormasPago(c)}</td>
                  <td className={td}>{c.forma_cuadre || <span className="text-slate-300">—</span>}</td>
                  <td className={td + " text-right font-mono font-bold"}>{tasa > 0 ? String(tasa) : "—"}</td>
                  <td className={td + " text-right font-mono font-black " + (saldo < 0 ? "text-danger-600" : "text-emerald-700")}>
                    {formatoMoneda("USD", saldo)}
                  </td>
                  <td className={td + " text-right font-mono font-black text-amber-600"}>
                    {tasa > 0 ? formatoMoneda("BS", debeTasa) : "—"}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                  {generado ? (
                    <>
                      <span className="mr-2">📥</span>Ningún cliente cuadra ese día.
                    </>
                  ) : (
                    <span className="mr-2">🗓️</span>
                  )}
                  {generado ? "" : "Seleccione un día (o todos) y pulse Generar Reporte."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
