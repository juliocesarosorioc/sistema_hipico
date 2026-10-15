/**
 * ============================================================================
 * POLLA — LÓGICA PURA (sin Supabase ni React)
 * ============================================================================
 *
 * Una Polla es un juego de ACIERTOS por puntos sobre el programa del día:
 *
 *   1. La casa configura QUÉ CARRERAS entran (salen de la matriz central del
 *      programa) y QUÉ PUNTOS da cada puesto. Por defecto 5 al 1º, 3 al 2º y
 *      1 al 3º, pero es configurable.
 *   2. Cada jugador compra una o más COMBINACIONES. Una combinación es un
 *      ejemplar por carrera: no puede llevar dos caballos en la misma carrera.
 *   3. Gana quien más puntos suma. Los premios por puesto (1º, 2º, 3º) los
 *      configura la casa, y pueden ser dinero u otra cosa.
 *   4. La casa cobra un % sobre la venta, y un % configurable de esa venta se
 *      aparta al ACUMULADO, que se paga a quien alcance la meta de puntos.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ ESTE ARCHIVO ES PURO Y POR QUÉ TAN ESPECÍFICO
 * ----------------------------------------------------------------------------
 * Todo lo caro de este módulo es el reparto, y el reparto se rompe en silencio:
 * un ejemplar invalidado que igual puntúa, una combinación con dos caballos en
 * la misma carrera que puntúa doble, un empate que le da el premio a uno solo.
 * Nada de eso da error: da un número, y la casa lo paga.
 *
 * Por eso el parseo del texto del jugador, el bloqueo de inválidos, el puntaje
 * y las finanzas están acá, sin base de datos, para que se prueben como se
 * prueba una función cualquiera.
 *
 * ----------------------------------------------------------------------------
 * CÓMO SE ESCRIBE UNA COMBINACIÓN
 * ----------------------------------------------------------------------------
 * El jugador escribe grupos separados por COMA o por SALTO DE LÍNEA; dentro de
 * cada grupo los caballos se separan con GUION y son alternativas. El grupo 1 es
 * la primera carrera de la Polla, el 2 la segunda, y así.
 *
 *   "1, 2-3, 1-2, 4, 5, 6"
 *        1×2×2×1×1×1 = 4 combinaciones:
 *        1-2-1-4-5-6   1-3-1-4-5-6   1-2-2-4-5-6   1-3-2-4-5-6
 *
 * El mismo texto con un caballo por línea:
 *
 *        1
 *        2-3
 *        1
 *        2-3
 *        4
 *        2-3
 *
 *        1×2×1×2×1×2 = 8 combinaciones.
 *
 * Y cuando el jugador NO quiere combinaciones sino UNA, escribe un solo grupo
 * con un caballo por carrera:
 *
 *   "1-2-3-4-5-6"  en una Polla de 6 carreras  ->  UNA combinación.
 *
 * Esa última regla evita cobrarle seis veces a quien escribió su combinación
 * corrida, y no es una heurística: se aplica solo cuando hay UN grupo, y tiene
 * tantos caballos como carreras. Con más de un grupo, los guiones son
 * alternativas, siempre.
 */

// ============================================================================
// Configuración
// ============================================================================

/** Puntos por puesto. Configurable: por defecto 5 / 3 / 1. */
export type ConfigPuntos = {
  primero: number;
  segundo: number;
  tercero: number;
};

export const PUNTOS_POR_DEFECTO: ConfigPuntos = { primero: 5, segundo: 3, tercero: 1 };

/** Puntos que hay que sacar para ganarse el acumulado. */
export const META_ACUMULADO_POR_DEFECTO = 30;

/**
 * Tope de combinaciones que se pueden generar desde un solo texto.
 *
 * No es un detalle: "1-2" en 16 carreras son 2¹⁶ = 65.536 combinaciones. Sin este
 * tope, un texto equivocado congela el navegador y deja al jugador esperando un
 * cobro que nunca termina. El producto se calcula ANTES de expandir, para no
 * construir el arreglo gigante y descartarlo después.
 */
export const MAX_COMBINACIONES = 2000;

// ============================================================================
// Datos de entrada
// ============================================================================

/** Un ejemplar de una carrera de la Polla. */
export type EjemplarPolla = {
  numero: string;
  nombre?: string | null;
};

/**
 * Una carrera que entra en la Polla.
 *
 * `clave` identifica la carrera en la matriz central (`fecha|hipodromo|carrera`) y
 * es lo que se guarda en la venta, para que el resultado se lea siempre de la
 * matriz central y no de una copia congelada.
 */
export type CarreraPolla = {
  clave: string;
  fecha: string;
  hipodromo: string;
  carrera: number;
  ejemplares: EjemplarPolla[];
  /**
   * Números que NO se pueden colocar en una combinación: retirados de la carrera
   * central, o invalidados para Polla.
   */
  invalidados?: string[];
};

/** Un ejemplar elegido para una carrera. */
export type SeleccionPolla = { claveCarrera: string; numero: string };

/**
 * Una combinación: exactamente un ejemplar por cada carrera de la Polla.
 *
 * Se nombra aparte de `SeleccionPolla` porque el error más caro de este módulo
 * es justamente confundir las dos: una combinación tiene longitud igual a la
 * cantidad de carreras, y `SeleccionPolla` es UN ejemplar.
 */
export type Combinacion = SeleccionPolla[];

export type ConfigPolla = {
  carreras: CarreraPolla[];
  puntos: ConfigPuntos;
  /** Lo que el jugador paga por cada combinación que compra. */
  precioUnitario: number;
  /** % de la venta que es ingreso de la casa. */
  comisionPct: number;
  /** % de la venta que se aparta al acumulado. */
  acumuladoPct: number;
  /** Puntos necesarios para cobrar el acumulado. */
  metaPuntos: number;
  /** Premios por puesto. `null` = ese puesto no paga. */
  premios: { primero: number | null; segundo: number | null; tercero: number | null };
};

/** Configuración con los defaults ya resueltos. */
export function configPorDefecto(carreras: CarreraPolla[], precioUnitario = 0): ConfigPolla {
  return {
    carreras,
    puntos: { ...PUNTOS_POR_DEFECTO },
    precioUnitario,
    comisionPct: 0,
    acumuladoPct: 0,
    metaPuntos: META_ACUMULADO_POR_DEFECTO,
    premios: { primero: null, segundo: null, tercero: null },
  };
}

// ============================================================================
// Normalización de números de ejemplar
// ============================================================================

/**
 * Deja el Nº de ejemplar en una forma comparable.
 *
 * La matriz central guarda "07" en un lado y "7" en el otro (el número con el que
 * corre el caballo es texto libre). Comparar crudo hacía que un 1º lugar "7" no
 * encontrara al ejemplar "07" y el jugador perdiera los 5 puntos sin ver por qué.
 */
export function normalizarNumero(v: unknown): string {
  return String(v ?? "").trim().replace(/^0+(?=\d)/, "");
}

// ============================================================================
// Parseo del texto del jugador
// ============================================================================

export type ResultadoParseo =
  | { ok: true; combinaciones: Combinacion[]; /** Carreras detectadas en el texto. */ carreras: number }
  | { ok: false; error: string };

/** Guiones largos: alguien copia de una página web y no son guiones ASCII. */
const GUIONES = /\s*[-‐‑‒–—―]\s*/g;

/** Divide el texto en grupos y, cada grupo, en sus alternativas. */
export function partirGrupos(texto: string): string[][] {
  return String(texto ?? "")
    .replace(/\r/g, "")
    .split(/[,;\n]+/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
    .map((g) => g.split(GUIONES).map(normalizarNumero).filter((n) => n.length > 0));
}

/** Cuántas combinaciones daría el texto, sin construirlas. */
export function contarCombinaciones(grupos: string[][]): number {
  if (!grupos.length) return 0;
  return grupos.reduce((acc, g) => acc * Math.max(1, g.length), 1);
}

/**
 * Convierte el texto del jugador en combinaciones de un ejemplar por carrera.
 *
 * Los grupos siguen el orden de las carreras configuradas. Si el jugador escribe
 * los grupos en otro orden, no se puede adivinar cuál carrera quiso decir, y
 * adivinar cambiaría el premio sin que nadie lo note: por eso el orden es fijo y
 * la pantalla muestra las carreras numeradas en la misma secuencia.
 */
export function parsearSeleccion(texto: string, carreras: CarreraPolla[]): ResultadoParseo {
  if (!Array.isArray(carreras) || carreras.length === 0) {
    return { ok: false, error: "La Polla no tiene carreras configuradas." };
  }
  const grupos = partirGrupos(texto);
  if (grupos.length === 0) return { ok: false, error: "No escribiste ninguna combinación." };

  const n = carreras.length;

  // Combinación corrida: un solo grupo, con un caballo por carrera.
  if (grupos.length === 1) {
    const unico = grupos[0];
    if (unico.length === n) {
      return {
        ok: true,
        carreras: n,
        combinaciones: [carreras.map((c, i) => ({ claveCarrera: c.clave, numero: unico[i] }))],
      };
    }
    return {
      ok: false,
      error:
        `Escribiste ${unico.length} caballos y la Polla tiene ${n} carreras. ` +
        `Poné ${n} caballos separados por guion para una sola combinación, o ` +
        `separá cada carrera con coma o salto de línea para dar alternativas.`,
    };
  }

  if (grupos.length !== n) {
    return {
      ok: false,
      error:
        `Escribiste ${grupos.length} grupos y la Polla tiene ${n} carreras. ` +
        `Cada carrera va en su propio grupo, separado por coma o salto de línea.`,
    };
  }

  // El producto se calcula ANTES de expandir: si el texto explota, no se construye nada.
  const total = contarCombinaciones(grupos);
  if (total > MAX_COMBINACIONES) {
    return {
      ok: false,
      error:
        `Esas opciones dan ${total.toLocaleString("es-VE")} combinaciones y el tope es ` +
        `${MAX_COMBINACIONES.toLocaleString("es-VE")}. Sacá alternativas o partí la Polla.`,
    };
  }

  const combinaciones: Combinacion[] = [];
  const visitar = (i: number, acum: Combinacion) => {
    if (i === n) {
      combinaciones.push([...acum]);
      return;
    }
    for (const numero of grupos[i]) {
      acum.push({ claveCarrera: carreras[i].clave, numero });
      visitar(i + 1, acum);
      acum.pop();
    }
  };
  visitar(0, []);
  return { ok: true, carreras: n, combinaciones };
}

// ============================================================================
// Inválidos y ejemplares jugables
// ============================================================================

/**
 * ¿Se puede colocar este Nº en una combinación?
 *
 * Responde `true` cuando NO se puede, y covers los tres casos: el número está en
 * la lista de inválidos, viene vacío, o no es un número. El último caso importa:
 * preguntar solo "¿está en la lista?" hacía que "abc" pasara como ejemplar
 * colocable, porque un texto no está en ninguna lista.
 */
export function esInvalido(carrera: CarreraPolla, numero: unknown): boolean {
  const n = normalizarNumero(numero);
  if (!n) return true;
  if (!/^\d+$/.test(n)) return true;
  return (carrera.invalidados ?? []).some((x) => normalizarNumero(x) === n);
}

/**
 * Ejemplares que se pueden colocar en una combinación de esa carrera.
 *
 * Los inválidos NO se ofrecen: es la regla del juego ("ninguna combinación puede
 * colocarlos") y además evita el reclamo. Si el ejemplar aparece en pantalla y
 * después se invalida, el jugador ya pagó por una combinación imposible.
 */
export function ejemplaresJugables(carrera: CarreraPolla): EjemplarPolla[] {
  return (carrera.ejemplares ?? []).filter((e) => !esInvalido(carrera, e.numero));
}

/**
 * Revisa una combinación antes de cobrarla.
 *
 * Se valida en DOS momentos y por razones distintas: al cobrar (el jugador no
 * puede comprar una combinación imposible) y al liquidar (un ejemplar puede
 * invalidarse DESPUÉS de la venta, y esa combinación tiene que quedar sin puntos
 * en vez de puntuar como si fuera válida).
 */
export function revisarCombinacion(
  seleccion: Combinacion,
  carreras: CarreraPolla[]
): { ok: true } | { ok: false; error: string } {
  const porClave = new Map(carreras.map((c) => [c.clave, c]));
  if (seleccion.length !== carreras.length) {
    return { ok: false, error: "La combinación no tiene un ejemplar por cada carrera." };
  }
  for (const sel of seleccion) {
    const carrera = porClave.get(sel.claveCarrera);
    if (!carrera) {
      return { ok: false, error: "La combinación incluye una carrera que no está en la Polla." };
    }
    const num = normalizarNumero(sel.numero);
    if (!num) return { ok: false, error: "Hay una carrera de la combinación sin caballo." };
    if (esInvalido(carrera, num)) {
      return {
        ok: false,
        error:
          `El ejemplar N° ${num} de la ${carrera.carrera}ª carrera de ${carrera.hipodromo} ` +
          `está invalidado y no se puede colocar.`,
      };
    }
    const existe = (carrera.ejemplares ?? []).some((e) => normalizarNumero(e.numero) === num);
    if (!existe) {
      return {
        ok: false,
        error: `El ejemplar N° ${num} no está en la ${carrera.carrera}ª carrera de ${carrera.hipodromo}.`,
      };
    }
  }
  return { ok: true };
}

/** El resultado del mismo tipo de error, para marcar la fila culpable en pantalla. */
export type ComboInvalida = { combinacion: Combinacion; error: string };

/**
 * Revisa todas las combinaciones de una venta.
 *
 * Devuelve cuáles están malas y por qué, no un sí/no: cuando un jugador carga 40
 * combinaciones y hay dos con un inválido, la pantalla tiene que señalar esas dos
 * y aceptar las otras 38.
 */
export function revisarVenta(
  combinaciones: Combinacion[],
  carreras: CarreraPolla[]
): { validas: Combinacion[]; invalidas: ComboInvalida[] } {
  const validas: Combinacion[] = [];
  const invalidas: ComboInvalida[] = [];
  for (const c of combinaciones) {
    const r = revisarCombinacion(c, carreras);
    if (r.ok) validas.push(c);
    else invalidas.push({ combinacion: c, error: r.error });
  }
  return { validas, invalidas };
}

// ============================================================================
// Puntaje
// ============================================================================

/** Resultado (orden de llegada) de una carrera, tal como lo da la matriz central. */
export type ResultadoCarrera = {
  clave: string;
  /** Números ganadores, en orden de llegada: ["3", "1", "7", ...]. */
  ganadores: string[];
};

/** Puntos de un puesto: fuera del 3º no hay puntos. */
export function puntosDePuesto(puesto: number, puntos: ConfigPuntos): number {
  const v = puesto === 1 ? puntos.primero : puesto === 2 ? puntos.segundo : puesto === 3 ? puntos.tercero : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Puntos de UNA combinación contra los resultados.
 *
 * Si el ejemplar quedó invalidado, la combinación no puntúa, aunque el resultado
 * lo haya-ranked en un puesto. Se puntúa la combinación que se podía jugar, no la
 * que el jugador quiso.
 */
export function puntosDeCombinacion(
  seleccion: Combinacion,
  resultados: ResultadoCarrera[],
  carreras: CarreraPolla[],
  puntos: ConfigPuntos
): number {
  const porCarrera = new Map(carreras.map((c) => [c.clave, c]));
  const porResultado = new Map(resultados.map((r) => [r.clave, r]));
  let total = 0;
  for (const sel of seleccion) {
    const carrera = porCarrera.get(sel.claveCarrera);
    if (carrera && esInvalido(carrera, sel.numero)) continue;
    const res = porResultado.get(sel.claveCarrera);
    if (!res) continue;
    const puesto = (res.ganadores ?? []).map(normalizarNumero).indexOf(normalizarNumero(sel.numero));
    if (puesto >= 0) total += puntosDePuesto(puesto + 1, puntos);
  }
  return total;
}

/** Una combinación con su puntaje. */
export type CombinacionPuntiada = {
  combinacion: Combinacion;
  puntos: number;
  /** Carreras sin pizarra: la Polla todavía no se puede liquidar. */
  carrerasSinResultado: string[];
};

/**
 * Puntúa todas las combinaciones y dice qué carreras falta cerrar.
 *
 * `carrerasSinResultado` se separa del puntaje a propósito: una carrera sin
 * pizarra no vale 0 puntos, vale "todavía no". Puntuar parcial le quitaría puntos
 * al jugador por una carrera que la casa todavía no corrió.
 */
export function puntuarCombinaciones(
  combinaciones: Combinacion[],
  resultados: ResultadoCarrera[],
  carreras: CarreraPolla[],
  puntos: ConfigPuntos
): CombinacionPuntiada[] {
  const conResultado = new Set(
    resultados.filter((r) => Array.isArray(r.ganadores) && r.ganadores.length > 0).map((r) => r.clave)
  );
  const sinCerrar = carreras.filter((c) => !conResultado.has(c.clave)).map((c) => `${c.hipodromo} ${c.carrera}ª`);
  const incompletas = sinCerrar.length > 0;
  return combinaciones.map((combinacion) => ({
    combinacion,
    puntos: incompletas ? 0 : puntosDeCombinacion(combinacion, resultados, carreras, puntos),
    carrerasSinResultado: sinCerrar,
  }));
}

/** Una venta con todas sus combinaciones puntuadas. */
export type VentaPuntuada = {
  id?: string;
  cliente_id?: string | null;
  cliente?: string | null;
  combinaciones: Combinacion[];
  /** Suma de los puntos de TODAS las combinaciones del cliente en esta Polla. */
  puntosTotales: number;
  /** Lo que el cliente pagó por esas combinaciones. */
  pagado: number;
};

/**
 * Agrupa las combinaciones por cliente y suma sus puntos.
 *
 * El ranking es POR CLIENTE, no por combinación: un jugador puede comprar varias
 * combinaciones y compite la persona. Si rankeara por combinación, el que compró
 * más entradas siempre ganaría, que es lo contrario de una Polla.
 */
export function puntuarVentas(
  ventas: VentaPuntuada[],
  resultados: ResultadoCarrera[],
  carreras: CarreraPolla[],
  puntos: ConfigPuntos
): VentaPuntuada[] {
  return ventas.map((v) => {
    const detalle = puntuarCombinaciones(v.combinaciones ?? [], resultados, carreras, puntos);
    return {
      ...v,
      combinaciones: detalle.map((d) => d.combinacion),
      puntosTotales: detalle.reduce((a, d) => a + d.puntos, 0),
    };
  });
}

// ============================================================================
// Ranking y premios
// ============================================================================

export type Puesto = 1 | 2 | 3;

/** Una fila del ranking con su premio ya asignado. */
export type FilaRanking = {
  clave: string;
  cliente_id?: string | null;
  cliente?: string | null;
  puntos: number;
  /** `null` = fuera de los tres primeros lugares, no paga premio de puesto. */
  puesto: Puesto | null;
  premio: number;
  /** Más de un cliente con este puesto: el premio se repartió. */
  empatado: boolean;
  /** Parte del acumulado que le tocó (0 si no lo cobra). */
  acumulado: number;
  /** Puntos que le faltaron para el acumulado (0 = lo cobró). */
  faltantesAcumulado: number;
};

/**
 * Ordena por puntos y asigna puesto con el criterio de competencia: el puesto es
 * 1 + la cantidad de filas con MÁS puntos. Así dos primeros dejan al siguiente en
 * tercero, que es lo que espera cualquiera que mire la tabla, en vez de un
 * segundo que no existe.
 */
export function ordenarRanking(ventas: VentaPuntuada[]): FilaRanking[] {
  const orden = [...ventas].sort((a, b) => {
    if (b.puntosTotales !== a.puntosTotales) return b.puntosTotales - a.puntosTotales;
    // Empate: por nombre, para que la tabla no cambie de orden entre recargas.
    return String(a.cliente ?? a.cliente_id ?? "").localeCompare(String(b.cliente ?? b.cliente_id ?? ""), "es");
  });
  const mayor = (p: number) => orden.filter((x) => x.puntosTotales > p).length + 1;
  return orden.map((v) => {
    const p = mayor(v.puntosTotales);
    return {
      clave: String(v.cliente_id ?? v.cliente ?? ""),
      cliente_id: v.cliente_id,
      cliente: v.cliente,
      puntos: v.puntosTotales,
      puesto: p === 1 || p === 2 || p === 3 ? ((p as 1 | 2 | 3)) : null,
      premio: 0,
      empatado: orden.filter((x) => x.puntosTotales === v.puntosTotales).length > 1,
      acumulado: 0,
      faltantesAcumulado: 0,
    };
  });
}

/** El premio configurado para un puesto. */
export function premioDePuesto(puesto: number | null, config: ConfigPolla): number {
  if (puesto === 1) return Number(config.premios.primero) || 0;
  if (puesto === 2) return Number(config.premios.segundo) || 0;
  if (puesto === 3) return Number(config.premios.tercero) || 0;
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reparte un monto entre n ganadores sin perder centavos.
 *
 * El sobrante por redondeo va al primero: cortar centavos a cambio de nada deja
 * la caja con diferencia y nadie sabe de dónde salió.
 */
export function repartirEntre(n: number, monto: number): number[] {
  const gente = Math.max(0, Math.floor(n));
  if (gente === 0) return [];
  const total = round2(Math.max(0, Number(monto) || 0));
  const base = round2(Math.floor((total / gente) * 100) / 100);
  const sobra = round2(total - base * gente);
  return Array.from({ length: gente }, (_, i) => round2(i === 0 ? base + sobra : base));
}

/**
 * Arma el ranking final: puesto, premio, acumulado y a quién le tocó.
 *
 * El acumulado se paga a quien llega a la meta de puntos. Si varios la alcanzan:
 *
 *   - Si hay un ganador claro (más puntos entre los que la alcanzaron), cobra él solo.
 *   - Si varios empatan en la meta, se reparte entre ellos.
 *
 * Cobra UNO, no todos: el acumulado es un premio, no unaitimesación. Y lo que no
 * alcanza la meta NO se reparte entre los demás, porque el acumulado existe para
 * la combinación perfecta.
 */
export function liquidarPolla(
  ventas: VentaPuntuada[],
  config: ConfigPolla,
  acumuladoDisponible: number
): FilaRanking[] {
  const filas = ordenarRanking(ventas);
  const meta = Math.max(0, Number(config.metaPuntos) || 0);
  const disponible = round2(Math.max(0, Number(acumuladoDisponible) || 0));

  // Premios por puesto, agrupando a los empatados para partir lo que les toca.
  const porPuesto = new Map<number, string[]>();
  for (const f of filas) {
    if (f.puesto === null) continue;
    const arr = porPuesto.get(f.puesto) ?? [];
    arr.push(f.clave);
    porPuesto.set(f.puesto, arr);
  }
  const premioDe = new Map<string, number>();
  for (const [puesto, claves] of porPuesto) {
    const partes = repartirEntre(claves.length, premioDePuesto(puesto, config));
    claves.forEach((c, i) => premioDe.set(c, partes[i] ?? 0));
  }

  // Acumulado: solo los que llegan a la meta; el mejor se lleva todo, o se reparte
  // si varios empatan en la meta.
  const metaAlcanzada = meta > 0 ? filas.filter((f) => f.puntos >= meta) : [];
  const mejorEntre = metaAlcanzada.length ? Math.max(...metaAlcanzada.map((f) => f.puntos)) : 0;
  const candidatos = meta > 0 && disponible > 0 ? metaAlcanzada.filter((f) => f.puntos === mejorEntre) : [];
  const partesAcum = repartirEntre(candidatos.length, disponible);
  const acumuladoDe = new Map<string, number>();
  candidatos.forEach((f, i) => acumuladoDe.set(f.clave, partesAcum[i] ?? 0));

  return filas.map((f) => ({
    ...f,
    premio: premioDe.get(f.clave) ?? 0,
    acumulado: acumuladoDe.get(f.clave) ?? 0,
    faltantesAcumulado: meta > 0 && f.puntos < meta ? meta - f.puntos : 0,
  }));
}

// ============================================================================
// Finanzas
// ============================================================================

export type FinanzasPolla = {
  combinacionesVendidas: number;
  /** Venta bruta: precio unitario × combinaciones. */
  ventaBruta: number;
  /** Ingreso de la casa por comisión. */
  comisionCasa: number;
  /** Monto apartado al acumulado. */
  aporteAcumulado: number;
  /** Premios por puesto que se pagan (primero + segundo + tercero). */
  premiosPagados: number;
  /** Lo que la casa actually paga en total, con el acumulado incluido. */
  totalPagado: number;
  /** Venta menos lo pagado. Positivo = la casa ganó. */
  netoCasa: number;
  /** Los premios no entran en lo que la venta financió. */
  descuadre: boolean;
  /** Avisos legibles para la pantalla, no excepciones. */
  avisos: string[];
};

/**
 * Finanzas de una Polla.
 *
 * El acumulado se aparta de la VENTA, no de lo que sobra después de los premios:
 * primero sale la comisión de la casa, después se aparta el acumulado, y con lo
 * que queda se pagan los premios. Si los premios no entran, `descuadre` lo dice en
 * pantalla en vez de dejar una caja negativa sin explicación.
 */
export function calcularFinanzasPolla(
  combinacionesVendidas: number,
  config: ConfigPolla,
  acumuladoDisponible = 0,
  ranking: FilaRanking[] = []
): FinanzasPolla {
  const n = Math.max(0, Number(combinacionesVendidas) || 0);
  const precio = Math.max(0, Number(config.precioUnitario) || 0);
  const ventaBruta = round2(n * precio);
  const comisionCasa = round2((ventaBruta * Math.max(0, Number(config.comisionPct) || 0)) / 100);
  const aporteAcumulado = round2((ventaBruta * Math.max(0, Number(config.acumuladoPct) || 0)) / 100);

  // Si hay ranking se paga lo que el ranking repartió (respeta empates); si no,
  // se toma lo configurado, que es lo que se ve antes de cerrar.
  const premiosPagados = ranking.length
    ? round2(ranking.reduce((a, f) => a + f.premio, 0))
    : round2(premioDePuesto(1, config) + premioDePuesto(2, config) + premioDePuesto(3, config));
  const acumuladoPagado = round2(ranking.reduce((a, f) => a + f.acumulado, 0));
  const totalPagado = round2(premiosPagados + acumuladoPagado);
  const netoCasa = round2(ventaBruta - totalPagado);

  const avisos: string[] = [];
  if (netoCasa < 0) {
    avisos.push(
      `Los premios y el acumulado (${totalPagado.toFixed(2)}) superan la venta ` +
        `(${ventaBruta.toFixed(2)}). La caja de la Polla queda en negativo.`
    );
  }
  if (Math.max(0, Number(acumuladoDisponible) || 0) > 0 && Number(config.acumuladoPct) === 0) {
    avisos.push("Hay acumulado disponible pero la Polla no aparta porcentaje: no se está acumulando nada.");
  }
  if (comisionCasa + aporteAcumulado > ventaBruta) {
    avisos.push("La comisión más el acumulado se llevan toda la venta: no queda para los premios.");
  }

  return {
    combinacionesVendidas: n,
    ventaBruta,
    comisionCasa,
    aporteAcumulado,
    premiosPagados,
    totalPagado,
    netoCasa,
    descuadre: netoCasa < 0,
    avisos,
  };
}

// ============================================================================
// Acumulado
// ============================================================================

export type EstadoAcumulado = {
  /** Lo que hay disponible para pagar. */
  disponible: number;
  /** Puntos que exige la meta vigente. */
  meta: number;
  /** Puntos del líder en esta Polla. */
  liderPuntos: number;
  /** Falta para que alguien lo cobre, o 0 si ya hay alguien en la meta. */
  faltantes: number;
  /** Ya alguien alcanzó la meta: el acumulado está para pagarse. */
  alcanzado: boolean;
};

/**
 * Estado del acumulado para mostrarlo ANTES de liquidar.
 *
 * Sale del ranking provisional: sirve para que la casa vea que al líder le falta
 * un punto y decida si sigue acumulando. Es una vista; no toca la base ni paga
 * nada.
 */
export function estadoAcumulado(
  ranking: FilaRanking[],
  config: ConfigPolla,
  disponible: number
): EstadoAcumulado {
  const meta = Math.max(0, Number(config.metaPuntos) || 0);
  const liderPuntos = ranking.reduce((a, f) => Math.max(a, f.puntos), 0);
  const alcanzado = meta > 0 && ranking.some((f) => f.puntos >= meta);
  return {
    disponible: round2(Math.max(0, Number(disponible) || 0)),
    meta,
    liderPuntos,
    faltantes: alcanzado ? 0 : Math.max(0, meta - liderPuntos),
    alcanzado,
  };
}

/** El acumulado que aporta UNA venta concreta, para mostrarlo antes de cobrar. */
export function aporteAcumulado(montoVenta: number, acumuladoPct: number): number {
  return round2((Math.max(0, Number(montoVenta) || 0) * Math.max(0, Number(acumuladoPct) || 0)) / 100);
}

/** Lo que el jugador paga por una cantidad de combinaciones. */
export function totalVenta(combinaciones: number, precioUnitario: number): number {
  return round2(Math.max(0, Number(combinaciones) || 0) * Math.max(0, Number(precioUnitario) || 0));
}

// ============================================================================
// Texto para pantalla y reportes
// ============================================================================

/** "1-2-3-4-5-6": la combinación en una línea, en el orden de las carreras. */
export function textoCombinacion(seleccion: Combinacion, carreras: CarreraPolla[]): string {
  const orden = new Map(carreras.map((c, i) => [c.clave, i]));
  return [...seleccion]
    .sort((a, b) => (orden.get(a.claveCarrera) ?? 0) - (orden.get(b.claveCarrera) ?? 0))
    .map((s) => normalizarNumero(s.numero))
    .join("-");
}

/** "LA RINCONADA 1ª, LA RINCONADA 3ª": las carreras de la Polla, en orden. */
export function textoCarreras(carreras: CarreraPolla[]): string {
  return carreras.map((c) => `${c.hipodromo} ${c.carrera}ª`).join(", ");
}

/** Etiqueta del premio, o el texto libre de la casa. */
export function etiquetaPremio(monto: number | null | undefined, extra?: string | null): string {
  const n = Number(monto);
  if (!Number.isFinite(n) || n <= 0) return "No paga";
  const base = n.toFixed(2).replace(/\.00$/, "");
  return extra ? `${base} (${extra})` : base;
}