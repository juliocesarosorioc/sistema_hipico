/**
 * ============================================================================
 * MOTOR DE SINCRONIZACIÓN DIARIA DE CARRERAS Y EJEMPLARES USA (TVG + DRF)
 * ============================================================================
 *
 * Sincroniza la programación de hipódromos americanos (Gulfstream Park, Santa Anita,
 * Saratoga, Belmont, Aqueduct, Keeneland, Churchill Downs, Tampa Bay Downs, etc.)
 * alimentando de forma universal el catálogo central de carreras (`carreras`,
 * `resultados_carreras`, `ih_*`) y propagando retirados (scratches).
 *
 * REGLAS FUNDAMENTALES:
 * 1. JURISDICCIÓN EXCLUSIVA USA: Prohibido tocar hipódromos venezolanos (La Rinconada,
 *    Valencia, Santa Rita quedan 100% blindados y excluidos).
 * 2. ALIMENTACIÓN UNIVERSAL: Carreras, horarios en hora Caracas, ejemplares (#, PP, ML,
 *    jockey, trainer) y retirados disponibles al instante en Apuestas, Tablas, Marcas,
 *    Pollas, Remates y Portal.
 */

import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/core/utils/fechas";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import {
  sincronizarCarrerasAlCentral,
  type CarreraEntrante,
  type EjemplarEntrante,
} from "@/features/carreras/lib/sincronizar";
import { aplicarRetirosCarrera } from "@/features/carreras/lib/retiros";
import { crearHipodromo, listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { useHipodromosStore } from "@/shared/store/useHipodromosStore";
import { useRegistroCentral } from "@/shared/store/useRegistroCentral";
import { useCarrerasDiaStore } from "@/shared/store/useCarrerasDiaStore";
import { NOMBRES_CANONICOS_HIPODROMOS } from "@/features/hipodromos/lib/tipos";

// ----------------------------------------------------------------------------
// Catálogo de Hipódromos Americanos Soportados
// ----------------------------------------------------------------------------
export type HipodromoUsaMeta = {
  codigo: string;
  nombre: string;
  drfCode: string;
  tvgSlug: string;
  estadoDefecto: string;
};

export const HIPODROMOS_USA_DISPONIBLES: HipodromoUsaMeta[] = [
  { codigo: "GP", nombre: "Gulfstream Park", drfCode: "GP", tvgSlug: "gulfstream-park", estadoDefecto: "FL" },
  { codigo: "SA", nombre: "Santa Anita", drfCode: "SA", tvgSlug: "santa-anita-park", estadoDefecto: "CA" },
  { codigo: "TAM", nombre: "Tampa Bay Downs", drfCode: "TAM", tvgSlug: "tampa-bay-downs", estadoDefecto: "FL" },
  { codigo: "AQU", nombre: "Aqueduct", drfCode: "AQU", tvgSlug: "aqueduct", estadoDefecto: "NY" },
  { codigo: "BEL", nombre: "Belmont Park", drfCode: "BEL", tvgSlug: "belmont-park", estadoDefecto: "NY" },
  { codigo: "SAR", nombre: "Saratoga", drfCode: "SAR", tvgSlug: "saratoga", estadoDefecto: "NY" },
  { codigo: "KEE", nombre: "Keeneland", drfCode: "KEE", tvgSlug: "keeneland", estadoDefecto: "KY" },
  { codigo: "CD", nombre: "Churchill Downs", drfCode: "CD", tvgSlug: "churchill-downs", estadoDefecto: "KY" },
  { codigo: "OP", nombre: "Oaklawn Park", drfCode: "OP", tvgSlug: "oaklawn-park", estadoDefecto: "AR" },
  { codigo: "PRX", nombre: "Parx Racing", drfCode: "PRX", tvgSlug: "parx-racing", estadoDefecto: "PA" },
  { codigo: "DMR", nombre: "Del Mar", drfCode: "DMR", tvgSlug: "del-mar", estadoDefecto: "CA" },
  { codigo: "MTH", nombre: "Monmouth Park", drfCode: "MTH", tvgSlug: "monmouth-park", estadoDefecto: "NJ" },
  { codigo: "LRL", nombre: "Laurel Park", drfCode: "LRL", tvgSlug: "laurel-park", estadoDefecto: "MD" },
  { codigo: "DEL", nombre: "Delaware Park", drfCode: "DEL", tvgSlug: "delaware-park", estadoDefecto: "DE" },
  { codigo: "CT", nombre: "Charles Town", drfCode: "CT", tvgSlug: "charles-town", estadoDefecto: "WV" },
  { codigo: "FG", nombre: "Fair Grounds", drfCode: "FG", tvgSlug: "fair-grounds", estadoDefecto: "LA" },
  { codigo: "GG", nombre: "Golden Gate Fields", drfCode: "GG", tvgSlug: "golden-gate-fields", estadoDefecto: "CA" },
  { codigo: "TP", nombre: "Turfway Park", drfCode: "TP", tvgSlug: "turfway-park", estadoDefecto: "KY" },
  { codigo: "RP", nombre: "Remington Park", drfCode: "RP", tvgSlug: "remington-park", estadoDefecto: "OK" },
  { codigo: "MNR", nombre: "Mountaineer", drfCode: "MNR", tvgSlug: "mountaineer", estadoDefecto: "WV" },
  { codigo: "MVR", nombre: "Mahoning Valley", drfCode: "MVR", tvgSlug: "mahoning-valley", estadoDefecto: "OH" },
];

/**
 * 1. GUARDIA DE SEGURIDAD JURISDICCIONAL:
 * Verifica si un hipódromo es venezolano para PROHIBIR su procesamiento en este flujo.
 */
export function esHipodromoVenezolano(nombre: string | null | undefined): boolean {
  if (!nombre) return false;
  const k = claveHipodromo(nombre);
  return (
    k === "LARINCONADA" ||
    k === "VALENCIA" ||
    k === "SANTARITA" ||
    k.includes("RINCONADA") ||
    k.includes("VALENCIA") ||
    k.includes("SANTARITA")
  );
}

export type EjemplarSincronizadoUsa = {
  numero: string;
  nombre: string;
  pp?: number;
  ml?: string;
  jockey?: string;
  jinete?: string;
  entrenador?: string;
  peso?: number | string;
  medicamento?: string;
  retirado?: boolean;
};

export type CarreraSincronizadaUsa = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  hora?: string | null;
  distancia?: number;
  superficie?: string;
  premio?: number;
  caballos: EjemplarSincronizadoUsa[];
  retirados: string[];
};

export type ResumenSincronizacionTrack = {
  hipodromo: string;
  carreras: number;
  ejemplares: number;
  retirados: number;
  listaRetirados: string[];
};

export type ResumenSincronizacionUsa = {
  ok: boolean;
  fecha: string;
  tracksProcesados: string[];
  totalCarreras: number;
  totalEjemplares: number;
  totalRetirados: number;
  detallesPorTrack: ResumenSincronizacionTrack[];
  error?: string;
};

// ----------------------------------------------------------------------------
// Parser Heurístico para Texto / HTML Copiado de TVG o DRF
// ----------------------------------------------------------------------------
export function parsearTextoPegadoUsa(
  texto: string,
  hipodromoDefecto = "Gulfstream Park",
  fechaDefecto = hoyLocal()
): CarreraSincronizadaUsa[] {
  if (esHipodromoVenezolano(hipodromoDefecto)) {
    throw new Error(`Jurisdicción exclusiva USA: '${hipodromoDefecto}' no está permitido.`);
  }

  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const carrerasMap = new Map<number, CarreraSincronizadaUsa>();
  let carreraActual = 1;

  for (let i = 0; i < lineas.length; i++) {
    const lin = lineas[i];

    // Encabezado de carrera: "Race 1 - 12:35 PM", "Carrera 2", "1st Race", "RACE 3"
    const mRace = lin.match(/\b(?:Race|Carrera)\s*#?\s*(\d+)\b/i) || lin.match(/^(\d+)(?:st|nd|rd|th)\s+Race/i);
    if (mRace) {
      carreraActual = parseInt(mRace[1], 10);
      let horaDetectada: string | null = null;
      const mHoraEnRace = lin.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
      if (mHoraEnRace) horaDetectada = mHoraEnRace[1].trim();

      if (!carrerasMap.has(carreraActual)) {
        carrerasMap.set(carreraActual, {
          hipodromo: hipodromoDefecto,
          carrera: carreraActual,
          fecha: fechaDefecto,
          hora: horaDetectada,
          superficie: lin.toLowerCase().includes("turf") ? "GRAMA" : "ARENA",
          caballos: [],
          retirados: [],
        });
      } else {
        const c = carrerasMap.get(carreraActual)!;
        if (horaDetectada && !c.hora) c.hora = horaDetectada;
      }
      continue;
    }

    // Detección de hora y distancia en línea descriptiva
    if (carrerasMap.has(carreraActual)) {
      const c = carrerasMap.get(carreraActual)!;
      if (!c.hora) {
        const mHora = lin.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
        if (mHora) c.hora = mHora[1].trim();
      }
      if (!c.distancia) {
        const mDist = lin.match(/(\d+(?:\.\d+)?)\s*(?:Furlongs?|F|Meters?|M|Miles?)/i);
        if (mDist) {
          const val = parseFloat(mDist[1]);
          if (lin.toLowerCase().includes("f")) c.distancia = Math.round(val * 201.168);
          else if (lin.toLowerCase().includes("mile")) c.distancia = Math.round(val * 1609.34);
          else c.distancia = Math.round(val);
        }
      }
    }

    // Detección de ejemplar: línea que inicia con número de programa (#1, 1, 1A, 2, 2B, etc.)
    const mNum = lin.match(/^(?:#?\s*)(\d{1,2}[A-Z]?)\b/i);
    if (mNum) {
      const numProg = mNum[1].toUpperCase().trim();
      const resto = lin.slice(mNum[0].length).trim();
      if (/^(?:st|nd|rd|th)?\s*(?:race|carrera)/i.test(resto)) continue;

      const esScratched = /\b(SCRATCHED|SCR|RETIRADO|RET)\b/i.test(lin);

      // Extraer jockey
      const mJockey = lin.match(/(?:Jockey:?\s*|Jinete:?\s*|\bJ:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\s*Trainer|\s*ML|\s*Weight|$)/i);
      const jockey = mJockey ? mJockey[1].trim() : undefined;

      // Extraer trainer
      const mTrainer = lin.match(/(?:Trainer:?\s*|Entrenador:?\s*|\bT:\s*)([A-Za-z\s'.-]+?)(?:,|\)|;|\s*Weight|\s*ML|$)/i);
      const entrenador = mTrainer ? mTrainer[1].trim() : undefined;

      // Extraer ML odds
      const mMl = lin.match(/(?:ML:?\s*|\bML\s+)(\d{1,2}\/\d{1,2}|\d+\.?\d*)|(?:\s)(\d{1,2}\/\d{1,2})(?:\s|\)|$)/i);
      const ml = mMl ? (mMl[1] || mMl[2])?.trim() : undefined;

      // Extraer PP
      const mPp = lin.match(/(?:PP:?\s*|\bP(?:ost)?\s*P(?:os)?:\s*)(\d{1,2})/i);
      const pp = mPp ? parseInt(mPp[1], 10) : undefined;

      // Extraer nombre limpio del ejemplar
      let nombreLimpio = resto
        .replace(/\((?:PP:?|ML:?|Jockey:?|Trainer:?|Weight:?|SCRATCHED|SCR)[^)]*\)/gi, "")
        .replace(/\b(SCRATCHED|SCR|RETIRADO)\b/gi, "")
        .replace(/\bPP:\s*\d+/gi, "")
        .replace(/\bML:\s*[0-9/.]+/gi, "")
        .replace(/\bJockey:\s*[A-Za-z\s'.-]+/gi, "")
        .replace(/\bTrainer:\s*[A-Za-z\s'.-]+/gi, "")
        .replace(/\bWeight:\s*\d+/gi, "")
        .replace(/^[-(: ]+|[-): ]+$/g, "")
        .trim();

      nombreLimpio = nombreLimpio.replace(/[()]/g, "").trim().toUpperCase();

      if (nombreLimpio && nombreLimpio.length >= 2 && !nombreLimpio.startsWith("RACE") && !nombreLimpio.startsWith("EXACTA")) {
        if (!carrerasMap.has(carreraActual)) {
          carrerasMap.set(carreraActual, {
            hipodromo: hipodromoDefecto,
            carrera: carreraActual,
            fecha: fechaDefecto,
            caballos: [],
            retirados: [],
          });
        }
        const c = carrerasMap.get(carreraActual)!;
        const yaExiste = c.caballos.some((e) => e.numero === numProg);
        if (!yaExiste) {
          c.caballos.push({
            numero: numProg,
            nombre: nombreLimpio,
            pp,
            ml,
            jockey,
            jinete: jockey,
            entrenador,
            retirado: esScratched,
          });
          if (esScratched && !c.retirados.includes(numProg)) {
            c.retirados.push(numProg);
          }
        }
      }
    }
  }

  return Array.from(carrerasMap.values()).sort((a, b) => a.carrera - b.carrera);
}

// ---
// Sincronizador Principal
// ----------------------------------------------------------------------------
export async function sincronizarCarrerasAmericanasDia(opciones?: {
  fechaISO?: string;
  tracksFiltro?: string[];
  fuentePreferida?: "AUTO_TVG_DRF" | "DRF" | "TVG";
  htmlOTextoPegado?: string;
  hipodromoPegado?: string;
  creadoPor?: string;
}): Promise<ResumenSincronizacionUsa> {
  const fecha = opciones?.fechaISO || hoyLocal();
  const creadoPor = opciones?.creadoPor || "Sincronizador TVG/DRF";
  const tracksFiltro = opciones?.tracksFiltro && opciones.tracksFiltro.length > 0
    ? opciones.tracksFiltro
    : ["GP", "SA", "TAM", "AQU"];

  // 1. Guardia de Jurisdicción Estricta
  if (opciones?.hipodromoPegado && esHipodromoVenezolano(opciones.hipodromoPegado)) {
    return {
      ok: false,
      fecha,
      tracksProcesados: [],
      totalCarreras: 0,
      totalEjemplares: 0,
      totalRetirados: 0,
      detallesPorTrack: [],
      error: `JURISDICCIÓN EXCLUSIVA USA: '${opciones.hipodromoPegado}' es un hipódromo venezolano y queda 100% excluido del sincronizador de carreras americanas.`,
    };
  }

  let carrerasObtenidas: CarreraSincronizadaUsa[] = [];

  // CASO 1: Texto o HTML pegado directamente
  if (opciones?.htmlOTextoPegado && opciones.htmlOTextoPegado.trim()) {
    const hipoTarget = opciones.hipodromoPegado || "Gulfstream Park";
    carrerasObtenidas = parsearTextoPegadoUsa(opciones.htmlOTextoPegado, hipoTarget, fecha);
  } else {
    // CASO 2: Invocación a Supabase Edge Function `sync-usa-races`
    let edgeOk = false;
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke("sync-usa-races", {
          body: {
            fecha,
            tracks: tracksFiltro,
            fuentePreferida: opciones?.fuentePreferida || "AUTO_TVG_DRF",
          },
        });
        if (!error && data && data.ok && Array.isArray(data.carreras) && data.carreras.length > 0) {
          carrerasObtenidas = data.carreras as CarreraSincronizadaUsa[];
          edgeOk = true;
        }
      } catch {
        /* fallback local */
      }
    }

    // Fallback: si la Edge Function no está desplegada en el entorno o no trajo carreras,
    // construir la estructura base para los tracks seleccionados
    if (!edgeOk || carrerasObtenidas.length === 0) {
      for (const trackCode of tracksFiltro) {
        const meta = HIPODROMOS_USA_DISPONIBLES.find(
          (h) => h.codigo === trackCode.toUpperCase() || claveHipodromo(h.nombre) === claveHipodromo(trackCode)
        );
        const nom = meta ? meta.nombre : trackCode;
        if (esHipodromoVenezolano(nom)) continue;

        // Intentar consulta directa a DRF Entries en el cliente
        try {
          const resp = await fetch(`https://entries.drf.com/data/racecards/${fecha}/${meta?.drfCode || trackCode}`);
          if (resp.ok) {
            const data = await resp.json();
            const races = data?.races || data?.raceList || [];
            for (const r of races) {
              const numC = Number(r.raceNumber || r.carrera) || 1;
              const runners = r.runners || r.horses || [];
              const caballos: EjemplarSincronizadoUsa[] = runners.map((h: any) => ({
                numero: String(h.programNumber || h.postPosition || "").trim().toUpperCase(),
                nombre: String(h.horseName || h.name || "").trim().toUpperCase(),
                pp: Number(h.postPosition) || undefined,
                ml: h.morningLineOdds || undefined,
                jockey: h.jockeyName,
                entrenador: h.trainerName,
                retirado: Boolean(h.isScratched || String(h.status).toUpperCase() === "SCR"),
              })).filter((c: any) => c.nombre);

              const rets = caballos.filter((c) => c.retirado).map((c) => c.numero);
              if (caballos.length > 0) {
                carrerasObtenidas.push({
                  hipodromo: nom,
                  carrera: numC,
                  fecha,
                  distancia: Number(r.distance) || 1200,
                  superficie: "ARENA",
                  caballos,
                  retirados: rets,
                });
              }
            }
          }
        } catch {
          /* fallback */
        }
      }
    }
  }

  // Filtrado final Anti-Venezuela
  carrerasObtenidas = carrerasObtenidas.filter((c) => !esHipodromoVenezolano(c.hipodromo));

  if (carrerasObtenidas.length === 0) {
    return {
      ok: false,
      fecha,
      tracksProcesados: [],
      totalCarreras: 0,
      totalEjemplares: 0,
      totalRetirados: 0,
      detallesPorTrack: [],
      error: "No se obtuvieron carreras para los tracks seleccionados en la fecha especificada.",
    };
  }

  // 2. Asegurar que los hipódromos existan en el catálogo `public.hipodromos`
  try {
    const tracksUnicos = [...new Set(carrerasObtenidas.map((c) => c.hipodromo))];
    const { data: hiposExistentes } = await listarHipodromos();
    const setClaves = new Set((hiposExistentes ?? []).map((h) => claveHipodromo(h.nombre)));

    for (const nom of tracksUnicos) {
      const k = claveHipodromo(nom);
      if (!setClaves.has(k)) {
        await crearHipodromo({
          nombre: NOMBRES_CANONICOS_HIPODROMOS[k] || nom,
          pais: "USA",
        });
        setClaves.add(k);
      }
    }
    useHipodromosStore.getState().invalidar();
  } catch {
    /* ignore */
  }

  // 3. Preparar e inyectar en el Maestro Central de Carreras (`carreras`)
  const carrerasEntrantes: CarreraEntrante[] = carrerasObtenidas.map((c) => ({
    fecha: c.fecha,
    hipodromo: c.hipodromo,
    carrera: c.carrera,
    distancia: c.distancia || 1200,
    superficie: c.superficie || "ARENA",
    premio: c.premio || 0,
    caballos: c.caballos.map((e) => ({
      numero: e.numero,
      nombre: e.nombre,
      nacionalidad: "USA",
      pts: e.ml ? 0 : 0,
      jockey: e.jockey,
      entrenador: e.entrenador,
      peso: e.peso,
      medicamento: e.medicamento,
    })),
  }));

  const resSinc = await sincronizarCarrerasAlCentral(carrerasEntrantes, creadoPor);

  // 4. Propagación Automática de Retirados (Scratches)
  const detallesPorTrack: ResumenSincronizacionTrack[] = [];
  const tracksGroup = new Map<string, CarreraSincronizadaUsa[]>();

  for (const c of carrerasObtenidas) {
    const arr = tracksGroup.get(c.hipodromo) ?? [];
    arr.push(c);
    tracksGroup.set(c.hipodromo, arr);

    // Si tiene retirados, propagar a tablas y catálogo maestro
    if (c.retirados && c.retirados.length > 0) {
      try {
        await aplicarRetirosCarrera({
          fecha: c.fecha,
          hipodromo: c.hipodromo,
          carrera: c.carrera,
          numeros: c.retirados,
        });
      } catch {
        /* best-effort */
      }
    }

    // 5. Almacén Analítico `ih_carreras_programa` e `ih_inscripciones_carrera`
    if (supabase) {
      try {
        const { data: progRow } = await supabase
          .from("ih_carreras_programa")
          .upsert(
            [
              {
                fecha: c.fecha,
                hipodromo: c.hipodromo.toUpperCase(),
                carrera_numero: c.carrera,
                distancia_metros: c.distancia || 1200,
                superficie: c.superficie || "ARENA",
                hora_programada: c.hora ? `${c.hora}:00` : null,
                estado_carrera: "PROGRAMADA",
              },
            ],
            { onConflict: "fecha,hipodromo,carrera_numero" }
          )
          .select("id")
          .maybeSingle();

        if (progRow?.id) {
          const inscripciones = c.caballos.map((e) => ({
            carrera_id: progRow.id,
            numero_gualdrapa: e.numero,
            nombre_ejemplar: e.nombre,
            puesto_pista: e.pp || Number(e.numero) || 1,
            jinete_nombre: e.jockey || null,
            entrenador_nombre: e.entrenador || null,
            retirado: Boolean(e.retirado),
          }));
          await supabase
            .from("ih_inscripciones_carrera")
            .upsert(inscripciones, { onConflict: "carrera_id,numero_gualdrapa" });
        }
      } catch {
        /* best-effort si no están las tablas analíticas */
      }
    }
  }

  // Resumen por track
  for (const [hipo, carrs] of tracksGroup) {
    const totalEjs = carrs.reduce((a, c) => a + c.caballos.length, 0);
    const todosRets = [...new Set(carrs.flatMap((c) => c.retirados))];
    detallesPorTrack.push({
      hipodromo: hipo,
      carreras: carrs.length,
      ejemplares: totalEjs,
      retirados: todosRets.length,
      listaRetirados: todosRets,
    });
  }

  // Notificar a toda la plataforma
  useRegistroCentral.getState().invalidarCarreras();
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent("hipico:carreras-actualizadas", {
          detail: { fecha, accion: "sincronizacion_usa" },
        })
      );
    } catch {
      /* ignore */
    }
  }

  return {
    ok: resSinc.ok,
    fecha,
    tracksProcesados: Array.from(tracksGroup.keys()),
    totalCarreras: carrerasObtenidas.length,
    totalEjemplares: carrerasObtenidas.reduce((a, c) => a + c.caballos.length, 0),
    totalRetirados: carrerasObtenidas.reduce((a, c) => a + c.retirados.length, 0),
    detallesPorTrack,
  };
}

// ----------------------------------------------------------------------------
// Temporizador de Auto-Actualización de Retirados (Scratches cada 15 min)
// ----------------------------------------------------------------------------
let timerScratches: number | null = null;

export function iniciarAutoActualizadorRetirados(
  intervaloMinutos = 15,
  onActualizado?: (resumen: ResumenSincronizacionUsa) => void
): void {
  detenerAutoActualizadorRetirados();
  const ms = Math.max(1, intervaloMinutos) * 60 * 1000;

  timerScratches = window.setInterval(async () => {
    try {
      const res = await sincronizarCarrerasAmericanasDia({
        fechaISO: hoyLocal(),
      });
      if (res.ok && res.totalRetirados > 0) {
        onActualizado?.(res);
      }
    } catch {
      /* ignore */
    }
  }, ms);
}

export function detenerAutoActualizadorRetirados(): void {
  if (timerScratches !== null) {
    clearInterval(timerScratches);
    timerScratches = null;
  }
}
