"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChipField } from "@/components/ui/HorseChips";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { listarClientesVenta, listarGruposVenta, type ClienteVenta, type GrupoVenta } from "@/lib/grupos";

// Extrae números de un string ej: "2/3/7" -> [2, 3, 7]
const extraerNumeros = (str: string) => {
  return str.split(/[\/, -]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
};

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";
const inputSel =
  "w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

type Props = {
  hipodromo: string;
  carrera: string;
  fecha: string;
  marcasIniciales: string;
  contraIniciales: string;
  valenDebutantes?: boolean;
  debutantes?: { numero: string; nombre: string; debutante: boolean }[];
  onCerrar: () => void;
};

type EstadoJugada = {
  tipo: "FAVOR" | "CONTRA" | "BLOQUEADO" | "DEBUTANTE" | "NO_POSIBLE";
  color: string;
  mensaje: string;
};

export function VentaMarcasModal({
  hipodromo,
  carrera,
  fecha,
  marcasIniciales,
  contraIniciales,
  valenDebutantes = false,
  debutantes = [],
  onCerrar,
}: Props) {
  // Configuración de la carrera (editable al vuelo)
  const [marcadas, setMarcadas] = useState(marcasIniciales);
  const [contra, setContra] = useState(contraIniciales);
  const [nv, setNv] = useState("");

  // Estado de la venta
  const [caballoJugado, setCaballoJugado] = useState("");
  const [monto, setMonto] = useState("");
  const [grupo, setGrupo] = useState("");
  const [cliente, setCliente] = useState("");

  // Estado de validación
  const [estadoJugada, setEstadoJugada] = useState<EstadoJugada | null>(null);

  // Datos reales de grupos y clientes
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [clientesV, setClientesV] = useState<ClienteVenta[]>([]);
  const [abiertoGrupo, setAbiertoGrupo] = useState(false);
  const [abiertoCliente, setAbiertoCliente] = useState(false);

  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);

  useEffect(() => {
    let v = true;
    void listarGruposVenta().then((gs) => v && setGrupos(gs));
    void listarClientesVenta().then((cs) => v && setClientesV(cs));
    return () => {
      v = false;
    };
  }, []);

  // Validación en tiempo real del caballo
  useEffect(() => {
    if (!caballoJugado) {
      setEstadoJugada(null);
      return;
    }
    const num = parseInt(caballoJugado, 10);
    if (Number.isNaN(num)) {
      setEstadoJugada(null);
      return;
    }
    const arrMarcadas = extraerNumeros(marcadas);
    const arrContra = extraerNumeros(contra);
    const arrNv = extraerNumeros(nv);

    if (arrNv.includes(num)) {
      setEstadoJugada({
        tipo: "BLOQUEADO",
        color: "bg-red-100 text-red-700",
        mensaje: "🚫 Caballo Inválido (NV). No se puede jugar.",
      });
      return;
    }
    if (num === 6 || num === 7) {
      setEstadoJugada({
        tipo: "NO_POSIBLE",
        color: "bg-red-100 text-red-700",
        mensaje: "🚫 Jugada NO posible: el 6 y el 7 no se juegan contra ningún caballo.",
      });
      return;
    }
    const esDebutante = debutantes.some((d) => String(d.numero) === String(num));
    if (esDebutante && !valenDebutantes) {
      setEstadoJugada({
        tipo: "DEBUTANTE",
        color: "bg-amber-100 text-amber-800",
        mensaje: "👶 Debutante detectado en pista → NO VALE (por defecto). Cambie la condición en Marcas.",
      });
      return;
    }
    if (arrMarcadas.includes(num)) {
      setEstadoJugada({ tipo: "FAVOR", color: "bg-emerald-100 text-emerald-700", mensaje: "✅ Juega A FAVOR de las Marcas." });
    } else {
      setEstadoJugada({ tipo: "CONTRA", color: "bg-amber-100 text-amber-700", mensaje: "⚔️ Juega EN CONTRA de las Marcas." });
    }
  }, [caballoJugado, marcadas, contra, nv, debutantes, valenDebutantes]);

  const bloq = estadoJugada?.tipo === "BLOQUEADO" || estadoJugada?.tipo === "NO_POSIBLE" || estadoJugada?.tipo === "DEBUTANTE";

  const gruposFiltrados = useMemo(() => {
    const t = grupo.trim().toUpperCase();
    return t ? grupos.filter((g) => g.nombre.toUpperCase().includes(t)) : grupos;
  }, [grupos, grupo]);

  const grupoSel = useMemo(() => grupos.find((g) => g.nombre.toUpperCase() === grupo.trim().toUpperCase()) ?? null, [grupos, grupo]);

  const clientesFiltrados = useMemo(() => {
    const t = cliente.trim().toUpperCase();
    const base = grupoSel
      ? clientesV.filter((c) => (c.grupos || []).map((x) => String(x)).includes(String(grupoSel.id)))
      : clientesV;
    return t ? base.filter((c) => c.nombre.toUpperCase().includes(t)) : base;
  }, [clientesV, cliente, grupoSel]);

  const procesarVenta = () => {
    if (!estadoJugada || bloq) return;
    const m = Number(monto);
    if (!caballoJugado || Number.isNaN(m) || m <= 0) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Ingrese el caballo y el monto de la venta.", tipo: "warning" } }));
      return;
    }
    if (!grupo.trim() || !cliente.trim()) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Seleccione el grupo y el cliente.", tipo: "warning" } }));
      return;
    }
    const comando = `MARCA ${hipodromo} C${carrera} N${caballoJugado} (${estadoJugada.tipo === "FAVOR" ? "A FAVOR" : "EN CONTRA"})`;
    agregarTicket({
      comando,
      monto: m,
      gananciaProyectada: Math.round(m * 1.2 * 100) / 100,
      comision: Math.round((m * 1.2 * 0.05) * 100) / 100,
      caballo: caballoJugado,
      cliente1: cliente.trim().toUpperCase(),
      fecha,
      hipodromo: hipodromo.toUpperCase(),
      carrera: Number(carrera) || 0,
    });
    window.dispatchEvent(
      new CustomEvent("toast", {
        detail: { msg: `✅ Marca C${carrera} N°${caballoJugado} · $${m.toLocaleString("es-VE", { maximumFractionDigits: 2 })} → ${cliente.trim().toUpperCase()} (${grupo.trim().toUpperCase()})`, tipo: "success" },
      })
    );
    onCerrar();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onCerrar}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-2xl bg-emerald-700 px-4 py-2.5 text-white">
          <h3 className="text-sm font-black uppercase tracking-wide">🎟️ Vender Marca · C{carrera}</h3>
          <button type="button" onClick={onCerrar} className="text-lg leading-none hover:text-emerald-200">
            ✕
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {hipodromo.toUpperCase()} · {fecha} · PAGA 120 P/100
          </p>

          {/* Configuración de la carrera (editable al vuelo) */}
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className={`${inputLbl} text-emerald-700`}>Marcas</span>
              <div className="mt-1 h-8 rounded-lg border border-emerald-300 bg-white focus-within:ring-2 focus-within:ring-emerald-400">
                <ChipField value={marcadas} onChange={setMarcadas} placeholder="1/2/3/4/5" />
              </div>
            </label>
            <label className="block">
              <span className={`${inputLbl} text-red-700`}>NV</span>
              <div className="mt-1 h-8 rounded-lg border border-red-300 bg-white focus-within:ring-2 focus-within:ring-red-400">
                <ChipField value={nv} onChange={setNv} placeholder="6/7" />
              </div>
            </label>
            <label className="block">
              <span className={`${inputLbl} text-amber-700`}>Contra</span>
              <div className="mt-1 h-8 rounded-lg border border-amber-300 bg-white focus-within:ring-2 focus-within:ring-amber-400">
                <ChipField value={contra} onChange={setContra} placeholder="…" />
              </div>
            </label>
          </div>

          {/* Caballo y monto */}
          <div className="flex gap-2">
            <label className="block w-1/3">
              <span className={inputLbl}>Caballo</span>
              <input
                type="number"
                value={caballoJugado}
                onChange={(e) => setCaballoJugado(e.target.value)}
                placeholder="Nº"
                className={`${inputSel} mt-1 text-center text-lg`}
              />
            </label>
            <label className="block flex-1">
              <span className={inputLbl}>Monto ($)</span>
              <input
                type="number"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0.00"
                className={`${inputSel} mt-1 text-right text-lg font-black text-emerald-700`}
              />
            </label>
          </div>

          {/* Validación dinámica */}
          <div className={`flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold ${estadoJugada ? estadoJugada.color : "bg-slate-100 text-slate-400"}`}>
            {estadoJugada ? estadoJugada.mensaje : "Ingresa un caballo para validar…"}
          </div>

          {debutantes.length > 0 && (
            <div className={`rounded-lg border-l-4 px-3 py-1.5 text-[10px] font-semibold ${valenDebutantes ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-400 bg-amber-50 text-amber-900"}`}>
              👶 Debutante(s) en la carrera: {debutantes.map((d) => `${d.numero} ${d.nombre}`).join(" · ")} → {valenDebutantes ? "VALEN" : "NO VALEN (por defecto)"}.
            </div>
          )}

          {/* Grupo y cliente (autocompletado real) */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={inputLbl}>Grupo (Agencia)</span>
              <div className="relative">
                <input
                  value={grupo}
                  onChange={(e) => { setGrupo(e.target.value.toUpperCase()); setAbiertoGrupo(true); }}
                  onFocus={() => setAbiertoGrupo(true)}
                  placeholder="Buscar o crear…"
                  className={inputSel}
                />
                {abiertoGrupo && gruposFiltrados.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
                    {gruposFiltrados.slice(0, 20).map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setGrupo(g.nombre.toUpperCase()); setAbiertoGrupo(false); }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-700 transition-colors hover:bg-primary-500/10"
                        >
                          <span className="truncate">{g.nombre}</span>
                          {g.es_principal ? <span className="text-[9px] font-black text-emerald-600">principal</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
            <label className="block">
              <span className={inputLbl}>Cliente (Jugador)</span>
              <div className="relative">
                <input
                  value={cliente}
                  onChange={(e) => { setCliente(e.target.value.toUpperCase()); setAbiertoCliente(true); }}
                  onFocus={() => setAbiertoCliente(true)}
                  placeholder="Buscar o crear…"
                  className={inputSel}
                />
                {abiertoCliente && clientesFiltrados.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
                    {clientesFiltrados.slice(0, 20).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setCliente(c.nombre.toUpperCase());
                            if (!grupoSel && c.grupos.length) {
                              const g = grupos.find((x) => String(x.id) === String(c.grupos[0]));
                              if (g) setGrupo(g.nombre.toUpperCase());
                            }
                            setAbiertoCliente(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-700 transition-colors hover:bg-primary-500/10"
                        >
                          <span className="truncate">{c.nombre}</span>
                          <span className="ml-2 shrink-0 text-[9px] font-black text-slate-400">
                            ${(c.saldo_actual ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          </div>

          <p className="rounded-lg bg-slate-50 px-2 py-1 text-[9px] font-semibold leading-relaxed text-slate-500">
            🎯 Jugadas posibles: 2X1, 3X2, 3X1, 4X3, 4X2, 4X1, 5X4, 5X3, 5X2, 5X1, 8X5, 8X4, 8X3, 8X2, 8X1. 🚫 No posibles: 6 y 7 contra ningún caballo.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="md" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="success" size="md" onClick={procesarVenta} disabled={bloq || !caballoJugado}>
            ✅ Registrar Jugada
          </Button>
        </div>
      </div>
    </div>
  );
}