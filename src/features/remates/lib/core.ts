/**
 * ============================================================================
 * REMATES — LÓGICA PURA (sin Supabase ni React)
 * ============================================================================
 *
 * El remate es una subasta de ejemplares: cada caballo del remate tiene un
 * monto pujado. El premio del ganador sale del pozo menos la comisión de la
 * casa, más un incentivo opcional que agrega la casa.
 *
 * Lo que cambia respecto del legacy (js/remates.js): los ejemplares del remate
 * NO se escriben a mano. Salen del PROGRAMA DEL DÍA — las carreras ya cargadas
 * en los hipódromos y su fecha (resultados_carreras.caballos, la misma fuente
 * que Carreras del Día y la Gaceta). El formulario encadena
 * Hipódromo → Fecha → Carrera → Ejemplares y de ahí se eligen.
 *
 * Este módulo es PURO a propósito: node lo corre directo y las finanzas y la
 * derivación de ejemplares quedan cubiertas por pruebas sin tocar la base.
 */

/** Fila de `remate_caballos` (una puja dentro de un remate). */
export type CaballoRemate = {
  id?: string;
  remate_id?: string;
  numero: number;
  nombre: string;
  monto_usd: number;
  cliente_id?: string | null;
  /** Nombre del cliente que puja (join `clientes(nombre)`), solo para mostrar. */
  cliente?: string | null;
  prob_porcentaje?: number | null;
  prob_implicita?: number | null;
  /**
   * Origen del ejemplar en el programa del día: el Nº con el que corre en la
   * carrera. Sin esto no se puede explicar de dónde salió el caballo del remate.
   */
  ejemplar_numero?: string | null;
};

/** Fila de `remates` (la subasta). */
export type Remate = {
  id: string;
  nombre: string;
  hipodromo_id?: string | null;
  /** Nombre del hipódromo (join `hipodromos(nombre)`), solo para mostrar. */
  hipodromo?: string | null;
  carrera?: number | null;
  fecha?: string | null;
  hora_cierre?: string | null;
  distancia?: string | null;
  comision_pct: number;
  incentivo: number;
  /** Incentivo como % del subtotal (0 = manda el monto fijo `incentivo`). */
  incentivo_pct?: number | null;
  notas?: string | null;
  /**
   * Grupo de venta del remate (opcional). Si está, sus tickets salen con
   * `grupo_cobro_id` y el banquero de la modalidad REMATES los cubre.
   */
  grupo_id?: string | null;
  /**
   * Escalera de pujas DEL REMATE, editable por la casa. Si viene vacía manda
   * `ESCALONES_PUJA` (la regla por defecto), así el módulo funciona igual con el
   * SQL viejo aplicado.
   */
  escalera?: EscalonPuja[];
  /** Observación escrita que explica la escalera en palabras. */
  nota_escalera?: string | null;
  /** "Abierto" | "Cerrado". Cerrado bloquea pujas nuevas y cambios de monto. */
  estado?: string | null;
  /** Momento del cierre (boton Cerrar). */
  cerrado_at?: string | null;
  /**
   * Momento en que se emitieron los tickets de venta y se descontaron los saldos.
   * Si esta puesto y el remate se reabre, los ejemplares que YA tienen comprador
   * quedan bloqueados: lo unico editable es asignarle comprador a los que siguen
   * en CASA.
   */
  liquidado_at?: string | null;
  fecha_registro?: string | null;
  caballos?: CaballoRemate[];
};

/** El remate está cerrado: no admite pujas nuevas ni cambios de monto. */
export function estaCerrado(remate: Pick<Remate, "estado"> | null | undefined): boolean {
  return String(remate?.estado ?? "").trim().toLowerCase() === "cerrado";
}

/** Un ejemplar tal como viene del programa central (resultados_carreras). */
export type EjemplarPrograma = {
  numero: string;
  nombre?: string | null;
  retirado?: boolean;
};

/**
 * Un candidato a pujar en el remate, derivado de un ejemplar del programa.
 * `numero` es la posición 1..n dentro del remate; `ejemplar_numero` es el Nº
 * con el que el caballo corre en la carrera (el vínculo con el programa).
 */
export type CandidatoRemate = {
  numero: number;
  nombre: string;
  ejemplar_numero: string;
  retirado: boolean;
};

/**
 * Deriva los candidatos del remate a partir de los ejemplares de una carrera
 * del programa. Los retirados NO se ofrecen (no corren), pero se devuelven con
 * `retirado: true` para que la UI pueda avisar por qué no están en la lista.
 */
export function candidatosDelPrograma(ejemplares: EjemplarPrograma[] | null | undefined): CandidatoRemate[] {
  if (!Array.isArray(ejemplares)) return [];
  const out: CandidatoRemate[] = [];
  for (const e of ejemplares) {
    const num = String(e?.numero ?? "").trim();
    if (!num || /^0+$/.test(num)) continue;
    out.push({
      numero: out.length + 1,
      nombre: String(e?.nombre ?? "").trim(),
      ejemplar_numero: num,
      retirado: e?.retirado === true,
    });
  }
  return out;
}

/** Solo los candidatos que de verdad corren (sin retirados). */
export function candidatosJugables(candidatos: CandidatoRemate[] | null | undefined): CandidatoRemate[] {
  return (candidatos ?? []).filter((c) => !c.retirado);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type FinanzasRemate = {
  caballos: number;
  subtotal: number;
  incentivo: number;
  /** % del subtotal usado como incentivo (0 = el monto fijo manda). */
  incentivoPct: number;
  totalBruto: number;
  comisionPct: number;
  descuentoComision: number;
  premioGanador: number;
};

/**
 * Incentivo de la casa: monto fijo, o porcentaje del subtotal si se %.
 *
 * El modo lo elige el que lo carga: si hay % (> 0), ese % del subtotal es el
 * incentivo y el monto fijo se ignora. El incentivo NUNCA entra en la base de la
 * comisión: se suma al premio después del descuento.
 */
export function incentivoDe(subtotal: number, monto: number, pct: number): number {
  const p = Number(pct) || 0;
  if (p > 0) return round2(subtotal * (p / 100));
  return round2(Number(monto) || 0);
}

/**
 * Motor financiero del remate:
 *   subtotal = suma de las pujas
 *   incentivo = monto fijo, o subtotal * incentivo_pct / 100 si se %
 *   bruto    = subtotal + incentivo
 *   comisión = SUBTOTAL * comision_pct / 100   (el incentivo no se grava)
 *   premio   = subtotal - comisión + incentivo
 */
export function calcularFinanzasRemate(
  caballos: Array<Pick<CaballoRemate, "monto_usd">> | null | undefined,
  incentivo: number,
  comisionPct: number,
  incentivoPct: number = 0
): FinanzasRemate {
  const filas = caballos ?? [];
  const subtotal = round2(filas.reduce((acc, c) => acc + (Number(c?.monto_usd) || 0), 0));
  const inc = incentivoDe(subtotal, incentivo, incentivoPct);
  const pct = Number(comisionPct) || 0;
  const totalBruto = round2(subtotal + inc);
  const descuentoComision = round2(subtotal * (pct / 100));
  return {
    caballos: filas.length,
    subtotal,
    incentivo: inc,
    incentivoPct: Number(incentivoPct) || 0,
    totalBruto,
    comisionPct: pct,
    descuentoComision,
    premioGanador: round2(totalBruto - descuentoComision),
  };
}

/** Un tramo de la escalera de puja: de `desde` a `hasta`, sube `incremento`. */
export type EscalonPuja = { desde: number; hasta: number | null; incremento: number };

/**
 * Escalera de incrementos del remate (regla de la casa):
 *   0–100 → +10 · 100–200 → +20 · 200–500 → +50 · 500–1000 → +100 · ≥1000 → +200.
 *
 * El tramo es semiabierto por arriba: 100 ya entra en el tramo siguiente. Así
 * "de 0 a 100 de 10 en 10" son 10,20,…,100 y el siguiente salto (desde 100) es 20.
 *
 * Esta es la escalera POR DEFECTO. La casa puede editarla por remate
 * (`guardarEscaleraRemate`); cuando lo hace, manda la del remate y esta solo
 * se usa como punto de partida y como respaldo si la guardada se daña.
 */
export const ESCALONES_PUJA: EscalonPuja[] = [
  { desde: 0, hasta: 100, incremento: 10 },
  { desde: 100, hasta: 200, incremento: 20 },
  { desde: 200, hasta: 500, incremento: 50 },
  { desde: 500, hasta: 1000, incremento: 100 },
  { desde: 1000, hasta: null, incremento: 200 },
];

/**
 * Deja una escalera usable o devuelve la de la casa.
 *
 * Una escalera editada llega desde la base (jsonb) o desde el formulario, así
 * que no se puede confiar en ella: si viniera con `desde` desordenado, con
 * incrementos en cero o con huecos, el cálculo de la puja mínima quedaría mudo y
 * aceptaría pujas por debajo del tramo. Normalizar aquí es lo que evita que un
 * dato mal guardado se convierta en plata de menos.
 *
 * Reglas: montos no negativos, incremento > 0, el último tramo abierto
 * (`hasta: null`) y los tramos encadenados sin huecos ni solapes.
 */
export function normalizarEscalera(
  escalera: EscalonPuja[] | null | undefined
): EscalonPuja[] {
  if (!Array.isArray(escalera) || escalera.length === 0) return ESCALONES_PUJA.map((e) => ({ ...e }));

  const limpia = escalera
    .map((e) => ({
      desde: Math.max(0, Number(e?.desde) || 0),
      hasta: e?.hasta == null ? null : Number(e.hasta),
      incremento: Math.max(1, Math.round(Number(e?.incremento) || 0)),
    }))
    // `hasta` inválido o menor que `desde` es un tramo sin sentido: se abre.
    .filter((e) => e.hasta === null || (Number.isFinite(e.hasta) && e.hasta > e.desde))
    .sort((a, b) => a.desde - b.desde);

  if (limpia.length === 0) return ESCALONES_PUJA.map((e) => ({ ...e }));

  // El primer tramo arranca en 0 (si no, los montos por debajo del primer `desde`
  // no tendrían incremento) y el último queda abierto (si no, las pujas altas se
  // quedarían sin regla).
  limpia[0] = { ...limpia[0], desde: 0 };
  limpia[limpia.length - 1] = { ...limpia[limpia.length - 1], hasta: null };

  // Se encadena: cada tramo arranca donde termina el anterior, para que no queden
  // montos sin incremento en las costuras.
  for (let i = 1; i < limpia.length; i++) {
    limpia[i] = { ...limpia[i], desde: limpia[i - 1].hasta ?? limpia[i - 1].desde };
  }
  return limpia;
}

/**
 * Incremento mínimo que corresponde al monto ACTUAL de la puja. El brinco se
 * decide por el tramo en el que cae el monto: 99 sube de a 10, 100 ya sube de a 20.
 *
 * `escalera` es opcional para no obligar a todos los llamadores a pasarla; si no
 * se manda, aplica la regla de la casa.
 */
export function incrementoPuja(monto: number, escalera?: EscalonPuja[] | null): number {
  const m = Number(monto) || 0;
  const tramos = normalizarEscalera(escalera);
  for (const e of tramos) {
    if (e.hasta === null || m < e.hasta) return e.incremento;
  }
  return tramos[tramos.length - 1].incremento;
}

/** Puja mínima siguiente: el monto actual más el incremento de su tramo. */
export function pujaMinimaSiguiente(monto: number, escalera?: EscalonPuja[] | null): number {
  return round2((Number(monto) || 0) + incrementoPuja(monto, escalera));
}

/** Texto de un tramo para la tabla: "0 – 100" o "1.000 en adelante". */
export function etiquetaTramo(e: EscalonPuja): string {
  const f = (n: number) => n.toLocaleString("es-VE");
  return e.hasta === null ? `${f(e.desde)} en adelante` : `${f(e.desde)} – ${f(e.hasta)}`;
}

/**
 * Nota de observación que explica la escalera en palabras, para que el usuario
 * nuevo sepa cuánto tiene que subir y por qué la casa no acepta menos.
 */
export function explicacionEscalera(escalera?: EscalonPuja[] | null): string {
  const tramos = normalizarEscalera(escalera);
  const partes = tramos.map((e) =>
    e.hasta === null
      ? `de ${e.desde.toLocaleString("es-VE")} en adelante, +${e.incremento.toLocaleString("es-VE")}`
      : `de ${e.desde.toLocaleString("es-VE")} a ${e.hasta.toLocaleString("es-VE")}, +${e.incremento.toLocaleString("es-VE")}`
  );
  return `La puja se sube por tramos, no de a cualquier monto: ${partes.join("; ")}. Cada puja tiene que ser al menos el monto actual más el incremento del tramo en el que cae. El tramo se decide por el monto actual, así que al cruzar de ${tramos[0]?.hasta?.toLocaleString("es-VE") ?? "—"} ya corresponde el incremento siguiente.`;
}

/**
 * Proporción de la jugada CON RESPECTO A LO QUE SE PAGA, en fracción y no en
 * porcentaje: "3/5", "1/9", "2/5". Cuando la fracción es entera se muestra
 * sola ("4", "3"), que es lo que el operador necesita leer de reojo.
 *
 * El denominador es el TOTAL A PAGAR del remate (subtotal + incentivo − comisión),
 * que es contra lo que compite la puja: de nada sirve decir "40%" si el ganador
 * se lleva 15% de lo que se puso. Se reduce con la fracción mínima para que el
 * número sea el que el operador diría en voz alta, y si el denominador queda
 * enorme (centavos en una puja redonda) se cae al porcentaje, que sigue siendo
 * legible y no inventa una división de 5 dígitos.
 */
export function proporcionJugada(
  monto: number | null | undefined,
  valorAPagar: number | null | undefined,
  maxDenominador = 12
): string {
  const m = Number(monto) || 0;
  const t = Number(valorAPagar) || 0;
  if (m <= 0) return "0";
  if (t <= 0) return "—";
  const num = Math.round(m * 100);
  const den = Math.round(t * 100);
  const g = (a: number, b: number): number => (b === 0 ? a : g(b, a % b));
  const d = g(num, den);
  const n = num / d;
  const denRed = den / d;
  if (denRed === 1) return String(n);
  if (denRed > maxDenominador) return `${round2((m / t) * 100)}%`;
  return `${n}/${denRed}`;
}

/** Una fracción tradicional del tote board: valor decimal y su nombre ("7/2"). */
export type FraccionHipodromo = { valor: number; etiqueta: string };

/**
 * Tabla de fracciones del tote board. El redondeo baja siempre a la fracción
 * inmediatamente menor, a favor de la casa: nunca se paga más de lo que la
 * pizarra anuncia. Desde 4.00 la fracción es entera ("4/1", "5/1", ...).
 */
export const FRACCIONES_HIPODROMO: FraccionHipodromo[] = [
  { valor: 0.05, etiqueta: "1/20" },
  { valor: 0.11, etiqueta: "1/9" },
  { valor: 0.2, etiqueta: "1/5" },
  { valor: 0.4, etiqueta: "2/5" },
  { valor: 0.5, etiqueta: "1/2" },
  { valor: 0.6, etiqueta: "3/5" },
  { valor: 0.8, etiqueta: "4/5" },
  { valor: 1, etiqueta: "1/1" },
  { valor: 1.2, etiqueta: "6/5" },
  { valor: 1.4, etiqueta: "7/5" },
  { valor: 1.5, etiqueta: "3/2" },
  { valor: 1.6, etiqueta: "8/5" },
  { valor: 1.8, etiqueta: "9/5" },
  { valor: 2, etiqueta: "2/1" },
  { valor: 2.5, etiqueta: "5/2" },
  { valor: 3, etiqueta: "3/1" },
  { valor: 3.5, etiqueta: "7/2" },
];

/** Baja una ganancia por unidad a la fracción tradicional que le corresponde. */
export function fraccionHipodromo(ganancia: number | null | undefined): FraccionHipodromo {
  const g = Number(ganancia);
  if (!Number.isFinite(g) || g < FRACCIONES_HIPODROMO[0].valor) return { valor: 0, etiqueta: "0" };
  if (g >= 4) {
    const entero = Math.floor(g);
    return { valor: entero, etiqueta: `${entero}/1` };
  }
  let elegida = FRACCIONES_HIPODROMO[0];
  for (const f of FRACCIONES_HIPODROMO) {
    if (f.valor <= g + 1e-9) elegida = f;
    else break;
  }
  return elegida;
}

export type DividendoHipodromo = {
  /** Ganancia por unidad, ya bajada a la fracción tradicional. */
  ganancia: number;
  /** Nombre tradicional de la ganancia ("1/9"). */
  fraccion: string;
  /** Lo que devuelve cada unidad jugada: 1 + ganancia ("1.11"). */
  dividendo: number;
};

/**
 * Dividendo del ejemplar como en el tote: `poteTotal / montoJugado` es el
 * retorno por unidad; la ganancia (`retorno − 1`) se baja a la fracción
 * tradicional y el dividendo es `1 + fracción`. Si el monto no supera al pozo
 * no hay ganancia y el dividendo queda en 1.00.
 */
export function calcularDividendoHipodromo(
  poteTotal: number | null | undefined,
  montoJugado: number | null | undefined
): DividendoHipodromo {
  const pote = Number(poteTotal) || 0;
  const monto = Number(montoJugado) || 0;
  if (monto <= 0 || pote <= 0 || pote <= monto) {
    return { ganancia: 0, fraccion: "0", dividendo: 1 };
  }
  const f = fraccionHipodromo(pote / monto - 1);
  return { ganancia: f.valor, fraccion: f.etiqueta, dividendo: round2(1 + f.valor) };
}

/** Cuota para la pizarra, estilo hipódromo: "1/9"; sin ganancia, "—". */
export function textoDividendo(
  poteTotal: number | null | undefined,
  montoJugado: number | null | undefined
): string {
  const d = calcularDividendoHipodromo(poteTotal, montoJugado);
  if (d.dividendo <= 1) return "—";
  return d.fraccion;
}

const fmtMontoRemate = (n: number | null | undefined) =>
  `$${(Number(n) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Una línea de la pizarra para compartir por WhatsApp. */
export type FilaPizarraRemate = {
  numero: string;
  nombre: string;
  comprador?: string | null;
  monto_usd: number;
};

/**
 * Cuerpo del mensaje (una línea por ejemplar) con comprador, valor y dividendo.
 *
 * El formato es POSICIONAL y sin etiquetas: el grupo lo lee de un vistazo y las
 * palabras `div.`/`monto`/`comprador` solo ocupaban ancho. La cuenta va siempre
 * en el mismo orden — nº · ejemplar · quién lo lleva · plata · cuota — y la
 * cuota va entre paréntesis al final, que es donde el ojo la encuentra:
 *
 *   1. BENDECIDA - ALBARRAN - $350.00 - (1/5)
 *   2. GRAN AVELINA - CASA - $30.00
 *
 * Separador ` - ` (guion corto) y no raya: en WhatsApp la raya se come el
 * espacio del siguiente campo en pantallas chicas.
 */
export function lineasPizarraRemate(
  filas: FilaPizarraRemate[] | null | undefined,
  premioGanador: number
): string {
  return (filas ?? [])
    .map((f) => {
      const quien = String(f.comprador ?? "").trim() || "CASA";
      const div = textoDividendo(premioGanador, f.monto_usd);
      const cuota = div === "—" ? "" : ` - (${div})`;
      return `${f.numero}. ${String(f.nombre ?? "").trim().toUpperCase()} - ${quien} - ${fmtMontoRemate(f.monto_usd)}${cuota}`;
    })
    .join("\n");
}

/**
 * Monto como lo escribe el grupo: sin símbolo y sin decimales cuando es
 * entero.
 *
 * El pie de la pizarra se copia y se pega en WhatsApp, donde `$350.00` se ve
 * como un número de programa de television. Un entero se escribe `350`; si
 * alguna vez hay centavos de verdad, se muestran los dos decimales en vez de
 * redondearlos en silencio.
 */
export function montoPizarraRemate(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * CIERRE de la pizarra de remates, tal como lo pide el grupo.
 *
 * El formato es EXACTO y no se "mejora":
 *
 *   Incentivo de la casa  62
 *
 *   *Total a pagar 558*
 *
 * - DOS espacios entre "casa" y el monto: con uno el número se lee pegado a la
 *   palabra y parece parte de la frase.
 * - Una línea en blanco entre las dos: sin ella, el total se lee como una
 *   continuación del incentivo y no como el resultado final.
 * - El total va en NEGRITA de WhatsApp (asteriscos), porque es el único número
 *   por el que se abre el mensaje en el grupo.
 */
export function cierrePizarraRemate(incentivo: number, total: number): string {
  return `Incentivo de la casa  ${montoPizarraRemate(incentivo)}\n\n*Total a pagar ${montoPizarraRemate(total)}*`;
}

/**
 * Arma el mensaje del remate para el grupo de WhatsApp: una línea por ejemplar
 * con su comprador, su valor y el dividendo equivalente que le toca al pozo.
 * Se usa como respaldo cuando la plantilla del Centro de WhatsApp está vacía.
 *
 * La PRIMERA línea lleva el nombre del grupo: es el mensaje que se manda al
 * grupo de WhatsApp del banquero, así que tiene que decir de quién es (y qué
 * se está rematando) antes de la lista, no al pie donde nadie lo lee.
 *
 * `incentivo` y `total` son opcionales para no romper las llamadas viejas, pero
 * cuando vienen se agrega el cierre con el formato exacto de `cierrePizarraRemate`.
 */
export function mensajePizarraRemate(
  remate: {
    nombre?: string | null;
    hipodromo?: string | null;
    carrera?: number | string | null;
    fecha?: string | null;
    grupo?: string | null;
  },
  filas: FilaPizarraRemate[] | null | undefined,
  premioGanador: number,
  cierre?: { incentivo: number; total: number } | null
): string {
  const titulo = String(remate?.nombre ?? "").trim() || "REMATES";
  const grupo = String(remate?.grupo ?? "").trim();
  const lugar = [
    String(remate?.hipodromo ?? "").trim(),
    remate?.carrera != null ? `C${remate.carrera}` : "",
    String(remate?.fecha ?? "").trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const encabezado = grupo ? `*${titulo.toUpperCase()}* · ${grupo.toUpperCase()}` : `*${titulo.toUpperCase()}*`;
  const cuerpo = [
    encabezado,
    ...(lugar ? [`🏇 ${lugar}`] : []),
    "",
    lineasPizarraRemate(filas, premioGanador),
  ];
  if (cierre) cuerpo.push("", cierrePizarraRemate(cierre.incentivo, cierre.total));
  return cuerpo.join("\n").trim();
}

/**
 * Traduce el porcentaje de una puja a lenguaje llano ("1 de cada 4"), que es
 * como lo razona el cliente; el porcentaje solo no dice nada.
 *
 * El redondeo es "grosso" a propósito: la probabilidad real se guarda con dos
 * decimales para las cuentas, pero "1 de cada 3" no puede mentir sobre su
 * redondeo, y "0 de cada 0" es peor que no decir nada.
 */
export function traducirProporcion(pct: number | null | undefined): string {
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0) return "sin proporción";
  const n = Math.max(1, Math.round(100 / p));
  return `1 de cada ${n.toLocaleString("es-VE")}`;
}

/**
 * Probabilidad implícita de cada puja: el peso de su monto sobre el pozo.
 * `porcentaje` es monto/subtotal*100; `implicita` es la cuota justa
 * (subtotal/monto), que es lo que la casa compara contra el monto pujado.
 */
export function probabilidades(caballos: Array<Pick<CaballoRemate, "monto_usd">> | null | undefined): Array<{ prob_porcentaje: number; prob_implicita: number }> {
  const filas = caballos ?? [];
  const subtotal = filas.reduce((acc, c) => acc + (Number(c?.monto_usd) || 0), 0);
  return filas.map((c) => {
    const monto = Number(c?.monto_usd) || 0;
    if (subtotal <= 0 || monto <= 0) return { prob_porcentaje: 0, prob_implicita: 0 };
    return {
      prob_porcentaje: round2((monto / subtotal) * 100),
      prob_implicita: round2(subtotal / monto),
    };
  });
}

/** Texto de resumen de la jornada del programa: "3 carrera(s) el 2026-10-04". */
export function resumenPrograma(carreras: Array<{ carrera: number | string }> | null | undefined, fecha: string): string {
  const n = (carreras ?? []).length;
  if (!n) return `Sin carreras cargadas para el ${fecha || "día elegido"}.`;
  return `${n} carrera(s) cargada(s) para el ${fecha}.`;
}

// ---------------------------------------------------------------------------
// AUTORIZACIÓN DE COMPRA: SALDO, AVAL Y BLOQUEO POR REMATE ABIERTO
// ---------------------------------------------------------------------------

/** Cliente tal como lo necesita el remate para autorizar una puja. */
export type ClienteRemate = {
  id?: string | number | null;
  nombre?: string | null;
  saldo_actual?: number | string | null;
  aval?: number | string | null;
  modo_juego?: string | null;
  libre?: boolean | null;
};

/** Una puja que retiene plata del cliente mientras el remate está abierto. */
export type BloqueoPuja = {
  cliente_id?: string | null;
  monto_usd?: number | string | null;
};

/** Autorización de una puja: si pasa y por qué no. */
export type AutorizacionRemate = {
  ok: boolean;
  monto: number;
  /** Saldo + aval del cliente. */
  bruto: number;
  /** Bruto − lo que ya tiene bloqueado en otros remates abiertos. */
  disponible: number;
  /** `null` cuando la puja está autorizada. */
  motivo: string | null;
};

const fmtDinero = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * El cliente en modo LIBRE no compra: en Taquilla juega por encima de su saldo
 * porque no topa. En Remates no hay "*2" ni cobertura: la puja es plata que la
 * casa tiene que poder devolver, así que un cliente libre no entra.
 *
 * El `libre` de la cartera y el `modo_juego` se miran los dos porque las dos
 * formas se guardaron según el módulo desde el que se cargó el cliente.
 */
export function esClienteLibreRemate(c: ClienteRemate | null | undefined): boolean {
  if (!c) return false;
  if (c.libre === true) return true;
  return String(c.modo_juego ?? "").trim().toLowerCase() === "libre";
}

/**
 * Poder de compra del cliente: `saldo + aval`, el mismo criterio de
 * `disponibleParaJugar` (taquilla/reparto.ts). El aval amplía lo que puede
 * comprar sin ser efectivo: por eso no se resta, solo se suma.
 */
export function saldoDisponibleRemate(c: ClienteRemate | null | undefined): number {
  const saldo = Number(c?.saldo_actual);
  const aval = Number(c?.aval);
  const s = Number.isFinite(saldo) ? saldo : 0;
  const a = Number.isFinite(aval) ? aval : 0;
  return round2(s + a);
}

/**
 * Cuánta plata tiene cada cliente COMPROMETIDA en remates abiertos: la suma de
 * sus pujas. Es la reserva que se muestra como "bloqueado" mientras el remate
 * sigue abierto, y se libera sola cuando el remate cierra o cuando se le quita
 * el ejemplar (no hay que restar nada a mano: el bloqueo se deriva de las pujas
 * vivas).
 */
export function sumarBloqueos(pujas: BloqueoPuja[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pujas ?? []) {
    const id = String(p?.cliente_id ?? "").trim();
    const monto = Number(p?.monto_usd) || 0;
    if (!id || monto <= 0) continue;
    out[id] = round2((out[id] ?? 0) + monto);
  }
  return out;
}

/**
 * Lo que le queda para pujar en ESTE remate: `saldo + aval` menos lo que ya
 * tiene comprometido en otros remates abiertos.
 *
 * `bloqueado` es un mapa `cliente_id → monto` que ya viene con lo de este mismo
 * remate descontado por el llamador cuando corresponde (subir la puja de un
 * ejemplar que el cliente ya tiene no puede=toparse contra su propia puja).
 */
export function disponibleRemate(
  cliente: ClienteRemate | null | undefined,
  bloqueado: Record<string, number> | null | undefined
): number {
  const id = String(cliente?.id ?? "").trim();
  const retenido = id ? Number(bloqueado?.[id]) || 0 : 0;
  return round2(saldoDisponibleRemate(cliente) - retenido);
}

/**
 * ¿Puede este cliente comprar por `monto` en el remate?
 *
 * Tres reglas y ni una negociable: hay cliente, NO es libre, y el monto no
 * pasa del disponible. El mensaje va listo para el `toast` porque casi siempre
 * lo va a terminar viendo el operador, no el cliente.
 */
export function autorizarPujaRemate(
  cliente: ClienteRemate | null | undefined,
  monto: number | null | undefined,
  bloqueado: Record<string, number> | null | undefined
): AutorizacionRemate {
  const n = round2(Number(monto) || 0);
  if (!cliente) return { ok: false, monto: n, bruto: 0, disponible: 0, motivo: "Elegí un comprador." };
  const bruto = saldoDisponibleRemate(cliente);
  const disponible = disponibleRemate(cliente, bloqueado);
  const nombre = String(cliente.nombre ?? "").trim() || "El cliente";
  if (esClienteLibreRemate(cliente)) {
    return {
      ok: false,
      monto: n,
      bruto,
      disponible,
      motivo: `${nombre} está en modo Libre: en Remates no puede comprar.`,
    };
  }
  if (n <= 0) return { ok: true, monto: 0, bruto, disponible, motivo: null };
  if (n > disponible + 0.001) {
    return {
      ok: false,
      monto: n,
      bruto,
      disponible,
      motivo:
        disponible <= 0
          ? `${nombre} no tiene saldo ni aval para comprar: disponible ${fmtDinero(disponible)}.`
          : `${nombre} tiene ${fmtDinero(disponible)} disponibles (saldo + aval − bloqueado) y la puja es de ${fmtDinero(n)}.`,
    };
  }
  return { ok: true, monto: n, bruto, disponible, motivo: null };
}

// ---------------------------------------------------------------------------
// CIERRE Y REAPERTURA
// ---------------------------------------------------------------------------

/** Lo unico de un renglon que decide si se vende o se queda en la casa. */
export type FilaLiquidable = {
  cliente_id?: string | null;
  monto_usd?: number | null;
};

/** Resumen de lo que va a pasar al cerrar, para mostrarlo ANTES de cerrar. */
export type PlanCierreRemate = {
  /** Ejemplares con comprador: generan ticket y descuentan saldo. */
  aVender: number;
  /** Ejemplares sin comprador: quedan en CASA, sin ticket ni descuento. */
  enCasa: number;
  /** Renglones con comprador pero sin monto: no se pueden vender. */
  sinMonto: number;
  /** Suma de los montos con comprador: es lo que se descuenta de los saldos. */
  total: number;
  /** No hay nada que liquidar: no tiene sentido abrir la confirmación. */
  vacio: boolean;
};

/**
 * Que hace el cierre, en numeros.
 *
 * La regla es una sola y no admite excepciones: **tiene comprador = venta**
 * (ticket + descuento de saldo), **no tiene comprador = CASA** (ni ticket ni
 * descuento, el ejemplar se lo queda la casa). Un renglon con comprador pero sin
 * monto no se puede vender, asi que se cuenta aparte para avisarlo en vez de
 * dejarlo pasar en silencio.
 *
 * Esto NO descuenta nada: solo mira. El dinero lo mueve `club_cerrar_remate`
 * (sql/remate_cierre.sql) en una sola transaccion.
 */
export function planCierreRemate(filas: FilaLiquidable[] | null | undefined): PlanCierreRemate {
  let aVender = 0;
  let enCasa = 0;
  let sinMonto = 0;
  let total = 0;
  for (const f of filas ?? []) {
    const monto = Number(f?.monto_usd) || 0;
    if (!String(f?.cliente_id ?? "").trim()) {
      if (monto > 0) enCasa += 1;
      continue;
    }
    if (monto <= 0) {
      sinMonto += 1;
      continue;
    }
    aVender += 1;
    total = round2(total + monto);
  }
  return { aVender, enCasa, sinMonto, total, vacio: aVender === 0 && enCasa === 0 };
}

/** Estado de edicion de un renglon de la pizarra. */
export type EdicionFilaRemate = {
  /** No se puede tocar nada: cerrado, retirado, invalidado o ya vendido. */
  bloqueado: boolean;
  /** Solo se le puede ASIGNAR un comprador: el valor ya se descontado. */
  soloAsignar: boolean;
  /** Ya se vendio en un cierre: su saldo fue descontado. */
  vendido: boolean;
};

/**
 * Que se puede tocar en una fila de la pizarra.
 *
 * - Cerrado = nada se toca.
 * - Retirado (Carreras) o invalidado (INV) = nada se toca.
 * - Remate YA liquidado y reabierto: lo unico editable es **asignarle comprador
 *   a los ejemplares que siguen sin comprador**. Los que ya tienen comprador
 *   estan vendidos (su saldo se descontó) y el valor ya se contabilizó, asi que
 *   quedan bloqueados.
 */
export function edicionFilaRemate(opts: {
  cerrado: boolean;
  liquidado?: boolean;
  vendido?: boolean;
  retiro?: boolean;
  inv?: boolean;
}): EdicionFilaRemate {
  const vendido = Boolean(opts.vendido);
  const bloqueado = Boolean(opts.cerrado) || Boolean(opts.retiro) || Boolean(opts.inv) || vendido;
  return { bloqueado, soloAsignar: Boolean(opts.liquidado) && !bloqueado, vendido };
}

