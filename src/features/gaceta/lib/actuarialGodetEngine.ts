export type MichelGodetFactors = {
  pista: "arena" | "cesped" | "fango" | "tapeta";
  clima: "seco" | "lluvioso" | "ventoso" | "nublado";
  cambioJockey: boolean;
  cambioEntrenador: boolean;
  reaparecida: boolean;
  customFactors: Array<{ id: string; nombre: string; peso: number }>;
};

export type EjemplarGodet = {
  id: string;
  numero: number;
  nombre: string;
  stud?: string;
  yuntaId?: string;
  pesoOptimoGanadorKg?: number;
  pesoFisicoHoyKg?: number;
  diasDescanso?: number;
  kilosHandicap?: number;
  alertasMedicas?: string[];
  historial400m?: number[];
  actuaciones?: number;
  varianzaTTC?: number;
  speedRatingTTC?: number;
  efectividadYunta?: number;
  tipoCarrera?: "velocista" | "perseguidor" | "rematador";
  paceEarly?: number;
  paceLate?: number;
  retirado?: boolean;
};

export type Parcial400m = {
  tramo: "400m" | "800m" | "1200m" | "1600m";
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
};

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
    if (e.tipoCarrera === "velocista") grupos.E1++;
    else if (e.tipoCarrera === "perseguidor") grupos.E2++;
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

export function credibilidadBuhlmannStraub(e: EjemplarGodet) {
  const n = e.actuaciones || 0;
  const varianza = e.varianzaTTC || 0.15;
  const Z = n / (n + varianza * 10);
  const speedAjustado = (e.speedRatingTTC || 70) * Z + 65 * (1 - Z);
  const efectividadAjustada = (e.efectividadYunta || 0.5) * Z + 0.4 * (1 - Z);
  return { Z: Number(Z.toFixed(3)), speedAjustado: Number(speedAjustado.toFixed(2)), efectividadAjustada: Number(efectividadAjustada.toFixed(3)) };
}

export function riesgoProporcionalCox(e: EjemplarGodet) {
  let hr = 1.0;
  const dias = e.diasDescanso || 21;
  if (dias < 14) hr *= 1.25;
  if (dias > 60) hr *= 0.9;
  const kilos = e.kilosHandicap || 54;
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

/** Convierte momios fraccionales M/L (3-1) a probabilidad implícita sin vig. */
export function probabilidadImplicitaMorningLine(morningLine: string | number | null | undefined): number | null {
  const texto = String(morningLine ?? "").trim();
  if (!texto) return null;
  const fraccional = /^(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)$/.exec(texto);
  if (fraccional) {
    const numerador = Number(fraccional[1]);
    const denominador = Number(fraccional[2]);
    if (denominador <= 0) return null;
    return Number((denominador / (numerador + denominador)).toFixed(4));
  }
  const decimal = Number(texto);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return Number((1 / decimal).toFixed(4));
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

export function generarProspectivaGodet(ejemplares: EjemplarGodet[], modo: ModoAnalisis, factores: MichelGodetFactors, pistaEnVivo?: PistaEnVivo) {
  const micmac = calcularMICMAC(ejemplares);
  const mactor = calcularMACTOR(ejemplares);
  const pista = pistaEnVivo || { sesgoRielInterno: 0, sesgoRielExterno: 0, sesgoVelocistas: 0, sesgoRematadores: 0, brisaRecta: 0, varianteObservada: 0 };
  const ordenados = [...ejemplares]
    .map((e) => {
      const cred = credibilidadBuhlmannStraub(e);
      const cox = riesgoProporcionalCox(e);
      const parc = parciales400m(e);
      const remate = simularRemateFinal(e, pista);
      const base = cred.speedAjustado * 0.6 + (100 - cox.hazardRatio * 80);
      const prob = Math.max(5, Math.min(95, base / (ejemplares.length * 0.8)));
      return { ejemplar: e, credibilidad: cred, riesgo: cox, parciales: parc, remate, prob: Number(prob.toFixed(2)), score: Number(base.toFixed(2)) };
    })
    .sort((a, b) => b.score - a.score);
  const total = ordenados.reduce((s, x) => s + x.prob, 0);
  const normalizados = ordenados.map((x, idx) => ({
    ...x,
    probNorm: Number(((x.prob / Math.max(1, total)) * 100).toFixed(2)),
    puestoProyectado: idx + 1,
    cuerposMeta: idx === 0 ? 0 : Number((idx * 0.25).toFixed(2)),
  }));
  return {
    modo,
    micmac,
    mactor,
    factores,
    pistaEnVivo: pista,
    ordenLlegada: normalizados,
    sumaProb: Number(normalizados.reduce((s, x) => s + x.probNorm, 0).toFixed(2)),
  };
}
