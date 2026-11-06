import { supabase } from "@/core/supabase";
import {
  asociarReglasCrucesPuestosPorJugador,
  type ModalidadesCruce,
} from "@/features/motores/lib/puestos";
import { listarGruposVenta } from "@/features/grupos/lib/grupos";
import { grupoActivoVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import type { OpcionesCrucesPuestos } from "@/features/motores/lib/puestos";

export type CrucesCarreraOverride = {
  todos?: Partial<ModalidadesCruce>;
  porJugador?: Record<string, Partial<ModalidadesCruce>>;
};

export async function cargarOpcionesCrucesPuestos(opts: {
  grupoId?: string | number | null;
  fecha: string;
  hipodromo: string;
  carrera: number | string;
}): Promise<{ ok: boolean; opciones: OpcionesCrucesPuestos; error?: string }> {
  const grupoId = String(opts.grupoId ?? grupoActivoVigente() ?? grupoVigente() ?? "").trim();
  if (!grupoId) {
    return {
      ok: false,
      opciones: {},
      error: "No se puede determinar el grupo contable de la carrera; seleccione un grupo antes de liquidar.",
    };
  }
  let grupos: Awaited<ReturnType<typeof listarGruposVenta>>;
  let clientes: Awaited<ReturnType<typeof clientesDeGrupo>>;
  try {
    [grupos, clientes] = await Promise.all([
      listarGruposVenta(),
      clientesDeGrupo(grupoId),
    ]);
  } catch (e) {
    return { ok: false, opciones: {}, error: (e as Error).message };
  }
  const grupo = grupos.find((g) => String(g.id) === grupoId);
  if (!grupo) {
    return {
      ok: false,
      opciones: {},
      error: `No se encontró el grupo ${grupoId}; no se aplicarán reglas de cruce por defecto.`,
    };
  }
  const leido = await leerCrucesCarrera({
    grupoId: grupo.id,
    fecha: opts.fecha,
    hipodromo: opts.hipodromo,
    carrera: Number(opts.carrera),
  });
  if (!leido.ok) return { ok: false, opciones: {}, error: leido.error };

  const grupoAnterior = grupo.permite_cruces;
  const reglasGrupo: ModalidadesCruce = {
    mismoEjemplar: grupo.cruce_mismo_ejemplar ?? grupoAnterior ?? true,
    diferenteEjemplar: grupo.cruce_diferente_ejemplar ?? grupoAnterior ?? true,
  };
  const reglasPorNombre: NonNullable<OpcionesCrucesPuestos["porJugadorPermanente"]> = {};
  for (const cliente of clientes) {
    const reglas: Partial<ModalidadesCruce> = {};
    const mismo = cliente.cruce_mismo_ejemplar ?? cliente.permite_cruces;
    const diferente = cliente.cruce_diferente_ejemplar ?? cliente.permite_cruces;
    if (typeof mismo === "boolean") reglas.mismoEjemplar = mismo;
    if (typeof diferente === "boolean") reglas.diferenteEjemplar = diferente;
    if (Object.keys(reglas).length > 0) {
      for (const nombre of [cliente.nombre, cliente.nombre_real, cliente.seudonimo]) {
        const clave = claveJugador(nombre);
        if (clave) reglasPorNombre[clave] = reglas;
      }
    }
  }
  const jugadores = clientes.map((cliente) => ({
    id: cliente.id,
    nombre: cliente.nombre,
    aliases: [cliente.nombre_real, cliente.seudonimo],
  }));
  const porJugadorPermanente = asociarReglasCrucesPuestosPorJugador(reglasPorNombre, jugadores);
  const carreraPorJugadorOverride = asociarReglasCrucesPuestosPorJugador(
    leido.override.porJugador,
    jugadores
  );
  return {
    ok: true,
    opciones: {
      grupo: reglasGrupo,
      porJugadorPermanente,
      carreraTodosOverride: leido.override.todos,
      carreraPorJugadorOverride,
    },
  };
}

async function clientesDeGrupo(grupoId: string): Promise<Array<{
  id: string;
  nombre: string;
  nombre_real: string;
  seudonimo: string | null;
  permite_cruces: boolean | null;
  cruce_mismo_ejemplar: boolean | null;
  cruce_diferente_ejemplar: boolean | null;
}>> {
  if (!supabase) throw new Error("Sin conexión a Supabase.");
  const [clientesResult, miembrosResult] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nombre, seudonimo, grupo_id, permite_cruces, cruce_mismo_ejemplar, cruce_diferente_ejemplar")
      .eq("grupo_id", grupoId),
    supabase.from("clientes_grupos").select("cliente_id").eq("grupo_id", grupoId),
  ]);
  if (clientesResult.error) throw new Error(`Clientes del grupo: ${clientesResult.error.message}`);
  if (miembrosResult.error) throw new Error(`Membresías del grupo: ${miembrosResult.error.message}`);
  const clientes = (clientesResult.data ?? []) as Array<Record<string, unknown>>;
  const idsCargados = new Set(clientes.map((cliente) => String(cliente.id)));
  const idsMembresia = [...new Set(
    (miembrosResult.data ?? [])
      .map((m) => String(m.cliente_id))
      .filter((id) => id && !idsCargados.has(id))
  )];
  if (idsMembresia.length) {
    const adicionales = await supabase
      .from("clientes")
      .select("id, nombre, seudonimo, grupo_id, permite_cruces, cruce_mismo_ejemplar, cruce_diferente_ejemplar")
      .in("id", idsMembresia);
    if (adicionales.error) throw new Error(`Clientes asociados al grupo: ${adicionales.error.message}`);
    clientes.push(...((adicionales.data ?? []) as Array<Record<string, unknown>>));
  }
  return clientes.map((cliente) => ({
      id: String(cliente.id),
      nombre: String(cliente.seudonimo || cliente.nombre || ""),
      nombre_real: String(cliente.nombre ?? ""),
      seudonimo: cliente.seudonimo ? String(cliente.seudonimo) : null,
      permite_cruces: typeof cliente.permite_cruces === "boolean" ? cliente.permite_cruces : null,
      cruce_mismo_ejemplar: typeof cliente.cruce_mismo_ejemplar === "boolean" ? cliente.cruce_mismo_ejemplar : null,
      cruce_diferente_ejemplar: typeof cliente.cruce_diferente_ejemplar === "boolean" ? cliente.cruce_diferente_ejemplar : null,
    }));
}

export async function cargarOpcionesCrucesPuestosPorGrupos(opts: {
  grupoIds: Array<string | number>;
  fecha: string;
  hipodromo: string;
  carrera: number | string;
}): Promise<{ ok: boolean; opciones: OpcionesCrucesPuestos; error?: string }> {
  const ids = [...new Set(opts.grupoIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) {
    const r = await cargarOpcionesCrucesPuestos(opts);
    return r;
  }
  const resultados = await Promise.all(
    ids.map(async (grupoId) => ({
      grupoId,
      resultado: await cargarOpcionesCrucesPuestos({ ...opts, grupoId }),
    }))
  );
  const fallido = resultados.find(({ resultado }) => !resultado.ok);
  if (fallido) {
    return {
      ok: false,
      opciones: {},
      error: `Grupo ${fallido.grupoId}: ${fallido.resultado.error ?? "no se pudieron cargar las reglas de cruce."}`,
    };
  }
  const porGrupo = Object.fromEntries(
    resultados.map(({ grupoId, resultado }) => [grupoId, resultado.opciones])
  );
  return { ok: true, opciones: { porGrupo } };
}

function claveJugador(nombre: unknown): string {
  return String(nombre ?? "").trim().toUpperCase();
}

export async function leerCrucesCarrera(opts: {
  grupoId: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
}): Promise<{ ok: boolean; override: CrucesCarreraOverride; error?: string }> {
  if (!supabase) return { ok: false, override: {}, error: "Sin conexión a Supabase." };
  const { data, error } = await supabase
    .from("cruces_carrera_config")
    .select("cruces_carrera_override")
    .eq("grupo_id", String(opts.grupoId))
    .eq("fecha", opts.fecha)
    .eq("hipodromo", opts.hipodromo.trim().toUpperCase())
    .eq("carrera", opts.carrera)
    .maybeSingle();
  if (error) return { ok: false, override: {}, error: error.message };
  const valor = data?.cruces_carrera_override;
  return {
    ok: true,
    override: valor && typeof valor === "object" && !Array.isArray(valor)
      ? valor as CrucesCarreraOverride
      : {},
  };
}

export async function guardarCrucesCarrera(opts: {
  grupoId: string | number;
  fecha: string;
  hipodromo: string;
  carrera: number;
  override: CrucesCarreraOverride;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  const override: CrucesCarreraOverride = {
    todos: opts.override.todos ?? {},
    porJugador: Object.fromEntries(
      Object.entries(opts.override.porJugador ?? {})
        .map(([nombre, reglas]) => [claveJugador(nombre), reglas])
        .filter(([nombre]) => Boolean(nombre))
    ),
  };
  const { error } = await supabase.from("cruces_carrera_config").upsert(
    {
      grupo_id: String(opts.grupoId),
      fecha: opts.fecha,
      hipodromo: opts.hipodromo.trim().toUpperCase(),
      carrera: opts.carrera,
      cruces_carrera_override: override,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "grupo_id,fecha,hipodromo,carrera" }
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}