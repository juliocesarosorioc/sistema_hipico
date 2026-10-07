"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mensajeSinAcceso, useAuthStore } from "@/store/useAuthStore";
import { pedirRecuperacion, resolverCorreo, sesionActual } from "@/lib/auth/sesion";

/**
 * Módulo de inicio de sesión.
 *
 * La contraseña NO se valida en el navegador: se envía a Supabase Auth y lo que
 * queda en el cliente es la sesión firmada que emite el servidor. El operador
 * escribe su usuario corto; `resolverCorreo` lo traduce al correo de alta
 * usando NEXT_PUBLIC_AUTH_DOMAIN.
 *
 * El formulario NO muestra ningún usuario de ejemplo, ni como placeholder ni
 * en el texto de ayuda: en una pantalla compartida o con el monitor de un
 * cliente al lado, el nombre del dueño del sistema es información que no
 * debería estar a la vista.
 *
 * Pendiente (queda en PLANIFICACION.md):
 *  - reCAPTCHA / Turnstile en el envío del formulario. No se puede verificar
 *    el token sin un servidor: el build es `output: "export"` y no hay API
 *    routes. Poner el widget sin validación sería security theatre.
 */
export default function PantallaLogin() {
  const router = useRouter();
  const iniciarSesion = useAuthStore((s) => s.iniciarSesion);
  const cargando = useAuthStore((s) => s.cargando);
  const errorLogin = useAuthStore((s) => s.errorLogin);
  const inicializada = useAuthStore((s) => s.inicializada);
  const usuarioActual = useAuthStore((s) => s.usuario);
  const perfiles = useAuthStore((s) => s.perfiles);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);

  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);

  // Recuperación: dos vistas en la misma pantalla en vez de una página aparte,
  // para no mandar al operador a otra URL solo para pedir un correo.
  const [pidiendo, setPidiendo] = useState(false);
  const [recuperando, setRecuperando] = useState(false);
  const [avisoRecovery, setAvisoRecovery] = useState<string | null>(null);
  const [errorRecovery, setErrorRecovery] = useState<string | null>(null);

  /**
   * El motivo con el que el middleware expulsó, si fue con motivo.
   *
   * Se lee de `location.search` y no de `useSearchParams` porque el build
   * estático no admite ese hook sin un límite de Suspensión, y agregarlo por
   * una query sería cambiar la arquitectura de la pantalla.
   */
  const [motivoExpulsion, setMotivoExpulsion] = useState<string | null>(null);
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("motivo");
    if (m) setMotivoExpulsion(m);
  }, []);

  /** El correo contra el que se va a verificar, ya con el dominio resuelto. */
  const correoResuelto = useMemo(() => {
    const id = usuario.trim();
    if (!id) return "";
    return id.includes("@") ? id.toLowerCase() : resolverCorreo(id);
  }, [usuario]);

  /**
   * Aviso de "entró pero no tiene nada". El middleware manda acá con
   * `?motivo=sin-accesos` cuando la sesión es válida pero el usuario no tiene
   * ni un tipo ni una capacidad: sin este texto el operador veía el formulario
   * limpio, como si su contraseña hubiera estado mal.
   */
  const avisoSinAcceso = useMemo(() => {
    if (errorLogin && /contraseña es correcta/.test(errorLogin)) return errorLogin;
    if (motivoExpulsion === "sin-accesos") {
      return mensajeSinAcceso(usuario || "tu usuario", false);
    }
    return null;
  }, [errorLogin, motivoExpulsion, usuario]);

  // Si ya hay sesión abierta no tiene sentido quedarse acá. Se espera a que el
  // store termine de verificar ANTES de decidir: si se comprueba el store antes
  // de `inicializada`, su `usuario` todavía está vacío y la comprobación da
  // "sin sesión" aunque la haya. Ese desajuste era el titileo: entraba igual,
  // volvía a redirigir, y el formulario parpadeaba.
  //
  // Y se exige que el usuario tenga ALGO con qué entrar, no solo que haya
  // sesión: quien entró sin tipo asignado es rechazado por el middleware, y
  // mandarlo al escritorio lo devolvía al login en bucle infinito. Aquí se
  // queda, leyendo el aviso.
  //
  // NO se llama a `salir()` para "limpiar" nada. El store ya arranca sin
  // identidad, y `salir()` dispara `signOut()`, que hace que `AuthBootstrap`
  // reaccione con SIGNED_OUT y vuelva a llamar `salir()`: un bucle que
  // re-renderizaba el formulario sin parar y dejaba los campos imposibles de
  // seleccionar. La puerta no tiene que desloguear a nadie.
  useEffect(() => {
    if (!inicializada) return;
    if (usuarioActual && (perfiles.length > 0 || esPrincipal)) router.replace("/dashboard");
  }, [inicializada, usuarioActual, perfiles.length, esPrincipal, router]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (cargando) return;
    // Cualquier excepción que se escape del store se traduce a un mensaje
    // visible. Antes el `await` era directo: si algo fallaba por dentro, el
    // `catch` no existía, el formulario no mostraba nada y el botón se quedaba
    // en "Autenticando..." para siempre.
    try {
      const ok = await iniciarSesion(usuario, clave);
      if (!ok) {
        setClave("");
        return;
      }
      // El destino normal es el Dashboard, que es donde aterriza el sistema.
      router.replace("/dashboard");
    } catch (err) {
      useAuthStore.setState({
        cargando: false,
        errorLogin: `Falló el inicio de sesión por dentro: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const pedirRecuperacion_ = async (e: FormEvent) => {
    e.preventDefault();
    if (pidiendo) return;
    setPidiendo(true);
    setErrorRecovery(null);
    setAvisoRecovery(null);
    const r = await pedirRecuperacion(usuario);
    setPidiendo(false);
    if (r.ok) setAvisoRecovery(r.aviso);
    else setErrorRecovery(r.error);
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
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-600 text-2xl text-white shadow-lg">
            {/* Moneda: replica el icono de monedas del login legacy (html/index.html). */}
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
              <path d="M7 6h1v4" />
              <path d="M16.71 13.88l.7.71-2.82 2.82" />
            </svg>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-wide text-slate-800">Club del Dinero</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">Panel Administrativo y Contable</p>
        </div>

        <form onSubmit={enviar} className="space-y-5" noValidate>
          <div>
            <label htmlFor="usuario" className="mb-1 block text-xs font-bold text-slate-700">
              Usuario
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                {/* Icono de usuario del login legacy. */}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                id="usuario"
                name="username"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="Usuario"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
              />
            </div>
            {/* Con qué correo se verifica realmente.
             *
             * El login acepta el usuario corto y le pega el dominio de
             * `NEXT_PUBLIC_AUTH_DOMAIN`. Si ese dominio no es el con el que se
             * dio de alta la cuenta en Supabase, el ingreso falla siempre y el
             * mensaje dice "usuario o contraseña incorrectos", que manda a
             * revisar la contraseña cuando el problema es otro. Mostrar el
             * correo resuelto lo deja a la vista sin pedirle nada a nadie. */}
            {correoResuelto ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Se verifica como{" "}
                <span className="font-mono font-bold text-slate-600">{correoResuelto}</span>
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="clave" className="mb-1 block text-xs font-bold text-slate-700">
              Contrase&ntilde;a
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                {/* Icono de candado del login legacy. */}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="clave"
                name="password"
                type={verClave ? "text" : "password"}
                autoComplete="current-password"
                required
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-10 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                tabIndex={-1}
                aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                title={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-emerald-600 focus:outline-none"
              >
                {/* Ojo / ojo tachado: alterna con la visibilidad de la clave. */}
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

          {avisoSinAcceso ? (
            <div
              role="alert"
              className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800"
            >
              <strong className="block font-bold uppercase">Sesión iniciada sin acceso</strong>
              <span className="mt-1 block">{avisoSinAcceso}</span>
            </div>
          ) : null}

          {errorLogin && !avisoSinAcceso ? (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-2 text-center text-xs font-bold text-red-600"
            >
              {errorLogin}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-lg bg-slate-800 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando ? (
              <>
                <svg viewBox="0 0 24 24" className="mr-2 inline h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Autenticando...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="mr-2 inline h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                Iniciar Sesi&oacute;n
              </>
            )}
          </button>

          {!recuperando ? (
            <button
              type="button"
              onClick={() => {
                setRecuperando(true);
                setErrorRecovery(null);
                setAvisoRecovery(null);
              }}
              className="w-full text-center text-xs font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-emerald-600 hover:underline focus:outline-none focus-visible:underline"
            >
              Olvid&eacute; mi contrase&ntilde;a
            </button>
          ) : null}
        </form>

        {recuperando ? (
          <form
            onSubmit={pedirRecuperacion_}
            className="mt-6 space-y-4 border-t border-slate-200 pt-6"
            noValidate
          >
            <p className="text-xs leading-relaxed text-slate-600">
              Escrib&iacute; tu usuario y te mandamos un correo con un enlace para poner una
             contrase&ntilde;a nueva. El enlace sirve una sola vez y vence despu&eacute;s de un rato.
            </p>

            <div>
              <label htmlFor="usuario-recuperacion" className="mb-1 block text-xs font-bold text-slate-700">
                Usuario
              </label>
              <input
                id="usuario-recuperacion"
                name="username-recovery"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="Usuario"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
              />
            </div>

            {avisoRecovery ? (
              <p
                role="status"
                className="rounded border border-emerald-200 bg-emerald-50 p-2 text-center text-xs font-bold text-emerald-700"
              >
                {avisoRecovery}
              </p>
            ) : null}
            {errorRecovery ? (
              <p
                role="alert"
                className="rounded border border-red-200 bg-red-50 p-2 text-center text-xs font-bold text-red-600"
              >
                {errorRecovery}
              </p>
            ) : null}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={pidiendo}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pidiendo ? "Enviando..." : "Enviar enlace"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecuperando(false);
                  setAvisoRecovery(null);
                  setErrorRecovery(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none"
              >
                Volver
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  );
}
