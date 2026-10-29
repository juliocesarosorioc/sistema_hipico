"use client";

import { useState } from "react";
import { codigosPaisUnicos, desglosarTelefono } from "@/shared/lib/vzla";
import { actualizarMiPerfil, type SesionPortal } from "@/features/portal/lib/portal";

type Props = {
  cliente: SesionPortal["cliente"];
  nombreGrupo?: string;
  onGuardado: (nuevoCliente: SesionPortal["cliente"]) => void;
};

/**
 * Modal Bloqueante de Actualización Obligatoria de Datos de Contacto.
 * Se presenta la primera vez que un jugador ingresa al portal o si no cuenta con
 * número de teléfono y correo electrónico registrados.
 * No puede cerrarse hasta que los datos mínimos (teléfono y correo) sean guardados.
 */
export function ModalActualizacionObligatoriaContacto({
  cliente,
  nombreGrupo,
  onGuardado,
}: Props) {
  const telDesglosado = desglosarTelefono(cliente.telefono);
  const [codigoPais, setCodigoPais] = useState(cliente.codigo_pais || telDesglosado.codigo || "+58");
  const [telefono, setTelefono] = useState(telDesglosado.numero || "");
  const [email, setEmail] = useState(cliente.email || "");
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const telefonoFormateado = () => {
    const dig = telefono.replace(/[^\d]/g, "");
    const t = codigoPais + " " + dig;
    return codigoPais === "+58" && dig.startsWith("0") ? codigoPais + " " + dig.slice(1) : t;
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const digitosTel = telefono.replace(/[^\d]/g, "");
    if (!digitosTel || digitosTel.length < 7) {
      setError("Debes ingresar un número de teléfono válido (mínimo 7 dígitos).");
      return;
    }

    const emailLimpio = email.trim().toLowerCase();
    if (!emailLimpio || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLimpio)) {
      setError("Debes ingresar un correo electrónico válido (ejemplo: usuario@correo.com).");
      return;
    }

    setGuardando(true);
    try {
      const telFinal = telefonoFormateado();
      const res = await actualizarMiPerfil({
        nombre: nombre.trim().toUpperCase() || cliente.nombre || undefined,
        codigo_pais: codigoPais,
        telefono: telFinal,
        email: emailLimpio,
      });

      if (!res.ok) {
        setError(res.error ?? "No se pudieron actualizar los datos de contacto.");
        setGuardando(false);
        return;
      }

      // Marcar en almacenamiento local para no volver a exigir de inmediato
      try {
        const idClave = cliente.id || cliente.seudonimo || "cliente";
        localStorage.setItem(`portal_contacto_verificado_${idClave}`, "1");
      } catch {
        /* sinop */
      }

      const clienteActualizado = res.cliente ?? {
        ...cliente,
        codigo_pais: codigoPais,
        telefono: telFinal,
        email: emailLimpio,
        nombre: nombre.trim().toUpperCase() || cliente.nombre,
      };

      onGuardado(clienteActualizado);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al guardar datos de contacto.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-actualizacion-contacto"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-indigo-500/40 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera distintiva */}
        <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-2xl ring-1 ring-white/20">
              📱
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                {nombreGrupo ? `Banca ${nombreGrupo}` : "Portal de Jugadores"}
              </span>
              <h2 id="titulo-actualizacion-contacto" className="text-base font-black tracking-tight text-white">
                Actualización Requerida de Contacto
              </h2>
            </div>
          </div>
          <p className="mt-2 text-xs text-indigo-100/80 leading-relaxed">
            Por seguridad, notificación de jugadas y liquidación de premios, es obligatorio registrar tu número de teléfono y correo electrónico antes de ingresar.
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={guardar} className="space-y-4 p-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700 flex items-start gap-2">
              <span className="text-base leading-none">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
              Nombre / Seudónimo
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre o seudónimo"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
              Número de Teléfono <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={codigoPais}
                onChange={(e) => setCodigoPais(e.target.value)}
                className="w-32 shrink-0 rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-slate-700 outline-none transition focus:border-indigo-600 focus:bg-white"
              >
                {codigosPaisUnicos().map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} ({p.pais})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                required
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="ej. 412 1234567"
                className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              Se utilizará para reportes de jugadas y confirmación vía WhatsApp o SMS.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
              Correo Electrónico <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ejemplo: jugador@correo.com"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Garantiza el respaldo y comprobantes de tus estados de cuenta.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={guardando}
              className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg transition hover:bg-indigo-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guardando ? "Guardando y Validando..." : "Actualizar y Continuar al Portal ➔"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ModalActualizacionObligatoriaContacto;
