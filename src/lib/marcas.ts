/**
 * MODULO MARCAS — acceso a datos (config CRUD, venta y liquidación).
 *
 * La jerarquía y la matemática viven en `./marcas/jerarquia` (lógica pura, sin
 * dependencias). Este archivo solo habla con Supabase.
 *
 * El dinero nunca se toca desde el navegador: la venta y la liquidación son
 * RPCs que debitan/abonan dentro de una transacción. Aquí no hay ni un solo
 * `update` a `clientes.saldo_actual`, porque un doble descuento es exactamente
 * el bug que ya se corrigió en el reembolso por retiro.
 */

import { supabase } from "@/lib/supabase";
import { exigirCapacidad } from "@/lib/seguridad/vigente";
import { listarClientesVenta, listarGruposVenta, type ClienteVenta, type GrupoVenta } from "@/lib/grupos";
import { listarCarrerasCentrales, type CarreraCentral, type EjemplarCarreraCentral } from "@/lib/carreras/central";
import { parsearOrden, separarNumeros } from "./marcas/jerarquia";

export * from "./marcas/jerarquia";
export {
  revisarConfig,
  candidatosAMarca,
  buscarEjemplar,
  etiquetaCaballo,
  indicePorNumero,
  type RevisionConfig,
} from "./marcas/registradas";
export { listarGruposVenta, listarClientesVenta };
export type { GrupoVenta, ClienteVenta };

/** Se avisa con un mensaje claro si la RPC no está instalada. */
const MENSAJE_SIN_RPC =
  "Falta la RPC club_vender_marca en Supabase. Ejecuta sql/marcas_venta.sql en el SQL Editor.";

export type ConfigMarcas = {
  id: number;
  hipodromo: string;
  fecha: string;
  carrera: number;
  marcas: string;
  nv: string;
  /** Numeros marcados como debutantes de la carrera, separados por "/". */
  debutantes: string;
  /**
   * Si los debutantes "valen". En `false` se comportan EXACTAMENTE como un NV:
   * no se pueden jugar y no cuentan como rivales validos.
   */
  debutantes_valen: boolean;
  estado: string;
  updated_at: string;
};

type RowMarcasCarrera = ConfigMarcas & Record<string, unknown>;

function mapeaConfig(fila: RowMarcasCarrera): ConfigMarcas {
  return {
    id: Number(fila.id),
    hipodromo: String(fila.hipodromo ?? ""),
    fecha: String(fila.fecha ?? ""),
    carrera: Number(fila.carrera),
    marcas: String(fila.marcas ?? ""),
    nv: String(fila.nv ?? ""),
    debutantes: String(fila.debutantes ?? ""),
    // Solo un `false` explicito apaga el switch. Antes de que exista la columna,
    // el SELECT no la trae y el valor llega `undefined`: tratar eso como "no
    // valen" dejaria la columna en off sola, sin que nadie la haya tocado.
    debutantes_valen: fila.debutantes_valen !== false,
    estado: String(fila.estado ?? "Abierta"),
    updated_at: String(fila.updated_at ?? ""),
  };
}

// ===========================================================================
// CRUD DE CONFIGURACIÓN
// ===========================================================================

export async function listarConfigMarcas(filtros?: {
  dia?: string;
  hipodromo?: string;
}): Promise<ConfigMarcas[]> {
  if (!supabase) return [];
  let q = supabase.from("marcas_carrera").select("*");
  if (filtros?.dia) q = q.eq("fecha", filtros.dia);
  if (filtros?.hipodromo) q = q.ilike("hipodromo", filtros.hipodromo);
  const { data, error } = await q.order("carrera", { ascending: true });
  if (error) return [];
  return ((data ?? []) as RowMarcasCarrera[]).map(mapeaConfig);
}

export async function leerConfigMarcas(
  hipodromo: string,
  fecha: string,
  carrera: number
): Promise<ConfigMarcas | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("marcas_carrera")
    .select("*")
    .ilike("hipodromo", String(hipodromo ?? "").trim())
    .eq("fecha", fecha)
    .eq("carrera", carrera)
    .maybeSingle();
  if (error || !data) return null;
  return mapeaConfig(data as RowMarcasCarrera);
}

export type GuardarConfigMarcas = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  marcas: string;
  nv: string;
  /** Numeros de debutantes separados por "/". Vacio si la carrera no tiene. */
  debutantes?: string;
  /** Por defecto `true`. Pasar `false` es lo que mete a los debutantes al NV. */
  debutantes_valen?: boolean;
  estado?: string;
};

/**
 * Crea o actualiza la configuración de una carrera (upsert por
 * hipodromo+fecha+carrera).
 *
 * Editar `marcas` NO altera los tickets ya vendidos: el snapshot de rivales
 * quedó dentro del ticket al vender, y la liquidación lee ese snapshot.
 */
export async function guardarConfigMarcas(
  cfg: GuardarConfigMarcas
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("marcas:fn_guardar_marcas");
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const hipo = String(cfg.hipodromo ?? "").trim().toUpperCase();
  if (!hipo) return { ok: false, error: "Indique el hipódromo." };
  if (!cfg.fecha) return { ok: false, error: "Indique la fecha." };
  if (!Number(cfg.carrera)) return { ok: false, error: "Indique la carrera." };
  if (!String(cfg.marcas ?? "").trim()) {
    return { ok: false, error: "Defina al menos una marca (favorito) para la carrera." };
  }

  const { data, error } = await supabase
    .from("marcas_carrera")
    .upsert(
      {
        hipodromo: hipo,
        fecha: cfg.fecha,
        carrera: Number(cfg.carrera),
        marcas: String(cfg.marcas).trim(),
        nv: String(cfg.nv ?? "").trim(),
        debutantes: String(cfg.debutantes ?? "").trim(),
        debutantes_valen: cfg.debutantes_valen !== false,
        estado: cfg.estado ?? "Abierta",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hipodromo,fecha,carrera" }
    )
    .select("id")
    .single();
    if (error) return { ok: false, error: explicaErrorColumnas(error.message) };
    return { ok: true, id: (data as { id?: number } | null)?.id };
}

/**
 * Si la base todavia no tiene las columnas de debutantes, el upsert falla con
 * un error de Postgres que no le dice al operador que hay que correr un SQL. Se
 * traduce para que el mensaje apunte a la causa real en vez de dejar al caja
 * creyendo que se rompio la aplicacion.
 */
function explicaErrorColumnas(mensaje: string): string {
  if (/column .*debutantes.* does not exist/i.test(mensaje)) {
    return "La tabla marcas_carrera no tiene las columnas de debutantes. Ejecuta sql/marcas_venta.sql en el SQL Editor de Supabase y vuelve a intentar.";
  }
  return mensaje;
}

export async function eliminarConfigMarcas(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { error } = await supabase.from("marcas_carrera").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Abre o cierra las ventas de la carrera sin borrar la configuración. */
export async function cambiarEstadoMarcas(
  id: number,
  estado: "Abierta" | "Cerrada"
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { error } = await supabase
    .from("marcas_carrera")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ===========================================================================
// VENTA
// ===========================================================================

export type VentaMarcas = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballo: string;
  /**
   * EL rival del match: UN solo numero, elegido por el operador de entre los
   * que el caballo tiene legales a su izquierda. La RPC lo revalida contra la
   * jerarquia: si no es legal, la venta se rechaza en vez de aceptar un rival
   * que el navegador se invento.
   */
  rival: string;
  monto: number;
  clienteId: string;
  grupoId: string;
  usuario?: string;
  /**
   * Clave de idempotencia. Si se repite la llamada con la misma clave, la RPC
   * devuelve el ticket ya creado SIN descontar de nuevo.
   */
  idempotencia?: string;
};

export type ResultadoVentaMarcas = {
  ok: boolean;
  ticketId?: number;
  rivales?: string[];
  tipo?: string;
  pagoBruto?: number;
  saldoRestante?: number;
  error?: string;
};

/**
 * Emite el ticket inmutable y descuenta el saldo.
 *
 * Ambas cosas ocurren en `club_vender_marca`, en una sola transacción. Si algo
 * falla, no queda ni el descuento ni el ticket.
 */
export async function venderMarca(v: VentaMarcas): Promise<ResultadoVentaMarcas> {
  if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
  const { data, error } = await supabase.rpc("club_vender_marca", {
    p_hipodromo: String(v.hipodromo ?? "").trim().toUpperCase(),
    p_carrera: Number(v.carrera) || 0,
    p_fecha: v.fecha,
    p_caballo: String(v.caballo ?? "").trim(),
    p_rival: String(v.rival ?? "").trim(),
    p_monto: Number(v.monto) || 0,
    p_cliente_id: v.clienteId,
    p_grupo_id: v.grupoId || null,
    p_usuario: v.usuario ?? null,
    p_idem: v.idempotencia ?? null,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return { ok: false, error: /club_vender_marca|not found|404/i.test(texto) ? MENSAJE_SIN_RPC : texto };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    ticketId: r.ticket_id as number | undefined,
    rivales: (r.rivales as string[]) ?? [],
    tipo: r.tipo as string | undefined,
    pagoBruto: r.pago_bruto as number | undefined,
    saldoRestante: r.saldo_restante as number | undefined,
  };
}

export type ResultadoLiquidacionMarcas = {
  ok: boolean;
  liquidados?: number;
  ganadores?: number;
  perdedores?: number;
  reintegrados?: number;
  /** Comisión retenida a la banca en la liquidación, si la RPC la reporta. */
  gananciaTotal?: number;
  error?: string;
};

  /**
   * Clave de idempotencia para una venta.
   *
   * Se genera UNA vez por jugada y se reutiliza en los reintentos: si supabase
   * corta la respuesta y el cliente repite el POST, la RPC reconoce la clave y
   * devuelve el ticket ya creado en vez de descontar el monto por segunda vez.
   * El respaldo existe porque `crypto.randomUUID` no existe fuera de un
   * contexto seguro (http:// en un IP viejo).
   */
  export function claveIdempotencia(): string {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return `marca-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  /** Liquida las marcas de una carrera contra el orden de llegada oficial. */
export async function liquidarMarcas(
  hipodromo: string,
  carrera: number,
  fecha: string
  ): Promise<ResultadoLiquidacionMarcas> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("marcas:fn_liquidar_marcas");
    } catch (e) {
      return { ok: false, error: (e as Error).message } as ResultadoLiquidacionMarcas;
    }
    const { data, error } = await supabase.rpc("club_liquidar_marca", {
    p_hipodromo: String(hipodromo ?? "").trim().toUpperCase(),
    p_carrera: Number(carrera) || 0,
    p_fecha: fecha,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    liquidados: r.liquidados as number | undefined,
    ganadores: r.ganadores as number | undefined,
    perdedores: r.perdedores as number | undefined,
    reintegrados: r.reintegrados as number | undefined,
    gananciaTotal: r.ganancia as number | undefined,
  };
}

// ===========================================================================
// RESULTADO DE LA CARRERA
// ===========================================================================

export type RegistrarOrden = {
  ok: boolean;
  orden?: Array<{ numero: string; puesto: number }>;
  retirados?: string[];
  error?: string;
};

/**
 * Carga el orden de llegada de la carrera en `resultados_carreras`.
 *
 * Va en su propia RPC y no como parte de la liquidación a propósito: primero se
 * registra el resultado real, después se liquida contra él. Si se hiciera todo de
 * golpe, un error de pago dejaría la carrera marcada como liquidada.
 *
 * Acepta el orden en texto libre ("5, 1, 3" o "5 1 3") porque así lo escribe el
 * operador; `parsearOrden` lo normaliza igual que el servidor.
 */
export async function registrarOrdenLlegada(
  hipodromo: string,
  carrera: number,
  fecha: string,
  ordenTexto: string,
  retiradosTexto?: string
  ): Promise<RegistrarOrden> {
    if (!supabase) return { ok: false, error: "Sin credenciales Supabase (.env.local)." };
    try {
      exigirCapacidad("marcas:fn_registrar_orden_llegada");
    } catch (e) {
      return { ok: false, error: (e as Error).message } as RegistrarOrden;
    }
    const orden = parsearOrden(ordenTexto);
  if (orden.length === 0) {
    return { ok: false, error: "Indique el orden de llegada." };
  }
  const retirados = separarNumeros(retiradosTexto);

  const { data, error } = await supabase.rpc("club_registrar_orden_llegada", {
    p_hipodromo: String(hipodromo ?? "").trim().toUpperCase(),
    p_carrera: Number(carrera) || 0,
    p_fecha: fecha,
    p_orden: orden,
    p_retirados: retirados,
  });
  if (error) {
    const texto = error.message ?? String(error);
    return {
      ok: false,
      error: /club_registrar_orden_llegada|not found|404/i.test(texto)
        ? "Falta la RPC club_registrar_orden_llegada en Supabase. Ejecuta sql/marcas_venta.sql."
        : texto,
    };
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    orden: (r.orden as Array<{ numero: string; puesto: number }>) ?? orden,
    retirados: (r.retirados as string[]) ?? retirados,
  };
}

// ===========================================================================
// PIZARRA OFICIAL (config + carrera central + resultado)
// ===========================================================================

/**
 * Una fila de la pizarra: lo que la carrera CENTRAL dice (inscritos, retiros,
 * ganador) mas la configuracion de Marcas vigente para esa misma clave.
 *
 * Las dos tablas se cruzan en memoria por `hipodromo + fecha + carrera`, que es
 * la misma clave en las dos. No se hace join en Supabase porque
 * `resultados_carreras` guarda los ejemplares en un jsonb y cada modulo la
 * normaliza a su manera; hacerlo aqui evita que cada pantalla vuelva a
 * inventarse el cruce.
 */
export type PizarraMarca = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  /** La fila completa de la carrera CENTRAL, con distancia, premio y hora. */
  central: CarreraCentral;
  /** Ejemplares inscritos segun la carrera central. */
  caballos: EjemplarCarreraCentral[];
  /** La configuracion de Marcas, o `null` si esa carrera aun no se configuro. */
  config: ConfigMarcas | null;
  /** Numero del ganador ya registrado en la pizarra, si hay resultado. */
  ganador?: string | null;
  /**
   * La configuracion existe pero la carrera NO esta en la jornada central. Pasa
   * cuando se quito la carrera de "Carreras del Dia" despues de ponerle marcas:
   * la fila sigue en `marcas_carrera` y sin marcar esto quedaba invisible e
   * imposible de borrar desde la aplicacion.
   */
  sinCarreraCentral?: boolean;
};

/**
 * Arma la pizarra de un dia cruzando `marcas_carrera` con la carrera CENTRAL.
 *
 * Se incluyen las carreras que todavia no tienen configuracion: el operador
 * tiene que poder abrir el modal y crearla desde ahi. Al reves (config sin
 * carrera central) tambien se incluyen, marcadas para que se note que faltan
 * los ejemplares y la validacion los va a rechazar.
 */
export async function listarPizarraMarcas(filtros: {
  dia: string;
  hipodromo?: string;
}): Promise<{ ok: boolean; filas: PizarraMarca[]; error?: string }> {
  if (!supabase) return { ok: false, filas: [], error: "Sin credenciales Supabase (.env.local)." };
  const dia = filtros.dia;
  const hipo = String(filtros.hipodromo ?? "").trim().toUpperCase();
  if (!dia) return { ok: false, filas: [], error: "Indique la fecha." };

  const [central, marcas] = await Promise.all([
    listarCarrerasCentrales(dia, hipo || undefined),
    listarConfigMarcas({ dia, ...(hipo ? { hipodromo: hipo } : {}) }),
  ]);
  if (!central.ok) return { ok: false, filas: [], error: central.error };

  const clave = (h: string, c: number) => `${h.trim().toUpperCase()}|${dia}|${c}`;
  const porClave = new Map<string, PizarraMarca>();
  for (const cc of central.datos ?? []) {
    const k = clave(cc.hipodromo, cc.carrera);
    porClave.set(k, {
      hipodromo: cc.hipodromo,
      fecha: dia,
      carrera: cc.carrera,
      central: cc,
      caballos: cc.caballos ?? [],
      // `listarCarrerasCentrales` ya trae los ganadores; `completarGanadores`
      // solo hace falta para el primer puesto, que se lee aqui directamente.
      config: null,
      ganador: cc.ganadores?.[0] ?? null,
    });
  }
  // Configuraciones cuya carrera central todavia no existe: se listan igual para
  // que el operador vea el desajuste en vez de creer que se guardo.
  for (const mc of marcas) {
    const k = clave(mc.hipodromo, mc.carrera);
    const fila = porClave.get(k);
    if (fila) fila.config = mc;
    else
      porClave.set(k, {
        hipodromo: mc.hipodromo,
        fecha: mc.fecha,
        carrera: mc.carrera,
        central: {
          fecha: mc.fecha,
          hipodromo: mc.hipodromo,
          carrera: mc.carrera,
        },
        caballos: [],
        config: mc,
        ganador: null,
        sinCarreraCentral: true,
      });
  }

  const filas = [...porClave.values()].sort((a, b) => a.carrera - b.carrera);
  return { ok: true, filas };
}


// ===========================================================================
// HELPERS DE UI
// ===========================================================================

/** Clientes de un grupo, para el filtro en cascada del modal. */
export function clientesDelGrupo(clientes: ClienteVenta[], grupoId: string): ClienteVenta[] {
  if (!grupoId) return [];
  return clientes.filter((c) => (c.grupos ?? []).map(String).includes(String(grupoId)));
}
