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
import {
  _comprometidoSimuladoCli,
  normalizarNombreCliente,
  type JugadaActivaSimulacion,
} from "@/features/taquilla/lib/cruces-y-tapas";

/** Cliente mínimo con el que se topa el saldo (compatible con `ClienteVenta`). */
export type ClienteConSaldo = {
  id?: string | number;
  nombre?: string | null;
  saldo_actual?: number | null;
  aval?: number | null;
  libre?: boolean | null;
  modo_juego?: string | null;
  telefono?: string | null;
  codigo_pais?: string | null;
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
  /** Cliente 2 (dador). Nunca se le descuenta si solo actúa como dador sin jugada previa. */
  cliente2: C | null;
  /** Monto solicitado originalmente en la línea. */
  montoSolicitado: number;
  /** Monto efectivamente aceptado tras aplicar el tope de saldo/aval. */
  montoAceptado: number;
  /** Exceso recortado (montoSolicitado - montoAceptado). */
  montoExcedido: number;
  /** Saldo + aval disponible restante después de esta línea (Infinity si libre). */
  queda: number;
  /** Riesgo comprometido simulado de Cliente 1 tras esta fila (considerando tapas/cruces en vivo). */
  riesgoComprometido?: number;
  /** Riesgo comprometido simulado de Cliente 2 tras esta fila (cuando hizo tapa como dador). */
  riesgoComprometidoCliente2?: number;
  /** Saldo + aval disponible restante de Cliente 2 tras esta línea (cuando hizo tapa como dador). */
  quedaCliente2?: number;
  /** Observación auditable cuando hubo recorte o falta de saldo ("Excedido X" / "Sin saldo"). */
  observacionExceso: string | null;
  /** Observación resumida con menciones @número de Usuario 1 y Usuario 2 para el chat/reporte. */
  observacionMencion?: string | null;
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
  const jugadasActivas: JugadaActivaSimulacion[] = [];
  const clientesConJugadaActiva = new Map<string, C>();
  const out: ProyeccionEnCurso<C>[] = [];
  const comPct = tasaComision ?? 5;

  for (const f of filas) {
    const idTicket = f.id != null && String(f.id).trim() !== "" ? String(f.id).trim() : null;
    const duplicado = idTicket ? ticketsVistos.has(idTicket) : false;
    if (idTicket) ticketsVistos.add(idTicket);

    const base1 = resolver(f.cliente1);
    const cliente2 = resolver(f.cliente2);
    const montoSolicitado = redondearCentavos(
      parseFloat(String(f.monto ?? "").replace(",", ".")) || 0
    );

    // Si base1 ya tiene jugadas en la carrera y esta nueva fila actúa como TAPA
    // (su riesgo comprometido simulado disminuye respecto al descontado actual),
    // liberamos el descuento previo para permitir la cobertura en vivo.
    let mapaDescuentoEfectivo = descontado;
    if (base1 && montoSolicitado > 0 && jugadasActivas.length > 0) {
      const clave1 = String(base1.id ?? base1.nombre ?? "").trim().toUpperCase();
      const nombre1 = String(base1.nombre ?? f.cliente1 ?? "").trim();
      const usadoActual = descontado.get(clave1) ?? 0;
      if (usadoActual > 0) {
        const tentativa: JugadaActivaSimulacion = {
          id: idTicket ?? `tmp-${out.length + 1}`,
          jugador: nombre1,
          tercio: String(cliente2?.nombre ?? f.cliente2 ?? "").trim(),
          jugada: f.jugada,
          caballo: f.caballo.trim(),
          monto: montoSolicitado,
          comisionPct: comPct,
        };
        const riesgoConTentativa = _comprometidoSimuladoCli(
          nombre1,
          [...jugadasActivas, tentativa],
          comPct
        );
        if (riesgoConTentativa < usadoActual) {
          mapaDescuentoEfectivo = new Map(descontado);
          mapaDescuentoEfectivo.set(clave1, 0);
          if (base1.id != null) mapaDescuentoEfectivo.set(String(base1.id), 0);
        }
      }
    }

    const cliente1 = clienteConSaldoDescontado(base1, mapaDescuentoEfectivo);
    const proyeccion = proyectarFila({
      jugada: f.jugada,
      caballo: f.caballo.trim(),
      monto: f.monto,
      tasaComision,
      cliente1,
      cliente2,
    });

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

    let riesgoComprometido: number | undefined;
    let riesgoComprometidoCliente2: number | undefined;
    let quedaCliente2: number | undefined;

    if (proyeccion.ok && !duplicado && montoAceptado > 0) {
      const nombreJ1 = String(base1?.nombre ?? f.cliente1 ?? "").trim();
      const nombreJ2 = String(cliente2?.nombre ?? f.cliente2 ?? "").trim();
      jugadasActivas.push({
        id: idTicket ?? `fila-${out.length + 1}`,
        jugador: nombreJ1,
        tercio: nombreJ2,
        jugada: f.jugada,
        caballo: f.caballo.trim(),
        monto: montoAceptado,
        comisionPct: comPct,
      });

      if (base1) {
        const clave1 = String(base1.id ?? base1.nombre ?? "").trim().toUpperCase();
        clientesConJugadaActiva.set(clave1, base1);
        const riesgoSim1 = _comprometidoSimuladoCli(nombreJ1, jugadasActivas, comPct);
        riesgoComprometido = riesgoSim1;
        descontado.set(clave1, riesgoSim1);
        if (base1.id != null) descontado.set(String(base1.id), riesgoSim1);
      }

      if (cliente2) {
        const clave2 = String(cliente2.id ?? cliente2.nombre ?? "").trim().toUpperCase();
        const riesgoSim2 = _comprometidoSimuladoCli(nombreJ2, jugadasActivas, comPct);
        riesgoComprometidoCliente2 = riesgoSim2;
        if (clientesConJugadaActiva.has(clave2)) {
          descontado.set(clave2, riesgoSim2);
          if (cliente2.id != null) descontado.set(String(cliente2.id), riesgoSim2);
        }
        const dispTotal2 = esSinTope(cliente2)
          ? Number.POSITIVE_INFINITY
          : redondearCentavos(disponibleParaJugar(cliente2));
        quedaCliente2 = Number.isFinite(dispTotal2)
          ? Math.max(0, restarDinero(dispTotal2, riesgoSim2))
          : Number.POSITIVE_INFINITY;
      }
    }

    const dispInicial1 = base1
      ? esSinTope(base1)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(base1))
      : Number.POSITIVE_INFINITY;

    const queda = base1
      ? Number.isFinite(dispInicial1)
        ? Math.max(
            0,
            restarDinero(
              dispInicial1,
              riesgoComprometido != null
                ? riesgoComprometido
                : (descontado.get(String(base1.id ?? base1.nombre ?? "").trim().toUpperCase()) ?? 0)
            )
          )
        : Number.POSITIVE_INFINITY
      : quedaCliente2 != null
        ? quedaCliente2
        : Number.POSITIVE_INFINITY;

    let observacionExceso: string | null = null;
    let observacionMencion: string | null = null;
    if (cliente1 && !esSinTope(cliente1) && montoSolicitado > 0) {
      if (montoAceptado <= 0 && dispAntes <= 0) {
        observacionExceso = "Sin saldo";
      } else if (montoExcedido > 0) {
        const excEntero = Number.isInteger(montoExcedido)
          ? String(montoExcedido)
          : montoExcedido.toFixed(2);
        observacionExceso = `Excedido ${excEntero}`;
      }
      if (observacionExceso) {
        const limpiarTel = (c: ClienteConSaldo | null | undefined) => {
          if (!c) return "";
          const t = String(c.telefono ?? "").replace(/\D+/g, "").replace(/^0+/, "");
          if (!t) return "";
          const cod = String(c.codigo_pais ?? "").replace(/\D+/g, "");
          return cod && !t.startsWith(cod) ? `${cod}${t}` : t;
        };
        const nom1 = String(cliente1.nombre ?? f.cliente1 ?? "Jugador 1").trim();
        const nom2 = String(cliente2?.nombre ?? f.cliente2 ?? "Banca").trim() || "Banca";
        const tel1 = limpiarTel(cliente1);
        const tel2 = limpiarTel(cliente2);
        const menc1 = tel1 ? `@${tel1} (${nom1})` : `@${nom1}`;
        const menc2 = tel2 ? `@${tel2} (${nom2})` : `@${nom2}`;
        const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
        const jugEtiq = f.caballo.trim() ? `${f.jugada.trim().toUpperCase()} (${f.caballo.trim()})` : f.jugada.trim().toUpperCase();
        observacionMencion = `${menc1} pidió ${fmtN(montoSolicitado)} con ${menc2} en ${jugEtiq} → solo juegan ${fmtN(montoAceptado)} porque ${nom1} excede el saldo.`;
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
      riesgoComprometido,
      riesgoComprometidoCliente2,
      quedaCliente2,
      observacionExceso,
      observacionMencion,
    });
  }
  return out;
}
