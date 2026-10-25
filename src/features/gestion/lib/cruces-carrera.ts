import { supabase } from "@/core/supabase";
import type { ModalidadesCruce } from "@/features/motores/lib/puestos";
import { listarClientesVenta, listarGruposVenta } from "@/features/grupos/lib/grupos";
import { grupoActivoVigente } from "@/features/seguridad/lib/vigente";
import type { OpcionesCrucesPuestos } from "@/features/motores/lib/puestos";

export type CrucesCarreraOverride = {
  todos?: Partial<ModalidadesCruce>;
  porJugador?: Record<string, Partial<ModalidadesCruce>>;
};

export async function cargarOpcionesCrucesPuestos(opts: {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
}): Promise<{ ok: boolean; opciones: OpcionesCrucesPuestos; error?: string }> {
  const [grupos, clientes] = await Promise.all([listarGruposVenta(), listarClientesVenta()]);
  const grupoActivo = grupoActivoVigente();
  const grupo = grupos.find((g) => grupoActivo && String(g.id) === String(grupoActivo))
    ?? grupos.find((g) => clientes.some((c) => c.grupos.some((id) => String(id) === String(g.id))));
  if (!grupo) {
    return { ok: true, opciones: { grupo: { mismoEjemplar: false, diferenteEjemplar: false } } };
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
    mismoEjemplar: grupo.cruce_mismo_ejemplar ?? grupoAnterior ?? false,
    diferenteEjemplar: grupo.cruce_diferente_ejemplar ?? grupoAnterior ?? false,
  };
  const porJugadorPermanente: NonNullable<OpcionesCrucesPuestos["porJugadorPermanente"]> = {};
  for (const cliente of clientes) {
    const reglas: Partial<ModalidadesCruce> = {};
    const mismo = cliente.cruce_mismo_ejemplar !== undefined ? cliente.cruce_mismo_ejemplar : cliente.permite_cruces;
    const diferente = cliente.cruce_diferente_ejemplar !== undefined ? cliente.cruce_diferente_ejemplar : cliente.permite_cruces;
    if (typeof mismo === "boolean") reglas.mismoEjemplar = mismo;
    if (typeof diferente === "boolean") reglas.diferenteEjemplar = diferente;
    if (Object.keys(reglas).length > 0) {
      porJugadorPermanente[claveJugador(cliente.nombre)] = reglas;
      porJugadorPermanente[String(cliente.id).trim().toUpperCase()] = reglas;
    }
  }
  const carreraPorJugadorOverride = { ...leido.override.porJugador };
  for (const cliente of clientes) {
    const regla = leido.override.porJugador?.[claveJugador(cliente.nombre)];
    if (regla) carreraPorJugadorOverride[String(cliente.id).trim().toUpperCase()] = regla;
  }
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

function claveJugador(nombre: string): string {
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
