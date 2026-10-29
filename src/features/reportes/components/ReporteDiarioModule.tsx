"use client";
import { DateInput } from "@/shared/components/ui/DateInput";

/**
 * Reporte Diario y por Carrera — módulo del personal (`/reporte-diario`).
 *
 * Jerarquía de visibilidad (la frontera real está en el SERVIDOR):
 *   - Super administrador (`veTodosLosGrupos`) → elige grupo ("todos" o uno) y
 *     cliente ("todos" o uno).
 *   - Admin de grupo → solo su grupo; elige "todos mis clientes" o uno.
 *   - Usuario/cliente → no llega acá: usa el Portal del Cliente.
 *
 * Los filtros de grupo/cliente son de INTERFAZ. Aunque se inyecte un id ajeno
 * por la URL o el body, la RPC `club_reporte_diario` fuerza el grupo del usuario
 * y el RLS de `tickets_apuestas` recorta el respaldo (ver
 * `sql/reporte_diario.sql` y `sql/rls_por_grupo.sql`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { SearchableSelect, type OpcionSelect } from "@/shared/components/ui/SearchableSelect";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { listarClientes } from "@/features/clientes/lib/clientes";
import { listarGruposAdmin } from "@/features/grupos/lib/grupos";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import {
  leerReporteDiario,
  type ReporteDiario,
} from "@/features/reportes/lib/reporte-diario";
import { ReporteDiarioTabla } from "@/features/reportes/components/ReporteDiarioTabla";

/** Fecha local en YYYY-MM-DD (sin desfase por UTC). */
function isoLocal(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

const HOY = isoLocal(new Date());

function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoLocal(d);
}

export function ReporteDiarioModule() {
  const veTodos = useAuthStore((s) => s.veTodosLosGrupos);
  const grupoSesion = useAuthStore((s) => s.grupoId);
  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const setGrupoActivo = useAuthStore((s) => s.setGrupoActivo);

  const [desde, setDesde] = useState(HOY);
  const [hasta, setHasta] = useState(HOY);
  const [hipodromo, setHipodromo] = useState("");
  const [clienteId, setClienteId] = useState("");

  const [grupos, setGrupos] = useState<OpcionSelect[]>([]);
  const [clientes, setClientes] = useState<OpcionSelect[]>([]);
  const [hipodromos, setHipodromos] = useState<OpcionSelect[]>([]);

  const [datos, setDatos] = useState<ReporteDiario | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [respaldo, setRespaldo] = useState(false);

  // El grupo que se mira: el super administrador puede elegir "todos"; el resto
  // queda anclado a su propio grupo (aunque pase otro id, el servidor lo ignora).
  const grupoMirado = veTodos ? grupoActivo ?? "" : grupoSesion;

  // --- Catálogos de los selectores -----------------------------------------
  useEffect(() => {
    void listarHipodromos().then((r) => {
      const lista = (r.data ?? []).map((h) => ({ value: h.nombre, label: h.nombre }));
      setHipodromos(lista);
    });
  }, []);

  useEffect(() => {
    if (!veTodos) return;
    void listarGruposAdmin().then((g) => {
      setGrupos(g.map((x) => ({ value: String(x.id), label: x.nombre })));
    });
  }, [veTodos]);

  useEffect(() => {
    // Solo se ofrecen los clientes que el usuario puede ver: el RLS de `clientes`
    // ya recorta a su grupo, así que la lista nunca trae carteras ajenas.
    void listarClientes(false, grupoMirado || null).then((c) => {
      setClientes(
        c.map((x) => ({ value: String(x.id), label: x.nombre || x.seudonimo || String(x.id) }))
      );
    });
    setClienteId("");
  }, [grupoMirado]);

  // --- Lectura del reporte -------------------------------------------------
  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const r = await leerReporteDiario({
      desde,
      hasta,
      hipodromo: hipodromo || null,
      // Solo el super administrador manda el grupo; el resto lo fuerza el servidor.
      grupoId: veTodos ? grupoActivo ?? null : null,
      clienteId: clienteId || null,
    });
    if (!r.ok) {
      setError(r.error ?? "No se pudo leer el reporte.");
      setDatos(null);
    } else {
      setDatos(r.datos ?? null);
      setRespaldo(Boolean(r.respaldo));
    }
    setCargando(false);
  }, [desde, hasta, hipodromo, clienteId, veTodos, grupoActivo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const rangoValido = desde <= hasta;
  const presets = useMemo(
    () => [
      { etiqueta: "Hoy", desde: HOY, hasta: HOY },
      { etiqueta: "Ayer", desde: diasAtras(1), hasta: diasAtras(1) },
      { etiqueta: "7 días", desde: diasAtras(6), hasta: HOY },
      { etiqueta: "30 días", desde: diasAtras(29), hasta: HOY },
    ],
    []
  );

  return (
    <div className="flex flex-col gap-5 pb-10">
      <header>
        <h1 className="text-xl font-black text-slate-800">Reporte Diario y por Carrera</h1>
        <p className="text-sm text-slate-500">
          Jugado, premios, devolución y balance neto por hipódromo y carrera, con el total del día.
        </p>
      </header>

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Desde</span>
            <DateInput
              value={desde}
              onFechaChange={(val) => setDesde(val)}
              className="text-sm font-bold"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Hasta</span>
            <DateInput
              value={hasta}
              onFechaChange={(val) => setHasta(val)}
              className="text-sm font-bold"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Hipódromo</span>
            <SearchableSelect
              options={hipodromos}
              value={hipodromo}
              onChange={setHipodromo}
              placeholder="Todos"
              allowCustom
            />
          </div>

          {veTodos ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Grupo</span>
              <SearchableSelect
                options={grupos}
                value={grupoActivo ?? ""}
                onChange={(v) => setGrupoActivo(v || null)}
                placeholder="Todos los grupos"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex w-full flex-col gap-1 md:w-72">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Cliente</span>
            <SearchableSelect
              options={clientes}
              value={clienteId}
              onChange={setClienteId}
              placeholder={veTodos ? "Todos los clientes" : "Todos mis clientes"}
            />
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Atajos</span>
            {presets.map((p) => (
              <Button
                key={p.etiqueta}
                variant="outline"
                size="sm"
                onClick={() => {
                  setDesde(p.desde);
                  setHasta(p.hasta);
                }}
              >
                {p.etiqueta}
              </Button>
            ))}
            <Button size="sm" onClick={() => void cargar()} disabled={cargando || !rangoValido}>
              {cargando ? "Cargando…" : "Actualizar"}
            </Button>
          </div>
        </div>
      </Card>

      {!rangoValido ? (
        <p className="text-sm font-semibold text-red-600">La fecha "desde" no puede ser mayor que "hasta".</p>
      ) : null}

      {respaldo ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Los números se están calculando en el navegador con el respaldo (el RLS ya aísla por grupo).
          Para el agregado en el servidor, aplicá <code className="font-mono">sql/reporte_diario.sql</code>.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {datos ? (
        <ReporteDiarioTabla datos={datos} />
      ) : cargando ? (
        <div className="py-16 text-center text-sm text-slate-400">Cargando el reporte…</div>
      ) : null}
    </div>
  );
}

export default ReporteDiarioModule;
