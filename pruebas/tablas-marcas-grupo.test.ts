// Pruebas del ENVÍO AL GRUPO de Tablas Fijas y Marcas por la WhatsApp Business
// Cloud API (Edge Function `whatsapp-enviar`), en lugar de abrir `wa.me`.
//
// El envío real no se puede ejercitar sin base de datos ni la cuenta de Meta,
// así que aquí se prueba:
//   · que los textos se puedan construir PUROS (sin abrir ventana), que es lo
//     que permite reutilizar el mismo contenido en el envío por API;
//   · que la capa de componentes quede CABLEADA a `enviarAlGrupoWsp` (un rename
//     accidental no debe dejar los botones "Al grupo" abriendo wa.me otra vez).
import {
  construirTextoWhatsAppMatriz,
  construirTextoWhatsAppReporte,
} from "../src/features/impresion/lib/exportar";
import { construirTextoWhatsAppMarcas, type BloqueMarcas } from "../src/features/impresion/lib/marcas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
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

// ---------------------------------------------------------------------------
// [1] construirTextoWhatsAppMatriz — PURA (sin wa.me)
// ---------------------------------------------------------------------------
console.log("\n[1] construirTextoWhatsAppMatriz");
const matriz = [
  { hipodromo: "VALENCIA", carrera: "5", superficie: "ARENA", fecha: "2026-10-14", moneda: "USD", ejemplares: [{}, {}], premio: 120 },
];
const textoMatriz = construirTextoWhatsAppMatriz(matriz);
ok("devuelve un texto no vacío", typeof textoMatriz === "string" && textoMatriz.length > 0);
ok("lleva la cabecera de la plantilla tablas_matriz", textoMatriz.includes("TABLAS FIJAS PUBLICADAS"));
ok("incluye el hipódromo", textoMatriz.includes("VALENCIA"));
ok("incluye la carrera", textoMatriz.includes("C5"));
ok("incluye el total de ejemplares", textoMatriz.includes("*TOTAL EJEMPLARES:* 2"));
// La pureza se prueba de hecho: en node no hay `window`, así que si la función
// abriera wa.me habría explotado antes de llegar acá.
ok("NO toca `window` (puro)", typeof (globalThis as { window?: unknown }).window === "undefined");

// ---------------------------------------------------------------------------
// [2] construirTextoWhatsAppReporte — PURA (sin wa.me)
// ---------------------------------------------------------------------------
console.log("\n[2] construirTextoWhatsAppReporte");
const reporte = [{ jugador: "ANA", grupo: "G1", nivel: "A", montoJugado: 100, montoPagado: 40 }];
const textoReporte = construirTextoWhatsAppReporte(reporte);
ok("devuelve un texto no vacío", textoReporte.length > 0);
ok("lleva la cabecera de la plantilla tablas_reporte", textoReporte.includes("REPORTE DE TABLAS"));
ok("incluye el jugador", textoReporte.includes("ANA"));
ok("incluye jugado/pagado", textoReporte.includes("JUGADO") && textoReporte.includes("PAGADO"));

// ---------------------------------------------------------------------------
// [3] construirTextoWhatsAppMarcas — PURA (sin wa.me)
// ---------------------------------------------------------------------------
console.log("\n[3] construirTextoWhatsAppMarcas");
const bloques: BloqueMarcas[] = [
  {
    hipodromo: "VALENCIA",
    carreras: [
      { carrera: 1, marcas: ["2", "4"], nv: [], deb: [], debValen: true, estado: "Abierta" },
      { carrera: 2, marcas: [], nv: ["7"], deb: [], debValen: true, estado: "Cerrada" },
    ],
  },
];
const textoMarcas = construirTextoWhatsAppMarcas(bloques, "2026-10-14");
ok("devuelve un texto no vacío", textoMarcas.length > 0);
ok("lleva la cabecera de la plantilla marcas_hoja", textoMarcas.includes("PROGRAMA DEL DÍA"));
ok("incluye el hipódromo", textoMarcas.includes("VALENCIA"));
ok("lista las carreras con sus marcas", textoMarcas.includes("C1 · MARCAS 2 4"));
ok("marca la carrera sin marcas con —", textoMarcas.includes("C2 · MARCAS —"));
ok("cuenta las carreras del día", textoMarcas.includes("*CARRERAS:* 2"));

// ---------------------------------------------------------------------------
// [4] Capa de componentes cableada al envío por API
// ---------------------------------------------------------------------------
console.log("\n[4] componentes de Tablas y Marcas → enviarAlGrupoWsp");
const raiz = process.cwd();
const modal = readFileSync(join(raiz, "src", "features", "tablas", "components", "ConfigImpresionModal.tsx"), "utf8");
const panel = readFileSync(join(raiz, "src", "features", "marcas", "components", "PanelMarcas.tsx"), "utf8");

ok(
  "el modal de impresión importa enviarAlGrupoWsp",
  /import\s*\{[^}]*enviarAlGrupoWsp[^}]*\}\s*from\s*"@\/features\/whatsapp\/lib\/whatsapp"/.test(modal)
);
ok(
  "el modal envía las Tablas al grupo con módulo \"tablas\"",
  /enviarAlGrupoWsp\([\s\S]*?"tablas"\)/.test(modal)
);
ok(
  "el modal usa el texto PURO (no abre wa.me) para el grupo",
  /construirTextoWhatsApp(Matriz|Reporte)\(/.test(modal) && /tipo === "matriz" \? construirTextoWhatsAppMatriz/.test(modal)
);
ok("el modal ofrece el botón \"Al grupo\"", modal.includes("📤 Al grupo"));

ok(
  "el panel de marcas importa enviarAlGrupoWsp",
  /import\s*\{\s*enviarAlGrupoWsp\s*\}\s*from\s*"@\/features\/whatsapp\/lib\/whatsapp"/.test(panel)
);
ok(
  "el panel envía las Marcas al grupo con módulo \"marcas\"",
  /enviarAlGrupoWsp\([\s\S]*?"marcas"\)/.test(panel)
);
ok(
  "el panel usa el texto PURO de marcas para el grupo",
  /enviarAlGrupoWsp\(\s*construirTextoWhatsAppMarcas\(/.test(panel)
);
ok("el panel ofrece el botón \"Al grupo\"", panel.includes("📤 Al grupo"));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
