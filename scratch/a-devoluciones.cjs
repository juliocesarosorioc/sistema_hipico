const fs = require("fs");
const p = "src/features/liquidacion/lib/devoluciones-cruce.ts";
let c = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const rep = (a, b) => {
  if (!c.includes(a)) throw new Error("No encontrado: " + a.slice(0, 80));
  c = c.replace(a, b);
};

rep(
  'import { redondearCentavos } from "@/shared/lib/dinero";',
  'import { aCentavos, deCentavos, calcularComisionExacta } from "@/shared/lib/dinero";'
);

rep(
  "  resultado?: number | null;\n  estado?: string | null;",
  "  resultado?: number | null;\n  /**\n   * Resultado BRUTO (antes de la comisión del grupo) desde la perspectiva del\n   * cliente. Es la base oficial de la devolución: si arriesga 100 y gana 100,\n   * la base es 100 aunque el neto tras comisión sea 95. Tiene prioridad sobre\n   * `resultado` (neto) cuando viene informado.\n   */\n  resultadoBruto?: number | null;\n  estado?: string | null;"
);

const ini = c.indexOf("export function calcularBaseDecididaCarrera(");
if (ini < 0) throw new Error("sin funcion");
c =
  c.slice(0, ini) +
  `export function calcularBaseDecididaCarrera(
  jugadasCarrera: JugadaEntradaBaseDecidida[],
  devolucionPct: number = 0
): ResultadoBaseDecididaCarrera {
  // Aritmética entera en centavos: nada de sumas en coma flotante.
  let ganadoCent = 0;
  let perdidoCent = 0;

  for (const j of jugadasCarrera) {
    if (!esJugadaElegibleParaDevolucion(j)) continue;

    // 1. Resultado oficial pre-calculado (prioridad: BRUTO, luego neto).
    const oficial =
      typeof j.resultadoBruto === "number" && Number.isFinite(j.resultadoBruto)
        ? j.resultadoBruto
        : typeof j.resultado === "number" && Number.isFinite(j.resultado)
          ? j.resultado
          : null;
    if (oficial !== null) {
      const cent = aCentavos(oficial);
      if (cent > 0) ganadoCent += cent;
      else if (cent < 0) perdidoCent += -cent;
      // 0 = empate total (ej. NINI que devuelve capital): sin base decidida.
      continue;
    }

    // 2. Sin resultado explícito: deducir según estado y montos.
    const est = String(j.estado ?? "").trim().toUpperCase();
    const gano = est === "GANADOR" || est === "GANO" || est === "SOLUCIONADO";
    const perdio = est === "PERDEDOR" || est === "PERDIO";
    if (!gano && !perdio) continue;

    const monto = aCentavos(j.montoJugado ?? j.monto ?? 0);
    const premio = aCentavos(j.premioPagar ?? j.premio ?? 0);
    const montoDec = aCentavos(j.montoDecidido ?? 0);

    if (gano) {
      ganadoCent += premio > monto ? premio - monto : montoDec > 0 ? montoDec : monto;
    } else {
      // Bloque o dividida con devolución parcial de empate: solo la parte decidida.
      perdidoCent += premio > 0 && premio < monto ? monto - premio : montoDec > 0 ? montoDec : monto;
    }
  }

  const hayCruce = ganadoCent > 0 && perdidoCent > 0;
  const baseCent = hayCruce ? Math.abs(ganadoCent - perdidoCent) : ganadoCent + perdidoCent;
  const baseDecidida = deCentavos(baseCent);
  // Un solo redondeo por asiento, con el mismo criterio que toda comisión.
  const devolucion = calcularComisionExacta(baseDecidida, Math.max(0, Number(devolucionPct) || 0));

  return {
    totalGanadoBruto: deCentavos(ganadoCent),
    totalPerdidoBruto: deCentavos(perdidoCent),
    baseDecididaTotal: baseDecidida,
    hayCruce,
    baseDecidida,
    devolucion,
  };
}
`;
fs.writeFileSync(p, c.replace(/\n/g, "\r\n"), "utf8");
console.log("ok devoluciones-cruce");
