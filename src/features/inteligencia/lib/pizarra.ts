/**
 * PIZARRA PROSPECTIVA — MACTOR + SMIC + ACTUARIO.
 *
 * MÓDULO PURO (sin React, sin Supabase, sin reloj): la matemática de la
 * pizarra vive acá y se prueba en node (`pruebas/inteligencia-pizarra.test.ts`).
 *
 * QUÉ RESUELVE
 * ------------
 * El ranking actuarial (`proyecciones.ts`) dice quién tiene más probabilidad
 * con el historial frío. La pizarra agrega lo que cambia EN EL DÍA y que el
 * ranking no puede saber:
 *
 *   1. EL TREN DE CARRERA (MACTOR): cuántos velocistas (E1) activos pelean la
 *      punta. Tres o más se queman entre ellos y favorecen a los que vienen
 *      detrás (E2/E3); uno solo se escapa; ninguno deja el ritmo en manos de
 *      los perseguidores.
 *   2. EL PESO DECLARADO HOY: no es lo mismo cargar el peso de referencia que
 *      llevar 3 kg de más. El ajuste es simétrico al del motor Godet
 *      (`simularRemateFinal`) para que la pizarra y el remate cuenten la misma
 *      historia.
 *   3. LA PISTA Y EL SESGO observado: riel interno/externo, velocistas o
 *      rematadores. Es el "en vivo" del día.
 *   4. LOS RETIROS: no se "recalculan" acá — el llamador saca a los retirados
 *      del lote y este módulo reparte el 100% entre los activos. Lo que sí
 *      hace la pizarra es decir en el informe CUÁNTO cambió el tren por esos
 *      retiros.
 *   5. EL REMATE FINAL: reutiliza `simularRemateFinal` del motor Godet, así el
 *      carril de la recta final no es una animación: es el mismo modelo.
 *
 * El estilo (E1/E2/E3) NO viene en la base: no hay parciales oficiales por
 * ejemplar. Se INFIERE con una regla declarada y testeable (ver
 * `inferirEstilo`): velocidad relativa al lote, consistencia y distancia de
 * sus últimas actuaciones. Es un proxy, y la UI lo dice.
 */
import {
  parciales400m,
  simularRemateFinal,
  type EjemplarGodet,
  type PistaEnVivo,
  type Parcial400m,
} from "@/features/gaceta/lib/actuarialGodetEngine";
import {
  PRIOR_MEDIA,
  credibilidadStraub,
  escalaSpeed,
  riesgoCox,
} from "@/features/inteligencia/lib/proyecciones";

/** Estilo de carrera: E1 velocista, E2 perseguidor, E3 rematador. */
export type EstiloCarrera = "E1" | "E2" | "E3";

/** Estado del terreno declarado para la jornada. */
export type FactorPista = "normal" | "ligera" | "pesada";

/** Comportamiento observado de la pista (sesgo en vivo). */
export type SesgoPista = "off" | "riel_interno" | "riel_externo" | "velocistas" | "rematadores";

/** Todo lo que la pizarra necesita de UN ejemplar. */
export type InsumoPizarra = {
  numero: number;
  nombre: string;
  nacionalidad?: string;
  /** Último speed rating/Beyer conocido (0 = sin dato). */
  speedRating: number;
  /** Índice de Consistencia Godet (0-100). */
  consistencia: number;
  actuaciones: number;
  placements?: number;
  /** % de aciertos (0-100). */
  winRate: number;
  /** Días desde la última actuación (0 = sin dato). */
  diasDescanso: number;
  /** Efectividad de la yunta (0-1). */
  efectividadYunta: number;
  /** Peso declarado para hoy (kg). `null` = el programa no lo trae. */
  pesoHoyKg: number | null;
  jockey?: string;
  entrenador?: string;
  /** Distancias de sus últimas actuaciones (m), de la más reciente a la más vieja. */
  distancias?: number[];
  /** Retirado según la lista central de la carrera. */
  retirado?: boolean;
};

/** Controles de la pizarra. */
export type AjustesPizarra = {
  factorPista: FactorPista;
  sesgo: SesgoPista;
  /** Parcial de 400 m de referencia (s). 22.2 = normal. */
  parcial400: number;
};

export const AJUSTES_POR_DEFECTO: AjustesPizarra = {
  factorPista: "normal",
  sesgo: "off",
  parcial400: 22.2,
};

export type TrenMactor = {
  codigo: "violento" | "solitario" | "falso" | "equilibrado";
  titulo: string;
  detalle: string;
  /** Números de los E1 ACTIVOS que pelean la punta. */
  velocistas: number[];
  /** Número del único E1 activo (tren solitario), o `null`. */
  puntero: number | null;
};

export type FilaPizarra = {
  numero: number;
  nombre: string;
  nacionalidad: string;
  estilo: EstiloCarrera;
  jockey: string;
  entrenador: string;
  speedRating: number;
  consistencia: number;
  actuaciones: number;
  winRate: number;
  diasDescanso: number;
  /** Peso declarado hoy, si el programa lo trae. */
  pesoHoyKg: number | null;
  /** Peso de referencia del lote (mediana de los declarados). */
  pesoReferenciaKg: number;
  /** Peso de hoy menos la referencia. */
  deltaPesoKg: number | null;
  /** Ajuste por peso (positivo = ventaja). */
  ajustePeso: number;
  /** Ajuste por terreno + sesgo. */
  ajustePista: number;
  /** Ajuste por el tren de carrera (MACTOR). */
  ajusteTren: number;
  /** Score actuarial puro (el mismo del ranking). */
  scoreBase: number;
  /** Score con los ajustes del día. */
  score: number;
  /** Probabilidad SMIC normalizada (suma 100 entre los activos). */
  probabilidad: number;
  puesto: number;
  /** Diferencia acumulada con el puntero, en cuerpos. */
  cuerpos: number;
  /** Última recta de 200 m simulada por el motor Godet (s). */
  remate200Seg: number;
  /** Etiqueta legible del ajuste de peso (`null` = sin peso declarado). */
  notaPeso: string | null;
};

export type CarrilRecta = {
  numero: number;
  nombre: string;
  puesto: number;
  probabilidad: number;
  /** Cuerpos detrás del puntero al cruzar la meta. */
  cuerpos: number;
  /** Distancia al disco, en % desde la derecha (0 = puntero). */
  posicionPct: number;
};

export type TicketsPizarra = {
  ganador: FilaPizarra | null;
  exacta: string;
  trifecta: string;
};

export type Pizarra = {
  activos: FilaPizarra[];
  retirados: InsumoPizarra[];
  tren: TrenMactor;
  pesoReferenciaKg: number;
  totalActivos: number;
  totalRetirados: number;
  tickets: TicketsPizarra;
  informe: string[];
};

// ---------------------------------------------------------------------------
// Utilidades numéricas
// ---------------------------------------------------------------------------

function promedio(valores: number[]): number {
  const v = valores.filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Mediana de los valores > 0. `0` si no hay ninguno. */
export function mediana(valores: number[]): number {
  const v = valores.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const medio = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[medio] : (v[medio - 1] + v[medio]) / 2;
}

const numero = (n: unknown): number => {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
};

// ---------------------------------------------------------------------------
// Estilo y tren de carrera
// ---------------------------------------------------------------------------

/**
 * Infiere el estilo de carrera de un ejemplar.
 *
 * NO hay parciales oficiales por caballo en la base, así que el estilo es un
 * PROXY declarado. Se suman tres señales:
 *
 *   - VELOCIDAD relativa: un caballo 4+ puntos por encima de la mediana del
 *     lote tiende a imponer el ritmo (E1); 4+ por debajo, a rematar (E3).
 *   - CONSISTENCIA: un caballo constante llega (E2/E3); uno intermitente con
 *     mucha velocidad suele irse adelante y pagar el esfuerzo (E1).
 *   - DISTANCIA: si hoy corre más largo que sus últimas actuaciones, el
 *     cambio de exigencia lo empuja al frente (E1); si acorta, llega (E3).
 *
 * Con `puntos >= 2` es E1, con `<= -2` es E3, y en el medio E2. Es la misma
 * clasificación E1/E2/E3 que usa MACTOR, para que el tren y la pizarra no
 * hablen idiomas distintos.
 */
export function inferirEstilo(
  insumo: Pick<InsumoPizarra, "speedRating" | "consistencia" | "distancias">,
  distanciaCarrera: number,
  velocidadReferencia: number
): EstiloCarrera {
  const speed = numero(insumo.speedRating);
  const consistencia = numero(insumo.consistencia);
  const ref = numero(velocidadReferencia) || 70;

  let puntos = 0;
  if (speed >= ref + 4) puntos += 2;
  else if (speed > 0 && speed <= ref - 4) puntos -= 2;

  if (consistencia >= 55) puntos -= 1;
  else if (consistencia > 0 && consistencia < 30) puntos += 1;

  const distancias = (insumo.distancias ?? []).filter((d) => numero(d) > 0);
  const carrera = numero(distanciaCarrera);
  if (distanciaCarrera > 0 && distancias.length) {
    const media = promedio(distancias.slice(0, 5));
    if (media > 0) {
      const ratio = carrera / media;
      if (ratio >= 1.25) puntos += 2;
      else if (ratio <= 0.8) puntos -= 2;
    }
  }

  if (puntos >= 2) return "E1";
  if (puntos <= -2) return "E3";
  return "E2";
}

/**
 * Estado del tren de carrera con los E1 que quedan ACTIVOS.
 *
 * `parcial400` es el termómetro real de la pista: 21.8 s o menos es una
 * carrera rapidísima, y ahí el tren es violento aunque haya pocos E1. El orden
 * de las reglas importa: primero el reloj, después el conteo.
 */
export function estadoTrenMactor(
  estilos: Array<{ numero: number; estilo: EstiloCarrera }>,
  parcial400: number
): TrenMactor {
  const velocistas = estilos.filter((e) => e.estilo === "E1").map((e) => e.numero);

  if (parcial400 > 0 && parcial400 <= 21.8) {
    return {
      codigo: "violento",
      titulo: "🔥 Tren violento",
      detalle: `Parcial de 400 m en ${parcial400.toFixed(1)} s: la punta se paga caro y los que vienen de atrás (E2/E3) cobran.`,
      velocistas,
      puntero: null,
    };
  }

  if (velocistas.length >= 3) {
    return {
      codigo: "violento",
      titulo: "🔥 Tren violento",
      detalle: `${velocistas.length} velocistas E1 activos pelean la punta: se gastan entre ellos y favorecen a E2/E3.`,
      velocistas,
      puntero: null,
    };
  }

  if (velocistas.length === 1) {
    return {
      codigo: "solitario",
      titulo: "🚀 Puntero solitario",
      detalle: `Solo el #${velocistas[0]} toma la punta sin pelea: bono de +3.8 al estilo E1.`,
      velocistas,
      puntero: velocistas[0],
    };
  }

  if (velocistas.length === 0) {
    return {
      codigo: "falso",
      titulo: "🐢 Tren falso",
      detalle: "Sin velocistas E1 activos: los perseguidores E2 toman la iniciativa y el ritmo se vuelve táctico.",
      velocistas,
      puntero: null,
    };
  }

  return {
    codigo: "equilibrado",
    titulo: "⚖️ Tren equilibrado",
    detalle: `${velocistas.length} velocistas E1 activos: hay pelea pero no se anulan.`,
    velocistas,
    puntero: null,
  };
}

// ---------------------------------------------------------------------------
// Ajustes del día
// ---------------------------------------------------------------------------

/** Ajuste por terreno declarado + sesgo observado. */
export function ajusteDePista(
  estilo: EstiloCarrera,
  numeroGualdrapa: number,
  ajustes: AjustesPizarra
): number {
  let delta = 0;

  if (ajustes.factorPista === "ligera") {
    if (estilo === "E1") delta += 2.0;
    if (estilo === "E3") delta -= 0.4;
  } else if (ajustes.factorPista === "pesada") {
    if (estilo === "E3") delta += 2.4;
    if (estilo === "E1") delta -= 0.8;
  }

  switch (ajustes.sesgo) {
    case "riel_interno":
      if (numeroGualdrapa >= 1 && numeroGualdrapa <= 3) delta += 2.2;
      break;
    case "riel_externo":
      if (numeroGualdrapa >= 5) delta += 2.2;
      break;
    case "velocistas":
      if (estilo === "E1") delta += 2.5;
      break;
    case "rematadores":
      if (estilo === "E2" || estilo === "E3") delta += 2.5;
      break;
    default:
      break;
  }

  return Number(delta.toFixed(2));
}

/**
 * Ajuste por peso declarado frente al peso de referencia del lote.
 *
 * Cargar el peso de referencia (o casi) es una ventaja: el caballo corre en
 * su punto. Una descarga de 2+ kg suma; una sobrecarga de 2+ kg resta, y a
 * partir de 5 kg la penalización se acota en −4.5 para que un dato raro del
 * programa no borre al ejemplar del mapa.
 */
export function ajusteDePeso(
  pesoHoyKg: number | null | undefined,
  referenciaKg: number
): { delta: number | null; ajuste: number; nota: string | null } {
  const peso = Number(pesoHoyKg);
  const ref = Number(referenciaKg);
  if (!Number.isFinite(peso) || peso <= 0 || !Number.isFinite(ref) || ref <= 0) {
    return { delta: null, ajuste: 0, nota: null };
  }

  const delta = Number((peso - ref).toFixed(1));
  const abs = Math.abs(delta);

  if (abs <= 0.5) {
    return { delta, ajuste: 1.9, nota: `Peso de referencia (${peso} kg) +1.9` };
  }
  if (delta < 0) {
    const ajuste = abs >= 2 ? 2.4 : 1.9;
    return { delta, ajuste, nota: `Descarga ${abs.toFixed(1)} kg (+${ajuste.toFixed(1)})` };
  }

  const ajuste = abs < 2 ? -0.8 : -Math.min(4.5, (abs - 1.5) * 0.55);
  return {
    delta,
    ajuste: Number(ajuste.toFixed(2)),
    nota: `Sobrecarga ${abs.toFixed(1)} kg (${ajuste.toFixed(1)})`,
  };
}

/** Ajuste por el tren de carrera. */
export function ajusteDeTren(estilo: EstiloCarrera, numeroGualdrapa: number, tren: TrenMactor): number {
  switch (tren.codigo) {
    case "violento":
      if (estilo === "E2" || estilo === "E3") return 3.2;
      if (estilo === "E1") return -1.2;
      return 0;
    case "solitario":
      return tren.puntero === numeroGualdrapa ? 3.8 : 0;
    case "falso":
      if (estilo === "E2") return 1.8;
      if (estilo === "E3") return 0.6;
      return 0;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Pizarra
// ---------------------------------------------------------------------------

/** Traduce el sesgo de la pizarra al tipo del motor Godet. */
export function pistaEnVivo(ajustes: AjustesPizarra): PistaEnVivo {
  return {
    sesgoRielInterno: ajustes.sesgo === "riel_interno" ? 1 : 0,
    sesgoRielExterno: ajustes.sesgo === "riel_externo" ? 1 : 0,
    sesgoVelocistas: ajustes.sesgo === "velocistas" ? 1 : 0,
    sesgoRematadores: ajustes.sesgo === "rematadores" ? 1 : 0,
    brisaRecta: 0,
    varianteObservada: 0,
  };
}

/**
 * Construye la pizarra completa.
 *
 * `insumos` debe traer TODOS los ejemplares (activos y retirados): así el
 * informe puede decir a quién se retiró y la UI pintarlos al pie. La
 * probabilidad se normaliza SOLO entre los activos, de modo que la suma sigue
 * siendo 100% después de cada retiro (la redistribución SMIC).
 */
export function construirPizarra(
  insumos: InsumoPizarra[],
  ajustes: AjustesPizarra = AJUSTES_POR_DEFECTO,
  distanciaCarrera = 1200
): Pizarra {
  const lista = (insumos ?? []).filter((i) => i && i.numero > 0);
  const activosBrutos = lista.filter((i) => !i.retirado);
  const retirados = lista.filter((i) => i.retirado);

  const pesoReferenciaKg = mediana(activosBrutos.map((i) => numero(i.pesoHoyKg))) || 54;
  const velocidadReferencia = mediana(activosBrutos.map((i) => numero(i.speedRating))) || 70;

  const estilos = activosBrutos.map((i) => ({
    numero: i.numero,
    estilo: inferirEstilo(i, distanciaCarrera, velocidadReferencia),
  }));
  const tren = estadoTrenMactor(estilos, ajustes.parcial400);
  const estiloPorNumero = new Map(estilos.map((e) => [e.numero, e.estilo] as const));

  const pista = pistaEnVivo(ajustes);

  const filas: FilaPizarra[] = activosBrutos.map((i) => {
    const estilo = estiloPorNumero.get(i.numero) ?? "E2";

    // Score actuario: la MISMA fórmula de `calcularRankingActuarial`.
    const z = credibilidadStraub(numero(i.actuaciones));
    const speedAjustado = z * escalaSpeed(numero(i.speedRating)) + (1 - z) * PRIOR_MEDIA;
    const hazard = riesgoCox(numero(i.diasDescanso), 0);
    const experiencia = Math.min(100, numero(i.actuaciones) * 10);
    const scoreBase =
      (0.42 * speedAjustado + 0.33 * numero(i.consistencia) + 0.15 * numero(i.winRate) + 0.1 * experiencia) /
      Math.max(0.5, hazard);

    const peso = ajusteDePeso(i.pesoHoyKg, pesoReferenciaKg);
    const pesoHoyKg = Number.isFinite(Number(i.pesoHoyKg)) && Number(i.pesoHoyKg) > 0 ? Number(i.pesoHoyKg) : null;

    const ajustePista = ajusteDePista(estilo, i.numero, ajustes);
    const ajusteTren = ajusteDeTren(estilo, i.numero, tren);

    // El motor Godet usa `pesoOptimoGanadorKg` como referencia: le pasamos el
    // peso de referencia del lote para que el remate y la pizarra midan el
    // mismo desvío.
    const godet: EjemplarGodet = {
      id: `${i.numero}-${i.nombre}`,
      numero: i.numero,
      nombre: i.nombre,
      pesoOptimoGanadorKg: pesoReferenciaKg,
      pesoFisicoHoyKg: pesoHoyKg ?? undefined,
      tipoCarrera: estilo === "E1" ? "velocista" : estilo === "E3" ? "rematador" : "perseguidor",
      actuaciones: numero(i.actuaciones),
      speedRatingTTC: numero(i.speedRating) || undefined,
      efectividadYunta: numero(i.efectividadYunta),
      diasDescanso: numero(i.diasDescanso),
    };
    const remate = simularRemateFinal(godet, pista);

    const score = Number((scoreBase + ajustePista + ajusteTren + peso.ajuste).toFixed(3));

    return {
      numero: i.numero,
      nombre: i.nombre,
      nacionalidad: i.nacionalidad ?? "VE",
      estilo,
      jockey: i.jockey ?? "",
      entrenador: i.entrenador ?? "",
      speedRating: numero(i.speedRating),
      consistencia: numero(i.consistencia),
      actuaciones: numero(i.actuaciones),
      winRate: numero(i.winRate),
      diasDescanso: numero(i.diasDescanso),
      pesoHoyKg,
      pesoReferenciaKg,
      deltaPesoKg: peso.delta,
      ajustePeso: peso.ajuste,
      ajustePista,
      ajusteTren,
      scoreBase: Number(scoreBase.toFixed(3)),
      score,
      probabilidad: 0,
      puesto: 0,
      cuerpos: 0,
      remate200Seg: remate.ultima200Seg,
      notaPeso: peso.nota,
    };
  });

  // Orden por score con desempate por número (estable para la UI).
  const ordenadas = [...filas].sort((a, b) => b.score - a.score || a.numero - b.numero);

  // SMIC: softmax sobre el score. Equivale a repartir el 100% con más peso a
  // los primeros sin que un solo punto de diferencia deje a alguien en 0%.
  const maxScore = ordenadas.length ? ordenadas[0].score : 0;
  const expuestos = ordenadas.map((f) => Math.exp((f.score - maxScore) * 0.35));
  const totalExp = expuestos.reduce((a, b) => a + b, 0) || 1;

  let acumulado = 0;
  const conPuesto = ordenadas.map((f, i) => {
    if (i > 0) acumulado += Math.max(0.25, (ordenadas[i - 1].score - f.score) * 0.72);
    return {
      ...f,
      puesto: i + 1,
      probabilidad: Number(((expuestos[i] / totalExp) * 100).toFixed(2)),
      cuerpos: Number(acumulado.toFixed(2)),
    };
  });

  const tickets = ticketsRecomendados(conPuesto);

  return {
    activos: conPuesto,
    retirados,
    tren,
    pesoReferenciaKg,
    totalActivos: conPuesto.length,
    totalRetirados: retirados.length,
    tickets,
    informe: informeTactico({ filas: conPuesto, tren, retirados, ajustes }),
  };
}

/** Tickets sugeridos a partir del ranking de la pizarra. */
export function ticketsRecomendados(filas: FilaPizarra[]): TicketsPizarra {
  const [a, b, c] = filas;
  return {
    ganador: a ?? null,
    exacta: a && b ? `${a.numero} - ${b.numero}` : a ? `${a.numero}` : "—",
    trifecta: a && b ? `${a.numero} / ${b.numero}${c ? ` / ${c.numero}` : ""}` : "—",
  };
}

/**
 * Simulación de la recta final.
 *
 * La brecha de cada ejemplar sale del score acumulado (como en la pizarra),
 * pero se descuenta por su remate de 200 m: un caballo que cierra más rápido
 * que el puntero recorta hasta ~0.9 cuerpos. Lo que se dibuja es el MODELO,
 * no una animación decorativa.
 */
export function rectaFinal(filas: FilaPizarra[], maxCarriles = 6): CarrilRecta[] {
  const top = filas.slice(0, Math.max(0, maxCarriles));
  if (!top.length) return [];
  const rematePuntero = top[0].remate200Seg;

  let acumulado = 0;
  return top.map((f, i) => {
    if (i > 0) {
      const brecha = Math.max(0.2, (top[i - 1].score - f.score) * 0.72);
      const cierre = (rematePuntero - f.remate200Seg) * 0.9;
      acumulado += Math.max(0.15, brecha - cierre);
    }
    return {
      numero: f.numero,
      nombre: f.nombre,
      puesto: f.puesto,
      probabilidad: f.probabilidad,
      cuerpos: Number(acumulado.toFixed(2)),
      // `right: 0%` = pegado al disco; cuanto más atrás, más se corre a la izquierda.
      posicionPct: Math.min(76, Math.round(acumulado * 6.5)),
    };
  });
}

/** Parciales de 400 m del motor Godet, para mostrar la lectura de ritmo. */
export function parcialesDeCarrera(insumo: InsumoPizarra, estilo: EstiloCarrera): Parcial400m[] {
  // `parciales400m` solo usa el número de gualdrapa y el estilo no influye en
  // su fórmula; se pasa un `EjemplarGodet` mínimo para no duplicar la curva.
  const e: EjemplarGodet = {
    id: `${insumo.numero}-${insumo.nombre}`,
    numero: insumo.numero,
    nombre: insumo.nombre,
    tipoCarrera: estilo === "E1" ? "velocista" : estilo === "E3" ? "rematador" : "perseguidor",
  };
  return parciales400m(e);
}

/** Relato táctico: qué cambió y por qué. */
export function informeTactico(opts: {
  filas: FilaPizarra[];
  tren: TrenMactor;
  retirados: InsumoPizarra[];
  ajustes: AjustesPizarra;
}): string[] {
  const { filas, tren, retirados, ajustes } = opts;
  const lineas: string[] = [];

  if (retirados.length) {
    const nombres = retirados.map((r) => `#${r.numero} ${r.nombre}`).join(", ");
    lineas.push(
      `⚠️ Retiros activos: ${nombres}. La probabilidad se redistribuyó al 100% entre ${filas.length} ejemplar(es) activo(s).`
    );
  } else {
    lineas.push("✓ Todos los ejemplares inscritos están activos: la pizarra corre sobre el lote completo.");
  }

  lineas.push(`${tren.titulo}: ${tren.detalle}`);

  const [a, b, c] = filas;
  if (a) {
    lineas.push(
      `🎯 Proyección tope: #${a.numero} ${a.nombre} (${a.probabilidad.toFixed(1)}%)` +
        (b ? `, escoltado por #${b.numero} ${b.nombre} (${b.probabilidad.toFixed(1)}%)` : "") +
        (c ? ` y #${c.numero} ${c.nombre} (${c.probabilidad.toFixed(1)}%)` : "") +
        "."
    );
  }

  if (ajustes.factorPista !== "normal") {
    lineas.push(
      ajustes.factorPista === "ligera"
        ? "🏁 Pista ligera/rápida: los velocistas E1 cobran +2.0 y los rematadores pierden algo de terreno."
        : "🏁 Pista pesada: los rematadores E3 cobran +2.4 y los velocistas E1 pagan el esfuerzo."
    );
  }

  if (ajustes.sesgo !== "off") {
    const etiquetas: Record<Exclude<SesgoPista, "off">, string> = {
      riel_interno: "ganan por el riel interno (PP 1-3)",
      riel_externo: "el riel interno está pesado y ganan del 5 en adelante",
      velocistas: "la pista favorece a los velocistas",
      rematadores: "los punteros colapsan y ganan los rematadores",
    };
    lineas.push(`📡 Sesgo observado: ${etiquetas[ajustes.sesgo]}.`);
  }

  const conPeso = filas.filter((f) => f.notaPeso);
  if (conPeso.length) {
    lineas.push(
      `⚖️ Pesos declarados: referencia del lote ${filas[0]?.pesoReferenciaKg ?? 54} kg · ` +
        conPeso.map((f) => `#${f.numero} ${f.notaPeso}`).join(" · ")
    );
  } else {
    lineas.push("⚖️ El programa no trae pesos declarados: el ajuste por peso queda neutralizado.");
  }

  return lineas;
}
