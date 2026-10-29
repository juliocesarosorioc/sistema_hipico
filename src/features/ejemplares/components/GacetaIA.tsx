"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLAVE_GEMINI_KEY, transformarGaceta, transformarGacetaTexto } from "@/features/gaceta/lib/ia";
import { guardarHistorialGaceta, registrarEjemplares, registrarGacetaEHistorial } from "@/features/gaceta/lib/padron";
import { sincronizarCarrerasAlCentral, type ResultadoCargaCarrera } from "@/features/carreras/lib/sincronizar";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { emitirToast } from "@/shared/lib/mensajeria";
import { useConfirmar } from "@/shared/store/useConfirmStore";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { numeroDeCarrera } from "@/features/gaceta/lib/numeros";
import { CarreraGacetaCard } from "@/features/ejemplares/components/CarreraGacetaCard";
import { listarHipodromos, publicarTablasLote, type OpcionHipodromo } from "@/features/tablas/lib/rpc";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { supabase } from "@/core/supabase";
import {
  acumularEnEnsamblaje,
  cargadasEnEnsamblaje,
  deduplicarCarreras,
  duplicadasEnEnsamblaje,
  leerRegistro,
  limpiarTodoRegistro,
  listaHors,
  marcarEnviadas,
  normalizarFechaIso,
  parsearRangoPaginas,
  persistirRegistro,
  type CarreraRegistro,
  type ResumenPadron,
} from "@/features/gaceta/lib/ui";

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
    getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }>;
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

/**
 * Extrae el TEXTO de un PDF (capa de texto de pdf.js).
 *
 * POR QUÉ EXISTE: la vía de imágenes se trunca. Un PDF de 13 carreras se
 * manda como imágenes y el modelo entrega las primeras y se queda sin tokens
 * para las últimas (Belmont 1-3, Charles Town 4-6, Keeneland 4-6: las tres
 * últimas se perdían). Con el texto se puede PARTIR el documento en bloques
 * de 2-3 carreras, y cada bloque cierra su respuesta completo.
 *
 * Cuando el PDF es una imagen escaneada no tiene capa de texto: ahí se
 * devuelve cadena vacía y el llamador cae a la vía de imágenes, que es la
 * única que puede leer un escaneo.
 *
 * `tope` limita las páginas leídas (mismo criterio que el render).
 */
async function extraerPdfComoTexto(file: File, tope?: number): Promise<string> {
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
      const page = await doc.getPage(i);
      try {
        const contenido = await page.getTextContent();
        const lineas = (contenido?.items ?? [])
          .map((it) => `${it.str ?? ""}${it.hasEOL ? "\n" : " "}`)
          .join("");
        if (lineas.trim()) paginas.push(lineas);
      } catch {
        /* página sin capa de texto: se omite */
      }
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
  return paginas.join("\n\n");
}

const SQL_AVISO_KEY = "club_gaceta_sql_aviso";

export type ResultadoInformeCarga = {
  hipodromo: string;
  fecha: string;
  totalCarreras: number;
  creadas: number;
  actualizadas: number;
  previamenteCargadas: number;
  tablasPublicadas: number;
  ejemplaresNuevos: number;
  ejemplaresVinculados: number;
  eraGacetaPrevia: boolean;
};

function convertirCarreraATablaFija(c: CarreraRegistro, fechaIso: string): TablaFijaRow {
  const hipo = String(c.hipodromo ?? "").trim().toUpperCase();
  const numCarrera = Number(c.carrera) || 1;
  const ejemplares = (c.ejemplares?.length ? c.ejemplares : c.caballos ?? []).map((e) => {
    let nac = e.nacionalidad ? String(e.nacionalidad).toUpperCase() : "";
    if (!nac) {
      const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(hipo);
      nac = esAmericano ? "US" : "VE";
    }
    return {
      numero: String(e.numero),
      nombre: String(e.nombre || "").trim().toUpperCase(),
      nacionalidad: nac,
      valor_ejemplar: Number(e.valor) || 0,
      retirado: false,
      ganador: false,
      ejemplar_id: e.ejemplar_id ?? null,
      invalidado: false,
    };
  });

  return {
    id: `gaceta-${hipo}-${numCarrera}-${fechaIso}`,
    hipodromo: hipo,
    hipodromo_id: null,
    carrera: numCarrera,
    fecha: fechaIso,
    fecha_creacion: new Date().toISOString(),
    estado: "Abierta",
    premio_original: Number(c.premio) || 100,
    premio_recalculado: Number(c.premio) || 100,
    suma_base_tabla: ejemplares.reduce((acc, curr) => acc + (curr.valor_ejemplar || 0), 0),
    limite_ventas: 0,
    cantidad_vendida: 0,
    moneda: "USD",
    tasa_cambio: null,
    distancia_carrera: c.distancia != null ? String(c.distancia) : null,
    superficie: (c.superficie || "ARENA").toUpperCase(),
    retirados_oficiales: null,
    comision_grupo: 0,
    grupo_venta: null,
    caballos: ejemplares,
    tabla_grupos: null,
  };
}

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
  /**
   * Capa de TEXTO del documento (si el PDF la trae).
   *
   * Cuando existe, la transcripción va por bloques de 2-3 carreras: es lo que
   * evita que las últimas carreras del documento se pierdan por truncamiento.
   * Cuando no existe (PDF escaneado), se manda la página como imagen.
   */
  const [textoDocumento, setTextoDocumento] = useState("");
  /** Fecha de la jornada que se está cargando. Por defecto HOY, pero admite días
   *  FUTUROS: las carreras del documento que no traigan fecha propia se sellan
   *  con esta fecha, para poder cargar/registrar/publicar jornadas posteriores. */
  const [fechaJornada, setFechaJornada] = useState(
    () => useCarrerasDiaStore.getState().fechaSeleccionada || hoyLocal()
  );
  /** Ref con el valor más reciente: la usan la recuperación del registro y la
   *  extracción, que corren una sola vez y no deben depender del estado. */
  const fechaJornadaRef = useRef(fechaJornada);
  useEffect(() => {
    fechaJornadaRef.current = fechaJornada;
  }, [fechaJornada]);
  const [vistaIndice, setVistaIndice] = useState(-1);
  const [carreras, setCarreras] = useState<CarreraRegistro[]>([]);
  const [resumen, setResumen] = useState<ResumenPadron>({ nuevos: 0, vinculados: 0 });
  const [registrando, setRegistrando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [faseRegistro, setFaseRegistro] = useState<"extrayendo" | "registrando" | "listo" | "error" | "">("");
  const [reporteCarga, setReporteCarga] = useState<ResultadoCargaCarrera[]>([]);
  const [historial, setHistorial] = useState(false);
  const [enviando, setEnviando] = useState(false);
  /** INDICADOR: carreras ya cargadas en el Ensamblaje vs. las del día. */
  const [cargadas, setCargadas] = useState(0);
  const [enviadasHoy, setEnviadasHoy] = useState(0);
  /** Catálogo de hipódromos activos: para mostrar el nombre propio en las cards. */
  const [hipodromos, setHipodromos] = useState<OpcionHipodromo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const confirmar = useConfirmar();

  useEffect(() => {
    void listarHipodromos().then((hs) => setHipodromos(hs)).catch(() => setHipodromos([]));
  }, []);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    emitirToast(msg, tipo);
  }, []);

  /**
   * Indicador "cargadas vs pendientes": refresca cuántas carreras hay ya en el
   * buzón del Ensamblaje y cuántas del día se mandaron desde la Gaceta.
   */
  const [informeResultado, setInformeResultado] = useState<ResultadoInformeCarga | null>(null);
  const [alertaGacetaPrevia, setAlertaGacetaPrevia] = useState<{
    existe: boolean;
    carreras: number;
    hipodromo: string;
    fecha: string;
  } | null>(null);

  const verificarGacetaExistente = useCallback(async (hipo: string, f: string) => {
    if (!supabase || !hipo.trim() || !f.trim()) return;
    try {
      const { count } = await supabase
        .from("tablas_fijas")
        .select("id", { count: "exact", head: true })
        .ilike("hipodromo", hipo.trim())
        .eq("fecha", f.trim());
      if (count && count > 0) {
        setAlertaGacetaPrevia({
          existe: true,
          carreras: count,
          hipodromo: hipo.trim().toUpperCase(),
          fecha: f.trim(),
        });
      } else {
        setAlertaGacetaPrevia(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const refrescarContadores = useCallback(() => {
    setCargadas(cargadasEnEnsamblaje());
    const reg = leerRegistro();
    setEnviadasHoy(reg && reg.length ? reg.filter((c) => c.enviada).length : 0);
  }, []);

  const registrarCarrerasEnElDia = useCallback(
    async (
      loteCarreras: CarreraRegistro[],
      fechaDestino?: string,
      registroAutomatico = false
    ): Promise<boolean> => {
      if (!loteCarreras.length) return false;
      const fecha = fechaDestino || normalizarFechaIso(fechaJornadaRef.current);
      if (!fecha) {
        setEstado("⚠️ Debe seleccionar la fecha de la jornada antes de registrar.");
        toast("Debe seleccionar la fecha de la jornada antes de registrar.", "warning");
        return false;
      }
      const lote = loteCarreras.map((c) => ({ ...c, fecha }));
      setSincronizando(true);
      setFaseRegistro("registrando");
      setEstado("💾 Registrando automáticamente en Carreras del Día...");
      setReporteCarga([]);
      try {
        try {
          const resumenPadron = await registrarEjemplares(lote as unknown as Array<Record<string, unknown>>);
          setResumen({ nuevos: resumenPadron.nuevos, vinculados: resumenPadron.vinculados });
          if (resumenPadron.errorDb || resumenPadron.fallidos > 0) {
            toast(
              `Carreras registradas; padrón de ejemplares parcialmente actualizado: ${resumenPadron.errorDb ?? `${resumenPadron.fallidos} ejemplar(es) fallidos.`}`,
              "warning"
            );
          }
        } catch (e) {
          toast(
            `No se pudieron vincular todos los ejemplares al padrón: ${e instanceof Error ? e.message : String(e)}`,
            "warning"
          );
        }
        const sincronizacion = await sincronizarCarrerasAlCentral(lote, "gaceta-ia");
        setReporteCarga(sincronizacion.resultados);
        if (!sincronizacion.ok || sincronizacion.resultados.some((r) => r.estado === "ERROR")) {
          throw new Error(sincronizacion.error || "No se pudieron guardar las carreras en la matriz central.");
        }

        useCarrerasDiaStore.getState().setFecha(fecha);
        const actualizables = new Set(
          sincronizacion.resultados
            .filter((r) => r.estado === "CREADA" || r.estado === "ACTUALIZADA_COMPLETADA")
            .map((r) => `${claveHipodromo(r.hipodromo)}|${Number(r.carrera)}`)
        );
        const loteActualizable = lote.filter((c) =>
          actualizables.has(`${claveHipodromo(c.hipodromo)}|${Number(c.carrera)}`)
        );
        useCarrerasDiaStore.getState().fusionarLote(
          loteActualizable.map((c) => ({
            fecha,
            hipodromo: String(c.hipodromo ?? "").trim().toUpperCase(),
            carrera: Number(c.carrera) || 0,
            estado: "Programada" as const,
            ventas: [],
            pago: null,
          }))
        );
        const registrarEnCache = useRegistroCentral.getState().registrarCarrera;
        for (const c of loteActualizable) {
          const ejemplares = c.ejemplares?.length ? c.ejemplares : c.caballos ?? [];
          registrarEnCache({
            fecha,
            hipodromo: String(c.hipodromo ?? "").trim().toUpperCase(),
            carrera: Number(c.carrera) || 0,
            estado: "Programada",
            origen: "ia",
            caballos: ejemplares.map((e) => ({
              numero: String(e.numero),
              nombre: e.nombre,
              nacionalidad: e.nacionalidad ?? "VE",
              jockey: e.jockey,
              entrenador: e.entrenador,
              peso: e.peso,
              medicamento: e.medicamento,
              implementos: e.implementos,
            })),
            distancia: c.distancia != null ? String(c.distancia) : null,
            superficie: c.superficie ?? null,
            premio: c.premio ?? null,
          });
        }
        // PUBLICACIÓN AUTOMÁTICA DIRECTA DE JUGADAS EN LA PLATAFORMA (TABLAS FIJAS)
        // Elimina el reproceso manual de ensamblaje: las tablas de jugadas se crean y se publican automáticamente.
        let tablasPublicadas = 0;
        try {
          const tablasLote = lote.map((c) => convertirCarreraATablaFija(c, fecha));
          const resPublicacion = await publicarTablasLote(tablasLote);
          tablasPublicadas = resPublicacion.okCount;
        } catch (errTablas) {
          console.warn("Aviso en publicación automática de tablas:", errTablas);
        }

        // Marcar en almacenamiento local como enviadas y aplicadas
        const carrerasActualizadas = lote.map((c) => ({
          ...c,
          enviada: true,
          aplicada: true,
        }));
        persistirRegistro(carrerasActualizadas);
        refrescarContadores();

        setCarreras((prev) =>
          prev.map((c) => {
            const actualizada = lote.find(
              (n) =>
                claveHipodromo(n.hipodromo) === claveHipodromo(c.hipodromo) &&
                Number(n.carrera) === Number(c.carrera)
            );
            return actualizada ? { ...actualizada, enviada: true, aplicada: true, ejemplares: (actualizada.ejemplares ?? []).map((e) => ({ ...e })) } : c;
          })
        );
        setFaseRegistro("listo");
        setEstado(`✅ Carreras y jugadas registradas y publicadas en la plataforma · ${fecha}`);
        const conteo = (estado: ResultadoCargaCarrera["estado"]) =>
          sincronizacion.resultados.filter((r) => r.estado === estado).length;

        // Disparar mensaje y reporte detallado de resultado para informar
        const info: ResultadoInformeCarga = {
          hipodromo: lote[0]?.hipodromo ? String(lote[0].hipodromo).toUpperCase() : "HIPÓDROMO",
          fecha,
          totalCarreras: lote.length,
          creadas: conteo("CREADA"),
          actualizadas: conteo("ACTUALIZADA_COMPLETADA"),
          previamenteCargadas: conteo("PREVIAMENTE_CARGADA"),
          tablasPublicadas: tablasPublicadas || lote.length,
          ejemplaresNuevos: resumen.nuevos,
          ejemplaresVinculados: resumen.vinculados,
          eraGacetaPrevia: conteo("PREVIAMENTE_CARGADA") > 0 || conteo("ACTUALIZADA_COMPLETADA") > 0,
        };
        setInformeResultado(info);

        toast(
          registroAutomatico
            ? `✅ IA registró ${conteo("CREADA")} nuevas, completó ${conteo("ACTUALIZADA_COMPLETADA")} carreras y publicó ${tablasPublicadas || lote.length} tablas de jugadas (Fecha: ${fecha})`
            : `✅ Sincronización y publicación: ${conteo("CREADA")} nuevas, ${tablasPublicadas || lote.length} tablas fijas activas (Fecha: ${fecha}).`,
          "success"
        );
        return true;
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : String(e);
        setFaseRegistro("error");
        setEstado(`No se pudieron registrar las carreras en el catálogo central: ${mensaje}`);
        toast(`❌ No se completó el registro automático: ${mensaje}`, "error");
        return false;
      } finally {
        setSincronizando(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    refrescarContadores();
  }, [refrescarContadores]);

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
    const guardadas = leerRegistro();
    if (!guardadas || !guardadas.length) return;

    const diaActual = fechaJornadaRef.current || hoyLocal();
    const guardadasHoy = guardadas.filter((c) => {
      const f = c.fecha ? (normalizarFechaIso(c.fecha) || "").slice(0, 10) : "";
      return f === diaActual;
    });

    if (!guardadasHoy.length) {
      limpiarTodoRegistro();
      setCarreras([]);
      setEstado("");
      return;
    }

    if (guardadasHoy.length !== guardadas.length) {
      persistirRegistro(guardadasHoy);
    }
    // Un registro guardado con versiones viejas puede traer repetidas: se
    // normaliza una sola vez al abrir y se vuelve a persistir sin duplicados.
    const arr = deduplicarCarreras(guardadasHoy).lista;
    if (arr.length !== guardadasHoy.length) persistirRegistro(arr);
    if (!arr.length) return;
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
      // Si el registro guardado no traía fecha, se sella con la jornada elegida.
      if (!copia.fecha) copia.fecha = fechaJornadaRef.current;
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
    // Registro CENTRAL: las carreras recuperadas del registro local pueden venir
    // de una sesión previa a la centralización; se publican igual en la matriz.
    void sincronizarCarrerasAlCentral(lista, "gaceta-ia").catch((e) =>
      console.warn("Registro central (recuperación de la gaceta):", e?.message || e)
    );
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
        const textos: string[] = [];
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
              const tope = parseInt(topePaginas, 10);
              // Capa de texto primero: si el PDF la tiene, se transcribe por
              // BLOQUES (2-3 carreras por llamada) y no se trunca. Si no la
              // tiene (PDF escaneado), se sigue con las páginas como imágenes.
              setEstado(`Leyendo el texto de ${f.name}...`);
              try {
                const texto = await extraerPdfComoTexto(f, tope > 0 ? tope : undefined);
                if (texto.trim().length >= 400) textos.push(texto);
              } catch {
                /* sin capa de texto: se usa la vía de imágenes */
              }
              setEstado(`Renderizando ${f.name}...`);
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
        if (textos.length) {
          setTextoDocumento(textos.join("\n\n"));
          setEstado(
            `${nuevas.length} página(s) listas · documento con capa de texto: se transcribirá por bloques (2-3 carreras por llamada) para que no se trunque.`
          );
        } else if (nuevas.length) {
          setEstado(`${nuevas.length} página(s) listas (sin capa de texto: se envía como imágenes).`);
        }
        if (nuevas.length) {
          setPaginas((prev) => [...prev, ...nuevas]);
          setSeleccionadas((prev) => {
            const n = new Set(prev);
            nuevas.forEach((p) => n.add(p.id));
            return n;
          });
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
    const hayTexto = textoDocumento.trim().length >= 400;
    if (!imgs.length && !hayTexto) {
      setEstado("Selecciona al menos una página.");
      toast("Selecciona al menos una página.", "warning");
      return;
    }
    const pesoSel = `${imgs.reduce((a, d) => a + pesoMB(d), 0).toFixed(1)} MB`;
    setTrabajando(true);
    setFaseRegistro("extrayendo");
    setEstado(
      hayTexto
        ? "🤖 Extrayendo ejemplares y carreras con IA..."
        : `🤖 Extrayendo ejemplares y carreras con IA... · ${imgs.length} página(s) (${pesoSel})`
    );
    setDiag("");
    try {
      // VÍA DE TEXTO (preferida): el documento se parte en bloques de 2-3
      // carreras, así ninguna respuesta se trunca. Solo si el PDF no traía
      // capa de texto se cae a la vía de imágenes.
      const res = hayTexto
        ? await transformarGacetaTexto(
            clave.trim(),
            textoDocumento,
            (hecho, total) => setProgreso({ hecho, total }),
            (s) => setEstado(s)
          )
        : await transformarGaceta(clave.trim(), imgs, (hecho, total) => setProgreso({ hecho, total }), (s) => setEstado(s));
      setDiag(res.diag ?? "");
      if (!res.ok) {
        setEstado(res.cuotaTotal ? "Cuota DIARIA gratuita de Gemini agotada. Prueba otra vez mañana o consigue otra clave gratis (aistudio.google.com/apikey)." : res.error ?? "Error transformando.");
        setCarreras([]);
        setResumen({ nuevos: 0, vinculados: 0 });
        setFaseRegistro("error");
        toast(
          res.cuotaTotal
            ? "Cuota diaria gratuita agotada: cambia de clave o reintenta mañana."
            : "❌ " + (res.error ?? "Error transformando."),
          res.cuotaTotal ? "warning" : "error"
        );
        return;
      }
      // Una extracción parcial se puede registrar, pero se señala como tal.
      if (res.cuotaTotal) toast(`Cuota agotada en parte de Gemini: resultado PARCIAL (${res.carreras.length} carrera(s)).`, "warning");
      // CONTROL DE DUPLICADOS: el mismo PDF (o dos páginas con la misma carrera)
      // no debe generar dos cards idénticas.
      const dedupe = deduplicarCarreras(res.carreras);
      if (dedupe.lista.length === 0) {
        setFaseRegistro("error");
        setEstado("La IA no encontró carreras válidas para registrar.");
        toast("La IA no encontró carreras válidas para registrar.", "warning");
        return;
      }
      const fechaDestino = normalizarFechaIso(fechaJornadaRef.current);
      if (!fechaDestino) {
        setFaseRegistro("error");
        setEstado("⚠️ Por favor seleccione la fecha de la jornada antes de procesar.");
        toast("Por favor seleccione la fecha de la jornada antes de procesar.", "warning");
        return;
      }
      const lista: CarreraRegistro[] = dedupe.lista.map((c) => ({
        ...c,
        // La fecha elegida para la jornada manda sobre fechas inferidas por IA:
        // evita que un encabezado erróneo o histórico desvíe la carrera.
        fecha: fechaDestino,
        premio: 100,
        ejemplares: (c.ejemplares || []).map((e) => ({ ...e, valor: 0, pts: 0 })),
        seleccionada: true,
        enviada: false,
        aplicada: false,
      }));
      setCarreras(lista);
      setResumen({ nuevos: 0, vinculados: 0 });
      persistirRegistro(lista);
      setEstado("💾 Registrando automáticamente en Carreras del Día...");
      if (dedupe.quitadas > 0) {
        toast(
          `🔁 ${dedupe.quitadas} carrera(s) repetida(s) en el documento: no se cargaron dos veces.`,
          "warning"
        );
      }
      if (res.avisoNumeracion) {
        toast(`🔢 ${res.avisoNumeracion}.`, "warning");
      }
      refrescarContadores();

      if (lista[0]?.hipodromo) {
        void verificarGacetaExistente(lista[0].hipodromo, fechaDestino);
      }

      const registrado = await registrarCarrerasEnElDia(lista, fechaDestino, true);
      if (!registrado) return;

      // Historial (gaceta_procesada) + MEMORIA HISTÓRICA de cada ejemplar, en
      // segundo plano y sin bloquear. La RPC `rpc_registrar_gaceta_e_historial`
      // hace las dos cosas: deja constancia de la gaceta procesada y alimenta
      // el histórico de cada caballo, que es lo que después usa la
      // proyección (Inteligencia Hípica) para calcular probabilidades.
      const fecha = lista.find((c) => c.fecha)?.fecha ?? null;
      registrarGacetaEHistorial(lista, fecha, "desconocido")
        .then((r) => {
          if (r.ok) {
            setEstado(
              `${res.cuotaTotal ? "PARCIAL · " : ""}Listo: ${lista.length} carrera(s) transcritas · memoria histórica alimentada.`
            );
            return;
          }
          console.warn("No se guardó el historial/memoria:", r.error);
          if (!sessionStorage.getItem(SQL_AVISO_KEY)) {
            sessionStorage.setItem(SQL_AVISO_KEY, "1");
            toast(
              "La gaceta se procesó bien, pero la memoria histórica no se pudo guardar (falta la RPC o permisos).",
              "warning"
            );
          }
        })
        .catch((e) => {
          console.warn("No se guardó el historial (gaceta_procesada):", e?.message || e);
          if (!sessionStorage.getItem(SQL_AVISO_KEY)) {
            sessionStorage.setItem(SQL_AVISO_KEY, "1");
            toast("La gaceta se procesó bien, pero el historial no se pudo guardar (falta la tabla o permisos).", "warning");
          }
        });

      if (res.cuotaTotal) setEstado(`PARCIAL · ${lista.length} carrera(s) registradas en la jornada ${fechaDestino}.`);
    } catch (e) {
      const msj = e instanceof Error ? e.message : String(e);
      setEstado("Error: " + msj);
      toast("❌ " + msj, "error");
    } finally {
      setTrabajando(false);
      setProgreso(null);
    }
  }, [clave, paginas, seleccionadas, textoDocumento, toast, refrescarContadores, registrarCarrerasEnElDia]);

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
      const conNombre = lista
        .filter((c) => listaHors(c).some((e) => String(e.nombre || "").trim()))
        // Sella con la jornada elegida las carreras que aún no tengan fecha.
        .map((c) => (c.fecha ? c : { ...c, fecha: fechaJornadaRef.current }));
      if (!conNombre.length) {
        toast("Las carreras marcadas no tienen ejemplares con nombre.", "warning");
        return;
      }
      setEnviando(true);
      const prev = carreras.map((c) => ({ ...c }));
      marcarEnviadas(prev, conNombre);
      // CONTROL DE DUPLICADOS: lo que ya estaba en el Ensamblaje se REEMPLAZA
      // (mismo día + hipódromo + carrera), no se apila otra copia.
      const yaEstaban = duplicadasEnEnsamblaje(conNombre);
      acumularEnEnsamblaje(conNombre);
      // Re-publica en el registro central por si el operador ajustó el hipódromo,
      // la distancia o el Nº de la carrera en las cards antes de enviar.
      void sincronizarCarrerasAlCentral(conNombre, "gaceta-ia").catch((e) =>
        console.warn("Registro central (envío al ensamblaje):", e?.message || e)
      );
      // Registro automático en el Padrón (UPSERT por nombre + nacionalidad).
      const tot = await registrarEjemplares(conNombre as unknown as Array<Record<string, unknown>>);
      // Limpieza del estado local: solo quedan las carreras NO enviadas, para
      // evitar envíos duplicados (la sección queda en blanco tras enviar).
      const restantes = prev
        .filter((c) => !c.enviada)
        .map((c) => ({ ...c, ejemplares: (c.ejemplares || []).map((e) => ({ ...e })) }));
      persistirRegistro(restantes.map((c) => ({ ...c, enviada: !!c.enviada, aplicada: !!c.aplicada })));
      setCarreras(restantes);
      refrescarContadores();
      const nEjemplares = (tot?.nuevos ?? 0) + (tot?.vinculados ?? 0);
      toast(
        `${conNombre.length} carrera(s) enviadas al ensamblaje${
          yaEstaban ? ` · ${yaEstaban} ya estaban y se actualizaron (sin duplicar)` : ""
        } y ${nEjemplares} ejemplares registrados en el padrón.${
          tot?.fallidos ? ` (${tot.fallidos} ejemplar(es) fallido(s))` : ""
        }`,
        tot?.fallidos ? "warning" : "success"
      );
      setEnviando(false);
      setTimeout(() => router.push("/tablas-fijas"), 700);
    },
    [carreras, enviando, router, refrescarContadores, toast]
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
    void confirmar({
      titulo: "Limpiar registro del día",
      mensaje: `${msj}Esta acción borra el registro guardado (no afecta las tablas ya publicadas).`,
      tipo: "warning",
      textoConfirmar: "Limpiar",
      destructivo: true,
    }).then((ok) => {
      if (!ok) return;
      limpiarTodoRegistro();
      setCarreras([]);
      setResumen({ nuevos: 0, vinculados: 0 });
      refrescarContadores();
      setEstado("Registro limpiado. Cargue un nuevo documento para empezar.");
      toast("Registro del día limpiado.", "success");
    });
  }, [carreras, refrescarContadores, toast, confirmar]);

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
  // INDICADOR cargadas vs pendientes: lo que ya está en el Ensamblaje y lo que
  // falta mandar de este registro. Las marcadas que ya están se REEMPLAZAN.
  const pendientes = carreras.filter((c) => !c.enviada).length;
  const duplicadasSel = duplicadasEnEnsamblaje(carreras.filter((c) => c.seleccionada));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            📤 Subir la Gaceta (PDF o Imagen)
          </h3>
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surfaceAlt p-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              <span>📅 Fecha de la jornada</span>
              <input
                type="date"
                value={fechaJornada}
                onChange={(e) => {
                  const fecha = e.target.value;
                  fechaJornadaRef.current = fecha;
                  setFechaJornada(fecha);
                  if (fecha) useCarrerasDiaStore.getState().setFecha(fecha);
                }}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
            </label>
            <p className="max-w-md pb-1 text-[10px] leading-snug text-slate-500">
              La fecha seleccionada se asigna a todas las carreras extraídas. Sirve para cargar, registrar y publicar
              <b> jornadas de días posteriores</b> (o anteriores) al actual.
            </p>
          </div>

          {alertaGacetaPrevia?.existe && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm flex items-start gap-2.5">
              <span className="text-xl">⚠️</span>
              <div>
                <p className="font-black uppercase tracking-wide">
                  Gaceta detectada previamente en la plataforma
                </p>
                <p className="text-[11px] mt-0.5 text-amber-800">
                  Ya existen <b>{alertaGacetaPrevia.carreras} carreras/tablas registradas</b> para <b>{alertaGacetaPrevia.hipodromo}</b> en la fecha <b>{alertaGacetaPrevia.fecha}</b>.
                  Al procesar, el sistema actualizará automáticamente las carreras y jugadas existentes sin duplicar registros.
                </p>
              </div>
            </div>
          )}
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
              className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-right text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
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
            disabled={trabajando || !clave.trim() || (seleccionadas.size === 0 && textoDocumento.trim().length < 400)}
            onClick={() => void alTransformar()}
            title={
              seleccionadas.size === 0 && textoDocumento.trim().length < 400
                ? "Selecciona al menos una página para extraer sus carreras"
                : `Enviar ${textoDocumento.trim().length >= 400 ? "el documento por bloques" : `${seleccionadas.size} página(s) seleccionada(s)`} a Gemini`
            }
          >
            ✨ Transformar con IA y Registrar en el Día
          </Button>
          {trabajando && (
            <div className="mt-3 rounded-lg border border-primary-200 bg-primary-500/5 p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wide text-primary-700">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
                  {faseRegistro === "registrando"
                    ? "💾 Registrando automáticamente en Carreras del Día…"
                    : "🤖 Extrayendo ejemplares y carreras con IA…"}
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
          {faseRegistro === "listo" && carreras.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => router.push("/carreras")}
            >
              Ir a Carreras del Día →
            </Button>
          )}
          {diag && (
            <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] font-mono text-success-500">
              {diag}
            </pre>
          )}
        </div>
      </div>

      {/* INDICADOR: carreras CARGADAS en el Ensamblaje vs PENDIENTES en este
          registro. Vive arriba de todo para que se vea también con la lista
          vacía (después de limpiar o de haber enviado todo). */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surfaceAlt px-3 py-2">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
          📫 En el Ensamblaje: {cargadas} cargada{cargadas === 1 ? "" : "s"}
        </span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-blue-700">
          ✅ Enviadas de este registro: {enviadasHoy}
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-700">
          ⏳ Pendientes de ensamblar: {pendientes}
        </span>
        {duplicadasSel > 0 && (
          <span
            className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-orange-700"
            title="Esas carreras ya están en el Ensamblaje: al enviar se actualizan con lo nuevo en vez de sumar una copia."
          >
            🔁 {duplicadasSel} ya cargadas → se reemplazan (no se duplican)
          </span>
        )}
        {cargadas > 0 && (
          <span className="text-[10px] font-semibold text-slate-500">
            Las repetidas (mismo día + hipódromo + carrera) se reemplazan, nunca se apilan.
          </span>
        )}
      </div>

      {reporteCarga.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4" aria-label="Auditoría de carga por carrera">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">📊 Auditoría de carga por carrera</h3>
            <span className="text-[10px] font-semibold text-slate-500">
              {reporteCarga.filter((r) => r.estado !== "ERROR").length} procesadas · {reporteCarga.filter((r) => r.estado === "ERROR").length} errores
            </span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(["CREADA", "ACTUALIZADA_COMPLETADA", "PREVIAMENTE_CARGADA", "PROTEGIDA", "ERROR"] as const).map((estadoCarga) => {
              const total = reporteCarga.filter((r) => r.estado === estadoCarga).length;
              return total > 0 ? (
                <span key={estadoCarga} className="rounded-full border border-line bg-surfaceAlt px-2 py-1 text-[10px] font-bold text-slate-600">
                  {estadoCarga.replaceAll("_", " ")}: {total}
                </span>
              ) : null;
            })}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surfaceAlt text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Hipódromo</th>
                  <th className="px-3 py-2">Carrera</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {reporteCarga.map((r, i) => (
                  <tr key={`${r.fecha}|${r.hipodromo}|${r.carrera ?? "documento"}|${i}`} className="border-t border-line">
                    <td className="whitespace-nowrap px-3 py-2">{r.fecha}</td>
                    <td className="px-3 py-2">{r.hipodromo}</td>
                    <td className="px-3 py-2">{r.carrera ?? "—"}</td>
                    <td className={`whitespace-nowrap px-3 py-2 font-bold ${r.estado === "ERROR" ? "text-red-600" : r.estado === "PROTEGIDA" ? "text-amber-600" : "text-emerald-700"}`}>
                      {r.estado.replaceAll("_", " ")}
                    </td>
                    <td className="min-w-64 px-3 py-2 text-slate-600">{r.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
              <Button
                variant="outline"
                size="sm"
                disabled={sincronizando || enviando}
                onClick={() => void registrarCarrerasEnElDia(carreras)}
                title="Guarda otra vez los cambios manuales de ejemplares y datos de carrera en la matriz central."
              >
                {sincronizando ? "Sincronizando…" : "🔄 Actualizar / Re-sincronizar en Base de Datos"}
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
                hipodromos={hipodromos}
                onChange={(nc) => setCarreras((prev) => prev.map((x, k) => (k === i ? nc : x)))}
                onEnviar={(id) => void enviar([carreras[id]])}
                onEliminar={() => eliminarCarrera(i)}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] italic leading-relaxed text-slate-500">
            💡 Al terminar la extracción, las carreras se registran en el catálogo central y quedan disponibles en los módulos
            de la jornada. Revise los datos; use <b>Actualizar / Re-sincronizar</b> si edita una tarjeta. El envío al Ensamblaje
            sigue siendo una acción aparte.
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

      {/* MODAL INFORMATIVO CON EL RESULTADO DE LA CARGA DE GACETA IA */}
      {informeResultado && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-500/40 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🏇</span>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide text-emerald-950">
                    Carga y Registro con IA Finalizado
                  </h3>
                  <p className="text-[11px] text-emerald-700">
                    Carreras y jugadas activadas automáticamente en la plataforma
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInformeResultado(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-emerald-100 hover:text-slate-700"
                aria-label="Cerrar modal de informe"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-3">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-500">Hipódromo</span>
                  <p className="text-sm font-black text-slate-900">{informeResultado.hipodromo}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-black uppercase text-slate-500">Fecha Jornada</span>
                  <p className="text-sm font-mono font-bold text-slate-900">{informeResultado.fecha}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 text-center">
                  <span className="text-[10px] font-black uppercase text-emerald-800">Carreras Creadas</span>
                  <p className="text-xl font-black text-emerald-700">{informeResultado.creadas}</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-2.5 text-center">
                  <span className="text-[10px] font-black uppercase text-sky-800">Actualizadas</span>
                  <p className="text-xl font-black text-sky-700">{informeResultado.actualizadas}</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5 text-center">
                  <span className="text-[10px] font-black uppercase text-indigo-800">Tablas Publicadas</span>
                  <p className="text-xl font-black text-indigo-700">{informeResultado.tablasPublicadas}</p>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-slate-50/80 p-3 text-xs text-slate-700 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span>🐎 Ejemplares vinculados en Padrón:</span>
                  <span className="font-bold font-mono text-emerald-700">+{informeResultado.ejemplaresVinculados}</span>
                </div>
                {informeResultado.ejemplaresNuevos > 0 && (
                  <div className="flex justify-between items-center">
                    <span>✨ Nuevos ejemplares registrados:</span>
                    <span className="font-bold font-mono text-emerald-700">+{informeResultado.ejemplaresNuevos}</span>
                  </div>
                )}
                {informeResultado.previamenteCargadas > 0 && (
                  <div className="flex justify-between items-center text-amber-800">
                    <span>ℹ️ Carreras completas previas (sin cambios):</span>
                    <span className="font-bold font-mono">{informeResultado.previamenteCargadas}</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                ✅ <b>Sin reproceso:</b> Las carreras y tablas fijas ya están publicadas en la base de datos y disponibles de inmediato para realizar apuestas en <b>Taquilla, Gestión de Jugadas, Marcas y Portal</b>. No es necesario acudir a Ensamblaje.
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInformeResultado(null)}
              >
                Cerrar
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setInformeResultado(null);
                  router.push("/apuestas");
                }}
              >
                Ir a Apuestas 🐎🎲
              </Button>
            </div>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}

export default GacetaIA;