// ============================================================================
// EDGE FUNCTION: crear-grupo
//
// Alta de una franquicia completa (NIVEL 1→3) en UNA operación:
//   1. El grupo de venta            → public.grupos_venta
//   2. La cuenta del admin del grupo → Supabase Auth + usuario_sistema (admin)
//   3. Las cuentas de los operadores → Supabase Auth + usuario_sistema (operador)
//
// ---------------------------------------------------------------------------
// POR QUÉ ES UNA EDGE FUNCTION (y no código del navegador)
// ---------------------------------------------------------------------------
// Crear cuentas en Supabase Auth exige la SERVICE ROLE KEY, que NO puede estar
// en el bundle: cualquiera la leería con devtools y tendría el sistema entero.
// Acá la llave vive solo en el servidor de la función.
//
// La autorización NO alcanza con estar autenticado: se revalida que quien llama
// sea el SUPER ADMINISTRADOR (usuario_sistema.es_principal = true). Un admin de
// grupo que lograra invocar la función recibe 403 y no puede fabricar bancas.
// Es defensa en profundidad: la puerta de la UI y el `exigirCapacidad` del
// cliente son comodidad; la frontera real está acá.
//
// ---------------------------------------------------------------------------
// INSTALAR
// ---------------------------------------------------------------------------
//   npx supabase login
//   npx supabase functions deploy crear-grupo
//
// La protección real es el chequeo de `es_principal` de adentro. La policy de
// invocación admite a cualquier autenticado; por eso el 403 es imprescindible.
//
// Ver también: supabase/seed_superadmin.sql (el candado de josorioc).
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY = 64 * 1024;
const DOMINIO_LOGIN = "sistemahipico.local";

type UsuarioEntrada = {
  usuario?: string;
  nombre?: string;
  tipo?: string;
  clave?: string;
  correo?: string;
};

type Cuerpo = {
  grupo?: {
    nombre?: string;
    moneda?: string | null;
    moneda_cuadre?: string | null;
    comision_default?: number | null;
    cupo_tabla?: number | null;
    responsable?: string | null;
    cuenta_bancaria?: string | null;
  };
  admin?: UsuarioEntrada;
  operadores?: UsuarioEntrada[];
};

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Misma normalización que claveDeUsuario del cliente: parte local, minúsculas. */
function claveDeUsuario(id: string | null | undefined): string {
  return String(id ?? "").trim().toLowerCase().split("@")[0];
}

function correoDeLogin(usuario: string, correo?: string): string {
  const limpio = String(correo ?? "").trim();
  return limpio || `${claveDeUsuario(usuario)}@${DOMINIO_LOGIN}`;
}

/** El usuario del JWT que viene en el header Authorization. */
async function usuarioDelToken(
  svc: ReturnType<typeof createClient>,
  req: Request
): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** ¿La sesión es del super administrador? (usuario_sistema.es_principal). */
async function esPrincipal(
  svc: ReturnType<typeof createClient>,
  user: { id: string; email: string }
): Promise<boolean> {
  const porAuth = await svc
    .from("usuario_sistema")
    .select("id, es_principal, activo")
    .eq("auth_id", user.id)
    .maybeSingle();
  if (porAuth.data?.es_principal === true && porAuth.data?.activo !== false) return true;

  const clave = claveDeUsuario(user.email);
  if (!clave) return false;
  const porId = await svc
    .from("usuario_sistema")
    .select("id, es_principal, activo")
    .eq("id", clave)
    .maybeSingle();
  return porId.data?.es_principal === true && porId.data?.activo !== false;
}

/** Busca un usuario de Auth por correo (para reutilizarlo si ya existía). */
async function authUserIdPorCorreo(
  svc: ReturnType<typeof createClient>,
  correo: string
): Promise<string | null> {
  const objetivo = correo.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const enc = data.users.find((u) => (u.email ?? "").toLowerCase() === objetivo);
    if (enc) return enc.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // --- 1. Autorización: solo el super administrador -------------------------
  const user = await usuarioDelToken(svc, req);
  if (!user) return json({ ok: false, error: "Sesión inválida o vencida." }, 401);
  if (!(await esPrincipal(svc, user))) {
    return json({ ok: false, error: "Solo el super administrador puede crear grupos." }, 403);
  }

  // --- 2. Cuerpo y validación ----------------------------------------------
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "La petición es demasiado grande." }, 413);

  let cuerpo: Cuerpo;
  try {
    cuerpo = JSON.parse(raw) as Cuerpo;
  } catch {
    return json({ ok: false, error: "Cuerpo inválido." }, 400);
  }

  const nombre = String(cuerpo.grupo?.nombre ?? "").trim().toUpperCase();
  if (!nombre) return json({ ok: false, error: "Indicá el nombre del grupo." }, 400);

  const usuarios: UsuarioEntrada[] = [cuerpo.admin, ...(cuerpo.operadores ?? [])].filter(
    (u): u is UsuarioEntrada => Boolean(u && u.usuario)
  );
  if (!usuarios.length || usuarios[0]?.tipo !== "admin") {
    return json({ ok: false, error: "El primer usuario debe ser el administrador (admin) del grupo." }, 400);
  }

  const vistos = new Set<string>();
  for (const u of usuarios) {
    const clave = claveDeUsuario(u.usuario);
    if (!clave) return json({ ok: false, error: "Cada usuario necesita su nombre de acceso." }, 400);
    if (vistos.has(clave)) return json({ ok: false, error: `El usuario "${u.usuario}" está repetido.` }, 400);
    vistos.add(clave);
    if (String(u.clave ?? "").length < 6) {
      return json({ ok: false, error: `La clave de "${u.usuario}" debe tener al menos 6 caracteres.` }, 400);
    }
    if (u.tipo !== "admin" && u.tipo !== "operador") {
      return json({ ok: false, error: `Tipo de usuario inválido para "${u.usuario}".` }, 400);
    }
  }

  // --- 3. Tipos de usuario --------------------------------------------------
  const { data: tipos, error: eTipos } = await svc.from("tipo_usuario").select("id, nombre");
  if (eTipos) return json({ ok: false, error: `No se pudieron leer los tipos: ${eTipos.message}` }, 500);
  const tipoId = (nombreTipo: string): number | null =>
    (tipos ?? []).find((t) => String(t.nombre).toLowerCase() === nombreTipo)?.id ?? null;
  const idAdmin = tipoId("admin");
  const idOperador = tipoId("operador");
  if (idAdmin == null || idOperador == null) {
    return json({ ok: false, error: "Faltan los tipos 'admin'/'operador'. Aplicá maestro_seed.sql." }, 500);
  }

  // --- 4. Grupo (idempotente por nombre) -----------------------------------
  const { data: grupo, error: eGrupo } = await svc
    .from("grupos_venta")
    .upsert(
      {
        nombre,
        moneda: cuerpo.grupo?.moneda ?? "USD",
        moneda_cuadre: cuerpo.grupo?.moneda_cuadre ?? "USD",
        es_principal: false,
        cupo_tabla: cuerpo.grupo?.cupo_tabla ?? 100,
        comision_default: cuerpo.grupo?.comision_default ?? 2.5,
        responsable: cuerpo.grupo?.responsable ?? null,
        cuenta_bancaria: cuerpo.grupo?.cuenta_bancaria ?? null,
        activo: true,
      },
      { onConflict: "nombre" }
    )
    .select("id")
    .single();
  if (eGrupo || !grupo) {
    return json({ ok: false, error: `No se pudo crear el grupo: ${eGrupo?.message ?? "sin datos"}` }, 500);
  }
  const grupoId = String(grupo.id);

  // --- 5. Cuentas de Auth + filas de usuario_sistema ------------------------
  const creados: Array<{ usuario: string; correo: string; tipo: string; clave: string }> = [];
  for (const u of usuarios) {
    const clave = claveDeUsuario(u.usuario);
    const correo = correoDeLogin(clave, u.correo);
    const tipo = u.tipo === "admin" ? "admin" : "operador";

    let authId: string | null = null;
    const creado = await svc.auth.admin.createUser({
      email: correo,
      password: String(u.clave),
      email_confirm: true,
    });
    if (creado.error) {
      // La cuenta pudo quedar de un intento previo: se reutiliza en vez de fallar.
      authId = await authUserIdPorCorreo(svc, correo);
      if (!authId) {
        return json(
          { ok: false, error: `No se pudo crear la cuenta de "${u.usuario}": ${creado.error.message}` },
          500
        );
      }
    } else {
      authId = creado.data.user?.id ?? null;
    }

    const { error: eUser } = await svc.from("usuario_sistema").upsert(
      {
        id: clave,
        nombre: u.nombre ?? clave,
        tipo_usuario_id: tipo === "admin" ? idAdmin : idOperador,
        activo: true,
        es_principal: false,
        grupo_id: grupoId,
        auth_id: authId,
      },
      { onConflict: "id" }
    );
    if (eUser) {
      return json(
        { ok: false, error: `Grupo creado, pero falló "${u.usuario}" en usuario_sistema: ${eUser.message}` },
        500
      );
    }

    creados.push({ usuario: clave, correo, tipo, clave: String(u.clave) });
  }

  return json({ ok: true, grupoId, grupoNombre: nombre, creados });
});
