/**
 * Saldos — Aplicación TRANSACCIONAL de la liquidación universal sobre el
 * saldo real del cliente (Bloque 3). Firma de seguridad:
 *
 *  - SOLO se "tochan" tickets en estado 'Pendiente' → cada ticket se decide
 *    UNA sola vez (idempotencia real: si la carrera ya fue liquidada, no se
 *    dobla el abono ni se pisan estados).
 *  - El abono al saldo del cliente se hace en el MISMO viaje que el update
 *    del ticket (Promise.all por lote → consistencia al finalizar).
 *  - Cuando se detecta que la carrera ya fue aplicada (tickets en
 *    'Ganador'/'Perdedor'), el lote se anula por seguridad (return ok,
 *    aplicados=0, yaAplicado=true).
 */
import { supabase } from "@/core/supabase";
import { liquidarOficial } from "@/features/motores/lib/oficiales";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { filtroDiaJornada, jornadasDesalineadas } from "@/features/liquidacion/lib/fecha";
import { parsearNini, netearComisionCruce, claveCruceFinanciero, type NeteoCruceItem, esJugadaDePuestos } from "@/features/betting/lib/bettingEngine";
import type { TicketMotor, ResultadoMotor } from "@/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "@/features/liquidacion/lib/liquidacion";
import {
  calcularLiquidacionPuestosCarrera,
  type EntradaCrucePuestos,
  type OpcionesCrucesPuestos,
} from "@/features/motores/lib/puestos";
import { cargarOpcionesCrucesPuestos } from "@/features/gestion/lib/cruces-carrera";
import { redondearCentavos, sumarDinero, restarDinero, formatearMontoSinMoneda } from "@/shared/lib/dinero";
import {
  calcularEstadoCuentaCliente,
  calcularResumenContableCliente,
  calcularIncentivoCarreraCliente,
  type TicketContableRaw,
} from "@/features/saldos/lib/contabilidad-central";
import { generarAsientoDevolucionIncentivo } from "@/features/contabilidad/lib/plan-cuentas";
import { jugadaInvolucraRetirado } from "@/features/carreras/lib/retiros-nucleo";
import { limpiarCacheClientes } from "@/features/clientes/lib/clientes";
import { limpiarCacheClientesVenta } from "@/features/grupos/lib/grupos";

export { calcularEstadoCuentaCliente, calcularResumenContableCliente, calcularIncentivoCarreraCliente };

export type LiquidarSaldosInput = {
  hipodromo: string;
  carrera: number | string;
  pizarra: PizarraCarrera;
  dividendos?: Record<string, number> | null;
  premio_por_tabla?: number | null;
  tasaComision?: number | null;
  /** Jornada (YYYY-MM-DD local) a la que pertenecen los tickets. Si no se pasa,
   *  se usa el día local. Antes SIEMPRE se usaba `hoyLocal()`: al liquidar una
   *  carrera de otra jornada (resultado cargado con retraso) la ventana de
   *  `fecha_registro` no la cubría y la liquidación no encontraba Pendientes. */
  fecha?: string;
  /**
   * Para el cruce de PUESTOS agrupado por cliente (requisito: grupo decide).
   * `true` ⇒ cruce consolidado (compensa todas las jugadas de puestos del
   * cliente en la carrera). `false` ⇒ sin cruces (comisión sobre bruto ganado).
   * Si no se pasa, queda por defecto TRUE para mantener el comportamiento previo
   * cuando se liquida sin pasar este flag (aunque el requisito exige que venga
   * del GRUPO). Esta firma es flexible para las distintas rutas.
   */
  agruparPorClientePuestos?: boolean;
  permiteCruces?: boolean;
  crucesPuestos?: OpcionesCrucesPuestos;
};

export type ResumenSaldos = {
  ok: boolean;
  motivo: string;
  aplicados: number;
  yaAplicado: boolean;
  reembolsos: number;
  abonoTotal: number;
  errores: string[];
};

const NUM = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Fabrica TicketMotor desde una fila de tickets_apuestas. */
export function motorDesdeFila(
  fila: Record<string, unknown>,
  ctx: LiquidarSaldosInput
): TicketMotor {
  const tipo = String(fila.nombre_jugada ?? "JUGADA").trim().toUpperCase();
  const monto = NUM(fila.monto_jugado);
  const rawCab = String(fila.caballo ?? "").trim();
  const numero =
    /\d/.test(rawCab)
      ? rawCab
      : fila.ejemplar_numero != null && String(fila.ejemplar_numero).trim() !== ""
        ? String(fila.ejemplar_numero).trim()
        : rawCab;
  const nini = parsearNini(tipo);
  return {
    hipodromo: ctx.hipodromo,
    carrera: String(ctx.carrera),
    fechas: [],
    id: String(fila.id ?? "fila"),
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: tipo,
    monto,
    caballo: nini ? numero : numero,
    puesto_final: typeof ctx.pizarra.primero === "number" ? ctx.pizarra.primero : parseInt(String(ctx.pizarra.primero ?? ""), 10) || 1,
    pizarra: ctx.pizarra,
    dividendos: ctx.dividendos ?? null,
    // El premio de TABLA viaja con el ticket (se congeló al vender, columna
    // `premio_por_tabla`). Si el caller no lo pasa —re-apertura y, sobre todo,
    // RE-LIQUIDACIÓN de una carrera ya pagada—, se usa el del propio ticket en
    // vez de caer al dividendo genérico o al 2 por defecto: sin esto, recalcular
    // una TABLA pagaría un premio distinto al que se pagó la primera vez.
    premio_por_tabla: ctx.premio_por_tabla != null
      ? ctx.premio_por_tabla
      : fila.premio_por_tabla != null
        ? NUM(fila.premio_por_tabla)
        : null,
  };
}

/**
 * Comisión (%) que corresponde a un ticket: la DEL GRUPO, congelada en
 * `comision_porcentaje` al vender. Si la fila no la trae (tickets viejos o
 * cargas sin grupo), se respalda con la tasa general que pasa el caller. Un 0%
 * EXPLÍCITO es válido (no se confunde con "falta el dato").
 */
export function tasaComisionDeFila(
  fila: Record<string, unknown>,
  respaldo?: number | null
): number {
  const raw = fila.comision_porcentaje;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const f = Number(respaldo);
  return Number.isFinite(f) && f >= 0 ? f : 5;
}

/**
 * Decide cada fila con el motor universal y aplica el neteo de comisión por
 * cruce financiero. Es el corazón de la liquidación: se expone para que la
 * reversión (`revertirLiquidacionCarrera`) calcule EXACTAMENTE igual que la
 * aplicación y no haya deriva entre lo que se abona y lo que se descuenta.
 */
export function decidirTickets(
  filas: unknown[],
  input: LiquidarSaldosInput
): Array<{ fila: Record<string, unknown>; res: ResultadoMotor }> {
  const decisiones: Array<{ fila: Record<string, unknown>; res: ResultadoMotor }> = [];
  for (const fRaw of filas) {
    const fila = fRaw as Record<string, unknown>;
    // Comisión POR TICKET desde su grupo (`comision_porcentaje` congelado): si
    // se usara una tasa única, los grupos con comisión distinta quedarían mal
    // cobrados. El caller sigue siendo el respaldo para tickets sin el dato.
    const tasa = tasaComisionDeFila(fila, input.tasaComision);
    const res = liquidarOficial(motorDesdeFila(fila, input), tasa);
    decisiones.push({ fila, res });
  }

  // ── CRUCE FINANCIERO: comisión neta por (cliente_juega_id, caballo, carrera) ──
  // Mismo neteo que pagarYCerrar: la comisión y las devoluciones se calculan
  // SOLO sobre la ganancia neta del cliente por ejemplar en la carrera.
  const usaModalidadesPuestos = input.crucesPuestos !== undefined;
  const esPuestos = (i: number) =>
    esJugadaDePuestos(String(decisiones[i].fila.nombre_jugada ?? decisiones[i].fila.tipo_jugada ?? ""));
  const items: NeteoCruceItem[] = decisiones
    .filter((_, i) => !usaModalidadesPuestos || !esPuestos(i))
    .filter(({ fila, res }) => {
      const m = NUM(fila.monto_jugado);
      // Empate NINI (devuelve capital: !ok && totalClienteNeto === monto) no es pérdida para el cruce
      return !(m > 0 && !res.ok && Math.abs(res.totalClienteNeto - m) < 0.01);
    })
    .map(({ fila, res }) => ({
    cliente: String(fila.cliente_juega_id ?? "").trim(),
    caballo: String(fila.caballo ?? "").trim(),
    monto: NUM(fila.monto_jugado),
    bruto: res.ok ? res.totalClienteNeto + res.gananciaCasa : 0,
    ok: res.ok,
    tasa: tasaComisionDeFila(fila, input.tasaComision),
    }));
  const gruposNeteo = netearComisionCruce(items, input.carrera, input.tasaComision, {
    agruparPorCliente: input.agruparPorClientePuestos === true || input.permiteCruces !== false,
    permiteCruces: input.permiteCruces !== false,
  });
  if (gruposNeteo.size > 0) {
    const gruposIdx = new Map<string, number[]>();
    for (let i = 0; i < decisiones.length; i++) {
      if (usaModalidadesPuestos && esPuestos(i)) continue;
      const cliente = String(decisiones[i].fila.cliente_juega_id ?? "").trim();
      const caballo = String(decisiones[i].fila.caballo ?? "").trim();
      if (!cliente || (!caballo && (input.agruparPorClientePuestos === true || input.permiteCruces !== false))) {
        // permite agrupar por cliente sin caballo: se construirá clave cliente::carrera
      }
      const k =
        input.agruparPorClientePuestos === true || input.permiteCruces !== false
          ? [String(input.carrera ?? "").trim().toUpperCase(), cliente].join("::")
          : claveCruceFinanciero(input.carrera, cliente, caballo);
      if (!k || !cliente) continue;
      const g = gruposNeteo.get(k);
      if (!g || g.conteo < 2) continue;
      const arr = gruposIdx.get(k) ?? [];
      arr.push(i);
      gruposIdx.set(k, arr);
    }
    for (const [k, idxs] of gruposIdx) {
      const grupo = gruposNeteo.get(k)!;
      const oldSum = idxs.reduce((a, i) => a + (decisiones[i].res.ok ? decisiones[i].res.gananciaCasa : 0), 0);
      if (oldSum <= 0 || grupo.comisionNeta === oldSum) continue;
      for (const i of idxs) {
        const res = decisiones[i].res;
        if (!res.ok) continue;
        const bruto = res.totalClienteNeto + res.gananciaCasa;
        const share = res.gananciaCasa / oldSum;
        const nueva = redondearCentavos(grupo.comisionNeta * share);
        res.totalClienteNeto = restarDinero(bruto, nueva);
        res.balanceBanca = sumarDinero(restarDinero(NUM(decisiones[i].fila.monto_jugado), bruto), nueva);
        res.gananciaCasa = nueva;
      }
    }
  }
  if (usaModalidadesPuestos && input.crucesPuestos) {
    const porJugador = new Map<string, number[]>();
    for (let i = 0; i < decisiones.length; i++) {
      if (!esPuestos(i)) continue;
      const nombre = String(decisiones[i].fila.cliente_juega_id ?? "").trim().toUpperCase();
      if (!nombre) continue;
      const lista = porJugador.get(nombre) ?? [];
      lista.push(i);
      porJugador.set(nombre, lista);
    }
    for (const [jugador, idxs] of porJugador) {
      const entradas: EntradaCrucePuestos[] = idxs
        .filter((i) => {
          const m = NUM(decisiones[i].fila.monto_jugado);
          const r = decisiones[i].res;
          return !(m > 0 && !r.ok && Math.abs(r.totalClienteNeto - m) < 0.01);
        })
        .map((i) => ({
          cliente: jugador,
          caballo: String(decisiones[i].fila.caballo ?? "").trim(),
          ok: decisiones[i].res.ok,
          bruto: decisiones[i].res.ok
            ? decisiones[i].res.totalClienteNeto + decisiones[i].res.gananciaCasa
            : 0,
          monto: NUM(decisiones[i].fila.monto_jugado),
        }));
      const tasa = tasaComisionDeFila(decisiones[idxs[0]].fila, input.tasaComision);
      const liquidacion = calcularLiquidacionPuestosCarrera(entradas, {
        ...input.crucesPuestos,
        pctComision: tasa,
      })[0];
      if (!liquidacion) continue;
      const ganadores = idxs.filter((i) => decisiones[i].res.ok);
      const comisionOriginal = ganadores.reduce((suma, i) => suma + decisiones[i].res.gananciaCasa, 0);
      if (!ganadores.length || Math.abs(comisionOriginal - liquidacion.comision) < 0.005) continue;
      let asignado = 0;
      for (const [n, i] of ganadores.entries()) {
        const res = decisiones[i].res;
        const bruto = res.totalClienteNeto + res.gananciaCasa;
        const nueva = n === ganadores.length - 1
          ? Math.round((liquidacion.comision - asignado) * 100) / 100
          : Math.round(
              liquidacion.comision *
              (comisionOriginal > 0 ? res.gananciaCasa / comisionOriginal : 1 / ganadores.length) *
              100
            ) / 100;
        asignado += nueva;
        res.totalClienteNeto = restarDinero(bruto, nueva);
        res.balanceBanca = sumarDinero(restarDinero(NUM(decisiones[i].fila.monto_jugado), bruto), nueva);
        res.gananciaCasa = nueva;
        if (liquidacion.modalidadesAplicadas.length > 0) {
          const fuente = liquidacion.modalidadesAplicadas.map(({ modalidad, origen }) => {
            const tipo = modalidad === "mismoEjemplar" ? "Mismo Ej." : "Dif. Ej.";
            const regla = origen === "Solo Carrera - Todos"
              ? `Solo Carrera #${input.carrera} - Todos`
              : origen === "Solo Carrera - Jugador"
                ? `Solo Carrera #${input.carrera} - Jugador`
                : origen;
            return `⚡ Cruce ${tipo} (${regla})`;
          }).join(" / ");
          res.motivo = `${res.motivo ?? ""} · ${fuente} · ${liquidacion.explicacionCruce ?? "comisión neta"}`;
        }
      }
    }
  }
  return decisiones;
}

/** Crédito que la liquidación acredita al cliente por un ticket decidido
 *  (0 si perdió; el capital si quedó 'Retirado'/anulado). */
export function creditoDeTicket(res: ResultadoMotor): number {
  if (res.ok) return res.totalClienteNeto;
  return res.totalClienteNeto > 0 ? res.totalClienteNeto : 0;
}

/**
 * Días de jornada (`fecha_carrera`) en los que existen jugadas de la MISMA
 * carrera (hipódromo + número), excluyendo el día esperado.
 *
 * Es la red de seguridad contra el fallo que dejaba a una carrera sin cobrar ni
 * pagar: si las jugadas quedaron archivadas bajo otra jornada, la liquidación de
 * `dia` no las encuentra y —antes— devolvía un OK en verde. Con esto, el motor
 * distingue «esta carrera no tiene jugadas» (OK legítimo) de «las jugadas están
 * en otro día» (ERROR que hay que corregir).
 *
 * La lectura es best-effort: si la consulta falla, devuelve [] para no romper el
 * camino normal (una liquidación sin jugadas sigue siendo válida).
 */
async function jornadasConJugadasDeOtraFecha(
  sdb: NonNullable<typeof supabase>,
  input: LiquidarSaldosInput,
  dia: string
): Promise<string[]> {
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("fecha_carrera")
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .limit(2000);
    if (error) return [];
    const fechas = (data ?? []) as Array<{ fecha_carrera: string | null }>;
    return jornadasDesalineadas(dia, fechas.map((r) => r.fecha_carrera));
  } catch {
    return [];
  }
}

/**
 * Liquida TODOS los tickets Pendientes de una carrera y aplica el resultado
 * en la BD: estado Ganador/Perdedor + premio_pagar + incremento de
 * clientes.saldo_actual del ganador (abono). Return resumen + errores.
 */
export async function aplicarLiquidacionSaldos(
  input: LiquidarSaldosInput
): Promise<ResumenSaldos> {
  if (!supabase) {
    return { ok: false, motivo: "Sin conexión a Supabase", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: ["Sin conexión a Supabase."] };
  }
  const sdb = supabase;
  // Día de la JORNADA: `input.fecha` o, si no se pasa, el día local. El eje es
  // la fecha de la CARRERA (`filtroDiaJornada`), no la de la venta: una jugada
  // cargada hoy para una carrera de otra jornada quedaba 'Pendiente' y la
  // carrera nunca se acreditaba. (Antes se filtraba con `.eq("fecha", f)`, pero
  // `fecha` NO existe en tickets_apuestas: la consulta moría en el catch.)
  const f = input.fecha || hoyLocal();
  const dia = String(f).slice(0, 10);
  let filas: unknown[] = [];
  try {
    const { data, error } = await sdb
      .from("tickets_apuestas")
      .select("*")
      // El día de la JORNADA es el de la CARRERA, no el de la venta (ver
      // `filtroDiaJornada`): una jugada cargada hoy para una carrera de ayer
      // quedaba PENDIENTE y la carrera nunca se acreditaba.
      .or(filtroDiaJornada(dia))
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .eq("estado", "Pendiente")
      // Una jugada ANULADA no se liquida: se excluye del motor. Sin este filtro,
      // anular una jugada dejaba el ticket 'Pendiente' y la re-liquidación lo
      // volvía a decidir/acreditar (la anulación no surtía efecto en el dinero).
      .or("anulada.is.null,anulada.eq.false")
      // Las MARCAS se liquidan con `club_liquidar_marca`, que lee el snapshot de
      // rivales del ticket. Si el motor universal las agarrara, decidiría "quien
      // salga primero" y pagaría a un rival que en la marca iba perdiendo.
      .not("nombre_jugada", "like", "MARCA %")
      // Las TABLAS FIJAS se liquidan con `club_liquidar_tabla_fija`, que paga
      // `cantidad_tablas × premio_por_tabla` y baja el premio por retiros con el
      // snapshot de la venta. El motor universal NO sabe leer `nombre_jugada`
      // ("TABLA FIJA (HIPO Cn)" no trae el número del ejemplar), así que las
      // decidía como PERDEDOR con premio 0 y encima les cobraba la comisión de
      // "jugada perdedora" (monto × pct) en vez de solo sobre la ganancia.
      .not("nombre_jugada", "like", "TABLA FIJA%")
      .limit(2000);
    if (error) throw error;
    filas = (data ?? []).filter((f) => !(f as Record<string, unknown>).anulada);
  } catch (e) {
    return { ok: false, motivo: "No se pudieron leer los tickets pendientes.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [(e as Error).message] };
  }

  if (filas.length === 0) {
    // Seguridad idempotente: si no hay Pendiente pero sí decididos → ya aplicado.
    const { data: decididos } = await sdb
      .from("tickets_apuestas")
      .select("id")
      .or(filtroDiaJornada(dia))
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .in("estado", ["Ganador", "Perdedor", "Retirado"])
      .not("nombre_jugada", "like", "MARCA %")
      .limit(1);
    if ((decididos ?? []).length > 0) {
      return { ok: true, motivo: "Carrera ya liquidada (tickets decididos). Sin cambios.", aplicados: 0, yaAplicado: true, reembolsos: 0, abonoTotal: 0, errores: [] };
    }

    // No hay pendientes HOY. Antes esto se devolvía como un OK en verde
    // («Sin tickets pendientes») y la carrera quedaba sin cobrar ni pagar para
    // siempre. Ahora se comprueba si la MISMA carrera tiene jugadas archivadas
    // bajo otra jornada: si las hay, la liquidación no es un éxito, es un ERROR
    // que nombra hasta dónde se movieron los tickets.
    const desalineadas = await jornadasConJugadasDeOtraFecha(sdb, input, dia);
    if (desalineadas.length > 0) {
      const dias = desalineadas.join(", ");
      return {
        ok: false,
        motivo:
          `La carrera tiene jugadas archivadas en OTRA jornada (${dias}), no en el ${dia}. ` +
          `No se cobró ni se pagó a nadie. Corregí la fecha de esas jugadas (o recalcular la carrera) y volvé a liquidar.`,
        aplicados: 0,
        yaAplicado: false,
        reembolsos: 0,
        abonoTotal: 0,
        errores: [
          `Jugadas de ${input.hipodromo.trim().toUpperCase()} C${Number(input.carrera)} encontradas en: ${dias}. Esperado: ${dia}.`,
        ],
      };
    }

    return { ok: true, motivo: "Sin tickets pendientes para esta carrera.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [] };
  }

  // Decide cada ticket con el motor universal (idempotente por estado) y aplica
  // el neteo de comisión por cruce. La MISMA función la usa
  // `revertirLiquidacionCarrera` para que el cálculo de reversión y el de
  // re-liquidación empleen exactamente la misma fórmula.
  let contexto = input;
  if (!contexto.crucesPuestos) {
    const reglas = await cargarOpcionesCrucesPuestos({
      fecha: dia,
      hipodromo: input.hipodromo,
      carrera: input.carrera,
    });
    if (!reglas.ok) {
      return {
        ok: false,
        motivo: "No se pudieron cargar las reglas de cruces de la carrera.",
        aplicados: 0,
        yaAplicado: false,
        reembolsos: 0,
        abonoTotal: 0,
        errores: [reglas.error ?? "Error desconocido al leer la configuración de cruces."],
      };
    }
    contexto = { ...input, crucesPuestos: reglas.opciones };
  }
  const decisiones = decidirTickets(filas, contexto);
  const errores: string[] = [];


  let abonoTotal = 0;
  let reembolsos = 0;
  for (const { res } of decisiones) {
    if (res.ok) {
      abonoTotal += res.totalClienteNeto;
    } else if (res.totalClienteNeto > 0) {
      // ANULADA: el motor devolvió el capital (ok:false pero con capital). La
      // venta ya lo descontó, así que entra en el abono como reembolso.
      abonoTotal += res.totalClienteNeto;
      reembolsos += 1;
    }
  }

  // Aplica los updates (ticket + saldo del cliente) en un viaje consistente.
  //
  // Los tickets INDETERMINADOS (el motor sabe que ganan por posición pero falta
  // el dividendo que cuantifica el premio, p. ej. la matriz W/P/S sin cargar) NO
  // se tocan: quedan PENDIENTES. Escribirlos como "Perdedor" con premio 0
  // cobraría $0 a una jugada ganadora y, como el estado queda persistido,
  // liquidar de nuevo ya no los revierte: el operador ni vería el error.
  const pendientes = decisiones.filter((d) => d.res.indeterminado);
  for (const { fila, res } of pendientes) {
    errores.push(
      `Ticket ${String(fila.id)} (${String(fila.nombre_jugada ?? "")}): sin dividendo para decidirlo, se deja PENDIENTE. ${res.motivo ?? ""}`.trim()
    );
  }

  const decidibles = decisiones.filter((d) => !d.res.indeterminado);
  const updates: Promise<unknown>[] = decidibles.map(({ fila, res }) => {
    // ANULADA: el motor devolvió el capital (ok:false con totalClienteNeto > 0
    // = monto). Se marca "Retirado" (ni ganador ni perdedor) y se le DEVUELVE el
    // capital al cliente. Antes caía en "Perdedor" con premio 0 y el cliente
    // perdía su dinero en una jugada que la casa anuló.
    const esAnulada = !res.ok && res.totalClienteNeto > 0;
    const estado = esAnulada ? "Retirado" : res.ok ? "Ganador" : "Perdedor";
    const retiradosPizarra = Array.isArray((input.pizarra as Record<string, unknown>)?.retirados)
      ? ((input.pizarra as { retirados?: Array<string | number> }).retirados ?? [])
      : [];
    const esPorRetirado =
      esAnulada &&
      retiradosPizarra.length > 0 &&
      jugadaInvolucraRetirado(fila.caballo, fila.ejemplar_numero, fila.nombre_jugada, retiradosPizarra);
    // premio_pagar / monto_decidido = PREMIO BRUTO (capital + ganancia ANTES de
    // comisión), que es la convención de TODO el sistema:
    //   · la liquidación legacy (marcas_venta.sql: premio_pagar = v_bruto;
    //     dupleta_liquidacion.sql: premio_pagar = v_premio),
    //   · el trigger del banquero (banqueros.sql: "v_mov := -premio_pagar
    //     (paga capital + ganancia)"),
    //   · el reporte de liquidación (reportes.ts: lee premio_pagar como bruto),
    //   · el mensaje de resultados del grupo (reportGenerator.mapearJugada →
    //     balanceJugada trata premio_pagar como el premio bruto).
    // Guardar aquí el NETO rompía todo eso: el "Consigue" del mensaje del grupo
    // (que relee la BD) pagaba de menos toda la comisión y el banquero cobraba/
    // pagaba de menos. El ABONO al saldo del ganador SÍ es neto
    // (totalClienteNeto): es el dinero que recibe en mano.
    const premioPagar = res.ok ? sumarDinero(res.totalClienteNeto, res.gananciaCasa) : 0;
    const montDecidido = premioPagar;
    const credito = res.ok || esAnulada ? res.totalClienteNeto : 0;

    const clientePromise = credito > 0
      ? (async () => {
          const fid = fila.cliente_juega_id;
          if (fid == null) return;
          const { data: c, error: eSel } = await sdb
            .from("clientes")
            .select("saldo_actual")
            .eq("id", fid)
            .maybeSingle();
          if (eSel) {
            // Sin lectura no se puede acumular sobre el saldo real: abortar solo el
            // abono. Antes el error se ignoraba, `actual` caía en 0 y el UPDATE
            // sobrescribía el saldo del cliente con el premio del ticket.
            errores.push(`Saldo cliente ${String(fid)}: no se pudo leer (${eSel.message})`);
            return;
          }
          const actual = NUM(((c ?? {}) as Record<string, unknown>).saldo_actual);
          const { error: eUpd } = await sdb
            .from("clientes")
            .update({ saldo_actual: sumarDinero(actual, credito) })
            .eq("id", fid as never);
          if (eUpd) errores.push(`Saldo cliente ${String(fid)}: no se pudo acreditar (${eUpd.message})`);
        })()
      : Promise.resolve();

    return Promise.all([
      sdb
        .from("tickets_apuestas")
        .update({
          estado,
          premio_pagar: premioPagar,
          monto_decidido: montDecidido,
          ...(esPorRetirado ? { anulada: false } : {}),
        })
        .eq("id", fila.id as never),
      clientePromise,
    ]).catch((e) => {
      errores.push(`Ticket ${String(fila.id)}: ${(e as Error).message}`);
    });
  });

  await Promise.all(updates);

  // ── ACREDITACIÓN SILENCIOSA DE INCENTIVOS CARRERA A CARRERA ──
  // Cada vez que se liquida una carrera, se calcula el incentivo ganado por cada
  // cliente en esa carrera específica y se suma de inmediato a su saldo real.
  const clientesParticipantes = [
    ...new Set(
      decidibles
        .map((d) => d.fila.cliente_juega_id)
        .filter((id): id is string | number => id != null)
    ),
  ];

  if (clientesParticipantes.length > 0) {
    try {
      const { data: dbClientes } = await sdb
        .from("clientes")
        .select("id, nombre, saldo_actual, devolucion, grupo_id")
        .in("id", clientesParticipantes as string[]);

      if (dbClientes && dbClientes.length > 0) {
        for (const cli of dbClientes as Array<Record<string, unknown>>) {
          const devPct = Math.max(0, Number(cli.devolucion) || 0);
          if (devPct <= 0) continue;

          const ticketsCli: TicketContableRaw[] = decidibles
            .filter((d) => String(d.fila.cliente_juega_id) === String(cli.id))
            .map((d) => ({
              ...(d.fila as unknown as TicketContableRaw),
              estado: !d.res.ok && d.res.totalClienteNeto > 0 ? "Retirado" : d.res.ok ? "Ganador" : "Perdedor",
              monto_decidido: d.res.ok ? sumarDinero(d.res.totalClienteNeto, d.res.gananciaCasa) : ((d.fila.monto_jugado as number) ?? 0),
            }));

          const inc = calcularIncentivoCarreraCliente(ticketsCli, devPct);
          if (inc > 0) {
            const actual = NUM(cli.saldo_actual);
            const nuevoSaldo = sumarDinero(actual, inc);
            await sdb
              .from("clientes")
              .update({ saldo_actual: nuevoSaldo })
              .eq("id", cli.id as never);

            try {
              await generarAsientoDevolucionIncentivo({
                grupoId: cli.grupo_id ? String(cli.grupo_id) : null,
                fecha: dia,
                clienteId: String(cli.id),
                clienteNombre: String(cli.nombre ?? "Cliente"),
                montoIncentivo: inc,
                referenciaId: `${dia}:${input.hipodromo}:C${input.carrera}`,
                usuario: "SISTEMA_LIQUIDACION",
              });
            } catch {
              /* ignore non-blocking accounting error */
            }
          }
        }
      }
    } catch (e) {
      console.error("Error acreditando incentivos silenciosos en carrera:", e);
    }
  }

  const ganadores = decidibles.filter((d) => d.res.ok).length;
  const base =
    `Liquidación aplicada: ${decidibles.length} ticket(s) decidido(s) (${ganadores} ganadores` +
    (reembolsos ? `, ${reembolsos} anulados devueltos` : "") +
    `). ` +
    `Abono total ${formatearMontoSinMoneda(abonoTotal)}.`;
  let motivo = base;
  if (pendientes.length) {
    motivo =
      base +
      ` ${pendientes.length} ticket(s) quedaron PENDIENTES porque falta el dividendo ` +
      `que los cuantifica (cargue los dividendos de la carrera y liquide de nuevo).`;
  }

  limpiarCacheClientes();
  limpiarCacheClientesVenta();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hipico:saldos-actualizados"));
    window.dispatchEvent(new CustomEvent("hipico_tickets_actualizados"));
  }

  return {
    ok: errores.length === 0,
    motivo,
    aplicados: decidibles.length,
    yaAplicado: false,
    reembolsos,
    abonoTotal,
    errores,
  };
}