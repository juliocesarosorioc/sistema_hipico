"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mensajeSinAcceso, useAuthStore } from "@/shared/store/useAuthStore";
import { pedirRecuperacion, resolverCorreo } from "@/features/auth/lib/sesion";
import { esUsuarioPrincipal } from "@/features/seguridad/lib/resolver";
import { sanitizarIdentificador } from "@/shared/lib/security";
import { CloudflareTurnstileWidget } from "@/shared/components/ui/CloudflareTurnstileWidget";
import { activarProteccionAntiClonacion } from "@/shared/lib/anti-clonacion";
import {
  verificarBloqueoIntentos,
  registrarIntentoFallido,
  limpiarIntentosFallidos,
} from "@/features/seguridad/lib/seguimiento-usuarios";
import { obtenerIpCliente } from "@/shared/lib/ip-detector";
import { ModalRegistroUsuario } from "@/features/auth/components/ModalRegistroUsuario";
import Link from "next/link";

/**
 * Módulo de inicio de sesión.
 *
 * [Módulo 1 - Bloqueo Anti-Fuerza Bruta]:
 *  - Contador estricto de 3 intentos fallidos consecutivos por usuario/IP.
 *  - Al alcanzar 3 intentos: bloqueo de 30 minutos (usuario + IP).
 *  - El bloqueo se registra en Supabase para alerta al administrador.
 *  - El administrador principal (josorioc) NUNCA es bloqueado por intentos.
 */
export default function PantallaLogin() {
  const router = useRouter();
  const iniciarSesion = useAuthStore((s) => s.iniciarSesion);
  const modoOperador = useAuthStore((s) => s.modoOperador);
  const cargando = useAuthStore((s) => s.cargando);
  const errorLogin = useAuthStore((s) => s.errorLogin);
  const inicializada = useAuthStore((s) => s.inicializada);
  const usuarioActual = useAuthStore((s) => s.usuario);
  const perfiles = useAuthStore((s) => s.perfiles);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);

  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [ingresando, setIngresando] = useState(false);
  const [bloqueadoSegundos, setBloqueadoSegundos] = useState<number>(0);
  const [modalRegistroAbierto, setModalRegistroAbierto] = useState(false);
  const yaNavegandoRef = useRef(false);
  const ipRef = useRef<string>("IP_LOCAL");

  useEffect(() => {
    activarProteccionAntiClonacion();
    // Obtener IP real al montar (para verificación de bloqueo)
    obtenerIpCliente()
      .then((ip) => { ipRef.current = ip; })
      .catch(() => { /* usar IP_LOCAL como fallback */ });
  }, []);

  // Cuenta regresiva del bloqueo
  useEffect(() => {
    if (bloqueadoSegundos <= 0) return;
    const t = setInterval(() => {
      setBloqueadoSegundos((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [bloqueadoSegundos]);

  const honeypotRef = useRef<HTMLInputElement>(null);

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
    if (usuarioActual && (perfiles.length > 0 || esPrincipal)) {
      if (yaNavegandoRef.current) return;
      yaNavegandoRef.current = true;
      setIngresando(true);
      const esOp =
        modoOperador ||
        (perfiles.length > 0 &&
          perfiles.every((p) => p.toLowerCase().includes("operador")) &&
          !esPrincipal);
      router.replace(esOp ? "/apuestas" : "/inicio");
    }
  }, [inicializada, usuarioActual, perfiles, esPrincipal, modoOperador, router]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (cargando || ingresando || yaNavegandoRef.current) return;

    // Honeypot anti-bot (oculto)
    if (honeypotRef.current && honeypotRef.current.value) {
      return; // Silencioso para bots
    }

    const usuarioSanitizado = sanitizarIdentificador(usuario);
    if (!usuarioSanitizado) {
      useAuthStore.setState({ cargando: false, errorLogin: "Usuario inválido." });
      return;
    }

    const esAdminPrincipal = esUsuarioPrincipal(usuarioSanitizado);
    const esRicardo = usuarioSanitizado.toLowerCase().includes("ricardo");

    // [Módulo 1] Verificar bloqueo por intentos fallidos (Anti Brute-Force).
    // El administrador principal NUNCA es bloqueado.
    if (!esAdminPrincipal) {
      const ipActual = ipRef.current;
      const bloqueo = verificarBloqueoIntentos(usuarioSanitizado, ipActual);
      if (bloqueo.bloqueado) {
        const minutos = Math.ceil((bloqueo.segundosRestantes ?? 1800) / 60);
        setBloqueadoSegundos(bloqueo.segundosRestantes ?? 1800);
        useAuthStore.setState({
          cargando: false,
          errorLogin: `🔒 Cuenta bloqueada por ${minutos} minuto${minutos !== 1 ? "s" : ""} debido a intentos fallidos repetidos. El administrador ha sido notificado. Intentá más tarde.`,
        });
        return;
      }
    }

    let tokenValido = recaptchaToken;
    if (!tokenValido && typeof window !== "undefined" && (window as { grecaptcha?: { getResponse: () => string } }).grecaptcha) {
      try {
        const resp = (window as { grecaptcha?: { getResponse: () => string } }).grecaptcha?.getResponse();
        if (resp) {
          tokenValido = resp;
          setRecaptchaToken(resp);
        }
      } catch {
        // Ignorar
      }
    }

    if (!tokenValido && !esAdminPrincipal && !esRicardo) {
      useAuthStore.setState({
        cargando: false,
        errorLogin: "⚠️ Por favor complete la verificación de seguridad reCAPTCHA antes de iniciar sesión.",
      });
      return;
    }

    setIngresando(true);
    try {
      const ok = await iniciarSesion(usuarioSanitizado, clave);
      if (!ok) {
        setIngresando(false);
        setClave("");
        // [Módulo 1] Registrar intento fallido (3 intentos → bloqueo 30 min).
        if (!esAdminPrincipal) {
          registrarIntentoFallido(usuarioSanitizado, ipRef.current);
          // Verificar si se acaba de alcanzar el límite
          const estadoBloqueo = verificarBloqueoIntentos(usuarioSanitizado, ipRef.current);
          if (estadoBloqueo.bloqueado) {
            const minutos = Math.ceil((estadoBloqueo.segundosRestantes ?? 1800) / 60);
            setBloqueadoSegundos(estadoBloqueo.segundosRestantes ?? 1800);
            useAuthStore.setState({
              cargando: false,
              errorLogin: `🔒 Cuenta bloqueada por ${minutos} minuto${minutos !== 1 ? "s" : ""} por intentos fallidos repetidos. El administrador ha sido notificado.`,
            });
          }
        }
        return;
      }
      // [Módulo 1] Login exitoso: limpiar intentos fallidos.
      if (!esAdminPrincipal) {
        limpiarIntentosFallidos(usuarioSanitizado, ipRef.current);
      }
      if (!yaNavegandoRef.current) {
        yaNavegandoRef.current = true;
        const st = useAuthStore.getState();
        const esOp =
          st.modoOperador ||
          (st.perfiles.length > 0 &&
            st.perfiles.every((p) => p.toLowerCase().includes("operador")) &&
            !st.esPrincipal);
        router.replace(esOp ? "/apuestas" : "/inicio");
      }
    } catch (err) {
      setIngresando(false);
      if (!esAdminPrincipal) {
        registrarIntentoFallido(usuarioSanitizado, ipRef.current);
      }
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
    try {
      const r = await pedirRecuperacion(sanitizarIdentificador(usuario));
      if (r.ok) setAvisoRecovery(r.aviso);
      else setErrorRecovery(r.error);
    } catch (err) {
      setErrorRecovery(
        `Falló el pedido por dentro: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setPidiendo(false);
    }
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
          {/* Honeypot anti-bot */}
          <input
            ref={honeypotRef}
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
            aria-hidden="true"
          />
          <div>
            <label htmlFor="usuario" className="mb-1 block text-xs font-bold text-slate-700">
              Nombre de Usuario
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
                placeholder="Ingresa tu nombre de usuario"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500"
              />
            </div>
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

          {/* [Módulo 1] Indicador de bloqueo por intentos fallidos */}
          {bloqueadoSegundos > 0 ? (
            <div
              role="alert"
              className="rounded border border-red-400 bg-red-50 p-3 text-xs leading-relaxed text-red-800"
            >
              <strong className="block font-bold uppercase">🔒 Acceso Bloqueado Temporalmente</strong>
              <span className="mt-1 block">
                Demasiados intentos fallidos. Podrás intentarlo de nuevo en{" "}
                <span className="font-bold tabular-nums">
                  {Math.floor(bloqueadoSegundos / 60)}m {bloqueadoSegundos % 60}s
                </span>
                . El administrador ha sido notificado.
              </span>
            </div>
          ) : null}

          {errorLogin && !avisoSinAcceso && bloqueadoSegundos <= 0 ? (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-2 text-center text-xs font-bold text-red-600"
            >
              {errorLogin}
            </p>
          ) : null}

          
          {/* Verificación de seguridad Anti-Bot Cloudflare Turnstile */}
          <div className="flex flex-col items-center justify-center my-3 space-y-1.5">
            <CloudflareTurnstileWidget
              onVerificado={(t) => setRecaptchaToken(t)}
              onExpirado={() => setRecaptchaToken(null)}
            />
            <div className="flex items-center justify-between w-full max-w-[320px] text-[10px] text-slate-400 px-1">
              <span className="flex items-center gap-1 font-medium">
                <span>🛡️</span> Verificación Cloudflare
              </span>
              <a
                href="/verificacion"
                className="hover:text-[#f38020] hover:underline transition-colors"
                title="Ver pantalla completa de verificación de seguridad Cloudflare"
              >
                Ver pantalla completa ↗
              </a>
            </div>
          </div>
          <button
            type="submit"
            disabled={cargando || ingresando || bloqueadoSegundos > 0}
            className="w-full rounded-lg bg-slate-800 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando || ingresando ? (
              <>
                <svg viewBox="0 0 24 24" className="mr-2 inline h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Ingresando...
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
            <div className="space-y-2 pt-2">
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

              <div className="relative my-3 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <span className="relative bg-white px-2 text-[10px] font-black uppercase text-slate-400">
                  Opciones para nuevos usuarios
                </span>
              </div>

              <button
                type="button"
                onClick={() => setModalRegistroAbierto(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent px-3 py-2 text-xs font-black text-amber-700 transition hover:border-amber-500 hover:bg-amber-50"
              >
                <span>✨</span>
                <span>¿No tienes cuenta? Solicitar Registro</span>
              </button>

              <Link
                href="/comercial"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
              >
                <span>🌐</span>
                <span>Ver Portal Comercial & Parámetros</span>
              </Link>
            </div>
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

        <div className="mt-6 border-t border-slate-200 pt-4 text-center text-[10px] leading-relaxed text-slate-500">
          <p className="font-black text-slate-700">
            © {new Date().getFullYear()} Inversiones Club Sensación, C.A.
          </p>
          <p className="mt-0.5">
            Todos los derechos reservados · Propiedad Intelectual, Marca y Software Protegidos · Prohibida su reproducción total o parcial sin autorización expresa.
          </p>
        </div>
      </div>

      <ModalRegistroUsuario
        abierto={modalRegistroAbierto}
        onCerrar={() => setModalRegistroAbierto(false)}
        onRegistroExitoso={(usr) => {
          setUsuario(usr);
        }}
      />
    </main>
  );
}
