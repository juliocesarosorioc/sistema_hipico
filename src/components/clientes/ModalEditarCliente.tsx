"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { DatosPagoForm } from "@/components/clientes/DatosPagoForm";
import {
  actualizarCliente,
  listarClientes,
  type ClienteRow,
} from "@/lib/clientes";
import {
  codigosPaisUnicos,
  componerTelefono,
  desglosarTelefono,
  esBancoVzla,
  listMetodosPago,
} from "@/lib/vzla";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const numValido = (v: string): number => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
};

const modoOpts = [
  { value: "aval", label: "Con Aval" },
  { value: "libre", label: "Libre" },
  { value: "pozo", label: "Pozo" },
];

type Props = {
  cliente: ClienteRow | null;
  onClose: () => void;
  onGuardado: () => void;
};

/**
 * Modal de edición de un cliente (clon del formEditarCliente del legacy).
 * Reutiliza DatosPagoForm para el bloque dinámico según método de pago.
 */
export function ModalEditarCliente({ cliente, onClose, onGuardado }: Props) {
  const [socios, setSocios] = useState<ClienteRow[]>([]);

  const [seudonimo, setSeudonimo] = useState("");
  const [nombres, setNombres] = useState("");
  const [apellido, setApellido] = useState("");
  const [codigoPais, setCodigoPais] = useState("+58");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [cedulaRif, setCedulaRif] = useState("");
  const [aval, setAval] = useState("");
  const [devolucion, setDevolucion] = useState("");
  const [modo, setModo] = useState("aval");
  const [socio, setSocio] = useState("");
  const [mostrarS, setMostrarS] = useState(false);
  const [metodo, setMetodo] = useState("");
  const [diaCuadre, setDiaCuadre] = useState("");
  const [formaCuadre, setFormaCuadre] = useState("");
  const [tasaCuadre, setTasaCuadre] = useState("");
  const [datosPago, setDatosPago] = useState<Record<string, unknown>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    listarClientes().then((cs) => setSocios(cs.filter((c) => c.es_socio === true)));
  }, []);

  useEffect(() => {
    if (!cliente) return;
    const tel = desglosarTelefono(cliente.telefono);
    setSeudonimo(cliente.seudonimo || cliente.nombre || "");
    const apellidoC = cliente.apellido || "";
    let nombresC = cliente.nombre || "";
    if (apellidoC && String(nombresC).toUpperCase().endsWith(String(apellidoC).toUpperCase())) {
      nombresC = String(nombresC).slice(0, String(nombresC).length - apellidoC.length).trim();
    } else if (apellidoC) {
      nombresC = "";
    }
    setNombres(nombresC);
    setApellido(apellidoC);
    setCodigoPais(tel.codigo || cliente.codigo_pais || "+58");
    setTelefono(tel.numero);
    setEmail(cliente.email || "");
    setCedulaRif(cliente.cedula_rif || "");
    setAval(cliente.aval != null ? String(cliente.aval) : "");
    setDevolucion(cliente.devolucion != null ? String(cliente.devolucion) : "");
    setModo(cliente.modo_juego || (cliente.libre ? "libre" : "aval"));
    setSocio(cliente.socio_asignado || "");
    setMostrarS(Boolean(cliente.mostrar_saldo_socio));
    setMetodo(cliente.metodo_pago || "");
    setDiaCuadre(cliente.dia_cuadre || "");
    setFormaCuadre(cliente.forma_cuadre || "");
    setTasaCuadre(cliente.tasa_cuadre != null ? String(cliente.tasa_cuadre) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id]);

  if (!cliente) return null;

  const guardar = async () => {
    if (!seudonimo.trim()) return toast("El seudónimo es obligatorio para operar.", "warning");
    const nombre = [nombres, apellido].filter(Boolean).join(" ").toUpperCase() || seudonimo.toUpperCase();
    const r = await actualizarCliente(
      cliente.id,
      {
        nombre,
        seudonimo: seudonimo.toUpperCase(),
        apellido: apellido || null,
        modo_juego: modo,
        libre: modo === "libre",
        telefono: componerTelefono(codigoPais, telefono) || null,
        codigo_pais: codigoPais,
        email: email.trim() || null,
        cedula_rif: cedulaRif.trim().toUpperCase() || null,
        aval: numValido(aval),
        devolucion: numValido(devolucion),
        socio_asignado: socio || null,
        mostrar_saldo_socio: mostrarS,
        metodo_pago: metodo || null,
        dia_cuadre: diaCuadre || null,
        forma_cuadre: formaCuadre || null,
        tasa_cuadre: numValido(tasaCuadre),
        datos_pago: !metodo || !Object.keys(datosPago).length ? null : datosPago,
      },
      cliente
    );
    if (!r.ok) return toast(r.error ?? "Error al actualizar.", "error");
    toast("Cliente actualizado.", "success");
    onGuardado();
    onClose();
  };

  const inpTxt = "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white flex items-center justify-between">
          <span>
            <i className="fas fa-user-edit mr-2"></i> Editar Cliente
          </span>
          <button className="text-slate-300 hover:text-white" onClick={onClose} aria-label="Cerrar">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Seudónimo *</label>
              <input value={seudonimo} onChange={(e) => setSeudonimo(e.target.value.toUpperCase())} className={inpTxt + " font-black uppercase"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Nombres</label>
              <input value={nombres} onChange={(e) => setNombres(e.target.value.toUpperCase())} className={inpTxt + " uppercase"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Apellido</label>
              <input value={apellido} onChange={(e) => setApellido(e.target.value.toUpperCase())} className={inpTxt + " uppercase"} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Código de país</label>
              <select value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} className={inpTxt + " font-bold"}>
                {codigosPaisUnicos().map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} {p.pais}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Teléfono</label>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inpTxt + " font-mono"} placeholder="412 123 4567" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={inpTxt} type="email" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Cédula / RIF</label>
              <input value={cedulaRif} onChange={(e) => setCedulaRif(e.target.value.toUpperCase())} className={inpTxt + " font-mono uppercase"} placeholder="V-12.345.678" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Modo de juego</label>
              <select value={modo} onChange={(e) => setModo(e.target.value)} className={inpTxt + " font-bold"}>
                {modoOpts.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Socio asignado</label>
              <select value={socio} onChange={(e) => setSocio(e.target.value)} className={inpTxt + " font-bold"}>
                <option value="">— Ninguno (Directo) —</option>
                {socios.map((s) => (
                  <option key={String(s.id)} value={s.nombre ?? ""}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Aval (límite pérdida)</label>
              <input value={aval} onChange={(e) => setAval(e.target.value)} className={inpTxt + " font-mono font-bold text-right"} inputMode="decimal" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Devolución / Incentivo %</label>
              <input value={devolucion} onChange={(e) => setDevolucion(e.target.value)} className={inpTxt + " font-mono font-bold text-right text-purple-700"} inputMode="decimal" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Día de cuadre</label>
              <select value={diaCuadre} onChange={(e) => setDiaCuadre(e.target.value)} className={inpTxt + " font-bold"}>
                <option value="">Sin día</option>
                {["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Forma de cuadre</label>
              <input value={formaCuadre} onChange={(e) => setFormaCuadre(e.target.value)} className={inpTxt + " uppercase"} placeholder="ej. WhatsApp" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Tasa de cuadre (Bs)</label>
              <input value={tasaCuadre} onChange={(e) => setTasaCuadre(e.target.value)} className={inpTxt + " font-mono font-bold text-right"} inputMode="decimal" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-1">
                <input type="checkbox" checked={mostrarS} onChange={(e) => setMostrarS(e.target.checked)} className="h-4 w-4 accent-primary-600" />
                <span className="text-[10px] font-black uppercase text-slate-600">Mostrar saldo al socio</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Método de pago</label>
            <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inpTxt + " font-bold"}>
              <option value="">— Seleccione —</option>
              {listMetodosPago(true).map((m) => (
                <option key={m} value={m}>
                  {esBancoVzla(m) ? m : m}
                </option>
              ))}
            </select>
          </div>

          {metodo ? (
            <DatosPagoForm
              prefijo="editar"
              metodo={metodo}
              inicial={(cliente.datos_pago as Record<string, unknown>) as never}
              onChange={(dp) => setDatosPago(dp as unknown as Record<string, unknown>)}
            />
          ) : null}
        </div>

        <div className="px-5 py-4 bg-slate-50 border-t border-line flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Guardar
          </Button>
        </div>
        <ToastHost />
      </div>
    </div>
  );
}