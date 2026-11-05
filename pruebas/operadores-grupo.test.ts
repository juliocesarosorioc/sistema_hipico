import assert from "node:assert/strict";
import {
  generarMensajeWhatsappOperador,
  normalizarTelefonoWhatsapp,
  enlaceWhatsappOperador,
} from "../src/features/grupos/lib/operadores-grupo";

console.log("=== PRUEBAS DE OPERADORES DE GRUPO Y ENVÍO WHATSAPP ===");

// 1. Prueba de normalización de teléfonos WhatsApp
assert.equal(normalizarTelefonoWhatsapp("+58 414-9327337", "+58"), "584149327337", "Normaliza número vzla con código y guiones");
assert.equal(normalizarTelefonoWhatsapp("04141234567", "+58"), "584141234567", "Quita el cero nacional inicial y antepone código 58");
assert.equal(normalizarTelefonoWhatsapp("584141234567", "+58"), "584141234567", "Mantiene número que ya tiene código 58");
assert.equal(normalizarTelefonoWhatsapp("+1 (305) 555-0199", "+1"), "13055550199", "Normaliza número internacional USA +1");
assert.equal(normalizarTelefonoWhatsapp("", "+58"), "", "Retorna vacío si no hay teléfono");

// 2. Prueba de generación de mensaje con credenciales e íconos
const mensaje = generarMensajeWhatsappOperador({
  grupoNombre: "Gun Bold",
  usuario: "carlos_movil",
  clave: "OP5821",
  nombre: "Carlos Gómez",
  telefono: "+58 414-1234567",
  urlLogin: "https://sistema.test/login/",
});

assert.ok(mensaje.includes("ACCESO DE TAQUILLA MÓVIL"), "Tiene encabezado llamativo con ícono");
assert.ok(mensaje.includes("GUN BOLD"), "Incluye nombre del grupo");
assert.ok(mensaje.includes("Carlos Gómez"), "Incluye nombre del operador");
assert.ok(mensaje.includes("`carlos_movil`"), "Incluye usuario en formato monoespaciado");
assert.ok(mensaje.includes("`OP5821`"), "Incluye contraseña en formato monoespaciado");
assert.ok(mensaje.includes("https://sistema.test/login/"), "Incluye enlace de acceso directo");
assert.ok(mensaje.includes("1️⃣") && mensaje.includes("2️⃣"), "Incluye instrucciones numeradas");

// 3. Prueba de enlace WhatsApp wa.me
const enlace = enlaceWhatsappOperador({
  grupoNombre: "Argentina",
  usuario: "yes",
  clave: "Yes#2026",
  nombre: "YES",
  telefono: "04149327337",
  codigoPais: "+58",
  urlLogin: "https://app.sistemahipico.com/login/",
});

assert.ok(enlace.startsWith("https://wa.me/584149327337?text="), "Genera URL wa.me correcta sin cero inicial");
assert.ok(enlace.includes(encodeURIComponent("Yes#2026")), "Contraseña está codificada en el texto URL");
assert.ok(enlace.includes(encodeURIComponent("ARGENTINA")), "Grupo está codificado en el texto URL");

console.log("✔ TODAS LAS PRUEBAS DE OPERADORES Y MENSAJERÍA PASARON CON ÉXITO.");
