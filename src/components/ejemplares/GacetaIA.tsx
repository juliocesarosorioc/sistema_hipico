"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLAVE_GEMINI_KEY, transformarGaceta } from "@/lib/gaceta/ia";
import { guardarHistorialGaceta, registrarEjemplares } from "@/lib/gaceta/padron";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { CarreraGacetaCard } from "@/components/ejemplares/CarreraGacetaCard";
import {
  acumularEnEnsamblaje,
  leerRegistro,
  limpiarTodoRegistro,
  listaHors,
  marcarEnviadas,
  parsearRangoPaginas,
  persistirRegistro,
  type CarreraRegistro,
  type ResumenPadron,
} from "@/lib/gaceta/ui";

type PaginaGaceta = { id: string; dataUrl: string; num: number; orden: number };

function leerArchivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

const MAX_ENVIO_PX = 1500;
const CALIDAD_JPEG = 0.6;

function pesoMB(dataUrl: string): number {
  return ((dataUrl.split(",")[1] || "").length * 3) / 4 / 1024 / 1024;
}

// ---- Renderizado de PDFs a miniaturas (client-side) ----------------------
// pdfjs renderiza cada página del PDF a un canvas → PNG. Así la vista previa
// funciona (el <img> no sabe pintar application/pdf) y las páginas seleccionadas
// se envían a Gemini como imágenes. Misma regla que el legacy (js/gaceta.js):
// ancho tope 1500 px y JPEG al 60%.
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
  // Worker vía CDN (mismo patrón que el legacy: js/gaceta.js). Emitirlo como
  // asset local rompe el build: el worker de pdfjs-dist 4.x es ESM (.mjs) y el
  // minificador de Next (Terser) no compila `import`/`export` toplevel. Con el
  // sufijo `?url` además quedaba workerSrc === undefined y ningún PDF cargaba.
  lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs";
  return lib;
}

/** Convierte un PDF (File → ArrayBuffer) en N dataURLs PNG (una por página).
 *  `tope` limita las páginas leídas (input "Páginas del PDF a leer"). */
async function renderPdfAPaginas(
  file: File,
  onProgreso: (pagina: number, total: number) => void,
  tope?: number
): Promise<string[]> {
  const lib = await cargarPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: PdfDoc;
  try {
    doc = await lib.getDocument({ data: buffer }).promise;
  } catch (e) {
    throw new Error(`No se pudo leer el PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
  const total = tope && tope > 0 ? Math.min(tope, doc.numPages) : doc.numPages;
  const paginas: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgreso(i, total);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(vp.width, MAX_ENVIO_PX);
      canvas.height = Math.round(canvas.width * (vp.height / vp.width));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      paginas.push(canvas.toDataURL("image/jpeg", CALIDAD_JPEG));
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

const SQL_AVISO_KEY = "club_gaceta_sql_aviso";

export function GacetaIA() {
  const [paginas, setPaginas] = useState<PaginaGaceta[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [clave, setClave] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [estado, setEstado] = useState("");
  const [diag, setDiag] = useState("");
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [rango, setRango] = useState("");
  const [topePaginas, setTopePaginas] = useState("");
  const [vistaIndice, setVistaIndice] = useState(-1);
  const [carreras, setCarreras] = useState<CarreraRegistro[]>([]);
  const [resumen, setResumen] = useState<ResumenPadron>({ nuevos: 0, vinculados: 0 });
  const [registrando, setRegistrando] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  // Clave guardada solo en este navegador.
  useEffect(() => {
    try {
      const k = localStorage.getItem(CLAVE_GEMINI_KEY) ?? "";
      if (k) setClave(k);
    } catch (e) {
      void e;
    }
  }, []);

  // Recupera las carreras pendientes del registro (sin re-transformar).
  useEffect(() => {
    const arr = leerRegistro();
    if (!arr || !arr.length) return;
    const pendientes = arr.filter((c) => !c.enviada);
    const enviadas = arr.length - pendientes.length;
    if (!pendientes.length) {
      setEstado(`${enviadas} carrera(s) ya se enviaron al Ensamblaje. Cargue un nuevo programa o use "Limpiar registro" para empezar de nuevo.`);
      return;
    }
    const lista = pendientes.map((c) => {
      const copia: CarreraRegistro = Object.assign({}, c);
      delete copia.enviada;
      delete copia.aplicada;
      return copia;
    });
    setCarreras(lista.map((c) => ({ ...c, seleccionada: true })));
    setEstado("Recuperando las carreras guardadas…");
    void registrarEjemplares(lista as unknown as Array<Record<string, unknown>>)
      .then((tot) => {
        setResumen({ nuevos: tot.nuevos, vinculados: tot.vinculados });
        setCarreras((prev) => prev.map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) })));
        setEstado(
          `${lista.length} carrera(s) guardada(s) pendientes de ensamblar${enviadas ? ` · ${enviadas} ya enviada(s)` : ""}. Puede enviarlas al Ensamblaje sin volver a transformar.`
        );
      })
      .catch(() => {
        setCarreras((prev) => prev.map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) })));
        setEstado(`${lista.length} carrera(s) guardada(s) pendientes de ensamblar. Puede enviarlas al Ensamblaje sin volver a transformar.`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teclado de la vista previa en grande (Esc / flechas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (vistaIndice < 0 || paginas.length === 0) return;
      if (e.key === "Escape") setVistaIndice(-1);
      else if (e.key === "ArrowLeft") setVistaIndice((i) => (i - 1 + paginas.length) % paginas.length);
      else if (e.key === "ArrowRight") setVistaIndice((i) => (i + 1) % paginas.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vistaIndice, paginas.length]);

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

  const aplicarRango = useCallback(() => {
    const set = parsearRangoPaginas(rango);
    if (!set.size) {
      toast("Formato de páginas: 1-4,6,8", "warning");
      return;
    }
    setSeleccionadas(new Set(paginas.filter((p) => set.has(p.num)).map((p) => p.id)));
  }, [rango, paginas, toast]);

  const onArchivos = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/"));
      if (!arr.length) {
        setEstado("Solo se aceptan PDF, JPG, PNG o WEBP.");
        return;
      }
      setLeyendo(true);
      setEstado("Leyendo archivos...");
      setDiag("");
      try {
        const nuevas: PaginaGaceta[] = [];
        const generar = (dataUrl: string) => ({
          id: `${dataUrl.slice(0, 24)}-${nuevas.length}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl,
          num: nuevas.length + 1,
          orden: nuevas.length,
        });
        for (const f of arr) {
          try {
            const esPdf = /\.pdf$/i.test(f.name) || f.type === "application/pdf";
            if (esPdf) {
              setEstado(`Renderizando ${f.name}...`);
              const tope = parseInt(topePaginas, 10);
              const pag = await renderPdfAPaginas(
                f,
                (pag, total) => setEstado(`Renderizando ${f.name} · página ${pag} de ${total}...`),
                tope > 0 ? tope : undefined
              );
              for (const d of pag) nuevas.push(generar(d));
            } else {
              const dataUrl = await leerArchivoComoDataUrl(f);
              nuevas.push(generar(dataUrl));
            }
          } catch (e) {
            setEstado("Error leyendo " + f.name + ": " + (e instanceof Error ? e.message : String(e)));
          }
        }
        if (nuevas.length) {
          setPaginas((prev) => [...prev, ...nuevas]);
          setSeleccionadas((prev) => {
            const n = new Set(prev);
            nuevas.forEach((p) => n.add(p.id));
            return n;
          });
          setEstado(`${nuevas.length} página(s) listas.`);
        }
      } finally {
        setLeyendo(false);
      }
    },
    [topePaginas, toast]
  );

  const guardarClave = useCallback(() => {
    try {
      localStorage.setItem(CLAVE_GEMINI_KEY, clave.trim());
      setEstado("Clave guardada (solo en este navegador).");
      toast("Clave guardada en este navegador.", "success");
    } catch (e) {
      setDiag(String(e));
    }
  }, [clave, toast]);

  const probarClave = useCallback(async () => {
    if (!clave.trim()) {
      toast("Escriba primero la clave.", "warning");
      return;
    }
    setTrabajando(true);
    setEstado("Probando clave con Gemini...");
    setDiag("");
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave.trim())}`);
      const d = (await r.json()).models || [];
      setDiag(r.ok ? `Clave válida — ${d.length} modelos disponibles.` : `HTTP ${r.status}: ${JSON.stringify(d).slice(0, 160)}`);
      setEstado(r.ok ? "Clave válida." : "Clave rechazada.");
      toast(r.ok ? "Clave válida y conexión OK." : "La prueba falló; revise la clave.", r.ok ? "success" : "error");
    } catch (e) {
      setEstado("Error de red al probar la clave.");
      setDiag(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }, [clave, toast]);

  const alTransformar = useCallback(async () => {
    if (!clave.trim()) {
      setEstado("Primero guarda tu clave de Gemini.");
      toast("Primero guarda tu clave de Gemini.", "warning");
      return;
    }
    const imgs = paginas.filter((p) => seleccionadas.has(p.id)).map((p) => p.dataUrl);
    if (!imgs.length) {
      setEstado("Selecciona al menos una página.");
      toast("Selecciona al menos una página.", "warning");
      return;
    }
    const pesoSel = `${imgs.reduce((a, d) => a + pesoMB(d), 0).toFixed(1)} MB`;
    setTrabajando(true);
    setEstado(`Transcribiendo ${imgs.length} página(s) (${pesoSel}) con Gemini (gratis)...`);
    setDiag("");
    try {
      const res = await transformarGaceta(clave.trim(), imgs, (hecho, total) => setProgreso({ hecho, total }), (s) => setEstado(s));
      setDiag(res.diag ?? "");
      if (!res.ok) {
        setEstado(res.cuotaTotal ? "Cuota DIARIA gratuita de Gemini agotada. Prueba otra vez mañana o consigue otra clave gratis (aistudio.google.com/apikey)." : res.error ?? "Error transformando.");
        setCarreras([]);
        setResumen({ nuevos: 0, vinculados: 0 });
        toast(
          res.cuotaTotal
            ? "Cuota diaria gratuita agotada: cambia de clave o reintenta mañana."
            : "❌ " + (res.error ?? "Error transformando."),
          res.cuotaTotal ? "warning" : "error"
        );
        return;
      }
      // Entrega inmediata: el resultado SIEMPRE se muestra; el padrón se
      // vincula por detrás y NO bloquea las cards.
      if (res.cuotaTotal) toast(`Cuota agotada en parte de Gemini: resultado PARCIAL (${res.carreras.length} carrera(s)).`, "warning");
      const lista: CarreraRegistro[] = res.carreras.map((c) => ({
        ...c,
        premio: 100,
        ejemplares: (c.ejemplares || []).map((e) => ({ ...e, valor: 0, pts: 0 })),
        seleccionada: true,
        enviada: false,
        aplicada: false,
      }));
      setCarreras(lista);
      setResumen({ nuevos: 0, vinculados: 0 });
      persistirRegistro(lista);
      setEstado(`Listo: ${lista.length} carrera(s) transcritas, σ Vinculando padrón…`);
      toast(`✅ Extraídas ${lista.length} carreras.`, "success");

      // Historlae (gaceta_procesada) en segundo plano, sin bloquear.
      const fecha = lista.find((c) => c.fecha)?.fecha ?? null;
      guardarHistorialGaceta(lista, fecha, "desconocido").catch((e) => {
        console.warn("No se guardó el historial (gaceta_procesada):", e?.message || e);
        if (!sessionStorage.getItem(SQL_AVISO_KEY)) {
          sessionStorage.setItem(SQL_AVISO_KEY, "1");
          toast("La gaceta se procesó bien, pero el historial no se pudo guardar (falta la tabla o permisos).", "warning");
        }
      });

      // Vinculación al padrón en segundo plano (actualiza las insignias ✗/✓/★).
      void registrarEjemplares(lista as unknown as Array<Record<string, unknown>>)
        .then((tot) => {
          setResumen({ nuevos: tot.nuevos, vinculados: tot.vinculados });
          setCarreras((prev) => prev.map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) })));
          setEstado(
            `${res.cuotaTotal ? "PARCIAL · " : ""}Listo: ${lista.length} carrera(s), ${tot.nuevos} ejemplar(es) nuevos registrados.`
          );
          if (tot.errorDb) {
            toast(`Transcripción lista (padrón sin conexión): ${tot.errorDb}. Ejecute el paquete SQL y use "Registrar ejemplares en el padrón".`, "warning");
          } else if (tot.fallidos > 0) {
            toast(`Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s), ${tot.fallidos} fallido(s).`, "warning");
          } else {
            toast(`Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s).`, "success");
          }
        })
        .catch((e) => {
          console.warn("Padrón en segundo plano falló:", e?.message || e);
          toast("La transcripción quedó lista, pero la vinculación al padrón falló.", "warning");
        });
    } catch (e) {
      const msj = e instanceof Error ? e.message : String(e);
      setEstado("Error: " + msj);
      toast("❌ " + msj, "error");
    } finally {
      setTrabajando(false);
      setProgreso(null);
    }
  }, [clave, paginas, seleccionadas, toast]);

  const registrarEnPadron = useCallback(async () => {
    if (registrando || carreras.length === 0) return;
    setRegistrando(true);
    setEstado("Vinculando ejemplares con el padrón...");
    const tot = await registrarEjemplares(carreras as unknown as Array<Record<string, unknown>>);
    setResumen({ nuevos: tot.nuevos, vinculados: tot.vinculados });
    setCarreras((prev) => prev.map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) })));
    setRegistrando(false);
    toast(
      `Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s)${tot.fallidos ? `, ${tot.fallidos} fallido(s)` : ""}.`,
      tot.fallidos || tot.errorDb ? "warning" : "success"
    );
    setEstado(`Padrón actualizado: ${tot.nuevos} nuevos, ${tot.vinculados} vinculados${tot.fallidos ? `, ${tot.fallidos} fallidos` : ""}.`);
  }, [carreras, registrando, toast]);

  const guardarHist = useCallback(async () => {
    if (historial || carreras.length === 0) return;
    setHistorial(true);
    const fecha = carreras.find((c) => c.fecha)?.fecha ?? null;
    const r = await guardarHistorialGaceta(carreras, fecha, "desconocido");
    setHistorial(false);
    toast(r.ok ? "🗂️ Historial guardado en gaceta_procesada." : `⚠️ ${r.error ?? "Error al guardar el historial."}`, r.ok ? "success" : "error");
  }, [carreras, historial, toast]);

  const enviar = useCallback(
    async (lista: CarreraRegistro[]) => {
      if (enviando) return;
      const conNombre = lista.filter((c) => listaHors(c).some((e) => String(e.nombre || "").trim()));
      if (!conNombre.length) {
        toast("Las carreras marcadas no tienen ejemplares con nombre.", "warning");
        return;
      }
      setEnviando(true);
      const prev = carreras.map((c) => ({ ...c }));
      marcarEnviadas(prev, conNombre);
      setCarreras(prev.map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) })));
      const total = acumularEnEnsamblaje(conNombre);
      const etiqueta =
        conNombre.length > 1
          ? `${conNombre.length} carrera(s) enviada(s) al Ensamblaje`
          : `Carrera C${conNombre[0].carrera || "?"} enviada al Ensamblaje`;
      toast(`${etiqueta} (total en el envío: ${total}). Revise y publique.`, "success");
      setEnviando(false);
      setTimeout(() => router.push("/tablas-fijas"), 700);
    },
    [carreras, enviando, router, toast]
  );

  const enviarSeleccionadas = useCallback(() => {
    const sel = carreras.filter((c) => c.seleccionada);
    if (!sel.length) {
      toast("Marca con el ✓ al menos una carrera para enviar.", "warning");
      return;
    }
    void enviar(sel);
  }, [carreras, enviar, toast]);

  const limpiar = useCallback(() => {
    const pendientes = carreras.filter((c) => !c.enviada).length;
    const msj = pendientes > 0 ? `Hay ${pendientes} carrera(s) pendientes de ensamblar. ` : "El registro no tiene carreras pendientes. ";
    if (!window.confirm(`¿Limpiar el registro del día?\n\n${msj}Esta acción borra el registro guardado (no afecta las tablas ya publicadas).`)) return;
    limpiarTodoRegistro();
    setCarreras([]);
    setResumen({ nuevos: 0, vinculados: 0 });
    setEstado("Registro limpiado. Cargue un nuevo documento para empezar.");
    toast("Registro del día limpiado.", "success");
  }, [carreras, toast]);

  const eliminarCarrera = useCallback(
    (i: number) => {
      const c = carreras[i];
      if (!c) return;
      setCarreras((prev) => {
        const rest = prev.filter((_, k) => k !== i);
        persistirRegistro(rest);
        return rest;
      });
      const resto = carreras.length - 1;
      setEstado(`Carrera C${c.carrera ?? i + 1} del ${c.hipodromo || "programa"} eliminada del registro.`);
      toast(resto > 0 ? `Carrera eliminada (quedan ${resto}).` : "Registro vacío tras eliminar la carrera.", "info");
    },
    [carreras, toast]
  );

  // Navegación de teclado tipo planilla sobre los VALORES (Tab/Enter/↑↓),
  // igual que el legacy js/gaceta.js.
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const esNav = e.key === "Enter" || e.key === "Tab" || e.key === "ArrowUp" || e.key === "ArrowDown";
    if (!esNav) return;
    const inp = e.target as HTMLElement;
    if (inp.dataset.gacValor === undefined) return;
    e.preventDefault();
    const dir = e.key === "Enter" || e.key === "Tab" ? (e.shiftKey ? -1 : 1) : e.key === "ArrowDown" ? 1 : -1;
    const valores = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-gac-valor]") ?? []);
    const i = valores.indexOf(inp);
    if (i === -1) return;
    const sig = valores[(i + dir + valores.length) % valores.length];
    sig?.focus();
    (sig as HTMLInputElement | null)?.select();
  };

  const selCount = paginas.filter((p) => seleccionadas.has(p.id)).length;
  const pesoSel = paginas.filter((p) => seleccionadas.has(p.id)).reduce((a, p) => a + pesoMB(p.dataUrl), 0);
  const carrerasSeleccionadas = carreras.filter((c) => c.seleccionada).length;
  const labelEnvio =
    carrerasSeleccionadas === 0
      ? "Enviar al Ensamblaje (sin selección)"
      : carrerasSeleccionadas === carreras.length
        ? `Enviar TODAS al Ensamblaje (${carrerasSeleccionadas})`
        : `Enviar seleccionadas (${carrerasSeleccionadas})`;

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
            className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary-500/60 hover:bg-primary-500/5 ${
              leyendo ? "pointer-events-none border-primary-400 bg-primary-500/5" : "border-line"
            }`}
          >
            {leyendo ? (
              <>
                <p className="mb-1 inline-flex items-center gap-2 text-sm font-bold text-primary-700">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
                  Cargando la gaceta…
                </p>
                <p className="text-xs text-slate-500">{estado}</p>
              </>
            ) : (
              <>
                <p className="mb-1 text-sm font-bold text-slate-600">☁️ Arrastre el PDF o la imagen de la gaceta aquí</p>
                <p className="text-xs text-slate-500">o haga clic para elegir el archivo (JPG, PNG, WEBP o PDF)</p>
                <p className="mt-1 text-[10px] text-slate-400">
                  Los PDF se renderizan página por página y se optimizan (JPEG ≤ 1600 px) para el envío a la IA.
                </p>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void onArchivos(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {paginas.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Vista previa — toque una página para incluirla/excluirla
                </p>
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-black text-primary-700">
                  Enviar {selCount} de {paginas.length} página(s) · {pesoSel.toFixed(1)} MB
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {paginas.map((p, idx) => {
                  const activa = seleccionadas.has(p.id);
                  return (
                    <div key={p.id} className="relative">
                      <button
                        type="button"
                        onClick={() => togglePagina(p.id)}
                        role="checkbox"
                        aria-checked={activa}
                        className={`relative block w-full cursor-pointer overflow-hidden rounded-lg border-2 select-none transition-all ${
                          activa ? "border-primary-500 shadow-lg ring-2 ring-primary-500/50" : "border-line opacity-60 hover:opacity-90"
                        }`}
                        title={activa ? "Quitar de la selección" : "Incluir en la selección"}
                      >
                        <img src={p.dataUrl} alt={`Página ${p.num}`} className="h-20 w-full object-cover" draggable={false} />
                        <span
                          className={`absolute left-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors ${
                            activa ? "border-primary-700 bg-primary-600" : "border-slate-400 bg-white"
                          }`}
                          aria-hidden
                        >
                          {activa && (
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5 text-white"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={4}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <span
                          className={`absolute bottom-0 left-0 z-20 px-1 text-[9px] font-bold ${
                            activa ? "bg-primary-700 text-white" : "bg-slate-950/80 text-slate-200"
                          }`}
                        >
                          {p.num}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVistaIndice(idx)}
                        title="Ver la página en grande"
                        aria-label="Ver la página en grande"
                        className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white shadow transition-colors"
                        style={{ backgroundColor: "#0891b2" }}
                      >
                        🔍
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-500">Enviar páginas:</span>
                <input
                  value={rango}
                  onChange={(e) => setRango(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") aplicarRango();
                  }}
                  placeholder="Ej: 1-4,6,8"
                  className="w-24 rounded-lg border border-line bg-surface px-2 py-1 text-center text-xs font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                <Button variant="ghost" size="sm" onClick={aplicarRango}>
                  Aplicar
                </Button>
                <Button variant="ghost" size="sm" onClick={seleccionarTodas}>
                  Todas
                </Button>
                <Button variant="ghost" size="sm" onClick={limpiarSeleccion}>
                  Ninguna
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <label htmlFor="max-paginas" className="text-xs font-bold uppercase text-slate-600">
              Páginas del PDF a leer
            </label>
            <input
              id="max-paginas"
              type="number"
              min={1}
              max={99}
              value={topePaginas}
              onChange={(e) => setTopePaginas(e.target.value)}
              placeholder="Todas"
              title="Limita las páginas que se renderizan del PDF (vacío = todas)"
              className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            />
          </div>
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
            onClick={() => void alTransformar()}
            title={
              seleccionadas.size === 0
                ? "Selecciona al menos una página para extraer sus carreras"
                : `Enviar ${seleccionadas.size} página(s) seleccionada(s) a Gemini`
            }
          >
            ✨ Transformar con IA (gratis)
          </Button>
          {trabajando && (
            <div className="mt-3 rounded-lg border border-primary-200 bg-primary-500/5 p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wide text-primary-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
                  Procesando con la IA…
                </span>
                {progreso && (
                  <span>
                    lote {progreso.hecho} / {progreso.total}
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary-100">
                <div
                  className="h-full rounded-full bg-primary-600 transition-all duration-300"
                  style={{ width: `${progreso ? Math.round((progreso.hecho / progreso.total) * 100) : 5}%` }}
                />
              </div>
            </div>
          )}
          {seleccionadas.size === 0 && paginas.length > 0 && !trabajando && (
            <p className="mt-1 text-center text-[10px] font-bold text-amber-600">
              Marca las páginas que contienen carreras antes de transformar.
            </p>
          )}
          <Button variant="ghost" size="md" className="mt-2 w-full" disabled={trabajando} onClick={() => void probarClave()}>
            🔌 Probar clave de IA
          </Button>
          {estado && (
            <p className={`mt-2 text-center text-[11px] ${/error/i.test(estado) ? "font-bold text-red-500" : "text-slate-500"}`}>
              {estado}
            </p>
          )}
          {diag && (
            <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] font-mono text-success-500">
              {diag}
            </pre>
          )}
        </div>
      </div>

      {carreras.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">
              📋 Carreras Extraídas{" "}
              <span className="text-xs font-bold normal-case text-slate-500">
                ({carreras.length} carreras · {resumen.nuevos} nuevos / {resumen.vinculados} vinculados al padrón)
              </span>
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="default" size="sm" disabled={registrando || historial || enviando} onClick={() => void registrarEnPadron()}>
                {registrando ? "Vinculando…" : "✔ Registrar en el padrón"}
              </Button>
              <Button variant="outline" size="sm" disabled={historial || registrando || enviando} onClick={() => void guardarHist()}>
                {historial ? "Guardando…" : "🗂️ Guardar historial"}
              </Button>
              <Button variant="default" size="sm" disabled={enviando || carreras.length === 0} onClick={enviarSeleccionadas}>
                {enviando ? "Enviando…" : `📤 ${labelEnvio}`}
              </Button>
              <Button variant="danger" size="sm" disabled={enviando} onClick={limpiar}>
                🧹 Limpiar registro
              </Button>
            </div>
          </div>
          <div ref={gridRef} onKeyDown={onGridKeyDown} className="grid grid-cols-1 gap-2 p-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
            {carreras.map((c, i) => (
              <CarreraGacetaCard
                key={`${String(c.hipodromo || "")}-${String(c.carrera ?? "")}-${i}`}
                index={i}
                carrera={c}
                onChange={(nc) => setCarreras((prev) => prev.map((x, k) => (k === i ? nc : x)))}
                onEnviar={(id) => void enviar([carreras[id]])}
                onEliminar={() => eliminarCarrera(i)}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] italic leading-relaxed text-slate-500">
            💡 La IA transcribe la gaceta tal cual: no inventa nombres. Usted revisa Valor, premio, distancia y superficie de
            cada carrera, y con <b>Cargar en el Ensamblaje</b> (o el envío masivo) decide CUÁNDO llevarlas. Nada se envía solo:
            los ejemplares se registran en el padrón por nombre + nacionalidad (los homónimos se desambiguan por país; EE.UU.
            por defecto USA y Venezuela VE).
          </p>
        </div>
      )}

      {/* Vista previa de una página de la gaceta en grande */}
      {vistaIndice >= 0 && paginas[vistaIndice] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5"
          style={{ backgroundColor: "rgba(0,0,0,.88)" }}
          onClick={() => setVistaIndice(-1)}
        >
          <div className="relative w-full" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setVistaIndice(-1)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-200"
              >
                ✕ Cerrar (Esc)
              </button>
              <span className="text-xs font-black text-white">
                Página {paginas[vistaIndice].num} de {paginas.length}
              </span>
            </div>
            <img
              src={paginas[vistaIndice].dataUrl}
              alt={`Página ${paginas[vistaIndice].num}`}
              className="w-full rounded-lg shadow-2xl"
              style={{ maxHeight: "80vh", objectFit: "contain" }}
            />
            <div className="mt-3 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setVistaIndice((i) => (i - 1 + paginas.length) % paginas.length)}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-700"
              >
                ◀ Anterior
              </button>
              <button
                type="button"
                onClick={() => setVistaIndice((i) => (i + 1) % paginas.length)}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-700"
              >
                Siguiente ▶
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

export default GacetaIA;