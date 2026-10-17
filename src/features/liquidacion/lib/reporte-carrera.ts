/**
 * REPORTE DE CARRERA — arma la plantilla de liquidación (ReporteCarrera) con
 * datos REALES de una carrera ya pagada.
 *
 * Módulo PURO (sin I/O ni React): recibe una `CarreraReporte` — la que ya
 * produce el motor oficial de `src/lib/liquidacion/reportes.ts` con las filas
 * liquidadas (estado, premio neto, cruce financiero) — y la traduce a
 * `ReporteCarreraDatos`, el contrato de la plantilla imprimible.
 *
 * Se usa en dos puntos:
 *   · Selector de Saldos/Reportes (elegís grupo → día → hipódromo → carrera).
 *   · «Ver Reporte de Liquidación» en PagarCarreraModal, apenas se paga.
 *
 * Convención del pareo JUEGA ↔ DA: `carreraReporte` graba cada ticket como
 * dos filas con id `${fecha}-${hipodromo}-${numero}-j-${i}` (el que JUEGA) y
 * `…-c-${i}` (el que CONSIGUE/DA). Se parean por el índice `i`.
 */
import type { ReporteCarreraDatos, JugadaVivo, Adelantada, NotaExcedido } from "@/features/saldos/components/ReporteCarrera";
import type { CarreraReporte, FilaReporte } from "@/features/liquidacion/lib/reportes";
import { colorDiscoNumero } from "@/features/saldos/lib/discos";
import { etiquetaJugada } from "@/features/taquilla/lib/nomenclatura";

// Los colores del disco de ejemplar viven en `saldos/lib/discos.ts` (los usan
// el armado y la plantilla). Se re-exportan para no romper importadores viejos.
export { colorDiscoNumero };

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

/** El "DA" (cliente que consigue) de cada índice de ticket, con lo que arriesga. */
function consiguePorJuega(c: CarreraReporte): Map<string, { cliente: string; resultado: number; riesgo: number }> {
  const mapa = new Map<string, { cliente: string; resultado: number; riesgo: number }>();
  for (const f of c.filas) {
    const i = indiceTicketDe(f.id);
    if (!i || !f.id.endsWith(`-c-${i}`)) continue; // solo filas "Consigue"
    // `riesgoDeFila` del lado "da": su parte de la proporción (monto·b/a), no el
    // neto del que juega. Es el APOSTÓ del DA que pide el reporte.
    mapa.set(i, { cliente: f.cliente, resultado: f.resultado ?? 0, riesgo: riesgoDeFila(f) });
  }
  return mapa;
}

/** Tipo de jugada → sección de «Parada Adelantadas» para las que ganaron. */
function seccionAdelantadaDe(jugada: string): "tablas" | "marcas" | "tercios" | null {
  const t = String(jugada ?? "").toUpperCase();
  if (/^TABLA/.test(t)) return "tablas";
  if (/^MARCAS?/.test(t)) return "marcas";
  if (/TERCIO|^T\d{1,2}\b|3Y3/.test(t)) return "tercios";
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
 * lado de la proporción (`monto · b/a`), que no es el neto del que juega. Sin
 * proporción (PP 10/10, MATCH sin fracción) los dos arriesgan lo mismo.
 */
export function riesgoDeFila(f: FilaReporte): number {
  if (f.rol === "CRUCE") return 0;
  if (f.rol === "Consigue") {
    const p = proporcionDe(f.jugada);
    if (p) return Math.round(((f.monto * p.b) / p.a) * 100) / 100;
  }
  return f.monto;
}

/**
 * Traduce una carrera liquidada a los datos de la plantilla de reporte.
 *
 * Reglas del armado:
 *   · "En vivo": UNA fila por ticket (la del que JUEGA), con su pareja como
 *     DA cuando la jugada tiene dos clientes (lo que da o va a los otros
 *     ejemplares) y el/los ejemplar(es) de la jugada para pintarlos con color.
 *     Se saltan las filas 🔀 CRUCE.
 *   · "Parada Adelantadas": las filas GANADORAS (resultado > 0) según el tipo
 *     de jugada (Tablas Fijas / Marcas / Tercios).
 *   · "Resumen": neto acumulado por cliente (positivo → Ganan, negativo →
 *     Pierden). Los tickets PENDIENTES (resultado null) NO entran al resumen:
 *     antes caían en «Ganan 0.00» y vaciaban la columna «Pierden».
 */
export function armarReporteCarrera(
  c: CarreraReporte,
  grupo?: string,
  disponibleDe?: (nombre: string) => number | null | undefined
): ReporteCarreraDatos {
  const puestos = (c.pizarra ?? "").split(/\s*·\s*/).filter(Boolean);
  const consigue = consiguePorJuega(c);

  const jugadasVivo: JugadaVivo[] = [];
  const adelantadas: { tablas: Adelantada[]; marcas: Adelantada[]; tercios: Adelantada[] } = {
    tablas: [],
    marcas: [],
    tercios: [],
  };
  const netoPorCliente = new Map<string, number>();
  // Ítem 10: total que financia cada jugador en la carrera (bruto de su lado).
  const riesgoPorCliente = new Map<string, number>();
  let correlativo = 0;

  for (const f of c.filas) {
    if (f.rol === "CRUCE") continue;
    const resultado = f.resultado; // number | null (null = pendiente)
    if (f.rol !== "Consigue") {
      // Solo la fila del que JUEGA va a la tabla "en vivo"; su pareja
      // (Consigue) ya viaja como DA. Las dos mitades igual suman al resumen.
      const i = indiceTicketDe(f.id) ?? `t-${correlativo++}`;
      const cons = consigue.get(i);
      const da = cons?.cliente ?? "";
      // `etiquetaJugada` rotula "PP" un MATCH sin fracción (nunca "10/10"); los
      // ejemplares viajan en `caballo` y la plantilla los pinta "1 × 8" con el
      // DA al lado, distinguiendo quién juega uno y quién el otro.
      // APOSTÓ de cada lado: el que JUEGA arriesga su monto; el que DA arriesga
      // su parte de la proporción (null cuando la jugada no tiene par).
      jugadasVivo.push({
        juega: f.cliente,
        aposto: riesgoDeFila(f),
        jugo: etiquetaJugada(f.jugada),
        caballo: f.caballo,
        da,
        apostoDa: cons ? cons.riesgo : null,
        resultado,
      });
    }

    // El riesgo se acumula para TODA fila decidida o no: "cuánto arriesgó" no
    // depende de si la jugada ya se liquidó.
    riesgoPorCliente.set(f.cliente, (riesgoPorCliente.get(f.cliente) ?? 0) + riesgoDeFila(f));

    // Los pendientes (resultado null) no suman a nadie: quedan fuera del resumen.
    if (resultado !== null) {
      netoPorCliente.set(f.cliente, (netoPorCliente.get(f.cliente) ?? 0) + resultado);
    }

    // «Parada Adelantadas»: la mitad del JUEGA que ganó, por tipo de jugada.
    if (resultado !== null && resultado > 0 && f.rol !== "Consigue") {
      const seccion = seccionAdelantadaDe(f.jugada);
      if (seccion) {
        adelantadas[seccion].push({ juega: f.cliente, descripcion: f.caballo || undefined, resultado });
      }
    }
  }

  const notaExcedidos: NotaExcedido[] = [];

  /** Arma una fila del resumen con su riesgo y el flag de exceso (ítem 10). */
  const filaResumen = (nombre: string, monto: number, id: number) => {
    const riesgo = Math.round((riesgoPorCliente.get(nombre) ?? 0) * 100) / 100;
    const disp = disponibleDe?.(nombre);
    const hayTope = typeof disp === "number" && Number.isFinite(disp);
    const excede = hayTope && riesgo > (disp as number) + 0.001;
    if (excede) notaExcedidos.push({ nombre, riesgo, disponible: disp as number });
    return { id, nombre, monto, riesgo, excede };
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
    const rb = a.neto - b.neto; // más pierde (más negativo) primero
    if (Math.abs(rb) > 1e-6) return rb > 0 ? 1 : -1;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  const ganan = gananRaw.map((x, i) => ({ ...x.fila, id: i + 1 }));
  const pierden = pierdenRaw.map((x, i) => ({ ...x.fila, id: i + 1 }));

  return {
    encabezado: {
      grupo,
      hipodromo: c.hipodromo,
      carrera: `Carrera ${c.numero}`,
      fecha: diaLegible(c.fecha),
      llegada: puestos.map((puesto, idx) => ({
        numero: puesto,
        puesto: `${idx + 1}º`,
        color: colorDiscoNumero(puesto),
      })),
    },
    jugadasVivo,
    adelantadas,
    resumen: { ganan, pierden },
    notaExcedidos,
  };
}