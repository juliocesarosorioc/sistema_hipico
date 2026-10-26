"use client";

/**
 * SECCIÓN DE JUGADAS — PORTAL DEL CLIENTE
 * =======================================
 * Permite a los jugadores desde el Portal de Clientes visualizar y comprar:
 *   1. ⚔️ Marcas        → siempre en proporción múltiplo de 6 (ajusta automáticamente y avisa al jugador).
 *   2. 🏁 Tablas Fijas  → compra de tablas POR CABALLO (cantidad independiente en cada ejemplar).
 *   3. 🥇 Puestos       → jugadas de puestos (1P, 2P, 3P, 10/8, 10/9, NINI, etc.).
 *   4. 🔨 Remates       → cuadros de remate publicados y registro de pujas/compra.
 *   5. 🔀 Dupletas      → combinaciones de 1ª y 2ª pata.
 *   6. 🎯 Pollas        → selección de ejemplares de 1ª a 6ª válida.
 *
 * El diseño de cada sección replica la vista operativa del Administrador (en modo
 * solo lectura de configuración de la casa). Si una modalidad está desbloqueada
 * por el Administrador, el botón de comprar está habilitado y se le cobra al
 * grupo del jugador. Si está bloqueada, el jugador puede solicitar el desbloqueo
 * con un clic, enviando un mensaje al panel del Administrador.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/core/supabase";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { formatoMoneda } from "@/shared/lib/vzla";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { listarTablasPublicadas } from "@/features/tablas/lib/rpc";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { listarPollas, type Polla } from "@/features/pollas/lib/pollas";
import {
  claveDeDupleta,
  listarDupletasGuardadas,
  type DupletaEstado,
} from "@/features/dupletas/lib/dupletas";
import { listarConfigMarcas, type ConfigMarcas } from "@/features/marcas/lib/marcas";
import { calcularRivales, separarNumeros } from "@/features/marcas/lib/jerarquia";
import {
  realizarJugada,
  solicitarCompraTabla,
  type SesionPortal,
} from "@/features/portal/lib/portal";
import {
  ajustarMontoMultiploDe6,
  BLOQUEO_POR_DEFECTO,
  leerBloqueosJugadas,
  MODALIDADES_PORTAL_META,
  solicitarDesbloqueoJugada,
  type EstadoBloqueoJugadas,
  type ModalidadPortalJugada,
} from "@/features/portal/lib/bloqueo-jugadas";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const hoyIso = (): string => {
  const d = new Date();
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type RematePortalRow = {
  id: string;
  hipodromo: string;
  carrera: number;
  fecha: string;
  estado?: string | null;
  porcentaje_casa?: number | null;
  caballos: Array<{
    numero: string | number;
    nombre: string;
    monto: number;
    comprador?: string | null;
    retirado?: boolean;
  }>;
};

type Props = {
  sesion: SesionPortal;
  onJugadaRealizada: () => Promise<void> | void;
  modalidadInicial?: ModalidadPortalJugada;
};

export function SeccionJugadasPortal({
  sesion,
  onJugadaRealizada,
  modalidadInicial = "tablas_fijas",
}: Props) {
  const [modalidad, setModalidad] = useState<ModalidadPortalJugada>(modalidadInicial);
  const [bloqueos, setBloqueos] = useState<EstadoBloqueoJugadas>({ ...BLOQUEO_POR_DEFECTO });
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [solicitandoDesbloqueo, setSolicitandoDesbloqueo] = useState(false);

  // Catálogos de ofertas de la casa (solo lectura para el jugador)
  const [tablas, setTablas] = useState<TablaFijaRow[]>([]);
  const [marcas, setMarcas] = useState<ConfigMarcas[]>([]);
  const [dupletas, setDupletas] = useState<DupletaEstado[]>([]);
  const [pollas, setPollas] = useState<Polla[]>([]);
  const [remates, setRemates] = useState<RematePortalRow[]>([]);

  const recargarBloqueos = useCallback(async () => {
    const b = await leerBloqueosJugadas();
    setBloqueos(b);
  }, []);

  useEffect(() => {
    void recargarBloqueos();
    const onUpdate = (e: Event) => {
      const ev = e as CustomEvent<EstadoBloqueoJugadas>;
      if (ev.detail) setBloqueos(ev.detail);
    };
    window.addEventListener("bloqueos-jugadas-actualizados", onUpdate);
    return () => window.removeEventListener("bloqueos-jugadas-actualizados", onUpdate);
  }, [recargarBloqueos]);

  useEffect(() => {
    let vivo = true;
    setCargandoCatalogos(true);
    const cargarRemates = async (): Promise<RematePortalRow[]> => {
      if (!supabase) return [];
      try {
        const { data: rems } = await supabase
          .from("remates")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(30);
        if (!rems?.length) return [];
        const ids = rems.map((r: { id: string }) => r.id);
        const { data: cabs } = await supabase
          .from("remate_caballos")
          .select("*")
          .in("remate_id", ids);
        return rems.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          hipodromo: String(r.hipodromo ?? "HIPÓDROMO"),
          carrera: Number(r.carrera) || 1,
          fecha: String(r.fecha ?? hoyIso()).slice(0, 10),
          estado: String(r.estado ?? "abierto"),
          porcentaje_casa: Number(r.porcentaje_casa ?? 25),
          caballos: ((cabs ?? []) as Array<Record<string, unknown>>)
            .filter((c) => String(c.remate_id) === String(r.id))
            .map((c) => ({
              numero: String(c.numero ?? c.caballo_numero ?? ""),
              nombre: String(c.nombre ?? c.caballo_nombre ?? `Ejemplar #${c.numero ?? ""}`),
              monto: Number(c.monto ?? c.puja ?? 0),
              comprador: c.cliente_nombre ? String(c.cliente_nombre) : null,
              retirado: Boolean(c.retirado),
            })),
        }));
      } catch {
        return [];
      }
    };

    Promise.all([
      listarTablasPublicadas().catch(() => [] as TablaFijaRow[]),
      listarConfigMarcas({ dia: hoyIso() }).catch(() => [] as ConfigMarcas[]),
      listarDupletasGuardadas().catch(() => [] as DupletaEstado[]),
      listarPollas().catch(() => ({ ok: false as const, datos: [] as Polla[] })),
      cargarRemates(),
    ]).then(([tb, mc, dp, pl, rm]) => {
      if (!vivo) return;
      setTablas(tb);
      setMarcas(mc);
      setDupletas(dp);
      setPollas((pl.datos ?? []).filter((p) => p.estado === "Abierta"));
      setRemates(rm);
      setCargandoCatalogos(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const metaActual = MODALIDADES_PORTAL_META.find((m) => m.id === modalidad)!;
  const estaBloqueada = Boolean(bloqueos[modalidad]);
  const disponible = sesion.resumen.disponible;
  const esLibre = String(sesion.cliente.modo_juego ?? "").toLowerCase().trim() === "libre";

  const pedirDesbloqueo = async (hipodromo?: string, carrera?: number | string) => {
    setSolicitandoDesbloqueo(true);
    const r = await solicitarDesbloqueoJugada({
      cliente: sesion.cliente,
      modalidad,
      hipodromo,
      carrera,
    });
    setSolicitandoDesbloqueo(false);
    if (!r.ok) {
      toast(r.error ?? "No se pudo enviar la solicitud de desbloqueo.", "error");
      return;
    }
    toast(
      `🔓 Solicitud enviada al Administrador para desbloquear ${metaActual.etiqueta}.`,
      "success"
    );
  };

  return (
    <div className="space-y-4">
      {/* Encabezado de la Sección de Jugadas */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-950 via-indigo-900 to-slate-900 p-4 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
              🏇 Centro de Jugadas en Línea · Cobro vinculado a tu grupo
            </div>
            <h2 className="text-lg font-black">
              Comprar Marcas, Tablas Fijas, Puestos, Remates, Dupletas y Pollas
            </h2>
            <p className="text-xs text-indigo-200/80">
              Seleccioná la modalidad para ver el cuadro oficial de la casa (solo lectura) y registrar tus jugadas.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white/10 px-3.5 py-2 border border-white/15">
            <div>
              <div className="text-[9px] font-black uppercase tracking-wider text-indigo-200">
                Grupo de Cobro
              </div>
              <div className="text-xs font-black text-white">
                {sesion.grupo?.nombre || "GRUPO OFICIAL"}
              </div>
            </div>
            <div className="h-7 w-px bg-white/20" />
            <div>
              <div className="text-[9px] font-black uppercase tracking-wider text-emerald-200">
                Disponible para jugar
              </div>
              <div className="text-sm font-black font-mono text-emerald-300">
                {esLibre ? "LIBRE" : formatoMoneda("USD", disponible)}
              </div>
            </div>
          </div>
        </div>

        {/* Selector de las 6 Modalidades */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {MODALIDADES_PORTAL_META.map((m) => {
            const activa = modalidad === m.id;
            const bloq = Boolean(bloqueos[m.id]);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setModalidad(m.id)}
                className={`flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                  activa
                    ? "border-amber-400 bg-white text-slate-900 shadow-lg ring-2 ring-amber-400/50"
                    : "border-white/15 bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base">{m.icono}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[8.5px] font-black uppercase ${
                      bloq
                        ? "bg-rose-500 text-white"
                        : activa
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-500/30 text-emerald-200"
                    }`}
                  >
                    {bloq ? "🔒 Bloqueada" : "🔓 Abierta"}
                  </span>
                </div>
                <div className="mt-1.5">
                  <div className="text-xs font-black">{m.etiqueta}</div>
                  <div
                    className={`text-[9.5px] line-clamp-1 ${
                      activa ? "text-slate-500" : "text-indigo-200/80"
                    }`}
                  >
                    {m.descripcion}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Banner si la modalidad está bloqueada por el Administrador */}
      {estaBloqueada && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none">🔒</span>
            <div>
              <h3 className="text-sm font-black text-amber-950 uppercase">
                Venta de {metaActual.etiqueta} bloqueada temporalmente por el Administrador
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Podés visualizar toda la programación y configuración de {metaActual.etiqueta}, y solicitar al Administrador que habilite la compra.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            disabled={solicitandoDesbloqueo}
            onClick={() => void pedirDesbloqueo()}
            className="bg-amber-600 hover:bg-amber-500 text-white font-black"
          >
            {solicitandoDesbloqueo ? "Enviando solicitud…" : "🔓 Solicitar Desbloqueo al Administrador"}
          </Button>
        </div>
      )}

      {cargandoCatalogos ? (
        <Card className="p-8 text-center text-sm text-slate-400">
          ⏳ Cargando programación oficial de jugadas…
        </Card>
      ) : (
        <>
          {modalidad === "tablas_fijas" && (
            <ModalidadTablasFijasPorCaballo
              sesion={sesion}
              tablas={tablas}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}

          {modalidad === "marcas" && (
            <ModalidadMarcasMultiplo6
              sesion={sesion}
              marcas={marcas}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}

          {modalidad === "puestos" && (
            <ModalidadPuestosPortal
              sesion={sesion}
              tablas={tablas}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}

          {modalidad === "remates" && (
            <ModalidadRematesPortal
              sesion={sesion}
              remates={remates}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}

          {modalidad === "dupletas" && (
            <ModalidadDupletasPortal
              sesion={sesion}
              dupletas={dupletas}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}

          {modalidad === "pollas" && (
            <ModalidadPollasPortal
              sesion={sesion}
              pollas={pollas}
              bloqueada={estaBloqueada}
              enviando={enviando}
              setEnviando={setEnviando}
              onPedirDesbloqueo={pedirDesbloqueo}
              onRealizada={onJugadaRealizada}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// 1. 🏁 TABLAS FIJAS — COMPRA DE TABLAS POR CABALLO (NO DE MANERA GENERAL)
// ============================================================================

function ModalidadTablasFijasPorCaballo({
  sesion,
  tablas,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  tablas: TablaFijaRow[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const hipodromos = useMemo(
    () => [...new Set(tablas.map((t) => String(t.hipodromo ?? "")).filter(Boolean))],
    [tablas]
  );
  const [hipo, setHipo] = useState("");
  const [carrera, setCarrera] = useState<number>(0);
  // Mapa ejemplarNumero -> cantidad de tablas que el jugador compra para ese caballo
  const [cantidadesPorCaballo, setCantidadesPorCaballo] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!hipo && hipodromos.length > 0) setHipo(hipodromos[0]);
  }, [hipo, hipodromos]);

  const carrerasHipo = useMemo(
    () =>
      tablas
        .filter((t) => String(t.hipodromo ?? "") === hipo)
        .sort((a, b) => Number(a.carrera ?? 0) - Number(b.carrera ?? 0)),
    [tablas, hipo]
  );

  useEffect(() => {
    if (carrerasHipo.length > 0 && !carrerasHipo.some((c) => Number(c.carrera ?? 0) === carrera)) {
      setCarrera(Number(carrerasHipo[0].carrera ?? 1));
      setCantidadesPorCaballo({});
    }
  }, [carrerasHipo, carrera]);

  const tablaActual = useMemo(
    () => carrerasHipo.find((t) => Number(t.carrera ?? 0) === carrera) ?? null,
    [carrerasHipo, carrera]
  );

  const premioPorTablaActual = useMemo(
    () => Number(tablaActual?.premio_recalculado ?? tablaActual?.premio_original ?? 0),
    [tablaActual]
  );

  const fijarCantidadCaballo = (numeroCaballo: string, cant: number) => {
    const limpia = Math.max(0, Math.min(999, Math.floor(Number(cant) || 0)));
    setCantidadesPorCaballo((prev) => {
      const next = { ...prev };
      if (limpia <= 0) delete next[numeroCaballo];
      else next[numeroCaballo] = limpia;
      return next;
    });
  };

  const seleccionCaballos = useMemo(() => {
    if (!tablaActual) return [];
    const filas = tablaActual.caballos ?? [];
    const premioBase = premioPorTablaActual;
    return filas
      .filter((f) => !f.retirado && !f.invalidado && (cantidadesPorCaballo[String(f.numero)] ?? 0) > 0)
      .map((f) => {
        const cant = cantidadesPorCaballo[String(f.numero)] ?? 0;
        const costoUnit = Number(f.valor_ejemplar) || 0;
        const subtotalCosto = Math.round(costoUnit * cant * 100) / 100;
        const subtotalPremio = Math.round(premioBase * cant * 100) / 100;
        return {
          numero: String(f.numero),
          nombre: f.nombre || `Ejemplar #${f.numero}`,
          cantidad: cant,
          costoUnit,
          subtotalCosto,
          subtotalPremio,
        };
      });
  }, [tablaActual, cantidadesPorCaballo, premioPorTablaActual]);

  const totalTablas = seleccionCaballos.reduce((a, x) => a + x.cantidad, 0);
  const totalCosto = seleccionCaballos.reduce((a, x) => a + x.subtotalCosto, 0);

  const comprarTablasPorCaballo = async () => {
    if (!tablaActual || seleccionCaballos.length === 0) {
      return toast("Indicá la cantidad de tablas en al menos un caballo.", "warning");
    }
    if (bloqueada) {
      return toast("La venta de Tablas Fijas está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    setEnviando(true);
    let exitos = 0;
    let ultimoError = "";
    const hipoTabla = String(tablaActual.hipodromo ?? hipo);
    const carrTabla = Number(tablaActual.carrera ?? carrera);
    const monedaTabla = String(tablaActual.moneda ?? "USD");
    for (const item of seleccionCaballos) {
      const r = await realizarJugada({
        tipo: "TABLA_FIJA",
        tabla_id: String(tablaActual.id),
        hipodromo: hipoTabla,
        carrera: carrTabla,
        ejemplar: item.numero,
        ejemplar_nombre: item.nombre,
        cantidad: item.cantidad,
        monto: item.subtotalCosto > 0 ? item.subtotalCosto : item.cantidad,
        premio_por_tabla: premioPorTablaActual,
        moneda: monedaTabla,
      });
      await solicitarCompraTabla({
        cliente: sesion.cliente,
        tablaId: tablaActual.id,
        hipodromo: hipoTabla,
        carrera: carrTabla,
        ejemplarNumero: item.numero,
        ejemplarNombre: item.nombre,
        cantidad: item.cantidad,
        premioPorTabla: premioPorTablaActual,
        ptsEjemplar: item.costoUnit,
        moneda: monedaTabla,
        costoUsd: item.costoUnit,
      }).catch(() => undefined);

      if (r.ok) exitos += 1;
      else ultimoError = r.error ?? "No se pudo registrar.";
    }
    setEnviando(false);
    if (exitos === 0) {
      return toast(ultimoError || "No se pudieron registrar las tablas.", "error");
    }
    setCantidadesPorCaballo({});
    toast(
      `✅ Compra registrada por caballo (${totalTablas} tabla(s) en ${exitos} ejemplar(es)) y cargada a tu grupo.`,
      "success"
    );
    await onRealizada();
  };

  if (!tablas.length) {
    return (
      <Card>
        <EmptyState
          icono="🏁"
          titulo="No hay Tablas Fijas publicadas en este momento"
          descripcion="Cuando el Administrador publique las tablas de la jornada aparecerán acá para comprar por caballo."
        />
      </Card>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Cabecera estilo modal Administrador (solo lectura de parámetros) */}
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
            🏁 Cuadro Oficial de Tablas Fijas (Vista Jugador · Solo Lectura de Configuración)
          </div>
          <div className="text-sm font-black">
            Compra de Tablas por Caballo — Indicá cuántas tablas deseás en cada ejemplar
          </div>
        </div>
        {tablaActual && (
          <div className="flex items-center gap-2 text-xs font-bold bg-white/10 px-3 py-1.5 rounded-xl">
            <span>Premio por tabla:</span>
            <span className="font-mono font-black text-emerald-300">
              {formatoMoneda(tablaActual.moneda || "USD", premioPorTablaActual)}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Selectores de Hipódromo y Carrera */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {hipodromos.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setHipo(h);
                  setCantidadesPorCaballo({});
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase transition ${
                  hipo === h
                    ? "bg-indigo-600 text-white shadow"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                🏇 {nombreHipodromoParaMostrar(h)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {carrerasHipo.map((c) => {
              const numCarr = Number(c.carrera ?? 1);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCarrera(numCarr);
                    setCantidadesPorCaballo({});
                  }}
                  className={`h-8 px-3 rounded-lg text-xs font-black transition ${
                    carrera === numCarr
                      ? "bg-amber-500 text-slate-950 shadow"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  C{numCarr}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabla de Ejemplares con input de cantidad de tablas POR CABALLO */}
        {tablaActual && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-left text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-200">
                  <th className="py-2.5 px-3 w-14">#</th>
                  <th className="py-2.5 px-3">Ejemplar</th>
                  <th className="py-2.5 px-3 text-right">Valor / Costo por Tabla</th>
                  <th className="py-2.5 px-3 text-right">Premio por Tabla</th>
                  <th className="py-2.5 px-3 text-center">Cantidad de Tablas a Comprar</th>
                  <th className="py-2.5 px-3 text-right">Subtotal Caballo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(tablaActual.caballos ?? []).map((f) => {
                  const retirado = Boolean(f.retirado || f.invalidado);
                  const numStr = String(f.numero);
                  const cant = cantidadesPorCaballo[numStr] ?? 0;
                  const costoUnit = Number(f.valor_ejemplar) || 0;
                  const subtotal = Math.round(costoUnit * cant * 100) / 100;
                  return (
                    <tr
                      key={numStr}
                      className={
                        retirado
                          ? "bg-rose-50/50 text-slate-400 line-through"
                          : cant > 0
                            ? "bg-indigo-50/70 font-semibold"
                            : "hover:bg-slate-50"
                      }
                    >
                      <td className="py-2 px-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 text-white font-mono text-xs font-black">
                          {f.numero}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-800">
                        {f.nombre || `Ejemplar #${f.numero}`}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-700">
                        {retirado ? "RETIRADO" : formatoMoneda(tablaActual.moneda || "USD", costoUnit)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-700 font-bold">
                        {retirado
                          ? "—"
                          : formatoMoneda(tablaActual.moneda || "USD", premioPorTablaActual)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {retirado ? (
                          <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">
                            RETIRADO
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => fijarCantidadCaballo(numStr, cant - 1)}
                              className="h-7 w-7 rounded-lg border border-slate-300 bg-white font-black text-slate-700 hover:bg-slate-100"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={999}
                              value={cant || ""}
                              placeholder="0"
                              onChange={(e) => fijarCantidadCaballo(numStr, parseInt(e.target.value, 10) || 0)}
                              className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-mono text-xs font-black outline-none focus:border-indigo-500"
                            />
                            <button
                              type="button"
                              onClick={() => fijarCantidadCaballo(numStr, cant + 1)}
                              className="h-7 w-7 rounded-lg border border-indigo-300 bg-indigo-50 font-black text-indigo-700 hover:bg-indigo-100"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-black text-indigo-900">
                        {cant > 0 ? (
                          <span>
                            {cant} tabla(s) · {formatoMoneda(tablaActual.moneda || "USD", subtotal)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Resumen de compra por caballo y botón de acción */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-black text-indigo-950">
              {seleccionCaballos.length > 0
                ? `Seleccionaste ${totalTablas} tabla(s) en ${seleccionCaballos.length} caballo(s) · Total a cobrar a tu grupo: ${formatoMoneda(tablaActual?.moneda || "USD", totalCosto)}`
                : "Ingresá la cantidad de tablas en cada caballo que desees comprar."}
            </div>
            {seleccionCaballos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {seleccionCaballos.map((item) => (
                  <span
                    key={item.numero}
                    className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-bold text-indigo-900 border border-indigo-200 shadow-sm"
                  >
                    #{item.numero} {item.nombre}: {item.cantidad} tabla(s) ({formatoMoneda("USD", item.subtotalCosto)})
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {bloqueada ? (
              <Button
                size="sm"
                onClick={() =>
                  void onPedirDesbloqueo(
                    String(tablaActual?.hipodromo ?? hipo),
                    Number(tablaActual?.carrera ?? carrera)
                  )
                }
                className="bg-amber-600 hover:bg-amber-500 text-white font-black"
              >
                🔓 Solicitar Desbloqueo
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={enviando || seleccionCaballos.length === 0}
                onClick={() => void comprarTablasPorCaballo()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
              >
                {enviando
                  ? "Registrando compra…"
                  : `🛒 Comprar Tablas por Caballo (${totalTablas})`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 2. ⚔️ MARCAS — SIEMPRE EN PROPORCIÓN MÚLTIPLO DE 6
// ============================================================================

function ModalidadMarcasMultiplo6({
  sesion,
  marcas,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  marcas: ConfigMarcas[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const hipos = useMemo(() => [...new Set(marcas.map((m) => m.hipodromo))], [marcas]);
  const [hipo, setHipo] = useState("");
  const [carrera, setCarrera] = useState<number>(1);
  const [caballo, setCaballo] = useState("");
  const [rival, setRival] = useState("");
  const [montoInput, setMontoInput] = useState("12");

  useEffect(() => {
    if (!hipo && hipos.length > 0) setHipo(hipos[0]);
  }, [hipo, hipos]);

  const carrerasHipo = useMemo(
    () => marcas.filter((m) => m.hipodromo === hipo).sort((a, b) => a.carrera - b.carrera),
    [marcas, hipo]
  );

  useEffect(() => {
    if (carrerasHipo.length > 0 && !carrerasHipo.some((c) => c.carrera === carrera)) {
      setCarrera(carrerasHipo[0].carrera);
      setCaballo("");
      setRival("");
    }
  }, [carrerasHipo, carrera]);

  const configActual = useMemo(
    () => carrerasHipo.find((c) => c.carrera === carrera) ?? null,
    [carrerasHipo, carrera]
  );

  const listaMarcasActual = useMemo(
    () => (configActual ? separarNumeros(configActual.marcas) : []),
    [configActual]
  );
  const listaNvActual = useMemo(
    () => (configActual ? separarNumeros(configActual.nv) : []),
    [configActual]
  );
  const listaDebutantesActual = useMemo(
    () => (configActual ? separarNumeros(configActual.debutantes) : []),
    [configActual]
  );

  const candidatosCaballo = useMemo(() => {
    if (!configActual) return [] as string[];
    const todos = [...listaMarcasActual, ...listaNvActual, ...listaDebutantesActual];
    return [...new Set(todos)];
  }, [configActual, listaMarcasActual, listaNvActual, listaDebutantesActual]);

  const rivalesValidos = useMemo(() => {
    if (!configActual || !caballo) return [] as string[];
    const analisis = calcularRivales(
      caballo,
      configActual.marcas,
      configActual.nv,
      configActual.debutantes,
      configActual.debutantes_valen,
      rival || ""
    );
    return analisis.candidatos;
  }, [configActual, caballo, rival]);

  // Cálculo automático a múltiplo de 6
  const calculoMultiplo6 = useMemo(() => ajustarMontoMultiploDe6(montoInput), [montoInput]);

  const registrarMarca = async () => {
    if (bloqueada) {
      return toast("La venta de Marcas está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    const hipoFinal = hipo || "LA RINCONADA";
    if (!caballo || !rival) {
      return toast("Seleccioná tu ejemplar y el ejemplar rival.", "warning");
    }
    const { ajustado } = calculoMultiplo6;
    setMontoInput(String(ajustado));
    setEnviando(true);
    const r = await realizarJugada({
      tipo: "MARCA",
      hipodromo: hipoFinal,
      fecha: hoyIso(),
      carrera,
      caballo,
      rival,
      monto: ajustado,
    });
    setEnviando(false);
    if (!r.ok) {
      return toast(r.error ?? "No se pudo registrar la marca.", "error");
    }
    toast(
      `✅ Tu jugada de Marca (#${caballo} vs #${rival}) es registrada por $${ajustado} (múltiplo de 6) y cobrada a tu grupo.`,
      "success"
    );
    void sesion;
    await onRealizada();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            ⚔️ Cuadro Oficial de Marcas (Vista Jugador · Proporción Múltiplo de 6)
          </div>
          <div className="text-sm font-black">
            Registro de Marcas por Jerarquía (5/6 · NV · Debutantes)
          </div>
        </div>
        <span className="rounded-lg bg-amber-400/20 border border-amber-300/40 px-2.5 py-1 text-[11px] font-black text-amber-200">
          Regla Oficial: Jugadas siempre en múltiplo de 6 (6, 12, 18, 24, 30…)
        </span>
      </div>

      <div className="p-4 space-y-4">
        {marcas.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {hipos.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setHipo(h);
                    setCaballo("");
                    setRival("");
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase ${
                    hipo === h ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  🏇 {nombreHipodromoParaMostrar(h)}
                </button>
              ))}
              {carrerasHipo.map((c) => (
                <button
                  key={c.carrera}
                  type="button"
                  onClick={() => {
                    setCarrera(c.carrera);
                    setCaballo("");
                    setRival("");
                  }}
                  className={`h-8 px-3 rounded-lg text-xs font-black ${
                    carrera === c.carrera
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  C{c.carrera}
                </button>
              ))}
            </div>

            {configActual && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                  <div className="text-[10px] font-black uppercase text-indigo-700">
                    🏆 Marcas (Jerarquía 1ª a {listaMarcasActual.length}ª)
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {listaMarcasActual.map((n, idx) => (
                      <span
                        key={`${n}-${idx}`}
                        className="rounded bg-indigo-100 px-2 py-0.5 font-mono font-black text-indigo-900"
                      >
                        {idx + 1}ªM: #{n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                  <div className="text-[10px] font-black uppercase text-slate-600">⚡ No Válidos (NV)</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {listaNvActual.length > 0 ? (
                      listaNvActual.map((n) => (
                        <span key={n} className="rounded bg-slate-200 px-2 py-0.5 font-mono font-bold">
                          #{n}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">Sin NV</span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg bg-white p-2.5 border border-slate-200">
                  <div className="text-[10px] font-black uppercase text-amber-700">🌟 Debutantes</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {listaDebutantesActual.length > 0 ? (
                      listaDebutantesActual.map((n) => (
                        <span key={n} className="rounded bg-amber-100 px-2 py-0.5 font-mono font-bold text-amber-900">
                          #{n}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">Sin debutantes</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Hipódromo</span>
              <input
                value={hipo}
                onChange={(e) => setHipo(e.target.value.toUpperCase())}
                placeholder="Ej. LA RINCONADA"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold uppercase"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase text-slate-500">Carrera</span>
              <input
                type="number"
                min={1}
                max={20}
                value={carrera}
                onChange={(e) => setCarrera(parseInt(e.target.value, 10) || 1)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"
              />
            </label>
          </div>
        )}

        {/* Selección de Ejemplar, Rival y Monto en proporción de 6 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Tu Ejemplar (Juega)
            </label>
            {candidatosCaballo.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {candidatosCaballo.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setCaballo(n);
                      setRival("");
                    }}
                    className={`h-9 w-9 rounded-lg font-mono text-xs font-black transition ${
                      caballo === n
                        ? "bg-indigo-600 text-white shadow"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    #{n}
                  </button>
                ))}
              </div>
            ) : (
              <input
                value={caballo}
                onChange={(e) => setCaballo(e.target.value.trim())}
                placeholder="N° de tu caballo (ej. 3)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold"
              />
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Ejemplar Rival (Da)
            </label>
            {candidatosCaballo.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {rivalesValidos.length > 0 ? (
                  rivalesValidos.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRival(n)}
                      className={`h-9 w-9 rounded-lg font-mono text-xs font-black transition ${
                        rival === n
                          ? "bg-amber-500 text-slate-950 shadow"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      #{n}
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-slate-400 italic">
                    {caballo ? "Sin rivales inferiores en jerarquía" : "Elegí primero tu ejemplar"}
                  </span>
                )}
              </div>
            ) : (
              <input
                value={rival}
                onChange={(e) => setRival(e.target.value.trim())}
                placeholder="N° del rival (ej. 6)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold"
              />
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Monto (Se ajusta a múltiplo de 6)
            </label>
            <input
              type="number"
              min={6}
              step={6}
              value={montoInput}
              onChange={(e) => setMontoInput(e.target.value)}
              onBlur={() => setMontoInput(String(calculoMultiplo6.ajustado))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm font-black text-indigo-900"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[6, 12, 18, 24, 30, 60, 120].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMontoInput(String(v))}
                  className={`rounded px-2 py-0.5 text-[10px] font-mono font-bold ${
                    calculoMultiplo6.ajustado === v
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Mensaje de confirmación de múltiplo de 6 */}
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-black">ℹ️ Proporción de 6 en Marcas: </span>
            {calculoMultiplo6.fueAjustado ? (
              <span>
                Ingresaste <b>${calculoMultiplo6.original}</b> →{" "}
                <b className="underline text-indigo-900">
                  tu jugada es registrada por ${calculoMultiplo6.ajustado} (múltiplo de 6)
                </b>
                .
              </span>
            ) : (
              <span>
                Tu jugada será registrada por <b>${calculoMultiplo6.ajustado} (múltiplo de 6)</b>.
              </span>
            )}
          </div>

          {bloqueada ? (
            <Button
              size="sm"
              onClick={() => void onPedirDesbloqueo(hipo, carrera)}
              className="bg-amber-600 hover:bg-amber-500 text-white font-black"
            >
              🔓 Solicitar Desbloqueo
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={enviando || !caballo || !rival}
              onClick={() => void registrarMarca()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
            >
              {enviando
                ? "Registrando…"
                : `⚔️ Registrar Marca por $${calculoMultiplo6.ajustado}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. 🥇 PUESTOS (JUGADAS ENTRE TERCIOS / PUESTOS)
// ============================================================================

function ModalidadPuestosPortal({
  tablas,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  tablas: TablaFijaRow[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const hiposSugeridos = useMemo(
    () => [
      ...new Set(
        ["LA RINCONADA", "VALENCIA", ...tablas.map((t) => String(t.hipodromo ?? ""))].filter(Boolean)
      ),
    ],
    [tablas]
  );
  const [hipo, setHipo] = useState(hiposSugeridos[0] || "LA RINCONADA");
  const [carrera, setCarrera] = useState(1);
  const [modalidadPuesto, setModalidadPuesto] = useState("1P");
  const [caballos, setCaballos] = useState("");
  const [monto, setMonto] = useState("20");

  const MODALIDADES_PUESTO = ["1P", "2P", "3P", "10/8", "10/9", "10/7", "10/6", "NINI", "1Y2N", "2Y3N"];

  const registrarPuesto = async () => {
    if (bloqueada) {
      return toast("La venta de Puestos está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    const m = parseFloat(monto);
    if (!caballos.trim() || !(m > 0)) {
      return toast("Indicá el/los ejemplar(es) y un monto mayor a cero.", "warning");
    }
    setEnviando(true);
    const r = await realizarJugada({
      tipo: "PUESTOS",
      modalidad: modalidadPuesto,
      hipodromo: hipo,
      fecha: hoyIso(),
      carrera,
      caballo: caballos.trim().toUpperCase(),
      monto: m,
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo registrar la jugada.", "error");
    setCaballos("");
    toast(`✅ Jugada ${modalidadPuesto} (#${caballos.trim()}) por $${m} registrada y cargada a tu grupo.`, "success");
    await onRealizada();
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white">
        <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
          🥇 Jugadas de Puestos y Proporciones (Vista Jugador)
        </div>
        <div className="text-sm font-black">
          Registrá jugadas a 1P, 2P, 3P, proporciones (10/8, 10/9) o NINI con cargo a tu grupo
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Hipódromo</label>
            <select
              value={hipo}
              onChange={(e) => setHipo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"
            >
              {hiposSugeridos.map((h) => (
                <option key={h} value={h}>
                  {nombreHipodromoParaMostrar(h)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carrera</label>
            <input
              type="number"
              min={1}
              max={20}
              value={carrera}
              onChange={(e) => setCarrera(parseInt(e.target.value, 10) || 1)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Ejemplar(es) (Ej. 3 o 1,2,3)
            </label>
            <input
              value={caballos}
              onChange={(e) => setCaballos(e.target.value)}
              placeholder="Ej: 4 o 1,2"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-black"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Monto (USD)</label>
            <input
              type="number"
              min={1}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-black"
            />
          </div>
        </div>

        <div>
          <span className="block text-[10px] font-black uppercase text-slate-500 mb-1.5">
            Modalidad de Puesto / Proporción
          </span>
          <div className="flex flex-wrap gap-1.5">
            {MODALIDADES_PUESTO.map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => setModalidadPuesto(mod)}
                className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
                  modalidadPuesto === mod
                    ? "bg-indigo-600 text-white shadow"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {mod}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          {bloqueada ? (
            <Button
              size="sm"
              onClick={() => void onPedirDesbloqueo(hipo, carrera)}
              className="bg-amber-600 hover:bg-amber-500 text-white font-black"
            >
              🔓 Solicitar Desbloqueo
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={enviando || !caballos.trim()}
              onClick={() => void registrarPuesto()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
            >
              {enviando ? "Registrando…" : "🛒 Registrar Jugada de Puesto"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 4. 🔨 REMATES (CUADRO ESTILO ADMIN EN SOLO LECTURA + COMPRA/PUJA)
// ============================================================================

function ModalidadRematesPortal({
  remates,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  remates: RematePortalRow[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const [remateId, setRemateId] = useState(remates[0]?.id ?? "");
  const [montosPuja, setMontosPuja] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!remateId && remates.length > 0) setRemateId(remates[0].id);
  }, [remateId, remates]);

  const actual = useMemo(
    () => remates.find((r) => r.id === remateId) ?? remates[0] ?? null,
    [remates, remateId]
  );

  const comprarCaballoRemate = async (numCab: string, nombreCab: string, montoBase: number) => {
    if (!actual) return;
    if (bloqueada) {
      return toast("La venta de Remates está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    const montoFinal = parseFloat(montosPuja[numCab] ?? "") || Math.max(10, montoBase + 5);
    setEnviando(true);
    const r = await realizarJugada({
      tipo: "REMATE",
      remate_id: actual.id,
      hipodromo: actual.hipodromo,
      fecha: actual.fecha,
      carrera: actual.carrera,
      caballo: numCab,
      ejemplar_nombre: nombreCab,
      monto: montoFinal,
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo registrar la compra en el remate.", "error");
    toast(`✅ Puja/compra registrada en Remate (#${numCab} ${nombreCab} por $${montoFinal}).`, "success");
    await onRealizada();
  };

  if (!actual) {
    return (
      <Card>
        <EmptyState
          icono="🔨"
          titulo="No hay cuadros de Remate abiertos"
          descripcion="Cuando el Administrador abra un remate aparecerá aquí con todos sus ejemplares."
        />
      </Card>
    );
  }

  const poteBruto = actual.caballos
    .filter((c) => !c.retirado)
    .reduce((a, c) => a + (Number(c.monto) || 0), 0);
  const pctCasa = Number(actual.porcentaje_casa ?? 25);
  const aPagar = Math.round(poteBruto * (1 - pctCasa / 100) * 100) / 100;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            🔨 Cuadro Oficial de Remate (Vista Jugador · Solo Lectura de Parámetros)
          </div>
          <div className="text-sm font-black">
            {nombreHipodromoParaMostrar(actual.hipodromo)} · Carrera #{actual.carrera} ({actual.fecha})
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold bg-white/10 px-3 py-1.5 rounded-xl">
          <span>Pote Bruto: {formatoMoneda("USD", poteBruto)}</span>
          <span>·</span>
          <span className="text-emerald-300 font-black">A Pagar: {formatoMoneda("USD", aPagar)}</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {remates.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRemateId(r.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                actual.id === r.id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              🏇 {nombreHipodromoParaMostrar(r.hipodromo)} · C{r.carrera}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100 text-left text-[10px] font-black uppercase text-slate-600 border-b border-slate-200">
                <th className="py-2 px-3 w-14">#</th>
                <th className="py-2 px-3">Ejemplar</th>
                <th className="py-2 px-3">Comprador Actual</th>
                <th className="py-2 px-3 text-right">Monto Actual</th>
                <th className="py-2 px-3 text-right">Tu Oferta / Compra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actual.caballos.map((c) => {
                const numStr = String(c.numero);
                const sugerido = Math.max(10, (Number(c.monto) || 0) + 5);
                return (
                  <tr key={numStr} className={c.retirado ? "bg-rose-50/40 line-through text-slate-400" : ""}>
                    <td className="py-2 px-3 font-mono font-black">#{numStr}</td>
                    <td className="py-2 px-3 font-bold text-slate-800">{c.nombre}</td>
                    <td className="py-2 px-3 text-slate-600">{c.comprador || "CASA"}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold">
                      {formatoMoneda("USD", c.monto)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {c.retirado ? (
                        <span className="text-[10px] font-black text-rose-600">RETIRADO</span>
                      ) : bloqueada ? (
                        <button
                          type="button"
                          onClick={() => void onPedirDesbloqueo(actual.hipodromo, actual.carrera)}
                          className="rounded bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-900 border border-amber-300"
                        >
                          🔓 Solicitar desbloqueo
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            value={montosPuja[numStr] ?? String(sugerido)}
                            onChange={(e) =>
                              setMontosPuja((prev) => ({ ...prev, [numStr]: e.target.value }))
                            }
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs font-bold"
                          />
                          <Button
                            size="sm"
                            disabled={enviando}
                            onClick={() => void comprarCaballoRemate(numStr, c.nombre, c.monto)}
                          >
                            🛒 Comprar
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 5. 🔀 DUPLETAS
// ============================================================================

function ModalidadDupletasPortal({
  dupletas,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  dupletas: DupletaEstado[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const [claveSel, setClaveSel] = useState("");
  const [num1, setNum1] = useState("");
  const [num2, setNum2] = useState("");
  const [monto, setMonto] = useState("10");

  useEffect(() => {
    if (!claveSel && dupletas.length > 0) {
      setClaveSel(claveDeDupleta(dupletas[0]));
    }
  }, [claveSel, dupletas]);

  const actual = useMemo(
    () => dupletas.find((d) => claveDeDupleta(d) === claveSel) ?? dupletas[0] ?? null,
    [dupletas, claveSel]
  );

  const comprarDupleta = async () => {
    if (!actual) return;
    if (bloqueada) {
      return toast("La venta de Dupletas está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    const m = parseFloat(monto);
    if (!num1 || !num2 || !(m > 0)) {
      return toast("Seleccioná un ejemplar en la 1ª pata, uno en la 2ª pata y el monto.", "warning");
    }
    setEnviando(true);
    const r = await realizarJugada({
      tipo: "DUPLETA",
      hipodromo: actual.hipodromo,
      fecha: actual.fecha,
      carrera1: actual.carrera1,
      carrera2: actual.carrera2,
      numero1: num1,
      numero2: num2,
      monto: m,
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo comprar la dupleta.", "error");
    toast(`✅ Dupleta registrada (C${actual.carrera1}: #${num1} × C${actual.carrera2}: #${num2}) por $${m}.`, "success");
    await onRealizada();
  };

  if (!actual) {
    return (
      <Card>
        <EmptyState
          icono="🔀"
          titulo="No hay Dupletas abiertas en este momento"
          descripcion="Cuando el Administrador habilite dupletas aparecerán acá con sus dos patas."
        />
      </Card>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white">
        <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
          🔀 Cuadro Oficial de Dupletas (Vista Jugador)
        </div>
        <div className="text-sm font-black">
          {nombreHipodromoParaMostrar(actual.hipodromo)} · C{actual.carrera1} + C{actual.carrera2}
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {dupletas.map((d) => {
            const k = claveDeDupleta(d);
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setClaveSel(k);
                  setNum1("");
                  setNum2("");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                  claveSel === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                🏇 {nombreHipodromoParaMostrar(d.hipodromo)} · C{d.carrera1}→C{d.carrera2}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-black uppercase text-indigo-900 mb-2">
              1ª Pata — Carrera #{actual.carrera1}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {actual.caballos1.map((e) => (
                <button
                  key={e.numero}
                  type="button"
                  disabled={e.retirado}
                  onClick={() => setNum1(String(e.numero))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    e.retirado
                      ? "bg-rose-50 text-slate-400 line-through"
                      : num1 === String(e.numero)
                        ? "bg-indigo-600 text-white shadow"
                        : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                  }`}
                >
                  #{e.numero} {e.nombre}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-black uppercase text-indigo-900 mb-2">
              2ª Pata — Carrera #{actual.carrera2}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {actual.caballos2.map((e) => (
                <button
                  key={e.numero}
                  type="button"
                  disabled={e.retirado}
                  onClick={() => setNum2(String(e.numero))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    e.retirado
                      ? "bg-rose-50 text-slate-400 line-through"
                      : num2 === String(e.numero)
                        ? "bg-amber-500 text-slate-950 shadow"
                        : "bg-slate-100 text-slate-800 hover:bg-slate-200"
                  }`}
                >
                  #{e.numero} {e.nombre}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 border border-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Monto de la Dupleta (USD):</span>
            <input
              type="number"
              min={1}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs font-black"
            />
          </div>
          {bloqueada ? (
            <Button
              size="sm"
              onClick={() => void onPedirDesbloqueo(actual.hipodromo, Number(actual.carrera1) || 1)}
              className="bg-amber-600 hover:bg-amber-500 text-white font-black"
            >
              🔓 Solicitar Desbloqueo
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={enviando || !num1 || !num2}
              onClick={() => void comprarDupleta()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
            >
              {enviando ? "Registrando…" : "🛒 Comprar Dupleta"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 6. 🎯 POLLAS (SELECCIÓN EN LAS 6 VÁLIDAS)
// ============================================================================

function ModalidadPollasPortal({
  pollas,
  bloqueada,
  enviando,
  setEnviando,
  onPedirDesbloqueo,
  onRealizada,
}: {
  sesion: SesionPortal;
  pollas: Polla[];
  bloqueada: boolean;
  enviando: boolean;
  setEnviando: (v: boolean) => void;
  onPedirDesbloqueo: (h?: string, c?: number) => Promise<void>;
  onRealizada: () => Promise<void> | void;
}) {
  const [pollaId, setPollaId] = useState(pollas[0]?.id ?? "");
  const [caballosValida, setCaballosValida] = useState<[string, string, string, string, string, string]>([
    "",
    "",
    "",
    "",
    "",
    "",
  ]);

  useEffect(() => {
    if (!pollaId && pollas.length > 0) setPollaId(pollas[0].id);
  }, [pollaId, pollas]);

  const actual = useMemo(
    () => pollas.find((p) => p.id === pollaId) ?? pollas[0] ?? null,
    [pollas, pollaId]
  );

  const comprarPolla = async () => {
    if (!actual) return;
    if (bloqueada) {
      return toast("La venta de Pollas está bloqueada. Solicitá el desbloqueo al Administrador.", "warning");
    }
    const numeros = caballosValida.map((c) => parseInt(c.trim(), 10));
    if (numeros.some((n) => !Number.isFinite(n) || n <= 0)) {
      return toast("Indicá un número de ejemplar válido en cada una de las 6 carreras válidas.", "warning");
    }
    setEnviando(true);
    const hipoPolla = actual.hipodromo_id || actual.nombre || "LA RINCONADA";
    const r = await realizarJugada({
      tipo: "POLLA",
      polla_id: actual.id,
      hipodromo: hipoPolla,
      fecha: actual.fecha,
      monto: Number(actual.precioUnitario) || 10,
      combinaciones: [numeros],
      texto_original: numeros.join("-"),
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo comprar la Polla.", "error");
    toast(`✅ Combinación de Polla (${numeros.join("-")}) registrada y cargada a tu grupo.`, "success");
    await onRealizada();
  };

  if (!actual) {
    return (
      <Card>
        <EmptyState
          icono="🎯"
          titulo="No hay Pollas abiertas en este momento"
          descripcion="Cuando el Administrador abra la Polla del día aparecerá acá para sellar tus combinaciones."
        />
      </Card>
    );
  }

  const hipoNombrePolla = actual.hipodromo_id || actual.nombre || "POLLA HÍPICA";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
            🎯 Cuadro Oficial de Polla Hípica (1ª a 6ª Válida)
          </div>
          <div className="text-sm font-black">
            {nombreHipodromoParaMostrar(hipoNombrePolla)} · {actual.fecha}
          </div>
        </div>
        <span className="rounded-lg bg-white/10 px-3 py-1 text-xs font-black text-emerald-300">
          Costo por combinación: {formatoMoneda("USD", actual.precioUnitario)}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <label key={idx} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 block">
              <span className="block text-[10px] font-black uppercase text-indigo-900">
                {idx + 1}ª Válida
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={caballosValida[idx]}
                onChange={(e) => {
                  const copia = [...caballosValida] as [string, string, string, string, string, string];
                  copia[idx] = e.target.value;
                  setCaballosValida(copia);
                }}
                placeholder="N° Caballo"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-center font-mono text-sm font-black"
              />
            </label>
          ))}
        </div>

        <div className="flex justify-end">
          {bloqueada ? (
            <Button
              size="sm"
              onClick={() => void onPedirDesbloqueo(hipoNombrePolla, 1)}
              className="bg-amber-600 hover:bg-amber-500 text-white font-black"
            >
              🔓 Solicitar Desbloqueo
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={enviando}
              onClick={() => void comprarPolla()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black"
            >
              {enviando
                ? "Sellando Polla…"
                : `🎯 Comprar Polla (${formatoMoneda("USD", actual.precioUnitario)})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
