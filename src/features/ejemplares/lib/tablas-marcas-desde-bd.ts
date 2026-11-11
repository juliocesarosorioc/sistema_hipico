import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import type { CarreraCentral } from "@/features/carreras/lib/central";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import type { GuardarConfigMarcas } from "@/features/marcas/lib/marcas";
import type { CarreraRegistro } from "@/features/gaceta/lib/ui";

export type JornadaRegistrada = {
  fecha: string;
  hipodromo: string;
  totalCarreras: number;
  totalEjemplares: number;
};

/**
 * Consulta en la base de datos todas las jornadas que tengan carreras guardadas
 * en la matriz maestra `carreras`.
 */
export async function listarJornadasEnBD(): Promise<JornadaRegistrada[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("carreras")
      .select("fecha, hipodromo, carrera, caballos")
      .order("fecha", { ascending: false })
      .limit(600);

    if (error || !data) return [];

    const agrupados = new Map<string, { fecha: string; hipodromo: string; carreras: Set<number>; ejemplares: number }>();

    for (const r of data as Array<{ fecha?: string; hipodromo?: string; carrera?: number; caballos?: unknown[] }>) {
      if (!r.fecha || !r.hipodromo) continue;
      const f = String(r.fecha).slice(0, 10);
      const h = String(r.hipodromo).trim().toUpperCase();
      const clave = `${f}|${h}`;
      const entry = agrupados.get(clave) || { fecha: f, hipodromo: h, carreras: new Set<number>(), ejemplares: 0 };
      if (r.carrera != null) entry.carreras.add(Number(r.carrera));
      if (Array.isArray(r.caballos)) entry.ejemplares += r.caballos.length;
      agrupados.set(clave, entry);
    }

    return Array.from(agrupados.values()).map((v) => ({
      fecha: v.fecha,
      hipodromo: v.hipodromo,
      totalCarreras: v.carreras.size,
      totalEjemplares: v.ejemplares,
    }));
  } catch (e) {
    console.warn("Aviso listando jornadas registradas en BD:", e);
    return [];
  }
}

/**
 * Convierte una lista de `CarreraCentral` a `TablaFijaRow` para su publicación en el módulo de Tablas.
 */
export function generarTablasDesdeCarrerasCentrales(
  carreras: CarreraCentral[],
  fechaIso: string
): TablaFijaRow[] {
  return carreras.map((c) => {
    const hipo = String(c.hipodromo ?? "").trim().toUpperCase();
    const numCarrera = Number(c.carrera) || 1;
    const f = String(c.fecha || fechaIso).slice(0, 10);
    const ejemplares = (c.caballos || []).map((e) => {
      let nac = e.nacionalidad ? String(e.nacionalidad).toUpperCase() : "";
      if (!nac) {
        const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(hipo);
        nac = esAmericano ? "US" : "VE";
      }
      return {
        numero: String(e.numero),
        nombre: String(e.nombre || "").trim().toUpperCase(),
        nacionalidad: nac,
        valor_ejemplar: 0,
        retirado: Boolean(e.retirado),
        ganador: false,
        ejemplar_id: null,
        invalidado: false,
      };
    });

    return {
      id: `gaceta-${hipo}-${numCarrera}-${f}`,
      hipodromo: hipo,
      hipodromo_id: null,
      carrera: numCarrera,
      fecha: f,
      fecha_creacion: new Date().toISOString(),
      estado: "Abierta",
      premio_original: Number(c.premio) || 100,
      premio_recalculado: Number(c.premio) || 100,
      suma_base_tabla: 0,
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
  });
}

/**
 * Genera la configuración por defecto de Marcas para una carrera central.
 */
export function generarConfigMarcasPorDefecto(
  c: CarreraCentral,
  marcasPersonalizadas?: string,
  nvPersonalizado?: string,
  estadoPersonalizado?: string
): GuardarConfigMarcas {
  const hipo = String(c.hipodromo ?? "").trim().toUpperCase();
  const fecha = String(c.fecha || hoyLocal()).slice(0, 10);
  const carrera = Number(c.carrera) || 1;

  const caballosActivos = (c.caballos || []).filter((e) => !e.retirado);
  
  let marcasStr = marcasPersonalizadas?.trim();
  if (!marcasStr) {
    const cantCandidatos = Math.min(4, Math.max(2, Math.min(caballosActivos.length, 3)));
    const candidatos = caballosActivos.slice(0, cantCandidatos);
    marcasStr = candidatos.map((e) => e.numero).join("/");
    if (!marcasStr && caballosActivos.length > 0) {
      marcasStr = caballosActivos[0].numero;
    }
  }

  const retirados = (c.caballos || []).filter((e) => e.retirado).map((e) => e.numero);
  const nvStr = nvPersonalizado != null ? nvPersonalizado.trim() : retirados.join("/");

  return {
    hipodromo: hipo,
    fecha,
    carrera,
    marcas: marcasStr || "1/2/3",
    nv: nvStr,
    debutantes: "",
    debutantes_valen: true,
    estado: estadoPersonalizado || "Abierta",
  };
}

/**
 * Transforma una CarreraCentral en CarreraRegistro para el editor de Gaceta.
 */
export function carreraCentralACarreraRegistro(c: CarreraCentral): CarreraRegistro {
  return {
    carrera: c.carrera,
    hipodromo: c.hipodromo,
    fecha: c.fecha,
    distancia: c.distancia ? Number(c.distancia) || c.distancia : 0,
    superficie: c.superficie || "ARENA",
    premio: c.premio || 100,
    ejemplares: (c.caballos || []).map((cb) => ({
      numero: cb.numero,
      nombre: cb.nombre || `EJEMPLAR ${cb.numero}`,
      nacionalidad: cb.nacionalidad ?? "VE",
      jockey: cb.jockey ?? undefined,
      entrenador: cb.entrenador ?? undefined,
      peso: cb.peso ? Number(cb.peso) : undefined,
      medicamento: cb.medicamento ?? undefined,
      implementos: cb.implementos ?? undefined,
      ml: cb.ml ?? undefined,
      stud: cb.stud ?? undefined,
      pedigri: cb.pedigri ?? undefined,
      valor: 0,
      pts: 0,
    })),
    seleccionada: true,
    enviada: false,
    aplicada: false,
  };
}
