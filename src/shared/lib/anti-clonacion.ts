/**
 * Módulo de Seguridad Anti-Clonación y Anti-Hackeo
 * ------------------------------------------------
 * Proporciona defensas activas en el navegador contra clonación de interfaz,
 * clickjacking en iframes externos y ataques de suplantación.
 */

export function activarProteccionAntiClonacion(): void {
  if (typeof window === "undefined") return;

  // 1. Anti-Clickjacking / Anti-Iframe:
  // Si la página está siendo embebida en un iframe de otro dominio (técnica de clonación/phishing),
  // rompemos el iframe para forzar la navegación directa en la ventana principal.
  try {
    if (window.top && window.top !== window.self) {
      // Intentamos comprobar el origen del padre
      const esMismoOrigen = window.top.location.origin === window.self.location.origin;
      if (!esMismoOrigen) {
        window.top.location.href = window.self.location.href;
      }
    }
  } catch {
    // Si saltó error por política de mismo origen (Cross-Origin Frame),
    // significa que el padre es definitivamente un dominio externo malicioso.
    try {
      window.top!.location.href = window.self.location.href;
    } catch {
      // Bloquear el cuerpo de la página para que no pueda ser usada
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
}
