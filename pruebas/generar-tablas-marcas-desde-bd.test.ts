import {
  generarTablasDesdeCarrerasCentrales,
  generarConfigMarcasPorDefecto,
  carreraCentralACarreraRegistro,
} from "../src/features/ejemplares/lib/tablas-marcas-desde-bd";
import type { CarreraCentral } from "../src/features/carreras/lib/central";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

console.log("\n[1] generarTablasDesdeCarrerasCentrales");
const carrerasSimuladas: CarreraCentral[] = [
  {
    fecha: "2026-11-15",
    hipodromo: "VALENCIA",
    carrera: 1,
    distancia: "1200",
    superficie: "ARENA",
    premio: 1500,
    caballos: [
      { numero: "1", nombre: "GRAN TRUENO", jockey: "J. HERRERA", retirado: false },
      { numero: "2", nombre: "REY DE COPAS", jockey: "E. MEDINA", retirado: false },
      { numero: "3", nombre: "VALENCIANO", jockey: "M. IBARRA", retirado: true },
      { numero: "4", nombre: "CAMPEON", jockey: "R. CAPRILES", retirado: false },
    ],
  },
  {
    fecha: "2026-11-15",
    hipodromo: "VALENCIA",
    carrera: 2,
    distancia: "1400",
    superficie: "ARENA",
    premio: 2000,
    caballos: [
      { numero: "1", nombre: "LUNA LLENA", jockey: "A. CHIRINOS", retirado: false },
      { numero: "2", nombre: "ESTRELLA", jockey: "Y. LEAL", retirado: false },
    ],
  },
];

const tablas = generarTablasDesdeCarrerasCentrales(carrerasSimuladas, "2026-11-15");
ok("Genera 2 tablas fijas", tablas.length === 2);
eq("Hipódromo en mayúsculas", tablas[0].hipodromo, "VALENCIA");
eq("Nacionalidad venezolana por defecto para Valencia", (tablas[0].caballos as any[])[0].nacionalidad, "VE");
eq("Número de carrera correcto", tablas[0].carrera, 1);
eq("Premio original", tablas[0].premio_original, 1500);
eq("Estado inicial Abierta", tablas[0].estado, "Abierta");
ok("Conserva todos los ejemplares inscritos", (tablas[0].caballos as any[]).length === 4);
eq("Mantiene el ejemplar retirado marcado", (tablas[0].caballos as any[])[2].retirado, true);

console.log("\n[2] generarConfigMarcasPorDefecto");
const configMarcaC1 = generarConfigMarcasPorDefecto(carrerasSimuladas[0]);
eq("Hipódromo de la marca", configMarcaC1.hipodromo, "VALENCIA");
eq("Fecha de la marca", configMarcaC1.fecha, "2026-11-15");
eq("Carrera de la marca", configMarcaC1.carrera, 1);
ok("Marcas contiene números de ejemplares activos", configMarcaC1.marcas.length > 0);
ok("Marcas no incluye al ejemplar retirado", !configMarcaC1.marcas.split("/").includes("3"));
eq("NV incluye al ejemplar retirado (3)", configMarcaC1.nv, "3");
eq("Estado de la marca es Abierta", configMarcaC1.estado, "Abierta");
eq("Debutantes valen true por defecto", configMarcaC1.debutantes_valen, true);

// Caso con marcas y nv personalizadas
const configPersonalizada = generarConfigMarcasPorDefecto(carrerasSimuladas[0], "1/4", "2/3", "Cerrada");
eq("Respeta marcas personalizadas", configPersonalizada.marcas, "1/4");
eq("Respeta nv personalizado", configPersonalizada.nv, "2/3");
eq("Respeta estado personalizado", configPersonalizada.estado, "Cerrada");

console.log("\n[3] carreraCentralACarreraRegistro");
const registroGaceta = carreraCentralACarreraRegistro(carrerasSimuladas[0]);
eq("Carrera número en registro", registroGaceta.carrera, 1);
eq("Hipódromo en registro", registroGaceta.hipodromo, "VALENCIA");
eq("Total ejemplares en registro", registroGaceta.ejemplares?.length, 4);
eq("Primer ejemplar nombre", registroGaceta.ejemplares?.[0].nombre, "GRAN TRUENO");
eq("Primer ejemplar jinete", registroGaceta.ejemplares?.[0].jockey, "J. HERRERA");
ok("Seleccionada es true por defecto", registroGaceta.seleccionada === true);

console.log(`\nResultado: ${pasan} pasaron, ${fallan} fallaron.`);
if (fallan > 0) process.exit(1);
