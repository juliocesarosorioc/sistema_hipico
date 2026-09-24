"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { GestionPlantillasModal } from "@/components/whatsapp/GestionPlantillasModal";
import {
  CLUB_NOMBRE,
  CODIGOS_PAIS,
  cargarPlantillas,
  componerTelefono,
  contarEnviosWsp,
  desglosarTelefono,
  fmtUSD,
  guardarPlantillas,
  guardarTelefonoCliente,
  limpiarNumero,
  listarClientesWsp,
  listarHistorialWsp,
  registrarEnvioWsp,
  reemplazarVars,
  restaurarPlantillas,
  telefonoInt,
  waLink,
  type ClienteWsp,
  type PlantillaWsp,
  type RegistroWsp,
} from "@/lib/whatsapp";
import {
  cargarJugadasDeCarrera,
  relacionJugadas,
  relacionResultados,
  reporteDisponibilidad,
  type MetaCarrera,
} from "@/lib/reportGenerator";

type TipoReporte = "saldos" | "jugadas" | "resultados";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

/** Fecha/hora legible para el encabezado y el historial. */
function fmtFechaHora(fecha?: string | null): string {
  if (!fecha) return "—";
  const d = new Date(fecha);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function leerDatos(n: unknown): { telefono?: string; tipo?: string } {
  try {
    if (typeof n === "object" && n !== null) return n as { telefono?: string; tipo?: string };
    return JSON.parse(String(n ?? "{}"));
  } catch {
    return {};
  }
}

/**
 * Centro de Notificaciones WhatsApp (clon del legacy html/whatsapp.html):
 *  - Panel superior: clientes con/sin teléfono + envíos registrados
 *  - Columna izquierda: Reporte General de Saldos (Generar/Copiar/Abrir)
 *  - Columna derecha: Envío Individual por Cliente (buscador autocomplete,
 *    teléfono, plantillas dinámicas con variables, vista previa y wa.me)
 *  - Gestionar Plantillas (⚙️): crear/editar/guardar en localStorage
 *  - Historial de envíos (notificaciones tipo 'whatsapp')
 */
export function WhatsAppModule() {
  const [clientes, setClientes] = useState<ClienteWsp[]>([]);
  const [plantillas, setPlantillas] = useState<PlantillaWsp[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [plantillaId, setPlantillaId] = useState("saldo");
  const [mensaje, setMensaje] = useState("");
  const [codigo, setCodigo] = useState("+58");
  const [telefono, setTelefono] = useState("");
  const [reporte, setReporte] = useState("");
  const [historial, setHistorial] = useState<RegistroWsp[]>([]);
  const [conEnvios, setConEnvios] = useState(0);
  const [fechaHeader, setFechaHeader] = useState("Cargando…");
  const [modalPlantillas, setModalPlantillas] = useState(false);
  const [guardandoTel, setGuardandoTel] = useState(false);
  const [tipoReporte, setTipoReporte] = useState<TipoReporte>("saldos");
  const [repHipodromo, setRepHipodromo] = useState("");
  const [repCarrera, setRepCarrera] = useState("");
  const [repRetirados, setRepRetirados] = useState("");
  const [repPizarra, setRepPizarra] = useState("");

  const clienteSel = useMemo(
    () => clientes.find((c) => String(c.id) === clienteId) ?? null,
    [clientes, clienteId]
  );
  const plantillaSel = useMemo(
    () => plantillas.find((p) => p.id === plantillaId) ?? null,
    [plantillas, plantillaId]
  );

  const resumen = useMemo(() => {
    const conTel = clientes.filter((c) => Boolean(c.telefono && limpiarNumero(c.telefono))).length;
    return { conTel, sinTel: clientes.length - conTel };
  }, [clientes]);

  const opcionesClientes = useMemo(
    () =>
      clientes.map((c) => ({
        value: String(c.id),
        label: `${c.nombre} · $${fmtUSD(c.saldo_actual)} · ${
          c.telefono && limpiarNumero(c.telefono) ? c.telefono : "sin tel"
        }`,
      })),
    [clientes]
  );

  const preview = useMemo(() => reemplazarVars(mensaje, clienteSel), [mensaje, clienteSel]);

  const refrescarHistorial = useCallback(async () => {
    const [envios, his] = await Promise.all([contarEnviosWsp(), listarHistorialWsp()]);
    setConEnvios(envios);
    setHistorial(his);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [cs, ps] = await Promise.all([listarClientesWsp(), Promise.resolve(cargarPlantillas())]);
      if (!vivo) return;
      setClientes(cs);
      setPlantillas(ps);
      const p = ps.find((x) => x.id === "saldo") ?? ps[0];
      if (p) {
        setPlantillaId(p.id);
        setMensaje(p.txt);
      }
      await refrescarHistorial();
    })();
    setFechaHeader(new Date().toLocaleString("es-ES"));
    return () => {
      vivo = false;
    };
  }, [refrescarHistorial]);

  const forzarPlantilla = (id: string, c: ClienteWsp | null) => {
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    setMensaje(p.txt);
    setPlantillaId(id);
  };

  const seleccionarCliente = (c: ClienteWsp | null) => {
    const dg = desglosarTelefono(c?.telefono);
    setCodigo(c?.codigo_pais || dg.codigo || "+58");
    setTelefono(dg.numero);
    if (c) forzarPlantilla(plantillaId, c);
  };

  // ============================================================
  // REPORTE DE TEXTO (saldos / relación de jugadas / resultados)
  // ============================================================
  const generarReporte = async () => {
    if (tipoReporte === "saldos") {
      const texto = reporteDisponibilidad(
        clientes.map((c) => ({ nombre: c.nombre, saldo: Number(c.saldo_actual) || 0 }))
      );
      setReporte(texto);
      toast("Disponibilidad actualizada.", "success");
      return;
    }
    const hip = repHipodromo.trim().toUpperCase();
    const car = repCarrera.trim();
    if (!hip || !car) {
      setReporte("Indica Hipódromo y N° de Carrera para generar la relación.");
      return;
    }
    const meta: MetaCarrera = {
      grupo: CLUB_NOMBRE,
      hipodromo: hip,
      carrera: car,
      retirados: repRetirados.trim(),
      pizarra: repPizarra.trim(),
    };
    const jugadas = await cargarJugadasDeCarrera({
      hipodromo: hip,
      carrera: car,
      soloPendientes: tipoReporte === "jugadas",
    });
    if (jugadas.length === 0) {
      setReporte("No hay jugadas registradas para esta carrera (regístralas en Taquilla o la boletería).");
      return;
    }
    setReporte(
      tipoReporte === "jugadas"
        ? relacionJugadas(meta, jugadas)
        : relacionResultados(meta, jugadas)
    );
    toast(tipoReporte === "jugadas" ? "Relación de jugadas generada." : "Relación de resultados generada.", "success");
  };

  const copiarReporte = async () => {
    if (!reporte.trim()) return toast("Genera primero el reporte.", "warning");
    try {
      await navigator.clipboard.writeText(reporte);
      toast("Reporte copiado al portapapeles.", "success");
    } catch {
      toast("No se pudo copiar el reporte.", "error");
    }
  };

  const abrirReporte = async () => {
    const texto = reporte.trim();
    if (!texto) return toast("Genera primero el reporte.", "warning");
    window.open(waLink("", texto), "_blank");
    await registrarEnvioWsp({ tipo: "Reporte general", telefono: "—", mensaje: texto, cliente: null });
    toast("WhatsApp abierto con el reporte general.", "success");
    refrescarHistorial();
  };

  // ============================================================
  // ENVÍO INDIVIDUAL POR CLIENTE
  // ============================================================
  const guardarTel = async () => {
    if (!clienteSel) return toast("Selecciona primero un cliente.", "warning");
    const num = limpiarNumero(telefono);
    if (num.length < 8) return toast("Número de teléfono no válido.", "warning");
    setGuardandoTel(true);
    const ok = await guardarTelefonoCliente(clienteSel.id, telefono, codigo);
    setGuardandoTel(false);
    if (!ok) return toast("No se guardó el teléfono.", "error");
    setClientes((cs) =>
      cs.map((c) =>
        c.id === clienteSel.id
          ? { ...c, telefono: componerTelefono(codigo, telefono), codigo_pais: codigo }
          : c
      )
    );
    toast(`✅ Teléfono actualizado para ${clienteSel.nombre}.`, "success");
  };

  const abrirWsp = async () => {
    if (!clienteSel) return toast("Selecciona un cliente.", "warning");
    const num = telefonoInt(codigo, telefono);
    if (num.length < 10) return toast("Teléfono WhatsApp no válido. Revisa el número.", "warning");
    const final = reemplazarVars(mensaje.trim(), clienteSel);
    if (!final) return toast("Escribe un mensaje para enviar.", "warning");
    window.open(waLink(num, final), "_blank");
    await registrarEnvioWsp({
      tipo: plantillaSel?.label ?? "Plantilla",
      telefono: `${limpiarNumero(codigo)} ${limpiarNumero(telefono)}`.trim(),
      mensaje: final,
      cliente: clienteSel,
    });
    toast(`WhatsApp abierto con el mensaje de ${clienteSel.nombre}.`, "success");
    refrescarHistorial();
  };

  // ============================================================
  // PLANTILLAS (gestionar)
  // ============================================================
  const onGuardarPlantillas = (lista: PlantillaWsp[]) => {
    guardarPlantillas(lista);
    setPlantillas(lista);
    if (plantillaId) {
      const p = lista.find((x) => x.id === plantillaId);
      if (p) setMensaje(p.txt);
    }
  };

  const onRestaurarTodas = () => {
    setPlantillas(restaurarPlantillas());
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Encabezado */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
        <div>
          <h1 className="text-base font-black uppercase tracking-wide text-slate-900">
            <span className="mr-2 text-emerald-500">💬</span> Centro de Notificaciones WhatsApp
          </h1>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Envía reportes de saldos, recordatorios de aval y avisos a tus clientes por WhatsApp. Los envíos quedan
            registrados automáticamente.
          </p>
        </div>
        <span className="rounded-lg border border-line bg-slate-100 px-4 py-1.5 text-xs font-bold text-slate-500 shadow-inner">
          {fechaHeader}
        </span>
      </header>

      {/* Resumen superior: 3 contadores */}
      <section aria-label="Resumen de clientes y envíos" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl bg-emerald-600 p-4 text-white shadow">
          <p className="text-2xl font-black">{resumen.conTel}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-200">
            Clientes con teléfono
          </p>
        </div>
        <div className="rounded-xl bg-amber-500 p-4 text-white shadow">
          <p className="text-2xl font-black">{resumen.sinTel}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-100">
            Sin teléfono registrado
          </p>
        </div>
        <div className="rounded-xl bg-slate-800 p-4 text-white shadow">
          <p className="text-2xl font-black">{conEnvios}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Envíos registrados</p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ================= REPORTE DE TEXTO ================= */}
        <section className="self-start overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="flex items-center justify-between bg-emerald-700 p-3.5 text-xs font-bold uppercase tracking-wider text-white">
            <span>📈 Generador de Reportes</span>
          </div>
          <div className="space-y-3 p-5">
            <p className="text-[11px] font-medium text-slate-500">
              Genera la disponibilidad de saldos, la relación de jugadas (pre-carrera) o la relación de
              resultados (post-liquidación). Luego cópialo o ábrelo directamente en tu WhatsApp.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "saldos", label: "💰 Disponibilidad (Saldos)" },
                  { id: "jugadas", label: "🏇 Relación de Jugadas" },
                  { id: "resultados", label: "🏁 Relación de Resultados" },
                ] as Array<{ id: TipoReporte; label: string }>
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTipoReporte(t.id)}
                  aria-pressed={tipoReporte === t.id}
                  className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    tipoReporte === t.id
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tipoReporte !== "saldos" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-600">
                  Hipódromo
                  <input
                    value={repHipodromo}
                    onChange={(e) => setRepHipodromo(e.target.value)}
                    placeholder="LA RINCONADA"
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-bold uppercase text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-600">
                  Carrera N°
                  <input
                    value={repCarrera}
                    onChange={(e) => setRepCarrera(e.target.value)}
                    type="number"
                    min={1}
                    placeholder="4"
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-600">
                  Retirados
                  <input
                    value={repRetirados}
                    onChange={(e) => setRepRetirados(e.target.value)}
                    placeholder="2, 5 → NO HUBO si vacío"
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-bold uppercase text-slate-600">
                  Pizarra {tipoReporte === "jugadas" ? "(opcional)" : "(resultados exactos)"}
                  <input
                    value={repPizarra}
                    onChange={(e) => setRepPizarra(e.target.value)}
                    placeholder="1-2-3-4-5-6-7-8"
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="default" size="md" onClick={generarReporte} className="bg-emerald-700 hover:bg-emerald-800">
                🔄 Generar / Actualizar
              </Button>
              <div className="flex gap-2">
                <Button size="md" className="bg-slate-800 text-white hover:bg-black" onClick={copiarReporte} title="Copiar texto">
                  📋 Copiar
                </Button>
                <Button size="md" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={abrirReporte} title="Abrir en WhatsApp">
                  💬 Abrir WhatsApp
                </Button>
              </div>
            </div>
            <textarea
              value={reporte}
              readOnly
              spellCheck={false}
              placeholder="Pulsa “Generar / Actualizar” para armar el reporte…"
              className="h-64 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 shadow-inner outline-none"
            />
          </div>
        </section>

        {/* ================= ENVÍO INDIVIDUAL ================= */}
        <section className="self-start overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className="bg-slate-800 p-3.5 text-xs font-bold uppercase tracking-wider text-white">
            <span className="text-emerald-400">💬</span> Envío Individual por Cliente
          </div>
          <div className="space-y-4 p-5">
            {/* Cliente (Searchable Dropdown / Autocomplete) */}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-700">Cliente</label>
              <SearchableSelect
                options={opcionesClientes}
                value={clienteId}
                displayValue={clienteSel ? clienteSel.nombre : ""}
                onChange={(v) => {
                  setClienteId(v);
                  seleccionarCliente(clientes.find((c) => String(c.id) === v) ?? null);
                }}
                placeholder="Buscar cliente por nombre…"
                allowCustom={false}
              />
            </div>

            {/* Teléfono WhatsApp */}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-700">Teléfono WhatsApp</label>
              <div className="flex items-center gap-2">
                <select
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  className="w-28 rounded-lg border border-slate-300 bg-slate-50 px-2 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  {CODIGOS_PAIS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  type="tel"
                  placeholder="4121234567"
                  className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <Button
                  size="md"
                  className="bg-blue-600 px-3 text-white hover:bg-blue-700"
                  onClick={guardarTel}
                  disabled={!clienteSel || guardandoTel}
                  title="Guardar teléfono en el cliente"
                >
                  {guardandoTel ? "…" : "💾"}
                </Button>
              </div>
              {clienteSel && !telefono.trim() && (
                <p className="mt-1 text-[10px] font-bold text-amber-600">
                  ⚠️ Este cliente no tiene teléfono registrado. Escríbelo y guarda.
                </p>
              )}
            </div>

            {/* Plantilla + Gestionar Plantillas */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-bold uppercase text-slate-700">Plantilla</label>
                <button
                  type="button"
                  onClick={() => setModalPlantillas(true)}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 transition-colors hover:text-indigo-600"
                  title="Gestionar plantillas (crear, editar, restaurar)"
                >
                  ⚙️ Gestionar Plantillas
                </button>
              </div>
              <select
                value={plantillaId}
                onChange={(e) => forzarPlantilla(e.target.value, clienteSel)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {plantillas
                  .filter((p) => p.grupo === "envio")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </div>

            {/* Mensaje */}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-slate-700">
                Mensaje <span className="normal-case font-medium text-slate-400">(usa {"{nombre}"}, {"{saldo}"}, {"{aval}"}, {"{fecha}"}, {"{club}"})</span>
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                spellCheck={false}
                rows={7}
                className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Vista previa */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Vista previa (así lo verá el cliente)
              </label>
              <div className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-700">
                {preview.trim() ? preview : "—"}
              </div>
            </div>

            <button
              type="button"
              onClick={abrirWsp}
              className="w-full rounded-lg bg-emerald-600 py-3 text-xs font-black uppercase tracking-wider text-white shadow-md transition-colors hover:bg-emerald-700"
            >
              💬 Abrir WhatsApp con este Mensaje
            </button>
          </div>
        </section>
      </div>

      {/* ================= HISTORIAL ================= */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between bg-slate-800 p-3.5 text-xs font-bold uppercase tracking-wider text-white">
          <span className="text-emerald-400">🕘</span> Historial de Envíos WhatsApp
          <button
            type="button"
            onClick={refrescarHistorial}
            className="rounded bg-slate-700 px-3 py-1 text-[10px] transition-colors hover:bg-slate-600"
          >
            🔄 Actualizar
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100 text-slate-700">
              <tr>
                <th className="p-3 font-bold uppercase tracking-wider">Fecha</th>
                <th className="p-3 font-bold uppercase tracking-wider">Cliente</th>
                <th className="p-3 font-bold uppercase tracking-wider">Tipo</th>
                <th className="p-3 font-bold uppercase tracking-wider">Teléfono</th>
                <th className="p-3 font-bold uppercase tracking-wider">Mensaje</th>
                <th className="p-3 text-center font-bold uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
              {historial.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center italic text-slate-400">
                    Aún no hay envíos registrados. ¡Usa el centro para hacer tu primer envío!
                  </td>
                </tr>
              ) : (
                historial.map((n, i) => {
                  const dp = leerDatos(n.datos);
                  const tel = dp.telefono || "—";
                  const msj = String(n.mensaje ?? "");
                  return (
                    <tr key={String(n.id ?? i)} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="whitespace-nowrap p-2.5 text-slate-500">{fmtFechaHora(n.created_at)}</td>
                      <td className="p-2.5 font-bold text-slate-800">{n.cliente_nombre || "—"}</td>
                      <td className="p-2.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                          {n.titulo || dp.tipo || "—"}
                        </span>
                      </td>
                      <td className="p-2.5 font-mono text-slate-600">{tel}</td>
                      <td className="max-w-xs p-2.5 text-slate-600">
                        <span className="block truncate" title={msj}>
                          {msj.slice(0, 90)}
                          {msj.length > 90 ? "…" : ""}
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">
                          {n.estado || "Enviado"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Gestionar Plantillas */}
      <GestionPlantillasModal
        abierto={modalPlantillas}
        onCerrar={() => setModalPlantillas(false)}
        plantillas={plantillas}
        onGuardar={onGuardarPlantillas}
      />
    </div>
  );
}

export default WhatsAppModule;