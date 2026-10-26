/**
 * REPORTE DE CARRERA — arma la plantilla de liquidación (ReporteCarrera) con
 * datos REALES de una carrera ya pagada o preliminar.
 *
 * Módulo PURO (sin I/O ni React): recibe una `CarreraReporte` — la que ya
 * produce el motor oficial de `src/lib/liquidacion/reportes.ts` con las filas
 * liquidadas (estado, premio neto, cruce financiero) — y la traduce a
 * `ReporteCarreraDatos`, el contrato de la plantilla imprimible de 7 columnas.
 */
import type {
  ReporteCarreraDatos,
  JugadaVivo,
  Adelantada,
  NotaExcedido,
  ObservacionOrdenExceso,
} from "@/features/saldos/components/ReporteCarrera";
import type { CarreraReporte, FilaReporte } from "@/features/liquidacion/lib/reportes";
import { pasaFiltroModalidad, type FiltroModalidadTiempo } from "@/features/jugadas/lib/modalidad-tiempo";
import { colorDiscoNumero } from "@/features/saldos/lib/discos";
import { etiquetaJugada } from "@/features/taquilla/lib/nomenclatura";
import { redondearCentavos, restarDinero, sumarDinero } from "@/shared/lib/dinero";
import { _reembolsosCruce, type ModalidadCruceCarrera } from "@/features/taquilla/lib/cruces-y-tapas";

export { colorDiscoNumero };

/**
 * Determina si una fila de `JugadaVivo` pertenece a la sección de Jugadas Adelantadas
 * (`esAdelantada === true`, `MARCA`, `TABLA FIJA`, `TABLA`, `REMATE`, `TERCIO`, etc.).
 * Las jugadas adelantadas NUNCA deben aparecer en la sección de Jugadas en Vivo.
 */
export function esJugadaAdelantadaReporte(j: JugadaVivo): boolean {
  if (j.esAdelantada) return true;
  const t = String(j.jugo ?? "").trim().toUpperCase();
  if (/^(MARCA|TABLA|REMATE|TERCIO|DUPLETA|POLLA)\b/.test(t)) return true;
  if (/^T\d{1,2}\b|3Y3/.test(t)) return true;
  return false;
}

/**
 * Segmenta las jugadas del reporte en dos listas mutuamente excluyentes con la misma
 * estructura de 7 columnas (`Quien Juega | Apostó | Resultado | Jugada | Quien Da | Apostó | Resultado`):
 *   - `enVivo`: únicamente jugadas en vivo (cero adelantadas).
 *   - `adelantadas`: todas las jugadas adelantadas (`⏳ ADELANTADA`, `MARCA`, `TABLA FIJA`, etc.).
 */
export function segmentarJugadasReporte(
  jugadasVivo: JugadaVivo[],
  adelantadas?: ReporteCarreraDatos["adelantadas"]
): { enVivo: JugadaVivo[]; adelantadas: JugadaVivo[] } {
  const enVivo: JugadaVivo[] = [];
  const listaAdelantadas: JugadaVivo[] = [];
  const vistos = new Set<string>();

  const firma = (j: JugadaVivo) =>
    `${String(j.juega ?? "").trim().toUpperCase()}::${String(j.jugo ?? "").trim().toUpperCase()}::${String(j.caballo ?? "").trim().toUpperCase()}::${String(j.aposto ?? "")}::${String(j.da ?? "").trim().toUpperCase()}`;

  for (const j of jugadasVivo ?? []) {
    if (esJugadaAdelantadaReporte(j)) {
      const item: JugadaVivo = { ...j, esAdelantada: true };
      vistos.add(firma(item));
      listaAdelantadas.push(item);
    } else {
      enVivo.push(j);
    }
  }

  const extras: Adelantada[] = [
    ...(adelantadas?.tablas ?? []),
    ...(adelantadas?.marcas ?? []),
    ...(adelantadas?.tercios ?? []),
    ...(adelantadas?.otras ?? []),
  ];
  for (const ex of extras) {
    const k = firma(ex);
    if (!vistos.has(k)) {
      vistos.add(k);
      listaAdelantadas.push({ ...ex, esAdelantada: true });
    }
  }

  return { enVivo, adelantadas: listaAdelantadas };
}

/** "2026-10-12" → «lun 12 oct 2026» (fecha legible para el encabezado). */
function diaLegible(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const f = new Date(y, m - 1, d);
  return f
    .toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .replace(/^([a-záéíóú]+)\.?/, (_, wd: string) => wd.toLowerCase());
}

/** Índice de pareo `-j-<i>` / `-c-<i>` extraído del id de una fila. */
function indiceTicketDe(id: string): string | null {
  const m = /-(j|c)-(\d+)$/.exec(id);
  return m ? m[2] : null;
}

/** El "DA" (cliente que consigue) de cada índice de ticket, con lo que arriesga y su resultado. */
function consiguePorJuega(c: CarreraReporte): Map<string, { cliente: string; resultado: number | null; riesgo: number }> {
  const mapa = new Map<string, { cliente: string; resultado: number | null; riesgo: number }>();
  for (const f of c.filas) {
    const i = indiceTicketDe(f.id);
    if (!i || !f.id.endsWith(`-c-${i}`)) continue;
    mapa.set(i, {
      cliente: f.cliente,
      resultado: f.resultado ?? null,
      riesgo: riesgoDeFila(f),
    });
  }
  return mapa;
}

/**
 * Tipo de jugada → sección de «Parada Adelantadas» para las que ganaron.
 */
function seccionAdelantadaDe(
  jugada: string,
  tipo?: "TABLA" | "MARCA" | null
): "tablas" | "marcas" | "tercios" | null {
  if (tipo === "TABLA") return "tablas";
  if (tipo === "MARCA") return "marcas";
  const t = String(jugada ?? "").toUpperCase();
  if (/TABLA/i.test(t)) return "tablas";
  if (/MARCA/i.test(t)) return "marcas";
  if (/TERCIO|^T\d{1,2}\b|3Y3/i.test(t)) return "tercios";
  return null;
}

/** Proporción "a/b" de un tipo de jugada (ej. "10/6"); null si no la trae. */
function proporcionDe(jugada: string): { a: number; b: number } | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(String(jugada ?? ""));
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? { a, b } : null;
}

/**
 * Ítem 10: riesgo REAL de una fila — el monto que ese jugador FINANCIA en la
 * carrera. El que JUEGA arriesga `monto`; el que CONSIGUE (el "da") arriesga su
 * lado de la proporción (`monto · b/a`).
 */
export function riesgoDeFila(f: FilaReporte): number {
  if (f.rol === "CRUCE") return 0;
  if (f.rol === "Consigue") {
    const p = proporcionDe(f.jugada);
    if (p) return redondearCentavos((f.monto * p.b) / p.a);
  }
  return redondearCentavos(f.monto);
}

export type OpcionesReporteCarrera = {
  /** `false` = carrera aún sin pagar: oculta pizarra, resultados y resumen. */
  liquidada?: boolean;
  /** Logo del hipódromo (Data URL PNG). */
  logoHipodromo?: string | null;
  /** Logo del grupo hípico (Data URL PNG). */
  logoGrupo?: string | null;
  filtroModalidad?: FiltroModalidadTiempo;
  /** Modalidad de cruces al liquidar: cuando es `'con_cruces'` o `true`, aplica el reembolso de comisión directamente al neto del cliente sin pintar filas CRUCE sueltas. */
  modalidadCruce?: ModalidadCruceCarrera | boolean;
  /** Porcentaje de comisión para el cálculo de reembolso por cruce (por defecto 5%). */
  comisionPct?: number;
};

export function armarReporteCarrera(
  c: CarreraReporte,
  grupo?: string,
  disponibleDe?: (nombre: string) => number | null | undefined,
  opciones?: OpcionesReporteCarrera
): ReporteCarreraDatos {
  const puestos = (c.pizarra ?? "").split(/\s*·\s*/).filter(Boolean);
  const consigue = consiguePorJuega(c);

  const jugadasVivo: JugadaVivo[] = [];
  const adelantadas: {
    tablas: Adelantada[];
    marcas: Adelantada[];
    tercios: Adelantada[];
    otras?: Adelantada[];
  } = {
    tablas: [],
    marcas: [],
    tercios: [],
    otras: [],
  };
  const netoPorCliente = new Map<string, number>();
  const riesgoPorCliente = new Map<string, number>();
  const lineasCruce: Array<{ cliente: string; resultado: number }> = [];
  const observacionesOrdenExceso: ObservacionOrdenExceso[] = [];
  const usadoProgresivoPorCliente = new Map<string, number>();

  let correlativo = 0;
  let ordenJuego = 0;
  const filtro: FiltroModalidadTiempo = opciones?.filtroModalidad ?? "TODAS";

  for (const f of c.filas) {
    if (f.rol === "CRUCE") continue;
    if (!pasaFiltroModalidad({ es_adelantada: f.esAdelantada }, filtro)) continue;
    const resultado = f.resultado; // number | null (null = pendiente)
    if (f.rol !== "Consigue") {
      ordenJuego += 1;
      const i = indiceTicketDe(f.id) ?? `t-${correlativo++}`;
      const cons = consigue.get(i);
      const da = cons?.cliente ?? "";
      const jugo =
        f.tipoJugada === "MARCA" || f.tipoJugada === "TABLA"
          ? f.jugada
          : etiquetaJugada(f.jugada);

      const apostoJuega = riesgoDeFila(f);
      const apostoDa = cons ? cons.riesgo : null;
      const resultadoDa = cons ? cons.resultado : null;

      const filaVivo: JugadaVivo = {
        juega: f.cliente,
        aposto: apostoJuega,
        jugo,
        caballo: f.caballo,
        da,
        apostoDa,
        resultado,
        resultadoDa,
        ...(f.esAdelantada ? { esAdelantada: true } : {}),
      };

      jugadasVivo.push(filaVivo);

      const seccion = seccionAdelantadaDe(f.jugada, f.tipoJugada);
      if (seccion && resultado !== null && resultado > 0) {
        adelantadas[seccion].push({
          ...filaVivo,
          descripcion: (f.ejemplar ?? f.caballo) || f.jugada,
        });
      } else if (f.esAdelantada) {
        adelantadas.otras?.push({
          ...filaVivo,
          esAdelantada: true,
          descripcion: (f.ejemplar ?? f.caballo) || f.jugada,
        });
      }

      // Verificación progresiva de límite de saldo por orden de juego (Jugador 1)
      const dispTotal = disponibleDe?.(f.cliente);
      if (typeof dispTotal === "number" && Number.isFinite(dispTotal) && apostoJuega > 0) {
        const yaUsado = usadoProgresivoPorCliente.get(f.cliente) ?? 0;
        const dispAntes = Math.max(0, restarDinero(dispTotal, yaUsado));
        if (apostoJuega > dispAntes + 0.001) {
          const montoAceptado = dispAntes;
          const montoExcedido = restarDinero(apostoJuega, montoAceptado);
          observacionesOrdenExceso.push({
            orden: ordenJuego,
            jugador: f.cliente,
            jugada: f.caballo ? `${jugo} (${f.caballo})` : jugo,
            montoSolicitado: apostoJuega,
            montoAceptado,
            montoExcedido,
            disponibleAntes: dispAntes,
            motivo:
              dispAntes <= 0
                ? "Sin saldo disponible (S/S) según orden de juego"
                : `Excedido ${Number.isInteger(montoExcedido) ? montoExcedido : montoExcedido.toFixed(2)} sobre su disponible restante`,
          });
        }
        usadoProgresivoPorCliente.set(f.cliente, sumarDinero(yaUsado, apostoJuega));
      }
    }

    riesgoPorCliente.set(f.cliente, sumarDinero(riesgoPorCliente.get(f.cliente) ?? 0, riesgoDeFila(f)));

    if (resultado !== null) {
      netoPorCliente.set(f.cliente, sumarDinero(netoPorCliente.get(f.cliente) ?? 0, resultado));
      lineasCruce.push({ cliente: f.cliente, resultado });
    }
  }

  // Si la modalidad de la carrera es CON CRUCES, calculamos el reembolso de comisión
  // sobre min(brutoGanado, brutoPerdido) y lo sumamos al neto del cliente sin pintar filas CRUCE sueltas.
  if (opciones?.modalidadCruce === "con_cruces" || opciones?.modalidadCruce === true) {
    const comPct = opciones?.comisionPct ?? 5;
    const { porCliente } = _reembolsosCruce(lineasCruce, "con_cruces", comPct);
    for (const [, info] of porCliente) {
      if (info.reembolsoCruce > 0) {
        const actual = netoPorCliente.get(info.cliente) ?? 0;
        netoPorCliente.set(info.cliente, sumarDinero(actual, info.reembolsoCruce));
      }
    }
  }

  const notaExcedidos: NotaExcedido[] = [];

  const filaResumen = (nombre: string, monto: number, id: number) => {
    const riesgo = redondearCentavos(riesgoPorCliente.get(nombre) ?? 0);
    const disp = disponibleDe?.(nombre);
    const hayTope = typeof disp === "number" && Number.isFinite(disp);
    const excede = hayTope && riesgo > (disp as number) + 0.001;
    if (excede) notaExcedidos.push({ nombre, riesgo, disponible: disp as number });
    return { id, nombre, monto: redondearCentavos(monto), riesgo, excede };
  };

  const gananRaw = [] as Array<{ nombre: string; neto: number; fila: ReporteCarreraDatos["resumen"]["ganan"][number] }>;
  const pierdenRaw = [] as Array<{ nombre: string; neto: number; fila: ReporteCarreraDatos["resumen"]["pierden"][number] }>;

  for (const [nombre, neto] of netoPorCliente) {
    if (neto > 0) {
      gananRaw.push({ nombre, neto, fila: filaResumen(nombre, neto, 0) });
    } else if (neto < 0) {
      pierdenRaw.push({ nombre, neto, fila: filaResumen(nombre, neto, 0) });
    }
  }

  gananRaw.sort((a, b) => {
    const rb = b.neto - a.neto;
    if (Math.abs(rb) > 1e-6) return rb > 0 ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });
  pierdenRaw.sort((a, b) => {
    const rb = a.neto - b.neto;
    if (Math.abs(rb) > 1e-6) return rb > 0 ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  const ganan = gananRaw.map((x, i) => ({ ...x.fila, id: i + 1 }));
  const pierden = pierdenRaw.map((x, i) => ({ ...x.fila, id: i + 1 }));

  return {
    encabezado: {
      grupo,
      logoGrupo: opciones?.logoGrupo ?? null,
      hipodromo: c.hipodromo,
      logoHipodromo: opciones?.logoHipodromo ?? null,
      carrera: `Carrera ${c.numero}`,
      fecha: diaLegible(c.fecha),
      llegada: puestos.map((puesto, idx) => ({
        numero: puesto,
        puesto: `${idx + 1}º`,
        color: colorDiscoNumero(puesto),
      })),
    },
    liquidada: opciones?.liquidada !== false,
    filtroModalidad: filtro,
    jugadasVivo,
    adelantadas,
    resumen: { ganan, pierden },
    notaExcedidos,
    observacionesOrdenExceso,
  };
}
