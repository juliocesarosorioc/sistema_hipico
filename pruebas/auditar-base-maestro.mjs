// ============================================================================
// AUDITORÍA DEL ESTADO REAL DEL MAESTRO EN LA BASE.
//
// Responde lo que el código no puede responder solo: si la base y el registro
// maestro están de acuerdo. El código declara capacidades; la base tiene las
// suyas. Si divergen, el sidebar autoriza controles que la base no conoce, o la
// matriz le da a un rol una capacidad que ya no existe.
//
// Usa la llave ANON a propósito: si la auditoría necesita privilegios
//kel elevated para leer, eso ya es un hallazgo (los accesos del sistema
// lo que se está exponiendo). Solo LEE, no escribe.
//
//   node pruebas/auditar-base-maestro.mjs
// ============================================================================
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { cargarRegistro, RAIZ } from "./cargar-maestro.mjs";

function leerEnv() {
  try {
    const txt = readFileSync(".env.local", "utf8");
    const out = {};
    for (const l of txt.split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = leerEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let pasan = 0;
let fallan = 0;
const mal = (m) => {
  console.log(`  FALLA ${m}`);
  fallan++;
};
const ok = (m) => {
  console.log(`  ok   ${m}`);
  pasan++;
};

if (!url || !anon) {
  console.log("  FALLA sin NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY en .env.local");
  process.exit(1);
}

const db = createClient(url, anon, { auth: { persistSession: false } });
const { CAPACIDADES, CAPACIDADES_POR_CLAVE, baseDeTipo, expandirConRequisitos, USUARIO_PRINCIPAL } =
  await cargarRegistro();

console.log("\n[1] Las tablas del maestro existen");
console.log("=".repeat(70));
// Estas son exactamente las tablas que crea src/db/seguridad_maestro.sql y que
// lee src/lib/seguridad/accesos.ts. Ni una más: `modulo` se discutió al
// principio y no existe (el módulo vive en `capacidad.modulo`, como texto), así
// que pedirla acá reportaba un faltante que no era real.
const TABLAS_MAESTRO = [
  "capacidad",
  "tipo_usuario",
  "tipo_usuario_capacidad",
  "usuario_sistema",
  "usuario_capacidad",
  // ABAC: el catálogo de atributos, las reglas y los atributos por usuario.
  // Si faltan, el RBAC funciona pero el ABAC queda mudo en la base, y la UI
  // dejaría pasar un botón que la policy después rebota.
  "atributo",
  "regla_abac",
  "usuario_atributo",
];

const conteos = {};
const inexistentes = [];
for (const tabla of TABLAS_MAESTRO) {
  // Un SELECT de verdad, no `head`: con `head` Supabase devuelve
  // `{ count: null, error: null }` cuando la tabla no existe, y eso se
  // reportaba como "ok con 0 filas". El mensaje de error real ("404: Could not
  // find the table") es lo que distingue "vacía" de "nunca aplicada".
  const { data, error } = await db.from(tabla).select("*").limit(1);
  if (error) {
    inexistentes.push(tabla);
    mal(`${tabla}: ${error.message}`);
  } else {
    const { count } = await db.from(tabla).select("*", { count: "exact", head: true });
    conteos[tabla] = count ?? 0;
    ok(`${tabla} existe (${conteos[tabla]} filas visibles para anon)`);
  }
}

// Si el esquema no está, NO tiene sentido seguir: cada comprobación de abajo
// daría un falso negativo distinto. Se dice qué aplicar y se sale.
if (inexistentes.length) {
  console.log(
    `\n  El esquema del maestro NO está aplicado: faltan ${inexistentes.length} tablas` +
      ` (${inexistentes.join(", ")}).`
  );
  console.log("  Esto NO es un problema de permisos del sistema: no hay de dónde leer.");
  console.log("\n  Que hacer: en el SQL Editor de Supabase, en este orden:");
  console.log("    1. src/db/seguridad_maestro.sql   (crea esquema, funciones y RLS)");
  console.log("    2. src/db/maestro_seed.sql        (generado desde el registro maestro)");
  console.log('    3. $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."   (solo en esa terminal)');
  console.log('       node pruebas/crear-admin.mjs josorioc "TU_CONTRASENA"');
  console.log("    4. node pruebas/auditar-base-maestro.mjs  (esta auditoría, de nuevo)");
  console.log(`\n${fallan} fallas, 0 ok. La base de negocio (hipodromos, clientes, tickets) sí`);
  console.log("responde: el problema es solo que el RBAC nunca se aplicó.");
  console.log("");
  process.exit(1);
}

// =============================================================================
console.log("\n[2] Las capacidades de la base coinciden con el registro");
// =============================================================================
{
  const { data: enBase, error } = await db.from("capacidad").select("clave, modulo, tipo, riesgo");
  if (error) {
    mal(`no pude leer public.capacidad: ${error.message} (RLS lo oculta a anon?)`);
  } else {
    const base = new Set((enBase ?? []).map((c) => c.clave));
    ok(`la base tiene ${base.size} capacidades`);

    const faltan = CAPACIDADES.map((c) => c.clave).filter((k) => !base.has(k));
    if (!faltan.length) ok("toda capacidad del registro existe en la base");
    else
      mal(
        `el seed NO esta aplicado: faltan ${faltan.length} en la base` +
          (faltan.length <= 6 ? ` (${faltan.join(", ")})` : ` (${faltan.slice(0, 6).join(", ")}...)`)
      );

    const sobran = [...base].filter((k) => !CAPACIDADES_POR_CLAVE.has(k));
    if (!sobran.length) ok("la base no tiene capacidades retiradas del registro");
    else
      mal(
        `la base conserva ${sobran.length} capacidades que el codigo ya no declara` +
          (sobran.length <= 6 ? `: ${sobran.join(", ")}` : `: ${sobran.slice(0, 6).join(", ")}...`)
      );

    // Los metadatos tambien tienen que coincidir: una capacidad con el riesgo
    // viejo en la base hace que la matriz proteja mas (o menos) de lo que dice
    // el codigo.
    const porClave = new Map((enBase ?? []).map((c) => [c.clave, c]));
    const metasDistintas = [];
    for (const c of CAPACIDADES) {
      const b = porClave.get(c.clave);
      if (!b) continue;
      if (b.modulo !== c.modulo || b.tipo !== c.tipo || b.riesgo !== c.riesgo) {
        metasDistintas.push(`${c.clave} (base: ${b.modulo}/${b.tipo}/${b.riesgo} | codigo: ${c.modulo}/${c.tipo}/${c.riesgo})`);
      }
    }
    if (!metasDistintas.length) ok("modulo, tipo y riesgo coinciden en cada capacidad");
    else
      mal(
        `${metasDistintas.length} capacidades difieren en sus metadatos` +
          (metasDistintas.length <= 4 ? `: ${metasDistintas.join("; ")}` : `: ${metasDistintas.slice(0, 4).join("; ")}...`)
      );
  }
}

// =============================================================================
console.log("\n[3] La matriz de cada tipo coincide con la base generica");
// =============================================================================
{
  const { data: tipos } = await db.from("tipo_usuario").select("id, nombre, activo");
  if (!tipos?.length) {
    mal("public.tipo_usuario esta vacia o no se lee");
  } else {
    ok(`la base tiene ${tipos.length} tipos: ${tipos.map((t) => t.nombre).join(", ")}`);

    const { data: matrix } = await db.from("tipo_usuario_capacidad").select("tipo_usuario_id, decision");
    const { data: caps } = await db.from("capacidad").select("id, clave");
    const idDeClave = new Map((caps ?? []).map((c) => [c.clave, c.id]));

    for (const nombre of ["admin", "operador", "consulta", "jugador"]) {
      const t = tipos.find((x) => x.nombre === nombre);
      if (!t) {
        mal(`el tipo "${nombre}" no existe en la base`);
        continue;
      }
      const esperadas = new Set(expandirConRequisitos(baseDeTipo(nombre)));
      const enMatriz = new Set(
        (matrix ?? [])
          .filter((m) => m.tipo_usuario_id === t.id && m.decision !== "denegado")
          .map((m) => idDeClave.get(m.capacidad_id))
          .filter(Boolean)
      );
      const noEnCodigo = [...enMatriz].filter((k) => !CAPACIDADES_POR_CLAVE.has(k));
      const sinPermiso = [...esperadas].filter((k) => !enMatriz.has(k));
      if (!sinPermiso.length) ok(`la matriz de ${nombre} cubre la base generica (${esperadas.size})`);
      else
        mal(
          `a "${nombre}" le faltan ${sinPermiso.length} capacidades de su base` +
            (sinPermiso.length <= 6 ? `: ${sinPermiso.slice(0, 6).join(", ")}` : `: ${sinPermiso.slice(0, 6).join(", ")}...`)
        );
      if (!noEnCodigo.length) ok(`la matriz de ${nombre} no concede capacidades retiradas`);
      else mal(`la matriz de ${nombre} concede ${noEnCodigo.length} capacidades que el codigo no declara: ${noEnCodigo.join(", ")}`);
    }
  }
}

// =============================================================================
console.log("\n[4] El usuario principal esta dado de alta y activo");
// =============================================================================
{
  const { data: u, error } = await db
    .from("usuario_sistema")
    .select("id, nombre, tipo_usuario_id, activo, es_principal")
    .eq("id", USUARIO_PRINCIPAL)
    .maybeSingle();
  if (error) {
    mal(`no pude leer usuario_sistema: ${error.message}`);
  } else if (!u) {
    mal(`el usuario "${USUARIO_PRINCIPAL}" NO esta en usuario_sistema: el seed no esta aplicado`);
  } else {
    ok(`${USUARIO_PRINCIPAL} esta dado de alta (tipo ${u.tipo_usuario_id})`);
    if (u.activo) ok("esta activo");
    else mal("esta INACTIVO: el acceso total no se concede");
    if (u.es_principal) ok("esta marcado como principal");
    else mal("NO esta marcado como principal: no tendria acceso total");
  }
}

// =============================================================================
console.log("\n[5] El ABAC esta sembrado y coincide con el codigo");
// =============================================================================
{
  const { data: atributos, error: eAtr } = await db.from("atributo").select("clave, tipo");
  if (eAtr) {
    mal(`no pude leer atributo: ${eAtr.message}`);
  } else if (!atributos?.length) {
    mal("public.atributo esta vacia: el ABAC no tiene catalogo");
  } else {
    ok(`${atributos.length} atributos en el catalogo`);
  }

    const { data: reglas, error: eReg } = await db
    .from("regla_abac")
    .select("id, ambito, efecto, clase, principal_exento, activo, capacidad:capacidad_id(clave), atributo:atributo_id(clave)");
  if (eReg) {
    mal(`no pude leer regla_abac: ${eReg.message}`);
  } else if (!reglas?.length) {
    mal("public.regla_abac esta vacia: el ABAC no tiene reglas y queda mudo");
  } else {
    ok(`${reglas.length} reglas de atributo sembradas`);

    // Una regla sin capacidad o sin atributo no se puede evaluar: el join de
    // `evaluar_abac` la deja afuera en silencio y la capacidad queda sin ABAC.
    const huerfanas = reglas.filter((r) => !r.capacidad?.clave || !r.atributo?.clave);
    if (!huerfanas.length) ok("ninguna regla quedo sin capacidad o sin atributo");
    else mal(`${huerfanas.length} regla(s) sin capacidad o atributo: ${huerfanas.map((r) => r.id).join(", ")}`);

    const malaAmbito = reglas.filter((r) => r.ambito !== "global" && !/^tipo:[a-z_]+$/.test(r.ambito));
    if (!malaAmbito.length) ok("los ambitos son 'global' o 'tipo:<nombre>'");
    else mal(`ambito con forma invalida en: ${malaAmbito.map((r) => r.id).join(", ")}`);

    const sinMensaje = reglas.filter((r) => !r.mensaje || !String(r.mensaje).trim());
    if (!sinMensaje.length) ok("toda regla tiene un mensaje para el operador");
    else mal(`${sinMensaje.length} regla(s) sin mensaje: el operador veria un error vacio`);

    const inactivas = reglas.filter((r) => r.activo === false);
    if (!inactivas.length) ok("ninguna regla esta desactivada");
    else console.log(`  info ${inactivas.length} regla(s) desactivadas a mano`);

    // `clase` y `principal_exento` tienen que ser coherentes: un invariante con
    // el dueño exento deja un agujero silencioso, y un tope que el dueño no
    // puede levantar es una traba sin motivo.
    const incoherentes = reglas.filter(
      (r) => (r.clase === "integridad" && r.principal_exento) || (r.clase === "limite" && !r.principal_exento)
    );
    if (!incoherentes.length) ok("clase y principal_exento son coherentes en todas las reglas");
    else mal(`regla(s) incoherentes, corregilas en el seed: ${incoherentes.map((r) => `${r.id} (${r.clase}/exento=${r.principal_exento})`).join(", ")}`);

    const claseRara = reglas.filter((r) => r.clase && !["integridad", "limite"].includes(r.clase));
    if (!claseRara.length) ok("toda regla declara una clase valida");
    else mal(`clase desconocida: ${[...new Set(claseRara.map((r) => r.clase))].join(", ")}`);

    // Las reglas de integridad (no re-resolver un ticket cerrado) tienen que
    // le pegar tambien al principal. Si alguien las exonera, el dueo puede
    // dejar el historial en un estado imposible.
    const integridad = reglas.filter((r) => r.clase === "integridad");
    const exonradas = integridad.filter((r) => r.principal_exento);
    if (!exonradas.length) ok(`${integridad.length} invariantes, ninguna eximida al principal`);
    else mal(`integridad eximida al principal (arreglalo): ${exonradas.map((r) => r.id).join(", ")}`);
  }
}

console.log(`\n${fallan ? "HAY FALLAS" : "TODO OK"}: ${pasan} ok, ${fallan} fallas`);
if (fallan) {
  console.log("\nQue hacer si falla: aplicar el SQL en el SQL Editor de Supabase, en este orden:");
  console.log("  1. src/db/seguridad_maestro.sql   (crea el esquema y la RLS)");
  console.log("  2. src/db/maestro_seed.sql        (generado desde el registro maestro)");
  console.log('  3. $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."');
  console.log('     node pruebas/crear-admin.mjs josorioc "TU_CONTRASENA"');
  console.log("  4. node pruebas/auditar-base-maestro.mjs  (esta auditoria, otra vez)");
}
console.log("");
process.exit(fallan ? 1 : 0);

