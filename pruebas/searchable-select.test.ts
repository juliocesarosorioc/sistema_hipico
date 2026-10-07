/**
 * Pruebas del teclado y del filtrado del SearchableSelect.
 *
 * El componente es React y no se monta acá: lo que se prueba es la lógica de
 * teclas (`searchable-select-teclado.ts`), que es la que decide qué se elige.
 */
import {
  aplicarTeclaCombo,
  etiquetaDeValor,
  filtrarOpciones,
  hayTextoLibre,
} from "../src/components/ui/searchable-select-teclado";

let ok = 0;
let fallos = 0;
function eq(nombre: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLA ${nombre}\n         esperado ${b}\n         real     ${a}`);
  }
}

const CLIENTES = [
  { value: "c1", label: "ANA PEREZ" },
  { value: "c2", label: "CARLOS RUIZ" },
  { value: "c3", label: "MARIA LOPEZ" },
];

const base = {
  filtradas: CLIENTES,
  activo: 0,
  texto: "",
  allowCustom: true,
  elegido: null as string | null,
  escapado: false,
};

console.log("[1] flechas: recorren la lista sin salirse de los extremos");
eq("abajo desde el primero va al segundo", aplicarTeclaCombo({ ...base, key: "ArrowDown" }).activoResultante, 1);
eq(
  "abajo en el ULTIMO se queda en el ultimo",
  aplicarTeclaCombo({ ...base, key: "ArrowDown", activo: 2 }).activoResultante,
  2
);
eq("arriba desde el segundo vuelve al primero", aplicarTeclaCombo({ ...base, key: "ArrowUp", activo: 1 }).activoResultante, 0);
eq(
  "arriba en el primero se queda en el primero",
  aplicarTeclaCombo({ ...base, key: "ArrowUp", activo: 0 }).activoResultante,
  0
);
eq(
  "abajo con lista de un elemento no se mueve",
  aplicarTeclaCombo({ ...base, key: "ArrowDown", filtradas: [CLIENTES[0]] }).activoResultante,
  0
);
eq("abajo abre la lista", aplicarTeclaCombo({ ...base, key: "ArrowDown", abierto: false }).abierto, true);
eq("la flecha cancela el evento", aplicarTeclaCombo({ ...base, key: "ArrowDown" }).preventDefault, true);

console.log("\n[2] Enter: elige lo que está resaltado");
eq("Enter elige el activo", aplicarTeclaCombo({ ...base, key: "Enter", activo: 1 }).elegido, "c2");
eq("Enter elige el primero por defecto", aplicarTeclaCombo({ ...base, key: "Enter" }).elegido, "c1");
eq("Enter cancela el evento", aplicarTeclaCombo({ ...base, key: "Enter" }).preventDefault, true);

console.log("\n[3] Enter sin coincidencia: texto libre solo si el campo lo permite");
eq(
  "con allowCustom elige lo escrito, en mayusculas",
  aplicarTeclaCombo({ ...base, key: "Enter", filtradas: [], texto: "nuevo cliente" }).elegido,
  "NUEVO CLIENTE"
);
eq(
  "sin allowCustom NO inventa un cliente",
  aplicarTeclaCombo({ ...base, key: "Enter", filtradas: [], texto: "nuevo", allowCustom: false }).elegido,
  null
);
eq(
  "con lista y sin texto en el activo respalda lo escrito",
  aplicarTeclaCombo({ ...base, key: "Enter", filtradas: [], texto: "  pedro " }).elegido,
  "PEDRO"
);
eq(
  "Enter sin nada escrito no elige nada",
  aplicarTeclaCombo({ ...base, key: "Enter", filtradas: [], texto: "   " }).elegido,
  null
);

console.log("\n[4] Escape: cierra y vuelve a la etiqueta elegida");
const esc = aplicarTeclaCombo({ ...base, key: "Escape", texto: "xyz", abierto: true });
eq("Escape cierra la lista", esc.abierto, false);
eq("Escape avisa que hay que restaurar el texto", esc.escapado, true);
eq("Escape no elige nada", esc.elegido, null);
eq("Escape cancela el evento", esc.preventDefault, true);

console.log("\n[5] teclas de escritura: el input las tiene que recibir");
for (const k of ["a", "Z", " ", "Backspace", "9", "Tab"]) {
  const r = aplicarTeclaCombo({ ...base, key: k });
  eq(`'${k}' no se consume`, r.preventDefault, false);
  eq(`'${k}' no elige nada`, r.elegido, null);
  eq(`'${k}' no cierra la lista`, r.escapado, false);
}

console.log("\n[6] filtro: por etiqueta, ignorando mayusculas");
eq("filtra por fragmento", filtrarOpciones(CLIENTES, "ru"), [{ value: "c2", label: "CARLOS RUIZ" }]);
eq("sin coincidencia devuelve vacio", filtrarOpciones(CLIENTES, "zzz"), []);
eq("texto vacio devuelve todo", filtrarOpciones(CLIENTES, "  ").length, 3);
eq("busca en mayusculas", filtrarOpciones(CLIENTES, "MARIA").length, 1);
eq("ignora espacios alrededor", filtrarOpciones(CLIENTES, "  lopez ").length, 1);

console.log("\n[7] texto libre: solo cuando lo escrito no es una etiqueta existente");
eq("una etiqueta exacta NO es texto libre", hayTextoLibre(CLIENTES, "ANA PEREZ"), false);
eq("otro nombre SÍ es texto libre", hayTextoLibre(CLIENTES, "PEDRO"), true);
eq("texto en minusculas no cuenta como etiqueta", hayTextoLibre(CLIENTES, "ana perez"), true);
eq("vacio no es texto libre", hayTextoLibre(CLIENTES, "   "), false);

console.log("\n[8] etiqueta mostrada: el nombre, nunca el id del cliente");
eq("muestra el nombre del id", etiquetaDeValor(CLIENTES, "c2"), "CARLOS RUIZ");
eq("si no esta en la lista, cae al displayValue", etiquetaDeValor(CLIENTES, "c9", "JUAN NUEVO"), "JUAN NUEVO");
eq("si no hay displayValue, muestra el valor", etiquetaDeValor(CLIENTES, "c9"), "c9");
eq("sin valor, cadena vacia", etiquetaDeValor(CLIENTES, ""), "");

console.log(`\nTODO ${fallos === 0 ? "OK" : "FALLA"}: ${ok} pasaron, ${fallos} fallaron`);
if (fallos > 0) process.exit(1);