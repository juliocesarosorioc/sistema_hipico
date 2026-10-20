"use client";

import { useEffect, useRef, useState } from "react";
import { BANCOS_VZLA, esBancoVzla, listMetodosPago, type DatosPago } from "@/shared/lib/vzla";
import {
  MONEDAS_PAGO,
  nuevaFormaPago,
  type FormaPago,
} from "@/features/clientes/lib/formasPago";

const lbl = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";
const inp =
  "w-full border border-emerald-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white";
const dis = inp + " bg-emerald-50 font-bold text-emerald-800 cursor-not-allowed";

const BANCO_LABEL: Record<string, string> = {
  "0102": "VENEZUELA", "0104": "VEN. CRÉDITO", "0105": "MERCANTIL", "0108": "BBVA PROVINCIAL",
  "0114": "OCCIDENTAL (BOD)", "0115": "EXTERIOR", "0128": "CARONI", "0134": "BANESCO",
  "0137": "SOFITASA", "0138": "PLAZA", "0146": "BANCARIBE", "0151": "DEL SUR",
  "0156": "PICHINCHA", "0157": "SUDEBAN", "0163": "DEL TESORO", "0164": "MIBANCO",
  "0166": "AGRÍCOLA", "0171": "ACTIVO", "0172": "BANCAMIGA", "0173": "CAFETERO",
  "0175": "BICENTENARIO", "0191": "BNC",
};

/**
 * Bloque dinámico de datos de pago (clon de js/clientes.js renderBloqueDatosPago).
 * Muestra los campos específicos según el método seleccionado.
 *
 * Cada bloque se renderiza DENTRO de una fila de `FormasPagoLista`, que es la
 * que agrega (➕) y quita (🗑️) formas de pago y pone la moneda y la ⭐ principal.
 */
export function DatosPagoForm({
  prefijo,
  metodo,
  inicial,
  onChange,
}: {
  prefijo: string;
  metodo: string;
  inicial?: DatosPago | null;
  onChange: (dp: DatosPago) => void;
}) {
  const [dp, setDp] = useState<DatosPago>({ ...(inicial ?? {}) });

  useEffect(() => {
    setDp({ ...(inicial ?? {}) });
  }, [inicial]);

  useEffect(() => {
    onChange(dp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dp]);

  if (!metodo) return null;

  const set = (k: keyof DatosPago, v: string) => setDp((d) => ({ ...d, [k]: v }));

  if (esBancoVzla(metodo)) {
    const [codigo, ...resto] = metodo.split(" · ");
    const nombre = resto.join(" · ");
    const esSudeban = codigo === "0157";
    const hint = esSudeban ? (
      <p className="mt-1 text-[9px] font-bold text-blue-700 md:col-span-3 bg-blue-50 border border-blue-200 rounded p-2">
        💡 <b>SUDEBAN:</b> tu cuenta tiene 20 dígitos ({codigo} + 16). Coloca <u>solo los 16 dígitos restantes</u>.
      </p>
    ) : (
      <p className="mt-1 text-[9px] font-medium text-slate-500 md:col-span-3 bg-slate-50 border border-slate-200 rounded p-2">
        💡 En las cuentas de Venezuela el código del banco ({codigo}) va <b>antes</b> del número de cuenta. Escribe
        únicamente los <b>16 dígitos</b> de tu cuenta.
      </p>
    );
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <div className="md:col-span-2">
          <label className={lbl}>Banco (predeterminado)</label>
          <input readOnly value={nombre} className={dis} data-testid={`${prefijo}-banco-nombre`} />
        </div>
        <div>
          <label className={lbl}>Código SUDEBAN</label>
          <input readOnly value={codigo} className={dis} />
        </div>
        <div>
          <label className={lbl}>Tipo de Cuenta</label>
          <select className={inp + " font-bold"} value={dp.tipo_cuenta ?? "CORRIENTE"} onChange={(e) => set("tipo_cuenta", e.target.value)}>
            <option>CORRIENTE</option>
            <option>AHORRO</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Número de Cuenta (16 dígitos)</label>
          <input
            inputMode="numeric"
            maxLength={16}
            placeholder={esSudeban ? `SOLO los 16 dígitos restantes (sin ${codigo})` : `Los 16 dígitos (sin el código ${codigo})`}
            className={inp + " font-mono"}
            value={dp.numero_cuenta ?? ""}
            onChange={(e) => set("numero_cuenta", e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Titular (nombre en la cuenta)</label>
          <input className={inp + " uppercase"} value={dp.titular ?? ""} onChange={(e) => set("titular", e.target.value.toUpperCase())} />
        </div>
        {hint}
      </div>
    );
  }

  if (metodo === "PAGO MÓVIL") {
    const seleccionado = dp.codigo && dp.banco ? `${dp.codigo} · ${dp.banco}` : `${BANCOS_VZLA[0].codigo} · ${BANCOS_VZLA[0].nombre}`;
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <div>
          <label className={lbl}>Banco (pago móvil)</label>
          <select className={inp + " font-bold"} value={seleccionado} onChange={(e) => {
            const [c, ...r] = e.target.value.split(" · ");
            setDp((d) => ({ ...d, codigo: c, banco: r.join(" · ") }));
          }}>
            {BANCOS_VZLA.map((b) => (
              <option key={b.codigo} value={`${b.codigo} · ${b.nombre}`}>
                {b.codigo} · {BANCO_LABEL[b.codigo] || b.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Teléfono vinculado</label>
          <input
            inputMode="numeric"
            placeholder="0412 123 4567"
            className={inp + " font-mono"}
            value={dp.telefono ?? ""}
            onChange={(e) => set("telefono", e.target.value)}
          />
        </div>
        <div>
          <label className={lbl}>Titular (opcional)</label>
          <input className={inp + " uppercase"} value={dp.titular ?? ""} onChange={(e) => set("titular", e.target.value.toUpperCase())} />
        </div>
        <div className="md:col-span-3">
          <label className={lbl}>Cédula / RIF (opcional)</label>
          <input className={inp + " font-mono uppercase"} placeholder="V-12.345.678" value={dp.cedula_rif ?? ""} onChange={(e) => set("cedula_rif", e.target.value.toUpperCase())} />
        </div>
      </div>
    );
  }

  if (metodo === "ZELLE" || metodo === "BINANCE") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <div>
          <label className={lbl}>Tipo de dato</label>
          <select className={inp + " font-bold"} value={dp.tipo_contacto ?? "correo"} onChange={(e) => set("tipo_contacto", e.target.value)}>
            <option value="correo">Correo electrónico</option>
            <option value="telefono">Número de teléfono</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Dato de {metodo} (correo o teléfono)</label>
          <input
            placeholder={metodo === "ZELLE" ? "ej. correo@mail.com o +1 555 123 4567" : "ID o correo vinculado a Binance"}
            className={inp}
            value={dp.dato ?? ""}
            onChange={(e) => set("dato", e.target.value)}
          />
        </div>
        {metodo === "BINANCE" ? (
          <div className="md:col-span-3">
            <label className={lbl}>ID / UID de Binance (opcional)</label>
            <input className={inp} value={dp.id_binance ?? ""} onChange={(e) => set("id_binance", e.target.value)} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
      <span className="mr-1">ℹ️</span>Para <b>{metodo}</b> no se requieren datos bancarios adicionales.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista dinámica de formas de pago — UNA o MÁS por cliente (PROMPT #7)
// ---------------------------------------------------------------------------

const lblF = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";
const inpF =
  "w-full border border-emerald-300 rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-white";

/**
 * Lista de formas de pago del cliente con ➕ Agregar otra forma de pago y 🗑️
 * para quitar (ModalCliente en alta/edición y Mi Perfil del Portal).
 *
 * Cada fila trae Método, Moneda, ⭐ Principal y los datos específicos de ese
 * método (vía `DatosPagoForm`), y el estado controlado es el arreglo entero:
 * el padre guarda `formas` y acá solo se piden cambios.
 *
 * El truco de `inicial`: `DatosPagoForm` copia `inicial` a su estado interno en
 * un efecto por referencia. Si `inicial` apuntara al `datos` que ese mismo
 * componente acaba de emitir, cada tecla generaría una referencia nueva,
 * re-dispararía el efecto y se entraría en un bucle de render. Por eso el
 * "inicial" de cada fila se congela en un `ref` por `uid` y solo se vacía a
 * propósito, cuando cambia el método de la fila (los datos del banco no sirven
 * para Zelle).
 */
export function FormasPagoLista({
  prefijo,
  formas,
  onChange,
  error,
}: {
  /** Prefijo de los `data-testid` (ej. "nuevo", "editar", "perfil"). */
  prefijo: string;
  formas: FormaPago[];
  onChange: (siguientes: FormaPago[]) => void;
  error?: string;
}) {
  const iniciales = useRef<Record<string, DatosPago | null>>({});

  // Toda fila necesita `uid`: es la clave de la fila y la llave del "inicial"
  // congelado. Si un padre arma la lista a mano (o la rehidrata de otro lado),
  // se lo ponemos acá una sola vez. Termina sola: al quedarse sin filas sin
  // `uid`, la condición deja de cumplirse.
  useEffect(() => {
    if (formas.some((f) => !f.uid)) onChange(formas.map((f) => (f.uid ? f : nuevaFormaPago(f))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formas]);

  /** Inicial congelado por fila (ver la nota de arriba). */
  const inicialDe = (f: FormaPago): DatosPago | null => {
    const k = f.uid ?? "";
    if (!(k in iniciales.current)) iniciales.current[k] = f.datos ?? null;
    return iniciales.current[k];
  };

  const cambiar = (i: number, parche: Partial<FormaPago>) =>
    onChange(formas.map((f, j) => (j === i ? { ...f, ...parche } : f)));

  /** Cambiar de método reinicia los datos y su inicial (bloque distinto). */
  const cambiarMetodo = (i: number, metodo: string) => {
    const uid = formas[i]?.uid;
    if (uid) iniciales.current[uid] = {};
    onChange(formas.map((f, j) => (j === i ? { ...f, metodo, datos: {} } : f)));
  };

  const marcarPrincipal = (i: number) =>
    onChange(formas.map((f, j) => ({ ...f, principal: j === i })));

  const agregar = () => onChange([...formas, nuevaFormaPago()]);

  const quitar = (i: number) => onChange(formas.filter((_, j) => j !== i));

  return (
    <div className="space-y-2" data-testid={`${prefijo}-formas-pago`}>
      {formas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-2 text-[11px] text-slate-500">
          <span className="mr-1">💳</span> Sin formas de pago registradas. Agregá una con el botón de abajo
          (Pago Móvil, Transferencia, Zelle, Binance/USDT, Efectivo…).
        </p>
      ) : null}

      {formas.map((f, i) => (
        <div
          key={f.uid ?? i}
          className="rounded-lg border border-emerald-200 bg-white p-2 shadow-sm"
          data-testid={`${prefijo}-forma-${i}`}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lblF}>
                Método de pago{formas.length > 1 ? ` #${i + 1}` : ""}
              </label>
              <select
                className={inpF + " font-bold"}
                value={f.metodo}
                onChange={(e) => cambiarMetodo(i, e.target.value)}
                data-testid={`${prefijo}-${i}-metodo`}
              >
                <option value="">— Seleccione —</option>
                {listMetodosPago(true).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lblF}>Moneda</label>
              <select
                className={inpF + " font-bold"}
                value={(f.moneda ?? "USD").toUpperCase()}
                onChange={(e) => cambiar(i, { moneda: e.target.value })}
                data-testid={`${prefijo}-${i}-moneda`}
              >
                {MONEDAS_PAGO.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2">
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700"
                title="Forma de pago con la que se cobra / paga por defecto"
              >
                <input
                  type="checkbox"
                  className="accent-amber-500"
                  checked={f.principal === true}
                  onChange={() => marcarPrincipal(i)}
                  data-testid={`${prefijo}-${i}-principal`}
                />
                ⭐ Principal
              </label>
              <button
                type="button"
                onClick={() => quitar(i)}
                title="Quitar esta forma de pago"
                aria-label={`Quitar forma de pago ${i + 1}`}
                className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 transition hover:bg-red-100"
                data-testid={`${prefijo}-${i}-quitar`}
              >
                🗑️
              </button>
            </div>
          </div>

          {f.metodo ? (
            <div className="mt-2">
              <DatosPagoForm
                prefijo={`${prefijo}-${i}`}
                metodo={f.metodo}
                inicial={inicialDe(f)}
                onChange={(dp) => cambiar(i, { datos: dp })}
              />
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={agregar}
          className="rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-700 transition hover:bg-emerald-100"
          data-testid={`${prefijo}-agregar-forma`}
        >
          ➕ Agregar otra forma de pago
        </button>
        <span className="text-[10px] text-slate-400">
          {formas.length} forma(s) · la ⭐ es la que se usa para cobrar o pagar
        </span>
      </div>

      {error ? (
        <p className="text-[10px] font-bold text-danger-600">{error}</p>
      ) : null}
    </div>
  );
}