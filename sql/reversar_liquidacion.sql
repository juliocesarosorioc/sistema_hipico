-- ============================================================================
--  REVERSAR LA LIQUIDACIÓN DE UNA CARRERA — RPC del resultado central (Bloque 1)
-- ============================================================================
--  La app implementa la reversión en `src/features/liquidacion/lib/reversar.ts`:
--  devuelve el dinero acreditado (taquilla, tablas fijas, marcas, dupletas),
--  reabre remates y pollas, y como ÚLTIMO paso borra el resultado oficial para
--  dejar la carrera ABIERTA (estado "Programada").
--
--  Este archivo crea la RPC que hace ese último paso CON VALIDACIÓN DE CAPACIDAD
--  EN EL SERVIDOR, en vez de un UPDATE directo:
--
--      public.club_revertir_resultado_carrera(fecha, hipodromo, carrera, usuario)
--
--  Borra el resultado de `resultados_carreras`:
--      ganadores = null, orden_llegada = null, dividendos = null,
--      premio_oficial = null, premio_recalculado = null,
--      aplicado_a_tablas = false.
--  (No borra la fila: deja `detalle`/ventas de la sesión intactos.)
--
--  La app llama a esta RPC y, si todavía no existe, cae al camino de
--  `club_guardar_resultado_carrera` con los campos en blanco (que sólo tienen
--  los permisos de carga/liquidación). O sea: mientras no corras este SQL, los
--  administradores igual pueden reversar; después de correrlo, también quien
--  tenga `gestion_jugadas:fn_reabrir_carrera`.
--
--  EJECUTAR EN EL SQL EDITOR DE SUPABASE (idempotente).
-- ============================================================================

create or replace function public.club_revertir_resultado_carrera(
  p_fecha     date,
  p_hipodromo text,
  p_carrera   integer,
  p_usuario   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hip   text;
  v_filas integer := 0;
begin
  v_hip := upper(btrim(coalesce(p_hipodromo, '')));
  if v_hip = '' then
    raise exception 'Hipodromo requerido';
  end if;
  if p_carrera is null or p_carrera <= 0 then
    raise exception 'Carrera requerida';
  end if;

  -- Permiso del lado del servidor: la reversión es destructiva sobre el dinero,
  -- así que exige capacidad explícita. Se acepta la de re-apertura y las de
  -- carga/liquidación (los administradores las tienen).
  if not (
         public.tiene_capacidad(auth.uid(), 'gestion_jugadas:fn_reabrir_carrera')
      or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:fn_liquidar_carrera')
      or public.tiene_capacidad(auth.uid(), 'gestion_jugadas:btn_cargar_resultados')
      or public.tiene_capacidad(auth.uid(), 'carreras:fn_registrar_carrera')
  ) then
    raise exception 'Sin permiso para reversar la liquidación de la carrera'
      using errcode = '42501';
  end if;

  update public.resultados_carreras
     set ganadores          = null,
         orden_llegada      = null,
         dividendos         = null,
         premio_oficial     = null,
         premio_recalculado = null,
         aplicado_a_tablas  = false,
         cargado_por        = null,
         updated_at         = now()
   where fecha     = coalesce(p_fecha, current_date)
     and upper(btrim(hipodromo)) = v_hip
     and carrera   = p_carrera;
  get diagnostics v_filas = rowcount;

  -- Auditoría (best-effort: no bloquea la reversión si la tabla/RLS lo impide).
  begin
    insert into public.auditoria (modulo, accion, detalle, fecha)
    values (
      'GESTION_JUGADAS',
      'REVERSAR_LIQUIDACION',
      left(
        format(
          'Resultado central de %s C%s (%s) revertido por %s',
          v_hip, p_carrera, coalesce(p_fecha::text, current_date::text), coalesce(p_usuario, 'usuario')
        ),
        500
      ),
      now()
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'filas', v_filas);
end;
$$;

revoke all on function public.club_revertir_resultado_carrera(date, text, integer, text) from public;
grant execute on function public.club_revertir_resultado_carrera(date, text, integer, text) to anon, authenticated;

-- VERIFICACIÓN ---------------------------------------------------------------
-- 1) La RPC existe y es security definer:
--    select proname, prosecdef from pg_proc
--     where proname = 'club_revertir_resultado_carrera';
--
-- 2) Reversión con sesión de staff (devuelve {"ok":true,...}):
--    select public.club_revertir_resultado_carrera('2026-01-01','PRUEBA',99999,'test');
--
-- 3) Sin permiso debe fallar con 42501:
--    (llamar con un usuario sin ninguna de las 4 capacidades)
-- ============================================================================
