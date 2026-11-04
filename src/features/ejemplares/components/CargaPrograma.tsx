"use client";

import { getHorseColor } from "@/shared/lib/horseColors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/shared/components/ui/Card";
import { Button } from "@/shared/components/ui/Button";
import { Input } from "@/shared/components/ui/Input";
import { DateInput } from "@/shared/components/ui/DateInput";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { BuscadorPadron, type OpcionPadron } from "@/features/ejemplares/components/BuscadorPadron";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { nombreHipodromoParaMostrar, nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";
import { registrarEjemplares, listarPadronSimple } from "@/features/gaceta/lib/padron";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";
import {
  guardarPrograma,
  hoyLocal,
  leerProgramaPorFecha,
  type CarreraPrograma,
  type ProgramaDia,
} from "@/features/gaceta/lib/programa";
import { ModalSincronizadorUsa } from "@/features/carreras/components/ModalSincronizadorUsa";
import { ModalImportarGacetaPdf } from "@/features/inteligencia/components/ModalImportarGacetaPdf";
import {
  HIPODROMOS_USA_DISPONIBLES,
  CATALOGO_DRF_OFICIAL,
  parsearUrlDrf,
  formatearFechaDrf,
  detectarHipodromosActivosDia,
  sincronizarCarrerasAmericanasDia,
  iniciarAutoActualizadorRetirados,
  detenerAutoActualizadorRetirados,
  estaAutoActualizadorActivo,
} from "@/features/carreras/lib/sincronizar-usa-tvg-drf";

const SUPERFICIES = ["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"];

type Caballo = CarreraPrograma["caballos"][number];

const plantaCaballo = (numero: number): Caballo => ({
  numero,
  nombre: "",
  nacionalidad: "VE",
  valor: 0,
  ejemplar_id: null,
  jockey: "",
  peso: "",
});

const pluma = "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/** Nacionalidad por defecto según el hipódromo (misma heurística que el legacy). */
function nacDefault(hipo: string): string {
  const h = (hipo || "").toUpperCase();
  if (/(RINCONADA|VALENCIA|CARACAS|CREOLE|NACIONAL|LA RINCONADA)/.test(h)) return "VE";
  if (/(GULFSTREAM|AQUEDUCT|BELMONT|SARATOGA|CHURCHILL|KENTUCKY|SANTA ANITA|DEL MAR|LAUREL|MONMOUTH|GOLDEN GATE|WOODBINE)/.test(h)) return "USA";
  return "VE";
}

const PAISES: Record<string, string[]> = {
  VE: ["VENEZUELA", "VENEZOLANO", "VENEZOLANA", "VEN"],
  USA: ["USA", "ESTADOS UNIDOS", "UNITED STATES"],
  BR: ["BRASIL", "BRA"],
  AR: ["ARGENTINA", "ARG"],
  CL: ["CHILE", "CHL"],
  MX: ["MEXICO", "MEX"],
  PA: ["PANAMA", "PAN"],
  PE: ["PERU", "PER"],
  CO: ["COLOMBIA", "COL"],
  EC: ["ECUADOR", "ECU"],
  UY: ["URUGUAY", "URU"],
};
const CODIGOS_NAC = new Set(["VE", "US", "USA", "BR", "AR", "CL", "MX", "PA", "PE", "CO", "EC", "UY"]);

/**
 * Parsea el bloque pegable de la Carga Rápida (una línea por ejemplar, mismo
 * formato que el legacy): `Nº NOMBRE [NAC] [VALOR]`. Tolerante a espacios,
 * códigos/países de nacionalidad y valores con `$`/comas.
 */
function parseLineas(t: string, hipo: string): Caballo[] {
  const out: Caballo[] = [];
  for (const raw of t.split(/\r?\n/)) {
    let resto = raw.trim().replace(/\s+/g, " ");
    if (!resto) continue;

    let numero = "";
    const mNum = resto.match(/^(\d{1,3}(?:[.,]\d+)?)\s+(.+)$/);
    if (mNum) {
      numero = mNum[1].replace(/[.,]/g, "");
      resto = mNum[2];
    }

    let nacionalidad = nacDefault(hipo);

    const mTok = resto.match(/^\(?([A-ZÁ-Ú]{2,3})\)?[\s.]+/i);
    if (mTok) {
      const c = mTok[1].toUpperCase();
      if (CODIGOS_NAC.has(c)) {
        nacionalidad = c === "US" ? "USA" : c;
        resto = resto.slice(mTok[0].length).trim();
      }
    }
    for (const [code, words] of Object.entries(PAISES)) {
      for (const w of words) {
        const re = new RegExp(`\\b${w}\\b`, "i");
        if (re.test(resto)) {
          nacionalidad = code === "US" ? "USA" : code;
          resto = resto.replace(re, " ").replace(/\s+/g, " ").trim();
          break;
        }
      }
    }

    let valor = 0;
    const mVal = resto.match(/^(.*?)\s+([$¢]?\s*[\d.,]+\s*)$/);
    if (mVal) {
      valor = Number(mVal[2].replace(/[$¢\s]/g, "").replace(/,/g, ".")) || 0;
      resto = mVal[1].trim();
    }

    const nombre = resto.toUpperCase().replace(/\s+/g, " ");
    if (!nombre) continue;
    out.push({
      numero: numero || String(out.length + 1),
      nombre,
      nacionalidad,
      valor,
      ejemplar_id: null,
      jockey: "",
      peso: "",
    });
  }
  return out;
}

/**
 * "Carga de Programa" — paridad funcional con el legacy (programa_dia.js /
 * ensamblaje). Ofrece dos modos que convergen al mismo payload:
 *
 *  - ⚡ Carga Rápida: pegado masivo de líneas `Nº NOMBRE [NAC] [VALOR]` sobre una
 *    carrera destino (mecanismo de tabulación rápida del legacy), sin mouse.
 *  - 🛠 Carga Manual: matriz estructurada por carrera/fila con selectores para
 *    Número, Ejemplar (padrón), Valor, Jockey y Peso.
 *
 * Ambos persisten con un UPSERT en `programa_dia` (RPC ← SELECT fallback) y
 * vinculan al padrón `ejemplares`. La matriz vive en contenedores
 * `overflow-x-auto` con grids `min-w` para no desbordar el layout principal.
 */
export function CargaPrograma() {
  const [fecha, setFecha] = useState("");
  const [hipodromo, setHipodromo] = useState("");
  const hipodromosActivos = useHipodromosActivos();
  const [padron, setPadron] = useState<OpcionPadron[]>([]);
  const [programa, setPrograma] = useState<ProgramaDia | null>(null);
  const [carreras, setCarreras] = useState<CarreraPrograma[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState<string>("");
  const [modo, setModo] = useState<"rapida" | "manual">("rapida");
  const [textoRapida, setTextoRapida] = useState("");
  const [destino, setDestino] = useState(-1);
  const [modalSincUsa, setModalSincUsa] = useState(false);
  const [modalGacetaPdf, setModalGacetaPdf] = useState(false);
  const [autoSyncActivo, setAutoSyncActivo] = useState(() => estaAutoActualizadorActivo());

  // Panel Integrado DRF (Sincronizador USA Directo)
  const [urlDrfDirecta, setUrlDrfDirecta] = useState("");
  const [sincronizandoDrf, setSincronizandoDrf] = useState(false);
  const [detectandoTracksDrf, setDetectandoTracksDrf] = useState(false);
  const [panelDrfAbierto, setPanelDrfAbierto] = useState(true);
  const [tracksDrfSeleccionados, setTracksDrfSeleccionados] = useState<string[]>(["CD", "GP", "AQU", "CT", "FL", "RP"]);
  const [filtroDrfSigla, setFiltroDrfSigla] = useState("");

  const metaDrfDirecto = useMemo(() => {
    return urlDrfDirecta.trim() ? parsearUrlDrf(urlDrfDirecta.trim()) : null;
  }, [urlDrfDirecta]);

  const alternarAutoSync = useCallback(() => {
    if (autoSyncActivo) {
      detenerAutoActualizadorRetirados();
      setAutoSyncActivo(false);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { msg: "⏸️ Auto-Sync 24/7 pausado.", tipo: "info" },
        })
      );
    } else {
      iniciarAutoActualizadorRetirados(15, (res) => {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              msg: `🔄 Auto-Sync: ${res.totalRetirados} retiros procesados en vivo.`,
              tipo: "info",
            },
          })
        );
      });
      setAutoSyncActivo(true);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            msg: "⚡ Auto-Sync 24/7 activado: carreras y retiros se sincronizan cada 15 min.",
            tipo: "success",
          },
        })
      );
    }
  }, [autoSyncActivo]);
  const areaRapida = useRef<HTMLTextAreaElement>(null);
  const usuario = useAuthStore((s) => s.usuario);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const cargarPrograma = useCallback(async (f: string) => {
    const res = await leerProgramaPorFecha(f);
    setPrograma(res.ok ? (res.data ?? null) : null);
  }, []);

  const handleImportarDrfDirecto = async (urlCustom?: string) => {
    const raw = (urlCustom || urlDrfDirecta).trim();
    if (!raw) {
      toast("Pega un enlace oficial de DRF primero.", "warning");
      return;
    }
    const meta = parsearUrlDrf(raw);
    if (!meta) {
      toast("Estructura DRF inválida. Debe ser https://www.drf.com/race-entries/track/{TRACK}/country/{COUNTRY}/date/{MM-DD-YYYY}", "warning");
      return;
    }

    setSincronizandoDrf(true);
    toast(`⚡ Importando DRF: ${meta.trackCode} (${meta.hipodromo}) · Fecha ${meta.fechaDRF}...`, "info");
    try {
      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: meta.fechaISO,
        tracksFiltro: [meta.trackCode],
        urlDirectaDrf: meta.urlPublica,
        fuentePreferida: "DRF",
      });

      if (res.ok) {
        setFecha(meta.fechaISO);
        setHipodromo(meta.hipodromo.toUpperCase());
        await cargarPrograma(meta.fechaISO);
        toast(`✅ Importado ${meta.hipodromo} con éxito (${res.totalCarreras} carreras, ${res.totalEjemplares} ejemplares).`, "success");
        setUrlDrfDirecta("");
      } else {
        toast(`⚠️ Importación: ${res.error || "Sin carreras devueltas"}`, "warning");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`❌ Error al importar DRF: ${msg}`, "error");
    } finally {
      setSincronizandoDrf(false);
    }
  };

  const handleSincronizarTracksDrf = async () => {
    if (!tracksDrfSeleccionados.length) {
      toast("Selecciona al menos un hipódromo DRF por su sigla.", "warning");
      return;
    }
    const fechaEfectiva = fecha || hoyLocal();
    setSincronizandoDrf(true);
    toast(`🏇 Sincronizando ${tracksDrfSeleccionados.length} hipódromos DRF para ${fechaEfectiva}...`, "info");
    try {
      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: fechaEfectiva,
        tracksFiltro: tracksDrfSeleccionados,
        fuentePreferida: "DRF",
      });

      if (res.ok) {
        if (!fecha) setFecha(fechaEfectiva);
        await cargarPrograma(res.fecha || fechaEfectiva);
        toast(`✅ Sincronizados ${res.tracksProcesados.length} hipódromos (${res.totalCarreras} carreras, ${res.totalEjemplares} ejemplares).`, "success");
      } else {
        toast(`⚠️ Sincronización: ${res.error || "Verificar"}`, "warning");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(`❌ Error en sincronización DRF: ${msg}`, "error");
    } finally {
      setSincronizandoDrf(false);
    }
  };

  const handleDetectarTracksDrf = async () => {
    const f = fecha || hoyLocal();
    setDetectandoTracksDrf(true);
    try {
      const tracks = await detectarHipodromosActivosDia(f);
      if (tracks.length > 0) {
        setTracksDrfSeleccionados(tracks);
        toast(`🔍 Detectados ${tracks.length} hipódromos activos en DRF para ${f} (${formatearFechaDrf(f)}): ${tracks.join(", ")}`, "success");
      } else {
        toast(`No se detectaron hipódromos automáticos para ${f}. Puedes marcarlos manualmente.`, "warning");
      }
    } catch {
      toast("Error al detectar hipódromos del día.", "error");
    } finally {
      setDetectandoTracksDrf(false);
    }
  };

  const toggleTrackDrf = (codigo: string) => {
    setTracksDrfSeleccionados((prev) =>
      prev.includes(codigo) ? prev.filter((c) => c !== codigo) : [...prev, codigo]
    );
  };

  // Catálogo de ejemplares (una sola vez).
  useEffect(() => {
    let vivo = true;
    void listarPadronSimple().then((pad) => {
      if (vivo) setPadron(pad);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Programa de la fecha elegida: se RELEE al cambiar de jornada para poder
  // cargar/editar días distintos de hoy (incluidos los FUTUROS). Antes solo se
  // leía el de hoy al montar y cambiar la fecha no traía el programa correcto.
  useEffect(() => {
    if (!fecha) {
      setPrograma(null);
      setCargando(false);
      return;
    }
    let vivo = true;
    setCargando(true);
    void leerProgramaPorFecha(fecha).then((prog) => {
      if (!vivo) return;
      setPrograma(prog.ok ? (prog.data ?? null) : null);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [fecha]);

  // Al cambiar el hipódromo seleccionado, mostraremos sus carreras del día.
  useEffect(() => {
    const seleccion = hipodromo.trim().toUpperCase();
    setCarreras(seleccion ? (programa?.carreras ?? []).filter((c) => c.hipodromo === seleccion) : []);
  }, [programa, hipodromo]);

  const opcionesHipodromo = useMemo(
    () =>
      hipodromosActivos.map((h) => ({
        value: h.value,
        label: h.label,
      })),
    [hipodromosActivos]
  );

  const opcionesPadron = useMemo(() => ({ opciones: padron }), [padron]);

  const totalEjemplares = useMemo(
    () => carreras.reduce((a, c) => a + (c.caballos || []).filter((cb) => cb.nombre).length, 0),
    [carreras]
  );

  // Vista previa en vivo del bloque pegado (máx. 6 filas + contador).
  const previewRapida = useMemo(() => parseLineas(textoRapida, hipodromo), [textoRapida, hipodromo]);

  const setCarrera = (i: number, patch: Partial<CarreraPrograma>) =>
    setCarreras((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const setCaballo = (i: number, j: number, patch: Partial<Caballo>) =>
    setCarreras((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, caballos: c.caballos.map((cb, jj) => (jj === j ? { ...cb, ...patch } : cb)) } : c))
    );

  const quitarCaballo = (i: number, j: number) =>
    setCarreras((prev) => prev.map((c, idx) => (idx === i ? { ...c, caballos: c.caballos.filter((_, jj) => jj !== j) } : c)));

  const agregarCarrera = () => {
    const n = carreras.length ? Math.max(...carreras.map((c) => c.carrera ?? 0)) + 1 : 1;
    setCarreras((prev) => [...prev, { hipodromo: hipodromo.trim().toUpperCase(), fecha, carrera: n, distancia: 0, superficie: "ARENA", premio: 0, caballos: [plantaCaballo(1)] }]);
  };

  const agregarEjemplar = (i: number) =>
    setCarreras((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const n = c.caballos.length ? Math.max(...c.caballos.map((cb) => Number(cb.numero) || 0)) + 1 : 1;
        return { ...c, caballos: [...c.caballos, plantaCaballo(n)] };
      })
    );

  /** Convierte el bloque pegado en filas y las aplica a la carrera destino. */
  const aplicarRapida = (modoApp: "append" | "replace") => {
    const filas = parseLineas(textoRapida, hipodromo);
    if (!filas.length) return toast("Pegue al menos una línea con el formato Nº NOMBRE [NAC] [VALOR].", "warning");
    const hipo = hipodromo.trim().toUpperCase();
    let proximaNueva: number | null = null;
    let siguiente: CarreraPrograma[];
    if (destino < 0 || destino >= carreras.length) {
      const n = carreras.length ? Math.max(...carreras.map((c) => c.carrera ?? 0)) + 1 : 1;
      siguiente = [...carreras, { hipodromo: hipo, fecha, carrera: n, distancia: 0, superficie: "ARENA", premio: 0, caballos: filas }];
      proximaNueva = siguiente.length - 1;
    } else {
      siguiente = carreras.map((c, idx) =>
        idx === destino ? { ...c, caballos: modoApp === "replace" ? filas : [...(c.caballos || []), ...filas] } : c
      );
    }
    setCarreras(siguiente);
    if (proximaNueva != null) setDestino(proximaNueva);
    setTextoRapida("");
    toast(
      `⚡ ${filas.length} ejemplar(es) ${modoApp === "replace" ? "reemplazaron" : "se añadieron a"} la carga (${hipo}).`,
      "success"
    );
    setTimeout(() => areaRapida.current?.focus(), 30);
  };

  const filaDestino = (i: number) => {
    const c = carreras[i];
    return `Carrera ${c?.carrera ?? i + 1}ª · ${(c?.caballos || []).filter((cb) => cb.nombre).length} ej`;
  };

  const guardar = async () => {
    if (!fecha) return toast("Seleccione la fecha de la jornada.", "warning");
    const hipo = hipodromo.trim().toUpperCase();
    if (!hipo) return toast("Seleccione o escriba el hipódromo.", "warning");
    if (!carreras.length) return toast("Agregue al menos una carrera al programa.", "warning");

    const pref = carreras.map((c) => ({
      ...c,
      hipodromo: hipo,
      fecha,
      caballos: (c.caballos || []).filter((cb) => cb.nombre.trim()),
    }));
    if (!pref.some((c) => c.caballos.length)) return toast("Cada carrera debe tener al menos un ejemplar con nombre.", "warning");

    setGuardando(true);
    // 1) Vinculación masiva al padrón `ejemplares` (crea los no registrados).
    const tot = await registrarEjemplares(pref as unknown as Array<Record<string, unknown>>);
    // 2) UPSERT masivo en `programa_dia` (merge con carreras de otros hipódromos).
    const otras = (programa?.carreras ?? []).filter((c) => c.hipodromo !== hipo);
    const merged = [...otras, ...pref];
    const hipodromos = [...new Set([...(programa?.hipodromos ?? []), hipo].map((h) => String(h).toUpperCase().trim()).filter(Boolean))];
    const res = await guardarPrograma({ fecha, hipodromos, carreras: merged }, usuario);
    setGuardando(false);

    if (!res.ok) return toast(res.error ?? "Error al guardar el programa.", "error");
    if (res.data) setPrograma(res.data);
    // `guardarPrograma` ya dio de alta las carreras en la matriz maestra
    // `carreras`; se invalida la caché para que Tablas, Marcas, Gestión,
    // Dupletas y Remates las vean de inmediato sin recargar.
    useRegistroCentral.getState().invalidarCarreras();
    setGuardado(`Programa guardado · ${pref.length} carrera(s) · ${totalEjemplares} ejemplar(es) · ${new Date().toLocaleTimeString("es-VE")}`);
    toast(
      `✅ Programa guardado: ${pref.length} carrera(s) en la matriz de carreras, ${totalEjemplares} ejemplar(es). Padrón: ${tot.nuevos} nuevo(s), ${tot.vinculados} vinculado(s)${tot.fallidos ? `, ${tot.fallidos} fallido(s)` : ""}.`,
      "success"
    );
    if (pref.some((c) => c.caballos.length)) setCarreras(pref);
  };

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      {/* Cabecera y Barra de Modos Unificada */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-800">📅 Carga de Carreras y Programa</h2>
          <p className="text-[11px] text-slate-500">
            Alimenta la matriz de carreras, Apuestas, Tablas y Dupletas con sincronización directa y gacetas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* MODO 1: Sincronizar USA / DRF Oficial (Automático) */}
          <button
            type="button"
            onClick={() => setModalSincUsa(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-95 px-3 py-1.5 text-xs font-black uppercase text-slate-950 shadow-md transition-all"
            title="Sincronizar directamente desde feeds oficiales de DRF (Daily Racing Form) / TVG / TwinSpires para cualquier fecha o pegando el enlace de DRF"
          >
            <span>🇺🇸</span>
            <span>Sincronizar USA / DRF Oficial</span>
          </button>

          {/* MODO 2: Importar Gacetas PDF (Multi-Fecha / Lote) */}
          <button
            type="button"
            onClick={() => setModalGacetaPdf(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 px-3 py-1.5 text-xs font-black uppercase text-white shadow-md transition-all border border-purple-300/40"
            title="Importar uno o múltiples PDFs de gacetas y retrospectos con previsualización editable"
          >
            <span>📄</span>
            <span>Importar Gacetas PDF (Multi-Fecha / Lote)</span>
          </button>

          {/* MODO 3: Auto-Sync 24/7 Activo (Toggle / Indicador) */}
          <button
            type="button"
            onClick={alternarAutoSync}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black uppercase shadow-md transition-all border ${
              autoSyncActivo
                ? "bg-emerald-600 text-white border-emerald-400/60 hover:bg-emerald-500"
                : "bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
            title="Sincronización en segundo plano cada 15 min"
          >
            <span className={`inline-block h-2 w-2 rounded-full ${autoSyncActivo ? "bg-emerald-300 animate-pulse" : "bg-slate-500"}`} />
            <span>{autoSyncActivo ? "🔄 Auto-Sync 24/7 Activo" : "⏸️ Auto-Sync Inactivo"}</span>
          </button>
        </div>
      </div>

      {/* Panel Oficial de Sincronización Directa DRF (Daily Racing Form) */}
      <Card className="w-full border-amber-500/40 bg-gradient-to-r from-amber-950/10 via-surface to-slate-900/5 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-600">
                Sincronizador Oficial DRF (Daily Racing Form · USA & CAN)
              </h3>
              <p className="text-[11px] text-slate-500">
                Pega cualquier URL oficial de DRF o marca los hipódromos por su sigla para importar la programación completa al instante.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPanelDrfAbierto(!panelDrfAbierto)}
              className="rounded-lg border border-line bg-surfaceAlt px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900"
            >
              {panelDrfAbierto ? "Ocultar panel ▲" : "Mostrar panel ▼"}
            </button>
          </div>
        </div>

        {panelDrfAbierto && (
          <div className="mt-3 space-y-3">
            {/* Opción A: Pegar Link Directo DRF */}
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <label htmlFor="input-url-drf-carga" className="text-[11px] font-black uppercase tracking-wider text-amber-700">
                  🔗 1. Pegar Enlace Directo Oficial de DRF (Cualquier Hipódromo y Fecha)
                </label>
                {urlDrfDirecta && (
                  <button
                    type="button"
                    onClick={() => setUrlDrfDirecta("")}
                    className="text-[10px] text-slate-400 hover:text-slate-700"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="input-url-drf-carga"
                  type="url"
                  placeholder="https://www.drf.com/race-entries/track/CD/country/USA/date/11-04-2026"
                  value={urlDrfDirecta}
                  onChange={(e) => setUrlDrfDirecta(e.target.value)}
                  className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-mono font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <Button
                  variant="default"
                  size="md"
                  disabled={!urlDrfDirecta.trim() || sincronizandoDrf}
                  onClick={() => void handleImportarDrfDirecto()}
                  className="!bg-amber-500 hover:!bg-amber-400 !text-slate-950 font-black"
                >
                  {sincronizandoDrf ? "Importando…" : "⚡ Importar DRF al Instante"}
                </Button>
              </div>

              {metaDrfDirecto ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-800">
                  <span className="font-black">✓ URL DRF Válida:</span>
                  <span className="rounded bg-emerald-200 px-1.5 py-0.5 font-mono font-black text-emerald-950">
                    {metaDrfDirecto.trackCode} ({metaDrfDirecto.hipodromo})
                  </span>
                  <span>· País: <b>{metaDrfDirecto.country}</b></span>
                  <span>· Fecha DRF: <b>{metaDrfDirecto.fechaDRF}</b> (ISO: {metaDrfDirecto.fechaISO})</span>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 font-mono">
                  Formato admitido: https://www.drf.com/race-entries/track/{`{TRACK_CODE}`}/country/{`{COUNTRY}`}/date/{`{MM-DD-YYYY}`}
                </p>
              )}
            </div>

            {/* Opción B: Selección Rápida por Siglas con Checkboxes */}
            <div className="rounded-xl border border-line bg-surface p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                  🏇 2. Marcar Hipódromos por su Sigla DRF ({tracksDrfSeleccionados.length} seleccionados)
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={detectandoTracksDrf}
                    onClick={() => void handleDetectarTracksDrf()}
                    className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-[10px] font-black uppercase text-white shadow-sm transition-all disabled:opacity-50"
                    title="Consultar en DRF qué hipódromos tienen carreras hoy"
                  >
                    {detectandoTracksDrf ? "Detectando…" : "🔍 Detectar Hipódromos del Día"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTracksDrfSeleccionados(HIPODROMOS_USA_DISPONIBLES.map((t) => t.codigo))}
                    className="rounded-lg border border-line bg-surfaceAlt px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-900"
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setTracksDrfSeleccionados([])}
                    className="rounded-lg border border-line bg-surfaceAlt px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-900"
                  >
                    Desmarcar
                  </button>
                  <Button
                    variant="success"
                    size="sm"
                    disabled={!tracksDrfSeleccionados.length || sincronizandoDrf}
                    onClick={() => void handleSincronizarTracksDrf()}
                    className="font-black text-xs"
                  >
                    {sincronizandoDrf ? "Sincronizando…" : "📥 Sincronizar Siglas"}
                  </Button>
                </div>
              </div>

              {/* Filtro rápido de siglas */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar por sigla (ej. CD, FL, RP, CT, DED, EVD, IND, MNR, MVR, PRX, PEN, GP)..."
                  value={filtroDrfSigla}
                  onChange={(e) => setFiltroDrfSigla(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                {filtroDrfSigla && (
                  <button
                    type="button"
                    onClick={() => setFiltroDrfSigla("")}
                    className="text-xs text-slate-400 hover:text-slate-700 px-1"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Grilla de Checkboxes de Hipódromos por Sigla */}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:grid-cols-6 max-h-48 overflow-y-auto pr-1">
                {HIPODROMOS_USA_DISPONIBLES.filter((t) => {
                  if (!filtroDrfSigla.trim()) return true;
                  const f = filtroDrfSigla.trim().toUpperCase();
                  return t.codigo.includes(f) || t.nombre.toUpperCase().includes(f);
                }).map((t) => {
                  const check = tracksDrfSeleccionados.includes(t.codigo);
                  return (
                    <label
                      key={t.codigo}
                      className={`flex items-center gap-2 rounded-lg border p-1.5 text-left cursor-pointer transition-colors select-none text-xs ${
                        check
                          ? "border-amber-400 bg-amber-50 text-amber-950 font-bold"
                          : "border-line bg-surfaceAlt/50 text-slate-600 hover:border-slate-300 hover:bg-surfaceAlt"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={check}
                        onChange={() => toggleTrackDrf(t.codigo)}
                        className="h-3.5 w-3.5 rounded border-line text-amber-600 focus:ring-amber-500 shrink-0"
                      />
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono font-black text-amber-700 border border-amber-300 text-[10px] shrink-0">
                        {t.codigo}
                      </span>
                      <span className="truncate flex-1 text-[11px]" title={t.nombre}>
                        {t.nombre}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Filtros principales */}
      <Card className="w-full p-4">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateInput
            id="fecha-programa"
            label="Fecha de la jornada"
            value={fecha}
            onFechaChange={setFecha}
          />
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Hipódromo</span>
            <SearchableSelect options={opcionesHipodromo} value={hipodromo} onChange={setHipodromo} placeholder="Buscar o escribir hipódromo…" />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <div className="flex-1" />
            <Button variant="outline" size="md" disabled={!fecha} onClick={() => void cargarPrograma(fecha)}>
              ⟳ Recargar
            </Button>
          </div>
        </div>
        {programa && (
          <p className="mt-3 rounded-lg border border-primary-200 bg-primary-500/5 px-3 py-2 text-[11px] font-semibold text-primary-700">
            📌 Programa existente para el <b>{programa.fecha}</b>:{" "}
            {programa.hipodromos.map((h) => nombreHipodromoParaMostrar(h)).join(", ") || "sin hipódromos"} ·{" "}
            {programa.carreras.length} carrera(s). Abajo se muestran las de{" "}
            <b>{nombreHipodromoParaMostrar(hipodromo) || "…"}</b>.
          </p>
        )}
        {guardado && <p className="mt-2 text-[11px] font-bold text-success-600">✔ {guardado}</p>}
      </Card>

      {!fecha ? (
        <Card className="p-8 text-center">
          <span className="text-3xl">📅</span>
          <p className="mt-2 text-sm font-bold text-slate-700">Seleccione una fecha de la jornada</p>
          <p className="mt-1 text-xs text-slate-500">No se cargará ningún programa de forma automática. Elija una fecha para comenzar.</p>
        </Card>
      ) : !hipodromo.trim() ? (
        <Card className="p-8 text-center">
          <span className="text-3xl">🏇</span>
          <p className="mt-2 text-sm font-bold text-slate-700">Seleccione un hipódromo para comenzar</p>
          <p className="mt-1 text-xs text-slate-500">Se desplegará la matriz de carreras y ejemplares del día.</p>
        </Card>
      ) : cargando ? (
        <Card className="p-8 text-center text-xs font-semibold text-slate-500">Cargando catálogos…</Card>
      ) : (
        <>
          {/* Selector de modalidad */}
          <div className="flex w-full max-w-md items-center gap-1 rounded-xl border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setModo("rapida")}
              className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wide transition-colors ${
                modo === "rapida" ? "bg-primary-600 text-white shadow" : "text-slate-500 hover:bg-surfaceAlt"
              }`}
            >
              ⚡ Carga Rápida
            </button>
            <button
              type="button"
              onClick={() => setModo("manual")}
              className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wide transition-colors ${
                modo === "manual" ? "bg-primary-600 text-white shadow" : "text-slate-500 hover:bg-surfaceAlt"
              }`}
            >
              🛠 Carga Manual
            </button>
          </div>

          {modo === "rapida" ? (
            /* ------------------------------------------------------------------ */
            /* ⚡ CARGA RÁPIDA                                                     */
            /* ------------------------------------------------------------------ */
            <Card className="w-full overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surfaceAlt/60 px-4 py-2.5">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-primary-700">⚡ Pegado masivo</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Una línea por ejemplar (<b>Nº NOMBRE [NAC] [VALOR]</b>).
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4 p-4">
                {/* Carrera destino (tipo Excel: selección por chip, sin mouse opcional) */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Destino:</span>
                  {carreras.map((c, i) => (
                    <button
                      key={`${c.carrera ?? i}-${i}`}
                      type="button"
                      onClick={() => setDestino(i)}
                      title="Hacer clic para apuntar el pegado a esta carrera"
                      className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                        destino === i ? "bg-primary-600 text-white shadow" : "border border-line bg-surface text-slate-600 hover:bg-surfaceAlt"
                      }`}
                    >
                      {filaDestino(i)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDestino(-1)}
                    className={`rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                      destino < 0 ? "bg-emerald-600 text-white shadow" : "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                    title="Crear una carrera nueva con el bloque pegado"
                  >
                    ➕ Nueva carrera
                  </button>
                </div>

                <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* Bloque de pegado */}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label htmlFor="rapida-bloque" className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Bloque pegable <span className="font-bold text-primary-600">({previewRapida.length} filas listas)</span>
                    </label>
                    <textarea
                      ref={areaRapida}
                      id="rapida-bloque"
                      spellCheck={false}
                      value={textoRapida}
                      onChange={(e) => setTextoRapida(e.target.value)}
                      placeholder={"1 DUQUE DE ALBA (VE) 150\n2 GATO NEGRO USA\n3 REINA DEL SUR\n4 CORCOVA"} 
                      className="h-44 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-xs font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="default" size="sm" onClick={() => aplicarRapida("append")}>
                        ＋ Añadir filas al destino
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => aplicarRapida("replace")}>
                        🔄 Reemplazar destino
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setTextoRapida("")}>
                        Vaciar bloque
                      </Button>
                    </div>
                  </div>

                  {/* Vista previa en vivo */}
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vista previa (sin guardar)</p>
                    <div className="mt-1.5 max-h-52 overflow-y-auto rounded-lg border border-line bg-slate-50 p-2">
                      {previewRapida.length === 0 ? (
                        <p className="py-6 text-center text-[11px] italic text-slate-400">Pegue las líneas para previsualizar…</p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {previewRapida.slice(0, 6).map((cb, i) => {
                            const guald = getHorseColor(cb.numero);
                            return (
                              <li key={i} className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                                <span
                                  className={`grid h-5 w-6 shrink-0 place-items-center rounded border text-[9px] font-black leading-none ${guald.bg} ${guald.text} ${guald.border}`}
                                >
                                  {cb.numero}
                                </span>
                                <span className="min-w-0 flex-1 truncate uppercase">{cb.nombre}</span>
                                <span className="shrink-0 rounded bg-slate-200 px-1 text-[9px] font-black text-slate-600">{cb.nacionalidad}</span>
                                {cb.valor ? <span className="shrink-0 text-[10px] font-black text-blue-700">${cb.valor}</span> : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {previewRapida.length > 6 && (
                        <p className="mt-1 border-t border-line pt-1 text-[10px] font-bold text-slate-400">
                          … y {previewRapida.length - 6} más
                        </p>
                      )}
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      Estado actual: <b className="text-slate-600">{carreras.length} carrera(s)</b> · <b className="text-slate-600">{totalEjemplares} ejemplar(es)</b> con nombre.
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            /* ------------------------------------------------------------------ */
            /* 🛠 CARGA MANUAL                                                     */
            /* ------------------------------------------------------------------ */
            <>
              {carreras.length === 0 && (
                <Card className="p-6 text-center">
                  <p className="text-xs text-slate-500 italic">Sin carreras para {nombrePropioHipodromo(hipodromo, hipodromosActivos)} en {fecha}.</p>
                  <Button variant="default" size="md" className="mt-3" onClick={agregarCarrera}>
                    ＋ Crear primera carrera
                  </Button>
                </Card>
              )}

              {carreras.map((c, i) => (
                <Card key={`${c.carrera ?? i}-${i}`} className="w-full overflow-hidden">
                  {/* Cabecera de la carrera */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surfaceAlt/60 px-4 py-2.5">
                    <h3 className="mr-2 text-xs font-black uppercase tracking-wider text-primary-700">
                      Carrera {c.carrera ?? i + 1}ª
                    </h3>
                    <span className="rounded-full bg-primary-600 px-2 py-0.5 text-[9px] font-black uppercase text-white">
                      {(c.caballos || []).filter((cb) => cb.nombre).length} ejemplares
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <Input label="" hint="" aria-label="Distancia"
                        type="number" placeholder="Dist. m" value={c.distancia || ""}
                        onChange={(e) => setCarrera(i, { distancia: Number(e.target.value) || 0 })}
                        className="!py-1.5 !text-xs text-right w-24" />
                      <select
                        aria-label="Superficie"
                        value={c.superficie || "ARENA"}
                        onChange={(e) => setCarrera(i, { superficie: e.target.value })}
                        className={pluma + " w-28"}
                      >
                        {SUPERFICIES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <Input label="" hint="" aria-label="Premio"
                        type="number" placeholder="Premio $" value={c.premio || ""}
                        onChange={(e) => setCarrera(i, { premio: Number(e.target.value) || 0 })}
                        className="!py-1.5 !text-xs text-right w-28" />
                      <Button variant="danger" size="sm" onClick={() => setCarreras((prev) => prev.filter((_, idx) => idx !== i))}>
                        🗑
                      </Button>
                    </div>
                  </div>

                  {/* Ejemplares inscritos (scroll horizontal dentro de la card) */}
                  <div className="p-3">
                    {(c.caballos || []).length === 0 ? (
                      <p className="py-2 text-center text-[11px] italic text-slate-400">Esta carrera no tiene ejemplares todavía.</p>
                    ) : (
                      <>
                        {/* Vista Móvil (Tarjetas compactas por ejemplar sin scroll horizontal forzado) */}
                        <div className="space-y-2 sm:hidden">
                          {(c.caballos || []).map((cb, j) => {
                            const vinc = cb.ejemplar_id != null && cb.nombre.length > 0;
                            return (
                              <div key={`mob-${i}-${j}`} className="rounded-xl border border-line bg-slate-50/70 p-2 space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    label=""
                                    hint=""
                                    aria-label="Número de chaleco"
                                    type="number"
                                    min={1}
                                    value={cb.numero}
                                    onChange={(e) => setCaballo(i, j, { numero: Number(e.target.value) || 0 })}
                                    className="!py-1.5 !px-2 !text-xs text-center w-14 shrink-0 font-black"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <BuscadorPadron
                                      opciones={opcionesPadron.opciones}
                                      valor={typeof cb.nombre === "string" ? cb.nombre : String(cb.nombre)}
                                      vinculado={vinc}
                                      onChange={(r) => setCaballo(i, j, { nombre: r.nombre, nacionalidad: r.nacionalidad, ejemplar_id: r.ejemplar_id })}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => quitarCaballo(i, j)}
                                    className="rounded-md border border-red-300 bg-white px-2 py-1.5 text-xs text-red-500"
                                    aria-label="Quitar ejemplar"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <Input
                                    label=""
                                    hint=""
                                    aria-label="Valor del ejemplar"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    placeholder="Valor $"
                                    value={cb.valor ?? ""}
                                    onChange={(e) => setCaballo(i, j, { valor: Number(e.target.value) || 0 })}
                                    className="!py-1 !px-2 !text-xs text-right"
                                  />
                                  <Input
                                    label=""
                                    hint=""
                                    aria-label="Jockey del ejemplar"
                                    type="text"
                                    placeholder="Jinete"
                                    value={typeof cb.jockey === "string" ? cb.jockey : String(cb.jockey ?? "")}
                                    onChange={(e) => setCaballo(i, j, { jockey: e.target.value })}
                                    className="!py-1 !px-2 !text-xs"
                                  />
                                  <Input
                                    label=""
                                    hint=""
                                    aria-label="Peso del ejemplar"
                                    type="number"
                                    min={0}
                                    step="0.5"
                                    placeholder="Peso kg"
                                    value={cb.peso ?? ""}
                                    onChange={(e) => setCaballo(i, j, { peso: e.target.value })}
                                    className="!py-1 !px-2 !text-xs text-right"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Vista Escritorio */}
                        <div className="hidden -mx-1 overflow-x-auto px-1 pb-1 sm:block">
                          <div className="min-w-[660px]">
                            <div className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_6rem_4rem_1.6rem] gap-2 px-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                              <span>Chaleco</span>
                              <span>Ejemplar (padrón)</span>
                              <span>Valor</span>
                              <span>Jockey</span>
                              <span>Peso kg</span>
                              <span />
                            </div>
                            {(c.caballos || []).map((cb, j) => {
                              const vinc = cb.ejemplar_id != null && cb.nombre.length > 0;
                              return (
                                <div key={`${i}-${j}`} className="grid grid-cols-[3rem_minmax(0,1fr)_5rem_6rem_4rem_1.6rem] items-center gap-2 py-0.5">
                                  <Input label="" hint="" aria-label="Número de chaleco"
                                    type="number" min={1} value={cb.numero}
                                    onChange={(e) => setCaballo(i, j, { numero: Number(e.target.value) || 0 })}
                                    className="!py-1.5 !px-2 !text-xs text-center" />
                                  <BuscadorPadron
                                    opciones={opcionesPadron.opciones}
                                    valor={typeof cb.nombre === "string" ? cb.nombre : String(cb.nombre)}
                                    vinculado={vinc}
                                    onChange={(r) => setCaballo(i, j, { nombre: r.nombre, nacionalidad: r.nacionalidad, ejemplar_id: r.ejemplar_id })}
                                  />
                                  <Input label="" hint="" aria-label="Valor del ejemplar"
                                    type="number" min={0} step="0.01" placeholder="0"
                                    value={cb.valor ?? ""}
                                    onChange={(e) => setCaballo(i, j, { valor: Number(e.target.value) || 0 })}
                                    className="!py-1.5 !px-2 !text-xs text-right" />
                                  <Input label="" hint="" aria-label="Jockey del ejemplar"
                                    type="text" placeholder="Jinete"
                                    value={typeof cb.jockey === "string" ? cb.jockey : String(cb.jockey ?? "")}
                                    onChange={(e) => setCaballo(i, j, { jockey: e.target.value })}
                                    className="!py-1.5 !px-2 !text-xs" />
                                  <Input label="" hint="" aria-label="Peso del ejemplar"
                                    type="number" min={0} step="0.5" placeholder="Kg"
                                    value={cb.peso ?? ""}
                                    onChange={(e) => setCaballo(i, j, { peso: e.target.value })}
                                    className="!py-1.5 !px-2 !text-xs text-right" />
                                  <button
                                    type="button"
                                    onClick={() => quitarCaballo(i, j)}
                                    className="rounded-md border border-red-300 p-1.5 text-[10px] text-red-500 transition-colors hover:bg-red-50"
                                    title="Quitar ejemplar"
                                    aria-label="Quitar ejemplar"
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => agregarEjemplar(i)}>
                      ＋ Agregar ejemplar
                    </Button>
                  </div>
                </Card>
              ))}

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="md" onClick={agregarCarrera}>
                  ＋ Agregar carrera
                </Button>
                {carreras.length > 0 && (
                  <Button variant="ghost" size="md" onClick={() => setCarreras([])}>
                    Vaciar matriz
                  </Button>
                )}
              </div>
            </>
          )}

          {/* Acciones compartidas (ambos modos convergen al mismo payload) */}
          <div className="flex w-full flex-wrap items-center gap-2">
            {modo === "rapida" && carreras.length > 0 && (
              <span className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[11px] font-bold text-slate-600">
                {carreras.length} carrera(s) · {totalEjemplares} ejemplar(es)
              </span>
            )}
            <Button variant="success" size="lg" className="ml-auto" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? "Guardando programa…" : "💾 Guardar Programa"}
            </Button>
          </div>
        </>
      )}

      {/* Modales de Sincronización Directa USA y Gacetas PDF Lote */}
      <ModalSincronizadorUsa
        abierto={modalSincUsa}
        onCerrar={() => setModalSincUsa(false)}
        fechaDefecto={fecha || hoyLocal()}
        onActualizado={() => {
          if (fecha) void cargarPrograma(fecha);
        }}
      />

      <ModalImportarGacetaPdf
        abierto={modalGacetaPdf}
        onCerrar={() => setModalGacetaPdf(false)}
        fechaDefault={fecha || hoyLocal()}
        hipodromoDefault={hipodromo}
        onCarrerasImportadas={() => {
          if (fecha) void cargarPrograma(fecha);
        }}
      />

      <ToastHost />
    </section>
  );
}

export default CargaPrograma;