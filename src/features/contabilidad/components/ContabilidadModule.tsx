"use client";

/**
 * CONTABILIDAD — módulo unificado de tesorería.
 *
 * Reúne las cuatro pantallas que el legacy tenía repartidas y que en el menú
 * estaban marcadas como "pronto":
 *   · Ingresos / Avales   (js/depositos.js)
 *   · Caja Unificada      (js/caja.js)
 *   · Bancos Reales       (js/bancos.js)
 *   · Monedas y Tasas     (js/monedas.js)
 *
 * Y la quinta, que es la contabilidad NIIF propiamente dicha:
 *   · Balance NIIF       (partida doble, NIC 21 y precisión decimal)
 *
 * El saldo de "caja" NO viene de una tabla `caja` — esa tabla no existe en el
 * sistema. Es la suma de `clientes.saldo_actual` (js/caja.js:306-316).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/core/supabase";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { ModalPagoAGanadorYConciliacion } from "@/features/contabilidad/components/ModalPagoAGanadorYConciliacion";
import { useAuthStore } from "@/shared/store/useAuthStore";
import {
  TabBancos,
  TabBalanceNIIF,
  TabCaja,
  TabIngresos,
  TabMonedas,
  TabPlanCuentasPUC,
  TabLibroDiarioMayor,
  TabEstadoResultadosSemana,
} from "@/features/contabilidad/components/ContabilidadTabs";
import { TabHonorariosEquipo } from "@/features/contabilidad/components/TabHonorariosEquipo";
import { TabCopilotoContableIA } from "@/features/contabilidad/components/TabCopilotoContableIA";
import { TabManualContableNIIF } from "@/features/contabilidad/components/TabManualContableNIIF";
import { sincronizarYAuditarContabilidadCompleta } from "@/features/contabilidad/lib/motor-backfill-retroactivo";
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import {
  listarAsientosNIIF,
  listarBancos,
  listarClientesSaldos,
  listarDepositos,
  listarHistorialTasas,
  listarMonedas,
  listarTasasReferencia,
  listarTransacciones,
  obtenerBalanceComprobacionNIIF,
  tasaGlobalVes,
  type AsientoNIIFResumen,
  type BancoRow,
  type ClienteSaldo,
  type DepositoRow,
  type FilaBalanceNIIF,
  type MonedaRow,
  type TasaCambioRow,
  type TasaReferenciaRow,
  type TransaccionRow,
} from "@/features/contabilidad/lib/contabilidad";

type Tab =
  | "ingresos"
  | "caja"
  | "bancos"
  | "monedas"
  | "puc"
  | "libro_diario"
  | "estado_resultados"
  | "niif"
  | "honorarios"
  | "asistente_ia"
  | "manual";

/**
 * Cada pantalla tiene su propia ruta para que el menú no marque varias
 * activas.
 *
 * El Balance NIIF, PUC, Libro Diario y Estado de Resultados se abren como
 * vistas de `/contabilidad` con `?vista=...`.
 */
const RUTAS: Record<Tab, { ruta: string; txt: string; emoji: string }> = {
  ingresos: { ruta: "/contabilidad/ingresos", txt: "Ingresos / Avales", emoji: "📥" },
  caja: { ruta: "/contabilidad/caja", txt: "Caja Unificada", emoji: "💵" },
  bancos: { ruta: "/contabilidad/bancos", txt: "Bancos Reales", emoji: "🏦" },
  monedas: { ruta: "/contabilidad/monedas", txt: "Monedas y Tasas", emoji: "💱" },
  puc: { ruta: "/contabilidad?vista=puc", txt: "Plan de Cuentas (PUC)", emoji: "📘" },
  libro_diario: { ruta: "/contabilidad?vista=libro_diario", txt: "Libro Diario (Partida Doble)", emoji: "📒" },
  estado_resultados: { ruta: "/contabilidad?vista=estado_resultados", txt: "Resultados Semanales", emoji: "📊" },
  niif: { ruta: "/contabilidad?vista=niif", txt: "Balance NIIF", emoji: "⚖️" },
  honorarios: { ruta: "/contabilidad?vista=honorarios", txt: "Honorarios Equipo", emoji: "👥" },
  asistente_ia: { ruta: "/contabilidad?vista=asistente_ia", txt: "Copiloto IA", emoji: "🤖" },
  manual: { ruta: "/contabilidad?vista=manual", txt: "Manual NIIF", emoji: "📖" },
};

export function ContabilidadModule({ tabInicial = "ingresos" }: { tabInicial?: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(tabInicial);
  const [bancos, setBancos] = useState<BancoRow[]>([]);
  const [clientes, setClientes] = useState<ClienteSaldo[]>([]);
  const [depositos, setDepositos] = useState<DepositoRow[]>([]);
  const [transacciones, setTransacciones] = useState<TransaccionRow[]>([]);
  const [monedas, setMonedas] = useState<MonedaRow[]>([]);
  const [historial, setHistorial] = useState<TasaCambioRow[]>([]);
  const [referencias, setReferencias] = useState<TasaReferenciaRow[]>([]);
  const [tasaVes, setTasaVes] = useState(1);
  const [balance, setBalance] = useState<FilaBalanceNIIF[]>([]);
  const [asientos, setAsientos] = useState<AsientoNIIFResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalPagosAbierto, setModalPagosAbierto] = useState(false);
  const [pestanaPagos, setPestanaPagos] = useState<"PAGAR_GANADORES" | "CONCILIAR_PAGOS">("PAGAR_GANADORES");

  /**
   * Rango de fechas del balance NIIF. Vive acá (y no en la pestaña) porque el
   * balance acumulado no se puede recortar en pantalla: hay que volver a
   * preguntarle a la base el detalle del período.
   */
  const [rango, setRango] = useState<{ desde?: string; hasta?: string }>({});
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const perfiles = useAuthStore((s) => s.perfiles);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  /**
   * Última pestaña pedida por el operador. Se guarda aparte de la URL porque
   * al navegar a `/contabilidad?vista=niif` el módulo se vuelve a montar y la
   * URL todavía puede no reflejar el cambio: sin este respaldo, el Balance
   * abriría en "Ingresos" en el primer clic.
   */
  const tabPedida = useRef<Tab | null>(null);

  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [grupoSeleccionado, setGrupoSeleccionado] = useState<string>(grupoActivo || "");

  useEffect(() => {
    void listarGruposVenta().then((g) => {
      setGrupos(g || []);
      if (!grupoSeleccionado && grupoActivo) {
        setGrupoSeleccionado(grupoActivo);
      }
    });
  }, [grupoActivo]);

  useEffect(() => {
    const handler = () => {
      void recargarBalance();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("contabilidad:asiento-registrado", handler);
      return () => window.removeEventListener("contabilidad:asiento-registrado", handler);
    }
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [b, c, d, t, m, h, r, v] = await Promise.all([
      listarBancos(),
      listarClientesSaldos(),
      listarDepositos(50),
      listarTransacciones(50),
      listarMonedas(),
      listarHistorialTasas(),
      listarTasasReferencia(),
      tasaGlobalVes(),
    ]);
    setBancos(b);
    setClientes(c);
    setDepositos(d);
    setTransacciones(t);
    setMonedas(m);
    setHistorial(h);
    setReferencias(r);
    setTasaVes(v);
    setCargando(false);
  }, []);

  /** Refresca los saldos de clientes en tiempo real sin recargar todo el módulo */
  const refrescarClientes = useCallback(async () => {
    const c = await listarClientesSaldos();
    setClientes(c);
  }, []);

  /** Balance acumulado (todo el libro) o del período pedido. */
  const aplicarRango = useCallback(async (nuevo: { desde?: string; hasta?: string }) => {
    setRango(nuevo);
    setBalance(await obtenerBalanceComprobacionNIIF(nuevo));
  }, []);

  /** Refresca el balance y el libro de asientos (después de registrar o revertir). */
  const recargarBalance = useCallback(async () => {
    setBalance(await obtenerBalanceComprobacionNIIF(rango));
    setAsientos(await listarAsientosNIIF(500));
  }, [rango]);

  useEffect(() => {
    void (async () => {
      await cargar();
      await sincronizarYAuditarContabilidadCompleta({
        grupoId: grupoSeleccionado || grupoActivo || null,
        silencioso: true,
      });
      setBalance(await obtenerBalanceComprobacionNIIF({}));
      setAsientos(await listarAsientosNIIF(500));
    })();
  }, [cargar, grupoActivo, grupoSeleccionado]);

  // Sincronización en tiempo real de saldos de clientes
  useEffect(() => {
    const handleActualizar = () => {
      void refrescarClientes();
    };

    window.addEventListener("hipico:saldos-actualizados", handleActualizar);
    window.addEventListener("hipico_tickets_actualizados", handleActualizar);
    window.addEventListener("hipico:movimientos-operador-actualizados", handleActualizar);
    window.addEventListener("focus", handleActualizar);

    let channel: any = null;
    if (supabase) {
      channel = supabase
        .channel("contabilidad-realtime-saldos")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "clientes" },
          () => {
            void refrescarClientes();
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tickets_apuestas" },
          () => {
            void refrescarClientes();
          }
        )
        .subscribe();
    }

    return () => {
      window.removeEventListener("hipico:saldos-actualizados", handleActualizar);
      window.removeEventListener("hipico_tickets_actualizados", handleActualizar);
      window.removeEventListener("hipico:movimientos-operador-actualizados", handleActualizar);
      window.removeEventListener("focus", handleActualizar);
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [refrescarClientes]);

  // La pestaña vigente sale de la URL: cada pantalla tiene su ruta y el
  // Balance NIIF se abre como vista (`?vista=niif`). Se lee de
  // `window.location.search` y no con `useSearchParams` porque el build
  // estático exigiría un límite de Suspense que estas páginas no tienen
  // (mismo criterio que SeguridadModule con `?pestana=`).
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get("vista");
    const mapaAlias: Record<string, Tab> = {
      diario: "libro_diario",
      libro_diario: "libro_diario",
      resultados: "estado_resultados",
      estado_resultados: "estado_resultados",
      puc: "puc",
      niif: "niif",
    };
    if (pedida && mapaAlias[pedida]) {
      setTab(mapaAlias[pedida]);
      return;
    }
    if (pedida && (Object.keys(RUTAS) as string[]).includes(pedida)) {
      setTab(pedida as Tab);
      return;
    }
    if (tabPedida.current) {
      setTab(tabPedida.current);
      return;
    }
    setTab(tabInicial);
  }, [tabInicial]);

  const irA = (t: Tab) => {
    tabPedida.current = t;
    setTab(t);
    router.push(RUTAS[t].ruta);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black text-slate-800">
          <span className="mr-2 text-primary-600">🪙</span> Contabilidad
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-line bg-slate-50 px-2.5 py-1 text-xs">
            <span className="font-bold text-slate-500 uppercase text-[10px]">🏢 Grupo:</span>
            <select
              value={grupoSeleccionado}
              onChange={(e) => setGrupoSeleccionado(e.target.value)}
              className="bg-transparent font-black text-slate-800 outline-none text-xs cursor-pointer"
            >
              <option value="">— Consolidado / Todos —</option>
              {grupos.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.nombre}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setPestanaPagos("PAGAR_GANADORES");
              setModalPagosAbierto(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 shadow-sm transition"
          >
            <span>🏆</span> Pagar Ganadores
          </button>
          <button
            type="button"
            onClick={() => {
              setPestanaPagos("CONCILIAR_PAGOS");
              setModalPagosAbierto(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-400 shadow-sm transition"
          >
            <span>🔔</span> Conciliar Pagos
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void (async () => {
                await sincronizarYAuditarContabilidadCompleta({
                  grupoId: grupoSeleccionado || grupoActivo || null,
                  silencioso: false,
                });
                await cargar();
                await recargarBalance();
              })()
            }
          >
            <span>⚖️🔄</span> Sincronizar Contabilidad NIIF
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line">
        {(Object.keys(RUTAS) as Tab[]).map((k) => {
          const t = RUTAS[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => irA(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors ${
                tab === k
                  ? "border-primary-600 text-primary-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className="mr-1.5">{t.emoji}</span>
              {t.txt}
            </button>
          );
        })}
      </div>

      {cargando ? (
        <div className="py-16 text-center text-sm text-slate-400">
          <span className="mr-2">⏳</span> Cargando contabilidad…
        </div>
      ) : tab === "ingresos" ? (
        <TabIngresos
          clientes={clientes}
          bancos={bancos}
          depositos={depositos}
          tasaVes={tasaVes}
          onHecho={cargar}
        />
      ) : tab === "caja" ? (
        <TabCaja
          clientes={clientes}
          bancos={bancos}
          transacciones={transacciones}
          tasaVes={tasaVes}
          onHecho={cargar}
        />
      ) : tab === "bancos" ? (
        <TabBancos bancos={bancos} monedas={monedas} onHecho={cargar} />
      ) : tab === "monedas" ? (
        <TabMonedas
          monedas={monedas}
          historial={historial}
          referencias={referencias}
          onHecho={cargar}
        />
      ) : tab === "puc" ? (
        <TabPlanCuentasPUC grupoId={grupoSeleccionado || null} />
      ) : tab === "libro_diario" ? (
        <TabLibroDiarioMayor grupoId={grupoSeleccionado || null} />
      ) : tab === "estado_resultados" ? (
        <TabEstadoResultadosSemana grupoId={grupoSeleccionado || null} />
      ) : tab === "honorarios" ? (
        <TabHonorariosEquipo grupoId={grupoSeleccionado || null} />
      ) : tab === "asistente_ia" ? (
        <TabCopilotoContableIA grupoId={grupoSeleccionado || null} onAsientoRegistrado={() => void recargarBalance()} />
      ) : tab === "manual" ? (
        <TabManualContableNIIF />
      ) : (
        <TabBalanceNIIF
          balance={balance}
          asientos={asientos}
          monedas={monedas}
          tasaVes={tasaVes}
          onRango={aplicarRango}
          onHecho={recargarBalance}
        />
      )}

      {modalPagosAbierto && (
        <ModalPagoAGanadorYConciliacion
          grupoId={grupoActivo || null}
          abierto={modalPagosAbierto}
          onCerrar={() => setModalPagosAbierto(false)}
          onPagoRealizado={() =>
            void (async () => {
              await cargar();
              await recargarBalance();
            })()
          }
          pestanaInicial={pestanaPagos}
        />
      )}

      <ToastHost />
    </div>
  );
}
