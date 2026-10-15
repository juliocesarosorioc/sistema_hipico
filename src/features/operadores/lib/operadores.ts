/**
 * ============================================================================
 * OPERADORES — personal del sistema y sus hipódromos
 * ============================================================================
 *
 * El legacy (`js/operadores.js`) era un CRUD sobre `public.operadores` con la
 * CONTRASEÑA EN CLARO. Esa tabla está RETIRADA (`src/core/db/retirar-legacy-operadores.sql`)
 * y no se vuelve a consumir: el alta y los permisos viven en Supabase Auth +
 * `usuario_sistema` + el maestro de seguridad (pestaña Usuarios de /seguridad).
 *
 * Lo que faltaba —y es lo que migra este módulo— es la RELACIÓN CON HIPÓDROMOS:
 * qué hipódromos opera cada usuario. Eso es el atributo ABAC
 * `usuario_hipodromos`, que las reglas de integridad leen para impedir que un
 * operador liquide o retiros una carrera de un hipódromo que no es suyo.
 *
 * La escritura va contra `public.usuario_atributo` y exige la MISMA capacidad
 * que las excepciones individuales (`seguridad:fn_personalizar_usuario`): es el
 * mismo tipo de dato, una personalización por persona.
 */
import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";
import { claveDeUsuario, leerUsuariosDelSistema, type UsuarioAlta } from "@/features/seguridad/lib/accesos";

export type Operador = UsuarioAlta & {
  /** Hipódromos asignados (atributo ABAC `usuario_hipodromos`). */
  hipodromos: string[];
};

export type ResOperadores = { ok: boolean; data: Operador[]; error?: string };
export type ResGuardar = { ok: boolean; error?: string };

/** Clave del atributo ABAC con la lista de hipódromos del usuario. */
export const CLAVE_HIPODROMOS = "usuario_hipodromos";

/** id del atributo `usuario_hipodromos` en el catálogo (`public.atributo`). */
async function idAtributoHipodromos(): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("atributo")
      .select("id")
      .eq("clave", CLAVE_HIPODROMOS)
      .maybeSingle();
    if (error) return null;
    return (data as { id?: number } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/** Mapa usuario_id → hipódromos, para todos los usuarios de una sola lectura. */
async function hipodromosPorUsuario(ids: string[]): Promise<Record<string, string[]>> {
  if (!supabase || ids.length === 0) return {};
  const idAtributo = await idAtributoHipodromos();
  if (idAtributo == null) return {};
  try {
    const { data, error } = await supabase
      .from("usuario_atributo")
      .select("usuario_id, valor")
      .eq("atributo_id", idAtributo)
      .in("usuario_id", ids.map((i) => claveDeUsuario(i)));
    if (error || !Array.isArray(data)) return {};
    const salida: Record<string, string[]> = {};
    for (const f of data as Array<{ usuario_id?: string; valor?: unknown }>) {
      const uid = String(f.usuario_id ?? "");
      salida[uid] = aLista(f.valor);
    }
    return salida;
  } catch {
    return {};
  }
}

/** El valor jsonb puede venir como array o como cadena "A, B" (legado). */
function aLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((v) => String(v)).filter(Boolean);
  if (typeof valor === "string") {
    const limpio = valor.trim();
    if (!limpio) return [];
    try {
      const parsed = JSON.parse(limpio);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
      /* no era JSON: se parte por comas */
    }
    return limpio.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** Usuarios del sistema con los hipódromos que tienen asignados. */
export async function listarOperadores(): Promise<ResOperadores> {
  const usuarios = await leerUsuariosDelSistema();
  const mapa = await hipodromosPorUsuario(usuarios.map((u) => u.id));
  return {
    ok: true,
    data: usuarios.map((u) => ({ ...u, hipodromos: mapa[claveDeUsuario(u.id)] ?? [] })),
  };
}

/**
 * Reemplaza la lista de hipódromos asignados a un usuario. Lista vacía = se
 * quita la asignación (el usuario no queda atado a ningún hipódromo).
 */
export async function guardarHipodromosDeOperador(usuarioId: string, hipodromos: string[]): Promise<ResGuardar> {
  try {
    exigirCapacidad("seguridad:fn_personalizar_usuario");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };

  const idAtributo = await idAtributoHipodromos();
  if (idAtributo == null) {
    return {
      ok: false,
      error: "Falta el atributo `usuario_hipodromos` en el maestro. Aplicá src/core/db/maestro_seed.sql.",
    };
  }

  const usuario = claveDeUsuario(usuarioId);
  const limpio = [...new Set(hipodromos.map((h) => String(h).trim()).filter(Boolean))];

  try {
    if (limpio.length === 0) {
      const { error } = await supabase
        .from("usuario_atributo")
        .delete()
        .eq("usuario_id", usuario)
        .eq("atributo_id", idAtributo);
      return error ? { ok: false, error: error.message } : { ok: true };
    }
    const { error } = await supabase
      .from("usuario_atributo")
      .upsert(
        { usuario_id: usuario, atributo_id: idAtributo, valor: limpio },
        { onConflict: "usuario_id,atributo_id" }
      );
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch {
    return { ok: false, error: "No se pudieron guardar los hipódromos del operador." };
  }
}
