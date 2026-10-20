"use client";

/**
 * LogoUploader — gestor reutilizable de logos en PNG/WEBP/JPG.
 *
 * La imagen NUNCA se sube a un bucket: se redimensiona en el cliente con
 * `<canvas>` y se guarda como **Data URL PNG base64** en la columna
 * `logo_url` (hipodromos / grupos_venta). Así el reporte impreso y
 * `html2canvas` pueden capturarla sin problemas de CORS.
 *
 * Reglas:
 *   · Acepta PNG, WEBP, JPG y JPEG (también por drag & drop).
 *   · Máximo 4 MB de archivo, lado máximo 256 px (configurable).
 *   · Fondo transparente conservado (PNG).
 *   · Cambiar y Quitar en un solo componente.
 */
import { useRef, useState, type DragEvent } from "react";
import { LOGO_MAX_PX, validarArchivoLogo } from "@/shared/lib/logos";

export { LOGO_MAX_PX, LOGO_MAX_BYTES, validarArchivoLogo, nombreArchivoLogo } from "@/shared/lib/logos";

function leerDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result ?? ""));
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.readAsDataURL(file);
  });
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("La imagen está dañada o no se pudo decodificar."));
    img.src = src;
  });
}

/**
 * Optimiza la imagen en el navegador: la reduce a `maxLado` px como máximo
 * (manteniendo proporción) y la devuelve como Data URL PNG.
 */
export async function optimizarLogo(file: File, maxLado: number = LOGO_MAX_PX): Promise<string> {
  const error = validarArchivoLogo(file);
  if (error) throw new Error(error);

  const dataUrl = await leerDataUrl(file);
  const img = await cargarImagen(dataUrl);
  const anchoOriginal = img.naturalWidth || img.width;
  const altoOriginal = img.naturalHeight || img.height;
  if (!anchoOriginal || !altoOriginal) throw new Error("La imagen no tiene dimensiones válidas.");

  const tope = Math.max(16, Math.round(maxLado));
  const escala = Math.min(1, tope / Math.max(anchoOriginal, altoOriginal));
  const ancho = Math.max(1, Math.round(anchoOriginal * escala));
  const alto = Math.max(1, Math.round(altoOriginal * escala));

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo preparar el lienzo para la imagen.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, ancho, alto);
  ctx.drawImage(img, 0, 0, ancho, alto);
  return canvas.toDataURL("image/png");
}

export type LogoUploaderProps = {
  /** Data URL (o URL remota) ya guardada. */
  value?: string | null;
  /** `null` cuando el operador quita el logo. */
  onChange: (logo: string | null) => void;
  /** Título de la sección. */
  label?: string;
  /** Texto de ayuda debajo del recuadro. */
  hint?: string;
  /** Lado máximo del PNG guardado. */
  maxLado?: number;
  /** Tamaño de la vista previa (px). */
  preview?: number;
  disabled?: boolean;
  className?: string;
};

/**
 * Recuadro con arrastrar-y-soltar, vista previa instantánea y acciones
 * «Cambiar» / «Quitar».
 */
export function LogoUploader({
  value,
  onChange,
  label = "Logo (PNG)",
  hint = "PNG, WEBP o JPG · se optimiza a 256 px · fondo transparente recomendado.",
  maxLado = LOGO_MAX_PX,
  preview = 88,
  disabled = false,
  className = "",
}: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegir = () => {
    if (disabled || procesando) return;
    inputRef.current?.click();
  };

  const procesar = async (file: File | null | undefined) => {
    const validacion = validarArchivoLogo(file);
    if (validacion) {
      setError(validacion);
      return;
    }
    setError(null);
    setProcesando(true);
    try {
      const logo = await optimizarLogo(file as File, maxLado);
      onChange(logo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar la imagen.");
    } finally {
      setProcesando(false);
    }
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setArrastrando(false);
    if (disabled) return;
    const file = e.dataTransfer?.files?.[0];
    void procesar(file);
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-black uppercase tracking-wide text-slate-600">🖼️ {label}</span>

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? "Cambiar logo" : "Subir logo"}
        onClick={elegir}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            elegir();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) setArrastrando(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setArrastrando(false);
        }}
        onDrop={soltar}
        className={[
          "flex items-center gap-3 rounded-xl border-2 border-dashed p-2.5 transition-colors",
          arrastrando ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-400",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        ].join(" ")}
      >
        <div
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-inner"
          style={{ width: preview, height: preview }}
        >
          {value ? (
            <img
              src={value}
              alt="Vista previa del logo"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain p-1"
            />
          ) : (
            <span className="text-2xl leading-none" aria-hidden="true">
              🏇
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 text-[11px] leading-snug">
          {value ? (
            <p className="font-bold text-emerald-700">✅ Logo cargado</p>
          ) : (
            <p className="font-bold text-slate-700">Arrastrá una imagen acá</p>
          )}
          <p className="text-slate-500">{procesando ? "Optimizando imagen…" : "o hacé clic para seleccionarla"}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={disabled || procesando}
              onClick={(e) => {
                e.stopPropagation();
                elegir();
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {value ? "Cambiar" : "Seleccionar"}
            </button>
            {value ? (
              <button
                type="button"
                disabled={disabled || procesando}
                onClick={(e) => {
                  e.stopPropagation();
                  setError(null);
                  onChange(null);
                }}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black uppercase text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Quitar
              </button>
            ) : null}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            void procesar(file);
            // Permite volver a elegir el mismo archivo después de quitarlo.
            e.target.value = "";
          }}
        />
      </div>

      {hint ? <span className="text-[10px] font-semibold text-slate-400">{hint}</span> : null}
      {error ? <span className="text-[10px] font-bold text-red-600">{error}</span> : null}
    </div>
  );
}

export default LogoUploader;
