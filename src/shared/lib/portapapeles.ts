/**
 * portapapeles.ts
 *
 * Utilidad universal y resiliente para copiar texto al portapapeles.
 * Funciona tanto en contextos seguros (HTTPS / localhost) como en entornos
 * HTTP no seguros (VPS por IP directa sin certificado SSL) o iframes.
 */

export async function copiarAlPortapapelesUniversal(texto: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // 1. Intentar API moderna navigator.clipboard si está disponible y habilitada
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Fallback si fue bloqueado por política de permisos o HTTP
    }
  }

  // 2. Fallback clásico garantizado con elemento textarea temporal
  try {
    const textArea = document.createElement("textarea");
    textArea.value = texto;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    textArea.setAttribute("readonly", "");
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const exito = document.execCommand("copy");
    document.body.removeChild(textArea);
    return Boolean(exito);
  } catch {
    return false;
  }
}
