"use client";

import { useEffect, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { emitirToast } from "@/shared/lib/mensajeria";
import { formatoMoneda } from "@/shared/lib/vzla";
import {
  listarMiembrosEquipo,
  guardarMiembroEquipo,
  eliminarMiembroEquipo,
  registrarPagoHonorario,
  listarRegistrosHonorarios,
  type MiembroEquipo,
  type RegistroHonorario,
} from "@/features/contabilidad/lib/honorarios-equipo";

interface Props {
  grupoId?: string | null;
}

export function TabHonorariosEquipo({ grupoId }: Props) {
  const [miembros, setMiembros] = useState<MiembroEquipo[]>([]);
  const [registros, setRegistros] = useState<RegistroHonorario[]>([]);
  const [cargando, setCargando] = useState(true);

  // Modal Nuevo / Editar Miembro
  const [modalMiembro, setModalMiembro] = useState(false);
  const [miembroEditando, setMiembroEditando] = useState<Partial<MiembroEquipo> | null>(null);

  // Modal Registrar Pago de Honorarios
  const [modalPago, setModalPago] = useState(false);
  const [miembroSeleccionado, setMiembroSeleccionado] = useState<MiembroEquipo | null>(null);
  const [montoPago, setMontoPago] = useState("");
  const [conceptoPago, setConceptoPago] = useState("");
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().slice(0, 10));
  const [estadoPago, setEstadoPago] = useState<"PAGADO" | "POR_PAGAR">("PAGADO");
  const [medioPago, setMedioPago] = useState("Pago Móvil");
  const [cuentaPagoCodigo, setCuentaPagoCodigo] = useState("1.1.02.002");
  const [bancoRef, setBancoRef] = useState("");
  const [procesandoPago, setProcesandoPago] = useState(false);

  const cargarDatos = async () => {
    setCargando(true);
    try {
      const [m, r] = await Promise.all([
        listarMiembrosEquipo(grupoId),
        listarRegistrosHonorarios(grupoId),
      ]);
      setMiembros(m);
      setRegistros(r);
    } catch {
      emitirToast("Cargados datos de colaboradores en memoria.", "info");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void cargarDatos();
  }, [grupoId]);

  const abrirNuevoMiembro = () => {
    setMiembroEditando({
      nombre_completo: "",
      cedula_rif: "",
      cargo_rol: "Operador de Taquilla",
      telefono: "",
      metodo_pago: "Pago Móvil",
      datos_pago: "",
      monto_pactado: 100,
      frecuencia_pago: "SEMANAL",
      activo: true,
      notas: "",
    });
    setModalMiembro(true);
  };

  const guardarMiembro = async () => {
    if (!miembroEditando?.nombre_completo?.trim()) {
      return emitirToast("El nombre del colaborador es obligatorio.", "warning");
    }
    const res = await guardarMiembroEquipo({
      ...miembroEditando,
      grupo_id: grupoId || null,
    });
    if (res.ok) {
      emitirToast("✅ Colaborador guardado correctamente.", "success");
      setModalMiembro(false);
      setMiembroEditando(null);
      void cargarDatos();
    } else {
      emitirToast(res.error || "Error al guardar.", "error");
    }
  };

  const eliminarMiembro = async (id: string, nombre: string) => {
    if (confirm(`¿Estás seguro de eliminar a ${nombre} del equipo?`)) {
      await eliminarMiembroEquipo(id);
      emitirToast(`Colaborador ${nombre} eliminado.`, "info");
      void cargarDatos();
    }
  };

  const abrirPago = (m: MiembroEquipo) => {
    setMiembroSeleccionado(m);
    setMontoPago(String(m.monto_pactado || ""));
    setConceptoPago(`Honorarios semanales por ${m.cargo_rol}`);
    setFechaPago(new Date().toISOString().slice(0, 10));
    setEstadoPago("PAGADO");
    setMedioPago(m.metodo_pago || "Pago Móvil");
    setBancoRef("");
    setModalPago(true);
  };

  const confirmarPago = async () => {
    if (!miembroSeleccionado) return;
    const m = parseFloat(montoPago);
    if (!m || m <= 0) return emitirToast("Indique un monto válido.", "warning");

    setProcesandoPago(true);
    try {
      const res = await registrarPagoHonorario({
        grupoId: grupoId || null,
        miembroId: miembroSeleccionado.id,
        miembroNombre: miembroSeleccionado.nombre_completo,
        fecha: fechaPago,
        concepto: conceptoPago || `Honorarios ${miembroSeleccionado.cargo_rol}`,
        monto: m,
        estado: estadoPago,
        medioPago,
        cuentaPagoCodigo: estadoPago === "PAGADO" ? cuentaPagoCodigo : undefined,
        bancoReferencia: bancoRef,
      });

      if (res.ok) {
        emitirToast(
          estadoPago === "PAGADO"
            ? `✅ Pago de $${m.toFixed(2)} registrado y asentado en Libro Diario.`
            : `📋 Obligación de honorarios por $${m.toFixed(2)} registrada en Cuentas por Pagar.`,
          "success"
        );
        setModalPago(false);
        void cargarDatos();
      } else {
        emitirToast(res.error || "Error registrando honorarios.", "error");
      }
    } finally {
      setProcesandoPago(false);
    }
  };

  const totalHonorariosPagados = registros
    .filter((r) => r.estado === "PAGADO")
    .reduce((acc, r) => acc + (r.monto || 0), 0);

  const totalHonorariosPorPagar = registros
    .filter((r) => r.estado === "POR_PAGAR")
    .reduce((acc, r) => acc + (r.monto || 0), 0);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Encabezado y Métricas */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white shadow-md">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">👥</span>
            <h2 className="text-lg font-black tracking-tight">Honorarios del Equipo de Trabajo</h2>
          </div>
          <p className="mt-1 text-xs text-indigo-200">
            Identificación de operadores y colaboradores con generación automática de asientos en partida doble.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={abrirNuevoMiembro}>
            <span className="mr-1">➕</span> Nuevo Colaborador
          </Button>
        </div>
      </div>

      {/* Tarjetas KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
            Total Colaboradores Activos
          </div>
          <div className="mt-1 text-2xl font-black text-indigo-950">
            {miembros.filter((m) => m.activo).length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Operadores, supervisores y administradores</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
            Honorarios Pagados (Gasto 6.1.03.001)
          </div>
          <div className="mt-1 text-2xl font-black text-emerald-950 font-mono">
            {formatoMoneda("USD", totalHonorariosPagados)}
          </div>
          <div className="text-[11px] text-emerald-600 mt-0.5">Desembolsados de Caja o Bancos</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">
            Honorarios por Pagar (Pasivo 2.1.06.001)
          </div>
          <div className="mt-1 text-2xl font-black text-amber-950 font-mono">
            {formatoMoneda("USD", totalHonorariosPorPagar)}
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">Pendientes de liquidar</div>
        </div>
      </div>

      {/* Lista de Miembros del Equipo */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
            Plantilla de Colaboradores
          </h3>
          <span className="text-[11px] font-bold text-slate-400">{miembros.length} registrados</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {miembros.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 hover:bg-slate-50 transition-all shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-slate-800">{m.nombre_completo}</h4>
                    <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-black uppercase bg-indigo-100 text-indigo-800">
                      {m.cargo_rol}
                    </span>
                  </div>
                  <span
                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                      m.activo ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {m.activo ? "Activo" : "Inactivo"}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1 text-xs text-slate-600">
                  {m.cedula_rif ? (
                    <div>
                      <span className="text-slate-400 font-semibold">C.I. / RIF:</span> {m.cedula_rif}
                    </div>
                  ) : null}
                  {m.telefono ? (
                    <div>
                      <span className="text-slate-400 font-semibold">Teléfono:</span> {m.telefono}
                    </div>
                  ) : null}
                  <div>
                    <span className="text-slate-400 font-semibold">Método:</span> {m.metodo_pago}{" "}
                    {m.datos_pago ? `(${m.datos_pago})` : ""}
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold">Honorario Pactado:</span>{" "}
                    <b className="text-emerald-700 font-mono">{formatoMoneda("USD", m.monto_pactado)}</b> /{" "}
                    {m.frecuencia_pago.toLowerCase()}
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-200 flex items-center justify-between gap-2">
                <Button variant="primary" size="sm" onClick={() => abrirPago(m)}>
                  💵 Pagar / Asentar
                </Button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMiembroEditando(m);
                      setModalMiembro(true);
                    }}
                    className="p-1 text-slate-500 hover:text-indigo-600 text-xs"
                    title="Editar datos"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    onClick={() => void eliminarMiembro(m.id, m.nombre_completo)}
                    className="p-1 text-slate-400 hover:text-rose-600 text-xs"
                    title="Eliminar colaborador"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Historial de Registros y Pagos */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
            Historial de Honorarios y Comprobantes Contables
          </h3>
          <span className="text-[11px] font-bold text-slate-400">{registros.length} movimientos</span>
        </div>

        {registros.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No se han registrado pagos u obligaciones de honorarios para este período.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase text-[9px] font-black">
                  <th className="py-2 px-3">Fecha</th>
                  <th className="py-2 px-3">Colaborador</th>
                  <th className="py-2 px-3">Concepto</th>
                  <th className="py-2 px-3 text-right">Monto</th>
                  <th className="py-2 px-3 text-center">Estado</th>
                  <th className="py-2 px-3">Medio de Pago</th>
                  <th className="py-2 px-3">Asiento NIIF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registros.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-mono text-slate-600">{r.fecha_registro}</td>
                    <td className="py-2 px-3 font-bold text-slate-800">{r.miembro_nombre}</td>
                    <td className="py-2 px-3 text-slate-700">{r.concepto}</td>
                    <td className="py-2 px-3 text-right font-mono font-black text-slate-900">
                      {formatoMoneda("USD", r.monto)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase ${
                          r.estado === "PAGADO"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {r.estado === "PAGADO" ? "Pagado" : "Por Pagar"}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {r.medio_pago || "Transferencia"} {r.banco_referencia ? `(#${r.banco_referencia})` : ""}
                    </td>
                    <td className="py-2 px-3 font-mono text-[10px] text-indigo-600 font-bold">
                      {r.asiento_id ? `Asiento: ${r.asiento_id.slice(0, 8)}…` : "Generado"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Crear / Editar Colaborador */}
      {modalMiembro && miembroEditando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-black text-slate-800 text-base">
                {miembroEditando.id ? "Editar Colaborador" : "Nuevo Colaborador del Equipo"}
              </h3>
              <button
                type="button"
                onClick={() => setModalMiembro(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="col-span-2 space-y-1">
                <label className="font-bold text-slate-700">Nombre Completo *</label>
                <input
                  type="text"
                  value={miembroEditando.nombre_completo || ""}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, nombre_completo: e.target.value })}
                  placeholder="Ej: CARLOS MENDOZA"
                  className="w-full rounded-xl border border-slate-300 p-2 font-bold uppercase outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">C.I. / RIF</label>
                <input
                  type="text"
                  value={miembroEditando.cedula_rif || ""}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, cedula_rif: e.target.value })}
                  placeholder="V-18452901"
                  className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Cargo / Rol *</label>
                <select
                  value={miembroEditando.cargo_rol || "Operador de Taquilla"}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, cargo_rol: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Operador de Taquilla">Operador de Taquilla</option>
                  <option value="Liquidador de Carreras">Liquidador de Carreras</option>
                  <option value="Administrador de Grupo">Administrador de Grupo</option>
                  <option value="Supervisor de Apuestas">Supervisor de Apuestas</option>
                  <option value="Soporte Técnico / Sistemas">Soporte Técnico / Sistemas</option>
                  <option value="Banquero / Tesorero">Banquero / Tesorero</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Teléfono</label>
                <input
                  type="text"
                  value={miembroEditando.telefono || ""}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, telefono: e.target.value })}
                  placeholder="+58 412 1234567"
                  className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Método de Pago</label>
                <select
                  value={miembroEditando.metodo_pago || "Pago Móvil"}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, metodo_pago: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Pago Móvil">Pago Móvil</option>
                  <option value="Transferencia Bancaria">Transferencia Bancaria</option>
                  <option value="Zelle / USDT">Zelle / USDT</option>
                  <option value="Efectivo Divisas">Efectivo Divisas</option>
                </select>
              </div>

              <div className="col-span-2 space-y-1">
                <label className="font-bold text-slate-700">Datos Bancarios / Cuenta de Pago</label>
                <input
                  type="text"
                  value={miembroEditando.datos_pago || ""}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, datos_pago: e.target.value })}
                  placeholder="Banco, Nro de cuenta, correo Zelle o billetera USDT"
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Monto Pactado (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={miembroEditando.monto_pactado ?? ""}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, monto_pactado: parseFloat(e.target.value) || 0 })}
                  placeholder="100.00"
                  className="w-full rounded-xl border border-slate-300 p-2 font-mono font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Frecuencia de Pago</label>
                <select
                  value={miembroEditando.frecuencia_pago || "SEMANAL"}
                  onChange={(e) => setMiembroEditando({ ...miembroEditando, frecuencia_pago: e.target.value as any })}
                  className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="DIARIO">Diario</option>
                  <option value="SEMANAL">Semanal (Cuadre)</option>
                  <option value="QUINCENAL">Quincenal</option>
                  <option value="MENSUAL">Mensual</option>
                  <option value="POR_CARRERA">Por Carrera / Jornada</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="outline" size="sm" onClick={() => setModalMiembro(false)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={guardarMiembro}>
                💾 Guardar Colaborador
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Registrar Pago / Obligación de Honorarios */}
      {modalPago && miembroSeleccionado ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <h3 className="font-black text-slate-800 text-base">Asentar Honorarios</h3>
                <p className="text-xs text-slate-500">{miembroSeleccionado.nombre_completo} ({miembroSeleccionado.cargo_rol})</p>
              </div>
              <button
                type="button"
                onClick={() => setModalPago(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Monto a Asentar (USD) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={montoPago}
                  onChange={(e) => setMontoPago(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2 font-mono font-black text-base text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Fecha de Registro</label>
                  <input
                    type="date"
                    value={fechaPago}
                    onChange={(e) => setFechaPago(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-2 font-semibold outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Estado Contable</label>
                  <select
                    value={estadoPago}
                    onChange={(e) => setEstadoPago(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-300 p-2 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="PAGADO">PAGADO (Desembolso Real)</option>
                    <option value="POR_PAGAR">POR PAGAR (Cuentas por Pagar)</option>
                  </select>
                </div>
              </div>

              {estadoPago === "PAGADO" ? (
                <div className="space-y-1 rounded-xl bg-slate-50 border border-slate-200 p-2.5">
                  <label className="font-bold text-slate-700">Cuenta de Salida (Haber)</label>
                  <select
                    value={cuentaPagoCodigo}
                    onChange={(e) => setCuentaPagoCodigo(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-1.5 font-semibold text-slate-800 bg-white"
                  >
                    <option value="1.1.01.001">1.1.01.001 — Caja General y Efectivo Divisas</option>
                    <option value="1.1.02.001">1.1.02.001 — Banco Pozo Principal Operativo</option>
                    <option value="1.1.02.002">1.1.02.002 — Bancos Nacionales (Pago Móvil)</option>
                    <option value="1.1.02.003">1.1.02.003 — Pasarelas Zelle / USDT</option>
                  </select>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-800 font-semibold">
                  📌 Se imputará a la cuenta de Pasivo <b>2.1.06.001 — Cuentas por Pagar Honorarios Equipo</b>.
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Concepto del Asiento</label>
                <input
                  type="text"
                  value={conceptoPago}
                  onChange={(e) => setConceptoPago(e.target.value)}
                  placeholder="Ej: Honorarios semana activa taquilla y liquidación"
                  className="w-full rounded-xl border border-slate-300 p-2 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">N° Comprobante / Referencia Bancaria</label>
                <input
                  type="text"
                  value={bancoRef}
                  onChange={(e) => setBancoRef(e.target.value)}
                  placeholder="Ej: 08492049"
                  className="w-full rounded-xl border border-slate-300 p-2 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="outline" size="sm" onClick={() => setModalPago(false)} disabled={procesandoPago}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={confirmarPago} disabled={procesandoPago}>
                {procesandoPago ? "Asentando..." : "✨ Confirmar y Asentar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
