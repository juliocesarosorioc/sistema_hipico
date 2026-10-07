/**
 * MODULO MARCAS — jerarquía posicional y matemática 120/100.
 *
 * Lógica PURA: sin Supabase, sin React, sin I/O. Se puede correr en el
 * navegador, en un test y en la RPC espejo sin arrastrar nada.
 *
 * La jerarquía se calcula aquí para previsualizar, pero la verdad es la RPC
 * `club_vender_marca` (sql/marcas_venta.sql): el navegador no decide contra
 * quién se juega. Estas funciones son un espejo EXACTO de las reglas del
 * servidor. Si divergieran, el usuario vería un matchup y la banca aceptaría
 * otro, que es peor que no previsualizar.
 *
 * Jerarquía (el orden de `marcas` es de izquierda a derecha):
 *   - está en `nv`                  → JUGADA BLOQUEADA
 *   - no está en `marcas` ni `nv`   → se mide contra las marcas, de una en una
 *   - es la primera marca           → JUGADA BLOQUEADA (nadie a su izquierda)
 *   - está en `marcas`, índice i>1  → se mide contra marcas[1 .. i-1], de una en una
 *
 * LA JUGADA ES UN MATCH DE A UNO, no una apuesta contra el paquete entero. Elegir
 * un caballo NO lo pone a pelear contra todos los demas: el operador elige CUAL
 * de los que tiene legal a su izquierda, y ese es el unico rival del ticket. La
 * norma de derecha a izquierda es la que acota la lista: un caballo de la
 * izquierda nunca puede jugarse contra uno de la derecha, asi que ese cruce
 * ni siquiera se ofrece.
 */

/** Proporción de la apuesta: se juega 120 para ganar 100. */
export const PROPORCION = 120;

/** Se juega 120 para ganar 100 → ganancia neta = 100/120. */
export const FACTOR_GANANCIA = 100 / 120;

/** Pago bruto = monto + ganancia neta = 220/120 del monto. */
export const FACTOR_BRUTO = 220 / 120;

export type AnalisisRivales = {
  /** El caballo se puede jugar. */
  valido: boolean;
  /**
   * EL rival de este match: uno solo, el que eligio el operador.
   * `null` cuando la jugada esta bloqueada.
   */
  rival: string | null;
  /**
   * Rivales LEGALES, en orden de izquierda a derecha. Es el menu del selector
   * del modal: nunca ofrece uno de la derecha ni uno que no valga.
   */
  candidatos: string[];
  /** Texto para la previsualización del modal. */
  mensaje: string;
  /** Por qué no, si no se puede jugar. */
  error?: string;
  /** El rival elegido se tomo del menu, o se cayo al primero. */
  rivalElegido?: boolean;
};

/**
 * "1/2/3/4/5" → ["1","2","3","4","5"].
 *
 * Separa por "/" y descarta segmentos vacíos: "1//2" no debe inventar un rival
 * en blanco. Hace el mismo trim que el `unnest(string_to_array(...))` del
 * servidor, para que cliente y servidorSaw igual.
 */
export function separarNumeros(s: string | null | undefined): string[] {
  return String(s ?? "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Calcula contra quien puede jugar el caballo seleccionado y cual es EL rival
 * de esta jugada.
 *
 * La jugada es de a uno: `rival` es un solo numero, el que salio del menu de
 * `candidatos`. `rivalElegido` viaja como parametro para que el modal no tenga
 * que reimplementar la jerarquia: si el numero enviado no esta en la lista legal
 * se cae al primero en vez de aceptarlo en silencio, porque un rival inventado
 * aqui seria un rival que el servidor nunca vio.
 *
 * Devuelve `valido: false` en vez de lanzar, para que el modal muestre el
 * motivo en vivo mientras el usuario escribe, sin try/catch.
 *
 * `strDebutantes` y `debutantesValen` son opcionales para no romper a los
 * llamadores que todavia no los pasan. Con el switch apagado, un debutante se
 * mete al NV ANTES de evaluar nada, igual que hace el SQL: asi el debutante no
 * es un caso paralelo con sus propias reglas, es un NV con otro nombre.
 */
export function calcularRivales(
  seleccionado: string,
  strMarcas: string,
  strNV: string,
  strDebutantes = "",
  debutantesValen = true,
  rivalElegido = ""
): AnalisisRivales {
  const sel = String(seleccionado ?? "").trim();
  if (!sel)
    return { valido: false, rival: null, candidatos: [], mensaje: "Ingrese un caballo para calcular rivales..." };

  const marcas = separarNumeros(strMarcas);
  const debutantes = separarNumeros(strDebutantes);

  // El fold va primero, antes de la regla 1, para que el bloqueo de NV cubra
  // al debutante sin duplicar la comprobacion.
  const nv = debutantesValen ? separarNumeros(strNV) : [...new Set([...separarNumeros(strNV), ...debutantes])];

  // REGLA 1: bloqueo NV.
  if (nv.includes(sel)) {
    // El mensaje distingue el motivo: el arreglo va en columnas distintas del
    // panel y el caja necesita saber cual tocar.
    const esDebutante = !debutantesValen && debutantes.includes(sel);
    return {
      valido: false,
      rival: null,
      candidatos: [],
      mensaje: esDebutante
        ? `El caballo ${sel} es debutante y la carrera tiene "debutantes no valen". JUGADA BLOQUEADA.`
        : `El caballo ${sel} es NV (No Vale). JUGADA BLOQUEADA.`,
    };
  }

  // Sin marcas no hay con que armar el matchup: no se vende nada.
  if (marcas.length === 0) {
    return {
      valido: false,
      rival: null,
      candidatos: [],
      mensaje: "No hay marcas definidas para enfrentar en esta carrera.",
    };
  }

  const idx = marcas.indexOf(sel);

  // REGLA 2: la marca mas a la izquierda no tiene a nadie a su izquierda, asi
  // que no tiene con quien jugarse. Sigue siendo la punta no vendible.
  if (idx === 0) {
    return {
      valido: false,
      rival: null,
      candidatos: [],
      mensaje: `El caballo ${sel} es el primer favorito. No tiene rivales a su izquierda.`,
    };
  }

  // REGLA 3: los candidatos son SIEMPRE los que tiene a su izquierda. Un
  // caballo fuera de la marca se mide contra todas ellas; una marca de indice
  // i>1 se mide contra las que tiene delante. Nunca se ofrece un cruce de
  // izquierda contra derecha.
  const candidatos = idx === -1 ? marcas : marcas.slice(0, idx);

  // El mismo caballo no puede ser su propio rival, aunque la configuracion
  // venga con numeros repetidos: `revisarConfig` lo marca y la RPC lo rechaza.
  const legales = candidatos.filter((n) => n !== sel);
  if (legales.length === 0) {
    return {
      valido: false,
      rival: null,
      candidatos: [],
      mensaje: `El caballo ${sel} no tiene ningun rival legal a su izquierda.`,
    };
  }

  // El operador elige UNO. Si el que manda no esta en el menu se usa el primero:
  // es mejor mostrar el de la punta que devolver `valido` con un rival que el
  // servidor va a rechazar.
  const pedido = String(rivalElegido ?? "").trim();
  const rival = legales.includes(pedido) ? pedido : legales[0];

  const sePuedeElegir =
    legales.length > 1
      ? ` Puede medirlo contra cualquiera de: ${legales.join(", ")}.`
      : "";

  return {
    valido: true,
    rival,
    candidatos: legales,
    rivalElegido: legales.includes(pedido),
    mensaje: `Juega ${sel} contra ${rival}.${sePuedeElegir}`,
  };
}

export type TicketCalculado = {
  monto: number;
  gananciaNeta: number;
  pagoBruto: number;
};

/**
 * Reparte el monto en la proporción 120/100.
 *
 * Se juega 120 para ganar 100: la ganancia neta es 100/120 del monto y el pago
 * bruto es el monto más esa ganancia (220/120). El redondeo a 2 decimales
 * coincide con el `round(..., 2)` de la RPC, de modo que lo que muestra el
 * modal es lo que se abona al cliente.
 */
export function calcularMonto(monto: number | string): TicketCalculado {
  const m = Number(monto) || 0;
  const gananciaNeta = Math.round(m * FACTOR_GANANCIA * 100) / 100;
  const pagoBruto = Math.round((m + gananciaNeta) * 100) / 100;
  return { monto: m, gananciaNeta, pagoBruto };
}

/**
 * Parsea el orden de llegada que escribe el operador.
 *
 * Acepta "5, 1, 3" o "5 1 3" o "5-1-3": son el mismo dato, el operador lo
 * escribe como le salga. Devuelve el puesto de cada caballo en el orden en que
 * aparecen (el primero es el ganador). Se descartan los segmentos vacíos, igual
 * que en `separarNumeros`, para que "5, , 1" no invente un puesto 2.
 *
 * Es la misma normalización que hace `club_registrar_orden_llegada` en el
 * servidor: el modal muestra lo que la RPC va a guardar.
 */
export function parsearOrden(texto: string | null | undefined): Array<{ numero: string; puesto: number }> {
  const partes = String(texto ?? "")
    .split(/[,\s\/-]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const salida: Array<{ numero: string; puesto: number }> = [];
  const vistos = new Set<string>();
  for (const p of partes) {
    if (vistos.has(p)) continue;  // el mismo caballo no ocupa dos puestos
    vistos.add(p);
    salida.push({ numero: p, puesto: salida.length + 1 });
  }
  return salida;
}

/**
 * Simula la liquidación contra un orden de llegada.
 *
 * La jugada es de a uno, asi que `rivales` trae UN numero: el rival que quedo
 * congelado en el ticket. Gana si el caballo jugado llega por delante de ese
 * rival; si llega por detrás pierde. Si el rival no aparece en el orden de
 * llegada no se puede afirmar la victoria, asi que cuenta como pérdida: es lo
 * mismo que hace `club_liquidar_marca`.
 *
 * Acepta mas de un rival porque la lista legal completa (la que se ofrece en el
 * selector) se puede pasar tal cual para previsualizar el peor caso; con dos o
 * mas gana solo si va por delante de TODOS.
 *
 * Sirve para la previsualización del modal y para verificar el pago antes de
 * tocar la base.
 */
export function simularMarca(
  caballo: string,
  rivales: string[],
  ordenLlegada: Array<{ numero: string; puesto: number | string }>
): { gana: boolean; puesto: number | null; motivo: string } {
  const puestoDe = (n: string): number | null => {
    const fila = ordenLlegada.find((f) => String(f.numero).trim() === String(n).trim());
    if (!fila) return null;
    const p = Number(fila.puesto);
    return Number.isFinite(p) ? p : null;
  };

  const sel = String(caballo ?? "").trim();
  const pSel = puestoDe(sel);
  if (pSel === null) {
    return { gana: false, puesto: null, motivo: `El caballo ${sel} no aparece en el orden de llegada.` };
  }

  const porDelante = rivales.filter((r) => {
    const p = puestoDe(r);
    return p !== null && p < pSel;
  });
  const faltantes = rivales.filter((r) => puestoDe(r) === null);

  if (porDelante.length > 0) {
    return {
      gana: false,
      puesto: pSel,
      motivo:
        rivales.length === 1
          ? `Pierde: su rival ${porDelante[0]} llegó por delante.`
          : `Pierde: ${porDelante.join(", ")} ${porDelante.length === 1 ? "llegó" : "llegaron"} por delante.`,
    };
  }
  if (faltantes.length > 0) {
    return {
      gana: false,
      puesto: pSel,
      motivo: `No se puede confirmar: ${faltantes.join(", ")} no figura en el orden de llegada.`,
    };
  }
  return {
    gana: true,
    puesto: pSel,
    motivo:
      rivales.length === 1
        ? `Gana a su rival ${rivales[0]} (puesto ${pSel}).`
        : `Gana a todos sus rivales (puesto ${pSel}).`,
  };
}
