"use client";

/**
 * MODAL 🐎 REALIZAR JUGADA — PORTAL DEL USUARIO (PROMPT #6)
 * ========================================================
 * El jugador arma su jugada y la registra directo contra su grupo. Cuatro
 * tipos, con la carga adaptada a cada uno:
 *
 *   · 🏁 Tabla Fija → una tabla publicada, con sus ejemplares y valores; se
 *     elige ejemplar (o tabla completa) y cantidad.
 *   · 🎯 Polla → una de las pollas ABIERTAS del día, con un ejemplar por carrera
 *     (1ª a 6ª válida) para armar la combinación.
 *   · 🔀 Dupleta → las dos patas de una dupleta guardada y un ejemplar en cada una.
 *   · ⚔️ Marca → el caballo y su rival, calculados con la jerarquía de la carrera
 *     (`calcularRivales`), la misma que valida el servidor.
 *
 * Toda la validación "de forma" vive en el núcleo puro `jugada-usuario.ts`
 * (probado sin Supabase); acá queda la carga de ofertas y el armado del body.
 * El saldo disponible (saldo + aval, salvo modo libre) se muestra y se controla
 * antes de mandar; la RPC de venta lo vuelve a validar.
 *
 * Las ofertas de cada tipo se intentan cargar con las funciones de su módulo.
 * Si la tabla todavía no tiene datos, el tipo muestra un aviso claro y el
 * jugador puede cargar la jugada como "Jugada No Relacionada".
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { formatoMoneda } from "@/shared/lib/vzla";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { listarTablasPublicadas } from "@/features/tablas/lib/rpc";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { listarPollas, type Polla } from "@/features/pollas/lib/pollas";
import {
  claveDeDupleta,
  listarDupletasGuardadas,
  type DupletaEstado,
} from "@/features/dupletas/lib/dupletas";
import { listarConfigMarcas, type ConfigMarcas } from "@/features/marcas/lib/marcas";
import { calcularRivales } from "@/features/marcas/lib/jerarquia";
import { realizarJugada, type SesionPortal } from "@/features/portal/lib/portal";
import { calcularEstadoCuentaCliente } from "@/features/saldos/lib/contabilidad-central";
import {
  ETIQUETA_TIPO,
  TIPOS_JUGADA,
  cuerpoVenta,
  resumenJugada,
  validarJugada,
  type JugadaBorrador,
  type TipoJugada,
} from "@/features/portal/lib/jugada-usuario";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const hoyIso = (): string => {
  const d = new Date();
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const inp = "modal-campo font-bold";
const lbl = "modal-campo-label";

const n = (v: unknown): number => {
  const x = parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/** Saldo disponible real: (saldo + aval - riesgoEnCurso) vía Contabilidad Central, salvo modo libre (sin tope). */
export function disponibleDe(
  cliente: SesionPortal["cliente"],
  riesgoEnCurso = 0
): { monto: number | null; etiqueta: string } {
  if (String(cliente.modo_juego ?? "").toLowerCase().trim() === "libre") {
    return { monto: null, etiqueta: "Modo libre (sin tope de saldo)" };
  }
  const estado = calcularEstadoCuentaCliente({
    id: cliente.id,
    nombre: cliente.nombre ?? "",
    saldoBaseBd: n(cliente.saldo_actual),
    aval: n(cliente.aval),
    libre: false,
  });
  const saldo = estado.saldoContable;
  const aval = estado.aval;
  const riesgo = Math.max(0, n(riesgoEnCurso));
  const disponible = Math.max(0, saldo + aval - riesgo);
  return {
    monto: disponible,
    etiqueta:
      riesgo > 0
        ? `Saldo ${formatoMoneda("USD", saldo)} + Aval ${formatoMoneda("USD", aval)} − Riesgo ${formatoMoneda("USD", riesgo)}`
        : `Saldo ${formatoMoneda("USD", saldo)} + Aval ${formatoMoneda("USD", aval)}`,
  };
}

export function ModalRealizarJugadaUsuario({
  sesion,
  onCerrar,
  onRealizada,
  onPedirNoRelacionada,
}: {
  sesion: SesionPortal;
  onCerrar: () => void;
  onRealizada: () => void;
  onPedirNoRelacionada: () => void;
}) {
  const cliente = sesion.cliente;
  const disp = useMemo(
    () => disponibleDe(cliente, sesion.resumen?.riesgoEnCurso ?? 0),
    [cliente, sesion.resumen?.riesgoEnCurso]
  );

  const [tipo, setTipo] = useState<TipoJugada>("TABLA_FIJA");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  // --- Ofertas por tipo -----------------------------------------------------
  const [tablas, setTablas] = useState<TablaFijaRow[]>([]);
  const [pollas, setPollas] = useState<Polla[]>([]);
  const [dupletas, setDupletas] = useState<DupletaEstado[]>([]);
  const [marcas, setMarcas] = useState<ConfigMarcas[]>([]);

  useEffect(() => {
    void listarTablasPublicadas().then(setTablas);
    void listarPollas(hoyIso()).then((r) => setPollas((r.datos ?? []).filter((p) => p.estado === "Abierta")));
    void listarDupletasGuardadas().then(setDupletas);
    void listarConfigMarcas({ dia: hoyIso() }).then(setMarcas);
  }, []);

  // --- Borrador -------------------------------------------------------------
  const [b, setB] = useState<JugadaBorrador>({ tipo: "TABLA_FIJA", cantidad: 1, monto: "", fecha: hoyIso() });
  const set = <K extends keyof JugadaBorrador>(k: K, v: JugadaBorrador[K]) =>
    setB((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    setB((prev) => ({ ...prev, tipo }));
  }, [tipo]);

  // Selecciones derivadas.
  const tabla = tablas.find((t) => String(t.id) === String(b.tablaId)) ?? null;
  const polla = pollas.find((p) => String(p.id) === String(b.pollaId)) ?? null;
  const dupleta = dupletas.find((d) => claveDeDupleta(d) === String(b.claveDupleta ?? "")) ?? dupletas[0] ?? null;
  const marca = marcas.find((m) => String(m.id) === String(b.marcaId ?? "")) ?? marcas[0] ?? null;

  // Rivales legales del caballo elegido en la marca (misma jerarquía que el server).
  const analisis = useMemo(() => {
    if (!marca || !b.caballo) return null;
    return calcularRivales(
      b.caballo,
      marca.marcas,
      marca.nv,
      marca.debutantes,
      marca.debutantes_valen,
      b.rival ?? ""
    );
  }, [marca, b.caballo, b.rival]);

  const enviar = async () => {
    setError("");
    // Se completan los campos derivados que la RPC necesita (hipódromo, carrera).
    const completo: JugadaBorrador = { ...b };
    if (tipo === "TABLA_FIJA" && tabla) {
      completo.hipodromo = String(tabla.hipodromo ?? "");
      completo.carrera = tabla.carrera ?? 0;
    }
    if (tipo === "DUPLETA" && dupleta) {
      completo.hipodromo = dupleta.hipodromo;
      completo.fecha = dupleta.fecha;
      completo.carrera1 = dupleta.carrera1;
      completo.carrera2 = dupleta.carrera2;
    }
    if (tipo === "MARCA" && marca) {
      completo.hipodromo = marca.hipodromo;
      completo.fecha = marca.fecha;
      completo.carrera = marca.carrera;
      if (analisis?.rival) completo.rival = analisis.rival;
    }
    const v = validarJugada(completo, { montoDisponible: disp.monto });
    if (!v.ok) {
      setError(v.error);
      return toast(v.error, "warning");
    }
    setEnviando(true);
    const r = await realizarJugada(cuerpoVenta(completo));
    setEnviando(false);
    if (!r.ok) {
      setError(r.error ?? "No se pudo registrar la jugada.");
      return toast(r.error ?? "No se pudo registrar la jugada.", "error");
    }
    toast(`Jugada registrada · ${resumenJugada(completo)}`, "success");
    onRealizada();
    onCerrar();
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-editorial modal-editorial--acento-esmeralda" onClick={(e) => e.stopPropagation()}>
        <header className="modal-editorial__cabecera">
          <div className="modal-editorial__titulos">
            <h2 className="modal-editorial__titulo">🐎 Realizar Jugada</h2>
            <p className="modal-editorial__sub">Registrá tu jugada directo contra tu grupo.</p>
          </div>
          <button onClick={onCerrar} className="modal-editorial__cerrar" aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="modal-editorial__cuerpo space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
            <div>
              <div className="text-[9px] font-black uppercase text-indigo-300">Disponible para jugar</div>
              <div className="text-sm font-black text-indigo-200">
                {disp.monto == null ? "Sin tope" : formatoMoneda("USD", disp.monto)}
              </div>
            </div>
            <div className="text-[10px] font-bold text-indigo-300">{disp.etiqueta}</div>
          </div>

          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-700 bg-slate-950/50 p-1">
            {TIPOS_JUGADA.map((t) => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  tipo === t ? "bg-indigo-600 text-white shadow" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {ETIQUETA_TIPO[t].icono} {ETIQUETA_TIPO[t].etiqueta}
              </button>
            ))}
          </div>

          {tipo === "TABLA_FIJA" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className={lbl}>Tabla publicada</label>
                <select className={inp} value={String(b.tablaId ?? "")} onChange={(e) => set("tablaId", e.target.value)}>
                  <option value="">— Seleccione —</option>
                  {tablas.map((t) => (
                    <option key={String(t.id)} value={String(t.id)}>
                      {nombreHipodromoParaMostrar(t.hipodromo)} · C{t.carrera} · {formatoMoneda(t.moneda, t.premio_original)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Ejemplar (vacío = tabla completa)</label>
                <select className={inp} value={String(b.ejemplar ?? "")} onChange={(e) => set("ejemplar", e.target.value)}>
                  <option value="">Tabla completa</option>
                  {(tabla?.caballos ?? []).map((c) => (
                    <option key={String(c.numero)} value={String(c.numero)} disabled={c.retirado}>
                      {c.numero} · {c.nombre}
                      {c.retirado ? " (retirado)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Cantidad de tablas</label>
                <input
                  className={inp + " text-right font-mono"}
                  inputMode="numeric"
                  value={String(b.cantidad ?? 1)}
                  onChange={(e) => set("cantidad", e.target.value.replace(/\D/g, "") || "1")}
                />
              </div>
            </div>
          ) : null}

          {tipo === "POLLA" ? (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={lbl}>Polla abierta del día</label>
                <select className={inp} value={String(b.pollaId ?? "")} onChange={(e) => set("pollaId", e.target.value)}>
                  <option value="">— Seleccione —</option>
                  {pollas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} · {p.carreras.length} carreras · {formatoMoneda("USD", p.precioUnitario)}/combinación
                    </option>
                  ))}
                </select>
              </div>
              {polla ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {polla.carreras.map((c, i) => (
                    <div key={c.clave || i}>
                      <label className={lbl}>
                        {i + 1}ª · {nombreHipodromoParaMostrar(c.hipodromo)} C{c.carrera}
                      </label>
                      <select
                        className={inp}
                        value={String(b.pollaSeleccion?.[c.clave] ?? "")}
                        onChange={(e) =>
                          setB((prev) => ({
                            ...prev,
                            pollaSeleccion: { ...(prev.pollaSeleccion ?? {}), [c.clave]: e.target.value },
                          }))
                        }
                      >
                        <option value="">—</option>
                        {c.ejemplares.map((e) => (
                          <option key={e.numero} value={e.numero} disabled={(c.retirados ?? []).includes(e.numero)}>
                            {e.numero} · {e.nombre ?? ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] font-bold text-amber-300">No hay pollas abiertas para hoy. Podés usar “Jugada No Relacionada”.</p>
              )}
            </div>
          ) : null}

          {tipo === "DUPLETA" ? (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={lbl}>Dupleta guardada</label>
                <select
                  className={inp}
                  value={String(b.claveDupleta ?? "")}
                  onChange={(e) => set("claveDupleta", e.target.value)}
                >
                  <option value="">— Seleccione —</option>
                  {dupletas.map((d) => (
                    <option key={claveDeDupleta(d)} value={claveDeDupleta(d)}>
                      {nombreHipodromoParaMostrar(d.hipodromo)} · C{d.carrera1}-C{d.carrera2} · {formatoMoneda("USD", d.precio)}/cruce
                    </option>
                  ))}
                </select>
              </div>
              {dupleta ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>1ª pata (C{dupleta.carrera1})</label>
                    <select className={inp} value={String(b.numero1 ?? "")} onChange={(e) => set("numero1", e.target.value)}>
                      <option value="">—</option>
                      {dupleta.caballos1.map((c) => (
                        <option key={c.numero} value={c.numero} disabled={c.retirado}>
                          {c.numero} · {c.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>2ª pata (C{dupleta.carrera2})</label>
                    <select className={inp} value={String(b.numero2 ?? "")} onChange={(e) => set("numero2", e.target.value)}>
                      <option value="">—</option>
                      {dupleta.caballos2.map((c) => (
                        <option key={c.numero} value={c.numero} disabled={c.retirado}>
                          {c.numero} · {c.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] font-bold text-amber-300">No hay dupletas guardadas para hoy.</p>
              )}
            </div>
          ) : null}

          {tipo === "MARCA" ? (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className={lbl}>Carrera con marcas configuradas</label>
                <select className={inp} value={String(b.marcaId ?? "")} onChange={(e) => set("marcaId", e.target.value)}>
                  <option value="">— Seleccione —</option>
                  {marcas.map((m) => (
                    <option key={String(m.id)} value={String(m.id)}>
                      {nombreHipodromoParaMostrar(m.hipodromo)} · C{m.carrera} · Marcas {m.marcas}
                    </option>
                  ))}
                </select>
              </div>
              {marca ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Caballo (marca)</label>
                    <select className={inp} value={String(b.caballo ?? "")} onChange={(e) => set("caballo", e.target.value)}>
                      <option value="">—</option>
                      {marca.marcas
                        .split("/")
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .map((num) => (
                          <option key={num} value={num}>
                            N° {num}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Rival</label>
                    <select
                      className={inp}
                      value={String(analisis?.rival ?? b.rival ?? "")}
                      onChange={(e) => set("rival", e.target.value)}
                      disabled={!analisis?.valido}
                    >
                      <option value="">—</option>
                      {(analisis?.candidatos ?? []).map((num) => (
                        <option key={num} value={num}>
                          N° {num}
                        </option>
                      ))}
                    </select>
                  </div>
                  {analisis && !analisis.valido ? (
                    <p className="col-span-2 text-[11px] font-bold text-rose-300">{analisis.mensaje}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] font-bold text-amber-300">No hay carreras con marcas configuradas para hoy.</p>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Monto a jugar</label>
              <input
                className={inp + " text-right font-mono"}
                inputMode="decimal"
                value={String(b.monto ?? "")}
                onChange={(e) => set("monto", e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="flex items-end">
              <div className="w-full rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-2">
                <div className="text-[9px] font-black uppercase text-slate-400">Resumen</div>
                <div className="text-[11px] font-bold text-slate-200">{resumenJugada(b)}</div>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-300">{error}</div>
          ) : null}

          <p className="text-[10px] text-slate-400">
            Al registrar, se descuenta de tu saldo como en cualquier taquilla. Si no te aparece una jugada que hiciste, usá{" "}
            <button className="font-bold text-indigo-400 underline" onClick={onPedirNoRelacionada}>
              ➕ Solicitar Incluir Jugada No Relacionada
            </button>
            .
          </p>
        </div>

        <footer className="modal-editorial__pie">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="default" size="sm" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">🐎</span>} Registrar jugada
          </Button>
        </footer>
      </div>
    </div>
  );
}
