"use client";

/**
 * MODAL ➕ SOLICITAR INCLUIR "JUGADA NO RELACIONADA" — PORTAL (PROMPT #6)
 * =====================================================================
 * Cuando al jugador no le aparece una jugada que sí hizo, la pide desde acá. La
 * solicitud queda como un reclamo (tipo SOLICITUD_JUGADA) en la bandeja del
 * admin, que la aprueba (insertando/ajustando la jugada) o la rechaza con
 * respuesta.
 *
 * La FECHA está restringida por la "Ventana de Revisión y Reclamos" del grupo:
 *   · SOLO_DIA_EN_CURSO → solo hoy (min = max = hoy).
 *   · SEMANA_EN_CURSO   → toda la semana fiscal del grupo (min = inicio,
 *     max = fin del ciclo definido por dia_inicio_semana / dia_fin_semana).
 *
 * La ventana vive en `ventana-reclamos.ts` (núcleo puro probado) y el servidor
 * la vuelve a comprobar: si el navegador manda otra fecha, la Edge Function la
 * rechaza.
 *
 * El soporte fotográfico se sube al bucket privado `reclamos` (mismo camino que
 * la disputa): pegar con Ctrl+V o elegir un archivo.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { opcionesHipodromo } from "@/features/hipodromos/lib/nombre";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import type { Hipodromo } from "@/features/hipodromos/lib/tipos";
import { useVersionLogos } from "@/shared/store/useHipodromosStore";
import { solicitarJugadaNoRelacionada, type SesionPortal } from "@/features/portal/lib/portal";
import { TIPOS_JUGADA, ETIQUETA_TIPO, type TipoJugada } from "@/features/portal/lib/jugada-usuario";
import {
  explicarVentana,
  fechaPisoReclamo,
  fechaTopeReclamo,
  normalizarVentana,
  type CicloGrupo,
} from "@/features/portal/lib/ventana-reclamos";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const hoyIso = (): string => {
  const d = new Date();
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const lbl = "modal-campo-label";

export function ModalJugadaNoRelacionada({
  sesion,
  ventana,
  ciclo,
  onCerrar,
}: {
  sesion: SesionPortal;
  /** Ventana configurada en el grupo del jugador. */
  ventana: string;
  /** Ciclo semanal del grupo (para el rango de SEMANA_EN_CURSO). */
  ciclo?: CicloGrupo | null;
  onCerrar: () => void;
}) {
  const hoy = hoyIso();
  const modo = normalizarVentana(ventana);
  const piso = fechaPisoReclamo(hoy, modo, ciclo);
  const tope = fechaTopeReclamo(hoy, modo, ciclo);

  const [fecha, setFecha] = useState(hoy);
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [tipoJugada, setTipoJugada] = useState<TipoJugada>("TABLA_FIJA");
  const [ejemplares, setEjemplares] = useState("");
  const [monto, setMonto] = useState("");
  const [explicacion, setExplicacion] = useState("");
  const [imagen, setImagen] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // Catálogo REAL de hipódromos (con país y logo) para el buscador con teclado.
  // Antes había una lista fija de 12 nombres y un `<datalist>`: si el club tenía
  // otro hipódromo registrado, el jugador no lo veía ni lo sugería.
  const [catalogo, setCatalogo] = useState<Hipodromo[]>([]);
  const versionLogos = useVersionLogos();
  useEffect(() => {
    let vivo = true;
    listarHipodromos()
      .then((r) => vivo && setCatalogo(r.data))
      .catch(() => vivo && setCatalogo([]));
    return () => {
      vivo = false;
    };
  }, [versionLogos]);
  const opcionesHip = useMemo(() => opcionesHipodromo(catalogo), [catalogo]);

  const elegirImagen = (f: File | null) => {
    setImagen(f);
    if (f) setPrevia(URL.createObjectURL(f));
    else setPrevia(null);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          elegirImagen(f);
          e.preventDefault();
          return;
        }
      }
    }
  };

  const enviar = async () => {
    setError("");
    if (!fecha) return setError("Elegí la fecha de la jugada.");
    if (fecha < piso || fecha > tope) {
      return setError(`La fecha tiene que estar entre ${piso} y ${tope} (ventana de tu grupo).`);
    }
    if (!hipodromo.trim()) return setError("Indicá el hipódromo.");
    if (!ejemplares.trim()) return setError("Indicá el ejemplar o los ejemplares.");
    if (!explicacion.trim()) return setError("Contá qué pasó con la jugada.");
    const m = parseFloat(monto.replace(",", "."));
    if (!(m > 0)) return setError("El monto tiene que ser mayor que cero.");

    setEnviando(true);
    const r = await solicitarJugadaNoRelacionada(sesion.cliente.id, {
      fecha,
      hipodromo: hipodromo.trim().toUpperCase(),
      carrera: carrera.trim(),
      tipo_jugada: ETIQUETA_TIPO[tipoJugada].etiqueta.toUpperCase(),
      ejemplares: ejemplares.trim(),
      monto: m,
      explicacion: explicacion.trim(),
      image: imagen,
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error ?? "No se pudo enviar la solicitud.");
      return toast(r.error ?? "No se pudo enviar la solicitud.", "error");
    }
    toast("Solicitud enviada. La casa la revisará y te responderá.", "success");
    onCerrar();
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-editorial" onClick={(e) => e.stopPropagation()}>
        <header className="modal-editorial__cabecera">
          <div className="modal-editorial__titulos">
            <h2 className="modal-editorial__titulo">➕ Solicitar Incluir Jugada No Relacionada</h2>
            <p className="modal-editorial__sub">Pedile a la casa que revise una jugada que no te aparece.</p>
          </div>
          <button onClick={onCerrar} className="modal-editorial__cerrar" aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="modal-editorial__cuerpo space-y-3" onPaste={onPaste}>
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-300">
            ⏱️ {explicarVentana(modo)}
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lbl}>Fecha (Día)</label>
              <input
                type="date"
                className="modal-campo"
                value={fecha}
                min={piso}
                max={tope}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div>
              <label className={lbl}>Hipódromo</label>
              {/* Buscador con teclado: escribís letras y filtra al instante
                  (↑↓, Enter, Escape), con bandera del país y logo del hipódromo. */}
              <SearchableSelect
                options={opcionesHip}
                value={hipodromo}
                onChange={(v) => setHipodromo(v)}
                placeholder="Escribí el hipódromo…"
                allowCustom
                temaOscuro
              />
            </div>
            <div>
              <label className={lbl}>Carrera</label>
              <input
                className="modal-campo font-mono"
                inputMode="numeric"
                value={carrera}
                onChange={(e) => setCarrera(e.target.value.replace(/\D/g, ""))}
                placeholder="1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lbl}>Tipo de jugada</label>
              <select className="modal-campo" value={tipoJugada} onChange={(e) => setTipoJugada(e.target.value as TipoJugada)}>
                {TIPOS_JUGADA.map((t) => (
                  <option key={t} value={t}>
                    {ETIQUETA_TIPO[t].icono} {ETIQUETA_TIPO[t].etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Ejemplar(es)</label>
              <input
                className="modal-campo"
                value={ejemplares}
                onChange={(e) => setEjemplares(e.target.value)}
                placeholder="Ej: 3 / 5x7"
              />
            </div>
          </div>

          <div>
            <label className={lbl}>Monto jugado</label>
            <input
              className="modal-campo text-right font-mono"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className={lbl}>Explicación</label>
            <textarea
              className="modal-campo min-h-[80px]"
              value={explicacion}
              onChange={(e) => setExplicacion(e.target.value)}
              placeholder="Contá qué jugaste, dónde y por qué creés que no aparece."
            />
          </div>

          <div>
            <label className={lbl}>Soporte (opcional · pegá con Ctrl+V o elegí un archivo)</label>
            <input
              type="file"
              accept="image/*"
              className="block w-full text-[11px] text-slate-400"
              onChange={(e) => elegirImagen(e.target.files?.[0] ?? null)}
            />
            {previa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previa} alt="Soporte" className="mt-2 max-h-40 rounded-xl border border-slate-700" />
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-300">{error}</div>
          ) : null}
        </div>

        <footer className="modal-editorial__pie">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">📤</span>} Enviar solicitud
          </Button>
        </footer>
      </div>
    </div>
  );
}
