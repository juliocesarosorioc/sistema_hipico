"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { emitirToast } from "@/shared/lib/mensajeria";
import { RecaptchaWidget } from "@/shared/components/ui/RecaptchaWidget";
import { useTema } from "@/shared/hooks/useTema";
import Link from "next/link";

export function ModalLoginRapido({
  abierto,
  onCerrar,
  onAbrirRegistro,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onAbrirRegistro?: () => void;
}) {
  const router = useRouter();
  const { tema } = useTema();
  const iniciarSesion = useAuthStore((s) => s.iniciarSesion);
  const cargando = useAuthStore((s) => s.cargando);
  const errorLogin = useAuthStore((s) => s.errorLogin);

  const esClaro = tema === "claro";
  const esAstigmatismo = tema === "astigmatismo";
  const esRojo = tema === "rojo";
  const esVerde = tema === "verde";
  const esAzul = tema === "azul";

  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  if (!abierto) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave.trim() || procesando || cargando) return;

    if (!recaptchaToken) {
      emitirToast("⚠️ Por favor completa la verificación reCAPTCHA con imágenes antes de continuar.", "warning");
      return;
    }

    setProcesando(true);
    try {
      const exito = await iniciarSesion(usuario.trim(), clave);
      if (exito) {
        emitirToast("¡Bienvenido! Sesión iniciada con éxito.", "success");
        onCerrar();
        const perfiles = useAuthStore.getState().perfiles;
        const modoOperador = useAuthStore.getState().modoOperador;
        const esOp =
          modoOperador ||
          (perfiles.length > 0 && perfiles.every((p) => p.toLowerCase().includes("operador")));
        router.push(esOp ? "/apuestas" : "/inicio");
      } else {
        emitirToast("Usuario o contraseña incorrectos.", "error");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al iniciar sesión.";
      emitirToast(msg, "error");
    } finally {
      setProcesando(false);
    }
  };

  // Clases dinámicas según el tema activo
  const modalBg = esClaro
    ? "bg-white text-slate-900 border-slate-200 shadow-2xl"
    : esAstigmatismo
    ? "bg-[#1d1914] text-[#f5ede1] border-[#4d4234] shadow-2xl"
    : esRojo
    ? "bg-[#140608] text-white border-red-900/60 shadow-2xl"
    : esVerde
    ? "bg-[#05180f] text-white border-emerald-900/60 shadow-2xl"
    : esAzul
    ? "bg-[#081226] text-white border-blue-900/60 shadow-2xl"
    : "bg-slate-950 text-white border-amber-500/30 shadow-2xl";

  const cabeceraBg = esClaro
    ? "bg-slate-50 border-b border-slate-200 text-slate-900"
    : esAstigmatismo
    ? "bg-gradient-to-r from-[#26211a] to-[#1d1914] border-b border-[#4d4234] text-[#f5ede1]"
    : esRojo
    ? "bg-gradient-to-r from-[#2c0e14] to-[#140608] border-b border-red-900/50 text-white"
    : esVerde
    ? "bg-gradient-to-r from-[#0c3620] to-[#05180f] border-b border-emerald-900/50 text-white"
    : esAzul
    ? "bg-gradient-to-r from-[#10274f] to-[#081226] border-b border-blue-900/50 text-white"
    : "bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/60 border-b border-amber-500/20 text-white";

  const inputClase = esClaro
    ? "bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white"
    : esAstigmatismo
    ? "bg-[#26211a] border-[#4d4234] text-[#f5ede1] placeholder-[#c9bea9]/50 focus:border-[#d4a373]"
    : esRojo
    ? "bg-[#2c0e14]/50 border-red-900 text-white placeholder-red-300/40 focus:border-red-500"
    : esVerde
    ? "bg-[#0c3620]/50 border-emerald-900 text-white placeholder-emerald-300/40 focus:border-emerald-500"
    : esAzul
    ? "bg-[#10274f]/50 border-blue-900 text-white placeholder-blue-300/40 focus:border-blue-500"
    : "bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-amber-400";

  const botonPrincipal = esClaro
    ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20"
    : esAstigmatismo
    ? "bg-[#d4a373] hover:bg-[#e0b589] text-[#1c1813] font-black shadow-lg shadow-[#d4a373]/20"
    : esRojo
    ? "bg-gradient-to-r from-red-600 to-red-500 hover:brightness-110 text-white shadow-lg shadow-red-600/20"
    : esVerde
    ? "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:brightness-110 text-white shadow-lg shadow-emerald-600/20"
    : esAzul
    ? "bg-gradient-to-r from-blue-600 to-blue-500 hover:brightness-110 text-white shadow-lg shadow-blue-600/20"
    : "bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:brightness-110 text-slate-950 font-black shadow-lg shadow-amber-500/20";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className={`relative w-full max-w-md overflow-hidden rounded-3xl border transition-colors ${modalBg}`}>
        {/* Cabecera Sistema Hípico */}
        <div className={`relative p-6 border-b transition-colors ${cabeceraBg}`}>
          <button
            type="button"
            onClick={onCerrar}
            className={`absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center transition ${
              esClaro ? "bg-slate-200 text-slate-600 hover:bg-slate-300" : "bg-white/10 text-slate-400 hover:text-white"
            }`}
          >
            ✕
          </button>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🏇</span>
            <span className={`text-xs font-black uppercase tracking-widest ${
              esClaro ? "text-blue-600" : esAstigmatismo ? "text-[#d4a373]" : "text-amber-400"
            }`}>
              Sistema Hípico · Acceso
            </span>
          </div>
          <h2 className="text-xl font-black tracking-tight">
            Iniciar Sesión
          </h2>
          <p className={`text-xs mt-1 ${esClaro ? "text-slate-500" : "text-slate-400"}`}>
            Ingresa a tu cuenta para jugar tablas, marcas y remates en vivo.
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorLogin && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 font-bold">
              ⚠️ {errorLogin}
            </div>
          )}

          <div>
            <label className={`block text-[11px] font-black uppercase mb-1 ${esClaro ? "text-slate-700" : "text-slate-400"}`}>
              Usuario o Correo
            </label>
            <input
              type="text"
              required
              autoFocus
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ej: operador1 / carlos@correo.com"
              className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition ${inputClase}`}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={`block text-[11px] font-black uppercase ${esClaro ? "text-slate-700" : "text-slate-400"}`}>
                Contraseña
              </label>
              <Link
                href="/reset-password"
                onClick={onCerrar}
                className={`text-[11px] hover:underline ${esClaro ? "text-blue-600 font-bold" : "text-amber-400"}`}
              >
                ¿Olvidaste tu clave?
              </Link>
            </div>
            <div className="relative">
              <input
                type={verClave ? "text" : "password"}
                required
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="••••••••"
                className={`w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition pr-10 ${inputClase}`}
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                {verClave ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Verificación reCAPTCHA con imágenes */}
          <div className="flex flex-col items-center justify-center my-3">
            <RecaptchaWidget
              onVerificado={(t) => setRecaptchaToken(t)}
              onExpirado={() => setRecaptchaToken(null)}
            />
            <span className={`text-[10px] mt-1 flex items-center gap-1 font-medium ${esClaro ? "text-slate-500" : "text-slate-400"}`}>
              <span>🛡️</span> Verificación de seguridad reCAPTCHA con imágenes
            </span>
          </div>

          <button
            type="submit"
            disabled={procesando || cargando}
            className={`w-full mt-2 rounded-xl py-3 text-xs font-black uppercase tracking-wider active:scale-95 transition disabled:opacity-50 ${botonPrincipal}`}
          >
            {procesando ? "Verificando credenciales..." : "🚀 Entrar al Sistema"}
          </button>

          {onAbrirRegistro && (
            <div className={`pt-2 text-center border-t text-xs ${
              esClaro ? "border-slate-200 text-slate-500" : "border-slate-800 text-slate-400"
            }`}>
              ¿No tienes una cuenta aún?{" "}
              <button
                type="button"
                onClick={() => {
                  onCerrar();
                  onAbrirRegistro();
                }}
                className={`font-bold hover:underline inline-flex items-center gap-1 ${
                  esClaro ? "text-blue-600" : "text-amber-400"
                }`}
              >
                Regístrate con prueba de 2 semanas →
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
