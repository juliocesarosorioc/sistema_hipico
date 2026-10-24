/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TOPE DE SALDO "EN ORDEN" DE LA CARGA INDIVIDUAL  (Taquilla)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  `proyectarFila` (validar.ts) topa cada jugada contra el disponible del
 *  cliente 1, pero mira SOLO esa fila. En una carga con varias jugadas del
 *  MISMO cliente todas veían el saldo entero y la segunda se autorizaba
 *  completa: al cobrar, la RPC `club_vender_jugada` (sql/taquilla_venta.sql),
 *  que sí descuenta en una transacción, la rechazaba por saldo y la venta se
 *  perdía.
 *
 *  Aquí se recorre el plano EN ORDEN y se descuenta del cliente 1 lo autorizado
 *  por las filas anteriores antes de proyectar la siguiente. El cliente 2
 *  (dador) NO se debita —la RPC resta `saldo_actual` del cliente que juega—, así
 *  que su saldo nunca cambia.
 *
 *  Módulo PURO (sin React ni red). Lo usan tanto la vista previa como el cobro
 *  de `Gestión de Jugadas`.
 */
import { proyectarFila, type FilaProyeccion } from "@/features/taquilla/lib/validar";
import { evaluarSaldoProgresivoJugadas } from "@/features/gestion/lib/saldo-progresivo";

/** Cliente mínimo con el que se topa el saldo (compatible con `ClienteVenta`). */
export type ClienteConSaldo = {
  id?: string | number;
  nombre?: string | null;
  saldo_actual?: number | null;
  aval?: number | null;
  modo_juego?: string | null;
};

/** Fila de la carga: mismas columnas que `proyectarFila` consume. */
export type FilaDeCarga = {
  jugada: string;
  caballo: string;
  monto: string;
  cliente1: string;
  cliente2: string;
};

export type ProyeccionEnCurso<C> = {
  proyeccion: FilaProyeccion;
  /** Cliente 1 con el saldo que le queda tras las filas anteriores. */
  cliente1: C | null;
  /** Cliente 2 (dador). Nunca se le descuenta. */
  cliente2: C | null;
  montoSolicitado: number;
  montoAceptado: number;
  montoExcedido: number;
  saldoAntes: number | null;
  saldoRestante: number | null;
  excedido: boolean;
  observacion: string | null;
  observacionCorta: string | null;
  etiquetaRestante: string;
};

/**
 * Copia el cliente con el `saldo_actual` rebajado por lo YA comprometido en
 * esta carga (solo el cliente 1 se debita). Devuelve el MISMO objeto si no hay
 * descuento, para no alterar identidad, aval (que no baja) ni `modo_juego`.
 */
export function clienteConSaldoDescontado<C extends ClienteConSaldo>(
  cliente: C | null,
  descontado: Map<string, number>
): C | null {
  if (!cliente) return cliente;
  const usado = descontado.get(String(cliente.id)) ?? 0;
  if (!usado) return cliente;
  return { ...cliente, saldo_actual: Number(cliente.saldo_actual ?? 0) - usado };
}

/**
 * Proyecta TODAS las filas en el orden del plano, descontando del cliente 1 lo
 * autorizado en cada fila anterior. Devuelve, por fila, la proyección y los
 * clientes ya con el saldo restante (para la celda "Saldo/Max" y los avisos).
 *
 * Solo descuenta cuando la fila es proyectable (`proyeccion.ok`); una fila con
 * jugada o monto ilegibles no resta nada, igual que no se cobraría.
 */
export function proyectarFilasEnOrden<C extends ClienteConSaldo, F extends FilaDeCarga>(
  filas: F[],
  resolver: (texto: string) => C | null,
  tasaComision?: number
): ProyeccionEnCurso<C>[] {
  const descontado = new Map<string, number>();
  const parciales: Array<{
    f: F;
    base1: C | null;
    cliente1: C | null;
    cliente2: C | null;
    proyeccion: FilaProyeccion;
    montoSolicitado: number;
    valida: boolean;
  }> = [];

  for (const f of filas) {
    const base1 = resolver(f.cliente1);
    const cliente1 = clienteConSaldoDescontado(base1, descontado);
    const cliente2 = resolver(f.cliente2);
    const proyeccion = proyectarFila({
      jugada: f.jugada,
      caballo: f.caballo.trim(),
      monto: f.monto,
      tasaComision,
      cliente1,
      cliente2,
    });
    const montoSolicitado = Number(String(f.monto ?? "").replace(",", "."));
    const sinSaldo = !proyeccion.ok && /sin saldo|saldo disponible|autoriza 0/i.test(proyeccion.motivo);
    parciales.push({
      f,
      base1,
      cliente1,
      cliente2,
      proyeccion,
      montoSolicitado: Number.isFinite(montoSolicitado) ? montoSolicitado : 0,
      valida: proyeccion.ok || sinSaldo,
    });
    if (proyeccion.ok && base1) {
      const usado = descontado.get(String(base1.id)) ?? 0;
      descontado.set(String(base1.id), usado + proyeccion.monto);
    }
  }

  const saldosIniciales = new Map<string, number | null>();
  for (const { f, base1 } of parciales) {
    if (!base1) continue;
    const clave = String(base1.id ?? f.cliente1).trim().replace(/\s+/g, " ").toLocaleUpperCase("es-VE");
    if (String(base1.modo_juego ?? "").trim().toLowerCase() === "libre") {
      saldosIniciales.set(clave, null);
    } else if (!saldosIniciales.has(clave)) {
      const saldo = Number(base1.saldo_actual ?? 0);
      const aval = Number(base1.aval ?? 0);
      saldosIniciales.set(clave, Math.max(0, saldo + aval));
    }
  }
  const evaluaciones = evaluarSaldoProgresivoJugadas(
    parciales.map(({ f, base1, proyeccion, montoSolicitado, valida }, lineaIndice) => ({
      lineaIndice,
      jugador: String(base1?.id ?? f.cliente1),
      contraparte: f.cliente2,
      montoSolicitado,
      montoAutorizado: proyeccion.ok ? proyeccion.monto : 0,
      valida,
    })),
    saldosIniciales
  );

  return parciales.map((fila, i) => ({
    proyeccion: fila.proyeccion,
    cliente1: fila.cliente1,
    cliente2: fila.cliente2,
    montoSolicitado: evaluaciones[i].montoSolicitado,
    montoAceptado: evaluaciones[i].montoAceptado,
    montoExcedido: evaluaciones[i].montoExcedido,
    saldoAntes: evaluaciones[i].saldoAntes,
    saldoRestante: evaluaciones[i].saldoRestante,
    excedido: evaluaciones[i].excedido,
    observacion: evaluaciones[i].observacion,
    observacionCorta: evaluaciones[i].observacionCorta,
    etiquetaRestante: evaluaciones[i].etiquetaRestante,
  }));
}
