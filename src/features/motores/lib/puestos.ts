// src/features/motores/lib/puestos.ts
// ------------------------------------------------------------
// Centralized engine for "jugadas de puestos" (position bets)
// Implements the six immutable business rules defined by the user.
// All validation and liquidation logic should be imported from this
// module – it is the Single Source Of Truth (SSOT) for puesto bets.
// ------------------------------------------------------------

/**
 * Types representing the allowed bet formats.
 */
export type PuestoTipo =
  | "1P"
  | "2P"
  | "2N"
  | "3P"
  | "3N"
  | "4P"
  | "4N"; // individual bets only (no "1N" allowed)

/**
 * Combined bet – two individual bets separated by a slash, e.g. "1P/2N".
 */
export type PuestoCombinada = `${PuestoTipo}/${PuestoTipo}`;

/**
 * Block bet – three individual bets separated by " Y ", e.g. "1P Y 2N".
 */
export type PuestoBloque = `${PuestoTipo} Y ${PuestoTipo} Y ${PuestoTipo}`;

/**
 * Result of a validation attempt.
 */
export interface ValidationResult {
  ok: boolean;
  /** Human‑readable error when ok === false */
  error?: string;
}

/**
 * Result of a liquidation (payout) calculation.
 */
export interface LiquidationResult {
  /** Amount returned to the player (may be 0 for draw). */
  player: number;
  /** Amount kept by the house / banker. */
  banker: number;
  /** Optional flag for a tie ("Nini"). */
  draw?: boolean;
}

/**
 * Helper: parse a bet string and determine its kind.
 */
function parseBet(bet: string):
  | { kind: "individual"; value: PuestoTipo }
  | { kind: "combined"; value: PuestoCombinada }
  | { kind: "block"; value: PuestoBloque }
  | { kind: "invalid" } {
  // Reject any occurrence of "1N" – rule 1.
  if (bet.includes("1N")) return { kind: "invalid" };

  // Simple regex checks – they also guarantee the literal types.
  const individualRe = /^(1P|2P|2N|3P|3N|4P|4N)$/;
  if (individualRe.test(bet)) return { kind: "individual", value: bet as PuestoTipo };

  const combinedRe = /^(1P|2P|2N|3P|3N|4P|4N)\/(1P|2P|2N|3P|3N|4P|4N)$/;
  if (combinedRe.test(bet)) return { kind: "combined", value: bet as PuestoCombinada };

  const blockRe = /^(1P|2P|2N|3P|3N|4P|4N) Y (1P|2P|2N|3P|3N|4P|4N) Y (1P|2P|2N|3P|3N|4P|4N)$/;
  if (blockRe.test(bet)) return { kind: "block", value: bet as PuestoBloque };

  return { kind: "invalid" };
}

/**
 * Business Rule 1 – Bilateral risk and elimination of "1N".
 * Ensures that both player and banker have a possible win given the
 * number of runners (nCorredores).
 */
export function validarPuesto(bet: string, nCorredores: number): ValidationResult {
  const parsed = parseBet(bet);
  if (parsed.kind === "invalid") {
    return { ok: false, error: "Apuesta no válida o contiene '1N' que está prohibido" };
  }

  // Helper to verify that a given bet can produce a win for the banker.
  const bankerCanWin = (tipo: PuestoTipo): boolean => {
    switch (tipo) {
      case "1P":
        return nCorredores >= 2; // banker wins if pos >= 2
      case "2P":
        return nCorredores >= 3; // banker wins if pos >= 3
      case "2N":
        return nCorredores >= 3; // banker wins if pos >= 3
      case "3P":
        return nCorredores >= 4;
      case "3N":
        return nCorredores >= 4;
      case "4P":
        return nCorredores >= 5;
      case "4N":
        return nCorredores >= 5;
      default:
        return false;
    }
  };

  // Helper to verify that the player can win.
  const playerCanWin = (tipo: PuestoTipo): boolean => {
    switch (tipo) {
      case "1P":
        return nCorredores >= 1; // pos === 1
      case "2P":
        return nCorredores >= 2; // pos <= 2
      case "2N":
        return nCorredores >= 2; // pos === 1 yields win
      case "3P":
        return nCorredores >= 3;
      case "3N":
        return nCorredores >= 3; // win when pos <= 2
      case "4P":
        return nCorredores >= 4;
      case "4N":
        return nCorredores >= 4; // win when pos <= 3
      default:
        return false;
    }
  };

  const ensureBothSides = (tipo: PuestoTipo): boolean =>
    playerCanWin(tipo) && bankerCanWin(tipo);

  if (parsed.kind === "individual") {
    if (!ensureBothSides(parsed.value)) {
      return { ok: false, error: `Apuesta '${bet}' no cumple con riesgo bilateral para ${nCorredores} corredores` };
    }
    return { ok: true };
  }

  // For combined and block bets the requirement is the maximum of the
  // component requirements (Rule 1‑4). All components must satisfy bilateral risk.
  const componentes = parsed.kind === "combined"
    ? parsed.value.split('/') as PuestoTipo[]
    : parsed.value.split(' Y ') as PuestoTipo[];

  for (const comp of componentes) {
    if (!ensureBothSides(comp)) {
      return { ok: false, error: `Componente '${comp}' de la apuesta '${bet}' invalido para ${nCorredores} corredores` };
    }
  }
  return { ok: true };
}

/**
 * Liquidation for a single individual bet – Rule 2.
 */
function liquidarIndividual(bet: PuestoTipo, posicion: number, monto: number): LiquidationResult {
  // Helper to treat "draw" (N) as a zero‑gain outcome.
  const draw = () => ({ player: 0, banker: monto, draw: true });

  switch (bet) {
    case "1P":
      return posicion === 1 ? { player: monto, banker: 0 } : { player: 0, banker: monto };
    case "2P":
      return posicion <= 2 ? { player: monto, banker: 0 } : { player: 0, banker: monto };
    case "2N":
      if (posicion === 1) return { player: monto, banker: 0 };
      if (posicion === 2) return draw();
      return { player: 0, banker: monto };
    case "3P":
      return posicion <= 3 ? { player: monto, banker: 0 } : { player: 0, banker: monto };
    case "3N":
      if (posicion <= 2) return { player: monto, banker: 0 };
      if (posicion === 3) return draw();
      return { player: 0, banker: monto };
    case "4P":
      return posicion <= 4 ? { player: monto, banker: 0 } : { player: 0, banker: monto };
    case "4N":
      if (posicion <= 3) return { player: monto, banker: 0 };
      if (posicion === 4) return draw();
      return { player: 0, banker: monto };
    default:
      // Should never happen because we only call this with validated tipos.
      return { player: 0, banker: monto };
  }
}

/**
 * Liquidation for a combined bet – Rule 3.
 * The win amount is split 50 % / 50 % between the two components when the
 * player wins; otherwise the banker receives the full stake. Draw on any
 * component results in a full draw (player receives 0).
 */
function liquidarCombinada(bet: PuestoCombinada, posicion: number, monto: number): LiquidationResult {
  const [first, second] = bet.split('/') as [PuestoTipo, PuestoTipo];
  const resFirst = liquidarIndividual(first, posicion, monto);
  const resSecond = liquidarIndividual(second, posicion, monto);

  // If either component is a draw, treat whole bet as draw.
  if (resFirst.draw || resSecond.draw) {
    return { player: 0, banker: monto, draw: true };
  }

  // Player wins only if **both** components indicate a player win.
  const playerWins = resFirst.player > 0 && resSecond.player > 0;
  if (playerWins) {
    // 50 % of the stake is returned to the player; the other 50 % stays with the banker.
    const playerAmt = monto * 0.5;
    const bankerAmt = monto - playerAmt; // remainder
    return { player: playerAmt, banker: bankerAmt };
  }

  // Otherwise the banker keeps everything.
  return { player: 0, banker: monto };
}

/**
 * Liquidation for a block bet – Rule 4.
 * Winning split is 75 % to the player, 25 % to the banker.
 */
function liquidarBloque(bet: PuestoBloque, posicion: number, monto: number): LiquidationResult {
  const componentes = bet.split(' Y ') as PuestoTipo[];
  const resultados = componentes.map(c => liquidarIndividual(c, posicion, monto));

  // Any draw → whole bet draws.
  if (resultados.some(r => r.draw)) {
    return { player: 0, banker: monto, draw: true };
  }

  // Player wins only if **all** components give player win.
  const playerWins = resultados.every(r => r.player > 0);
  if (playerWins) {
    const playerAmt = monto * 0.75;
    const bankerAmt = monto - playerAmt;
    return { player: playerAmt, banker: bankerAmt };
  }

  // Otherwise banker keeps everything.
  return { player: 0, banker: monto };
}

/**
 * Public liquidation entry point – decides which internal routine to call.
 */
export function liquidarPuesto(bet: string, posicion: number, monto: number): LiquidationResult {
  const parsed = parseBet(bet);
  if (parsed.kind === "invalid") {
    // Defensive: return full loss for unknown format.
    return { player: 0, banker: monto };
  }
  switch (parsed.kind) {
    case "individual":
      return liquidarIndividual(parsed.value, posicion, monto);
    case "combined":
      return liquidarCombinada(parsed.value, posicion, monto);
    case "block":
      return liquidarBloque(parsed.value, posicion, monto);
  }
}

/**
 * Rule 5 – Apply 5 % commission **only on net positive** player gain.
 */
export function aplicarComision(res: LiquidationResult): LiquidationResult {
  if (res.player <= 0) return res; // no commission on loss or draw
  const commission = res.player * 0.05;
  const playerAfter = res.player - commission;
  const bankerAfter = res.banker + commission;
  return { ...res, player: playerAfter, banker: bankerAfter };
}

/**
 * Export a convenient namespace for external modules.
 */
export const Puestos = {
  validar: validarPuesto,
  liquidar: liquidarPuesto,
  aplicarComision,
};

// ------------------------------------------------------------
// End of puesto engine (SSOT).
// ------------------------------------------------------------