// ============================================================================
// Normalización de filas de `tablas_fijas` — módulo PURO.
//
// Vive aparte de `rpc.ts` a propósito. `normalizarFilas` no toca la base: solo
// castea y ordena. Pero estaba definida dentro de `rpc.ts`, que importa
// `@/lib/supabase` en tiempo de ejecución, y eso hacía imposible probarla desde
// node (el import moría antes de llegar a la función). Al separarla, las
// pruebas unitarias del CRUD de cuadros pueden ejercitar de verdad la que decide
// si `ganador` y `ejemplar_id` sobreviven a la lectura.
//
// Si alguna vez hace falta tocar esto, el invariante importante es este: el
// `map` de cada cuadro debe conservar TODOS los campos de `EjemplarTabla`. Un
// campo omitido se pierde en silencio, porque las escrituras reescriben el array
// `caballos` completo a partir de lo que se leyo.
// ============================================================================
// Rutas RELATIVAS a proposito. Este archivo se compila a CommonJS para correr
// en node (ver pruebas/tsconfig.json) y node no resuelve el alias `@/`. Los
// modulos de Marcas usan el mismo truco por la misma razon.
import type { TablaFijaRow } from "../tablas-fijas";
import { parseNum } from "./tipos";

/**
 * Orden de presentación: primero por hipódromo (A-Z) y dentro de cada uno por
 * número de carrera ASCENDENTE. Sin esto el orden es el que devuelva la
 * consulta (arbitrario) y las carreras se ven desordenadas: 3, 11, 2, 1.
 * Se compara numéricamente, no como texto, para que C2 vaya antes que C10.
 */
function compararParaMostrar(a: TablaFijaRow, b: TablaFijaRow): number {
  const hipo = (a.hipodromo ?? "").localeCompare(b.hipodromo ?? "", "es");
  if (hipo !== 0) return hipo;
  const ca = Number(a.carrera);
  const cb = Number(b.carrera);
  // Las carreras sin número válido se van al final, no al principio.
  const va = Number.isFinite(ca) && ca > 0 ? ca : Number.POSITIVE_INFINITY;
  const vb = Number.isFinite(cb) && cb > 0 ? cb : Number.POSITIVE_INFINITY;
  if (va !== vb) return va - vb;
  return (a.fecha ?? "").localeCompare(b.fecha ?? "");
}

/** Normaliza filas crudas (número/string) al contrato de la SPA. */
export function normalizarFilas(data: unknown[]): TablaFijaRow[] {
  return data
    .map((r) => {
      const raw = r as Record<string, unknown>;
      const caballos = Array.isArray(raw.caballos)
        ? raw.caballos.map((c) => {
            const cc = c as Record<string, unknown>;
            return {
              numero: String(cc.numero ?? ""),
              nombre: String(cc.nombre ?? ""),
              nacionalidad: cc.nacionalidad ? String(cc.nacionalidad) : null,
              valor_ejemplar: cc.valor_ejemplar != null ? parseNum(cc.valor_ejemplar) : null,
              retirado: Boolean(cc.retirado),
              // `ganador` y `ejemplar_id` tambien se conservan. Antes se caian al
              // map y cualquier edicion que reescribiera el array `caballos`
              // completo (el CRUD de cuadros) dejaba a todos los ejemplares sin
              // ganador y sin su vinculo al padron.
              ganador: Boolean(cc.ganador),
              ejemplar_id: cc.ejemplar_id != null ? String(cc.ejemplar_id) : null,
            };
          })
        : null;
      const grupos = Array.isArray(raw.tabla_grupos)
        ? raw.tabla_grupos.map((g) => g as Record<string, unknown>)
        : null;
      return {
        id: String(raw.id ?? ""),
        hipodromo: raw.hipodromo ? String(raw.hipodromo) : null,
        hipodromo_id: raw.hipodromo_id != null ? (raw.hipodromo_id as string | number) : null,
        carrera: parseNum(raw.carrera) || null,
        fecha: raw.fecha ? String(raw.fecha) : null,
        fecha_creacion: raw.fecha_creacion ? String(raw.fecha_creacion) : null,
        estado: raw.estado ? String(raw.estado) : null,
        premio_original: raw.premio_original != null ? parseNum(raw.premio_original) : null,
        premio_recalculado: raw.premio_recalculado != null ? parseNum(raw.premio_recalculado) : null,
        suma_base_tabla: raw.suma_base_tabla != null ? parseNum(raw.suma_base_tabla) : null,
        monto_tabla: raw.monto_tabla != null ? parseNum(raw.monto_tabla) : null,
        limite_ventas: raw.limite_ventas != null ? parseNum(raw.limite_ventas) : null,
        cantidad_vendida: raw.cantidad_vendida != null ? parseNum(raw.cantidad_vendida) : null,
        moneda: raw.moneda ? String(raw.moneda) : null,
        distancia_carrera: raw.distancia_carrera ? String(raw.distancia_carrera) : null,
        superficie: raw.superficie ? String(raw.superficie) : null,
        retirados_oficiales: raw.retirados_oficiales ? String(raw.retirados_oficiales) : null,
        caballos,
        tabla_grupos: grupos as TablaFijaRow["tabla_grupos"],
      };
    })
    .sort(compararParaMostrar);
}
