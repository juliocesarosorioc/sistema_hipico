// ============================================================================
// EDGE FUNCTION: normalizar-jugadas
//
// Capa 2 (OPCIONAL) de la Carga Rápida: manda el bloque de texto dictado a un
// modelo de lenguaje y devuelve las MISMAS líneas reescritas en la notación que
// ya entiende el normalizador difuso local (Capa 1). No estructura por sí sola:
// solo CORRIGE el texto —números hablados, nombres mal transcriptos, orden— y el
// resto del pipeline (preview + poblar) sigue igual.
//
// Si no hay IA configurada, la función responde `{ ok: false, error }` y la UI
// se queda con el normalizador local. Nunca es un requisito para vender.
//
// ---------------------------------------------------------------------------
// INSTALAR (opcional)
// ---------------------------------------------------------------------------
//   npx supabase secrets set IA_API_KEY="..." \
//                         IA_MODELO="gpt-4o-mini" \
//                         IA_BASE_URL="https://api.openai.com/v1"   # opcional
//   npx supabase functions deploy normalizar-jugadas
//
// La autorización la hace ESTA función con `auth.getUser` + la RPC
// `tiene_capacidad('gestion_jugadas:fn_corregir_ia')`, igual que las funciones
// de WhatsApp. El modelo no ve datos de la base: solo el bloque pegado, la lista
// de nombres de clientes y el padrón de la carrera.
// ============================================================================

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY = 256 * 1024;
const MAX_LINEAS = 200;
const MAX_CLIENTES = 400;
const MAX_CABALLOS = 60;

function json(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(d), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const texto = (v: unknown, max = 400): string => String(v ?? "").trim().slice(0, max);

/** ¿Quién llama es staff con la capacidad de la Capa 2 (o el principal)? */
async function esStaff(
  db: SupabaseClient,
  req: Request
): Promise<{ ok: boolean; error?: string }> {
  const h = req.headers.get("authorization") ?? "";
  const jwt = h.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.split(".").length !== 3) return { ok: false, error: "Sin sesión válida." };
  try {
    const { data, error } = await db.auth.getUser(jwt);
    const user = data?.user;
    if (error || !user) return { ok: false, error: "Sesión no válida." };
    const { data: puede, error: eRbac } = await db.rpc("tiene_capacidad", {
      u: user.id,
      clave: "gestion_jugadas:fn_corregir_ia",
    });
    if (eRbac || puede !== true) return { ok: false, error: "No tenés permiso para usar la IA." };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo validar la sesión." };
  }
}

const BASE_URL = (Deno.env.get("IA_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const MODELO = Deno.env.get("IA_MODELO") ?? "gpt-4o-mini";

/**
 * Reescribe las líneas usando el modelo. Devuelve SIEMPRE una lista alineada con
 * la entrada (misma cantidad); si el modelo devuelve algo raro, se cae al texto
 * original de esa línea en vez de romper el bloque.
 */
async function corregirConIA(
  apiKey: string,
  lineas: string[],
  clientes: string[],
  caballos: Array<{ numero: string; nombre: string }>
): Promise<{ lineas: string[] } | { error: string }> {
  const system = [
    "Sos un transcriptor de jugadas hípicas. Recibís líneas dictadas por voz con errores.",
    "Devolvés, para CADA línea, la misma jugada reescrita en notación canónica y en el MISMO orden:",
    "  <MONTO> <JUGADA> <N° CABALLO> <CLIENTE 1> [da <CLIENTE 2>]",
    "Reglas:",
    "- JUGADA: pp, 2p, 3p, 3y3, 2y3, 10/8, 2x3, etc. (según lo que se jugó).",
    "- MONTO: solo dígitos, sin puntos de miles ni símbolos. 'cien'→100, 'cincuenta y cinco'→55.",
    "- CABALLO: el número de programa (una o dos cifras). Si dan el nombre del ejemplar, poné su número.",
    "- CLIENTE 1 es quien JUEGA; CLIENTE 2 (tras 'da') es quien DA. Usá SOLO nombres de la lista de clientes.",
    "- No inventes datos: lo que no puedas resolver, dejalo tal como vino en esa parte.",
    "- Respondé ÚNICAMENTE con un objeto JSON: {\"lineas\":[\"...\",\"...\"]} con exactamente la misma cantidad de líneas que la entrada, sin comentarios.",
  ].join("\n");

  const user = JSON.stringify({
    lineas,
    clientes,
    caballos,
  });

  let resp: Response;
  try {
    resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    return { error: "No se pudo contactar el modelo de IA." };
  }

  if (!resp.ok) {
    const detalle = await resp.text().catch(() => "");
    return { error: `La IA respondió ${resp.status}. ${texto(detalle, 200)}`.trim() };
  }

  try {
    const datos = await resp.json();
    const contenido = datos?.choices?.[0]?.message?.content;
    const parsed = typeof contenido === "string" ? JSON.parse(contenido) : contenido;
    const salida = Array.isArray(parsed?.lineas) ? parsed.lineas : null;
    if (!salida) return { error: "La IA no devolvió una lista de líneas." };
    // Alinear a la entrada: ni más ni menos. Lo que falte se queda como vino.
    return {
      lineas: lineas.map((orig, i) => {
        const corregida = texto(salida[i], 400);
        return corregida || orig;
      }),
    };
  } catch {
    return { error: "No se pudo interpretar la respuesta de la IA." };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_BODY) return json({ ok: false, error: "Solicitud demasiado grande." }, 413);

  let e: Record<string, unknown>;
  try {
    e = JSON.parse(cuerpo);
  } catch {
    return json({ ok: false, error: "Datos inválidos." }, 400);
  }

  const apiKey = Deno.env.get("IA_API_KEY") ?? Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    // Sin IA configurada la UI NO falla: se queda con el normalizador local.
    return json({ ok: false, error: "La IA no está configurada. Se usó el normalizador local." });
  }

  const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const staff = await esStaff(db, req);
  if (!staff.ok) return json({ ok: false, error: staff.error ?? "Sin permiso." }, 403);

  const lineas = (Array.isArray(e.lineas) ? e.lineas : [])
    .map((l) => texto(l, 400))
    .filter(Boolean)
    .slice(0, MAX_LINEAS);
  if (lineas.length === 0) return json({ ok: false, error: "No hay líneas para corregir." }, 400);

  const clientes = (Array.isArray(e.clientes) ? e.clientes : [])
    .map((c) => texto(c, 120))
    .filter(Boolean)
    .slice(0, MAX_CLIENTES);
  const caballos = (Array.isArray(e.caballos) ? e.caballos : [])
    .map((c) => {
      const f = c as Record<string, unknown>;
      return { numero: texto(f?.numero, 6), nombre: texto(f?.nombre, 120) };
    })
    .filter((c) => c.numero || c.nombre)
    .slice(0, MAX_CABALLOS);

  const res = await corregirConIA(apiKey, lineas, clientes, caballos);
  if ("error" in res) return json({ ok: false, error: res.error }, 502);
  return json({ ok: true, lineas: res.lineas });
});
