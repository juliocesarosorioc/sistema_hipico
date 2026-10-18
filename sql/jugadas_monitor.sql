-- ============================================================================
--  MONITOR DE JUGADAS  (progress monitor) + AUDITORÍA de correcciones/anulaciones
-- ============================================================================
--  Ejecutar en Supabase -> SQL Editor (una sola vez, es idempotente).
--
--  Qué agrega:
--    1) Columnas de control en `tickets_apuestas`:
--         anulada / anulada_motivo / anulada_por / anulada_at
--         pagado_en / pagado_por
--    2) Tabla `jugadas_auditoria`: cada corrección, anulación, restauración o
--       marcado de pago queda registrado con motivo, snapshot y (opcional)
--       imagen en base64 (data URL) para verificación visual.
--    3) Índices para el monitor (hipódromo+carrera, estado, anulada).
--    4) Vista `v_jugadas_monitor`: una fila por (hipódromo, carrera, fecha de
--       carrera) con los agregados que ve el monitor.
--    5) Política de UPDATE para que el staff autenticado pueda corregir/anular
--       desde la consola (la app además exige la capacidad en el cliente).
--
--  NOTA: la fecha de la carrera se toma de `nota_auditoria::jsonb->>'fecha_carrera'`
--  (los RPC de venta la guardan). No se usa `fecha_registro` (timestamp de venta).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) COLUMNAS DE CONTROL
-- ----------------------------------------------------------------------------
alter table public.tickets_apuestas
    add column if not exists anulada        boolean not null default false,
    add column if not exists anulada_motivo text,
    add column if not exists anulada_por    text,
    add column if not exists anulada_at     timestamptz,
    add column if not exists pagado_en      timestamptz,
    add column if not exists pagado_por     text;

-- ----------------------------------------------------------------------------
-- 2) TABLA DE AUDITORÍA
--    `imagen` guarda un data URL (image/jpeg base64) comprimido en el navegador:
--    no depende de policies de Storage y sobrevive con el registro de auditoría.
-- ----------------------------------------------------------------------------
create table if not exists public.jugadas_auditoria (
    id         bigserial primary key,
    ticket_id  text        not null,
    hipodromo  text,
    carrera    int,
    accion     text        not null,   -- EDITAR | ANULAR | RESTAURAR | MARCAR_PAGADO
    motivo     text,
    detalle    jsonb,                  -- { antes: {...}, despues: {...} }
    imagen     text,                   -- data URL opcional (imagen de verificación)
    usuario    text,
    creado_at  timestamptz not null default now()
);

alter table public.jugadas_auditoria disable row level security;
grant all privileges on table public.jugadas_auditoria to anon, authenticated;
grant usage, select on sequence public.jugadas_auditoria_id_seq to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) ÍNDICES DEL MONITOR
-- ----------------------------------------------------------------------------
create index if not exists idx_tickets_apuestas_hip_carr
    on public.tickets_apuestas (hipodromo, carrera);
create index if not exists idx_tickets_apuestas_estado
    on public.tickets_apuestas (estado);
create index if not exists idx_tickets_apuestas_anulada
    on public.tickets_apuestas (anulada);
create index if not exists idx_jugadas_auditoria_ticket
    on public.jugadas_auditoria (ticket_id, creado_at desc);

-- ----------------------------------------------------------------------------
-- 4) VISTA `v_jugadas_monitor`
--    Agrupa los tickets por carrera. `resultado_cargado` mira el libro de
--    resultados (`resultados_carreras`) por hipódromo+carrera y, si el ticket
--    conoce la fecha de carrera, por esa fecha.
-- ----------------------------------------------------------------------------
drop view if exists public.v_jugadas_monitor;
-- `security_invoker = true` (PG15+): la vista se ejecuta con los privilegios de
-- quien consulta, así que RESPETA el RLS de `tickets_apuestas`. Antes corría como
-- el dueño y ESQUIVABA el RLS: un usuario con grupo veía las jugadas de TODOS los
-- grupos por el monitor. Con esto, un usuario con grupo solo ve las suyas.
create view public.v_jugadas_monitor with (security_invoker = true) as
select
    g.hipodromo,
    g.carrera,
    g.fecha_carrera,
    -- Dimensión de grupo: la usa el filtro del super administrador ("ver un
    -- grupo"). Un usuario con grupo ya viene acotado por el RLS, así que la app
    -- solo filtra por esta columna cuando el admin elige un grupo.
    g.grupo_cobro_id,
    g.total_jugadas,
    g.total_monto,
    g.total_premio,
    g.en_juego,
    g.por_pagar,
    g.liquidadas,
    g.anuladas,
    g.monto_vigente,
    g.premio_ganador,
    g.usuarios,
    g.origenes,
    exists (
        select 1
        from public.resultados_carreras r
        where upper(btrim(r.hipodromo)) = g.hipodromo
          and r.carrera = g.carrera
          and (g.fecha_carrera is null or r.fecha = g.fecha_carrera)
          and (
              coalesce(array_length(r.ganadores, 1), 0) > 0
              or r.aplicado_a_tablas is true
              or r.orden_llegada is not null
          )
    ) as resultado_cargado
from (
    select
        t.hipodromo,
        t.carrera,
        t.fecha_carrera,
        -- Dimensión de grupo: tiene que salir en el SELECT además del GROUP BY,
        -- o el alias `g` no expone `grupo_cobro_id` (42703) al usarlo arriba.
        t.grupo_cobro_id,
        count(*)                                                    as total_jugadas,
        coalesce(sum(t.monto), 0)                                   as total_monto,
        coalesce(sum(t.premio), 0)                                  as total_premio,
        count(*) filter (where not t.anulada and t.estado = 'Pendiente')                          as en_juego,
        count(*) filter (where not t.anulada and t.estado = 'Ganador' and t.pagado_en is null)    as por_pagar,
        count(*) filter (
            where not t.anulada
              and (t.estado in ('Perdedor', 'Retirado')
                   or (t.estado = 'Ganador' and t.pagado_en is not null))
        )                                                           as liquidadas,
        count(*) filter (where t.anulada)                           as anuladas,
        coalesce(sum(t.monto) filter (where not t.anulada), 0)      as monto_vigente,
        coalesce(sum(t.premio) filter (where not t.anulada and t.estado = 'Ganador'), 0) as premio_ganador,
        array_remove(array_agg(distinct t.usuario), null)           as usuarios,
        string_agg(distinct t.origen, ', ')                         as origenes
    from (
        select
            upper(btrim(coalesce(tk.hipodromo, ''))) as hipodromo,
            coalesce(tk.carrera, 0)::int             as carrera,
            (case when tk.nota_auditoria ~ '^\s*[\{\[]'
                  then nullif(tk.nota_auditoria::jsonb ->> 'fecha_carrera', '')
             end)::date                              as fecha_carrera,
            tk.grupo_cobro_id                        as grupo_cobro_id,
            (case when tk.nota_auditoria ~ '^\s*[\{\[]'
                  then nullif(tk.nota_auditoria::jsonb ->> 'origen', '')
             end)                                    as origen,
            (case when tk.nota_auditoria ~ '^\s*[\{\[]'
                  then nullif(tk.nota_auditoria::jsonb ->> 'usuario', '')
             end)                                    as usuario,
            coalesce(tk.estado, 'Pendiente')         as estado,
            coalesce(tk.anulada, false)              as anulada,
            tk.pagado_en                             as pagado_en,
            coalesce(tk.monto_jugado, 0)::numeric    as monto,
            coalesce(tk.premio_pagar, 0)::numeric    as premio
        from public.tickets_apuestas tk
    ) t
    group by t.hipodromo, t.carrera, t.fecha_carrera, t.grupo_cobro_id
) g;

grant select on public.v_jugadas_monitor to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4b) VISTA `v_jugadas_carrera` (detalle)
--    Espejo de `tickets_apuestas` con las columnas que necesita el monitor.
--    Corre con `security_invoker = true`: respeta el RLS de `tickets_apuestas`
--    (un usuario con grupo solo ve lo suyo). Las escrituras van directo a la
--    tabla, cubiertas por la policy de UPDATE de más abajo.
-- ----------------------------------------------------------------------------
drop view if exists public.v_jugadas_carrera;
-- `security_invoker = true`: igual que el monitor, respeta el RLS de
-- `tickets_apuestas` (antes lo esquivaba y mostraba todos los grupos).
create view public.v_jugadas_carrera with (security_invoker = true) as
select
    tk.id,
    upper(btrim(coalesce(tk.hipodromo, ''))) as hipodromo,
    tk.carrera,
    -- Grupo de cobro y cliente que juega: el filtro del admin y el aislamiento
    -- por grupo (RLS) los necesitan.
    tk.grupo_cobro_id,
    tk.cliente_juega_id,
    tk.nombre_jugada,
    tk.caballo,
    tk.ejemplar_numero,
    tk.monto_jugado,
    tk.monto_decidido,
    tk.premio_pagar,
    tk.comision_porcentaje,
    tk.estado,
    tk.cliente_juega_nombre,
    tk.cliente_consigue_nombre,
    tk.moneda,
    tk.nota_auditoria,
    tk.fecha_registro,
    coalesce(tk.anulada, false)              as anulada,
    tk.anulada_motivo,
    tk.anulada_por,
    tk.anulada_at,
    tk.pagado_en,
    tk.pagado_por,
    (case when tk.nota_auditoria ~ '^\s*[\{\[]'
          then nullif(tk.nota_auditoria::jsonb ->> 'fecha_carrera', '')
     end)::date                              as fecha_carrera,
    (case when tk.nota_auditoria ~ '^\s*[\{\[]'
          then nullif(tk.nota_auditoria::jsonb ->> 'origen', '')
     end)                                    as origen,
    (case when tk.nota_auditoria ~ '^\s*[\{\[]'
          then nullif(tk.nota_auditoria::jsonb ->> 'usuario', '')
     end)                                    as usuario
from public.tickets_apuestas tk;

grant select on public.v_jugadas_carrera to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) RLS: lectura y UPDATE del staff autenticado (la app exige la capacidad).
--
--    IMPORTANTE: NO se ejecuta `enable row level security` ni `disable`: se
--    respeta el estado que ya tenga la tabla (hoy, RLS ACTIVO).
--
--    OJO: acá NO se crea una policy amplia `using (true)`. Esa policy —al ser
--    permisiva y sumarse por OR a las demás— ANULABA el aislamiento por grupo de
--    `tickets_apuestas` (src/db/rls_por_grupo.sql). Ahora la policy del monitor
--    exige el MISMO filtro de grupo (por `grupo_cobro_id` o por cliente propio),
--    con respaldo a `true` SOLO si todavía no se corrieron los resolutores
--    (sql/grupos_usuarios.sql), para que este script siga siendo autónomo.
-- ----------------------------------------------------------------------------
do $$
begin
  drop policy if exists tickets_apuestas_monitor_select on public.tickets_apuestas;
  drop policy if exists tickets_apuestas_monitor_update on public.tickets_apuestas;

  if to_regprocedure('public.usuario_en_grupo(uuid,text)') is not null
     and to_regprocedure('public.usuario_en_cliente(uuid,text)') is not null then
    execute $pol$
      create policy tickets_apuestas_monitor_select on public.tickets_apuestas
        for select to authenticated
        using (
          public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
          or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text)
        )$pol$;
    execute $pol$
      create policy tickets_apuestas_monitor_update on public.tickets_apuestas
        for update to authenticated
        using (
          public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
          or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text)
        )
        with check (
          public.usuario_en_grupo(auth.uid(), grupo_cobro_id::text)
          or public.usuario_en_cliente(auth.uid(), cliente_juega_id::text)
        )$pol$;
  else
    -- Sin resolutores todavía: se conserva el comportamiento anterior para no
    -- dejar el monitor sin lectura (se aprieta al correr grupos_usuarios.sql).
    execute $pol$
      create policy tickets_apuestas_monitor_select on public.tickets_apuestas
        for select to authenticated using (true)$pol$;
    execute $pol$
      create policy tickets_apuestas_monitor_update on public.tickets_apuestas
        for update to authenticated using (true) with check (true)$pol$;
  end if;
end
$$;

-- Forzar a PostgREST a recargar el esquema: sin esto, recién creada la vista
-- sigue respondiendo 404/PGRST205 hasta que Supabase refresque su caché.
notify pgrst, 'reload schema';

-- ============================================================================
--  VERIFICACIÓN
--    select * from public.v_jugadas_monitor order by hipodromo, carrera limit 20;
--    select column_name from information_schema.columns
--      where table_name = 'tickets_apuestas' and column_name in
--      ('anulada','anulada_motivo','anulada_por','anulada_at','pagado_en','pagado_por');
-- ============================================================================
