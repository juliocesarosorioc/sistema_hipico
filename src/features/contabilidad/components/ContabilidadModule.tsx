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
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import {
  TabBancos,
  TabBalanceNIIF,
  TabCaja,
  TabIngresos,
  TabMonedas,
} from "@/features/contabilidad/components/ContabilidadTabs";
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

type Tab = "ingresos" | "caja" | "bancos" | "monedas" | "niif";

/**
 * Cada pantalla tiene su propia ruta para que el menú no marque varias
 * activas.
 *
 * El Balance NIIF es la excepción: se abre como VISTA de `/contabilidad` con
 * `?vista=niif`. Motivo concreto: en este sistema TODA ruta tiene su
 * capacidad registrada en el maestro (`capacidadesDeRuta`), y una ruta sin
 * registrar queda DENEGADA — por el middleware del servidor y también por
 * `RutaProtegida` en el cliente. Agregar una ruta nueva obliga a tocar el
 * maestro de seguridad, que es de otro módulo; la query `?vista=` resuelve lo
 * mismo sin tocarlo y con el mismo patrón que ya usa `/seguridad?pestana=`.
 */
const RUTAS: Record<Tab, { ruta: string; txt: string; emoji: string }> = {
  ingresos: { ruta: "/contabilidad/ingresos", txt: "Ingresos / Avales", emoji: "📥" },
  caja: { ruta: "/contabilidad/caja", txt: "Caja Unificada", emoji: "💵" },
  bancos: { ruta: "/contabilidad/bancos", txt: "Bancos Reales", emoji: "🏦" },
  monedas: { ruta: "/contabilidad/monedas", txt: "Monedas y Tasas", emoji: "💱" },
  niif: { ruta: "/contabilidad?vista=niif", txt: "Balance NIIF", emoji: "📘" },
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

  /**
   * Rango de fechas del balance NIIF. Vive acá (y no en la pestaña) porque el
   * balance acumulado no se puede recortar en pantalla: hay que volver a
   * preguntarle a la base el detalle del período.
   */
  const [rango, setRango] = useState<{ desde?: string; hasta?: string }>({});

  /**
   * Última pestaña pedida por el operador. Se guarda aparte de la URL porque
   * al navegar a `/contabilidad?vista=niif` el módulo se vuelve a montar y la
   * URL todavía puede no reflejar el cambio: sin este respaldo, el Balance
   * abriría en "Ingresos" en el primer clic.
   */
  const tabPedida = useRef<Tab | null>(null);

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

  /** Balance acumulado (todo el libro) o del período pedido. */
  const aplicarRango = useCallback(async (nuevo: { desde?: string; hasta?: string }) => {
    setRango(nuevo);
    setBalance(await obtenerBalanceComprobacionNIIF(nuevo));
  }, []);

  /** Refresca el balance y el libro de asientos (después de registrar o revertir). */
  const recargarBalance = useCallback(async () => {
    setBalance(await obtenerBalanceComprobacionNIIF(rango));
    setAsientos(await listarAsientosNIIF(50));
  }, [rango]);

  useEffect(() => {
    void (async () => {
      await cargar();
      setBalance(await obtenerBalanceComprobacionNIIF({}));
      setAsientos(await listarAsientosNIIF(50));
    })();
  }, [cargar]);

  // La pestaña vigente sale de la URL: cada pantalla tiene su ruta y el
  // Balance NIIF se abre como vista (`?vista=niif`). Se lee de
  // `window.location.search` y no con `useSearchParams` porque el build
  // estático exigiría un límite de Suspense que estas páginas no tienen
  // (mismo criterio que SeguridadModule con `?pestana=`).
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get("vista");
    // Se comparan contra las claves CONOCIDAS (y no con `in RUTAS`, que también
    // encuentra "constructor" y compañía en el prototipo del objeto).
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
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void (async () => {
              await cargar();
              await recargarBalance();
            })()
          }
        >
          <span>🔄</span> Actualizar
        </Button>
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

      <ToastHost />
    </div>
  );
}
