import { supabaseAdmin } from "@/core/supabase-admin";
import path from "node:path";
import {
  grupoPermitido,
  resolverGrupoEfectivo,
  type IdentidadSala,
} from "./sala-auth";

/**
 * Validación y conciliación server-side de solicitudes de recarga.
 *
 * REGLA DE ORO: el navegador solo aporta datos bancarios declarados y la huella
 * SHA-256 del archivo. La confianza IA, el OCR y el resultado de la bóveda se
 * calculan SIEMPRE acá con `SUPABASE_SERVICE_ROLE_KEY`. Ningún campo
 * `p_confianza_ia` / `p_datos_ocr_ia` del body se reenvía a la RPC.
 */

export interface SolicitudRecargaEntrada {
  grupoId?: string | null;
  clienteId?: string | null;
  metodoPago?: string | null;
  bancoOrigen?: string | null;
  referencia?: string | null;
  montoReportado?: number | string | null;
  moneda?: string | null;
  nombreArchivo?: string | null;
  comprobanteUrl?: string | null;
  hashImagenSha256?: string | null;
}

export type ResultadoValidacionRecarga =
  | { ok: true; resultado: Record<string, any>; conciliacion: "exacta" | "pendiente" }
  | { ok: false; status: number; error: string };

const METODOS_PAGO = new Set(["PAGO_MOVIL", "ZELLE", "TRANSFERENCIA", "BINANCE"]);
const MONEDAS = new Set(["USD", "VES", "EUR", "USDT"]);
const HASH_SHA256 = /^[a-f0-9]{64}$/i;
const REFERENCIA_VALIDA = /^[A-Za-z0-9._/-]{4,64}$/;
const MAX_MONTO = 1_000_000;
const TOLERANCIA_MONTO = 0.02;

function limpiarTexto(valor: unknown, max: number): string {
  return String(valor ?? "").trim().slice(0, max);
}

function sanearNombreArchivo(valor: unknown): string {
  const crudo = String(valor ?? "").trim();
  if (!crudo) return "comprobante.jpg";
  // `basename` en ambos separadores: impide rutas tipo ../../.env
  const base = path.basename(crudo.replace(/\\/g, "/")).replace(/[^A-Za-z0-9._ -]/g, "_");
  const seguro = base.replace(/^\.+/, "").slice(0, 160);
  return seguro || "comprobante.jpg";
}

function normalizarMetodo(valor: unknown): string {
  const m = String(valor ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (m === "PAGOMOVIL" || m === "PAGO_MOVIL") return "PAGO_MOVIL";
  if (m === "ZELLE") return "ZELLE";
  if (m === "TRANSFERENCIA" || m === "TRANSFERENCIA_BANCARIA") return "TRANSFERENCIA";
  if (m === "BINANCE" || m === "BINANCE_PAY" || m === "USDT") return "BINANCE";
  return m;
}

function redondear(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Verifica que un cliente pertenezca al grupo indicado. Para jugadores el
 * cliente se fuerza desde la identidad; para staff se exige que el cliente
 * exista, esté activo y pertenezca al mismo grupo.
 */
async function resolverClienteDeRecarga(
  identidad: IdentidadSala,
  grupoId: string,
  clienteIdSolicitado?: string | null
): Promise<{ ok: true; clienteId: string; clienteNombre: string } | { ok: false; status: number; error: string }> {
  const clienteId =
    identidad.tipo === "JUGADOR"
      ? identidad.usuarioId
      : limpiarTexto(clienteIdSolicitado, 64);

  if (!clienteId) {
    return { ok: false, status: 400, error: "clienteId es obligatorio para recargar a nombre de un cliente." };
  }

  if (identidad.tipo === "JUGADOR" && clienteId !== identidad.usuarioId) {
    return { ok: false, status: 403, error: "Un jugador solo puede recargar su propia cuenta." };
  }

  const { data: cliente, error } = await supabaseAdmin
    .from("clientes")
    .select("id, nombre, seudonimo, grupo_id, activo, saldo_actual, saldo_disponible")
    .eq("id", clienteId)
    .maybeSingle();

  if (error || !cliente) {
    return { ok: false, status: 404, error: "Cliente no encontrado." };
  }

  const cl = cliente as Record<string, any>;
  if (cl.activo === false) {
    return { ok: false, status: 403, error: "El cliente está inactivo." };
  }
  const grupoCliente = String(cl.grupo_id ?? cl.grupo_cobro_id ?? "");
  if (grupoCliente !== grupoId) {
    return { ok: false, status: 403, error: "El cliente no pertenece al grupo de la sala." };
  }

  return {
    ok: true,
    clienteId,
    clienteNombre: String(cl.seudonimo || cl.nombre || identidad.nombre || "Cliente"),
  };
}

interface NotificacionBoveda {
  id: string;
  metodo_pago?: string | null;
  banco_receptor?: string | null;
  referencia_completa?: string | null;
  referencia_ultimos_6?: string | null;
  monto_exacto?: number | string | null;
  moneda?: string | null;
}

/**
 * Busca una notificación bancaria real no consumida. Si coincide en grupo,
 * método, referencia y monto, la solicitud puede auto-aprobarse. Si no, queda
 * pendiente de revisión humana: nunca se inventa una confianza alta.
 */
async function conciliarConBoveda(args: {
  grupoId: string;
  metodoPago: string;
  bancoOrigen: string;
  referencia: string;
  monto: number;
  moneda: string;
}): Promise<{ notificacion: NotificacionBoveda | null; confianza: number; datosOcr: Record<string, any> }> {
  const ref6 = args.referencia.slice(-6);
  let notificacion: NotificacionBoveda | null = null;

  try {
    const { data } = await supabaseAdmin
      .from("boveda_notificaciones_bancarias")
      .select("id, metodo_pago, banco_receptor, referencia_completa, referencia_ultimos_6, monto_exacto, moneda")
      .eq("grupo_id", args.grupoId)
      .eq("consumida", false)
      .eq("referencia_ultimos_6", ref6)
      .order("fecha_notificacion", { ascending: false })
      .limit(8);

    const candidatas = (data || []) as NotificacionBoveda[];
    notificacion =
      candidatas.find((n) => {
        const metodoOk = normalizarMetodo(n.metodo_pago) === args.metodoPago;
        const bancoOk =
          !args.bancoOrigen ||
          !n.banco_receptor ||
          String(n.banco_receptor).toUpperCase().includes(args.bancoOrigen.toUpperCase()) ||
          args.bancoOrigen.toUpperCase().includes(String(n.banco_receptor).toUpperCase());
        const refOk =
          !n.referencia_completa ||
          String(n.referencia_completa).replace(/[^A-Za-z0-9]/g, "").toUpperCase().endsWith(
            args.referencia.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
          ) ||
          String(n.referencia_completa).replace(/[^A-Za-z0-9]/g, "").toUpperCase() ===
            args.referencia.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const montoOk = Math.abs(Number(n.monto_exacto ?? 0) - args.monto) <= TOLERANCIA_MONTO;
        const monedaOk = !n.moneda || String(n.moneda).toUpperCase() === args.moneda;
        return metodoOk && bancoOk && refOk && montoOk && monedaOk;
      }) || null;
  } catch {
    notificacion = null;
  }

  if (notificacion) {
    return {
      notificacion,
      confianza: 0.99,
      datosOcr: {
        fuente: "boveda_bancaria",
        verificado: true,
        conciliacion: "exacta",
        bancoDetectado: notificacion.banco_receptor || args.bancoOrigen,
        referenciaDetectada: notificacion.referencia_completa || args.referencia,
        montoDetectado: Number(notificacion.monto_exacto ?? args.monto),
        monedaDetectada: notificacion.moneda || args.moneda,
        formatoValido: true,
        notificacionId: notificacion.id,
      },
    };
  }

  return {
    notificacion: null,
    // 0 = sin evidencia bancaria. La RPC NO debe auto-aprobar con este valor.
    confianza: 0,
    datosOcr: {
      fuente: "validacion_servidor",
      verificado: false,
      conciliacion: "pendiente",
      bancoDetectado: args.bancoOrigen,
      referenciaDetectada: args.referencia,
      montoDetectado: args.monto,
      monedaDetectada: args.moneda,
      formatoValido: true,
    },
  };
}

export async function validarSolicitudRecargaServidor(
  identidad: IdentidadSala,
  entrada: SolicitudRecargaEntrada
): Promise<ResultadoValidacionRecarga> {
  const grupoId = resolverGrupoEfectivo(identidad, entrada.grupoId);
  if (!grupoId || !grupoPermitido(identidad, grupoId)) {
    return { ok: false, status: 403, error: "Grupo no autorizado para recargar." };
  }

  const cliente = await resolverClienteDeRecarga(identidad, grupoId, entrada.clienteId);
  if (!cliente.ok) return cliente;

  const metodoPago = normalizarMetodo(entrada.metodoPago);
  if (!METODOS_PAGO.has(metodoPago)) {
    return { ok: false, status: 400, error: "Método de pago no permitido." };
  }

  const bancoOrigen = limpiarTexto(entrada.bancoOrigen, 80).toUpperCase();
  if (bancoOrigen.length < 2) {
    return { ok: false, status: 400, error: "Banco de origen inválido." };
  }

  const referencia = limpiarTexto(entrada.referencia, 64).replace(/\s+/g, "");
  if (!REFERENCIA_VALIDA.test(referencia)) {
    return { ok: false, status: 400, error: "Referencia bancaria inválida (4 a 64 caracteres alfanuméricos)." };
  }

  const monto = Number(entrada.montoReportado);
  if (!Number.isFinite(monto) || monto <= 0 || monto > MAX_MONTO) {
    return { ok: false, status: 400, error: "Monto reportado inválido." };
  }

  const moneda = limpiarTexto(entrada.moneda || "USD", 8).toUpperCase();
  if (!MONEDAS.has(moneda)) {
    return { ok: false, status: 400, error: "Moneda no permitida." };
  }

  const hashImagenSha256 = limpiarTexto(entrada.hashImagenSha256, 64).toLowerCase();
  if (!HASH_SHA256.test(hashImagenSha256)) {
    return { ok: false, status: 400, error: "La huella SHA-256 del comprobante es inválida." };
  }

  const nombreArchivo = sanearNombreArchivo(entrada.nombreArchivo || entrada.comprobanteUrl);

  // Anti-replay: una misma imagen o referencia no puede recargarse dos veces.
  const { data: hashPrevio } = await supabaseAdmin
    .from("solicitudes_recarga_saldo")
    .select("id, estado")
    .eq("hash_imagen_sha256", hashImagenSha256)
    .limit(1);
  if (hashPrevio && hashPrevio.length > 0) {
    return { ok: false, status: 409, error: "Este comprobante ya fue utilizado en una solicitud de recarga." };
  }

  const { data: refPrevia } = await supabaseAdmin
    .from("solicitudes_recarga_saldo")
    .select("id, estado")
    .eq("grupo_id", grupoId)
    .eq("metodo_pago", metodoPago)
    .eq("referencia_original", referencia)
    .limit(1);
  if (refPrevia && refPrevia.length > 0) {
    return { ok: false, status: 409, error: "Esta referencia bancaria ya fue registrada en el grupo." };
  }

  const conciliacion = await conciliarConBoveda({
    grupoId,
    metodoPago,
    bancoOrigen,
    referencia,
    monto,
    moneda,
  });

  const comprobanteUrl = `recargas/${cliente.clienteId}/${Date.now()}-${nombreArchivo}`;

  const { data: recargaRes, error: errRecarga } = await supabaseAdmin.rpc(
    "procesar_solicitud_recarga_blindada",
    {
      p_grupo_id: grupoId,
      p_cliente_id: cliente.clienteId,
      p_metodo_pago: metodoPago,
      p_banco_origen: bancoOrigen,
      p_referencia: referencia,
      p_monto_reportado: redondear(monto),
      p_moneda: moneda,
      p_tasa_cambio: 1,
      p_comprobante_url: comprobanteUrl,
      p_hash_imagen_sha256: hashImagenSha256,
      // Calculados exclusivamente en el servidor.
      p_datos_ocr_ia: conciliacion.datosOcr,
      p_confianza_ia: conciliacion.confianza,
    }
  );

  if (errRecarga) {
    return { ok: false, status: 400, error: errRecarga.message || "No se pudo procesar la recarga." };
  }

  return {
    ok: true,
    resultado: {
      ...(recargaRes && typeof recargaRes === "object" ? (recargaRes as Record<string, any>) : {}),
      cliente_id: cliente.clienteId,
      cliente_nombre: cliente.clienteNombre,
      conciliacion: conciliacion.notificacion ? "exacta" : "pendiente",
    },
    conciliacion: conciliacion.notificacion ? "exacta" : "pendiente",
  };
}
