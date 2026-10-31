"use client";

/**
 * MODAL DE ACCIÓN sobre una jugada del REPORTE (Marcas / Tablas Fijas).
 *
 * Un solo modal para los tres modos —corregir, anular y restaurar—, con el
 * motivo OBLIGATORIO (la operación queda auditada). No existe el "crear": la
 * venta se hace por su flujo (Taquilla / Tablas / Marcas).
 *
 * EDICIÓN TOTAL
 * -------------
 * El modo "corregir" habilita TODOS los campos del ticket:
 *   · Jugador 1 (juega) y Jugador 2 (paga/banquero);
 *   · Monto / precio y premio a pagar;
 *   · Tipo de jugada (nomenclatura);
 *   · Ejemplar(es) y su Nº (con SINCRONIZACIÓN nº→nombre oficial del padrón);
 *   · Estado (los estados MAESTROS: Pendiente / Liquidada / Anulada).
 *
 * NOTAS PREDEFINIDAS
 * ------------------
 * El motivo de la corrección se compone de una NOTA PREDEFINIDA (una de las 5
 * de `NOTAS_PREDEFINIDAS_EDICION`) más un detalle libre, para no reescribir a
 * mano lo mismo en cada corrección.
 *
 * RECÁLCULO
 * ---------
 * Al guardar, `edicion-reporte.ts` rehace la carrera si YA está liquidada, así
 * los totales del reporte (cobrado / pagado / comisión de grupo / balance)
 * quedan recalculados.
 *
 * El permiso NO se decide acá: la puerta está en `edicion-reporte.ts`
 * (perfil Administrador Principal). Este componente solo pinta y llama.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/shared/components/ui/Button";
import {
  MOTIVOS_ANULACION,
  NOTAS_PREDEFINIDAS_EDICION,
  componerNota,
  type EditablesJugada,
} from "@/features/jugadas/lib/jugadas";
import type { VentaTablaReporte } from "@/features/tablas/lib/reporte-tablas-nucleo";
import {
  anularJugadaDeReporte,
  editarJugadaDeReporte,
  restaurarJugadaDeReporte,
} from "@/features/reportes/lib/edicion-reporte";
import { ETIQUETA_ESTADO, ESTADOS_MAESTROS, estadoMaestro, type EstadoMaestro } from "@/features/liquidacion/lib/estados-jugada";
import { nombreOficialDeCaballoSuelto } from "@/features/liquidacion/lib/resolver-ejemplar";
import { ETIQUETA_ADELANTADA, ETIQUETA_EN_VIVO, type ModalidadTiempo } from "@/features/jugadas/lib/modalidad-tiempo";
import { leerCarrerasMaestro, aCarreraCentral } from "@/features/carreras/lib/maestro";
import { listarGruposVenta, jugadoresDeGrupo, type ClienteVenta } from "@/features/grupos/lib/grupos";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";

export type ModoAccionJugada = "editar" | "anular" | "restaurar";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 focus:border-slate-400 focus:outline-none";

/**
 * Estado MAESTRO que el operador elige. Se mapea al estado INTERNO que entiende
 * el motor: PENDIENTE→"Pendiente", LIQUIDADA→se conserva el interno actual
 * (Ganador/Perdedor/Retirado) o "Ganador" si venía pendiente, ANULADA→"Anulado".
 */
const ESTADOS_MAESTROS_UI: readonly EstadoMaestro[] = ESTADOS_MAESTROS;

const TITULO: Record<ModoAccionJugada, string> = {
  editar: "✏️ Corregir jugada",
  anular: "🚫 Anular jugada",
  restaurar: "♻️ Restaurar jugada",
};

const EXITO: Record<ModoAccionJugada, string> = {
  editar: "Jugada corregida.",
  anular: "Jugada anulada.",
  restaurar: "Jugada restaurada.",
};

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function ModalAccionJugadaReporte({
  venta,
  modo,
  onCancelar,
  onHecho,
}: {
  venta: VentaTablaReporte;
  modo: ModoAccionJugada;
  onCancelar: () => void;
  /** Se llama con un mensaje de éxito (o el aviso de auditoría) y ya cerrado. */
  onHecho: (mensaje: string) => void;
}) {
  const [nombreJugada, setNombreJugada] = useState(
    venta.nombreJugada || (venta.numero ? `TABLA FIJA · ${venta.numero}` : "TABLA FIJA")
  );
  const [jugador1, setJugador1] = useState(venta.jugador ?? "");
  const [jugador1Id, setJugador1Id] = useState(venta.jugadorId ?? "");
  const [jugador2, setJugador2] = useState("");
  const [jugador2Id, setJugador2Id] = useState("");
  const [grupoId, setGrupoId] = useState(venta.grupoId ?? "");
  const [grupoNombre, setGrupoNombre] = useState(venta.grupo ?? "");
  const [caballo, setCaballo] = useState(venta.caballo ?? "");
  const [ejemplar, setEjemplar] = useState(venta.numero ?? "");
  const [jugadoresGrupo, setJugadoresGrupo] = useState<ClienteVenta[]>([]);
  const [cargandoJugadores, setCargandoJugadores] = useState(false);
  /** Padrón de la carrera: permite elegir el ejemplar y autocompletar etiquetas. */
  const [ejemplaresCarrera, setEjemplaresCarrera] = useState<Array<{ numero: string; nombre: string }>>([]);
  /** Nombre oficial resuelto del padrón al cambiar el Nº ("" = no se pudo). */
  const [nombreOficial, setNombreOficial] = useState("");
  const [monto, setMonto] = useState(venta.monto ? String(venta.monto) : "");
  const [premio, setPremio] = useState(venta.pagado ? String(venta.pagado) : "");
  const [estado, setEstado] = useState<EstadoMaestro>(() => estadoMaestro({ estado: venta.estado, anulada: venta.anulada }));
  /**
   * Modalidad de tiempo: ⚡ En Vivo (por defecto) o ⏳ Adelantada. Se muestra el
   * valor que YA tiene la jugada (`venta.adelantada`) y se puede cambiar acá.
   */
  const [modalidad, setModalidad] = useState<ModalidadTiempo>(() =>
    venta.adelantada ? "ADELANTADA" : "EN_VIVO"
  );
  const [grupos, setGrupos] = useState<Array<{ id: string; nombre: string }>>([]);
  const [nota, setNota] = useState<string>("");
  const [detalle, setDetalle] = useState("");
  const [motivoLibre, setMotivoLibre] = useState(modo === "anular" ? MOTIVOS_ANULACION[0] : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelar]);

  // Carga el padrón de la carrera para poder cambiar el ejemplar con etiqueta automática.
  useEffect(() => {
    if (modo !== "editar") return;
    let cancelado = false;
    (async () => {
      try {
        const m = await leerCarrerasMaestro(venta.fecha, venta.hipodromo);
        if (cancelado || !m.ok) return;
        const f = m.filas.find((x) => Number(x.carrera) === Number(venta.carrera));
        if (!f) return;
        const c = aCarreraCentral(f);
        const lista = (c.caballos ?? [])
          .map((x) => ({ numero: String(x.numero ?? "").trim(), nombre: String(x.nombre ?? "").trim() }))
          .filter((x) => x.numero);
        if (!cancelado) setEjemplaresCarrera(lista);
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [modo, venta.fecha, venta.hipodromo, venta.carrera]);

  // Carga la lista de grupos para reasignar la jugada desde el reporte.
  useEffect(() => {
    if (modo !== "editar") return;
    let cancelado = false;
    (async () => {
      try {
        const gs = await listarGruposVenta();
        if (cancelado) return;
        const lista = (gs ?? [])
          .map((g: any) => ({ id: String(g?.id ?? ""), nombre: String(g?.nombre ?? "").trim() }))
          .filter((g: any) => g.id && g.nombre);
        if (!cancelado) {
          setGrupos(lista);
          // Sincronizar ID de grupo si venta.grupoId no coincide con un ID pero sí con el nombre
          const idActual = (grupoId || venta.grupoId || "").trim();
          const nombreActual = (grupoNombre || venta.grupo || "").trim().toLowerCase();
          const coincidePorId = lista.find((x) => x.id === idActual);
          if (!coincidePorId && nombreActual) {
            const coincidePorNombre = lista.find((x) => x.nombre.trim().toLowerCase() === nombreActual);
            if (coincidePorNombre) {
              setGrupoId(coincidePorNombre.id);
              setGrupoNombre(coincidePorNombre.nombre);
            }
          } else if (coincidePorId && !grupoNombre) {
            setGrupoNombre(coincidePorId.nombre);
          }
        }
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [modo, venta.grupo, venta.grupoId]);

  // Carga los jugadores del grupo seleccionado para permitir buscarlos y corregirlos
  useEffect(() => {
    if (modo !== "editar") return;
    const gid = (grupoId || venta.grupoId || "").trim();
    if (!gid) {
      setJugadoresGrupo([]);
      return;
    }
    let cancelado = false;
    setCargandoJugadores(true);
    (async () => {
      try {
        let idParaBuscar = gid;
        if (grupos.length > 0 && !grupos.some((g) => g.id === gid)) {
          const porNombre = grupos.find((g) => g.nombre.trim().toLowerCase() === gid.toLowerCase());
          if (porNombre) idParaBuscar = porNombre.id;
        }
        const js = await jugadoresDeGrupo(idParaBuscar);
        if (cancelado) return;
        setJugadoresGrupo(js);

        // Si el jugador 1 no tiene ID, asociarlo si hay match exacto
        if (jugador1 && !jugador1Id) {
          const exacto = js.find((x) => x.nombre.trim().toLowerCase() === jugador1.trim().toLowerCase());
          if (exacto) setJugador1Id(String(exacto.id));
        }
      } catch {
        if (!cancelado) setJugadoresGrupo([]);
      } finally {
        if (!cancelado) setCargandoJugadores(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [modo, grupoId, venta.grupoId, grupos]);

  const opcionesJugadores = useMemo(() => {
    return jugadoresGrupo.map((j) => {
      const saldo = j.saldo_actual ?? 0;
      const aval = j.aval ?? 0;
      const detalle = j.libre
        ? "libre"
        : `Disp. $${(saldo + aval).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${aval > 0 ? ` (aval ${aval})` : ""}`;
      return {
        value: String(j.id),
        label: `${j.nombre} · ${detalle}`,
      };
    });
  }, [jugadoresGrupo]);

  const seleccionarGrupo = (gid: string) => {
    setGrupoId(gid);
    const g = grupos.find((x) => x.id === gid);
    setGrupoNombre(g?.nombre ?? (gid === "" ? venta.grupo ?? "" : ""));
  };

  const seleccionarJugador1 = (val: string) => {
    const encontrado = jugadoresGrupo.find((j) => String(j.id) === String(val));
    if (encontrado) {
      setJugador1(encontrado.nombre);
      setJugador1Id(String(encontrado.id));
    } else {
      setJugador1(val);
      setJugador1Id("");
    }
  };

  const seleccionarJugador2 = (val: string) => {
    const encontrado = jugadoresGrupo.find((j) => String(j.id) === String(val));
    if (encontrado) {
      setJugador2(encontrado.nombre);
      setJugador2Id(String(encontrado.id));
    } else {
      setJugador2(val);
      setJugador2Id("");
    }
  };

  /**
   * Al cambiar el Nº de ejemplar, busca el nombre OFICIAL en el padrón de la
   * carrera y lo deja listo para guardar. Esto resuelve el bug de que quedaba el
   * nombre del caballo ANTERIOR (ej. "ETNA'S NAPPER(USA)") con el Nº nuevo.
   */
  const cambiarEjemplar = async (valor: string) => {
    const limpio = valor.replace(/\D/g, "");
    setEjemplar(limpio);
    setNombreOficial("");
    if (!/^[0-9]+$/.test(limpio)) {
      setCaballo(valor.trim());
      return;
    }
    // Primero intenta con el padrón ya cargado (más rápido, etiqueta automática).
    const delPadron = ejemplaresCarrera.find((x) => x.numero === limpio);
    if (delPadron?.nombre) {
      setNombreOficial(delPadron.nombre);
      setCaballo(delPadron.nombre);
      return;
    }
    const nombre = await nombreOficialDeCaballoSuelto({
      fecha: venta.fecha,
      hipodromo: venta.hipodromo,
      carrera: venta.carrera,
      caballo: limpio,
    });
    if (nombre) {
      setNombreOficial(nombre);
      // El campo `caballo` (etiqueta) pasa a mostrar el nombre real del Nº nuevo.
      setCaballo(nombre);
    }
  };

  /** Selección desde el padrón precargado: autocompleta Nº, nombre/etiqueta y oficial. */
  const seleccionarEjemplar = (numero: string) => {
    if (!numero) return;
    setEjemplar(numero);
    setNombreOficial("");
    const delPadron = ejemplaresCarrera.find((x) => x.numero === numero);
    if (delPadron?.nombre) {
      setNombreOficial(delPadron.nombre);
      setCaballo(delPadron.nombre);
      return;
    }
    void cambiarEjemplar(numero);
  };

  const confirmar = async () => {
    setError("");
    const motivoEdicion = componerNota(nota, detalle) || motivoLibre;
    if (modo === "editar" && !motivoEdicion.trim()) {
      setError("Indicá el motivo/nota de la corrección.");
      return;
    }
    if (modo === "anular" && !motivoLibre.trim()) {
      setError("Indicá el motivo de la anulación.");
      return;
    }
    setGuardando(true);
    const ctx = { hipodromo: venta.hipodromo, carrera: venta.carrera, fecha: venta.fecha };
    try {
      let r;
      if (modo === "editar") {
        // Estado INTERNO derivado del maestro elegido. LIQUIDADA respeta el estado
        // actual del ticket (no inventa un ganador): solo cambia si venía pendiente.
        const estadoInterno =
          estado === "ANULADA" ? "Anulado" : estado === "PENDIENTE" ? "Pendiente" : venta.estado || "Ganador";

        const numFinal =
          ejemplar.trim() !== ""
            ? Number(ejemplar)
            : /^\d+$/.test(caballo.trim())
              ? Number(caballo.trim())
              : null;
        const cabFinal = caballo.trim() || (numFinal != null ? String(numFinal) : null);

        r = await editarJugadaDeReporte(
          venta.id,
          {
            nombre_jugada: nombreJugada.trim() || null,
            caballo: cabFinal,
            cliente_juega_id: jugador1Id.trim() || null,
            cliente_juega_nombre: jugador1.trim() || null,
            cliente_consigue_id: jugador2Id.trim() || null,
            cliente_consigue_nombre: jugador2.trim() || null,
            grupo_cobro_id: grupoId.trim() || null,
            grupo_cobro_nombre: grupoNombre.trim() || null,
            ejemplar_numero: numFinal,
            monto_jugado: monto.trim() === "" ? null : Number(monto),
            premio_pagar: premio.trim() === "" ? null : Number(premio),
            estado: estadoInterno,
            es_adelantada: modalidad === "ADELANTADA",
          } as EditablesJugada,
          motivoEdicion.trim(),
          ctx
        );
      } else if (modo === "anular") {
        r = await anularJugadaDeReporte(
          venta.id,
          detalle.trim() ? `${motivoLibre} · ${detalle.trim()}` : motivoLibre,
          ctx
        );
      } else {
        r = await restaurarJugadaDeReporte(venta.id, motivoLibre.trim() || "Restauración desde el reporte", ctx);
      }
      setGuardando(false);
      if (!r.ok) {
        setError(r.error ?? "No se pudo aplicar el cambio.");
        return;
      }
      onHecho(r.error ?? EXITO[modo]);
    } catch (e) {
      setGuardando(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cabecera = `${venta.hipodromo} · C${venta.carrera} · ${venta.caballo || "—"}`;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancelar();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-800">{TITULO[modo]}</h3>
            <p className="truncate text-[10px] font-semibold text-slate-500">{cabecera}</p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            title="Cerrar (Esc)"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-4">
          <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
            Jugador: <b className="text-slate-800">{venta.jugador || "—"}</b> · Grupo:{" "}
            <b className="text-slate-800">{venta.grupo || "—"}</b> · Monto:{" "}
            <b className="text-slate-800">{venta.monto.toLocaleString("es-VE")}</b>
          </div>

          {modo === "editar" ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Grupo de cobro">
                <select
                  value={grupoId}
                  onChange={(e) => seleccionarGrupo(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Sin cambiar / actual —</option>
                  {grupos.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nombre}
                    </option>
                  ))}
                </select>
              </Campo>

              <Campo label="Tipo de jugada (nomenclatura)">
                <input
                  value={nombreJugada}
                  onChange={(e) => setNombreJugada(e.target.value)}
                  placeholder="ej. TABLA FIJA, MARCA, DUPLETA…"
                  className={inputCls}
                />
              </Campo>

              <Campo label="Jugador 1 (juega / usuario del grupo)">
                <SearchableSelect
                  options={opcionesJugadores}
                  value={jugador1Id || jugador1}
                  displayValue={jugador1}
                  onChange={seleccionarJugador1}
                  allowCustom={true}
                  placeholder={
                    cargandoJugadores
                      ? "Cargando jugadores del grupo…"
                      : opcionesJugadores.length > 0
                        ? "Buscar jugador del grupo…"
                        : "Buscar o escribir jugador…"
                  }
                  inputClassName={inputCls}
                />
                {jugadoresGrupo.length > 0 && (
                  <span className="mt-0.5 block text-[10px] text-slate-500">
                    👥 {jugadoresGrupo.length} jugador(es) en este grupo
                  </span>
                )}
              </Campo>

              <Campo label="Jugador 2 / paga (banquero)">
                <SearchableSelect
                  options={opcionesJugadores}
                  value={jugador2Id || jugador2}
                  displayValue={jugador2}
                  onChange={seleccionarJugador2}
                  allowCustom={true}
                  placeholder="Cliente que paga / banquero (opcional)"
                  inputClassName={inputCls}
                />
              </Campo>
              <Campo label="Ejemplar (desde carrera / etiqueta)">
                {ejemplaresCarrera.length > 0 ? (
                  <select
                    value={ejemplar}
                    onChange={(e) => seleccionarEjemplar(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— Seleccionar ejemplar del padrón —</option>
                    {ejemplaresCarrera.map((x) => (
                      <option key={x.numero} value={x.numero}>
                        {x.numero} · {x.nombre || "Sin nombre"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={caballo} onChange={(e) => setCaballo(e.target.value)} className={inputCls} />
                )}
              </Campo>
              <Campo label="Nº ejemplar">
                <input value={ejemplar} onChange={(e) => void cambiarEjemplar(e.target.value)} className={inputCls} />
                {nombreOficial && (
                  <span className="mt-0.5 block text-[10px] font-bold text-emerald-600">
                    ✓ Nombre oficial: {nombreOficial}
                  </span>
                )}
              </Campo>
              <Campo label="Nombre / etiqueta del ejemplar">
                <input value={caballo} onChange={(e) => setCaballo(e.target.value)} className={inputCls} />
              </Campo>
              <Campo label="Monto jugado">
                <input
                  value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputCls}
                />
              </Campo>
              <Campo label="Premio a pagar">
                <input
                  value={premio}
                  onChange={(e) => setPremio(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inputCls}
                />
              </Campo>
              <Campo label="Estado">
                <select
                  value={estado}
                  onChange={(e) => setEstado(e.target.value as EstadoMaestro)}
                  className={inputCls}
                >
                  {ESTADOS_MAESTROS_UI.map((m) => (
                    <option key={m} value={m}>
                      {ETIQUETA_ESTADO[m]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Modalidad de tiempo">
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                      modalidad === "ADELANTADA" ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                  />
                  <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setModalidad("EN_VIVO")}
                      aria-pressed={modalidad === "EN_VIVO"}
                      title="En Vivo: la jugada se cargó mientras la carrera corría."
                      className={`px-2 py-1 text-[10px] font-bold transition ${
                        modalidad === "EN_VIVO"
                          ? "bg-emerald-500 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {ETIQUETA_EN_VIVO}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalidad("ADELANTADA")}
                      aria-pressed={modalidad === "ADELANTADA"}
                      title="Adelantada: la jugada se cargó ANTES de que corra la carrera."
                      className={`border-l border-slate-300 px-2 py-1 text-[10px] font-bold transition ${
                        modalidad === "ADELANTADA"
                          ? "bg-amber-500 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {ETIQUETA_ADELANTADA}
                    </button>
                  </div>
                </div>
              </Campo>
              <Campo label="Nota predefinida">
                <select value={nota} onChange={(e) => setNota(e.target.value)} className={inputCls}>
                  <option value="">— Sin nota predefinida —</option>
                  {NOTAS_PREDEFINIDAS_EDICION.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Detalle adicional (opcional)">
                <input
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Texto adicional para la auditoría"
                  className={inputCls}
                />
              </Campo>
            </div>
          ) : modo === "anular" ? (
            <div className="space-y-3">
              <Campo label="Motivo (obligatorio)">
                <select value={motivoLibre} onChange={(e) => setMotivoLibre(e.target.value)} className={inputCls}>
                  {MOTIVOS_ANULACION.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Detalle (opcional)">
                <textarea
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  rows={3}
                  placeholder="Detalle adicional para el registro"
                  className={inputCls}
                />
              </Campo>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-600">
                Esta jugada está <b className="text-rose-600">anulada</b>. Al restaurarla vuelve a contar para el
                grupo y para la liquidación.
              </p>
              <Campo label="Motivo (por defecto: restauración desde el reporte)">
                <input
                  value={motivoLibre}
                  onChange={(e) => setMotivoLibre(e.target.value)}
                  placeholder="Restauración desde el reporte"
                  className={inputCls}
                />
              </Campo>
            </div>
          )}

          <p className="mt-3 text-[10px] font-semibold text-amber-600">
            Todo cambio queda auditado (usuario, motivo y snapshot). Si la carrera ya está LIQUIDADA, al guardar se
            recalcula completa (premios, comisión del grupo y balance).
          </p>

          {error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
              ⚠️ {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" disabled={guardando} onClick={() => void confirmar()}>
            {guardando ? "Aplicando…" : `${TITULO[modo]} `}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ModalAccionJugadaReporte;
