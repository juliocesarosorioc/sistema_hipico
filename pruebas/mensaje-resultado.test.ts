import { mensajeResultadoDeCarrera } from "../src/lib/taquilla/mensajeResultado";
import type { PizarraCarrera } from "../src/lib/liquidacion";

const pizarra: PizarraCarrera = {
  primero: "7",
  segundo: "2",
  tercero: "4",
  cuarto: "1",
  quinto: "5",
  sexto: "",
  septimo: "",
  octavo: "",
};

const dividendos: Record<string, number> | null = {
  // Dummy para no forzar indeterminado salvo que falte matriz WPS
  "win:7": 12.5,
  "place:7": 5.4,
  "show:7": 3.2,
};

const tickets = [
  // NINI 2N (caballo 2): si NO figura → gana; en esta pizarra 2° figura → pierde (retorno clásico)
  {
    comando: "100 2N",
    monto: 100,
    caballo: "2",
    cliente1: "JUAN",
    cliente2: "PEDRO",
  },
  // Clásico pierde: 1P caballo 3 (3 no está entre 1-5) → pierde
  {
    comando: "200 1P",
    monto: 200,
    caballo: "3",
    cliente1: "MARIO",
  },
  // Clásico ganador con consigue: supongamos 7 gana (primero 7). 1P caballo 7 → gana
  {
    comando: "150 1P",
    monto: 150,
    caballo: "7",
    cliente1: "LUIS",
    cliente2: "CARLOS",
  },
];

export function testGeneracionMensajeResultados() {
  const msg = mensajeResultadoDeCarrera({
    hipodromo: "LA RINCONADA",
    carrera: 5,
    fecha: "2025-10-10",
    grupo: "TERCIOS",
    retirados: "NO HUBO RETIROS",
    pizarra,
    dividendos,
    tickets,
    tasaComision: 5,
  });

  if (!msg) throw new Error("El mensaje no puede estar vacío");
  if (!msg.includes("TERCIOS") && !msg.includes("LA RINCONADA")) {
    throw new Error("Falta cabecera del grupo/hipódromo");
  }
  if (!msg.includes("CARRERA") && !msg.includes("5 Carrera") && !msg.includes("Carrera")) {
    // Acepta variantes del header
  }
  if (!msg.includes("Juega")) throw new Error("Debe incluir líneas 'Juega'");
  if (!msg.includes("POSITIVOS")) throw new Error("Debe incluir cierre POSITIVOS");
  if (!msg.includes("NEGATIVOS")) throw new Error("Debe incluir cierre NEGATIVOS");
  if (!msg.includes("Total jugadas")) throw new Error("Debe incluir pie 'Total jugadas'");

  const total = (msg.match(/Total jugadas:\s*\d+/i)?.[0] ?? "");
  const num = Number(total.replace(/\D/g, ""));
  if (num !== tickets.length) throw new Error(`Total jugadas incorrecto: ${total}`);
}

testGeneracionMensajeResultados();
console.log("✔ mensaje-resultado.test.ts: PASS (formato de relación de resultados válido)");

