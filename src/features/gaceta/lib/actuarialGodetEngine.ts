export type SuperficiePista =
  | "dirt_fast"
  | "dirt_normal"
  | "dirt_good"
  | "muddy"
  | "sloppy"
  | "turf_firm"
  | "turf_good"
  | "turf_yielding"
  | "turf_soft"
  | "off_turf_fango"
  | "arena"
  | "cesped"
  | "fango"
  | "tapeta";

export type MichelGodetFactors = {
  pista: SuperficiePista | "arena" | "cesped" | "fango" | "tapeta";
  clima: "seco" | "lluvioso" | "ventoso" | "nublado";
  cambioJockey: boolean;
  cambioEntrenador: boolean;
  reaparecida: boolean;
  customFactors: Array<{ id: string; nombre: string; peso: number }>;
};

export type EstiloCarrera = "E1" | "E2" | "E3"; // E1 Velocista/Puntero, E2 Perseguidor/Stalker, E3 Rematador/Closer

export type EjemplarGodet = {
  id: string;
  numero: number;
  nombre: string;
  stud?: string;
  pais?: string;
  yuntaId?: string;
  pesoOptimoGanadorKg?: number;
  pesoFisicoHoyKg?: number;
  diasDescanso?: number;
  kilosHandicap?: number;
  descargo?: number;
  alertasMedicas?: string[];
  historial400m?: number[];
  actuaciones?: number;
  varianzaTTC?: number;
  speedRatingTTC?: number;
  efectividadYunta?: number;
  tipoCarrera?: "velocista" | "perseguidor" | "rematador";
  estilo?: EstiloCarrera;
  earlyPace?: number;
  latePace?: number;
  beyer?: number;
  morningLine?: number | string;
  jockey?: string;
  entrenador?: string;
  trackeos?: any[];
  aptitudTurf?: number;
  aptitudDirt?: number;
  aptitudWet?: number;
  retirado?: boolean;
  pesoJinete?: number;
  pesoNeto?: number;
};

export type Parcial400m = {
  tramo: "400m" | "800m" | "1200m" | "1600m" | "200m";
  tiempoSeg: number;
  velocidadMS: number;
  energiaGasto: number;
  desaceleracion?: number;
};

export type ModoAnalisis = "previa" | "en_vivo";

export type PistaEnVivo = {
  sesgoRielInterno: number;
  sesgoRielExterno: number;
  sesgoVelocistas: number;
  sesgoRematadores: number;
  brisaRecta: number;
  varianteObservada: number;
  superficie?: SuperficiePista | string;
  estado?: string;
};

export type EscenarioTrenCarrera = {
  tipo: "todos" | "retiro_velocista" | "sin_velocistas" | "duelo_suicida";
  descripcion: string;
  impacto: Record<string, number>; // ajustes por id/numero
};

function clasificarEstiloPorParciales(e: EjemplarGodet): EstiloCarrera {
  const early = e.earlyPace ?? (e.historial400m && e.historial400m[0] ? 100 - e.historial400m[0] * 2 : 80);
  const late = e.latePace ?? 70;
  if (early >= 90) return "E1"; // Velocista/Puntero
  if (late >= 85 && early < 90) return "E3"; // Rematador/Closer
  return "E2"; // Perseguidor/Stalker
}

export function calcularMICMAC(ejemplares: EjemplarGodet[]) {
  const factores = [
    "forma",
    "ritmo",
    "cruce",
    "distancia",
    "pista",
    "jockey",
    "yunta",
    "pesos",
    "descanso",
    "táctica",
  ];
  const matriz = factores.map((f, i) =>
    factores.map((_, j) => {
      if (i === j) return 0;
      const base = Math.sin((i + 1) * (j + 1)) * 3;
      return Math.max(0, Math.round(base));
    })
  );
  return { factores, matriz, motivacion: ejemplares.length };
}

export function calcularMACTOR(ejemplares: EjemplarGodet[]) {
  const grupos = { E1: 0, E2: 0, E3: 0 };
  for (const e of ejemplares) {
    const estilo = e.estilo || clasificarEstiloPorParciales(e);
    if (estilo === "E1") grupos.E1++;
    else if (estilo === "E2") grupos.E2++;
    else grupos.E3++;
  }
  const total = Math.max(1, ejemplares.length);
  return {
    grupos,
    equilibrio: {
      E1: Math.round((grupos.E1 / total) * 100),
      E2: Math.round((grupos.E2 / total) * 100),
      E3: Math.round((grupos.E3 / total) * 100),
    },
  };
}

export function simularTrenCarrera(ejemplares: EjemplarGodet[], retirados: Set<string> = new Set()) {
  const activos = ejemplares.filter((e) => !e.retirado && !retirados.has(String(e.id)) && !retirados.has(String(e.numero)));
  // Clasificar con datos reales cuando existan
  const activosClasificados = activos.map((e) => ({ ...e, estilo: e.estilo || clasificarEstiloPorParciales(e) }));
  const mactor = calcularMACTOR(activosClasificados);
  const escenarios: EscenarioTrenCarrera[] = [];

  if (mactor.grupos.E1 >= 2) {
    escenarios.push({
      tipo: "duelo_suicida",
      descripcion: "Duelo Suicida / Tren Violento: 2 o más velocistas (E1) en disputa - penaliza punteros, favorece E2/E3 con buen remate",
      impacto: { penalizaE1: -0.08, bonificaE3: 0.08, bonificaE2: 0.04 },
    });
  } else if (mactor.grupos.E1 === 1) {
    escenarios.push({
      tipo: "todos",
      descripcion: "Un solo velocista E1 - puede intentar unir salida con llegada si parciales son cómodos",
      impacto: { bonificaE1solo: 0.04 },
    });
  } else if (mactor.grupos.E1 === 0) {
    escenarios.push({
      tipo: "sin_velocistas",
      descripcion: "Sin velocistas E1: los E2 toman la punta en parciales lentos - ritmo manejable favorece posicionamiento",
      impacto: { bonificaE2punta: 0.03 },
    });
  }

  // Simular retiro de un velocista clave
  const e1s = activosClasificados.filter((e) => e.estilo === "E1");
  if (e1s.length >= 2) {
    escenarios.push({
      tipo: "retiro_velocista",
      descripcion: "Si se retira un velocista clave, el otro E1 queda Solo en Punta (Lone Speed) con bono táctico +3.8 a +4.5 pts Godet",
      impacto: { loneSpeedBono: 4.3 },
    });
  }

  return { activos: activosClasificados, mactor, escenarios };
}

export function credibilidadBuhlmannStraub(e: EjemplarGodet) {
  const n = e.actuaciones || 0;
  const varianza = e.varianzaTTC || 0.15;
  const Z = n / (n + varianza * 10);
  const speedBase = e.speedRatingTTC || e.beyer || 70;
  const speedAjustado = speedBase * Z + 65 * (1 - Z);
  const efectividadAjustada = (e.efectividadYunta || 0.5) * Z + 0.4 * (1 - Z);
  return { Z: Number(Z.toFixed(3)), speedAjustado: Number(speedAjustado.toFixed(2)), efectividadAjustada: Number(efectividadAjustada.toFixed(3)) };
}

export function riesgoProporcionalCox(e: EjemplarGodet) {
  let hr = 1.0;
  const dias = e.diasDescanso || 21;
  if (dias < 14) hr *= 1.25;
  if (dias > 60) hr *= 0.9;
  const kilos = e.kilosHandicap || e.pesoNeto || e.pesoJinete || 54;
  if (kilos > 57) hr *= 1.12;
  const alertas = (e.alertasMedicas || []).length;
  hr *= 1 + alertas * 0.18;
  if (e.pesoFisicoHoyKg && e.pesoOptimoGanadorKg) {
    const diff = e.pesoFisicoHoyKg - e.pesoOptimoGanadorKg;
    if (diff > 2) hr *= 1.08;
    if (diff < -2) hr *= 0.95;
  }
  return { hazardRatio: Number(hr.toFixed(3)), riesgo: hr > 1.15 ? "alto" : hr > 1.05 ? "medio" : "bajo" };
}

export function valorEsperadoKelly(probModelo: number, dividendo: number) {
  const prob = Math.max(0, Math.min(1, probModelo));
  const odd = Math.max(1.01, dividendo || 1);
  const ev = prob * odd - 1;
  const b = odd - 1;
  const kelly = b > 0 ? (prob * b - (1 - prob)) / b : 0;
  const kellyFrac = Math.max(0, kelly / 2);
  return { ev: Number(ev.toFixed(4)), kelly: Number(kelly.toFixed(4)), kellyFraccional: Number(kellyFrac.toFixed(4)), overlay: ev > 0 };
}

export function parciales400m(e: EjemplarGodet): Parcial400m[] {
  const base = 24 + (e.numero % 3);
  const tramos = [
    { tramo: "400m" as const, factor: 1.0 },
    { tramo: "800m" as const, factor: 0.98 },
    { tramo: "1200m" as const, factor: 0.96 },
    { tramo: "1600m" as const, factor: 0.94 },
  ];
  const res: Parcial400m[] = [];
  for (const t of tramos) {
    const tiempoSeg = Number((base / t.factor + (e.numero % 5) * 0.12).toFixed(2));
    const velocidadMS = Number((400 / tiempoSeg).toFixed(3));
    const energiaGasto = Number((t.factor < 0.98 ? 0.62 : 0.48).toFixed(3));
    res.push({ tramo: t.tramo, tiempoSeg, velocidadMS, energiaGasto, desaceleracion: t.factor < 0.97 ? Number((0.02).toFixed(3)) : 0 });
  }
  return res;
}

export function simularRemateFinal(e: EjemplarGodet, pista: PistaEnVivo) {
  const cred = credibilidadBuhlmannStraub(e);
  const bonoPista = (pista.sesgoRematadores - pista.sesgoVelocistas) * 0.4;
  const deltaKg = e.pesoFisicoHoyKg && e.pesoOptimoGanadorKg ? e.pesoFisicoHoyKg - e.pesoOptimoGanadorKg : 0;
  // `deltaKg > 0` = lleva MÁS peso que su referencia → el último parcial se
  // hace más lento (suma tiempo). Antes el signo estaba invertido y el motor
  // premiaba al que cargaba de más, justo al revés que la pizarra y que el
  // sentido común del hándicap.
  const factorKg = deltaKg * (deltaKg > 0 ? 0.08 : 0.06);
  const ultima200 = Number((11.6 - bonoPista + factorKg - (cred.speedAjustado - 70) * 0.01).toFixed(2));
  return { ultima200Seg: Math.max(10.8, ultima200), cierre: factorKg <= 0 ? "positivo" : "estable", bonoPista: Number(bonoPista.toFixed(3)) };
}

function aplicarCondicionPista(probBase: number, e: EjemplarGodet, pista?: PistaEnVivo) {
  if (!pista) return probBase;
  const sup = String(pista.superficie || "").toLowerCase();
  // Penalizar caballos de grama si va a fango / off-turf
  if ((sup.includes("mud") || sup.includes("slop") || sup.includes("fango") || sup.includes("off")) && (e.aptitudTurf && e.aptitudTurf > 60 && (!e.aptitudWet || e.aptitudWet < 40))) {
    return probBase * 0.85;
  }
  // Bonificar si tiene aptitud fango/wet
  if ((sup.includes("mud") || sup.includes("slop") || sup.includes("fango") || sup.includes("wet")) && e.aptitudWet && e.aptitudWet > 70) {
    return probBase * 1.12;
  }
  // Bonificar turf si firme
  if (sup.includes("turf") && e.aptitudTurf && e.aptitudTurf > 70) {
    return probBase * 1.05;
  }
  return probBase;
}

function parseMorningLine(ml?: number | string): number {
  if (ml == null) return 0;
  if (typeof ml === "number") return ml;
  const s = String(ml).trim();
  // formatos tipo 3-1, 5/2
  if (s.includes("-")) {
    const [a, b] = s.split("-").map((x) => parseFloat(x));
    if (!isNaN(a) && !isNaN(b) && b > 0) return a / b + 1;
  }
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => parseFloat(x));
    if (!isNaN(a) && !isNaN(b) && b > 0) return a / b + 1;
  }
  const f = parseFloat(s);
  return isNaN(f) ? 0 : f;
}

export function generarProspectivaGodet(
  ejemplares: EjemplarGodet[],
  modo: ModoAnalisis = "previa",
  factores: MichelGodetFactors = { pista: "arena", clima: "seco", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] },
  pistaEnVivo?: PistaEnVivo,
  options: { retirados?: Set<string> } = {}
) {
  const retirados = options.retirados || new Set<string>();
  const activosBase = ejemplares.filter((e) => !e.retirado && !retirados.has(String(e.id)) && !retirados.has(String(e.numero)));
  const micmac = calcularMICMAC(ejemplares);
  const tren = simularTrenCarrera(ejemplares, retirados);
  const mactor = tren.mactor;
  const pista = pistaEnVivo || { sesgoRielInterno: 0, sesgoRielExterno: 0, sesgoVelocistas: 0, sesgoRematadores: 0, brisaRecta: 0, varianteObservada: 0 };

  const ordenados = [...activosBase]
    .map((e) => {
      const estilo = e.estilo || clasificarEstiloPorParciales(e);
      const cred = credibilidadBuhlmannStraub({ ...e, estilo });
      const cox = riesgoProporcionalCox(e);
      const parc = parciales400m(e);
      const remate = simularRemateFinal(e, pista);
      let base = (cred.speedAjustado * 0.65 + (100 - cox.hazardRatio * 75)) * (0.9 + (Number(e.actuaciones || 6) / 40));

      // Ajustes por tren de carrera
      if (mactor.grupos.E1 >= 2 && estilo === "E1") {
        base *= 0.9; // Duelan entre si
      } else if (mactor.grupos.E1 >= 2 && estilo === "E3") {
        base *= 1.12; // Favorece remate fuerte
      } else if (mactor.grupos.E1 >= 2 && estilo === "E2") {
        base *= 1.06;
      }
      if (mactor.grupos.E1 === 1 && estilo === "E1") {
        base *= 1.08; // Puntero solitario / lone speed
      }
      if (mactor.grupos.E1 === 0 && estilo === "E2") {
        base *= 1.05;
      } else if (mactor.grupos.E1 === 0 && estilo === "E3") {
        base *= 1.04;
      }

      // Trackeos / briseos destacados
      if (e.trackeos && e.trackeos.length > 0) {
        const reciente = e.trackeos[0];
        const txt = JSON.stringify(reciente).toLowerCase();
        if (/fenomeno|tronando|shn|bullet/.test(txt)) base *= 1.06;
        else if (/rem.*12|1\/\d+/.test(txt)) base *= 1.03;
        if (/600|800/.test(txt)) base *= 1.02;
      }

      // Descargo aprendiz
      if (e.descargo && e.descargo >= 3) {
        base *= 1.03;
      } else if (e.descargo && e.descargo >= 1) {
        base *= 1.01;
      }

      // Peso físico vs óptimo
      if (e.pesoFisicoHoyKg && e.pesoOptimoGanadorKg) {
        const diff = e.pesoFisicoHoyKg - e.pesoOptimoGanadorKg;
        if (diff < -1) base *= 1.02;
        if (diff > 2) base *= 0.97;
      }

      let prob = Math.max(4, Math.min(98, base / (Math.max(1, activosBase.length) * 0.75)));
      prob = aplicarCondicionPista(prob, e, pista);
      const ml = parseMorningLine(e.morningLine);
      const probImpl = ml > 0 ? (1 / ml) * 100 : 0;
      const overlay = probImpl > 0 && prob > probImpl * 1.08;

      return {
        ejemplar: { ...e, estilo },
        credibilidad: cred,
        riesgo: cox,
        parciales: parc,
        remate,
        prob: Number(prob.toFixed(2)),
        score: Number(base.toFixed(2)),
        estilo,
        ml,
        probImpl: Number(probImpl.toFixed(2)),
        overlay,
      };
    })
    .sort((a, b) => b.score - a.score);

  const total = ordenados.reduce((s, x) => s + x.prob, 0);
  const normalizados = ordenados.map((x, idx) => ({
    ...x,
    probNorm: Number(((x.prob / Math.max(1, total)) * 100).toFixed(2)),
    puestoProyectado: idx + 1,
    cuerposMeta: idx === 0 ? 0 : Number((idx * 0.25).toFixed(2)),
  }));

  const dictamen = [];
  if (mactor.grupos.E1 >= 2) {
    dictamen.push(`Planteamiento con todos: Duelo en punta entre ${mactor.grupos.E1} velocistas (E1). Favorece rematadores (E3) y perseguidores (E2) con buen cierre.`);
    dictamen.push("Impacto si se retira un velocista clave: el restante E1 quedaría Solo en Punta (Lone Speed) con bono táctico - revisar probabilidad al marcar retiro.");
  } else if (mactor.grupos.E1 === 1) {
    dictamen.push("Planteamiento con todos: 1 velocista E1 posible. Si controla parciales cómodos, puede unir salida con llegada.");
  } else if (mactor.grupos.E1 === 0) {
    dictamen.push("Planteamiento con todos: Sin E1 - ritmo lento esperado. Los E2 mejor ubicados toman la punta y dominan el desarrollo.");
  }
  if (pista?.superficie && String(pista.superficie).toLowerCase().includes("mud")) {
    dictamen.push("Alerta de pista: Cambio a Fango/Muddy - penaliza caballos netamente de grama sin figuraciones en barro; bonifica con aptitud Wet.");
  }
  if (pista?.superficie && String(pista.superficie).toLowerCase().includes("turf")) {
    dictamen.push("Pista de Grama (Turf) - ponderar récord en Turf y ratings Tomlinson.");
  }

  return {
    modo,
    micmac,
    mactor,
    factores,
    pistaEnVivo: pista,
    ordenLlegada: normalizados,
    sumaProb: Number(normalizados.reduce((s, x) => s + x.probNorm, 0).toFixed(2)),
    trenCarrera: tren,
    dictamen,
    activos: activosBase.length,
    retiradosCount: ejemplares.length - activosBase.length,
  };
}
