/**
 * CUADERNO DE JUGADAS — agregación pura (sin Supabase).
 *
 * Vive separado de `cuaderno.ts` (que sí habla con la base) para que los
 * totales —por grupo y por semana— se puedan probar en node sin credenciales.
 * La regla de oro del Cuaderno: NO mueve saldos. Es un libro de control que el
 * admin lleva a mano para ver cómo va un cliente entre varios grupos,
 * incluidos los que no están registrados en el sistema.
 *
 * DEFINICIONES (para que el número no cambie de significado entre pantallas):
 *   apostado  = suma de `monto` de TODOS los apuntes.
 *   premios   = suma de `premio` SOLO de los apuntes 'Ganada'.
 *   neto      = premios - apostado.  Positivo = el cliente ganó (la casa debe);
 *               negativo = la casa ganó. Es la posición neta del cliente.
 *   pendiente = suma de `monto` de los apuntes 'Pendiente' (todavía en riesgo).
 */

export type CuadernoEstado = "Pendiente" | "Ganada" | "Perdida" | "Reembolsada";

/** Estados válidos del cuaderno (mismo orden que el selector de la UI). */
export const ESTADOS_CUADERNO: CuadernoEstado[] = ["Pendiente", "Ganada", "Perdida", "Reembolsada"];

/**
 * Fila del cuaderno tal como sale de `public.cuaderno_jugadas`.
 *
 * `monto`/`premio` se aceptan como `number | string` porque PostgREST devuelve
 * las columnas `numeric` como texto; la agregación los normaliza igual.
 */
export type CuadernoFila = {
  id: string | number;
  cliente_id: string | number;
  grupo_id?: string | number | null;
  grupo_nombre: string;
  /** Fecha de la carrera (YYYY-MM-DD). */
  fecha: string;
  hipodromo?: string | null;
  carrera?: number | string | null;
  tipo?: string | null;
  caballo?: string | null;
  monto: number | string;
  premio: number | string;
  estado: CuadernoEstado | string;
  nota?: string | null;
  creado_por?: string | null;
  created_at?: string | null;
};

/** Totales de un conjunto de apuntes (de un grupo, de una semana o globales). */
export type ResumenCuaderno = {
  jugadas: number;
  apostado: number;
  premios: number;
  neto: number;
  pendiente: number;
};

/** Totales por grupo: la clave es el nombre del grupo (texto libre). */
export type ResumenGrupo = ResumenCuaderno & { grupo: string };

/** Totales por semana (lunes a domingo). */
export type ResumenSemana = ResumenCuaderno & { inicio: string; fin: string };

export type CuadernoAgregado = {
  totales: ResumenCuaderno;
  porGrupo: ResumenGrupo[];
  porSemana: ResumenSemana[];
};

/** Número usable desde `numeric` de PostgREST o desde un input. */
export function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/** ISO corto (YYYY-MM-DD) de una fecha local, sin pasar por UTC. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Suma `dias` a una fecha ISO (YYYY-MM-DD) usando calendario local. */
export function sumarDiasIso(fechaIso: string, dias: number): string {
  const [y, m, d] = String(fechaIso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return fechaIso;
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + dias);
  return isoLocal(base);
}

/**
 * Lunes de la semana ISO que contiene `fechaIso`. La semana del Cuaderno es
 * lunes→domingo, la misma que usa el ciclo por defecto de los grupos. Si la
 * fecha viene vacía o rota, se devuelve tal cual (la fila cae en su propio
 * grupo y no desaparece del reporte).
 */
export function inicioSemana(fechaIso: string): string {
  const iso = String(fechaIso ?? "").slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const base = new Date(y, m - 1, d);
  if (Number.isNaN(base.getTime())) return iso;
  const js = base.getDay(); // 0 = domingo
  const retro = js === 0 ? 6 : js - 1;
  base.setDate(base.getDate() - retro);
  return isoLocal(base);
}

/** Etiqueta legible de la semana: "2026-10-13 → 2026-10-19". */
export function etiquetaSemana(inicio: string): string {
  return `${inicio} → ${sumarDiasIso(inicio, 6)}`;
}

/** Aporta UNA fila a un acumulador de totales. */
function acumular(r: ResumenCuaderno, f: CuadernoFila): void {
  const monto = num(f.monto);
  const premio = num(f.premio);
  r.jugadas += 1;
  r.apostado += monto;
  if (f.estado === "Ganada") r.premios += premio;
  if (f.estado === "Pendiente") r.pendiente += monto;
  r.neto = r.premios - r.apostado;
}

const vacio = (): ResumenCuaderno => ({ jugadas: 0, apostado: 0, premios: 0, neto: 0, pendiente: 0 });

/**
 * Arma los totales del Cuaderno: globales, por grupo y por semana.
 *
 * `porGrupo` y `porSemana` salen ordenados para la lectura: los grupos de mayor
 * a menor apostado (lo que más pesa primero) y las semanas de la más reciente a
 * la más vieja (lo último que pasó, arriba).
 */
export function resumenCuaderno(filas: CuadernoFila[]): CuadernoAgregado {
  const totales = vacio();
  const grupos = new Map<string, ResumenCuaderno>();
  const semanas = new Map<string, ResumenCuaderno>();

  for (const f of filas) {
    acumular(totales, f);

    const g = String(f.grupo_nombre ?? "").trim() || "SIN GRUPO";
    const accG = grupos.get(g) ?? vacio();
    acumular(accG, f);
    grupos.set(g, accG);

    const ini = inicioSemana(String(f.fecha ?? ""));
    const accS = semanas.get(ini) ?? vacio();
    acumular(accS, f);
    semanas.set(ini, accS);
  }

  const porGrupo: ResumenGrupo[] = [...grupos.entries()]
    .map(([grupo, r]) => ({ grupo, ...r }))
    .sort((a, b) => b.apostado - a.apostado || a.grupo.localeCompare(b.grupo, "es"));

  const porSemana: ResumenSemana[] = [...semanas.entries()]
    .map(([inicio, r]) => ({ inicio, fin: sumarDiasIso(inicio, 6), ...r }))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));

  return { totales, porGrupo, porSemana };
}
