function extraerMontoNumerico(rawInput) {
  const limpio = (rawInput || "").trim().replace(/^[\$Bs\.\s]+/i, "").trim();
  if (!limpio) return { monto: 0, montoTexto: "0", esKilo: false };
  const matchK = /^(\d+(?:[\.,]\d+)?)\s*k$/i.exec(limpio);
  if (matchK) {
    const base = parseFloat(matchK[1].replace(",", "."));
    if (Number.isFinite(base) && base > 0) {
      const monto = Math.round(base * 1000 * 100) / 100;
      return { monto, montoTexto: String(monto), esKilo: true };
    }
  }
  const f = parseFloat(limpio.replace(",", "."));
  const m = Number.isFinite(f) && f > 0 ? Math.round(f * 100) / 100 : 0;
  return { monto: m, montoTexto: String(m), esKilo: false };
}

function normalizarBandoCaballos(raw, maxEjemplarCarrera = 16) {
  const limpio = raw.replace(/\b(de\s+la|del|de|la|el|#)\b/gi, " ").trim();
  if (/[\.\-,\/]/.test(limpio) || /\d+\s+\d+/.test(limpio)) {
    return limpio
      .split(/[\.\-,\/\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+[A-Z]?$/i.test(s));
  }
  const soloDigitos = limpio.replace(/\s+/g, "");
  return /^\d+[A-Z]?$/i.test(soloDigitos) ? [soloDigitos.toUpperCase()] : [];
}

function testParser(textoUsuario) {
  const texto = textoUsuario.trim().replace(/\s+/g, " ");
  const esConsigue = /^(consigo|doy)\b/i.test(texto);
  const verboEstandar = /^doy\b/i.test(texto) ? "Doy" : esConsigue ? "Consigo" : "Juego";

  const regexPuestosYCaballos = /^(?:(juego|jugo|jugó|consigo|doy|voy)\s+)?(?:([1-9]p|10p|[1-9]n|10n|[1-5]y[1-5]n?|[1-5]\/[1-5]n?|a|al)\s+)?(?:de\s+la\s+|del\s+|de\s+|la\s+|el\s+|a\s+|al\s+|#)?([0-9A-Za-z\.\-,\s']+?)\s+(?:con\s+|por\s+|\$|bs\.?|bs\s+)?([0-9kK\.,]+)$/i;
  const matchPuesto = texto.match(regexPuestosYCaballos);

  if (matchPuesto) {
    const rawMod = (matchPuesto[2] || "").trim().toUpperCase();
    let modLimpia = "1P";
    if (rawMod && rawMod !== "A" && rawMod !== "AL") {
      modLimpia = rawMod.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
      modLimpia = modLimpia.replace(/^([1-5]\/[1-5])(?=-)/, "$1N");
    }

    const rawEjemplar = (matchPuesto[3] || "").trim();
    const { monto, montoTexto } = extraerMontoNumerico(matchPuesto[4]);

    if (rawEjemplar && monto > 0) {
      const numMatch = rawEjemplar.match(/^\d+/);
      const caballos = normalizarBandoCaballos(rawEjemplar);
      const ejemplarIdentificador = numMatch ? numMatch[0] : (caballos[0] || rawEjemplar.toUpperCase());
      const caballosBandoA = caballos.length > 0 ? caballos : [ejemplarIdentificador];

      let ejemplarTexto = rawEjemplar.toUpperCase();
      if (numMatch && !/^\d+$/.test(rawEjemplar)) {
        ejemplarTexto = `#${rawEjemplar.toUpperCase()}`;
      }

      return {
        valido: true,
        modalidad: modLimpia,
        ejemplarTexto,
        caballosBandoA,
        monto,
        jugadaEstandarizada: `${verboEstandar} ${modLimpia} ${ejemplarTexto} ${montoTexto}`,
      };
    }
  }

  return { valido: false };
}

const casos = [
  "JUEGO A 6 AMOR PROHIBIDO 500",
  "JUEGO A 5 ALANA 500",
  "JUEGO 2Y2 DE MAHOMES 500",
  "JUEGO 2N DE BROTHER WILL 500",
  "JUGO 2N DE FOUR PALMS QUEEN 500",
  "JUEGO 3N DE ROSE SENSATION 500",
  "JUEGO 4P DE LITTLE VALERY 500",
  "Juego 5p special one 100",
  "Juego 6p gold rock 100"
];

casos.forEach(c => {
  const r = testParser(c);
  console.log(c, "=>", r.valido ? "✅ " + r.jugadaEstandarizada : "❌ INVALIDO");
});
