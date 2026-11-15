import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/core/supabase-admin";
import { autenticarPeticionSala, type IdentidadSala } from "@/features/sala-juegos/lib/sala-auth";
import { validarSolicitudRecargaServidor } from "@/features/sala-juegos/lib/recargas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

/**
 * POST /api/recargas/validar
 *
 * Cierre de VULN-12:
 * 1. Exige Authorization: Bearer <access_token> o header interno x-internal-bot-secret.
 * 2. Si viene de la web, verifica con supabaseAdmin.auth.getUser(token) y comprueba
 *    que clienteId tenga auth_user_id === user.id (de lo contrario HTTP 403 Forbidden).
 * 3. Valida hashImagenSha256 con /^[a-f0-9]{64}$/i y referencia de 4 a 20 dígitos numéricos.
 */
export async function POST(req: Request) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }
  const secretHeader = req.headers.get("x-internal-bot-secret");
  const esBot = secretHeader === INTERNAL_BOT_SECRET;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");

  if (!esBot && (!authHeader || !authHeader.startsWith("Bearer "))) {
    return NextResponse.json(
      { ok: false, error: "401 Unauthorized: Header Authorization Bearer o x-internal-bot-secret requerido." },
      { status: 401 }
    );
  }

  let user: any = null;
  if (!esBot) {
    const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      return NextResponse.json(
        { ok: false, error: "401 Unauthorized: Token de sesión inválido o expirado." },
        { status: 401 }
      );
    }
    user = userData.user;
  }

  const body = await req.json().catch(() => ({} as Record<string, any>));
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  // 1. Validar cliente y autorización (VULN-12)
  const clienteId = String(body.clienteId ?? body.cliente_id ?? "").trim();
  if (!clienteId) {
    return NextResponse.json({ ok: false, error: "clienteId es requerido." }, { status: 400 });
  }

  let clienteRow: any = null;
  if (!esBot) {
    const { data: cl, error: clErr } = await supabaseAdmin
      .from("clientes")
      .select("id, auth_user_id, grupo_id, nombre, saldo_actual, saldo_retenido, saldo_disponible, libre, activo")
      .eq("id", clienteId)
      .maybeSingle();

    if (clErr || !cl) {
      return NextResponse.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });
    }
    clienteRow = cl;

    const coincideAuth = cl.auth_user_id === user.id;
    if (!coincideAuth) {
      // Verificar si es staff/admin del sistema en usuario_sistema
      const { data: staffRow } = await supabaseAdmin
        .from("usuario_sistema")
        .select("id, activo, es_principal")
        .eq("id", user.id)
        .maybeSingle();

      if (!staffRow || staffRow.activo === false) {
        return NextResponse.json(
          { ok: false, error: "403 Forbidden: No tiene autorización sobre la cuenta de este cliente." },
          { status: 403 }
        );
      }
    }
  }

  // 2. Validación estricta de Hash SHA-256 (64 hex)
  const hashImagenSha256 = String(body.hashImagenSha256 ?? body.hash_imagen_sha256 ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(hashImagenSha256)) {
    return NextResponse.json(
      { ok: false, error: "La huella hashImagenSha256 debe ser un valor hexadecimal SHA-256 válido de 64 caracteres." },
      { status: 400 }
    );
  }

  // 3. Validación estricta de Referencia (4 a 20 dígitos numéricos)
  const referencia = String(body.referencia ?? "").trim();
  if (!/^\d{4,20}$/.test(referencia)) {
    return NextResponse.json(
      { ok: false, error: "La referencia debe contener entre 4 y 20 dígitos numéricos." },
      { status: 400 }
    );
  }

  // 4. Validación de Monto
  const montoReportado = Number(body.montoReportado ?? body.monto_reportado ?? body.monto);
  if (!Number.isFinite(montoReportado) || montoReportado <= 0) {
    return NextResponse.json(
      { ok: false, error: "El montoReportado debe ser un número positivo mayor a 0." },
      { status: 400 }
    );
  }

  // Resolver identidad para el motor de conciliación bancaria
  let identidad: IdentidadSala;
  if (esBot) {
    identidad = {
      tipo: "STAFF",
      usuarioId: "bot-whatsapp",
      nombre: "Bot WhatsApp",
      grupoId: body.grupoId ?? body.grupo_id ?? null,
      esAdmin: true,
      esOperador: true,
      permisos: ["recargar", "aprobar"],
    };
  } else {
    identidad = {
      tipo: "JUGADOR",
      usuarioId: clienteRow?.id || user.id,
      nombre: clienteRow?.nombre || "Jugador",
      grupoId: clienteRow?.grupo_id || body.grupoId || null,
      esAdmin: false,
      esOperador: false,
      permisos: ["recargar"],
      clienteRow,
    };
  }

  const resultado = await validarSolicitudRecargaServidor(identidad, {
    grupoId: body.grupoId ?? body.grupo_id ?? clienteRow?.grupo_id,
    clienteId,
    metodoPago: body.metodoPago ?? body.metodo_pago,
    bancoOrigen: body.bancoOrigen ?? body.banco_origen,
    referencia,
    montoReportado,
    moneda: body.moneda,
    nombreArchivo: body.nombreArchivo ?? body.nombre_archivo,
    comprobanteUrl: body.comprobanteUrl ?? body.comprobante_url,
    hashImagenSha256,
  });

  if (!resultado.ok) {
    return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
  }

  return NextResponse.json({
    ok: true,
    conciliacion: resultado.conciliacion,
    resultado: resultado.resultado,
  });
}
