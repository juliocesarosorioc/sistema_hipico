"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cambiarClave } from "@/lib/auth/sesion";

/**
 * Puesta de contraseña nueva (la segunda mitad de "Olvidé mi contraseña").
 *
 * Esta página NO es un portal libre: no se puede entrar por URL. Supabase manda
 * al correo un enlace que trae una sesión de recuperación de un solo uso y con
 * vencimiento; sin esa sesión, `updateUser()` no tiene a quién cambiarle la
 * clave. Por eso hay que distinguir "todavía no sé si el enlace sirve" de "el
 * enlace no sirve": al abrirla a mano el estado es desconocido, y recién cuando
 * Supabase responde se puede decir algo.
 *
 * El token nunca se guarda en el navegador ni se manda a ningún backend propio:
 * lo lee el cliente de Supabase desde la URL, igual que la sesión de login.
 */
type Estado = "verificando" | "sin_enlace" | "listo" | "guardado" | "error";

export default function PaginaResetPassword() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("verificando");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    // Se importa acá y no arriba a propósito: el cliente de Supabase lee el
    // token de la URL cuando se inicializa, y este módulo tiene que existir
    // para que esa lectura ocurra.
    let vivo = true;
    (async () => {
      const { supabase } = await import("@/lib/supabase");
      if (!vivo) return;
      if (!supabase) {
        setEstado("error");
        setError("Supabase no está configurado (faltan las variables de entorno).");
        return;
      }
      // Si la URL trae el token, la sesión de recuperación queda en este
      // momento. Si no trae nada, no hay nada que recuperar.
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      if (data.session) setEstado("listo");
      else setEstado("sin_enlace");
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    if (nueva.length < 8) {
      setError("La contraseña nueva tiene que tener al menos 8 caracteres.");
      return;
    }
    if (nueva !== repetida) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setGuardando(true);
    const r = await cambiarClave(nueva);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEstado("guardado");
    setNueva("");
    setRepetida("");
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 font-sans"
      style={{
        backgroundImage: "url('https://www.transparenttextures.com/patterns/cubes.png')",
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-black uppercase tracking-wide text-slate-800">
            Contrase&ntilde;a nueva
          </h1>
        </div>

        {estado === "verificando" ? (
          <p className="py-6 text-center text-sm text-slate-500">Verificando el enlace...</p>
        ) : null}

        {estado === "sin_enlace" ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Esta p&aacute;gina solo funciona desde el enlace que te llega por correo. Si lo
              abriste a mano, o el enlace ya se us&oacute; o venci&oacute;, ped&iacute; uno nuevo
              desde la pantalla de inicio de sesi&oacute;n.
            </p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="w-full rounded-lg bg-slate-800 py-3 text-sm font-bold uppercase tracking-wider text-white shadow transition-colors hover:bg-black"
            >
              Ir al inicio de sesi&oacute;n
            </button>
          </div>
        ) : null}

        {estado === "guardado" ? (
          <div className="space-y-4">
            <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-center text-sm font-bold text-emerald-700">
              Tu nueva contrase&ntilde;a qued&oacute; guardada.
            </p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="w-full rounded-lg bg-slate-800 py-3 text-sm font-bold uppercase tracking-wider text-white shadow transition-colors hover:bg-black"
            >
              Iniciar sesi&oacute;n
            </button>
          </div>
        ) : null}

        {estado === "listo" ? (
          <form onSubmit={enviar} className="space-y-5" noValidate>
            <div>
              <label htmlFor="nueva" className="mb-1 block text-xs font-bold text-slate-700">
                Contrase&ntilde;a nueva
              </label>
              <div className="relative">
                <input
                  id="nueva"
                  name="new-password"
                  type={verClave ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 pr-10 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  tabIndex={-1}
                  aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  title={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-emerald-600 focus:outline-none"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    {verClave ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="repetida" className="mb-1 block text-xs font-bold text-slate-700">
                Repetir la contrase&ntilde;a
              </label>
              <input
                id="repetida"
                name="confirm-password"
                type={verClave ? "text" : "password"}
                autoComplete="new-password"
                required
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
              />
            </div>

            <p className="text-xs text-slate-500">M&iacute;nimo 8 caracteres.</p>

            {error ? (
              <p
                role="alert"
                className="rounded border border-red-200 bg-red-50 p-2 text-center text-xs font-bold text-red-600"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={guardando}
              className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guardando ? "Guardando..." : "Guardar"}
            </button>
          </form>
        ) : null}

        {estado === "error" ? (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-red-600"
          >
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
