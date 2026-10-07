/**
 * ============================================================================
 * REMATES — SERVICIO (acceso a datos)
 * ============================================================================
 *
 * Migración del legacy `js/remates.js`. A diferencia de aquel, los ejemplares
 * del remate salen del PROGRAMA DEL DÍA (resultados_carreras) y no se escriben
 * a mano: ver `listarCarrerasCentrales()` en `@/lib/carreras/central`.
 *
 * Tablas: `remates` (la subasta) y `remate_caballos` (las pujas). El esquema y
 * las policies se aplican con `sql/remates.sql` (manual, en el SQL Editor).
 *
 * La lógica pura (finanzas, derivación de ejemplares, probabilidades) vive en
 * `@/lib/remates/core` y se re-exporta acá para que los consumidores importen
 * un solo módulo.
 */
import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import {
  calcularFinanzasRemate,
  candidatosDelPrograma,
  candidatosJugables,
  resumenPrograma,
  normalizarEscalera,
  estaCerrado,
  autorizarPujaRemate,
  sumarBloqueos,
  type CaballoRemate,
  type Remate,
  type EscalonPuja,
  type ClienteRemate,
} from "@/lib/remates/core";

export * from "@/lib/remates/core";

export type ResRemates = { ok: boolean; datos?: Remate[]; error?: string };
export type ResRemate = { ok: boolean; id?: string; error?: string };
export type ResSimple = { ok: boolean; error?: string };

/** Las escrituras de pujas viven en RPC `security definer` (sql/remate_pujas_rpc.sql). */
const MENSAJE_SIN_RPC_PUJAS =
  "No se encontraron las funciones de pujas de remate. Aplicalas con sql/remate_pujas_rpc.sql.";

/**
 * Traduce el error de PostgREST cuando la RPC de pujas todavía no está aplicada
 * (PGRST202 / "not found") a un mensaje accionable; deja pasar el resto tal cual.
 */
function mensajeErrorPujas(texto: string | undefined, fallback: string): string {
  const t = texto ?? "";
  return /club_(asignar_pujas|pujar_caballo|eliminar_caballo)_remate|not found|404|PGRST202|schema cache/i.test(t)
    ? fallback
    : t || fallback;
}

/** Las escrituras de la subasta viven en RPC (sql/remate_escritura_rpc.sql). */
const MENSAJE_SIN_RPC_REMATE =
  "No se encontraron las funciones del remate. Aplicalas con sql/remate_escritura_rpc.sql.";

/**
 * Traduce el error de PostgREST cuando la RPC de la subasta todavía no está
 * aplicada (PGRST202 / "not found") a un mensaje accionable; deja pasar el resto.
 */
function mensajeErrorRemate(texto: string | undefined, fallback: string): string {
  const t = texto ?? "";
  return /club_(crear|eliminar|guardar_incentivo|guardar_escalera)_remate|not found|404|PGRST202|schema cache/i.test(t)
    ? fallback
    : t || fallback;
}

export type NuevoRemate = {
  nombre: string;
  hipodromo_id: string | number | null;
  /** Nombre del hipódromo. La tabla viva tiene `hipodromo` (text) NOT NULL. */
  hipodromo?: string | null;
  carrera: number | string | null;
  fecha: string;
  hora_cierre?: string | null;
  distancia?: string | null;
  comision_pct?: number;
  incentivo?: number;
  incentivo_pct?: number;
  notas?: string | null;
  /** Grupo de venta del remate (opcional): habilita el banquero de REMATES. */
  grupo_id?: string | null;
};

/** Caballo a asignar al remate (monto + cliente). */
export type PujaRemate = {
  numero: number;
  nombre: string;
  monto_usd: number;
  cliente_id?: string | null;
  ejemplar_numero?: string | null;
};

function normalizarRemate(raw: Record<string, unknown>): Remate {
  const hip = raw.hipodromos as { nombre?: string } | null;
  const numCarrera =
    raw.carrera != null
      ? Number(raw.carrera) || null
      : raw.carrera_num != null
        ? Number(raw.carrera_num) || null
        : null;
  return {
    id: String(raw.id ?? ""),
    nombre: String(raw.nombre ?? "").trim(),
    hipodromo_id: raw.hipodromo_id != null ? String(raw.hipodromo_id) : null,
    hipodromo: hip?.nombre ?? (raw.hipodromo != null ? String(raw.hipodromo) : null),
    carrera: numCarrera,
    fecha: raw.fecha != null ? String(raw.fecha) : null,
    hora_cierre: raw.hora_cierre != null ? String(raw.hora_cierre) : null,
    distancia: raw.distancia != null ? String(raw.distancia) : null,
    comision_pct: raw.comision_pct != null ? Number(raw.comision_pct) : 20,
    incentivo: raw.incentivo != null ? Number(raw.incentivo) : 0,
    incentivo_pct: raw.incentivo_pct != null ? Number(raw.incentivo_pct) : 0,
    notas: raw.notas != null ? String(raw.notas) : null,
    grupo_id: raw.grupo_id != null ? String(raw.grupo_id) : null,
    // La escalera se normaliza al LEERLA: si en la base quedó a medias, el módulo
    // igual tiene que poder pujar con una regla coherente.
    escalera: normalizarEscalera(raw.escalera as EscalonPuja[] | null),
    nota_escalera: raw.nota_escalera != null ? String(raw.nota_escalera) : null,
    estado: raw.estado != null ? String(raw.estado) : "Abierto",
    cerrado_at: raw.cerrado_at != null ? String(raw.cerrado_at) : null,
    liquidado_at: raw.liquidado_at != null ? String(raw.liquidado_at) : null,
    fecha_registro: raw.fecha_registro != null ? String(raw.fecha_registro) : null,
  };
}

/** Lista los remates, del más reciente al más viejo. */
export async function listarRemates(): Promise<ResRemates> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    // `select("*")` tolera que falte una columna opcional (migración a medias).
    const { data, error } = await supabase
      .from("remates")
      .select("*, hipodromos(nombre)")
      .order("fecha_registro", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, datos: (data ?? []).map((r) => normalizarRemate(r as Record<string, unknown>)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Crea un remate. */
export async function crearRemate(input: NuevoRemate): Promise<ResRemate> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const nombre = String(input.nombre ?? "").trim().toUpperCase();
  if (!nombre) return { ok: false, error: "El remate necesita un nombre." };
  if (!input.hipodromo_id) return { ok: false, error: "Elegí el hipódromo." };
  if (!input.fecha) return { ok: false, error: "Elegí la fecha del programa." };
  try {
    // El insert vive en la RPC `security definer`: el navegador ya no escribe
    // `remates` directo (solo tiene SELECT). La RPC valida y normaliza en el
    // servidor y deriva `hipodromo` de `hipodromos` si no viene el nombre.
    const { data, error } = await supabase.rpc("club_crear_remate", {
      p_nombre: nombre,
      p_hipodromo_id: input.hipodromo_id != null ? String(input.hipodromo_id) : null,
      p_hipodromo: input.hipodromo != null ? String(input.hipodromo).trim() : null,
      p_carrera: input.carrera != null ? Number(input.carrera) || null : null,
      p_fecha: input.fecha,
      p_hora_cierre: input.hora_cierre != null ? String(input.hora_cierre) : null,
      p_distancia: input.distancia ?? null,
      p_comision_pct: Number(input.comision_pct ?? 20) || 20,
      p_notas: input.notas ?? null,
      p_grupo_id: input.grupo_id != null && String(input.grupo_id) !== "" ? String(input.grupo_id) : null,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorRemate(error.message, MENSAJE_SIN_RPC_REMATE) };
    const id = (data as { id?: string } | null)?.id;
    return { ok: true, id: id != null ? String(id) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Elimina el remate y, en cascada, sus caballos asignados. */
export async function eliminarRemate(id: string): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_eliminar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    // `remate_caballos` y `remate_pujas` caen por la FK `on delete cascade` que
    // aplica la RPC. El navegador ya no borra `remates` directo (solo SELECT).
    const { error } = await supabase.rpc("club_eliminar_remate", {
      p_remate_id: id,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorRemate(error.message, MENSAJE_SIN_RPC_REMATE) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Caballos (pujas) asignados a un remate. */
export async function listarCaballosRemate(remateId: string): Promise<{ ok: boolean; datos?: CaballoRemate[]; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("remate_caballos")
      .select("*, clientes(nombre)")
      .eq("remate_id", remateId)
      .order("numero", { ascending: true });
    if (error) return { ok: false, error: error.message };
    const datos = (data ?? []).map((r) => {
      const raw = r as Record<string, unknown>;
      const cliente = raw.clientes as { nombre?: string } | null;
      return {
        id: raw.id != null ? String(raw.id) : undefined,
        remate_id: String(raw.remate_id ?? ""),
        numero: Number(raw.numero) || 0,
        nombre: String(raw.nombre ?? "").trim(),
        monto_usd: Number(raw.monto_usd) || 0,
        cliente_id: raw.cliente_id != null ? String(raw.cliente_id) : null,
        cliente: cliente?.nombre ?? null,
        prob_porcentaje: raw.prob_porcentaje != null ? Number(raw.prob_porcentaje) : null,
        prob_implicita: raw.prob_implicita != null ? Number(raw.prob_implicita) : null,
        ejemplar_numero: raw.ejemplar_numero != null ? String(raw.ejemplar_numero) : null,
      } satisfies CaballoRemate;
    });
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Estado real del remate en la base.
 *
 * La UI ya sabe si está cerrado, pero el cierre tiene que valer también si
 * alguien llega al botón por otro camino (o con la pantalla abierta desde antes
 * del cierre): la fila que se va a tocar se comprueba contra la base, no contra
 * lo que la pantalla tenía pintado.
 */
async function leerEstadoRemate(remateId: string): Promise<{ ok: boolean; cerrado?: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase.from("remates").select("estado").eq("id", remateId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, cerrado: estaCerrado(data as { estado?: string | null }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// SALDO: LO QUE QUEDA COMPROMETIDO Y QUIÉN PUEDE COMPRAR
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Plata comprometida por cada cliente en los remates que siguen ABIERTOS.
 *
 * El bloqueo no es una columna que alguien mantiene a mano: se DERIVA de las
 * pujas vivas, así que se mantiene solo — si se le quita el ejemplar al
 * comprador, la fila desaparece y el saldo queda libre; si el remate cierra, ya
 * no cuenta. Un "saldo bloqueado" guardado a mano se desincroniza a la primera
 * puja y termina cobrando dos veces.
 *
 * `excluirRemateId` deja de contar un remate puntual (para ver el disponible de
 * un remate sin que se topen contra sus propias pujas).
 */
export async function listarSaldosBloqueados(
  excluirRemateId?: string
): Promise<{ ok: boolean; datos: Record<string, number>; error?: string }> {
  if (!supabase) return { ok: false, datos: {}, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("remate_caballos")
      .select("remate_id, cliente_id, monto_usd, remates(estado)");
    if (error) return { ok: false, datos: {}, error: error.message };
    const vivos: Array<{ cliente_id?: string | null; monto_usd?: number | null }> = [];
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const estado = (r.remates as { estado?: string | null } | null)?.estado;
      if (estaCerrado({ estado })) continue;
      if (excluirRemateId && String(r.remate_id ?? "") === String(excluirRemateId)) continue;
      vivos.push({ cliente_id: r.cliente_id as string | null, monto_usd: r.monto_usd as number | null });
    }
    return { ok: true, datos: sumarBloqueos(vivos) };
  } catch (e) {
    return { ok: false, datos: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Autoriza en el SERVIDOR las pujas de uno o varios compradores.
 *
 * Tres reglas y ninguna negociable: sin comprador no se compra, el modo LIBRE
 * no compra en remates, y el monto no puede pasar de `saldo + aval` menos lo que
 * ya tiene bloqueado en otros remates abiertos.
 *
 * `liberar` es la puja que se está REEMPLAZANDO (subir un ejemplar que el cliente
 * ya tenía): su monto anterior se descuenta antes de topar, porque si no el
 * cliente pagaría dos veces por el mismo ejemplar.
 */
async function autorizarPujasRemate(
  pujas: Array<{ cliente_id?: string | null; monto_usd: number | null | undefined }>,
  liberar?: { cliente_id?: string | null; monto_usd: number | null | undefined } | null
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };

  const porCliente = new Map<string, number>();
  for (const p of pujas) {
    const id = String(p?.cliente_id ?? "").trim();
    const monto = Number(p?.monto_usd) || 0;
    if (!id || monto <= 0) continue;
    porCliente.set(id, r2((porCliente.get(id) ?? 0) + monto));
  }
  if (porCliente.size === 0) return { ok: true };

  const libId = String(liberar?.cliente_id ?? "").trim();
  const libMonto = libId ? Number(liberar?.monto_usd) || 0 : 0;
  const ids = [...new Set([...porCliente.keys(), ...(libId ? [libId] : [])])];

  const [resCli, resBloq] = await Promise.all([
    supabase.from("clientes").select("id, nombre, saldo_actual, aval, modo_juego, libre").in("id", ids),
    listarSaldosBloqueados(),
  ]);
  if (resCli.error) return { ok: false, error: resCli.error.message };

  const porId = new Map(
    ((resCli.data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.id ?? ""), r as ClienteRemate])
  );
  const bloqueos: Record<string, number> = { ...(resBloq.datos ?? {}) };
  if (libId && libMonto > 0) bloqueos[libId] = r2(Math.max(0, (bloqueos[libId] ?? 0) - libMonto));

  for (const [id, total] of porCliente) {
    const fila = porId.get(id);
    if (!fila) return { ok: false, error: "El comprador no existe en la cartera." };
    const a = autorizarPujaRemate({ ...fila, id }, total, bloqueos);
    if (!a.ok) return { ok: false, error: a.motivo ?? "El cliente no puede comprar." };
  }
  return { ok: true };
}

/**
 * Asigna ejemplares (del programa) como pujas del remate. Recalcula la
 * probabilidad implícita de CADA caballo del remate con el pozo resultante, no
 * solo de los nuevos: agregar una puja cambia el peso relativo de las demás.
 */
export async function asignarCaballosRemate(remateId: string, pujas: PujaRemate[]): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_asignar_caballos");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const estado = await leerEstadoRemate(remateId);
  if (!estado.ok) return { ok: false, error: estado.error };
  if (estado.cerrado) return { ok: false, error: "El remate está cerrado: no admite pujas nuevas." };
  const filas = (pujas ?? []).filter((p) => String(p.nombre ?? "").trim());
  if (!filas.length) return { ok: false, error: "No hay ejemplares para asignar." };
  // Nadie topa contra el saldo en el navegador: un cliente sin saldo ni aval, o
  // en modo Libre, no compra aunque le dejen el campo abierto.
  const autorizacion = await autorizarPujasRemate(filas);
  if (!autorizacion.ok) return { ok: false, error: autorizacion.error };
  try {
    // Toda la escritura (insert de pujas + historial + recalculo de probabilidades
    // de todo el remate) pasa por la RPC `security definer`: el navegador ya no
    // tiene INSERT/UPDATE sobre `remate_caballos` ni `remate_pujas`.
    const { error } = await supabase.rpc("club_asignar_pujas_remate", {
      p_remate_id: remateId,
      p_pujas: filas.map((p) => ({
        numero: Number(p.numero) || 0,
        nombre: String(p.nombre).trim(),
        monto_usd: Number(p.monto_usd) || 0,
        cliente_id: p.cliente_id ?? null,
        ejemplar_numero: p.ejemplar_numero ?? null,
      })),
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorPujas(error.message, MENSAJE_SIN_RPC_PUJAS) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Quita una puja del remate. */
export async function eliminarCaballoRemate(id: string, _remateId?: string): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_eliminar_caballo");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const { error } = await supabase.rpc("club_eliminar_caballo_remate", {
      p_caballo_id: id,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorPujas(error.message, MENSAJE_SIN_RPC_PUJAS) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sube la puja de un ejemplar ya asignado (monto + comprador). Tras guardar,
 * recalcula las probabilidades de TODO el remate: subir el monto de uno cambia
 * el peso relativo de los demás.
 */
export async function pujarCaballoRemate(
  remateId: string,
  caballoId: string,
  patch: { monto_usd: number; cliente_id?: string | null }
): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_asignar_caballos");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const estado = await leerEstadoRemate(remateId);
  if (!estado.ok) return { ok: false, error: estado.error };
  if (estado.cerrado) return { ok: false, error: "El remate está cerrado: no se pueden subir pujas." };
  // La puja que se reemplaza libera su monto viejo antes de topar el saldo: si
  // no, el comprador pagaría dos veces por el mismo ejemplar.
  let previa: { cliente_id: string | null; monto_usd: number } | null = null;
  try {
    const { data: prev } = await supabase
      .from("remate_caballos")
      .select("cliente_id, monto_usd")
      .eq("id", caballoId)
      .maybeSingle();
    if (prev) {
      previa = {
        cliente_id: (prev as { cliente_id?: string | null }).cliente_id ?? null,
        monto_usd: Number((prev as { monto_usd?: number | null }).monto_usd) || 0,
      };
    }
  } catch {
    previa = null;
  }
  const autorizacion = await autorizarPujasRemate(
    [{ cliente_id: patch.cliente_id ?? null, monto_usd: Number(patch.monto_usd) || 0 }],
    previa
  );
  if (!autorizacion.ok) return { ok: false, error: autorizacion.error };
  try {
    // Update + historial + recalculo de probabilidades, todo en la RPC definer.
    const { error } = await supabase.rpc("club_pujar_caballo_remate", {
      p_caballo_id: caballoId,
      p_monto_usd: Number(patch.monto_usd) || 0,
      p_cliente_id: patch.cliente_id ?? null,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorPujas(error.message, MENSAJE_SIN_RPC_PUJAS) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Guarda el incentivo de la casa para el remate: monto fijo y/o porcentaje del
 * subtotal (si hay % > 0, ese % manda e ignora el monto).
 */
export async function guardarIncentivoRemate(
  remateId: string,
  incentivo: number,
  incentivoPct: number = 0
): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const monto = Number(incentivo) || 0;
  const pct = Number(incentivoPct) || 0;
  try {
    // El update vive en la RPC `security definer`: valida la capacidad, que el
    // remate exista y que no esté cerrado. El navegador ya no escribe `remates`.
    const { error } = await supabase.rpc("club_guardar_incentivo_remate", {
      p_remate_id: remateId,
      p_incentivo: monto,
      p_incentivo_pct: pct,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorRemate(error.message, MENSAJE_SIN_RPC_REMATE) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// ESCALERA DE PUJAS EDITABLE + CIERRE DE LA SUBASTA
// ---------------------------------------------------------------------------

/**
 * Guarda la escalera de pujas del remate y su nota de observación.
 *
 * La escalera se NORMALIZA antes de guardarse (`normalizarEscalera`): guardar un
 * jsonb con huecos o incrementos en cero convertiría el error en plata de menos,
 * y una vez escrito el error ya no se ve.
 */
export async function guardarEscaleraRemate(
  remateId: string,
  escalera: EscalonPuja[],
  notaEscalera?: string | null
): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const limpia = normalizarEscalera(escalera);
  const nota = String(notaEscalera ?? "").trim();
  try {
    // Mismo patrón: escalera/nota van por RPC, que valida que cada tramo tenga
    // incremento > 0 y que el remate siga abierto.
    const { error } = await supabase.rpc("club_guardar_escalera_remate", {
      p_remate_id: remateId,
      p_escalera: limpia,
      p_nota_escalera: nota || null,
      p_usuario: null,
    });
    if (error) return { ok: false, error: mensajeErrorRemate(error.message, MENSAJE_SIN_RPC_REMATE) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Abre o cierra la subasta.
 *
 * QUEDO RETIRADO A PROPOSITO: este UPDATE solo cambiaba el estado y cerraba el
 * remate SIN emitir tickets ni descontar saldos, que es exactamente el cobro
 * perdido que nenhuma casa quiere. Para cerrar (y liquidar) usar
 * `cerrarRemateLiquidando`, y para reabrir, `reabrirRemate`.
 */
export async function cambiarEstadoRemate(
  remateId: string,
  estado: "Abierto" | "Cerrado"
): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  return {
    ok: false,
    error:
      `No se puede cambiar el estado con un UPDATE directo (quedaría la subasta cerrada sin tickets ni descuento ` +
      `de saldo). Usá cerrarRemateLiquidando/reabrirRemate: requieren sql/remate_cierre.sql.`,
  };
}

// ---------------------------------------------------------------------------
// CIERRE ECONOMICO (sql/remate_cierre.sql)
// ---------------------------------------------------------------------------

export type ResultadoCierreRemate = {
  ok: boolean;
  error?: string;
  /** Tickets de venta generados en este cierre. */
  tickets?: number;
  /** Ejemplares que se quedan en la casa (sin comprador): sin ticket ni saldo. */
  casa?: number;
  /** Ejemplares que ya tenían ticket de un cierre anterior (no se cobran dos veces). */
  ya_cobrados?: number;
  /** Total descontado del saldo de los compradores en este cierre. */
  total?: number;
};

const MENSAJE_SIN_RPC_CIERRE =
  "No se encontro la funcion club_cerrar_remate. Aplicala con sql/remate_cierre.sql.";

/**
 * Cierra la subasta Y la liquida: por cada ejemplar con comprador descuenta el
 * monto de `clientes.saldo_actual` y emite el ticket de venta. Todo pasa por
 * `club_cerrar_remate` en una sola transaccion, asi que no puede quedar medio
 * hecho, y es idempotente (un ejemplar ya cobrado no se cobra de nuevo).
 *
 * Los ejemplares sin comprador quedan en CASA: no generan ticket ni descuento.
 */
export async function cerrarRemateLiquidando(remateId: string): Promise<ResultadoCierreRemate> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const { data, error } = await supabase.rpc("club_cerrar_remate", {
      p_remate_id: remateId,
      p_usuario: null,
    });
    if (error) {
      const texto = error.message ?? String(error);
      return { ok: false, error: /club_cerrar_remate|not found|404/i.test(texto) ? MENSAJE_SIN_RPC_CIERRE : texto };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      tickets: Number(r.tickets ?? 0),
      casa: Number(r.casa ?? 0),
      ya_cobrados: Number(r.ya_cobrados ?? 0),
      total: Number(r.total_descontado ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reabre la subasta. NO borra tickets ni devuelve saldos: lo unico que cambia es
 * que el remate vuelve a "Abierto" para poder ASIGNAR un comprador a los
 * ejemplares que siguen sin comprador (CASA). Como `liquidado_at` queda puesto,
 * el modulo Remates mantiene bloqueados los ejemplares ya vendidos.
 */
export async function reabrirRemate(remateId: string): Promise<ResSimple> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const { error } = await supabase.rpc("club_reabrir_remate", {
      p_remate_id: remateId,
      p_usuario: null,
    });
    if (error) {
      const texto = error.message ?? String(error);
      return {
        ok: false,
        error: /club_reabrir_remate|not found|404/i.test(texto)
          ? "No se encontro la funcion club_reabrir_remate. Aplicala con sql/remate_cierre.sql."
          : texto,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Vende UN ejemplar de un remate que ya estaba liquidado (asignación posterior a
 * una reapertura). Emite el mismo ticket de venta y descuenta el mismo saldo que
 * el cierre, con la misma idempotencia: si el ejemplar ya se vendió, no cobra de
 * nuevo.
 */
export async function venderCaballoRemate(
  caballoId: string,
  clienteId: string
): Promise<ResultadoCierreRemate> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    exigirCapacidad("remates:fn_guardar_remate");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  try {
    const { data, error } = await supabase.rpc("club_vender_caballo_remate", {
      p_caballo_id: caballoId,
      p_cliente_id: clienteId,
      p_usuario: null,
    });
    if (error) {
      const texto = error.message ?? String(error);
      return {
        ok: false,
        error: /club_vender_caballo_remate|not found|404/i.test(texto)
          ? "No se encontro la funcion club_vender_caballo_remate. Aplicala con sql/remate_cierre.sql."
          : texto,
      };
    }
    const r = (data ?? {}) as Record<string, unknown>;
    return { ok: true, tickets: 1, total: Number(r.monto ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// HISTORIAL DE PUJAS (tabla `remate_pujas`, creada por sql/remate_pujas.sql)
// ---------------------------------------------------------------------------

/** Una puja registrada: quién puja, por cuánto y cuándo. */
export type PujaHistorica = {
  id?: string;
  caballo_id?: string | null;
  numero: number;
  nombre: string;
  monto_usd: number;
  cliente_id?: string | null;
  cliente?: string | null;
  created_at?: string | null;
};

/** Historial de pujas del remate, del más reciente al más viejo. */
export async function listarPujasRemate(
  remateId: string
): Promise<{ ok: boolean; datos?: PujaHistorica[]; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  try {
    const { data, error } = await supabase
      .from("remate_pujas")
      .select("*, clientes(nombre), remate_caballos(numero, nombre)")
      .eq("remate_id", remateId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: error.message };
    const datos = (data ?? []).map((r) => {
      const raw = r as Record<string, unknown>;
      const cliente = raw.clientes as { nombre?: string } | null;
      const cab = raw.remate_caballos as { numero?: number; nombre?: string } | null;
      return {
        id: raw.id != null ? String(raw.id) : undefined,
        caballo_id: raw.caballo_id != null ? String(raw.caballo_id) : null,
        numero: Number(cab?.numero ?? 0) || 0,
        nombre: String(cab?.nombre ?? "").trim(),
        monto_usd: Number(raw.monto_usd) || 0,
        cliente_id: raw.cliente_id != null ? String(raw.cliente_id) : null,
        cliente: cliente?.nombre ?? null,
        created_at: raw.created_at != null ? String(raw.created_at) : null,
      } satisfies PujaHistorica;
    });
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
