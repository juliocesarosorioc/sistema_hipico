// ============================================================================
// SIMULACION DE club_liquidar_marca (sql/marcas_venta.sql)
//
// No hay Postgres en esta maquina, asi que la funcion no se puede ejecutar. Esta
// simulacion replica su LOGICA linea por linea para poder correr los casos y
// detectar errores de decision (los caros: cobrar a un ganador por perdida,
// reintegrar dos veces, contar mal) antes de que el SQL toque plata real.
//
// Si cambias la funcion, cambia esto. Si divergen, la simulacion miente.
// ============================================================================

export type CaballoCarrera = {
  numero: string;
  retirado: boolean;
  ganador: boolean;
};

export type ResultadoCarrera = {
  orden_llegada: Array<{ numero: string; puesto: number }>;
  /** `resultados_carreras.retirados`: texto libre ("4", "4, 7", "NO HUBO RETIROS"). */
  retirados: string | null;
  /** `resultados_carreras.caballos[].retirado`: la verdad por caballo. */
  caballos?: CaballoCarrera[];
};

export type TicketMarca = {
  id: number;
  cliente: string;
  saldo: number;
  caballo: string;
  rivales: string[];
  monto: number;
  estado: string;
  premio_pagar: number;
  monto_decidido: number;
  comision_pagada: number;
};

export class ErrorLiquidacion extends Error {
  movioAlguien: boolean;
  constructor(msg: string) {
    super(msg);
    this.movioAlguien = false;
  }
}

// --- helpers: espejo de las expresiones del SQL --------------------------------

/** regexp_matches(texto,'[0-9]+','g') -> array de tokens. */
function tokensNumeros(texto: string | null): string[] {
  return String(texto ?? "").match(/[0-9]+/g) ?? [];
}

/** jsonb_object_agg(numero, puesto). */
function indicePuestos(orden: Array<{ numero: string; puesto: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of orden) {
    const n = String(e.numero ?? "").trim();
    if (n) out[n] = Number(e.puesto);
  }
  return out;
}

/**
 * club_registrar_orden_llegada: normaliza las 3 formas aceptadas a
 * [{numero, puesto}]. Rechaza vacio / sin puesto, igual que la RPC.
 */
export function normalizarOrden(orden: unknown): Array<{ numero: string; puesto: number }> {
  if (!Array.isArray(orden) || orden.length === 0) {
    throw new Error("El orden de llegada no puede estar vacio.");
  }
  let items: Array<Record<string, unknown>>;
  const primero = orden[0] as Record<string, unknown>;
  if (typeof primero === "object" && primero !== null && "puesto" in primero) {
    items = orden as Array<Record<string, unknown>>;
  } else {
    // la posicion en el array ES el puesto (ordinality)
    items = (orden as unknown[]).map((e, i) => ({
      numero: typeof e === "object" && e !== null ? (e as Record<string, unknown>).numero : e,
      puesto: i + 1,
    }));
  }
  const norm = items
    .filter((e) => String(e.numero ?? "").trim() !== "" && e.puesto != null && String(e.puesto) !== "")
    .map((e) => ({ numero: String(e.numero).trim(), puesto: Number(e.puesto) }));
  if (norm.length === 0) throw new Error("El orden de llegada no contiene ningun caballo con puesto.");
  return norm;
}

/**
 * Etrados de la carrera, por TIENDA DE ORIGEN (no por deducir un numero suelto):
 *   - `caballos[].retirado` es el flag por caballo de la carrera REGISTRADA: es
 *     la verdad. Se lee primero.
 *   - `retirados` es el texto libre que la base guarda aparte. Se acepta como
 *     respaldo, parseando tokens exactos para que el 4 no coincida con el 14.
 *   La union de ambos cubre las carreras migradas de una epoca y las nuevas.
 */
function withdrawnSet(resultado: ResultadoCarrera): Set<string> {
  const set = new Set<string>();
  for (const c of resultado.caballos ?? []) {
    if (c.retirado === true) {
      const n = String(c.numero ?? "").trim();
      if (n) set.add(n);
    }
  }
  for (const t of tokensNumeros(resultado.retirados)) set.add(String(t).trim());
  return set;
}

/**
 * Espejo de club_liquidar_marca. Mueve `saldo` de cada cliente en el sitio.
 * Aborta (throw) sin mover saldo si un ticket no se puede decidir.
 *
 * Retiro: la jugada ANULA y el ticket queda solo como registro informatico
 * (`estado='Retirado'`, `premio_pagar=0`, `monto_decidido=0`), igual que hace
 * `club_reembolsar_retirados` en Tablas Fijas. El stake vuelve al cliente, pero
 * eso se refleja en el SALDO y en la auditoria, nunca en el ticket: un ticket
 * anulado con `monto_decidido` en cero es indistinguible de "no se liquido", que
 * es justo lo que un reporte necesita poder distinguir de "perdio".
 */
export function liquidarMarca(
  resultado: ResultadoCarrera,
  tickets: TicketMarca[]
): { liquidados: number; ganadores: number; perdedores: number; reintegrados: number; dinero: number } {
  // --- guarda: sin orden de llegada no se decide nada -------------------------
  if (!resultado.orden_llegada || resultado.orden_llegada.length === 0) {
    throw new Error("La carrera no tiene ORDEN DE LLEGADA.");
  }
  const puestos = indicePuestos(resultado.orden_llegada);
  const retirados = withdrawnSet(resultado);

  let liquidados = 0;
  let ganadores = 0;
  let perdedores = 0;
  let reintegrados = 0;
  let dinero = 0;

  for (const t of tickets) {
    if (t.estado !== "Pendiente") continue;
    liquidados++;

    // 1) el caballo jugado se retiro -> anular y devolver
    if (retirados.has(String(t.caballo).trim())) {
      t.saldo += t.monto;
      dinero += t.monto;
      t.estado = "Retirado";
      t.monto_decidido = 0;
      t.premio_pagar = 0;
      t.comision_pagada = 0;
      reintegrados++;
      continue;
    }

    // 2) puesto del caballo jugado
    const puestoSel = puestos[String(t.caballo).trim()];
    if (puestoSel == null) {
      throw new Error(`El caballo ${t.caballo} del ticket ${t.id} no aparece en el orden de llegada.`);
    }

    // 3) rivales del snapshot
    let gana = true;
    let anulado = false;
    for (const r0 of t.rivales) {
      const rival = String(r0).trim();

      // rival retirado -> anular y devolver, y NO caer en la rama de perdedor
      if (retirados.has(rival)) {
        gana = false;
        anulado = true;
        t.saldo += t.monto;
        dinero += t.monto;
        t.estado = "Retirado";
        t.monto_decidido = 0;
        t.premio_pagar = 0;
        t.comision_pagada = 0;
        reintegrados++;
        break;
      }

      const pRival = puestos[rival];
      if (pRival == null) {
        throw new Error(`El rival ${rival} (contra el que juega el ticket ${t.id}) no aparece en el orden de llegada.`);
      }
      if (pRival < puestoSel) gana = false;
    }

    if (anulado) continue;

    // 4) gana -> se acredita el BRUTO (220/120)
    if (gana) {
      const bruto = Math.round(t.monto * 220 * 100 / 120) / 100;
      t.saldo += bruto;
      dinero += bruto;
      t.estado = "Ganador";
      t.premio_pagar = bruto;
      t.monto_decidido = bruto;
      ganadores++;
    } else {
      t.estado = "Perdedor";
      t.premio_pagar = 0;
      t.monto_decidido = 0;
      perdedores++;
    }
  }

  return { liquidados, ganadores, perdedores, reintegrados, dinero };
}
