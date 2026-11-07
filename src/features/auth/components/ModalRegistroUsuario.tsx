"use client";

import { useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { emitirToast } from "@/shared/lib/mensajeria";
import { RecaptchaWidget } from "@/shared/components/ui/RecaptchaWidget";
import {
  ETIQUETAS_ROL,
  generarMensajeWhatsAppAprobacion,
  registrarNuevaSolicitud,
  type RolSolicitado,
} from "@/features/auth/lib/solicitudes-registro";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  adminTelefono?: string;
  onRegistroExitoso?: (usuario: string) => void;
};

export function ModalRegistroUsuario({ abierto, onCerrar, adminTelefono = "", onRegistroExitoso }: Props) {
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<RolSolicitado>("JUGADOR");
  const [pruebaGratuita, setPruebaGratuita] = useState(false);
  const [nombreGrupoNuevo, setNombreGrupoNuevo] = useState("");
  const [clave, setClave] = useState("");
  const [claveConfirm, setClaveConfirm] = useState("");
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [solicitudEnviada, setSolicitudEnviada] = useState(false);
  const [whatsappInfo, setWhatsappInfo] = useState<{ texto: string; url: string } | null>(null);

  if (!abierto) return null;

  const resetForm = () => {
    setNombre("");
    setUsuario("");
    setTelefono("");
    setCorreo("");
    setRol("JUGADOR");
    setPruebaGratuita(false);
    setNombreGrupoNuevo("");
    setClave("");
    setClaveConfirm("");
    setMensaje("");
    setSolicitudEnviada(false);
    setWhatsappInfo(null);
  };

  const handleCerrar = () => {
    resetForm();
    onCerrar();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nombre.trim()) {
      emitirToast("Indique su nombre completo.", "warning");
      return;
    }
    const userLimpio = usuario.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!userLimpio || userLimpio.length < 3) {
      emitirToast("El usuario debe tener al menos 3 caracteres (sin espacios ni símbolos).", "warning");
      return;
    }
    if (!telefono.trim() || telefono.trim().length < 7) {
      emitirToast("Indique un número de WhatsApp válido para contactarlo.", "warning");
      return;
    }
    if (pruebaGratuita && !nombreGrupoNuevo.trim()) {
      emitirToast("Indique el nombre de su grupo o centro hípico para la prueba.", "warning");
      return;
    }
    if (clave && clave.length < 4) {
      emitirToast("La contraseña debe tener al menos 4 caracteres.", "warning");
      return;
    }
    if (clave && clave !== claveConfirm) {
      emitirToast("Las contraseñas no coinciden.", "warning");
      return;
    }

    if (!recaptchaToken) {
      emitirToast("⚠️ Por favor completa la verificación reCAPTCHA con imágenes antes de enviar la solicitud.", "warning");
      return;
    }

    setGuardando(true);

    const r = await registrarNuevaSolicitud({
      nombre,
      usuario: userLimpio,
      telefono,
      correo,
      rol_solicitado: pruebaGratuita ? "SOCIO_AGENCIA" : rol,
      prueba_gratuita: pruebaGratuita,
      nombre_grupo_nuevo: pruebaGratuita ? nombreGrupoNuevo.trim() : null,
      mensaje,
      clave_deseada: clave,
    });

    setGuardando(false);

    if (!r.ok) {
      emitirToast(r.error || "No se pudo registrar la solicitud.", "error");
      return;
    }

    // Generar texto y enlace para WhatsApp
    const wa = generarMensajeWhatsAppAprobacion(
      {
        nombre,
        usuario: userLimpio,
        telefono,
        correo,
        rol_solicitado: pruebaGratuita ? "SOCIO_AGENCIA" : rol,
        prueba_gratuita: pruebaGratuita,
        nombre_grupo_nuevo: pruebaGratuita ? nombreGrupoNuevo.trim() : null,
        mensaje,
      },
      adminTelefono
    );

    setWhatsappInfo(wa);
    setSolicitudEnviada(true);
    emitirToast(
      pruebaGratuita
        ? "¡Solicitud de prueba gratuita enviada! Notifique al administrador para activarla."
        : "¡Solicitud enviada! Notifique al administrador para activar su cuenta.",
      "success"
    );
    if (onRegistroExitoso) onRegistroExitoso(userLimpio);
  };

  const handleCopiarTexto = () => {
    if (!whatsappInfo) return;
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(whatsappInfo.texto);
      emitirToast("📋 Mensaje copiado al portapapeles.", "success");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCerrar();
      }}
    >
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-amber-500/30 bg-slate-900 text-white shadow-2xl transition-all">
        {/* Cabecera decorada de lujo */}
        <div className="relative bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/60 px-5 py-4 border-b border-amber-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-xl text-slate-950 shadow-md">
                🏇
              </span>
              <div>
                <h3 className="text-base font-black uppercase tracking-wide text-amber-400">
                  Solicitud de Registro
                </h3>
                <p className="text-[11px] text-slate-300">
                  Plataforma Hípica Profesional · Aprobación de Ingreso
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCerrar}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Cuerpo del Modal */}
        <div className="max-h-[80vh] overflow-y-auto p-5 text-xs">
          {solicitudEnviada && whatsappInfo ? (
            /* Vista de Éxito y Notificación al Administrador */
            <div className="space-y-4 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/20 text-3xl text-emerald-400 ring-2 ring-emerald-500/40">
                ✓
              </div>

              <div>
                <h4 className="text-base font-black uppercase tracking-wide text-emerald-400">
                  ¡Solicitud Enviada con Éxito!
                </h4>
                <p className="mt-1 text-slate-300 leading-relaxed text-xs">
                  Tu cuenta <b>@{usuario}</b> ha sido registrada y está en estado{" "}
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300">
                    PENDIENTE DE APROBACIÓN
                  </span>
                  .
                </p>
              </div>

              {/* Caja de instrucciones de WhatsApp */}
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-4 text-left space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs uppercase tracking-wide">
                  <span>📱</span> Notificar al Administrador
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Para que el administrador active tu usuario de forma inmediata, envía el mensaje de confirmación por WhatsApp:
                </p>

                {/* Previsualización del mensaje */}
                <div className="rounded-lg bg-slate-950/80 p-3 text-[11px] font-mono text-emerald-200 border border-emerald-800/50 whitespace-pre-line max-h-36 overflow-y-auto">
                  {whatsappInfo.texto}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={whatsappInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-900/40 transition hover:from-emerald-500 hover:to-green-500 hover:scale-[1.02] active:scale-95"
                  >
                    <span>💬</span> Abrir WhatsApp y Enviar al Administrador
                  </a>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopiarTexto}
                    className="border-slate-700 hover:bg-slate-800 text-slate-300"
                  >
                    📋 Copiar
                  </Button>
                </div>
              </div>

              {/* Botón para finalizar */}
              <div className="pt-2">
                <Button variant="default" onClick={handleCerrar} className="w-full bg-slate-800 hover:bg-slate-700">
                  Listo · Volver al Inicio
                </Button>
              </div>
            </div>
          ) : (
            /* Formulario de Registro */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-[11px] text-amber-200 leading-relaxed">
                ℹ️ Complete sus datos para solicitar su cuenta. Una vez enviada, podrá notificar al administrador directamente vía WhatsApp para habilitar su acceso.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Nombre completo */}
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Nombre y Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Ej: Carlos Méndez"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400"
                  />
                </div>

                {/* Nombre de usuario */}
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Usuario deseado *
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-500 font-bold">
                      @
                    </span>
                    <input
                      type="text"
                      required
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
                      placeholder="cmendez"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-7 pr-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400 lowercase"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* WhatsApp */}
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Teléfono WhatsApp *
                  </label>
                  <input
                    type="tel"
                    required
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="+58 412 1234567"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400"
                  />
                </div>

                {/* Correo electrónico */}
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="carlos@correo.com"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Selector de Rol */}
              <div>
                <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                  Tipo de Cuenta / Rol Solicitado *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(ETIQUETAS_ROL) as RolSolicitado[]).map((r) => {
                    const info = ETIQUETAS_ROL[r];
                    const sel = rol === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRol(r)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition ${
                          sel
                            ? "border-amber-400 bg-amber-500/20 text-white shadow-xs ring-1 ring-amber-400"
                            : "border-slate-800 bg-slate-950/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        }`}
                      >
                        <span className="text-lg">{info.emoji}</span>
                        <span className="mt-1 font-bold text-[10px] uppercase leading-tight line-clamp-1">
                          {info.titulo.split("/")[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  {ETIQUETAS_ROL[rol].desc}
                </p>
              </div>

              {/* Opción destacada: Registrar tu grupo y realizar prueba gratuita por 2 semanas */}
              <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-amber-400/5 to-slate-950 p-3.5 transition">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pruebaGratuita}
                    onChange={(e) => {
                      const chk = e.target.checked;
                      setPruebaGratuita(chk);
                      if (chk) setRol("SOCIO_AGENCIA");
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 accent-amber-500 focus:ring-amber-400"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 font-black text-amber-300 text-xs">
                      <span>🎁</span>
                      <span>Registrar mi propio grupo y realizar prueba gratuita por 2 semanas</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-300 leading-tight">
                      Acceso completo durante 14 días para tu sala, banca o centro hípico. Tablas, Marcas, Remates y liquidación sin costo.
                    </p>
                  </div>
                </label>

                {pruebaGratuita && (
                  <div className="mt-3 pt-3 border-t border-amber-500/20 space-y-1.5 animate-fadeIn">
                    <label className="block font-bold text-amber-200 text-[11px]">
                      Nombre de tu Grupo / Centro Hípico / Sala *
                    </label>
                    <input
                      type="text"
                      required={pruebaGratuita}
                      value={nombreGrupoNuevo}
                      onChange={(e) => setNombreGrupoNuevo(e.target.value)}
                      placeholder="Ej: Inversiones El Campeón / Centro Hípico La Fusta"
                      className="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder:text-slate-600"
                    />
                  </div>
                )}
              </div>

              {/* Contraseña deseada */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Contraseña deseada
                  </label>
                  <input
                    type="password"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    placeholder="Mínimo 4 caracteres"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                    Confirmar Contraseña
                  </label>
                  <input
                    type="password"
                    value={claveConfirm}
                    onChange={(e) => setClaveConfirm(e.target.value)}
                    placeholder="Repita la contraseña"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Mensaje / Nota para el admin */}
              <div>
                <label className="mb-1 block font-bold text-slate-300 text-[11px]">
                  Nota u Observación para el Administrador (opcional)
                </label>
                <textarea
                  rows={2}
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  placeholder="Ej: Deseo abrir cupo para jugar tablas y marcas..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white outline-none focus:border-amber-400 resize-none"
                />
              </div>

              {/* Verificación reCAPTCHA con imágenes */}
              <div className="flex flex-col items-center justify-center pt-2">
                <RecaptchaWidget
                  onVerificado={(t) => setRecaptchaToken(t)}
                  onExpirado={() => setRecaptchaToken(null)}
                />
              </div>

              {/* Botón de envío */}
              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={guardando || !recaptchaToken}
                  className="w-full bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black py-2.5 text-xs uppercase tracking-wider shadow-lg transition-transform active:scale-95 disabled:opacity-50"
                >
                  {guardando ? "Enviando solicitud..." : "🚀 Enviar Solicitud y Notificar"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
