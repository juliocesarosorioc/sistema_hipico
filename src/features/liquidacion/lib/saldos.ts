import {
  calcularLiquidacionConIncentivosYSocios,
  emitirMensajePaso,
  type BaseIncentivo,
  type BaseSocio,
} from "@/features/liquidacion/lib/liquidacion-incentivos-socios";
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
import { cargarOpcionesCrucesPuestosPorGrupos } from "@/features/gestion/lib/cruces-carrera";
import { grupoDeCuenta } from "@/features/grupos/lib/atribucion-grupo";
import {
  grupoActivoVigente,
  grupoVigente,
  veTodosLosGruposVigente,
} from "@/features/seguridad/lib/vigente";

function grupoLiquidacionEfectivo(grupoId?: string | number | null): string {
  const g =
    grupoId != null && String(grupoId).trim() !== ""
      ? String(grupoId).trim()
      : veTodosLosGruposVigente()
        ? grupoActivoVigente() || grupoVigente()
        : grupoVigente() || grupoActivoVigente();
  return String(g ?? "").trim();
}
import { redondearCentavos, sumarDinero, restarDinero, formatearMontoSinMoneda, calcularComisionExacta } from "@/shared/lib/dinero";
import {
  calcularEstadoCuentaCliente,
  calcularResumenContableCliente,
  calcularIncentivoCarreraCliente,
  esJugadaPuestosParaIncentivo,
  type TicketContableRaw,
} from "@/features/saldos/lib/contabilidad-central";
import {
  calcularBaseDecididaCarrera,
  type JugadaEntradaBaseDecidida,
} from "@/features/liquidacion/lib/devoluciones-cruce";
import { resolverSeudonimoClienteSync } from "@/features/clientes/lib/clientes";
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
  grupoId?: string | number | null;
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
    .map(({ fila, res }) => {
      const m = NUM(fila.monto_jugado);
      const perdidaEfectiva =
        !res.ok && res.totalClienteNeto > 0 && res.totalClienteNeto < m
          ? restarDinero(m, res.totalClienteNeto)
          : m;
      return {
        cliente: String(fila.cliente_juega_id ?? "").trim(),
        caballo: String(fila.caballo ?? "").trim(),
        monto: perdidaEfectiva,
        bruto: res.ok ? res.totalClienteNeto + res.gananciaCasa : 0,
        ok: res.ok,
        tasa: tasaComisionDeFila(fila, input.tasaComision),
      };
    });
  const gruposNeteo = netearComisionCruce(items, input.carrera, input.tasaComision, {
    agruparPorCliente: false,
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
    const resolverAliasCanonico = (idRaw?: unknown, nomRaw?: unknown): string => {
      const id = String(idRaw ?? "").trim();
      const nom = String(nomRaw ?? "").trim();
      if (id) {
        const porId = resolverSeudonimoClienteSync(id);
        if (porId && porId.toUpperCase() !== id.toUpperCase()) return porId.toUpperCase();
      }
      if (nom) {
        const porNom = resolverSeudonimoClienteSync(nom);
        if (porNom) return porNom.toUpperCase();
      }
      return (id || nom).toUpperCase();
    };
    for (let i = 0; i < decisiones.length; i++) {
      if (!esPuestos(i)) continue;
      const idJuega = String(decisiones[i].fila.cliente_juega_id ?? "").trim().toUpperCase();
      const nomJuega = String(decisiones[i].fila.cliente_juega_nombre ?? "").trim().toUpperCase();
      const canon = resolverAliasCanonico(idJuega, nomJuega);
      const nombre = idJuega || canon || nomJuega;
      if (!nombre) continue;
      const grupoId = grupoDeCuenta(
        decisiones[i].fila.grupo_cuenta_id as string | number | null | undefined,
        decisiones[i].fila.grupo_publicador_id as string | number | null | undefined,
        decisiones[i].fila.grupo_cobro_id as string | number | null | undefined
      ) || String(input.grupoId ?? "").trim();
      const clave = `${grupoId}::${canon || nombre}`;
      const lista = porJugador.get(clave) ?? [];
      lista.push(i);
      porJugador.set(clave, lista);
    }
    for (const idxs of porJugador.values()) {
      const jugador = String(decisiones[idxs[0]].fila.cliente_juega_id ?? "").trim().toUpperCase();
      const nombreJugador = String(decisiones[idxs[0]].fila.cliente_juega_nombre ?? "").trim().toUpperCase();
      const aliasJugador = resolverAliasCanonico(jugador, nombreJugador);
      const grupoId = grupoDeCuenta(
        decisiones[idxs[0]].fila.grupo_cuenta_id as string | number | null | undefined,
        decisiones[idxs[0]].fila.grupo_publicador_id as string | number | null | undefined,
        decisiones[idxs[0]].fila.grupo_cobro_id as string | number | null | undefined
      ) || String(input.grupoId ?? "").trim();
      const entradas: EntradaCrucePuestos[] = idxs
        .filter((i) => {
          const m = NUM(decisiones[i].fila.monto_jugado);
          const r = decisiones[i].res;
          return !(m > 0 && !r.ok && Math.abs(r.totalClienteNeto - m) < 0.01);
        })
        .map((i) => {
          const m = NUM(decisiones[i].fila.monto_jugado);
          const r = decisiones[i].res;
          const perdidaEfectiva =
            !r.ok && r.totalClienteNeto > 0 && r.totalClienteNeto < m
              ? restarDinero(m, r.totalClienteNeto)
              : m;
          return {
            cliente: aliasJugador || nombreJugador || jugador,
            clienteId: jugador,
            grupoId,
            caballo: String(decisiones[i].fila.caballo ?? "").trim(),
            ok: r.ok,
            bruto: r.ok ? r.totalClienteNeto + r.gananciaCasa : 0,
            monto: perdidaEfectiva,
          };
        });
      // Cruce simétrico con rol Consigue (tanto cuando Consigue pierde como cuando Consigue gana)
      if (nombreJugador || jugador || aliasJugador) {
        for (let i = 0; i < decisiones.length; i++) {
          if (idxs.includes(i) || !esPuestos(i)) continue;
          const fila = decisiones[i].fila;
          const conNom = String(fila.cliente_consigue_nombre ?? "").trim().toUpperCase();
          const conId = String(fila.cliente_consigue_id ?? "").trim().toUpperCase();
          const conAlias = resolverAliasCanonico(conId, conNom);
          const coincide =
            (conId && jugador && conId === jugador) ||
            (conNom && (conNom === nombreJugador || conNom === jugador || conNom === aliasJugador)) ||
            (conAlias && aliasJugador && conAlias === aliasJugador);
          if (!coincide) continue;
          const grupoFila = grupoDeCuenta(
            fila.grupo_cuenta_id as string | number | null | undefined,
            fila.grupo_publicador_id as string | number | null | undefined,
            fila.grupo_cobro_id as string | number | null | undefined
          ) || String(input.grupoId ?? "").trim();
          if (grupoFila && grupoId && grupoFila !== grupoId) continue;
          const r = decisiones[i].res;
          const m = NUM(fila.monto_jugado);
          if (r.ok) {
            // Juega gana -> Consigue pierde la ganancia neta de Juega
            const perdidaConsigue = restarDinero(sumarDinero(r.totalClienteNeto, r.gananciaCasa), m);
            if (perdidaConsigue > 0) {
              entradas.push({
                cliente: aliasJugador || nombreJugador || jugador,
                clienteId: jugador,
                grupoId,
                caballo: String(fila.caballo ?? "").trim(),
                ok: false,
                bruto: 0,
                monto: perdidaConsigue,
              });
            }
          } else {
            // Juega pierde -> Consigue gana SOLO lo que Juega perdió. En una
            // pérdida PARCIAL (ej. 1Y2N cuando acierta el 1P y devuelve capital
            // del 2N) Juega recupera `totalClienteNeto`; el dador NO puede cobrar
            // el monto entero, solo la fracción efectivamente perdida.
            const gananciaConsigue = Math.max(0, restarDinero(m, r.totalClienteNeto));
            if (gananciaConsigue > 0) {
              entradas.push({
                cliente: aliasJugador || nombreJugador || jugador,
                clienteId: jugador,
                grupoId,
                caballo: String(fila.caballo ?? "").trim(),
                ok: true,
                bruto: gananciaConsigue,
                monto: 0,
              });
            }
          }
        }
      }
      const tasa = tasaComisionDeFila(decisiones[idxs[0]].fila, input.tasaComision);
      const liquidaciones = calcularLiquidacionPuestosCarrera(entradas, {
        ...input.crucesPuestos,
        pctComision: tasa,
      });
      const liquidacion =
        liquidaciones.find(
          (x) =>
            ((jugador && x.clienteId === jugador) ||
              x.cliente.trim().toUpperCase() === (aliasJugador || nombreJugador || jugador)) &&
            x.grupoId === grupoId
        ) ?? liquidaciones[0];
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
  dia: string,
  grupoFiltro = ""
): Promise<string[]> {
  try {
    let q = sdb
      .from("tickets_apuestas")
      .select("fecha_carrera, fecha_registro, anulada, estado")
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .eq("estado", "Pendiente")
      .or("anulada.is.null,anulada.eq.false")
      .limit(2000);
    if (grupoFiltro) {
      q = q.eq("grupo_cobro_id", grupoFiltro);
    }
    const { data, error } = await q;
    if (error) return [];
    const filas = ((data ?? []) as Array<{ fecha_carrera?: string | null; fecha_registro?: string | null; anulada?: boolean | null }> ).filter(
      (r) => !r.anulada && (!r.fecha_registro || String(r.fecha_registro).slice(0, 10) === dia)
    );
    return jornadasDesalineadas(dia, filas.map((r) => r.fecha_carrera ?? null));
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
  const grupoFiltro = grupoLiquidacionEfectivo(input.grupoId);
  let filas: unknown[] = [];
  try {
    let qPend = sdb
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
    if (grupoFiltro) {
      qPend = qPend.eq("grupo_cobro_id", grupoFiltro);
    }
    const { data, error } = await qPend;
    if (error) throw error;
    filas = (data ?? []).filter((f) => !(f as Record<string, unknown>).anulada);
  } catch (e) {
    return { ok: false, motivo: "No se pudieron leer los tickets pendientes.", aplicados: 0, yaAplicado: false, reembolsos: 0, abonoTotal: 0, errores: [(e as Error).message] };
  }

  if (filas.length === 0) {
    // Seguridad idempotente: si no hay Pendiente pero sí decididos o anulados en esta jornada → ya aplicado / sin pendientes.
    let qDec = sdb
      .from("tickets_apuestas")
      .select("id, estado, anulada, premio_pagar, monto_jugado")
      .or(filtroDiaJornada(dia))
      .eq("hipodromo", input.hipodromo.trim().toUpperCase())
      .eq("carrera", Number(input.carrera))
      .limit(500);
    if (grupoFiltro) {
      qDec = qDec.eq("grupo_cobro_id", grupoFiltro);
    }
    const { data: decididos } = await qDec;
    if ((decididos ?? []).length > 0) {
      const idsMalAnuladas = ((decididos ?? []) as Array<Record<string, unknown>>)
        .filter(
          (d) =>
            !d.anulada &&
            !d.anulada_at &&
            !d.anulada_motivo &&
            String(d.estado ?? "").toLowerCase().startsWith("anul") &&
            d.id != null
        )
        .map((d) => d.id);
      if (idsMalAnuladas.length > 0) {
        await sdb
          .from("tickets_apuestas")
          .update({ estado: "Perdedor" })
          .in("id", idsMalAnuladas as never[]);
      }
      return { ok: true, motivo: "Carrera ya liquidada (tickets decididos). Sin cambios.", aplicados: 0, yaAplicado: true, reembolsos: 0, abonoTotal: 0, errores: [] };
    }

    // No hay pendientes HOY. Antes esto se devolvía como un OK en verde
    // («Sin tickets pendientes») y la carrera quedaba sin cobrar ni pagar para
    // siempre. Ahora se comprueba si la MISMA carrera tiene jugadas archivadas
    // bajo otra jornada: si las hay, la liquidación no es un éxito, es un ERROR
    // que nombra hasta dónde se movieron los tickets.
    const desalineadas = await jornadasConJugadasDeOtraFecha(sdb, input, dia, grupoFiltro);
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

    return {
      ok: false,
      motivo: "No se puede liquidar la carrera porque no hay jugadas cargadas. No se liquidará hasta que cargue información de jugadas.",
      aplicados: 0,
      yaAplicado: false,
      reembolsos: 0,
      abonoTotal: 0,
      errores: ["No se encontraron jugadas registradas para esta carrera."],
    };
  }

  // Si algún ticket vino sin cliente_juega_id o sin cliente_consigue_id, intentar reconciliarlo por nombre/seudónimo contra `clientes`
  const nombresSinId = new Set<string>();
  for (const raw of filas) {
    const f = raw as Record<string, unknown>;
    if (!String(f.cliente_juega_id ?? "").trim() && String(f.cliente_juega_nombre ?? "").trim()) {
      nombresSinId.add(String(f.cliente_juega_nombre).trim());
    }
    if (!String(f.cliente_consigue_id ?? "").trim() && String(f.cliente_consigue_nombre ?? "").trim()) {
      nombresSinId.add(String(f.cliente_consigue_nombre).trim());
    }
  }
  if (nombresSinId.size > 0) {
    try {
      const { data: cliCatalogo } = await sdb
        .from("clientes")
        .select("id, nombre, seudonimo, grupo_id")
        .limit(2000);
      if (Array.isArray(cliCatalogo) && cliCatalogo.length > 0) {
        const porIdentidad = new Map<string, { id: string; alias: string; grupoId?: string }>();
        for (const c of cliCatalogo as Array<Record<string, unknown>>) {
          const id = String(c.id ?? "").trim();
          if (!id) continue;
          const nom = String(c.nombre ?? "").trim();
          const seu = String(c.seudonimo ?? "").trim();
          const alias = seu || nom;
          const gId = c.grupo_id ? String(c.grupo_id).trim() : undefined;
          if (nom) porIdentidad.set(nom.toUpperCase(), { id, alias, grupoId: gId });
          if (seu) porIdentidad.set(seu.toUpperCase(), { id, alias, grupoId: gId });
        }
        for (const raw of filas) {
          const f = raw as Record<string, unknown>;
          if (!String(f.cliente_juega_id ?? "").trim()) {
            const m = porIdentidad.get(String(f.cliente_juega_nombre ?? "").trim().toUpperCase());
            if (m) {
              f.cliente_juega_id = m.id;
              f.cliente_juega_nombre = m.alias;
              if (!f.grupo_cuenta_id && m.grupoId) f.grupo_cuenta_id = m.grupoId;
            }
          }
          if (!String(f.cliente_consigue_id ?? "").trim()) {
            const m = porIdentidad.get(String(f.cliente_consigue_nombre ?? "").trim().toUpperCase());
            if (m) {
              f.cliente_consigue_id = m.id;
              f.cliente_consigue_nombre = m.alias;
            }
          }
        }
      }
    } catch {
      /* continúa validación normal */
    }
  }

  const puestosSinCliente = filas.filter((raw) => {
    const fila = raw as Record<string, unknown>;
    const tipo = String(fila.nombre_jugada ?? fila.tipo_jugada ?? "");
    return esJugadaDePuestos(tipo) && !String(fila.cliente_juega_id ?? "").trim();
  });
  if (puestosSinCliente.length > 0) {
    const ids = puestosSinCliente
      .map((raw) => String((raw as Record<string, unknown>).id ?? "sin ID"))
      .join(", ");
    const error = `Liquidación detenida: las jugadas de puestos ${ids} no tienen cliente contable (cliente_juega_id); no se aplicaron saldos ni cruces.`;
    return {
      ok: false,
      motivo: error,
      aplicados: 0,
      yaAplicado: false,
      reembolsos: 0,
      abonoTotal: 0,
      errores: [error],
    };
  }

  // Decide cada ticket con el motor universal (idempotente por estado) y aplica
  // el neteo de comisión por cruce. La MISMA función la usa
  // `revertirLiquidacionCarrera` para que el cálculo de reversión y el de
  // re-liquidación empleen exactamente la misma fórmula.
  let grupoSesion = String(input.grupoId ?? grupoActivoVigente() ?? grupoVigente() ?? "").trim();
  const gruposTickets = new Set(
    filas
      .map((raw) => {
        const fila = raw as Record<string, unknown>;
        return grupoDeCuenta(
          fila.grupo_cuenta_id as string | number | null | undefined,
          fila.grupo_publicador_id as string | number | null | undefined,
          fila.grupo_cobro_id as string | number | null | undefined
        );
      })
      .filter(Boolean)
  );
  if (!grupoSesion && gruposTickets.size === 0) {
    try {
      const { data: gDef } = await sdb
        .from("grupos_venta")
        .select("id")
        .eq("activo", true)
        .limit(1)
        .maybeSingle();
      if (gDef?.id) {
        grupoSesion = String(gDef.id).trim();
      }
    } catch {
      /* fallback */
    }
  }
  const hayTicketSinGrupo = filas.some((raw) => {
    const fila = raw as Record<string, unknown>;
    return !grupoDeCuenta(
      fila.grupo_cuenta_id as string | number | null | undefined,
      fila.grupo_publicador_id as string | number | null | undefined,
      fila.grupo_cobro_id as string | number | null | undefined
    );
  });
  if (hayTicketSinGrupo) {
    const grupoInferible = grupoSesion || (gruposTickets.size >= 1 ? [...gruposTickets][0] : "default");
    gruposTickets.add(grupoInferible);
  }
  if (!gruposTickets.size && grupoSesion) gruposTickets.add(grupoSesion);
  if (!gruposTickets.size) gruposTickets.add("default");
  let reglasCruce: Awaited<ReturnType<typeof cargarOpcionesCrucesPuestosPorGrupos>>;
  try {
    const idsReales = [...gruposTickets].filter((g) => g !== "default");
    reglasCruce = idsReales.length > 0
      ? await cargarOpcionesCrucesPuestosPorGrupos({
          grupoIds: idsReales,
          fecha: dia,
          hipodromo: input.hipodromo,
          carrera: input.carrera,
        })
      : {
          ok: true,
          opciones: {
            grupo: { mismoEjemplar: true, diferenteEjemplar: true },
            porGrupo: {},
          },
        };
  } catch {
    reglasCruce = {
      ok: true,
      opciones: {
        grupo: { mismoEjemplar: true, diferenteEjemplar: true },
        porGrupo: {},
      },
    };
  }
  if (!reglasCruce.ok) {
    reglasCruce = {
      ok: true,
      opciones: {
        grupo: { mismoEjemplar: true, diferenteEjemplar: true },
        porGrupo: {},
      },
    };
  }
  const contexto: LiquidarSaldosInput = {
    ...input,
    grupoId: grupoSesion || (gruposTickets.size === 1 ? [...gruposTickets][0] : undefined),
    crucesPuestos: {
      ...input.crucesPuestos,
      porGrupo: reglasCruce.opciones.porGrupo,
    },
  };
  const decisiones = decidirTickets(filas, contexto);
  const errores: string[] = [];


  let abonoTotal = 0;
  let reembolsos = 0;
  for (const { fila, res } of decisiones) {
    const m = NUM(fila.monto_jugado);
    if (res.ok) {
      abonoTotal += res.totalClienteNeto;
    } else if (res.totalClienteNeto > 0) {
      // El motor devolvió capital total (empate NINI / retirado) o parcial (ej. 2Y3N en 3° lugar).
      // La venta ya descontó `monto_jugado`, así que se acredita la porción devuelta.
      abonoTotal += res.totalClienteNeto;
      if (m > 0 && Math.abs(res.totalClienteNeto - m) < 0.01) {
        reembolsos += 1;
      }
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
  // 1. Persistir el estado oficial de cada ticket decidido en tickets_apuestas
  const updatesTickets: Promise<unknown>[] = decidibles.map(({ fila, res }) => {
    const montoFila = NUM(fila.monto_jugado);
    const esEmpateTotal =
      !res.ok && montoFila > 0 && Math.abs(res.totalClienteNeto - montoFila) < 0.01;
    const esPerdidaParcial =
      !res.ok && res.totalClienteNeto > 0 && !esEmpateTotal;
    const retiradosPizarra = Array.isArray((input.pizarra as Record<string, unknown>)?.retirados)
      ? ((input.pizarra as { retirados?: Array<string | number> }).retirados ?? [])
      : [];
    const esPorRetirado =
      (esEmpateTotal || esPerdidaParcial) &&
      retiradosPizarra.length > 0 &&
      jugadaInvolucraRetirado(fila.caballo, fila.ejemplar_numero, fila.nombre_jugada, retiradosPizarra);
    const estado = esPorRetirado ? "Retirado" : res.ok ? "Ganador" : "Perdedor";
    const premioPagar = res.ok
      ? sumarDinero(res.totalClienteNeto, res.gananciaCasa)
      : esEmpateTotal || esPerdidaParcial
      ? res.totalClienteNeto
      : 0;
    const montDecidido = res.ok
      ? premioPagar
      : esPerdidaParcial
      ? restarDinero(montoFila, res.totalClienteNeto)
      : esEmpateTotal
      ? 0
      : montoFila;

    return Promise.resolve(
      sdb
        .from("tickets_apuestas")
        .update({
          estado,
          premio_pagar: premioPagar,
          monto_decidido: montDecidido,
          comision_pagada: res.ok ? res.gananciaCasa : 0,
          ...(fila.cliente_juega_id ? { cliente_juega_id: fila.cliente_juega_id } : {}),
          ...(fila.cliente_juega_nombre ? { cliente_juega_nombre: fila.cliente_juega_nombre } : {}),
          ...(fila.cliente_consigue_id ? { cliente_consigue_id: fila.cliente_consigue_id } : {}),
          ...(fila.cliente_consigue_nombre ? { cliente_consigue_nombre: fila.cliente_consigue_nombre } : {}),
          ...(esPorRetirado ? { anulada: false } : {}),
        })
        .eq("id", fila.id as never)
    ).catch((e: unknown) => {
      errores.push(`Ticket ${String(fila.id)}: ${(e as Error).message}`);
    });
  });

  await Promise.all(updatesTickets);

  // Sincronización con Sala P2P: si alguno de los tickets decididos provino de la Sala (`SALA_P2P:<codigo>`),
  // liberar su `saldo_retenido` en `clientes` y marcar su estado en `chat_tickets_fifo` para evitar doble liquidación.
  const ticketsSalaP2P = decidibles.filter((d) =>
    String(d.fila.nota_auditoria ?? "").startsWith("SALA_P2P:")
  );
  if (ticketsSalaP2P.length > 0) {
    try {
      const liberacionPorCliente = new Map<string, number>();
      for (const { fila, res } of ticketsSalaP2P) {
        const codigoTicket = String(fila.nota_auditoria ?? "").slice("SALA_P2P:".length).trim();
        const montoF = NUM(fila.monto_jugado);
        const jId = String(fila.cliente_juega_id ?? "").trim();
        const cId = String(fila.cliente_consigue_id ?? "").trim();
        if (jId && montoF > 0) {
          liberacionPorCliente.set(jId, sumarDinero(liberacionPorCliente.get(jId) ?? 0, montoF));
        }
        if (cId && montoF > 0) {
          liberacionPorCliente.set(cId, sumarDinero(liberacionPorCliente.get(cId) ?? 0, montoF));
        }
        if (codigoTicket) {
          const estadoFifo = !res.ok && Math.abs(res.totalClienteNeto - montoF) < 0.01
            ? "EMPATE"
            : res.ok
            ? "GANADOR_PROPONENTE"
            : "GANADOR_ACEPTANTE";
          await sdb
            .from("chat_tickets_fifo")
            .update({ estado: estadoFifo })
            .eq("codigo_ticket", codigoTicket)
            .in("estado", ["ABIERTO", "ACTIVO", "PENDIENTE"]);
        }
      }
      for (const [cliId, montoLiberar] of liberacionPorCliente.entries()) {
        const { data: cl } = await sdb
          .from("clientes")
          .select("saldo_retenido, saldo_actual, aval, libre")
          .eq("id", cliId)
          .maybeSingle();
        if (cl) {
          const nuevoRet = Math.max(0, restarDinero(NUM(cl.saldo_retenido), montoLiberar));
          const nuevoDisp = cl.libre
            ? 999999
            : Math.max(0, restarDinero(sumarDinero(NUM(cl.saldo_actual), NUM(cl.aval)), nuevoRet));
          await sdb
            .from("clientes")
            .update({ saldo_retenido: nuevoRet, saldo_disponible: nuevoDisp })
            .eq("id", cliId);
        }
      }
    } catch (errSala) {
      console.warn("[saldos] No se pudo liberar retención de tickets SALA_P2P:", errSala);
    }
  }

  // ── UNIFICACIÓN DE SALDOS, CRUCES Y DEVOLUCIONES CARRERA A CARRERA (SSOT) ──
  emitirMensajePaso("⏳ Unificando saldos por carrera con cruces e incentivos...", "info");

  // 1. Recolectar identidades de TODOS los clientes participantes (Juega y Consigue)
  const idsParticipantes = new Set<string>();
  const nombresParticipantes = new Set<string>();

  for (const d of decidibles) {
    const jId = String(d.fila.cliente_juega_id ?? "").trim();
    const cId = String(d.fila.cliente_consigue_id ?? "").trim();
    const jNom = String(d.fila.cliente_juega_nombre ?? d.fila.clienteJuega ?? "").trim().toUpperCase();
    const cNom = String(d.fila.cliente_consigue_nombre ?? d.fila.clienteConsigue ?? d.fila.tercio ?? "").trim().toUpperCase();

    if (jId) idsParticipantes.add(jId);
    if (cId) idsParticipantes.add(cId);
    if (jNom) nombresParticipantes.add(jNom);
    if (cNom) nombresParticipantes.add(cNom);
  }

  try {
    // 2. Cargar clientes participantes desde la base de datos
    let queryClientes = sdb
      .from("clientes")
      .select("id, nombre, seudonimo, saldo_actual, devolucion, incentivo_pct, incentivo_base, socio_id, socio_asignado, socio_comision_pct, comision_socio_pct, socio_base, grupo_id");

    if (idsParticipantes.size > 0) {
      queryClientes = queryClientes.in("id", Array.from(idsParticipantes));
    }

    const { data: dbClientesRaw, error: errCli } = await queryClientes;
    let listaClientes: Array<Record<string, unknown>> = (dbClientesRaw ?? []) as Array<Record<string, unknown>>;

    // Si faltan clientes por nombre/seudónimo que no vinieron por ID
    if (nombresParticipantes.size > 0) {
      const encontradosNombres = new Set<string>();
      for (const c of listaClientes) {
        const n = String(c.nombre ?? "").trim().toUpperCase();
        const s = String(c.seudonimo ?? "").trim().toUpperCase();
        if (n) encontradosNombres.add(n);
        if (s) encontradosNombres.add(s);
      }
      const faltantes = Array.from(nombresParticipantes).filter((nom) => !encontradosNombres.has(nom));
      if (faltantes.length > 0) {
        const { data: dbFaltantes } = await sdb
          .from("clientes")
          .select("id, nombre, seudonimo, saldo_actual, devolucion, incentivo_pct, incentivo_base, socio_id, socio_asignado, socio_comision_pct, comision_socio_pct, socio_base, grupo_id")
          .or(faltantes.map((f) => `nombre.ilike.${f},seudonimo.ilike.${f}`).join(","));
        if (dbFaltantes) {
          listaClientes = [...listaClientes, ...(dbFaltantes as Array<Record<string, unknown>>)];
        }
      }
    }

    // Deduplicar estrictamente por ID de cliente para jamás aplicar el saldo dos veces al mismo cliente
    const clientesUnicosMap = new Map<string, Record<string, unknown>>();
    for (const c of listaClientes) {
      const idKey = String(c.id ?? c.nombre ?? "").trim().toUpperCase();
      if (idKey && !clientesUnicosMap.has(idKey)) {
        clientesUnicosMap.set(idKey, c);
      }
    }
    listaClientes = Array.from(clientesUnicosMap.values());

    // 3. Procesar y unificar carrera por cada cliente
    for (const cli of listaClientes) {
      const cliIdStr = String(cli.id ?? "").trim().toUpperCase();
      const cliNom = String(cli.nombre ?? "").trim().toUpperCase();
      const cliSeu = String(cli.seudonimo ?? "").trim().toUpperCase();

      // Identificar si una jugada pertenece a este cliente
      const esClienteJuega = (fila: any) => {
        const fId = String(fila.cliente_juega_id ?? "").trim().toUpperCase();
        const fNom = String(fila.cliente_juega_nombre ?? fila.clienteJuega ?? "").trim().toUpperCase();
        return (cliIdStr && fId === cliIdStr) || (cliNom && fNom === cliNom) || (cliSeu && fNom === cliSeu);
      };

      const esClienteConsigue = (fila: any) => {
        const fId = String(fila.cliente_consigue_id ?? "").trim().toUpperCase();
        const fNom = String(fila.cliente_consigue_nombre ?? fila.clienteConsigue ?? fila.tercio ?? "").trim().toUpperCase();
        return (cliIdStr && fId === cliIdStr) || (cliNom && fNom === cliNom) || (cliSeu && fNom === cliSeu);
      };

      let ganadoBrutoCarrera = 0;
      let perdidoBrutoCarrera = 0;
      let ganadoBrutoSoloJuega = 0;
      let perdidoBrutoSoloJuega = 0;
      let tasaComision = input.tasaComision ?? 5;
      const entradasCruceCli: EntradaCrucePuestos[] = [];
      const grupoClienteCanonico = String(cli.grupo_id ?? contexto.grupoId ?? "").trim();

      for (const d of decidibles) {
        const fila = d.fila;
        const res = d.res;
        const m = NUM(fila.monto_jugado);
        const grupoFila =
          grupoClienteCanonico ||
          grupoDeCuenta(
            fila.grupo_cuenta_id as string | number | null | undefined,
            fila.grupo_publicador_id as string | number | null | undefined,
            fila.grupo_cobro_id as string | number | null | undefined
          ) ||
          String(contexto.grupoId ?? "").trim();
        const cabFila = String(fila.caballo ?? fila.ejemplar_numero ?? "").trim();
        const elegibleIncentivo = esJugadaPuestosParaIncentivo(
          String(fila.nombre_jugada ?? fila.tipo_jugada ?? ""),
          fila.modalidad as string | null | undefined,
          fila.origen as string | null | undefined
        );

        // Perspectiva como Juega
        if (esClienteJuega(fila)) {
          tasaComision = tasaComisionDeFila(fila, input.tasaComision);
          if (res.ok) {
            const gananciaTicket = Math.max(0, restarDinero(res.totalClienteNeto + res.gananciaCasa, m));
            ganadoBrutoCarrera = sumarDinero(ganadoBrutoCarrera, gananciaTicket);
            if (elegibleIncentivo) {
              ganadoBrutoSoloJuega = sumarDinero(ganadoBrutoSoloJuega, gananciaTicket);
            }
            if (gananciaTicket > 0) {
              entradasCruceCli.push({
                cliente: cliNom || cliSeu || cliIdStr,
                clienteId: cliIdStr,
                grupoId: grupoFila,
                caballo: cabFila,
                ok: true,
                bruto: gananciaTicket,
                monto: 0,
              });
            }
          } else {
            const empateTotal = m > 0 && Math.abs(res.totalClienteNeto - m) < 0.01;
            const perdidaParcial = res.totalClienteNeto > 0 && !empateTotal;
            if (!empateTotal) {
              const perdidaTicket = perdidaParcial ? restarDinero(m, res.totalClienteNeto) : m;
              perdidoBrutoCarrera = sumarDinero(perdidoBrutoCarrera, perdidaTicket);
              if (elegibleIncentivo) {
                perdidoBrutoSoloJuega = sumarDinero(perdidoBrutoSoloJuega, perdidaTicket);
              }
              if (perdidaTicket > 0) {
                entradasCruceCli.push({
                  cliente: cliNom || cliSeu || cliIdStr,
                  clienteId: cliIdStr,
                  grupoId: grupoFila,
                  caballo: cabFila,
                  ok: false,
                  bruto: 0,
                  monto: perdidaTicket,
                });
              }
            }
          }
        }

        // Perspectiva como Consigue (Dador / Contraparte)
        if (esClienteConsigue(fila)) {
          tasaComision = tasaComisionDeFila(fila, input.tasaComision);
          if (res.ok) {
            // El lado Juega ganó -> Consigue pierde la ganancia neta otorgada
            const perdidaConsigue = Math.max(0, restarDinero(res.totalClienteNeto + res.gananciaCasa, m));
            perdidoBrutoCarrera = sumarDinero(perdidoBrutoCarrera, perdidaConsigue);
            if (perdidaConsigue > 0) {
              entradasCruceCli.push({
                cliente: cliNom || cliSeu || cliIdStr,
                clienteId: cliIdStr,
                grupoId: grupoFila,
                caballo: cabFila,
                ok: false,
                bruto: 0,
                monto: perdidaConsigue,
              });
            }
          } else {
            // El lado Juega perdió -> Consigue gana lo EFECTIVAMENTE perdido por
            // Juega. Si la pérdida es PARCIAL (NINI/compuesta que devuelve parte
            // del capital), el dador solo cobra `monto - capital devuelto`; si es
            // total, cobra el monto completo. (Antes cobraba `m` siempre, lo que
            // inflaba al Consigue: SAM 6ta daba 209,00 en vez de 66,50.)
            const empateTotal = m > 0 && Math.abs(res.totalClienteNeto - m) < 0.01;
            if (!empateTotal) {
              const gananciaConsigue = Math.max(0, restarDinero(m, res.totalClienteNeto));
              ganadoBrutoCarrera = sumarDinero(ganadoBrutoCarrera, gananciaConsigue);
              if (gananciaConsigue > 0) {
                entradasCruceCli.push({
                  cliente: cliNom || cliSeu || cliIdStr,
                  clienteId: cliIdStr,
                  grupoId: grupoFila,
                  caballo: cabFila,
                  ok: true,
                  bruto: gananciaConsigue,
                  monto: 0,
                });
              }
            }
          }
        }
      }

      // Si el cliente no tuvo movimiento en esta carrera, saltar
      if (ganadoBrutoCarrera === 0 && perdidoBrutoCarrera === 0) continue;

      // ── REGLA CANÓNICA DE CRUCES Y DEVOLUCIONES SOBRE MONTO DECIDIDO ──
      // - Las devoluciones son en base al monto decidido de la carrera SIN la comisión (gane o pierda).
      // - Si solo perdió (ej. perdió 50) -> base = 50.
      // - Si solo ganó (ej. ganó 50) -> base = 50.
      // - Si en la carrera hubo cruce (ej. ganó 50 y perdió 20) -> base = |50 - 20| = 30.
      // - Regla #6: sin cruce en la carrera, el rol Consigue NO devenga incentivo ni comisión de socio.
      const diferenciaBruta = restarDinero(ganadoBrutoCarrera, perdidoBrutoCarrera);
      const hayCruceCarrera = ganadoBrutoCarrera > 0 && perdidoBrutoCarrera > 0;
      const baseDecididaIncentivoCarrera = hayCruceCarrera
        ? redondearCentavos(Math.abs(diferenciaBruta))
        : redondearCentavos(sumarDinero(ganadoBrutoSoloJuega, perdidoBrutoSoloJuega));
      let saldoNetoJugadas = 0;
      let comisionCasaCarrera = 0;
      let montoIncentivo = 0;
      const incPct = Math.max(0, Number(cli.incentivo_pct ?? cli.devolucion) || 0);

      if (input.permiteCruces === false) {
        comisionCasaCarrera =
          ganadoBrutoCarrera > 0 ? calcularComisionExacta(ganadoBrutoCarrera, tasaComision) : 0;
        saldoNetoJugadas = restarDinero(diferenciaBruta, comisionCasaCarrera);
      } else if (entradasCruceCli.length > 0 && contexto.crucesPuestos) {
        const liqCruce = calcularLiquidacionPuestosCarrera(entradasCruceCli, {
          ...contexto.crucesPuestos,
          pctComision: tasaComision,
        });
        comisionCasaCarrera = redondearCentavos(
          liqCruce.reduce((acc, item) => sumarDinero(acc, item.comision), 0)
        );
        saldoNetoJugadas = restarDinero(diferenciaBruta, comisionCasaCarrera);
      } else if (diferenciaBruta > 0) {
        // Saldo positivo: la comisión se calcula sobre la diferencia neta positiva
        comisionCasaCarrera = calcularComisionExacta(diferenciaBruta, tasaComision);
        saldoNetoJugadas = restarDinero(diferenciaBruta, comisionCasaCarrera);
      } else {
        saldoNetoJugadas = diferenciaBruta; // Negativo o cero
        comisionCasaCarrera = 0;
      }

      // Devolución / incentivo sobre monto neto decidido de la carrera SIN comisión (gane o pierda)
      if (incPct > 0 && baseDecididaIncentivoCarrera > 0) {
        montoIncentivo = calcularComisionExacta(baseDecididaIncentivoCarrera, incPct);
      }

      // Impacto total en el saldo del cliente por la carrera
      const impactoTotalSaldo = sumarDinero(saldoNetoJugadas, montoIncentivo);

      if (impactoTotalSaldo !== 0 || montoIncentivo > 0) {
        const actual = NUM(cli.saldo_actual);
        const nuevoSaldo = sumarDinero(actual, impactoTotalSaldo);
        await sdb.from("clientes").update({ saldo_actual: nuevoSaldo }).eq("id", cli.id as never);

        // Asiento NIIF de incentivo si correspondió
        if (montoIncentivo > 0) {
          try {
            await generarAsientoDevolucionIncentivo({
              grupoId: cli.grupo_id ? String(cli.grupo_id) : null,
              fecha: dia,
              clienteId: String(cli.id),
              clienteNombre: String(cli.nombre ?? cli.seudonimo ?? "Cliente"),
              montoIncentivo,
              referenciaId: `${dia}:${input.hipodromo}:C${input.carrera}`,
              usuario: "SISTEMA_LIQUIDACION",
              nota: `Devolución sobre monto neto decidido C${input.carrera} ${input.hipodromo} (base: $${baseDecididaIncentivoCarrera.toFixed(2)})`,
            });
          } catch {
            /* ignore non-blocking */
          }
        }
      }

      // Comisión confidencial al socio asignado sobre monto neto decidido de la carrera
      const socioIdRaw = (cli.socio_id ?? cli.socio_asignado) as string | null;
      const socPct = Math.max(0, Number(cli.socio_comision_pct ?? cli.comision_socio_pct) || 0);
      if (socioIdRaw && socPct > 0 && baseDecididaIncentivoCarrera > 0) {
        const montoSocio = calcularComisionExacta(baseDecididaIncentivoCarrera, socPct);
        if (montoSocio > 0) {
          const { data: socioDb } = await sdb
            .from("clientes")
            .select("id, saldo_actual, nombre, seudonimo")
            .or(`id.eq.${socioIdRaw},nombre.ilike.${socioIdRaw},seudonimo.ilike.${socioIdRaw}`)
            .limit(1)
            .maybeSingle();

          if (socioDb) {
            const actualSoc = NUM(socioDb.saldo_actual);
            await sdb
              .from("clientes")
              .update({ saldo_actual: sumarDinero(actualSoc, montoSocio) })
              .eq("id", socioDb.id as never);
          }
        }
      }
    }
  } catch (e) {
    console.error("Error unificando saldos y cruces de carrera:", e);
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