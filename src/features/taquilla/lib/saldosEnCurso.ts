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
 *  por las filas anteriores antes de proyectar la siguiente, deduplicando por
 *  `id` de ticket para jamás restar dos veces la misma jugada.
 *
 *  Módulo PURO (sin React ni red). Lo usan tanto la vista previa como el cobro
 *  de `Gestión de Jugadas`.
 */
import { proyectarFila, type FilaProyeccion } from "@/features/taquilla/lib/validar";
import { disponibleParaJugar, esSinTope } from "@/features/taquilla/lib/reparto";
import { redondearCentavos, restarDinero, sumarDinero } from "@/shared/lib/dinero";

/** Cliente mínimo con el que se topa el saldo (compatible con `ClienteVenta`). */
export type ClienteConSaldo = {
  id?: string | number;
  nombre?: string | null;
  saldo_actual?: number | null;
  aval?: number | null;
  libre?: boolean | null;
  modo_juego?: string | null;
};

/** Fila de la carga: mismas columnas que `proyectarFila` consume. */
export type FilaDeCarga = {
  id?: string | number;
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
  /** Monto solicitado originalmente en la línea. */
  montoSolicitado: number;
  /** Monto efectivamente aceptado tras aplicar el tope de saldo/aval. */
  montoAceptado: number;
  /** Exceso recortado (montoSolicitado - montoAceptado). */
  montoExcedido: number;
  /** Saldo + aval disponible restante después de esta línea (Infinity si libre). */
  queda: number;
  /** Observación auditable cuando hubo recorte o falta de saldo ("Excedido X" / "Sin saldo"). */
  observacionExceso: string | null;
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
  const clave = String(cliente.id ?? cliente.nombre ?? "").trim().toUpperCase();
  const usado = descontado.get(clave) ?? descontado.get(String(cliente.id)) ?? 0;
  if (!usado) return cliente;
  return {
    ...cliente,
    saldo_actual: restarDinero(Number(cliente.saldo_actual ?? 0), usado),
  };
}

/**
 * Proyecta TODAS las filas en el orden del plano, descontando del cliente 1 lo
 * autorizado en cada fila anterior y deduplicando por `id` de ticket si viene
 * informado. Devuelve, por fila, la proyección, los clientes ya con el saldo
 * restante y el desglose progresivo (`queda`, `montoSolicitado`, `montoAceptado`,
 * `montoExcedido`, `observacionExceso`).
 */
export function proyectarFilasEnOrden<C extends ClienteConSaldo, F extends FilaDeCarga>(
  filas: F[],
  resolver: (texto: string) => C | null,
  tasaComision?: number
): ProyeccionEnCurso<C>[] {
  const descontado = new Map<string, number>();
  const ticketsVistos = new Set<string>();
  const out: ProyeccionEnCurso<C>[] = [];

  for (const f of filas) {
    const idTicket = f.id != null && String(f.id).trim() !== "" ? String(f.id).trim() : null;
    const duplicado = idTicket ? ticketsVistos.has(idTicket) : false;
    if (idTicket) ticketsVistos.add(idTicket);

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

    const montoSolicitado = redondearCentavos(
      parseFloat(String(f.monto ?? "").replace(",", ".")) || 0
    );
    const dispAntes = cliente1
      ? esSinTope(cliente1)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(cliente1))
      : Number.POSITIVE_INFINITY;

    const montoAceptado = proyeccion.ok ? redondearCentavos(proyeccion.monto) : 0;
    const montoExcedido =
      montoSolicitado > montoAceptado
        ? Math.max(0, restarDinero(montoSolicitado, montoAceptado))
        : 0;

    if (proyeccion.ok && base1 && !duplicado) {
      const clave = String(base1.id ?? base1.nombre ?? "").trim().toUpperCase();
      const usado = descontado.get(clave) ?? 0;
      const nuevo = sumarDinero(usado, montoAceptado);
      descontado.set(clave, nuevo);
      if (base1.id != null) descontado.set(String(base1.id), nuevo);
    }

    const queda = Number.isFinite(dispAntes)
      ? Math.max(0, restarDinero(dispAntes, duplicado ? 0 : montoAceptado))
      : Number.POSITIVE_INFINITY;

    let observacionExceso: string | null = null;
    if (cliente1 && !esSinTope(cliente1) && montoSolicitado > 0) {
      if (montoAceptado <= 0 && dispAntes <= 0) {
        observacionExceso = "Sin saldo";
      } else if (montoExcedido > 0) {
        const excEntero = Number.isInteger(montoExcedido)
          ? String(montoExcedido)
          : montoExcedido.toFixed(2);
        observacionExceso = `Excedido ${excEntero}`;
      }
    }

    out.push({
      proyeccion,
      cliente1,
      cliente2,
      montoSolicitado,
      montoAceptado,
      montoExcedido,
      queda,
      observacionExceso,
    });
  }
  return out;
}
