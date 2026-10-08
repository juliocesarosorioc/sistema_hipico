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
import { getHorseColor } from "@/lib/horseColors";
import { interpretarFecha } from "@/lib/fechas";
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
 * NUNCA devuelve una fecha parcial: la persistencia solo recibe ISO válido o
 * null (→ hoyLocal).
 *
 * DELEGADO en `interpretarFecha` de `@/lib/fechas`, que es la única fuente de
 * verdad. Antes esta función tenía su propia copia del parser y su clase de
 * separadores era `[/.]`: el guion no estaba, así que "04-10-2026" —como se
 * escribe una fecha todos los días en Venezuela— devolvía `null`. El `null` se
 * TOMABA COMO "sin fecha" y el texto crudo se iba al INSERT, donde Postgres lo
 * leyó como MM-DD y quedó en 2026-04-10. Ese fue el incidente que partió la
 * jornada del 04-10-2026. No se vuelve a escribir un segundo parser de fechas.
 *
 * Para GUARDAR (no para leer) usa `exigirFechaIso`, que lanza en vez de
 * devolver `null`: un validador que "no opina" deja pasar lo que no validó.
 */
export function normalizarFechaIso(v: unknown): string | null {
  return interpretarFecha(v).iso;
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
/**
 * @deprecated Usa `getHorseColor` / `horseBgHex` de "@/lib/horseColors".
 * Se conserva por compatibilidad (Dupletas, Gaceta) y ahora delega en la
 * paleta canónica: antes este archivo, horseColors.ts y el `cardColor` local
 * de Gestión de Jugadas tenían paletas DIFERENTES para el mismo número.
 */
export function colorDeNumeroGac(n: unknown): { bg: string; fg: string } {
  const c = getHorseColor(typeof n === "number" ? n : parseInt(String(n), 10));
  return { bg: c.hex, fg: c.hexText };
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

/**
 * Clave única de una carrera: día + hipódromo + número. Dos carreras con la
 * misma clave son LA MISMA carrera, vengan de la gaceta o de un re-envío.
 * Con clave vacía ("||") no se puede comparar nada, y ahí se permite repetir.
 */
export function claveCarrera(c: CarreraRegistro | null | undefined): string {
  const hipo = String(c?.hipodromo || "").trim().toUpperCase();
  const car = String(c?.carrera ?? "").trim();
  const dia = c?.fecha ? (normalizarFechaIso(c.fecha) || "").slice(0, 10) : "";
  return `${dia}|${hipo}|${car}`;
}

/** ¿La clave identifica una carrera de verdad (trae hipódromo o número)? */
function claveValida(k: string): boolean {
  const [, hipo, car] = k.split("|");
  return Boolean(hipo || car);
}

/**
 * Quita las carreras REPETIDAS de una lista recién transcripta (misma clave),
 * conservando la primera aparición. Devuelve cuántas se descartaron.
 */
export function deduplicarCarreras(carreras: CarreraRegistro[]): { lista: CarreraRegistro[]; quitadas: number } {
  const vistas = new Set<string>();
  const lista: CarreraRegistro[] = [];
  let quitadas = 0;
  for (const c of carreras) {
    const k = claveCarrera(c);
    if (claveValida(k) && vistas.has(k)) {
      quitadas += 1;
      continue;
    }
    if (claveValida(k)) vistas.add(k);
    lista.push(c);
  }
  return { lista, quitadas };
}

/** Cuántas de las carreras dadas YA están en el buzón del Ensamblaje.
 *  El envío las REEMPLAZA en vez de sumar una copia más. */
export function duplicadasEnEnsamblaje(carreras: CarreraRegistro[]): number {
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY) ?? [];
  const claves = new Set(arr.map(claveCarrera).filter(claveValida));
  return carreras.filter((c) => claves.has(claveCarrera(c))).length;
}

/** Conteo de carreras ya cargadas en el buzón (claves únicas). */
export function cargadasEnEnsamblaje(): number {
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY) ?? [];
  return new Set(arr.map(claveCarrera).filter(claveValida)).size;
}

/**
 * Acumula carreras en el Ensamblaje (ensamblaje_carreras + gaceta_prellenado),
 * igual que el legacy js/gaceta.js acumularEnEnsamblaje(). Retorna el total.
 *
 * CONTROL DE DUPLICADOS: si el buzón ya tiene una carrera con el mismo
 * día+hipódromo+número, se REEMPLAZA (queda la versión nueva con los valores
 * corregidos) en lugar de apilar una copia. Reenviar la misma gaceta —o
 * transformar dos veces el mismo PDF— ya no duplica carreras.
 */
export function acumularEnEnsamblaje(carreras: CarreraRegistro[]): number {
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY) ?? [];
  carreras.forEach((c) => {
    const k = claveCarrera(c);
    const i = claveValida(k) ? arr.findIndex((x) => claveCarrera(x) === k) : -1;
    if (i >= 0) arr[i] = Object.assign({}, c);
    else arr.push(Object.assign({}, c));
  });
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

/** Día ISO de una carrera del buzón (vacío si la Gaceta no trajo fecha). */
function diaDeBuzon(c: CarreraRegistro): string {
  return (c?.fecha ? normalizarFechaIso(c.fecha) : null)?.slice(0, 10) || "";
}

/**
 * Consume el buzón (al levantar el Ensamblaje los pega en cards, igual que el
 * legacy js/tablas.js escribirGacetaRegistro que limpia las claves de envío).
 *
 * Si se pasa `dia`, solo se consumen las carreras de ESE día: las de otro día
 * se conservan en el buzón para que aparezcan cuando el usuario cambie la
 * fecha. La plataforma tiene un registro único y central de carreras, así que
 * una gaceta de mañana no puede aparecer ni desaparecer dentro de la de hoy.
 */
export function limpiarBuzonEnsamblaje(dia?: string): void {
  if (!dia) {
    quitarClave(ENSAMBLAJE_CARRERAS_KEY);
    quitarClave(GACETA_PRELLENADO_KEY);
    return;
  }
  const arr = leerArr<CarreraRegistro>(ENSAMBLAJE_CARRERAS_KEY);
  if (arr) {
    const resto = arr.filter((c) => {
      const d = diaDeBuzon(c);
      return d !== "" && d !== dia;
    });
    if (resto.length) escribirArr(ENSAMBLAJE_CARRERAS_KEY, resto);
    else quitarClave(ENSAMBLAJE_CARRERAS_KEY);
  }
  const solo = localStorage.getItem(GACETA_PRELLENADO_KEY) || sessionStorage.getItem(GACETA_PRELLENADO_KEY);
  if (!solo) return;
  let conservar = false;
  try {
    const p = JSON.parse(solo) as CarreraRegistro;
    const d = p && p.hipodromo ? diaDeBuzon(p) : "";
    conservar = !!d && d !== dia;
  } catch {
    conservar = false;
  }
  if (!conservar) quitarClave(GACETA_PRELLENADO_KEY);
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