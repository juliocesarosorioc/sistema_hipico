"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { esPantallaDeAcceso, esRutaPublica } from "@/features/seguridad/lib/capacidades";
import { sesionActual } from "@/features/auth/lib/sesion";

/**
 * Al montar el SPA siembra la sesión RBAC (permisos en memoria + cookies para
 * el middleware) y vigila la sesión de Supabase: sin sesión válida manda a
 * /login, y al cerrarse (logout o expiración) vuelve a expulsar. No renderiza
 * nada.
 */
export function AuthBootstrap() {
  const inicializar = useAuthStore((s) => s.inicializar);
  const salir = useAuthStore((s) => s.salir);
  const router = useRouter();
  const ruta = usePathname();

  useEffect(() => {
    void inicializar();
  }, [inicializar]);

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
      // La pregunta NO es "¿tiene sesión?" sino "¿esta ruta necesita sesión?".
      // Con la comparación fija contra "/login", entrar a la raíz sin sesión
      // expulsaba a "/login" (redirección inútil, y una de los parpadeos que se quejaba el login) y, peor, entrar a `/reset-password` desde el
      // enlace del correo —que justamente llega SIN sesión— expulsaba también:
      // la recuperación de contraseña se rompía sola.
      const st = useAuthStore.getState();
      const sesionAdminLocal =
        st.esPrincipal ||
        (typeof window !== "undefined" && Boolean(localStorage.getItem("hipico_sesion_admin_local")));
      const sesionOpLocal =
        st.modoOperador ||
        (typeof window !== "undefined" && localStorage.getItem("hipico_sesion_operador_local") === "1");
      if (!s && !sesionOpLocal && !sesionAdminLocal && !esRutaPublica(ruta)) router.replace("/login");
    })();

    // El cliente de Supabase notifica por canal; el evento de storage cubre el
    // cierre de sesión ejecutado en otra pestaña.
    //
    // La suscripción se registra una vez y en un `let` que el cleanup puede ver.
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
