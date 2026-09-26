"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTablasFijasStore, type StoredTablaFija } from "@/store/useTablasFijasStore";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { parseNum, sumaBase, fmtMoney, type DraftCarrera, type ItemCarritoVenta } from "@/lib/tablas/tipos";
import { aDraftCarrera, eliminarDelRegistroGaceta, leerBuzonEnsamblaje, limpiarBuzonEnsamblaje } from "@/lib/gaceta/ui";
import { useCarrerasDiaStore } from "@/store/useCarrerasDiaStore";
import { registrarCarreraProgramada } from "@/lib/carreras-dia";
import { asegurarHipodromo } from "@/lib/tablas/rpc";
import { hoyLocal } from "@/lib/gaceta/programa";
import { SeccionPliegue } from "@/components/tablas/SeccionPliegue";
import { ParametrosCarrera } from "@/components/tablas/ParametrosCarrera";
import { TarjetaEnsamblaje } from "@/components/tablas/TarjetaEnsamblaje";
import { MonitorTablas, type VentaTablaItem } from "@/components/tablas/MonitorTablas";
import { CarritoVentas } from "@/components/tablas/CarritoVentas";
import { ToastHost } from "@/components/ui/ToastHost";
import { Guard } from "@/components/ui/Guard";
import ConfigImpresionModal from "@/components/tablas/ConfigImpresionModal";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";

export type ErrorPublicacion = { hipodromo: string; carrera: number | null; error: string };

type Props = {
  /** Devuelve el id real de Supabase + error legible. El contenedor reemplaza el id del store. */
  persistirPublicacion?: (t: StoredTablaFija) => Promise<{ ok: boolean; id?: string | number | null; error?: string }>;
  /** Publicación en lote (batch) para "Publicar todas". */
  persistirLote?: (
    lote: StoredTablaFija[]
  ) => Promise<{ ok: boolean; okCount: number; errores: ErrorPublicacion[] }>;
  persistirEdicion?: (t: StoredTablaFija, patch: Record<string, unknown>) => Promise<boolean>;
  persistirVenta?: (t: StoredTablaFija, v: VentaTablaItem) => Promise<boolean>;
  persistirLiquidacion?: (t: StoredTablaFija, r: PizarraResultados) => Promise<boolean>;
};

/**
 * Módulo Tablas Fijas — clon 1:1 de html/tablas.html:
 *  · Cabecera blanca con botón refrescar
 *  · Bloques desplegables: Parámetros de la próxima carrera / Carreras en el
 *    Ensamblaje / Monitor de Tablas Publicadas (con botón verde IMPRIMIR TABLAS)
 *  · Carrito de venta flotante arriba a la derecha (Cerrar Venta → taquilla)
 *  · Auto-cierre reactivo: al liquidar, la tabla se cierra en Supabase (UPDATE
 *    estado='Cerrada') y desaparece del Monitor sin recargar (marcarCerrada +
 *    suscripción realtime a tablas_fijas, defensiva).
 */
export function TablasModule(props: Props) {
  const router = useRouter();
  const { persistirPublicacion, persistirLote, persistirEdicion, persistirVenta, persistirLiquidacion } = props;

  const tablas = useTablasFijasStore((s) => s.tablas);
  const setTablas = useTablasFijasStore((s) => s.setTablas);
  const marcarCerrada = useTablasFijasStore((s) => s.marcarCerrada);
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  const carrerasDia = useCarrerasDiaStore((s) => s.carreras);

  const [secciones, setSecciones] = useState({ parametros: false, ensamblaje: false, monitor: true });
  const [impresion, setImpresion] = useState(false);
  const [modoManual, setModoManual] = useState(false);
  const [drafts, setDrafts] = useState<DraftCarrera[]>([]);
  const [carrito, setCarrito] = useState<ItemCarritoVenta[]>([]);
  /** Fecha del programa (Filtro Universal): las tarjetas heredadas de la
   *  Gaceta traen la fecha del evento; las manuales usan este valor (hoy). */
  const [fechaPrograma, setFechaPrograma] = useState(() => hoyLocal());

  const openCount = tablas.filter((t) => !t.cerrada).length;

  const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

  const refresh = async () => {
    const { listarTablasPublicadas } = await import("@/lib/tablas/rpc");
    const filas = await listarTablasPublicadas();
    setTablas(filas);
  };

  // Carga inicial
  useEffect(() => {
    void refresh();
    // Hidrata las tarjetas desde el buzón de la Gaceta (ensamblaje_carreras +
    // gaceta_prellenado), igual que el legacy js/tablas.js migrarLegacy, y luego
    // CONSUME el buzón para que no se dupliquen al recargar.
    const buzon = leerBuzonEnsamblaje();
    const hidratadas = buzon
      .map((c) => aDraftCarrera(c))
      .filter((d) => d.caballos.length > 0);
    if (hidratadas.length > 0) {
      setDrafts((ds) => [...hidratadas, ...ds]);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            msg: `🗂️ ${hidratadas.length} carrera(s) llegaron de la Gaceta. Revise y publique.`,
            tipo: "info",
          },
        })
      );
    }
    limpiarBuzonEnsamblaje();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime defensivo: si tablas_fijas está en la publicación supabase_realtime,
  // cualquier UPDATE/INSERT/DELETE (otra sesión, liquidación…) refresca el Monitor
  // al instante. Si no, basta con el botón Refrescar / la ruta reactiva local.
  useEffect(() => {
    let canal: { unsubscribe: () => void } | null = null;
    (async () => {
      const { supabase } = await import("@/lib/supabase");
      if (!supabase) return;
      try {
        canal = supabase
          .channel(`tablas-fijas-${Date.now()}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "tablas_fijas" }, () => {
            void refresh();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "resultados_carreras" }, () => {
            void import("@/lib/carreras-dia").then((m) => m.cargarCarrerasDelDia().catch(() => {}));
          })
          .subscribe();
      } catch {
        /* sin realtime → refresh manual */
      }
    })();
    return () => {
      try {
        canal?.unsubscribe();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const publicar = async (tabla: StoredTablaFija): Promise<{ ok: boolean; error?: string }> => {
    if (!persistirPublicacion) {
      setTablas([...tablas.filter((t) => String(t.id) !== String(tabla.id)), tabla as StoredTablaFija]);
      return { ok: true };
    }
    const r = await persistirPublicacion(tabla);
    if (!r.ok) return { ok: false, error: r.error || "desconocido" };
    setTablas([...tablas.filter((t) => String(t.id) !== String(tabla.id)), { ...tabla, id: r.id ?? tabla.id } as StoredTablaFija]);
    return { ok: true };
  };

  const draftATabla = (d: DraftCarrera): StoredTablaFija => ({
    id: d.uid,
    hipodromo: d.hipodromo.trim().toUpperCase(),
    hipodromo_id: null,
    carrera: Math.round(parseNum(d.carrera)) || null,
    // La fecha del evento heredada de la Gaceta SIEMPRE gana; si la tarjeta
    // es manual, usa la fecha del Filtro Universal (nunca UTC del sistema).
    fecha: d.fecha || fechaPrograma,
    fecha_creacion: new Date().toISOString(),
    estado: "Abierta",
    premio_original: parseNum(d.premio),
    premio_recalculado: parseNum(d.premio),
    suma_base_tabla: sumaBase(d.caballos),
    limite_ventas: 0,
    cantidad_vendida: 0,
    moneda: "USD",
    tasa_cambio: null,
    distancia_carrera: d.distancia,
    superficie: (d.superficie || "ARENA").toUpperCase(),
    retirados_oficiales: null,
    comision_grupo: 0,
    grupo_venta: null,
    // Saneamiento del payload: `valor_ejemplar` siempre a Number y ceros
    // explícitos, para que Supabase reciba datos limpios (sin NaN/cadenas).
    caballos: (d.caballos ?? []).map((cb) => {
      // Detección automática de nacionalidad americana si no viene definida
      let nac = cb.nacionalidad ? String(cb.nacionalidad).toUpperCase() : "";
      if (!nac) {
        const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(d.hipodromo);
        nac = esAmericano ? "US" : "VE";
      }
      
      return {
        numero: cb.numero,
        nombre: String(cb.nombre || "").trim().toUpperCase(),
        nacionalidad: nac,
        valor_ejemplar: parseNum(cb.valor_ejemplar) || 0,
        retirado: !!cb.retirado,
        ganador: !!cb.ganador,
        ejemplar_id: cb.ejemplar_id ?? null,
      };
    }),
    
    tabla_grupos: null,
    cerrada: false,
  });

  const publicarDraft = async (d: DraftCarrera) => {
    if (!d.hipodromo.trim()) return toast("Escriba el hipódromo de la carrera.", "warning");
    if (!d.carrera.trim()) return toast("Indique el número de la carrera.", "warning");
    if ((d.caballos ?? []).length === 0 && !modoManual)
      return toast("Añada al menos un ejemplar (o active ✍️ Modo Manual para registrar la carrera vacía).", "warning");

    // Modo Manual sin ejemplares: registra el hipódromo (crea si es nuevo) y
    // la carrera vacía en resultados_carreras, sin publicar una tabla sin datos.
    if ((d.caballos ?? []).length === 0) {
      await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
      const r = await registrarCarreraProgramada({
        fecha: d.fecha || fechaPrograma,
        hipodromo: d.hipodromo.trim(),
        carrera: Math.round(parseNum(d.carrera)) || d.carrera,
      }).catch(() => ({ ok: false as const, error: "sin conexión" }));
      eliminarDelRegistroGaceta(d.hipodromo.toUpperCase(), d.carrera);
      setDrafts((ds) => ds.filter((x) => x.uid !== d.uid));
      toast(
        r?.ok
          ? `✅ Carrera ${d.hipodromo.toUpperCase()} C${d.carrera} registrada (Modo Manual, sin ejemplares).`
          : `⚠️ Carrera registrada localmente; no se pudo persistir en BD: ${r?.error ?? "desconocido"}`,
        r?.ok ? "success" : "warning"
      );
      return;
    }

    const res = await publicar(draftATabla(d));
    if (res.ok) {
      await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
      toast(`✅ Tabla ${d.hipodromo.toUpperCase()} C${d.carrera} publicada con éxito.`, "success");
      eliminarDelRegistroGaceta(d.hipodromo.toUpperCase(), d.carrera);
      setDrafts((ds) => ds.filter((x) => x.uid !== d.uid));
    } else {
      toast("Error al publicar: " + (res.error || "desconocido"), "error");
    }
  };

  const publicarTodas = async () => {
    if (drafts.length === 0) return toast("No hay carreras en el ensamblaje.", "info");
    const validas = drafts.filter(
      (d) => d.hipodromo.trim() && d.carrera.trim() && (modoManual || (d.caballos ?? []).length > 0)
    );
    if (validas.length === 0)
      return toast(
        modoManual
          ? "Revise hipódromo y carrera de las tarjetas del ensamblaje."
          : "Ninguna carrera válida para publicar (active ✍️ Modo Manual para registrar carreras vacías).",
        "warning"
      );

    if (modoManual) {
      // En modo manual el lote registra TODAS las carreras: vacías → la
      // carrera programada en resultados_carreras; con caballos → tabla fija.
      let okVacios = 0;
      let okTablas = 0;
      const tablasConCaballos = validas.filter((d) => (d.caballos ?? []).length > 0);
      const vacias = validas.filter((d) => (d.caballos ?? []).length === 0);
      for (const d of vacias) {
        await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
        const r = await registrarCarreraProgramada({
          fecha: d.fecha || fechaPrograma,
          hipodromo: d.hipodromo.trim(),
          carrera: Math.round(parseNum(d.carrera)) || d.carrera,
        }).catch(() => ({ ok: false as const, error: "sin conexión" }));
        if (r?.ok) okVacios++;
      }
      if (tablasConCaballos.length) {
        const lote = tablasConCaballos.map((d) => draftATabla(d));
        if (persistirLote) {
          const r = await persistirLote(lote);
          okTablas = r.okCount;
        } else {
          for (const t of lote) {
            const r = await publicar(t);
            if (r.ok) okTablas++;
          }
        }
      }
      validas.forEach((d) => eliminarDelRegistroGaceta(d.hipodromo.toUpperCase(), d.carrera));
      setDrafts((ds) => ds.filter((d) => !validas.some((v) => v.uid === d.uid)));
      return toast(
        `✅ Modo Manual: ${okVacios} carrera(s) vacía(s) registrada(s) · ${okTablas} tabla(s) publicada(s).`,
        "success"
      );
    }

    const lote = validas.map((d) => draftATabla(d));
    const claveDeDraft = (d: DraftCarrera) =>
      `${d.hipodromo.trim().toUpperCase()}|${Math.round(parseNum(d.carrera)) || d.carrera}`;
    const draftPorClave = new Map(validas.map((d) => [claveDeDraft(d), d]));

    let okCount = 0;
    let errores: ErrorPublicacion[] = [];
    if (persistirLote) {
      const r = await persistirLote(lote);
      okCount = r.okCount;
      errores = r.errores ?? [];
    } else {
      for (const t of lote) {
        const r = await publicar(t);
        if (r.ok) okCount++;
        else errores.push({ hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: r.error || "desconocido" });
      }
    }

    // Una vez publicadas, salen del Ensamblaje (solo vuelven las que fallaron).
    const restantes = drafts.filter((d) => !validas.some((v) => v.uid === d.uid));
    errores.forEach((e) => {
      const d = draftPorClave.get(`${String(e.hipodromo).toUpperCase()}|${e.carrera}`);
      if (d) restantes.push(d);
    });
    setDrafts(restantes);
    validas.forEach((d) => eliminarDelRegistroGaceta(d.hipodromo.toUpperCase(), d.carrera));

    if (okCount === lote.length) {
      toast(`✅ ${okCount} tabla(s) publicada(s) con éxito.`, "success");
    } else if (okCount > 0) {
      toast(`⚠️ ${okCount} tabla(s) publicada(s), ${errores.length} con error: ${errores.map((e) => e.error).join("; ")}.`, "warning");
    } else {
      toast(`Error al publicar: ${errores.map((e) => e.error).join("; ") || "desconocido"}`, "error");
    }
  };

  const pegarDesdeGaceta = () => {
    router.push("/ejemplares?tab=gaceta");
  };

  const agregarAlCarrito = (v: VentaTablaItem) => {
    const tabla = tablas.find((t) => String(t.id) === String(v.tablaId));
    if (!tabla) return;
    const item: ItemCarritoVenta = {
      id: "it-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      tablaId: v.tablaId,
      hipodromo: tabla.hipodromo ?? "",
      carrera: tabla.carrera ?? null,
      premio: tabla.premio_recalculado ?? 0,
      moneda: tabla.moneda,
      numero: v.numero,
      nombre: v.nombre,
      monto: v.monto,
      cantidad: v.cantidad ?? v.monto,
      grupo: v.grupo,
      jugador: v.jugador,
    };
    setCarrito((c) => [...c, item]);
  };

  const cerrarVenta = async () => {
    if (carrito.length === 0) return;
    let vendidos = 0;
    for (const item of carrito) {
      const tabla = tablas.find((t) => String(t.id) === String(item.tablaId));
      if (!tabla) continue;
      const base = (tabla.premio_recalculado ?? 0) * item.monto;
      agregarTicket({
        comando:
          item.nombre === "TABLA COMPLETA"
            ? `TABLA ${item.hipodromo} C${item.carrera} TABLA COMPLETA`
            : `TABLA ${item.hipodromo} C${item.carrera} N${item.numero} ${item.nombre}`,
        monto: item.monto,
        gananciaProyectada: base,
        comision: base * 0.05,
      });
      if (persistirVenta) {
        await persistirVenta(tabla, { tablaId: item.tablaId, numero: item.numero, nombre: item.nombre, monto: item.monto });
      }
      // Centralización: registra la venta en el ledger "Carreras del Día".
      useCarrerasDiaStore.getState().agregarVenta(item.hipodromo, item.carrera ?? 0, {
        numero: item.numero,
        nombre: item.nombre,
        cantidad: item.cantidad ?? item.monto,
        grupo: item.grupo?.nombre ?? null,
        jugador: item.jugador?.nombre ?? null,
        tablaId: item.tablaId,
      });
      setTablas(
        tablas.map((t) =>
          String(t.id) === String(item.tablaId)
            ? { ...t, cantidad_vendida: (t.cantidad_vendida ?? 0) + item.monto }
            : t
        )
      );
      vendidos++;
    }
    setCarrito([]);
    if (vendidos > 0) toast(`✅ Venta cerrada: ${vendidos} tabla(s) enviada(s) a la taquilla.`, "success");
  };

  const liquidar = async (tabla: StoredTablaFija, r: PizarraResultados) => {
    if (persistirLiquidacion) {
      const ok = await persistirLiquidacion(tabla, r);
      if (ok) marcarCerrada(tabla.hipodromo ?? "", tabla.carrera ?? 0);
    } else {
      marcarCerrada(tabla.hipodromo ?? "", tabla.carrera ?? 0);
    }
  };

  const editar = async (tabla: StoredTablaFija, patch: Record<string, unknown>) => {
    if (persistirEdicion) {
      const ok = await persistirEdicion(tabla, patch);
      if (ok) setTablas(tablas.map((t) => (String(t.id) === String(tabla.id) ? { ...t, ...patch } : t)));
    } else {
      setTablas(tablas.map((t) => (String(t.id) === String(tabla.id) ? { ...t, ...patch } : t)));
    }
  };

  const retirar = async (tabla: StoredTablaFija, indice: number, retirado: boolean): Promise<boolean> => {
    const { retirarEjemplarTabla } = await import("@/lib/tablas/rpc");
    const r = await retirarEjemplarTabla(tabla, indice, retirado);
    if (!r.ok) {
      toast(`No se pudo ${retirado ? "retirar" : "rehabilitar"} el ejemplar: ${r.error ?? "Error"}.`, "error");
      return false;
    }
    toast(
      `Ejemplar ${retirado ? "retirado" : "rehabilitado"}. Premio recalculado: ${fmtMoney(r.premio ?? null, tabla.moneda)}${
        r.reembolsos ? ` (${r.reembolsos} reembolso(s))` : ""
      }`,
      "success"
    );
    void refresh();
    return true;
  };

  const eliminar = async (tabla: StoredTablaFija) => {
    const { eliminarTablaFija } = await import("@/lib/tablas/rpc");
    const r = await eliminarTablaFija(tabla.id);
    if (!r.ok) {
      toast(`No se pudo eliminar la tabla: ${r.error ?? "Error"}.`, "error");
      return;
    }
    setTablas(tablas.filter((t) => String(t.id) !== String(tabla.id)));
    toast(`🗑️ Tabla ${tabla.hipodromo} C${tabla.carrera} eliminada. La carrera y el Padrón se conservan.`, "success");
  };

  const als = "flex items-stretch";

  return (
    <div className="space-y-4">
      {/* Cabecera blanca del módulo */}
      <div className="no-print flex items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h1 className="text-lg font-black uppercase text-slate-900">🏇 Tablas Fijas</h1>
          <p className="text-xs text-slate-500">Ensambla, publica, vende e imprime — sincronizado con Supabase.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-1.5 text-xs font-black uppercase text-slate-600 transition-colors hover:bg-surface"
          title="Refrescar del servidor"
        >
          🔄 <span className="hidden sm:inline">Refrescar</span>
        </button>
        <label
          className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-black uppercase text-slate-600"
          title="Filtro Universal por fecha: las tarjetas manuales y carreras vacías se publican bajo ESTA fecha (YYYY-MM-DD)"
        >
          📅
          <input
            type="date"
            value={fechaPrograma}
            onChange={(e) => setFechaPrograma(e.target.value || hoyLocal())}
            className="bg-transparent text-xs font-bold text-slate-700 outline-none"
          />
        </label>
      </div>

      {/* Bloque 1: Parámetros */}
      <SeccionPliegue
        titulo="Parámetros de la próxima carrera"
        icono="🔧"
        abierto={secciones.parametros}
        onToggle={() => setSecciones((s) => ({ ...s, parametros: !s.parametros }))}
      >
        <ParametrosCarrera onAgregar={(d) => setDrafts((ds) => [...ds, d])} />
      </SeccionPliegue>

      {/* Bloque 2: Carreras en el Ensamblaje */}
      <SeccionPliegue
        titulo="Carreras en el Ensamblaje"
        icono="🗂️"
        contador={drafts.length}
        abierto={secciones.ensamblaje}
        onToggle={() => setSecciones((s) => ({ ...s, ensamblaje: !s.ensamblaje }))}
        accion={
          <div className={als}>
            <button
              type="button"
              onClick={() => setModoManual((m) => !m)}
              className={`m-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wide shadow-md transition-colors ${
                modoManual
                  ? "bg-cyan-600 text-white hover:bg-cyan-700"
                  : "border border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
              }`}
              title="Modo Manual: permite registrar carreras vacías escritas a mano sin depender de la Gaceta IA."
            >
              {modoManual ? "✅ Modo Manual ON" : "✍️ Modo Manual"}
            </button>
            <button
              type="button"
              onClick={pegarDesdeGaceta}
              className="m-1.5 whitespace-nowrap rounded-lg bg-cyan-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-cyan-700"
              title="Ir al módulo de Gacetas IA (las carreras se extraen desde la IA)"
            >
              📋 Pegar desde Gaceta
            </button>
            <button
              type="button"
              onClick={() => void publicarTodas()}
              disabled={drafts.length === 0}
              className="m-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              🚀 Publicar todas
            </button>
          </div>
        }
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {drafts.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
              <p className="text-sm font-semibold text-slate-500">El ensamblaje está vacío.</p>
              <p className="mt-1 text-xs text-slate-400">Añade una carrera desde “Parámetros de la próxima carrera”.</p>
            </div>
          ) : (
            drafts.map((d) => (
              <TarjetaEnsamblaje
                key={d.uid}
                draft={d}
                onChange={(nd) => setDrafts((ds) => ds.map((x) => (x.uid === d.uid ? nd : x)))}
                onPublicar={publicarDraft}
                onQuitar={(uid) => {
                  const quitable = drafts.find((x) => x.uid === uid);
                  if (quitable) eliminarDelRegistroGaceta(quitable.hipodromo.toUpperCase(), quitable.carrera);
                  setDrafts((ds) => ds.filter((x) => x.uid !== uid));
                }}
              />
            ))
          )}
        </div>
      </SeccionPliegue>

      {/* Bloque 3: Monitor de Tablas Publicadas + botón verde IMPRIMIR TABLAS */}
      <SeccionPliegue
        titulo="Monitor de Tablas Publicadas"
        icono="🖥️"
        contador={openCount}
        abierto={secciones.monitor}
        onToggle={() => setSecciones((s) => ({ ...s, monitor: !s.monitor }))}
      >
        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 no-print">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">🚦 Carreras del Día</span>
              {tablas.filter((t) => !t.cerrada).map((t) => {
              const est = carrerasDia.find(
                (c) => c.hipodromo === (t.hipodromo ?? "").toUpperCase() && c.carrera === t.carrera
              );
              const color =
                est?.estado === "Liquidada"
                  ? "border-slate-400 bg-slate-100 text-slate-600"
                  : est?.estado === "Resultados"
                    ? "border-amber-400 bg-amber-50 text-amber-700"
                    : "border-emerald-400 bg-emerald-50 text-emerald-700";
              return (
                <span
                  key={String(t.id)}
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${color}`}
                  title={
                    est?.pago
                      ? `Pago automático de tablas vendidas: ${fmtMoney(est.pago.totalPagado)} (${est.pago.tablasPagadas} tabla(s))`
                      : `${est?.ventas?.length ?? 0} venta(s) registrada(s)`
                  }
                >
                  {t.hipodromo} C{t.carrera} · {est?.estado ?? "Programada"}
                </span>
              );
            })}
            </div>
            <Guard permiso="imprimir_tablas">
              <button
                type="button"
                onClick={() => setImpresion(true)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-emerald-700"
                title="Imprimir / exportar tablas publicadas (matriz 15 por hoja o reporte por jugador)"
              >
                🖨️ Imprimir Tablas
              </button>
            </Guard>
          </div>
          <MonitorTablas tablas={tablas} onVender={agregarAlCarrito} onLiquidar={liquidar} onEditar={editar} onRetirar={retirar} onEliminar={eliminar} />
        </div>
      </SeccionPliegue>

      <ConfigImpresionModal abierto={impresion} onCerrar={() => setImpresion(false)} tablasRespaldo={tablas} />

      {/* Carrito flotante + toasts */}
      <CarritoVentas items={carrito} onQuitarItem={(id) => setCarrito((c) => c.filter((i) => i.id !== id))} onVaciar={() => setCarrito([])} onCerrarVenta={() => void cerrarVenta()} />
      <ToastHost />
    </div>
  );
}

export default TablasModule;