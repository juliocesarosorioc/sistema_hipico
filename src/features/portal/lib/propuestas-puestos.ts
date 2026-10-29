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
  parsearConcrecion,
  parsearMensajeJugada,
  type DatosJugada,
  type RolJugada,
} from "@/features/portal/lib/gramatica-concrecion-hipica";

export type PropuestaPuesto = {
  id: number;
  autor: string;
  rol: RolJugada;
  jugada: string;
  caballos: string;
  montoOriginal: number;
  /** Lo que todavía no ha concretado nadie. */
  montoAbierto: number;
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

export type EstadoMesa = {
  /** Disponible actual por jugador (ya descontado lo propuesto y lo concretado). */
  disponibles: Record<string, number>;
  propuestas: PropuestaPuesto[];
  concreciones: ConcrecionPuesto[];
  /** Avisos de límite ("Juan hasta 300") para las observaciones del reporte. */
  limites: string[];
  siguienteId: number;
};

export type ResultadoMesa = {
  estado: EstadoMesa;
  /** true si la acción hizo algo (publicó o concretó). */
  ok: boolean;
  /** true si se rechazó por falta de saldo. */
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
  hasta: (nombre: string, disponible: number) => `${nombre} hasta ${fmt(disponible)}`,
  sinSaldo: (nombre: string) => `${nombre} sin saldo disponible`,
} as const;

/** Mesa nueva con el disponible de cada jugador. */
export function crearMesa(disponibles: Record<string, number> = {}): EstadoMesa {
  return { disponibles: { ...disponibles }, propuestas: [], concreciones: [], limites: [], siguienteId: 1 };
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
  concreciones: [...e.concreciones],
  limites: [...e.limites],
});

const bloqueo = (estado: EstadoMesa, mensaje: string): ResultadoMesa => ({
  estado,
  ok: false,
  bloqueado: true,
  mensajes: [mensaje],
});

/**
 * PROPONER. Topa con el disponible: nunca publica el exceso.
 */
export function proponer(
  estado: EstadoMesa,
  p: { autor: string; rol: RolJugada; jugada: string; caballos: string; monto: number }
): ResultadoMesa {
  const clave = claveDe(estado, p.autor);
  const nombre = clave;
  const monto = redondear(Number(p.monto));
  if (!Number.isFinite(monto) || monto <= 0) {
    return { estado, ok: false, bloqueado: false, mensajes: ["Indica un monto mayor que 0."] };
  }
  const disponible = disponibleDe(estado, clave);
  if (disponible <= 0) return bloqueo(estado, frases.sinSaldo(nombre));

  const publicado = Math.min(monto, disponible);
  const mensajes: string[] = [];
  const limites: string[] = [];
  if (monto > disponible) {
    // El aviso lleva el disponible ANTES de descontar lo publicado.
    const aviso = frases.atento(nombre, disponible);
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
  c: { jugador: string; propuestaId?: number; monto?: number }
): ResultadoMesa {
  const clave = claveDe(estado, c.jugador);
  const nombre = clave;
  const propuesta =
    c.propuestaId !== undefined
      ? estado.propuestas.find((p) => p.id === c.propuestaId)
      : [...estado.propuestas].reverse().find((p) => p.montoAbierto > 0);
  if (!propuesta || propuesta.montoAbierto <= 0) {
    return { estado, ok: false, bloqueado: false, mensajes: ["No hay ninguna propuesta abierta para concretar."] };
  }
  if (propuesta.autor.trim().toLowerCase() === clave.trim().toLowerCase()) {
    return { estado, ok: false, bloqueado: false, mensajes: [`${nombre} no puede concretar su propia propuesta.`] };
  }
  const disponible = disponibleDe(estado, clave);
  if (disponible <= 0) return bloqueo(estado, frases.sinSaldo(nombre));

  const pedido = Math.min(c.monto !== undefined && c.monto > 0 ? redondear(c.monto) : propuesta.montoAbierto, propuesta.montoAbierto);
  const amarrado = Math.min(pedido, disponible);
  const mensajes: string[] = [];
  const limites: string[] = [];
  if (pedido > disponible) {
    const aviso = frases.hasta(nombre, disponible);
    mensajes.push(aviso);
    limites.push(aviso);
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
  nuevo.limites.push(...limites);
  return { estado: nuevo, ok: true, bloqueado: false, mensajes, propuesta: prop, concrecion, monto: amarrado };
}

/**
 * Fachada del AGENTE: recibe lo que escribió un jugador y decide si es una
 * concreción ("J", "Ponte"…) o una propuesta ("consigo 1p 2-5 300"). Si el texto
 * no se entiende, responde con la aclaratoria y NO toca el estado.
 */
export function procesarMensajeMesa(estado: EstadoMesa, entrada: { jugador: string; texto: string }): ResultadoMesa {
  const conc = parsearConcrecion(entrada.texto);
  if (conc.ok) return concretar(estado, { jugador: entrada.jugador, monto: conc.monto });

  const parseo = parsearMensajeJugada(entrada.texto);
  if (!parseo.ok) return { estado, ok: false, bloqueado: false, mensajes: [parseo.aclaratoria] };
  const d: DatosJugada = parseo.datos;
  return proponer(estado, { autor: entrada.jugador, rol: d.rol, jugada: d.jugada, caballos: d.caballos, monto: d.monto });
}

/** Observaciones del reporte de WhatsApp con los límites alcanzados ("Juan hasta 300"). */
export function observacionesDeLimites(estado: EstadoMesa): string {
  return [...new Set(estado.limites)].join("\n");
}
