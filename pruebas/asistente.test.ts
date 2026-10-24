import {
  esConsultaDeCarreras,
  fechaSolicitada,
  rutaSugeridaAutorizada,
  rutasDisponiblesPara,
  resumirCarreras,
} from "../src/features/asistente/lib/contrato";

let pasan = 0;
let fallan = 0;

function igual(nombre: string, obtenido: unknown, esperado: unknown) {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n        obtenido: ${JSON.stringify(obtenido)}\n        esperado: ${JSON.stringify(esperado)}`);
  }
}

function verificar(nombre: string, condicion: boolean) {
  igual(nombre, condicion, true);
}

const rutas = rutasDisponiblesPara([
  "carreras:ruta_carreras",
  "general:ruta_inicio",
]);

verificar("solo incluye rutas con permiso vigente", rutas.some((ruta) => ruta.ruta === "/carreras"));
verificar("no expone rutas sin permiso", !rutas.some((ruta) => ruta.ruta === "/clientes"));
igual("no acepta navegación a una ruta no autorizada", rutaSugeridaAutorizada("/clientes", rutas), null);
igual("acepta navegación a una ruta permitida", rutaSugeridaAutorizada("/carreras", rutas), "/carreras");
igual("reconoce consulta de programa de carreras", esConsultaDeCarreras("¿Qué carreras hay hoy?"), true);
igual("no clasifica consulta general como carrera", esConsultaDeCarreras("¿Cómo cambio mi contraseña?"), false);
igual("usa fecha de hoy cuando no se indica", fechaSolicitada("¿Qué carreras hay?", "2026-10-22"), "2026-10-22");
igual("extrae fecha válida", fechaSolicitada("Consulta las carreras 2026-10-23", "2026-10-22"), "2026-10-23");
igual("rechaza fecha imposible", fechaSolicitada("Carreras 2026-02-30", "2026-10-22"), "2026-10-22");
igual(
  "reduce carreras y ejemplares a campos seguros para contexto",
  resumirCarreras([{
    hipodromo: "La Rinconada",
    fecha: "2026-10-22",
    carrera: 3,
    distancia: "1200",
    caballos: [{ numero: 1, nombre: "Ejemplar Uno", retirado: false }],
  }]),
  [{
    hipodromo: "La Rinconada",
    fecha: "2026-10-22",
    carrera: 3,
    distancia: "1200",
    superficie: null,
    ejemplares: [{ numero: "1", nombre: "Ejemplar Uno", retirado: false }],
  }]
);

console.log(`\n${pasan} pasaron, ${fallan} fallaron.`);
if (fallan) process.exitCode = 1;
