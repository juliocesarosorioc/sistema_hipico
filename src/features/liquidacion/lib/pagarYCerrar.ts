import { liquidarOficial } from "@/features/motores/lib/oficiales";
import { exigirPermiso } from "@/features/seguridad/lib/vigente";
import { cerrarTablaFija } from "@/features/tablas/lib/tablas-fijas";
import { upsertResultadoCentral } from "@/features/carreras/lib/carreras-dia";
import { leerRetirosCarrera } from "@/features/carreras/lib/retiros";
import { ordenLlegadaDePizarra, posicionesDePizarra } from "@/features/liquidacion/lib/posiciones";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem } from "@/features/betting/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { aplicarLiquidacionSaldos, type ResumenSaldos } from "@/features/liquidacion/lib/saldos";
import { liquidarMarcas } from "@/features/marcas/lib/marcas";
import { liquidarTablaFija } from "@/features/tablas/lib/rpc";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";

/**
 * Suma de todos los tickets de la carrera. El comando puede traer el monto al
 * principio ("100 2N"), así que se lee del comando cuando aparece ahí y del
 * campo `monto` cuando no.
 */
function totalDeTickets(tickets: TicketPagar[]): number {
  let total = 0;
  for (const t of tickets) {
    const m = /^(\d+(?:\.\d+)?)\s+/i.exec(String(t.comando ?? "").trim());
    const monto = m ? Number(m[1]) : Number(t.monto);
    if (Number.isFinite(monto)) total += monto;
  }
  return total;
}

export type TicketPagar = {
  comando: string;
  monto: number;
  /** Número del ejemplar apostado (columna CABALLO) — necesario para NINIS. */
  caballo?: string;
  /** Nombre del CLIENTE 1 (el que "juega") — para el neteo de cruces. */
  cliente1?: string;
  /** Nombre del CLIENTE 2 (el que "da") — referencia de la operación. */
  cliente2?: string;
  /** Jerarquía de permisos resuelta por el caller (Carrera → Cliente → Grupo).
   *  false ⇒ el cruce financiero NO recibe descuento de comisión neta
   *  (factura comisión por ticket). undefined ⇒ se permite el neteo. */
  permiteCruces?: boolean;
};

export type ResLiquidarCarrera = {
  ok: boolean;
  motivo: string;
  procesados: Array<{ comando: string; resultado: ResultadoMotor }>;
  totalInvertido: number;
  totalClienteNeto: number;
  balanceBanca: number;
  gananciaCasa: number;
  /** Cantidad de tickets cuyos montos se ajustaron por comisión neta (cruces). */
  neteados?: number;
  /** Liquidación de las TABLAS FIJAS de la carrera (RPC `club_liquidar_tabla_fija`).
   *  Va aparte del motor universal: las tablas pagos `cantidad × premio` con su
   *  propia regla de comisión. `pagado`/`comision` ya vienen sumados al resumen. */
  tablasFijas?: { ok: boolean; tablas: number; pagado: number; comision: number; error?: string };
  tablaCerrada?: { ok: boolean; conteo?: number; error?: string };
  /** Escritura del resultado en `resultados_carreras` (fuente de verdad de
   *  Carreras del Día). Va aparte porque un fallo acá NO puede invalidar una
   *  liquidación cuyos tickets ya se pagaron. */
  resultadoCentral?: { ok: boolean; error?: string };
  /** Liquidación de las jugadas de MARCAS de la carrera (best-effort): al quedar
   *  el resultado oficial se liquidan con `club_liquidar_marca`, que lee el
   *  snapshot de rivales del ticket. Un fallo acá (sin jugadas, sin permiso o
   *  sin orden de llegada) NO invalida la liquidación universal. */
  marcas?: {
    ok: boolean;
    liquidados?: number;
    ganadores?: number;
    perdedores?: number;
    reintegrados?: number;
    error?: string;
  };
};

/** Respuesta vacía con ceros, para cuando la operación ni siquiera arranca. */
function liquidacionVacia(e: Error): ResLiquidarCarrera {
  return {
    ok: false,
    procesados: [],
    motivo: `SIN PERMISO: ${e.message}`,
    totalInvertido: 0,
    totalClienteNeto: 0,
    balanceBanca: 0,
    gananciaCasa: 0,
  };
}

/**
 * Flujo "Pagar Carrera": liquida cada ticket del operador contra el motor
 * UNIVERSAL (líquida NINI, REMATE, PUESTOS, GANADOR, Tablas Fijas con
 * dividendos oficiales de resultados_carreras cuando existen) y, tras procesar
 * con éxito, Cierra automáticamente la Tabla Fija de esa carrera (status →
 * 'Cerrada'). La caché UI se sincroniza marcarCerrada() (sin recargar página).
 */
export async function liquidarCarreraYCerrarTabla(opts: {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  tickets: TicketPagar[];
  tasaComision?: number | null;
  dividendos?: Record<string, number> | null;
  /** Fecha de la JORNADA que se liquida (no necesariamente hoy). */
  fecha?: string;
}): Promise<ResLiquidarCarrera> {
    try {
      // Con contexto, no solo con permiso: el ABAC exige que el operador
      // liquide un hipódromo que sea del SUYO, y que el total de la carrera no
      // pase del tope que él puede firmar. Se evalúa por ticket, porque el tope
      // es por operación y liquidar 20 tickets de a uno esquivaría el control.
      exigirPermiso("gestion_jugadas:fn_liquidar_carrera", {
        hipodromo: opts.hipodromo,
        monto: totalDeTickets(opts.tickets),
      });
    } catch (e) {
      return liquidacionVacia(e as Error);
    }
    const { hipodromo, carrera, pizarra, tickets, tasaComision } = opts;
  // La jornada que se liquida, NO necesariamente hoy. Se usa para retiros, para
  // leer dividendos y para escribir el resultado CENTRAL: con `hoyLocal()` fijo,
  // liquidar una jornada que no es la de hoy guardaba el resultado en el día
  // equivocado y el semáforo (que filtra por la fecha elegida) no cambiaba de
  // color al finalizar.
  const fecha = opts.fecha || hoyLocal();
  const dividendos = opts.dividendos ?? (await dividendosDe(hipodromo, carrera, fecha));

  const procesados: ResLiquidarCarrera["procesados"] = [];
  const metadatos: Array<{ cliente1?: string; caballo: string; monto: number; permiteCruces?: boolean }> = [];
  let totalInvertido = 0;

  for (const t of tickets) {
    // Comando con monto al inicio ("100 2N") o sin monto (Tablas: "TABLA ...").
    const m = /^(\d+(?:\.\d+)?)\s+(.+?)\s*$/i.exec(String(t.comando).trim());
    const monto = m ? parseFloat(m[1]) : t.monto;
    const tipo = m ? m[2].trim().toUpperCase() : String(t.comando).trim().toUpperCase();
    if (!Number.isFinite(monto) || monto <= 0 || !tipo) {
      return {
        ok: false,
        motivo: "Ticket malformado (falta monto): " + t.comando,
        procesados,
        totalInvertido,
        totalClienteNeto: 0,
        balanceBanca: 0,
        gananciaCasa: 0,
        tablaCerrada: { ok: false, error: "Ticket malformado." },
      };
    }
    const ticketMotor: TicketMotor = {
      hipodromo,
      carrera: String(carrera),
      caballo: String(t.caballo ?? "").trim(),
      fechas: [],
      id: "liquidar-" + procesados.length,
      cruces: 1,
      cuota: null,
      total: monto,
      addedAt: 0,
      tipo_jugada: tipo,
      monto,
      puesto_final: typeof pizarra.primero === "number" ? pizarra.primero : firstOrdinal(pizarra.primero),
      pizarra,
      dividendos: dividendos ?? null,
    };

    const res = liquidarOficial(ticketMotor, tasaComision);
    procesados.push({ comando: t.comando, resultado: res });
    metadatos.push({ cliente1: t.cliente1, caballo: String(t.caballo ?? "").trim(), monto, permiteCruces: t.permiteCruces });
    totalInvertido += monto;
  }

  // ── CRUCE FINANCIERO: comisión neta por (cliente1, caballo, carrera) ──
  // La jerarquía Carrera → Cliente → Grupo llega resuelta en cada ticket
  // (permiteCruces). Con permiso en NO no se netea (comisión por ticket).
  // TODO(PLANIFICACIÓN): "INQUIETUDES CON RESPECTO A CRUCES" — pendiente
  // decidir si el permiso en NO además BLOQUEA la operación.
  let neteados = 0;
  const items: NeteoCruceItem[] = procesados.map((p, i) => ({
    cliente: metadatos[i].cliente1 ?? "",
    caballo: metadatos[i].caballo,
    monto: metadatos[i].monto,
    bruto: p.resultado.ok ? p.resultado.totalClienteNeto + p.resultado.gananciaCasa : 0,
    ok: p.resultado.ok,
  }));
  const gruposNeteo = netearComisionCruce(items, carrera, tasaComision);
  const gruposIdx = new Map<string, number[]>();
  for (let i = 0; i < procesados.length; i++) {
    const t = tickets[i];
    if (!(t.cliente1 ?? "").trim() || !(t.caballo ?? "").trim() || t.permiteCruces === false) continue;
    const k = claveCruceFinanciero(carrera, t.cliente1!, t.caballo!);
    const g = gruposNeteo.get(k);
    if (!g || g.conteo < 2) continue;
    const arr = gruposIdx.get(k) ?? [];
    arr.push(i);
    gruposIdx.set(k, arr);
  }
  for (const [k, idxs] of gruposIdx) {
    const grupo = gruposNeteo.get(k)!;
    const oldSum = idxs.reduce((a, i) => a + (procesados[i].resultado.ok ? procesados[i].resultado.gananciaCasa : 0), 0);
    if (oldSum <= 0 || grupo.comisionNeta === oldSum) continue;
    for (const i of idxs) {
      const res = procesados[i].resultado;
      if (!res.ok) continue;
      const bruto = res.totalClienteNeto + res.gananciaCasa;
      const share = res.gananciaCasa / oldSum;
      const nueva = round2(grupo.comisionNeta * share);
      res.totalClienteNeto = round2(bruto - nueva);
      res.balanceBanca = round2(metadatos[i].monto - bruto + nueva);
      res.gananciaCasa = nueva;
      res.motivo = (res.motivo ?? "") + " · comisión neta por cruce (sobre $" + grupo.neto + ")";
      neteados += 1;
    }
  }

  let totalClienteNeto = 0;
  let balanceBanca = 0;
  let gananciaCasa = 0;
  for (const p of procesados) {
    totalClienteNeto += p.resultado.totalClienteNeto;
    balanceBanca += p.resultado.balanceBanca;
    gananciaCasa += p.resultado.gananciaCasa;
  }

  // Resultado CENTRAL. Sin esto, liquidar desde /gestion-jugadas pagaba los
  // tickets y cerraba la tabla, pero la carrera NO llegaba a `resultados_carreras`
  // (la fuente de verdad de Carreras del Día, los semáforos y los saldos): el
  // resultado quedaba solo en memoria y se perdía al recargar. Se escribe antes
  // del cierre y sin abortar si falla, porque los tickets ya están pagados y
  // volver atrás sería peor que un resultado sin centralizar.
  const posiciones = posicionesDePizarra(pizarra);

  // `retirados` es obligatorio en el upsert y se escribe TAL CUAL, asi que hay
  // que releer el actual: mandar un "NO HUBO RETIROS" fijo borraria los retiros
  // ya registrados por la via de retiros al central.
  const retiradosActuales = await leerRetirosCarrera(fecha, hipodromo, carrera);
  const central = await upsertResultadoCentral({
    fecha,
    hipodromo,
    carrera,
    ganadores: posiciones,
    retirados: retiradosActuales.length ? retiradosActuales.join(" ") : "NO HUBO RETIROS",
    cargado_por: "GESTION-JUGADAS",
    // El orden estructurado y los dividendos NO se pueden quedar en el camino:
    // sin ellos la fila central queda con `orden_llegada`/`dividendos` en NULL
    // (era el caso de las 131 filas de producción) y la liquidación de puestos
    // no tiene con qué pagar. Taquilla ya los guardaba; esto lo alinea.
    orden_llegada: ordenLlegadaDePizarra(pizarra),
    dividendos: dividendos ?? null,
  });

  // TABLAS FIJAS: se liquidan por su RPC ANTES de cerrarlas (la RPC solo toca
  // tickets 'Pendiente' de la tabla). Pago = cantidad × premio_por_tabla, con el
  // ajuste por retiros que trae el snapshot de la venta. El motor universal NO
  // sabe resolverlas (el `nombre_jugada` "TABLA FIJA (HIPO Cn)" no trae el Nº de
  // ejemplar), por eso `aplicarLiquidacionSaldos` las excluye y viven acá.
  //
  // Los totales de tabla fija van SEPARADOS del resumen de la sesión (que solo
  // cuenta los tickets cargados en esta pantalla): mezclarlos dejaría el
  // "Balance de la banca" sin su contrapartida de inversión. La venta de tabla
  // fija se cobró en el módulo de Tablas, así que su capital no está en
  // `totalInvertido`; el resumen los muestra en su propia línea.
  let tablasFijas: ResLiquidarCarrera["tablasFijas"];
  try {
    tablasFijas = await liquidarTablasFijasDeCarrera(hipodromo, Number(carrera), pizarra, fecha);
  } catch (e) {
    tablasFijas = { ok: false, tablas: 0, pagado: 0, comision: 0, error: (e as Error).message };
  }

  // AUTO-CIERRE: tras pagar con éxito, cierra la Tabla Fija de la carrera.
  const cierre = await cerrarTablaFija(hipodromo, carrera);
  if (cierre.ok) {
    useTablasFijasStore.getState().marcarCerrada(hipodromo, carrera);
  }

  // MARCAS: con el resultado YA oficial en `resultados_carreras`, se liquidan las
  // jugadas de Marcas de la carrera. Antes esto vivía en la pestaña "Resultado"
  // del modal de Marcas; al centralizar el resultado en un único flujo, la
  // liquidación de Marcas viaja con él para que no quede un cargador por
  // modalidad. Es best-effort e idempotente (solo toca tickets 'Pendiente'
  // `MARCA %`): si no hay jugadas, permiso u orden de llegada, se reporta el
  // motivo SIN abortar una liquidación cuyos tickets ya se pagaron.
  let marcas: ResLiquidarCarrera["marcas"];
  try {
    const rm = await liquidarMarcas(hipodromo, Number(carrera), fecha);
    marcas = {
      ok: rm.ok,
      liquidados: rm.liquidados,
      ganadores: rm.ganadores,
      perdedores: rm.perdedores,
      reintegrados: rm.reintegrados,
      error: rm.error,
    };
  } catch (e) {
    marcas = { ok: false, error: (e as Error).message };
  }

  return {
    ok: true,
    motivo: `Carrera ${hipodromo} C${carrera} liquidada. ${procesados.length} ticket(s).`,
    procesados,
    totalInvertido,
    totalClienteNeto,
    balanceBanca,
    gananciaCasa,
    neteados,
    tablasFijas,
    tablaCerrada: cierre,
    resultadoCentral: central,
    marcas,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * ÍTEM 1 — Re-apertura de una carrera YA LIQUIDADA.
 *
 * Liquida SOLO los tickets nuevos (estado 'Pendiente') que se agregaron DESPUÉS
 * de la liquidación original. A propósito NO reescribe el resultado central ni
 * vuelve a cerrar la tabla: lo ya liquidado quedó en estado
 * Ganador/Perdedor/Retirado y `aplicarLiquidacionSaldos` es idempotente por
 * estado, así que los tickets previos NO se tocan (no se dobla el abono).
 *
 * Se exige la capacidad `gestion_jugadas:fn_reabrir_carrera` (la autorización
 * que pide el dueño para la re-apertura explícita).
 *
 * Además de las jugadas nuevas, re-decide las TABLAS FIJAS de la carrera con su
 * RPC (ver `liquidarTablasFijasDeCarrera`): es el mismo camino que repara una
 * tabla que la liquidación vieja dejó mal.
 */
export async function liquidarPendientesDeCarrera(opts: {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  tasaComision?: number | null;
  dividendos?: Record<string, number> | null;
  fecha?: string;
}): Promise<ResumenSaldos> {
  try {
    exigirPermiso("gestion_jugadas:fn_reabrir_carrera", {
      hipodromo: opts.hipodromo,
      monto: 0,
    });
  } catch (e) {
    const msg = `SIN PERMISO: ${(e as Error).message}`;
    return { ok: false, motivo: msg, aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [msg] };
  }
  const fecha = opts.fecha || hoyLocal();
  const dividendos = opts.dividendos ?? (await dividendosDe(opts.hipodromo, opts.carrera, fecha));
  const resumen = await aplicarLiquidacionSaldos({
    hipodromo: opts.hipodromo,
    carrera: opts.carrera,
    pizarra: opts.pizarra,
    dividendos,
    tasaComision: opts.tasaComision,
    // La JORNADA, no "hoy": la ventana de fecha_registro debe cubrir el día de
    // la carrera que se liquida.
    fecha,
  });

  // Las TABLAS FIJAS no pasan por `aplicarLiquidacionSaldos` (tienen su propia
  // RPC), así que la re-apertura no las tocaba y, si la liquidación vieja las
  // dejó mal, quedaban atascadas. Acá se re-deciden con su regla: es el punto
  // que usa la re-liquidación para reparar una carrera ya liquidada.
  try {
    const tf = await liquidarTablasFijasDeCarrera(opts.hipodromo, Number(opts.carrera), opts.pizarra, fecha);
    if (tf.tablas > 0) {
      resumen.motivo += ` · 🏁 Tablas fijas: ${tf.tablas} liquidada(s), $${tf.pagado} a pagar.`;
    }
    if (!tf.ok && tf.error) resumen.errores.push(`Tablas fijas: ${tf.error}`);
  } catch (e) {
    resumen.errores.push(`Tablas fijas: ${(e as Error).message}`);
  }
  return resumen;
}

function firstOrdinal(primero: unknown): number {
  if (typeof primero === "number") return primero;
  const n = Number.parseInt(String(primero ?? ""), 10);
  return Number.isFinite(n) ? n : 1;
}

/**
 * Liquida por RPC las TABLAS FIJAS abiertas de la carrera y devuelve los totales
 * (lo que se le paga a los jugadores y la comisión del grupo).
 *
 * La liquidación de tabla fija tiene su propia regla —`pago = cantidad_tablas ×
 * premio_por_tabla`, con el premio ajustado por los retiros posteriores a la
 * venta— y su propia RPC transaccional (`club_liquidar_tabla_fija`), que además
 * acredita el saldo del jugador. Por eso NO pasa por el motor universal.
 *
 * Best-effort: si falta permiso, red o no hay tablas, se reporta el motivo sin
 * abortar la liquidación de la carrera (los tickets de sesión ya se pagaron).
 */
async function liquidarTablasFijasDeCarrera(
  hipodromo: string,
  carrera: number,
  pizarra: PizarraCarrera,
  fecha: string,
  usuario?: string | null
): Promise<{ ok: boolean; tablas: number; pagado: number; comision: number; error?: string }> {
  const ganador = String(pizarra.primero ?? "").trim();
  // Dead heat: ganan TODOS los que empataron (la RPC acepta "1,3,4"). Sin
  // ganadores no se toca nada (la tabla queda pendiente a decisión manual).
  const empates = Array.isArray(pizarra.empates) ? pizarra.empates.map((e) => String(e).trim()) : [];
  const ganadores = [ganador, ...empates].filter(Boolean).join(",");
  if (!ganadores) return { ok: true, tablas: 0, pagado: 0, comision: 0 };
  if (!supabase) return { ok: false, tablas: 0, pagado: 0, comision: 0, error: "Sin conexión a Supabase." };

  let ids: Array<string | number> = [];
  const dia = String(fecha).slice(0, 10);
  try {
    // El hipódromo se compara por clave canónica (misma que retiros/matrices): la
    // columna puede venir escrita "LA RINCONADA" o "LA RINCONADA " y un `.eq`
    // texto dejaría la tabla sin liquidar.
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("id, hipodromo, carrera, fecha, fecha_creacion, estado")
      .eq("carrera", carrera)
      .limit(50);
    if (error) throw error;
    const clave = claveHipodromo(hipodromo);
    ids = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((t) => claveHipodromo(String(t.hipodromo ?? "")) === clave)
      .filter((t) => String(t.fecha ?? t.fecha_creacion ?? "").slice(0, 10) === dia)
      // La tabla 'Cerrada' NO se descarta: cerrarla sin liquidar (el flujo viejo
      // cerraba la tabla con el motor universal y dejaba los tickets mal) la
      // dejaba fuera para siempre. La RPC solo toca tickets SIN pagar, así que
      // re-liquidar una tabla cerrada es idempotente y repara lo que quedó mal.
      .map((t) => t.id as string | number);
  } catch (e) {
    return { ok: false, tablas: 0, pagado: 0, comision: 0, error: `Tablas fijas: ${(e as Error).message}` };
  }

  // REPARACIÓN antes de liquidar: los tickets de tabla fija que quedaron
  // 'Perdedor' (la liquidación vieja los decidía con el motor universal, que no
  // lee "TABLA FIJA (HIPO Cn)" y los marcaba perdedores con premio 0) vuelven a
  // 'Pendiente' para que la RPC los re-decida con su regla. Un 'Ganador' NO se
  // toca: ya está pagado (no se duplica el abono). Un perdedor legítimo se vuelve
  // a marcar 'Perdedor' (pago 0), así que el reproceso es idempotente.
  await reabrirTablasFijasMalDecididas(hipodromo, carrera, dia);

  let pagado = 0;
  let comision = 0;
  let tablas = 0;
  const errores: string[] = [];
  for (const id of ids) {
    const r = await liquidarTablaFija({ tablaId: id, ganadores, usuario });
    if (!r.ok) {
      errores.push(r.error ?? "No se pudo liquidar la tabla fija.");
      continue;
    }
    tablas += 1;
    pagado += r.pagado ?? 0;
    comision += r.comision ?? 0;
  }
  return {
    ok: errores.length === 0,
    tablas,
    pagado: round2(pagado),
    comision: round2(comision),
    error: errores.length ? errores[0] : undefined,
  };
}

/**
 * Devuelve a 'Pendiente' los tickets de TABLA FIJA de la jornada que quedaron
 * mal decididos como 'Perdedor'.
 *
 * Por qué existe: antes, la liquidación de la carrera resolvía los tickets de
 * tabla fija con el motor universal. Ese motor lee `nombre_jugada`
 * ("TABLA FIJA (HIPO Cn)"), que NO trae el Nº de ejemplar, así que marcaba al
 * ganador como 'Perdedor' con premio 0. La RPC de tablas solo toca 'Pendiente',
 * de modo que esos tickets quedaban atascados y el pago no aparecía en ningún
 * reporte. Resetearlos deja que la RPC los re-decida bien.
 *
 * Seguro por diseño:
 *   · Solo 'Perdedor': un 'Ganador' ya está pagado y no se toca.
 *   · Un perdedor legítimo se vuelve a marcar 'Perdedor' con pago 0 → sin
 *     cambio de saldo.
 *   · Sin ganadores no se llama (la tabla quedaría para decisión manual).
 *
 * Best-effort: si falla, la RPC igual liquida los que estén 'Pendiente'.
 */
async function reabrirTablasFijasMalDecididas(hipodromo: string, carrera: number, dia: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from("tickets_apuestas")
      .update({ estado: "Pendiente", premio_pagar: 0, monto_decidido: 0, comision_pagada: 0 })
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .like("nombre_jugada", "TABLA FIJA%")
      .eq("estado", "Perdedor")
      .or(filtroDiaJornada(dia));
  } catch {
    // Best-effort: la liquidación sigue con lo que ya esté 'Pendiente'.
  }
}

/** Lee los dividendos oficiales ya persistidos en resultados_carreras
    (fecha + hipódromo + carrera) para cruzar la liquidación universal. */
async function dividendosDe(hipodromo: string, carrera: number | string, fecha?: string): Promise<Record<string, number> | null> {
  if (!supabase) return null;
  try {
    // Fecha LOCAL (no UTC): el dividendo se persistió con la fecha de la
    // jornada que ve el operador (ISO YYYY-MM-DD); con UTC se consultaba el
    // "día anterior" tras las 20:00.
    const f = fecha || hoyLocal();
    const { data } = await supabase
      .from("resultados_carreras")
      .select("dividendos")
      .eq("fecha", f)
      .eq("hipodromo", hipodromo.trim().toUpperCase())
      .eq("carrera", Number(carrera))
      .maybeSingle();
    if (!data || data.dividendos == null || typeof data.dividendos !== "object") return null;
    const div = data.dividendos as Record<string, unknown>;
    const limpio: Record<string, number> = {};
    for (const [k, v] of Object.entries(div)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) limpio[k] = n;
    }
    return Object.keys(limpio).length ? limpio : null;
  } catch {
    return null;
  }
}