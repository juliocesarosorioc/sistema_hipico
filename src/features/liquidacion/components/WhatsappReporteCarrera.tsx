"use client";

import { useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { leerResultadoOficial } from "@/features/carreras/lib/carreras-dia";
import {
  cargarJugadasDeCarrera,
  relacionResultados,
  type MetaCarrera,
} from "@/features/impresion/lib/reportGenerator";
import { CLUB_NOMBRE, enviarAlGrupoWsp, waLink } from "@/features/whatsapp/lib/whatsapp";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

type Props = {
  fecha: string;
  hipodromo: string;
  carrera: number | string;
  /** Grupo que encabeza la relación (nombre del grupo activo). */
  grupo?: string;
  etiqueta?: string;
};

/**
 * 💬 WHATSAPP DEL REPORTE — botón que arma la RELACIÓN DE RESULTADOS de la
 * carrera mostrada y la entrega lista para el grupo, sin salir del reporte.
 *
 * Usa el MISMO camino que el Centro de WhatsApp (`leerResultadoOficial` +
 * `cargarJugadasDeCarrera` + `relacionResultados`): así el texto que se pega en
 * el grupo es idéntico al que produce ese módulo, con el cierre de POSITIVOS /
 * NEGATIVOS y el pie estricto del club.
 */
export default function WhatsappReporteCarrera({ fecha, hipodromo, carrera, grupo, etiqueta = "💬" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  /** Arma la RELACIÓN DE RESULTADOS (formato WhatsApp ya establecido). Devuelve
   *  "" si faltan datos o no hay jugadas para la carrera. */
  const construir = async (): Promise<string> => {
    const hip = String(hipodromo ?? "").trim().toUpperCase();
    const car = String(carrera ?? "").trim();
    if (!hip || !car) {
      toast("Elegí un hipódromo y una carrera primero.", "warning");
      return "";
    }
    const oficial = await leerResultadoOficial(hip, car, fecha);
    const meta: MetaCarrera = {
      grupo: grupo?.trim() || CLUB_NOMBRE,
      hipodromo: nombreHipodromoParaMostrar(hip),
      carrera: car,
      fecha: fecha ? new Date(`${fecha}T12:00:00`) : new Date(),
      pizarra: oficial?.puestos?.length ? oficial.puestos.join(" · ") : "",
      pizarraPuestos: oficial?.puestos ?? [],
      pizarraRaya: oficial?.puestosRaya ?? oficial?.puestos ?? [],
      dividendos: oficial?.dividendos ?? null,
    };
    // La MISMA fecha que el Reporte de Liquidación: sin acotar por día, la
    // relación mezclaba tickets de otras fechas con el mismo hipódromo + carrera
    // y suministraba datos distintos al reporte.
    const jugadas = await cargarJugadasDeCarrera({
      hipodromo: hip,
      carrera: car,
      fecha: fecha ? String(fecha).slice(0, 10) : undefined,
    });
    if (!jugadas.length) {
      return "No hay jugadas registradas para esta carrera (registralas en Taquilla o en la carga rápida).";
    }
    return relacionResultados(meta, jugadas);
  };

  const generar = async () => {
    setAbierto(true);
    setCargando(true);
    try {
      setTexto(await construir());
    } catch {
      setTexto("No se pudo generar la relación de resultados.");
    } finally {
      setCargando(false);
    }
  };

  /** Copia la relación al portapapeles en un solo clic (ícono 📋). */
  const copiarDirecto = async () => {
    try {
      const t = await construir();
      setTexto(t);
      if (!t.trim() || t.startsWith("No hay jugadas")) {
        toast(t || "Nada para copiar.", "warning");
        return;
      }
      await navigator.clipboard.writeText(t);
      toast("Resultado copiado en formato WhatsApp.", "success");
    } catch {
      toast("No se pudo copiar el mensaje.", "error");
    }
  };

  const copiar = async () => {
    if (!texto.trim()) return toast("Generá primero el mensaje.", "warning");
    try {
      await navigator.clipboard.writeText(texto);
      toast("Mensaje copiado al portapapeles.", "success");
    } catch {
      toast("No se pudo copiar el mensaje.", "error");
    }
  };

  const abrirWsp = () => {
    if (!texto.trim()) return toast("Generá primero el mensaje.", "warning");
    window.open(waLink("", texto), "_blank");
  };

  const enviarGrupo = async () => {
    if (!texto.trim()) return toast("Generá primero el mensaje.", "warning");
    setEnviando(true);
    const res = await enviarAlGrupoWsp(texto, "reporte");
    setEnviando(false);
    if (res?.ok) toast("Mensaje enviado al grupo vinculado.", "success");
    else toast(res?.error ?? "No se pudo enviar (¿grupo vinculado / API configurada?).", "error");
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={generar} title="WhatsApp: arma la relación de resultados de la carrera">
        {etiqueta}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void copiarDirecto()}
        title="Copiar la relación de resultados en formato WhatsApp"
      >
        📋
      </Button>

      {abierto && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line bg-emerald-800 px-4 py-2 text-white">
              <h3 className="text-xs font-black uppercase tracking-wide">
                💬 Relación de resultados — {nombreHipodromoParaMostrar(hipodromo)} C{carrera}
              </h3>
              <button type="button" onClick={() => setAbierto(false)} className="text-slate-200 hover:text-white">
                ✕
              </button>
            </div>
            <div className="p-3">
              <textarea
                value={cargando ? "Generando…" : texto}
                readOnly
                spellCheck={false}
                className="h-72 w-full resize-none rounded-lg border border-line bg-slate-50 p-3 font-mono text-[11px] text-slate-800 outline-none"
              />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={copiar}>
                  📋 Copiar
                </Button>
                <Button size="sm" variant="outline" onClick={abrirWsp}>
                  🟢 Abrir WhatsApp
                </Button>
                <Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => void enviarGrupo()} disabled={enviando}>
                  {enviando ? "…" : "📤 Enviar al grupo"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
