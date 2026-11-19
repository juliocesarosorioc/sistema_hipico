/**
 * ============================================================================
 * MESA DE PROPUESTAS Y CONCRECIONES — descuento progresivo de disponible
 * ============================================================================
 *
 * Núcleo PURO e INMUTABLE (cada operación devuelve un estado nuevo) que lleva el
 * "libro" de propuestas abiertas del Agente y el disponible de cada jugador.
 *
 * REGLAS (frases EXACTAS que emite el Agente):
 *
 *  1. DESCUENTO EN CALIENTE. Pedro con disponible 500 que propone o concreta 400
 *     queda de una vez con 100.
 *  2. PROPONER POR ENCIMA del disponible: la propuesta baja al máximo disponible
 *     (jamás se publica el exceso) y se avisa:
 *        Atento "Pedro", disponible 500
 *  3. CONCRETAR POR ENCIMA del disponible (J / Ponte / Jugué / Jugaste): se
 *     amarra solo lo que alcanza, el resto queda ABIERTO en la propuesta:
 *        Juan hasta 300
 *  4. DISPONIBLE AGOTADO (<= 0): se bloquea cualquier propuesta o concreción:
 *        Pedro sin saldo disponible
 *
 * El riesgo comprometido por jugada se toma como el `monto` (jugadas de puestos
 * 1 a 1). Las proporciones A Premio (10a8) las ajusta la capa de ventas al
 * registrar el ticket real.
 */
import {
  esComandoCerrarJugada,
  esComandoJugueConTodos,
  parsearConcrecion,
  parsearMensajeJugada,
  type DatosJugada,
  type RolJugada,
} from "@/features/portal/lib/gramatica-concrecion-hipica";
import {
  MENSAJE_CARRERA_CERRADA,
  esCarreraCerradaOEnPartida,
  type EstadoOperativoCarrera,
} from "@/features/portal/lib/bloqueo-jugadas";
import { jugadaInvolucraRetirado } from "@/features/carreras/lib/retiros-nucleo";

export { MENSAJE_CARRERA_CERRADA };

export type PropuestaPuesto = {
  id: number;
  autor: string;
  rol: RolJugada;
  jugada: string;
  caballos: string;
  montoOriginal: number;
  /** Lo que todavía no ha concretado nadie. */
  montoAbierto: number;
  /** true si el autor cerró la propuesta con "Se Fue" o equivalente. */
  cerradaPorAutor?: boolean;
};

/** Una jugada ya amarrada entre el autor de la propuesta y quien concretó. */
export type ConcrecionPuesto = {
  propuestaId: number;
  autor: string;
  rolAutor: RolJugada;
  /** Quien respondió J / Ponte / Jugué. Toma el lado contrario al autor. */
  jugador: string;
  rolJugador: RolJugada;
  jugada: string;
  caballos: string;
  monto: number;
};

/**
 * Cola FIFO de aceptantes con saldo pendiente cuando una propuesta se llena
 * parcialmente (ej. pidió 30 y quedaban 10 -> "Jugo 10, Es lo que queda", quedan 20 pendientes)
 * o entra un siguiente jugador (ej. cuarto jugador con 30) a la espera de "Jugue con Todos" / "Todos".
 */
export type PendienteConcrecionPuesto = {
  propuestaId: number;
  jugador: string;
  montoSolicitado: number;
  montoConcretado: number;
  montoPendiente: number;
  /** true si el jugador dijo "Se Fue" o cualquiera de los códigos para cerrar la jugada. */
  cerrada: boolean;
};

export type EstadoMesa = {
  /** Disponible actual por jugador (ya descontado lo propuesto y lo concretado). */
  disponibles: Record<string, number>;
  propuestas: PropuestaPuesto[];
  concreciones: ConcrecionPuesto[];
  /** Cola FIFO de concreciones parciales o en espera de "Jugue con Todos" / "Todos". */
  pendientes?: PendienteConcrecionPuesto[];
  /** Avisos de límite ("Juan hasta 300") para las observaciones del reporte. */
  limites: string[];
  siguienteId: number;
  /** Estado operativo de la carrera actual ('ABIERTA' | 'CERRADA' | 'LIQUIDADA' | ...). */
  estadoCarrera?: EstadoOperativoCarrera;
  /** true si la carrera ya cerró o dio la partida. */
  carreraCerrada?: boolean;
  /** Hora de partida programada para validación automática. */
  horaPartida?: string | Date | number | null;
};

export type ResultadoMesa = {
  estado: EstadoMesa;
  /** true si la acción hizo algo (publicó o concretó). */
  ok: boolean;
  /** true si se rechazó por falta de saldo o por carrera cerrada. */
  bloqueado: boolean;
  /** Mensajes del Agente, EXACTOS, en el orden en que se emiten. */
  mensajes: string[];
  propuesta?: PropuestaPuesto;
  concrecion?: ConcrecionPuesto;
  /** Monto realmente publicado / amarrado (tras topar con el disponible). */
  monto?: number;
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""));
const redondear = (n: number): number => Math.round(n * 100) / 100;

/** Frases EXACTAS del Agente. */
export const frases = {
  atento: (nombre: string, disponible: number) => `Atento "${nombre}", disponible ${fmt(disponible)}`,
  atentoConIcono: (nombre: string, disponible: number) => `⚠️ Atento '${nombre}', disponible ${fmt(disponible)}.`,
  hasta: (nombre: string, disponible: number) => `${nombre} hasta ${fmt(disponible)}`,
  sinSaldo: (nombre: string) => `${nombre} sin saldo disponible`,
  sinSaldoConIcono: (nombre: string) => `⛔ ${nombre} sin saldo disponible.`,
  esLoQueQueda: (monto: number) => `Jugo ${fmt(monto)}, Es lo que queda`,
  jugoCompleto: (monto: number) => `Jugó Completo ${fmt(monto)}`,
  jugo: (monto: number) => `Jugo ${fmt(monto)}`,
  carreraCerrada: () => MENSAJE_CARRERA_CERRADA,
} as const;

export const notificarSinSaldo = (nombre: string): string => frases.sinSaldoConIcono(nombre);
export const notificarAjusteDisponible = (nombre: string, disponible: number): string =>
  frases.atentoConIcono(nombre, disponible);

/** Mesa nueva con el disponible de cada jugador. */
export function crearMesa(
  disponibles: Record<string, number> = {},
  opciones?: {
    estadoCarrera?: EstadoOperativoCarrera;
    carreraCerrada?: boolean;
    horaPartida?: string | Date | number | null;
  }
): EstadoMesa {
  return {
    disponibles: { ...disponibles },
    propuestas: [],
    concreciones: [],
    pendientes: [],
    limites: [],
    siguienteId: 1,
    estadoCarrera: opciones?.estadoCarrera ?? "ABIERTA",
    carreraCerrada: opciones?.carreraCerrada ?? false,
    horaPartida: opciones?.horaPartida ?? null,
  };
}

/** Actualiza de forma inmutable el estado de la carrera en la mesa. */
export function fijarEstadoCarreraMesa(
  estado: EstadoMesa,
  estadoCarrera: EstadoOperativoCarrera | boolean,
  opciones?: { horaPartida?: string | Date | number | null }
): EstadoMesa {
  const nuevo = copiar(estado);
  if (typeof estadoCarrera === "boolean") {
    nuevo.carreraCerrada = estadoCarrera;
    nuevo.estadoCarrera = estadoCarrera ? "CERRADA" : "ABIERTA";
  } else {
    nuevo.estadoCarrera = estadoCarrera;
    nuevo.carreraCerrada = esCarreraCerradaOEnPartida(estadoCarrera);
  }
  if (opciones?.horaPartida !== undefined) {
    nuevo.horaPartida = opciones.horaPartida;
  }
  return nuevo;
}

/**
 * Incrementa o descuenta el saldo disponible de un jugador en caliente
 * (ej. cuando se aprueba un cobro/depósito o se ejecuta un pago a ganador)
 * y emite las notificaciones oficiales si queda sin fondos.
 */
export function actualizarSaldoMesaEnCaliente(
  estado: EstadoMesa,
  params: {
    jugador: string;
    monto: number;
    operacion: "ABONO" | "DESCUENTO" | "FIJAR";
  }
): {
  estado: EstadoMesa;
  jugador: string;
  saldoAnterior: number;
  nuevoSaldo: number;
  sinSaldo: boolean;
  notificaciones: string[];
} {
  const clave = claveDe(estado, params.jugador);
  const anterior = disponibleDe(estado, clave);
  const delta = redondear(Math.abs(Number(params.monto) || 0));
  let nuevoSaldo = anterior;
  if (params.operacion === "ABONO") {
    nuevoSaldo = redondear(anterior + delta);
  } else if (params.operacion === "DESCUENTO") {
    nuevoSaldo = redondear(anterior - delta);
  } else {
    nuevoSaldo = redondear(Number(params.monto) || 0);
  }

  const nuevoEstado = copiar(estado);
  nuevoEstado.disponibles[clave] = nuevoSaldo;

  const notificaciones: string[] = [];
  const sinSaldo = nuevoSaldo <= 0;
  if (sinSaldo) {
    notificaciones.push(frases.sinSaldoConIcono(clave));
  }

  return {
    estado: nuevoEstado,
    jugador: clave,
    saldoAnterior: anterior,
    nuevoSaldo,
    sinSaldo,
    notificaciones,
  };
}

/** Clave real del jugador en la mesa (sin distinguir mayúsculas). */
function claveDe(estado: EstadoMesa, nombre: string): string {
  const buscado = String(nombre ?? "").trim().toLowerCase();
  return Object.keys(estado.disponibles).find((k) => k.trim().toLowerCase() === buscado) ?? String(nombre ?? "").trim();
}

/** Disponible vigente de un jugador (0 si no está en la mesa). */
export function disponibleDe(estado: EstadoMesa, nombre: string): number {
  return estado.disponibles[claveDe(estado, nombre)] ?? 0;
}

const copiar = (e: EstadoMesa): EstadoMesa => ({
  ...e,
  disponibles: { ...e.disponibles },
  propuestas: e.propuestas.map((p) => ({ ...p })),
  concreciones: e.concreciones.map((c) => ({ ...c })),
  pendientes: (e.pendientes ?? []).map((p) => ({ ...p })),
  limites: [...e.limites],
});

const bloqueo = (estado: EstadoMesa, mensaje: string): ResultadoMesa => ({
  estado,
  ok: false,
  bloqueado: true,
  mensajes: [mensaje],
});

function verificarMesaCerrada(
  estado: EstadoMesa,
  override?: {
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
  }
): boolean {
  return esCarreraCerradaOEnPartida({
    estado: override?.estadoCarrera ?? estado.estadoCarrera,
    cerrada: override?.cerrada ?? estado.carreraCerrada,
    horaPartida: override?.horaPartida ?? estado.horaPartida,
    ahora: override?.ahora,
  });
}

/**
 * PROPONER. Topa con el disponible: nunca publica el exceso.
 */
export function proponer(
  estado: EstadoMesa,
  p: {
    autor: string;
    rol: RolJugada;
    jugada: string;
    caballos: string;
    monto: number;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
    formatoConIcono?: boolean;
  }
): ResultadoMesa {
  if (verificarMesaCerrada(estado, p)) {
    return bloqueo(estado, MENSAJE_CARRERA_CERRADA);
  }
  const clave = claveDe(estado, p.autor);
  const nombre = clave;
  const monto = redondear(Number(p.monto));
  if (!Number.isFinite(monto) || monto <= 0) {
    return { estado, ok: false, bloqueado: false, mensajes: ["Indica un monto mayor que 0."] };
  }
  const disponible = disponibleDe(estado, clave);
  if (disponible <= 0) {
    return bloqueo(
      estado,
      p.formatoConIcono ? frases.sinSaldoConIcono(nombre) : frases.sinSaldo(nombre)
    );
  }

  const publicado = Math.min(monto, disponible);
  const mensajes: string[] = [];
  const limites: string[] = [];
  if (monto > disponible) {
    // El aviso lleva el disponible ANTES de descontar lo publicado.
    const aviso = p.formatoConIcono
      ? frases.atentoConIcono(nombre, disponible)
      : frases.atento(nombre, disponible);
    mensajes.push(aviso);
    limites.push(aviso);
  }

  const nuevo = copiar(estado);
  nuevo.disponibles[clave] = redondear(disponible - publicado);
  const propuesta: PropuestaPuesto = {
    id: nuevo.siguienteId,
    autor: nombre,
    rol: p.rol,
    jugada: p.jugada,
    caballos: p.caballos,
    montoOriginal: publicado,
    montoAbierto: publicado,
  };
  nuevo.siguienteId += 1;
  nuevo.propuestas.push(propuesta);
  nuevo.limites.push(...limites);
  return { estado: nuevo, ok: true, bloqueado: false, mensajes, propuesta, monto: publicado };
}

/**
 * CONCRETAR (J / Ponte / Jugué / Jugaste). Sin `monto`, toma todo lo abierto;
 * con `monto`, solo esa parte. Topa con el disponible y deja el resto abierto.
 */
export function concretar(
  estado: EstadoMesa,
  c: {
    jugador: string;
    propuestaId?: number;
    monto?: number;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
    formatoConIcono?: boolean;
  }
): ResultadoMesa {
  if (verificarMesaCerrada(estado, c)) {
    return bloqueo(estado, MENSAJE_CARRERA_CERRADA);
  }
  const clave = claveDe(estado, c.jugador);
  const nombre = clave;
  const propuestaAbierta =
    c.propuestaId !== undefined
      ? estado.propuestas.find((p) => p.id === c.propuestaId)
      : [...estado.propuestas].reverse().find((p) => p.montoAbierto > 0 && !p.cerradaPorAutor);

  const propuestaParaCola =
    !propuestaAbierta && c.monto !== undefined && c.monto > 0
      ? c.propuestaId !== undefined
        ? estado.propuestas.find((p) => p.id === c.propuestaId && !p.cerradaPorAutor)
        : [...estado.propuestas].reverse().find((p) => !p.cerradaPorAutor)
      : undefined;

  const propuesta = propuestaAbierta ?? propuestaParaCola;

  if (!propuesta || (propuesta.montoAbierto <= 0 && !propuestaParaCola)) {
    return { estado, ok: false, bloqueado: false, mensajes: ["No hay ninguna propuesta abierta para concretar."] };
  }
  if (propuesta.autor.trim().toLowerCase() === clave.trim().toLowerCase()) {
    return { estado, ok: false, bloqueado: false, mensajes: [`${nombre} no puede concretar su propia propuesta.`] };
  }
  const disponible = disponibleDe(estado, clave);
  if (disponible <= 0) {
    return bloqueo(
      estado,
      c.formatoConIcono ? frases.sinSaldoConIcono(nombre) : frases.sinSaldo(nombre)
    );
  }

  // Si la propuesta ya agotó su montoAbierto (0) pero el jugador entra con un monto válido (ej. el 4to jugador con 30),
  // queda en cola FIFO a la espera de que el proponente diga "Jugue con Todos" o "Todos" (salvo que diga "Se Fue").
  if (propuesta.montoAbierto <= 0) {
    const montoDeseado = redondear(c.monto!);
    const topeJugador = Math.min(montoDeseado, disponible);
    const nuevo = copiar(estado);
    nuevo.pendientes = nuevo.pendientes ?? [];
    nuevo.pendientes.push({
      propuestaId: propuesta.id,
      jugador: nombre,
      montoSolicitado: topeJugador,
      montoConcretado: 0,
      montoPendiente: topeJugador,
      cerrada: false,
    });
    const prop = nuevo.propuestas.find((p) => p.id === propuesta.id)!;
    return { estado: nuevo, ok: true, bloqueado: false, mensajes: [], propuesta: prop, monto: 0 };
  }

  const montoSolicitadoExplicito =
    c.monto !== undefined && c.monto > 0 ? redondear(c.monto) : undefined;
  const pedido = Math.min(
    montoSolicitadoExplicito !== undefined ? montoSolicitadoExplicito : propuesta.montoAbierto,
    propuesta.montoAbierto
  );
  const amarrado = Math.min(pedido, disponible);
  const mensajes: string[] = [];
  const limites: string[] = [];
  if (pedido > disponible) {
    const aviso = frases.hasta(nombre, disponible);
    mensajes.push(aviso);
    limites.push(aviso);
  }

  const fueRecortadoPorRemanente =
    montoSolicitadoExplicito !== undefined &&
    montoSolicitadoExplicito > propuesta.montoAbierto &&
    amarrado === propuesta.montoAbierto;

  if (fueRecortadoPorRemanente) {
    mensajes.push(frases.esLoQueQueda(amarrado));
  }

  const nuevo = copiar(estado);
  nuevo.disponibles[clave] = redondear(disponible - amarrado);
  const prop = nuevo.propuestas.find((p) => p.id === propuesta.id)!;
  prop.montoAbierto = redondear(prop.montoAbierto - amarrado);
  const concrecion: ConcrecionPuesto = {
    propuestaId: prop.id,
    autor: prop.autor,
    rolAutor: prop.rol,
    jugador: nombre,
    rolJugador: prop.rol === "DA" ? "JUEGA" : "DA",
    jugada: prop.jugada,
    caballos: prop.caballos,
    monto: amarrado,
  };
  nuevo.concreciones.push(concrecion);

  if (fueRecortadoPorRemanente && montoSolicitadoExplicito !== undefined) {
    const topeSolicitado = Math.min(montoSolicitadoExplicito, disponible);
    const pendiente = redondear(Math.max(0, topeSolicitado - amarrado));
    if (pendiente > 0) {
      nuevo.pendientes = nuevo.pendientes ?? [];
      nuevo.pendientes.push({
        propuestaId: prop.id,
        jugador: nombre,
        montoSolicitado: topeSolicitado,
        montoConcretado: amarrado,
        montoPendiente: pendiente,
        cerrada: false,
      });
    }
  }

  nuevo.limites.push(...limites);
  return { estado: nuevo, ok: true, bloqueado: false, mensajes, propuesta: prop, concrecion, monto: amarrado };
}

/**
 * CERRAR JUGADA ("Se Fue", "sf", "cf", "c fue", "ce fue").
 * - Si lo dice un jugador que tenía un remanente o turno pendiente en cola (ej. el 3ro o 4to),
 *   cierra su remanente pendiente para que no entre cuando el proponente diga "Jugue con Todos" / "Todos".
 * - Si lo dice el proponente, retira el montoAbierto restante de su propuesta (restituyendo su disponible)
 *   y cierra la cola pendiente de esa propuesta.
 */
export function cerrarJugada(
  estado: EstadoMesa,
  params: {
    jugador: string;
    propuestaId?: number;
  }
): ResultadoMesa {
  const clave = claveDe(estado, params.jugador);
  const nuevo = copiar(estado);
  nuevo.pendientes = nuevo.pendientes ?? [];
  let hizoAlgo = false;

  for (const item of nuevo.pendientes) {
    if (
      !item.cerrada &&
      item.montoPendiente > 0 &&
      item.jugador.trim().toLowerCase() === clave.trim().toLowerCase() &&
      (params.propuestaId === undefined || item.propuestaId === params.propuestaId)
    ) {
      item.cerrada = true;
      item.montoPendiente = 0;
      hizoAlgo = true;
    }
  }

  for (const prop of nuevo.propuestas) {
    if (
      !prop.cerradaPorAutor &&
      prop.autor.trim().toLowerCase() === clave.trim().toLowerCase() &&
      (params.propuestaId === undefined || prop.id === params.propuestaId)
    ) {
      if (prop.montoAbierto > 0) {
        nuevo.disponibles[clave] = redondear(disponibleDe(nuevo, clave) + prop.montoAbierto);
        prop.montoAbierto = 0;
      }
      prop.cerradaPorAutor = true;
      for (const item of nuevo.pendientes) {
        if (item.propuestaId === prop.id && !item.cerrada) {
          item.cerrada = true;
          item.montoPendiente = 0;
        }
      }
      hizoAlgo = true;
    }
  }

  return {
    estado: nuevo,
    ok: hizoAlgo,
    bloqueado: false,
    mensajes: [],
  };
}

/**
 * CONCRETAR CON TODOS ("Jugue con Todos" / "Todos").
 * El proponente acepta cubrir a todos los jugadores que quedaron parciales (ej. el 3ro que jugó 10 de 30)
 * o en cola (ej. el 4to con 30) y que NO hayan dicho "Se Fue" ni códigos de cierre:
 * - Al 3ro (que tenía parte jugada y completa su jugada): "Jugó Completo 30"
 * - Al 4to (que estaba en cola sin monto jugado): "Jugo 30"
 * Descontando el saldo correspondiente a todos (proponente y aceptantes).
 */
export function concretarConTodos(
  estado: EstadoMesa,
  params: {
    autor: string;
    propuestaId?: number;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
  }
): ResultadoMesa {
  if (verificarMesaCerrada(estado, params)) {
    return bloqueo(estado, MENSAJE_CARRERA_CERRADA);
  }
  const claveAutor = claveDe(estado, params.autor);
  const pendientesActivos = (estado.pendientes ?? []).filter((p) => !p.cerrada && p.montoPendiente > 0);
  const propuesta =
    params.propuestaId !== undefined
      ? estado.propuestas.find(
          (p) =>
            p.id === params.propuestaId &&
            p.autor.trim().toLowerCase() === claveAutor.trim().toLowerCase() &&
            !p.cerradaPorAutor
        )
      : [...estado.propuestas]
          .reverse()
          .find(
            (p) =>
              p.autor.trim().toLowerCase() === claveAutor.trim().toLowerCase() &&
              !p.cerradaPorAutor &&
              pendientesActivos.some((item) => item.propuestaId === p.id)
          );

  if (!propuesta) {
    return {
      estado,
      ok: false,
      bloqueado: false,
      mensajes: ["No hay jugadas pendientes para concretar con todos."],
    };
  }

  const nuevo = copiar(estado);
  nuevo.pendientes = nuevo.pendientes ?? [];
  const prop = nuevo.propuestas.find((p) => p.id === propuesta.id)!;
  const mensajes: string[] = [];
  let totalAdicional = 0;

  for (const item of nuevo.pendientes) {
    if (item.propuestaId !== prop.id || item.cerrada || item.montoPendiente <= 0) continue;

    const claveJugador = claveDe(nuevo, item.jugador);
    const dispAutor = disponibleDe(nuevo, claveAutor);
    const dispJugador = disponibleDe(nuevo, claveJugador);
    const cupoAbiertoPreviamenteDescontado = prop.montoAbierto;
    const maxPosibleAutor = redondear(cupoAbiertoPreviamenteDescontado + dispAutor);

    const adicional = Math.min(item.montoPendiente, maxPosibleAutor, dispJugador);
    if (adicional <= 0) continue;

    const consumeDeAbierto = Math.min(cupoAbiertoPreviamenteDescontado, adicional);
    const consumeDeDisponibleAutor = redondear(adicional - consumeDeAbierto);

    prop.montoAbierto = redondear(prop.montoAbierto - consumeDeAbierto);
    if (consumeDeDisponibleAutor > 0) {
      nuevo.disponibles[claveAutor] = redondear(dispAutor - consumeDeDisponibleAutor);
    }
    nuevo.disponibles[claveJugador] = redondear(dispJugador - adicional);

    const eraParcial = item.montoConcretado > 0;
    const nuevoTotalJugador = redondear(item.montoConcretado + adicional);
    item.montoConcretado = nuevoTotalJugador;
    item.montoPendiente = redondear(item.montoPendiente - adicional);
    totalAdicional = redondear(totalAdicional + adicional);

    if (eraParcial) {
      const concExistente = [...nuevo.concreciones]
        .reverse()
        .find(
          (c) =>
            c.propuestaId === prop.id &&
            c.jugador.trim().toLowerCase() === claveJugador.trim().toLowerCase()
        );
      if (concExistente) {
        concExistente.monto = nuevoTotalJugador;
      } else {
        nuevo.concreciones.push({
          propuestaId: prop.id,
          autor: prop.autor,
          rolAutor: prop.rol,
          jugador: claveJugador,
          rolJugador: prop.rol === "DA" ? "JUEGA" : "DA",
          jugada: prop.jugada,
          caballos: prop.caballos,
          monto: nuevoTotalJugador,
        });
      }
      mensajes.push(
        item.montoPendiente === 0
          ? frases.jugoCompleto(nuevoTotalJugador)
          : frases.jugo(nuevoTotalJugador)
      );
    } else {
      nuevo.concreciones.push({
        propuestaId: prop.id,
        autor: prop.autor,
        rolAutor: prop.rol,
        jugador: claveJugador,
        rolJugador: prop.rol === "DA" ? "JUEGA" : "DA",
        jugada: prop.jugada,
        caballos: prop.caballos,
        monto: nuevoTotalJugador,
      });
      mensajes.push(frases.jugo(nuevoTotalJugador));
    }
  }

  return {
    estado: nuevo,
    ok: totalAdicional > 0,
    bloqueado: false,
    mensajes,
    propuesta: prop,
    monto: totalAdicional,
  };
}

/**
 * Fachada del AGENTE: recibe lo que escribió un jugador y decide si es una
 * concreción ("J", "Ponte"…), un cierre ("Se Fue"), una ampliación ("Jugue con Todos" / "Todos")
 * o una propuesta ("consigo 1p 2-5 300"). Si el texto no se entiende, responde con la aclaratoria y NO toca el estado.
 */
export function procesarMensajeMesa(
  estado: EstadoMesa,
  entrada: {
    jugador: string;
    texto: string;
    propuestaId?: number;
    estadoCarrera?: EstadoOperativoCarrera | null;
    cerrada?: boolean | null;
    horaPartida?: string | Date | number | null;
    ahora?: Date | number | null;
    formatoConIcono?: boolean;
  }
): ResultadoMesa {
  if (verificarMesaCerrada(estado, entrada)) {
    return bloqueo(estado, MENSAJE_CARRERA_CERRADA);
  }
  if (esComandoCerrarJugada(entrada.texto)) {
    return cerrarJugada(estado, {
      jugador: entrada.jugador,
      propuestaId: entrada.propuestaId,
    });
  }
  if (esComandoJugueConTodos(entrada.texto)) {
    return concretarConTodos(estado, {
      autor: entrada.jugador,
      propuestaId: entrada.propuestaId,
      estadoCarrera: entrada.estadoCarrera,
      cerrada: entrada.cerrada,
      horaPartida: entrada.horaPartida,
      ahora: entrada.ahora,
    });
  }
  const conc = parsearConcrecion(entrada.texto);
  if (conc.ok) {
    return concretar(estado, {
      jugador: entrada.jugador,
      propuestaId: entrada.propuestaId,
      monto: conc.monto,
      formatoConIcono: entrada.formatoConIcono,
    });
  }

  const parseo = parsearMensajeJugada(entrada.texto);
  if (!parseo.ok) return { estado, ok: false, bloqueado: false, mensajes: [parseo.aclaratoria] };
  const d: DatosJugada = parseo.datos;
  return proponer(estado, {
    autor: entrada.jugador,
    rol: d.rol,
    jugada: d.jugada,
    caballos: d.caballos,
    monto: d.monto,
    formatoConIcono: entrada.formatoConIcono,
  });
}

/** Observaciones del reporte de WhatsApp con los límites alcanzados ("Juan hasta 300"). */
export function observacionesDeLimites(estado: EstadoMesa): string {
  return [...new Set(estado.limites)].join("\n");
}

/**
 * Anula en la mesa todas las propuestas abiertas y concreciones que involucren
 * algún ejemplar retirado, restituyendo el saldo comprometido a cada jugador.
 */
export function anularJugadasMesaPorRetiro(
  estado: EstadoMesa,
  retirados: Array<string | number>
): { estado: EstadoMesa; propuestasAnuladas: number; concrecionesAnuladas: number } {
  const nuevo = copiar(estado);
  let propuestasAnuladas = 0;
  let concrecionesAnuladas = 0;

  const restablecerSaldo = (nombre: string, monto: number) => {
    if (monto <= 0) return;
    const k = Object.keys(nuevo.disponibles).find((x) => x.toUpperCase() === nombre.trim().toUpperCase()) ?? nombre.trim();
    nuevo.disponibles[k] = redondear((nuevo.disponibles[k] ?? 0) + monto);
  };

  nuevo.propuestas = nuevo.propuestas.filter((p) => {
    if (jugadaInvolucraRetirado(p.caballos, null, p.jugada, retirados)) {
      // Restituir la porción aún abierta (las concreciones se restituyen abajo)
      if (p.montoAbierto > 0) {
        restablecerSaldo(p.autor, p.montoAbierto);
      }
      propuestasAnuladas += 1;
      return false;
    }
    return true;
  });

  nuevo.concreciones = nuevo.concreciones.filter((c) => {
    if (jugadaInvolucraRetirado(c.caballos, null, c.jugada, retirados)) {
      restablecerSaldo(c.autor, c.monto);
      restablecerSaldo(c.jugador, c.monto);
      concrecionesAnuladas += 1;
      return false;
    }
    return true;
  });

  return { estado: nuevo, propuestasAnuladas, concrecionesAnuladas };
}
