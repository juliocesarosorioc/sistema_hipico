import {
  parsearComandoApertura,
  esComandoCierre,
  parsearPizarra,
  respuestaApertura,
  respuestaCarreraCerrada,
  respuestaPizarra,
} from "../src/features/whatsapp/lib/agente-grupo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("Fallo: " + msg);
}

console.log("=== INICIO PRUEBAS WHATSAPP GRUPO CARRERA Y ABONO ADMIN ===");

// Apertura
const ap = parsearComandoApertura("Abierta La Rinconada 1");
assert(Boolean(ap), "Debe parsear apertura estándar");
assert(ap?.hipodromo === "LA RINCONADA" && ap?.carrera === 1, "Hipódromo y carrera correctos");
assert(respuestaApertura(ap!).includes("🟢 ABIERTA"), "Respuesta de apertura correcta");

const ap2 = parsearComandoApertura("Abierta C2");
assert(ap2?.carrera === 2, "Debe parsear 'Abierta C2'");

// Cierre
assert(esComandoCierre("Cerrada"), "Cerrada debe detectarse");
assert(esComandoCierre("No va más"), "No va más debe detectarse");
assert(respuestaCarreraCerrada().includes("⛔ Carrera cerrada"), "Respuesta de cierre correcta");

// Pizarra
const pz = parsearPizarra("Pizarra: 5-2-8-1-4");
assert(Array.isArray(pz) && pz.join("-") === "5-2-8-1-4", "Debe parsear pizarra");
const pz2 = parsearPizarra("Cambio de pizarra: 2-5-8-1-4");
assert(Array.isArray(pz2), "Debe parsear corrección de pizarra");
assert(respuestaPizarra(pz!).includes("5-2-8-1-4"), "Respuesta de pizarra correcta");

console.log("=== TODAS LAS PRUEBAS WHATSAPP GRUPO PASARON ===");