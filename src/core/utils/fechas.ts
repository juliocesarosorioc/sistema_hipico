/**
 * Utilidades de fecha normalizadas bajo el huso horario America/Caracas (UTC-4).
 */
export function hoyLocal(): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Caracas",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return formatter.format(new Date());
}

export function normalizarFechaIso(fechaStr?: string | null): string {
    if (!fechaStr) return hoyLocal();
    const parts = String(fechaStr).split(/[\/\-]/);
    if (parts.length === 3) {
        if (parts[0].length === 4) {
            return parts[0] + "-" + parts[1].padStart(2, "0") + "-" + parts[2].padStart(2, "0");
        } else {
            return parts[2] + "-" + parts[1].padStart(2, "0") + "-" + parts[0].padStart(2, "0");
        }
    }
    return String(fechaStr).slice(0, 10);
}

export function esFechaIso(str?: string | null): boolean {
    if (!str) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(str).trim());
}

export type ResultadoInterpretacionFecha = {
    iso: string;
    motivo?: string;
    ambigua?: boolean;
    alternativas?: string[];
};

export function interpretarFecha(str?: unknown): ResultadoInterpretacionFecha {
    const val = str != null ? String(str) : "";
    const isoVal = normalizarFechaIso(val);
    return {
        iso: isoVal,
        motivo: isoVal ? undefined : "Fecha no válida",
        ambigua: false,
        alternativas: [],
    };
}
