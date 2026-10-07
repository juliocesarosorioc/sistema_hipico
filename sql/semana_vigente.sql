-- ============================================================================
-- SEMANA VIGENTE — qué semana está en uso, aunque el calendario ya haya pasado
-- ============================================================================
-- ES IDEMPOTENTE. Aplicarlo varias veces no cambia nada.
-- Ejecutar en el SQL Editor de Supabase.
--
-- ----------------------------------------------------------------------------
-- QUÉ ES
-- ----------------------------------------------------------------------------
-- Una columna en `grupos_venta` que dice qué semana fiscal se está operando, en
-- lugar de deducirla siempre de la fecha de hoy.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA
-- ----------------------------------------------------------------------------
-- `dia_inicio_semana` / `dia_fin_semana` dicen QUÉ DÍAS forman la semana, pero
-- no cuál de las muchas semanas posibles es la vigente. Eso se deducía con la
-- fecha de hoy, y la deducción falla en el momento que importa: cuando la casa
-- opera la semana anterior porque la actual todavía no arrancó, o cuando el
-- cierre de una semana se hace varios días después de su corte.
--
-- Con la deducción, el lunes a la 01:00 la pantalla ya muestra la semana nueva
-- y el cierre de la que se acaba de terminar desaparece de la vista: el operador
-- ve "ABIERTA" sobre una semana que ya cerró y no encuentra dónde consolidarla.
--
-- Fijarla deja el estado explícito y auditable:
--   NULL  → se deduce de hoy (comportamiento anterior, no cambia nada)
--   fecha → esa es la semana vigente, se agote o no el calendario
--
-- ----------------------------------------------------------------------------
-- POR QUÉ ES UNA COLUMNA Y NO UNA TABLA
-- ----------------------------------------------------------------------------
-- Es un dato DEL GRUPO, no un historial: un grupo tiene una semana vigente y
-- listo. La foto histórica ya la guarda `cierres_jornada`; duplicarla acá sería
-- tener dos fuentes de la verdad que se contradicen.
--
-- Solo se guarda el INICIO: el fin sale del ciclo del grupo
-- (dia_inicio_semana/dia_fin_semana), que es el que ya define la semana. Guardar
-- los dos dejaría la posibilidad de que un par inicio/fin no coincida con el
-- ciclo y la semana "vigente" fuera de 7 días.
--
-- ----------------------------------------------------------------------------
-- ROL DE ESCRITURA
-- ----------------------------------------------------------------------------
-- Mover la semana vigente cambia sobre qué rango se consolida el balance de la
-- casa, así que solo lo hace el USUARIO PRINCIPAL (ver `soy_principal()` en
-- src/db/seguridad_maestro.sql). La app lo oculta igual, pero la frontera de
-- verdad está acá: la columna no tiene privilegio de escritura para `anon` ni
-- para `authenticated`, y la RPC que sí la escribe es `security definer` con su
-- propia guarda `soy_principal()`.

begin;

-- ----------------------------------------------------------------------------
-- 1) La columna
-- ----------------------------------------------------------------------------
alter table public.grupos_venta
    add column if not exists semana_vigente_inicio date;

comment on column public.grupos_venta.semana_vigente_inicio is
  'Inicio (YYYY-MM-DD) de la semana fiscal vigente. NULL = se deduce de la fecha de hoy. Solo el usuario principal la escribe.';

-- ----------------------------------------------------------------------------
-- 2) No puede ser una fecha imposible
-- ----------------------------------------------------------------------------
-- Un check distinto al CHECK de los días: acá la restricción es que la fecha
-- esté dentro de un rango con sentido, para que un dato de formato roto no deje
-- la semana vigente calculando rangos imposibles.
--
-- Postgres no tiene "IF NOT EXISTS" en un CHECK, así que se pregunta al
-- catálogo antes de crearlo (mismo truco que sql/ciclos_facturacion_semanal.sql).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'grupos_venta_semana_vigente_valida'
  ) then
    alter table public.grupos_venta
      add constraint grupos_venta_semana_vigente_valida
      check (
        semana_vigente_inicio is null
        or (semana_vigente_inicio >= date '2000-01-01'
            and semana_vigente_inicio <  date '2100-01-01')
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Nadie escribe la columna en crudo; todos la leen
-- ----------------------------------------------------------------------------
-- La LECTURA es para todos los autenticados: la semana vigente es el dato que
-- la operatoria necesita ver para saber sobre qué rango se está consolidando.
--
-- La ESCRITURA no se concede por privilegio de columna, sino por la RPC de la
-- sección 4. Se revoca el `update` de esa columna porque, si algún script previo
-- dejó un `grant update` de TABLA (o una policy permisiva de update), el
-- privilegio de columna no alcanzaría para frenarlo: en Postgres un `grant` de
-- columna solo acota mientras no exista uno de tabla. La RPC es `security
-- definer`, así que escribe la columna sin necesitar ese privilegio.
--
-- Ojo con NO crear una policy `for update` de "solo el principal" sobre la tabla
-- entera. En Postgres las políticas permisivas del mismo comando se combinan con
-- OR: si ya existe una policy de update (la de otro script), una nueva que pida
-- `soy_principal()` no restringe nada y no aporta seguridad, solo la sensación de
-- que sí. Lo que protege de verdad es el `revoke` de la columna de arriba.
--
-- Se borran y se recrean las políticas de lectura para que aplicar el script de
-- nuevo no deje dos políticas viejas contradiciéndose.
-- ----------------------------------------------------------------------------
alter table public.grupos_venta enable row level security;

drop policy if exists grupos_venta_semana_vigente_lectura on public.grupos_venta;
drop policy if exists grupos_venta_semana_vigente_escritura on public.grupos_venta;

create policy grupos_venta_semana_vigente_lectura
  on public.grupos_venta
  for select
  to authenticated
  using (true);

grant select on public.grupos_venta to authenticated;

-- La llave pública del navegador no toca esta tabla ni de lectura ni de
-- escritura. `grupos_venta_lectura.sql` le daba `select` a `anon`; esta tabla
-- no lo necesita para funcionar, así que no se le abre nada nuevo.
revoke update on public.grupos_venta from anon;
revoke update (semana_vigente_inicio) on public.grupos_venta from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) Cómo se lee y cómo se escribe, documentado junto a la columna
-- ----------------------------------------------------------------------------
-- La app NO escribe la columna con un update suelto: usa
-- `club_fijar_semana_vigente(p_grupo_id, p_inicio)`, que es `security definer`
-- y valida que el inicio pertenezca a una semana real del ciclo del grupo.
-- Un update directo podría dejar un inicio que no coincide con
-- dia_inicio_semana y la semana vigente sería un rango arbitrario.

create or replace function public.club_fijar_semana_vigente(
  p_grupo_id  uuid,
  p_inicio    date default null   -- NULL = volver a deducirla de hoy
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio date;
begin
  -- Solo el principal. Sin esta guarda la función `security definer` sería un
  -- agujero: ejecutarla salta el RLS de la tabla.
  if not public.soy_principal() then
    raise exception 'Solo el usuario principal puede fijar la semana vigente.'
      using errcode = '42501';
  end if;

  if p_grupo_id is null then
    raise exception 'Falta el grupo.'
      using errcode = '22004';
  end if;

  v_inicio := p_inicio;

  if v_inicio is not null then
    -- El inicio tiene que caer en el día de apertura del ciclo. Si no, el fin
    -- calculado a partir de él no es el corte del grupo y la semana vigente
    -- deja de ser una semana.
    -- `extract(isodow ...)` ya numera igual que la columna: 1 = Lunes … 7 =
    -- Domingo. No hace falta traducir nada.
    if not exists (
      select 1
      from public.grupos_venta g
      where g.id = p_grupo_id
        and extract(isodow from v_inicio)::int = coalesce(g.dia_inicio_semana, 1)
    ) then
      raise exception 'El inicio % no es un día de apertura del ciclo del grupo.', v_inicio
        using errcode = '22007';
    end if;
  end if;

  update public.grupos_venta
     set semana_vigente_inicio = v_inicio
   where id = p_grupo_id;

  if not found then
    raise exception 'El grupo % no existe.', p_grupo_id
      using errcode = 'P0002';
  end if;

  return v_inicio;
end;
$$;

comment on function public.club_fijar_semana_vigente(uuid, date) is
  'Fija (o con NULL libera) la semana fiscal vigente de un grupo. Solo el usuario principal.';

-- EXECUTE solo a los autenticados: si se le deja a `anon`, la llave pública del
-- navegador podría desplazar la semana sin haber iniciado sesión.
revoke execute on function public.club_fijar_semana_vigente(uuid, date) from public, anon;
grant execute on function public.club_fijar_semana_vigente(uuid, date) to authenticated;

commit;