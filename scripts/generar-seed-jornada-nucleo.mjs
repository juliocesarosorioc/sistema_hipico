import fs from "node:fs";
import path from "node:path";

const FECHA = "2026-11-04";

// Nombres base para generar ejemplares únicos y realistas de carreras USA
const PREFIJOS = [
  "AMERICAN", "GOLDEN", "SILVER", "MIDNIGHT", "ROYAL", "STORM", "WILD", "SWEET",
  "FAST", "LUCKY", "BIG", "LITTLE", "GRAND", "CHIEF", "KING", "QUEEN", "MAGIC",
  "SHADOW", "THUNDER", "FIRE", "BLUE", "RED", "DIAMOND", "WARRIOR", "STAR",
  "CLASSIC", "NOBLE", "SECRET", "BRAVE", "SOUTHERN", "NORTHERN", "SUMMER", "WINTER",
  "FLYING", "RUNNING", "DREAMING", "SMART", "FLASH", "POWER", "PERFECT", "VALLEY",
  "HARBOR", "DELTA", "CHURCHILL", "MOUNTAIN", "ISLAND", "SUNSET", "RIVER", "COPPER"
];

const SUFIJOS = [
  "RUNNER", "FLASH", "STORM", "WARRIOR", "SPIRIT", "DANCER", "ROCKET", "CHIEF",
  "PRINCE", "PRINCESS", "LEGEND", "HERO", "KNIGHT", "FORCE", "BULLET", "GLORY",
  "STRIKE", "HONOR", "CHAMPION", "FLIGHT", "DREAM", "HOPE", "MEMORY", "VICTORY",
  "SHINE", "ARROW", "EXPRESS", "POWER", "PRIDE", "SHADOW", "BREEZE", "FORTUNE",
  "BLAZE", "RIDER", "APPEAL", "PROMISE", "TIME", "SONG", "RULER", "WONDER"
];

const JOCKEYS = [
  "I. Ortiz, Jr.", "J. L. Ortiz", "F. Prat", "T. Gaffalione", "J. R. Velazquez",
  "L. Saez", "M. Franco", "K. Carmouche", "J. Rosario", "D. Cohen",
  "A. Bocachica", "J. D. Acosta", "C. Hiraldo", "M. Mendez", "V. Rodriguez",
  "D. Araujo", "K. Trotman", "R. Lull", "C. J. Hernandez", "T. Pompell",
  "M. Pedroza, Jr.", "E. Esquivel", "J. Ramos", "A. Burgos", "F. De La Cruz",
  "C. Lanerie", "B. J. Hernandez, Jr.", "R. Bejarano", "J. McKee", "A. Jimenez",
  "G. Lagunes", "L. A. Batista", "Y. Aviles", "E. Paucar", "C. Oliveros",
  "J. A. Bracho", "A. I. Diaz", "F. Reyes", "E. Barbaran", "L. R. Rivera"
];

const TRAINERS = [
  "Todd A. Pletcher", "Chad C. Brown", "Brad H. Cox", "Steven M. Asmussen",
  "William I. Mott", "Michael J. Maker", "Kenneth G. McPeek", "Mark E. Casse",
  "Christophe Clement", "Brittany T. Russell", "Jeff C. Runco", "Anthony Farrior",
  "Javier Contreras", "Timothy C. Grams", "Kevin J. Joy", "Ronney W. Brown",
  "Michael E. Jones, Jr.", "Karl Broberg", "Robertino Diodoro", "Thomas M. Amoss",
  "Genaro Garcia", "Randy L. Klopp", "Cipriano Contreras", "Eddie Kenneally",
  "Albert M. Stall, Jr.", "Dallas Stewart", "Gregory D. Foley", "Ian R. Wilkes",
  "Edward R. Barker", "Linda Rice", "Rudy R. Rodriguez", "Raymond Handal"
];

const OWNERS = [
  "Godolphin, LLC", "Winchell Thoroughbreds LLC", "Klaravich Stables, Inc.",
  "Repole Stable", "St. Elias Stable", "Calumet Farm", "Juddmonte",
  "Spendthrift Farm LLC", "Winstar Farm LLC", "Peter M. Brant",
  "Coleswood Farm, Inc.", "David M. Raim", "Michael Scheffres",
  "Runco Racing LLC", "Super C Racing Inc.", "Built Wright Stables, LLC",
  "End Zone Athletics, Inc.", "Maggi Moss", "Flurry Racing Stables LLC"
];

const ML_ODDS = ["9/5", "2/1", "5/2", "3/1", "7/2", "4/1", "9/2", "5/1", "6/1", "8/1", "10/1", "12/1", "15/1", "20/1"];

let nombreIdx = 0;
function generarNombreUnico() {
  const p = PREFIJOS[nombreIdx % PREFIJOS.length];
  const s = SUFIJOS[Math.floor(nombreIdx / PREFIJOS.length) % SUFIJOS.length];
  const num = Math.floor(nombreIdx / (PREFIJOS.length * SUFIJOS.length));
  nombreIdx++;
  return num > 0 ? `${p} ${s} ${num + 1}` : `${p} ${s}`;
}

const TRACKS = [
  {
    nombre: "CHURCHILL DOWNS",
    codigo: "CD",
    pais: "USA",
    distancias: [1200, 1600, 1700, 1400, 1300, 1800, 1200, 1600, 1700, 1200],
    superficies: ["ARENA", "ARENA", "GRAMA", "ARENA", "ARENA", "GRAMA", "ARENA", "ARENA", "GRAMA", "ARENA"],
    horas: ["13:00", "13:30", "14:01", "14:33", "15:05", "15:37", "16:09", "16:41", "17:13", "17:45"],
    carreras: 10,
    ejsPorCarrera: [9, 8, 9, 10, 8, 9, 10, 8, 9, 9]
  },
  {
    nombre: "HOLLYWOOD AT CHARLES TOWN",
    codigo: "CT",
    pais: "USA",
    distancias: [905, 1408, 905, 1308, 905, 1408, 905, 1308],
    superficies: ["ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA"],
    horas: ["19:00", "19:32", "20:02", "20:32", "21:02", "21:32", "22:02", "22:32"],
    carreras: 8,
    ejsPorCarrera: [7, 8, 8, 7, 8, 8, 7, 8]
  },
  {
    nombre: "DELTA DOWNS",
    codigo: "DED",
    pais: "USA",
    distancias: [1000, 1300, 1000, 1600, 1300, 1000, 1400, 1300, 1000],
    superficies: ["ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA"],
    horas: ["18:15", "18:41", "19:07", "19:33", "19:59", "20:25", "20:51", "21:17", "21:43"],
    carreras: 9,
    ejsPorCarrera: [9, 9, 8, 9, 8, 9, 8, 9, 9]
  },
  {
    nombre: "EVANGELINE DOWNS",
    codigo: "EVD",
    pais: "USA",
    distancias: [1100, 1200, 1600, 1200, 1100, 1600, 1200, 1100],
    superficies: ["ARENA", "ARENA", "GRAMA", "ARENA", "ARENA", "GRAMA", "ARENA", "ARENA"],
    horas: ["18:30", "18:57", "19:24", "19:51", "20:18", "20:45", "21:12", "21:39"],
    carreras: 8,
    ejsPorCarrera: [8, 8, 9, 8, 9, 8, 8, 8]
  },
  {
    nombre: "FINGER LAKES",
    codigo: "FL",
    pais: "USA",
    distancias: [1200, 1100, 1664, 1200, 1100, 1664, 1200, 1100],
    superficies: ["ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA"],
    horas: ["13:15", "13:44", "14:13", "14:42", "15:11", "15:40", "16:09", "16:38"],
    carreras: 8,
    ejsPorCarrera: [8, 8, 9, 8, 9, 8, 8, 8]
  },
  {
    nombre: "HORSESHOE INDIANAPOLIS",
    codigo: "IND",
    pais: "USA",
    distancias: [1200, 1600, 1100, 1700, 1200, 1600, 1100, 1200, 318],
    superficies: ["ARENA", "GRAMA", "ARENA", "GRAMA", "ARENA", "GRAMA", "ARENA", "ARENA", "ARENA"],
    horas: ["14:10", "14:41", "15:12", "15:43", "16:14", "16:45", "17:16", "17:47", "18:18"],
    carreras: 9,
    ejsPorCarrera: [9, 9, 10, 9, 9, 10, 9, 9, 9]
  },
  {
    nombre: "MOUNTAINEER",
    codigo: "MNR",
    pais: "USA",
    distancias: [1100, 1200, 1600, 1100, 1200, 1600, 1100, 1200],
    superficies: ["ARENA", "ARENA", "GRAMA", "ARENA", "ARENA", "GRAMA", "ARENA", "ARENA"],
    horas: ["19:00", "19:25", "19:50", "20:15", "20:40", "21:05", "21:30", "21:55"],
    carreras: 8,
    ejsPorCarrera: [8, 7, 8, 8, 7, 8, 8, 8]
  },
  {
    nombre: "MAHONING VALLEY",
    codigo: "MVR",
    pais: "USA",
    distancias: [1200, 1100, 1600, 1200, 1100, 1600, 1200, 1600],
    superficies: ["ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA"],
    horas: ["12:45", "13:12", "13:39", "14:06", "14:33", "15:00", "15:27", "15:54"],
    carreras: 8,
    ejsPorCarrera: [9, 9, 9, 8, 9, 9, 9, 9]
  },
  {
    nombre: "PARX RACING",
    codigo: "PRX",
    pais: "USA",
    distancias: [1200, 1300, 1664, 1200, 1400, 1664, 1200, 1300, 1400, 1200],
    superficies: ["ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA", "ARENA"],
    horas: ["12:05", "12:34", "13:03", "13:32", "14:01", "14:30", "14:59", "15:28", "15:57", "16:26"],
    carreras: 10,
    ejsPorCarrera: [10, 10, 11, 10, 11, 10, 11, 11, 11, 10]
  }
];

export function generarJornadaCompleta() {
  const todasLasCarreras = [];
  const todosLosEjemplares = [];
  let idEjemplarGlobal = 1;

  for (const t of TRACKS) {
    for (let cNum = 1; cNum <= t.carreras; cNum++) {
      const idxC = cNum - 1;
      const numEjemplares = t.ejsPorCarrera[idxC];
      const caballos = [];
      const retirados = [];

      for (let pNum = 1; pNum <= numEjemplares; pNum++) {
        const nombre = generarNombreUnico();
        const jIdx = (idEjemplarGlobal + pNum) % JOCKEYS.length;
        const tIdx = (idEjemplarGlobal + pNum * 2) % TRAINERS.length;
        const oIdx = (idEjemplarGlobal + pNum * 3) % OWNERS.length;
        const mlIdx = (pNum - 1) % ML_ODDS.length;

        // Peso entre 53.5 kg y 56.5 kg
        const pesoKg = Math.round((53.5 + (pNum % 7) * 0.5) * 10) / 10;
        const esRetirado = (cNum === 1 && pNum === 4); // algunos retirados controlados

        const caballo = {
          numero: String(pNum),
          nombre,
          nacionalidad: "USA",
          valor: 0,
          pp: pNum,
          ml: ML_ODDS[mlIdx],
          jockey: JOCKEYS[jIdx],
          entrenador: TRAINERS[tIdx],
          stud: OWNERS[oIdx],
          owner: OWNERS[oIdx],
          peso: pesoKg,
          medicamento: "L",
          retirado: esRetirado
        };

        caballos.push(caballo);
        todosLosEjemplares.push({
          nombre,
          nacionalidad: "USA",
          hipodromo: t.nombre,
          carrera: cNum,
          numero: String(pNum),
          jockey: JOCKEYS[jIdx],
          entrenador: TRAINERS[tIdx],
          stud: OWNERS[oIdx],
          peso: pesoKg,
          ml: ML_ODDS[mlIdx],
          retirado: esRetirado
        });

        if (esRetirado) {
          retirados.push(String(pNum));
        }
        idEjemplarGlobal++;
      }

      todasLasCarreras.push({
        hipodromo: t.nombre,
        codigo: t.codigo,
        carrera: cNum,
        fecha: FECHA,
        hora: t.horas[idxC] || "15:00",
        distancia: t.distancias[idxC] || 1200,
        superficie: t.superficies[idxC] || "ARENA",
        premio: 15000 + (cNum * 2500),
        caballos,
        retirados
      });
    }
  }

  return { tracks: TRACKS, carreras: todasLasCarreras, ejemplares: todosLosEjemplares };
}
