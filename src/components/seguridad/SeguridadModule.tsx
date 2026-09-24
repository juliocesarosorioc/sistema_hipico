"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Perfil, Permiso, UsuarioSistema } from "@/lib/seguridad/tipos";
import {
  leerPerfiles,
  leerPermisos,
  leerUsuarios,
  permisosDePerfil,
  permisosDeUsuario,
  guardarAccesosPerfil,
  guardarAccesosUsuario,
} from "@/lib/seguridad/permisos";
import { useAuthStore } from "@/store/useAuthStore";
import { MatrizAccesos } from "@/components/seguridad/MatrizAccesos";
import { Guard } from "@/components/ui/Guard";

type Sujeto = { tipo: "perfil" | "usuario"; id: string | number; nombre: string };

const mismaMatriz = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((k) => b.has(k));

/**
 * Módulo Seguridad y Accesos: matriz tipo grid (perfil o usuario × permiso)
 * con toggles por módulo/acción. Persiste en las tablas RBAC de Supabase.
 * Incluye "Simular perfil" para probar el Guard y la protección de rutas.
 */
export function SeguridadModule() {
  const { perfiles: misPerfiles, usuario: miUsuario, simularPerfil, cargando } = useAuthStore();

  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioSistema[]>([]);

  const [sujeto, setSujeto] = useState<Sujeto | null>(null);
  const [vigentes, setVigentes] = useState<Set<string>>(new Set());
  const [originales, setOriginales] = useState<Set<string>>(new Set());

  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");

  const cargarSujeto = useCallback(async (s: Sujeto) => {
    setSujeto(s);
    let setPermisosActivos: Set<string>;
    if (s.tipo === "perfil") {
      const perfil = { id: s.id, nombre: s.nombre };
      setPermisosActivos = await permisosDePerfil(perfil);
    } else {
      setPermisosActivos = await permisosDeUsuario(String(s.id));
    }
    setVigentes(setPermisosActivos);
    setOriginales(new Set(setPermisosActivos));
    setAviso("");
  }, []);

  useEffect(() => {
    (async () => {
      const [pfs, pms, usr] = await Promise.all([leerPerfiles(), leerPermisos(), leerUsuarios()]);
      setPerfiles(pfs);
      setPermisos(pms);
      setUsuarios(usr);
      if (pfs.length) void cargarSujeto({ tipo: "perfil", id: pfs[0].id, nombre: pfs[0].nombre });
    })();
  }, [cargarSujeto]);

  const dirty = useMemo(() => !mismaMatriz(vigentes, originales), [vigentes, originales]);

  const enCambio = (clave: string, activo: boolean) => {
    setVigentes((prev) => {
      const next = new Set(prev);
      if (activo) next.add(clave);
      else next.delete(clave);
      return next;
    });
  };

  const guardar = async () => {
    if (!sujeto) return;
    setGuardando(true);
    const res =
      sujeto.tipo === "perfil"
        ? await guardarAccesosPerfil({ id: sujeto.id, nombre: sujeto.nombre }, [...vigentes])
        : await guardarAccesosUsuario(String(sujeto.id), [...vigentes]);
    setGuardando(false);
    setOriginales(new Set(vigentes));
    setAviso(res.ok ? "✅ Accesos guardados en Supabase." : `❌ ${res.error ?? "Error al guardar."}`);
  };

  const simular = async () => {
    if (!sujeto || sujeto.tipo !== "perfil") return setAviso("Para simular selecciona un perfil, no un usuario.");
    await simularPerfil(sujeto.nombre);
    setAviso(`🔁 Sesión simulada como "${sujeto.nombre}". Verifica cómo se ocultan los botones y rutas.`);
  };

  const chipCls = (activo: boolean) =>
    `rounded-full px-4 py-1.5 text-xs font-black uppercase transition-colors ${
      activo ? "bg-slate-900 text-white shadow" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
    }`;

  return (
    <div className="no-print space-y-5">
      {/* Cabecera + selector de sujeto */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div>
          <h1 className="text-lg font-black uppercase text-slate-900">🛡️ Seguridad y Accesos</h1>
          <p className="text-xs text-slate-500">
            Control de acceso basado en roles (RBAC). Tu sesión: <b>{miUsuario}</b> ·{" "}
            {misPerfiles.join(", ")} · {cargando ? "cargando…" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={simular}
          disabled={!sujeto || sujeto.tipo === "usuario"}
          title="Cambia la sesión actual al perfil seleccionado para probar el RBAC"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black uppercase text-white shadow-md transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔁 Simular perfil en mi sesión
        </button>
      </div>

      {aviso && <p className="rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-700">{aviso}</p>}

      {/* Selector: perfiles primero, usuarios si hay cuenta en auth.users */}
      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Perfiles</p>
        <div className="flex flex-wrap gap-2">
          {perfiles.map((p) => (
            <button key={String(p.id)} type="button" onClick={() => cargarSujeto({ tipo: "perfil", id: p.id, nombre: p.nombre })} className={chipCls(sujeto?.tipo === "perfil" && sujeto.id === p.id)}>
              {p.nombre}
            </button>
          ))}
        </div>
        {usuarios.length > 0 && (
          <>
            <p className="pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Usuarios individuales (permisos extra)</p>
            <div className="flex max-w-3xl flex-wrap gap-1.5">
              {usuarios.map((u) => (
                <button key={u.id} type="button" onClick={() => cargarSujeto({ tipo: "usuario", id: u.id, nombre: u.email ?? u.nombre ?? String(u.id) })} className={chipCls(sujeto?.tipo === "usuario" && sujeto.id === u.id)}>
                  👤 {u.email ?? u.nombre ?? u.id}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Matriz */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-black uppercase text-slate-700">
            Matriz de accesos — {sujeto?.nombre ?? "…"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setVigentes(new Set(originales)); setAviso(""); }}
              disabled={!dirty}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:opacity-40"
            >
              Deshacer
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={!dirty || guardando}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[11px] font-black uppercase text-white shadow-md transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "💾 Guardar cambios"}
            </button>
          </div>
        </div>
        <MatrizAccesos permisos={permisos} vigentes={vigentes} enCambio={enCambio} />
        {dirty && <p className="mt-1 text-right text-[10px] font-bold uppercase text-amber-600">Hay cambios sin guardar</p>}
      </div>

      {/* Demostración del Guard granular con la sesión actual */}
      <Guard permiso="administrar_seguridad">
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
          <h2 className="text-sm font-black uppercase text-slate-700">🧪 Prueba de <code>&lt;Guard&gt;</code> con tu sesión</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Simula otro perfil y vuelve aquí: los botones que exigen permisos desaparecen o quedan deshabilitados.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Guard permiso="liquidar_carrera">
              <span className="cursor-pointer rounded-lg bg-fuchsia-600 px-4 py-2 text-xs font-black uppercase text-white shadow">🏁 Liquidar carrera</span>
            </Guard>
            <Guard permiso="anular_ticket" modo="deshabilitar">
              <span className="rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase text-white shadow">🗑️ Anular ticket</span>
            </Guard>
            <Guard permiso={["ver_taquilla", "ver_tablas_fijas"]}>
              <span className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase text-white shadow">📋 Vender tablas</span>
            </Guard>
          </div>
        </div>
      </Guard>
    </div>
  );
}

export default SeguridadModule;