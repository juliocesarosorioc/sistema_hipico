/**
 * CONTABILIDAD — capa de datos.
 *
 * Port de `js/depositos.js`, `js/caja.js`, `js/bancos.js` y `js/monedas.js`.
 *
 * CONVENCIÓN MONETARIA (heredada del legacy, js/depositos.js:187):
 *   'VES' = bolívares · 'USD' = dólares · la tasa es Bs por 1 USD, por eso se
 *   DIVIDE para llevar a dólares:  montoUsd = esVes ? monto / tasa : monto
 *
 * DIFERENCIA CON EL LEGACY: todo el dinero se mueve con las RPC de
 * `sql/contabilidad.sql`, que son transaccionales. El legacy hacía una
 * secuencia de `await` sin rollback, así que un fallo a mitad de camino dejaba
 * el banco acreditado y el saldo sin debitar (o al revés), sin forma de
 * arreglarlo. Si la RPC no está instalada se avisa con un mensaje explícito en
 * lugar de simular el movimiento con escrituras parciales.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad, exigirPermiso } from "@/lib/seguridad/vigente";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TipoDeposito = "Normal" | "Otorgar Aval" | "Pagar Aval";
export type TipoTransaccion = "TRANSFERENCIA" | "RETIRO";
export type MonedaCodigo = "USD" | "VES";

export type BancoRow = {
  id: string;
  nombre: string;
  moneda_codigo: string | null;
  saldo_local: number | null;
};

export type DepositoRow = {
  id: number;
  fecha: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  tipo_operacion: string | null;
  monto: number | null;
  monto_usd: number | null;
  nota: string | null;
  modalidad: string | null;
  banco_id: string | null;
  banco_nombre: string | null;
  referencia: string | null;
  moneda: string | null;
  tasa_cambio: number | null;
};

export type TransaccionRow = {
  id: number;
  fecha: string | null;
  tipo_operacion: string | null;
  cliente_origen_id: string | null;
  cliente_origen_nombre: string | null;
  cliente_destino_id: string | null;
  cliente_destino_nombre: string | null;
  monto: number | null;
  monto_usd: number | null;
  tasa_cambio: number | null;
  moneda: string | null;
  modalidad: string | null;
  banco_id: string | null;
  banco_nombre: string | null;
  referencia: string | null;
  nota: string | null;
  numero_cuenta: string | null;
  tipo_cuenta: string | null;
  cedula_rif: string | null;
  nombre_beneficiario: string | null;
};

export type MonedaRow = {
  id: string;
  nombre: string;
  codigo: string;
  simbolo: string | null;
  es_base: boolean | null;
  tasa_cambio: number | null;
};

export type TasaCambioRow = {
  id: number;
  moneda_id: string;
  tasa: number;
  fecha_registro: string;
  monedas?: { nombre: string; codigo: string } | null;
};

export type TasaReferenciaRow = {
  id: string;
  tipo: "BCV" | "BINANCE" | "EURO";
  tasa: number;
  fecha_aplicar: string;
};

/** Cliente con los dos saldos que la contabilidad mueve. */
export type ClienteSaldo = {
  id: string;
  nombre: string;
  saldo_actual: number;
  aval: number;
};

export type ResultadoMovimiento = {
  ok: boolean;
  error?: string;
  monto_usd?: number;
  saldo_nuevo?: number;
  aval_nuevo?: number;
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** ¿El movimiento está expresado en bolívares? */
export const esVes = (moneda: string | null | undefined): boolean =>
  String(moneda ?? "USD").toUpperCase() === "VES";

/**
 * Equivalente en dólares. VES = Bs y la tasa es Bs por USD, así que divide.
 * Es la fórmula del legacy (js/depositos.js:187, js/caja.js:237) corregida para
 * no devolver Infinity cuando la tasa es 0.
 */
export function aUsd(monto: number, moneda: string | null | undefined, tasa: number | null | undefined): number {
  if (monto <= 0) return 0;
  if (!esVes(moneda)) return monto;
  const t = num(tasa);
  return t > 0 ? round2(monto / t) : 0;
}

const MENSAJE_SIN_RPC =
  "Falta instalar sql/contabilidad.sql en Supabase. Los movimientos de dinero requieren la RPC transaccional; no se hacen escrituras parciales.";

async function rpcContable(nombre: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  if (!supabase) return { data: null, error: { message: "Sin conexión a Supabase" } };
  const { data, error } = await supabase.rpc(nombre, args);
  return { data, error };
}

/** Detecta si la RPC no existe (la más común al no haber corrido el SQL). */
function esRpcAusente(error: { message: string } | null): boolean {
  if (!error) return false;
  const m = error.message.toLowerCase();
  return m.includes("does not exist") || m.includes("no existe") || m.includes("not found") || m.includes("404");
}

// ---------------------------------------------------------------------------
// Tasas de referencia (BCV / BINANCE / EURO)
// ---------------------------------------------------------------------------

export async function listarTasasReferencia(filtroTipo?: string): Promise<TasaReferenciaRow[]> {
  if (!supabase) return [];
  let q = supabase
    .from("tasas_referencia")
    .select("id, tipo, tasa, fecha_aplicar")
    .order("fecha_aplicar", { ascending: false });
  if (filtroTipo) q = q.eq("tipo", filtroTipo);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as TasaReferenciaRow[];
}

export async function guardarTasaReferencia(
  tipo: string,
  tasa: number,
  fechaAplicar: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!fechaAplicar) return { ok: false, error: "Indique la fecha de aplicación." };
  if (!(tasa > 0)) return { ok: false, error: "La tasa debe ser un número mayor a cero." };
  exigirCapacidad("contabilidad:fn_registrar_tasa");
  const { error } = await supabase
    .from("tasas_referencia")
    .insert({ tipo, tasa, fecha_aplicar: fechaAplicar });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Tasa vigente a una fecha: la última cuyo `fecha_aplicar` ya pasó. */
export async function tasaVigente(tipo: string, fecha?: string): Promise<number | null> {
  if (!supabase) return null;
  const f = fecha || new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tasas_referencia")
    .select("tasa")
    .eq("tipo", tipo)
    .lte("fecha_aplicar", f)
    .order("fecha_aplicar", { ascending: false })
    .limit(1);
  return data && data.length ? num(data[0].tasa) : null;
}

/** Tasa global de bolívares: BCV vigente, o la del catálogo como respaldo. */
export async function tasaGlobalVes(): Promise<number> {
  const bcv = await tasaVigente("BCV");
  if (bcv && bcv > 0) return bcv;
  if (!supabase) return 1;
  const { data } = await supabase.from("monedas").select("tasa_cambio").limit(1);
  const t = data && data.length ? num(data[0].tasa_cambio) : 0;
  return t > 0 ? t : 1;
}

// ---------------------------------------------------------------------------
// Monedas y tasas de cambio
// ---------------------------------------------------------------------------

export async function listarMonedas(): Promise<MonedaRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("monedas")
    .select("id, nombre, codigo, simbolo, es_base, tasa_cambio")
    .order("es_base", { ascending: false });
  if (error) return [];
  return (data ?? []) as MonedaRow[];
}

export async function listarHistorialTasas(monedaId?: string): Promise<TasaCambioRow[]> {
  if (!supabase) return [];
  let q = supabase
    .from("tasas_cambio")
    .select("id, moneda_id, tasa, fecha_registro, monedas(nombre, codigo)")
    .order("fecha_registro", { ascending: false });
  if (monedaId) q = q.eq("moneda_id", monedaId);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as unknown as TasaCambioRow[];
}

/**
 * `tasas_cambio` es APPEND-ONLY (js/monedas.js:332): cada cambio es una fila
 * nueva y la vigente es la última por fecha. Nunca se actualiza una tasa vieja.
 */
export async function registrarTasaCambio(
  monedaId: string,
  tasa: number
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!(tasa > 0)) return { ok: false, error: "La tasa debe ser un número mayor a cero." };
  exigirCapacidad("contabilidad:fn_registrar_tasa");
  const { data, error } = await rpcContable("club_registrar_tasa", {
    p_moneda_id: monedaId,
    p_tasa: tasa,
  });
  if (error) {
    if (esRpcAusente(error)) {
      // Fallback directo: la tabla es append-only, así que un INSERT conserva
      // la misma semántica que la RPC.
      const ins = await supabase.from("tasas_cambio").insert({ moneda_id: monedaId, tasa });
      if (ins.error) return { ok: false, error: ins.error.message };
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }
  void data;
  return { ok: true };
}

export async function crearMoneda(datos: {
  nombre: string;
  codigo: string;
  simbolo: string;
  tasa: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!datos.nombre.trim() || !datos.codigo.trim() || !datos.simbolo.trim())
    return { ok: false, error: "Nombre, código y símbolo son obligatorios." };
    if (!(datos.tasa > 0)) return { ok: false, error: "La tasa inicial debe ser mayor a cero." };
    exigirCapacidad("contabilidad:btn_crear_moneda");
    const { error } = await supabase.from("monedas").insert({
    nombre: datos.nombre.trim(),
    codigo: datos.codigo.trim().toUpperCase(),
    simbolo: datos.simbolo.trim(),
    es_base: false,
    tasa_cambio: datos.tasa,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bancos
// ---------------------------------------------------------------------------

export async function listarBancos(): Promise<BancoRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("bancos").select("*").order("nombre");
  if (error) return [];
  return (data ?? []) as BancoRow[];
}

/**
 * Equivalente en dólares de un saldo de cuenta.
 * `tasa` es Bs por 1 USD, entonces una cuenta en Bs se divide (js/bancos.js:49-55).
 */
export function saldoBancoUsd(saldoLocal: number, monedaCodigo: string | null, tasa: number | null): number {
  if (!esVes(monedaCodigo)) return round2(saldoLocal);
  const t = num(tasa);
  return t > 0 ? round2(saldoLocal / t) : 0;
}

export async function guardarBanco(
  datos: { id?: string | null; nombre: string; moneda_codigo: string; saldo_local: number }
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!datos.nombre.trim()) return { ok: false, error: "El nombre del banco es obligatorio." };
  if (!datos.moneda_codigo) return { ok: false, error: "La moneda del banco es obligatoria." };
  if (!Number.isFinite(datos.saldo_local)) return { ok: false, error: "El saldo es obligatorio." };
  exigirCapacidad(datos.id ? "contabilidad:btn_editar_banco" : "contabilidad:btn_crear_banco");
  const { error } = await rpcContable("club_guardar_banco", {
    p_id: datos.id ?? null,
    p_nombre: datos.nombre,
    p_moneda_codigo: datos.moneda_codigo,
    p_saldo_local: datos.saldo_local,
  });
  if (error) {
    if (esRpcAusente(error)) {
      const q = datos.id
        ? supabase
            .from("bancos")
            .update({
              nombre: datos.nombre.trim().toUpperCase(),
              moneda_codigo: datos.moneda_codigo.toUpperCase(),
              saldo_local: datos.saldo_local,
            })
            .eq("id", datos.id)
        : supabase.from("bancos").insert({
            nombre: datos.nombre.trim().toUpperCase(),
            moneda_codigo: datos.moneda_codigo.toUpperCase(),
            saldo_local: datos.saldo_local,
          });
      const r = await q;
      if (r.error) return { ok: false, error: r.error.message };
    } else {
      return { ok: false, error: error.message };
    }
  }
  return { ok: true };
}

export async function eliminarBanco(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  try {
    exigirCapacidad("contabilidad:fn_eliminar_banco");
    const { error } = await supabase.from("bancos").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Saldos de clientes
// ---------------------------------------------------------------------------

export async function listarClientesSaldos(): Promise<ClienteSaldo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nombre, saldo_actual, aval")
    .order("nombre");
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id),
    nombre: String(c.nombre ?? ""),
    saldo_actual: num(c.saldo_actual),
    aval: num(c.aval),
  }));
}

/**
 * Saldo de "caja": la suma de `clientes.saldo_actual`.
 * NO existe una tabla `caja` en el sistema (verificado: 0 resultados en todo
 * el repo) — el legacy hacía exactamente esta suma (js/caja.js:306-316).
 */
export function totalCaja(clientes: ClienteSaldo[]): number {
  return round2(clientes.reduce((acc, c) => acc + c.saldo_actual, 0));
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

export async function listarDepositos(limite = 50): Promise<DepositoRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("depositos")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(limite);
  if (error) return [];
  return (data ?? []) as DepositoRow[];
}

export async function listarTransacciones(limite = 50): Promise<TransaccionRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transacciones_financieras")
    .select("*")
    .order("id", { ascending: false })
    .limit(limite);
  if (error) return [];
  return (data ?? []) as TransaccionRow[];
}

/**
 * Depósito / ingreso / aval (js/depositos.js:205-239).
 *
 * Reglas, idénticas a las de la RPC:
 *  - Normal        → saldo + monto, banco + monto
 *  - Otorgar Aval  → solo aval + monto (no suma saldo, no toca el banco: es garantía)
 *  - Pagar Aval    → cancela deuda, luego reduce aval y el excedente entra al
 *                    saldo; banco + monto
 */
export async function registrarDeposito(p: {
  cliente_id: string;
  tipo_operacion: TipoDeposito;
  monto: number;
  moneda: string;
  tasa_cambio: number;
  modalidad?: string | null;
  banco_id?: string | null;
  referencia?: string | null;
  nota?: string | null;
}): Promise<ResultadoMovimiento> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!p.cliente_id) return { ok: false, error: "Debe seleccionar un cliente." };
  if (!(p.monto > 0)) return { ok: false, error: "Indique un monto válido." };
  if (esVes(p.moneda) && !(p.tasa_cambio > 0))
    return { ok: false, error: "Indique la tasa aplicada al ingreso en Bs." };
  if (p.tipo_operacion !== "Otorgar Aval") {
    if (!p.modalidad) return { ok: false, error: "Debe indicar la modalidad del ingreso." };
      if (!p.banco_id) return { ok: false, error: "Debe seleccionar el banco receptor." };
    }
  exigirPermiso("contabilidad:fn_registrar_movimiento", {
    monto: p.monto,
    // "Otorgar Aval" no tiene modalidad de pago externa (es una garantía
    // interna): sin este respaldo, `metodo_pago: ""` no está en METODOS_PAGO y
    // la regla ABAC rechaza un aval legítimo como "no reconocido".
    metodo_pago: normMetodo(p.modalidad) || "otro",
  });
    const { data, error } = await rpcContable("club_registrar_deposito", {
    p_cliente_id: p.cliente_id,
    p_tipo: p.tipo_operacion,
    p_monto: p.monto,
    p_moneda: p.moneda,
    p_tasa: p.tasa_cambio,
    p_modalidad: p.modalidad ?? null,
    p_banco_id: p.banco_id ?? null,
    p_referencia: p.referencia ?? null,
    p_nota: p.nota ?? null,
    p_creditar_banco: true,
  });
  if (error) {
    if (esRpcAusente(error)) return { ok: false, error: MENSAJE_SIN_RPC };
    return { ok: false, error: error.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    monto_usd: num(r.monto_usd),
    saldo_nuevo: num(r.saldo_nuevo),
    aval_nuevo: num(r.aval_nuevo),
  };
}

/** Traslado entre clientes: el saldo viaja, la tesorería no se toca. */
export async function registrarTraslado(p: {
  origen_id: string;
  destino_id: string;
  monto: number;
  nota?: string | null;
}): Promise<ResultadoMovimiento> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!p.origen_id) return { ok: false, error: "Debe seleccionar un cliente origen." };
  if (!p.destino_id) return { ok: false, error: "Debe seleccionar un cliente destino." };
  if (p.origen_id === p.destino_id) return { ok: false, error: "No puede transferir a sí mismo." };
    if (!(p.monto > 0)) return { ok: false, error: "El monto debe ser un número mayor a cero." };

  exigirPermiso("contabilidad:fn_registrar_movimiento", {
    monto: p.monto,
    // El traslado no sale de la casa: el saldo viaja de un cliente a otro sin
    // pasar por una modalidad externa. Para la regla es una transferencia
    // interna, y por eso se pasa fija en vez de leerse de la entrada (que no
    // tiene el campo). El tope de monto sí aplica igual.
    metodo_pago: "transferencia",
  });
  const { data, error } = await rpcContable("club_registrar_traslado", {
    p_origen_id: p.origen_id,
    p_destino_id: p.destino_id,
    p_monto: p.monto,
    p_nota: p.nota ?? null,
  });
  if (error) {
    if (esRpcAusente(error)) return { ok: false, error: MENSAJE_SIN_RPC };
    return { ok: false, error: error.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, saldo_nuevo: num(r.origen_nuevo) };
}

/** Retiro a la tesorería: descuenta al cliente y al banco receptor. */
export async function registrarRetiro(p: {
  origen_id: string;
  monto: number;
  moneda: string;
  tasa_cambio: number;
  modalidad: string;
  banco_id?: string | null;
  referencia?: string | null;
  numero_cuenta?: string | null;
  tipo_cuenta?: string | null;
  cedula_rif?: string | null;
  beneficiario?: string | null;
  nota?: string | null;
}): Promise<ResultadoMovimiento> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!p.origen_id) return { ok: false, error: "Debe seleccionar un cliente origen." };
  if (!(p.monto > 0)) return { ok: false, error: "El monto debe ser un número mayor a cero." };
  if (!p.modalidad) return { ok: false, error: "Debe indicar la modalidad del retiro." };
  if (esVes(p.moneda) && !(p.tasa_cambio > 0))
      return { ok: false, error: "Indique la tasa aplicada al egreso en Bs." };

  exigirPermiso("contabilidad:fn_registrar_movimiento", {
    monto: p.monto,
    metodo_pago: normMetodo(p.modalidad),
  });
  const { data, error } = await rpcContable("club_registrar_retiro", {
    p_origen_id: p.origen_id,
    p_monto: p.monto,
    p_moneda: p.moneda,
    p_tasa: p.tasa_cambio,
    p_modalidad: p.modalidad,
    p_banco_id: p.banco_id ?? null,
    p_referencia: p.referencia ?? null,
    p_numero_cuenta: p.numero_cuenta ?? null,
    p_tipo_cuenta: p.tipo_cuenta ?? null,
    p_cedula_rif: p.cedula_rif ?? null,
    p_beneficiario: p.beneficiario ?? null,
    p_nota: p.nota ?? null,
  });
  if (error) {
    if (esRpcAusente(error)) return { ok: false, error: MENSAJE_SIN_RPC };
    return { ok: false, error: error.message };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return { ok: true, monto_usd: num(r.monto_usd), saldo_nuevo: num(r.saldo_nuevo) };
}

// ---------------------------------------------------------------------------
// Catálogos de la UI
// ---------------------------------------------------------------------------

/**
 * El metodo de pago tal como lo espera la regla ABAC: minúsculas y sin
 * mayúsculas ni espacios raros. "PAGO MOVIL" y "pago movil" tienen que ser la
 * misma modalidad, o un movimiento legitimo se rechaza como "no reconocido".
 */
function normMetodo(modalidad: string | null | undefined): string {
  return String(modalidad ?? "")
    .trim()
    .toLowerCase();
}

/** Modalidades de egreso (js/caja.js:113). */
export const MODALIDADES_EGRESO = [
  "ZELLE",
  "BINANCE",
  "EFECTIVO",
  "DIVISA",
  "PAGO MÓVIL",
  "TRANSFERENCIA",
  "OTRO",
] as const;

/** Modalidades de ingreso (js/depositos.js:79). */
export const MODALIDADES_INGRESO = [
  "EFECTIVO",
  "DIVISA",
  "PAGO MÓVIL",
  "TRANSFERENCIA",
  "PAYPAL",
  "ZELLE",
  "BINANCE",
  "OTRO",
] as const;

export const TIPOS_CUENTA = ["CORRIENTE", "AHORRO", ""] as const;
