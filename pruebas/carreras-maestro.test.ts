// ============================================================================
// Pruebas del NÚCLEO de la matriz de carreras (src/lib/carreras/maestro-nucleo.ts).
//
// Es la pieza que decide qué ve la plataforma: cómo se lee una fila de la matriz,
// de dónde sale el estado de la carrera y cómo se mezclan catálogo + resultado.
// Si esto falla, un módulo muestra "Programada" una carrera ya liquidada, o no
// muestra una carrera que la IA acaba de cargar — los dos síntomas que motivaron
// crear la matriz maestra.
//
//   - normalizarGanadores: las DOS formas históricas ("1/2/3" y [{numero}])
//   - normalizarCaballos: número numérico, retiros por número, filas sin Nº
//   - estadoDeCarrera: el resultado manda sobre la propia fila del maestro
//   - aCarreraCentral: catálogo + resultado embebido en un solo objeto
// ============================================================================
import {
  aCarreraCentral,
  dedupFilasMaestro,
  estadoDeCarrera,
  hipodromosAEscribir,
  normalizarCaballos,
  normalizarGanadores,
  ordenarPorNumero,
  primerResultado,
  type FilaCarreraMaestro,
} from "../src/lib/carreras/maestro-nucleo";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

console.log("\n[1] normalizarGanadores: las dos formas en que se guardó");
// ---------------------------------------------------------------------------
eq("nada", normalizarGanadores(null), []);
eq("texto con barras", normalizarGanadores("1/2/3"), ["1", "2", "3"]);
eq("texto con espacios", normalizarGanadores(" 4 / 5 "), ["4", "5"]);
eq("lista plana", normalizarGanadores(["1", "2"]), ["1", "2"]);
eq("lista de objetos", normalizarGanadores([{ numero: 1, puesto: 1 }, { numero: 4, puesto: 2 }]), ["1", "4"]);
eq("mezcla y basura", normalizarGanadores([{ numero: 2 }, null, "", "7"]), ["2", "7"]);
eq("texto vacio", normalizarGanadores(""), []);

console.log("\n[2] normalizarCaballos");
// ---------------------------------------------------------------------------
eq("numero numerico pasa a texto", normalizarCaballos([{ numero: 4, nombre: "TIO" }], new Set()), [
  { numero: "4", nombre: "TIO", nacionalidad: null, retirado: false },
]);
eq("retirado por la lista central", normalizarCaballos([{ numero: 2 }, { numero: 5 }], new Set(["5"])), [
  { numero: "2", nombre: null, nacionalidad: null, retirado: false },
  { numero: "5", nombre: null, nacionalidad: null, retirado: true },
]);
eq("retirado en la propia fila", normalizarCaballos([{ numero: 3, retirado: true }], new Set()), [
  { numero: "3", nombre: null, nacionalidad: null, retirado: true },
]);
eq("descarta filas sin numero", normalizarCaballos([{ nombre: "SIN NUMERO" }, { numero: "" }], new Set()), []);

console.log("\n[3] estadoDeCarrera: el resultado manda");
// ---------------------------------------------------------------------------
const base: FilaCarreraMaestro = { fecha: "2026-09-25", hipodromo: "LA RINCONADA", carrera: 1 };
eq("sin nada, Programada", estadoDeCarrera(base, null), "Programada");
eq("estado propio Abierta", estadoDeCarrera({ ...base, estado: "Abierta" }, null), "Abierta");
eq("estado propio Cerrada", estadoDeCarrera({ ...base, estado: "Cerrada" }, null), "Cerrada");
eq("hay ganador -> Resultados aunque el maestro diga Programada", estadoDeCarrera({ ...base, estado: "Programada" }, { ganadores: ["3"] }), "Resultados");
eq("aplicado a tablas -> Liquidada", estadoDeCarrera({ ...base, estado: "Programada" }, { ganadores: ["3"], aplicado_a_tablas: true }), "Liquidada");
// El síntoma que motivó derivarlo: `claseEstadoCarrera` caía siempre en
// "programada" y el semáforo daba por pendiente una carrera ya liquidada.
eq("estado desconocido cae en Programada", estadoDeCarrera({ ...base, estado: "inventado" }, null), "Programada");
eq("estado ausente cae en Programada", estadoDeCarrera({ ...base, estado: null }, null), "Programada");

console.log("\n[4] primerResultado: el embed llega como objeto o como array");
// ---------------------------------------------------------------------------
eq("objeto", primerResultado({ ...base, resultados_carreras: { ganadores: ["1"] } })?.ganadores, ["1"]);
eq("array de uno", primerResultado({ ...base, resultados_carreras: [{ ganadores: ["2"] }] })?.ganadores, ["2"]);
eq("array vacio", primerResultado({ ...base, resultados_carreras: [] }), null);
eq("sin embed", primerResultado(base), null);

console.log("\n[5] aCarreraCentral: catálogo + resultado en un objeto");
// ---------------------------------------------------------------------------
eq(
  "carrera solo en la matriz (la IA la acaba de cargar)",
  aCarreraCentral({
    id: "abc",
    fecha: "2026-09-25",
    hipodromo: " la rinconada ",
    carrera: 3,
    estado: "Programada",
    caballos: [{ numero: 1, nombre: "TIO" }],
    distancia: "1400",
    superficie: "ARENA",
    premio: 5000,
  }),
  {
    id: "abc",
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 3,
    caballos: [{ numero: "1", nombre: "TIO", nacionalidad: null, retirado: false }],
    retirados: [],
    // INV es distinto de retirado: sale vacío, no null.
    invalidados: [],
    invalidadosPolla: [],
    distancia: "1400",
    superficie: "ARENA",
    premio: 5000,
    hora: null,
    estado: "Programada",
    // Auditoría: la fila de la matriz no trae nada de esto y sale neutro, pero
    // tiene que estar presente para que los módulos puedan mostrar quién cargó
    // la carrera y si fue verificada.
    origen: null,
    registrado_por: null,
    actualizado_por: null,
    verificado: false,
    verificado_por: null,
    verificado_at: null,
    updated_at: null,
    ganadores: [],
    aplicado_a_tablas: false,
  }
);
eq(
  "la lista de retiros del RESULTADO pisa la de la matriz",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 1,
    retirados: "9",
    caballos: [{ numero: 1 }, { numero: 9 }],
    resultados_carreras: { retirados: "2,5", ganadores: ["3"] },
  }).retirados,
  ["2", "5"]
);
eq(
  "si el resultado no trae retiros, manda la matriz",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 1,
    retirados: "9",
    resultados_carreras: { ganadores: ["3"] },
  }).retirados,
  ["9"]
);
eq(
  "INV se lee de invalidado_remate, independiente de los retiros",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 4,
    retirados: "3",
    invalidado_remate: "5,7",
    caballos: [{ numero: 3 }, { numero: 5 }, { numero: 7 }],
  }),
  {
    id: undefined,
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 4,
caballos: [
      { numero: "3", nombre: null, nacionalidad: null, retirado: true },
      { numero: "5", nombre: null, nacionalidad: null, retirado: false },
      { numero: "7", nombre: null, nacionalidad: null, retirado: false },
    ],
    retirados: ["3"],
    invalidados: ["5", "7"],
    // El INV de Remates no toca Pollas: acá no hay ninguno.
    invalidadosPolla: [],
    distancia: null,
    superficie: null,
    premio: null,
    hora: null,
    estado: "Programada",
    origen: null,
    registrado_por: null,
    actualizado_por: null,
    verificado: false,
    verificado_por: null,
    verificado_at: null,
    updated_at: null,
    ganadores: [],
    aplicado_a_tablas: false,
  }
);
eq(
  "el INV de Pollas se lee aparte del de Remates",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 5,
    caballos: [{ numero: "2", nombre: null, nacionalidad: null, retirado: false }],
    invalidado_remate: "5",
    invalidado_polla: "2",
  }).invalidadosPolla,
  ["2"]
);
eq(
  "y un INV de Remates no inválida para Pollas",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 5,
    caballos: [{ numero: "2", nombre: null, nacionalidad: null, retirado: false }],
    invalidado_remate: "5",
  }).invalidadosPolla,
  []
);
eq(
  "un INV NO marca el ejemplar como retirado en los demás módulos",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 4,
    invalidado_remate: "5",
    caballos: [{ numero: 5 }],
  }).caballos?.[0]?.retirado,
  false
);
eq(
  "auditoría: sale verificada con quién y cuándo",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 2,
    verificado: true,
    verificado_por: "josorioc",
    verificado_at: "2026-10-02T14:30:00Z",
    actualizado_por: "admin",
    origen: "manual",
  }),
  {
    id: undefined,
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 2,
    caballos: [],
    retirados: [],
    invalidados: [],
    invalidadosPolla: [],
    distancia: null,
    superficie: null,
    premio: null,
    hora: null,
    estado: "Programada",
    origen: "manual",
    registrado_por: null,
    actualizado_por: "admin",
    verificado: true,
    verificado_por: "josorioc",
    verificado_at: "2026-10-02T14:30:00Z",
    updated_at: null,
    ganadores: [],
    aplicado_a_tablas: false,
  }
);
eq(
  "ganadores en objetos (orden de llegada) se aplanan",
  aCarreraCentral({
    fecha: "2026-09-25",
    hipodromo: "LA RINCONADA",
    carrera: 1,
    resultados_carreras: { orden_llegada: [{ numero: 2, puesto: 1 }, { numero: 5, puesto: 2 }] },
  }).ganadores,
  ["2", "5"]
);
ok(
  "una carrera sin número no se inventa en 0 con estado liquidada",
  aCarreraCentral({ fecha: "2026-09-25", hipodromo: "X", carrera: 0 }).estado === "Programada"
);

console.log("\n[6] ordenarPorNumero: ejemplares 1..n aunque la fuente llegue desordenada");
// ---------------------------------------------------------------------------
eq(
  "normalizarCaballos ordena numérico (10 después de 2, no como texto)",
  normalizarCaballos([{ numero: 10, nombre: "DIEZ" }, { numero: 2, nombre: "DOS" }, { numero: 1, nombre: "UNO" }], new Set()).map((c) => c.numero),
  ["1", "2", "10"]
);
eq(
  "mezcla de texto y números se ordena por el número",
  ordenarPorNumero([{ numero: "12" }, { numero: 3 }, { numero: "2" }]).map((c) => c.numero),
  ["2", 3, "12"]
);
eq(
  "los que no traen número válido van al final",
  ordenarPorNumero([{ numero: "" }, { numero: 7 }, { numero: "S/N" }]).map((c) => c.numero),
  [7, "", "S/N"]
);
eq(
  "una carrera con datos de copias desordenadas fusiona ordenada",
  (() => {
    const f = dedupFilasMaestro([
      { fecha: "2026-10-04", hipodromo: "LA RINCONADA", carrera: 6, caballos: [{ numero: "10", nombre: "DIEZ" }] },
      { fecha: "2026-10-04", hipodromo: "LA RINCONADA", carrera: 6, caballos: [{ numero: "3", nombre: "TRES" }] },
    ])[0];
    return (f.caballos as { numero: string }[]).map((c) => c.numero);
  })(),
  ["3", "10"]
);

// ============================================================================
// DEDUPLICACIÓN POR CLAVE CANÓNICA
//
// El caso real: LA RINCONADA 2026-10-04 tiene 18 filas para 13 carreras porque
// la matriz guardó cada Ejemplar como fila propia con `carrera: ""`. C1, C2, C4,
// C10 y C13 salían dos veces, y la copia vacía hacía que el módulo la marcara
// "sin ejemplares registrados" teniendo 8.
//
// La fila buena es la que trae Nú de carrera y life; la basura, la que no.
// ============================================================================
const EJEMPLARES_C1 = [
  "BENDECIDA",
  "GRAN AVELINA",
  "ROSE SENSATIONS",
  "BIENMESABE",
  "MULTIVERSO",
  "LOCA TE PONES",
  "TIANSHAN",
  "ACANELADA",
];

/** La fila basura: la escribió la IA al crear cada ejemplar sin nú de carrera. */
const filaEjemplarSinCarrera = (nombre: string) => ({
  fecha: "2026-10-04",
  hipodromo: "LA RINCONADA",
  carrera: "",
  estado: "Programada",
  caballos: [{ numero: "", nombre }],
});

const filaCarreraBuena = (carrera: number, caballos: { numero: string; nombre: string }[]) => ({
  fecha: "2026-10-04",
  hipodromo: "LA RINCONADA",
  carrera,
  estado: "Programada",
  caballos,
});

/** Ejemplar tal como sale de la fila (el módulo lo tipa como `unknown`). */
type EjTest = { numero: string; nombre: string };
const ejemplaresDe = (f: FilaCarreraMaestro | undefined): EjTest[] =>
  (f?.caballos as EjTest[] | undefined) ?? [];

/** Pasa filas CRUDAS de la matriz: la IA escribe `carrera: ""` en las suyas. */
const dedup = (filas: unknown[]): FilaCarreraMaestro[] =>
  dedupFilasMaestro(filas as FilaCarreraMaestro[]);

const matrizDelCaso = [
  filaCarreraBuena(1, EJEMPLARES_C1.map((n, i) => ({ numero: String(i + 1), nombre: n }))),
  ...EJEMPLARES_C1.map((n) => filaEjemplarSinCarrera(n)),
  filaCarreraBuena(2, [{ numero: "1", nombre: "CABALLO C2" }]),
  filaEjemplarSinCarrera("CABALLO C2"),
  filaCarreraBuena(3, []),
];

const dedupCaso = dedup(matrizDelCaso);

eq("13 filas del caso colapsan a las carreras que tienen número real", dedupCaso.length, 3);
eq("C1 conserva los 8 ejemplares", ejemplaresDe(dedupCaso[0]).length, EJEMPLARES_C1.length);
eq(
  "C1 conserva los nombres en orden",
  ejemplaresDe(dedupCaso[0]).map((c) => c.nombre),
  EJEMPLARES_C1
);
eq(
  "el ejemplar suelto no crea una carrera 0 (no hay nú que agrupar)",
  dedupCaso.some((f) => f.carrera === 0),
  false
);
ok(
  "una carrera con lista vacía NO se marca como duplicada de la buena",
  (() => {
    const soloBuena = dedup([
      filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
      filaCarreraBuena(1, []),
    ]);
    return soloBuena.length === 1 && ejemplaresDe(soloBuena[0]).length === 1;
  })()
);
eq(
  "el hipódromo se compara por clave normalizada (espacios y mayúsculas)",
  dedup([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { ...filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]), hipodromo: "La Rinconada" },
  ]).length,
  1
);
eq(
  "carreras distintas del mismo hipódromo NO se fusionan",
  dedup([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    filaCarreraBuena(2, [{ numero: "1", nombre: "B" }]),
  ]).length,
  2
);
eq(
  "hipódromos distintos con el mismo número NO se fusionan",
  dedup([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { ...filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]), hipodromo: "LAS PIEDRAS" },
  ]).length,
  2
);
eq(
  "las copias de un mismo número con ejemplares distintos se FUSIONAN",
  ejemplaresDe(
    dedup([
      filaCarreraBuena(4, [{ numero: "1", nombre: "A" }]),
      filaCarreraBuena(4, [{ numero: "2", nombre: "B" }]),
    ])[0]
  ).map((c) => c.nombre),
  ["A", "B"]
);
ok(
  "los retiros de las dos copias se juntan (no se pierde el retiro de la copia pobre)",
  (() => {
    const f = dedup([
      { ...filaCarreraBuena(5, [{ numero: "1", nombre: "A" }]), retirados: "3" },
      { ...filaCarreraBuena(5, [{ numero: "2", nombre: "B" }]), retirados: "4, 3" },
    ])[0];
    const lista = String(f.retirados ?? "")
      .split(/[^0-9]+/)
      .filter(Boolean);
    return lista.includes("3") && lista.includes("4");
  })()
);
ok(
  "una fila sin hipódromo se descarta y no contamina la carrera válida",
  dedup([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { fecha: "2026-10-04", hipodromo: "", carrera: 1, caballos: [{ numero: "9", nombre: "X" }] },
  ]).every((f) => (f.caballos as { nombre: string }[]).every((c) => c.nombre !== "X"))
);
eq(
  "una fila sin fecha queda aparte: no se mezcla con la carrera del día",
  dedup([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { fecha: "", hipodromo: "LA RINCONADA", carrera: 1, caballos: [{ numero: "9", nombre: "Y" }] },
  ]).length,
  2
);
eq(
  "copias idénticas (mismo arancel) no añaden ejemplares repetidos",
  ejemplaresDe(
    dedup([
      filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
      filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    ])[0]
  ).length,
  1
);

// ============================================================================
// HIPODROMOS A ESCRIBIR (hipodromosAEscribir)
//
// El upsert de la matriz dedupa por (fecha, hipodromo, carrera) con TEXTO, así
// que escribir "LA RINCONADA" cuando la BD guarda "La Rinconada" crearía una
// SEGUNDA fila (duplicada). El escritor debe reusar el texto que ya está
// guardado para esa clave canónica y actualizar en vez de insertar.
// ============================================================================
const textosEscribir = (
  entradas: { fecha?: string | null; hipodromo: unknown; carrera: unknown }[],
  existentes: { fecha?: unknown; hipodromo?: unknown; carrera?: unknown }[]
) => hipodromosAEscribir(entradas, existentes);

eq(
  "reusa el TEXTO guardado cuando la misma clave ya existe con otra grafía",
  textosEscribir(
    [{ fecha: "2026-10-06", hipodromo: "LA RINCONADA", carrera: 3 }],
    [{ fecha: "2026-10-06", hipodromo: "La Rinconada", carrera: 3 }]
  ).get("2026-10-06|LARINCONADA|3"),
  "La Rinconada"
);
eq(
  "carrera nueva: usa la forma canónica en mayúsculas",
  textosEscribir(
    [{ fecha: "2026-10-06", hipodromo: "la rinconada", carrera: 4 }],
    [{ fecha: "2026-10-06", hipodromo: "La Rinconada", carrera: 3 }]
  ).get("2026-10-06|LARINCONADA|4"),
  "LA RINCONADA"
);
eq(
  "mismo hipódromo con número distinto no se mezcla",
  textosEscribir(
    [{ fecha: "2026-10-06", hipodromo: "LA RINCONADA", carrera: 5 }],
    [{ fecha: "2026-10-06", hipodromo: "La Rinconada", carrera: 3 }]
  ).get("2026-10-06|LARINCONADA|5"),
  "LA RINCONADA"
);
eq(
  "entrada sin hipódromo ni número queda fuera del mapa",
  textosEscribir(
    [{ fecha: "2026-10-06", hipodromo: "  ", carrera: 0 }],
    []
  ).size,
  0
);

console.log(`\nTODO OK: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
