/**
 * ============================================================================
 * RESOLUCIÓN DE ACCESOS — "quién puede hacer qué"
 * ============================================================================
 *
 * Es lógica PURA (sin Supabase ni React) para poder testearla y para que el
 * maestro y los guards consulten exactamente lo mismo.
 *
 * ORDEN DE PRECEDENCIA (de mayor a menor):
 *
 *   1. USUARIO PRINCIPAL   → acceso TOTAL. No consulta nada más.
 *   2. EXCEPCIÓN INDIVIDUAL → si el usuario tiene una decisión explícita
 *                            ("permitido"/"denegado") para esa capacidad, manda
 *                            esa, aunque el tipo se la niegue o se la conceda.
 *   3. BASE DEL TIPO       → lo que el tipo de usuario tiene en su matriz.
 *   4. NEGADO POR OMISIÓN  → si nadie lo concedió, NO se concede.
 *
 * El paso 4 es el que cierra el "todo permitido por omisión" que había antes:
 * una capacidad que no está en ninguna matriz simplemente no se ve.
 */

import { CAPACIDADES, CAPACIDADES_POR_CLAVE } from "@/lib/seguridad/capacidades";
import type { Decision, ExcepcionUsuario, TipoUsuario } from "@/lib/seguridad/tipos";

/**
 * Usuario principal de la plataforma. Tiene acceso total a botones, modales,
 * casillas y campos sin importar qué diga la matriz, para que un error de
 * configuración no pueda dejar fuera al dueño del sistema.
 *
 * Se compara contra el identificador con el que se inicia sesión, tolerando el
 * correo: "josorioc", "josorioc@sistemahipico.local" y "Josorioc" son el mismo.
 */
export const USUARIO_PRINCIPAL = "josorioc";

/** ¿Este identificador es el usuario principal? */
export function esUsuarioPrincipal(identificador: string | null | undefined): boolean {
  const id = (identificador ?? "").trim().toLowerCase();
  if (!id) return false;
  const sinDominio = id.split("@")[0];
  return id === USUARIO_PRINCIPAL || sinDominio === USUARIO_PRINCIPAL;
}

export type Entrada = {
  /** Identificador con el que se inició sesión. */
  identificador?: string | null;
  /** Tipo de usuario asignado, con su base de capacidades. */
  tipo?: TipoUsuario | null;
  /** Excepciones individuales por encima del tipo. */
  excepciones?: ExcepcionUsuario;
};

export type Resolucion = {
  /** true si la última decisión fue "todo permitido" (usuario principal). */
  total: boolean;
  /** Set final de capacidades permitidas, ya resueltas. */
  permitidas: Set<string>;
  /** Por qué se concedieron o negaron, para explicarlo en el maestro. */
  origen: Map<string, Decision | "principal">;
  /** Función de consulta, ya lista para los guards. */
  puede: (clave: string) => boolean;
};

/** Devuelve la decisión EXPRESA de una capacidad, o null si se hereda. */
function decisionExpresa(excepciones: ExcepcionUsuario, clave: string): Decision | null {
  const d = excepciones?.[clave];
  return d === "permitido" || d === "denegado" ? d : null;
}

/**
 * Resuelve el acceso efectivo. `requiere` se resuelve en cascada: si una
 * capacidad exige otra que está denegada, la primera también queda denegada.
 * Se evalúa conMemo para no ciclar cuando el requisito forma un anillo.
 */
export function resolverAccesos(entrada: Entrada): Resolucion {
  const permitidas = new Set<string>();
  const origen = new Map<string, Decision | "principal">();

  // 1. Usuario principal: acceso total, sin mirar la matriz.
  if (esUsuarioPrincipal(entrada.identificador)) {
    for (const clave of CAPACIDADES_POR_CLAVE.keys()) {
      permitidas.add(clave);
      origen.set(clave, "principal");
    }
    return { total: true, permitidas, origen, puede: (k) => permitidas.has(k) };
  }

  const base = new Set(entrada.tipo?.capacidades ?? []);
  const excepciones = entrada.excepciones ?? {};

  const decidido = new Map<string, Decision>();
  const enCurso = new Set<string>();

  const evaluar = (clave: string): Decision => {
    const ya = decidido.get(clave);
    if (ya) return ya;
    if (enCurso.has(clave)) return "denegado"; // anillo de requisitos: se corta
    enCurso.add(clave);

    // 2. Excepción individual.
    const propia = decisionExpresa(excepciones, clave);
    let decision: Decision;
    if (propia) {
      decision = propia;
    } else {
      // 3. Base del tipo.
      decision = base.has(clave) ? "permitido" : "denegado";
    }

    // Requisitos: si exige algo denegado, no se concede.
    if (decision === "permitido") {
      const cap = CAPACIDADES_POR_CLAVE.get(clave);
      for (const req of cap?.requiere ?? []) {
        if (evaluar(req) !== "permitido") {
          decision = "denegado";
          break;
        }
      }
    }

    enCurso.delete(clave);
    decidido.set(clave, decision);
    return decision;
  };

  /** Etiqueta de por qué una capacidad quedó como quedó (la muestra el maestro). */
  const motivoDe = (clave: string): Decision | "principal" => {
    const e = decisionExpresa(excepciones, clave);
    if (e) return e;
    return base.has(clave) ? "heredado" : "denegado";
  };

  for (const clave of CAPACIDADES_POR_CLAVE.keys()) {
    if (evaluar(clave) === "permitido") {
      permitidas.add(clave);
      origen.set(clave, motivoDe(clave));
    }
  }

  return { total: false, permitidas, origen, puede: (k) => permitidas.has(k) };
}

/**
 * Capacidades de un tipo de usuario, ya expandidas con sus requisitos. Sirve
 * para mostrar en la matriz "lo que tiene" sin surprises por `requiere`.
 */
export function expandirConRequisitos(claves: Iterable<string>): Set<string> {
  const salida = new Set<string>();
  const pendientes = [...claves];
  while (pendientes.length) {
    const clave = pendientes.pop()!;
    if (salida.has(clave)) continue;
    salida.add(clave);
    for (const req of CAPACIDADES_POR_CLAVE.get(clave)?.requiere ?? []) {
      if (!salida.has(req)) pendientes.push(req);
    }
  }
  return salida;
}

/** Tipos de usuario del sistema, con su base genérica de capacidades. */
export const TIPOS_USUARIO_SISTEMA: Array<{ nombre: string; descripcion: string }> = [
  { nombre: "admin", descripcion: "Administrador. Acceso total a todo el sistema." },
  { nombre: "operador", descripcion: "Opera la taquilla, las tablas y las jugadas del día." },
  { nombre: "consulta", descripcion: "Solo lectura. Puede ver y consultar, nunca escribir." },
  { nombre: "jugador", descripcion: "Usuario que juega. Acceso acotado a jugar y a su información." },
];

/**
 * Base genérica de cada tipo. Se usa como punto de partida cuando se crea el
 * tipo por primera vez; después la manda la matriz guardada en la BD.
 */
export function baseDeTipo(nombre: string): string[] {
  const n = (nombre ?? "").toLowerCase();
  const todas = [...CAPACIDADES_POR_CLAVE.keys()];
  /**
   * Todo lo que se puede VER sin escribir: la pantalla y las celdas de lectura.
   * Se filtra SOLO por `riesgo === "lectura"`, no por `tipo === "ruta"`: entrar
   * al módulo de Seguridad es una ruta, pero es CRÍTICA porque desde ahí se
   * concede o quita el acceso de todos. Filtrar por tipo le abría el maestro a
   * un rol de solo lectura.
   */
  const lecturaDe = (...modulos: string[]) =>
    CAPACIDADES.filter((x) => modulos.includes(x.modulo) && x.riesgo === "lectura").map((x) => x.clave);

  /**
   * Las escrituras (`tipo === "funcion"`) de los módulos operativos.
   *
   * Tiene que ir pegada a `lecturaDe`: si el operador ve el módulo y sus
   * botones de escribir, pero no tiene las `fn_*` de ese módulo, entonces los
   * botones le aparecen habilitados y `exigirCapacidad()` le rebota la
   * escritura. Eso es peor que no proteger: el sistema se ve roto.
   *
   * Se excluyen a mano `contabilidad` y `seguridad`: el dinero y el maestro se
   * los deja solo al admin, aunque un operador pueda verlos.
   *
   * `grupos:campo_asignar_grupo` tampoco entra: es de tipo "campo", así que el
   * filtro por `funcion` ya lo deja fuera. Asignar un cliente a un grupo cambia
   * el precio de todas sus jugadas, y es una decisión del dueño del negocio,
   * no del operador de taquilla.
   */
  const MODULOS_OPERATIVOS = [
    "clientes", "grupos", "carreras", "hipodromos", "gestion_jugadas",
    "tablas", "taquilla", "tickets", "ejemplares", "marcas", "dupleta",
    "remates", "pollas",
  ] as const;

  /**
   * Lo que el operador de Pollas NO recibe por tipo.
   *
   * Cobrar una venta es lo mismo que cobrar en Taquilla y el operador lo hace. Pero
   * `fn_liquidar_polla` reparte premios y paga el acumulado: es plata que sale de
   * la caja, y queda en manos del admin. Sin esta resta, el operador tendría la
   * capacidad y el botón habilitado, y podría pagarse a sí mismo un acumulado.
   */
  const POLLAS_SOLO_ADMIN = ["pollas:fn_liquidar_polla", "pollas:btn_liquidar"];

  const escrituraDe = (...modulos: string[]) =>
    CAPACIDADES.filter(
      (x) => modulos.includes(x.modulo) && x.tipo === "funcion" && x.modulo !== "contabilidad" && x.modulo !== "seguridad"
    )
      .map((x) => x.clave)
      .filter((k) => !POLLAS_SOLO_ADMIN.includes(k));

  if (n.includes("admin")) return todas;
  if (n.includes("operador") || n.includes("taqui")) {
    return [
      ...lecturaDe("general", "clientes", "grupos", "carreras", "gestion_jugadas", "tablas", "taquilla", "tickets", "ejemplares", "marcas", "dupleta", "remates", "pollas"),
      ...escrituraDe(...MODULOS_OPERATIVOS),
      "clientes:celda_acciones",
      "tickets:btn_tomar",
      "gestion_jugadas:btn_cargar",
      "gestion_jugadas:btn_editar_jugada",
      "gestion_jugadas:btn_cargar_resultados",
      "gestion_jugadas:btn_liquidar",
      "gestion_jugadas:modal_finalizar",
      "tablas:btn_publicar",
      "tablas:btn_editar",
      "tablas:btn_vender",
      "tablas:btn_imprimir",
      "tablas:modal_venta",
      "tablas:modal_cuadro",
      "taquilla:btn_registrar_jugada",
      "marcas:btn_editar_marcas",
      "marcas:btn_marcar_debutantes",
      "pollas:btn_crear_polla",
      "pollas:btn_registrar_venta",
    ];
  }
  if (n.includes("consulta") || n.includes("audit")) {
    return lecturaDe(
      "general", "clientes", "grupos", "carreras", "gestion_jugadas", "tablas", "taquilla",
      "tickets", "ejemplares", "marcas", "dupleta", "contabilidad", "seguridad", "hipodromos",
      "whatsapp", "portal", "remates", "pollas"
    );
  }
  if (n.includes("jugador") || n.includes("cliente")) {
    return [...lecturaDe("general", "portal", "carreras"), "portal:btn_jugar", "portal:celda_saldo_portal"];
  }
  return lecturaDe("general");
}
