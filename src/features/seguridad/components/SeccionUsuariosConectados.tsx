"use client";

import { useEffect, useState, useTransition } from "react";
import {
  consultarUsuariosConectados,
  consultarActividadUsuario,
  purgarActividadAntigua10Dias,
  formatearNombreRuta,
  type UsuarioSesionInfo,
  type UsuarioActividadItem,
} from "@/features/seguridad/lib/seguimiento-usuarios";

interface Props {
  usuarioSeleccionadoId?: string;
  onSeleccionarUsuario?: (usuarioId: string) => void;
}

export function SeccionUsuariosConectados({
  usuarioSeleccionadoId,
  onSeleccionarUsuario,
}: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioSesionInfo[]>([]);
  const [usuarioActivo, setUsuarioActivo] = useState<string>(usuarioSeleccionadoId || "");
  const [tabDetalle, setTabDetalle] = useState<"paginas" | "acciones" | "resumen">("paginas");
  const [actividad, setActividad] = useState<{
    paginas: UsuarioActividadItem[];
    acciones: UsuarioActividadItem[];
    totalPaginas: number;
    totalAcciones: number;
  }>({ paginas: [], acciones: [], totalPaginas: 0, totalAcciones: 0 });

  const [cargando, setCargando] = useState(true);
  const [cargandoActividad, setCargandoActividad] = useState(false);
  const [mensajePurga, setMensajePurga] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Sincronizar usuario externo si cambia
  useEffect(() => {
    if (usuarioSeleccionadoId && usuarioSeleccionadoId !== usuarioActivo) {
      setUsuarioActivo(usuarioSeleccionadoId);
    }
  }, [usuarioSeleccionadoId]);

  // Cargar lista de sesiones y usuarios
  const recargarUsuarios = async () => {
    setCargando(true);
    try {
      const lista = await consultarUsuariosConectados();
      setUsuarios(lista);
      if (!usuarioActivo && lista.length > 0) {
        setUsuarioActivo(lista[0].usuarioId);
      }
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargarUsuarios();
    // Auto-refresco cada 20 segundos para reflejar conexiones en vivo
    const timer = setInterval(() => {
      void recargarUsuarios();
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // Cargar páginas y acciones del usuario activo
  useEffect(() => {
    if (!usuarioActivo) return;
    let activo = true;
    setCargandoActividad(true);

    void consultarActividadUsuario(usuarioActivo).then((res) => {
      if (activo) {
        setActividad(res);
        setCargandoActividad(false);
      }
    });

    return () => {
      activo = false;
    };
  }, [usuarioActivo]);

  const seleccionar = (id: string) => {
    setUsuarioActivo(id);
    onSeleccionarUsuario?.(id);
  };

  const ejecutarPurga10Dias = async () => {
    startTransition(async () => {
      const count = await purgarActividadAntigua10Dias();
      setMensajePurga(`Limpieza completada: ${count} registro(s) de más de 10 días eliminados.`);
      setTimeout(() => setMensajePurga(null), 4000);
      void recargarUsuarios();
      if (usuarioActivo) {
        const res = await consultarActividadUsuario(usuarioActivo);
        setActividad(res);
      }
    });
  };

  const sesionSel = usuarios.find((u) => u.usuarioId === usuarioActivo);
  const totalOnline = usuarios.filter((u) => u.online).length;

  return (
    <div className="space-y-3">
      {/* Barra superior de métricas */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-black uppercase tracking-wider text-slate-800">
              {totalOnline} Usuario{totalOnline === 1 ? "" : "s"} Conectado{totalOnline === 1 ? "" : "s"} en Vivo
            </span>
          </div>

          <span className="hidden text-slate-300 sm:inline">|</span>

          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            Total Sesiones: {usuarios.length}
          </span>

          <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
            🛡️ Purga automática: cada 10 días
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void recargarUsuarios()}
            disabled={cargando}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 active:scale-95 transition-all"
            title="Refrescar usuarios conectados"
          >
            {cargando ? "🔄 Actualizando…" : "🔄 Refrescar"}
          </button>

          <button
            type="button"
            onClick={() => void ejecutarPurga10Dias()}
            className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 active:scale-95 transition-all"
            title="Ejecutar purga de registros con más de 10 días de antigüedad"
          >
            🧹 Limpiar &gt;10 días
          </button>
        </div>
      </div>

      {mensajePurga && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs font-bold text-emerald-800 animate-in fade-in">
          ✅ {mensajePurga}
        </div>
      )}

      {/* Grid Principal: Lista de Usuarios (izq) y Detalle de Páginas/Acciones (der) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
        {/* Panel Izquierdo: Usuarios con su tiempo de conexión */}
        <aside className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Usuarios y Conexión
            </span>
            <span className="text-[10px] text-slate-400">
              {usuarios.length} registrado(s)
            </span>
          </div>

          <div className="max-h-[38rem] overflow-y-auto space-y-1.5 pr-1">
            {usuarios.length === 0 && !cargando && (
              <p className="p-4 text-center text-xs text-slate-400">
                No hay usuarios conectados recientemente.
              </p>
            )}

            {usuarios.map((u) => {
              const esActivo = u.usuarioId === usuarioActivo;
              return (
                <button
                  key={u.id || u.usuarioId}
                  type="button"
                  onClick={() => seleccionar(u.usuarioId)}
                  className={`w-full rounded-xl border p-2.5 text-left transition-all ${
                    esActivo
                      ? "border-indigo-500 bg-indigo-50/70 shadow-sm ring-1 ring-indigo-300"
                      : "border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-xs font-black text-slate-800">
                      {u.nombre || u.usuarioId}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${
                        u.online
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${u.online ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                      {u.online ? "En línea" : "Desconectado"}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-slate-500">
                      ⏱️ Tiempo conectado:
                    </span>
                    <span className="font-mono font-bold text-indigo-700">
                      {u.tiempoConexionTexto}
                    </span>
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center justify-between gap-1 text-[9px] text-slate-400">
                    <span className="truncate max-w-[10rem]">
                      📍 {formatearNombreRuta(u.paginaActual)}
                    </span>
                    <span>{u.dispositivo || "PC"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Panel Derecho: Detalle del usuario seleccionado */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
          {/* Cabecera del Usuario Seleccionado */}
          <div className="border-b border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white font-black text-sm shadow">
                  {(sesionSel?.nombre || usuarioActivo || "U").charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-slate-800">
                      {sesionSel?.nombre || usuarioActivo || "Seleccione un usuario"}
                    </h3>
                    <code className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
                      @{usuarioActivo}
                    </code>
                    {sesionSel?.online ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800 border border-emerald-300">
                        🟢 Conectado Ahora
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        ⚪ Desconectado
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Rol: <b>{sesionSel?.rol || "Operador"}</b>
                    {sesionSel?.grupoId ? ` · Grupo ID: ${sesionSel.grupoId}` : " · Sin Grupo (Global)"}
                    {sesionSel?.dispositivo ? ` · ${sesionSel.dispositivo}` : ""}
                  </p>
                </div>
              </div>

              {/* Estadísticas de conexión del usuario */}
              <div className="flex flex-wrap items-center gap-2 text-right">
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
                  <span className="block text-[9px] font-bold uppercase text-slate-400">
                    Tiempo de Conexión
                  </span>
                  <span className="font-mono text-sm font-black text-indigo-700">
                    {sesionSel?.tiempoConexionTexto || "—"}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
                  <span className="block text-[9px] font-bold uppercase text-slate-400">
                    Página Actual
                  </span>
                  <span className="text-xs font-bold text-slate-700 truncate max-w-[11rem] block">
                    {formatearNombreRuta(sesionSel?.paginaActual)}
                  </span>
                </div>
              </div>
            </div>

            {/* Selector de sub-pestañas: Páginas vs Acciones */}
            <div className="mt-4 flex border-b border-slate-200">
              <button
                type="button"
                onClick={() => setTabDetalle("paginas")}
                className={`border-b-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-all ${
                  tabDetalle === "paginas"
                    ? "border-indigo-600 text-indigo-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                📄 Páginas que Visita ({actividad.totalPaginas})
              </button>
              <button
                type="button"
                onClick={() => setTabDetalle("acciones")}
                className={`border-b-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-all ${
                  tabDetalle === "acciones"
                    ? "border-indigo-600 text-indigo-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                ⚡ Acciones que Ejecuta ({actividad.totalAcciones})
              </button>
              <button
                type="button"
                onClick={() => setTabDetalle("resumen")}
                className={`border-b-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-all ${
                  tabDetalle === "resumen"
                    ? "border-indigo-600 text-indigo-700 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                ℹ️ Resumen de Sesión
              </button>
            </div>
          </div>

          {/* Cuerpo del Detalle */}
          <div className="flex-1 p-4 overflow-y-auto max-h-[30rem]">
            {cargandoActividad ? (
              <div className="p-8 text-center text-xs font-semibold text-slate-400">
                Cargando historial de {usuarioActivo}…
              </div>
            ) : tabDetalle === "paginas" ? (
              /* Sub-pestaña: Páginas que visita */
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Historial de Navegación (Últimos 10 días)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {actividad.paginas.length} visita(s) registrada(s)
                  </span>
                </div>

                {actividad.paginas.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No se han registrado visitas a páginas para este usuario en los últimos 10 días.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                    {actividad.paginas.map((p, idx) => {
                      const d = new Date(p.fecha);
                      const hora = isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const fechaStr = isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
                      return (
                        <div key={p.id || idx} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors text-xs">
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">📄</span>
                            <div>
                              <span className="font-bold text-slate-800 block">
                                {formatearNombreRuta(p.ruta)}
                              </span>
                              <code className="text-[10px] text-slate-400">{p.ruta}</code>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-slate-700 block">{hora}</span>
                            <span className="text-[10px] text-slate-400">{fechaStr}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : tabDetalle === "acciones" ? (
              /* Sub-pestaña: Acciones que ejecuta */
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Registro de Acciones y Operaciones (Últimos 10 días)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {actividad.acciones.length} acción(es) registrada(s)
                  </span>
                </div>

                {actividad.acciones.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    No se han registrado acciones operativas para este usuario en los últimos 10 días.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
                    {actividad.acciones.map((a, idx) => {
                      const d = new Date(a.fecha);
                      const hora = isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const fechaStr = isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
                      return (
                        <div key={a.id || idx} className="flex items-center justify-between p-2.5 hover:bg-slate-50 transition-colors text-xs">
                          <div className="flex items-center gap-2.5">
                            <span className="text-base">⚡</span>
                            <div>
                              <span className="font-bold text-slate-800 block">
                                {a.accion || "Operación de usuario"}
                              </span>
                              {a.detalle && (
                                <p className="text-[10px] text-slate-500 max-w-md truncate">
                                  {a.detalle}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-bold text-slate-700 block">{hora}</span>
                            <span className="text-[10px] text-slate-400">{fechaStr}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Sub-pestaña: Resumen de Sesión */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-[10px] font-black uppercase text-slate-400">
                      Inicio de Sesión
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {sesionSel?.inicioSesion
                        ? new Date(sesionSel.inicioSesion).toLocaleString("es-ES")
                        : "—"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-[10px] font-black uppercase text-slate-400">
                      Último Latido / Actividad
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {sesionSel?.ultimoLatido
                        ? new Date(sesionSel.ultimoLatido).toLocaleString("es-ES")
                        : "—"}
                    </span>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <span className="block text-[10px] font-black uppercase text-slate-400">
                      Dispositivo y Navegador
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      {sesionSel?.dispositivo || "PC"} · {sesionSel?.navegador || "Navegador"}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-indigo-900 space-y-1">
                  <div className="flex items-center gap-2 font-black uppercase tracking-wide">
                    <span>🛡️ Regla de Retención de 10 Días</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Todo el registro de páginas visitadas, acciones ejecutadas y sesiones de <strong>{usuarioActivo}</strong> se conserva estrictamente por <strong>10 días</strong>. Los datos con antigüedad mayor se purgan de manera 100% automática en el servidor y en la base de datos sin necesidad de intervención manual.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
