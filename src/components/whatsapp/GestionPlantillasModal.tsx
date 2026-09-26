"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PLANTILLAS_DEFAULT, VARIABLES_WSP, type PlantillaWsp } from "@/lib/whatsapp";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  plantillas: PlantillaWsp[];
  onGuardar: (lista: PlantillaWsp[]) => void;
};

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

/**
 * Modal "Gestionar Plantillas" del Centro de WhatsApp.
 * Crear / editar / guardar / restaurar (por plantilla o todos) y eliminar las
 * plantillas personalizadas. Persistencia en localStorage (lib/whatsapp.ts).
 */
export function GestionPlantillasModal({ abierto, onCerrar, plantillas, onGuardar }: Props) {
  const [selId, setSelId] = useState("");
  const [txt, setTxt] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [label, setLabel] = useState("");
  const [variables, setVariables] = useState("{nombre}");
  const [grupo, setGrupo] = useState<"envio" | "reporte">("envio");

  useEffect(() => {
    if (!abierto) return;
    setNuevo(false);
    setLabel("");
    setVariables("{nombre}");
    setGrupo("envio");
    if (plantillas.length > 0) {
      setSelId(plantillas[0].id);
      setTxt(plantillas[0].txt);
    }
  }, [abierto]);

  const sel = plantillas.find((p) => p.id === selId);

  const elegir = (id: string) => {
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    setSelId(id);
    setTxt(p.txt);
    setNuevo(false);
  };

  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 40) || `plantilla_${Date.now()}`;

  const guardar = () => {
    if (nuevo) {
      if (!label.trim()) return toast("Escribe el nombre de la plantilla.", "warning");
      const nueva: PlantillaWsp = {
        id: `${slug(label)}_${Date.now()}`,
        label: label.trim(),
        grupo,
        variables: variables.trim() || "{nombre}",
        txt,
        custom: true,
      };
      const lista = [...plantillas, nueva];
      onGuardar(lista);
      setSelId(nueva.id);
      setNuevo(false);
      setLabel("");
      toast(`✅ Plantilla “${nueva.label}” creada.`, "success");
      return;
    }
    if (!sel) return;
    const lista = plantillas.map((p) => (p.id === sel.id ? { ...p, txt } : p));
    onGuardar(lista);
    toast(`💾 Plantilla “${sel.label}” guardada.`, "success");
  };

  const eliminar = () => {
    if (!sel) return;
    if (!sel.custom) return toast("Las plantillas predeterminadas no se pueden eliminar.", "warning");
    const lista = plantillas.filter((p) => p.id !== sel.id);
    onGuardar(lista);
    if (lista.length > 0) elegir(lista[0].id);
    toast(`🗑️ Plantilla “${sel.label}” eliminada.`, "success");
  };

  const restaurarEsta = () => {
    if (!sel) return;
    const def = PLANTILLAS_DEFAULT.find((p) => p.id === sel.id);
    if (!def) return toast("Solo las plantillas predeterminadas tienen texto original.", "warning");
    onGuardar(plantillas.map((p) => (p.id === sel.id ? { ...p, txt: def.txt } : p)));
    setTxt(def.txt);
    toast(`↩️ Plantilla “${sel.label}” restaurada.`, "info");
  };

  const restaurarTodas = () => {
    onGuardar(PLANTILLAS_DEFAULT.map((p) => ({ ...p })));
    if (plantillas.length > 0) elegir(plantillas[0].id);
    toast("↩️ Todas las plantillas restauradas al texto original.", "info");
  };

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-indigo-700 px-4 py-3 text-white">
          <h3 className="text-xs font-black uppercase tracking-wider">⚙️ Gestionar Plantillas WhatsApp</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-indigo-200 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Plantilla</label>
              <select
                value={selId}
                onChange={(e) => elegir(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}{" "}
                    {p.custom
                      ? "(personalizada)"
                      : p.grupo === "reporte"
                        ? "(reporte)"
                        : p.grupo === "tablas"
                          ? "(tablas)"
                          : ""}
                  </option>
                ))}
              </select>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setNuevo(true); setTxt(""); setLabel(""); }}>
              ＋ Nueva
            </Button>
          </div>

          {nuevo && (
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Nombre</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ej: Carrera de hoy"
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Variables</label>
                <input
                  value={variables}
                  onChange={(e) => setVariables(e.target.value)}
                  placeholder="{nombre} {saldo}"
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-xs text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Grupo</label>
                <select
                  value={grupo}
                  onChange={(e) => setGrupo(e.target.value as "envio" | "reporte")}
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <option value="envio">Envío individual</option>
                  <option value="reporte">Reporte general</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Variables disponibles
            </label>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES_WSP.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTxt((t) => (t ? `${t} ${v}` : v))}
                  className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-600 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-100"
                  title="Insertar al final del texto"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Texto de la plantilla
              {sel && !nuevo && <span className="ml-2 normal-case font-semibold text-slate-400">{sel.label}</span>}
            </label>
            <textarea
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full resize-y rounded-xl border border-line bg-surface p-3 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              placeholder="Escribe aquí el texto… (usa las variables indicadas)"
            />
          </div>

          <p className="rounded-lg bg-gray-50 px-3 py-2 text-[10px] font-semibold text-slate-500">
            💾 Los cambios se guardan en este navegador (localStorage) y se aplican de inmediato al Centro de WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-gray-50 px-4 py-3">
          <Button size="sm" variant="ghost" onClick={restaurarTodas} title="Restaurar todas las plantillas al texto original">
            ↩️ Restaurar todas
          </Button>
          <Button size="sm" variant="ghost" onClick={restaurarEsta} title="Restaurar la plantilla seleccionada">
            ↩️ Restaurar esta
          </Button>
          {sel?.custom && (
            <Button size="sm" variant="danger" onClick={eliminar}>
              🗑️ Eliminar
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCerrar}>
              Cerrar
            </Button>
            <Button size="md" onClick={guardar}>
              💾 Guardar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GestionPlantillasModal;