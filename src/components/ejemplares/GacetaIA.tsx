"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLAVE_GEMINI_KEY,
  transformarGaceta,
  type CarreraExtraida,
} from "@/lib/gaceta/ia";
import { Button } from "@/components/ui/Button";

type PaginaGaceta = { id: string; dataUrl: string; orden: number };

function leerArchivoComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export function GacetaIA() {
  const [paginas, setPaginas] = useState<PaginaGaceta[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [clave, setClave] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [estado, setEstado] = useState("");
  const [diag, setDiag] = useState("");
  const [carreras, setCarreras] = useState<CarreraExtraida[]>([]);
  const [densa, setDensa] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const k = localStorage.getItem(CLAVE_GEMINI_KEY) ?? "";
      if (k) setClave(k);
    } catch (e) {
      void e;
    }
  }, []);

  const togglePagina = useCallback((id: string) => {
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const seleccionarTodas = useCallback(() => {
    setSeleccionadas(new Set(paginas.map((p) => p.id)));
  }, [paginas]);

  const limpiarSeleccion = useCallback(() => {
    setSeleccionadas(new Set());
  }, []);

  const onArchivos = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || f.type.startsWith("image/"));
    if (!arr.length) {
      setEstado("Solo se aceptan PDF, JPG, PNG o WEBP.");
      return;
    }
    setEstado("Leyendo archivos...");
    const nuevas: PaginaGaceta[] = [];
    for (const f of arr) {
      try {
        const dataUrl = await leerArchivoComoDataUrl(f);
        nuevas.push({ id: `${f.name}-${nuevas.length}-${Date.now()}`, dataUrl, orden: nuevas.length });
      } catch (e) {
        setEstado("Error leyendo " + f.name + ": " + (e instanceof Error ? e.message : String(e)));
      }
    }
    setPaginas((prev) => [...prev, ...nuevas]);
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      nuevas.forEach((p) => n.add(p.id));
      return n;
    });
    setEstado(`${nuevas.length} archivo(s) listos.`);
  }, []);

  const guardarClave = useCallback(() => {
    try {
      localStorage.setItem(CLAVE_GEMINI_KEY, clave.trim());
      setEstado("Clave guardada (solo en este navegador).");
    } catch (e) {
      setDiag(String(e));
    }
  }, [clave]);

  const probarClave = useCallback(async () => {
    setTrabajando(true);
    setEstado("Probando clave con Gemini...");
    setDiag("");
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(clave.trim())}`);
      const d = (await r.json()).models || [];
      setDiag(r.ok ? `Clave válida — ${d.length} modelos disponibles.` : `HTTP ${r.status}: ${JSON.stringify(d).slice(0, 160)}`);
      setEstado(r.ok ? "Clave válida." : "Clave rechazada.");
    } catch (e) {
      setEstado("Error de red al probar la clave.");
      setDiag(e instanceof Error ? e.message : String(e));
    } finally {
      setTrabajando(false);
    }
  }, [clave]);

  const transformar = useCallback(async () => {
    if (!clave.trim()) {
      setEstado("Primero guarda tu clave de Gemini.");
      return;
    }
    const imgs = paginas.filter((p) => seleccionadas.has(p.id)).map((p) => p.dataUrl);
    if (!imgs.length) {
      setEstado("Selecciona al menos una página.");
      return;
    }
    setTrabajando(true);
    setEstado(`Transcribiendo ${imgs.length} página(s) con Gemini (gratis)...`);
    setDiag("");
    const res = await transformarGaceta(clave.trim(), imgs);
    setTrabajando(false);
    setDiag(res.diag ?? "");
    if (!res.ok) {
      setEstado(res.error ?? "Error transformando.");
      setCarreras([]);
      return;
    }
    setCarreras(res.carreras);
    setEstado(`Extraídas ${res.carreras.length} carrera(s).`);
  }, [clave, paginas, seleccionadas]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            📤 Subir la Gaceta (PDF o Imagen)
          </h3>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void onArchivos(e.dataTransfer.files);
            }}
            className="cursor-pointer rounded-xl border-2 border-dashed border-line p-8 text-center transition-colors hover:border-primary-500/60 hover:bg-primary-500/5"
          >
            <p className="mb-1 text-sm font-bold text-slate-600">☁️ Arrastre el PDF o la imagen de la gaceta aquí</p>
            <p className="text-xs text-slate-500">o haga clic para elegir el archivo (JPG, PNG, WEBP o PDF)</p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void onArchivos(e.target.files);
              }}
            />
          </div>

          {paginas.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Vista previa — toca una página para incluirla/excluirla
                </p>
                <span className="text-[10px] font-bold text-primary-600">{seleccionadas.size} seleccionadas</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {paginas.map((p) => {
                  const activa = seleccionadas.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePagina(p.id)}
                      className={`relative overflow-hidden rounded-lg border-2 transition-transform ${
                        activa ? "border-primary-500 shadow-lg" : "border-line opacity-60"
                      }`}
                      title={activa ? "Quitar" : "Incluir"}
                    >
                      <img src={p.dataUrl} alt={`Página ${p.orden + 1}`} className="h-20 w-full object-cover" />
                      <span className="absolute bottom-0 left-0 bg-slate-950/80 px-1 text-[9px] font-bold text-slate-200">
                        {p.orden + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase text-slate-500">Selección:</span>
                <Button variant="ghost" size="sm" onClick={seleccionarTodas}>
                  Todas
                </Button>
                <Button variant="ghost" size="sm" onClick={limpiarSeleccion}>
                  Ninguna
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="mb-4 border-b border-line pb-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            🔑 Clave de la IA (Gemini, gratis)
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
            Con IA gratuita de Google (Gemini). <b>Sin costo y sin tarjeta.</b> La clave se guarda{" "}
            <b>solo en este navegador</b>.
          </p>
          <ul className="mb-3 list-inside list-decimal space-y-1 rounded-lg border border-line bg-surfaceAlt p-3 text-[11px] text-slate-600">
            <li>Entra a aistudio.google.com/apikey (con tu cuenta de Google).</li>
            <li>Click en Create API key y copia la clave (empieza con AIza...).</li>
            <li>Pégala abajo y presiona Guardar clave.</li>
          </ul>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 inline-flex items-center gap-1 text-[11px] font-bold text-success-400 hover:text-success-500"
          >
            ↗ Obtener mi clave gratis
          </a>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="AIza..."
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-success-500"
          />
          <Button variant="success" size="md" className="mt-2 w-full" onClick={guardarClave}>
            💾 Guardar clave (en este navegador)
          </Button>
          <Button
            variant="default"
            size="lg"
            className="mt-4 w-full"
            disabled={trabajando || !clave.trim()}
            onClick={() => void transformar()}
          >
            ✨ Transformar con IA (gratis)
          </Button>
          <Button variant="ghost" size="md" className="mt-2 w-full" disabled={trabajando} onClick={() => void probarClave()}>
            🔌 Probar clave de IA
          </Button>
          {estado && <p className="mt-2 text-center text-[11px] text-slate-500">{estado}</p>}
          {diag && (
            <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-2 text-[10px] font-mono text-success-500">
              {diag}
            </pre>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
          Vista de resultados
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant={densa ? "default" : "ghost"} size="sm" onClick={() => setDensa(true)}>
            Compacta
          </Button>
          <Button variant={densa ? "ghost" : "default"} size="sm" onClick={() => setDensa(false)}>
            Detallada
          </Button>
        </div>
      </div>

      {carreras.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-700">
            📋 Carreras Extraídas ({carreras.length})
          </h3>
          <div className={`grid gap-2 ${densa ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1"}`}>
            {carreras.map((c, i) => (
              <div key={i} className="rounded-xl border border-line bg-surfaceAlt/60 p-3">
                <p className="text-xs font-bold text-primary-600">
                  {String(c.hipodromo || "?").toUpperCase()} · C{c.carrera ?? "?"}
                </p>
                {densa ? null : (
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {c.fecha ?? "-"} · {(c.distancia || 0) > 0 ? `${c.distancia} m` : "-"} · {c.superficie || "ARENA"} · premio {c.premio || 0}
                  </p>
                )}
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-slate-600">
                  {(c.ejemplares || []).map((ej, j) => (
                    <li key={j}>
                      {ej.numero} · <b>{ej.nombre}</b> ({ej.nacionalidad ?? "VE"}){Number(ej.valor) > 0 ? ` · $${ej.valor}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default GacetaIA;