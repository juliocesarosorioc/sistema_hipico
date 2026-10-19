/**
 * LOGOS DE HIPÓDROMOS Y GRUPOS — núcleo puro (testeable en node).
 *
 * El logo se guarda como Data URL PNG base64 en `logo_url`. Estas funciones
 * validan el archivo elegido y arman un nombre de descarga seguro; la
 * redimensión con `<canvas>` vive en el componente `LogoUploader`.
 */

/** Lado máximo por defecto del logo guardado (suficiente para imprimir). */
export const LOGO_MAX_PX = 256;

/** Peso máximo del archivo original antes de optimizar. */
export const LOGO_MAX_BYTES = 4 * 1024 * 1024;

const TIPOS_VALIDOS = /^image\/(png|webp|jpe?g)$/i;

/** Devuelve el error de validación o `null` si el archivo sirve. */
export function validarArchivoLogo(file: { type?: string; size?: number } | null | undefined): string | null {
  if (!file) return "No se seleccionó ninguna imagen.";
  if (!TIPOS_VALIDOS.test(String(file.type || ""))) {
    return "Formato no soportado. Usá una imagen PNG, WEBP o JPG.";
  }
  if (Number(file.size ?? 0) > LOGO_MAX_BYTES) {
    return "La imagen supera los 4 MB. Usá una más liviana o recortala antes de subirla.";
  }
  return null;
}

/** Nombre de archivo seguro (sin acentos ni símbolos) para descargas. */
export function nombreArchivoLogo(nombre: string): string {
  const base = String(nombre || "logo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "logo"}_logo.png`;
}
