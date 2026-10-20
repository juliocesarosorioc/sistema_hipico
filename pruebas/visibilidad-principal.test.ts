// ============================================================================
// PROMPT #5 · VISIBILIDAD COMPARTIDA DE LAS JUGADAS DEL GRUPO PRINCIPAL
//
// El grupo PRINCIPAL publica sus jugadas (Tablas Fijas, Marcas, Pollas,
// Dupletas, Remates, Puestos) y decide QUIÉN las ve en vivo:
//
//   Toggle 1 · `visibilidad_global_principal`        → todos ven.
//   Toggle 2 · `grupos_autorizados_ver_principal[]`  → solo los autorizados
//                                                       (y SOLO si el global OFF).
//
// Regla acordada con el dueño: con el global ON, la LISTA NO IMPORTA.
//
// Qué protege esta prueba:
//   1. El núcleo puro (`visibilidad-principal.ts`): lectura tolerante del array,
//      resolución del principal, los tres modos y la autorización.
//   2. Que el panel 🌐 (`PanelVisibilidadPrincipal.tsx`) use ese núcleo y NO
//      invente reglas propias.
//   3. La migración SQL (`grupos_visibilidad_principal.sql`): las dos columnas,
//      el resolutor `puede_ver_principal`, la RPC y la policy RLS.
//   4. El guardado (`grupos.ts::actualizarVisibilidadPrincipal`) y el render en
//      el modal de `GruposModule.tsx`, condicionado a "es principal".
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  idTexto,
  gruposAutorizadosDe,
  esGlobalPrincipal,
  puedeVerPrincipal,
  puedeVerElPrincipal,
  principalDe,
  modoVisibilidad,
  etiquetaModoVisibilidad,
  candidatosAutorizar,
  alternarAutorizado,
} from "../src/features/grupos/lib/visibilidad-principal";
import type { GrupoVisibilidad } from "../src/features/grupos/lib/visibilidad-principal";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 1 — lectura tolerante de la lista de autorizados");
// ---------------------------------------------------------------------------
igual(gruposAutorizadosDe(null), [], "null → lista vacía");
igual(gruposAutorizadosDe(undefined), [], "undefined → lista vacía");
igual(gruposAutorizadosDe({ id: "p" }), [], "grupo sin el campo → lista vacía");
igual(gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: null }), [], "campo null → vacío");
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: ["a", "b"] }),
  ["a", "b"],
  "array de strings tal cual"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: [1, 2] }),
  ["1", "2"],
  "ids numéricos normalizados a texto"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: ["a", "a", "b", "a"] }),
  ["a", "b"],
  "sin duplicados y conservando el orden"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: ["a", "", "  ", "b"] }),
  ["a", "b"],
  "descarta vacíos y espacios"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: '["x","y"]' as unknown as string[] }),
  ["x", "y"],
  "string JSON de PostgREST → array"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: "{x,y}" as unknown as string[] }),
  ["x", "y"],
  "formato {x,y} de Postgres como respaldo"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: "solo-uno" as unknown as string[] }),
  ["solo-uno"],
  "id suelto sin comas → un único elemento"
);
igual(
  gruposAutorizadosDe({ id: "p", grupos_autorizados_ver_principal: "{ }" as unknown as string[] }),
  [],
  "llaves vacías → lista vacía"
);

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 2 — resolución del principal y Toggle 1");
// ---------------------------------------------------------------------------
si(esGlobalPrincipal({ id: "p", visibilidad_global_principal: true }), "global true → encendido");
si(!esGlobalPrincipal({ id: "p", visibilidad_global_principal: false }), "global false → apagado");
si(!esGlobalPrincipal({ id: "p", visibilidad_global_principal: "true" as unknown as boolean }), "global 'true' (texto) NO enciende: solo booleano true");
si(!esGlobalPrincipal(null), "sin grupo → apagado");

const principal: GrupoVisibilidad = { id: "P", es_principal: true, nombre: "Principal" };
const lista: GrupoVisibilidad[] = [
  { id: "A", es_principal: false },
  { id: "P", es_principal: true, visibilidad_global_principal: true },
  { id: "B", es_principal: false },
];
igual(principalDe(lista)?.id, "P", "principalDe encuentra el marcado");
igual(principalDe([{ id: "A" }, { id: "B" }]), null, "sin principal → null");
igual(principalDe(null), null, "null → null");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 3 — ¿quién puede ver las jugadas del principal?");
// ---------------------------------------------------------------------------
si(!puedeVerPrincipal(null, "B"), "sin principal → nadie ve (false)");
si(!puedeVerPrincipal(undefined, "B"), "undefined → false");
si(puedeVerPrincipal(principal, "P"), "el propio principal siempre se ve");
si(
  puedeVerPrincipal({ id: "P", visibilidad_global_principal: true }, "Z"),
  "global ON → cualquier grupo ve, aunque no esté en la lista"
);
si(
  !puedeVerPrincipal({ id: "P", visibilidad_global_principal: false }, "Z"),
  "global OFF y lista vacía → NO ve (NADIE)"
);
si(
  puedeVerPrincipal(
    { id: "P", visibilidad_global_principal: false, grupos_autorizados_ver_principal: ["B"] },
    "B"
  ),
  "global OFF con lista → el autorizado SÍ ve"
);
si(
  !puedeVerPrincipal(
    { id: "P", visibilidad_global_principal: false, grupos_autorizados_ver_principal: ["B"] },
    "C"
  ),
  "global OFF con lista → el que NO está en la lista no ve"
);
si(!puedeVerPrincipal({ id: "P" }, null), "grupo sin es_principal y sin destino → false");
si(!puedeVerPrincipal({ id: "P" }, ""), "grupo destino vacío → false");
si(
  puedeVerPrincipal(
    { id: "P", es_principal: true, visibilidad_global_principal: false, grupos_autorizados_ver_principal: [] },
    "B"
  ),
  "cualquiera marcado es_principal se ve a sí mismo"
);
igual(
  puedeVerElPrincipal(lista, "Z"),
  true,
  "puedeVerElPrincipal resuelve el principal (global ON) para un tercero"
);
igual(puedeVerElPrincipal(lista, "P"), true, "puedeVerElPrincipal: el principal se ve");
igual(puedeVerElPrincipal(null, "P"), false, "puedeVerElPrincipal sin grupos → false");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 4 — modos de visibilidad y rótulos");
// ---------------------------------------------------------------------------
igual(modoVisibilidad({ id: "P", visibilidad_global_principal: true }), "GLOBAL", "global ON → GLOBAL");
igual(
  modoVisibilidad({ id: "P", visibilidad_global_principal: false, grupos_autorizados_ver_principal: ["B"] }),
  "LISTA",
  "global OFF con lista → LISTA"
);
igual(modoVisibilidad({ id: "P", visibilidad_global_principal: false }), "NADIE", "global OFF sin lista → NADIE");
igual(
  modoVisibilidad({ id: "P", visibilidad_global_principal: true, grupos_autorizados_ver_principal: ["B"] }),
  "GLOBAL",
  "global ON gana sobre la lista (regla del dueño)"
);
igual(etiquetaModoVisibilidad("GLOBAL"), "🌐 Todos los grupos", "rótulo GLOBAL con emoji");
igual(etiquetaModoVisibilidad("LISTA"), "🔒 Solo grupos autorizados", "rótulo LISTA con emoji");
igual(etiquetaModoVisibilidad("NADIE"), "🚫 Solo el Principal", "rótulo NADIE con emoji");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 5 — candidatos a autorizar y alternado de la lista");
// ---------------------------------------------------------------------------
const universo = [
  { id: "P", es_principal: true, activo: true },
  { id: "A", es_principal: false, activo: true },
  { id: "B", es_principal: false, activo: false },
  { id: "C", es_principal: false, activo: true },
];
igual(
  candidatosAutorizar(universo, "P").map((g) => g.id),
  ["A", "C"],
  "excluye al principal y a los inactivos"
);
igual(candidatosAutorizar(null, "P"), [], "sin grupos → sin candidatos");
igual(
  candidatosAutorizar(universo, "a").map((g) => String(g.id)),
  ["A", "C"],
  "excluye al principal aunque el id se compare como texto"
);
igual(
  identificadores(alternarAutorizado([], "B", true)),
  ["B"],
  "marcar sobre lista vacía agrega"
);
igual(
  alternarAutorizado(["A", "B"], "B", true),
  ["A", "B"],
  "marcar un ya presente no duplica"
);
igual(alternarAutorizado(["A", "B"], "A", false), ["B"], "desmarcar quita el id");
igual(alternarAutorizado([], "A", false), [], "desmarcar de lista vacía → vacía");
igual(
  alternarAutorizado(["A", "", "  B  "], "C", true),
  ["A", "B", "C"],
  "normaliza, quita vacíos y agrega el nuevo al final"
);
igual(alternarAutorizado(null, "A", true), ["A"], "null como entrada → [id]");
igual(alternarAutorizado(["A"], "", true), ["A"], "id vacío no se marca");

function identificadores(v: Array<string | number>): string[] {
  return v.map(idTexto);
}

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 6 — el panel 🌐 usa el núcleo (sin reglas propias)");
// ---------------------------------------------------------------------------
const panel = leer("src", "features", "grupos", "components", "PanelVisibilidadPrincipal.tsx");
si(/modoVisibilidad/.test(panel), "el panel calcula el modo con modoVisibilidad");
si(/etiquetaModoVisibilidad/.test(panel), "el panel rotula con etiquetaModoVisibilidad");
si(/candidatosAutorizar/.test(panel), "el panel lista candidatos con candidatosAutorizar");
si(/gruposAutorizadosDe/.test(panel), "el panel marca los seleccionados con gruposAutorizadosDe");
si(!/grupos_autorizados_ver_principal\s*\.filter/.test(panel), "el panel NO filtra la lista por su cuenta");

const mod = leer("src", "features", "grupos", "components", "GruposModule.tsx");
si(/PanelVisibilidadPrincipal/.test(mod), "GruposModule monta el panel de visibilidad");
si(
  /editando\.es_principal === true \?[\s\S]{0,400}PanelVisibilidadPrincipal/.test(mod),
  "el panel solo se ofrece cuando el grupo es principal"
);
si(/actualizarVisibilidadPrincipal/.test(mod), "GruposModule guarda con actualizarVisibilidadPrincipal");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 7 — migración SQL: columnas, resolutor, RPC y RLS");
// ---------------------------------------------------------------------------
const sql = leer("sql", "grupos_visibilidad_principal.sql");
si(
  /add column if not exists visibilidad_global_principal/.test(sql),
  "trae la columna visibilidad_global_principal (Toggle 1)"
);
si(
  /add column if not exists grupos_autorizados_ver_principal/.test(sql),
  "trae la columna grupos_autorizados_ver_principal (Toggle 2)"
);
si(/grupos_autorizados_ver_principal\s+uuid\[\]/.test(sql), "la lista es uuid[]");
si(/visibilidad_global_principal\s+boolean/.test(sql), "el toggle global es boolean");
si(
  /create or replace function public\.puede_ver_principal/.test(sql),
  "define el resolutor public.puede_ver_principal(uuid)"
);
si(
  /coalesce\(v_principal\.visibilidad_global_principal,\s*false\)/.test(sql),
  "el resolutor corta primero por el global (regla del dueño)"
);
si(
  /create or replace function public\.club_visibilidad_principal/.test(sql),
  "define la RPC club_visibilidad_principal"
);
si(
  /club_visibilidad_principal\([\s\S]{0,200}p_global boolean[\s\S]{0,200}p_grupos uuid\[\]/.test(sql),
  "la RPC recibe el toggle global y la lista de grupos autorizados"
);
si(
  /create policy tickets_apuestas_ver_principal/.test(sql),
  "agrega la policy de lectura tickets_apuestas_ver_principal"
);
si(
  /fecha_registro/.test(sql) && !/tickets_apuestas \(fecha, hipodromo/.test(sql),
  "el índice usa fecha_registro (tickets_apuestas no tiene columna fecha)"
);
si(/define definer/i.test(sql) || /security definer/i.test(sql), "la RPC corre con security definer");

// ---------------------------------------------------------------------------
console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
