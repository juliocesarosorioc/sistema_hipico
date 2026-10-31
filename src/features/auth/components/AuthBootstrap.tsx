"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { esPantallaDeAcceso, esRutaPublica } from "@/features/seguridad/lib/capacidades";
import { sesionActual } from "@/features/auth/lib/sesion";
import {
  registrarLatidoPresencia,
  registrarVisitaPagina,
  registrarAccionUsuario,
  purgarActividadAntigua10Dias,
} from "@/features/seguridad/lib/seguimiento-usuarios";

/**
 * Al montar el SPA siembra la sesión RBAC (permisos en memoria + cookies para
 * el middleware) y vigila la sesión de Supabase: sin sesión válida manda a
 * /login, y al cerrarse (logout o expiración) vuelve a expulsar.
 * Además gestiona la presencia en vivo, el registro de páginas/acciones y la
 * purga automática de actividad cada 10 días.
 */
export function AuthBootstrap() {
  const inicializar = useAuthStore((s) => s.inicializar);
  const salir = useAuthStore((s) => s.salir);
  const miUsuario = useAuthStore((s) => s.usuario);
  const tipoUsuario = useAuthStore((s) => s.tipoUsuario);
  const perfiles = useAuthStore((s) => s.perfiles);
  const miGrupoId = useAuthStore((s) => s.grupoId);
  const router = useRouter();
  const ruta = usePathname();

  useEffect(() => {
    void inicializar();
  }, [inicializar]);

  // Registro de páginas visitadas, latidos de presencia y purga automática cada 10 días
  useEffect(() => {
    if (!miUsuario) return;

    // Registrar visita a la página actual
    registrarVisitaPagina(miUsuario, ruta);

    // Enviar latido de presencia inicial
    void registrarLatidoPresencia({
      usuarioId: miUsuario,
      nombre: miUsuario,
        rol: tipoUsuario?.nombre || perfiles[0] || "Operador",
      grupoId: miGrupoId ? String(miGrupoId) : null,
      paginaActual: ruta,
    });

    // Purgar automáticamente registros con más de 10 días de antigüedad
    void purgarActividadAntigua10Dias();

    // Heartbeat periódico cada 45 segundos
    const timer = setInterval(() => {
      void registrarLatidoPresencia({
        usuarioId: miUsuario,
        nombre: miUsuario,
        rol: tipoUsuario?.nombre || perfiles[0] || "Operador",
        grupoId: miGrupoId ? String(miGrupoId) : null,
        paginaActual: ruta,
      });
    }, 45000);

    return () => clearInterval(timer);
  }, [miUsuario, ruta, tipoUsuario, perfiles, miGrupoId]);

  // Escuchar eventos globales de acciones operativas ejecutadas
  useEffect(() => {
    if (!miUsuario) return;
    const alAccion = (e: Event) => {
      const ce = e as CustomEvent<{ accion: string; detalle?: unknown }>;
      if (ce.detail?.accion) {
        registrarAccionUsuario(miUsuario, ce.detail.accion, ce.detail.detalle as any);
      }
    };
    window.addEventListener("hipico:accion", alAccion);
    return () => window.removeEventListener("hipico:accion", alAccion);
  }, [miUsuario]);

  useEffect(() => {
    let vivo = true;

    // El acceso va ANTES de cualquier visualización: si no hay sesión de
    // Supabase, se expulsa a /login sin dejar pintar el contenido. Además se
    // escuchan los cambios de sesión (expiración, cierre en otra pestaña) para
    // desarmar los permisos en memoria, no solo esconder la vista.
    const alCambiar = (evento: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED" | "PASSWORD_RECOVERY" | "INITIAL_SESSION") => {
      if (!vivo) return;
      if (evento === "SIGNED_OUT") {
        const st = useAuthStore.getState();
        const sesionAdminLocal =
          st.esPrincipal ||
          (typeof window !== "undefined" && Boolean(localStorage.getItem("hipico_sesion_admin_local")));
        const sesionOpLocal =
          st.modoOperador ||
          (typeof window !== "undefined" && localStorage.getItem("hipico_sesion_operador_local") === "1");
        if (sesionAdminLocal || sesionOpLocal) return;

        // Supabase ya completó el cierre; no vuelvas a llamar signOut desde
        // su propio callback (puede bloquear la cola de eventos de Auth).
        void salir(false).then(() => router.replace("/login"));
        return;
      }
      // Un token renovado puede ser el alta de un usuario nuevo: se re-resuelve
      // su tipo de usuario para que sus accesos no queden viejos.
      void inicializar().then(() => {
        // SOLO desde una pantalla de INGRESO. Si el operador está a mitad de una
        // recuperación de contraseña, esa ruta es pública pero no de acceso:
        // mandarlo al dashboard lo deja sin poder guardar la clave nueva.
        const s = useAuthStore.getState();
        if (!s.inicializada || !s.sembrada) return;
        if (esPantallaDeAcceso(ruta)) router.replace(s.modoOperador ? "/apuestas" : "/inicio");
      });
    };

    void (async () => {
      const s = await sesionActual();
      if (!vivo) return;
      const st = useAuthStore.getState();
      const sesionAdminLocal =
        st.esPrincipal ||
        (typeof window !== "undefined" && Boolean(localStorage.getItem("hipico_sesion_admin_local")));
      const sesionOpLocal =
        st.modoOperador ||
        (typeof window !== "undefined" && localStorage.getItem("hipico_sesion_operador_local") === "1");
      if (!s && !sesionOpLocal && !sesionAdminLocal && !esRutaPublica(ruta)) router.replace("/login");
    })();

    let canal: { unsubscribe: () => void } | null = null;
    let desarmado = false;
    void (async () => {
      const { supabase } = await import("@/core/supabase");
      const { data } = (await supabase?.auth.onAuthStateChange((evento) =>
        alCambiar(evento as Parameters<typeof alCambiar>[0])
      )) ?? { data: null };
      const sub = data?.subscription ?? null;
      if (desarmado) sub?.unsubscribe();
      else canal = sub;
    })();

    const onStorage = (ev: StorageEvent) => {
      if (ev.key?.startsWith("sb-")) alCambiar("SIGNED_OUT");
    };
    window.addEventListener("storage", onStorage);

    return () => {
      vivo = false;
      desarmado = true;
      canal?.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, [ruta, router, salir, inicializar]);

  return null;
}

export default AuthBootstrap;
