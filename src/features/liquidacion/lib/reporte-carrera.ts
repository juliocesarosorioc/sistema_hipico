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
import type { ReporteCarreraDatos, JugadaVivo, Adelantada } from "@/features/saldos/components/ReporteCarrera";
import type { CarreraReporte } from "@/features/liquidacion/lib/reportes";
import { colorDiscoNumero } from "@/features/saldos/lib/discos";

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

/** El "DA" (cliente que consigue) de cada índice de ticket. */
function consiguePorJuega(c: CarreraReporte): Map<string, { cliente: string; resultado: number }> {
  const mapa = new Map<string, { cliente: string; resultado: number }>();
  for (const f of c.filas) {
    const i = indiceTicketDe(f.id);
    if (!i || !f.id.endsWith(`-c-${i}`)) continue; // solo filas "Consigue"
    mapa.set(i, { cliente: f.cliente, resultado: f.resultado ?? 0 });
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
export function armarReporteCarrera(c: CarreraReporte, grupo?: string): ReporteCarreraDatos {
  const puestos = (c.pizarra ?? "").split(/\s*·\s*/).filter(Boolean);
  const consigue = consiguePorJuega(c);

  const jugadasVivo: JugadaVivo[] = [];
  const adelantadas: { tablas: Adelantada[]; marcas: Adelantada[]; tercios: Adelantada[] } = {
    tablas: [],
    marcas: [],
    tercios: [],
  };
  const netoPorCliente = new Map<string, number>();
  let correlativo = 0;

  for (const f of c.filas) {
    if (f.rol === "CRUCE") continue;
    const resultado = f.resultado; // number | null (null = pendiente)
    if (f.rol !== "Consigue") {
      // Solo la fila del que JUEGA va a la tabla "en vivo"; su pareja
      // (Consigue) ya viaja como DA. Las dos mitades igual suman al resumen.
      const i = indiceTicketDe(f.id) ?? `t-${correlativo++}`;
      const da = consigue.get(i)?.cliente ?? "";
      jugadasVivo.push({ juega: f.cliente, jugo: f.jugada, caballo: f.caballo, aposto: f.monto, da, resultado });
    }

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

  const ganan: ReporteCarreraDatos["resumen"]["ganan"] = [];
  const pierden: ReporteCarreraDatos["resumen"]["pierden"] = [];
  for (const [nombre, neto] of netoPorCliente) {
    if (neto > 0) {
      ganan.push({ id: ganan.length + 1, nombre, monto: neto });
    } else if (neto < 0) {
      pierden.push({ id: pierden.length + 1, nombre, monto: neto });
    }
  }

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
  };
}