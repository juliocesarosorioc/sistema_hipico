"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectarModalidad, parsearLineaRapida, proyectarFila } from "@/lib/taquilla/validar";
import { HorseBadge } from "@/components/ui/HorseChips";
import { useTaquillaStore, type TicketTaquilla } from "@/store/useTaquillaStore";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla, type ResLiquidarCarrera } from "@/lib/liquidacion/pagarYCerrar";
import { dividendosDePizarra } from "@/lib/liquidacion/posiciones";
import { guardarPizarraCentral } from "@/lib/liquidacion/pizarraCentral";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useHipodromosActivos } from "@/store/useHipodromosStore";
import { nombrePropioHipodromo } from "@/lib/hipodromos/nombre";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { SemaforoCarreras } from "@/components/gestion/SemaforoCarreras";
import { Button } from "@/components/ui/Button";
import { fmtMoney, type EjemplarTabla } from "@/lib/tablas/tipos";
import { listarClientesVenta, listarGruposVenta, saldoDeCliente, avalDeCliente, esClienteLibre, limiteDeJugar, type ClienteVenta } from "@/lib/grupos";
import { listarCarrerasPorDia, asegurarHipodromo } from "@/lib/tablas/rpc";
import { registrarCarreraProgramada } from "@/lib/carreras-dia";
import { alternarRetiroCarrera, aplicarRetirosCarrera, parsearRetirados } from "@/lib/carreras/retiros";
import { claveHipodromo } from "@/lib/carreras/claves";
import { useRegistroCentralOpts } from "@/store/useRegistroCentral";
import { hoyLocal } from "@/lib/gaceta/programa";
import { revisarCaballo, maximoDeLaCarrera, type RevisionCaballo } from "@/lib/taquilla/caballos";
import type { Reparto } from "@/lib/taquilla/reparto";

/** Resumen compacto del reparto para la celda de ejemplares (una línea, 9px). */
function resumenReparto(rep: Reparto | null, moneda: string): { txt: string; clase: string } | null {
  if (!rep || rep.montoAutorizado <= 0) return null;
  const m = (n: number) => fmtMoney(Number.isFinite(n) ? n : 0, moneda);
  const n1 = rep.lado1.caballos.length;
  if (rep.estructura === "A_PREMIO" && rep.proporcion) {
    const { p, q } = rep.proporcion;
    return {
      txt: `${p}:${q} · ${m(rep.lado1.riesgo)}/${m(rep.lado2.riesgo)}`,
      clase: "text-indigo-600",
    };
  }
  const unidad = n1 > 1 ? ` ${m(rep.lado1.porCaballo)} c/u` : "";
  const etiqueta = rep.estructura === "DADOR" ? "DADOR" : "PP";
  return {
    txt: `${etiqueta}${unidad}`,
    clase: rep.estructura === "DADOR" ? "text-purple-600" : "text-sky-600",
  };
}

type FilaCarga = {
  jugada: string;
  caballo: string;
  monto: string;
  cliente1: string;
  cliente2: string;
  /** Motivo si el parser universal marcó la línea como ilegible (fila roja ⚠️).
   *  El operador la corrige a mano y el flag se limpia al editarla. */
  error?: string;
};

const filaVacia = (): FilaCarga => ({
  jugada: "",
  caballo: "",
  monto: "",
  cliente1: "",
  cliente2: "",
});

const MONEDA = "VES";

function hipoKey(h: unknown): string {
  return String(h ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Gestión de Jugadas — Taquilla (clon del legacy):
 *  - Carga Individual con columnas # | X | JUGADA | CABALLO | MONTO |
 *    CLIENTE 1 | CLIENTE 2 (sin COBRO ni DISP, tipografía text-xs)
 *  - JUGADA solo nomenclatura pura (2x3 10/8 · 1p · 2n) + MONTO numérico aparte;
 *    el motor cruza la modalidad con el monto y proyecta el cobro por cliente
 *  - Saldo inline por cliente (registro de clientes): ✅ si alcanza el MONTO,
 *    ⚠️ "Max: X" si no; saldo azul (positivo) / rojo (negativo)
 *  - Auto-resolución del ejemplar: el número de CABALLO se cruza con la tabla
 *    publicada y bajo el input se muestra "N - NOMBRE" en gris
 *  - Alineación estricta: celdas h-12 + align-middle, mensajes inline con
 *    posición absolute para no descuadrar las filas
 *  - Pre-visualización de jugadas cargadas en sesión con acciones ✏️ (devuelve
 *    la jugada a la tabla para corregirla como inputs editables) y ✕
 *  - Modal Carga Rápida: textarea con bloque de texto (formato legacy) que el
 *    motor parsea línea por línea y puebla las filas automáticamente
 *  - Inputs: Retirados · COM % · Modalidad (Con Cruces) · Saldos Pozo/Traslado/Aval
 *  - Hipódromo buscable + Semáforo de carreras (gris/verde/amarillo/rojo)
 *  - Barra de comandos flotante con atajos: Ctrl+Q / Ctrl+Y / Ctrl+R / Ctrl+Shift+K
 *  - Liquidación con motor + posiciones dinámicas (5 por defecto, hasta 8)
 *    + Dead Heat (cero fraccionamiento)
 */
export function GestionJugadasModule() {
  const [hipodromo, setHipodromo] = useState("LA RINCONADA");
  const hipodromos = useHipodromosActivos();
  const nombreHipodromo = nombrePropioHipodromo(hipodromo, hipodromos);
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [carrerasPorDia, setCarrerasPorDia] = useState<number[]>([]);
  const [carrera, setCarrera] = useState(1);
  const [modoManual, setModoManual] = useState(false);
  const [retirados, setRetirados] = useState("");
  const [comision, setComision] = useState("5");
  const [conCruces, setConCruces] = useState(false);
  const [filas, setFilas] = useState<FilaCarga[]>([filaVacia()]);
  const [jugadasPorCarrera, setJugadasPorCarrera] = useState<number[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [aviso, setAviso] = useState("");

  const { carreras: centralCarrerasDiaAllBase, carrerasDe, recargar: recargarRegistroCentral } =
    useRegistroCentralOpts(fecha);
  /**
   * LOS SEMÁFOROS Y LOS EJEMPLARES SALEN DE LA MISMA LISTA.
   *
   * Antes este módulo mantenía DOS copias del catálogo: `carrerasCentrales`
   * (una consulta propia filtrada por hipódromo) para los ejemplares, y el
   * registro central (`carrerasDe`) para los números del semáforo. Dos lecturas
   * del mismo catálogo con dos criterios distintos, así que una podía traer los
   * 8 ejemplares de la C1 y la otra ninguna, o traer los de otra jornada. El
   * síntoma era "en Carreras del Día salen estos 8 y en Gestión estos otros 8".
   *
   * Ahora hay una sola: `carrerasDelDia`, recortada del registro central con la
   * MISMA clave canónica `hipodromo|carrera` para ambos consumidores.
   */
  const carrerasDelDia = useMemo(
    () =>
      claveHipodromo(hipodromo)
        ? carrerasDe(hipodromo)
        : centralCarrerasDiaAllBase,
    [carrerasDe, hipodromo, centralCarrerasDiaAllBase]
  );
  const centralCarrerasDiaAll = centralCarrerasDiaAllBase;
  const carrerasConEjemplares = useMemo(
    () =>
      carrerasDelDia
        .filter((c) => (c.caballos?.length ?? 0) > 0)
        .map((c) => Number(c.carrera))
        .sort((a, b) => a - b),
    [carrerasDelDia]
  );

  /** Opciones del Autocomplete CLIENTE 1/CLIENTE 2 (value = nombre real en BD). */
  const opcionesClientes = useMemo(
    () =>
      [...new Map(clientes.map((c) => [String(c.nombre).trim().toUpperCase(), c])).values()]
        .map((c) => ({ value: String(c.nombre), label: String(c.nombre) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientes]
  );

  // Registro de clientes con saldos (validación inline CLIENTE 1 / CLIENTE 2)
  const [gruposMapa, setGruposMapa] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let vivo = true;
    listarClientesVenta().then((c) => {
      if (vivo) setClientes(c);
    });
    // Jerarquía de cruces: switch general del GRUPO (default TRUE).
    listarGruposVenta().then((gs) => {
      const mapa: Record<string, boolean> = {};
      for (const g of gs) mapa[String(g.id)] = g.permite_cruces !== false;
      if (vivo) setGruposMapa(mapa);
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Semáforo: los números de carrera del día.
   *
   * La fuente es la MISMA que alimenta el padrón de ejemplares (el registro
   * central). Antes este efecto iba a `listarCarrerasPorDia` —una consulta
   * distinta— y solo usaba su respuesta cuando el registro central venía
   * vacío, así que el semáforo y los ejemplares podían señalar carreras
   * diferentes. Ahora la lista sale de `carrerasDelDia`, ya deduplicada por
   * clave canónica; `listarCarrerasPorDia` queda como respaldo para el caso en
   * que la matriz aún no responde (carreras con resultados pero sin catálogo).
   */
  useEffect(() => {
    let vivo = true;
    setCarrerasPorDia([]);
    setCarrera(1);
    if (carrerasDelDia.length > 0) {
      const base = [...new Set(carrerasDelDia.map((c) => Number(c.carrera)).filter((n) => n > 0))].sort(
        (a, b) => a - b
      );
      setCarrerasPorDia(base);
      if (base.length > 0) setCarrera(base.includes(carrera) ? carrera : Math.min(...base));
      return () => {
        vivo = false;
      };
    }
    listarCarrerasPorDia(fecha, hipodromo)
      .then((c) => {
        if (!vivo) return;
        const base = [...new Set(c.map((n) => Number(n)).filter((n) => n > 0))].sort((a, b) => a - b);
        setCarrerasPorDia(base);
        if (base.length > 0) setCarrera(base.includes(carrera) ? carrera : Math.min(...base));
      })
      .catch(() => {
        if (vivo) setCarrera(1);
      });
    return () => {
      vivo = false;
    };
  }, [fecha, hipodromo, carrerasDelDia, carrera]);

  // El catálogo y sus ejemplares los aporta el REGISTRO CENTRAL (arriba). Este
  // módulo ya no mantiene una segunda consulta: dos copias del mismo catálogo
  // divergen y producían padrones distintos entre módulos.

  useEffect(() => {
    const conEj = carrerasConEjemplares;
    if (conEj.length !== carrerasPorDia.length || conEj.some((n: number, i: number) => n !== carrerasPorDia[i])) {
      setCarrerasPorDia(conEj);
    }
    if (conEj.length > 0 && !conEj.includes(carrera)) {
      setCarrera(Math.min(...conEj));
    }
  }, [carrerasConEjemplares, carrerasPorDia, carrera]);

  const [modalPreliminar, setModalPreliminar] = useState(false);
  const [modalResultados, setModalResultados] = useState(false);
  const [modalFinalizar, setModalFinalizar] = useState(false);
  const [modalComandos, setModalComandos] = useState(false);
  const [modalCargaRapida, setModalCargaRapida] = useState(false);
  const [textoCargaRapida, setTextoCargaRapida] = useState("");
  const [ultimaPizarra, setUltimaPizarra] = useState<PizarraResultados | null>(null);
  const [resumen, setResumen] = useState<ResLiquidarCarrera | null>(null);

  const tickets = useTaquillaStore((s) => s.tickets);
  const eliminarTicket = useTaquillaStore((s) => s.eliminarTicket);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  const tablas = useTablasFijasStore((s) => s.tablas);

  /**
   * Hipódromos con carreras CARGADAS en el día elegido (se elige el día
   * primero): los que tienen tabla publicada o carrera en el registro central.
   * El catálogo completo queda disponible si el día aún no tiene nada.
   *
   * La data central viene del REGISTRO CENTRAL compartido con Marcas, Tablas y
   * Dupletas, no de un `useCarrerasCentrales` propio: con copias separadas, una
   * carrera recién registrada aparecía en Tablas y en Marcas pero el selector de
   * Gestión no la ofrecía, y era imposible venderla sin recargar a mano.
   */


const hipodromosDelDia = useMemo(() => {
    // `claveHipodromo` en los dos lados: con un `.toUpperCase()` propio que
    // dejaba el espacio ("LA RINCONADA" vs "LARINCONADA"), un hipódromo con
    // carrera no entraba en la lista y el usuario tenía que recargar a mano.
    const conCarreras = new Set<string>();
    for (const t of tablas) {
      const h = claveHipodromo(t.hipodromo);
      if (h && String(t.fecha || t.fecha_creacion || "").slice(0, 10) === fecha) conCarreras.add(h);
    }
    for (const c of centralCarrerasDiaAll) {
      const h = claveHipodromo(c.hipodromo);
      if (h) conCarreras.add(h);
    }
    if (!conCarreras.size) return hipodromos;
    const normalizado = new Map(hipodromos.map((h) => [claveHipodromo(h.value), h] as const));
    const dentro = [...conCarreras]
      .map((k) => normalizado.get(k) ?? { value: k, label: k })
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const dentroKeys = new Set(dentro.map((h) => claveHipodromo(h.value)));
    const fuera = hipodromos.filter((h) => !dentroKeys.has(claveHipodromo(h.value)));
    return [...dentro, ...fuera];
  }, [tablas, hipodromos, centralCarrerasDiaAll, fecha]);

  // Atajos de la Barra de Comandos (real keyboard events)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "q") {
        e.preventDefault();
        setModalPreliminar(true);
      } else if (k === "y") {
        e.preventDefault();
        setModalResultados(true);
      } else if (k === "r") {
        e.preventDefault();
        setModalFinalizar(true);
      } else if (k === "k" && e.shiftKey) {
        e.preventDefault();
        setModalComandos(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const comisionNum = useMemo(() => {
    const n = parseFloat(comision.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }, [comision]);

  /** Proyecta la fila. Si los clientes no están en el registro todavía, se
      calculan por prefijo para poder topar el monto igual (mismo criterio que
      `saldoCliente`, que corre un turno más tarde en el render). */
  const valida = (f: FilaCarga) => {
    return proyectarFila({
      jugada: f.jugada,
      caballo: f.caballo.trim(),
      monto: f.monto,
      tasaComision: comisionNum,
      cliente1: saldoCliente(f.cliente1),
      cliente2: saldoCliente(f.cliente2),
    });
  };

  const tablaDeCarrera = useMemo(
    () =>
      tablas.find(
        (t) =>
          claveHipodromo(t.hipodromo) === claveHipodromo(hipodromo) &&
          Number(t.carrera) === Number(carrera) &&
          // La fecha es imprescindible: el store persiste tablas de jornadas
          // anteriores y sin este filtro el respaldo mostraba los ejemplares de
          // otro día cuando la carrera actual no tenía padrón en el registro
          // central ("trae ejemplares de días diferentes al seleccionado").
          String(t.fecha || t.fecha_creacion || "").slice(0, 10) === fecha
      ),
    [tablas, hipodromo, carrera, fecha]
  );

  /**
   * Carrera central (registro único) que corresponde a la vista actual. Se
   * busca por la clave canónica, no solo por número: con la copia anterior el
   * móduloonoraba la primera fila que coincidía en número, que podía ser de
   * otra jornada.
   */
  const centralDeCarrera = useMemo(
    () => carrerasDelDia.find((c) => Number(c.carrera) === Number(carrera)) ?? null,
    [carrerasDelDia, carrera]
  );

  /**
   * Ejemplares inscritos de la carrera en pantalla.
   *
   * ORDEN DE PREFERENCIA (importante): la matriz `carreras` —el registro único—
   * MANDA. La tabla fija publicada es el libro de VENTAS, no el padrón de
   * inscripción: su lista de caballos es la que había una venta, que puede venir
   * de otra jornada o de otra carga. Por eso antes se veían ocho NOMBRES
   * COMPLETAMENTE DISTINTOS a los de Carreras del Día: este módulo priorizaba
   * `tablaDeCarrera.caballos` y solo caía al catálogo central si la tabla no
   * tenía caballos.
   *
   * La tabla fija solo entra como respaldo cuando el catálogo central no tiene
   * ejemplares para esa carrera, y la lista CENTRAL de retiros se aplica sobre
   * las dos: un retiro registrado en cualquier módulo se ve al instante.
   */
  const caballosDeCarrera = useMemo<EjemplarTabla[]>(() => {
    const retiradosCentral = new Set(centralDeCarrera?.retirados ?? []);
    const marcar = (
      c: { numero: string | number; nombre?: string | null; nacionalidad?: string | null; retirado?: boolean },
      porDefecto: string
    ): EjemplarTabla => ({
      numero: String(c.numero),
      nombre: c.nombre ?? porDefecto,
      nacionalidad: c.nacionalidad ?? null,
      retirado: Boolean(c.retirado) || retiradosCentral.has(String(c.numero)),
    });
    const central = centralDeCarrera?.caballos ?? [];
    if (central.length > 0) return central.map((c) => marcar(c, ""));
    if (tablaDeCarrera?.caballos?.length) return tablaDeCarrera.caballos.map((c) => marcar(c, ""));
    return [];
  }, [tablaDeCarrera, centralDeCarrera]);

  const monedaFmt = (n: number): string =>
    fmtMoney(Number.isFinite(n) ? n : 0, MONEDA);

  /**
   * Revision de la columna CABALLO contra los caballos de la carrera en
   * pantalla. Se recalcula una vez por carrera (no por fila): el topete de
   * apuntar un caballo que no corre es del modulo PURO `taquilla/caballos`.
   *
   * `maximoDeLaCarrera(caballosDeCarrera)` es 0 cuando la carrera no trae
   * ejemplares, y en ese caso manda el tope de 16 del modulo puro. Cuando si
   * trae, el conjunto de participantes es lo que manda (y una carrera de 18
   * caballos acepta el 18 sin tocar el tope).
   */
  const revisionCaballo = useMemo(
    () => (texto: string): RevisionCaballo =>
      revisarCaballo(texto, caballosDeCarrera, maximoDeLaCarrera(caballosDeCarrera)),
    [caballosDeCarrera]
  );

  /** Cliente del registro que coincide con el texto tipeado (exacto o único por prefijo). */
  const saldoCliente = (texto: string): ClienteVenta | null => {
    const t = texto.trim().toLowerCase();
    if (!t) return null;
    const exacto = clientes.find((c) => c.nombre.toLowerCase() === t);
    if (exacto) return exacto;
    const porPrefijo = clientes.filter((c) => c.nombre.toLowerCase().startsWith(t));
    return porPrefijo.length === 1 ? porPrefijo[0] : null;
  };

  /**
   * Indicador inline de la celda del cliente: ✅ si el disponible alcanza el
   * MONTO, ⚠️ "Max: X" si no, o "Saldo X" en azul/rojo según el signo.
   * Fallback: cobro proyectado cuando el cliente no está en el registro.
   *
   * "Disponible" = saldo + aval (misma regla que la RPC). Cuando el aval es lo
   * que topsa, se dice: si el caja ve "Max: 0" en un cliente con aval 500 y le
   * autoriza la jugada igual, la RPC la rechaza y pierde la venta; y al revés,
   * si le tapa el botón donde sí había aval, no se vende.
   */
  const infoCliente = (texto: string, montoStr: string, cobroNeto: number): ReactNode => {
    const c = saldoCliente(texto);
    if (!c) {
      if (cobroNeto > 0) {
        return <span className="truncate text-[9px] font-black text-emerald-600">Cobra {monedaFmt(cobroNeto)}</span>;
      }
      return null;
    }
    const saldo = saldoDeCliente(c);
    const aval = avalDeCliente(c);
    const libre = esClienteLibre(c);
    const disponible = limiteDeJugar(c);
    const monto = parseFloat(String(montoStr).replace(",", "."));
    const montoValido = Number.isFinite(monto) && monto > 0;
    const conAval = !libre && aval > 0;
    if (montoValido) {
      if (libre) {
        return <span className="truncate text-[9px] font-black text-emerald-600">✅ Libre · saldo {monedaFmt(saldo)}</span>;
      }
      if (disponible >= monto) {
        return conAval ? (
          <span className="truncate text-[9px] font-black text-emerald-600">
            ✅ Disp {monedaFmt(disponible)} · aval {monedaFmt(aval)}
          </span>
        ) : (
          <span className="truncate text-[9px] font-black text-emerald-600">✅ Saldo {monedaFmt(saldo)}</span>
        );
      }
      return (
        <span className="truncate text-[9px] font-black text-red-500">
          ⚠️ Max: {monedaFmt(disponible)}
          {conAval ? ` (${monedaFmt(saldo)} + ${monedaFmt(aval)})` : ""}
        </span>
      );
    }
    if (libre) {
      return <span className="truncate text-[9px] font-bold text-blue-600">Libre · saldo {monedaFmt(saldo)}</span>;
    }
    const cls = saldo < 0 ? "text-red-600" : "text-blue-600";
    return conAval ? (
      <span className={`truncate text-[9px] font-bold ${cls}`}>
        Saldo {monedaFmt(saldo)} · aval {monedaFmt(aval)}
      </span>
    ) : (
      <span className={`truncate text-[9px] font-bold ${cls}`}>Saldo {monedaFmt(saldo)}</span>
    );
  };

  /** Ejemplar que coincide con el número tipeado en CABALLO (tabla fija o central). */
  const ejemplarResuelto = useMemo(
    () => (texto: string) => {
      const t = texto.trim();
      if (!t || !caballosDeCarrera.length) return null;
      const n = t.replace(/[^0-9]/g, "");
      if (!n) return null;
      return caballosDeCarrera.find((c) => String(c.numero) === n) ?? null;
    },
    [caballosDeCarrera]
  );

  /** Convierte el comando de un ticket de vuelta a una fila editable (jugada + monto + caballo + clientes). */
  const desarmarTicket = (t: TicketTaquilla): FilaCarga => {
    const m = /^(\d+(?:[.,]\d+)?)\s+(.+)$/.exec(String(t.comando).trim());
    const base = filaVacia();
    if (m) return { ...base, monto: m[1].trim(), jugada: m[2].trim(), caballo: t.caballo ?? "", cliente1: t.cliente1 ?? "", cliente2: t.cliente2 ?? "" };
    return { ...base, jugada: String(t.comando).trim(), caballo: t.caballo ?? "", cliente1: t.cliente1 ?? "", cliente2: t.cliente2 ?? "" };
  };

  /** ✏️ Devuelve una jugada cargada a la tabla como inputs editables (sin borrarla). */
  const editarTicket = (id: string) => {
    const t = tickets.find((x) => x.id === id);
    if (!t) return;
    eliminarTicket(id);
    const fila = desarmarTicket(t);
    setFilas((f) => [fila, ...f]);
    setAviso(`✏️ “${t.comando}” devuelto a la tabla para corregirlo.`);
  };

  const ticketsDeCarrera = useMemo(
    () =>
      tickets.filter((t) => {
        if (/^TABLA /i.test(t.comando)) return false;
        // Aislamiento por [Fecha + Hipódromo + N° Carrera]: los tickets con
        // contexto solo cuentan si coinciden; los legacy (sin contexto) se
        // conservan en la vista para no perder la sesión anterior.
        if (t.carrera !== undefined && t.carrera !== carrera) return false;
        if (t.fecha !== undefined && t.fecha !== fecha) return false;
        if (t.hipodromo !== undefined && hipoKey(t.hipodromo) !== hipoKey(hipodromo)) return false;
        return true;
      }),
    [tickets, carrera, fecha, hipodromo]
  );

  const totalInvertidoSesion = useMemo(
    () => ticketsDeCarrera.reduce((a, t) => a + t.monto, 0),
    [ticketsDeCarrera]
  );

  /**
   * Jerarquía de cruces (Carrera → Cliente → Grupo):
   * el operador decide la carrera con el switch "Con Cruces"; aquí se resuelve
   * el cierre por (cliente, grupo). false ⇒ el cruce financiero SE FACTURA
   * normal (comisión por ticket, sin neteo) — ver pagarYCerrar.ts.
   */
  const permiteCrucesDe = useCallback(
    (nombre: string): boolean | undefined => {
      const clave = String(nombre ?? "").trim().toUpperCase();
      if (!clave) return undefined;
      const c = clientes.find((x) => String(x.nombre).trim().toUpperCase() === clave);
      if (c && c.permite_cruces === false) return false;
      if (c) {
        for (const gi of c.grupos) if (gruposMapa[String(gi)] === false) return false;
      }
      return true;
    },
    [clientes, gruposMapa]
  );

  const setFila = (i: number, patch: Partial<FilaCarga>) =>
    setFilas((f) => f.map((r, j) => (j === i ? { ...r, ...patch, error: undefined } : r)));

  /**
   * Modo Manual (bypass Gaceta IA): al cargar jugadas sobre una carrera vacía,
   *  · asegura el hipódromo tipeado en la BD (si no existe lo crea),
   *  · registra el número de carrera en resultados_carreras (Programada),
   *  · suma el número al semáforo local para que siga visible en la sesión.
   * Best-effort: un fallo de red no bloquea la carga local.
   */
  const consolidarManual = async () => {
    await asegurarHipodromo(hipodromo).catch(() => null);
    const r = await registrarCarreraProgramada({ fecha, hipodromo, carrera }).catch(() => null);
    if (r && !r.ok) {
      setAviso("⚠️ No se pudo persistir la carrera manual en BD: " + (r.error ?? "desconocido"));
    }
    setCarrerasPorDia((c) => (c.includes(carrera) ? c : [...c, carrera].sort((a, b) => a - b)));
  };

  /**
   * RETIROS DE LA CARRERA (data central). El campo "Retirados" ya no es un
   * texto decorativo: al aplicar, la lista pasa a `resultados_carreras` y desde
   * ahí el retiro incide en Tablas Fijas, Dupletas, Taquilla y el
   * Carreras del Día, reembolsa tickets pendientes y recalcula premios.
   */
  const aplicarRetiros = async () => {
    const lista = parsearRetirados(retirados);
    const r = await aplicarRetirosCarrera({ fecha, hipodromo, carrera, numeros: lista });
    if (!r.ok) {
      setAviso(`⚠️ No se pudieron centralizar los retiros: ${r.error ?? "sin conexión"}`);
      return;
    }
    setRetirados(lista.join(","));
    // La lista de retiros se centralizó: se invalida el registro central para
    // que chipset, semáforo y padrón de ejemplares se re lean de la matriz. No
    // hay una segunda copia local que refrescar.
    recargarRegistroCentral();
    setAviso(
      lista.length
        ? `⛔ Retirados C${carrera}: ${r.retirados.join(", ")} · ${r.tablasAfectadas} tabla(s) sincronizada(s)` +
            (r.reembolsos ? ` · ${r.reembolsos} ticket(s) reembolsado(s)` : "") +
            (r.premios.length ? ` · premios recalculados: ${r.premios.length}` : "")
        : `✔ C${carrera}: ${r.texto}`
    );
  };

  /**
   * Presionar un ejemplar lo RETIRA (o lo rehabilita). El retiro pertenece a la
   * CARRERA: se escribe en la data central y desde ahí incide en Tablas Fijas,
   * Dupletas, Taquilla y Carreras del Día, reembolsa lo pendiente y
   * recalcula el premio de la tabla.
   */
  const alternarRetiroEjemplar = async (c: EjemplarTabla) => {
    const retirado = !c.retirado;
    const r = await alternarRetiroCarrera({
      fecha,
      hipodromo,
      carrera,
      numero: c.numero,
      retirado,
    });
    if (!r.ok) {
      setAviso(`⚠️ No se pudo centralizar el retiro de N°${c.numero}: ${r.error ?? "sin conexión"}`);
      return;
    }
    recargarRegistroCentral();
    setAviso(
      retirado
        ? `⛔ N°${c.numero} RETIRADO de C${carrera} · ${r.tablasAfectadas} tabla(s) sincronizada(s)` +
            (r.reembolsos ? ` · ${r.reembolsos} ticket(s) reembolsado(s)` : "")
        : `↩ N°${c.numero} rehabilitado en C${carrera}.`
    );
  };

  const cargarAtaquilla = () => {
    let n = 0;
    const errores: string[] = [];
    const indicesError: number[] = [];
    const recortes: string[] = [];
    for (const f of filas) {
      if (!f.jugada.trim() && !f.monto.trim()) continue;
      /* Antes de la nomenclatura: un caballo que no corre no se puede cobrar
         liquidar. Se revisa igual con el campo vacio (no molesta: ahi la
         revision devuelve ok) para que un numero mal escrito con la jugada
         todavia vacia no se cuele al autocomplete. */
      const rc = revisionCaballo(f.caballo);
      if (!rc.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${rc.motivo}`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      const v = valida(f);
      if (!v.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${v.motivo}`);
        indicesError.push(filas.indexOf(f));
        continue;
      }
      /* El monto que se registra es el AUTORIZADO (topado por el saldo del
         cliente con menos disponible), no el tipeado. Si se recortó, se avisa. */
      if (v.reparto?.recortado) {
        recortes.push(
          `Fila ${filas.indexOf(f) + 1}: ${v.reparto.avisos[0] ?? `Se autoriza ${v.monto} de ${v.montoPedido}.`}`
        );
      }
      const mejorCobre = Math.max(v.cliente1?.cobroNeto ?? 0, v.cliente2?.cobroNeto ?? 0);
      const comisionMejor =
        v.cliente1 && v.cliente2 && (v.cliente2?.cobroNeto ?? 0) > (v.cliente1?.cobroNeto ?? 0)
          ? v.cliente2.comision
          : (v.cliente1?.comision ?? 0);
      agregarTicket({
        comando: `${v.monto} ${v.tipo}`,
        monto: v.monto,
        caballo: f.caballo.trim() || undefined,
        gananciaProyectada: round2(mejorCobre - v.monto),
        comision: comisionMejor,
        cliente1: f.cliente1.trim() || undefined,
        cliente2: f.cliente2.trim() || undefined,
        cobro1: v.cliente1?.cobroNeto,
        cobro2: v.cliente2?.cobroNeto,
        fecha,
        hipodromo,
        carrera,
      });
      n += 1;
    }
    if (n === 0) {
      if (indicesError.length > 0) {
        setFilas((fs) => fs.map((r, i) => (indicesError.includes(i) ? { ...r, error: errores.find((e) => e.startsWith(`Fila ${i + 1}`)) } : r)));
      }
      return setAviso("Carga al menos una jugada válida (JUGADA + MONTO). " + (errores[0] ?? ""));
    }
    if (modoManual) void consolidarManual();
    if (!jugadasPorCarrera.includes(carrera)) setJugadasPorCarrera((j) => [...j, carrera]);
    setFilas((fs) => {
      // Las filas con error NO se pierden: quedan en rojo ⚠️ para corregir y reenviar.
      const conservar = fs
        .map((r, i) => ({ r, i }))
        .filter(({ i }) => indicesError.includes(i))
        .map(({ r, i }) => ({ ...r, error: r.error ?? errores.find((e) => e.startsWith(`Fila ${i + 1}`)) }));
      return [...conservar, filaVacia()];
    });
    setAviso(
      `✅ ${n} jugada(s) enviada(s) a la taquilla (C${carrera}).` +
        (errores.length ? ` ${errores.length} fila(s) con error quedaron en rojo para corregir.` : "") +
        (recortes.length ? ` ⚠️ ${recortes.length} recortada(s) por saldo: ${recortes.join(" · ")}` : "")
    );
  };

  const poblarCargaRapida = () => {
    const lineas = textoCargaRapida.split("\n");
    const filasNuevas: FilaCarga[] = [];
    let ok = 0;
    for (const l of lineas) {
      const p = parsearLineaRapida(l);
      if (!p) continue;
      if (p.ok) {
        filasNuevas.push({
          jugada: p.jugada,
          caballo: p.caballo,
          monto: p.monto,
          cliente1: p.cliente1,
          cliente2: p.cliente2,
        });
        ok += 1;
      } else {
        // Línea ilegible: NO se descarta — se pinta en rojo ⚠️ para que el
        // operador la corrija manualmente en la tabla antes de enviar a la BD.
        filasNuevas.push({ ...filaVacia(), jugada: l.trim(), error: p.motivo });
      }
    }
    const ilegibles = filasNuevas.filter((f) => f.error).length;
    /* Un caballo que no corre no se descarta como la linea ilegible (esa si es
       irrecuperable sin releerla): la fila se conserva y se marca en rojo, como
       el parser hace con las suyas, para que el operador corrija el numero. */
    const conCaballoMalo = filasNuevas.filter((f) => !f.error && !revisionCaballo(f.caballo).ok);
    if (filasNuevas.length > 0) {
      setFilas(filasNuevas);
      setTextoCargaRapida("");
      setModalCargaRapida(false);
      setAviso(
        ok > 0
          ? `⚡ ${ok} fila(s) poblada(s) desde el bloque de texto.` +
              (ilegibles ? ` ⚠️ ${ilegibles} línea(s) ilegible(s) quedaron en rojo para corregir.` : "") +
              (conCaballoMalo.length
                ? ` 🐴 ${conCaballoMalo.length} con caballo que no corre en esta carrera.`
                : "")
          : `⚠️ Ninguna línea fue legible. ${ilegibles} fila(s) quedaron en rojo — corregí jugada y monto, o escribí el bloque con "JUGADA CABALLO MONTO CLIENTE1 [CLIENTE2]".`
      );
    } else {
      setAviso("⚠️ Pegá al menos una línea con una jugada para poder poblarla.");
    }
  };

  const ejecutarFinalizar = async () => {
    if (!ultimaPizarra) {
      setModalFinalizar(false);
      setModalResultados(true);
      return setAviso("Primero cargá los resultados (Ctrl+Y) para liquidar.");
    }
    if (ticketsDeCarrera.length === 0) return setAviso("No hay jugadas en sesión para esta carrera.");
    const r = await liquidarCarreraYCerrarTabla({
      hipodromo,
      carrera,
      pizarra: ultimaPizarra.pizarra,
      // Los dividendos cargados en Ctrl+Y viajan al motor y al central: sin
      // esto la liquidación de puestos quedaba PENDIENTE por dividendo
      // faltante y `resultados_carreras.dividendos` se guardaba en NULL.
      dividendos: dividendosDePizarra(ultimaPizarra),
      tickets: ticketsDeCarrera.map((t) => ({
        comando: t.comando,
        monto: t.monto,
        caballo: t.caballo,
        cliente1: t.cliente1,
        cliente2: t.cliente2,
        permiteCruces: conCruces ? permiteCrucesDe(t.cliente1 ?? "") : false,
      })),
      tasaComision: comisionNum,
    });
    setResumen(r);
    if (r.ok) {
      for (const t of ticketsDeCarrera) eliminarTicket(t.id);
      setUltimaPizarra(null);
      setJugadasPorCarrera((j: number[]) => j.filter((c) => c !== carrera));
      setResumen(r);
    }
    setAviso(r.ok ? `✅ ${r.motivo}` : `❌ ${r.motivo}`);
  };

  const cerrarFinalizar = () => {
    setModalFinalizar(false);
    setResumen(null);
  };

  return (
    <div className="space-y-2 pb-14">
      {/* Inputs superiores */}
      <div className="grid gap-1.5 rounded-xl border border-line bg-surface p-2 lg:grid-cols-6">
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">1 · Fecha 📅</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyLocal())}
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">2 · Hipódromo</label>
          <SearchableSelect
            options={hipodromosDelDia}
            value={hipodromo}
            onChange={setHipodromo}
            placeholder="Buscar hipódromo…"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">
            Retirados · C{carrera}
          </label>
          <div className="flex items-center gap-1">
            <input
              value={retirados}
              onChange={(e) => setRetirados(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void aplicarRetiros();
              }}
              placeholder='ej. "2,5"'
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            <Button
              size="sm"
              className="shrink-0 !bg-gradient-to-r !from-red-500 !to-rose-600 !text-white"
              onClick={() => void aplicarRetiros()}
              title="Centraliza los retiros de la carrera y los propaga a todos los módulos"
            >
              ⛔ Aplicar
            </Button>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[9px] font-bold uppercase leading-none tracking-wide text-slate-500">COM %</label>
          <input
            value={comision}
            onChange={(e) => setComision(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-[13px] leading-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <label className="flex cursor-pointer items-end gap-2 pb-2 text-xs font-bold uppercase text-slate-600">
          <input
            type="checkbox"
            checked={conCruces}
            onChange={(e) => setConCruces(e.target.checked)}
            className="h-4 w-4 accent-primary-500"
          />
          Con Cruces
        </label>
        <label className="flex cursor-pointer items-end gap-2 rounded-xl border border-cyan-200 bg-cyan-50/60 px-3 py-2 text-[11px] font-black uppercase text-cyan-700" title="Permite cargar jugadas y registrar carreras aunque la Gaceta IA no haya extraído nada (sin bloquear).">
          <input
            type="checkbox"
            checked={modoManual}
            onChange={(e) => setModoManual(e.target.checked)}
            className="h-4 w-4 accent-cyan-600"
          />
          ✍️ Modo Manual
        </label>
        <div className="rounded-xl border border-line bg-gray-50 px-3 py-2 text-right">
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-600">
            {nombreHipodromo} C{carrera} · {ticketsDeCarrera.length} ticket(s) · {monedaFmt(totalInvertidoSesion)}
          </p>
        </div>
      </div>

      <SemaforoCarreras
        hipodromo={hipodromo}
        fecha={fecha}
        carreras={carrerasPorDia}
        activa={carrera}
        manual={modoManual}
        onSeleccionar={setCarrera}
      />

      {/* Tabla de Carga Individual (clon 1:1 del legacy) */}
      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-700">Carga Individual</h3>
          <span className="flex items-center gap-2">
            <span className="inline-flex min-w-[3.5rem] items-center justify-center rounded-full border-2 border-indigo-200 bg-white px-4 py-1.5 text-2xl font-black uppercase leading-none tracking-widest text-indigo-900 shadow-md md:text-3xl">
              C{carrera}
            </span>
            <span className="text-[10px] font-semibold text-slate-500">
              {nombreHipodromo} · Retirados: {retirados.trim() || "—"}
            </span>
          </span>
        </div>

        {/* Panel lateral de ejemplares (tabla fija publicada o Carreras del Día) */}
        <div className={caballosDeCarrera.length ? "flex flex-col gap-2 lg:flex-row" : ""}>
          {caballosDeCarrera.length > 0 && (
            <aside className="shrink-0 rounded-xl border border-line bg-white p-1.5 shadow-sm lg:w-[28%]">
              <p className="px-1 pb-1 text-[9px] font-black uppercase leading-none tracking-wide text-slate-500">
                🐎 Ejemplares registrados ({caballosDeCarrera.length})
              </p>
              <ul className="max-h-60 divide-y divide-line/60 overflow-y-auto">
                {caballosDeCarrera.map((c, ci) => (
                  <li key={ci}>
                    <button
                      type="button"
                      onClick={() => void alternarRetiroEjemplar(c)}
                      title={
                        c.retirado
                          ? `Quitar el retiro de N°${c.numero} (se propaga a todos los módulos)`
                          : `Retirar N°${c.numero} (se propaga a todos los módulos)`
                      }
                      className={`flex w-full cursor-pointer items-center gap-1.5 px-1 py-0 text-left leading-none hover:bg-amber-50 ${
                        c.retirado ? "bg-red-50/60" : ""
                      }`}
                    >
                      <HorseBadge num={c.numero} size="sm" retirado={c.retirado} />
                      <span
                        className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase leading-none ${
                          c.retirado ? "text-red-500 line-through" : "text-slate-700"
                        }`}
                      >
                        {c.nombre || <span className="text-slate-400">Nº {c.numero} (sin nombre)</span>}
                      </span>
                      {c.retirado ? (
                        <span className="shrink-0 rounded bg-red-100 px-1 text-[8px] font-black text-red-600">RET</span>
                      ) : (
                        <span className="shrink-0 text-[9px] font-black uppercase text-amber-600 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100">
                          ⛔
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className={caballosDeCarrera.length ? "min-w-0 flex-1" : "w-full"}>
            <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="gj-cabecera text-white">
              <th className="w-[3%] border-r border-slate-700 px-1 py-0.5 text-left text-[10px] font-bold uppercase leading-none">#</th>
              <th className="w-[3%] border-r border-slate-700 px-1 py-0.5 text-center text-[10px] font-bold uppercase leading-none">X</th>
              <th className="w-[20%] border-r border-slate-700 px-1 py-0.5 text-left text-[10px] font-bold uppercase leading-none">Jugada</th>
              <th className="w-[11%] border-r border-slate-700 px-1 py-0.5 text-left text-[10px] font-bold uppercase leading-none">Caballo</th>
              <th className="w-[11%] border-r border-slate-700 px-1 py-0.5 text-right text-[10px] font-bold uppercase leading-none">Monto</th>
              <th className="w-[26%] border-r border-slate-700 px-1 py-0.5 text-left text-[10px] font-bold uppercase leading-none">Cliente 1</th>
              <th className="w-[26%] px-1 py-0.5 text-left text-[10px] font-bold uppercase leading-none">Cliente 2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {filas.map((f, i) => {
              const v = valida(f);
              const detectado = f.jugada.trim() ? detectarModalidad(f.jugada) : null;
              const ejemplar = ejemplarResuelto(f.caballo);
              const rc = revisionCaballo(f.caballo);
              const caballoInvalido = !rc.ok;
              const rep = v.ok ? v.reparto : null;
              const recortado = !!rep?.recortado;
              const resumen = resumenReparto(rep, MONEDA);
              return (
                <tr key={i} className={`align-middle ${f.error ? "bg-red-50" : ""}`} title={f.error ?? undefined}>
                  <td className="gj-celda relative h-7 px-1 py-0 text-xs text-slate-400">
                    <span className="block truncate">
                      {f.error ? (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          ⚠️ <span className="hidden text-[9px] font-bold">{f.error}</span>
                        </span>
                      ) : (
                        i + 1
                      )}
                    </span>
                  </td>
                  <td className="gj-celda relative h-7 px-1 py-0 text-center">
                    <button
                      type="button"
                      onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                      disabled={filas.length <= 1}
                      aria-label="Eliminar fila"
                      className="text-xs text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </td>
                  <td className="gj-celda relative h-7 px-1 py-0">
                    <input
                      value={f.jugada}
                      onChange={(e) => setFila(i, { jugada: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          cargarAtaquilla();
                        }
                      }}
                      placeholder="10/8 · pp · 1p · 2n"
                      className="w-full rounded border border-line bg-white px-1 py-0.5 text-[11px] font-bold leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <span
                      className={`pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-black uppercase leading-none tracking-wide ${
                        v.ok ? "text-emerald-600" : "text-slate-300"
                      }`}
                    >
                      {detectado ?? (f.jugada.trim() ? "—" : "")}
                    </span>
                  </td>
                  <td className={`gj-celda relative h-7 px-1 py-0 ${caballoInvalido ? "bg-red-50" : ""}`}>
                    <input
                      value={f.caballo}
                      onChange={(e) => setFila(i, { caballo: e.target.value })}
                      placeholder="1 · 1,2x3"
                      inputMode="numeric"
                      aria-invalid={caballoInvalido}
                      title={
                        caballoInvalido
                          ? rc.motivo
                          : rep
                            ? `${rep.estructura} · C1 ${monedaFmt(rep.lado1.riesgo)}` +
                              (rep.lado2.riesgo > 0 ? ` · C2 ${monedaFmt(rep.lado2.riesgo)}` : " · C2 da") +
                              (rep.avisos.length ? `\n${rep.avisos.join("\n")}` : "")
                            : ejemplar
                              ? `${ejemplar.numero} - ${ejemplar.nombre}`
                              : ""
                      }
                      className={`w-full rounded border bg-white px-1 py-0.5 text-[11px] font-semibold leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        caballoInvalido ? "border-red-400" : "border-line"
                      }`}
                    />
                    {caballoInvalido ? (
                      <span className="pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-black uppercase leading-none text-red-600">
                        No corre
                      </span>
                    ) : resumen ? (
                      <span
                        className={`pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-black uppercase leading-none tracking-wide ${resumen.clase}`}
                      >
                        {resumen.txt}
                      </span>
                    ) : (
                      ejemplar && (
                        <span
                          className={`pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-bold leading-none ${
                            ejemplar.retirado ? "text-red-500 line-through" : "text-gray-500"
                          }`}
                        >
                          {ejemplar.numero} - {ejemplar.nombre}
                          {ejemplar.retirado ? " (RET)" : ""}
                        </span>
                      )
                    )}
                  </td>
                  <td className="gj-celda relative h-7 px-1 py-0">
                    <input
                      value={f.monto}
                      onChange={(e) => setFila(i, { monto: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      title={recortado ? `Se autoriza ${monedaFmt(v.ok ? v.monto : 0)} por saldo disponible` : undefined}
                      className={`w-full rounded border bg-white px-1 py-0.5 text-right text-[11px] font-black leading-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        recortado ? "border-amber-400 bg-amber-50" : "border-line"
                      }`}
                    />
                    {recortado && (
                      <span
                        className="pointer-events-none absolute bottom-0.5 left-1 block truncate text-[9px] font-black leading-none text-amber-700"
                      >
                        → {monedaFmt(v.ok ? v.monto : 0)}
                      </span>
                    )}
                  </td>
                  <td className="gj-celda relative h-8 px-1 py-0">
                    <SearchableSelect
                      options={opcionesClientes}
                      value={f.cliente1}
                      onChange={(v) => setFila(i, { cliente1: v })}
                      placeholder="Cliente 1…"
                      allowCustom={false}
                      displayValue={f.cliente1}
                      className=""
                      inputClassName="w-full rounded-md border border-line bg-white px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <span className="pointer-events-none absolute bottom-0.5 left-1 right-1 block leading-none">
                      {infoCliente(f.cliente1, f.monto, v.ok && v.cliente1 ? v.cliente1.cobroNeto : 0)}
                    </span>
                  </td>
                  <td className="gj-celda relative h-8 px-1 py-0">
                    <SearchableSelect
                      options={opcionesClientes}
                      value={f.cliente2}
                      onChange={(v) => setFila(i, { cliente2: v })}
                      placeholder="Cliente 2…"
                      allowCustom={false}
                      displayValue={f.cliente2}
                      className=""
                      inputClassName="w-full rounded-md border border-line bg-white px-1 py-0.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <span className="pointer-events-none absolute bottom-0.5 left-1 right-1 block leading-none">
                      {infoCliente(f.cliente2, f.monto, v.ok && v.cliente2 ? v.cliente2.cobroNeto : 0)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setModalCargaRapida(true)}>
            ⚡ Carga Rápida <span className="ml-1 rounded bg-warning-500/20 px-1.5 text-[9px] font-black text-warning-700">texto</span>
          </Button>
          <Button size="sm" onClick={() => setFilas((f) => [...f, filaVacia()])}>＋ Agregar fila</Button>
          <Button variant="success" size="md" className="ml-auto" onClick={cargarAtaquilla}>
            📥 Cargar jugada(s) en la taquilla
          </Button>
        </div>

        {/* Pre-visualización — jugadas cargadas en sesión con edición inline (✏️) */}
        {ticketsDeCarrera.length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-gray-50 p-2">
            <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
              🧾 Pre-visualización — jugadas cargadas en la taquilla ({ticketsDeCarrera.length}) ·{" "}
              <span className="normal-case font-semibold text-slate-400">✏️ devuelve la jugada a la tabla para corregirla</span>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="w-[4%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">#</th>
                    <th className="w-[3%] border-r border-slate-700 px-1 py-1 text-center font-bold uppercase">X</th>
                    <th className="w-[22%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Jugada</th>
                    <th className="w-[8%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Caballo</th>
                    <th className="w-[10%] border-r border-slate-700 px-1 py-1 text-right font-bold uppercase">Monto</th>
                    <th className="w-[17%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Cliente 1</th>
                    <th className="w-[19%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Cliente 2</th>
                    <th className="w-[17%] px-1 py-1 text-right font-bold uppercase">Premio/Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {ticketsDeCarrera.map((t, i) => {
                    const jugada = String(t.comando).replace(/^\d+(?:[.,]\d+)?\s+/, "").trim() || String(t.comando).trim();
                    const mejorCobre = Math.max(t.cobro1 ?? 0, t.cobro2 ?? 0, t.gananciaProyectada + t.monto);
                    const premio = mejorCobre > t.monto;
                    return (
                      <tr key={t.id} className="align-middle bg-white">
                        <td className="h-10 px-1 py-0 align-middle text-xs text-slate-400">{i + 1}</td>
                        <td className="h-10 px-1 py-0 align-middle text-center">
                          <button
                            type="button"
                            onClick={() => editarTicket(t.id)}
                            aria-label="Editar jugada"
                            title="Volver a la tabla como inputs editables"
                            className="text-xs text-slate-400 hover:text-primary-600"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => eliminarTicket(t.id)}
                            aria-label="Quitar jugada"
                            title="Quitar de la sesión"
                            className="ml-1 text-xs text-slate-400 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </td>
                        <td className="h-10 truncate px-1 py-0 align-middle font-mono text-[11px] font-semibold text-slate-700" title={t.comando}>
                          {jugada}
                        </td>
                        <td className="h-10 px-1 py-0 align-middle font-bold text-slate-800">{t.caballo ? t.caballo.toUpperCase() : "—"}</td>
                        <td className="h-10 px-1 py-0 align-middle text-right font-black text-slate-900">{monedaFmt(t.monto)}</td>
                        <td className="h-10 truncate px-1 py-0 align-middle text-xs font-semibold text-slate-700" title={t.cliente1}>
                          {t.cliente1 || "—"}
                        </td>
                        <td className="h-10 truncate px-1 py-0 align-middle text-xs font-semibold text-slate-700" title={t.cliente2}>
                          {t.cliente2 || "—"}
                        </td>
                        <td className={`h-10 px-1 py-0 align-middle text-right text-[11px] font-black ${premio ? "text-emerald-600" : "text-red-600"}`}>
                          {premio ? `+${monedaFmt(mejorCobre - t.monto)}` : `SALDO −${monedaFmt(t.monto - mejorCobre)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {aviso && <p className="mt-2 text-xs font-semibold text-slate-600">{aviso}</p>}
      </div>

      {/* Barra de comandos flotante (sticky bottom) */}
      <div className="no-print sticky bottom-0 z-30 -mx-4 border-t border-line bg-slate-900 px-4 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.18)] lg:-mx-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setModalPreliminar(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            📋 Preliminar <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+Q</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalResultados(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            🏁 Carga de Resultados <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+Y</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalFinalizar(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-success-600 to-emerald-500 px-3 py-2 text-xs font-black text-white hover:brightness-110"
          >
            ✅ Registrar y Finalizar <kbd className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-black">Ctrl+R</kbd>
          </button>
          <button
            type="button"
            onClick={() => setModalComandos(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            ⌨️ Comandos <kbd className="rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-black text-white">Ctrl+⇧+K</kbd>
          </button>
        </div>
      </div>

      {/* Modal Preliminar de Carrera (Ctrl+Q) */}
      {modalPreliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">📋 Preliminar de Carrera — {nombreHipodromo} C{carrera}</h3>
              <button type="button" onClick={() => setModalPreliminar(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[9px] font-bold uppercase text-slate-400">Retirados</p>
                  <p className="font-bold text-slate-800">{retirados.trim() || "NO HUBO RETIROS"}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-[9px] font-bold uppercase text-slate-400">Comisión</p>
                  <p className="font-bold text-slate-800">{comisionNum}%</p>
                </div>
              </div>
              <div className="rounded-lg border border-line">
                <p className="border-b border-line bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-500">
                  Ejemplares inscritos ({caballosDeCarrera.length})
                </p>
                <ul className="max-h-56 divide-y divide-line/60 overflow-y-auto px-3 py-1">
                  {caballosDeCarrera.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 py-1.5 text-sm">
                    <HorseBadge num={c.numero} size="md" retirado={c.retirado} />
                      <span className={`font-bold uppercase text-slate-800 ${c.retirado ? "line-through opacity-50" : ""}`}>{c.nombre || `Nº ${c.numero}`}</span>
                      {c.retirado && <span className="ml-auto rounded bg-red-100 px-1.5 text-[9px] font-black text-red-600">RET.</span>}
                    </li>
                  ))}
                  {!caballosDeCarrera.length && (
                    <li className="py-4 text-center text-xs italic text-slate-400">Sin ejemplares registrados para esta carrera (ni en Tablas Fijas ni en Carreras del Día).</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="flex justify-end border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" onClick={() => setModalPreliminar(false)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Carga de Resultados (Ctrl+Y) — posiciones dinámicas (5 + añadir hasta 8) + Dead Heat */}
      <CargaResultadosModal
        abierto={modalResultados}
        onCerrar={() => setModalResultados(false)}
        hipodromo={hipodromo}
        carrera={String(carrera)}
        caballos={caballosDeCarrera.length ? caballosDeCarrera : null}
        onConfirmar={(r) => {
          setUltimaPizarra(r);
          setModalResultados(false);
          setAviso(`🏁 Resultados C${carrera} cargados (${r.llenas} posiciones${r.empates.length ? ` · ${r.empates.length} empate(s)` : ""}).`);
          // Centraliza en resultados_carreras con la MISMA pizarra: así lo que
          // se carga acá aplica también a Tablas Fijas, Carreras del Día y
          // cualquier módulo que lea el resultado central.
          void guardarPizarraCentral({
            hipodromo,
            carrera,
            cargado_por: "GESTION-JUGADAS",
            r,
          }).then((res) => {
            if (!res.ok) setAviso(`⚠️ Resultado C${carrera} local, pero no se centralizó: ${res.error ?? "sin conexión"}`);
          });
        }}
      />

      {/* Registrar y Finalizar (Ctrl+R) */}
      {modalFinalizar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✅ Registrar y Finalizar — {nombreHipodromo} C{carrera}</h3>
              <button type="button" onClick={cerrarFinalizar} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
              {!ultimaPizarra ? (
                <p className="rounded-lg bg-warning-500/10 px-3 py-2 text-xs font-semibold text-warning-700">
                  ⚠️ Todavía no cargaste los resultados. Usá Ctrl+Y (Carga de Resultados) o confirmá abajo para abrir el modal.
                </p>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 p-3">
                  <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Pizarra cargada ({ultimaPizarra.llenas} posiciones)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(ultimaPizarra.pizarra)
                      .filter(([k, v]) => k !== "empates" && typeof v === "string" && v.trim() !== "")
                      .map(([k, v]) => (
                        <span key={k} className="rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black uppercase text-white">
                          {k}: <b>{v}</b>
                        </span>
                      ))}
                    {ultimaPizarra.empates.length > 0 && (
                      <span className="rounded-md bg-warning-500 px-2 py-1 text-[10px] font-black uppercase text-white">
                        ⚡ Empates: {ultimaPizarra.empates.join(", ")} (cero fraccionamiento)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {resumen ? (
                <div className="rounded-2xl border border-line p-3">
                  <p className="text-xs font-black uppercase text-slate-700">{resumen.ok ? "Resumen de la liquidación" : "Liquidación incompleta"}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Invertido</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.totalInvertido)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">A pagar (neto)</p>
                      <p className="font-black text-success-600">{monedaFmt(resumen.totalClienteNeto)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Balance de la banca</p>
                      <p className="font-black text-slate-900">{monedaFmt(resumen.balanceBanca)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-3 py-2">
                      <p className="text-[9px] font-bold uppercase text-slate-400">Comisión de la casa</p>
                      <p className="font-black text-primary-700">{monedaFmt(resumen.gananciaCasa)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] font-semibold text-slate-500">
                    {resumen.motivo} {resumen.tablaCerrada?.ok ? "· Tabla cerrada en BD ✔" : "· No se pudo cerrar la tabla en BD."}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-gray-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  {ticketsDeCarrera.length} ticket(s) en sesión · Invertido: <b>{monedaFmt(totalInvertidoSesion)}</b>. Al
                  confirmar, el motor liquida con la pizarra y cierra la carrera automáticamente.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={cerrarFinalizar}>Cerrar</Button>
              {!resumen && (
                <>
                  <Button size="sm" onClick={() => { setModalFinalizar(false); setModalResultados(true); }}>
                    🏁 Cargar resultados
                  </Button>
                  <Button variant="success" size="md" onClick={ejecutarFinalizar}>
                    💰 Registrar y Finalizar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comandos (Ctrl+Shift+K) */}
      {modalComandos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">⌨️ Comandos de la Taquilla</h3>
              <button type="button" onClick={() => setModalComandos(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="divide-y divide-line p-2">
              {[
                ["Ctrl+Q", "📋 Preliminar de Carrera", "Muestra ejemplares inscritos de la carrera activa."],
                ["Ctrl+Y", "🏁 Carga de Resultados", "Pizarra con 5 posiciones por defecto (+ puestos dinámicos hasta 8) + Empate (Dead Heat) por posición."],
                ["Ctrl+R", "✅ Registrar y Finalizar", "Liquida los tickets con el motor y cierra la carrera (estado= Cerrada)."],
                ["Ctrl+Shift+K", "⌨️ Comandos", "Este listado de atajos."],
              ].map(([kbd, titulo, desc]) => (
                <div key={kbd} className="flex items-start gap-3 px-2 py-2.5">
                  <kbd className="mt-0.5 shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-black text-white">{kbd}</kbd>
                  <div>
                    <p className="text-xs font-bold text-slate-800">{titulo}</p>
                    <p className="text-[11px] text-slate-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-line bg-gray-50 px-4 py-3">
              <Button size="sm" onClick={() => setModalComandos(false)}>Entendido</Button>
            </div>
          </div>
        </div>
      )}

      {/* Carga Rápida (texto libre) — pegar bloque y poblar tabla */}
      {modalCargaRapida && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">⚡ Carga Rápida — {nombreHipodromo} C{carrera}</h3>
              <button type="button" onClick={() => setModalCargaRapida(false)} className="text-slate-300 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 p-4">
              <textarea
                value={textoCargaRapida}
                onChange={(e) => setTextoCargaRapida(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={"Pegá el bloque de jugadas (1 por línea, CUALQUIER orden):\n\n3y3 9 40 emy mar\n2p 1 100 Perrito molinas\nJuega Lolo 2p (1) con 300 da Mar\n1/2 y 2n 7 100 Eddie Manuel\n2x3 10/8 2 100 Juan Pedro"}
                className="w-full resize-y rounded-xl border border-line bg-white p-3 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              />
              <p className="text-[10px] font-semibold text-slate-500">
                Motor heurístico por <b>tokens</b>: detecta <b>JUGADA · CABALLO · MONTO · CLIENTE 1 · CLIENTE 2</b>{" "}
                sin importar el orden (ej. <i>3y3 9 40 emy mar</i> o <i>Juega Lolo 2p (1) con 300 da Mar</i>). Líneas
                ilegibles quedan en <span className="font-black text-red-600">rojo ⚠️</span> en la tabla para
                corregirlas manualmente, sin romper el resto del bloque.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => { setTextoCargaRapida(""); setModalCargaRapida(false); }}>
                Cancelar
              </Button>
              <Button variant="success" size="md" onClick={poblarCargaRapida}>📥 Poblar tabla</Button>
            </div>
          </div>
        </div>
      )}

      {/* Evento Enter en barras superiores no debe recargar */}
      <input type="hidden" />
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Color de casaca por número (paleta ligera para el preliminar). */


export default GestionJugadasModule;