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
import { resolverContraparteModalidad } from "@/features/liquidacion/lib/etiquetas-reporte";
import { redondearCentavos, restarDinero, sumarDinero } from "@/shared/lib/dinero";
import {
  _reembolsosCruce,
  normalizarNombreCliente,
  type ModalidadCruceCarrera,
} from "@/features/taquilla/lib/cruces-y-tapas";
import { calcularEstadoCuentaCliente, calcularResumenContableCliente } from "@/features/saldos/lib/contabilidad-central";
import { resolverSeudonimoClienteSync, obtenerMapaSeudonimosClientesSync } from "@/features/clientes/lib/clientes";

export { colorDiscoNumero, calcularEstadoCuentaCliente, calcularResumenContableCliente };
export {
  bloqueSaldos,
  construirMensajeResultadosAgente,
  MENSAJE_PIZARRA_ANULADA,
} from "@/features/liquidacion/lib/agente-pizarra";

/**
 * Asiento contable interno de carrera: "Bono por Cruce de jugadas".
 * No se visualiza como fila en la tabla de jugadas del reporte, pero sí se
 * contabiliza en el resultado final de cada jugador (🟢 Ganan / 🔴 Pierden).
 */
export type AsientoBonoCruceCarrera = {
  concepto: "Bono por Cruce de jugadas";
  cliente: string;
  brutoGanado: number;
  brutoPerdido: number;
  baseCruce: number;
  bonoCruce: number;
};

export type CategoriaJugadaAdelantada =
  | "tercios"
  | "marcas"
  | "tablas"
  | "remates"
  | "dupletas";

export const SECCIONES_JUGADAS_ADELANTADAS: ReadonlyArray<{
  id: CategoriaJugadaAdelantada;
  titulo: string;
}> = [
  { id: "tercios", titulo: "Jugadas entre tercios" },
  { id: "marcas", titulo: "Marcas Adelantadas" },
  { id: "tablas", titulo: "Tablas Adelantadas" },
  { id: "remates", titulo: "Remates Adelantados" },
  { id: "dupletas", titulo: "Dupletas Adelantadas" },
];

/**
 * Clasifica una jugada adelantada en una de las 5 secciones oficiales:
 *   1. Jugadas entre tercios (`tercios`)
 *   2. Marcas Adelantadas (`marcas`)
 *   3. Tablas Adelantadas (`tablas`)
 *   4. Remates Adelantados (`remates`)
 *   5. Dupletas Adelantadas (`dupletas`)
 */
export function categoriaJugadaAdelantada(entrada: unknown): CategoriaJugadaAdelantada {
  const raw =
    entrada && typeof entrada === "object"
      ? ((entrada as { jugo?: unknown; jugada?: unknown }).jugo ??
          (entrada as { jugada?: unknown }).jugada ??
          "")
      : entrada;
  const t = String(raw ?? "").trim().toUpperCase();
  if (/^MARCA\b/.test(t) || t.includes("MARCA")) return "marcas";
  if (/^TABLA\b|^TF\b/.test(t) || t.includes("TABLA")) return "tablas";
  if (/^(REMATE|POLLA)\b/.test(t) || t.includes("REMATE")) return "remates";
  if (/^DUPLETA\b/.test(t) || t.includes("DUPLETA")) return "dupletas";
  return "tercios";
}

/**
 * Agrupa las jugadas adelantadas en las 5 secciones oficiales (devolviendo
 * únicamente las secciones que tienen al menos 1 jugada: "Si las hay").
 */
export function agruparAdelantadasPorSeccion<T extends { jugo?: string; jugada?: string }>(
  filas: T[]
): Array<{ id: CategoriaJugadaAdelantada; categoria: CategoriaJugadaAdelantada; titulo: string; filas: T[] }> {
  const mapa = new Map<CategoriaJugadaAdelantada, T[]>();
  for (const s of SECCIONES_JUGADAS_ADELANTADAS) {
    mapa.set(s.id, []);
  }
  for (const f of filas ?? []) {
    const cat = categoriaJugadaAdelantada(f.jugo ?? f.jugada ?? "");
    mapa.get(cat)!.push(f);
  }
  return SECCIONES_JUGADAS_ADELANTADAS.map((s) => ({
    id: s.id,
    categoria: s.id,
    titulo: s.titulo,
    filas: mapa.get(s.id) ?? [],
  })).filter((s) => s.filas.length > 0);
}

/**
 * Determina si una fila de `JugadaVivo` pertenece a la sección de Jugadas Adelantadas
 * (`esAdelantada === true`, `MARCA`, `TABLA FIJA`, `TABLA`, `REMATE`, `TERCIO`, etc.).
 * Las jugadas adelantadas NUNCA deben aparecer en la sección de Jugadas en Vivo.
 */
export function esJugadaAdelantadaReporte(j: {
  jugo?: string;
  jugada?: string;
  esAdelantada?: boolean;
}): boolean {
  if (j.esAdelantada) return true;
  const t = String(j.jugo ?? j.jugada ?? "").trim().toUpperCase();
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
  if (typeof f.riesgo === "number" && Number.isFinite(f.riesgo) && f.riesgo >= 0) {
    return redondearCentavos(f.riesgo);
  }
  if (f.rol === "Consigue") {
    if (f.tipoJugada === "MARCA" || /^MARCAS?\b/i.test(String(f.jugada ?? "").trim())) {
      return redondearCentavos((f.monto * 5) / 6);
    }
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
  /** Lookup opcional de teléfono limpio por nombre de cliente para menciones @número en observaciones. */
  telefonoDe?: (nombre: string) => string | null | undefined;
  /** Observaciones adicionales de jugadas recortadas por exceso de saldo durante la carga. */
  observacionesExcesoExtra?: ObservacionOrdenExceso[];
  /** Mapa explícito de resolución de seudónimos (id/nombre -> seudónimo). */
  mapaSeudonimos?: Map<string, string>;
  /** Cartera de clientes para enriquecer el mapa de seudónimos. */
  clientes?: Array<{ id?: string | number; nombre?: string | null; seudonimo?: string | null }>;
};

export function armarReporteCarrera(
  c: CarreraReporte,
  grupo?: string,
  disponibleDe?: (nombre: string) => number | null | undefined,
  opciones?: OpcionesReporteCarrera
): ReporteCarreraDatos {
  let puestos = (c.pizarra ?? "")
    .replace(/["'{}]/g, "")
    .split(/[\s·,\/\-]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  let puestosRaya = (c.pizarraRaya ?? "")
    .replace(/["'{}]/g, "")
    .split(/[\s·,\/\-]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));

  // Fallback de contingencia: si la pizarra no viene explícita pero hay jugadas ganadoras con resultado neto > 0
  if (puestos.length === 0 && Array.isArray(c.filas)) {
    const ganadoresFilas = new Set<string>();
    for (const f of c.filas) {
      if (f.rol === "Juega" && (f.resultado ?? 0) > 0 && f.jugada !== "🔀 CRUCE") {
        const cab = String(f.caballo ?? "").trim();
        if (cab && /^\d+$/.test(cab)) ganadoresFilas.add(cab);
      }
    }
    if (ganadoresFilas.size > 0) {
      puestos = [...ganadoresFilas];
      puestosRaya = puestos;
    }
  }

  const consigue = consiguePorJuega(c);

  const mapaSeud = new Map<string, string>();
  const syncMap = obtenerMapaSeudonimosClientesSync();
  if (syncMap) {
    for (const [k, v] of syncMap) mapaSeud.set(k, v);
  }
  if (opciones?.mapaSeudonimos) {
    for (const [k, v] of opciones.mapaSeudonimos) mapaSeud.set(k, v);
  }
  if (Array.isArray(opciones?.clientes)) {
    for (const cli of opciones.clientes) {
      const alias = String(cli.seudonimo || cli.nombre || "").trim();
      if (!alias) continue;
      if (cli.id != null) {
        mapaSeud.set(String(cli.id), alias);
        mapaSeud.set(String(cli.id).toLowerCase(), alias);
      }
      if (cli.nombre) {
        mapaSeud.set(String(cli.nombre).trim(), alias);
        mapaSeud.set(String(cli.nombre).trim().toUpperCase(), alias);
        mapaSeud.set(normalizarNombreCliente(cli.nombre), alias);
      }
      if (cli.seudonimo) {
        mapaSeud.set(String(cli.seudonimo).trim(), alias);
        mapaSeud.set(String(cli.seudonimo).trim().toUpperCase(), alias);
        mapaSeud.set(normalizarNombreCliente(cli.seudonimo), alias);
      }
    }
  }

  const resolverAlias = (identidad: unknown, id?: unknown): string => {
    const raw = String(identidad ?? "").trim();
    if (!raw || raw === "—" || raw === "-") return raw;
    if (id != null) {
      const porId = resolverSeudonimoClienteSync(String(id), mapaSeud);
      if (porId && porId !== String(id)) return porId;
    }
    return resolverSeudonimoClienteSync(raw, mapaSeud);
  };

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
  const nombreVisiblePorClave = new Map<string, string>();
  const identidadPorNombre = new Map<string, string>();
  const identidadPorId = new Map<string, string>();
  const lineasCruce: Array<{
    cliente: string;
    clienteId?: string;
    resultado: number;
    comisionCobrada?: number;
    comisionPct?: number;
  }> = [];
  const observacionesOrdenExceso: ObservacionOrdenExceso[] = [];
  const usadoProgresivoPorCliente = new Map<string, number>();

  const registrarNombreCliente = (raw: string, clienteId?: string): string => {
    const alias = resolverAlias(raw, clienteId);
    const nombreNormalizado = normalizarNombreCliente(alias || raw);
    const idNormalizado = String(clienteId ?? "").trim();
    const clave = idNormalizado
      ? identidadPorId.get(idNormalizado.toUpperCase()) ?? `id:${idNormalizado.toUpperCase()}`
      : nombreNormalizado
        ? identidadPorNombre.get(nombreNormalizado) ?? `nombre:${nombreNormalizado}`
        : "";
    if (!clave) return "";
    const existente = nombreVisiblePorClave.get(clave);
    const nombreElegido = alias || String(raw ?? "").trim();
    if (!existente) {
      nombreVisiblePorClave.set(clave, nombreElegido);
    } else {
      const idRaw = String(clienteId ?? "").trim();
      const esAliasExplicito =
        (idRaw && (mapaSeud.has(idRaw) || mapaSeud.has(idRaw.toLowerCase()))) ||
        (raw && (mapaSeud.has(String(raw).trim()) || mapaSeud.has(normalizarNombreCliente(raw))));
      if (esAliasExplicito) {
        nombreVisiblePorClave.set(clave, nombreElegido);
      } else if (existente === existente.toLowerCase() && nombreElegido === nombreElegido.toUpperCase()) {
        nombreVisiblePorClave.set(clave, nombreElegido);
      }
    }
    if (nombreNormalizado && !idNormalizado) identidadPorNombre.set(nombreNormalizado, clave);
    if (idNormalizado) identidadPorId.set(idNormalizado.toUpperCase(), clave);
    return clave;
  };

  let correlativo = 0;
  let ordenJuego = 0;
  const filtro: FiltroModalidadTiempo = opciones?.filtroModalidad ?? "TODAS";

  for (const f of c.filas) {
    if (
      f.rol === "CRUCE" ||
      (f.tipoJugada as string) === "INCENTIVO" ||
      (f.tipoJugada as string) === "DEVOLUCION" ||
      /INCENTIVO|DEVOLUCION/i.test(f.jugada ?? "")
    ) {
      continue;
    }
    if (!pasaFiltroModalidad({ es_adelantada: f.esAdelantada }, filtro)) continue;
    const resultado = f.resultado; // number | null (null = pendiente)
    const claveCliente = registrarNombreCliente(f.cliente, f.clienteId);
    if (f.rol !== "Consigue") {
      ordenJuego += 1;
      const i = indiceTicketDe(f.id) ?? `t-${correlativo++}`;
      const cons = consigue.get(i);
      const consCliente = cons ? resolverAlias(cons.cliente) : "";
      const da = resolverContraparteModalidad(f.jugada, consCliente, f.tipoJugada);
      const jugo =
        f.tipoJugada === "MARCA" || f.tipoJugada === "TABLA"
          ? f.jugada
          : etiquetaJugada(f.jugada);

      const apostoJuega = riesgoDeFila(f);
      const apostoDa = cons ? cons.riesgo : null;
      const resultadoDa = cons ? cons.resultado : null;

      const filaVivo: JugadaVivo = {
        juega: resolverAlias(f.cliente, f.clienteId),
        aposto: apostoJuega,
        jugo,
        caballo: f.caballo,
        ...(f.precioTabla !== undefined ? { precioTabla: f.precioTabla } : {}),
        da,
        apostoDa,
        resultado,
        resultadoDa,
        ...(f.esAdelantada ? { esAdelantada: true } : {}),
        ...(f.esRetirado ? { esRetirado: true } : {}),
        ...(f.horaCarga ? { horaCarga: f.horaCarga } : {}),
      };

      jugadasVivo.push(filaVivo);

      const seccion = seccionAdelantadaDe(f.jugada, f.tipoJugada);
      // Las jugadas adelantadas (tablas incluidas) deben aparecer en su sección
      // siempre que se liquide, aunque el resultado sea 0 o pendiente.
      if (seccion) {
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
      const dispTotal = disponibleDe?.(f.cliente) ?? disponibleDe?.(claveCliente);
      if (typeof dispTotal === "number" && Number.isFinite(dispTotal) && apostoJuega > 0 && claveCliente) {
        const yaUsado = usadoProgresivoPorCliente.get(claveCliente) ?? 0;
        const dispAntes = Math.max(0, restarDinero(dispTotal, yaUsado));
        if (apostoJuega > dispAntes + 0.001) {
          const montoAceptado = dispAntes;
          const montoExcedido = restarDinero(apostoJuega, montoAceptado);
          const nombreJug1 = nombreVisiblePorClave.get(claveCliente) ?? f.cliente;
          const nombreJug2 = da || "Banca";
          const tel1 = (opciones?.telefonoDe?.(nombreJug1) ?? "").replace(/\D+/g, "");
          const tel2 = (opciones?.telefonoDe?.(nombreJug2) ?? "").replace(/\D+/g, "");
          const menc1 = tel1 ? `@${tel1} (${nombreJug1})` : `@${nombreJug1}`;
          const menc2 = tel2 ? `@${tel2} (${nombreJug2})` : `@${nombreJug2}`;
          const etiquetaJug = f.caballo ? `${jugo} (${f.caballo})` : jugo;
          const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
          observacionesOrdenExceso.push({
            orden: ordenJuego,
            jugador: nombreJug1,
            contraparte: nombreJug2,
            telefonoJugador: tel1 || null,
            telefonoContraparte: tel2 || null,
            jugada: etiquetaJug,
            montoSolicitado: apostoJuega,
            montoAceptado,
            montoExcedido,
            disponibleAntes: dispAntes,
            motivo:
              dispAntes <= 0
                ? `Sin saldo disponible (S/S) según orden de juego`
                : `Excedido ${fmtNum(montoExcedido)} sobre su disponible restante`,
            resumenMencion: `${menc1} pidió ${fmtNum(apostoJuega)} con ${menc2} en ${etiquetaJug} → solo juegan ${fmtNum(montoAceptado)} porque ${nombreJug1} excede el saldo (disp. ${fmtNum(dispAntes)}).`,
          });
        }
        usadoProgresivoPorCliente.set(claveCliente, sumarDinero(yaUsado, apostoJuega));
      }
    }

    if (claveCliente) {
      riesgoPorCliente.set(claveCliente, sumarDinero(riesgoPorCliente.get(claveCliente) ?? 0, riesgoDeFila(f)));

      if (resultado !== null) {
        netoPorCliente.set(claveCliente, sumarDinero(netoPorCliente.get(claveCliente) ?? 0, resultado));
        lineasCruce.push({
          cliente: nombreVisiblePorClave.get(claveCliente) ?? f.cliente,
          ...(f.clienteId ? { clienteId: f.clienteId } : {}),
          resultado,
          comisionCobrada: f.comisionCobrada,
          comisionPct: opciones?.comisionPct,
        });
      }
    }
  }

  // Asiento contable interno por carrera: "Bono por Cruce de jugadas".
  // Habilitado por defecto salvo que explícitamente se indique `modalidadCruce: "sin_cruces"` o `false`.
  const conCruces = opciones?.modalidadCruce !== "sin_cruces" && opciones?.modalidadCruce !== false;
  const asientosBonoCruce: AsientoBonoCruceCarrera[] = [];
  if (conCruces) {
    const comPct = opciones?.comisionPct ?? 5;
    const { porCliente } = _reembolsosCruce(lineasCruce, "con_cruces", comPct);
    for (const [claveCruce, info] of porCliente) {
      if (info.reembolsoCruce > 0) {
        // El reembolso reduce la comisión efectiva: se acredita una sola vez al
        // neto consolidado, además de conservarse como asiento auditable.
        const claveIdentidad = info.clienteId
          ? identidadPorId.get(info.clienteId.toUpperCase())
          : identidadPorNombre.get(normalizarNombreCliente(info.cliente));
        const destino = claveIdentidad ?? `nombre:${claveCruce}`;
        netoPorCliente.set(
          destino,
          sumarDinero(netoPorCliente.get(destino) ?? 0, info.reembolsoCruce)
        );
        asientosBonoCruce.push({
          concepto: "Bono por Cruce de jugadas",
          cliente: nombreVisiblePorClave.get(destino) ?? info.cliente,
          brutoGanado: info.brutoGanado,
          brutoPerdido: info.brutoPerdido,
          baseCruce: info.baseCruce,
          bonoCruce: info.reembolsoCruce,
        });
      }
    }
  }

  const notaExcedidos: NotaExcedido[] = [];

  const filaResumen = (clave: string, monto: number, id: number) => {
    const nombre = nombreVisiblePorClave.get(clave) ?? clave;
    const riesgo = redondearCentavos(riesgoPorCliente.get(clave) ?? 0);
    const disp = disponibleDe?.(nombre) ?? disponibleDe?.(clave);
    const hayTope = typeof disp === "number" && Number.isFinite(disp);
    const excede = hayTope && riesgo > (disp as number) + 0.001;
    if (excede) notaExcedidos.push({ nombre, riesgo, disponible: disp as number });
    return { id, nombre, monto: redondearCentavos(monto), riesgo, excede };
  };

  // ── REGLA ESTRICTA DE TOTALIZACIÓN DE USUARIOS:
  // No puede haber dos usuarios en positivo o dos en negativo o el mismo usuario en negativos y positivos.
  // Solo puede aparecer un usuario con la totalización de sus resultados.
  const consolidadoPorUsuario = new Map<
    string,
    {
      claveOriginal: string;
      nombre: string;
      netoTotal: number;
      riesgoTotal: number;
    }
  >();

  for (const [clave, neto] of netoPorCliente) {
    const rawNombre = nombreVisiblePorClave.get(clave) ?? clave;
    const nombreAlias = resolverAlias(rawNombre);
    const nombreVisible = nombreAlias || rawNombre;
    const nombreNorm = normalizarNombreCliente(nombreVisible);
    const riesgo = riesgoPorCliente.get(clave) ?? 0;

    const existente = consolidadoPorUsuario.get(nombreNorm);
    if (!existente) {
      consolidadoPorUsuario.set(nombreNorm, {
        claveOriginal: clave,
        nombre: nombreVisible,
        netoTotal: neto,
        riesgoTotal: riesgo,
      });
    } else {
      existente.netoTotal = sumarDinero(existente.netoTotal, neto);
      existente.riesgoTotal = sumarDinero(existente.riesgoTotal, riesgo);
      if (nombreVisible && (!existente.nombre || existente.nombre.length < nombreVisible.length)) {
        existente.nombre = nombreVisible;
      }
    }
  }

  const gananRaw = [] as Array<{ nombre: string; neto: number; fila: ReporteCarreraDatos["resumen"]["ganan"][number] }>;
  const pierdenRaw = [] as Array<{ nombre: string; neto: number; fila: ReporteCarreraDatos["resumen"]["pierden"][number] }>;

  for (const [, item] of consolidadoPorUsuario) {
    const netoRedondeado = redondearCentavos(item.netoTotal);
    if (Math.abs(netoRedondeado) < 0.01) {
      // Balance 0: no va ni a ganan ni a pierden
      continue;
    }

    const disp = disponibleDe?.(item.nombre) ?? disponibleDe?.(item.claveOriginal);
    const hayTope = typeof disp === "number" && Number.isFinite(disp);
    const excede = hayTope && item.riesgoTotal > (disp as number) + 0.001;
    if (excede) {
      notaExcedidos.push({ nombre: item.nombre, riesgo: item.riesgoTotal, disponible: disp as number });
    }

    const fila = {
      id: 0,
      nombre: item.nombre,
      monto: netoRedondeado,
      riesgo: redondearCentavos(item.riesgoTotal),
      excede,
    };

    if (netoRedondeado > 0) {
      gananRaw.push({ nombre: item.nombre, neto: netoRedondeado, fila });
    } else {
      pierdenRaw.push({ nombre: item.nombre, neto: netoRedondeado, fila });
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
      ...(puestosRaya.length > 0 && puestosRaya.join(",") !== puestos.join(",")
        ? {
            llegadaRaya: puestosRaya.map((puesto, idx) => ({
              numero: puesto,
              puesto: `${idx + 1}º`,
              color: colorDiscoNumero(puesto),
            })),
          }
        : {}),
      ...(c.retirados && c.retirados.length > 0 ? { retirados: c.retirados } : {}),
    },
    liquidada: opciones?.liquidada !== false,
    filtroModalidad: filtro,
    jugadasVivo,
    adelantadas,
    resumen: { ganan, pierden },
    notaExcedidos,
    observacionesOrdenExceso: [
      ...observacionesOrdenExceso,
      ...(opciones?.observacionesExcesoExtra ?? []),
    ],
    asientosBonoCruce,
  };
}
