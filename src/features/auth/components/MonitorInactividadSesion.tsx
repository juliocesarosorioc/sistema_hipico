"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { cerrarSesion, rutaLoginConBasePath } from "@/features/auth/lib/sesion";
import { esRutaPublica } from "@/features/seguridad/lib/capacidades";

/**
 * REGLAS DE TIEMPO DE INACTIVIDAD BANCARIA:
 * - Inactividad total permitida: 15 minutos (900.000 ms).
 * - Ventana de aviso previo con cuenta regresiva: 1 minuto (60.000 ms).
 * - Momento en que aparece el aviso: tras 14 minutos de inactividad (840.000 ms).
 */
const TIEMPO_INACTIVIDAD_MS = 15 * 60 * 1000; // 15 minutos = 900.000 ms
const TIEMPO_AVISO_PREVIO_MS = 60 * 1000; // 1 minuto = 60.000 ms
const UMBRAL_AVISO_MS = TIEMPO_INACTIVIDAD_MS - TIEMPO_AVISO_PREVIO_MS; // 14 minutos = 840.000 ms
const CLAVE_STORAGE_ACTIVIDAD = "club_ultima_actividad";

export function MonitorInactividadSesion() {
  const router = useRouter();
  const pathname = usePathname();
  const usuario = useAuthStore((s) => s.usuario);
  const salirStore = useAuthStore((s) => s.salir);

  const [montado, setMontado] = useState(false);
  const [mostrarAviso, setMostrarAviso] = useState(false);
  const [segundosRestantes, setSegundosRestantes] = useState(60);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  const ultimaActividadRef = useRef<number>(Date.now());
  const avisoAbiertoRef = useRef<boolean>(false);
  const cerrandoRef = useRef<boolean>(false);

  // Evitar SSR issues con createPortal
  useEffect(() => {
    setMontado(true);
    ultimaActividadRef.current = Date.now();
    try {
      localStorage.setItem(CLAVE_STORAGE_ACTIVIDAD, String(Date.now()));
    } catch {
      /* ignore */
    }
  }, []);

  // Función para cerrar la sesión de forma inmediata y limpia
  const ejecutarCierrePorInactividad = async () => {
    if (cerrandoRef.current) return;
    cerrandoRef.current = true;
    setCerrandoSesion(true);

    try {
      await cerrarSesion();
      await salirStore();
    } catch {
      /* no bloquear logout si falla red */
    } finally {
      if (typeof window !== "undefined") {
        window.location.replace(rutaLoginConBasePath());
      } else {
        router.replace("/login");
      }
    }
  };

  // Función para resetear el contador de inactividad
  const continuarSesion = () => {
    const ahora = Date.now();
    ultimaActividadRef.current = ahora;
    avisoAbiertoRef.current = false;
    setMostrarAviso(false);
    setSegundosRestantes(60);

    try {
      localStorage.setItem(CLAVE_STORAGE_ACTIVIDAD, String(ahora));
    } catch {
      /* ignore */
    }
  };

  // Escuchar eventos de interacción del usuario para mantener la sesión activa
  useEffect(() => {
    if (!usuario || esRutaPublica(pathname)) return;

    let ultimoRegistro = Date.now();

    const alInteractuar = () => {
      const ahora = Date.now();
      // Si el modal de aviso está en pantalla, no lo cerramos con un simple movimiento
      // de ratón accidental; el usuario debe presionar "Continuar" para confirmar presencia
      if (avisoAbiertoRef.current) return;

      // Throttle a 2.5 segundos para no sobrecargar el hilo de render
      if (ahora - ultimoRegistro > 2500) {
        ultimoRegistro = ahora;
        ultimaActividadRef.current = ahora;
        try {
          localStorage.setItem(CLAVE_STORAGE_ACTIVIDAD, String(ahora));
        } catch {
          /* ignore */
        }
      }
    };

    const eventos = ["mousedown", "keydown", "touchstart", "scroll", "click", "wheel"];
    eventos.forEach((ev) => window.addEventListener(ev, alInteractuar, { passive: true }));

    // Sincronizar actividad entre múltiples pestañas del mismo navegador
    const alCambiarStorage = (e: StorageEvent) => {
      if (e.key === CLAVE_STORAGE_ACTIVIDAD && e.newValue) {
        const timestamp = parseInt(e.newValue, 10);
        if (!Number.isNaN(timestamp) && timestamp > ultimaActividadRef.current) {
          ultimaActividadRef.current = timestamp;
          if (avisoAbiertoRef.current) {
            avisoAbiertoRef.current = false;
            setMostrarAviso(false);
            setSegundosRestantes(60);
          }
        }
      }
    };
    window.addEventListener("storage", alCambiarStorage);

    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, alInteractuar));
      window.removeEventListener("storage", alCambiarStorage);
    };
  }, [usuario, pathname]);

  // Ciclo de verificación cada 1 segundo
  useEffect(() => {
    if (!usuario || esRutaPublica(pathname)) {
      setMostrarAviso(false);
      return;
    }

    const timer = setInterval(() => {
      if (cerrandoRef.current) return;

      const ahora = Date.now();
      // Leer también si otra pestaña actualizó la actividad recientemente
      let timestampLocal = ultimaActividadRef.current;
      try {
        const guardado = localStorage.getItem(CLAVE_STORAGE_ACTIVIDAD);
        if (guardado) {
          const num = parseInt(guardado, 10);
          if (!Number.isNaN(num) && num > timestampLocal) {
            timestampLocal = num;
            ultimaActividadRef.current = num;
          }
        }
      } catch {
        /* ignore */
      }

      const inactividadMs = ahora - timestampLocal;

      // 1. Si superó los 15 minutos completos: Cierre obligatorio inmediato
      if (inactividadMs >= TIEMPO_INACTIVIDAD_MS) {
        void ejecutarCierrePorInactividad();
        return;
      }

      // 2. Si superó los 14 minutos: Mostrar modal con cuenta regresiva del último minuto
      if (inactividadMs >= UMBRAL_AVISO_MS) {
        const restantesMs = Math.max(0, TIEMPO_INACTIVIDAD_MS - inactividadMs);
        const segs = Math.max(1, Math.ceil(restantesMs / 1000));
        setSegundosRestantes(segs);
        if (!avisoAbiertoRef.current) {
          avisoAbiertoRef.current = true;
          setMostrarAviso(true);
        }
      } else {
        if (avisoAbiertoRef.current) {
          avisoAbiertoRef.current = false;
          setMostrarAviso(false);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [usuario, pathname]);

  // Atajos de teclado en el modal de aviso
  useEffect(() => {
    if (!mostrarAviso) return;

    const alPulsarTecla = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        continuarSesion();
      } else if (e.key === "Escape") {
        e.preventDefault();
        void ejecutarCierrePorInactividad();
      }
    };

    window.addEventListener("keydown", alPulsarTecla);
    return () => window.removeEventListener("keydown", alPulsarTecla);
  }, [mostrarAviso]);

  if (!montado || !mostrarAviso || !usuario || esRutaPublica(pathname)) {
    return null;
  }

  // Renderizado mediante Portal a nivel de document.body con z-index absoluto
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="titulo-inactividad"
      aria-describedby="desc-inactividad"
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border-2 border-amber-500/60 bg-[var(--app-surface)] text-[var(--app-text)] shadow-2xl ring-1 ring-white/10 animate-in zoom-in-95 duration-200">
        {/* Barra superior de advertencia */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-3 text-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider">
            <span className="text-base animate-pulse">⚠️</span>
            <span>Aviso de Inactividad de Sesión</span>
          </div>
          <span className="rounded-full bg-slate-950/20 px-2 py-0.5 text-[10px] font-black uppercase text-slate-950">
            Seguridad
          </span>
        </div>

        {/* Cuerpo del Diálogo */}
        <div className="p-6 text-center space-y-4">
          {/* Reloj con animación de pulso */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-amber-500/40 bg-amber-500/10 shadow-inner">
            <span className="font-mono text-3xl font-black text-amber-500 tabular-nums">
              {segundosRestantes}s
            </span>
          </div>

          <div className="space-y-1.5">
            <h2 id="titulo-inactividad" className="text-lg font-black tracking-tight text-[var(--app-text)]">
              ¿Deseas continuar en el sistema?
            </h2>
            <p id="desc-inactividad" className="text-xs text-[var(--app-text-muted)] leading-relaxed max-w-sm mx-auto">
              Se detectaron <strong className="text-[var(--app-text)]">14 minutos de inactividad</strong>. Por protección bancaria y de saldos, la sesión se cerrará automáticamente en{" "}
              <span className="font-bold text-amber-500">{segundosRestantes} segundos</span>.
            </p>
          </div>

          {/* Barra de progreso regresiva visual */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/60 border border-slate-700/60">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-red-500 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${(segundosRestantes / 60) * 100}%` }}
            />
          </div>

          {/* Botones de Acción */}
          <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
            <button
              type="button"
              autoFocus
              disabled={cerrandoSesion}
              onClick={continuarSesion}
              className="w-full flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-950 shadow-lg shadow-emerald-500/25 hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              <span>✅ Continuar Sesión</span>
            </button>

            <button
              type="button"
              disabled={cerrandoSesion}
              onClick={() => void ejecutarCierrePorInactividad()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-bold text-red-500 hover:bg-red-500 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            >
              <span>⏻ Cerrar Ahora</span>
            </button>
          </div>

          <p className="text-[10px] text-[var(--app-text-dim)] pt-1">
            Presiona <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-[9px] font-mono">Enter</kbd> para mantenerte conectado o <kbd className="px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-[9px] font-mono">Esc</kbd> para salir.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MonitorInactividadSesion;
