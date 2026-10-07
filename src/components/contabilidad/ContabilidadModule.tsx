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
 * El saldo de "caja" NO viene de una tabla `caja` — esa tabla no existe en el
 * sistema. Es la suma de `clientes.saldo_actual` (js/caja.js:306-316).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { TabBancos, TabCaja, TabIngresos, TabMonedas } from "@/components/contabilidad/ContabilidadTabs";
import {
  listarBancos,
  listarClientesSaldos,
  listarDepositos,
  listarHistorialTasas,
  listarMonedas,
  listarTasasReferencia,
  listarTransacciones,
  tasaGlobalVes,
  type BancoRow,
  type ClienteSaldo,
  type DepositoRow,
  type MonedaRow,
  type TasaCambioRow,
  type TasaReferenciaRow,
  type TransaccionRow,
} from "@/lib/contabilidad";

type Tab = "ingresos" | "caja" | "bancos" | "monedas";

/** Cada pantalla tiene su propia ruta para que el menú no marque varias activas. */
const RUTAS: Record<Tab, { ruta: string; txt: string; emoji: string }> = {
  ingresos: { ruta: "/contabilidad/ingresos", txt: "Ingresos / Avales", emoji: "📥" },
  caja: { ruta: "/contabilidad/caja", txt: "Caja Unificada", emoji: "💵" },
  bancos: { ruta: "/contabilidad/bancos", txt: "Bancos Reales", emoji: "🏦" },
  monedas: { ruta: "/contabilidad/monedas", txt: "Monedas y Tasas", emoji: "💱" },
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
  const [cargando, setCargando] = useState(true);

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

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Si la ruta cambia sin remount (navegación interna), se sincroniza la pestaña.
  useEffect(() => {
    setTab(tabInicial);
  }, [tabInicial]);

  const irA = (t: Tab) => {
    setTab(t);
    router.push(RUTAS[t].ruta);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-black text-slate-800">
          <span className="mr-2 text-primary-600">🪙</span> Contabilidad
        </h1>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          <span >🔄</span> Actualizar
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
      ) : (
        <TabMonedas
          monedas={monedas}
          historial={historial}
          referencias={referencias}
          onHecho={cargar}
        />
      )}

      <ToastHost />
    </div>
  );
}
