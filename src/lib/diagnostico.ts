/**
 * DIAGNÓSTICO DEL SISTEMA — lectura de sanidad + reparación de la matriz.
 *
 * POR QUÉ EXISTE
 * ---------------
 * El fallo más caro que ha tenido la plataforma no era un error visible: era una
 * CARRERA QUE SÓLO EXISTÍA EN UNA TABLA. Tablas Fijas leía `tablas_fijas`; el
 * resto de los módulos (Marcas, Dupleta, Remates, Taquilla, Jugadas) leen la
 * matriz `carreras`. Como la sincronización entre ambas era best-effort del
 * cliente, una carrera publicada podía quedarse sin ver en ninguna otra parte y
 * el operador no se enteraba: no había error, sólo un programa incompleto.
 *
 * `carreras` es el catálogo único, así que la prueba de que el sistema está sano
 * es simple: toda carrera publicada en Tablas tiene fila en la matriz. Eso es lo
 * que este módulo mide y, con el botón de reparación, lo deja en su sitio.
 *
 * TODO lo de acá es de LECTURA salvo `repararMatrizDesdeTablas`, que escribe
 * únicamente con la capacidad `carreras:fn_registrar_carrera` y sólo completa
 * datos que están faltando: no toca estados, ni caballos, ni retiros, ni
 * resultados ya escritos.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import { escribirCarrerasMaestro, reintentarMaestro } from "@/lib/carreras/maestro";
import type { EntradaCarrera } from "@/lib/carreras/maestro-nucleo";
import { listarTablasPublicadas } from "@/lib/tablas/rpc";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { hoyLocal } from "@/lib/gaceta/programa";

export type EstadoChequeo = "ok" | "aviso" | "error";

export type Chequeo = {
  id: string;
  area: string;
  titulo: string;
  detalle: string;
  estado: EstadoChequeo;
  /** Cantidad de filas involucradas, para el número grande de la tarjeta. */
  conteo?: number;
};

export type ResultadoDiagnostico = {
  generado: string;
  chequeos: Chequeo[];
  /** Carreras publicadas que no están en la matriz (para la lista de detalle). */
  faltantes: string[];
  errores: number;
  avisos: number;
};

const LIMITE = 5000;

/** `true` cuando el error dice que la tabla/columna no existe → falta aplicar SQL. */
function esAusente(msg: string): boolean {
  return /does not exist|not found|PGRST202|PGRST204|schema cache/i.test(msg);
}

/** `true` = la tabla existe; `false` = no existe; string = otro error. */
async function existeTabla(nombre: string): Promise<boolean | string> {
  if (!supabase) return "Sin credenciales Supabase (.env.local).";
  try {
    const { error } = await supabase.from(nombre).select("*").limit(1);
    if (!error) return true;
    return esAusente(error.message) ? false : error.message;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return esAusente(msg) ? false : msg;
  }
}

/**
 * ¿Existe una columna? Igual que `existeTabla`, pero para un campo suelto.
 *
 * Se prueba SELECCIONANDO la columna, no consultando el catálogo: con la anon
 * key no se puede leer `information_schema` (RLS), y una consulta que devuelve
 * error por permiso se confundiría con "no existe".
 *
 * `select("id").eq(grupo, "-")` es lo más barato que devuelve error de columna
 * inexistente sin filtrar filas: `limit(1)` solo.
 */
async function existeColumna(tabla: string, columna: string): Promise<boolean | string> {
  if (!supabase) return "Sin credenciales Supabase (.env.local).";
  try {
    const { error } = await supabase.from(tabla).select(columna).limit(1);
    if (!error) return true;
    return esAusente(error.message) ? false : error.message;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return esAusente(msg) ? false : msg;
  }
}

async function contar(tabla: string, filtros?: (q: any) => any): Promise<number | null> {
  if (!supabase) return null;
  try {
    let q = supabase.from(tabla).select("id", { count: "exact", head: true });
    if (filtros) q = filtros(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** Clave de grano de la matriz: una fila por (fecha, hipódromo, carrera). */
const clave = (fecha: string, hipodromo: string, carrera: number) =>
  `${fecha}|${String(hipodromo).trim().toUpperCase()}|${carrera}`;

/** La fecha de una tabla: "fecha" o, si viene NULL del legacy, la de creación. */
function fechaDeTabla(t: TablaFijaRow): string {
  const f = String(t.fecha ?? "").slice(0, 10);
  if (f) return f;
  return String(t.fecha_creacion ?? "").slice(0, 10);
}

type FilaMatrizMin = {
  id: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
  hipodromo_id: string | number | null;
};

async function leerMatriz(): Promise<{ filas: FilaMatrizMin[]; error?: string }> {
  if (!supabase) return { filas: [], error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select("id,fecha,hipodromo,carrera,hipodromo_id")
      .limit(LIMITE);
    if (error) return { filas: [], error: error.message };
    return { filas: (data ?? []) as unknown as FilaMatrizMin[] };
  } catch (e) {
    return { filas: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Lectura de sanidad
// ---------------------------------------------------------------------------

/**
 * Corre todos los chequeos. No lanza: un chequeo que no se puede leer se
 * reporta como error con su mensaje, para que el operador vea qué falta
 * aplicar en vez de ver una pantalla en blanco.
 */
export async function correrDiagnostico(): Promise<ResultadoDiagnostico> {
  const chequeos: Chequeo[] = [];
  const faltantes: string[] = [];
  const hoy = hoyLocal();

  // --- 1. La matriz maestra está aplicada -----------------------------------
  const hayMatriz = await existeTabla("carreras");
  const matriz = hayMatriz === true ? await leerMatriz() : { filas: [], error: undefined };
  const enMatriz = new Set(matriz.filas.map((f) => clave(f.fecha, f.hipodromo, Number(f.carrera) || 0)));

  chequeos.push(
    hayMatriz === true
      ? {
          id: "matriz",
          area: "Carreras",
          titulo: "Matriz maestra `carreras` aplicada",
          detalle: `Es el catálogo único de la plataforma. Contiene ${matriz.filas.length} carreras.`,
          estado: "ok",
          conteo: matriz.filas.length,
        }
      : {
          id: "matriz",
          area: "Carreras",
          titulo: "Matriz maestra `carreras` NO aplicada",
          detalle:
            typeof hayMatriz === "string"
              ? hayMatriz
              : "Falta aplicar sql/carreras.sql (runbook paso 13). Sin ella los módulos no ven carreras.",
          estado: "error",
        }
  );

  // --- 2. Coherencia Tablas ↔ matriz ----------------------------------------
  const tablas = await listarTablasPublicadas();
  const validas = tablas.filter((t) => fechaDeTabla(t) && t.hipodromo && Number(t.carrera));
  for (const t of validas) {
    const k = clave(fechaDeTabla(t), String(t.hipodromo), Number(t.carrera) || 0);
    if (!enMatriz.has(k)) faltantes.push(k);
  }
  const huerfanas = tablas.length - validas.length;

  chequeos.push({
    id: "coherencia",
    area: "Carreras",
    titulo: "Carreras de Tablas Fijas presentes en la matriz",
    detalle: faltantes.length
      ? `${faltantes.length} de ${validas.length} carreras publicadas no existen en la matriz: los demás módulos no las ven.`
      : `Las ${validas.length} carreras publicadas están en la matriz.`,
    estado: faltantes.length ? "error" : "ok",
    conteo: faltantes.length,
  });

  if (huerfanas > 0) {
    chequeos.push({
      id: "tablas_sin_fecha",
      area: "Tablas",
      titulo: "Tablas publicadas sin fecha ni hipódromo",
      detalle: `${huerfanas} filas de tablas_fijas no se pueden comparar con la matriz (sin fecha o sin carrera).`,
      estado: "aviso",
      conteo: huerfanas,
    });
  }

  // --- 3. hipodromo_id resuelto --------------------------------------------
  const sinHip = matriz.filas.filter((f) => f.hipodromo_id == null);
  chequeos.push({
    id: "hipodromo_id",
    area: "Hipódromos",
    titulo: "Carreras con el hipódromo enlazado",
    detalle: sinHip.length
      ? `${sinHip.length} carreras no tienen hipodromo_id (el nombre está, el enlace no).`
      : "Todas las carreras de la matriz tienen hipodromo_id.",
    estado: sinHip.length ? "aviso" : "ok",
    conteo: sinHip.length,
  });

  // --- 4. Resultados sin carrera enlazada ----------------------------------
  const hayResultados = await existeTabla("resultados_carreras");
  if (hayResultados === true && supabase) {
    try {
      const { data, error } = await supabase
        .from("resultados_carreras")
        .select("id")
        .is("carrera_id", null)
        .limit(LIMITE);
      const sueltos = error ? 0 : (data ?? []).length;
      chequeos.push({
        id: "resultados_sueltos",
        area: "Resultados",
        titulo: "Resultados enlazados a su carrera",
        detalle: sueltos
          ? `${sueltos} filas de resultados_carreras no tienen carrera_id: ese resultado no se le muestra a nadie.`
          : "Todos los resultados apuntan a una carrera de la matriz.",
        estado: sueltos ? "aviso" : "ok",
        conteo: sueltos,
      });
    } catch {
      /* la lectura opcional no debe tumbar el diagnóstico */
    }
  }

  // --- 5. Cierres de caja: ¿está el SQL? -----------------------------------
  const hayCierres = await existeTabla("cierres_jornada");
  chequeos.push(
    hayCierres === true
      ? {
          id: "cierres",
          area: "Contabilidad",
          titulo: "Cierre de día / semana disponible",
          detalle: "La tabla cierres_jornada está aplicada.",
          estado: "ok",
        }
      : {
          id: "cierres",
          area: "Contabilidad",
          titulo: "Cierre de día / semana NO disponible",
          detalle:
            typeof hayCierres === "string"
              ? hayCierres
              : "Falta aplicar sql/cierres_jornada.sql (runbook paso 20).",
          estado: "aviso",
        }
  );

  // --- 5b. Semana vigente: ¿está la columna? ---------------------------------
  // Es un AVISO y no un error: sin la columna la semana se sigue deduciendo del
  // calendario y todo funciona. Lo que falta es poder fijarla a mano.
  const haySemanaVigente = await existeColumna("grupos_venta", "semana_vigente_inicio");
  chequeos.push(
    haySemanaVigente === true
      ? {
          id: "semana-vigente",
          area: "Contabilidad",
          titulo: "Semana vigente disponible",
          detalle:
            "grupos_venta.semana_vigente_inicio está aplicada: se puede fijar qué semana se está consolidando.",
          estado: "ok",
        }
      : {
          id: "semana-vigente",
          area: "Contabilidad",
          titulo: "Semana vigente NO disponible (la semana se deduce del calendario)",
          detalle:
            typeof haySemanaVigente === "string"
              ? haySemanaVigente
              : "Falta aplicar sql/semana_vigente.sql (runbook paso 21). Mientras tanto la semana se deduce de la fecha de hoy.",
          estado: "aviso",
        }
  );

  // --- 6. Operación del día -------------------------------------------------
  const [grupos, tipos, clientes, tickets] = await Promise.all([
    contar("grupos_venta", (q) => q.eq("activo", true)),
    contar("tipos_jugadas", (q) => q.eq("activo", true)),
    contar("clientes", (q) => q.is("eliminado_en", null)),
    contar("tickets", (q) => q.in("estado", ["ABIERTO", "EN_PROCESO"])),
  ]);

  const delDia = matriz.filas.filter((f) => String(f.fecha) === hoy).length;
  chequeos.push({
    id: "operacion",
    area: "Operación",
    titulo: `Operación de hoy (${hoy})`,
    detalle: `${delDia} carreras en la matriz · ${grupos ?? "?"} grupos de venta · ${
      tipos ?? "?"
    } tipos de jugada · ${clientes ?? "?"} clientes · ${tickets ?? "?"} tickets sin resolver`,
    estado: delDia > 0 ? "ok" : "aviso",
    conteo: delDia,
  });

  return {
    generado: new Date().toISOString(),
    chequeos,
    faltantes,
    errores: chequeos.filter((c) => c.estado === "error").length,
    avisos: chequeos.filter((c) => c.estado === "aviso").length,
  };
}

// ---------------------------------------------------------------------------
// Reparación
// ---------------------------------------------------------------------------

export type ResultadoReparacion = {
  ok: boolean;
  creadas: number;
  hipodromosEnlazados: number;
  resultadosEnlazados: number;
  error?: string;
};

/**
 * Deja la matriz al día con lo que ya existe en Tablas Fijas. Tres pasos, cada
 * uno de los cuales sólo COMPLETA lo que falta:
 *
 *  1. Crea en `carreras` las carreras publicadas que no tienen fila.
 *  2. Enlaza `hipodromo_id` donde el hipódromo existe en el catálogo pero la
 *     carrera quedó sin el id (un update de UNA columna, no un upsert completo:
 *     un upsert aquí mandaría caballos/estado vacíos y pisaría al operador).
 *  3. Enlaza `resultados_carreras.carrera_id` de los resultados que quedaron
 *     sueltos.
 *
 * No toca estados, caballos, retiros, invalidados, premios ni los resultados ya
 * escritos. Es idempotente: correrla dos veces no cambia nada la segunda.
 */
export async function repararMatrizDesdeTablas(): Promise<ResultadoReparacion> {
  if (!supabase) return { ok: false, creadas: 0, hipodromosEnlazados: 0, resultadosEnlazados: 0, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("carreras:fn_registrar_carrera");
  } catch (e) {
    return { ok: false, creadas: 0, hipodromosEnlazados: 0, resultadosEnlazados: 0, error: (e as Error).message };
  }

  const salida: ResultadoReparacion = { ok: true, creadas: 0, hipodromosEnlazados: 0, resultadosEnlazados: 0 };

  // --- Catálogo de hipódromos (para el id) ----------------------------------
  const idsHipodromos = new Map<string, string | number>();
  try {
    const { data } = await supabase.from("hipodromos").select("id,nombre");
    for (const h of (data ?? []) as Array<{ id?: unknown; nombre?: unknown }>) {
      const k = String(h.nombre ?? "").trim().toUpperCase();
      if (k && h.id != null) idsHipodromos.set(k, h.id as string | number);
    }
  } catch {
    /* sin catálogo: se crean las carreras igual, solo sin hipodromo_id */
  }

  // --- 1. Carreras que faltan ----------------------------------------------
  const tablas = (await listarTablasPublicadas()).filter(
    (t) => fechaDeTabla(t) && t.hipodromo && Number(t.carrera)
  );
  if (tablas.length) {
    const matriz = await leerMatriz();
    const enMatriz = new Map(
      matriz.filas.map((f) => [clave(f.fecha, f.hipodromo, Number(f.carrera) || 0), f])
    );
    const entradas: EntradaCarrera[] = [];
    const vistas = new Set<string>();
    for (const t of tablas) {
      const k = clave(fechaDeTabla(t), String(t.hipodromo), Number(t.carrera) || 0);
      if (vistas.has(k)) continue;
      vistas.add(k);
      if (enMatriz.has(k)) continue;
      entradas.push({
        fecha: fechaDeTabla(t),
        hipodromo: String(t.hipodromo).trim().toUpperCase(),
        carrera: Number(t.carrera) || 0,
        estado: "Programada",
        caballos: [],
        origen: "reparacion",
      });
    }
    if (entradas.length) {
      const r = await escribirCarrerasMaestro(entradas);
      if (!r.ok) {
        salida.ok = false;
        salida.error = r.error ?? "No se pudieron crear las carreras.";
      } else {
        salida.creadas = r.guardadas ?? entradas.length;
      }
    }
  }

  // --- 2. hipodromo_id faltante --------------------------------------------
  if (idsHipodromos.size) {
    const matriz = await leerMatriz();
    for (const f of matriz.filas) {
      if (f.hipodromo_id != null) continue;
      const id = idsHipodromos.get(String(f.hipodromo ?? "").trim().toUpperCase());
      if (id == null) continue;
      const { error } = await supabase.from("carreras").update({ hipodromo_id: id }).eq("id", f.id);
      if (error) {
        salida.ok = false;
        salida.error = salida.error ?? error.message;
        break;
      }
      salida.hipodromosEnlazados++;
    }
  }

  // --- 3. resultados sueltos ----------------------------------------------
  const res = await supabase
    .from("resultados_carreras")
    .select("id,fecha,hipodromo,carrera")
    .is("carrera_id", null)
    .limit(LIMITE);
  const sueltos = (res.data ?? []) as Array<Record<string, unknown>>;
  if (sueltos.length) {
    const matriz = await leerMatriz();
    const porClave = new Map(
      matriz.filas.map((f) => [clave(f.fecha, f.hipodromo, Number(f.carrera) || 0), f.id])
    );
    for (const r of sueltos) {
      const id = porClave.get(
        clave(String(r.fecha ?? ""), String(r.hipodromo ?? ""), Number(r.carrera) || 0)
      );
      if (id == null) continue;
      const { error } = await supabase.from("resultados_carreras").update({ carrera_id: id }).eq("id", r.id);
      if (error) {
        salida.ok = false;
        salida.error = salida.error ?? error.message;
        break;
      }
      salida.resultadosEnlazados++;
    }
  }

  // La matriz pudo cambiar de forma: obligamos a los módulos a releerla.
  reintentarMaestro();
  return salida;
}
