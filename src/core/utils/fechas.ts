// ============================================================================
// FECHAS — UNICA FUENTE DE VERDAD.
// ============================================================================

const MESES: Record<string, number> = {
  enero: 1, ene: 1,
  febrero: 2, feb: 2,
  marzo: 3, mar: 3,
  abril: 4, abr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6,
  julio: 7, jul: 7,
  agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9,
  octubre: 10, oct: 10,
  noviembre: 11, nov: 11,
  diciembre: 12, dic: 12,
};

export type LecturaFecha = {
  iso: string | null;
  ambigua: boolean;
  alternativas: string[];
  motivo: string | null;
};

export type ResultadoInterpretacionFecha = LecturaFecha;

function isoDe(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2999) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!mm) return false;
  return isoDe(Number(mm[1]), Number(mm[2]), Number(mm[3])) !== null;
}

function desdeIsoConHora(s: string): string | null {
  const mm = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (!mm) return null;
  return isoDe(Number(mm[1]), Number(mm[2]), Number(mm[3]));
}

export function interpretarFecha(v: unknown): LecturaFecha {
  const ninguna = (motivo: string): LecturaFecha => ({ iso: null, ambigua: false, alternativas: [], motivo });

  if (v === null || v === undefined) return ninguna("No se recibio ninguna fecha.");
  const s = String(v).trim();
  if (!s) return ninguna("La fecha esta vacia.");

  const iso = desdeIsoConHora(s);
  if (iso) return { iso, ambigua: false, alternativas: [iso], motivo: null };

  const conMes = /^[\p{L}\s,]*?(\d{1,2})\s*(?:de\s+|del\s+)?([\p{L}]+)\.?\s*(?:de\s+|del\s+)?(\d{4})\s*$/u.exec(s);
  if (conMes) {
    const d = Number(conMes[1]);
    const clave = conMes[2].toLowerCase().replace(/[^a-z]/g, "");
    const m = MESES[clave];
    if (m) {
      const r = isoDe(Number(conMes[3]), m, d);
      return r
        ? { iso: r, ambigua: false, alternativas: [r], motivo: null }
        : ninguna(`"${d}" no existe en ${conMes[2]}.`);
    }
    return ninguna(`No se reconoce el mes "${conMes[2]}".`);
  }

  const ddmm = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(s);
  if (ddmm) {
    const a = Number(ddmm[1]);
    const b = Number(ddmm[2]);
    const y = Number(ddmm[3]);

    const comoDiaMes = isoDe(y, b, a);
    const comoMesDia = isoDe(y, a, b);

    const alts: string[] = [];
    if (comoDiaMes) alts.push(comoDiaMes);
    if (comoMesDia && comoMesDia !== comoDiaMes) alts.push(comoMesDia);

    if (!alts.length) return ninguna(`"${s}" no es una fecha valida.`);

    return {
      iso: comoDiaMes ?? comoMesDia,
      ambigua: alts.length > 1,
      alternativas: alts,
      motivo: null,
    };
  }

  const compacto = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compacto) {
    const r = isoDe(Number(compacto[1]), Number(compacto[2]), Number(compacto[3]));
    if (r) return { iso: r, ambigua: false, alternativas: [r], motivo: null };
    return ninguna(`"${s}" no es una fecha valida.`);
  }

  return ninguna(`"${s}" no tiene un formato de fecha reconocible. Use AAAA-MM-DD o DD/MM/AAAA.`);
}

export function exigirFechaIso(v: unknown, contexto: string, ambiguaSi = true): string {
  const r = interpretarFecha(v);
  if (!r.iso) throw new Error(`${contexto}: ${r.motivo ?? "fecha invalida"}`);
  if (ambiguaSi && r.ambigua) {
    throw new Error(
      `${contexto}: "${String(v).trim()}" es una fecha AMBIGUA: puede ser ` +
        `${r.alternativas.join(" o ")}. Escriba el ano primero (AAAA-MM-DD) para ` +
        `dejar claro el dia.`
    );
  }
  return r.iso;
}

export function fechaOpcional(v: unknown): LecturaFecha {
  if (v === null || v === undefined || String(v).trim() === "") {
    return { iso: null, ambigua: false, alternativas: [], motivo: null };
  }
  return interpretarFecha(v);
}

export function isoAFechaLocal(iso: string): string {
  const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!mm) return iso;
  return `${mm[3]}/${mm[2]}/${mm[1]}`;
}

export const ZONA_JORNADA = "America/Caracas";

export function fechaJornadaCaracas(fecha: Date = new Date()): string {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA_JORNADA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const out = fmt.format(d);
    if (esFechaIso(out)) return out;
  } catch {
    /* fallback */
  }
  const desplazado = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  const iso = `${desplazado.getUTCFullYear()}-${String(desplazado.getUTCMonth() + 1).padStart(2, "0")}-${String(
    desplazado.getUTCDate()
  ).padStart(2, "0")}`;
  return esFechaIso(iso) ? iso : d.toISOString().slice(0, 10);
}

export function horaJornadaCaracas(fecha: Date = new Date()): string {
  const d = fecha instanceof Date && !Number.isNaN(fecha.getTime()) ? fecha : new Date();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONA_JORNADA,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    const desplazado = new Date(d.getTime() - 4 * 60 * 60 * 1000);
    return `${String(desplazado.getUTCHours()).padStart(2, "0")}:${String(desplazado.getUTCMinutes()).padStart(2, "0")}`;
  }
}

export function obtenerFechaJornadaVzla(fechaInput?: Date | string): string {
  if (typeof fechaInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fechaInput.trim())) {
    return fechaInput.trim();
  }
  const d = fechaInput ? new Date(fechaInput) : new Date();
  return fechaJornadaCaracas(d);
}

export function hoyLocal(): string {
  return fechaJornadaCaracas(new Date());
}

export function normalizarFechaIso(fechaStr?: string | null): string {
  if (!fechaStr) return hoyLocal();
  const r = interpretarFecha(fechaStr);
  if (r.iso) return r.iso;
  return String(fechaStr).slice(0, 10);
}
