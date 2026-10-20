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

/**
 * ============================================================================
 * LOGOS EN CALIENTE — cache-busting y evento de propagación
 * ============================================================================
 *
 * Un logo es un Data URL (`data:image/png;base64,...`). El navegador NO lo
 * vuelve a pedir si la cadena no cambió, y aunque cambie, React reutiliza el
 * `<img>` si el `src` difiere. Para que TODAS las ventanas, cabeceras, reportes
 * y tarjetas abiertas muestren el logo nuevo al instante (zero-reload) se
 * combinan dos cosas:
 *
 *   · `conCacheBust` le agrega un parámetro efímero (`#v=<marca>`) al Data URL
 *     para forzar el repintado del `<img>` sin tocar el contenido guardado.
 *   · El evento global `logos-updated` avisa a los componentes montados que
 *     relean/re-rendericen. Lo emite `emitirLogosActualizados` (mensajería).
 *
 * Estas funciones son PURAS (testeables en node), salvo el `Date.now()` del
 * parámetro por defecto, que solo se usa para tener una marca distinta.
 */

/** Marca de versión de la sesión: cambia en cada carga/actualización de logo. */
let versionLogos = 0;

/** Avanza la marca global de logos y la devuelve. */
export function marcarLogosActualizados(): number {
  versionLogos += 1;
  return versionLogos;
}

/** Marca actual (para tests / renders deterministas). */
export function versionLogosActual(): number {
  return versionLogos;
}

/**
 * Agrega un fragmento de cache-busting a un Data URL/URL de logo. No altera el
 * contenido guardado en la base: solo la cadena que ve el `<img>`, así el
 * navegador repinta el logo recién cambiado. Devuelve el valor tal cual cuando
 * es vacío.
 */
export function conCacheBust(url: string | null | undefined, marca: number | string = versionLogos): string | null {
  const u = String(url ?? "");
  if (!u) return null;
  // Se separa el `#` viejo si lo hubiera para no apilar fragmentos.
  const limpio = u.split("#")[0];
  const separador = limpio.includes("?") ? "&" : "#";
  // Un fragmento (`#v=`) no viaja al servidor, así que un Data URL sigue siendo
  // decodificable por el navegador y `html2canvas` lo captura igual.
  return `${limpio}${separador}v=${marca}`;
}
