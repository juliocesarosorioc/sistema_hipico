"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLAVE_GEMINI_KEY,
  transformarGaceta,
  type CarreraExtraida,
} from "@/lib/gaceta/ia";
import { guardarHistorialGaceta, registrarEjemplares } from "@/lib/gaceta/padron";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";

type PaginaGaceta = { id: string; dataUrl: string; orden: number };

function leerArchivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

// ---- Renderizado de PDFs a miniaturas (client-side) ----------------------
// pdfjs renderiza cada página del PDF a un canvas → PNG. Así la vista previa
// funciona (el <img> no sabe pintar application/pdf) y las páginas seleccionadas
// se envían a Gemini como imágenes.
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (p: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
    cleanup: () => void;
  }>;
  destroy: () => Promise<void>;
};

async function cargarPdfJs(): Promise<PdfLib> {
  const mod = (await import("pdfjs-dist/legacy/build/pdf")) as unknown as
    | { default?: PdfLib }
    | PdfLib;
  const lib = (mod as { default?: PdfLib }).default ?? (mod as PdfLib);
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

/** Convierte un PDF (File → ArrayBuffer) en N dataURLs PNG (una por página). */
async function renderPdfAPaginas(file: File, onProgreso: (pagina: number, total: number) => void): Promise<string[]> {
  const lib = await cargarPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: PdfDoc;
  try {
    doc = await lib.getDocument({ data: buffer }).promise;
  } catch (e) {
    throw new Error(`No se pudo leer el PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
  const paginas: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      onProgreso(i, doc.numPages);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      paginas.push(canvas.toDataURL("image/png"));
      try {
        page.cleanup();
      } catch {
        /* noop */
      }
    }
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* noop */
    }
  }
  return paginas;
}

export function GacetaIA() {
  const [paginas, setPaginas] = useState<PaginaGaceta[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [clave, setClave] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [estado, setEstado] = useState("");
  const [diag, setDiag] = useState("");
  const [carreras, setCarreras] = useState<CarreraExtraida[]>([]);
  const [densa, setDensa] = useState(true);
  const [registrando, setRegistrando] = useState(false);
  const [historial, setHistorial] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const k = localStorage.getItem(CLAVE_GEMINI_KEY) ?? "";
      if (k) setClave(k);
    } catch (e) {
      void e;
    }
  }, []);

  const togglePagina = useCallback((id: string) => {
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const seleccionarTodas = useCallback(() => {
    setSeleccionadas(new Set(paginas.map((p) => p.id)));
  }, [paginas]);

  const limpiarSeleccion = useCallback(() => {
    setSeleccionadas(new Set());
  }, []);

  const onArchivos = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/"));
    if (!arr.length) {
      setEstado("Solo se aceptan PDF, JPG, PNG o WEBP.");
      return;
    }
    setEstado("Leyendo archivos...");
    const nuevas: PaginaGaceta[] = [];
    const generar = (dataUrl: string) => ({ id: `${dataUrl.slice(0, 24)}-${nuevas.length}-${Date.now()}`, dataUrl, orden: nuevas.length });
    for (const f of arr) {
      try {
        const esPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
        if (esPdf) {
          setEstado(`Renderizando ${f.name}...`);
          const paginas = await renderPdfAPaginas(f, (pag, total) => setEstado(`Renderizando ${f.name} · página ${pag} de ${total}...`));
          paginas.forEach((d) => nuevas.push(generar(d)));
        } else {
          const dataUrl = await leerArchivoComoDataUrl(f);
          nuevas.push(generar(dataUrl));
        }
      } catch (e) {
        setEstado("Error leyendo " + f.name + ": " + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (!nuevas.length) return;
    setPaginas((prev) => [...prev, ...nuevas]);
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      nuevas.forEach((p) => n.add(p.id));
      return n;
    });
    setEstado(`${nuevas.length} página(s) listas.`);
  }, []);

  const guardarClave = useCallback(() => {
    try {
      localStorage.setItem(CLAVE_GEMINI_KEY, clave.trim());
      setEstado("Clave guardada (solo en este navegador).");
    } catch (e) {
      setDiag(String(e));
    }
  }, [clave]);

  const probarClave = useCallback(async () => {
    setTrabajando(true);
    setEstado("Probando clave con Gemini...");
    setDiag("");
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave.trim())}`);
      const d = (await r.json()).models || [];
      setDiag(r.ok ? `Clave válida — ${d.length} modelos disponibles.` : `HTTP ${r.status}: ${JSON.stringify(d).slice(0, 160)}`);
      setEstado(r.ok ? "Clave válida." : "Clave rechazada.");
    } catch (e) {
      setEstado("Error de red al probar la clave.");
      setDiag(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }, [clave]);

  const transformar = useCallback(async () => {
    if (!clave.trim()) {
      setEstado("Primero guarda tu clave de Gemini.");
      return;
    }
    const imgs = paginas.filter((p) => seleccionadas.has(p.id)).map((p) => p.dataUrl);
    if (!imgs.length) {
      setEstado("Selecciona al menos una página.");
      return;
    }
    setTrabajando(true);
    setEstado(`Transcribiendo ${imgs.length} página(s) con Gemini (gratis)...`);
    setDiag("");
    const res = await transformarGaceta(clave.trim(), imgs);
    setTrabajando(false);
    setDiag(res.diag ?? "");
    if (!res.ok) {
      setEstado(res.error ?? "Error transformando.");
      setCarreras([]);
      return;
    }
    setCarreras(res.carreras);
    setEstado(`Extraídas ${res.carreras.length} carrera(s).`);
  }, [clave, paginas, seleccionadas]);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  /** Registra los ejemplares extraídos en `ejemplares` (paridad gaceta_padron.registrar). */
  const registrarEnPadron = useCallback(async () => {
    setRegistrando(true);
    setEstado("Vinculando ejemplares con el padrón...");
    const tot = await registrarEjemplares(carreras as unknown as Array<Record<string, unknown>>);
    setCarreras([...carreras]);
    setRegistrando(false);
    toast(
      `Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s)${tot.fallidos ? `, ${tot.fallidos} fallido(s)` : ""}.`,
      tot.fallidos ? "warning" : "success"
    );
    setEstado(`Padrón actualizado: ${tot.nuevos} nuevos, ${tot.vinculados} vinculados${tot.fallidos ? `, ${tot.fallidos} fallidos` : ""}.`);
  }, [carreras, toast]);

  /** Guarda el historial de la transcripción en `gaceta_procesada`. */
  const guardarHistorial = useCallback(async () => {
    setHistorial(true);
    const fecha = carreras.find((c) => c.fecha)?.fecha ?? null;
    const r = await guardarHistorialGaceta(carreras, fecha, "operador-admin");
    setHistorial(false);
    toast(r.ok ? "🗂️ Historial guardado en gaceta_procesada." : `⚠️ ${r.error ?? "Error al guardar el historial."}`, r.ok ? "success" : "error");
  }, [carreras, toast]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            📤 Subir la Gaceta (PDF o Imagen)
          </h3>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void onArchivos(e.dataTransfer.files);
            }}
            className="cursor-pointer rounded-xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-primary-500/60 hover:bg-primary-500/5"
          >
            <p className="mb-1 text-sm font-bold text-slate-600">☁️ Arrastre el PDF o la imagen de la gaceta aquí</p>
            <p className="text-xs text-slate-500">o haga clic para elegir el archivo (JPG, PNG, WEBP o PDF)</p>
            <p className="mt-1 text-[10px] text-slate-400">Los PDF se renderizan página por página (vista previa nítida y envío como imagen a la IA).</p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void onArchivos(e.target.files);
              }}
            />
          </div>

          {paginas.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Vista previa — marque/desmarque las páginas que desea enviar a la IA
                </p>
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-black text-primary-700">
                  {seleccionadas.size} páginas seleccionadas de {paginas.length}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {paginas.map((p) => {
                  const activa = seleccionadas.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePagina(p.id)}
                      role="checkbox"
                      aria-checked={activa}
                      className={`relative overflow-hidden rounded-lg border-2 transition-transform ${
                        activa ? "border-primary-500 shadow-lg" : "border-line opacity-60 hover:opacity-80"
                      }`}
                      title={activa ? "Quitar de la selección" : "Incluir en la selección"}
                    >
                      <img src={p.dataUrl} alt={`Página ${p.orden + 1}`} className="h-20 w-full object-cover" />
                      <span
                        className={`absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded border-2 bg-white/90 text-[10px] font-black leading-none ${
                          activa ? "border-primary-600 bg-primary-600 text-white" : "border-slate-400 text-transparent"
                        }`}
                        aria-hidden
                      >
                        {activa ? "✓" : ""}
                      </span>
                      <span className="absolute bottom-0 left-0 bg-slate-950/80 px-1 text-[9px] font-bold text-slate-200">
                        {p.orden + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-500">Selección:</span>
                <Button variant="ghost" size="sm" onClick={seleccionarTodas}>
                  Todas
                </Button>
                <Button variant="ghost" size="sm" onClick={limpiarSeleccion}>
                  Ninguna
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            🔑 Clave de la IA (Gemini, gratis)
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Con IA gratuita de Google (Gemini). <b>Sin costo y sin tarjeta.</b> La clave se guarda{" "}
            <b>solo en este navegador</b>.
          </p>
          <ul className="mb-3 list-inside list-decimal space-y-1 rounded-lg border border-line bg-surfaceAlt p-3 text-[11px] text-slate-600">
            <li>Entra a aistudio.google.com/apikey (con tu cuenta de Google).</li>
            <li>Click en Create API key y copia la clave (empieza con AIza...).</li>
            <li>Pégala abajo y presiona Guardar clave.</li>
          </ul>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 inline-flex items-center gap-1 text-[11px] font-bold text-success-400 hover:text-success-500"
          >
            ↗ Obtener mi clave gratis
          </a>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="AIza..."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500"
          />
          <Button variant="success" size="md" className="mt-2 w-full" onClick={guardarClave}>
            💾 Guardar clave (en este navegador)
          </Button>
          <Button
            variant="default"
            size="lg"
            className="mt-4 w-full"
            disabled={trabajando || !clave.trim() || seleccionadas.size === 0}
            onClick={() => void transformar()}
            title={
              seleccionadas.size === 0
                ? "Selecciona al menos una página para extraer sus carreras"
                : `Enviar ${seleccionadas.size} página(s) seleccionada(s) a Gemini`
            }
          >
            ✨ Transformar con IA (gratis)
          </Button>
          {seleccionadas.size === 0 && paginas.length > 0 && !trabajando && (
            <p className="mt-1 text-center text-[10px] font-bold text-amber-600">
              Marca las páginas que contienen carreras antes de transformar.
            </p>
          )}
          <Button variant="ghost" size="md" className="mt-2 w-full" disabled={trabajando} onClick={() => void probarClave()}>
            🔌 Probar clave de IA
          </Button>
          {estado && <p className="mt-2 text-center text-[11px] text-slate-500">{estado}</p>}
          {diag && (
            <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] font-mono text-success-500">
              {diag}
            </pre>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
          Vista de resultados
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant={densa ? "default" : "ghost"} size="sm" onClick={() => setDensa(true)}>
            Compacta
          </Button>
          <Button variant={densa ? "ghost" : "default"} size="sm" onClick={() => setDensa(false)}>
            Detallada
          </Button>
        </div>
      </div>

      {carreras.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              📋 Carreras Extraídas ({carreras.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="default" size="sm" disabled={registrando || historial} onClick={() => void registrarEnPadron()}>
                {registrando ? "Vinculando…" : "✔ Registrar en el padrón"}
              </Button>
              <Button variant="outline" size="sm" disabled={historial || registrando} onClick={() => void guardarHistorial()}>
                {historial ? "Guardando…" : "🗂️ Guardar historial"}
              </Button>
            </div>
          </div>
          <div className={`grid gap-2 ${densa ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1"}`}>
            {carreras.map((c, i) => (
              <div key={i} className="rounded-xl border border-line bg-surfaceAlt/60 p-3">
                <p className="text-xs font-bold text-primary-600">
                  {String(c.hipodromo || "?").toUpperCase()} · C{c.carrera ?? "?"}
                </p>
                {densa ? null : (
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {c.fecha ?? "-"} · {(c.distancia || 0) > 0 ? `${c.distancia} m` : "-"} · {c.superficie || "ARENA"} · premio {c.premio || 0}
                  </p>
                )}
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-slate-600">
                  {(c.ejemplares || []).map((ej, j) => (
                    <li key={j}>
                      {ej.numero} · <b>{ej.nombre}</b> ({ej.nacionalidad ?? "VE"}){Number(ej.valor) > 0 ? ` · $${ej.valor}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

export default GacetaIA;