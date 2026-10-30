/**
 * validador.ts
 *
 * Herramienta de verificación, validación y mensajería para importación de Gacetas IA.
 * Detecta omisiones de ejemplares, huecos en secuencias de caballos o carreras,
 * campos faltantes y genera reportes detallados consolidados por archivo y carrera.
 */

import { numeroDeCarrera } from "./numeros";
import type { CarreraRegistro, EjemplarEditable } from "./ui";
import type { CarreraExtraida } from "./ia";

export type TipoIncidencia = "error" | "advertencia";

export type IncidenciaCarrera = {
  tipo: TipoIncidencia;
  campo?: string;
  mensaje: string;
  numeroCaballo?: string | number;
};

export type DiagnosticoCarrera = {
  esValida: boolean;
  esCompleta: boolean;
  nivel: "completa" | "advertencia" | "incompleta";
  incidencias: IncidenciaCarrera[];
  totalCaballos: number;
  caballosNumeros: number[];
  caballosFaltantes: number[];
  numerosDuplicados: number[];
  caballosSinNombre: Array<string | number>;
  tieneDistancia: boolean;
  tieneHipodromo: boolean;
  archivoOrigen?: string;
};

export type CarreraValidable = CarreraRegistro | CarreraExtraida;

function obtenerEjemplares(c: CarreraValidable): Array<{
  numero?: string | number;
  nombre?: string;
  jockey?: string;
  peso?: string | number;
  valor?: number | string;
}> {
  const ej = (c as CarreraRegistro).ejemplares || (c as CarreraRegistro).caballos || (c as CarreraExtraida).ejemplares;
  return Array.isArray(ej) ? ej : [];
}

/**
 * Valida una carrera individual para comprobar que no omita datos esenciales
 * (secuencia de números de caballos, nombres, distancia, etc.).
 */
export function validarCarrera(carrera: CarreraValidable): DiagnosticoCarrera {
  const incidencias: IncidenciaCarrera[] = [];
  const ejemplares = obtenerEjemplares(carrera);
  const totalCaballos = ejemplares.length;
  const archivoOrigen = (carrera as CarreraRegistro).archivoOrigen || undefined;

  const numCarrera = numeroDeCarrera(carrera.carrera);
  if (numCarrera == null) {
    incidencias.push({
      tipo: "error",
      campo: "carrera",
      mensaje: "Número de carrera ausente o no reconocido.",
    });
  }

  const hipodromo = String(carrera.hipodromo || "").trim();
  const tieneHipodromo = hipodromo.length > 0;
  if (!tieneHipodromo) {
    incidencias.push({
      tipo: "advertencia",
      campo: "hipodromo",
      mensaje: "Falta el nombre del hipódromo.",
    });
  }

  const distNum = Number(carrera.distancia);
  const tieneDistancia = Number.isFinite(distNum) && distNum > 0;
  if (!tieneDistancia) {
    incidencias.push({
      tipo: "advertencia",
      campo: "distancia",
      mensaje: "Distancia no especificada o en 0 metros.",
    });
  }

  if (totalCaballos === 0) {
    incidencias.push({
      tipo: "error",
      campo: "ejemplares",
      mensaje: "No se detectaron ejemplares participantes en esta carrera.",
    });
  } else if (totalCaballos === 1) {
    incidencias.push({
      tipo: "advertencia",
      campo: "ejemplares",
      mensaje: "Solo se detectó 1 ejemplar (las carreras oficiales poseen 2 o más participantes).",
    });
  }

  // Análisis detallado de los ejemplares
  const numerosPresentes: number[] = [];
  const numerosDuplicados: number[] = [];
  const setNumeros = new Set<number>();
  const caballosSinNombre: Array<string | number> = [];
  let sinJockeyCount = 0;

  ejemplares.forEach((ej, idx) => {
    const rawNum = ej.numero;
    const numInt = parseInt(String(rawNum ?? "").replace(/\D/g, ""), 10);
    const posVisual = rawNum ?? idx + 1;

    if (!Number.isNaN(numInt) && numInt > 0) {
      if (setNumeros.has(numInt)) {
        numerosDuplicados.push(numInt);
      } else {
        setNumeros.add(numInt);
        numerosPresentes.push(numInt);
      }
    }

    const nombreLimpio = String(ej.nombre || "").trim();
    if (
      !nombreLimpio ||
      /^(sin nombre|ejemplar|caballo|\?|-|\.)$/i.test(nombreLimpio)
    ) {
      caballosSinNombre.push(posVisual);
    }

    if (!String(ej.jockey || "").trim()) {
      sinJockeyCount++;
    }
  });

  if (numerosDuplicados.length > 0) {
    incidencias.push({
      tipo: "error",
      campo: "numeros",
      mensaje: `Números de ejemplar duplicados: #${[...new Set(numerosDuplicados)].join(", #")}`,
    });
  }

  if (caballosSinNombre.length > 0) {
    incidencias.push({
      tipo: "error",
      campo: "nombres",
      mensaje: `Ejemplares sin nombre registrado: #${caballosSinNombre.join(", #")}`,
    });
  }

  // Detección de huecos en la secuencia de caballos (ej: caballos 1, 2, 4 -> falta el #3)
  const caballosFaltantes: number[] = [];
  if (numerosPresentes.length >= 2) {
    numerosPresentes.sort((a, b) => a - b);
    const min = numerosPresentes[0];
    const max = numerosPresentes[numerosPresentes.length - 1];

    // Si la secuencia empieza en 1 o 2 y tiene un rango razonable (≤ 24)
    if (min <= 2 && max <= 24) {
      for (let n = 1; n <= max; n++) {
        if (!setNumeros.has(n)) {
          caballosFaltantes.push(n);
        }
      }
    }
  }

  if (caballosFaltantes.length > 0) {
    incidencias.push({
      tipo: "advertencia",
      campo: "secuencia_caballos",
      mensaje: `Posible omisión de participantes: no se detectó el ejemplar #${caballosFaltantes.join(", #")}`,
    });
  }

  if (totalCaballos >= 4 && sinJockeyCount === totalCaballos) {
    incidencias.push({
      tipo: "advertencia",
      campo: "jockeys",
      mensaje: "Ningún ejemplar tiene jinete/jockey asignado.",
    });
  }

  const tieneErrores = incidencias.some((i) => i.tipo === "error");
  const tieneAdvertencias = incidencias.some((i) => i.tipo === "advertencia");

  let nivel: "completa" | "advertencia" | "incompleta" = "completa";
  if (tieneErrores) {
    nivel = "incompleta";
  } else if (tieneAdvertencias) {
    nivel = "advertencia";
  }

  return {
    esValida: !tieneErrores,
    esCompleta: !tieneErrores && !tieneAdvertencias,
    nivel,
    incidencias,
    totalCaballos,
    caballosNumeros: numerosPresentes,
    caballosFaltantes,
    numerosDuplicados: [...new Set(numerosDuplicados)],
    caballosSinNombre,
    tieneDistancia,
    tieneHipodromo,
    archivoOrigen,
  };
}

export type DesgloseArchivo = {
  archivo: string;
  totalCarreras: number;
  totalCaballos: number;
  carreras: Array<{
    carrera: number | string;
    totalCaballos: number;
    diagnostico: DiagnosticoCarrera;
  }>;
};

export type ReporteValidacionLote = {
  totalArchivos: number;
  totalCarreras: number;
  totalCaballos: number;
  carrerasCompletas: number;
  carrerasConAdvertencia: number;
  carrerasIncompletas: number;
  carrerasFaltantesSecuencia: Array<{ hipodromo: string; faltan: number[] }>;
  desglosePorArchivo: DesgloseArchivo[];
  diagnosticos: Map<string, DiagnosticoCarrera>;
};

/**
 * Valida un conjunto de carreras agrupándolas por archivo de origen si existe,
 * calculando el estado general de integridad de la importación.
 */
export function validarLoteCarreras(
  carreras: CarreraValidable[],
  nombresArchivosConocidos: string[] = []
): ReporteValidacionLote {
  const diagnosticos = new Map<string, DiagnosticoCarrera>();
  let totalCaballos = 0;
  let carrerasCompletas = 0;
  let carrerasConAdvertencia = 0;
  let carrerasIncompletas = 0;

  const gruposPorArchivo = new Map<string, CarreraValidable[]>();

  // Si se conocen nombres de archivos pero ninguna carrera los tiene aún asignados,
  // se distribuyen o se registra el contenedor
  const archivoPorDefecto = nombresArchivosConocidos.length === 1 ? nombresArchivosConocidos[0] : "Documento Principal";

  carreras.forEach((c, idx) => {
    const diag = validarCarrera(c);
    const key = `${String(c.hipodromo || "")}|${String(c.carrera || idx + 1)}`;
    diagnosticos.set(key, diag);

    totalCaballos += diag.totalCaballos;
    if (diag.nivel === "completa") carrerasCompletas++;
    else if (diag.nivel === "advertencia") carrerasConAdvertencia++;
    else carrerasIncompletas++;

    const nombreArchivo = (c as CarreraRegistro).archivoOrigen || diag.archivoOrigen || archivoPorDefecto;
    const lista = gruposPorArchivo.get(nombreArchivo) || [];
    lista.push(c);
    gruposPorArchivo.set(nombreArchivo, lista);
  });

  // Asegurar que archivos conocidos sin carreras también aparezcan
  for (const nombre of nombresArchivosConocidos) {
    if (!gruposPorArchivo.has(nombre)) {
      gruposPorArchivo.set(nombre, []);
    }
  }

  const desglosePorArchivo: DesgloseArchivo[] = [];
  for (const [archivo, lista] of gruposPorArchivo.entries()) {
    let caballosArchivo = 0;
    const desgloseCarreras = lista.map((c, i) => {
      const key = `${String(c.hipodromo || "")}|${String(c.carrera || i + 1)}`;
      const diag = diagnosticos.get(key) || validarCarrera(c);
      caballosArchivo += diag.totalCaballos;
      return {
        carrera: c.carrera ?? i + 1,
        totalCaballos: diag.totalCaballos,
        diagnostico: diag,
      };
    });

    desglosePorArchivo.push({
      archivo,
      totalCarreras: lista.length,
      totalCaballos: caballosArchivo,
      carreras: desgloseCarreras,
    });
  }

  // Secuencia de carreras (por ejemplo carreras 1..10 de un hipódromo)
  const porHipodromo = new Map<string, Set<number>>();
  for (const c of carreras) {
    const num = numeroDeCarrera(c.carrera);
    if (num != null) {
      const h = String(c.hipodromo || "GENERAL").trim().toUpperCase();
      const s = porHipodromo.get(h) || new Set<number>();
      s.add(num);
      porHipodromo.set(h, s);
    }
  }

  const carrerasFaltantesSecuencia: Array<{ hipodromo: string; faltan: number[] }> = [];
  for (const [hipo, setNums] of porHipodromo) {
    const arr = [...setNums].sort((a, b) => a - b);
    if (arr.length > 1) {
      const max = arr[arr.length - 1];
      const faltan: number[] = [];
      for (let n = 1; n <= max; n++) {
        if (!setNums.has(n)) faltan.push(n);
      }
      if (faltan.length > 0) {
        carrerasFaltantesSecuencia.push({ hipodromo: hipo, faltan });
      }
    }
  }

  return {
    totalArchivos: desglosePorArchivo.length,
    totalCarreras: carreras.length,
    totalCaballos,
    carrerasCompletas,
    carrerasConAdvertencia,
    carrerasIncompletas,
    carrerasFaltantesSecuencia,
    desglosePorArchivo,
    diagnosticos,
  };
}

/**
 * Genera el texto estructurado para mensajería (WhatsApp, Telegram, Operadores)
 * informando la cantidad total de archivos, cuántas carreras por archivo y
 * cuántos caballos por carrera.
 */
export function generarMensajeResumenImportacion(
  reporte: ReporteValidacionLote,
  fechaJornada: string,
  hipodromosStr = ""
): string {
  const lineas: string[] = [];

  lineas.push("🏇 *REPORTE DE IMPORTACIÓN GACETA IA*");
  lineas.push(`📅 *Fecha de Jornada:* ${fechaJornada || "No especificada"}`);
  if (hipodromosStr) {
    lineas.push(`📍 *Hipódromo(s):* ${hipodromosStr}`);
  }
  lineas.push(
    `📁 *Total Archivos:* ${reporte.totalArchivos} | 🏁 *Total Carreras:* ${reporte.totalCarreras} | 🐴 *Total Caballos:* ${reporte.totalCaballos}`
  );
  lineas.push("----------------------------------------------");

  reporte.desglosePorArchivo.forEach((arch, idx) => {
    lineas.push(`📂 *Archivo ${idx + 1}: ${arch.archivo}*`);
    lineas.push(`   📊 Subtotal: ${arch.totalCarreras} carrera(s) · ${arch.totalCaballos} ejemplar(es)`);

    if (arch.carreras.length === 0) {
      lineas.push("   ⚠️ _(No se extrajeron carreras de este archivo)_");
    } else {
      arch.carreras.forEach((c) => {
        const d = c.diagnostico;
        const icono = d.nivel === "completa" ? "✅" : d.nivel === "advertencia" ? "⚠️" : "❌";
        const notas = d.incidencias.length > 0 ? ` (${d.incidencias.map((i) => i.mensaje).join("; ")})` : "";
        lineas.push(`   • Carrera ${c.carrera}: ${c.totalCaballos} caballos ${icono}${notas}`);
      });
    }
    lineas.push("");
  });

  lineas.push("----------------------------------------------");
  lineas.push("🔍 *Estado de Verificación e Integridad:*");
  lineas.push(`  ✅ Completas sin observaciones: ${reporte.carrerasCompletas}`);
  if (reporte.carrerasConAdvertencia > 0) {
    lineas.push(`  ⚠️ Con advertencias / datos a revisar: ${reporte.carrerasConAdvertencia}`);
  }
  if (reporte.carrerasIncompletas > 0) {
    lineas.push(`  ❌ Incompletas (faltan ejemplares o nombres): ${reporte.carrerasIncompletas}`);
  }

  if (reporte.carrerasFaltantesSecuencia.length > 0) {
    lineas.push("");
    lineas.push("⚠️ *Aviso de Carreras Faltantes en Secuencia:*");
    reporte.carrerasFaltantesSecuencia.forEach((f) => {
      lineas.push(`  • ${f.hipodromo}: Faltan carreras [${f.faltan.join(", ")}]`);
    });
  }

  lineas.push("");
  lineas.push("ℹ️ _Generado automáticamente por el Sistema Hípico Inteligente._");

  return lineas.join("\n");
}

/**
 * Genera el mensaje / instrucción puntual para indicarle al Agente IA (o al operador)
 * que debe volver a verificar esa carrera o gaceta en particular debido a datos incompletos.
 */
export function generarMensajeParaAgenteIA(
  carrera: CarreraValidable,
  diag: DiagnosticoCarrera,
  fechaJornada = ""
): string {
  const hipo = String(carrera.hipodromo || "Hipódromo Desconocido").toUpperCase();
  const cNum = carrera.carrera ?? "N/A";
  const arch = diag.archivoOrigen || (carrera as CarreraRegistro).archivoOrigen || "Gaceta cargada";

  const lineas: string[] = [];
  lineas.push("🤖 *SOLICITUD DE RE-VERIFICACIÓN PARA AGENTE IA*");
  lineas.push(`📍 *Hipódromo:* ${hipo}`);
  lineas.push(`🏁 *Carrera:* Carrera ${cNum}`);
  if (fechaJornada) lineas.push(`📅 *Fecha:* ${fechaJornada}`);
  lineas.push(`📁 *Archivo / Gaceta de Origen:* ${arch}`);
  lineas.push(`🐴 *Ejemplares detectados actualmente:* ${diag.totalCaballos}`);
  lineas.push("");
  lineas.push("🚨 *DISCREPANCIAS Y DATOS FALTANTES DETECTADOS:*");

  diag.incidencias.forEach((inc) => {
    lineas.push(` • [${inc.tipo.toUpperCase()}] ${inc.mensaje}`);
  });

  if (diag.caballosFaltantes.length > 0) {
    lineas.push(` • ⚠️ Se omitieron los números de ejemplar: #${diag.caballosFaltantes.join(", #")}`);
  }

  lineas.push("");
  lineas.push("📋 *INSTRUCCIÓN EXACTA PARA EL AGENTE:*");
  lineas.push(
    `"Favor volver a leer minuciosamente el archivo '${arch}' específicamente para la Carrera ${cNum} de ${hipo}. Asegurar la transcripción de TODOS los ejemplares participantes sin omitir ninguno, verificando número de partidor, nombre exacto, jinete, entrenador, peso y distancia. Corregir los datos señalados anteriormente."`
  );

  return lineas.join("\n");
}
