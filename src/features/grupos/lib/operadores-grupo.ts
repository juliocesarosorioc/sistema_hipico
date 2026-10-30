/**
 * ============================================================================
 * OPERADORES DE GRUPO — Acceso celular y gestión por grupo de venta
 * ============================================================================
 *
 * Permite a los administradores asignar uno o varios operadores a cada grupo
 * dentro del modal de grupos, con:
 *   - Nombre de usuario para acceso desde el celular
 *   - Contraseña de acceso
 *   - Nombre / alias del operador
 *   - Hipódromos autorizados (atributo ABAC usuario_hipodromos)
 *   - Estado activo/inactivo
 */
import { supabase } from "@/core/supabase";
import { claveDeUsuario } from "@/features/seguridad/lib/accesos";
import { guardarHipodromosDeOperador, CLAVE_HIPODROMOS } from "@/features/operadores/lib/operadores";
import { basePathActual } from "@/features/auth/lib/sesion";

export type OperadorGrupo = {
  id: string; // nombre de usuario para acceso celular
  nombre: string;
  grupoId: string;
  grupoNombre?: string;
  clave?: string;
  telefono?: string;
  codigoPais?: string;
  activo: boolean;
  hipodromos: string[];
  creadoEn?: string;
};

const CLAVE_STORAGE_CLAVES = "hipico_operadores_claves_cache";

/** Almacena claves de operadores en cache local como respaldo seguro */
function guardarClaveEnCacheLocal(usuarioId: string, clave: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    const mapa = raw ? JSON.parse(raw) : {};
    mapa[usuarioId.toLowerCase()] = clave;
    window.localStorage.setItem(CLAVE_STORAGE_CLAVES, JSON.stringify(mapa));
  } catch {
    // ignore
  }
}

export function obtenerClaveCacheLocal(usuarioId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    if (!raw) return null;
    const mapa = JSON.parse(raw);
    return mapa[usuarioId.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

/** Obtiene el id numérico del tipo 'operador' en la tabla tipo_usuario */
async function obtenerIdTipoOperador(): Promise<number> {
  if (!supabase) return 2;
  try {
    const { data } = await supabase
      .from("tipo_usuario")
      .select("id")
      .ilike("nombre", "operador")
      .maybeSingle();
    return (data as { id?: number } | null)?.id ?? 2;
  } catch {
    return 2;
  }
}

/** Lista los hipódromos asignados a cada usuario */
async function obtenerHipodromosUsuarios(ids: string[]): Promise<Record<string, string[]>> {
  if (!supabase || ids.length === 0) return {};
  try {
    const { data: atrs } = await supabase
      .from("atributo")
      .select("id")
      .eq("clave", CLAVE_HIPODROMOS)
      .maybeSingle();
    const idAtr = (atrs as { id?: number } | null)?.id;
    if (!idAtr) return {};

    const { data, error } = await supabase
      .from("usuario_atributo")
      .select("usuario_id, valor")
      .eq("atributo_id", idAtr)
      .in("usuario_id", ids.map((i) => claveDeUsuario(i)));

    if (error || !Array.isArray(data)) return {};
    const mapa: Record<string, string[]> = {};
    for (const fila of data as Array<{ usuario_id?: string; valor?: unknown }>) {
      const uid = String(fila.usuario_id ?? "").toLowerCase();
      const val = fila.valor;
      if (Array.isArray(val)) {
        mapa[uid] = val.map((x) => String(x)).filter(Boolean);
      } else if (typeof val === "string") {
        mapa[uid] = val.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    return mapa;
  } catch {
    return {};
  }
}

/**
 * Lista todos los operadores asignados a un grupo de venta específico.
 */
export async function listarOperadoresDeGrupo(
  grupoId: string | number
): Promise<OperadorGrupo[]> {
  if (!supabase) return [];
  const gid = String(grupoId);

  try {
    // 1. Intentar leer incluyendo clave_acceso, telefono y codigo_pais
    let data: Array<Record<string, unknown>> | null = null;
    try {
      const res = await supabase
        .from("usuario_sistema")
        .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, telefono, codigo_pais, tipo_usuario_id, tipo_usuario(nombre)")
        .eq("grupo_id", gid);
      if (!res.error && Array.isArray(res.data)) {
        data = res.data;
      }
    } catch {
      data = null;
    }

    // 2. Si falló por columnas nuevas, reintentar con columnas base
    if (!data) {
      try {
        const resClave = await supabase
          .from("usuario_sistema")
          .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, tipo_usuario_id, tipo_usuario(nombre)")
          .eq("grupo_id", gid);
        if (!resClave.error && Array.isArray(resClave.data)) {
          data = resClave.data;
        }
      } catch {
        data = null;
      }
    }

    // 3. Fallback absoluto a columnas estándar
    if (!data) {
      const res2 = await supabase
        .from("usuario_sistema")
        .select("id, nombre, activo, grupo_id, creado_en, tipo_usuario_id, tipo_usuario(nombre)")
        .eq("grupo_id", gid);
      if (res2.error || !Array.isArray(res2.data)) {
        return [];
      }
      data = res2.data;
    }

    const ids = data.map((u) => String(u.id ?? ""));
    const hiposMap = await obtenerHipodromosUsuarios(ids);

    return data.map((u) => {
      const id = String(u.id ?? "");
      const claveRemota = u.clave_acceso ? String(u.clave_acceso) : null;
      const clave = claveRemota || obtenerClaveCacheLocal(id) || "";

      return {
        id,
        nombre: String(u.nombre ?? id),
        grupoId: String(u.grupo_id ?? gid),
        clave,
        telefono: u.telefono ? String(u.telefono) : undefined,
        codigoPais: u.codigo_pais ? String(u.codigo_pais) : undefined,
        activo: u.activo !== false,
        hipodromos: hiposMap[id.toLowerCase()] ?? [],
        creadoEn: u.creado_en ? String(u.creado_en) : undefined,
      };
    });
  } catch (e) {
    console.error("Error al listar operadores de grupo:", e);
    return [];
  }
}

/**
 * Da de alta o actualiza un operador asignado al grupo.
 */
export async function guardarOperadorDeGrupo(params: {
  grupoId: string | number;
  usuario: string;
  nombre?: string;
  clave?: string;
  telefono?: string;
  codigoPais?: string;
  activo?: boolean;
  hipodromos?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };

  const idLimpio = claveDeUsuario(params.usuario);
  if (!idLimpio) return { ok: false, error: "El operador necesita un nombre de usuario de acceso." };

  const grupoIdStr = String(params.grupoId);
  const tipoId = await obtenerIdTipoOperador();
  const nombreLimpio = (params.nombre || idLimpio).trim();
  const claveLimpia = (params.clave || "").trim();
  const telefonoLimpio = (params.telefono || "").trim();
  const codPaisLimpio = (params.codigoPais || "+58").trim();

  try {
    // 1. Guardar en usuario_sistema (intentar con clave_acceso, telefono, codigo_pais)
    let errUpsert: { message?: string } | null = null;
    try {
      const payloadCompleto: Record<string, unknown> = {
        id: idLimpio,
        nombre: nombreLimpio,
        tipo_usuario_id: tipoId,
        grupo_id: grupoIdStr,
        activo: params.activo !== false,
        es_principal: false,
      };
      if (claveLimpia) payloadCompleto.clave_acceso = claveLimpia;
      if (telefonoLimpio) payloadCompleto.telefono = telefonoLimpio;
      if (codPaisLimpio) payloadCompleto.codigo_pais = codPaisLimpio;

      const res = await supabase
        .from("usuario_sistema")
        .upsert(payloadCompleto, { onConflict: "id" });
      errUpsert = res.error;
    } catch (e) {
      errUpsert = { message: String(e) };
    }

    // 2. Si dio error por columnas inexistentes, reintentar quitando telefono y codigo_pais
    if (errUpsert && /telefono|codigo_pais|column|does not exist/i.test(errUpsert.message ?? "")) {
      try {
        const payloadConClave: Record<string, unknown> = {
          id: idLimpio,
          nombre: nombreLimpio,
          tipo_usuario_id: tipoId,
          grupo_id: grupoIdStr,
          activo: params.activo !== false,
          es_principal: false,
        };
        if (claveLimpia) payloadConClave.clave_acceso = claveLimpia;

        const resConClave = await supabase
          .from("usuario_sistema")
          .upsert(payloadConClave, { onConflict: "id" });
        errUpsert = resConClave.error;
      } catch (e) {
        errUpsert = { message: String(e) };
      }
    }

    // 3. Si aún da error por clave_acceso, reintentar solo columnas base
    if (errUpsert && /clave_acceso|column|does not exist/i.test(errUpsert.message ?? "")) {
      const resSinClave = await supabase
        .from("usuario_sistema")
        .upsert(
          {
            id: idLimpio,
            nombre: nombreLimpio,
            tipo_usuario_id: tipoId,
            grupo_id: grupoIdStr,
            activo: params.activo !== false,
            es_principal: false,
          },
          { onConflict: "id" }
        );
      errUpsert = resSinClave.error;
    }

    if (errUpsert) {
      return { ok: false, error: `No se pudo registrar el operador: ${errUpsert.message}` };
    }

    // 4. Guardar en cache local la contraseña para acceso y consulta inmediata (por id y por teléfono)
    if (claveLimpia) {
      guardarClaveEnCacheLocal(idLimpio, claveLimpia);
      if (telefonoLimpio) {
        const digitos = telefonoLimpio.replace(/\D/g, "");
        if (digitos) guardarClaveEnCacheLocal(digitos, claveLimpia);
      }
    }

    // 5. Guardar los hipódromos asignados si se especificaron
    if (params.hipodromos !== undefined) {
      await guardarHipodromosDeOperador(idLimpio, params.hipodromos);
    }

    // 6. Intentar crear o actualizar en Supabase Auth mediante la edge function si existe
    if (claveLimpia) {
      try {
        void supabase.functions.invoke("crear-grupo", {
          body: {
            admin: null,
            operadores: [
              {
                usuario: idLimpio,
                nombre: nombreLimpio,
                tipo: "operador",
                clave: claveLimpia,
              },
            ],
            grupo: { id: grupoIdStr },
          },
        });
      } catch {
        /* best-effort */
      }
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Desvincula o elimina un operador de este grupo.
 */
export async function desvincularOperadorDeGrupo(
  usuarioId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  const idLimpio = claveDeUsuario(usuarioId);

  try {
    // Al desvincularlo del grupo, se le quita el grupo_id y se desactiva
    const { error } = await supabase
      .from("usuario_sistema")
      .update({ grupo_id: null, activo: false })
      .eq("id", idLimpio);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Alterna el estado activo/inactivo de un operador de grupo.
 */
export async function alternarEstadoOperador(
  usuarioId: string,
  activo: boolean
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase." };
  const idLimpio = claveDeUsuario(usuarioId);

  try {
    const { error } = await supabase
      .from("usuario_sistema")
      .update({ activo })
      .eq("id", idLimpio);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Resuelve la URL canónica de login para compartir con el operador.
 */
export function urlLoginOperador(): string {
  if (typeof window === "undefined") return "https://app.sistemahipico.com/login/";
  const base = basePathActual();
  return `${window.location.origin}${base}/login/`;
}

/**
 * Genera un texto formateado para compartir las credenciales del operador por WhatsApp.
 */
export function generarMensajeWhatsappOperador(opts: {
  grupoNombre: string;
  usuario: string;
  clave: string;
  nombre?: string;
  telefono?: string;
  urlLogin?: string;
}): string {
  const url = opts.urlLogin || urlLoginOperador();
  const nombreTxt = opts.nombre ? `\n👤 *Operador:* ${opts.nombre}` : "";
  const telTxt = opts.telefono ? `\n📞 *Teléfono:* ${opts.telefono}` : "";

  return (
    `🏇 *ACCESO DE OPERADOR — TAQUILLA MÓVIL*\n` +
    `🏢 *Grupo:* ${opts.grupoNombre.toUpperCase()}${nombreTxt}${telTxt}\n` +
    `\n` +
    `📱 *Usuario / Teléfono:* \`${opts.usuario}\`\n` +
    `🔑 *Contraseña:* \`${opts.clave || "(asignada)"}\`\n` +
    `\n` +
    `🌐 *Enlace de Ingreso:* ${url}\n` +
    `\n` +
    `_Ingresa con tu usuario o celular y esta contraseña para registrar jugadas y consultar reportes._`
  );
}
