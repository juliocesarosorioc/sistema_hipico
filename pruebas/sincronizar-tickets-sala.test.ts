// Regresión: el bot concretó tickets en chat_tickets_fifo pero no los reflejó
// en tickets_apuestas porque el payload incluía la columna inexistente
// `modalidad` y el error de PostgREST se descartaba silenciosamente.
import { sincronizarTicketsPropuestaATaquilla } from "../src/features/whatsapp-sala/lib/sincronizar-tickets-sala";

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

function crearCliente(resultados: {
  tickets?: any[];
  grupo?: any;
  existente?: any;
  errorInsert?: any;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const from = (tabla: string) => {
    const st: { tabla: string; metodo: string } = { tabla, metodo: "select" };
    const api: any = {
      select() {
        st.metodo = "select";
        return api;
      },
      eq() {
        return api;
      },
      neq() {
        return api;
      },
      ilike() {
        return api;
      },
      in() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        return Promise.resolve({
          data:
            st.tabla === "grupos_venta"
              ? resultados.grupo ?? null
              : resultados.existente ?? null,
          error: null,
        });
      },
      insert(filas: Array<Record<string, unknown>>) {
        st.metodo = "insert";
        inserts.push(...filas);
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        let value: any = { data: null, error: null };
        if (st.metodo === "select" && st.tabla === "chat_tickets_fifo") {
          value = { data: resultados.tickets ?? [] };
        } else if (st.metodo === "insert") {
          value = { data: null, error: resultados.errorInsert ?? null };
        }
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return api;
  };
  return { from, inserts };
}

const ticket = {
  codigo_ticket: "TK-E23B4EA9",
  proponente_id: "c2b86c79-f5f3-426d-a0b8-172adff10898",
  proponente_nombre: "SHAFLAN",
  aceptante_id: "bcf510ec-8c71-4503-bd8f-1db38335faa1",
  aceptante_nombre: "CLUB AMERICA",
  accion_proponente: "JUEGA",
  modalidad: "1P y 1/2N",
  ejemplar_numero: "6",
  caballos_bando_a: ["6"],
  caballos_bando_b: [],
  es_match: false,
  proporcion_premio: "1x1",
  monto_concretado: 1000,
  estado: "ACTIVO",
};

const params = {
  propuestaMsgId: "36c4e5e5-fd1d-46fd-8f45-540b5b439b8b",
  sala: {
    id: "6cafa9e9-d6d4-4ff2-9b31-36ad176cdd7b",
    grupo_id: "b37f5104-5d38-44ab-b28a-5a546fe5fdb5",
    hipodromo_activo: "GULFSTREAM PARK",
    numero_carrera_activa: 7,
    fecha_activa: "2026-11-19",
  },
  grupoId: "b37f5104-5d38-44ab-b28a-5a546fe5fdb5",
};

(async () => {
  console.log("\n[1] ticket concretado se refleja en tickets_apuestas");
  const cliente = crearCliente({ tickets: [ticket], grupo: { comision_default: 2.5, moneda: "USD" } });
  await sincronizarTicketsPropuestaATaquilla(cliente as any, params);
  eq("un ticket insertado", cliente.inserts.length, 1);
  const fila = cliente.inserts[0] ?? {};
  eq("sin columna inexistente modalidad", Object.prototype.hasOwnProperty.call(fila, "modalidad"), false);
  eq("marcador de auditoría", fila.nota_auditoria, {
    origen: "SALA_P2P",
    codigo_ticket: "TK-E23B4EA9",
  });
  eq("monto", fila.monto_jugado, 1000);
  eq("jugador", fila.cliente_juega_nombre, "SHAFLAN");
  eq("caballo", fila.caballo, "6");
  eq("jugada", fila.nombre_jugada, "1P Y 1/2N");
  eq("comisión", fila.comision_porcentaje, 2.5);

  console.log("\n[2] error de inserción no detiene el bot");
  const clienteError = crearCliente({
    tickets: [ticket],
    grupo: null,
    errorInsert: { message: "simulado" },
  });
  await sincronizarTicketsPropuestaATaquilla(clienteError as any, params);
  eq("intento realizado", clienteError.inserts.length, 1);

  console.log(`\nRESUMEN: ${pasan} pasan, ${fallan} fallan`);
  if (fallan > 0) process.exitCode = 1;
})();
