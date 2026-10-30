"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import {
  listarOperadoresDeGrupo,
  guardarOperadorDeGrupo,
  desvincularOperadorDeGrupo,
  alternarEstadoOperador,
  generarMensajeWhatsappOperador,
  type OperadorGrupo,
} from "@/features/grupos/lib/operadores-grupo";
import { codigosPaisUnicos, componerTelefono, desglosarTelefono } from "@/shared/lib/vzla";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { estaBorrado, type Hipodromo } from "@/features/hipodromos/lib/tipos";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";

type Props = {
  grupoId: string | number;
  grupoNombre: string;
  onActualizado?: () => void;
};

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }
};

export function PestanaOperadoresGrupo({ grupoId, grupoNombre, onActualizado }: Props) {
  const [operadores, setOperadores] = useState<OperadorGrupo[]>([]);
  const [hipodromos, setHipodromos] = useState<Hipodromo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Formulario de creación / edición
  const [modoForm, setModoForm] = useState<"crear" | "editar" | null>(null);
  const [formUsuario, setFormUsuario] = useState("");
  const [formNombre, setFormNombre] = useState("");
  const [formClave, setFormClave] = useState("");
  const [formCodigoPais, setFormCodigoPais] = useState("+58");
  const [formTelefono, setFormTelefono] = useState("");
  const [formActivo, setFormActivo] = useState(true);
  const [formHipodromos, setFormHipodromos] = useState<Set<string>>(new Set());
  const [todosHipodromos, setTodosHipodromos] = useState(true);

  // Visibilidad de contraseñas en la tabla
  const [visibles, setVisibles] = useState<Record<string, boolean>>({});

  const refrescar = useCallback(async () => {
    setCargando(true);
    try {
      const [ops, hips] = await Promise.all([
        listarOperadoresDeGrupo(grupoId, grupoNombre),
        listarHipodromos(),
      ]);
      setOperadores(ops);
      setHipodromos(hips.data.filter((h) => !estaBorrado(h)));
    } catch (e) {
      console.error("Error al refrescar operadores:", e);
    } finally {
      setCargando(false);
    }
  }, [grupoId, grupoNombre]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const toggleVisible = (id: string) => {
    setVisibles((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const abrirCrear = () => {
    setModoForm("crear");
    setFormUsuario("");
    setFormNombre("");
    setFormCodigoPais("+58");
    setFormTelefono("");
    // Generar contraseña sugerida de 6 dígitos
    const randomPass = "OP" + Math.floor(1000 + Math.random() * 9000);
    setFormClave(randomPass);
    setFormActivo(true);
    setTodosHipodromos(true);
    setFormHipodromos(new Set());
  };

  const abrirEditar = (op: OperadorGrupo) => {
    setModoForm("editar");
    setFormUsuario(op.id);
    setFormNombre(op.nombre || op.id);
    setFormClave(op.clave || "");
    const des = desglosarTelefono(op.telefono);
    setFormCodigoPais(op.codigoPais || des.codigo || "+58");
    setFormTelefono(des.numero);
    setFormActivo(op.activo);
    if (!op.hipodromos || op.hipodromos.length === 0) {
      setTodosHipodromos(true);
      setFormHipodromos(new Set());
    } else {
      setTodosHipodromos(false);
      setFormHipodromos(new Set(op.hipodromos.map((h) => h.toUpperCase())));
    }
  };

  const cancelarForm = () => {
    setModoForm(null);
  };

  const alternarHipodromo = (nombre: string) => {
    const n = nombre.toUpperCase();
    setFormHipodromos((prev) => {
      const copy = new Set(prev);
      if (copy.has(n)) copy.delete(n);
      else copy.add(n);
      return copy;
    });
  };

  const generarClaveAleatoria = () => {
    const pass = "OP" + Math.floor(1000 + Math.random() * 9000);
    setFormClave(pass);
  };

  const guardarOperador = async () => {
    const u = formUsuario.trim().toLowerCase();
    if (!u) {
      toast("El operador necesita un nombre de usuario de acceso.", "warning");
      return;
    }
    if (u.length < 3) {
      toast("El nombre de usuario debe tener al menos 3 caracteres.", "warning");
      return;
    }

    setGuardando(true);
    const hipos = todosHipodromos ? [] : Array.from(formHipodromos);
    const tlfCompleto = formTelefono.trim()
      ? componerTelefono(formCodigoPais, formTelefono.trim())
      : "";

    const res = await guardarOperadorDeGrupo({
      grupoId,
      grupoNombre,
      usuario: u,
      nombre: formNombre.trim() || u,
      clave: formClave.trim(),
      telefono: tlfCompleto,
      codigoPais: formCodigoPais,
      activo: formActivo,
      hipodromos: hipos,
    });

    setGuardando(false);

    if (!res.ok) {
      toast(res.error || "No se pudo guardar el operador.", "error");
      return;
    }

    toast(
      modoForm === "crear"
        ? `✅ Operador "${u}" creado y asignado al grupo ${grupoNombre}.`
        : `✅ Operador "${u}" actualizado con éxito.`,
      "success"
    );

    setModoForm(null);
    void refrescar();
    onActualizado?.();
  };

  const handleToggleActivo = async (op: OperadorGrupo) => {
    const nuevo = !op.activo;
    const res = await alternarEstadoOperador(op.id, nuevo);
    if (res.ok) {
      toast(`Operador ${op.id} ${nuevo ? "activado" : "desactivado"}.`, "info");
      void refrescar();
    } else {
      toast(res.error || "No se pudo cambiar el estado.", "error");
    }
  };

  const handleDesvincular = async (op: OperadorGrupo) => {
    if (!confirm(`¿Estás seguro de desvincular al operador "${op.nombre || op.id}" de este grupo?`)) {
      return;
    }
    const res = await desvincularOperadorDeGrupo(op.id);
    if (res.ok) {
      toast(`Operador "${op.id}" desvinculado del grupo.`, "success");
      void refrescar();
      onActualizado?.();
    } else {
      toast(res.error || "No se pudo desvincular.", "error");
    }
  };

  const copiarMensajeWhatsapp = (op: OperadorGrupo) => {
    const texto = generarMensajeWhatsappOperador({
      grupoNombre,
      usuario: op.id,
      clave: op.clave || "",
      nombre: op.nombre,
      telefono: op.telefono,
    });

    if (navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(() => {
        toast("📋 Datos de acceso copiados. Pégalos en WhatsApp para tu operador.", "success");
      });
    } else {
      prompt("Copia el texto para enviarlo por WhatsApp:", texto);
    }
  };

  return (
    <div className="space-y-4">
      {/* BANNER EXPLICATIVO */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-sky-50 to-white p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="text-2xl leading-none">📱</span>
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950">
                Operadores de Taquilla Móvil y Celular
              </h4>
              <p className="text-[11px] text-indigo-800 leading-snug">
                Asigna uno o varios operadores a <b>{grupoNombre}</b>. Cada operador ingresa desde su teléfono móvil con su
                <b> Nombre de Usuario</b> y <b>Contraseña</b> para vender y reportar exclusivamente para este grupo.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={abrirCrear}
            className="bg-indigo-600 hover:bg-indigo-500 font-black text-xs text-white shadow-sm flex items-center gap-1.5"
          >
            <span>➕</span> Asignar Operador
          </Button>
        </div>
      </div>

      {/* FORMULARIO DE CREAR / EDITAR OPERADOR */}
      {modoForm && (
        <Card className="border-2 border-indigo-400 bg-white p-4 shadow-md rounded-xl space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h5 className="text-xs font-black uppercase tracking-wide text-slate-800 flex items-center gap-1.5">
              <span>{modoForm === "crear" ? "➕ Asignar Nuevo Operador" : "✏️ Editar Operador"}</span>
              <span className="text-[10px] text-slate-400 font-normal">para {grupoNombre}</span>
            </h5>
            <button
              type="button"
              onClick={cancelarForm}
              className="text-slate-400 hover:text-slate-700 text-xs font-bold"
            >
              ✕ Cancelar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Nombre de Usuario */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                Nombre de Usuario (Acceso Celular) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                disabled={modoForm === "editar"}
                value={formUsuario}
                onChange={(e) => setFormUsuario(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                placeholder="Ej: taquilla1, carlos_movil, 04141234567"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              />
              <p className="mt-0.5 text-[9.5px] text-slate-400">
                Identificador único con el que inicia sesión en su celular.
              </p>
            </div>

            {/* Nombre del Operador */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                Nombre / Alias del Operador
              </label>
              <input
                type="text"
                value={formNombre}
                onChange={(e) => setFormNombre(e.target.value)}
                placeholder="Ej: Carlos Gómez (Taquilla Sur)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-0.5 text-[9.5px] text-slate-400">
                Nombre de la persona o identificación de la taquilla.
              </p>
            </div>

            {/* Contraseña */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                  Contraseña de Acceso <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={generarClaveAleatoria}
                  className="text-[9.5px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  🎲 Generar Clave
                </button>
              </div>
              <input
                type="text"
                value={formClave}
                onChange={(e) => setFormClave(e.target.value)}
                placeholder="Contraseña del operador"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono font-bold text-indigo-700 bg-indigo-50/30 focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-0.5 text-[9.5px] text-slate-400">
                Clave con la que ingresará al portal de venta en su teléfono.
              </p>
            </div>

            {/* Número de Teléfono Celular con Código de País */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                Teléfono Celular (con código de país)
              </label>
              <div className="flex gap-1.5">
                <select
                  value={formCodigoPais}
                  onChange={(e) => setFormCodigoPais(e.target.value)}
                  className="w-32 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-800 bg-white focus:border-indigo-500 focus:outline-none"
                >
                  {codigosPaisUnicos().map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} ({p.pais})
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={formTelefono}
                  onChange={(e) => setFormTelefono(e.target.value.replace(/[^\d\s-]/g, ""))}
                  placeholder="Ej: 4149327337"
                  className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <p className="mt-0.5 text-[9.5px] text-slate-400">
                Permite enviar credenciales directo por WhatsApp e iniciar sesión con el número.
              </p>
            </div>

            {/* Estado Activo */}
            <div className="flex flex-col justify-center">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-600 mb-1">
                Estado del Operador
              </label>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={formActivo}
                  onChange={(e) => setFormActivo(e.target.checked)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
                <span className="text-xs font-bold text-slate-800">
                  {formActivo ? "🟢 Habilitado para operar" : "🔴 Acceso bloqueado"}
                </span>
              </label>
            </div>
          </div>

          {/* HIPÓDROMOS ASIGNADOS */}
          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                🏇 Hipódromos Autorizados
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={todosHipodromos}
                  onChange={(e) => {
                    setTodosHipodromos(e.target.checked);
                    if (e.target.checked) setFormHipodromos(new Set());
                  }}
                  className="rounded accent-indigo-600"
                />
                <span className="font-bold text-slate-700 text-[11px]">Todos los Hipódromos</span>
              </label>
            </div>

            {!todosHipodromos && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
                {hipodromos.map((h) => {
                  const nombreH = (h.nombre || "").toUpperCase();
                  const seleccionado = formHipodromos.has(nombreH);
                  return (
                    <button
                      key={String(h.id)}
                      type="button"
                      onClick={() => alternarHipodromo(nombreH)}
                      className={`px-2.5 py-1 rounded-md text-[10.5px] font-bold transition-all ${
                        seleccionado
                          ? "bg-indigo-600 text-white shadow-sm scale-105"
                          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {seleccionado ? "✓ " : ""}
                      {nombreHipodromoParaMostrar(nombreH)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* BOTONES DEL FORMULARIO */}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button size="sm" variant="outline" onClick={cancelarForm}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={guardando}
              onClick={() => void guardarOperador()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs"
            >
              {guardando ? "⏳ Guardando…" : "💾 Guardar Operador"}
            </Button>
          </div>
        </Card>
      )}

      {/* LISTADO DE OPERADORES ASIGNADOS */}
      {cargando ? (
        <div className="py-8 text-center text-xs text-slate-400 font-bold">
          Cargando operadores de {grupoNombre}…
        </div>
      ) : operadores.length === 0 ? (
        <EmptyState
          titulo="Sin operadores asignados"
          descripcion={`Este grupo aún no tiene operadores de taquilla móvil registrados. Haz clic en "Asignar Operador" para crear un usuario de acceso celular y contraseña.`}
          accion={
            <Button size="sm" onClick={abrirCrear} className="bg-indigo-600 text-white font-bold text-xs">
              ➕ Asignar Primer Operador
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
            <span>{operadores.length} operador{operadores.length === 1 ? "" : "es"} configurado{operadores.length === 1 ? "" : "s"}</span>
            <span className="text-[10px] text-slate-400">Clic en 📋 para enviar credenciales por WhatsApp</span>
          </div>

          <div className="divide-y divide-slate-100 rounded-xl border border-line bg-white overflow-hidden shadow-sm">
            {operadores.map((op) => {
              const claveVisible = visibles[op.id] === true;
              const tieneHipos = op.hipodromos && op.hipodromos.length > 0;

              return (
                <div
                  key={op.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 hover:bg-slate-50/60 transition-colors"
                >
                  {/* IDENTIDAD DEL OPERADOR */}
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${
                        op.activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      📱
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-black text-indigo-900 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                          {op.id}
                        </span>
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            op.activo ? "bg-emerald-500" : "bg-rose-400"
                          }`}
                          title={op.activo ? "Habilitado" : "Bloqueado"}
                        />
                      </div>
                      <div className="text-xs font-bold text-slate-700">
                        {op.nombre}
                      </div>
                      {op.telefono ? (
                        <div className="text-[10.5px] font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                          <span>📞</span>
                          <span className="font-mono text-slate-700 font-bold">{op.telefono}</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-400 italic mt-0.5">Sin teléfono registrado</div>
                      )}
                    </div>
                  </div>

                  {/* CONTRASEÑA */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Clave:
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 min-w-[70px] text-center">
                      {claveVisible ? op.clave || "(sin clave)" : "••••••••"}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleVisible(op.id)}
                      title={claveVisible ? "Ocultar contraseña" : "Ver contraseña"}
                      className="text-xs text-slate-500 hover:text-slate-800 p-1"
                    >
                      {claveVisible ? "🙈" : "👁️"}
                    </button>
                  </div>

                  {/* HIPÓDROMOS */}
                  <div className="text-left max-w-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-0.5">
                      Hipódromos:
                    </span>
                    {tieneHipos ? (
                      <div className="flex flex-wrap gap-1">
                        {op.hipodromos.map((h) => (
                          <span
                            key={h}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-700 border border-slate-200"
                          >
                            {h}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700 border border-emerald-200">
                        🏇 Todos los hipódromos
                      </span>
                    )}
                  </div>

                  {/* ACCIONES */}
                  <div className="flex items-center gap-1.5 ml-auto">
                    {/* Botón WhatsApp */}
                    {op.telefono ? (
                      <a
                        href={`https://wa.me/${op.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(
                          generarMensajeWhatsappOperador({
                            grupoNombre,
                            usuario: op.id,
                            clave: op.clave || "",
                            nombre: op.nombre,
                            telefono: op.telefono,
                          })
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Enviar credenciales por WhatsApp a ${op.telefono}`}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-bold hover:bg-emerald-500 transition-colors shadow-xs"
                      >
                        <span>💬</span>
                        <span className="hidden sm:inline">WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => copiarMensajeWhatsapp(op)}
                        title="Copiar datos de acceso para WhatsApp"
                        className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition-colors shadow-xs"
                      >
                        <span>💬</span>
                        <span className="hidden sm:inline">Copiar</span>
                      </button>
                    )}

                    {/* Alternar Activo/Inactivo */}
                    <button
                      type="button"
                      onClick={() => void handleToggleActivo(op)}
                      title={op.activo ? "Desactivar acceso" : "Activar acceso"}
                      className={`rounded-lg px-2 py-1 text-xs font-bold transition-colors ${
                        op.activo
                          ? "text-slate-500 hover:bg-slate-100"
                          : "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                      }`}
                    >
                      {op.activo ? "Pausar" : "Activar"}
                    </button>

                    {/* Editar */}
                    <button
                      type="button"
                      onClick={() => abrirEditar(op)}
                      title="Editar datos y contraseña"
                      className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                    >
                      ✏️
                    </button>

                    {/* Desvincular */}
                    <button
                      type="button"
                      onClick={() => void handleDesvincular(op)}
                      title="Desvincular del grupo"
                      className="rounded-lg p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
