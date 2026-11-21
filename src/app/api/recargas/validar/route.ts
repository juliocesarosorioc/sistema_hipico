import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/features/seguridad/lib/require-session";
import { validarSolicitudRecargaServidor } from "@/features/sala-juegos/lib/recargas-server";
import type { IdentidadSala } from "@/features/sala-juegos/lib/sala-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResultadoRecarga = Awaited<ReturnType<typeof validarSolicitudRecargaServidor>>;

const RECARGAS_EN_VUELO = new Map<string, Promise<ResultadoRecarga>>();

function claveIdempotencia(valores: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(valores)).digest("hex");
}

function respuestaResultado(resultado: ResultadoRecarga) {
  if (!resultado.ok) {
    return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json(
    {
      ok: true,
      conciliacion: resultado.conciliacion,
      resultado: resultado.resultado,
    },
    { status: 200 }
  );
}

/** POST /api/recargas/validar: exige hipico_session firmada y deduplica concurrentes. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }

  const autorizacion = await requireSession(req, ["cliente", "superadmin", "admin_grupo"]);
  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: autorizacion.error },
      { status: autorizacion.status }
    );
  }
  const sesion = autorizacion.sesion;

  const esCliente =
    sesion.rol === "cliente" && sesion.perfil === "cliente" && Boolean(sesion.clienteId);
  const esStaff = sesion.rol === "superadmin" || sesion.rol === "admin_grupo";

  const body = await req.json().catch(() => ({} as Record<string, any>));
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  const clienteIdSolicitado = String(body.clienteId ?? body.cliente_id ?? "").trim();
  const clienteId = esCliente ? sesion.clienteId! : clienteIdSolicitado;
  if (!clienteId) {
    return NextResponse.json({ ok: false, error: "clienteId es requerido." }, { status: 400 });
  }
  if (esCliente && clienteIdSolicitado && clienteIdSolicitado !== clienteId) {
    return NextResponse.json(
      { ok: false, error: "403 Forbidden: solo puede recargar su propia cuenta." },
      { status: 403 }
    );
  }

  const hashImagenSha256 = String(body.hashImagenSha256 ?? body.hash_imagen_sha256 ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(hashImagenSha256)) {
    return NextResponse.json(
      { ok: false, error: "La huella hashImagenSha256 debe ser un valor hexadecimal SHA-256 válido de 64 caracteres." },
      { status: 400 }
    );
  }

  const referencia = String(body.referencia ?? "").trim();
  if (!/^\d{4,20}$/.test(referencia)) {
    return NextResponse.json(
      { ok: false, error: "La referencia debe contener entre 4 y 20 dígitos numéricos." },
      { status: 400 }
    );
  }

  const montoReportado = Number(body.montoReportado ?? body.monto_reportado ?? body.monto);
  if (!Number.isFinite(montoReportado) || montoReportado <= 0) {
    return NextResponse.json(
      { ok: false, error: "El montoReportado debe ser un número positivo mayor a 0." },
      { status: 400 }
    );
  }

  const identidad: IdentidadSala = esCliente
    ? {
        tipo: "JUGADOR",
        usuarioId: clienteId,
        nombre: sesion.usuario,
        grupoId: sesion.grupoId,
        esAdmin: false,
        esOperador: false,
        permisos: sesion.permisos,
      }
    : {
        tipo: "STAFF",
        usuarioId: sesion.sub || sesion.usuario,
        nombre: sesion.usuario,
        grupoId: sesion.grupoId,
        esAdmin: sesion.rol === "superadmin",
        esOperador: true,
        permisos: sesion.permisos,
      };

  const entrada = {
    grupoId: body.grupoId ?? body.grupo_id ?? sesion.grupoId,
    clienteId,
    metodoPago: body.metodoPago ?? body.metodo_pago,
    bancoOrigen: body.bancoOrigen ?? body.banco_origen,
    referencia,
    montoReportado,
    moneda: body.moneda,
    nombreArchivo: body.nombreArchivo ?? body.nombre_archivo,
    comprobanteUrl: body.comprobanteUrl ?? body.comprobante_url,
    hashImagenSha256,
  };

  const clave = claveIdempotencia([
    sesion.sub || sesion.usuario,
    sesion.rol,
    identidad.grupoId ?? entrada.grupoId ?? "",
    clienteId,
    referencia,
    hashImagenSha256.toLowerCase(),
    montoReportado.toFixed(2),
  ]);

  const enVuelo = RECARGAS_EN_VUELO.get(clave);
  const promesa =
    enVuelo ??
    validarSolicitudRecargaServidor(identidad, entrada).finally(() => {
      RECARGAS_EN_VUELO.delete(clave);
    });
  if (!enVuelo) RECARGAS_EN_VUELO.set(clave, promesa);

  return respuestaResultado(await promesa);
}
