/**
 * Encabezados institucionales con identidad de grupo.
 * Capa pura de presentación: sin Supabase, sin efectos secundarios y reutilizable por el
 * demonio Baileys ( réplica en JS ) y por el servidor Next.
 */

export type ContextoEncabezadoGrupo =
  | "plano"
  | "resultado"
  | "apertura"
  | "cierre"
  | "concrecion"
  | "propuesta";

export const ENCABEZADO_INSTITUCIONAL = "🏇🏻Administración Hípica🏇🏻";

const CONECTORES_GRUPO: Record<ContextoEncabezadoGrupo, string> = {
  plano: "comparte el plano oficial de jugadas",
  resultado: "informa el resultado y la liquidación oficial",
  apertura: "da la bienvenida a la carrera",
  cierre: "informa que la carrera quedó cerrada",
  concrecion: "confirma una jugada pactada",
  propuesta: "comparte una propuesta en vivo",
};

/** Resuelve el nombre del grupo desde cualquier variante del objeto `sala`. */
export function nombreGrupoMensaje(sala?: any): string {
  const candidatos = [
    sala?.grupo_nombre,
    sala?.nombre_grupo,
    sala?.whatsapp_group_nombre,
    sala?.grupo?.nombre,
    sala?.nombre_sala,
    sala?.nombre,
  ];
  for (const valor of candidatos) {
    const nombre = String(valor ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (nombre) return nombre.toUpperCase();
  }
  return "PRINCIPAL";
}

/** Conector gramatical correcto para el contexto del mensaje. */
export function conectorGrupo(contexto: ContextoEncabezadoGrupo): string {
  return CONECTORES_GRUPO[contexto] || CONECTORES_GRUPO.plano;
}

/** `Administración Hípica` + `TU Grupo "X" te ...:` listo para anteponer al mensaje. */
export function encabezadoGrupo(sala: any, contexto: ContextoEncabezadoGrupo): string {
  if (contexto === "resultado") {
    return (
      `*🏆 RESULTADO Y LIQUIDACIÓN OFICIAL🏆*\n` +
      `*${ENCABEZADO_INSTITUCIONAL}*\n` +
      `Grupo "${nombreGrupoMensaje(sala)}" :`
    );
  }

  return (
    `${ENCABEZADO_INSTITUCIONAL}\n` +
    `TU Grupo "${nombreGrupoMensaje(sala)}" te ${conectorGrupo(contexto)}:`
  );
}
