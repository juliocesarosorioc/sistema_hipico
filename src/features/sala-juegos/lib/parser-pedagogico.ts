cat << 'EOF' > src/features/sala-juegos/lib/parser-pedagogico.ts
// LÍNEA 1: Motor Determinístico de Estandarización Hípica y Corrección Pedagógica

export interface ResultadoAnalisisJugada {
  esIntencionDeJugada: boolean;
  valido: boolean;
  accionProponente: 'JUEGA' | 'CONSIGUE';
  esMatch: boolean;
  modalidad: string;
  caballosBandoA: string[];
  caballosBandoB: string[];
  ejemplarTexto: string;
  monto: number;
  jugadaEstandarizada: string;
  confianza: number;
  requiereOperador: boolean;
  mensajePedagogicoPrivado?: string;
  sugerenciasUnClic?: string[];
}

// Normaliza bloques de caballos como "45", "1.5", "1,5", "4 .5", "la 15" -> ["1", "5"] -> "1-5"
function normalizarBandoCaballos(raw: string, maxEjemplarCarrera = 16): string[] {
  const limpio = raw
    .replace(/\b(de\s+la|del|de|la|el|#)\b/gi, ' ')
    .trim();

  // Si tiene separadores explícitos (., -, /, , o espacios entre números)
  if (/[\.\-,\/]/.test(limpio) || /\d+\s+\d+/.test(limpio)) {
    return limpio
      .split(/[\.\-,\/\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d+[A-Z]?$/i.test(s));
  }

  // Si escribió un número de 2 dígitos pegado como "45", "15", "46" que supera el máximo de caballos de la carrera
  const soloDigitos = limpio.replace(/\s+/g, '');
  if (/^\d{2}$/.test(soloDigitos)) {
    const numEntero = parseInt(soloDigitos, 10);
    if (numEntero > maxEjemplarCarrera || /la\s+\d{2}/i.test(raw)) {
      const d1 = soloDigitos[0];
      const d2 = soloDigitos[1];
      if (d1 !== '0' && d2 !== '0') return [d1, d2];
    }
  }

  return /^\d+[A-Z]?$/i.test(soloDigitos) ? [soloDigitos.toUpperCase()] : [];
}

export function analizarYEstandarizarJugada(
  textoUsuario: string,
  saldoDisponible: number,
  ejemplaresRetirados: string[] = [],
  maxEjemplarCarrera = 16
): ResultadoAnalisisJugada {
  const texto = textoUsuario.trim().replace(/\s+/g, ' ');

  // 1. Detectar si el mensaje tiene intención de jugada
  const patronIntencion = /\b(juego|j|consigo|doy|voy|1p|2p|3p|4p|2n|3n|4n|2y2n|3y3n|x|contra)\b/i;
  if (!patronIntencion.test(texto)) {
    return {
      esIntencionDeJugada: false,
      valido: true,
      accionProponente: 'JUEGA',
      esMatch: false,
      modalidad: '',
      caballosBandoA: [],
      caballosBandoB: [],
      ejemplarTexto: '',
      monto: 0,
      jugadaEstandarizada: texto,
      confianza: 1.0,
      requiereOperador: false,
    };
  }

  // Determinar verbo inicial (Juego vs Consigo/Doy)
  const esConsigue = /^(consigo|doy)\b/i.test(texto);
  const verboEstandar = /^doy\b/i.test(texto) ? 'Doy' : esConsigue ? 'Consigo' : 'Juego';
  const accionProponente: 'JUEGA' | 'CONSIGUE' = esConsigue ? 'CONSIGUE' : 'JUEGA';

  // 2. CASO A: JUGADA DE MATCH CON "x" O "contra"
  // Ejemplos: "Juego 1x4 50", "Juego 1.6 x 4.5 100", "Juego 1,5 x 4-6 100", "Juego la 15 x 46 con 100"
  const regexMatch = /^(?:(juego|consigo|doy)\s+)?(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s*(?:x|vs|contra)\s*(?:de\s+la\s+|la\s+|del\s+|el\s+)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?)$/i;
  const matchVs = texto.match(regexMatch);

  if (matchVs) {
    const bandoA = normalizarBandoCaballos(matchVs[2], maxEjemplarCarrera);
    const bandoB = normalizarBandoCaballos(matchVs[3], maxEjemplarCarrera);
    const monto = parseFloat(matchVs[4].replace(',', '.'));

    if (bandoA.length > 0 && bandoB.length > 0 && monto > 0) {
      // Verificar retirados en cualquiera de los dos bandos
      const retiradoDetectado = [...bandoA, ...bandoB].find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: true,
          modalidad: 'MATCH',
          caballosBandoA: bandoA,
          caballosBandoB: bandoB,
          ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
          monto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. No se permiten jugadas con ejemplares retirados.`,
        };
      }

      // Verificar saldo disponible
      if (monto > saldoDisponible) {
        const montoSugerido = Math.floor(saldoDisponible);
        const estandarAjustada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')} ${montoSugerido}`;
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: true,
          modalidad: 'MATCH',
          caballosBandoA: bandoA,
          caballosBandoB: bandoB,
          ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
          monto,
          jugadaEstandarizada: estandarAjustada,
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🔒 Solo visible para ti: Tu jugada supera tu saldo disponible ($${saldoDisponible.toFixed(2)}). Puedes enviarla hasta tu monto disponible:`,
          sugerenciasUnClic: montoSugerido > 0 ? [estandarAjustada] : [],
        };
      }

      const jugadaEstandarizada = `${verboEstandar} ${bandoA.join('-')} x ${bandoB.join('-')} ${monto}`;
      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: true,
        modalidad: 'MATCH',
        caballosBandoA: bandoA,
        caballosBandoB: bandoB,
        ejemplarTexto: `${bandoA.join('-')} x ${bandoB.join('-')}`,
        monto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
      };
    }
  }

  // 3. CASO B: JUGADAS DE PUESTOS Y LLAVES ("1p", "2n", "2p", "2y2n", "2n y 2y2n", "3n", "3p", "4n")
  // Ejemplos:
  // - "Juego 1p del 5 con 100" / "Juego 1p #5 100" / "Juego 1p 5 con 100" -> "Juego 1P 5 100"
  // - "Consigo 1p del 5 con 100" / "Doy 1p 5 100" -> "Consigo 1P 5 100"
  // - "Juego 1p de la 45 100" / "juego 1p de 4 .5 100" -> "Juego 1P 4-5 100"
  const regexPuestos = /^(?:(juego|consigo|doy)\s+)?(1p|2p|3p|4p|2n\s+y\s+2y2n|3n\s+y\s+3y3n|2y2n|3y3n|2n|3n|4n)\s+(?:de\s+la\s+|del\s+|de\s+|la\s+|el\s+|#)?([0-9A-Za-z\.\-,\s]+?)\s+(?:con\s+|por\s+|\$)?(\d+(?:[\.,]\d+)?)$/i;
  const matchPuesto = texto.match(regexPuestos);

  if (matchPuesto) {
    const modLimpia = matchPuesto[2].toUpperCase().replace(/\s+/g, ' ');
    const caballos = normalizarBandoCaballos(matchPuesto[3], maxEjemplarCarrera);
    const monto = parseFloat(matchPuesto[4].replace(',', '.'));

    if (caballos.length > 0 && monto > 0) {
      const retiradoDetectado = caballos.find((c) =>
        ejemplaresRetirados.map((r) => r.trim()).includes(c)
      );
      if (retiradoDetectado) {
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos.join('-'),
          monto,
          jugadaEstandarizada: '',
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🚫 El ejemplar #${retiradoDetectado} está RETIRADO oficialmente. Elige otro ejemplar activo.`,
        };
      }

      if (monto > saldoDisponible) {
        const montoSugerido = Math.floor(saldoDisponible);
        const estandarAjustada = `${verboEstandar} ${modLimpia} ${caballos.join('-')} ${montoSugerido}`;
        return {
          esIntencionDeJugada: true,
          valido: false,
          accionProponente,
          esMatch: false,
          modalidad: modLimpia,
          caballosBandoA: caballos,
          caballosBandoB: [],
          ejemplarTexto: caballos.join('-'),
          monto,
          jugadaEstandarizada: estandarAjustada,
          confianza: 1.0,
          requiereOperador: false,
          mensajePedagogicoPrivado: `🔒 Solo visible para ti: Tu saldo disponible es $${saldoDisponible.toFixed(2)}. ¿Deseas publicar la jugada hasta tu disponible?`,
          sugerenciasUnClic: montoSugerido > 0 ? [estandarAjustada] : [],
        };
      }

      const jugadaEstandarizada = `${verboEstandar} ${modLimpia} ${caballos.join('-')} ${monto}`;
      return {
        esIntencionDeJugada: true,
        valido: true,
        accionProponente,
        esMatch: false,
        modalidad: modLimpia,
        caballosBandoA: caballos,
        caballosBandoB: [],
        ejemplarTexto: caballos.join('-'),
        monto,
        jugadaEstandarizada,
        confianza: 0.99,
        requiereOperador: false,
      };
    }
  }

  // 4. CORRECCIÓN PEDAGÓGICA CUANDO EL JUGADOR ESCRIBE CON ERROR DE FORMATO
  const numerosDetectados = texto.match(/\d+/g) || [];
  const ej1 = numerosDetectados[0] || '5';
  const ej2 = numerosDetectados[1] || '4';
  const montoEj = numerosDetectados[numerosDetectados.length - 1] || '100';

  return {
    esIntencionDeJugada: true,
    valido: false,
    accionProponente,
    esMatch: false,
    modalidad: 'DUDA_FORMATO',
    caballosBandoA: [],
    caballosBandoB: [],
    ejemplarTexto: '',
    monto: 0,
    jugadaEstandarizada: '',
    confianza: 0.45,
    requiereOperador: true,
    mensajePedagogicoPrivado:
      `🤖 Corrección Pedagógica: No pude procesar tu jugada "${texto}". Así debes escribirla:\n` +
      `• Para jugar Puesto: Juego 1P ${ej1} ${montoEj} (o Consigo 1P ${ej1} ${montoEj})\n` +
      `• Para jugar Llave/Dupla: Juego 1P ${ej1}-${ej2} ${montoEj}\n` +
      `• Para jugar Match (Caballo vs Caballo): Juego ${ej1} x ${ej2} ${montoEj}\n` +
      `Se ha notificado también al operador por si requieres atención personalizada.`,
    sugerenciasUnClic: [
      `Juego 1P ${ej1} ${montoEj}`,
      `Consigo 1P ${ej1} ${montoEj}`,
      `Juego ${ej1} x ${ej2} ${montoEj}`,
    ],
  };
}
// LÍNEA 248: Fin del archivo parser-pedagogico.ts
EOF
echo "✅ Archivo 2 (parser-pedagogico.ts) creado correctamente."