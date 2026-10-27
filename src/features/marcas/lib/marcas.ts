/**
 * MODULO MARCAS — acceso a datos (config CRUD, venta y liquidación).
 *
 * La jerarquía y la matemática viven en `./marcas/jerarquia` (lógica pura, sin
 * dependencias). Este archivo solo habla con Supabase.
 *
 * El dinero nunca se toca desde el navegador: la venta y la liquidación son
 * RPCs que debitan/abonan dentro de una transacción. Aquí no hay ni un solo
 * `update` a `clientes.saldo_actual`, porque un doble descuento es exactamente
 * el bug que ya se corrigió en el reembolso por retiro.
 */

import { supabase } from "@/core/supabase";
import { exigirCapacidad } from "@/features/seguridad/lib/vigente";
import { listarClientesVenta, listarGruposVenta, type ClienteVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { listarCarrerasCentrales, type CarreraCentral, type EjemplarCarreraCentral } from "@/features/carreras/lib/central";
import {
  faltantesEnOrden,
  numeroCaballoMarca,
  parsearOrden,
  separarNumeros,
} from "@/features/marcas/lib/jerarquia";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";

export * from "@/features/marcas/lib/jerarquia";
export {
  revisarConfig,
  candidatosAMarca,
  buscarEjemplar,
  etiquetaCaballo,
  indicePorNumero,
  type RevisionConfig,
} from "@/features/marcas/lib/registradas";
export { listarGruposVenta, listarClientesVenta };
export type { GrupoVenta, ClienteVenta };

/** Se avisa con un mensaje claro si la RPC no está instalada. */
const MENSAJE_SIN_RPC =
  "Falta la RPC club_vender_marca en Supabase. Ejecuta sql/marcas_venta.sql en el SQL Editor.";

export type ConfigMarcas = {
  id: number;
  hipodromo: string;
  fecha: string;
  carrera: number;
  marcas: string;
  nv: string;
  /** Numeros marcados como debutantes de la carrera, separados por "/". */
  debutantes: string;
  /**
   * Si los debutantes "valen". En `false` se comportan EXACTAMENTE como un NV:
   * no se pueden jugar y no cuentan como rivales validos.
   */
  debutantes_valen: boolean;
  estado: string;
  updated_at: string;
};

type RowMarcasCarrera = ConfigMarcas & Record<string, unknown>;

function mapeaConfig(fila: RowMarcasCarrera): ConfigMarcas {
  return {
    id: Number(fila.id),
    hipodromo: String(fila.hipodromo ?? ""),
    fecha: String(fila.fecha ?? ""),
    carrera: Number(fila.carrera),
    marcas: String(fila.marcas ?? ""),
    nv: String(fila.nv ?? ""),
    debutantes: String(fila.debutantes ?? ""),
    // Solo un `false` explicito apaga el switch. Antes de que exista la columna,
    // el SELECT no la trae y el valor llega `undefined`: tratar eso como "no
    // valen" dejaria la columna en off sola, sin que nadie la haya tocado.
    debutantes_valen: fila.debutantes_valen !== false,
    estado: String(fila.estado ?? "Abierta"),
    updated_at: String(fila.updated_at ?? ""),
  };
}

// ===========================================================================
// CRUD DE CONFIGURACIÓN
// ===========================================================================

export async function listarConfigMarcas(filtros?: {
  dia?: string;
  hipodromo?: string;
}): Promise<ConfigMarcas[]> {
  if (!supabase) return [];
  let q = supabase.from("marcas_carrera").select("*");
  if (filtros?.dia) q = q.eq("fecha", filtros.dia);
  if (filtros?.hipodromo) q = q.ilike("hipodromo", filtros.hipodromo);
  const { data, error } = await q.order("carrera", { ascending: true });
  if (error) return [];
  return ((data ?? []) as RowMarcasCarrera[]).map(mapeaConfig);
}

export async function leerConfigMarcas(
  hipodromo: string,
  fecha: string,
  carrera: number
): Promise<ConfigMarcas | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("marcas_carrera")
    .select("*")
    .ilike("hipodromo", String(hipodromo ?? "").trim())
    .eq("fecha", fecha)
    .eq("carrera", carrera)
    .maybeSingle();
  if (error || !data) return null;
  return mapeaConfig(data as RowMarcasCarrera);
}

export type GuardarConfigMarcas = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  marcas: string;
  nv: string;
  /** Numeros de debutantes separados por "/". Vacio si la carrera no tiene. */
  debutantes?: string;
  /** Por defecto `true`. Pasar `false` es lo que mete a los debutantes al NV. */
  debutantes_valen?: boolean;
  estado?: string;
};

/**
 * Crea o actualiza la configuración de una carrera (upsert por
 * hipodromo+fecha+carrera).
 *
 * Editar `marcas` NO altera los tickets ya vendidos: el snapshot de rivales
 * quedó dentro del ticket al vender, y la liquidación lee ese snapshot.
 */
export async function guardarConfigMarcas(
  cfg: GuardarConfigMarcas
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("marcas:fn_guardar_marcas");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const hipo = String(cfg.hipodromo ?? "").trim().toUpperCase();
  if (!hipo) return { ok: false, error: "Indique el hipódromo." };
  if (!cfg.fecha) return { ok: false, error: "Indique la fecha." };
  if (!Number(cfg.carrera)) return { ok: false, error: "Indique la carrera." };
  if (!String(cfg.marcas ?? "").trim()) {
    return { ok: false, error: "Defina al menos una marca (favorito) para la carrera." };
  }

  const { data, error } = await supabase
    .from("marcas_carrera")
    .upsert(
      {
        hipodromo: hipo,
        fecha: cfg.fecha,
        carrera: Number(cfg.carrera),
        marcas: String(cfg.marcas).trim(),
        nv: String(cfg.nv ?? "").trim(),
        debutantes: String(cfg.debutantes ?? "").trim(),
        debutantes_valen: cfg.debutantes_valen !== false,
        estado: cfg.estado ?? "Abierta",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hipodromo,fecha,carrera" }
    )
    .select("id")
    .single();
    if (error) return { ok: false, error: explicaErrorColumnas(error.message) };
    return { ok: true, id: (data as { id?: number } | null)?.id };
}

/**
 * Si la base todavia no tiene las columnas de debutantes, el upsert falla con
 * un error de Postgres que no le dice al operador que hay que correr un SQL. Se
 * traduce para que el mensaje apunte a la causa real en vez de dejar al caja
 * creyendo que se rompio la aplicacion.
 */
function explicaErrorColumnas(mensaje: string): string {
  if (/column .*debutantes.* does not exist/i.test(mensaje)) {
    return "La tabla marcas_carrera no tiene las columnas de debutantes. Ejecuta sql/marcas_venta.sql en el SQL Editor de Supabase y vuelve a intentar.";
  }
  return mensaje;
}

export async function eliminarConfigMarcas(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { error } = await supabase.from("marcas_carrera").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Abre o cierra las ventas de la carrera sin borrar la configuración. */
export async function cambiarEstadoMarcas(
  id: number,
  estado: "Abierta" | "Cerrada"
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { error } = await supabase
    .from("marcas_carrera")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ===========================================================================
// VENTA
// ===========================================================================

export type VentaMarcas = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballo: string;
  /**
   * EL rival del match: UN solo numero, elegido por el operador de entre los
   * que el caballo tiene legales a su izquierda. La RPC lo revalida contra la
   * jerarquia: si no es legal, la venta se rechaza en vez de aceptar un rival
   * que el navegador se invento.
   */
  rival: string;
  monto: number;
  clienteId: string;
  grupoId: string;
  usuario?: string;
  /**
   * Clave de idempotencia. Si se repite la llamada con la misma clave, la RPC
   * devuelve el ticket ya creado SIN descontar de nuevo.
   */
  idempotencia?: string;
};

export type ResultadoVentaMarcas = {
  ok: boolean;
  ticketId?: number;
  rivales?: string[];
  tipo?: string;
  pagoBruto?: number;
  saldoRestante?: number;
  error?: string;
};

/**
 * Emite el ticket inmutable y descuenta el saldo.
 *
 * Ambas cosas ocurren en `club_vender_marca`, en una sola transacción. Si algo
 * falla, no queda ni el descuento ni el ticket.
 */
export async function venderMarca(v: VentaMarcas): Promise<ResultadoVentaMarcas> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { data, error } = await supabase.rpc("club_vender_marca", {
    p_hipodromo: String(v.hipodromo ?? "").trim().toUpperCase(),
    p_carrera: Number(v.carrera) || 0,
    p_fecha: v.fecha,
    p_caballo: String(v.caballo ?? "").trim(),
    p_rival: String(v.rival ?? "").trim(),
    p_monto: Number(v.monto) || 0,
    p_cliente_id: v.clienteId,
    p_grupo_id: v.grupoId || null,
    p_usuario: v.usuario ?? null,
    p_idem: v.idempotencia ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return { ok: false, error: /club_vender_marca|not found|404/i.test(texto) ? MENSAJE_SIN_RPC : texto };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ticket_id != null) {
    try {
      await supabase
        .from("tickets_apuestas")
        .update({ cliente_consigue_nombre: "MARCAS" })
        .eq("id", r.ticket_id as never);
    } catch {
      /* best-effort */
    }
  }
  return {
    ok: true,
    ticketId: r.ticket_id as number | undefined,
    rivales: (r.rivales as string[]) ?? [],
    tipo: r.tipo as string | undefined,
    pagoBruto: r.pago_bruto as number | undefined,
    saldoRestante: r.saldo_restante as number | undefined,
  };
}

export type ResultadoLiquidacionMarcas = {
  ok: boolean;
  liquidados?: number;
  ganadores?: number;
  perdedores?: number;
  reintegrados?: number;
  /** Comisión retenida a la banca en la liquidación, si la RPC la reporta. */
  gananciaTotal?: number;
  error?: string;
};

  /**
   * Clave de idempotencia para una venta.
   *
   * Se genera UNA vez por jugada y se reutiliza en los reintentos: si supabase
   * corta la respuesta y el cliente repite el POST, la RPC reconoce la clave y
   * devuelve el ticket ya creado en vez de descontar el monto por segunda vez.
   * El respaldo existe porque `crypto.randomUUID` no existe fuera de un
   * contexto seguro (http:// en un IP viejo).
   */
  export function claveIdempotencia(): string {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return `marca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

/**
 * Caballos que faltan en el orden de llegada para poder liquidar las marcas.
 *
 * La RPC aborta en el PRIMER ausente y no mueve saldo. Eso protege la plata,
 * pero deja al operador adivinando cual caballo falta: este chequeo lee los
 * tickets Pendientes y el resultado oficial antes de llamar a la RPC, y
 * devuelve la lista completa. Si la vista `v_jugadas_carrera` no existe o el
 * usuario no ve los tickets (RLS), se devuelve vacio y la RPC sigue siendo la
 * que decide.
 */
/**
 * Extrae los rivales de una jugada de Marca desde `nota_auditoria.rivales_snapshot`
 * o como respaldo desde el texto de `caballo` / `nombre_jugada` (ej. "2 x 8", "MARCA 2 vs 8").
 */
function extraerRivalesTicketMarca(t: Record<string, unknown>, cabElegido: string): string[] {
  let nota: unknown = t.nota_auditoria;
  if (typeof nota === "string") {
    try {
      nota = JSON.parse(nota);
    } catch {
      nota = null;
    }
  }
  if (nota && typeof nota === "object" && Array.isArray((nota as Record<string, unknown>).rivales_snapshot)) {
    const snap = ((nota as Record<string, unknown>).rivales_snapshot as unknown[])
      .map((r) => numeroCaballoMarca(r))
      .filter((n): n is string => Boolean(n && n !== cabElegido));
    if (snap.length > 0) return snap;
  }
  const numsCab = (String(t.caballo ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
  const rivalesCab = numsCab.filter((n, idx) => idx > 0 && n !== cabElegido);
  if (rivalesCab.length > 0) return rivalesCab;
  const numsJug = (String(t.nombre_jugada ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
  return numsJug.filter((n) => n !== cabElegido);
}

/**
 * Liquida las marcas de una carrera contra el orden de llegada / pizarra oficial,
 * ejecutando el PAGO (al jugador ganador) y COBRO (al usuario del sistema `MARCAS`)
 * según el resultado de la carrera.
 */
export async function liquidarMarcas(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<ResultadoLiquidacionMarcas> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("marcas:fn_liquidar_marcas");
  } catch (e) {
    return { ok: false, error: (e as Error).message } as ResultadoLiquidacionMarcas;
  }

  const sdb = supabase;
  const hip = String(hipodromo ?? "").trim().toUpperCase();
  const dia = String(fecha ?? "").slice(0, 10);
  const nCarrera = Number(carrera) || 0;
  if (!hip || !dia || !nCarrera) {
    return { ok: false, error: "Hipódromo, fecha o carrera inválidos." };
  }

  // 1) Leer resultado oficial de la carrera (`orden_llegada`, `ganadores`, `retirados`, `caballos`).
  const { data: res, error: er } = await sdb
    .from("resultados_carreras")
    .select("orden_llegada, ganadores, retirados, caballos")
    .ilike("hipodromo", `%${hip}%`)
    .eq("fecha", dia)
    .eq("carrera", nCarrera)
    .maybeSingle();

  if (er || !res) {
    return { ok: false, error: er?.message ?? "La carrera aún no tiene resultado cargado." };
  }

  const puestos = new Map<string, number>();
  const ordenArr = Array.isArray(res.orden_llegada)
    ? (res.orden_llegada as Array<unknown>)
    : [];
  ordenArr.forEach((item, idx) => {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const num = String(obj.numero ?? "").trim();
      const p = Number(obj.puesto ?? idx + 1);
      if (num && Number.isFinite(p) && p > 0 && !puestos.has(num)) {
        puestos.set(num, p);
      }
    } else {
      const num = String(item ?? "").trim();
      if (num && !puestos.has(num)) {
        puestos.set(num, idx + 1);
      }
    }
  });
  if (puestos.size === 0 && Array.isArray(res.ganadores)) {
    (res.ganadores as Array<unknown>).forEach((g, idx) => {
      const num = String(g ?? "").trim();
      if (num && !puestos.has(num)) puestos.set(num, idx + 1);
    });
  }

  if (puestos.size === 0) {
    return { ok: false, error: "La carrera no tiene orden de llegada ni pizarra oficial cargada." };
  }

  const retirados = new Set<string>();
  for (const c of (Array.isArray(res.caballos) ? res.caballos : []) as Array<Record<string, unknown>>) {
    if (c.retirado === true) {
      const n = String(c.numero ?? "").trim();
      if (n) retirados.add(n);
    }
  }
  for (const m of String(res.retirados ?? "").match(/\d+/g) ?? []) retirados.add(m);

  // 2) Leer tickets de MARCA pendientes de la carrera.
  const { data: rawTickets, error: et } = await sdb
    .from("tickets_apuestas")
    .select("*")
    .ilike("hipodromo", `%${hip}%`)
    .eq("carrera", nCarrera)
    .ilike("nombre_jugada", "MARCA%")
    .limit(1000);

  if (et) return { ok: false, error: et.message };

  const ticketsPendientes = ((rawTickets ?? []) as Array<Record<string, unknown>>).filter((t) => {
    if (Boolean(t.anulada)) return false;
    const est = String(t.estado ?? "").trim().toUpperCase();
    if (est !== "PENDIENTE" && est !== "ACTIVA" && est !== "ABIERTA" && est !== "") return false;
    let fechaTicket = String(t.fecha_registro ?? "").slice(0, 10);
    try {
      const nota = typeof t.nota_auditoria === "string" ? JSON.parse(t.nota_auditoria) : t.nota_auditoria;
      if (nota && typeof nota === "object" && (nota as Record<string, unknown>).fecha_carrera) {
        fechaTicket = String((nota as Record<string, unknown>).fecha_carrera).slice(0, 10);
      }
    } catch {
      /* ignore */
    }
    return !fechaTicket || fechaTicket === dia;
  });

  if (ticketsPendientes.length === 0) {
    return { ok: true, liquidados: 0, ganadores: 0, perdedores: 0, reintegrados: 0, gananciaTotal: 0 };
  }

  // 3) Asegurar usuario `MARCAS` en `public.clientes` para imputarle el pago/cobro.
  let idUsuarioMarcas: string | number | null = null;
  let saldoUsuarioMarcas = 0;
  try {
    const { data: cliMarcas } = await sdb
      .from("clientes")
      .select("id, saldo_actual")
      .ilike("nombre", "MARCAS")
      .limit(1)
      .maybeSingle();
    if (cliMarcas?.id != null) {
      idUsuarioMarcas = cliMarcas.id as string | number;
      saldoUsuarioMarcas = Number(cliMarcas.saldo_actual ?? 0) || 0;
    } else {
      const grupoSample = ticketsPendientes.find((t) => t.grupo_cobro_id != null)?.grupo_cobro_id ?? null;
      const { data: creado } = await sdb
        .from("clientes")
        .insert([
          {
            nombre: "MARCAS",
            seudonimo: "MARCAS",
            modo_juego: "libre",
            libre: true,
            saldo_actual: 0,
            aval: 0,
            ...(grupoSample != null ? { grupo_id: grupoSample } : {}),
          },
        ])
        .select("id, saldo_actual")
        .maybeSingle();
      if (creado?.id != null) {
        idUsuarioMarcas = creado.id as string | number;
        saldoUsuarioMarcas = Number(creado.saldo_actual ?? 0) || 0;
      }
    }
  } catch {
    /* best-effort */
  }

  // 4) Evaluar cada ticket de Marca y acumular deltas de saldo por jugador y para `MARCAS`.
  let liquidados = 0;
  let ganadores = 0;
  let perdedores = 0;
  let reintegrados = 0;
  let gananciaCasaTotal = 0;
  let deltaUsuarioMarcas = 0;
  const deltaPorJugador = new Map<string, number>();

  const acumularJugador = (clienteId: unknown, delta: number) => {
    if (clienteId == null || !Number.isFinite(delta) || Math.abs(delta) < 0.005) return;
    const k = String(clienteId);
    deltaPorJugador.set(k, Math.round(((deltaPorJugador.get(k) ?? 0) + delta) * 100) / 100);
  };

  for (const t of ticketsPendientes) {
    const idTicket = t.id;
    const monto = Math.round((Number(t.monto_jugado ?? 0) || 0) * 100) / 100;
    const tasaCom =
      t.comision_porcentaje != null && String(t.comision_porcentaje).trim() !== ""
        ? Number(t.comision_porcentaje)
        : 5;
    const cab = numeroCaballoMarca(t.caballo, t.ejemplar_numero) ?? "";
    const rivales = extraerRivalesTicketMarca(t, cab);

    const hayRetiro = (cab && retirados.has(cab)) || rivales.some((rv) => retirados.has(rv));
    if (hayRetiro) {
      liquidados += 1;
      reintegrados += 1;
      acumularJugador(t.cliente_juega_id, monto);
      await sdb
        .from("tickets_apuestas")
        .update({
          estado: "Retirado",
          premio_pagar: 0,
          monto_decidido: 0,
          comision_pagada: 0,
          cliente_consigue_nombre: "MARCAS",
          ...(idUsuarioMarcas != null ? { cliente_consigue_id: idUsuarioMarcas } : {}),
        })
        .eq("id", idTicket as never);
      continue;
    }

    const pCab = cab && puestos.has(cab) ? puestos.get(cab)! : null;
    const pRivales = rivales.map((rv) => (puestos.has(rv) ? puestos.get(rv)! : null));

    // Regla de decisión:
    // - Gana el ejemplar jugado si figura en la llegada/pizarra y todos sus rivales
    //   llegaron detrás de él o quedaron fuera de la pizarra.
    // - Pierde el ejemplar jugado si algún rival figura en la llegada/pizarra delante
    //   (o empatado) con él, o si el rival entró en pizarra y el jugado quedó fuera.
    let gana: boolean | null = null;
    if (pCab !== null && (pRivales.length === 0 || pRivales.every((pr) => pr === null || pCab < pr))) {
      gana = true;
    } else if (pRivales.some((pr) => pr !== null && (pCab === null || pr <= pCab))) {
      gana = false;
    } else {
      // Ninguno de los dos ejemplares entró en pizarra → se reintegra (0/0).
      liquidados += 1;
      reintegrados += 1;
      acumularJugador(t.cliente_juega_id, monto);
      await sdb
        .from("tickets_apuestas")
        .update({
          estado: "Retirado",
          premio_pagar: 0,
          monto_decidido: 0,
          comision_pagada: 0,
          cliente_consigue_nombre: "MARCAS",
          ...(idUsuarioMarcas != null ? { cliente_consigue_id: idUsuarioMarcas } : {}),
        })
        .eq("id", idTicket as never);
      continue;
    }

    if (gana) {
      // PAGO DE LA MARCA: Jugador cobra proporción 5/6 íntegra (+ recupera su capital `monto`).
      // Usuario `MARCAS` paga `pagoMarca + comisionGrupo(pagoMarca)`.
      const pagoMarca = Math.round(((monto * 5) / 6) * 100) / 100;
      const bruto = Math.round((monto + pagoMarca) * 100) / 100;
      const comGrupo = Math.round(pagoMarca * (tasaCom / 100) * 100) / 100;

      liquidados += 1;
      ganadores += 1;
      gananciaCasaTotal = Math.round((gananciaCasaTotal + comGrupo) * 100) / 100;
      acumularJugador(t.cliente_juega_id, bruto);
      deltaUsuarioMarcas = Math.round((deltaUsuarioMarcas - (pagoMarca + comGrupo)) * 100) / 100;

      await sdb
        .from("tickets_apuestas")
        .update({
          estado: "Ganador",
          premio_pagar: bruto,
          monto_decidido: bruto,
          comision_pagada: comGrupo,
          cliente_consigue_nombre: "MARCAS",
          ...(idUsuarioMarcas != null ? { cliente_consigue_id: idUsuarioMarcas } : {}),
        })
        .eq("id", idTicket as never);
    } else {
      // COBRO DE LA MARCA: Jugador pierde `monto` (ya descontado al vender).
      // Usuario `MARCAS` cobra `monto - comisionGrupo(monto)`.
      const comGrupo = Math.round(monto * (tasaCom / 100) * 100) / 100;
      const cobroNetoMarcas = Math.round((monto - comGrupo) * 100) / 100;

      liquidados += 1;
      perdedores += 1;
      gananciaCasaTotal = Math.round((gananciaCasaTotal + comGrupo) * 100) / 100;
      deltaUsuarioMarcas = Math.round((deltaUsuarioMarcas + cobroNetoMarcas) * 100) / 100;

      await sdb
        .from("tickets_apuestas")
        .update({
          estado: "Perdedor",
          premio_pagar: 0,
          monto_decidido: 0,
          comision_pagada: comGrupo,
          cliente_consigue_nombre: "MARCAS",
          ...(idUsuarioMarcas != null ? { cliente_consigue_id: idUsuarioMarcas } : {}),
        })
        .eq("id", idTicket as never);
    }
  }

  // 5) Aplicar pagos a los jugadores ganadores/reintegrados en `public.clientes`.
  for (const [clienteId, delta] of deltaPorJugador.entries()) {
    try {
      const { data: cli } = await sdb
        .from("clientes")
        .select("saldo_actual")
        .eq("id", clienteId as never)
        .maybeSingle();
      const actual = Number((cli as { saldo_actual?: unknown } | null)?.saldo_actual ?? 0) || 0;
      await sdb
        .from("clientes")
        .update({ saldo_actual: Math.round((actual + delta) * 100) / 100 })
        .eq("id", clienteId as never);
    } catch {
      /* best-effort */
    }
  }

  // 6) Aplicar pago/cobro neto al usuario `MARCAS` en `public.clientes`.
  if (idUsuarioMarcas != null && Math.abs(deltaUsuarioMarcas) >= 0.005) {
    try {
      await sdb
        .from("clientes")
        .update({ saldo_actual: Math.round((saldoUsuarioMarcas + deltaUsuarioMarcas) * 100) / 100 })
        .eq("id", idUsuarioMarcas as never);
    } catch {
      /* best-effort */
    }
  }

  return {
    ok: true,
    liquidados,
    ganadores,
    perdedores,
    reintegrados,
    gananciaTotal: gananciaCasaTotal,
  };
}

// ===========================================================================
// RESULTADO DE LA CARRERA
// ===========================================================================

export type RegistrarOrden = {
  ok: boolean;
  orden?: Array<{ numero: string; puesto: number }>;
  retirados?: string[];
  error?: string;
};

/**
 * Carga el orden de llegada de la carrera en `resultados_carreras`.
 *
 * Va en su propia RPC y no como parte de la liquidación a propósito: primero se
 * registra el resultado real, después se liquida contra él. Si se hiciera todo de
 * golpe, un error de pago dejaría la carrera marcada como liquidada.
 *
 * Acepta el orden en texto libre ("5, 1, 3" o "5 1 3") porque así lo escribe el
 * operador; `parsearOrden` lo normaliza igual que el servidor.
 */
export async function registrarOrdenLlegada(
  hipodromo: string,
  carrera: number,
  fecha: string,
  ordenTexto: string,
  retiradosTexto?: string
  ): Promise<RegistrarOrden> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("marcas:fn_registrar_orden_llegada");
    } catch (e) {
      return { ok: false, error: (e as Error).message } as RegistrarOrden;
    }
    const orden = parsearOrden(ordenTexto);
  if (orden.length === 0) {
    return { ok: false, error: "Indique el orden de llegada." };
  }
  const retirados = separarNumeros(retiradosTexto);

  const { data, error } = await supabase.rpc("club_registrar_orden_llegada", {
    p_hipodromo: String(hipodromo ?? "").trim().toUpperCase(),
    p_carrera: Number(carrera) || 0,
    p_fecha: fecha,
    p_orden: orden,
    p_retirados: retirados,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return {
      ok: false,
      error: /club_registrar_orden_llegada|not found|404/i.test(texto)
        ? "Falta la RPC club_registrar_orden_llegada en Supabase. Ejecuta sql/marcas_venta.sql."
        : texto,
    };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    orden: (r.orden as Array<{ numero: string; puesto: number }>) ?? orden,
    retirados: (r.retirados as string[]) ?? retirados,
  };
}

// ===========================================================================
// PIZARRA OFICIAL (config + carrera central + resultado)
// ===========================================================================

/**
 * Una fila de la pizarra: lo que la carrera CENTRAL dice (inscritos, retiros,
 * ganador) mas la configuracion de Marcas vigente para esa misma clave.
 *
 * Las dos tablas se cruzan en memoria por `hipodromo + fecha + carrera`, que es
 * la misma clave en las dos. No se hace join en Supabase porque
 * `resultados_carreras` guarda los ejemplares en un jsonb y cada modulo la
 * normaliza a su manera; hacerlo aqui evita que cada pantalla vuelva a
 * inventarse el cruce.
 */
export type PizarraMarca = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  /** La fila completa de la carrera CENTRAL, con distancia, premio y hora. */
  central: CarreraCentral;
  /** Ejemplares inscritos segun la carrera central. */
  caballos: EjemplarCarreraCentral[];
  /** La configuracion de Marcas, o `null` si esa carrera aun no se configuro. */
  config: ConfigMarcas | null;
  /** Numero del ganador ya registrado en la pizarra, si hay resultado. */
  ganador?: string | null;
  /**
   * La configuracion existe pero la carrera NO esta en la jornada central. Pasa
   * cuando se quito la carrera de "Carreras del Dia" despues de ponerle marcas:
   * la fila sigue en `marcas_carrera` y sin marcar esto quedaba invisible e
   * imposible de borrar desde la aplicacion.
   */
  sinCarreraCentral?: boolean;
};

/**
 * Arma la pizarra de un dia cruzando `marcas_carrera` con la carrera CENTRAL.
 *
 * Se incluyen las carreras que todavia no tienen configuracion: el operador
 * tiene que poder abrir el modal y crearla desde ahi. Al reves (config sin
 * carrera central) tambien se incluyen, marcadas para que se note que faltan
 * los ejemplares y la validacion los va a rechazar.
 */
export async function listarPizarraMarcas(filtros: {
  dia: string;
  hipodromo?: string;
}): Promise<{ ok: boolean; filas: PizarraMarca[]; error?: string }> {
  if (!supabase) return { ok: false, filas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = filtros.dia;
  const hipo = String(filtros.hipodromo ?? "").trim().toUpperCase();
  if (!dia) return { ok: false, filas: [], error: "Indique la fecha." };

  const [central, marcas] = await Promise.all([
    listarCarrerasCentrales(dia, hipo || undefined),
    listarConfigMarcas({ dia, ...(hipo ? { hipodromo: hipo } : {}) }),
  ]);
  if (!central.ok) return { ok: false, filas: [], error: central.error };

  const clave = (h: string, c: number) => `${h.trim().toUpperCase()}|${dia}|${c}`;
  const porClave = new Map<string, PizarraMarca>();
  for (const cc of central.datos ?? []) {
    const k = clave(cc.hipodromo, cc.carrera);
    porClave.set(k, {
      hipodromo: cc.hipodromo,
      fecha: dia,
      carrera: cc.carrera,
      central: cc,
      caballos: cc.caballos ?? [],
      // `listarCarrerasCentrales` ya trae los ganadores; `completarGanadores`
      // solo hace falta para el primer puesto, que se lee aqui directamente.
      config: null,
      ganador: cc.ganadores?.[0] ?? null,
    });
  }
  // Configuraciones cuya carrera central todavia no existe: se listan igual para
  // que el operador vea el desajuste en vez de creer que se guardo.
  for (const mc of marcas) {
    const k = clave(mc.hipodromo, mc.carrera);
    const fila = porClave.get(k);
    if (fila) fila.config = mc;
    else
      porClave.set(k, {
        hipodromo: mc.hipodromo,
        fecha: mc.fecha,
        carrera: mc.carrera,
        central: {
          fecha: mc.fecha,
          hipodromo: mc.hipodromo,
          carrera: mc.carrera,
        },
        caballos: [],
        config: mc,
        ganador: null,
        sinCarreraCentral: true,
      });
  }

  const filas = [...porClave.values()].sort((a, b) => a.carrera - b.carrera);
  return { ok: true, filas };
}


// ===========================================================================
// HELPERS DE UI
// ===========================================================================

/** Clientes de un grupo, para el filtro en cascada del modal. */
export function clientesDelGrupo(clientes: ClienteVenta[], grupoId: string): ClienteVenta[] {
  if (!grupoId) return [];
  return clientes.filter((c) => (c.grupos ?? []).map(String).includes(String(grupoId)));
}
