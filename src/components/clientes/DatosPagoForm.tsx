"use client";

import { useEffect, useState } from "react";
import { BANCOS_VZLA, esBancoVzla, type DatosPago } from "@/lib/vzla";

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
      <i className="fas fa-info-circle mr-1"></i>Para <b>{metodo}</b> no se requieren datos bancarios adicionales.
    </div>
  );
}