/**
 * Utilidades puras de la Gaceta + contratos de persistencia.
 * Paridad 1:1 con el legacy:
 *   - helpers de UI: js/gaceta_helpers.js (SUPERFICIES, FLAGS, colorDeNumeroGac,
 *     parsearRangoPaginas, nacEjemplar, aNum, HIPODROMOS_USA, REGISTRO_KEY...).
 *   - persistencia: 'gaceta_registro' (H.persistirRegistro / H.marcarEnviadas de
 *     gaceta_helpers.js) y el "buzón" hacia el Ensamblaje: 'ensamblaje_carreras'
 *     + 'gaceta_prellenado' (js/gaceta.js acumularEnEnsamblaje y
 *     js/tablas.js migrarLegacy / listaHors / eliminarDelRegistroGaceta).
 */
import type { DraftCarrera } from "@/lib/tablas/tipos";

export const SUPERFICIES = ["ARENA", "CESPED", "FANGO", "TAPETA", "OTRA"] as const;
export const NACIONALIDADES = [
  "VE", "USA", "BR", "AR", "CL", "MX", "PA", "PE", "CO", "EC", "UY", "OTRA",
] as const;

export const FLAGS: Record<string, string> = {
  VE: "🇻🇪",
  USA: "🇺🇸",
  BR: "🇧🇷",
  AR: "🇦🇷",
  CL: "🇨🇱",
  MX: "🇲🇽",
  PA: "🇵🇦",
  PE: "🇵🇪",
  CO: "🇨🇴",
  EC: "🇪🇨",
  UY: "🇺🇾",
  OTRA: "🏳️",
};

const NAC_VE = new Set(["VE", "VEN", "VZLA", "VENEZUELA", "VZ"]);

/** Bandera emoji de un ejemplar para la Gaceta: Venezuela se sobreentiende y
 *  NO renderiza nada; el resto muestra solo el emoji (sin siglas en texto). */
export function banderaGaceta(nac?: string): string {
  const n = String(nac ?? "VE").trim().toUpperCase();
  if (NAC_VE.has(n)) return "";
  return FLAGS[n] || "";
}

// Hipódromos de EE.UU. sembrados en la BD: si la carrera es de uno de ellos,
// sus ejemplares quedan con nacionalidad USA por defecto; los no reconocidos
// (el programa es venezolano) quedan VE. Igual que js/gaceta_helpers.js.
export const HIPODROMOS_USA = [
  "AQUEDUCT", "BELMONT PARK", "CHARLES TOWN", "CHURCHILL DOWNS", "DEL MAR",
  "FAIR GROUNDS", "FINGER LAKES", "GOLDEN GATE FIELDS", "GULFSTREAM PARK",
  "KEENELAND", "LAUREL PARK", "LOS ALAMITOS", "MONMOUTH PARK", "OAKLAWN PARK",
  "PIMLICO", "SANTA ANITA", "SARATOGA", "TAMPA BAY DOWNS",
] as const;

// Registro persistente del día (igual que el legacy).
export const REGISTRO_KEY = "gaceta_registro";
export const ENSAMBLAJE_CARRERAS_KEY = "ensamblaje_carreras";
export const GACETA_PRELLENADO_KEY = "gaceta_prellenado";

export type EjemplarEditable = {
  numero: string | number;
  nombre: string;
  nacionalidad?: string;
  valor?: number | string;
  pts?: number | string;
  ejemplar_id?: string | number | null;
  nuevo?: boolean;
};

/** Carrera transcrita por la Gaceta (shape del legacy: hipodromo/carrera/
 *  distancia/superficie/premio + ejemplares) con las marcas de envío. */
export type CarreraRegistro = {
  carrera: number | string | null;
  hipodromo?: string;
  fecha?: string | null;
  distancia?: number | string;
  superficie?: string;
  premio?: number;
  ejemplares?: EjemplarEditable[];
  caballos?: EjemplarEditable[];
  /** Marcada como enviada al Ensamblaje (persistido en gaceta_registro). */
  enviada?: boolean;
  aplicada?: boolean;
  /** Checkbox "sel" de la card (incluir al envío masivo). */
  seleccionada?: boolean;
};

export type ResumenPadron = { nuevos: number; vinculados: number };

/** Acepta "3,5" y "3.5" (decimal con coma típico en Vzla). Igual aNum del legacy. */
export function aNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalización ESTRICTA de fecha a ISO 8601 (YYYY-MM-DD).
 * Acepta "2026-09-24", "2026-9-4", "24/09/2026" y "Domingo, 24 de Septiembre
 * de 2026" (y variantes con "sep", "septiembre"… SOLO si el mes es escribible).
 * Devuelve null si no puede resolver el día/mes/año. NUNCA devuelve una fecha
 * parcial: la persistencia solo recibe ISO válido o null (→ hoyLocal).
 */
export function normalizarFechaIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  const MESES: Record<string, number> = {
    enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3,
    abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7,
    agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9,
    octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
  };
  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;
  // 1) YYYY-MM-DD / YYYY/M/D / YYYY-MM-DDTHH...
  let mm = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (mm) {
    y = parseInt(mm[1], 10);
    m = parseInt(mm[2], 10);
    d = parseInt(mm[3], 10);
  } else {
    // 2) DD/MM/YYYY o DD-MM-YYYY (orden mexicano-típico para latam).
    mm = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
    if (mm) {
      d = parseInt(mm[1], 10);
      m = parseInt(mm[2], 10);
      y = parseInt(mm[3], 10);
    } else {
      // 3) "Domingo, 24 de Septiembre de 2026" (y variantes).
      const sep = s.match(/^[\p{L} ]*?(\d{1,2})\s+de\s+([A-Za-z]+)\s+de\s+(\d{4})/u);
      if (sep) {
        d = parseInt(sep[1], 10);
        m = MESES[sep[2].toLowerCase()] ?? null;
        y = parseInt(sep[3], 10);
      }
    }
  }
  if (!y || !m || !d) return null;
  const fecha = new Date(Date.UTC(y, m - 1, d));
  if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function paisHipodromo(hipo?: string | null): string | null {
  const h = String(hipo || "").trim().toUpperCase();
  if (!h) return null;
  if (HIPODROMOS_USA.some((n) => h.includes(n))) return "USA";
  return "VE";
}

/** Nacionalidad por defecto de un ejemplar: la que trajo la IA si es válida,
 *  si no la del país del hipódromo de la carrera (USA/VE). */
export function nacEjemplar(ej?: { nacionalidad?: string } | null, hipo?: string | null): string {
  const nac = String(ej?.nacionalidad || "").trim().toUpperCase();
  if (NACIONALIDADES.includes(nac as (typeof NACIONALIDADES)[number])) return nac;
  return paisHipodromo(hipo) || "VE";
}

/** Paleta oficial de 14 colores de gualdrapa (idéntica a la del Ensamblaje). */
export function colorDeNumeroGac(n: unknown): { bg: string; fg: string } {
  const x = parseInt(String(n), 10);
  const PALETA: Array<{ bg: string; fg: string }> = [
    { bg: "#FF0000", fg: "#FFFFFF" },
    { bg: "#FFFFFF", fg: "#000000" },
    { bg: "#0000FF", fg: "#FFFFFF" },
    { bg: "#FFFF00", fg: "#000000" },
    { bg: "#008000", fg: "#FFFFFF" },
    { bg: "#000000", fg: "#FFFF00" },
    { bg: "#FFA500", fg: "#000000" },
    { bg: "#FFC0CB", fg: "#000000" },
    { bg: "#40E0D0", fg: "#000000" },
    { bg: "#800080", fg: "#FFFFFF" },
    { bg: "#808080", fg: "#FF0000" },
    { bg: "#32CD32", fg: "#000000" },
    { bg: "#8B4513", fg: "#FFFFFF" },
    { bg: "#800000", fg: "#FFFFFF" },
  ];
  if (!x) return { bg: "#94a3b8", fg: "#FFFFFF" };
  return PALETA[((x - 1) % 14 + 14) % 14];
}

export function parsearRangoPaginas(txt: string): Set<number> {
  const set = new Set<number>();
  (txt || "").split(",").forEach((part) => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.min(+m[1], +m[2]);
      const b = Math.max(+m[1], +m[2]);
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(part)) {
      set.add(+part);
    }
  });
  return set;
}

/** Suma de los valores de los ejemplares de una carrera (Suma de la Tabla). */
export function sumaCarrera(c: CarreraRegistro | null | undefined): number {
  return listaHors(c || {}).reduce((a, ej) => a + (aNum(ej.valor) ?? aNum(ej.pts) ?? 0), 0);
}

/** Acepta "caballos" (buzón/ensamblaje) o "ejemplares" (registro IA), igual
 *  que el legacy js/tablas.js listaHors(). */
export function listaHors(pre: CarreraRegistro | Record<string, unknown>): EjemplarEditable[] {
  const p = pre as CarreraRegistro;
  if (Array.isArray(p.caballos) && p.caballos.length) return p.caballos;
  if (Array.isArray(p.ejemplares)) return p.ejemplares;
  return [];
}

// ---------- Registro persistente (gaceta_registro) ----------

function leerArr<T>(clave: string): T[] | null {
  try {
    const x = JSON.parse(localStorage.getItem(clave) || "");
    if (Array.isArray(x)) return x as T[];
  } catch {
    /* vacío */
  }
  try {
    const x = JSON.parse(sessionStorage.getItem(clave) || "");
    if (Array.isArray(x)) return x as T[];
  } catch {
    /* vacío */
  }
  return null;
}

function escribirArr(clave: string, arr: unknown[]): void {
  try {
    localStorage.setItem(clave, JSON.stringify(arr));
  } catch {
    /* cuota llena */
  }
  try {
    sessionStorage.setItem(clave, JSON.stringify(arr));
  } catch {
    /* cuota llena */
  }
}

function quitarClave(clave: string): void {
  try {
    localStorage.removeItem(clave);
  } catch {
    /* noop */
  }
  try {
    sessionStorage.removeItem(clave);
  } catch {
    /* noop */
  }
}

/** Lee el registro del día (localStorage primero, sesión como respaldo). */
export function leerRegistro(): CarreraRegistro[] | null {
  return leerArr<CarreraRegistro>(REGISTRO_KEY);
}

export function escribirRegistro(arr: CarreraRegistro[]): void {
  escribirArr(REGISTRO_KEY, arr);
}

/** Persiste las carreras con sus marcas enviada/aplicada (H.persistirRegistro). */
export function persistirRegistro(carreras: CarreraRegistro[]): void {
  escribirRegistro(carreras.map((c) => Object.assign({}, c, { enviada: !!c.enviada, aplicada: !!c.aplicada })));
}

/**
 * Marca como enviadas las carreras dadas dentro del estado (coincidencia por
 * hipódromo+carrera, si no solo hipódromo, si no una pendiente sin hipódromo,
 * y como último recurso la primera sin marcar). Igual que el legacy
 * H.marcarEnviadas. Además conserva los VALORES editados en pantalla.
 */
export function marcarEnviadas(estado: CarreraRegistro[], enviadas: CarreraRegistro[]): void {
  const porMarcar = estado.filter((c) => !c.enviada);
  enviadas.forEach((ce) => {
    const hipo = String(ce.hipodromo || "").trim().toUpperCase();
    let idx = porMarcar.findIndex(
      (c) => String(c.hipodromo || "").trim().toUpperCase() === hipo && String(c.carrera ?? "") === String(ce.carrera ?? "")
    );
    if (idx === -1 && hipo) idx = porMarcar.findIndex((c) => String(c.hipodromo || "").trim().toUpperCase() === hipo);
    if (idx === -1) idx = porMarcar.findIndex((c) => !String(c.hipodromo || "").trim());
    if (idx === -1) idx = 0;
    const objetivo = porMarcar.splice(idx, 1)[0];
    if (objetivo) {
      objetivo.enviada = true;
      objetivo.aplicada = false;
      const porNombre = new Map<string, EjemplarEditable>();
      (ce.caballos || []).forEach((cb) => porNombre.set(String(cb.nombre || "").toUpperCase(), cb));
      (objetivo.ejemplares || []).forEach((ej) => {
        const cb = porNombre.get(String(ej.nombre || "").toUpperCase());
        if (cb) {
          ej.numero = cb.numero;
          ej.valor = cb.valor;
        }
      });
    }
  });
  persistirRegistro(estado);
}

// ---------- Buzón hacia el Ensamblaje ----------

/** Acumula carreras en el Ensamblaje (ensamblaje_carreras + gaceta_prellenado),
 *  igual que el legacy js/gaceta.js acumularEnEnsamblaje(). Retorna el total. */
export function acumularEnEnsamblaje(carreras: CarreraRegistro[]): number {
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY) ?? [];
  carreras.forEach((c) => arr.push(Object.assign({}, c)));
  escribirArr(ENSAMBLAJE_CARRERAS_KEY, arr);
  const ultima = carreras[carreras.length - 1];
  if (ultima) escribirArr(GACETA_PRELLENADO_KEY, [ultima]);
  return arr.length;
}

/** Lee el buzón (ensamblaje_carreras + gaceta_prellenado), normalizando cada
 *  carrera con enviada=false (igual que migrarLegacy de js/tablas.js). */
export function leerBuzonEnsamblaje(): CarreraRegistro[] {
  const out: CarreraRegistro[] = [];
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY);
  if (arr) out.push(...arr);
  try {
    const solo = localStorage.getItem(GACETA_PRELLENADO_KEY) || sessionStorage.getItem(GACETA_PRELLENADO_KEY);
    if (solo) {
      const p = JSON.parse(solo) as CarreraRegistro;
      if (p && p.hipodromo) out.push(p);
    }
  } catch {
    /* inválido */
  }
  return out.map((c) => Object.assign({}, c, { enviada: false }));
}

/** Consume el buzón (al levantar el Ensamblaje los pega en cards, igual que el
 *  legacy js/tablas.js escribirGacetaRegistro que limpia las claves de envío). */
export function limpiarBuzonEnsamblaje(): void {
  quitarClave(ENSAMBLAJE_CARRERAS_KEY);
  quitarClave(GACETA_PRELLENADO_KEY);
}

/** Quita UNA carrera del registro persistente (paridad eliminarDelRegistroGaceta). */
export function eliminarDelRegistroGaceta(hipodromo: string | null | undefined, carrera: string | number | null | undefined): void {
  const reg = leerRegistro();
  if (!reg || !reg.length) return;
  const h = String(hipodromo || "").trim().toUpperCase();
  const c = String(carrera ?? "");
  const filtrados = reg.filter(
    (item) => String(item.hipodromo || "").trim().toUpperCase() !== h || String(item.carrera ?? "") !== c
  );
  if (filtrados.length !== reg.length) {
    escribirRegistro(filtrados);
    limpiarBuzonEnsamblaje();
  }
}

/** Borra el registro del día + buzón (paridad limpiarRegistro de js/gaceta.js). */
export function limpiarTodoRegistro(): void {
  quitarClave(REGISTRO_KEY);
  limpiarBuzonEnsamblaje();
}

/** Convierte una carrera de la Gaceta en una card del Ensamblaje (DraftCarrera),
 *  mapeando caballos/ejemplares → EjemplarTabla. Igual que el legacy
 *  construirCardsGaceta → listaHors + crearCardCarrera. */
export function aDraftCarrera(pre: CarreraRegistro, sufijo = ""): DraftCarrera {
  const caballos = listaHors(pre)
    .map((c) => ({
      numero: String(c.numero ?? ""),
      nombre: String(c.nombre || "").trim().toUpperCase(),
      nacionalidad: String(c.nacionalidad || "VE").toUpperCase(),
      valor_ejemplar: aNum(c.valor) ?? aNum(c.pts) ?? null,
    }))
    .filter((c) => c.nombre);
  return {
    uid: "gac-" + Date.now().toString(36) + (sufijo || Math.random().toString(36).slice(2, 6)),
    hipodromo: String(pre.hipodromo || "").trim().toUpperCase(),
    carrera: String(pre.carrera ?? ""),
    distancia: String(pre.distancia ?? "").trim() || "1100",
    superficie: String(pre.superficie || "ARENA").toUpperCase(),
    premio: String(pre.premio ?? 100),
    caballos,
    /** Fecha del evento leída por la IA (ISO estricto) — se conserva para que
     *  la publicación de la tabla fija use ESA fecha y no la del sistema. */
    fecha: pre.fecha ? normalizarFechaIso(pre.fecha) : null,
  };
}