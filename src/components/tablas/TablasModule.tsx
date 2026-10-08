"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTablasFijasStore, type StoredTablaFija } from "@/store/useTablasFijasStore";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { parseNum, sumaBase, fmtMoney, type DraftCarrera, type ItemCarritoVenta } from "@/lib/tablas/tipos";
import { aDraftCarrera, eliminarDelRegistroGaceta, leerBuzonEnsamblaje, limpiarBuzonEnsamblaje } from "@/lib/gaceta/ui";
import { useCarrerasDiaStore } from "@/store/useCarrerasDiaStore";
import { registrarCarreraProgramada, cargarCarrerasDelDia } from "@/lib/carreras-dia";
import {
  numeroCarrera,
  sembrarCarreraCentral,
  useRegistroCentralOpts,
} from "@/store/useRegistroCentral";
import { MonitorHipodromos } from "@/components/ui/MonitorHipodromos";
import { agruparPorHipodromo, diaDeCarrera } from "@/lib/carreras/agruparHipodromos";
import { asegurarHipodromo } from "@/lib/tablas/rpc";
import { resumenProblemasCarga, validarFechasDeCarga } from "@/lib/tablas/validar-carga";
import { hoyLocal } from "@/lib/gaceta/programa";
import { SeccionPliegue } from "@/components/tablas/SeccionPliegue";
import { ParametrosCarrera } from "@/components/tablas/ParametrosCarrera";
import { TarjetaEnsamblaje } from "@/components/tablas/TarjetaEnsamblaje";
import { MonitorTablas, type VentaTablaItem } from "@/components/tablas/MonitorTablas";
import { ToastHost } from "@/components/ui/ToastHost";
import { Guard } from "@/components/ui/Guard";
import ConfigImpresionModal from "@/components/tablas/ConfigImpresionModal";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";

export type ErrorPublicacion = { hipodromo: string; carrera: number | null; error: string; publicada?: boolean };

type Props = {
  /** Devuelve el id real de Supabase + error legible. El contenedor reemplaza el id del store. */
  persistirPublicacion?: (t: StoredTablaFija) => Promise<{ ok: boolean; id?: string | number | null; error?: string }>;
  /** Publicación en lote (batch) para "Publicar todas". */
  persistirLote?: (
    lote: StoredTablaFija[]
  ) => Promise<{ ok: boolean; okCount: number; errores: ErrorPublicacion[] }>;
  persistirEdicion?: (t: StoredTablaFija, patch: Record<string, unknown>) => Promise<boolean>;
  persistirVenta?: (
    t: StoredTablaFija,
    v: VentaTablaItem
  ) => Promise<{ ok: boolean; error?: string }>;
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
  const [menuEnsamblaje, setMenuEnsamblaje] = useState(false);
  const [drafts, setDrafts] = useState<DraftCarrera[]>([]);
  /** Fecha del programa (Filtro Universal): las tarjetas heredadas de la
   *  Gaceta traen la fecha del evento; las manuales usan este valor (hoy). */
  const [fechaPrograma, setFechaPrograma] = useState(() => hoyLocal());
  /** Registro central: la misma lectura de carreras del día que Marcas y Gestión. */
  const registroCentral = useRegistroCentralOpts(fechaPrograma);
  /** Filtro de hipódromo activado desde las columnas "Hipódromos del Día". */
  const [filtroHipodromo, setFiltroHipodromo] = useState<string>("");

  const openCount = tablas.filter((t) => !t.cerrada).length;

  /** Hipódromos del día (abiertos, de la fecha seleccionada) ordenados
   *  alfabéticamente, con sus carreras y estado. Solo la fecha indicada por
   *  el filtro de día (por defecto hoy). La normalización de fecha y el
   *  agrupado viven en lib/carreras/agruparHipodromos (compartidos con
   *  Carreras del Día). */
  const hipodromosDia = useMemo(() => {
    const abiertas = tablas.filter((t) => !t.cerrada);
    // Agrupación compartida con Carreras del Día: mismos grupos, misma
    // normalización de fecha y mismos colores de estado.
    return agruparPorHipodromo(
      abiertas.map((t) => {
        const hipo = (t.hipodromo ?? "").trim().toUpperCase();
        // Cruce acotado al día: el ledger guarda varias fechas con el mismo
        // (hipódromo, carrera) y sin comparar `e.fecha` el chip heredaba el
        // estado de otro día.
        const dia = diaDeCarrera(t, fechaPrograma);
        const est = carrerasDia.find(
          (e) => e.hipodromo === hipo && e.carrera === t.carrera && e.fecha === dia
        );
        return {
          id: t.id,
          hipodromo: hipo,
          carrera: t.carrera,
          fecha: t.fecha,
          fecha_creacion: t.fecha_creacion,
          estado: est?.estado ?? "Programada",
          ventas: est?.ventas?.length ?? 0,
        };
      }),
      fechaPrograma
    );
  }, [tablas, fechaPrograma, carrerasDia]);

  const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

  /** Descarga la Matriz de Tablas Fijas (la misma vista de impresión) como `.xls`. */
  const exportarExcel = async () => {
    setMenuEnsamblaje(false);
    try {
      const [{ cargarMatrizImpresion }, { exportarExcelTablas }] = await Promise.all([
        import("@/lib/impresion/tablas"),
        import("@/lib/impresion/excel"),
      ]);
      const m = await cargarMatrizImpresion(tablas, { dia: fechaPrograma, hipodromo: filtroHipodromo });
      if (m.carreras.length === 0) {
        toast("No hay tablas publicadas para exportar.", "warning");
        return;
      }
      const ok = exportarExcelTablas(m.carreras, `TABLAS-FIJAS-${fechaPrograma}`);
      if (ok) toast(`Excel generado con ${m.carreras.length} carreras.`, "success");
      else toast("No se pudo generar el archivo Excel.", "error");
    } catch (e) {
      toast(`No se pudo generar el Excel: ${(e as Error)?.message ?? e}`, "error");
    }
  };

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
    const todas = buzon.map((c) => aDraftCarrera(c));
    // Solo las carreras DEL DÍA: la plataforma tiene un registro único y
    // central, y una gaceta leída para otra fecha no puede aparecer en este
    // programa (se conserva en el buzón para cuando cambie la fecha).
    const hoy = hoyLocal();
    const hidratadas = todas.filter((d) => !d.fecha || String(d.fecha).slice(0, 10) === hoy);
    // Las tarjetas SIN ejemplares se hidratan también: el filtro las botaba en
    // silencio, y como `limpiarBuzonEnsamblaje()` corre igual, esas carreras se
    // perdían para siempre — se registraban en la Gaceta, no aparecían como
    // cards, y nunca llegaban al Monitor ni a ningún módulo. Publicar una vacía
    // es lo que hace `publicarDraft` (registra la carrera programada).
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
    limpiarBuzonEnsamblaje(hoy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * HIDRATA EL SEMÁFORO AL ABRIR EL MÓDULO.
   *
   * `useCarrerasDiaStore` solo se llenaba desde el evento realtime de la línea
   * 150, así que entrando directo a Tablas (F5, otra pestaña, o cualquier ruta
   * sin realtime porque `tablas_fijas` no está en la publicación) los chips de
   * "Carreras del Día" salían VACÍOS aunque las carreras existieran. Se hidrata
   * al montar y además desde el registro central, que ya viene de la misma
   * consulta que usan Marcas, Gestión y Dupletas.
   */
  useEffect(() => {
    let vivo = true;
    void (async () => {
      await cargarCarrerasDelDia().catch(() => {});
      if (!vivo) return;
      const hoy = fechaPrograma || hoyLocal();
      for (const c of registroCentral.carreras) {
        useCarrerasDiaStore.getState().upsert({
          fecha: c.fecha || hoy,
          hipodromo: c.hipodromo,
          carrera: numeroCarrera(c.carrera),
          estado: c.estado === "Liquidada" ? "Liquidada" : c.estado === "Resultados" ? "Resultados" : "Programada",
          ventas: [],
        });
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaPrograma]);

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
    // `ok` puede venir con `error`: la tabla quedó publicada, pero el central no
    // se pudo sincronizar (carrera invisible en Marcas/Gestión/Dupletas). Se
    // propaga para no perder el aviso; antes se descartaba y el operador veía
    // "publicada con éxito".
    return { ok: true, error: r.error };
  };

  /**
   * @param fechaIso Fecha YA validada por `validarFechasDeCarga`. Se pasa
   *   explícitamente y no se vuelve a leer `d.fecha` aquí a propósito: si este
   *   objeto se armara con el texto crudo de la tarjeta, la fecha sin validar
   *   volvería a llegar al INSERT y el servidor la interpretaría como MM-DD
   *   (que es como se partió la jornada del 04-10-2026). Quien llama tiene que
   *   haber pasado la barrera; si no la pasó, no hay fecha válida que pasar.
   */
  const draftATabla = (d: DraftCarrera, fechaIso: string): StoredTablaFija => ({
    id: d.uid,
    hipodromo: d.hipodromo.trim().toUpperCase(),
    hipodromo_id: null,
    carrera: Math.round(parseNum(d.carrera)) || null,
    fecha: fechaIso,
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

    // BARRERA DE FECHA (individual). Misma regla que en el lote: la fecha de la
    // tarjeta tiene que ser inequívoca y de la jornada abierta. El 04-10-2026 se
    // partió justamente por publicar sin esta comprobación.
    const chequeo = validarFechasDeCarga([d], fechaPrograma);
    if (!chequeo.ok) {
      toast(resumenProblemasCarga(chequeo.problemas), "error");
      return;
    }
    // A partir de aquí la fecha es SIEMPRE ISO de la jornada.
    const fechaCarrera = chequeo.fechaIso;

    // Modo Manual sin ejemplares: registra el hipódromo (crea si es nuevo) y
    // la carrera vacía en resultados_carreras, sin publicar una tabla sin datos.
    if ((d.caballos ?? []).length === 0) {
      await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
      const r = await registrarCarreraProgramada({
        fecha: fechaCarrera,
        hipodromo: d.hipodromo.trim(),
        carrera: Math.round(parseNum(d.carrera)) || d.carrera,
      }).catch(() => ({ ok: false as const, error: "sin conexión" }));
      // Se siembra DESPUÉS de la escritura: sembrar antes haría que el refetch
      // (que dispara el bump de versión) volviera a leer la fila antes de que
      // existiera y la borrara de la lista.
      sembrarCarreraCentral(d.hipodromo, d.carrera, fechaCarrera);
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

    const res = await publicar(draftATabla(d, fechaCarrera));
    if (res.ok) {
      await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
      // Solo se siembra en el registro central si el upsert del central funcionó.
      // Sembrar cuando falló mostraría la carrera en Marcas/Gestión hasta el
      // próximo refetch, aunque en la base no exista.
      if (!res.error) sembrarCarreraCentral(d.hipodromo, d.carrera, fechaCarrera);
      toast(
        res.error
          ? `⚠️ Tabla ${d.hipodromo.toUpperCase()} C${d.carrera}: ${res.error}`
          : `✅ Tabla ${d.hipodromo.toUpperCase()} C${d.carrera} publicada con éxito.`,
        res.error ? "warning" : "success"
      );
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

    // BARRERA DE FECHA. Sin esto, una tarjeta con "04-10-2026" se publicaba en
    // crudo y Postgres lo leía como MM-DD: el 04-10-2026 terminó con tres
    // carreras (C10-C12) fechadas 2026-04-10, y no aparecían en Tablas Fijas ni
    // en Gestión de Jugadas. Se valida ANTES de tocar la base, y se reportan
    // TODOS los problemas juntos para no corregirlos de uno en uno.
    const chequeo = validarFechasDeCarga(validas, fechaPrograma);
    if (!chequeo.ok) {
      toast(resumenProblemasCarga(chequeo.problemas), "error");
      for (const p of chequeo.problemas) {
        console.warn(`[carga] ${p.hipodromo} C${p.carrera} (${p.fechaEnPantalla}): ${p.motivo} -> ${p.como}`);
      }
      return;
    }

    if (modoManual) {
      // En modo manual el lote registra TODAS las carreras: vacías → la
      // carrera programada en resultados_carreras; con caballos → tabla fija.
      let okVacios = 0;
      let okTablas = 0;
      const avisos: string[] = [];
      const sinCentralIds = new Set<string | number>();
      const tablasConCaballos = validas.filter((d) => (d.caballos ?? []).length > 0);
      const vacias = validas.filter((d) => (d.caballos ?? []).length === 0);
      for (const d of vacias) {
        await asegurarHipodromo(d.hipodromo.trim()).catch(() => null);
        const r = await registrarCarreraProgramada({
          fecha: chequeo.fechaIso,
          hipodromo: d.hipodromo.trim(),
          carrera: Math.round(parseNum(d.carrera)) || d.carrera,
        }).catch(() => ({ ok: false as const, error: "sin conexión" }));
        // `registrarCarreraProgramada` escribe la matriz directo: si falla, NO
        // se siembra (mostraría una carrera que en la base no existe).
        if (r?.ok) {
          sembrarCarreraCentral(d.hipodromo, d.carrera, chequeo.fechaIso);
          okVacios++;
        }
      }
      if (tablasConCaballos.length) {
        const lote = tablasConCaballos.map((d) => draftATabla(d, chequeo.fechaIso));
        if (persistirLote) {
          const r = await persistirLote(lote);
          okTablas = r.okCount;
          for (const e of r.errores ?? []) {
            if (!e.publicada) continue;
            avisos.push(`${e.hipodromo} C${e.carrera}: ${e.error}`);
            for (const t of lote) {
              if (
                String(t.hipodromo ?? "").toUpperCase() === String(e.hipodromo ?? "").toUpperCase() &&
                String(t.carrera) === String(e.carrera)
              ) {
                sinCentralIds.add(t.id);
              }
            }
          }
        } else {
          for (const t of lote) {
            const r = await publicar(t);
            if (r.ok) {
              okTablas++;
              if (r.error) {
                avisos.push(`${t.hipodromo} C${t.carrera}: ${r.error}`);
                sinCentralIds.add(t.id);
              }
            }
          }
        }
        for (const d of tablasConCaballos) {
          if (sinCentralIds.has(d.uid)) continue;
          sembrarCarreraCentral(d.hipodromo, d.carrera, chequeo.fechaIso);
        }
      }
      validas.forEach((d) => eliminarDelRegistroGaceta(d.hipodromo.toUpperCase(), d.carrera));
      setDrafts((ds) => ds.filter((d) => !validas.some((v) => v.uid === d.uid)));
      const base = `Modo Manual: ${okVacios} carrera(s) vacía(s) registrada(s) · ${okTablas} tabla(s) publicada(s).`;
      return toast(
        avisos.length ? `⚠️ ${base} Sin central (no se verán en Marcas/Gestión): ${avisos.join("; ")}.` : `✅ ${base}`,
        avisos.length ? "warning" : "success"
      );
    }

    const lote = validas.map((d) => draftATabla(d, chequeo.fechaIso));
    const claveDeDraft = (d: DraftCarrera) =>
      `${d.hipodromo.trim().toUpperCase()}|${Math.round(parseNum(d.carrera)) || d.carrera}`;
    const draftPorClave = new Map(validas.map((d) => [claveDeDraft(d), d]));

    let okCount = 0;
    // `errores`: la tabla NO se publicó -> la tarjeta vuelve al Ensamblaje.
    // `avisos`: la tabla SÍ se publicó, pero el central no se sincronizó; queda
    // vendiéndose pero invisible en Marcas/Gestión/Dupletas. NO vuelve al
    // Ensamblaje (ya está en la base): solo se avisa. Confundir ambos es lo que
    // dejaba 13 tablas publicadas con 1 sola carrera en el central.
    let errores: ErrorPublicacion[] = [];
    const avisos: ErrorPublicacion[] = [];
    if (persistirLote) {
      const r = await persistirLote(lote);
      okCount = r.okCount;
      for (const e of r.errores ?? []) (e.publicada ? avisos : errores).push(e);
    } else {
      for (const t of lote) {
        const r = await publicar(t);
        const fila: ErrorPublicacion = { hipodromo: t.hipodromo ?? "", carrera: t.carrera ?? null, error: r.error || "desconocido" };
        if (!r.ok) {
          errores.push(fila);
        } else {
          okCount++;
          if (r.error) avisos.push({ ...fila, publicada: true });
        }
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
    // Solo entran al registro central las que se publicaron Y sincronizaron. Si
    // el central falló, sembrarla mostraría una carrera que en la base no está.
    const noSembrar = new Set(
      [...errores, ...avisos].map((e) => `${String(e.hipodromo).toUpperCase()}|${e.carrera}`)
    );
    for (const t of lote) {
      if (noSembrar.has(`${String(t.hipodromo ?? "").toUpperCase()}|${t.carrera}`)) continue;
      sembrarCarreraCentral(t.hipodromo ?? "", t.carrera ?? 0, t.fecha || fechaPrograma);
    }

    if (okCount === lote.length && avisos.length === 0) {
      toast(`✅ ${okCount} tabla(s) publicada(s) con éxito.`, "success");
    } else if (okCount > 0 && errores.length === 0) {
      toast(
        `⚠️ ${okCount} tabla(s) publicada(s); ${avisos.length} sin central (no se verán en Marcas/Gestión): ${avisos.map((e) => e.error).join("; ")}.`,
        "warning"
      );
    } else if (okCount > 0) {
      const extra = avisos.length ? ` · ${avisos.length} publicada(s) sin central` : "";
      toast(`⚠️ ${okCount} tabla(s) publicada(s), ${errores.length} con error: ${errores.map((e) => e.error).join("; ")}${extra}.`, "warning");
    } else {
      toast(`Error al publicar: ${errores.map((e) => e.error).join("; ") || "desconocido"}`, "error");
    }
  };

  const pegarDesdeGaceta = () => {
    router.push("/ejemplares?tab=gaceta");
  };

  const venderDirecto = async (v: VentaTablaItem): Promise<{ ok: boolean; error?: string }> => {
    const tabla = tablas.find((t) => String(t.id) === String(v.tablaId));
    if (!tabla) return { ok: false, error: "No se encontro la tabla en el monitor." };
    if (persistirVenta) {
      const r = await persistirVenta(tabla, v);
      if (!r.ok) return { ok: false, error: r.error ?? "No se pudo registrar la venta." };
    }
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
      cantidad: v.cantidad ?? 1,
      grupo: v.grupo,
      jugador: v.jugador,
    };
    const base = (tabla.premio_recalculado ?? 0) * item.monto;
    agregarTicket({
      comando:
        item.nombre === "TABLA COMPLETA"
          ? `TABLA ${item.hipodromo} C${item.carrera} TABLA COMPLETA`
          : `TABLA ${item.hipodromo} C${item.carrera} N${item.numero} ${item.nombre}`,
      monto: item.monto,
      gananciaProyectada: base,
      // La tabla fija NO cobra comision al jugador: lo que juega es lo que se
      // le descuenta. La comision es del grupo y se calcula sobre el monto
      // decidido, al liquidar. Antes aqui se ponia 5% fijo, que cobraba de
      // mas al jugador y no coincidia con ningun convenio.
      comision: 0,
    });
    // Centralización: registra la venta en el ledger "Carreras del Día".
    useCarrerasDiaStore.getState().agregarVenta(item.hipodromo, item.carrera ?? 0, {
      numero: item.numero,
      nombre: item.nombre,
      cantidad: item.cantidad ?? 1,
      grupo: item.grupo?.nombre ?? null,
      jugador: item.jugador?.nombre ?? null,
      tablaId: item.tablaId,
    });
    setTablas(
      tablas.map((t) =>
        String(t.id) === String(item.tablaId)
          ? { ...t, cantidad_vendida: (t.cantidad_vendida ?? 0) + (item.cantidad ?? 1) }
          : t
      )
    );
    toast(
      `🛒 Venta enviada a la taquilla: ${item.hipodromo} C${item.carrera}${
        item.nombre === "TABLA COMPLETA" ? " · Tabla completa" : ` N${item.numero} ${item.nombre}`
      } por ${fmtMoney(item.monto, item.moneda)}.`,
      "success"
    );
    return { ok: true };
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
      >
        <div className="p-4">
          <div className="mb-3 no-print">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                🗂️ Carreras en espera de publicación
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">
                  {drafts.length}
                </span>
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuEnsamblaje((m) => !m)}
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-slate-700"
                  title="Acciones del ensamblaje: Modo Manual, Pegar desde Gaceta, Publicar todas y Exportar a Excel"
                >
                  ⚙️ Acciones Carreras <span className="text-[9px] opacity-70">▾</span>
                </button>
                {menuEnsamblaje && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuEnsamblaje(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-white shadow-2xl">
                      <button
                        type="button"
                        onClick={() => setModoManual((m) => !m)}
                        className={`flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wide transition-colors ${
                          modoManual ? "bg-emerald-50 text-emerald-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                        title="Permite registrar carreras vacías escritas a mano sin depender de la Gaceta IA."
                      >
                        {modoManual ? "✅ Modo Manual ON" : "✍️ Modo Manual"}
                        <span className="ml-auto text-[9px] font-bold text-slate-400">{modoManual ? "activado" : "desactivado"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          pegarDesdeGaceta();
                          setMenuEnsamblaje(false);
                        }}
                        className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:bg-slate-50"
                        title="Ir al módulo de Gacetas IA (las carreras se extraen desde la IA)"
                      >
                        📋 Pegar desde Gaceta
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void publicarTodas();
                          setMenuEnsamblaje(false);
                        }}
                        disabled={drafts.length === 0}
                        className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wide text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Publicar en lote todas las carreras del ensamblaje"
                      >
                        🚀 Publicar todas
                      </button>
                      <Guard permiso="tablas:btn_imprimir">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuEnsamblaje(false);
                            void exportarExcel();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] font-black uppercase tracking-wide text-emerald-700 transition-colors hover:bg-emerald-50"
                          title="Descarga la vista de impresión de las Tablas Fijas como archivo Excel (.xls), con la misma estructura, colores y tamaño"
                        >
                          📊 Exportar a Excel
                          <span className="ml-auto text-[9px] font-bold text-slate-400">.xls</span>
                        </button>
                      </Guard>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            <MonitorHipodromos
              grupos={hipodromosDia}
              filtro={filtroHipodromo}
              onFiltro={setFiltroHipodromo}
              fecha={fechaPrograma}
              onFecha={setFechaPrograma}
              vacio={`Sin hipódromos publicados para la fecha ${fechaPrograma}.`}
              className="mb-3"
              acciones={
                <Guard permiso="tablas:btn_imprimir">
                  <button
                    type="button"
                    onClick={() => setImpresion(true)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-[11px] font-black uppercase tracking-wide text-white shadow-md transition-colors hover:bg-emerald-700"
                    title="Imprimir / exportar tablas publicadas (matriz 15 por hoja o reporte por jugador)"
                  >
                    🖨️ Imprimir Tablas
                  </button>
                </Guard>
              }
            />
          <MonitorTablas
            tablas={tablas}
            onVender={venderDirecto}
            onLiquidar={liquidar}
            onEditar={editar}
            onRetirar={retirar}
            onEliminar={eliminar}
            hipodromoFiltro={filtroHipodromo}
            onHipodromoFiltro={setFiltroHipodromo}
            fechaDia={fechaPrograma}
            onFechaDia={setFechaPrograma}
          />
        </div>
      </SeccionPliegue>

      <ConfigImpresionModal abierto={impresion} onCerrar={() => setImpresion(false)} tablasRespaldo={tablas} />

      <ToastHost />
    </div>
  );
}

export default TablasModule;