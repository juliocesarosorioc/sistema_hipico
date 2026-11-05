"use client";

import { useEffect, useState } from "react";
import {
  aprobarSolicitud,
  listarSolicitudesRegistro,
  rechazarSolicitud,
  type EstadoSolicitud,
  type SolicitudRegistro,
  ETIQUETAS_ROL,
} from "@/features/auth/lib/solicitudes-registro";
import { guardarUsuarioSistema } from "@/features/seguridad/lib/accesos";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useAuthStore } from "@/shared/store/useAuthStore";

export function SeccionSolicitudesRegistro() {
  const adminUsuario = useAuthStore((s) => s.usuario) || "ADMIN";
  const [solicitudes, setSolicitudes] = useState<SolicitudRegistro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<EstadoSolicitud | "TODAS">("TODAS");
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const data = await listarSolicitudesRegistro(
        filtro === "TODAS" ? undefined : filtro
      );
      setSolicitudes(data);
    } catch {
      emitirToast("Error al cargar solicitudes de registro.", "error");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void cargar();
  }, [filtro]);

  const handleAprobar = async (sol: SolicitudRegistro) => {
    if (!sol.id) return;
    const confirmar = window.confirm(
      `¿Desea aprobar el ingreso de "${sol.nombre}" (@${sol.usuario}) con rol "${sol.rol_solicitado}"?`
    );
    if (!confirmar) return;

    setProcesandoId(sol.id);
    try {
      // 1. Mapear rol solicitado a tipo de usuario del sistema
      const tipoMapeado =
        sol.rol_solicitado === "BANQUERO"
          ? "banquero"
          : sol.rol_solicitado === "OPERADOR"
          ? "operador"
          : sol.rol_solicitado === "SOCIO_AGENCIA"
          ? "admin"
          : "jugador";

      // 2. Dar de alta en usuarios del sistema
      await guardarUsuarioSistema({
        id: sol.usuario,
        nombre: sol.nombre,
        tipo: tipoMapeado,
        activo: true,
        clienteId: null,
        grupoId: sol.grupo_id ? String(sol.grupo_id) : null,
      });

      // 3. Marcar solicitud como aprobada
      const r = await aprobarSolicitud(sol.id, adminUsuario);
      if (r.ok) {
        emitirToast(`Solicitud de @${sol.usuario} aprobada exitosamente.`, "success");
        await cargar();
      } else {
        emitirToast(r.error || "No se pudo marcar la solicitud.", "error");
      }
    } catch (e) {
      emitirToast((e as Error).message, "error");
    } finally {
      setProcesandoId(null);
    }
  };

  const handleRechazar = async (sol: SolicitudRegistro) => {
    if (!sol.id) return;
    const motivo = window.prompt(`Indique el motivo del rechazo para @${sol.usuario}:`, "No cumple los requisitos");
    if (motivo === null) return;

    setProcesandoId(sol.id);
    try {
      const r = await rechazarSolicitud(sol.id, adminUsuario, motivo);
      if (r.ok) {
        emitirToast(`Solicitud de @${sol.usuario} rechazada.`, "info");
        await cargar();
      } else {
        emitirToast(r.error || "No se pudo rechazar la solicitud.", "error");
      }
    } catch (e) {
      emitirToast((e as Error).message, "error");
    } finally {
      setProcesandoId(null);
    }
  };

  const handleNotificarWhatsApp = (sol: SolicitudRegistro) => {
    const telLimpio = sol.telefono.replace(/\D/g, "");
    const msg = [
      `🏇 *SISTEMA HÍPICO - CUENTA ACTIVADA*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `¡Hola ${sol.nombre}!`,
      `Tu cuenta en la plataforma ha sido *APROBADA Y ACTIVADA* con éxito.`,
      ``,
      `👤 *Usuario:* ${sol.usuario}`,
      `🎯 *Rol Asignado:* ${ETIQUETAS_ROL[sol.rol_solicitado]?.titulo || sol.rol_solicitado}`,
      sol.grupo_nombre ? `🏢 *Grupo:* ${sol.grupo_nombre}` : "",
      ``,
      `Puedes ingresar de inmediato en:`,
      `👉 ${typeof window !== "undefined" ? window.location.origin : ""}/login`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `¡Bienvenido y éxito en tus jugadas!`,
    ]
      .filter(Boolean)
      .join("\n");

    const url = telLimpio
      ? `https://wa.me/${telLimpio}?text=${encodeURIComponent(msg)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      {/* Barra de control */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
        <div>
          <h2 className="text-sm font-black text-slate-800">
            Solicitudes de Registro de Nuevos Usuarios
          </h2>
          <p className="text-xs text-slate-500">
            Revise los prospectos que se registraron desde la web comercial o la app.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as EstadoSolicitud | "TODAS")}
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500"
          >
            <option value="TODAS">Todas las solicitudes</option>
            <option value="PENDIENTE_APROBACION">⏳ Pendientes de Aprobación</option>
            <option value="APROBADO">✅ Aprobadas</option>
            <option value="RECHAZADO">❌ Rechazadas</option>
          </select>

          <button
            type="button"
            onClick={cargar}
            disabled={cargando}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cargando ? "Cargando..." : "🔄 Actualizar"}
          </button>
        </div>
      </div>

      {/* Lista / Tabla de solicitudes */}
      {solicitudes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
          <p className="text-sm font-bold text-slate-500">
            {cargando
              ? "Consultando solicitudes..."
              : filtro === "PENDIENTE_APROBACION"
              ? "No hay solicitudes pendientes de aprobación en este momento."
              : "No se encontraron solicitudes con el filtro seleccionado."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-[10px] font-black uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2.5">Solicitante</th>
                <th className="px-3 py-2.5">Contacto</th>
                <th className="px-3 py-2.5">Rol Solicitado</th>
                <th className="px-3 py-2.5">Grupo / Sucursal</th>
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {solicitudes.map((sol) => {
                const esPendiente = sol.estado === "PENDIENTE_APROBACION";
                const esAprobado = sol.estado === "APROBADO";
                const esRechazado = sol.estado === "RECHAZADO";

                return (
                  <tr key={sol.id || sol.usuario} className="hover:bg-slate-50/70">
                    <td className="px-3 py-3">
                      <div className="font-bold text-slate-900">{sol.nombre}</div>
                      <div className="font-mono text-[11px] text-slate-500">@{sol.usuario}</div>
                      {sol.mensaje ? (
                        <div className="mt-1 line-clamp-2 max-w-xs text-[10px] italic text-slate-500">
                          &ldquo;{sol.mensaje}&rdquo;
                        </div>
                      ) : null}
                    </td>

                    <td className="px-3 py-3">
                      <div className="font-bold text-slate-800">{sol.telefono}</div>
                      {sol.correo ? (
                        <div className="text-[10px] text-slate-500">{sol.correo}</div>
                      ) : null}
                    </td>

                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 font-bold text-amber-800 border border-amber-200 text-[10px]">
                        <span>{ETIQUETAS_ROL[sol.rol_solicitado]?.emoji || "👤"}</span>
                        <span>{ETIQUETAS_ROL[sol.rol_solicitado]?.titulo || sol.rol_solicitado}</span>
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <span className="text-slate-700 font-medium">
                        {sol.grupo_nombre || "General / Sin Asignar"}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-[11px] text-slate-500">
                      {sol.created_at ? new Date(sol.created_at).toLocaleDateString("es-VE") : "Hoy"}
                    </td>

                    <td className="px-3 py-3">
                      {esPendiente ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                          ⏳ Pendiente
                        </span>
                      ) : esAprobado ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                          ✅ Aprobado
                        </span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800">
                          ❌ Rechazado
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {esPendiente ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleAprobar(sol)}
                              disabled={procesandoId === sol.id}
                              className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                              title="Aprobar y dar de alta usuario"
                            >
                              Aprobar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRechazar(sol)}
                              disabled={procesandoId === sol.id}
                              className="rounded bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-200 disabled:opacity-50"
                              title="Rechazar solicitud"
                            >
                              Rechazar
                            </button>
                          </>
                        ) : null}

                        {esAprobado ? (
                          <button
                            type="button"
                            onClick={() => handleNotificarWhatsApp(sol)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-200"
                            title="Enviar credenciales / bienvenida por WhatsApp"
                          >
                            <span>📲 WhatsApp</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => {
                            const tel = sol.telefono.replace(/\D/g, "");
                            window.open(
                              tel ? `https://wa.me/${tel}` : "https://api.whatsapp.com",
                              "_blank"
                            );
                          }}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                          title="Contactar directamente por WhatsApp"
                        >
                          💬 Chat
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
