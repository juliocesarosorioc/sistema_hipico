// ============================================================================
// VALIDADOR DE SQL — corre los scripts del repo contra un Postgres REAL.
//
// POR QUÉ EXISTE
// --------------
// Los scripts de `sql/` se aplican a mano en el SQL Editor de Supabase: si
// tienen un error de sintaxis, el operador lo descubre EN PRODUCCIÓN, con un
// mensaje críptico ("syntax error at or near if") que no dice dónde está el
// problema real.
//
// Este script levanta un Postgres embebido (la misma versión que usa
// Supabase), aplica los scripts sobre un esquema mínimo y ejecuta pruebas
// FUNCIONALES de lo que acaban de crear. Es la única forma de saber que el
// SQL va a correr antes de subirlo.
//
// Los errores que encontró la primera vez (y que estaban en el repo):
//   - `end if;` cerrando un bloque `begin ... exception ... end;`.
//   - Variables de PL/pgSQL usadas sin declarar en el DECLARE.
//   - Texto (TEXT) insertado en una columna INTEGER.
//   - Parámetros con default ANTES de parámetros obligatorios.
//   - "8.000" leído como 8 (el separador de miles venezolano).
//
// USO
// ---
//   npm run validar:sql
//
// Requisitos: `npm i -D embedded-postgres pg` (los binarios de Postgres se
// descargan en el postinstall). El script avisa y exits con 1 si faltan.
// ============================================================================
import EmbeddedPostgres from "embedded-postgres";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = 55439;
const DB_DIR = process.env.PG_TMP_DIR || join(process.env.TEMP || process.env.TMPDIR || ".", "hipico-pgdata");

let pgMod;
try {
  pgMod = (await import("pg")).default ?? (await import("pg"));
} catch {
  console.error(
    "\nFalta la dependencia 'pg'. Instala las herramientas de validación:\n  npm i -D embedded-postgres pg\n"
  );
  process.exit(1);
}

const pg = new EmbeddedPostgres({
  databaseDir: DB_DIR,
  user: "postgres",
  password: "postgres",
  port: PUERTO,
  persistent: false,
  // UTF8 obligatorio: los scripts del repo tienen acentos y flechas (→) en los
  // comentarios, y WIN1252 los rechaza.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

console.log("Levantando Postgres embebido (UTF8)...");
await pg.initialise();
await pg.start();
await pg.createDatabase("sistema");
console.log(`Postgres arriba en el puerto ${PUERTO}.\n`);

async function ejecutar(sql, db = "sistema") {
  const c = new pgMod.Client({
    host: "localhost",
    port: PUERTO,
    user: "postgres",
    password: "postgres",
    database: db,
  });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// ESQUEMA MÍNIMO: lo que tocan los scripts nuevos. Reproduce la forma real
// (usuario_sistema.id es TEXT y el uuid de Auth va en `auth_id`), porque si el
// harness se aparta de la realidad, el validador miente.
// ---------------------------------------------------------------------------
const BASE = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable
  as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

create table if not exists public.ejemplares (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nacionalidad text not null default 'VE',
  created_at timestamptz not null default now()
);
create unique index if not exists uq_ejemplares_nombre_nac
  on public.ejemplares (lower(nombre), upper(nacionalidad));

create table if not exists public.gaceta_procesada (
  id uuid primary key default gen_random_uuid(),
  fecha_gaceta date,
  num_carreras int,
  contenido jsonb,
  creado_por text,
  created_at timestamptz not null default now()
);

create table if not exists public.resultados_carreras (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  hipodromo text not null,
  carrera int not null,
  ganadores text,
  orden_llegada jsonb,
  dividendos jsonb,
  retirado text,
  retirados text,
  aplicado_a_tablas boolean,
  premio_oficial numeric,
  premio_recalculado numeric
);

create table if not exists public.carreras (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  hipodromo text not null,
  hipodromo_id uuid,
  carrera int not null,
  estado text not null default 'Programada',
  caballos jsonb not null default '[]'::jsonb,
  retirados text,
  distancia text,
  superficie text,
  premio numeric,
  hora text,
  origen text not null default 'ia',
  registrado_por text,
  actualizado_por text,
  verificado boolean not null default false,
  verificado_por text,
  verificado_at timestamptz,
  invalidado_remate text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carreras_unico unique (fecha, hipodromo, carrera)
);

create table if not exists public.tablas_fijas (
  id bigserial primary key,
  hipodromo text,
  fecha date,
  carrera int,
  caballos jsonb not null default '[]'::jsonb,
  estado text,
  premio numeric
);

create table if not exists public.tickets_apuestas (
  id bigserial primary key,
  hipodromo text,
  carrera integer,
  nota_auditoria text,
  fecha_registro timestamptz not null default now()
);

create table if not exists public.usuario_sistema (
  id text primary key,
  auth_id uuid,
  nombre text,
  tipo_usuario_id int,
  activo boolean default true,
  es_principal boolean default false
);

create table if not exists public.capacidad (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  modulo text,
  tipo text,
  titulo text,
  riesgo text
);
create table if not exists public.tipo_usuario (
  id int primary key,
  nombre text not null,
  descripcion text
);
create table if not exists public.tipo_usuario_capacidad (
  tipo_usuario_id int not null references public.tipo_usuario(id),
  capacidad_id uuid not null references public.capacidad(id) on delete cascade,
  decision text,
  primary key (tipo_usuario_id, capacidad_id)
);
create table if not exists public.auditoria (
  id bigserial primary key,
  usuario text,
  modulo text,
  accion text,
  detalle jsonb,
  ip text,
  navegador text,
  ubicacion text,
  created_at timestamptz not null default now()
);

insert into public.capacidad (clave, modulo, tipo) values
  ('ejemplares:fn_guardar_ejemplar', 'ejemplares', 'funcion'),
  ('inteligencia_hipica:celda_memoria_historica', 'inteligencia_hipica', 'celda'),
  ('inteligencia_hipica:ruta_proyecciones', 'inteligencia_hipica', 'ruta'),
  ('carreras:fn_registrar_carrera', 'carreras', 'funcion'),
  ('tablas:btn_editar', 'tablas', 'boton'),
  ('contabilidad:fn_registrar_movimiento', 'contabilidad', 'funcion'),
  ('contabilidad:celda_movimientos', 'contabilidad', 'celda')
on conflict (clave) do nothing;

create or replace function public.tiene_capacidad(p_uid uuid, p_clave text)
returns boolean
language plpgsql
stable
as $$
declare
  v_es_principal boolean := false;
  v_tiene boolean := false;
begin
  if p_uid is null then
    return false;
  end if;
  select us.es_principal into v_es_principal
    from public.usuario_sistema us
   where us.auth_id = p_uid and us.activo
   limit 1;
  if coalesce(v_es_principal, false) then
    return true;
  end if;
  select exists (
    select 1
      from public.usuario_sistema us
      join public.tipo_usuario_capacidad tuc on tuc.tipo_usuario_id = us.tipo_usuario_id
      join public.capacidad c on c.id = tuc.capacidad_id
     where us.auth_id = p_uid and us.activo and c.clave = p_clave and tuc.decision = 'permitido'
  ) into v_tiene;
  return coalesce(v_tiene, false);
end;
$$;
`;

// ---------------------------------------------------------------------------
// Los scripts que se validan. El orden importa: el de las tablas fijas
// necesita la tabla `tablas_fijas`, y el de contabilidad es independiente.
// ---------------------------------------------------------------------------
const SCRIPTS = [
  "sql/memoria_historica.sql",
  "sql/gaceta_lote_carreras.sql",
  "sql/tablas_caballo_invalidado.sql",
  "sql/contabilidad_niif.sql",
];

let fallos = 0;
let oks = 0;

function comprobar(condicion, mensaje, detalle) {
  if (condicion) {
    oks++;
    console.log(`  ok   ${mensaje}`);
  } else {
    fallos++;
    console.log(`  FALLA ${mensaje}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

try {
  await ejecutar(BASE);
  console.log("Esquema minimo creado.\n");

  for (const s of SCRIPTS) {
    const sql = readFileSync(join(RAIZ, s), "utf8");
    try {
      await ejecutar(sql);
      console.log(`  OK    ${s}`);
    } catch (e) {
      fallos++;
      console.log(`  FALLA ${s}\n        ${String(e.message).split("\n")[0]}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log("\n[funcional] carreras con jugadas en la unica matriz");
  // -------------------------------------------------------------------------
  await ejecutar(`
    insert into public.tickets_apuestas (hipodromo, carrera, nota_auditoria, fecha_registro)
    values ('BELMONT PARK', 3, '{"fecha_carrera":"2026-10-22"}', '2026-10-23T12:00:00Z')
  `);
  try {
    const migracionCatalogo = readFileSync(
      join(RAIZ, "sql/carreras_catalogo_desde_jugadas.sql"),
      "utf8"
    );
    await ejecutar(migracionCatalogo);
    const historica = await ejecutar(`
      select fecha::text, hipodromo, carrera, caballos
        from public.carreras
       where fecha = date '2026-10-22'
         and hipodromo = 'BELMONT PARK'
         and carrera = 3
    `);
    comprobar(
      historica.rows.length === 1 &&
        historica.rows[0]?.caballos?.length === 0,
      "backfill incluye carreras historicas con jugadas y sin ejemplares"
    );

    await ejecutar(`
      insert into public.tickets_apuestas (hipodromo, carrera, nota_auditoria, fecha_registro)
      values ('KEENELAND', 5, '{"fecha_carrera":"2026-10-23"}', '2026-10-23T18:00:00Z')
    `);
    const futura = await ejecutar(`
      select count(*)::int as cantidad
        from public.carreras
       where fecha = date '2026-10-23'
         and hipodromo = 'KEENELAND'
         and carrera = 5
    `);
    comprobar(futura.rows[0]?.cantidad === 1, "el trigger cataloga futuras carreras al guardar jugadas");

    await ejecutar(migracionCatalogo);
    const idempotente = await ejecutar(`
      select count(*)::int as cantidad
        from public.carreras
       where fecha = date '2026-10-22'
         and hipodromo = 'BELMONT PARK'
         and carrera = 3
    `);
    comprobar(idempotente.rows[0]?.cantidad === 1, "el backfill se puede volver a ejecutar sin duplicar");
  } catch (e) {
    fallos++;
    console.log(`  FALLA sql/carreras_catalogo_desde_jugadas.sql\n        ${String(e.message).split("\n")[0]}`);
  }

  // -------------------------------------------------------------------------
  console.log("\n[funcional] jerarquía de cruces por modalidad");
  // -------------------------------------------------------------------------
  await ejecutar(`
    create table if not exists public.grupos_venta (
      id uuid primary key,
      nombre text not null,
      permite_cruces boolean
    );
    create table if not exists public.clientes (
      id uuid primary key,
      nombre text not null,
      permite_cruces boolean
    );
    alter table public.resultados_carreras add column if not exists detalle jsonb not null default '{}'::jsonb;
    create or replace function public.usuario_en_grupo(u uuid, g text)
      returns boolean language sql stable as $$ select true $$;
    insert into public.grupos_venta (id, nombre, permite_cruces)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grupo prueba', true);
    insert into public.clientes (id, nombre, permite_cruces)
      values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cliente prueba', true);
  `);
  try {
    await ejecutar(readFileSync(join(RAIZ, "sql/permite_cruces_jerarquia.sql"), "utf8"));
    const flags = await ejecutar(`
      select g.cruce_mismo_ejemplar as grupo_mismo,
             g.cruce_diferente_ejemplar as grupo_diferente,
             c.cruce_mismo_ejemplar as cliente_mismo,
             c.cruce_diferente_ejemplar as cliente_diferente
        from public.grupos_venta g cross join public.clientes c
    `);
    comprobar(
      flags.rows[0]?.grupo_mismo === true &&
        flags.rows[0]?.grupo_diferente === true &&
        flags.rows[0]?.cliente_mismo === true &&
        flags.rows[0]?.cliente_diferente === true,
      "migra la configuración legacy sin cambiar las reglas existentes"
    );
    await ejecutar(`
      insert into public.resultados_carreras (fecha, hipodromo, carrera, detalle)
      values ('2026-10-23', 'HIPODROMO PRUEBA', 4,
        '{"cruces_carrera_override":{"todos":{"mismoEjemplar":true}}}'::jsonb)
    `);
    const snapshot = await ejecutar(`
      select cruces_carrera_override
        from public.resultados_carreras
       where fecha = '2026-10-23' and hipodromo = 'HIPODROMO PRUEBA' and carrera = 4
    `);
    comprobar(
      snapshot.rows[0]?.cruces_carrera_override?.todos?.mismoEjemplar === true,
      "conserva el override en el resultado liquidado"
    );
    await ejecutar(`
      insert into public.cruces_carrera_config
        (grupo_id, fecha, hipodromo, carrera, cruces_carrera_override)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-10-23', 'HIPODROMO PRUEBA', 4,
        '{"porJugador":{"JUAN":{"diferenteEjemplar":false}}}'::jsonb)
    `);
    const raceOverride = await ejecutar(`
      select cruces_carrera_override -> 'porJugador' -> 'JUAN' ->> 'diferenteEjemplar' as valor
        from public.cruces_carrera_config
    `);
    comprobar(raceOverride.rows[0]?.valor === "false", "persiste la excepción aislada de carrera por jugador");
  } catch (e) {
    comprobar(false, "aplica SQL de jerarquía de cruces", String(e.message).split("\n")[0]);
  }

  // -------------------------------------------------------------------------
  console.log("\n[funcional] memoria historica");
  // -------------------------------------------------------------------------
  await ejecutar(`
    insert into public.usuario_sistema (id, auth_id, nombre, tipo_usuario_id, activo, es_principal)
    values ('josorioc', '11111111-1111-1111-1111-111111111111', 'Prueba', 1, true, true)
    on conflict (id) do nothing;
    select public.rpc_registrar_gaceta_e_historial(
      '2026-10-04'::date,
      '[{"carrera":1,"hipodromo":"LA RINCONADA","distancia":"1.400","superficie":"arena","premio":"8.000",
         "ejemplares":[{"numero":"1","nombre":"EL TREMENDO","nacionalidad":"VE"},
                       {"numero":"2","nombre":"LA FARAONA","nacionalidad":"VE"}]}]'::jsonb,
      'prueba'
    );
  `);

  let r = await ejecutar(`
    select nombre, puesto, distancia, superficie, premio
      from public.memoria_historica_caballos order by nombre;
  `);
  const filas = r.rows;
  comprobar(filas.length === 2, "la gaceta registra los dos ejemplares", JSON.stringify(filas));
  comprobar(
    filas.every((f) => f.puesto === 0),
    "una carrera NO disputada queda con puesto 0 (participación, resultado pendiente)",
    JSON.stringify(filas.map((f) => f.puesto))
  );
  comprobar(
    filas.every((f) => f.distancia === 1400),
    'la distancia "1.400" son 1400 metros (el punto de miles se descarta)',
    JSON.stringify(filas.map((f) => f.distancia))
  );
  comprobar(
    filas.every((f) => Number(f.premio) === 8000),
    'el premio "8.000" son 8000 (Postgres lo leeria como 8)',
    JSON.stringify(filas.map((f) => f.premio))
  );

  r = await ejecutar(`
    select * from public.rpc_obtener_memoria_historica_caballos(
      array['EL TREMENDO','LA FARAONA'], '2026-10-05'::date);
  `);
  comprobar(
    r.rows.length === 0,
    "una carrera que no se corrio NO cuenta como actuacion del caballo",
    JSON.stringify(r.rows)
  );

  await ejecutar(`
    insert into public.resultados_carreras (fecha, hipodromo, carrera, ganadores, orden_llegada)
    values ('2026-10-04','LA RINCONADA',1,'1','[{"numero":"1","puesto":1},{"numero":"2","puesto":2}]');
    select public.rpc_registrar_gaceta_e_historial(
      '2026-10-04'::date,
      '[{"carrera":1,"hipodromo":"LA RINCONADA","distancia":"1.400","superficie":"arena","premio":"8.000",
         "ejemplares":[{"numero":"1","nombre":"EL TREMENDO","nacionalidad":"VE"},
                       {"numero":"2","nombre":"LA FARAONA","nacionalidad":"VE"}]}]'::jsonb,
      'prueba'
    );
  `);
  r = await ejecutar(`select nombre, puesto from public.memoria_historica_caballos order by nombre;`);
  comprobar(
    r.rows.every((f) => f.puesto > 0),
    "con el resultado cargado, el puesto se rellena (1 y 2)",
    JSON.stringify(r.rows)
  );

  r = await ejecutar(`
    select nombre, actuaciones, placements, indice_consistencia_godet
      from public.rpc_obtener_memoria_historica_caballos(
        array['EL TREMENDO','LA FARAONA'], '2026-10-05'::date);
  `);
  comprobar(r.rows.length === 2, "la memoria devuelve los dos ejemplares", JSON.stringify(r.rows));
  comprobar(
    r.rows.every((f) => f.actuaciones === 1 && f.placements === 1),
    "1 actuacion y 1 top-3 para cada uno",
    JSON.stringify(r.rows)
  );
  comprobar(
    r.rows.every((f) => Number(f.indice_consistencia_godet) === 100),
    "el Indice de Consistencia Godet pondera el premio (100)",
    JSON.stringify(r.rows.map((f) => f.indice_consistencia_godet))
  );

  // -------------------------------------------------------------------------
  console.log("\n[funcional] carga por lotes ACUMULATIVA");
  // -------------------------------------------------------------------------
  await ejecutar(`
    select public.rpc_guardar_lote_carreras_gaceta(
      '2026-10-04'::date, 'LA RINCONADA',
      '[{"carrera":1,"distancia":"1400","superficie":"ARENA","premio":"8000",
         "ejemplares":[{"numero":"1","nombre":"EL TREMENDO"},{"numero":"2","nombre":"LA FARAONA"}]},
        {"carrera":2,"distancia":"1400","superficie":"ARENA","premio":"8000",
         "ejemplares":[{"numero":"1","nombre":"MI NINA"}]}]'::jsonb,
      'prueba'
    );
  `);
  await ejecutar(`
    select public.rpc_guardar_lote_carreras_gaceta(
      '2026-10-04'::date, 'LA RINCONADA',
      '[{"carrera":2,"distancia":"1400","superficie":"ARENA","premio":"8000",
         "ejemplares":[{"numero":"1","nombre":"MI NINA"},{"numero":"3","nombre":"EL GRANDE"}]}]'::jsonb,
      'prueba'
    );
  `);
  r = await ejecutar(`
    select c.carrera,
           (select string_agg(e ->> 'nombre', ', ' order by (e ->> 'numero')::int)
              from jsonb_array_elements(c.caballos) e) as ejemplares
      from public.carreras c
     where c.fecha = '2026-10-04' and c.hipodromo = 'LA RINCONADA'
     order by c.carrera;
  `);
  const c1 = r.rows.find((x) => x.carrera === 1);
  const c2 = r.rows.find((x) => x.carrera === 2);
  comprobar(r.rows.length === 2, "las dos carreras siguen tras el segundo lote", JSON.stringify(r.rows));
  comprobar(
    c1 && c1.ejemplares === "EL TREMENDO, LA FARAONA",
    "la carrera que NO vino en el segundo lote no se toca",
    c1 && c1.ejemplares
  );
  comprobar(
    c2 && c2.ejemplares === "MI NINA, EL GRANDE",
    "la carrera del segundo lote SUMA ejemplares (no reemplaza)",
    c2 && c2.ejemplares
  );
} catch (e) {
  fallos++;
  console.log("ERROR GENERAL: " + String(e.message).split("\n")[0]);
} finally {
  try {
    await pg.stop();
  } catch {
    /* el servidor ya pudo estar parado */
  }
}

console.log(`\n${fallos === 0 ? "SQL OK" : fallos + " FALLOS"} · ${oks} comprobaciones ok`);
process.exit(fallos === 0 ? 0 : 1);
