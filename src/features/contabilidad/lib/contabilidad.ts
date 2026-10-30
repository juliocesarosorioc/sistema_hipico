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
import { supabase } from "@/core/supabase";
import { exigirCapacidad, exigirPermiso, grupoActivoVigente, esPrincipalVigente, grupoVigente } from "@/features/seguridad/lib/vigente";
import { listarClientes } from "@/features/clientes/lib/clientes";
import { sincronizarSaldosRealesClientes } from "@/features/saldos/lib/contabilidad-central";
import { aNumero, calcularComisionExacta, monedaExacta } from "@/shared/lib/utils";

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
  /** Fecha manual de la operación contable (asiento). */
  fecha: string | null;
  fecha_asiento?: string | null;
  /** Fecha interna del sistema en que se realizó en la plataforma. */
  fecha_movimiento?: string | null;
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
  /** Fecha manual de la operación contable (asiento). */
  fecha: string | null;
  fecha_asiento?: string | null;
  /** Fecha interna del sistema en que se realizó en la plataforma. */
  fecha_movimiento?: string | null;
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

const num = aNumero;

/**
 * Redondeo a dos decimales.
 *
 * POR QUÉ NO ES `Math.round(n * 100) / 100`: ese redondeo falla en el medio
 * centavo exacto (`1.005` daba `1.00` en vez de `1.01`). `monedaExacta`
 * (src/shared/lib/utils.ts) suma el `Number.EPSILON` que hace falta para que
 * el medio centavo caiga hacia arriba. Todos los importes de la contabilidad
 * salen de acá.
 */
export const round2 = (n: number): number => monedaExacta(n);

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

/**
 * Detecta si la RPC no existe (la más común al no haber corrido el SQL).
 *
 * OJO con las variantes del mensaje: PostgREST no siempre dice "does not
 * exist". Cuando la función está en el archivo SQL pero NO se corrió, el
 * esquema cacheado responde
 *   "Could not find the function public.<fn> in the schema cache."
 * (código PGRST202). Sin esa variante, el operador veía un error crudo de
 * PostgREST en vez del aviso de "falta instalar el SQL".
 */
function esRpcAusente(error: { message: string } | null): boolean {
  if (!error) return false;
  const m = error.message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("no existe") ||
    m.includes("not found") ||
    m.includes("could not find") ||
    m.includes("schema cache") ||
    m.includes("404")
  );
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
  // El aislamiento por grupo lo hace el RLS de la base; esto solo implementa el
  // filtro "ver un grupo / todos" del super administrador o del grupo asignado.
  const activo = !esPrincipalVigente() ? (grupoVigente() || null) : (grupoActivoVigente() || null);
  let q = supabase
    .from("clientes")
    .select("id, nombre, saldo_actual, aval, grupo_id, telefono, codigo_pais")
    .order("nombre");
  if (activo) q = q.eq("grupo_id", activo);
  const { data, error } = await q;
  if (error) return [];
  const rawList = ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
    id: String(c.id),
    nombre: String(c.nombre ?? ""),
    saldo_actual: num(c.saldo_actual),
    aval: num(c.aval),
    grupo_id: c.grupo_id != null ? String(c.grupo_id) : activo,
    telefono: c.telefono ? String(c.telefono) : null,
    codigo_pais: c.codigo_pais ? String(c.codigo_pais) : null,
  }));
  const sincronizados = await sincronizarSaldosRealesClientes(rawList, activo);
  return sincronizados.map((c) => ({
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

/**
 * IDs de los clientes del grupo ACTIVO (filtro "ver un grupo" del super
 * administrador). Devuelve `null` cuando no hay grupo elegido (ver "todos"): en
 * ese caso NO se filtra acá (un usuario con grupo ya viene acotado por el RLS).
 * Devuelve `[]` si el grupo no tiene clientes (nada que mostrar).
 */
async function idsClientesDelGrupoActivo(): Promise<string[] | null> {
  if (!grupoActivoVigente()) return null;
  try {
    const clientes = await listarClientes();
    return clientes.map((c) => String(c.id));
  } catch {
    return null;
  }
}

export async function listarDepositos(limite = 50): Promise<DepositoRow[]> {
  if (!supabase) return [];
  const ids = await idsClientesDelGrupoActivo();
  if (ids && ids.length === 0) return [];
  let q = supabase
    .from("depositos")
    .select("*")
    .order("fecha", { ascending: false })
    .limit(limite);
  if (ids) q = q.in("cliente_id", ids);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as DepositoRow[];
}

export async function listarTransacciones(limite = 50): Promise<TransaccionRow[]> {
  if (!supabase) return [];
  const ids = await idsClientesDelGrupoActivo();
  if (ids && ids.length === 0) return [];
  let q = supabase
    .from("transacciones_financieras")
    .select("*")
    .order("id", { ascending: false })
    .limit(limite);
  if (ids) {
    const lista = ids.join(",");
    q = q.or(`cliente_origen_id.in.(${lista}),cliente_destino_id.in.(${lista})`);
  }
  const { data, error } = await q;
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
  /** Fecha manual del asiento contable elegida por el operador. */
  fecha_asiento?: string | null;
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

  // Actualización de fecha_asiento (manual) y fecha_movimiento (timestamp interno de plataforma)
  const fechaAsiento = p.fecha_asiento || new Date().toISOString().slice(0, 10);
  const fechaMovimiento = new Date().toISOString();
  if (supabase) {
    try {
      const { data: depReciente } = await supabase
        .from("depositos")
        .select("id")
        .eq("cliente_id", p.cliente_id)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (depReciente?.id) {
        await supabase
          .from("depositos")
          .update({
            fecha: fechaAsiento,
            fecha_asiento: fechaAsiento,
            fecha_movimiento: fechaMovimiento,
          } as Record<string, unknown>)
          .eq("id", depReciente.id);
      }
    } catch {
      /* best-effort */
    }
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
  /** Fecha manual del asiento contable elegida por el operador. */
  fecha_asiento?: string | null;
}): Promise<ResultadoMovimiento> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };
  if (!p.origen_id) return { ok: false, error: "Debe seleccionar un cliente origen." };
  if (!p.destino_id) return { ok: false, error: "Debe seleccionar un cliente destino." };
  if (p.origen_id === p.destino_id) return { ok: false, error: "No puede transferir a sí mismo." };
    if (!(p.monto > 0)) return { ok: false, error: "El monto debe ser un número mayor a cero." };

  exigirPermiso("contabilidad:fn_registrar_movimiento", {
    monto: p.monto,
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

  const fechaAsiento = p.fecha_asiento || new Date().toISOString().slice(0, 10);
  const fechaMovimiento = new Date().toISOString();
  if (supabase) {
    try {
      const { data: trxReciente } = await supabase
        .from("transacciones")
        .select("id")
        .eq("cliente_origen_id", p.origen_id)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trxReciente?.id) {
        await supabase
          .from("transacciones")
          .update({
            fecha: fechaAsiento,
            fecha_asiento: fechaAsiento,
            fecha_movimiento: fechaMovimiento,
          } as Record<string, unknown>)
          .eq("id", trxReciente.id);
      }
    } catch {
      /* best-effort */
    }
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
  /** Fecha manual del asiento contable elegida por el operador. */
  fecha_asiento?: string | null;
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

  const fechaAsiento = p.fecha_asiento || new Date().toISOString().slice(0, 10);
  const fechaMovimiento = new Date().toISOString();
  if (supabase) {
    try {
      const { data: trxReciente } = await supabase
        .from("transacciones")
        .select("id")
        .eq("cliente_origen_id", p.origen_id)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (trxReciente?.id) {
        await supabase
          .from("transacciones")
          .update({
            fecha: fechaAsiento,
            fecha_asiento: fechaAsiento,
            fecha_movimiento: fechaMovimiento,
          } as Record<string, unknown>)
          .eq("id", trxReciente.id);
      }
    } catch {
      /* best-effort */
    }
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

// ===========================================================================
//  📘  CONTABILIDAD NIIF — PARTIDA DOBLE, NIC 21 Y PRECISIÓN DECIMAL
// ---------------------------------------------------------------------------
//  POR QUÉ EXISTE ESTE BLOQUE
//
//  Hasta acá la contabilidad del sistema era "un saldo por cliente": un número
//  que sube y baja. Sirve para la caja, pero NO alcanza para una contabilidad
//  NIIF, que exige tres cosas que el legacy no tenía:
//
//   1. PARTIDA DOBLE: cada hecho económico deja DOS huellas, una en el debe y
//      otra en el haber, y el total de ambas tiene que ser EXACTAMENTE el
//      mismo. Si no cuadra, el asiento no existe.
//   2. MULTIMONEDA (NIC 21): la operación se hace en una moneda (la de
//      OPERACIÓN: la del banco, la del cliente) pero la casa presenta en otra
//      (la de PRESENTACIÓN). El importe original NO se pierde: se guarda junto
//      con la tasa HISTÓRICA del día (NIC 21.39: la del hecho económico, no
//      la de hoy ni la del cierre).
//   3. PRECISIÓN DECIMAL: los importes se cuentan en CENTAVOS ENTEROS, no en
//      coma flotante (ver `monedaExacta` y `calcularComisionExacta` en
//      src/shared/lib/utils.ts).
//
//  LA FRONTERA DE CONFIANZA
//  El cuadre se valida DOS veces: acá en el cliente (para no enviar un asiento
//  descuadrado y para avisarle al operador qué línea falla) y en el SERVIDOR
//  (que es la garantía real: la RPC `rpc_registrar_asiento_niif` levanta una
//  excepción si debe ≠ haber). La validación del cliente es una cortesía; la
//  del servidor, la ley.
//
//  LOS REVERSOS NO BORRAN NADA
//  Un asiento registrado es INMUTABLE. Para corregirlo se registra un
//  CONTRA-ASIENTO (el inverso: lo que estaba en el debe pasa al haber y
//  viceversa) que queda en el libro al lado del original. Borrar el asiento
//  original dejaría el balance descuadrado y sin rastro de por qué. Por eso
//  en la base NO hay permiso de DELETE y la RPC no expone ningún borrado.
// ===========================================================================

/** Una línea del asiento: una cuenta y su importe en debe o en haber. */
export type LineaAsientoNIIF = {
  /** Código de la cuenta en el plan (p. ej. "1.1.01"). */
  cuenta: string;
  /** Nombre de la cuenta en el plan. */
  nombre_cuenta: string;
  /** Importe en la MONEDA DE OPERACIÓN del asiento (la del hecho económico). */
  debe: number;
  haber: number;
};

/** Asiento en partida doble, listo para registrarse. */
export type AsientoNIIF = {
  /**
   * Clave de idempotencia. Repetir el registro con la misma clave NO duplica
   * el asiento: devuelve el que ya estaba (como `p_idem` en
   * sql/marcas_venta.sql).
   */
  clave: string;
  /** Fecha del hecho económico ("YYYY-MM-DD"). */
  fecha: string;
  /** Qué pasó, en palabras (va al libro diario). */
  concepto: string;
  /** Moneda en la que se CONTABILIZA (NIC 21.11: moneda de operación). */
  moneda_operacion: string;
  /** Moneda en la que se PRESENTA el balance (moneda de presentación). */
  moneda_presentacion: string;
  /**
   * Tasa de cambio HISTÓRICA (NIC 21.39): 1 unidad de `moneda_operacion`
   * equivale a `tasa_cambio` unidades de `moneda_presentacion`. Es la del día
   * del hecho económico, NO la de hoy.
   */
  tasa_cambio: number;
  lineas: LineaAsientoNIIF[];
  /** true si es el contra-asiento que revierte otro asiento. */
  es_contra_asiento?: boolean;
  /** Clave del asiento que este contra-asiento revierte. */
  asiento_origen?: string | null;
  /** Quién lo registró (auditoría). */
  usuario?: string | null;
};

/** Cabecera de un asiento ya registrado (para listados y reversos). */
export type AsientoNIIFResumen = {
  id: string;
  clave: string;
  fecha: string | null;
  concepto: string | null;
  moneda_operacion: string | null;
  moneda_presentacion: string | null;
  tasa_cambio: number | null;
  total_debe: number | null;
  total_haber: number | null;
  es_contra_asiento: boolean | null;
  asiento_origen: string | null;
};

/** Una cuenta del balance de comprobación. */
export type FilaBalanceNIIF = {
  cuenta: string;
  nombre_cuenta: string;
  moneda_presentacion: string;
  total_debe: number;
  total_haber: number;
  saldo: number;
  /** Cantidad de líneas que componen la cuenta. */
  movimientos: number;
};

export type ResultadoAsientoNIIF = {
  ok: boolean;
  error?: string;
  id?: string;
  clave?: string;
  /** true si el asiento ya existía (no se duplicó). */
  ya_existia?: boolean;
  total_debe?: number;
  total_haber?: number;
};

/** Filtros del balance de comprobación. */
export type FiltroBalanceNIIF = {
  /** Texto libre: busca en el código y en el nombre de la cuenta. */
  texto?: string;
  /** Moneda de presentación. */
  moneda?: string;
  /** Fecha inicial (inclusive, "YYYY-MM-DD"). */
  desde?: string;
  /** Fecha final (inclusive, "YYYY-MM-DD"). */
  hasta?: string;
};

const MENSAJE_SIN_RPC_NIIF =
  "Falta instalar sql/contabilidad_niif.sql en Supabase. Los asientos NIIF se registran solo por la RPC (valida el cuadre en el servidor); no se hacen escrituras parciales.";

/**
 * Valida el asiento en el cliente ANTES de tocar la base.
 *
 * Devuelve la lista de errores (vacía = el asiento está bien). Se llama desde
 * `registrarAsientoPartidaDobleNIIF`, que LAZA si esta lista no está vacía:
 * un asiento descuadrado es un error de construcción del dato, no un rechazo
 * del servidor, y tiene que verse como tal.
 *
 * La comparación de totales se hace en CENTAVOS ENTEROS: sumar `0.1` catorce
 * veces en coma flotante NO da `1.4`, y un asiento que "no cuadra" porque el
 * lado del debe acumuló error de coma flotante es un asiento que el operador
 * no puede arreglar (no hay nada que corregir en la pantalla).
 */
export function validarAsientoNIIF(asiento: AsientoNIIF): string[] {
  const errores: string[] = [];

  if (!String(asiento.clave ?? "").trim()) {
    errores.push("El asiento necesita una clave de idempotencia.");
  }
  if (!String(asiento.concepto ?? "").trim()) {
    errores.push("El asiento necesita un concepto.");
  }
  if (!String(asiento.fecha ?? "").trim()) {
    errores.push("El asiento necesita fecha.");
  }
  const operacion = String(asiento.moneda_operacion ?? "").trim().toUpperCase();
  const presentacion = String(asiento.moneda_presentacion ?? "").trim().toUpperCase();
  if (!operacion) errores.push("Indique la moneda de operación.");
  if (!presentacion) errores.push("Indique la moneda de presentación.");
  if (!(aNumero(asiento.tasa_cambio) > 0)) {
    errores.push("La tasa de cambio histórica debe ser un número mayor a cero.");
  }

  const lineas = asiento.lineas ?? [];
  if (lineas.length < 2) {
    errores.push("Un asiento en partida doble necesita al menos dos líneas (un debe y un haber).");
  }

  let centavosDebe = 0;
  let centavosHaber = 0;
  lineas.forEach((l, i) => {
    const n = i + 1;
    const debe = monedaExacta(l.debe);
    const haber = monedaExacta(l.haber);
    if (!String(l.cuenta ?? "").trim()) {
      errores.push(`La línea ${n} no tiene cuenta.`);
    }
    if (debe < 0 || haber < 0) {
      errores.push(`La línea ${n} no puede tener importes negativos: use un contra-asiento para revertir.`);
    }
    if (debe > 0 && haber > 0) {
      errores.push(`La línea ${n} no puede tener debe y haber a la vez.`);
    }
    if (debe === 0 && haber === 0) {
      errores.push(`La línea ${n} no tiene importe.`);
    }
    centavosDebe += Math.round(debe * 100);
    centavosHaber += Math.round(haber * 100);
  });

  if (centavosDebe !== centavosHaber) {
    const dif = (centavosDebe - centavosHaber) / 100;
    errores.push(
      `El asiento no cuadra: debe ${(centavosDebe / 100).toFixed(2)} y haber ${(centavosHaber / 100).toFixed(2)} ` +
        `(diferencia ${dif.toFixed(2)}). No se registró nada.`
    );
  }

  return errores;
}

/**
 * Registra un asiento en PARTIDA DOBLE.
 *
 * Qué hace, en orden:
 *  1. valida el cuadre en el cliente (lanza si no cuadra: nada llega a la base),
 *  2. exige la capacidad de escribir movimientos de caja,
 *  3. convierte los importes a la MONEDA DE PRESENTACIÓN con la tasa
 *     histórica (NIC 21) usando aritmética exacta,
 *  4. llama a la RPC `rpc_registrar_asiento_niif`, que vuelve a validar el
 *     cuadre en el servidor y es idempotente por `clave`.
 *
 * NUNCA borra nada: un error se corrige con un contra-asiento
 * (`registrarContraAsientoNIIF`).
 */
export async function registrarAsientoPartidaDobleNIIF(
  asiento: AsientoNIIF
): Promise<ResultadoAsientoNIIF> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  // 1) Validación ESTRICTA en el cliente. Se LANZA: el error es del dato
  //    armado, no del servidor, y el que llama tiene que enterarse ya.
  const errores = validarAsientoNIIF(asiento);
  if (errores.length > 0) throw new Error(errores.join(" "));

  // 2) Permiso. Escribir un asiento es escribir un movimiento de dinero: usa
  //    la MISMA capacidad que los depósitos, los retiros y los traslados, para
  //    que no haya una puerta trasera que esquive el RBAC.
  //
  //    Se usa `exigirCapacidad` (RBAC) y NO `exigirPermiso` (RBAC + ABAC): las
  //    reglas de atributo de esa capacidad están atadas al FORMULARIO de
  //    movimiento de caja (método de pago, tope del operador, grupo del
  //    registro) y no a un asiento del libro. Aplicarlas acá rechazaría, por
  //    omisión, al administrador de grupo y al banquero por el atributo
  //    `grupo` ausente, que es un fallo de contexto y no una política.
  try {
    exigirCapacidad("contabilidad:fn_registrar_movimiento");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // 3) Importes exactos y conversión a la moneda de presentación (NIC 21).
  const tasa = aNumero(asiento.tasa_cambio);
  const lineas = (asiento.lineas ?? []).map((l) => {
    const debe = monedaExacta(l.debe);
    const haber = monedaExacta(l.haber);
    return {
      cuenta: String(l.cuenta).trim(),
      nombre_cuenta: String(l.nombre_cuenta ?? "").trim(),
      debe,
      haber,
      // El importe en moneda de presentación se guarda AL LADO del original:
      // el libro tiene que poder mostrar las dos cifras (NIC 21.39).
      debe_presentacion: monedaExacta(debe * tasa),
      haber_presentacion: monedaExacta(haber * tasa),
    };
  });

  const { data, error } = await rpcContable("rpc_registrar_asiento_niif", {
    p_clave: String(asiento.clave).trim(),
    p_fecha: asiento.fecha,
    p_concepto: String(asiento.concepto).trim(),
    p_moneda_operacion: String(asiento.moneda_operacion).trim().toUpperCase(),
    p_moneda_presentacion: String(asiento.moneda_presentacion).trim().toUpperCase(),
    p_tasa_cambio: tasa,
    p_lineas: lineas,
    p_es_contra_asiento: Boolean(asiento.es_contra_asiento),
    p_asiento_origen: asiento.asiento_origen ?? null,
    p_usuario: asiento.usuario ?? null,
  });
  if (error) {
    if (esRpcAusente(error)) return { ok: false, error: MENSAJE_SIN_RPC_NIIF };
    return { ok: false, error: error.message };
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    id: r.id != null ? String(r.id) : undefined,
    clave: r.clave != null ? String(r.clave) : String(asiento.clave).trim(),
    ya_existia: Boolean(r.ya_existia),
    total_debe: monedaExacta(r.total_debe),
    total_haber: monedaExacta(r.total_haber),
  };
}

/** Lee un asiento (cabecera + líneas) por su clave de idempotencia. */
export async function obtenerAsientoNIIFPorClave(clave: string): Promise<AsientoNIIF | null> {
  if (!supabase || !clave) return null;
  const { data, error } = await supabase
    .from("asientos_niif")
    .select(
      "id, clave, fecha, concepto, moneda_operacion, moneda_presentacion, tasa_cambio, es_contra_asiento, asiento_origen, asientos_niif_lineas(cuenta, nombre_cuenta, debe, haber)"
    )
    .eq("clave", clave)
    .limit(1);
  if (error || !data || data.length === 0) return null;

  const r = data[0] as unknown as Record<string, unknown>;
  const crudos = (r.asientos_niif_lineas ?? []) as Array<Record<string, unknown>>;
  return {
    clave: String(r.clave ?? clave),
    fecha: String(r.fecha ?? new Date().toISOString().slice(0, 10)),
    concepto: String(r.concepto ?? ""),
    moneda_operacion: String(r.moneda_operacion ?? "USD"),
    moneda_presentacion: String(r.moneda_presentacion ?? "USD"),
    tasa_cambio: aNumero(r.tasa_cambio) || 1,
    es_contra_asiento: Boolean(r.es_contra_asiento),
    asiento_origen: r.asiento_origen != null ? String(r.asiento_origen) : null,
    lineas: crudos.map((l) => ({
      cuenta: String(l.cuenta ?? ""),
      nombre_cuenta: String(l.nombre_cuenta ?? ""),
      debe: monedaExacta(l.debe),
      haber: monedaExacta(l.haber),
    })),
  };
}

/**
 * Registra el CONTRA-ASIENTO de un asiento (el reverso).
 *
 * POR QUÉ NO SE BORRA: un asiento ya registrado es parte del libro. Si se
 * borra, el balance queda descuadrado y nadie puede saber después qué se
 * corrigió ni por qué. El reverso correcto es el asiento INVERSO: lo que
 * estaba en el debe pasa al haber y viceversa, con la misma tasa histórica,
 * y queda al lado del original con su clave propia (`REVERSO:<clave>`).
 *
 * Como la clave es fija, registrar dos veces el mismo reverso NO duplica nada:
 * el segundo intento devuelve el contra-asiento que ya estaba.
 */
export async function registrarContraAsientoNIIF(
  claveOriginal: string,
  opciones?: { fecha?: string; concepto?: string; usuario?: string | null }
): Promise<ResultadoAsientoNIIF> {
  const original = await obtenerAsientoNIIFPorClave(claveOriginal);
  if (!original) {
    return { ok: false, error: `No existe el asiento "${claveOriginal}".` };
  }
  if (original.es_contra_asiento) {
    return { ok: false, error: `El asiento "${claveOriginal}" ya es un contra-asiento: no se revierte dos veces.` };
  }
  return registrarAsientoPartidaDobleNIIF({
    clave: `REVERSO:${original.clave}`,
    fecha: opciones?.fecha || original.fecha,
    concepto: opciones?.concepto || `Reverso de ${original.clave}: ${original.concepto}`,
    moneda_operacion: original.moneda_operacion,
    moneda_presentacion: original.moneda_presentacion,
    tasa_cambio: original.tasa_cambio,
    es_contra_asiento: true,
    asiento_origen: original.clave,
    usuario: opciones?.usuario ?? null,
    lineas: original.lineas.map((l) => ({
      cuenta: l.cuenta,
      nombre_cuenta: l.nombre_cuenta,
      debe: l.haber,
      haber: l.debe,
    })),
  });
}

/** Lista los asientos registrados (los más recientes primero). */
export async function listarAsientosNIIF(limite = 50): Promise<AsientoNIIFResumen[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("asientos_niif")
    .select(
      "id, clave, fecha, concepto, moneda_operacion, moneda_presentacion, tasa_cambio, total_debe, total_haber, es_contra_asiento, asiento_origen"
    )
    .order("fecha", { ascending: false })
    .order("creado_at", { ascending: false })
    .limit(limite);
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id ?? ""),
    clave: String(r.clave ?? ""),
    fecha: r.fecha != null ? String(r.fecha) : null,
    concepto: r.concepto != null ? String(r.concepto) : null,
    moneda_operacion: r.moneda_operacion != null ? String(r.moneda_operacion) : null,
    moneda_presentacion: r.moneda_presentacion != null ? String(r.moneda_presentacion) : null,
    tasa_cambio: aNumero(r.tasa_cambio),
    total_debe: monedaExacta(r.total_debe),
    total_haber: monedaExacta(r.total_haber),
    es_contra_asiento: Boolean(r.es_contra_asiento),
    asiento_origen: r.asiento_origen != null ? String(r.asiento_origen) : null,
  }));
}

/**
 * Balance de comprobación NIIF.
 *
 * Sin rango de fechas devuelve lo que trae la vista
 * `vw_balance_comprobacion_niif`: una fila por cuenta con el total del debe,
 * el total del haber y el saldo (debe − haber) en la MONEDA DE PRESENTACIÓN.
 *
 * CON RANGO DE FECHAS el balance acumulado no sirve (mezclaría saldos de
 * antes y después del corte), así que se recalcula sobre el DETALLE del
 * rango: se leen las cabeceras del período, después sus líneas, y se agregan
 * por cuenta en CENTAVOS ENTEROS. El resultado es el mismo balance, pero del
 * período pedido.
 */
export async function obtenerBalanceComprobacionNIIF(
  filtros: FiltroBalanceNIIF = {}
): Promise<FilaBalanceNIIF[]> {
  if (!supabase) return [];

  if (!filtros.desde && !filtros.hasta) {
    const { data, error } = await supabase.from("vw_balance_comprobacion_niif").select("*");
    if (error) return [];
    const filas = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      cuenta: String(r.cuenta ?? ""),
      nombre_cuenta: String(r.nombre_cuenta ?? ""),
      moneda_presentacion: String(r.moneda_presentacion ?? "USD"),
      total_debe: monedaExacta(r.total_debe),
      total_haber: monedaExacta(r.total_haber),
      saldo: monedaExacta(r.saldo),
      movimientos: aNumero(r.movimientos),
    }));
    return filtrarBalanceNIIF(filas, filtros);
  }

  // Detalle del período: cabeceras primero (para quedarse con los ids) y
  // después las líneas de esos asientos.
  let qCab = supabase.from("asientos_niif").select("id, fecha, moneda_presentacion");
  if (filtros.desde) qCab = qCab.gte("fecha", filtros.desde);
  if (filtros.hasta) qCab = qCab.lte("fecha", filtros.hasta);
  const { data: cab, error: errCab } = await qCab;
  if (errCab) return [];

  const cabeceras = (cab ?? []) as Array<Record<string, unknown>>;
  if (cabeceras.length === 0) return [];

  const idDeCabecera = new Map<string, string>();
  cabeceras.forEach((c) => idDeCabecera.set(String(c.id), String(c.moneda_presentacion ?? "USD")));

  const { data: lins, error: errLins } = await supabase
    .from("asientos_niif_lineas")
    .select("asiento_id, cuenta, nombre_cuenta, debe_presentacion, haber_presentacion")
    .in(
      "asiento_id",
      Array.from(idDeCabecera.keys())
    );
  if (errLins) return [];

  // Agregado por cuenta, en CENTAVOS ENTEROS (la vista agrega en `numeric`,
  // que también es decimal exacto: los dos caminos dan el mismo número).
  const mapa = new Map<
    string,
    { cuenta: string; nombre_cuenta: string; moneda: string; debe: number; haber: number; mov: number }
  >();
  ((lins ?? []) as Array<Record<string, unknown>>).forEach((l) => {
    const asientoId = String(l.asiento_id ?? "");
    const cuenta = String(l.cuenta ?? "");
    const clave = `${cuenta}|${idDeCabecera.get(asientoId) ?? "USD"}`;
    const fila = mapa.get(clave) ?? {
      cuenta,
      nombre_cuenta: String(l.nombre_cuenta ?? ""),
      moneda: idDeCabecera.get(asientoId) ?? "USD",
      debe: 0,
      haber: 0,
      mov: 0,
    };
    fila.debe += Math.round(monedaExacta(l.debe_presentacion) * 100);
    fila.haber += Math.round(monedaExacta(l.haber_presentacion) * 100);
    fila.mov += 1;
    mapa.set(clave, fila);
  });

  const filasPeriodo = Array.from(mapa.values()).map((f) => ({
    cuenta: f.cuenta,
    nombre_cuenta: f.nombre_cuenta,
    moneda_presentacion: f.moneda,
    total_debe: f.debe / 100,
    total_haber: f.haber / 100,
    saldo: (f.debe - f.haber) / 100,
    movimientos: f.mov,
  }));
  return filtrarBalanceNIIF(filasPeriodo, filtros);
}
/**
 * Filtra las filas del balance por texto y por moneda.
 *
 * Va SEPARADO de la consulta a propósito: el balance son pocas filas (un
 * renglón por cuenta) y filtrar en memoria es instantánea y exacto. Filtrar
 * en la base obligaría a repetir la agregación por cada tecla.
 */
export function filtrarBalanceNIIF(
  filas: FilaBalanceNIIF[],
  filtros: { texto?: string; moneda?: string }
): FilaBalanceNIIF[] {
  const texto = String(filtros.texto ?? "").trim().toUpperCase();
  const moneda = String(filtros.moneda ?? "").trim().toUpperCase();
  return filas.filter((f) => {
    if (moneda && f.moneda_presentacion.toUpperCase() !== moneda) return false;
    if (!texto) return true;
    return `${f.cuenta} ${f.nombre_cuenta}`.toUpperCase().includes(texto);
  });
}

/**
 * Comisión de un movimiento, calculada con aritmética EXACTA en centavos.
 *
 * Se expone acá porque la comisión es el número que más veces se ha reportado
 * "distinto" según dónde se mirara (la del ticket, la del liquidado y la del
 * reporte de comisiones): se calcula en UNA sola función y el total cuadra.
 */
export function calcularComision(montoBruto: number, porcentaje: number): number {
  return calcularComisionExacta(montoBruto, porcentaje);
}

