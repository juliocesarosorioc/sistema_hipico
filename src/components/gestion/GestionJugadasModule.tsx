"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectarModalidad, parsearLineaRapida, proyectarFila } from "@/lib/taquilla/validar";
import { useTaquillaStore, type TicketTaquilla } from "@/store/useTaquillaStore";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla, type ResLiquidarCarrera } from "@/lib/liquidacion/pagarYCerrar";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useHipodromosActivos } from "@/store/useHipodromosStore";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { SemaforoCarreras } from "@/components/gestion/SemaforoCarreras";
import { Button } from "@/components/ui/Button";
import { fmtMoney, type EjemplarTabla } from "@/lib/tablas/tipos";
import { listarClientesVenta, listarGruposVenta, saldoDeCliente, type ClienteVenta } from "@/lib/grupos";
import { listarCarrerasPorDia, asegurarHipodromo } from "@/lib/tablas/rpc";
import { registrarCarreraProgramada } from "@/lib/carreras-dia";
import { listarCarrerasCentrales, type CarreraCentral } from "@/lib/carreras/central";
import { aplicarRetirosCarrera, parsearRetirados } from "@/lib/carreras/retiros";
import { hoyLocal } from "@/lib/gaceta/programa";

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
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [carrerasPorDia, setCarrerasPorDia] = useState<number[]>([]);
  const [carrerasCentrales, setCarrerasCentrales] = useState<CarreraCentral[]>([]);
  const [carrera, setCarrera] = useState(1);
  const [modoManual, setModoManual] = useState(false);
  const [retirados, setRetirados] = useState("");
  const [comision, setComision] = useState("5");
  const [conCruces, setConCruces] = useState(false);
  const [filas, setFilas] = useState<FilaCarga[]>([filaVacia()]);
  const [aviso, setAviso] = useState("");
  const [jugadasPorCarrera, setJugadasPorCarrera] = useState<number[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);

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

  // Semáforo dinámico: carreras registradas en la BD para [fecha + hipódromo].
  // Al cambiar cualquiera de los dos, se re-consulta y la vista vuelve a C1.
  useEffect(() => {
    let vivo = true;
    setCarrerasPorDia([]);
    setCarrera(1);
    listarCarrerasPorDia(fecha, hipodromo)
      .then((c) => {
        if (!vivo) return;
        setCarrerasPorDia(c);
        // Si el hipódromo tiene carreras registradas, se activa su primera
        // carrera registrada (o la 1 si está entre ellas) para habilitar la
        // selección en el semáforo.
        if (c.length > 0) setCarrera(c.includes(1) ? 1 : Math.min(...c));
        else setCarrera(1);
      })
      .catch(() => {
        /* sin red → semáforo vacío */
        if (vivo) setCarrera(1);
      });
    return () => {
      vivo = false;
    };
  }, [fecha, hipodromo]);

  // Carreras del Día (editor central): ejemplares inscritos de la jornada — la
  // carrera puede existir SOLO aquí (registrada por número, sin tabla fija ni
  // gaceta). Alimenta el panel de ejemplares y la auto-resolución del CABALLO.
  useEffect(() => {
    let vivo = true;
    listarCarrerasCentrales(fecha, hipodromo)
      .then((r) => {
        if (vivo && r.ok) setCarrerasCentrales(r.datos ?? []);
      })
      .catch(() => {
        /* sin red → se conserva el panel de tabla fija */
      });
    return () => {
      vivo = false;
    };
  }, [fecha, hipodromo]);

  // Aislamiento por carrera: al cambiar de carrera se limpia la pizarra de la
  // vista anterior y se refresca el indicador de jugadas cargadas.
  useEffect(() => {
    setUltimaPizarra(null);
    setResumen(null);
  }, [carrera]);

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

  const valida = (f: FilaCarga) =>
    proyectarFila({ jugada: f.jugada, caballo: f.caballo.trim(), monto: f.monto, tasaComision: comisionNum });

  const tablaDeCarrera = useMemo(
    () =>
      tablas.find(
        (t) =>
          (t.hipodromo ?? "").toUpperCase().replace(/\s+/g, "") === hipodromo.toUpperCase().replace(/\s+/g, "") &&
          t.carrera === carrera
      ),
    [tablas, hipodromo, carrera]
  );

  /** Carrera central (Carreras del Día) que corresponde a la vista actual. */
  const centralDeCarrera = useMemo(
    () => carrerasCentrales.find((c) => Number(c.carrera) === Number(carrera)) ?? null,
    [carrerasCentrales, carrera]
  );

  /**
   * Ejemplares inscritos de la carrera en pantalla: prioriza la tabla fija
   * publicada; si la carrera solo existe en Carreras del Día, usa sus
   * ejemplares registrados (pueden ser solo número, sin nombre).
   */
  const caballosDeCarrera = useMemo<EjemplarTabla[]>(() => {
    // La lista CENTRAL de retiros manda sobre la tabla local: si un retiro se
    // aplicó en otro módulo, aquí se ve de inmediato sin esperar la recarga.
    const retiradosCentral = new Set(centralDeCarrera?.retirados ?? []);
    if (tablaDeCarrera?.caballos?.length) {
      return tablaDeCarrera.caballos.map((c) => ({
        ...c,
        retirado: Boolean(c.retirado) || retiradosCentral.has(String(c.numero)),
      }));
    }
    const cs = centralDeCarrera?.caballos ?? [];
    return cs.map((c) => ({
      numero: c.numero,
      nombre: c.nombre ?? "",
      nacionalidad: c.nacionalidad ?? null,
      retirado: Boolean(c.retirado) || retiradosCentral.has(String(c.numero)),
    }));
  }, [tablaDeCarrera, centralDeCarrera]);

  const monedaFmt = (n: number): string =>
    fmtMoney(Number.isFinite(n) ? n : 0, MONEDA);

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
   * Indicador inline de la celda del cliente: ✅ si el saldo alcanza el MONTO,
   * ⚠️ "Max: X" si no alcanza, o "Saldo X" en azul/rojo según el signo.
   * Fallback: cobro proyectado cuando el cliente no está en el registro.
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
    const monto = parseFloat(String(montoStr).replace(",", "."));
    const montoValido = Number.isFinite(monto) && monto > 0;
    if (montoValido) {
      if (saldo >= monto) {
        return <span className="truncate text-[9px] font-black text-emerald-600">✅ Saldo {monedaFmt(saldo)}</span>;
      }
      return <span className="truncate text-[9px] font-black text-red-500">⚠️ Max: {monedaFmt(saldo)}</span>;
    }
    const cls = saldo < 0 ? "text-red-600" : "text-blue-600";
    return <span className={`truncate text-[9px] font-bold ${cls}`}>Saldo {monedaFmt(saldo)}</span>;
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
   * ahí el retiro incide en Tablas Fijas, Marcas, Dupletas, Taquilla y el
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
    const c = await listarCarrerasCentrales(fecha, hipodromo);
    if (c.ok) setCarrerasCentrales(c.datos ?? []);
    setAviso(
      lista.length
        ? `⛔ Retirados C${carrera}: ${r.retirados.join(", ")} · ${r.tablasAfectadas} tabla(s) sincronizada(s)` +
            (r.reembolsos ? ` · ${r.reembolsos} ticket(s) reembolsado(s)` : "") +
            (r.premios.length ? ` · premios recalculados: ${r.premios.length}` : "")
        : `✔ C${carrera}: ${r.texto}`
    );
  };

  const cargarAtaquilla = () => {
    let n = 0;
    const errores: string[] = [];
    const indicesError: number[] = [];
    for (const f of filas) {
      if (!f.jugada.trim() && !f.monto.trim()) continue;
      const v = valida(f);
      if (!v.ok) {
        errores.push(`Fila ${filas.indexOf(f) + 1}: ${v.motivo}`);
        indicesError.push(filas.indexOf(f));
        continue;
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
    setAviso(`✅ ${n} jugada(s) enviada(s) a la taquilla (C${carrera}).` + (errores.length ? ` ${errores.length} fila(s) con error quedaron en rojo para corregir.` : ""));
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
    if (filasNuevas.length > 0) {
      setFilas(filasNuevas);
      setTextoCargaRapida("");
      setModalCargaRapida(false);
      setAviso(
        ok > 0
          ? `⚡ ${ok} fila(s) poblada(s) desde el bloque de texto.` +
              (ilegibles ? ` ⚠️ ${ilegibles} línea(s) ilegible(s) quedaron en rojo para corregir.` : "")
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
      setJugadasPorCarrera((j) => j.filter((c) => c !== carrera));
      setResumen(r);
    }
    setAviso(r.ok ? `✅ ${r.motivo}` : `❌ ${r.motivo}`);
  };

  const cerrarFinalizar = () => {
    setModalFinalizar(false);
    setResumen(null);
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Inputs superiores */}
      <div className="grid gap-3 rounded-2xl border border-line bg-surface p-3 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Hipódromo</label>
          <SearchableSelect
            options={hipodromos}
            value={hipodromo}
            onChange={setHipodromo}
            placeholder="Buscar hipódromo…"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Fecha 📅</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyLocal())}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
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
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">COM %</label>
          <input
            value={comision}
            onChange={(e) => setComision(e.target.value.replace(/[^0-9.,]/g, ""))}
            inputMode="decimal"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">En sesión · {fecha}</p>
          <p className="text-sm font-black text-slate-900">{monedaFmt(totalInvertidoSesion)}</p>
          <p className="text-[9px] text-slate-400">{ticketsDeCarrera.length} ticket(s) · <span className="font-semibold text-slate-600">{hipodromo.toUpperCase()} C{carrera}</span></p>
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
              {hipodromo} · Retirados: {retirados.trim() || "—"}
            </span>
          </span>
        </div>

        {/* Panel lateral de ejemplares (tabla fija publicada o Carreras del Día) */}
        <div className={caballosDeCarrera.length ? "flex flex-col gap-3 lg:flex-row" : ""}>
          {caballosDeCarrera.length > 0 && (
            <aside className="shrink-0 rounded-xl border border-line bg-white p-2 shadow-sm lg:w-[28%]">
              <p className="px-1 pb-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                🐎 Ejemplares registrados ({caballosDeCarrera.length})
              </p>
              <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto">
                {caballosDeCarrera.map((c, ci) => (
                  <li
                    key={ci}
                    className="flex items-center gap-2 px-1 py-1"
                    style={{ backgroundColor: c.retirado ? "rgba(239,68,68,0.06)" : undefined }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 flex-none items-center justify-center text-center text-[10px] font-bold"
                      style={{ backgroundColor: cardColor(c.numero), color: textoColor(c.numero) }}
                    >
                      {c.numero}
                    </span>
                    <span className={`min-w-0 flex-1 truncate text-xs font-bold uppercase ${c.retirado ? "text-red-500 line-through" : "text-slate-700"}`}>
                      {c.nombre || <span className="text-slate-400">Nº {c.numero} (sin nombre)</span>}
                    </span>
                    {c.retirado && (
                      <span className="shrink-0 rounded bg-red-100 px-1 text-[8px] font-black text-red-600">RET</span>
                    )}
                  </li>
                ))}
              </ul>
            </aside>
          )}
          <div className={caballosDeCarrera.length ? "min-w-0 flex-1" : "w-full"}>
            <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="w-[4%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">#</th>
              <th className="w-[3%] border-r border-slate-700 px-1 py-1 text-center font-bold uppercase">X</th>
              <th className="w-[22%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Jugada</th>
              <th className="w-[12%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Caballo</th>
              <th className="w-[12%] border-r border-slate-700 px-1 py-1 text-right font-bold uppercase">Monto</th>
              <th className="w-[23.5%] border-r border-slate-700 px-1 py-1 text-left font-bold uppercase">Cliente 1</th>
              <th className="w-[23.5%] px-1 py-1 text-left font-bold uppercase">Cliente 2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {filas.map((f, i) => {
              const v = valida(f);
              const detectado = f.jugada.trim() ? detectarModalidad(f.jugada) : null;
              const ejemplar = ejemplarResuelto(f.caballo);
              return (
                <tr key={i} className={`align-middle ${f.error ? "bg-red-50" : ""}`} title={f.error ?? undefined}>
                  <td className="relative h-12 px-1 py-0 align-middle text-xs text-slate-400">
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
                  <td className="relative h-12 px-1 py-0 align-middle text-center">
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
                  <td className="relative h-12 px-1 py-0 align-middle">
                    <input
                      value={f.jugada}
                      onChange={(e) => setFila(i, { jugada: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          cargarAtaquilla();
                        }
                      }}
                      placeholder="2x3 10/8 · 1p · 2n"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    <span
                      className={`pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-black uppercase leading-none tracking-wide ${
                        v.ok ? "text-emerald-600" : "text-slate-300"
                      }`}
                    >
                      {detectado ?? (f.jugada.trim() ? "—" : "")}
                    </span>
                  </td>
                  <td className="relative h-12 px-1 py-0 align-middle">
                    <input
                      value={f.caballo}
                      onChange={(e) => setFila(i, { caballo: e.target.value })}
                      placeholder="Nº"
                      inputMode="numeric"
                      title={ejemplar ? `${ejemplar.numero} - ${ejemplar.nombre}` : ""}
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    {ejemplar && (
                      <span
                        className={`pointer-events-none absolute bottom-0.5 left-1 right-1 truncate text-[9px] font-bold leading-none ${
                          ejemplar.retirado ? "text-red-500 line-through" : "text-gray-500"
                        }`}
                      >
                        {ejemplar.numero} - {ejemplar.nombre}
                        {ejemplar.retirado ? " (RET)" : ""}
                      </span>
                    )}
                  </td>
                  <td className="relative h-12 px-1 py-0 align-middle">
                    <input
                      value={f.monto}
                      onChange={(e) => setFila(i, { monto: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      className="w-full rounded-md border border-line bg-white px-1 py-1 text-right text-xs font-black text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                  </td>
                  <td className="relative h-12 px-1 py-0 align-middle">
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
                    <span className="pointer-events-none absolute bottom-0 left-1 right-1 leading-none">
                      {infoCliente(f.cliente1, f.monto, v.ok && v.cliente1 ? v.cliente1.cobroNeto : 0)}
                    </span>
                  </td>
                  <td className="relative h-12 px-1 py-0 align-middle">
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
                    <span className="pointer-events-none absolute bottom-0 left-1 right-1 leading-none">
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
              <h3 className="text-xs font-black uppercase">📋 Preliminar de Carrera — {hipodromo} C{carrera}</h3>
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
                      <span className="flex h-7 w-7 shrink-0 flex-none items-center justify-center rounded text-center text-[10px] font-bold"
                        style={{ backgroundColor: c.retirado ? "#ef4444" : cardColor(c.numero), color: c.retirado ? "#ffffff" : textoColor(c.numero) }}>
                        {c.numero}
                      </span>
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
        }}
      />

      {/* Registrar y Finalizar (Ctrl+R) */}
      {modalFinalizar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-slate-800 px-4 py-3 text-white">
              <h3 className="text-xs font-black uppercase">✅ Registrar y Finalizar — {hipodromo} C{carrera}</h3>
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
              <h3 className="text-xs font-black uppercase">⚡ Carga Rápida — {hipodromo} C{carrera}</h3>
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
function cardColor(n: string | number): string {
  const i = ((Number(n) || 1) - 1) % 14;
  return ["#dc2626", "#f5f5f4", "#2563eb", "#facc15", "#16a34a", "#111827", "#f97316", "#f9a8d4", "#22d3ee", "#9333ea", "#6b7280", "#4ade80", "#92400e", "#7f1d1d"][i < 0 ? 0 : i];
}

/** Fondos claros de `cardColor` que necesitan texto oscuro para leerse. */
const FONDOS_CLAROS = new Set(["#f5f5f4", "#facc15", "#f9a8d4", "#22d3ee", "#4ade80"]);

/** Texto legible según el fondo de `cardColor` (los claros llevan texto oscuro). */
function textoColor(n: string | number): string {
  return FONDOS_CLAROS.has(cardColor(n)) ? "#111827" : "#ffffff";
}

export default GestionJugadasModule;