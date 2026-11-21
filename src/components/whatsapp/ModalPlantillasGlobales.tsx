"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  aplicarVariablesPlantilla,
  PLANTILLAS_GRUPO_DEFAULT,
  type PlantillaGrupoItem,
} from "@/features/whatsapp/lib/plantillas-grupo";

type Origen = "grupo" | "global" | "default";
type Plantilla = PlantillaGrupoItem & { origen: Origen };
type Categoria =
  | "Concreción"
  | "Saldo"
  | "Carrera"
  | "Plano"
  | "Pedagogía"
  | "Varios";
type Tab = "catalogo" | "grupo" | "individual" | "bienvenida";
type Sala = {
  id: string;
  nombre_sala?: string | null;
  whatsapp_group_nombre?: string | null;
  grupo_id?: string | null;
};
type Aviso = { tipo: "ok" | "error"; texto: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Grupo resuelto por la página (mismo valor que usa el modal de lenguaje). */
  grupoId: string;
  salaId?: string | null;
};

const CATEGORIAS: Categoria[] = [
  "Concreción",
  "Saldo",
  "Carrera",
  "Plano",
  "Pedagogía",
  "Varios",
];

const CATEGORIA_POR_CLAVE: Record<string, Categoria> = {
  confirmacion_jugada: "Concreción",
  concrecion_saldo_parcial: "Concreción",
  tope_saldo_publico: "Saldo",
  pedagogia_exceso_dm: "Pedagogía",
  sin_saldo_dm: "Saldo",
  recarga_instrucciones: "Saldo",
  apertura_carrera: "Carrera",
  cierre_carrera: "Carrera",
  cierre_sin_pizarra: "Carrera",
  plano_encabezado: "Plano",
  resultado_liquidacion: "Plano",
  correccion_pedagogica_dm: "Pedagogía",
  bienvenida_individual: "Varios",
  mensaje_grupo: "Varios",
  mensaje_individual: "Varios",
};

const EJEMPLOS: Record<string, string> = {
  nombre: "Juan",
  jugador: "@Juan Pérez",
  codigo_sala: "ABC-123",
  grupo: "Grupo Oficial",
  saldo_disponible: "25.000",
  encabezado: "📋 SALA DE JUEGOS",
  conector: "→",
  numero_jugada: "#12",
  juega: "1P 5",
  da: "3x5",
  modalidad: "Puesto",
  proporcion: "1 a 2",
  monto: "10.000",
  riesgo_juega: "Medio",
  riesgo_da: "Bajo",
  saldo_de: "@Pedro",
  saldo: "25.000",
  hipodromo: "LA RINCONADA",
  carrera: "4",
  retirados: "Ninguno",
  fecha: "21/11/2026",
  pizarra: "5-3-2",
  total_jugadas: "8",
  resumen: "• 4 jugadas ganadoras",
  positivos: "🟢 @Juan +30.000",
  negativos: "🔴 @Pedro -10.000",
  texto: "juego 1p 5 20mil",
};

const ORIGEN_ESTILO: Record<Origen, string> = {
  grupo: "border-cyan-200 bg-cyan-50 text-cyan-700",
  global: "border-violet-200 bg-violet-50 text-violet-700",
  default: "border-slate-200 bg-slate-100 text-slate-600",
};
const ORIGEN_ETIQUETA: Record<Origen, string> = {
  grupo: "Grupo",
  global: "Global",
  default: "Default",
};

function categoriaDe(clave: string): Categoria {
  return CATEGORIA_POR_CLAVE[clave] || "Varios";
}

function valorEjemplo(variable: string): string {
  const limpia = variable.replace(/^\{|\}$/g, "");
  return EJEMPLOS[limpia] ?? `{${limpia}}`;
}

export default function ModalPlantillasGlobales({
  open,
  onClose,
  grupoId,
  salaId = null,
}: Props) {
  const [montado, setMontado] = useState(false);
  const [tab, setTab] = useState<Tab>("catalogo");
  const [alcance, setAlcance] = useState<"GLOBAL" | "GRUPO">(
    grupoId ? "GRUPO" : "GLOBAL"
  );
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<Categoria | "Todas">("Todas");
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [seleccion, setSeleccion] = useState<string>(
    PLANTILLAS_GRUPO_DEFAULT[0]?.clave || ""
  );
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaSeleccionada, setSalaSeleccionada] = useState<string>(salaId || "");
  const [cargandoSalas, setCargandoSalas] = useState(false);
  const [textoGrupo, setTextoGrupo] = useState("");
  const [enviandoGrupo, setEnviandoGrupo] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [textoDm, setTextoDm] = useState("");
  const [enviandoDm, setEnviandoDm] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!open) return;
    const alEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alEscape);
    return () => window.removeEventListener("keydown", alEscape);
  }, [open, onClose]);

  const cargarPlantillas = useCallback(async () => {
    if (!open) return;
    if (alcance === "GRUPO" && !grupoId) {
      setPlantillas([]);
      setAviso({
        tipo: "error",
        texto: "No hay un grupo resuelto. Elegí el alcance Global para editar plantillas compartidas.",
      });
      return;
    }
    setCargando(true);
    setAviso(null);
    try {
      const objetivo = alcance === "GLOBAL" ? "GLOBAL" : encodeURIComponent(grupoId);
      const res = await fetch(`/api/whatsapp-sala/plantillas?grupo_id=${objetivo}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "No se pudieron cargar las plantillas");
      }
      const lista: Plantilla[] = Array.isArray(data.plantillas) ? data.plantillas : [];
      setPlantillas(lista);
      setBorradores(
        Object.fromEntries(lista.map((p) => [p.clave, p.contenido || ""]))
      );
      setSeleccion((prev) =>
        lista.some((p) => p.clave === prev) ? prev : lista[0]?.clave || ""
      );
      const porClave = new Map(lista.map((p) => [p.clave, p.contenido || ""]));
      setTextoGrupo((prev) => prev || porClave.get("mensaje_grupo") || "");
      setTextoDm((prev) => prev || porClave.get("mensaje_individual") || "");
    } catch (err: any) {
      setAviso({
        tipo: "error",
        texto: err?.message || "No se pudieron cargar las plantillas",
      });
    } finally {
      setCargando(false);
    }
  }, [open, alcance, grupoId]);

  useEffect(() => {
    void cargarPlantillas();
  }, [cargarPlantillas]);

  const cargarSalas = useCallback(async () => {
    if (!open) return;
    setCargandoSalas(true);
    try {
      const qs = grupoId ? `?grupo_id=${encodeURIComponent(grupoId)}` : "";
      const res = await fetch(`/api/whatsapp-sala/salas-grupos${qs}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      const lista: Sala[] = Array.isArray(data?.salas) ? data.salas : [];
      setSalas(lista);
      setSalaSeleccionada((prev) =>
        prev || (salaId ? String(salaId) : lista[0]?.id ? String(lista[0].id) : "")
      );
    } catch {
      setSalas([]);
    } finally {
      setCargandoSalas(false);
    }
  }, [open, grupoId, salaId]);

  useEffect(() => {
    if (open && tab === "grupo") void cargarSalas();
  }, [open, tab, cargarSalas]);

  const guardarClave = useCallback(
    async (clave: string, contenido: string): Promise<boolean> => {
      if (alcance === "GRUPO" && !grupoId) {
        setAviso({ tipo: "error", texto: "Se requiere un grupo para guardar." });
        return false;
      }
      setGuardando(true);
      setAviso(null);
      try {
        const res = await fetch("/api/whatsapp-sala/plantillas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grupo_id: alcance === "GLOBAL" ? null : grupoId,
            clave,
            contenido,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok || data?.guardado === false) {
          throw new Error(data?.error || "No se pudo guardar la plantilla");
        }
        setAviso({
          tipo: "ok",
          texto: `✅ "${clave}" guardada como ${
            data?.origen === "global" ? "global" : "del grupo"
          }.`,
        });
        await cargarPlantillas();
        return true;
      } catch (err: any) {
        setAviso({
          tipo: "error",
          texto: err?.message || "No se pudo guardar la plantilla",
        });
        return false;
      } finally {
        setGuardando(false);
      }
    },
    [alcance, grupoId, cargarPlantillas]
  );

  const plantillaSel = plantillas.find((p) => p.clave === seleccion) || null;
  const textoSeleccion = borradores[seleccion] ?? plantillaSel?.contenido ?? "";
  const vistaPrevia = aplicarVariablesPlantilla(textoSeleccion, EJEMPLOS);

  const filtradas = useMemo(
    () =>
      plantillas.filter((p) => {
        const coincide = `${p.clave} ${p.titulo}`
          .toLowerCase()
          .includes(busqueda.trim().toLowerCase());
        const porCategoria = categoria === "Todas" || categoriaDe(p.clave) === categoria;
        return coincide && porCategoria;
      }),
    [plantillas, busqueda, categoria]
  );

  function insertarVariable(
    variable: string,
    destino: "catalogo" | "bienvenida" | "dm"
  ) {
    const token = `{${variable.replace(/^\{|\}$/g, "")}}`;
    if (destino === "dm") {
      setTextoDm((prev) => `${prev}${token}`.trim());
      return;
    }
    const clave = destino === "bienvenida" ? "bienvenida_individual" : seleccion;
    const actual = borradores[clave] ?? "";
    const textarea = editorRef.current;
    const inicio = textarea?.selectionStart ?? actual.length;
    const fin = textarea?.selectionEnd ?? inicio;
    const nuevo = `${actual.slice(0, inicio)}${token}${actual.slice(fin)}`;
    setBorradores((prev) => ({ ...prev, [clave]: nuevo }));
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = inicio + token.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  function usarComoMensaje(clave: "mensaje_grupo" | "mensaje_individual") {
    const contenido = borradores[clave] || "";
    if (clave === "mensaje_grupo") setTextoGrupo(contenido);
    else setTextoDm(contenido);
    setAviso({
      tipo: "ok",
      texto: `📝 Texto de "${clave}" cargado. Revisalo antes de enviar.`,
    });
  }

  async function enviarAlGrupo() {
    if (!salaSeleccionada || !textoGrupo.trim()) {
      setAviso({ tipo: "error", texto: "Elegí una sala y escribí el mensaje." });
      return;
    }
    setEnviandoGrupo(true);
    setAviso(null);
    try {
      const res = await fetch("/api/whatsapp-sala/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salaId: salaSeleccionada,
          grupoId: grupoId || null,
          texto: textoGrupo.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.motivo || data?.error || "No se pudo enviar al grupo");
      }
      setAviso({
        tipo: data?.publicadoWhatsApp ? "ok" : "error",
        texto: data?.publicadoWhatsApp
          ? "📤 Mensaje enviado al grupo de WhatsApp."
          : `Mensaje guardado, pero Baileys no confirmó la publicación: ${
              data?.motivoBot || "sin respuesta del demonio"
            }`,
      });
    } catch (err: any) {
      setAviso({ tipo: "error", texto: err?.message || "No se pudo enviar al grupo" });
    } finally {
      setEnviandoGrupo(false);
    }
  }

  async function enviarPrivado() {
    if (!telefono.trim() || !textoDm.trim()) {
      setAviso({ tipo: "error", texto: "Ingresá el teléfono/JID y el mensaje." });
      return;
    }
    setEnviandoDm(true);
    setAviso(null);
    try {
      const res = await fetch("/api/whatsapp-sala/enviar-privado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefonoOjid: telefono.trim(),
          texto: textoDm.trim(),
          grupoId: grupoId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "No se pudo enviar el mensaje privado");
      }
      setAviso({ tipo: "ok", texto: "📨 Mensaje privado enviado." });
    } catch (err: any) {
      setAviso({ tipo: "error", texto: err?.message || "No se pudo enviar el DM" });
    } finally {
      setEnviandoDm(false);
    }
  }

  if (!open || !montado) return null;

  const bienvenida = plantillas.find((p) => p.clave === "bienvenida_individual");
  const bienvenidaTexto = borradores.bienvenida_individual ?? bienvenida?.contenido ?? "";
  const bienvenidaPreview = aplicarVariablesPlantilla(bienvenidaTexto, EJEMPLOS);

  const pestañas: { id: Tab; etiqueta: string }[] = [
    { id: "catalogo", etiqueta: "🌐 Global / 🎯 Por grupo" },
    { id: "grupo", etiqueta: "💬 Mensajes al grupo" },
    { id: "individual", etiqueta: "🙋 Mensajes individuales" },
    { id: "bienvenida", etiqueta: "👋 Bienvenida" },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-2 sm:p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] transition-opacity duration-200"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-plantillas-titulo"
        className="relative z-10 flex max-h-[92vh] w-full max-w-6xl animate-bet-slip-dock flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2
              id="modal-plantillas-titulo"
              className="text-sm font-black uppercase tracking-wide text-slate-900"
            >
              🧩 Plantillas y mensajes de WhatsApp
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Editá textos globales o del grupo, enviá mensajes al grupo por DM y configurá la bienvenida.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar modal de plantillas"
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            ✕ Cerrar
          </button>
        </div>

        {/* Pestañas */}
        <nav
          role="tablist"
          aria-label="Secciones de plantillas"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2"
        >
          {pestañas.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              id={`tab-plantillas-${p.id}`}
              aria-selected={tab === p.id}
              aria-controls={`panel-plantillas-${p.id}`}
              onClick={() => {
                setTab(p.id);
                setAviso(null);
              }}
              className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-black transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                tab === p.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "border border-transparent text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p.etiqueta}
            </button>
          ))}
        </nav>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {aviso && (
            <div
              role="status"
              aria-live="polite"
              className={`mb-4 rounded-xl border px-3 py-2 text-[11px] font-bold ${
                aviso.tipo === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {aviso.texto}
            </div>
          )}

          {tab === "catalogo" && (
            <div
              role="tabpanel"
              id="panel-plantillas-catalogo"
              aria-labelledby="tab-plantillas-catalogo"
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    aria-pressed={alcance === "GLOBAL"}
                    onClick={() => setAlcance("GLOBAL")}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${
                      alcance === "GLOBAL"
                        ? "bg-violet-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    🌐 Global
                  </button>
                  <button
                    type="button"
                    aria-pressed={alcance === "GRUPO"}
                    onClick={() => setAlcance("GRUPO")}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-black transition ${
                      alcance === "GRUPO"
                        ? "bg-cyan-600 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    🎯 Por grupo
                  </button>
                </div>
                <span className="text-[10px] font-bold text-slate-500">
                  {alcance === "GLOBAL"
                    ? "Aplica a todos los inquilinos"
                    : `Grupo: ${grupoId || "sin resolver"}`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="buscar-plantilla" className="sr-only">
                  Buscar plantilla por clave o título
                </label>
                <input
                  id="buscar-plantilla"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="🔍 Buscar por clave o título…"
                  className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none transition focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => void cargarPlantillas()}
                  disabled={cargando}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {cargando ? "Cargando…" : "⟳ Refrescar"}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5" aria-label="Filtrar por categoría">
                {(["Todas", ...CATEGORIAS] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={categoria === cat}
                    onClick={() => setCategoria(cat)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-black transition ${
                      categoria === cat
                        ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                <div>
                  <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-700">
                    Plantillas ({filtradas.length})
                  </h3>
                  <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                    {cargando && plantillas.length === 0 ? (
                      <div className="animate-pulse rounded-2xl border border-slate-200 bg-slate-100 px-4 py-6 text-center text-[11px] font-bold text-slate-500">
                        Cargando plantillas…
                      </div>
                    ) : filtradas.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-[11px] font-bold text-slate-500">
                        No hay plantillas para este filtro.
                      </div>
                    ) : (
                      filtradas.map((p) => (
                        <button
                          key={p.clave}
                          type="button"
                          onClick={() => setSeleccion(p.clave)}
                          aria-pressed={seleccion === p.clave}
                          className={`w-full rounded-2xl border p-3 text-left transition ${
                            seleccion === p.clave
                              ? "border-emerald-400 bg-emerald-50/70 shadow-sm"
                              : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-black text-slate-900">{p.titulo}</span>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${ORIGEN_ESTILO[p.origen]}`}
                            >
                              {ORIGEN_ETIQUETA[p.origen]}
                            </span>
                          </div>
                          <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                            {p.clave}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[10px] text-slate-600">
                            {p.descripcion}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {plantillaSel ? (
                    <>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-black text-slate-900">
                            {plantillaSel.titulo}
                          </h3>
                          <p className="font-mono text-[10px] text-slate-500">
                            {plantillaSel.clave}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${ORIGEN_ESTILO[plantillaSel.origen]}`}
                        >
                          {ORIGEN_ETIQUETA[plantillaSel.origen]}
                        </span>
                      </div>

                      <label htmlFor="editor-plantilla" className="sr-only">
                        Contenido de la plantilla
                      </label>
                      <textarea
                        id="editor-plantilla"
                        ref={editorRef}
                        value={textoSeleccion}
                        onChange={(e) =>
                          setBorradores((prev) => ({
                            ...prev,
                            [seleccion]: e.target.value,
                          }))
                        }
                        rows={6}
                        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500"
                        placeholder="Escribí aquí el texto de la plantilla…"
                      />

                      {plantillaSel.variables.length > 0 && (
                        <div className="mt-2">
                          <p className="mb-1 text-[10px] font-black uppercase text-slate-500">
                            Insertar variable
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {plantillaSel.variables.map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => insertarVariable(v, "catalogo")}
                                title={`Vista previa: ${valorEjemplo(v)}`}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-[10px] font-black text-emerald-700 transition hover:bg-emerald-100"
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="mb-1 text-[10px] font-black uppercase text-slate-500">
                          Vista previa en vivo
                        </p>
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-800">
                          {vistaPrevia || "—"}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void guardarClave(seleccion, textoSeleccion)}
                          disabled={guardando || (alcance === "GRUPO" && !grupoId)}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"
                        >
                          {guardando ? "Guardando…" : "💾 Guardar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const def = PLANTILLAS_GRUPO_DEFAULT.find(
                              (d) => d.clave === seleccion
                            );
                            if (!def) return;
                            setBorradores((prev) => ({ ...prev, [seleccion]: def.contenido }));
                            setAviso({
                              tipo: "ok",
                              texto: "↩️ Texto default restaurado. Guardá para aplicarlo.",
                            });
                          }}
                          disabled={guardando}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                        >
                          ↩️ Restaurar default
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="py-8 text-center text-xs font-bold text-slate-500">
                      Seleccioná una plantilla de la lista.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "grupo" && (
            <div
              role="tabpanel"
              id="panel-plantillas-grupo"
              aria-labelledby="tab-plantillas-grupo"
              className="mx-auto max-w-3xl space-y-3"
            >
              <div>
                <label
                  htmlFor="selector-sala-plantillas"
                  className="mb-1 block text-[11px] font-black uppercase text-slate-600"
                >
                  Sala de juegos
                </label>
                <select
                  id="selector-sala-plantillas"
                  value={salaSeleccionada}
                  onChange={(e) => setSalaSeleccionada(e.target.value)}
                  disabled={cargandoSalas}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none transition focus:border-emerald-500 disabled:opacity-50"
                >
                  <option value="">
                    {cargandoSalas ? "Cargando salas…" : "Seleccioná una sala"}
                  </option>
                  {salas.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre_sala || s.whatsapp_group_nombre || s.id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="texto-grupo" className="text-[11px] font-black uppercase text-slate-600">
                    Mensaje
                  </label>
                  <button
                    type="button"
                    onClick={() => usarComoMensaje("mensaje_grupo")}
                    className="text-[10px] font-bold text-emerald-700 underline"
                  >
                    Usar plantilla “Mensaje Libre al Grupo”
                  </button>
                </div>
                <textarea
                  id="texto-grupo"
                  value={textoGrupo}
                  onChange={(e) => setTextoGrupo(e.target.value)}
                  rows={8}
                  placeholder="Escribí el mensaje que se publicará en el grupo…"
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500"
                />
              </div>

              <button
                type="button"
                onClick={() => void enviarAlGrupo()}
                disabled={enviandoGrupo || !salaSeleccionada || !textoGrupo.trim()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-[11px] font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"
              >
                {enviandoGrupo ? "Enviando…" : "📤 Enviar al grupo"}
              </button>
            </div>
          )}

          {tab === "individual" && (
            <div
              role="tabpanel"
              id="panel-plantillas-individual"
              aria-labelledby="tab-plantillas-individual"
              className="mx-auto max-w-3xl space-y-3"
            >
              <div>
                <label htmlFor="telefono-dm" className="mb-1 block text-[11px] font-black uppercase text-slate-600">
                  Teléfono o JID del jugador
                </label>
                <input
                  id="telefono-dm"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="584121234567 o 584121234567@s.whatsapp.net"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none transition focus:border-emerald-500"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="texto-dm" className="text-[11px] font-black uppercase text-slate-600">
                    Mensaje privado
                  </label>
                  <button
                    type="button"
                    onClick={() => usarComoMensaje("mensaje_individual")}
                    className="text-[10px] font-bold text-emerald-700 underline"
                  >
                    Usar plantilla “Mensaje Libre Individual”
                  </button>
                </div>
                <textarea
                  id="texto-dm"
                  value={textoDm}
                  onChange={(e) => setTextoDm(e.target.value)}
                  rows={8}
                  placeholder="Escribí el mensaje que se enviará por DM…"
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void enviarPrivado()}
                  disabled={enviandoDm || !telefono.trim() || !textoDm.trim()}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-[11px] font-black text-white transition hover:bg-cyan-500 disabled:opacity-40"
                >
                  {enviandoDm ? "Enviando…" : "📨 Enviar por DM"}
                </button>
                {alcance === "GLOBAL" && (
                  <span className="text-[10px] font-bold text-slate-500">
                    La plantilla editable se guarda en el alcance Global seleccionado.
                  </span>
                )}
              </div>
            </div>
          )}

          {tab === "bienvenida" && (
            <div
              role="tabpanel"
              id="panel-plantillas-bienvenida"
              aria-labelledby="tab-plantillas-bienvenida"
              className="mx-auto max-w-4xl space-y-3"
            >
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 text-[11px] font-bold leading-relaxed text-cyan-800">
                👋 Este mensaje se envía automáticamente por DM la primera vez que el jugador
                escribe al grupo. Usalo para darle la bienvenida, indicar el código de sala y
                recordarle su saldo disponible.
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-xs font-black text-slate-900">
                      bienvenida_individual
                    </h3>
                    {bienvenida && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${ORIGEN_ESTILO[bienvenida.origen]}`}
                      >
                        {ORIGEN_ETIQUETA[bienvenida.origen]}
                      </span>
                    )}
                  </div>
                  <label htmlFor="editor-bienvenida" className="sr-only">
                    Texto de bienvenida individual
                  </label>
                  <textarea
                    id="editor-bienvenida"
                    ref={editorRef}
                    value={bienvenidaTexto}
                    onChange={(e) =>
                      setBorradores((prev) => ({
                        ...prev,
                        bienvenida_individual: e.target.value,
                      }))
                    }
                    rows={9}
                    className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 outline-none transition focus:border-emerald-500"
                    placeholder="Escribí el mensaje de bienvenida…"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(bienvenida?.variables || PLANTILLAS_GRUPO_DEFAULT.find(
                      (d) => d.clave === "bienvenida_individual"
                    )?.variables || []).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertarVariable(v, "bienvenida")}
                        title={`Vista previa: ${valorEjemplo(v)}`}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 font-mono text-[10px] font-black text-emerald-700 transition hover:bg-emerald-100"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void guardarClave("bienvenida_individual", bienvenidaTexto)
                    }
                    disabled={guardando || (alcance === "GRUPO" && !grupoId)}
                    className="mt-3 rounded-xl bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {guardando ? "Guardando…" : "💾 Guardar bienvenida"}
                  </button>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-[10px] font-black uppercase text-slate-500">
                    Vista previa en vivo
                  </p>
                  <div className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
                    {bienvenidaPreview || "—"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <p className="text-[10px] font-bold text-slate-500">
            Alcance actual: {alcance === "GLOBAL" ? "🌐 Global" : `🎯 Grupo ${grupoId || ""}`}
            {" · "}Los cambios impactan al bot al guardar.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
