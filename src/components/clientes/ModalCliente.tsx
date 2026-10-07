"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { DatosPagoForm } from "@/components/clientes/DatosPagoForm";
import {
  actualizarCliente,
  crearCliente,
  etiquetaModoJuego,
  listarClientes,
  MODO_JUEGO_OPCIONES,
  resolverSocio,
  valorSocioAsignado,
  type ClienteRow,
} from "@/lib/clientes";
import {
  codigosPaisUnicos,
  componerTelefono,
  desglosarTelefono,
  esBancoVzla,
  listMetodosPago,
  type DatosPago,
} from "@/lib/vzla";
import { listarGruposVenta, type GrupoVenta } from "@/lib/grupos";
import { useAuthStore } from "@/store/useAuthStore";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO"];
const FORMAS_CUADRE = ["SALDO EN CONTADO", "EFECTIVO DIRECTO", "COMPENSACIÓN AVAL", "MIXTO"];

type Props = {
  /** null = alta nueva; ClienteRow = edición. */
  cliente?: ClienteRow | null;
  onClose: () => void;
  onGuardado: () => void;
};

// ---------------------------------------------------------------------------
// Piezas de maquetación (uniformidad de campos en todas las secciones)
// ---------------------------------------------------------------------------

const inp =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const inpErr = "border-danger-400 bg-danger-50/40 focus:ring-danger-400";
const errTxt = "mt-0.5 text-[10px] font-bold text-danger-600";
const numInp = inp + " text-right font-mono font-black tabular-nums";

/** Etiqueta de campo: icono + texto en mayúsculas, con marca de obligatorio. */
function Etiqueta({
  texto,
  icono,
  tono = "text-slate-500",
  requerido,
}: {
  texto: string;
  icono?: string;
  tono?: string;
  requerido?: boolean;
}) {
  return (
    <label className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase leading-none tracking-wider text-slate-500">
      {icono ? <span className={`w-3 text-center text-[9px] leading-none ${tono}`} aria-hidden>{icono}</span> : null}
      <span className={tono}>{texto}</span>
      {requerido ? <span className="text-danger-600">*</span> : null}
    </label>
  );
}

/** Campo: etiqueta + control + error, con altura de línea consistente. */
function Campo({
  texto,
  icono,
  tono,
  requerido,
  error,
  children,
  ancho,
}: {
  texto: string;
  icono?: string;
  tono?: string;
  requerido?: boolean;
  error?: string;
  children: React.ReactNode;
  ancho?: string;
}) {
  return (
    <div className={ancho ?? ""}>
      <Etiqueta texto={texto} icono={icono} tono={tono} requerido={requerido} />
      {children}
      {error ? <p className={errTxt}>{error}</p> : null}
    </div>
  );
}

/** Interruptor compacto para los booleanos (filas de banderas). */
function Interruptor({
  activo,
  onChange,
  icono,
  texto,
  tono = "text-slate-600",
  disabled,
}: {
  activo: boolean;
  onChange: (v: boolean) => void;
  icono: string;
  texto: string;
  tono?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!activo)}
      aria-pressed={activo}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition ${
        disabled ? "cursor-not-allowed border-line bg-slate-100 opacity-50" : "cursor-pointer hover:bg-slate-50"
      } ${activo ? "border-primary-300 bg-primary-50/60" : "border-line bg-surface"}`}
    >
      <span className={`w-3 text-center text-[10px] leading-none ${activo ? "text-primary-600" : "text-slate-300"}`} aria-hidden>{icono}</span>
      <span className="flex-1 text-[10px] font-black uppercase leading-tight tracking-wider text-slate-600">{texto}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          activo ? "bg-primary-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
            activo ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** Bloque de sección: icono, título y campos en rejilla uniforme. */
function Seccion({
  titulo,
  icono,
  tono,
  children,
}: {
  titulo: string;
  icono: string;
  tono: { chip: string; texto: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-line bg-slate-50/80 px-3 py-1.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${tono.chip}`}>
          <span className={`text-[10px] leading-none ${tono.texto}`} aria-hidden>{icono}</span>
        </span>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600">{titulo}</h3>
      </header>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-3 sm:grid-cols-3">{children}</div>
    </section>
  );
}

const TONO = {
  primary: { chip: "bg-primary-100", texto: "text-primary-600" },
  amber: { chip: "bg-amber-100", texto: "text-amber-600" },
  purple: { chip: "bg-purple-100", texto: "text-purple-600" },
  emerald: { chip: "bg-emerald-100", texto: "text-emerald-600" },
  cyan: { chip: "bg-cyan-100", texto: "text-cyan-600" },
} as const;

/** Insignia de estado para la cabecera. */
function Insignia({ icono, texto, tono }: { icono: string; texto: string; tono: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${tono}`}>
      <span className="text-[8px] leading-none" aria-hidden>{icono}</span>
      {texto}
    </span>
  );
}

/**
 * Modal de Gestión de Clientes — un SOLO formulario para alta y edición.
 *
 * Antes había dos formularios distintos (`ModalNuevoCliente` dentro de
 * ClientesModule y `ModalEditarCliente`), y ya divergían: el de alta validaba
 * en línea y el de edición no; el de alta ligaba "mostrar saldo al socio" a
 * "es socio" y el de edición no; y cada uno tenía su propio grid, así que un
 * campo podía estar en una columna distinta según el modo. Aquí hay un único
 * formulario con secciones, iconos y rejilla uniforme, y las validaciones se
 * aplican igual en alta y en edición.
 */
export function ModalCliente({ cliente = null, onClose, onGuardado }: Props) {
  const esEdicion = cliente != null;
  const [clientes, setClientes] = useState<ClienteRow[]>([]);

  const [seudonimo, setSeudonimo] = useState("");
  const [nombres, setNombres] = useState("");
  const [apellido, setApellido] = useState("");
  const [codigoPais, setCodigoPais] = useState("+58");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [cedulaRif, setCedulaRif] = useState("");
  const [direccion, setDireccion] = useState("");
  const [comision, setComision] = useState("");
  const [permiteCruces, setPermiteCruces] = useState(true);
  const [modo, setModo] = useState("aval");
  const [aval, setAval] = useState("");
  const [devolucion, setDevolucion] = useState("");
  const [socio, setSocio] = useState("");
  const [mostrarS, setMostrarS] = useState(false);
  const [esSocio, setEsSocio] = useState(false);
  const [metodo, setMetodo] = useState("");
  const [datosPago, setDatosPago] = useState<Record<string, unknown>>({});
  const [diaCuadre, setDiaCuadre] = useState("");
  const [formaCuadre, setFormaCuadre] = useState("");
  const [tasaCuadre, setTasaCuadre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [grupoId, setGrupoId] = useState("");

  // SOLO el usuario principal. Meter a un cliente en un grupo cambia el precio de
  // todas sus jugadas, así que el campo no se abre a quien solo pueda crear
  // clientes. Se lee del store para que aparezca y desaparezca con la sesión y el
  // modal no quede con la decisión de un usuario anterior.
  const puedeAsignarGrupo = useAuthStore((s) => s.esPrincipal);
  const modoLibre = modo === "libre";

  useEffect(() => {
    if (!cliente) return;
    const tel = desglosarTelefono(cliente.telefono);
    setSeudonimo(cliente.seudonimo || cliente.nombre || "");
    const apellidoC = cliente.apellido || "";
    // Se separa el apellido del nombre completo tolerando tildes, mayúsculas y
    // espacios extra. Antes, si la comparación fallaba se vaciaba `nombres` y al
    // guardar se sobrescribía `nombre` con el apellido, perdiendo el nombre real.
    let nombresC = cliente.nombre || "";
    if (apellidoC) {
      const sinTilde = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
      const nombreNorm = sinTilde(nombresC);
      const apellidoNorm = sinTilde(apellidoC);
      if (nombreNorm.endsWith(" " + apellidoNorm) || nombreNorm === apellidoNorm) {
        nombresC = nombresC.slice(0, nombresC.length - apellidoC.length).trim();
      } else {
        // No coincide: se conserva el nombre completo para no perderlo al guardar.
        nombresC = nombresC.trim();
      }
    }
    setNombres(nombresC);
    setApellido(apellidoC);
    setCodigoPais(tel.codigo || cliente.codigo_pais || "+58");
    setTelefono(tel.numero);
    setEmail(cliente.email || "");
    setCedulaRif(cliente.cedula_rif || "");
    setDireccion(cliente.direccion || "");
    setComision(cliente.comision != null ? String(cliente.comision) : "");
    setEsSocio(cliente.es_socio === true);
    setAval(cliente.aval != null ? String(cliente.aval) : "");
    setDevolucion(cliente.devolucion != null ? String(cliente.devolucion) : "");
    setModo(cliente.modo_juego || (cliente.libre ? "libre" : "aval"));
    setMostrarS(Boolean(cliente.mostrar_saldo_socio));
    setPermiteCruces(cliente.permite_cruces !== false);
    setMetodo(cliente.metodo_pago || "");
    setDiaCuadre(cliente.dia_cuadre || "");
    setFormaCuadre(cliente.forma_cuadre || "");
    setTasaCuadre(cliente.tasa_cuadre != null ? String(cliente.tasa_cuadre) : "");
    setGrupoId(
      puedeAsignarGrupo && cliente.grupo_id ? String(cliente.grupo_id) : ""
    );
    setErrores({});
  }, [cliente?.id, puedeAsignarGrupo]);

  // La lista de socios se carga una vez; el cliente puede llegar antes.
  useEffect(() => {
    void listarClientes().then(setClientes);
    // Los grupos solo se piden si el campo se va a mostrar: son datos de
    // comerciales que un operador no tiene por qué tener en memoria.
    if (puedeAsignarGrupo) void listarGruposVenta().then(setGrupos);
  }, [puedeAsignarGrupo]);

  const socios = useMemo(() => clientes.filter((c) => c.es_socio === true), [clientes]);

  // `socio_asignado` puede venir como id (canónico) o como nombre/pseudónimo
  // (legacy). Se resuelve aparte porque `socios` llega después del cliente: si se
  // resolviera en el efecto anterior, la lista vacía devolvería null y el select
  // quedaría en "Ninguno", borrando la relación al guardar.
  useEffect(() => {
    if (!cliente) return;
    setSocio(valorSocioAsignado(resolverSocio(cliente.socio_asignado, socios)) ?? "");
  }, [cliente?.id, socios]);

  const limpiar = (campo: string) => setErrores((x) => (x[campo] ? { ...x, [campo]: "" } : x));

  /** Validación en línea, igual en alta y edición (antes solo el alta validaba). */
  const validar = () => {
    const e: Record<string, string> = {};
    const nick = seudonimo.trim();
    if (!nick) e.seudonimo = "El seudónimo es obligatorio.";
    else if (
      clientes.some(
        (c) =>
          String(c.seudonimo || c.nombre || "").trim().toUpperCase() === nick.toUpperCase() &&
          String(c.id) !== String(cliente?.id ?? "")
      )
    )
      e.seudonimo = "Ya existe un cliente con ese seudónimo.";
    if (telefono.trim() && !/^[\d\s()+-]+$/.test(telefono.trim())) e.telefono = "Teléfono inválido (solo dígitos y + - ( )).";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) e.email = "Email inválido.";
    for (const [k, v, max] of [
      ["devolucion", devolucion, 100],
      ["comision", comision, 100],
    ] as const) {
      if (v.trim() && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > max)) e[k] = `Debe estar entre 0 y ${max}.`;
    }
    if (aval.trim() && (Number.isNaN(Number(aval)) || Number(aval) < 0)) e.aval = "No puede ser negativo.";
    if (tasaCuadre.trim() && Number.isNaN(Number(tasaCuadre))) e.tasaCuadre = "Tasa inválida.";
    if (formaCuadre.trim() && !FORMAS_CUADRE.includes(formaCuadre.trim().toUpperCase()))
      e.formaCuadre = "Forma de cuadre no reconocida.";
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const guardar = async () => {
    if (!validar()) {
      toast("Revise los campos marcados en rojo.", "warning");
      return;
    }
    const nombre = [nombres, apellido].filter(Boolean).join(" ").toUpperCase() || seudonimo.trim().toUpperCase();
    const comun = {
      nombre,
      seudonimo: seudonimo.trim().toUpperCase(),
      apellido: apellido || null,
      modo_juego: modo,
      libre: modo === "libre",
      telefono: componerTelefono(codigoPais, telefono) || null,
      codigo_pais: codigoPais,
      email: email.trim() || null,
      cedula_rif: cedulaRif.trim().toUpperCase() || null,
      direccion: direccion.trim() || null,
      socio_asignado: socio || null,
      metodo_pago: metodo || null,
      dia_cuadre: diaCuadre || null,
      forma_cuadre: formaCuadre || null,
      datos_pago: !metodo || !Object.keys(datosPago).length ? null : (datosPago as unknown as DatosPago),
    };
    setGuardando(true);
// Se respetan las dos formas que ya usaba cada rama del CRUD: el alta
    // distingue "vacío" (null) de 0, la edición escribe el número tal cual.
    //
    // `grupo_id` NO viaja si quien guarda no puede asignarlo. Ocultar el campo
    // alcanza solo para la pantalla: el estado arrancaba vacío, así que mandar
    // `null` sacaba al cliente de su grupo cada vez que un operador guardaba
    // cualquier otro dato. Para eso el campo se omite del parche y no se manda
    // como null. En el alta no hay grupo previo que preservar, así que va null.
    const extra = puedeAsignarGrupo
      ? { grupo_id: grupoId || null }
      : esEdicion
        ? {}
        : { grupo_id: null };
    const r = esEdicion
      ? await actualizarCliente(
          cliente!.id,
          {
            ...comun,
            ...extra,
            es_socio: esSocio,
            mostrar_saldo_socio: mostrarS,
            permite_cruces: permiteCruces,
            comision: num(comision),
            aval: num(aval),
            devolucion: num(devolucion),
            tasa_cuadre: num(tasaCuadre),
          },
          cliente
        )
      : await crearCliente({
          ...comun,
          ...extra,
          es_socio: esSocio || null,
          mostrar_saldo_socio: mostrarS || null,
          permite_cruces: permiteCruces,
          comision: num(comision) || null,
          aval: num(aval) || null,
          devolucion: num(devolucion),
          tasa_cuadre: num(tasaCuadre) || null,
        });
    setGuardando(false);
    if (!r.ok) return toast(r.error ?? (esEdicion ? "Error al actualizar." : "Error al crear."), "error");
    toast(esEdicion ? `Cliente "${nombre}" actualizado.` : `Cliente "${nombre}" creado.`, "success");
    onGuardado();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-4 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 bg-slate-800 px-4 py-2.5 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm leading-none text-primary-400" aria-hidden>{esEdicion ? "\u{1F9D1}\u200D\u{1F4BC}" : "\u2795"}</span>
            <span className="text-xs font-black uppercase tracking-wider">{esEdicion ? "Editar Cliente" : "Nuevo Cliente"}</span>
            {esEdicion ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <Insignia icono="🧪" texto={cliente.seudonimo || cliente.nombre || "—"} tono="bg-white/10 text-white" />
                <Insignia icono="🎲" texto={etiquetaModoJuego(cliente.modo_juego)} tono="bg-amber-400/20 text-amber-200" />
                {cliente.es_socio ? <Insignia icono="👑" texto="Socio" tono="bg-amber-400/20 text-amber-200" /> : null}
                {cliente.grupo_id ? <Insignia icono="👥" texto="En grupo" tono="bg-indigo-400/20 text-indigo-200" /> : null}
                {cliente.portal_habilitado ? <Insignia icono="🔑" texto="Portal" tono="bg-cyan-400/20 text-cyan-200" /> : null}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 text-slate-300 transition hover:text-white"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        <form
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            void guardar();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Cuerpo: secciones en rejilla uniforme */}
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            <Seccion titulo="Identidad" icono="🧪" tono={TONO.primary}>
              <Campo texto="Seudónimo" icono="👤" requerido tono="text-primary-600" error={errores.seudonimo}>
                <input
                  value={seudonimo}
                  onChange={(e) => {
                    setSeudonimo(e.target.value.toUpperCase());
                    limpiar("seudonimo");
                  }}
                  className={inp + " font-black uppercase" + (errores.seudonimo ? " " + inpErr : "")}
                  autoFocus
                  maxLength={20}
                  placeholder="PEPE01"
                  aria-invalid={!!errores.seudonimo}
                />
              </Campo>
              <Campo texto="Nombres" icono="✍️">
                <input
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value.toUpperCase())}
                  className={inp + " uppercase"}
                  placeholder="JUAN CARLOS"
                />
              </Campo>
              <Campo texto="Apellido" icono="✍️">
                <input
                  value={apellido}
                  onChange={(e) => setApellido(e.target.value.toUpperCase())}
                  className={inp + " uppercase"}
                  placeholder="PEREZ"
                />
              </Campo>
              <Campo texto="Cédula / RIF" icono="🧪">
                <input
                  value={cedulaRif}
                  onChange={(e) => setCedulaRif(e.target.value.toUpperCase())}
                  className={inp + " font-mono uppercase"}
                  placeholder="V-12.345.678"
                />
              </Campo>
              <Campo texto="País" icono="🌐">
                <select value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} className={inp + " font-bold"}>
                  {codigosPaisUnicos().map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} {p.pais}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo texto="Teléfono (WhatsApp)" icono="📞" error={errores.telefono}>
                <input
                  value={telefono}
                  onChange={(e) => {
                    setTelefono(e.target.value);
                    limpiar("telefono");
                  }}
                  className={inp + " font-mono" + (errores.telefono ? " " + inpErr : "")}
                  placeholder="412 123 4567"
                  inputMode="tel"
                  aria-invalid={!!errores.telefono}
                />
              </Campo>
              <Campo texto="Email" icono="✉️" error={errores.email} ancho="col-span-2">
                <input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    limpiar("email");
                  }}
                  className={inp + (errores.email ? " " + inpErr : "")}
                  type="email"
                  placeholder="cliente@correo.com"
                  aria-invalid={!!errores.email}
                />
              </Campo>
              <Campo texto="Dirección" icono="📍">
                <input
                  value={direccion}
                  onChange={(e) => setDireccion(e.target.value)}
                  className={inp + " uppercase"}
                  placeholder="Calle, número, ciudad"
                />
              </Campo>
            </Seccion>

            <Seccion titulo="Reglas de juego y cuenta" icono="🎲" tono={TONO.amber}>
              <Campo texto="Modo de juego" icono="🎲" tono="text-amber-600">
                <select value={modo} onChange={(e) => setModo(e.target.value)} className={inp + " font-bold"}>
                  {MODO_JUEGO_OPCIONES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                texto="Aval (límite pérdida)"
                icono="🛡️"
                tono="text-amber-600"
                error={errores.aval}
              >
                <input
                  value={aval}
                  onChange={(e) => {
                    setAval(e.target.value);
                    limpiar("aval");
                  }}
                  className={numInp + " text-amber-700" + (errores.aval ? " " + inpErr : "")}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={modoLibre}
                  title={modoLibre ? "En modo Libre el aval no aplica." : "USD"}
                  aria-invalid={!!errores.aval}
                />
              </Campo>
              <Campo
                texto="Devolución / Incentivo %"
                icono="％"
                tono="text-purple-600"
                error={errores.devolucion}
              >
                <input
                  value={devolucion}
                  onChange={(e) => {
                    setDevolucion(e.target.value);
                    limpiar("devolucion");
                  }}
                  className={numInp + " text-purple-700" + (errores.devolucion ? " " + inpErr : "")}
                  inputMode="decimal"
                  placeholder="0"
                  aria-invalid={!!errores.devolucion}
                />
              </Campo>
              <Campo texto="Socio / Agencia" icono="👔">
                <select value={socio} onChange={(e) => setSocio(e.target.value)} className={inp + " font-bold"}>
                  <option value="">— Directo —</option>
                  {socios.map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>
                      {s.seudonimo || s.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo texto="Comisión propia %" icono="🤲" tono="text-emerald-600" error={errores.comision}>
                <input
                  value={comision}
                  onChange={(e) => {
                    setComision(e.target.value);
                    limpiar("comision");
                  }}
                  className={numInp + " text-emerald-700" + (errores.comision ? " " + inpErr : "")}
                  inputMode="decimal"
                  placeholder="usa la del grupo"
                  aria-invalid={!!errores.comision}
                />
              </Campo>
              <div className="grid grid-cols-1 gap-1.5 self-end">
                <Interruptor
                  activo={esSocio}
                  onChange={(v) => {
                    setEsSocio(v);
                    if (!v) setMostrarS(false);
                  }}
                  icono="👑"
                  texto="Es socio"
                />
                <Interruptor
                  activo={mostrarS}
                  onChange={setMostrarS}
                  icono="👁️"
                  texto="Ver saldo en portal"
                  disabled={!esSocio}
                />
                <Interruptor
                  activo={permiteCruces}
                  onChange={setPermiteCruces}
                  icono="↪️"
                  texto="Permite cruces"
                />
              </div>
            </Seccion>

            <Seccion titulo="Cuadre semanal" icono="📅" tono={TONO.emerald}>
              <Campo texto="Día que se cuadra" icono="📅">
                <select value={diaCuadre} onChange={(e) => setDiaCuadre(e.target.value)} className={inp + " font-bold"}>
                  <option value="">— Sin día —</option>
                  {DIAS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </Campo>
              {/* El grupo cambia el precio de todas las jugadas del cliente: solo el
                  usuario principal ve el campo. Quien no lo tiene no lo
                  necesita para trabajar, y verlo lo haría dudar de si puede. */}
              {puedeAsignarGrupo ? (
                <Campo texto="Grupo" icono="👥">
                  <select value={grupoId} onChange={(e)=>setGrupoId(e.target.value)} className={inp + " font-bold"}>
                    <option value="">— Sin grupo —</option>
                    {grupos.map((g:any)=>(
                      <option key={String(g.id)} value={String(g.id)}>{String(g.nombre||g.id)}</option>
                    ))}
                  </select>
                </Campo>
              ) : null}
              
              <Campo texto="Forma de cuadre" icono="🤝" error={errores.formaCuadre}>
                <select
                  value={formaCuadre}
                  onChange={(e) => {
                    setFormaCuadre(e.target.value.toUpperCase());
                    limpiar("formaCuadre");
                  }}
                  className={inp + " font-bold" + (errores.formaCuadre ? " " + inpErr : "")}
                >
                  <option value="">— Seleccione —</option>
                  {FORMAS_CUADRE.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo texto="Tasa (Bs/$)" icono="💸" error={errores.tasaCuadre}>
                <input
                  value={tasaCuadre}
                  onChange={(e) => {
                    setTasaCuadre(e.target.value);
                    limpiar("tasaCuadre");
                  }}
                  className={numInp + (errores.tasaCuadre ? " " + inpErr : "")}
                  inputMode="decimal"
                  placeholder="0"
                  aria-invalid={!!errores.tasaCuadre}
                />
              </Campo>
            </Seccion>

            <Seccion titulo="Cobro y pago" icono="💳" tono={TONO.cyan}>
              <Campo texto="Método de pago" icono="👛" ancho="col-span-2 sm:col-span-3">
                <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inp + " font-bold"}>
                  <option value="">— Sin método —</option>
                  {listMetodosPago(true).map((m) => (
                    <option key={m} value={m}>
                      {esBancoVzla(m) ? m : m}
                    </option>
                  ))}
                </select>
              </Campo>
              {metodo ? (
                <div className="col-span-2 sm:col-span-3">
                  <DatosPagoForm
                    prefijo={esEdicion ? "editar" : "nuevo"}
                    metodo={metodo}
                    inicial={esEdicion ? ((cliente!.datos_pago as Record<string, unknown>) as never) : undefined}
                    onChange={(dp) => setDatosPago(dp as unknown as Record<string, unknown>)}
                  />
                </div>
              ) : null}
            </Seccion>
          </div>

          {/* Pie fijo */}
          <div className="flex items-center justify-between gap-2 border-t border-line bg-white px-4 py-2.5">
            <span className="hidden items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:flex">
              <span aria-hidden>⌨️</span> Enter para guardar
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" type="button" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="default" size="sm" type="submit" disabled={guardando}>
                {guardando ? <span className="mr-1" aria-hidden>⏳</span> : <span className="mr-1" aria-hidden>💾</span>}
                {esEdicion ? "Guardar" : "Crear"}
              </Button>
            </div>
          </div>
        </form>
      </div>
      <ToastHost />
    </div>
  );
}