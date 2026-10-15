// ============================================================================
// Genera el seed SQL del MAESTRO de seguridad a partir del registro de
// capacidades del código, para que la base y el código no puedan divergir.
//
//   node pruebas/generar-seed-maestro.mjs > src/db/maestro_seed.sql
//
// El registro está en TypeScript: `cargar-maestro.mjs` lo compila con el mismo
// compilador del proyecto a un temporal y lo importa desde ahí. Determinista:
// no depende de regex sobre el fuente.
//
// El archivo que genera es idempotente: se puede aplicar más de una vez.
//
//   node pruebas/generar-seed-maestro.mjs src/db/maestro_seed.sql
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cargarRegistro, cargarAbac, RAIZ } from "./cargar-maestro.mjs";

const DESTINO = process.argv[2] ?? null;

const { MODULOS_ESQUEMA, CAPACIDADES, baseDeTipo, expandirConRequisitos } = await cargarRegistro();
const { ATRIBUTOS, REGLAS_ABAC } = await cargarAbac();

if (!MODULOS_ESQUEMA?.length || !CAPACIDADES?.length) {
  console.error("No pude cargar el registro maestro. Aborto: no quiero generar un seed vacío.");
  process.exit(1);
}

const TIPOS = ["admin", "operador", "consulta", "jugador"];

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);

/**
 * Un `jsonb` de la regla, para la columna `condicion` de `regla_abac`.
 *
 * Va como texto con `::jsonb` y NO como literal jsonb: el `generar_series` de
 * los arrays y los comillas sueltos del `valor` harían que el INSERT no sea
 * legible y sea fácil que se corrompa al editarlo a mano.
 */
const jsonb = (o) => `${q(JSON.stringify(o))}::jsonb`;
const arr = (xs) => `array[${(xs ?? []).map(q).join(", ")}]::text[]`;

const L = [];
L.push("-- ============================================================================");
L.push("-- SEED del maestro de seguridad - GENERADO AUTOMATICAMENTE. NO EDITAR A MANO.");
L.push("--   Fuente:    src/lib/seguridad/capacidades.ts");
L.push("--   Regenerar: node pruebas/generar-seed-maestro.mjs > src/db/maestro_seed.sql");
L.push("--   Aplicar DESPUES de src/db/seguridad_maestro.sql (que crea el esquema).");
L.push("-- ============================================================================");
L.push("");
L.push(`-- ${CAPACIDADES.length} capacidades en ${MODULOS_ESQUEMA.length} modulos.`);
L.push("");
L.push("-- ------------------------------------------------------------ capacidades");
for (const c of CAPACIDADES) {
  L.push(
    `insert into public.capacidad (clave, modulo, tipo, titulo, riesgo, fuente, requiere) values (${q(
      c.clave
    )}, ${q(c.modulo)}, ${q(c.tipo)}, ${q(c.titulo)}, ${q(c.riesgo)}, ${q(c.fuente)}, ${arr(c.requiere)}) ` +
      `on conflict (clave) do update set modulo = excluded.modulo, tipo = excluded.tipo, ` +
      `titulo = excluded.titulo, riesgo = excluded.riesgo, fuente = excluded.fuente, requiere = excluded.requiere;`
  );
}

L.push("");
L.push("-- ------------------------------------ tipos de usuario");
for (let i = 0; i < TIPOS.length; i++) {
  L.push(
    `insert into public.tipo_usuario (id, nombre, descripcion) values (${i + 1}, ${q(TIPOS[i])}, ${q(
      `Base generica: ${TIPOS[i]}`
    )}) on conflict (id) do update set nombre = excluded.nombre;`
  );
}

L.push("");
L.push("-- ------------------------- retirar capacidades que el maestro ya no declara");
L.push("-- Sin esto, una capacidad borrada del código sigue viva en `public.capacidad`");
L.push("-- y el sidebar sigue authorizing un control que ya no existe. El RBAC viejo");
L.push("-- (`src/db/rbac.sql`) usa `public.permisos`, otra tabla: no se toca acá.");
L.push(
  `delete from public.capacidad c\n` +
    `where not exists (select 1 from unnest(${arr(CAPACIDADES.map((c) => c.clave))}) as v(clave) where v.clave = c.clave);`
);

L.push("");
L.push("-- ------------------------------------- matriz base de cada tipo de usuario");
for (let i = 0; i < TIPOS.length; i++) {
  const nombre = TIPOS[i];
  const caps = [...expandirConRequisitos(baseDeTipo(nombre))].sort();
  L.push(`-- ${nombre}: ${caps.length} capacidades`);
  L.push(
    `insert into public.tipo_usuario_capacidad (tipo_usuario_id, capacidad_id, decision)\n` +
      `select ${i + 1}, c.id, 'permitido' from public.capacidad c where c.clave = any (${arr(caps)})\n` +
      `on conflict (tipo_usuario_id, capacidad_id) do update set decision = excluded.decision;`
  );
  L.push("");
}

L.push("-- -------------------------------------- usuario principal (acceso total)");
L.push("insert into public.usuario_sistema (id, nombre, tipo_usuario_id, activo, es_principal)");
L.push("values ('josorioc', 'Usuario principal', 1, true, true)");
L.push("on conflict (id) do update set tipo_usuario_id = excluded.tipo_usuario_id, es_principal = excluded.es_principal;");
L.push("");

// ============================================================================
// ABAC
// ============================================================================
L.push("-- ============================================ ABAC: atributos y reglas");
L.push("-- Catálogo de atributos y reglas por capacidad. El código que decide está");
L.push("-- en src/lib/seguridad/abac.ts; la base evalúa lo mismo en");
L.push("-- public.puede_contexto(u, clave, ctx), para que la policy y la UI den");
L.push("-- la misma respuesta. Si se edita una regla, se regenera este archivo.");
L.push("");

if (!ATRIBUTOS?.length || !REGLAS_ABAC?.length) {
  console.error("No pude cargar el catálogo ABAC. Aborto: un seed sin reglas deja el ABAC mudo.");
  process.exit(1);
}

L.push(`-- ${ATRIBUTOS.length} atributos, ${REGLAS_ABAC.length} reglas.`);
L.push("");
L.push("-- ------------------------------------------------------------- atributos");
for (const a of ATRIBUTOS) {
  L.push(
    `insert into public.atributo (clave, nombre, tipo, descripcion, origen) values (${q(a.clave)}, ${q(
      a.nombre
    )}, ${q(a.tipo)}, ${q(a.descripcion)}, ${q(a.origen)}) ` +
      `on conflict (clave) do update set nombre = excluded.nombre, tipo = excluded.tipo, ` +
      `descripcion = excluded.descripcion, origen = excluded.origen;`
  );
}

L.push("");
L.push("-- ----------------------------------------------------------------- reglas");
L.push("-- `condicion` lleva el operador y el valor esperados, para que la base");
L.push("-- pueda evaluarla sin volver aárbol TypeScript.");
for (const r of REGLAS_ABAC) {
  const cond = { operador: r.operador, valor: r.valor ?? null };
  L.push(
    `insert into public.regla_abac (id, capacidad_id, ambito, atributo_id, condicion, efecto, mensaje, ` +
      `clase, principal_exento, riesgo, fuente)\n` +
      `select ${q(r.id)}, c.id, ${q(r.ambito)}, a.id, ${jsonb(cond)}, ${q(r.efecto)}, ${q(r.mensaje)}, ` +
      `${q(r.clase)}, ${r.principal === "exento"}, ${q(r.riesgo)}, ${q(r.fuente)}\n` +
      `from public.capacidad c, public.atributo a\n` +
      `where c.clave = ${q(r.capacidad)} and a.clave = ${q(r.atributo)}\n` +
      `on conflict (id) do update set capacidad_id = excluded.capacidad_id, ambito = excluded.ambito, ` +
      `atributo_id = excluded.atributo_id, condicion = excluded.condicion, efecto = excluded.efecto, ` +
      `mensaje = excluded.mensaje, clase = excluded.clase, principal_exento = excluded.principal_exento, ` +
      `riesgo = excluded.riesgo, fuente = excluded.fuente;`
  );
}

L.push("");
L.push("-- ------- retirar reglas que el código ya no declara (mismo criterio que");
L.push("--         las capacidades: si la regla no está en el registro, se va)");
L.push(
  `delete from public.regla_abac r\n` +
    `where not exists (select 1 from unnest(${arr(REGLAS_ABAC.map((r) => r.id))}) as v(id) where v.id = r.id);`
);

L.push("");

const salida = L.join("\n");

if (DESTINO) {
  const ruta = resolve(RAIZ, DESTINO);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, salida, "utf8");
  console.error(`escrito ${DESTINO} · ${CAPACIDADES.length} capacidades · ${MODULOS_ESQUEMA.length} modulos`);
} else {
  process.stdout.write(salida);
}
