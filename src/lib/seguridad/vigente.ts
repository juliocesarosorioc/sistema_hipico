/**
 * Accesos VIGENTES de la sesión, en un módulo aparte del store.
 *
 * Por qué existe: `Guard` (React) ya consulta `useAuthStore`, pero las
 * funciones de escritura de `src/lib/*` no son componentes y no pueden usar
 * hooks. Antes de este archivo, esas funciones NO comprobaban nada: el botón
 * estaba oculto y la operación se ejecutaba igual si se llamaba desde la
 * consola del navegador con la llave anon.
 *
 * Por qué NO importa el store: `useAuthStore` ya importa este módulo (para
 * publicar la resolución) y `accesos.ts` también lo importaría (para proteger
 * la escritura de matrices). Si este archivo importara el store, el ciclo
 * `store -> accesos -> vigente -> store` dejararia `tieneCapacidad` en
 * `undefined` en tiempo de carga. Se invierte el sentido: el store ESCRIBE
 * acá, y los demás solo LEEN.
 *
 * Esto NO reemplaza a la base. Es defensa en profundidad en el cliente: la
 * frontera real sigue siendo `auth.uid()` + RLS en src/db/seguridad_maestro.sql.
 */

import {
  exigirContexto,
  permiteConContexto,
  type ContextoAbac,
} from "@/lib/seguridad/abac";

/** Capacidades de la sesión resuelta. Vacío = nadie conectado todavía. */
let permisos = new Set<string>();
let esPrincipal = false;
let usuario = "";
/** Tipo de usuario de la sesión, para las reglas ABAC con ámbito `tipo:*`. */
let tipoUsuario = "";
/** Atributos del usuario (hipódromos asignados, etc.), para el ABAC. */
let atributos: Record<string, unknown> = {};

/** Se llama cada vez que la sesión se resuelve (login, arranque, recarga). */
export function setAccesosVigentes(nuevos: {
  permisos: Iterable<string>;
  esPrincipal: boolean;
  usuario: string;
  tipoUsuario?: string;
  atributos?: Record<string, unknown>;
}): void {
  permisos = new Set(nuevos.permisos);
  esPrincipal = nuevos.esPrincipal;
  usuario = nuevos.usuario;
  tipoUsuario = nuevos.tipoUsuario ?? "";
  atributos = nuevos.atributos ?? {};
}

/** Se llama al cerrar sesión: sin sesión no hay ni una capacidad. */
export function limpiarAccesosVigentes(): void {
  permisos = new Set();
  esPrincipal = false;
  usuario = "";
  tipoUsuario = "";
  atributos = {};
}

/** Identificador de la sesión vigente ("" si no hay). */
export function usuarioVigente(): string {
  return usuario;
}

/**
 * ¿La sesión vigente es el usuario principal?
 *
 * Existe para las operaciones que NO son una capacidad del RBAC sino una
 * atribución personal del dueño (ver `resolucion.total`). Ocultar el control en
 * la pantalla no alcanza: la función de escritura es llamable desde la consola
 * con la misma llave, así que el filtro va del lado de los datos.
 */
export function esPrincipalVigente(): boolean {
  return esPrincipal;
}

/** true si la sesión puede ejecutar la capacidad. Sin sesión, false. */
export function tieneCapacidad(...claves: string[]): boolean {
  if (esPrincipal) return true;
  if (permisos.size === 0) return false;
  return claves.every((c) => permisos.has(c));
}

/** Opciones ABAC de la sesión vigente, para no repetirlas en cada llamada. */
function opcionesAbac(): { tipoUsuario: string; esPrincipal: boolean } {
  return { tipoUsuario, esPrincipal };
}

/**
 * true si la capacidad pasa el RBAC Y el ABAC de este contexto.
 *
 * El contexto es el del REGISTRO sobre el que se opera, no el de la pantalla:
 * `{ estado, monto, hipodromo }` del ticket que se está resolviendo. Los
 * atributos del usuario se mezclan por DEBAJO de los del registro: el
 * `usuario_hipodromos` sale de la sesión, no de lo que mande la UI.
 */
export function puedeConContexto(capacidad: string, contexto: ContextoAbac = {}): boolean {
  if (!tieneCapacidad(capacidad)) return false;
  return permiteConContexto(capacidad, { ...atributos, ...contexto }, opcionesAbac());
}

/** Lanza si la sesión NO puede ejecutar la capacidad. Devuelve el módulo. */
export class ErrorPermiso extends Error {
  readonly capacidad: string;
  constructor(capacidad: string) {
    super(
      `Permiso denegado: ${capacidad}` +
        (usuario ? ` (sesión: ${usuario})` : " (sin sesión)") +
        ". La operación no se ejecutó."
    );
    this.name = "ErrorPermiso";
    this.capacidad = capacidad;
  }
}

/**
 * Puerta de las funciones de escritura. Se llama AL PRINCIPIO de la operación,
 * antes de tocar Supabase, no después de validar el formulario.
 *
 *   export async function eliminarCliente(id) {
 *     exigirCapacidad("clientes:fn_eliminar_cliente");
 *     ...
 *   }
 */
export function exigirCapacidad(capacidad: string): void {
  if (tieneCapacidad(capacidad)) return;
  throw new ErrorPermiso(capacidad);
}

/**
 * Puerta de escritura COMPLETA: primero el permiso (RBAC), después los
 * atributos del registro (ABAC).
 *
 * El orden importa. Invertido, `exigirContexto` daría el error de atributo a
 * alguien que ni permiso tiene, y el mensaje insinuaría que el problema es el
 * registro cuando en realidad es la sesión.
 *
 *   export async function resolverTicket(id, d) {
 *     const t = await leer(id);
 *     exigirPermiso("tickets:fn_anular_ticket", { estado: t.estado, accion: d.accion });
 *     ...
 *   }
 */
export function exigirPermiso(capacidad: string, contexto: ContextoAbac = {}): void {
  if (!tieneCapacidad(capacidad)) throw new ErrorPermiso(capacidad);
  exigirContexto(capacidad, { ...atributos, ...contexto }, opcionesAbac());
}
