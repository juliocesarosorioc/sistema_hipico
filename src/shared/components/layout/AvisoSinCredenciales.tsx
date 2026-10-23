"use client";

import { supabase } from "@/core/supabase";

/**
 * AVISO DE CREDENCIALES AUSENTES.
 *
 * Qué pasa sin `.env.local`: `src/core/supabase.ts` devuelve `supabase = null`
 * y la app entero entra en "modo local". El login acepta el usuario, la
 * contraseña NUNCA se valida (no hay a quién validarla), ninguna consulta
 * llega a la base y las pantallas salen vacías. Para quien está devant de la
 * pantalla, el síntoma es "la app no abre" — sin ninguna pista de por qué.
 *
 * Por qué está en el layout raíz y no en la pantalla de login: el problema
 * NO es del login. Es de TODA la app, y este aviso tiene que verse en
 * cualquier pantalla por la que entre el operador.
 *
 * Es un banner, no una pantalla bloqueante: si alguien está usando la app en
 * "modo local" a propósito (para revisar la interfaz sin base), el aviso
 *仍然是 de lectura y no le impide trabajar.
 */
export function AvisoSinCredenciales() {
  if (supabase) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-[100] border-b-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
        <span className="text-lg leading-none" aria-hidden>
          ⚠️
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black uppercase tracking-wide">
            Faltan las credenciales de Supabase — la app no puede leer ni escribir datos
          </p>
          <p className="mt-0.5 text-[12px] leading-snug">
            No existe el archivo <code className="rounded bg-amber-100 px-1 font-mono">.env.local</code> (o le
            faltan <code className="rounded bg-amber-100 px-1 font-mono">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code className="rounded bg-amber-100 px-1 font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Copiá la
            plantilla <code className="rounded bg-amber-100 px-1 font-mono">.env.example</code> a{" "}
            <code className="rounded bg-amber-100 px-1 font-mono">.env.local</code>, completá las dos variables y
            reiniciá el servidor. Ojo: <code className="rounded bg-amber-100 px-1 font-mono">.env.local</code> está
            ignorado por git, así que <b>no</b> se copia solo al abrir un worktree nuevo.
          </p>
        </div>
      </div>
    </div>
  );
}

export default AvisoSinCredenciales;
