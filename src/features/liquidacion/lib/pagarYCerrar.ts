import { liquidarOficial } from "@/features/motores/lib/oficiales";
import { exigirPermiso } from "@/features/seguridad/lib/vigente";
import { cerrarTablaFija } from "@/features/tablas/lib/tablas-fijas";
import { upsertResultadoCentral } from "@/features/carreras/lib/carreras-dia";
import { leerRetirosCarrera, jugadaInvolucraRetirado, normalizarRetirados } from "@/features/carreras/lib/retiros";
import { ordenLlegadaDePizarra, posicionesDePizarra } from "@/features/liquidacion/lib/posiciones";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem, esJugadaDePuestos } from "@/features/betting/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import { supabase } from "@/core/supabase";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { aplicarLiquidacionSaldos, type ResumenSaldos } from "@/features/liquidacion/lib/saldos";
import { liquidarMarcas } from "@/features/marcas/lib/marcas";
import { liquidarDupleta } from "@/features/dupletas/lib/dupletas";
import { liquidarTablaFija } from "@/features/tablas/lib/rpc";
import { calcularFinanzasRemate } from "@/features/remates/lib/core";
import { claveHipodromo } from "@/features/carreras/lib/claves";
import { filtroDiaJornada } from "@/features/liquidacion/lib/fecha";
import { redondearCentavos } from "@/shared/lib/dinero";
import {
  calcularLiquidacionPuestosCarrera,
  type EntradaCrucePuestos,
  type OpcionesCrucesPuestos,
} from "@/features/motores/lib/puestos";

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
  /** Liquidación de las DUPLETAS de la jornada cuya otra carrera ya tiene
   *  resultado (best-effort: `club_liquidar_dupleta` es una sola vía por par de
   *  carreras y solo toca tickets 'Pendiente'). */
  dupletas?: { ok: boolean; liquidadas: number; pagado: number; error?: string };
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
  /** Premio oficial / recalculado de la tabla de la carrera. Se escribe en el
   *  resultado central para que el upsert no lo deje en NULL (viene del objeto
   *  de la tabla, que esta función no conoce). */
  premio_oficial?: number | null;
  premio_recalculado?: number | null;
  /** true = agrupar cruces de PUESTOS por cliente en la carrera. */
  permiteCruces?: boolean;
  /** Jerarquía de modalidades para las jugadas entre tercios. */
  crucesPuestos?: OpcionesCrucesPuestos;
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
  const retPizarra = Array.isArray((pizarra as Record<string, unknown>)?.retirados)
    ? normalizarRetirados((pizarra as { retirados?: Array<string | number> }).retirados)
    : null;
  const [dividendos, retiradosActuales] = await Promise.all([
    opts.dividendos !== undefined ? Promise.resolve(opts.dividendos) : dividendosDe(hipodromo, carrera, fecha),
    retPizarra && retPizarra.length > 0 ? Promise.resolve(retPizarra) : leerRetirosCarrera(fecha, hipodromo, carrera),
  ]);
  const pizarraConRetirados: PizarraCarrera = retiradosActuales.length
    ? ({ ...pizarra, retirados: retiradosActuales } as PizarraCarrera)
    : pizarra;

  const procesados: ResLiquidarCarrera["procesados"] = [];
  const metadatos: Array<{ cliente1?: string; caballo: string; monto: number; tipo: string }> = [];
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
      pizarra: pizarraConRetirados,
      dividendos: dividendos ?? null,
    };

    const res = liquidarOficial(ticketMotor, tasaComision);
    procesados.push({ comando: t.comando, resultado: res });
    t.permiteCruces = opts.permiteCruces !== false;
    metadatos.push({ cliente1: t.cliente1, caballo: String(t.caballo ?? "").trim(), monto, tipo });
    totalInvertido += monto;
  }

  // ── CRUCE FINANCIERO: comisión neta por (cliente1, caballo, carrera) ──
  // La jerarquía Carrera → Cliente → Grupo llega resuelta en cada ticket
  // (permiteCruces). Con permiso en NO no se netea (comisión por ticket).
  // El cruce de PUESTOS se agrupa por cliente en la carrera cuando corresponde.
  const agruparPorCliente =
    typeof opts.permiteCruces === "boolean" ? opts.permiteCruces : true;
  let neteados = 0;
  const usaModalidadesPuestos = opts.crucesPuestos !== undefined;
  const indicesLegados = procesados
    .map((_, i) => i)
    .filter((i) => !usaModalidadesPuestos || !esJugadaDePuestos(metadatos[i].tipo))
    .filter((i) => {
      const r = procesados[i].resultado;
      // Empate NINI (devuelve capital: !ok && totalClienteNeto === monto) no es pérdida para el cruce
      return !(metadatos[i].monto > 0 && !r.ok && Math.abs(r.totalClienteNeto - metadatos[i].monto) < 0.01);
    });
  const items: NeteoCruceItem[] = indicesLegados.map((i) => ({
    cliente: metadatos[i].cliente1 ?? "",
    caballo: metadatos[i].caballo,
    monto: metadatos[i].monto,
    bruto: procesados[i].resultado.ok ? procesados[i].resultado.totalClienteNeto + procesados[i].resultado.gananciaCasa : 0,
    ok: procesados[i].resultado.ok,
  }));
  const gruposNeteo = netearComisionCruce(items, carrera, tasaComision, {
    agruparPorCliente: agruparPorCliente !== false,
    permiteCruces: agruparPorCliente !== false,
  });
  const gruposIdx = new Map<string, number[]>();
  for (let i = 0; i < procesados.length; i++) {
    if (usaModalidadesPuestos && esJugadaDePuestos(metadatos[i].tipo)) continue;
    const t = tickets[i];
    if (!(t.cliente1 ?? "").trim() || (!(t.caballo ?? "").trim() && !(agruparPorCliente !== false))) continue;
    const k =
      agruparPorCliente !== false
        ? [String(carrera ?? "").trim().toUpperCase(), String(t.cliente1!).trim().toUpperCase()].join("::")
        : claveCruceFinanciero(carrera, t.cliente1!, t.caballo!);
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

  if (usaModalidadesPuestos && opts.crucesPuestos) {
    const indicesPorJugador = new Map<string, number[]>();
    for (let i = 0; i < procesados.length; i++) {
      if (!esJugadaDePuestos(metadatos[i].tipo)) continue;
      const nombre = String(metadatos[i].cliente1 ?? "").trim().toUpperCase();
      if (!nombre) continue;
      const idxs = indicesPorJugador.get(nombre) ?? [];
      idxs.push(i);
      indicesPorJugador.set(nombre, idxs);
    }
    for (const [jugador, idxs] of indicesPorJugador) {
      const entradas: EntradaCrucePuestos[] = idxs
        .filter((i) => {
          const r = procesados[i].resultado;
          // Empate NINI (0/0, devuelve capital) no cuenta como pérdida en el cruce
          return !(metadatos[i].monto > 0 && !r.ok && Math.abs(r.totalClienteNeto - metadatos[i].monto) < 0.01);
        })
        .map((i) => ({
          cliente: jugador,
          caballo: metadatos[i].caballo,
          ok: procesados[i].resultado.ok,
          bruto: procesados[i].resultado.ok
            ? procesados[i].resultado.totalClienteNeto + procesados[i].resultado.gananciaCasa
            : 0,
          monto: metadatos[i].monto,
        }));
      const liquidacion = calcularLiquidacionPuestosCarrera(entradas, {
        ...opts.crucesPuestos,
        pctComision: Number(tasaComision ?? 5),
      })[0];
      if (!liquidacion) continue;
      const ganadores = idxs.filter((i) => procesados[i].resultado.ok);
      const comisionOriginal = ganadores.reduce((suma, i) => suma + procesados[i].resultado.gananciaCasa, 0);
      if (ganadores.length === 0 || Math.abs(comisionOriginal - liquidacion.comision) < 0.005) continue;
      let asignado = 0;
      for (const [n, i] of ganadores.entries()) {
        const res = procesados[i].resultado;
        const bruto = res.totalClienteNeto + res.gananciaCasa;
        const nueva = n === ganadores.length - 1
          ? round2(liquidacion.comision - asignado)
          : round2(liquidacion.comision * (comisionOriginal > 0 ? res.gananciaCasa / comisionOriginal : 1 / ganadores.length));
        asignado += nueva;
        res.totalClienteNeto = round2(bruto - nueva);
        res.balanceBanca = round2(metadatos[i].monto - bruto + nueva);
        res.gananciaCasa = nueva;
        if (liquidacion.modalidadesAplicadas.length > 0) {
          const etiquetas = liquidacion.modalidadesAplicadas.map(({ modalidad, origen }) => {
            const tipo = modalidad === "mismoEjemplar" ? "Mismo Ej." : "Dif. Ej.";
            const fuente = origen === "Solo Carrera - Todos"
              ? `Solo Carrera #${carrera} - Todos`
              : origen === "Solo Carrera - Jugador"
                ? `Solo Carrera #${carrera} - Jugador`
                : origen;
            return `⚡ Cruce ${tipo} (${fuente})`;
          });
          res.motivo = `${res.motivo ?? ""} · ${etiquetas.join(" / ")} · ${liquidacion.explicacionCruce ?? "comisión neta"}`;
        }
        neteados += 1;
      }
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

  const central = await upsertResultadoCentral({
    fecha,
    hipodromo,
    carrera,
    ganadores: posiciones,
    retirados: retiradosActuales.length ? retiradosActuales.join(" ") : "NO HUBO RETIROS",
    cargado_por: "GESTION-JUGADAS",
    orden_llegada: ordenLlegadaDePizarra(pizarra),
    dividendos: dividendos ?? null,
    ...(opts.crucesPuestos ? {
      cruces_carrera_override: {
        todos: opts.crucesPuestos.carreraTodosOverride ?? {},
        porJugador: opts.crucesPuestos.carreraPorJugadorOverride ?? {},
      },
    } : {}),
    premio_oficial: opts.premio_oficial ?? undefined,
    premio_recalculado: opts.premio_recalculado ?? undefined,
  });

  // ── LIQUIDACIÓN ÚNICA DE JUGADAS + AUTO-CIERRE EN PARALELO ──────────────────
  const [jugadas, cierre] = await Promise.all([
    liquidarJugadasDeCarrera({
      hipodromo,
      carrera,
      fecha,
      pizarra: pizarraConRetirados,
    }),
    cerrarTablaFija(hipodromo, carrera),
  ]);
  const tablasFijas = jugadas.tablasFijas;
  const marcas = jugadas.marcas;
  if (cierre.ok) {
    useTablasFijasStore.getState().marcarCerrada(hipodromo, carrera);
  }
  marcarEstadoCarreraEnMemoria({
    hipodromo,
    carrera,
    fecha,
    estado: "LIQUIDADA",
  });

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
    dupletas: jugadas.dupletas,
  };
}

function round2(n: number): number {
  return redondearCentavos(n);
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
  // dejó mal, quedaban atascadas. Se re-deciden por el MISMO pipeline que usa la
  // liquidación completa (tablas fijas + marcas + dupletas): es el punto que usa
  // la re-liquidación para reparar una carrera ya liquidada.
  try {
    const jugadas = await liquidarJugadasDeCarrera({
      hipodromo: opts.hipodromo,
      carrera: opts.carrera,
      pizarra: opts.pizarra,
      fecha,
    });
    const tf = jugadas.tablasFijas;
    if (tf.tablas > 0) {
      resumen.motivo += ` · 🏁 Tablas fijas: ${tf.tablas} liquidada(s), $${tf.pagado} a pagar.`;
    }
    if (!tf.ok && tf.error) resumen.errores.push(`Tablas fijas: ${tf.error}`);
    if (!jugadas.marcas.ok && jugadas.marcas.error) resumen.errores.push(`Marcas: ${jugadas.marcas.error}`);
    if (!jugadas.dupletas.ok && jugadas.dupletas.error) resumen.errores.push(`Dupletas: ${jugadas.dupletas.error}`);
  } catch (e) {
    resumen.errores.push(`Jugadas: ${(e as Error).message}`);
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
export async function liquidarTablasFijasDeCarrera(
  hipodromo: string,
  carrera: number,
  pizarra: PizarraCarrera,
  fecha: string,
  usuario?: string | null
): Promise<{ ok: boolean; tablas: number; pagado: number; comision: number; error?: string }> {
  // Regla de negocio: Tablas Fijas y Remates se liquidan por el Orden de Llegada en Raya
  // (el caballo que cruzó la raya primero), aun cuando haya distanciamiento en el Orden Oficial.
  const ganador = String(
    pizarra.primero_raya || pizarra.orden_llegada_raya?.[0] || pizarra.primero || ""
  ).trim();
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
    //
    // La JORNADA se acota EN LA CONSULTA (no con un tope en memoria): sin esto,
    // con el correr de los días el `limit` fijo dejaba afuera la tabla del día
    // (hay muchas tablas con el mismo Nº de carrera en toda la historia) y la
    // carrera no se liquidaba. Se conservan las filas sin `fecha` para el fallback
    // por `fecha_creacion`.
    const { data, error } = await supabase
      .from("tablas_fijas")
      .select("id, hipodromo, carrera, fecha, fecha_creacion, estado")
      .eq("carrera", carrera)
      .or(`fecha.eq.${dia},fecha.is.null`)
      .limit(200);
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

/** Resultado de la liquidación unificada de jugadas de una carrera. */
export type ResumenJugadas = {
  tablasFijas: { ok: boolean; tablas: number; pagado: number; comision: number; error?: string };
  marcas: {
    ok: boolean;
    liquidados?: number;
    ganadores?: number;
    perdedores?: number;
    reintegrados?: number;
    error?: string;
  };
  dupletas: { ok: boolean; liquidadas: number; pagado: number; error?: string };
};

/**
 * LIQUIDACIÓN ÚNICA de las jugadas de una carrera contra el resultado oficial.
 *
 * Todas las modalidades que pagan a partir del resultado —TABLAS FIJAS, MARCAS
 * y DUPLETAS— se liquidan por acá, y todos los módulos que registran un
 * resultado (Gestión de Jugadas, Taquilla, Tablas Fijas, WhatsApp/Remates/
 * Pollas/Marcas vía `CargaResultadosRapida`) terminan llamando a esta misma
 * función. Así no hay dos maneras de pagar: registrar el resultado una vez paga
 * todas las jugadas.
 *
 * Las jugadas de TAQUILLA (GANADOR/PUESTOS/WPS/PAREOS, remates) NO pasan por
 * acá: las paga `aplicarLiquidacionSaldos` sobre los tickets reales de la BD,
 * porque dependen de los dividendos y del capital de la sesión.
 *
 * Best-effort por modalidad: si una falla (permiso, red, RPC ausente) se
 * reporta el motivo SIN abortar las demás ni una liquidación cuyos tickets ya se
 * pagaron.
 */
export async function liquidarJugadasDeCarrera(opts: {
  hipodromo: string;
  carrera: number | string;
  fecha?: string;
  pizarra: PizarraCarrera;
  usuario?: string | null;
}): Promise<ResumenJugadas> {
  const fecha = opts.fecha || hoyLocal();
  const carrera = Number(opts.carrera) || 0;

  const [tablasFijas, marcas, dupletas] = await Promise.all([
    liquidarTablasFijasDeCarrera(opts.hipodromo, carrera, opts.pizarra, fecha, opts.usuario).catch((e) => ({
      ok: false,
      tablas: 0,
      pagado: 0,
      comision: 0,
      error: (e as Error).message,
    })),
    liquidarMarcas(opts.hipodromo, carrera, fecha)
      .then((rm) => ({
        ok: rm.ok,
        liquidados: rm.liquidados,
        ganadores: rm.ganadores,
        perdedores: rm.perdedores,
        reintegrados: rm.reintegrados,
        error: rm.error,
      }))
      .catch((e) => ({ ok: false, error: (e as Error).message })),
    liquidarDupletasDeCarrera(opts.hipodromo, carrera, fecha).catch((e) => ({
      ok: false,
      liquidadas: 0,
      pagado: 0,
      error: (e as Error).message,
    })),
    liquidarRematesDeCarrera(opts.hipodromo, carrera, opts.pizarra, fecha).catch(() => null),
  ]);

  return { tablasFijas, marcas, dupletas };
}

/**
 * Liquida los REMATES de la carrera utilizando el Orden de Llegada en Raya
 * (`primero_raya` / `orden_llegada_raya[0]`, que por defecto es igual al 1° Oficial).
 */
export async function liquidarRematesDeCarrera(
  hipodromo: string,
  carrera: number,
  pizarra: PizarraCarrera,
  fecha: string
): Promise<{ ok: boolean; liquidados: number; pagado: number }> {
  const ganadorRaya = String(
    pizarra.primero_raya || pizarra.orden_llegada_raya?.[0] || pizarra.primero || ""
  ).trim();
  if (!ganadorRaya || !supabase) return { ok: true, liquidados: 0, pagado: 0 };

  const dia = String(fecha).slice(0, 10);
  const clave = claveHipodromo(hipodromo);
  let premioPorRemate = new Map<string, number>();
  let premioDefault = 0;

  try {
    const { data: rematesData } = await supabase
      .from("remates")
      .select("id, hipodromo, carrera, fecha, incentivo, incentivo_pct, comision_pct")
      .eq("carrera", carrera)
      .eq("fecha", dia)
      .limit(50);

    const rematesCarrera = ((rematesData ?? []) as Array<Record<string, unknown>>).filter(
      (r) => claveHipodromo(String(r.hipodromo ?? "")) === clave
    );

    for (const rem of rematesCarrera) {
      const remId = String(rem.id ?? "");
      if (!remId) continue;
      const { data: cabData } = await supabase
        .from("remate_caballos")
        .select("monto_usd")
        .eq("remate_id", remId);
      const fin = calcularFinanzasRemate(
        (cabData ?? []) as Array<{ monto_usd: number }>,
        Number(rem.incentivo) || 0,
        Number(rem.comision_pct ?? 20),
        Number(rem.incentivo_pct) || 0
      );
      if (fin.premioGanador > 0) {
        premioPorRemate.set(remId, fin.premioGanador);
        if (!premioDefault) premioDefault = fin.premioGanador;
      }
    }

    const { data: ticketsData } = await supabase
      .from("tickets_apuestas")
      .select("id, caballo, ejemplar_numero, monto_jugado, premio_pagar, estado, nota_auditoria")
      .eq("carrera", carrera)
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .like("nombre_jugada", "REMATE%")
      .or(filtroDiaJornada(dia));

    const retiradosRem = Array.isArray((pizarra as Record<string, unknown>)?.retirados)
      ? ((pizarra as { retirados?: Array<string | number> }).retirados ?? [])
      : [];

    let liquidados = 0;
    let pagado = 0;
    await Promise.all(
      ((ticketsData ?? []) as Array<Record<string, unknown>>).map(async (tk) => {
        const est = String(tk.estado ?? "").trim().toUpperCase();
        if (est === "RETIRADO" || est === "ANULADO" || est === "ANULADA") return;
        const ej = String(tk.ejemplar_numero ?? tk.caballo ?? "").trim();
        if (retiradosRem.length > 0 && jugadaInvolucraRetirado(tk.caballo, tk.ejemplar_numero, tk.nombre_jugada, retiradosRem)) {
          await supabase!
            .from("tickets_apuestas")
            .update({
              anulada: false,
              estado: "Retirado",
              premio_pagar: 0,
              monto_decidido: 0,
              comision_pagada: 0,
            })
            .eq("id", tk.id);
          liquidados += 1;
          return;
        }
        const esGanadorRaya = ej !== "" && ej === ganadorRaya;
        let remIdNota = "";
        try {
          const notaObj = typeof tk.nota_auditoria === "string" ? JSON.parse(tk.nota_auditoria) : tk.nota_auditoria;
          if (notaObj && typeof notaObj === "object") {
            remIdNota = String((notaObj as Record<string, unknown>).remate_id ?? "");
          }
        } catch {
          /* ignore */
        }
        const premio = (remIdNota && premioPorRemate.get(remIdNota)) || premioDefault || Number(tk.premio_pagar) || 0;
        if (esGanadorRaya && premio > 0) {
          await supabase!
            .from("tickets_apuestas")
            .update({
              estado: "Ganador",
              premio_pagar: premio,
              monto_decidido: premio,
              cliente_consigue_nombre: "REMATES",
              banquero_nombre: "REMATES",
              cliente_consigue_id: null,
              banquero_cliente_id: null,
            })
            .eq("id", tk.id);
          pagado += premio;
        } else {
          await supabase!
            .from("tickets_apuestas")
            .update({
              estado: "Perdedor",
              premio_pagar: 0,
              cliente_consigue_nombre: "REMATES",
              banquero_nombre: "REMATES",
              cliente_consigue_id: null,
              banquero_cliente_id: null,
            })
            .eq("id", tk.id);
        }
        liquidados += 1;
      })
    );
    return { ok: true, liquidados, pagado: round2(pagado) };
  } catch {
    return { ok: false, liquidados: 0, pagado: 0 };
  }
}

/**
 * Liquida las DUPLETAS de la jornada que incluyen esta carrera y cuyas DOS
 * carreras ya tienen resultado. La RPC `club_liquidar_dupleta` es una sola vía
 * por par de carreras y solo toca tickets 'Pendiente', así que reintentar es
 * idempotente.
 *
 * Best-effort: las matrices (`dupletas`) y los resultados (`resultados_carreras`)
 * se leen con la sesión del operador; si la RLS no los deja ver, se devuelve sin
 * liquidar y sin romper el flujo.
 */
export async function liquidarDupletasDeCarrera(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<{ ok: boolean; liquidadas: number; pagado: number; error?: string }> {
  if (!supabase) return { ok: false, liquidadas: 0, pagado: 0, error: "Sin conexión a Supabase." };
  const dia = String(fecha).slice(0, 10);
  const clave = claveHipodromo(hipodromo);

  let pares: Array<{ carrera1: number; carrera2: number }> = [];
  try {
    const { data, error } = await supabase
      .from("dupletas")
      .select("hipodromo, fecha, carrera1, carrera2")
      .eq("fecha", dia)
      .limit(200);
    if (error) throw error;
    pares = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((d) => claveHipodromo(String(d.hipodromo ?? "")) === clave)
      .map((d) => ({ carrera1: Number(d.carrera1), carrera2: Number(d.carrera2) }))
      .filter(
        (d) =>
          Number.isFinite(d.carrera1) &&
          Number.isFinite(d.carrera2) &&
          d.carrera1 !== d.carrera2 &&
          (d.carrera1 === carrera || d.carrera2 === carrera)
      );
  } catch (e) {
    return { ok: false, liquidadas: 0, pagado: 0, error: `Dupletas: ${(e as Error).message}` };
  }
  if (!pares.length) return { ok: true, liquidadas: 0, pagado: 0 };

  // Solo se liquidan las dupletas cuyas DOS carreras ya tienen resultado.
  const conResultado = new Set<number>();
  try {
    const { data } = await supabase
      .from("resultados_carreras")
      .select("carrera")
      .eq("fecha", dia)
      .eq("hipodromo", hipodromo.trim().toUpperCase())
      .limit(500);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const n = Number(r.carrera);
      if (Number.isFinite(n)) conResultado.add(n);
    }
  } catch {
    // Sin poder leer los resultados no se arriesga un pago a medias.
    return { ok: true, liquidadas: 0, pagado: 0 };
  }

  let liquidadas = 0;
  let pagado = 0;
  const errores: string[] = [];
  const vistas = new Set<string>();
  for (const p of pares) {
    const k = `${p.carrera1}x${p.carrera2}`;
    if (vistas.has(k)) continue;
    vistas.add(k);
    if (!conResultado.has(p.carrera1) || !conResultado.has(p.carrera2)) continue;
    const r = await liquidarDupleta({
      hipodromo: hipodromo.trim().toUpperCase(),
      fecha: dia,
      carrera1: p.carrera1,
      carrera2: p.carrera2,
    });
    if (!r.ok) {
      errores.push(r.error ?? "No se pudo liquidar la dupleta.");
      continue;
    }
    liquidadas += 1;
    pagado += r.pagado ?? 0;
  }
  return { ok: errores.length === 0, liquidadas, pagado: round2(pagado), error: errores[0] };
}

import {
  MENSAJE_CARRERA_CERRADA,
  esCarreraCerradaOEnPartida,
  verificarEstadoCarreraParaJugada,
  marcarEstadoCarreraEnMemoria,
} from "@/features/portal/lib/bloqueo-jugadas";

export {
  MENSAJE_CARRERA_CERRADA,
  esCarreraCerradaOEnPartida,
  verificarEstadoCarreraParaJugada,
  marcarEstadoCarreraEnMemoria,
};

export {
  parsearComandoPizarra,
  pizarraDeLlegada,
  ejecutarComandoPizarra,
  MENSAJE_PIZARRA_ANULADA,
  type ComandoPizarra,
  type RespuestaPizarra,
  type PuertoPizarra,
  type EstadoPizarraAgente,
} from "@/features/liquidacion/lib/agente-pizarra";
