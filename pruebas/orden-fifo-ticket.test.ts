// Regresión: error 23502 al concretar jugadas por WhatsApp.
//
// `chat_tickets_fifo.orden_fifo` es NOT NULL y no tiene DEFAULT en producción;
// el RPC `concretar_jugada_fifo_atomica` no lo envía. El constructor del ticket
// de la app debe incluir siempre todas las columnas obligatorias, con valores
// no nulos, para que el fallback local pueda concretar sin migraciones SQL.
import {
  COLUMNAS_OBLIGATORIAS_TICKET_FIFO,
  construirPayloadTicketFifo,
} from "../src/features/whatsapp-sala/lib/payload-ticket-fifo";

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
  eq(nombre, condicion, true);
}

const datosBase = {
  grupoId: "b37f5104-5d38-44ab-b28a-5a546fe5fdb5",
  salaId: "6cafa9e9-d6d4-4ff2-9b31-36ad176cdd7b",
  propuestaMsgId: "81ec3216-ef20-44ee-8bd4-7401f37b4749",
  proponenteId: "635ce220-aa31-46e6-9bc2-5e6a024f960a",
  proponenteNombre: "YES",
  aceptanteId: "11111111-1111-4111-8111-111111111111",
  aceptanteNombre: "ADMIN",
  montoSolicitado: 100,
  montoConcretado: 100,
};

console.log("\n[1] columnas NOT NULL siempre presentes");
for (const columna of COLUMNAS_OBLIGATORIAS_TICKET_FIFO) {
  if (columna === "id" || columna === "codigo_ticket") continue;
  const payload = construirPayloadTicketFifo(datosBase, 7);
  ok(`${columna} presente`, Object.prototype.hasOwnProperty.call(payload, columna));
}

console.log("\n[2] orden_fifo nunca nulo");
eq("orden explícito", construirPayloadTicketFifo(datosBase, 7).orden_fifo, 7);
eq("orden sin valor -> 1", construirPayloadTicketFifo(datosBase, 0).orden_fifo, 1);
eq("orden NaN -> 1", construirPayloadTicketFifo(datosBase, NaN).orden_fifo, 1);

console.log("\n[3] valores por defecto no nulos en texto");
const payloadMin = construirPayloadTicketFifo(
  {
    grupoId: datosBase.grupoId,
    propuestaMsgId: datosBase.propuestaMsgId,
    montoSolicitado: 50,
    montoConcretado: 50,
  },
  1
);
eq("proponente_nombre", payloadMin.proponente_nombre, "Proponente");
eq("aceptante_nombre", payloadMin.aceptante_nombre, "Jugador");
eq("modalidad", payloadMin.modalidad, "1P");
eq("ejemplar_numero", payloadMin.ejemplar_numero, "1");
eq("accion_proponente", payloadMin.accion_proponente, "JUEGA");
eq("proporcion_premio", payloadMin.proporcion_premio, "1x1");

console.log("\n[4] montos y estado");
const payload = construirPayloadTicketFifo(
  { ...datosBase, montoConcretado: 43.5, montoPendienteAmpliacion: 56.5, estado: "activo" },
  3
);
eq("monto_concretado", payload.monto_concretado, 43.5);
eq("monto_pendiente_ampliacion", payload.monto_pendiente_ampliacion, 56.5);
eq("estado normalizado", payload.estado, "ACTIVO");

console.log(`\nRESUMEN: ${pasan} pasan, ${fallan} fallan`);
if (fallan > 0) process.exitCode = 1;
