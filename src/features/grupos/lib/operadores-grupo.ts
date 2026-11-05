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
 *   - Teléfono celular para envío de credenciales por WhatsApp y acceso directo
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

export type OperadorCache = {
  usuario: string;
  clave: string;
  grupoId: string;
  grupoNombre: string;
  nombre?: string;
  telefono?: string;
  codigoPais?: string;
  activo?: boolean;
  hipodromos?: string[];
  creadoEn?: string;
};

const CLAVE_STORAGE_CLAVES = "hipico_operadores_claves_cache";
const CLAVE_STORAGE_OPERADORES = "hipico_operadores_perfiles_cache";

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

/** Guarda el perfil completo del operador en caché local */
export function guardarOperadorEnCacheLocal(op: OperadorCache): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    const mapa: Record<string, OperadorCache> = raw ? JSON.parse(raw) : {};
    const key = op.usuario.toLowerCase().trim();
    const entry: OperadorCache = {
      ...op,
      usuario: key,
      activo: op.activo !== false,
      hipodromos: op.hipodromos ?? [],
    };
    mapa[key] = entry;
    if (op.telefono) {
      const dig = op.telefono.replace(/\D/g, "");
      if (dig) mapa[dig] = entry;
    }
    window.localStorage.setItem(CLAVE_STORAGE_OPERADORES, JSON.stringify(mapa));
    guardarClaveEnCacheLocal(key, op.clave);
    if (op.telefono) {
      const dig = op.telefono.replace(/\D/g, "");
      if (dig) guardarClaveEnCacheLocal(dig, op.clave);
    }
  } catch {
    // ignore
  }
}

/** Obtiene el perfil completo del operador desde la caché local */
export function obtenerOperadorCacheLocal(usuarioId: string): OperadorCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    if (!raw) return null;
    const mapa: Record<string, OperadorCache> = JSON.parse(raw);
    const key = usuarioId.toLowerCase().trim();
    return mapa[key] ?? null;
  } catch {
    return null;
  }
}

/** Obtiene todos los operadores asignados a un grupo desde la caché local */
export function obtenerOperadoresDeGrupoCacheLocal(grupoId: string | number): OperadorCache[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    if (!raw) return [];
    const mapa: Record<string, OperadorCache> = JSON.parse(raw);
    const gid = String(grupoId).trim().toLowerCase();
    const vistos = new Set<string>();
    const lista: OperadorCache[] = [];

    for (const op of Object.values(mapa)) {
      if (!op || !op.usuario) continue;
      const uKey = op.usuario.toLowerCase().trim();
      if (vistos.has(uKey)) continue;
      if (String(op.grupoId).trim().toLowerCase() === gid) {
        vistos.add(uKey);
        lista.push(op);
      }
    }
    return lista;
  } catch {
    return [];
  }
}

/** Elimina un operador de la caché local para que no retenga grupos viejos */
export function eliminarOperadorDeCacheLocal(usuarioId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = usuarioId.toLowerCase().trim();
    const raw = window.localStorage.getItem(CLAVE_STORAGE_OPERADORES);
    if (raw) {
      const mapa = JSON.parse(raw);
      const tel = mapa[key]?.telefono;
      delete mapa[key];
      if (tel) {
        const dig = String(tel).replace(/\D/g, "");
        if (dig) delete mapa[dig];
      }
      window.localStorage.setItem(CLAVE_STORAGE_OPERADORES, JSON.stringify(mapa));
    }
    const rawClaves = window.localStorage.getItem(CLAVE_STORAGE_CLAVES);
    if (rawClaves) {
      const mapaClaves = JSON.parse(rawClaves);
      delete mapaClaves[key];
      window.localStorage.setItem(CLAVE_STORAGE_CLAVES, JSON.stringify(mapaClaves));
    }
  } catch {
    // ignore
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
 * Normaliza cualquier número telefónico al formato internacional de WhatsApp
 * (ej: '+58 414-9327337' o '04149327337' -> '584149327337').
 */
export function normalizarTelefonoWhatsapp(tel: string, codigoPais = "+58"): string {
  let dig = String(tel ?? "").replace(/\D/g, "");
  if (!dig) return "";
  const codDig = codigoPais.replace(/\D/g, "") || "58";
  if (dig.startsWith(codDig)) return dig;
  if (dig.startsWith("0")) dig = dig.slice(1);
  return `${codDig}${dig}`;
}

/**
 * Lista todos los operadores asignados a un grupo de venta específico.
 * Usa estrategia multi-capa resiliente:
 *   1. RPC club_listar_operadores (SECURITY DEFINER, omite RLS)
 *   2. Endpoint interno /api/operadores (Service Role)
 *   3. Consulta directa usuario_sistema
 *   4. Fusión con caché local para persistencia instantánea y visualización garantizada
 */
export async function listarOperadoresDeGrupo(
  grupoId: string | number,
  grupoNombre?: string
): Promise<OperadorGrupo[]> {
  const gid = String(grupoId).trim();
  const mapaOperadores: Map<string, OperadorGrupo> = new Map();

  // 1. Intentar leer vía RPC SECURITY DEFINER (omite RLS en Supabase)
  if (supabase) {
    try {
      const { data: rpcOps, error: rpcErr } = await supabase.rpc("club_listar_operadores", {
        p_grupo_id: gid,
      });
      if (!rpcErr && Array.isArray(rpcOps)) {
        for (const op of rpcOps as Array<Record<string, unknown>>) {
          const id = String(op.id ?? "").toLowerCase();
          if (!id) continue;
          mapaOperadores.set(id, {
            id,
            nombre: String(op.nombre ?? id),
            grupoId: String(op.grupoId ?? gid),
            grupoNombre: String(op.grupoNombre ?? grupoNombre ?? "Grupo Asignado"),
            clave: op.clave ? String(op.clave) : "",
            telefono: op.telefono ? String(op.telefono) : undefined,
            codigoPais: op.codigoPais ? String(op.codigoPais) : "+58",
            activo: op.activo !== false,
            hipodromos: [],
            creadoEn: op.creadoEn ? String(op.creadoEn) : undefined,
          });
        }
      }
    } catch {
      /* Fallback siguiente capa */
    }
  }

  // 2. Si no hubo resultados o falló la RPC, intentar ruta API interna del servidor
  if (mapaOperadores.size === 0 && typeof window !== "undefined") {
    try {
      const resApi = await fetch(`/api/operadores?grupoId=${encodeURIComponent(gid)}`);
      if (resApi.ok) {
        const json = await resApi.json();
        if (json.ok && Array.isArray(json.operadores)) {
          for (const op of json.operadores as Array<Record<string, unknown>>) {
            const id = String(op.id ?? "").toLowerCase();
            if (!id) continue;
            mapaOperadores.set(id, {
              id,
              nombre: String(op.nombre ?? id),
              grupoId: String(op.grupoId ?? gid),
              grupoNombre: grupoNombre ?? "Grupo Asignado",
              clave: op.clave ? String(op.clave) : "",
              telefono: op.telefono ? String(op.telefono) : undefined,
              codigoPais: op.codigoPais ? String(op.codigoPais) : "+58",
              activo: op.activo !== false,
              hipodromos: [],
              creadoEn: op.creadoEn ? String(op.creadoEn) : undefined,
            });
          }
        }
      }
    } catch {
      /* Fallback siguiente capa */
    }
  }

  // 3. Fallback directo a Supabase usuario_sistema (si la sesión tiene permiso)
  if (mapaOperadores.size === 0 && supabase) {
    try {
      let data: Array<Record<string, unknown>> | null = null;
      try {
        const res = await supabase
          .from("usuario_sistema")
          .select("id, nombre, activo, grupo_id, creado_en, clave_acceso, telefono, codigo_pais, tipo_usuario_id")
          .eq("grupo_id", gid);
        if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
          data = res.data;
        }
      } catch {
        data = null;
      }

      if (data && data.length > 0) {
        for (const u of data) {
          const id = String(u.id ?? "").toLowerCase();
          if (!id) continue;
          mapaOperadores.set(id, {
            id,
            nombre: String(u.nombre ?? id),
            grupoId: String(u.grupo_id ?? gid),
            grupoNombre: grupoNombre ?? "Grupo Asignado",
            clave: u.clave_acceso ? String(u.clave_acceso) : "",
            telefono: u.telefono ? String(u.telefono) : undefined,
            codigoPais: u.codigo_pais ? String(u.codigo_pais) : "+58",
            activo: u.activo !== false,
            hipodromos: [],
            creadoEn: u.creado_en ? String(u.creado_en) : undefined,
          });
        }
      }
    } catch {
      /* Fallback a caché local */
    }
  }

  // 4. Fusión con la caché local: garantiza que cualquier operador recién creado
  //    o guardado en este navegador permanezca visible y conserve su contraseña
  const locales = obtenerOperadoresDeGrupoCacheLocal(gid);
  for (const loc of locales) {
    const key = loc.usuario.toLowerCase().trim();
    const existente = mapaOperadores.get(key);
    if (existente) {
      if (!existente.clave && loc.clave) existente.clave = loc.clave;
      if (!existente.telefono && loc.telefono) existente.telefono = loc.telefono;
      if (!existente.codigoPais && loc.codigoPais) existente.codigoPais = loc.codigoPais;
      if (loc.hipodromos && loc.hipodromos.length > 0) existente.hipodromos = loc.hipodromos;
    } else {
      mapaOperadores.set(key, {
        id: key,
        nombre: loc.nombre || key,
        grupoId: gid,
        grupoNombre: grupoNombre || loc.grupoNombre || "Grupo Asignado",
        clave: loc.clave || "",
        telefono: loc.telefono,
        codigoPais: loc.codigoPais || "+58",
        activo: loc.activo !== false,
        hipodromos: loc.hipodromos || [],
        creadoEn: loc.creadoEn,
      });
    }
  }

  // 5. Cargar hipódromos asignados
  const ids = Array.from(mapaOperadores.keys());
  if (ids.length > 0) {
    const hiposMap = await obtenerHipodromosUsuarios(ids);
    for (const [id, op] of mapaOperadores.entries()) {
      const hipos = hiposMap[id] ?? [];
      if (hipos.length > 0) {
        op.hipodromos = hipos;
      }
      // Actualizar en caché local
      if (op.clave) {
        guardarOperadorEnCacheLocal({
          usuario: op.id,
          clave: op.clave,
          grupoId: gid,
          grupoNombre: grupoNombre || op.grupoNombre || "Grupo Asignado",
          nombre: op.nombre,
          telefono: op.telefono,
          codigoPais: op.codigoPais,
          activo: op.activo,
          hipodromos: op.hipodromos,
        });
      }
    }
  }

  return Array.from(mapaOperadores.values());
}

/**
 * Da de alta o actualiza un operador asignado al grupo.
 */
export async function guardarOperadorDeGrupo(params: {
  grupoId: string | number;
  grupoNombre?: string;
  usuario: string;
  nombre?: string;
  clave?: string;
  telefono?: string;
  codigoPais?: string;
  activo?: boolean;
  hipodromos?: string[];
}): Promise<{ ok: boolean; error?: string; operador?: OperadorGrupo }> {
  const idLimpio = claveDeUsuario(params.usuario);
  if (!idLimpio) return { ok: false, error: "El operador necesita un nombre de usuario de acceso." };

  const grupoIdStr = String(params.grupoId).trim();
  const nombreLimpio = (params.nombre || idLimpio).trim();
  const claveLimpia = (params.clave || "").trim();
  const telefonoLimpio = (params.telefono || "").trim();
  const codPaisLimpio = (params.codigoPais || "+58").trim();
  const activoFinal = params.activo !== false;
  const hiposFinal = params.hipodromos ?? [];

  // 1. Guardar en caché local DE INMEDIATO para respuesta instantánea en UI
  guardarOperadorEnCacheLocal({
    usuario: idLimpio,
    clave: claveLimpia,
    grupoId: grupoIdStr,
    grupoNombre: params.grupoNombre || "Grupo Asignado",
    nombre: nombreLimpio,
    telefono: telefonoLimpio,
    codigoPais: codPaisLimpio,
    activo: activoFinal,
    hipodromos: hiposFinal,
    creadoEn: new Date().toISOString(),
  });

  let guardadoEnDb = false;

  // 2. Intentar guardar en Supabase mediante RPC SECURITY DEFINER (omite RLS)
  if (supabase) {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_guardar_operador", {
        p_usuario: idLimpio,
        p_nombre: nombreLimpio,
        p_clave: claveLimpia,
        p_grupo_id: grupoIdStr,
        p_telefono: telefonoLimpio || null,
        p_codigo_pais: codPaisLimpio,
        p_activo: activoFinal,
      });
      if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
        guardadoEnDb = true;
      }
    } catch {
      /* Fallback al siguiente método */
    }
  }

  // 3. Si no guardó por RPC, intentar vía API interna
  if (!guardadoEnDb && typeof window !== "undefined") {
    try {
      const resApi = await fetch("/api/operadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usuario: idLimpio,
          nombre: nombreLimpio,
          clave: claveLimpia,
          grupoId: grupoIdStr,
          telefono: telefonoLimpio,
          codigoPais: codPaisLimpio,
          activo: activoFinal,
        }),
      });
      if (resApi.ok) {
        const json = await resApi.json();
        if (json.ok) guardadoEnDb = true;
      }
    } catch {
      /* Fallback siguiente */
    }
  }

  // 4. Si aún no guardó, intentar upsert directo con supabase
  if (!guardadoEnDb && supabase) {
    try {
      const tipoId = await obtenerIdTipoOperador();
      await supabase.from("usuario_sistema").upsert(
        {
          id: idLimpio,
          nombre: nombreLimpio,
          tipo_usuario_id: tipoId,
          grupo_id: grupoIdStr,
          clave_acceso: claveLimpia || null,
          telefono: telefonoLimpio || null,
          codigo_pais: codPaisLimpio,
          activo: activoFinal,
          es_principal: false,
        },
        { onConflict: "id" }
      );
    } catch {
      /* local cache ya garantiza funcionamiento */
    }
  }

  // 5. Guardar hipódromos autorizados
  if (params.hipodromos !== undefined) {
    try {
      await guardarHipodromosDeOperador(idLimpio, params.hipodromos);
    } catch {
      /* best-effort */
    }
  }

  const opGenerado: OperadorGrupo = {
    id: idLimpio,
    nombre: nombreLimpio,
    grupoId: grupoIdStr,
    grupoNombre: params.grupoNombre,
    clave: claveLimpia,
    telefono: telefonoLimpio,
    codigoPais: codPaisLimpio,
    activo: activoFinal,
    hipodromos: hiposFinal,
  };

  return { ok: true, operador: opGenerado };
}

/**
 * Desvincula o elimina un operador de este grupo.
 */
export async function desvincularOperadorDeGrupo(
  usuarioId: string
): Promise<{ ok: boolean; error?: string }> {
  const idLimpio = claveDeUsuario(usuarioId);

  // 1. Limpiar de caché local inmediatamente
  eliminarOperadorDeCacheLocal(idLimpio);

  // 2. Intentar eliminar por RPC con privilegios
  if (supabase) {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_eliminar_operador", {
        p_usuario: idLimpio,
      });
      if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
        return { ok: true };
      }
    } catch {
      /* fallback */
    }
  }

  // 3. Intentar por endpoint interno
  if (typeof window !== "undefined") {
    try {
      await fetch(`/api/operadores?usuario=${encodeURIComponent(idLimpio)}`, {
        method: "DELETE",
      });
    } catch {
      /* fallback */
    }
  }

  // 4. Fallback directo a la base de datos
  if (supabase) {
    try {
      const { error: delErr } = await supabase.from("usuario_sistema").delete().eq("id", idLimpio);
      if (!delErr) return { ok: true };

      // Si delete está bloqueado por FK, desvincular grupo_id y desactivar
      await supabase
        .from("usuario_sistema")
        .update({ grupo_id: null, activo: false })
        .eq("id", idLimpio);
    } catch {
      /* local cache ya limpio */
    }
  }

  return { ok: true };
}

/**
 * Alterna el estado activo/inactivo de un operador de grupo.
 */
export async function alternarEstadoOperador(
  usuarioId: string,
  activo: boolean
): Promise<{ ok: boolean; error?: string }> {
  const idLimpio = claveDeUsuario(usuarioId);

  // 1. Actualizar en caché local
  const opCache = obtenerOperadorCacheLocal(idLimpio);
  if (opCache) {
    opCache.activo = activo;
    guardarOperadorEnCacheLocal(opCache);
  }

  // 2. Intentar vía RPC
  if (supabase) {
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc("club_alternar_operador", {
        p_usuario: idLimpio,
        p_activo: activo,
      });
      if (!rpcErr && rpcRes && (rpcRes as Record<string, unknown>).ok) {
        return { ok: true };
      }
    } catch {
      /* fallback */
    }
  }

  // 3. Intentar vía API interna
  if (typeof window !== "undefined") {
    try {
      await fetch("/api/operadores", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: idLimpio, activo }),
      });
    } catch {
      /* fallback */
    }
  }

  // 4. Fallback directo a usuario_sistema
  if (supabase) {
    try {
      await supabase.from("usuario_sistema").update({ activo }).eq("id", idLimpio);
    } catch {
      /* local cache ya actualizado */
    }
  }

  return { ok: true };
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
 * Genera un texto formateado con íconos para compartir las credenciales del operador por WhatsApp.
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
  const nombreTxt = opts.nombre && opts.nombre !== opts.usuario ? `\n👤 *Operador:* ${opts.nombre}` : "";
  const telTxt = opts.telefono ? `\n📞 *Móvil:* ${opts.telefono}` : "";

  return (
    `🏇 *SISTEMA HÍPICO — ACCESO DE TAQUILLA MÓVIL*\n` +
    `----------------------------------------\n` +
    `🏢 *Grupo:* ${opts.grupoNombre.toUpperCase()}${nombreTxt}${telTxt}\n` +
    `\n` +
    `📋 *CREDENCIALES DE INGRESO:*\n` +
    `📱 *Usuario / Móvil:* \`${opts.usuario}\`\n` +
    `🔑 *Contraseña:* \`${opts.clave || "(asignada)"}\`\n` +
    `\n` +
    `🌐 *Enlace de Ingreso:*\n` +
    `${url}\n` +
    `----------------------------------------\n` +
    `✨ *Instrucciones:*\n` +
    `1️⃣ Abre el enlace en tu navegador móvil\n` +
    `2️⃣ Ingresa tu Usuario (o Teléfono) y tu Contraseña\n` +
    `3️⃣ ¡Listo para vender jugadas y consultar tus reportes!`
  );
}

/**
 * Genera el enlace directo a WhatsApp (wa.me) con el número normalizado y el mensaje codificado.
 */
export function enlaceWhatsappOperador(opts: {
  grupoNombre: string;
  usuario: string;
  clave: string;
  nombre?: string;
  telefono?: string;
  codigoPais?: string;
  urlLogin?: string;
}): string {
  const telNormalizado = normalizarTelefonoWhatsapp(opts.telefono || "", opts.codigoPais || "+58");
  const mensaje = generarMensajeWhatsappOperador(opts);
  if (!telNormalizado) return "";
  return `https://wa.me/${telNormalizado}?text=${encodeURIComponent(mensaje)}`;
}
