import { NextResponse } from "next/server";
import { autenticarPeticionSala } from "@/features/sala-juegos/lib/sala-auth";
import { validarSolicitudRecargaServidor } from "@/features/sala-juegos/lib/recargas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/recargas/validar
 *
 * Endpoint seguro de auto-recarga. La identidad se toma del token de portal o
 * de la sesión de staff; el OCR, la confianza IA y la conciliación con la
 * bóveda bancaria se calculan en el servidor con service role. El body del
 * navegador NO puede inyectar `p_confianza_ia` ni `p_datos_ocr_ia`.
 */
export async function POST(req: Request) {
  const auth = await autenticarPeticionSala(req);
  if (!auth.ok || !auth.identidad) {
    return NextResponse.json(
      { ok: false, error: auth.error || "No autorizado." },
      { status: auth.status || 401 }
    );
  }

  const body = await req.json().catch(() => ({} as Record<string, any>));
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  const resultado = await validarSolicitudRecargaServidor(auth.identidad, {
    grupoId: body.grupoId ?? body.grupo_id,
    clienteId: body.clienteId ?? body.cliente_id,
    metodoPago: body.metodoPago ?? body.metodo_pago,
    bancoOrigen: body.bancoOrigen ?? body.banco_origen,
    referencia: body.referencia,
    montoReportado: body.montoReportado ?? body.monto_reportado ?? body.monto,
    moneda: body.moneda,
    nombreArchivo: body.nombreArchivo ?? body.nombre_archivo,
    comprobanteUrl: body.comprobanteUrl ?? body.comprobante_url,
    hashImagenSha256: body.hashImagenSha256 ?? body.hash_imagen_sha256,
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
