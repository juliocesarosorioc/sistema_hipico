"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Registro = {
  id: number;
  fecha: string | null;
  usuario: string | null;
  modulo: string | null;
  accion: string | null;
  ip: string | null;
  navegador: string | null;
  ubicacion: string | null;
};

type Filtros = { desde: string; hasta: string; modulo: string; usuario: string; accion: string; ip: string };

const VACIO: Filtros = { desde: "", hasta: "", modulo: "", usuario: "", accion: "", ip: "" };
const TAM = 50;
const TOPE_RESUMEN = 20000;

const fmtFecha = (f: string | null): string => {
  if (!f) return "—";
  const d = new Date(f);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "medium" });
};

/** Fecha local (YYYY-MM-DD) para los inputs type=date y los atajos. */
const aInput = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Resumen = { total: number; porModulo: Array<{ modulo: string; n: number }> };

/**
 * Visor del log de auditoría (`public.auditoria`), que escribe la RPC
 * `club_log_accion` (security definer: el navegador no puede falsificarlo).
 *
 * Además de la tabla paginada, muestra un resumen (total y conteo por módulo)
 * y filtros por fecha, módulo, usuario, acción e IP con atajos de rango.
 */
export function AuditoriaPanel() {
  const [borrador, setBorrador] = useState<Filtros>(VACIO);
  const [aplicados, setAplicados] = useState<Filtros>(VACIO);
  const [pagina, setPagina] = useState(1);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [total, setTotal] = useState(0);
  const [resumen, setResumen] = useState<Resumen>({ total: 0, porModulo: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paginas = Math.max(1, Math.ceil(total / TAM));
  const desdeFila = total === 0 ? 0 : (pagina - 1) * TAM + 1;
  const hastaFila = Math.min(pagina * TAM, total);

  /** Resumen: total y conteo por módulo con todos los filtros menos el módulo. */
  const cargarResumen = useCallback(async (f: Filtros): Promise<Resumen> => {
    if (!supabase) return { total: 0, porModulo: [] };
    const mapa = new Map<string, number>();
    let total = 0;
    for (let desde = 0; desde < TOPE_RESUMEN; desde += 1000) {
      let q = supabase.from("auditoria").select("modulo").order("id", { ascending: false });
      if (f.desde) q = q.gte("fecha", `${f.desde}T00:00:00`);
      if (f.hasta) q = q.lte("fecha", `${f.hasta}T23:59:59`);
      if (f.usuario) q = q.ilike("usuario", `%${f.usuario}%`);
      if (f.accion) q = q.ilike("accion", `%${f.accion}%`);
      if (f.ip) q = q.ilike("ip", `%${f.ip}%`);
      const { data, error: err } = await q.range(desde, desde + 999);
      if (err) throw err;
      const filas = (data ?? []) as Array<{ modulo: string | null }>;
      for (const r of filas) {
        const m = (r.modulo ?? "").trim() || "(sin módulo)";
        mapa.set(m, (mapa.get(m) ?? 0) + 1);
      }
      total += filas.length;
      if (filas.length < 1000) break;
    }
    const porModulo = [...mapa.entries()].map(([modulo, n]) => ({ modulo, n })).sort((a, b) => b.n - a.n);
    return { total, porModulo };
  }, []);

  const buscar = useCallback(
    async (f: Filtros, p: number) => {
      if (!supabase) {
        setError("Sin conexión a Supabase.");
        setCargando(false);
        return;
      }
      setCargando(true);
      setError(null);
      try {
        const desde = (p - 1) * TAM;
        let q = supabase
          .from("auditoria")
          .select("*", { count: "exact" })
          .order("fecha", { ascending: false })
          .order("id", { ascending: false });
        if (f.desde) q = q.gte("fecha", `${f.desde}T00:00:00`);
        if (f.hasta) q = q.lte("fecha", `${f.hasta}T23:59:59`);
        if (f.modulo) q = q.eq("modulo", f.modulo);
        if (f.usuario) q = q.ilike("usuario", `%${f.usuario}%`);
        if (f.accion) q = q.ilike("accion", `%${f.accion}%`);
        if (f.ip) q = q.ilike("ip", `%${f.ip}%`);
        const [tabla, res] = await Promise.all([q.range(desde, desde + TAM - 1), cargarResumen(f)]);
        if (tabla.error) throw tabla.error;
        setRegistros((tabla.data as Registro[]) ?? []);
        setTotal(tabla.count ?? 0);
        setResumen(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    },
    [cargarResumen],
  );

  useEffect(() => {
    void buscar(aplicados, pagina);
  }, [buscar, aplicados, pagina]);

  const aplicar = (f: Filtros) => {
    setBorrador(f);
    setAplicados(f);
    setPagina(1);
  };

  const atajo = (tipo: "hoy" | "semana" | "mes") => {
    const hoy = new Date();
    const fin = aInput(hoy);
    let ini = fin;
    if (tipo === "semana") {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 6);
      ini = aInput(d);
    } else if (tipo === "mes") {
      ini = aInput(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    }
    aplicar({ ...VACIO, desde: ini, hasta: fin });
  };

  const moduloActivo = aplicados.modulo;

  const campos = useMemo(() => {
    const campo = (clave: keyof Filtros, etiqueta: string, placeholder: string, tipo: "text" | "date" = "text") => (
      <label className="flex flex-col gap-1">
        <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">{etiqueta}</span>
        <input
          type={tipo}
          value={borrador[clave]}
          placeholder={placeholder}
          onChange={(e) => setBorrador({ ...borrador, [clave]: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") aplicar(borrador);
          }}
          className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
        />
      </label>
    );
    return (
      <>
        {campo("desde", "Fecha Desde", "", "date")}
        {campo("hasta", "Fecha Hasta", "", "date")}
        <label className="flex flex-col gap-1">
          <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Módulo</span>
          <select
            value={borrador.modulo}
            onChange={(e) => setBorrador({ ...borrador, modulo: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
          >
            <option value="">Todos</option>
            {resumen.porModulo.map((m) => (
              <option key={m.modulo} value={m.modulo}>
                {m.modulo}
              </option>
            ))}
          </select>
        </label>
        {campo("usuario", "Usuario", "Nombre…")}
        {campo("accion", "Acción", "Buscar acción…")}
        {campo("ip", "IP", "IP…")}
      </>
    );
  }, [borrador, resumen.porModulo]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {campos}
        <button
          onClick={() => aplicar(borrador)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white hover:bg-indigo-700"
        >
          Buscar
        </button>
        <button
          onClick={() => aplicar(VACIO)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-50"
        >
          Limpiar filtros
        </button>
        <button
          onClick={() => atajo("hoy")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-50"
        >
          Hoy
        </button>
        <button
          onClick={() => atajo("semana")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-50"
        >
          Últimos 7 días
        </button>
        <button
          onClick={() => atajo("mes")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-50"
        >
          Este mes
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</p>
      ) : null}

      <div className="rounded-2xl border border-line bg-surface p-3">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-2xl font-black leading-none text-slate-800">{resumen.total}</span>
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">registros</span>
        </div>
        {resumen.porModulo.length ? (
          <div className="flex flex-wrap gap-1.5">
            {resumen.porModulo.map((m) => {
              const activo = moduloActivo === m.modulo;
              return (
                <button
                  key={m.modulo}
                  onClick={() => aplicar({ ...borrador, modulo: activo ? "" : m.modulo })}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                    activo
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                  }`}
                  title={`Filtrar por ${m.modulo}`}
                >
                  {m.modulo} <span className={activo ? "text-indigo-100" : "text-slate-400"}>{m.n}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">Sin módulos para los filtros aplicados.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {cargando ? "Consultando…" : `Mostrando ${desdeFila}-${hastaFila} de ${total} registros`}
        </p>
        <div className="flex items-center gap-1">
          <button
            disabled={pagina <= 1 || cargando}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="px-1 text-[11px] font-bold text-slate-500">
            Página {pagina} de {paginas}
          </span>
          <button
            disabled={pagina >= paginas || cargando}
            onClick={() => setPagina((p) => Math.min(paginas, p + 1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="min-w-full divide-y divide-slate-100 text-[11px]">
          <thead className="bg-surfaceAlt">
            <tr>
              {["#", "Fecha/Hora", "Usuario", "Módulo", "Acción", "IP", "Ubicación", "Navegador"].map((t) => (
                <th key={t} className="px-3 py-2 text-left font-black uppercase tracking-wide text-slate-500">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {registros.map((r, i) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5 font-mono text-slate-400">{(pagina - 1) * TAM + i + 1}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{fmtFecha(r.fecha)}</td>
                <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-700">{r.usuario ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.modulo ?? "—"}</td>
                <td className="max-w-[420px] px-3 py-1.5 text-slate-600">{r.accion ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-500">{r.ip ?? "—"}</td>
                <td className="max-w-[200px] truncate px-3 py-1.5 text-slate-500">{r.ubicacion ?? "—"}</td>
                <td className="max-w-[260px] truncate px-3 py-1.5 text-slate-500">{r.navegador ?? "—"}</td>
              </tr>
            ))}
            {!cargando && !registros.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Sin registros para los filtros aplicados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditoriaPanel;
