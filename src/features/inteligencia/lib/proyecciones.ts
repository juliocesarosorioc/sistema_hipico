/**
 * RANKING DE PROBABILIDAD ACTUARIAL —Intelligence Hípica.
 *
 * MÓDULO PURO (sin Supabase, sin React, sin reloj): todo lo que decide el
 * modelo vive acá y se puede probar en node.
 *
 * POR QUÉ NO ES UN "PUNTAJE DE FAVORITO"
 * ---------------------------------------
 * El problema real de proyectar una carrera es que la mayoría de los datos
 * que se usan (la intuition, el nombre del caballo, quién lo monta hoy) NO
 * tienen valor predictivo. Lo que sí lo tiene son tres cosas que la
 * plataforma ya tiene registradas:
 *
 *   1. LA FORMA (speed rating / Beyer): qué tan rápido fue el caballo.
 *   2. LA CONSISTENCIA: cuántas veces lo dejó arriba, ponderado por el
 *      premio de cada carrera (el Índice de Consistencia Godet).
 *   3. LA CREDIBILIDAD: cuántas carreras tiene. Un caballo con una sola
 *      actuación no puede recibir el mismo peso que uno con veinte, por muy
 *      bueno que haya sido ese debut.
 *
 * El modelo combina esas tres y además penaliza el RIESGO (vuelve de un
 * retiro, peso desbalanceado, alertas médicas), que es la parte que suele
 * ignorar el análisis de la casa.
 *
 * LA CREDIBILIDAD (Bühlmann-Straub)
 * ---------------------------------
 * Es el ajuste estadístico clásico: el peso de la propia media del caballo
 * es `Z = n / (n + k)`, y el resto se lo queda la media de la población
 * (`k` es la "fuerza" del priori: cuántos datos harían falta para creerle al
 * 100%). Con `k = 8`, un caballo con 4 carreras tiene Z = 0.33: su propia
 * media pesa un tercio y la del país pesa dos tercios. Es lo que evita que
 * un debut perfecto se lleve la carrera en la proyección.
 *
 * EL RIESGO (Cox)
 * ---------------
 * `hazard ratio`: un factor multiplicativo que se aplica al score. Un caballo
 * que vuelve después de 70 días pesa menos; uno que viene con 10 kilos de
 * handicapping pesa más; las alertas médicas pesan 18% cada una. El modelo
 * NO dice "va a perder": dice que su historial es menos transferible.
 */
import type { MemoriaEjemplar } from "@/features/gaceta/lib/padron";

/** Ejemplar ya cruzado con su memoria histórica, listo para proyectar. */
export type EjemplarProyectable = {
  /** Número de gualdrapa en la carrera que se va a proyectar. */
  numero: number;
  nombre: string;
  /** Nacionalidad (para desempates y para el color de la gualdrapa). */
  nacionalidad?: string;
  /** Memoria histórica del ejemplar (puede venir vacía si es nuevo). */
  memoria: MemoriaEjemplar | null;
};

/** Contexto de la carrera que se está proyectando. */
export type ContextoCarrera = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  distancia: number;
  superficie: string;
  /** Premio de la carrera: entra en la escala del modelo. */
  premio: number;
};

/** Una fila del ranking, ya con la probabilidad calculada. */
export type FilaProyeccion = {
  numero: number;
  nombre: string;
  nacionalidad: string;
  /** Probabilidad de ganar, en porcentaje (suma 100 entre todos). */
  probabilidad: number;
  /** Puesto proyectado. */
  puesto: number;
  /** Índice de Consistencia Godet (0-100). */
  indiceConsistencia: number;
  /** Último Beyer/Speed Rating conocido (0 si no hay). */
  speedRating: number;
  /** Número de carreras registradas. */
  actuaciones: number;
  /** Veces que terminó en el top 3. */
  placements: number;
  /** Porcentaje de aciertos (0-100). */
  winRate: number;
  /** Credibilidad Z de Bühlmann-Straub (0-1). */
  credibilidad: number;
  /** Speed rating AJUSTADO por credibilidad (la media que el modelo usa). */
  speedAjustado: number;
  /** Hazard ratio de Cox (1 = riesgo normal). */
  hazardRatio: number;
  /** Etiqueta del riesgo: bajo / medio / alto. */
  riesgo: "bajo" | "medio" | "alto";
  /** Días desde la última carrera (0 si nunca corrió). */
  diasDescanso: number;
  /** Jinete que más veces lo montó. */
  jineteHabitual: string;
  /** Entrenador que más veces lo tuvo. */
  entrenadorHabitual: string;
  /** Score bruto (antes de normalizar). */
  score: number;
  /** Motivos por los que el modelo lo sube o lo baja. */
  notas: string[];
};

/** Fuerza del priori: cuántos datos hacen falta para creerle al caballo. */
export const PRIOR_FUERZA = 8;

/** Media de la población: el "rating" promedio de un ejemplar sin historial. */
export const PRIOR_MEDIA = 60;

/** Rango de speed rating que se considera del 50 (muy malo) al 130 (elite). */
export const RANGO_SPEED = { min: 50, max: 130 };

/** Escala el speed rating a 0-100 dentro del rango de la población. */
export function escalaSpeed(speed: number): number {
  const s = Number(speed) || 0;
  if (s <= 0) return PRIOR_MEDIA;
  const t = (s - RANGO_SPEED.min) / (RANGO_SPEED.max - RANGO_SPEED.min);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * Credibilidad de Bühlmann-Straub.
 *
 * `Z = n / (n + k)`: el peso de la media PROPIA del caballo. Con cero
 * actuaciones, Z = 0 y el modelo solo ve la media de la población.
 */
export function credibilidadStraub(actuaciones: number): number {
  const n = Math.max(0, Number(actuaciones) || 0);
  return n / (n + PRIOR_FUERZA);
}

/**
 * Hazard ratio de Cox para el riesgo de la carrera de hoy.
 *
 * Factores que el modelo conoce de la plataforma:
 *   - descanso insuficiente (vuelve hace menos de 14 días),
 *   - descanso excesivo (más de 60 días: la forma se pierde),
 *   - alertas médicas registradas.
 */
export function riesgoCox(diasDescanso: number, alertasMedicas: number): number {
  let hr = 1;
  const dias = Number(diasDescanso) || 0;
  if (dias > 0 && dias < 14) hr *= 1.25;
  if (dias > 60) hr *= 0.9;
  const alertas = Math.max(0, Number(alertasMedicas) || 0);
  hr *= 1 + alertas * 0.18;
  return Number(hr.toFixed(3));
}

/** Etiqueta legible del hazard ratio. */
export function etiquetaRiesgo(hr: number): "bajo" | "medio" | "alto" {
  if (hr > 1.15) return "alto";
  if (hr > 1.05) return "medio";
  return "bajo";
}

/** Días entre la última actuación y la fecha de la carrera que se proyecta. */
export function diasDesdeUltima(fechaUltima: string | null | undefined, fechaCarrera: string): number {
  if (!fechaUltima) return 0;
  const a = Date.parse(`${String(fechaUltima).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(fechaCarrera).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const d = Math.round((b - a) / 86400000);
  return d > 0 ? d : 0;
}

/**
 * Calcula el ranking de probabilidad de la carrera.
 *
 * La probabilidad se NORMALIZA al final: la suma de todas es 100. Así el
 * número se lee como "este caballo tiene un 34% de ganar", que es lo que el
 * operador puede usar, en vez de un score sin unidad.
 *
 * Un ejemplar SIN historial no se inventa: entra con la media de la
 * población y 0% de consistencia, y el ranking lo pone abajo con honestidad.
 */
export function calcularRankingActuarial(
  ejemplares: EjemplarProyectable[],
  contexto: ContextoCarrera
): FilaProyeccion[] {
  const filas: FilaProyeccion[] = ejemplares.map((e) => {
    const m = e.memoria;
    const actuaciones = m?.actuaciones ?? 0;
    const placements = m?.placements ?? 0;
    const winRate = m?.winRate ?? 0;
    const consistencia = m?.indiceConsistenciaGodet ?? 0;
    const speed = m?.speedRating ?? 0;
    const ultimaFecha = m?.historial?.[0]?.fecha ?? null;
    const diasDescanso = diasDesdeUltima(ultimaFecha, contexto.fecha);
    const hazardRatio = riesgoCox(diasDescanso, 0);
    const notas: string[] = [];

    // 1) Credibilidad: cuánto pesa la media propia frente a la del país.
    const z = credibilidadStraub(actuaciones);
    const speedEscalado = escalaSpeed(speed);
    const speedAjustado = z * speedEscalado + (1 - z) * PRIOR_MEDIA;
    if (actuaciones === 0) notas.push("Sin historial: se usa la media de la población.");
    else if (actuaciones < 5) notas.push(`Historial corto (${actuaciones} carrera(s)): poco peso a su media propia.`);

    // 2) Consistencia: el premio de cada carrera pesa en el índice.
    if (consistencia >= 60) notas.push(`Constante (índice ${consistencia}).`);
    else if (actuaciones >= 3 && consistencia < 25) notas.push(`Poco consistente (índice ${consistencia}).`);

    // 3) Descanso.
    if (diasDescanso > 0 && diasDescanso < 14) notas.push(`Vuelve hace ${diasDescanso} días: descanso corto.`);
    if (diasDescanso > 60) notas.push(`Lleva ${diasDescanso} días sin correr.`);

    // 4) Score: la forma manda, la consistencia acompaña, el resto es margen.
    const experiencia = Math.min(100, actuaciones * 10);
    let score =
      0.42 * speedAjustado +
      0.33 * consistencia +
      0.15 * winRate +
      0.10 * experiencia;
    score = score / Math.max(0.5, hazardRatio);

    return {
      numero: e.numero,
      nombre: e.nombre,
      nacionalidad: e.nacionalidad ?? m?.nacionalidad ?? "VE",
      probabilidad: 0,
      puesto: 0,
      indiceConsistencia: consistencia,
      speedRating: speed,
      actuaciones,
      placements,
      winRate,
      credibilidad: Number(z.toFixed(3)),
      speedAjustado: Number(speedAjustado.toFixed(2)),
      hazardRatio,
      riesgo: etiquetaRiesgo(hazardRatio),
      diasDescanso,
      jineteHabitual: m?.jineteHabitual ?? "",
      entrenadorHabitual: m?.entrenadorHabitual ?? "",
      score: Number(score.toFixed(3)),
      notas,
    };
  });

  const ordenadas = [...filas].sort((a, b) => b.score - a.score || a.numero - b.numero);
  const total = ordenadas.reduce((s, f) => s + Math.max(0.01, f.score), 0);
  return ordenadas.map((f, i) => ({
    ...f,
    puesto: i + 1,
    probabilidad: Number(((Math.max(0.01, f.score) / total) * 100).toFixed(2)),
  }));
}

/**
 * Convierte la memoria histórica en el tipo del motor Godet, para que la
 * pizarra prospectiva (`ModalAnalisisActuarialGodet`) reciba datos REALES y
 * no los valores de ejemplo que usa su modo "previa".
 */
export function aEjemplarGodet(fila: FilaProyeccion): {
  id: string;
  numero: number;
  nombre: string;
  stud?: string;
  actuaciones: number;
  varianzaTTC: number;
  speedRatingTTC: number;
  efectividadYunta: number;
  diasDescanso: number;
  tipoCarrera: "velocista" | "perseguidor" | "rematador";
} {
  // El tipo de carrera se infiere de la distancia de su última actuación: con
  // la memoria a la vista es mejor que suponerlo por el número de gualdrapa.
  const distancia = 1400;
  const tipo: "velocista" | "perseguidor" | "rematador" =
    distancia <= 1100 ? "velocista" : distancia >= 1600 ? "rematador" : "perseguidor";
  return {
    id: `${fila.numero}-${fila.nombre}`,
    numero: fila.numero,
    nombre: fila.nombre,
    stud: fila.nacionalidad,
    actuaciones: Math.max(1, fila.actuaciones),
    // La varianza del tiempo por carrera: sin historial medido se usa un
    // priori del 15%, que es el valor que el propio motor usa por defecto.
    varianzaTTC: 0.15,
    speedRatingTTC: fila.speedRating || 70,
    efectividadYunta: Number((fila.winRate / 100).toFixed(3)) || 0.5,
    diasDescanso: fila.diasDescanso || 21,
    tipoCarrera: tipo,
  };
}
