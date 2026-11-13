/**
 * Módulo de Seguridad Anti-Clonación, Anti-Hackeo y Sesión Única en Cliente
 * -------------------------------------------------------------------------
 * Proporciona defensas activas en el navegador contra clonación de interfaz,
 * clickjacking en iframes externos, ataques de suplantación y concurrencia.
 */

let canalSesionUnica: BroadcastChannel | null = null;

export function activarProteccionAntiClonacion(opts?: {
  usuarioId?: string;
  sesionId?: string;
  onSesionDuplicada?: () => void;
}): void {
  if (typeof window === "undefined") return;

  // 1. Anti-Clickjacking / Anti-Iframe:
  // Si la página está siendo embebida en un iframe de otro dominio (técnica de clonación/phishing),
  // rompemos el iframe para forzar la navegación directa en la ventana principal.
  try {
    if (window.top && window.top !== window.self) {
      const esMismoOrigen = window.top.location.origin === window.self.location.origin;
      if (!esMismoOrigen) {
        window.top.location.href = window.self.location.href;
      }
    }
  } catch {
    try {
      window.top!.location.href = window.self.location.href;
    } catch {
      document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;font-family:sans-serif;text-align:center;padding:20px;">
          <div>
            <h1 style="color:#ef4444;font-size:24px;font-weight:bold;">⚠️ Intento de Clonación Detectado</h1>
            <p style="margin-top:10px;color:#94a3b8;">Por razones de seguridad, esta aplicación no puede ser cargada dentro de un iframe o sitio no autorizado.</p>
          </div>
        </div>
      `;
    }
  }

  // 2. Coordinación de Sesión Única y Anti-Concurrencia (BroadcastChannel entre pestañas/ventanas)
  if (typeof BroadcastChannel !== "undefined" && opts?.usuarioId && opts?.sesionId) {
    if (canalSesionUnica) {
      try { canalSesionUnica.close(); } catch { /* ignore */ }
    }

    try {
      canalSesionUnica = new BroadcastChannel(`sesion_unica_${opts.usuarioId}`);
      // No hacer broadcast a uno mismo en la misma ventana, solo escuchar eventos de otras
      canalSesionUnica.onmessage = (event) => {
        const data = event.data;
        if (data && data.tipo === "NUEVA_SESION_INICIADA" && data.sesionId && data.sesionId !== opts.sesionId) {
          // Otra pestaña o ventana del mismo navegador inició sesión con este usuario
          if (opts.onSesionDuplicada) {
            opts.onSesionDuplicada();
          }
        }
      };
    } catch {
      /* BroadcastChannel no disponible o restringido */
    }
  }
}

/**
 * Notifica a otras pestañas que una nueva sesión fue autenticada.
 */
export function notificarInicioSesionUnica(usuarioId: string, sesionId: string): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const canal = new BroadcastChannel(`sesion_unica_${usuarioId}`);
    canal.postMessage({
      tipo: "NUEVA_SESION_INICIADA",
      sesionId,
      timestamp: Date.now(),
    });
    setTimeout(() => {
      try { canal.close(); } catch { /* ignore */ }
    }, 1000);
  } catch {
    /* ignore */
  }
}
