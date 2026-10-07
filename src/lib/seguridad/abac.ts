/**
 * ============================================================================
 * ABAC — control de acceso por ATRIBUTOS, encima del RBAC
 * ============================================================================
 *
 * El RBAC (`resolver.ts`) responde "¿qué tipo de usuario es?". El ABAC responde
 * "¿sobre QUÉ registro, en QUÉ momento y con QUÉ valor?".
 *
 * Por qué hace falta acá, y no es teórico:
 *
 *   - Un operador de taquilla no puede tocar un hipódromo que no es el suyo.
 *     Con RBAC puro es imposible de expresar: el operador tiene la capacidad,
 *     pero el registro es de otro.
 *   - No se puede resolver un ticket que ya está SOLUCIONADO. El operador tiene
 *     `tickets:fn_anular_ticket`; lo que cambia es el ESTADO del registro.
 *   - Hay un tope de monto que el operador aprueba y de ahí en arriba escala al
 *     admin. La capacidad es la misma; el VALOR es distinto.
 *
 * LAS REGLAS, en una línea cada una:
 *
 *   1. El RBAC concede. Si el RBAC denies, el ABAC no lo revive.
 *   2. Después de que el RBAC concede, se evalúan las reglas de esa capacidad.
 *   3. Una regla que NO se cumple bloquea. No hay "advertir y seguir": si el
 *      registro no trae el atributo que la regla mira, se bloquea igual.
 *   4. Todas las reglas aplicables se evalúan (AND). Con una que falle, no pasa.
 *
 * El punto 3 es el que más bugs evita: una regla de dinero que se comprueba con
 * `contexto.monto ?? 0` dejaría pasar un `undefined` como si fuera cero. Acá el
 * atributo ausente deniega, y el mensaje dice cuál falta, para que el que llama
 * sepa qué tiene que pasar.
 *
 * `principal` en la regla:
 *   - "sujeto"  (por defecto) el usuario principal TAMBIÉN obeyce la regla. Para
 *               invariantes de integridad (no resolver un ticket cerrado) tiene
 *               que ser así: nadie, ni el dueño, debería poder dejar el
 *               historial en un estado imposible.
 *   - "exento"  el principal se salta la regla. Solo para límites de negocio
 *               (topes de monto), que son un límite operativo, no de integridad.
 */

import { CAPACIDADES_POR_CLAVE } from "@/lib/seguridad/capacidades";
import type { Riesgo } from "@/lib/seguridad/tipos";

// ============================================================================
// TIPOS
// ============================================================================

/** Clase de dato del atributo. Decide cómo se compara. */
export type TipoAtributo = "texto" | "numero" | "booleano" | "lista";

/**
 * Comparación de la regla.
 *
 * `en_atributo` es el caso interesante: en vez de un valor fijo, el conjunto
 * permitido sale de OTRO atributo del contexto. Así "este operador solo puede
 * trabajar sus hipódromos" se expresa sin escribir la lista a mano en el
 * código: el conjunto permitido es `usuario_hipodromos`, que viene del usuario.
 */
export type OperadorAbac =
  | "igual"
  | "diferente"
  | "en"
  | "no_en"
  | "mayor_igual"
  | "menor_igual"
  | "entre"
  | "no_vacio"
  | "vacio"
  | "en_atributo";

/** Qué pasa cuando la comparación NO se cumple. */
export type EfectoAbac = "denegar" | "permitir";

/**
 * Para qué está la regla. Es lo que decide si el principal puede saltársela.
 *
 *   "integridad" → el registro no puede quedar en un estado imposible. Le
 *                   aplica a TODOS, principal incluido: un ticket cerrado que se
 *                   vuelve a resolver, un hipódromo que no es el tuyo. No se
 *                   levanta.
 *   "limite"     → un tope operativo. El dueño puede levantarlo si un día el
 *                   negocio lo necesita (subir el tope de 5.000 a 10.000 sin
 *                   cambiar una línea de código).
 *
 * Antes de esto el `principal` era un booleano suelto, y "exento" se aplicaba a
 * mano en cada regla. El primer día que alguien se olvidó, una regla de
 * integridad quedó con el dueño saltándosela y no se notó. Con `clase`
 * explícita, la coherencia se puede testear.
 */
export type ClaseAbac = "integridad" | "limite";

/** A quién le aplica la regla. */
export type AmbitoAbac = "global" | `tipo:${string}`;

/** Un atributo del catálogo: qué se puede mirar y de dónde sale. */
export type Atributo = {
  clave: string;
  nombre: string;
  tipo: TipoAtributo;
  descripcion: string;
  /** De dónde sale el valor: "registro.hipodromo", "usuario.hipodromos"... */
  origen: string;
};

/** Una regla de atributo sobre una capacidad. */
export type ReglaAbac = {
  /** Identificador estable, para referenciarla desde la base y los tests. */
  id: string;
  /** Capacidad a la que se aplica. */
  capacidad: string;
  /** A quién le aplica: a todos, o solo a un tipo de usuario. */
  ambito: AmbitoAbac;
  /** Atributo mirado (clave del catálogo). */
  atributo: string;
  operador: OperadorAbac;
  /**
   * Valor esperado. Para `entre` son dos números `[min, max]`. Para
   * `en_atributo` es la clave de otro atributo del contexto.
   */
  valor?: string | number | boolean | Array<string | number>;
  /** Qué pasa si la comparación no se cumple. */
  efecto: EfectoAbac;
  /** Lo que ve el operador cuando se bloquea. Sin datos sensibles. */
  mensaje: string;
  /** Integridad o límite operativo. Decide si el principal se salta la regla. */
  clase: ClaseAbac;
  /** Si el usuario principal también tiene que cumplirla. */
  principal: "sujeto" | "exento";
  riesgo: Riesgo;
  /** Trazabilidad al código, como en el maestro de capacidades. */
  fuente: string;
};

/** El contexto de la operación: los atributos de ESTA llamada. */
export type ContextoAbac = Record<string, unknown>;

export type EvaluacionAbac = {
  /** ¿Pasa el ABAC? Independiente del RBAC: esto solo mira atributos. */
  permitido: boolean;
  /** La primera regla que bloqueó, si bloqueó. */
  regla: ReglaAbac | null;
  /** Todas las reglas que se evaluaron, para explicarlo en pantalla. */
  aplicadas: Array<{ regla: ReglaAbac; cumplida: boolean }>;
};

// ============================================================================
// CATÁLOGO DE ATRIBUTOS
// ============================================================================

export const ATRIBUTOS: Atributo[] = [
  {
    clave: "estado",
    nombre: "Estado del registro",
    tipo: "texto",
    descripcion: "Estado del ticket, apuesta o movimiento. Un ticket SOLUCIONADO no se vuelve a tocar.",
    origen: "registro.estado",
  },
  {
    clave: "accion",
    nombre: "Acción aplicada",
    tipo: "texto",
    descripcion: "Acción que se está ejecutando: ABONO, REEMBOLSO, AJUSTE, RECHAZO.",
    origen: "operacion.accion",
  },
  {
    clave: "monto",
    nombre: "Monto",
    tipo: "numero",
    descripcion: "Cantidad de dinero de la operación, en la moneda del registro.",
    origen: "registro.monto",
  },
  {
    clave: "hipodromo",
    nombre: "Hipódromo",
    tipo: "texto",
    descripcion: "Hipódromo del registro. El operador de taquilla solo trabaja el suyo.",
    origen: "registro.hipodromo",
  },
  {
    clave: "metodo_pago",
    nombre: "Método de pago",
    tipo: "texto",
    descripcion: "Forma de pago del movimiento: efectivo, transferencia, punto, zelle...",
    origen: "registro.metodo_pago",
  },
  {
    clave: "usuario_hipodromos",
    nombre: "Hipódromos asignados al usuario",
    tipo: "lista",
    descripcion: "Hipódromos que tiene asignados el usuario de la sesión. Viene de usuario_atributo.",
    origen: "usuario.hipodromos",
  },
];

export const ATRIBUTOS_POR_CLAVE: Map<string, Atributo> = new Map(ATRIBUTOS.map((a) => [a.clave, a]));

/**
 * Los métodos de pago que la contabilidad reconoce.
 *
 * Sale de los catálogos de la UI, no de una lista escrita acá: si el admin
 * agrega una modalidad nueva en `contabilidad.ts` y esta lista no la incluye,
 * la operación legítima se rechaza con "método no reconocido". Ese error es
 * peor que el que la regla previene.
 *
 * `pruebas/validar-rbac.mjs` verifica que la regla y los catálogos no se
 * separen.
 */
export const METODOS_PAGO: string[] = [
  "efectivo",
  "transferencia",
  "pago movil",
  "divisa",
  "paypal",
  "zelle",
  "binance",
  "otro",
];

// ============================================================================
// REGLAS
// ============================================================================

/**
 * Las reglas del sistema. Se evalúan en orden; la primera que bloquea corta.
 *
 * Todas apuntan a capacidades que ya existen en el maestro: una regla sobre una
 * capacidad inexistente nunca se dispararía, y el validador falla si pasa eso.
 */
export const REGLAS_ABAC: ReglaAbac[] = [
  // --- tickets: no se re-resuelve un ticket ya cerrado -------------------
  {
    id: "ticket:anular:estado_abierto",
    capacidad: "tickets:fn_anular_ticket",
    ambito: "global",
    atributo: "estado",
    operador: "en",
    valor: ["CREADO", "EN_REVISION"],
    efecto: "denegar",
    mensaje: "Este ticket ya fue solucionado. No se puede volver a resolver.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/tickets.ts:resolverTicket",
  },
  {
    id: "ticket:anular:accion_valida",
    capacidad: "tickets:fn_anular_ticket",
    ambito: "global",
    atributo: "accion",
    operador: "en",
    valor: ["ABONO", "REEMBOLSO", "AJUSTE", "RECHAZO"],
    efecto: "denegar",
    mensaje: "La acción indicada no es una resolución válida de ticket.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/tickets.ts:resolverTicket",
  },

  // --- liquidar carrera: hipódromo y monto ------------------------------
  {
    id: "liquidar:hipodromo_propio",
    capacidad: "gestion_jugadas:fn_liquidar_carrera",
    ambito: "tipo:operador",
    atributo: "hipodromo",
    operador: "en_atributo",
    valor: "usuario_hipodromos",
    efecto: "denegar",
    mensaje: "Ese hipódromo no está asignado a tu usuario. Pedile a un administrador que lo cargue.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/gestion_jugadas.ts:liquidarCarrera",
  },
  {
    id: "liquidar:tope_operador",
    capacidad: "gestion_jugadas:fn_liquidar_carrera",
    ambito: "tipo:operador",
    atributo: "monto",
    operador: "entre",
    valor: [0, 5000],
    efecto: "permitir",
    mensaje: "La liquidación supera los 5.000: la tiene que firmar un administrador.",
    // Tope operativo, no de integridad: el dueño lo puede levantar si hace falta.
    clase: "limite",
    principal: "exento",
    riesgo: "critico",
    fuente: "src/lib/gestion_jugadas.ts:liquidarCarrera",
  },

  // --- retiros: no se fabrican retiros negativos ------------------------
  {
    id: "retiros:monto_no_negativo",
    capacidad: "gestion_jugadas:fn_aplicar_retiros",
    ambito: "global",
    atributo: "monto",
    operador: "entre",
    valor: [0, 25000],
    efecto: "permitir",
    mensaje: "El retiro debe estar entre 0 y 25.000.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/gestion_jugadas.ts:aplicarRetiros",
  },
  {
    id: "retiros:hipodromo_propio",
    capacidad: "gestion_jugadas:fn_aplicar_retiros",
    ambito: "tipo:operador",
    atributo: "hipodromo",
    operador: "en_atributo",
    valor: "usuario_hipodromos",
    efecto: "denegar",
    mensaje: "Ese hipódromo no está asignado a tu usuario.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/gestion_jugadas.ts:aplicarRetiros",
  },

  // --- contabilidad: método de pago y tope ------------------------------
  // La lista sale de MODALIDADES_INGRESO y MODALIDADES_EGRESO (contabilidad.ts),
  // que son las que la UI ofrece de verdad. Sin esta union, la regla terminaba
  // con una lista inventada que rechazaba BINANCE o PAYPAL en un movimiento
  // totalmente legitimo. El validador comprueba que no se separen de nuevo.
  {
    id: "contabilidad:metodo_pago_valido",
    capacidad: "contabilidad:fn_registrar_movimiento",
    ambito: "global",
    atributo: "metodo_pago",
    operador: "en",
    valor: METODOS_PAGO,
    efecto: "denegar",
    mensaje: "Método de pago no reconocido.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/contabilidad.ts:registrarMovimiento",
  },
  {
    id: "contabilidad:tope_operador",
    capacidad: "contabilidad:fn_registrar_movimiento",
    ambito: "tipo:operador",
    atributo: "monto",
    operador: "entre",
    valor: [0, 10000],
    efecto: "permitir",
    mensaje: "El movimiento supera los 10.000: lo tiene que registrar un administrador.",
    clase: "limite",
    principal: "exento",
    riesgo: "critico",
    fuente: "src/lib/contabilidad.ts:registrarMovimiento",
  },

  // --- hipódromos: el operador edita el suyo ----------------------------
  {
    id: "hipodromos:guardar_propio",
    capacidad: "hipodromos:fn_guardar_hipodromo",
    ambito: "tipo:operador",
    atributo: "hipodromo",
    operador: "en_atributo",
    valor: "usuario_hipodromos",
    efecto: "denegar",
    mensaje: "Solo podés modificar los hipódromos que tenés asignados.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "escritura",
    fuente: "src/lib/hipodromos/servicio.ts:actualizarHipodromo",
  },
  {
    // Borrar es el caso fuerte: no hace falta un bug de PL/pgSQL para que un
    // operador se lleve un hipódromo entero. La regla de `fn_guardar` cubría la
    // edición, pero `btn_eliminar` era una capacidad crítica sin ninguna
    // condición de contexto, o sea un botón rojo sin regla detrás.
    id: "hipodromos:eliminar_propio",
    capacidad: "hipodromos:btn_eliminar",
    ambito: "tipo:operador",
    atributo: "hipodromo",
    operador: "en_atributo",
    valor: "usuario_hipodromos",
    efecto: "denegar",
    mensaje: "Solo podés eliminar los hipódromos que tenés asignados.",
    clase: "integridad",
    principal: "sujeto",
    riesgo: "critico",
    fuente: "src/lib/hipodromos/servicio.ts:eliminarHipodromo",
  },
];

export const REGLAS_ABAC_POR_CLAVE: Map<string, ReglaAbac[]> = (() => {
  const m = new Map<string, ReglaAbac[]>();
  for (const r of REGLAS_ABAC) {
    if (!m.has(r.capacidad)) m.set(r.capacidad, []);
    m.get(r.capacidad)!.push(r);
  }
  return m;
})();

// ============================================================================
// COMPARACIÓN
// ============================================================================

/**
 * Normaliza un valor para compararlo: minusculas, sin espacios de sobra y SIN
 * TILDES.
 *
 * Quitar las tildes no es purismo: los datos vienen de formularios y de
 * catalogos escritos por personas distintas, y "PAGO MOVIL" con tilde contra
 * "pago movil" sin ella son la misma modalidad. Si la comparacion no normaliza
 * el acento, la diferencia de escritura bloquea un cobro real, y el operador
 * no tiene forma de saber por que.
 *
 * La version en Postgres (public.norma_abac) hace lo mismo, para que la base
 * y el cliente no juzguen el mismo registro de forma distinta.
 */
const norm = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const aLista = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map(norm);

/**
 * ¿El atributo está presente? `undefined`, `null` y `""` cuentan como ausente.
 *
 * El string vacío es ausente a propósito: un formulario que manda `monto: ""`
 * no está diciendo "cero", está diciendo que no se llenó el campo. Tratarlo
 * como cero dejaría pasar la regla de topes.
 */
function presente(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function aNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compara contra el valor declarado en la regla, con el tipo del atributo. */
function cumple(r: ReglaAbac, valor: unknown, ctx: ContextoAbac): boolean {
  const tipo = ATRIBUTOS_POR_CLAVE.get(r.atributo)?.tipo ?? "texto";

  switch (r.operador) {
    case "no_vacio":
      return presente(valor);
    case "vacio":
      return !presente(valor);

    case "en_atributo": {
      // El conjunto permitido viene de otro atributo del contexto. Si ese
      // atributo no está, no hay forma de saber qué se permite: no se permite.
      if (!presente(valor)) return false;
      const conjunto = String(r.valor ?? "");
      const fuente = ctx[conjunto];
      if (!presente(fuente)) return false;
      return aLista(fuente).includes(norm(valor));
    }

    case "entre": {
      const n = aNumero(valor);
      if (n === null) return false;
      const [min, max] = (Array.isArray(r.valor) ? r.valor : []) as number[];
      if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) return false;
      return n >= Number(min) && n <= Number(max);
    }

    case "mayor_igual": {
      const n = aNumero(valor);
      return n !== null && n >= Number(r.valor);
    }
    case "menor_igual": {
      const n = aNumero(valor);
      return n !== null && n <= Number(r.valor);
    }

    case "en":
    case "no_en": {
      if (!presente(valor)) return false;
      const dentro = aLista(r.valor).includes(norm(valor));
      return r.operador === "en" ? dentro : !dentro;
    }

    case "igual":
      if (!presente(valor)) return false;
      if (tipo === "booleano") return Boolean(valor) === Boolean(r.valor);
      if (tipo === "numero") {
        const n = aNumero(valor);
        return n !== null && n === Number(r.valor);
      }
      return norm(valor) === norm(r.valor);

    case "diferente":
      if (!presente(valor)) return false;
      return norm(valor) !== norm(r.valor);

    default:
      return false;
  }
}

// ============================================================================
// EVALUACIÓN
// ============================================================================

export type OpcionesAbac = {
  /** Tipo de usuario de la sesión, para las reglas con ámbito `tipo:*`. */
  tipoUsuario?: string | null;
  /** Si la sesión es el usuario principal. */
  esPrincipal?: boolean;
};

/** ¿La regla le aplica a esta sesión? */
export function aplicaLaRegla(r: ReglaAbac, opts: OpcionesAbac): boolean {
  if (r.ambito === "global") return true;
  const tipo = (opts.tipoUsuario ?? "").trim().toLowerCase();
  return `tipo:${tipo}` === r.ambito.toLowerCase();
}

/**
 * Evalúa el ABAC de una capacidad contra el contexto de la operación.
 *
 * Esto NO mira permisos: solo atributos. El orden correcto en el llamador es
 * `tieneCapacidad(...)` primero, y después `evaluarAbac(...)`, o mejor
 * `exigirContexto(...)`, que hace las dos cosas en orden.
 */
export function evaluarAbac(
  capacidad: string,
  contexto: ContextoAbac = {},
  opts: OpcionesAbac = {}
): EvaluacionAbac {
  const reglas = REGLAS_ABAC_POR_CLAVE.get(capacidad) ?? [];
  const aplicadas: Array<{ regla: ReglaAbac; cumplida: boolean }> = [];

  for (const r of reglas) {
    if (!aplicaLaRegla(r, opts)) continue;
    if (opts.esPrincipal && r.principal === "exento") continue;

    // Atributo ausente: la regla no se cumple. Es el cierre por omisión.
    const valor = contexto[r.atributo];
    const cumplida = cumple(r, valor, contexto);
    aplicadas.push({ regla: r, cumplida });

    if (!cumplida) return { permitido: false, regla: r, aplicadas };
  }
  return { permitido: true, regla: null, aplicadas };
}

/** ¿La capacidad pasa el ABAC con este contexto? Atajo booleano. */
export function permiteConContexto(
  capacidad: string,
  contexto: ContextoAbac = {},
  opts: OpcionesAbac = {}
): boolean {
  return evaluarAbac(capacidad, contexto, opts).permitido;
}

/**
 * Falla cuando el ABAC no se cumple.
 *
 * `principal` no exime: el usuario principal tampoco puede resolver un ticket
 * ya cerrado. La exemption va por regla (`principal: "exento"`), no global.
 */
export class ErrorAtributo extends Error {
  readonly capacidad: string;
  readonly regla: ReglaAbac | null;
  constructor(capacidad: string, regla: ReglaAbac | null, motivo: string) {
    super(motivo);
    this.name = "ErrorAtributo";
    this.capacidad = capacidad;
    this.regla = regla;
  }
}

/** Throw si el ABAC no se cumple. Devuelve el contexto evaluado. */
export function exigirContexto(
  capacidad: string,
  contexto: ContextoAbac = {},
  opts: OpcionesAbac = {}
): ContextoAbac {
  const ev = evaluarAbac(capacidad, contexto, opts);
  if (!ev.permitido) {
    throw new ErrorAtributo(capacidad, ev.regla, ev.regla?.mensaje ?? "La operación no cumple las reglas de atributos.");
  }
  return contexto;
}

/** Todas las reglas de una capacidad, para mostrarlas en el maestro. */
export function reglasDeCapacidad(capacidad: string): ReglaAbac[] {
  return REGLAS_ABAC_POR_CLAVE.get(capacidad) ?? [];
}

/** Capacidades que tienen al menos una regla de atributo. */
export function capacidadesConAbac(): string[] {
  return [...REGLAS_ABAC_POR_CLAVE.keys()];
}
