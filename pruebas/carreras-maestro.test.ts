// ============================================================================
// Pruebas del NÃšCLEO de la matriz de carreras (src/lib/carreras/maestro-nucleo.ts).
//
// Es la pieza que decide quÃ© ve la plataforma: cÃ³mo se lee una fila de la matriz,
// de dÃ³nde sale el estado de la carrera y cÃ³mo se mezclan catÃ¡logo + resultado.
// Si esto falla, un mÃ³dulo muestra "Programada" una carrera ya liquidada, o no
// muestra una carrera que la IA acaba de cargar â€” los dos sÃ­ntomas que motivaron
// crear la matriz maestra.
//
//   - normalizarGanadores: las DOS formas histÃ³ricas ("1/2/3" y [{numero}])
//   - normalizarCaballos: nÃºmero numÃ©rico, retiros por nÃºmero, filas sin NÂº
//   - estadoDeCarrera: el resultado manda sobre la propia fila del maestro
//   - aCarreraCentral: catÃ¡logo + resultado embebido en un solo objeto
// ============================================================================
import {
  aCarreraCentral,
  dedupFilasMaestro,
  estadoDeCarrera,
  normalizarCaballos,
  normalizarGanadores,
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

console.log("\n[1] normalizarGanadores: las dos formas en que se guardÃ³");
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
// El sÃ­ntoma que motivÃ³ derivarlo: `claseEstadoCarrera` caÃ­a siempre en
// "programada" y el semÃ¡foro daba por pendiente una carrera ya liquidada.
eq("estado desconocido cae en Programada", estadoDeCarrera({ ...base, estado: "inventado" }, null), "Programada");
eq("estado ausente cae en Programada", estadoDeCarrera({ ...base, estado: null }, null), "Programada");

console.log("\n[4] primerResultado: el embed llega como objeto o como array");
// ---------------------------------------------------------------------------
eq("objeto", primerResultado({ ...base, resultados_carreras: { ganadores: ["1"] } })?.ganadores, ["1"]);
eq("array de uno", primerResultado({ ...base, resultados_carreras: [{ ganadores: ["2"] }] })?.ganadores, ["2"]);
eq("array vacio", primerResultado({ ...base, resultados_carreras: [] }), null);
eq("sin embed", primerResultado(base), null);

console.log("\n[5] aCarreraCentral: catÃ¡logo + resultado en un objeto");
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
    invalidados: undefined,
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
  "auditorÃ­a: sale verificada con quiÃ©n y cuÃ¡ndo",
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
  "una carrera sin nÃºmero no se inventa en 0 con estado liquidada",
  aCarreraCentral({ fecha: "2026-09-25", hipodromo: "X", carrera: 0 }).estado === "Programada"
);

// ============================================================================
// DEDUPLICACIÃ“N POR CLAVE CANÃ“NICA
//
// El caso real: LA RINCONADA 2026-10-04 tiene 18 filas para 13 carreras porque
// la matriz guardÃ³ cada Ejemplar como fila propia con `carrera: ""`. C1, C2, C4,
// C10 y C13 salÃ­an dos veces, y la copia vacÃ­a hacÃ­a que el mÃ³dulo la marcara
// "sin ejemplares registrados" teniendo 8.
//
// La fila buena es la que trae NÃº de carrera y life; la basura, la que no.
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

/** La fila basura: la escribiÃ³ la IA al crear cada ejemplar sin nÃº de carrera. */
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

const matrizDelCaso = [
  filaCarreraBuena(1, EJEMPLARES_C1.map((n, i) => ({ numero: String(i + 1), nombre: n }))),
  ...EJEMPLARES_C1.map((n) => filaEjemplarSinCarrera(n)),
  filaCarreraBuena(2, [{ numero: "1", nombre: "CABALLO C2" }]),
  filaEjemplarSinCarrera("CABALLO C2"),
  filaCarreraBuena(3, []),
];

const dedupCaso = dedupFilasMaestro(matrizDelCaso);

eq("13 filas del caso colapsan a las carreras que tienen nÃºmero real", dedupCaso.length, 3);
eq("C1 conserva los 8 ejemplares", dedupCaso[0].caballos.length, EJEMPLARES_C1.length);
eq(
  "C1 conserva los nombres en orden",
  dedupCaso[0].caballos.map((c) => c.nombre),
  EJEMPLARES_C1
);
eq(
  "el ejemplar suelto no crea una carrera 0 (no hay nÃº que agrupar)",
  dedupCaso.some((f) => f.carrera === 0),
  false
);
ok(
  "una carrera con lista vacÃ­a NO se marca como duplicada de la buena",
  (() => {
    const soloBuena = dedupFilasMaestro([
      filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
      filaCarreraBuena(1, []),
    ]);
    return soloBuena.length === 1 && soloBuena[0].caballos.length === 1;
  })()
);
eq(
  "el hipÃ³dromo se compara por clave normalizada (espacios y mayÃºsculas)",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { ...filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]), hipodromo: "La Rinconada" },
  ]).length,
  1
);
eq(
  "carreras distintas del mismo hipÃ³dromo NO se fusionan",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    filaCarreraBuena(2, [{ numero: "1", nombre: "B" }]),
  ]).length,
  2
);
eq(
  "hipÃ³dromos distintos con el mismo nÃºmero NO se fusionan",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { ...filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]), hipodromo: "LAS PIEDRAS" },
  ]).length,
  2
);
eq(
  "las copias de un mismo nÃºmero con ejemplares distintos se FUSIONAN",
  dedupFilasMaestro([
    filaCarreraBuena(4, [{ numero: "1", nombre: "A" }]),
    filaCarreraBuena(4, [{ numero: "2", nombre: "B" }]),
  ])[0].caballos.map((c) => c.nombre),
  ["A", "B"]
);
ok(
  "los retiros de las dos copias se juntan (no se pierde el retiro de la copia pobre)",
  (() => {
    const f = dedupFilasMaestro([
      { ...filaCarreraBuena(5, [{ numero: "1", nombre: "A" }]), retirados: "3" },
      { ...filaCarreraBuena(5, [{ numero: "2", nombre: "B" }]), retirados: "4, 3" },
    ])[0];
    const lista = f.retirados as string[];
    return lista.includes("3") && lista.includes("4");
  })()
);
ok(
  "una fila sin hipÃ³dromo se descarta y no contamina la carrera vÃ¡lida",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { fecha: "2026-10-04", hipodromo: "", carrera: 1, caballos: [{ numero: "9", nombre: "X" }] },
  ]).every((f) => (f.caballos as { nombre: string }[]).every((c) => c.nombre !== "X"))
);
eq(
  "una fila sin fecha queda aparte: no se mezcla con la carrera del dÃ­a",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    { fecha: "", hipodromo: "LA RINCONADA", carrera: 1, caballos: [{ numero: "9", nombre: "Y" }] },
  ]).length,
  2
);
eq(
  "copias idÃ©nticas (mismo arancel) no aÃ±aden ejemplares repetidos",
  dedupFilasMaestro([
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
    filaCarreraBuena(1, [{ numero: "1", nombre: "A" }]),
  ])[0].caballos.length,
  1
);

console.log(`\nTODO OK: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
