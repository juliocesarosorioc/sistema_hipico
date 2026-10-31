"use client";

import { useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { emitirToast } from "@/shared/lib/mensajeria";
import { formatoMoneda } from "@/shared/lib/vzla";
import {
  generarAsientoPartidaDoble,
  PLAN_CUENTAS_HIPICO,
  type LineaAsientoContable,
} from "@/features/contabilidad/lib/plan-cuentas";
import { procesarIntencionDataAnalystCpa } from "@/features/ia-copiloto/lib/analista-cpa-auditor";

interface Props {
  grupoId?: string | null;
  onAsientoRegistrado?: () => void;
}

type TipoOperacionIA =
  | "HONORARIOS_EQUIPO"
  | "COBRO_CLIENTE_AVALADO"
  | "PAGO_GANADOR_AVALADO"
  | "GASTO_OPERATIVO"
  | "DEPOSITO_BANCO"
  | "VENTA_INTERGRUPO_ARGENTINA";

export function TabCopilotoContableIA({ grupoId, onAsientoRegistrado }: Props) {
  const [promptTexto, setPromptTexto] = useState("");
  const [tipoOperacion, setTipoOperacion] = useState<TipoOperacionIA>("HONORARIOS_EQUIPO");

  // Parámetros guiados
  const [beneficiario, setBeneficiario] = useState("");
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [modalidadPago, setModalidadPago] = useState<"EFECTIVO" | "BANCO_PAGO_MOVIL" | "ZELLE_USDT" | "POR_PAGAR">("BANCO_PAGO_MOVIL");

  const [procesando, setProcesando] = useState(false);
  const [reporteCpa, setReporteCpa] = useState<string>("");
  const [auditandoCpa, setAuditandoCpa] = useState(false);

  const ejecutarAnalisisCpa = async (consulta: string) => {
    setAuditandoCpa(true);
    try {
      const res = await procesarIntencionDataAnalystCpa(consulta, {
        grupoId: grupoId || null,
        usuario: "AUDITOR_CPA",
      });
      if (res.esAnalitico && res.texto) {
        setReporteCpa(res.texto);
        onAsientoRegistrado?.();
      }
    } finally {
      setAuditandoCpa(false);
    }
  };

  // Interpretación asistida por IA de texto libre
  const interpretarPrompt = () => {
    const txt = promptTexto.trim().toLowerCase();
    if (!txt) return;

    // Extracción de monto
    const matchMonto = txt.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (matchMonto) {
      setMonto(matchMonto[1]);
    }

    // Tipo de operación
    if (txt.includes("honorario") || txt.includes("operador") || txt.includes("sueldo") || txt.includes("pago a")) {
      setTipoOperacion("HONORARIOS_EQUIPO");
    } else if (txt.includes("cobro") || txt.includes("cobrar") || txt.includes("deuda") || txt.includes("aval")) {
      setTipoOperacion("COBRO_CLIENTE_AVALADO");
    } else if (txt.includes("premio") || txt.includes("ganador")) {
      setTipoOperacion("PAGO_GANADOR_AVALADO");
    } else if (txt.includes("gasto") || txt.includes("comida") || txt.includes("luz") || txt.includes("papeleria")) {
      setTipoOperacion("GASTO_OPERATIVO");
    } else if (txt.includes("argentina") || txt.includes("intergrupo") || txt.includes("convenio")) {
      setTipoOperacion("VENTA_INTERGRUPO_ARGENTINA");
    }

    // Modalidad de pago
    if (txt.includes("zelle") || txt.includes("usdt")) {
      setModalidadPago("ZELLE_USDT");
    } else if (txt.includes("efectivo") || txt.includes("caja")) {
      setModalidadPago("EFECTIVO");
    } else if (txt.includes("debe") || txt.includes("por pagar") || txt.includes("pendiente")) {
      setModalidadPago("POR_PAGAR");
    } else {
      setModalidadPago("BANCO_PAGO_MOVIL");
    }

    setConcepto(promptTexto);
    emitirToast("✨ El Copiloto Contable interpretó tu registro. Revisa la partida doble abajo.", "success");
  };

  // Construcción de la partida doble asistida
  const montoNum = Math.round((parseFloat(monto) || 0) * 100) / 100;

  const cuentaPago =
    modalidadPago === "EFECTIVO"
      ? { codigo: "1.1.01.001", nombre: "Caja General y Efectivo Divisas" }
      : modalidadPago === "ZELLE_USDT"
      ? { codigo: "1.1.02.003", nombre: "Pasarelas Zelle / USDT" }
      : { codigo: "1.1.02.002", nombre: "Bancos Nacionales (Pago Móvil)" };

  let lineasSimuladas: LineaAsientoContable[] = [];

  if (montoNum > 0) {
    if (tipoOperacion === "HONORARIOS_EQUIPO") {
      const ctaHaber = modalidadPago === "POR_PAGAR"
        ? { codigo: "2.1.06.001", nombre: "Cuentas por Pagar Honorarios Equipo" }
        : cuentaPago;

      lineasSimuladas = [
        {
          cuenta_codigo: "6.1.03.001",
          cuenta_nombre: "Gastos de Honorarios y Operadores de Equipo",
          cliente_nombre: beneficiario || "Colaborador",
          debe: montoNum,
          haber: 0,
          concepto: concepto || `Honorarios devengados: ${beneficiario || "Personal"}`,
        },
        {
          cuenta_codigo: ctaHaber.codigo,
          cuenta_nombre: ctaHaber.nombre,
          cliente_nombre: beneficiario || "Colaborador",
          debe: 0,
          haber: montoNum,
          concepto: modalidadPago === "POR_PAGAR" ? "Obligación por pagar" : "Desembolso de honorarios",
        },
      ];
    } else if (tipoOperacion === "COBRO_CLIENTE_AVALADO") {
      lineasSimuladas = [
        {
          cuenta_codigo: cuentaPago.codigo,
          cuenta_nombre: cuentaPago.nombre,
          cliente_nombre: beneficiario || "Cliente",
          debe: montoNum,
          haber: 0,
          concepto: concepto || `Cobro de cartera aval: ${beneficiario || "Cliente"}`,
        },
        {
          cuenta_codigo: "1.2.02.001",
          cuenta_nombre: "Cartera de Avales Otorgados por Cobrar",
          cliente_nombre: beneficiario || "Cliente",
          debe: 0,
          haber: montoNum,
          concepto: `Disminución de cuenta por cobrar aval de ${beneficiario || "Cliente"}`,
        },
      ];
    } else if (tipoOperacion === "PAGO_GANADOR_AVALADO") {
      lineasSimuladas = [
        {
          cuenta_codigo: "2.1.01.003",
          cuenta_nombre: "Cuentas por Pagar — Premios Clientes Avalados",
          cliente_nombre: beneficiario || "Ganador Avalado",
          debe: montoNum,
          haber: 0,
          concepto: concepto || `Liquidación de premio a cliente: ${beneficiario}`,
        },
        {
          cuenta_codigo: cuentaPago.codigo,
          cuenta_nombre: cuentaPago.nombre,
          cliente_nombre: beneficiario || "Ganador Avalado",
          debe: 0,
          haber: montoNum,
          concepto: `Desembolso bancario a ganador: ${beneficiario}`,
        },
      ];
    } else if (tipoOperacion === "GASTO_OPERATIVO") {
      lineasSimuladas = [
        {
          cuenta_codigo: "6.1.03.001",
          cuenta_nombre: "Gastos de Operación y Administración",
          cliente_nombre: beneficiario || "Proveedor",
          debe: montoNum,
          haber: 0,
          concepto: concepto || "Gasto operativo de la casa",
        },
        {
          cuenta_codigo: cuentaPago.codigo,
          cuenta_nombre: cuentaPago.nombre,
          cliente_nombre: beneficiario || "Proveedor",
          debe: 0,
          haber: montoNum,
          concepto: "Salida de tesorería por gasto operativo",
        },
      ];
    } else if (tipoOperacion === "VENTA_INTERGRUPO_ARGENTINA") {
      lineasSimuladas = [
        {
          cuenta_codigo: "1.2.03.001",
          cuenta_nombre: "Cuentas por Cobrar a Grupos en Convenio",
          cliente_nombre: beneficiario || "Grupo Origen",
          debe: montoNum,
          haber: 0,
          concepto: concepto || `Cobro inter-grupo a ${beneficiario || "Grupo"}`,
        },
        {
          cuenta_codigo: "4.3.01.002",
          cuenta_nombre: "Ingresos Venta Neta Inter-Grupos (Argentina)",
          cliente_nombre: beneficiario || "Grupo Origen",
          debe: 0,
          haber: montoNum,
          concepto: `Ganancia retenida por venta inter-grupo imputada a Argentina`,
        },
      ];
    }
  }

  const totalDebe = lineasSimuladas.reduce((a, l) => a + l.debe, 0);
  const totalHaber = lineasSimuladas.reduce((a, l) => a + l.haber, 0);
  const estaCuadrado = totalDebe > 0 && Math.abs(totalDebe - totalHaber) < 0.001;

  const confirmarAsiento = async () => {
    if (!estaCuadrado) {
      return emitirToast("El asiento debe tener partida doble exacta (Debe === Haber).", "warning");
    }

    setProcesando(true);
    try {
      const res = await generarAsientoPartidaDoble({
        grupo_id: grupoId || null,
        fecha_contable: fecha,
        tipo_evento: tipoOperacion,
        referencia_id: `IA-${Date.now()}`,
        descripcion: concepto || `Asiento asistido por IA: ${tipoOperacion}`,
        creado_por: "COPILOTO_CONTABLE_IA",
        lineas: lineasSimuladas,
      });

      if (res.ok) {
        emitirToast(`🎉 Asiento N°${res.asiento?.numero_asiento ?? "PUBLICADO"} registrado con éxito.`, "success");
        setPromptTexto("");
        setMonto("");
        setBeneficiario("");
        setConcepto("");
        onAsientoRegistrado?.();
      } else {
        emitirToast(res.error || "No se pudo asentar.", "error");
      }
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Banner Copiloto Contable IA */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 p-5 text-white shadow-lg">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-pulse">🤖</span>
          <div>
            <h2 className="text-base font-black">Copiloto Contable IA — Registro Asistido en Partida Doble</h2>
            <p className="text-xs text-indigo-200">
              Formula preguntas que orientan a realizar registros perfectos sin errores de partida doble ni omisiones de cuentas.
            </p>
          </div>
        </div>

        {/* Input en lenguaje natural */}
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            type="text"
            value={promptTexto}
            onChange={(e) => setPromptTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && interpretarPrompt()}
            placeholder="Escribe en lenguaje natural: Ej. 'Pagué $150 de honorarios al operador Carlos por Pago Móvil'"
            className="flex-1 rounded-xl bg-white/10 border border-white/20 p-2.5 text-xs text-white placeholder-slate-400 outline-none focus:bg-white/15 focus:ring-2 focus:ring-indigo-400"
          />
          <Button variant="primary" size="sm" onClick={interpretarPrompt}>
            ✨ Interpretar con IA
          </Button>
        </div>

        {/* Acciones rápidas Senior Data Analyst & CPA Auditor */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/15 pt-3">
          <span className="text-[11px] font-black uppercase tracking-wider text-amber-300">
            📊 Perfil Data Analyst & Auditor CPA:
          </span>
          <button
            type="button"
            disabled={auditandoCpa}
            onClick={() => void ejecutarAnalisisCpa("Verificar cuadre contable y auditoría NIIF partida doble")}
            className="rounded-lg border border-emerald-400/50 bg-emerald-600/30 px-2.5 py-1 text-[11px] font-bold text-emerald-100 hover:bg-emerald-600/50 transition disabled:opacity-50"
          >
            {auditandoCpa ? "⏳ Auditando..." : "⚖️ Auditar Cuadre Contable NIIF"}
          </button>
          <button
            type="button"
            disabled={auditandoCpa}
            onClick={() => void ejecutarAnalisisCpa("Analizar rentabilidad, ganancia de la casa e incentivos devueltos")}
            className="rounded-lg border border-sky-400/50 bg-sky-600/30 px-2.5 py-1 text-[11px] font-bold text-sky-100 hover:bg-sky-600/50 transition disabled:opacity-50"
          >
            📈 Rentabilidad e Incentivos
          </button>
          <button
            type="button"
            disabled={auditandoCpa}
            onClick={() => void ejecutarAnalisisCpa("Auditar rendimiento por socio y comisiones de socios")}
            className="rounded-lg border border-amber-400/50 bg-amber-600/30 px-2.5 py-1 text-[11px] font-bold text-amber-100 hover:bg-amber-600/50 transition disabled:opacity-50"
          >
            👔 Auditar Comisiones a Socios
          </button>
        </div>

        {reporteCpa && (
          <div className="mt-3 rounded-xl border border-emerald-400/40 bg-slate-950/90 p-3.5 text-xs text-emerald-100 shadow-inner">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-black uppercase text-emerald-400 text-[11px]">
                📋 Dictamen del Auditor CPA & Data Analyst
              </span>
              <button
                type="button"
                onClick={() => setReporteCpa("")}
                className="text-[11px] text-slate-400 hover:text-white"
              >
                ✕ Cerrar
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{reporteCpa}</pre>
          </div>
        )}
      </div>

      {/* Preguntas Orientadoras Guiadas */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-4">
        <div className="border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            Preguntas Orientadoras para el Registro
          </h3>
          <p className="text-[11px] text-slate-500">
            Responde las preguntas para que el sistema mapee automáticamente el PUC correcto.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Pregunta 1: Tipo */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700">
              1. ¿Qué tipo de transacción deseas registrar? *
            </label>
            <select
              value={tipoOperacion}
              onChange={(e) => setTipoOperacion(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 p-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="HONORARIOS_EQUIPO">💼 Honorarios de Equipo (Operadores, Liquidadores)</option>
              <option value="COBRO_CLIENTE_AVALADO">👤 Cobro a Cliente Avalado (Cuentas por Cobrar)</option>
              <option value="PAGO_GANADOR_AVALADO">🏆 Pago a Ganador Avalado (Cuentas por Pagar)</option>
              <option value="GASTO_OPERATIVO">🏢 Gasto Operativo / Administrativo</option>
              <option value="VENTA_INTERGRUPO_ARGENTINA">🔀 Imputación Venta Inter-Grupos (Argentina)</option>
            </select>
          </div>

          {/* Pregunta 2: Beneficiario / Cliente */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700">
              2. ¿Quién es el beneficiario, colaborador o cliente involucrado? *
            </label>
            <input
              type="text"
              value={beneficiario}
              onChange={(e) => setBeneficiario(e.target.value)}
              placeholder="Ej: CARLOS MENDOZA / CLIENTE AVAL"
              className="w-full rounded-xl border border-slate-300 p-2 font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Pregunta 3: Monto */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700">
              3. ¿Cuál es el monto en USD? *
            </label>
            <input
              type="number"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-slate-300 p-2 font-mono font-black text-base text-indigo-950 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Pregunta 4: Medio de Pago */}
          <div className="space-y-1">
            <label className="font-bold text-slate-700">
              4. ¿A través de qué medio se liquidó o queda por pagar? *
            </label>
            <select
              value={modalidadPago}
              onChange={(e) => setModalidadPago(e.target.value as any)}
              className="w-full rounded-xl border border-slate-300 p-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="BANCO_PAGO_MOVIL">🏦 Banco Nacional / Pago Móvil (1.1.02.002)</option>
              <option value="EFECTIVO">💵 Caja General / Efectivo Divisas (1.1.01.001)</option>
              <option value="ZELLE_USDT">🌐 Pasarela Zelle / USDT (1.1.02.003)</option>
              <option value="POR_PAGAR">📋 Queda Por Pagar / Pasivo Acumulado</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-700">Fecha Contable</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold text-slate-700">Concepto / Glosa del Asiento</label>
            <input
              type="text"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Descripción analítica del movimiento"
              className="w-full rounded-xl border border-slate-300 p-2 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Previsualización del Asiento Contable Cuadrado */}
      {lineasSimuladas.length > 0 ? (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚖️</span>
              <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900">
                Previsualización de Partida Doble NIIF
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                  estaCuadrado ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                }`}
              >
                {estaCuadrado ? "✓ Partida Doble Cuadrada" : "Desbalanceado"}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase text-[9px] font-black">
                  <th className="py-2 px-3">Cuenta PUC</th>
                  <th className="py-2 px-3">Descripción de Cuenta</th>
                  <th className="py-2 px-3">Tercero / Beneficiario</th>
                  <th className="py-2 px-3 text-right">Debe ($)</th>
                  <th className="py-2 px-3 text-right">Haber ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineasSimuladas.map((l, i) => (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-mono font-bold text-indigo-700">{l.cuenta_codigo}</td>
                    <td className="py-2 px-3 font-semibold text-slate-800">{l.cuenta_nombre}</td>
                    <td className="py-2 px-3 text-slate-600">{l.cliente_nombre || "—"}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                      {l.debe > 0 ? formatoMoneda("USD", l.debe) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                      {l.haber > 0 ? formatoMoneda("USD", l.haber) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-black text-slate-900 bg-slate-50">
                  <td colSpan={3} className="py-2 px-3 uppercase text-[10px]">
                    Totales Balanceados
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-indigo-900">
                    {formatoMoneda("USD", totalDebe)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-indigo-900">
                    {formatoMoneda("USD", totalHaber)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              size="md"
              onClick={confirmarAsiento}
              disabled={!estaCuadrado || procesando}
            >
              {procesando ? "Asentando..." : "✨ Confirmar y Asentar en Libro Diario"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
