"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { emitirToast } from "@/shared/lib/mensajeria";
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
  const iniciarSesion = useAuthStore((s) => s.iniciarSesion);
  const cargando = useAuthStore((s) => s.cargando);
  const errorLogin = useAuthStore((s) => s.errorLogin);

  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [procesando, setProcesando] = useState(false);

  if (!abierto) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !clave.trim() || procesando || cargando) return;

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

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/30 bg-slate-950 text-white shadow-2xl">
        {/* Cabecera estilo Betplay */}
        <div className="relative bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/60 p-6 border-b border-amber-500/20">
          <button
            type="button"
            onClick={onCerrar}
            className="absolute top-4 right-4 h-8 w-8 rounded-full bg-slate-800/80 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">🏇</span>
            <span className="text-xs font-black uppercase tracking-widest text-amber-400">
              Club Hípico · Acceso
            </span>
          </div>
          <h2 className="text-xl font-black text-white tracking-tight">
            Iniciar Sesión
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Ingresa a tu cuenta para jugar tablas, marcas y remates en vivo.
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorLogin && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              ⚠️ {errorLogin}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-black uppercase text-slate-400 mb-1">
              Usuario o Correo
            </label>
            <input
              type="text"
              required
              autoFocus
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ej: operador1 / carlos@correo.com"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-black uppercase text-slate-400">
                Contraseña
              </label>
              <Link
                href="/reset-password"
                onClick={onCerrar}
                className="text-[11px] text-amber-400 hover:underline"
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 transition pr-10"
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
              >
                {verClave ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={procesando || cargando}
            className="w-full mt-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 py-3 text-xs font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-amber-500/20 hover:brightness-110 active:scale-95 transition disabled:opacity-50"
          >
            {procesando ? "Verificando credenciales..." : "🚀 Entrar al Sistema"}
          </button>

          {onAbrirRegistro && (
            <div className="pt-2 text-center border-t border-slate-800 text-xs text-slate-400">
              ¿No tienes una cuenta aún?{" "}
              <button
                type="button"
                onClick={() => {
                  onCerrar();
                  onAbrirRegistro();
                }}
                className="font-bold text-amber-400 hover:underline inline-flex items-center gap-1"
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
