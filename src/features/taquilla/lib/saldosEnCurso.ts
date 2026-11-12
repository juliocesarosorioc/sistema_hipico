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
import { calcularComisionExacta, redondearCentavos, restarDinero, sumarDinero } from "@/shared/lib/dinero";
import {
  _comprometidoSimuladoCli,
  normalizarNombreCliente,
  type JugadaActivaSimulacion,
} from "@/features/taquilla/lib/cruces-y-tapas";
import { calcularEstadoCuentaCliente } from "@/features/saldos/lib/contabilidad-central";

export { calcularEstadoCuentaCliente };

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
  /** Frase exacta de disponible para propuesta: Atento "Nombre", disponible X | Nombre sin saldo disponible */
  alertaProponer?: string | null;
  /** Frase exacta de tope en concreción: Nombre hasta X | Nombre sin saldo disponible */
  alertaConcretar?: string | null;
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

export type OpcionesProyeccionEnOrden = {
  /**
   * Si el grupo permite cruces de jugadas sin cobrar comisión:
   * - `true`: al jugar al derecho y al revés (tapa) permite hasta el 100% del monto cubierto (ej. 100 -> 100).
   * - `false`: al jugar al derecho y al revés habiendo agotado saldo, permite hasta lo máximo que ganaría con cualquiera de las dos (`montoCubierto - comision`, ej. 100 al 5% -> 95).
   * - `undefined`: modo compatible por defecto.
   */
  permiteCruces?: boolean;
  /** Jugadas previas ya activas del cliente en la misma carrera. */
  jugadasPreviasCarrera?: JugadaActivaSimulacion[];
};

/**
 * Proyecta TODAS las filas en el orden del plano, descontando progresivamente tanto a
 * Jugador 1 (`cliente1`) como a Jugador 2 (`cliente2`) lo autorizado en cada fila anterior,
 * verificando aval, pozo (`saldo_actual`), disponible y modo libre (`esSinTope`),
 * y aplicando la regla de neteo en vivo (Tapa Derecho/Revés) con o sin cruces.
 */
export function proyectarFilasEnOrden<C extends ClienteConSaldo, F extends FilaDeCarga>(
  filas: F[],
  resolver: (texto: string) => C | null,
  tasaComision?: number,
  opts?: OpcionesProyeccionEnOrden
): ProyeccionEnCurso<C>[] {
  const descontado = new Map<string, number>();
  const ticketsVistos = new Set<string>();
  const jugadasActivas: JugadaActivaSimulacion[] = Array.isArray(opts?.jugadasPreviasCarrera)
    ? [...opts!.jugadasPreviasCarrera]
    : [];
  const tienePreviasExternas = jugadasActivas.length > 0;
  const clientesConJugadaActiva = new Map<string, C>();
  const out: ProyeccionEnCurso<C>[] = [];
  const comPct = tasaComision ?? 5;
  const permiteCrucesSim = Boolean(opts?.permiteCruces);

  for (const f of filas) {
    const idTicket = f.id != null && String(f.id).trim() !== "" ? String(f.id).trim() : null;
    const duplicado = idTicket ? ticketsVistos.has(idTicket) : false;
    if (idTicket) ticketsVistos.add(idTicket);

    const base1 = resolver(f.cliente1);
    const base2 = resolver(f.cliente2);
    const esBanca2 = !base2 || !String(base2.nombre ?? "").trim() || ["BANCA", "CASA", "SISTEMA"].includes(String(base2.nombre ?? "").trim().toUpperCase());
    const montoSolicitado = redondearCentavos(
      parseFloat(String(f.monto ?? "").replace(",", ".")) || 0
    );

    const rawJugada = String(f.jugada ?? "").trim();
    const esInversaEnTexto = /^(?:doy|consigo|da)\s+/i.test(rawJugada);
    const jugadaNormalizadaFila = esInversaEnTexto
      ? rawJugada.replace(/^(?:doy|consigo|da)\s+/i, "").trim()
      : rawJugada;

    const nombre1 = String(base1?.nombre ?? f.cliente1 ?? "").trim();
    const nombre2 = String(base2?.nombre ?? f.cliente2 ?? "").trim();

    const construirTentativa = (monto: number): JugadaActivaSimulacion => ({
      id: idTicket ?? `tmp-${out.length + 1}`,
      jugador: esInversaEnTexto ? (nombre2 || "CONTRAPARTE") : nombre1,
      tercio: esInversaEnTexto ? nombre1 : nombre2,
      jugada: jugadaNormalizadaFila,
      caballo: f.caballo.trim(),
      monto,
      comisionPct: comPct,
    });

    // Evaluar si la nueva fila actúa como TAPA (jugada al derecho y al revés sobre el mismo ejemplar)
    // tanto para Jugador 1 (base1) como para Jugador 2 (base2).
    let mapaDescuentoEfectivo = descontado;
    let fueTapa1 = false;
    let fueTapa2 = false;

    const evaluarCupoTapaCliente = (baseCli: C | null, nombreCli: string): { esTapa: boolean; cupoLiberado: number; usadoActual: number; clave: string } => {
      if (!baseCli || !nombreCli || montoSolicitado <= 0 || jugadasActivas.length === 0) {
        return { esTapa: false, cupoLiberado: 0, usadoActual: 0, clave: "" };
      }
      const clave = String(baseCli.id ?? baseCli.nombre ?? "").trim().toUpperCase();
      const usadoActual = descontado.get(clave) ?? 0;
      const riesgoBrutoAntes = _comprometidoSimuladoCli(nombreCli, jugadasActivas, 0, new Set(), true);
      if (usadoActual <= 0 && riesgoBrutoAntes <= 0) {
        return { esTapa: false, cupoLiberado: 0, usadoActual, clave };
      }
      const montoTest = Math.min(montoSolicitado, Math.max(usadoActual, riesgoBrutoAntes));
      if (montoTest <= 0) {
        return { esTapa: false, cupoLiberado: 0, usadoActual, clave };
      }
      const riesgoBrutoConTest = _comprometidoSimuladoCli(
        nombreCli,
        [...jugadasActivas, construirTentativa(montoTest)],
        0,
        new Set(),
        true
      );
      if (riesgoBrutoConTest < riesgoBrutoAntes) {
        const montoCubierto = restarDinero(riesgoBrutoAntes, riesgoBrutoConTest);
        const cupoLiberado =
          opts?.permiteCruces === false
            ? Math.max(0, restarDinero(montoCubierto, calcularComisionExacta(montoCubierto, comPct)))
            : montoCubierto;
        return { esTapa: true, cupoLiberado, usadoActual, clave };
      }
      return { esTapa: false, cupoLiberado: 0, usadoActual, clave };
    };

    const tapa1 = evaluarCupoTapaCliente(base1, nombre1);
    if (tapa1.esTapa) {
      fueTapa1 = true;
      if (mapaDescuentoEfectivo === descontado) mapaDescuentoEfectivo = new Map(descontado);
      const nuevoDesc1 = tienePreviasExternas
        ? restarDinero(tapa1.usadoActual, tapa1.cupoLiberado)
        : Math.max(0, restarDinero(tapa1.usadoActual, tapa1.cupoLiberado));
      mapaDescuentoEfectivo.set(tapa1.clave, nuevoDesc1);
      if (base1?.id != null) mapaDescuentoEfectivo.set(String(base1.id), nuevoDesc1);
    }

    if (!esBanca2) {
      const tapa2 = evaluarCupoTapaCliente(base2, nombre2);
      if (tapa2.esTapa) {
        fueTapa2 = true;
        if (mapaDescuentoEfectivo === descontado) mapaDescuentoEfectivo = new Map(descontado);
        const nuevoDesc2 = tienePreviasExternas
          ? restarDinero(tapa2.usadoActual, tapa2.cupoLiberado)
          : Math.max(0, restarDinero(tapa2.usadoActual, tapa2.cupoLiberado));
        mapaDescuentoEfectivo.set(tapa2.clave, nuevoDesc2);
        if (base2?.id != null) mapaDescuentoEfectivo.set(String(base2.id), nuevoDesc2);
      }
    }

    const cliente1 = clienteConSaldoDescontado(base1, mapaDescuentoEfectivo);
    const cliente2 = esBanca2 ? base2 : clienteConSaldoDescontado(base2, mapaDescuentoEfectivo);
    const proyeccion = proyectarFila({
      jugada: jugadaNormalizadaFila,
      caballo: f.caballo.trim(),
      monto: f.monto,
      tasaComision,
      cliente1,
      cliente2,
    });

    const dispAntes1 = cliente1
      ? esSinTope(cliente1)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(cliente1))
      : Number.POSITIVE_INFINITY;

    const dispAntes2 = cliente2 && !esBanca2
      ? esSinTope(cliente2)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(cliente2))
      : Number.POSITIVE_INFINITY;

    const montoAceptado = proyeccion.ok ? redondearCentavos(proyeccion.monto) : 0;
    const montoExcedido =
      montoSolicitado > montoAceptado
        ? Math.max(0, restarDinero(montoSolicitado, montoAceptado))
        : 0;

    let riesgoComprometido: number | undefined;
    let riesgoComprometidoCliente2: number | undefined;

    if (proyeccion.ok && !duplicado && montoAceptado > 0) {
      jugadasActivas.push(construirTentativa(montoAceptado));

      if (base1) {
        const clave1 = String(base1.id ?? base1.nombre ?? "").trim().toUpperCase();
        clientesConJugadaActiva.set(clave1, base1);
        const riesgo1 = proyeccion.reparto ? proyeccion.reparto.lado1.riesgo : montoAceptado;
        const acumuladoLineal1 = sumarDinero(descontado.get(clave1) ?? 0, riesgo1);
        const riesgoPrevioExt1 = tienePreviasExternas
          ? _comprometidoSimuladoCli(nombre1, opts!.jugadasPreviasCarrera!, comPct, new Set(), permiteCrucesSim)
          : 0;
        const riesgoSimTotal1 = _comprometidoSimuladoCli(nombre1, jugadasActivas, comPct, new Set(), permiteCrucesSim);
        const riesgoSim1 = tienePreviasExternas
          ? Math.max(0, restarDinero(riesgoSimTotal1, riesgoPrevioExt1))
          : riesgoSimTotal1;
        const nuevoComprometido1 = fueTapa1 || riesgoSim1 < acumuladoLineal1 ? riesgoSim1 : acumuladoLineal1;
        riesgoComprometido = nuevoComprometido1;
        descontado.set(clave1, nuevoComprometido1);
        if (base1.id != null) descontado.set(String(base1.id), nuevoComprometido1);
      }

      if (base2 && !esBanca2) {
        const clave2 = String(base2.id ?? base2.nombre ?? "").trim().toUpperCase();
        clientesConJugadaActiva.set(clave2, base2);
        const riesgo2 = proyeccion.reparto ? proyeccion.reparto.lado2.riesgo : montoAceptado;
        const acumuladoLineal2 = sumarDinero(descontado.get(clave2) ?? 0, riesgo2);
        const riesgoPrevioExt2 = tienePreviasExternas
          ? _comprometidoSimuladoCli(nombre2, opts!.jugadasPreviasCarrera!, comPct, new Set(), permiteCrucesSim)
          : 0;
        const riesgoSimTotal2 = _comprometidoSimuladoCli(nombre2, jugadasActivas, comPct, new Set(), permiteCrucesSim);
        const riesgoSim2 = tienePreviasExternas
          ? Math.max(0, restarDinero(riesgoSimTotal2, riesgoPrevioExt2))
          : riesgoSimTotal2;
        const nuevoComprometido2 = fueTapa2 || riesgoSim2 < acumuladoLineal2 ? riesgoSim2 : acumuladoLineal2;
        riesgoComprometidoCliente2 = nuevoComprometido2;
        descontado.set(clave2, nuevoComprometido2);
        if (base2.id != null) descontado.set(String(base2.id), nuevoComprometido2);
      }
    }

    const dispInicial1 = base1
      ? esSinTope(base1)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(base1))
      : Number.POSITIVE_INFINITY;

    const gasto1 = base1 ? (descontado.get(String(base1.id ?? base1.nombre ?? "").trim().toUpperCase()) ?? 0) : 0;
    const queda = base1
      ? Number.isFinite(dispInicial1)
        ? Math.max(0, restarDinero(dispInicial1, gasto1))
        : Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;

    const dispInicial2 = base2 && !esBanca2
      ? esSinTope(base2)
        ? Number.POSITIVE_INFINITY
        : redondearCentavos(disponibleParaJugar(base2))
      : Number.POSITIVE_INFINITY;

    const gasto2 = base2 && !esBanca2 ? (descontado.get(String(base2.id ?? base2.nombre ?? "").trim().toUpperCase()) ?? 0) : 0;
    const quedaCliente2 = base2 && !esBanca2
      ? Number.isFinite(dispInicial2)
        ? Math.max(0, restarDinero(dispInicial2, gasto2))
        : Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;

    let observacionExceso: string | null = null;
    let observacionMencion: string | null = null;
    let alertaProponer: string | null = null;
    let alertaConcretar: string | null = null;

    const excede1 = Boolean(cliente1 && !esSinTope(cliente1) && montoSolicitado > 0 && dispAntes1 < montoSolicitado);
    const excede2 = Boolean(cliente2 && !esBanca2 && !esSinTope(cliente2) && montoSolicitado > 0 && dispAntes2 < montoSolicitado);

    if ((excede1 || excede2) && montoSolicitado > 0) {
      const nom1 = String(cliente1?.nombre ?? f.cliente1 ?? "Jugador 1").trim();
      const nom2 = String(cliente2?.nombre ?? f.cliente2 ?? "Jugador 2").trim();
      const quienExcede = excede1 && excede2 ? `${nom1} y ${nom2}` : excede1 ? nom1 : nom2;
      const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

      if (montoAceptado <= 0) {
        observacionExceso = "Sin saldo";
        alertaProponer = `${quienExcede} sin saldo disponible`;
        alertaConcretar = `${quienExcede} sin saldo disponible`;
      } else if (montoExcedido > 0) {
        const excEntero = Number.isInteger(montoExcedido)
          ? String(montoExcedido)
          : montoExcedido.toFixed(2);
        observacionExceso = `Excedido ${excEntero}`;
        alertaProponer = `Atento "${quienExcede}", disponible ${fmtN(Math.min(dispAntes1, dispAntes2))}`;
        alertaConcretar = `${quienExcede} hasta ${fmtN(montoAceptado)}`;
      }

      if (observacionExceso) {
        const limpiarTel = (c: ClienteConSaldo | null | undefined) => {
          if (!c) return "";
          const t = String(c.telefono ?? "").replace(/\D+/g, "").replace(/^0+/, "");
          if (!t) return "";
          const cod = String(c.codigo_pais ?? "").replace(/\D+/g, "");
          return cod && !t.startsWith(cod) ? `${cod}${t}` : t;
        };
        const tel1 = limpiarTel(cliente1);
        const tel2 = limpiarTel(cliente2);
        const menc1 = tel1 ? `@${tel1} (${nom1})` : `@${nom1}`;
        const menc2 = tel2 ? `@${tel2} (${nom2})` : `@${nom2}`;
        const jugEtiq = f.caballo.trim() ? `${f.jugada.trim().toUpperCase()} (${f.caballo.trim()})` : f.jugada.trim().toUpperCase();
        observacionMencion = `${menc1} pidió ${fmtN(montoSolicitado)} con ${menc2} en ${jugEtiq} → solo juegan ${fmtN(montoAceptado)} porque ${quienExcede} excede el saldo.`;
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
      alertaProponer,
      alertaConcretar,
    });
  }
  return out;
}
