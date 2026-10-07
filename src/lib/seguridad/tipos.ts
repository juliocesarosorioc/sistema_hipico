/** Tipos del módulo de seguridad (control de acceso por tipo de usuario). */

/** Qué clase de cosa es una capacidad dentro del esquema del sistema. */
export type TipoCapacidad = "ruta" | "boton" | "modal" | "celda" | "campo" | "funcion";

/**
 * Gravedad de una capacidad. Orden de riesgo ascendente: primero se protegió lo
 * que solo lee, después lo que escribe, y encima lo que mueve dinero o borra.
 */
export type Riesgo = "lectura" | "escritura" | "critico";

/** Una capacidad registrada en el maestro. `clave` es el identificador estable. */
export type Capacidad = {
  /** Identificador estable y único. Ej. "contabilidad:btn_eliminar_banco". */
  clave: string;
  /** Módulo al que pertenece. */
  modulo: string;
  tipo: TipoCapacidad;
  /** Texto que ve el operador en el maestro. */
  titulo: string;
  descripcion: string;
  riesgo: Riesgo;
  /** Trazabilidad al código: "ruta/archivo:línea". La usa la auditoría. */
  fuente: string;
  /** Ruta web cuando la capacidad corresponde a una pantalla. */
  ruta?: string;
  /** Capacidades que además hacen falta (se exige TODAS). */
  requiere?: string[];
};

/** Un módulo del sistema con su inventario completo. */
export type ModuloEsquema = {
  clave: string;
  nombre: string;
  ruta: string;
  icono: string;
  descripcion: string;
  capacidades: Capacidad[];
};

/**
 * Decisión sobre una capacidad para un sujeto concreto. Es tri-estado a
 * propósito: "heredado" deja que resuelva la base del tipo de usuario.
 */
export type Decision = "permitido" | "denegado" | "heredado";

/**
 * Un tipo de usuario (rol). Es la base genérica que se le aplica a todos los
 * usuarios de ese tipo; después cada usuario puede tener excepciones.
 */
export type TipoUsuario = {
  id: number | string;
  nombre: string;
  descripcion?: string;
  /** Si está inactivo, deja de asignarse a usuarios nuevos. */
  activo?: boolean;
  /** Capacidades propias del tipo. Fuente: `perfil_permisos`. */
  capacidades: string[];
  /** Si es un tipo del sistema, se puede cambiar pero no borrar. */
  sistema?: boolean;
};

/** Permiso heredado del modelo anterior. Se mantiene por compatibilidad. */
export type Permiso = {
  id: number | string;
  clave: string;
  modulo: string;
  descripcion: string;
};

export type Perfil = {
  id: number | string;
  nombre: string;
  descripcion?: string;
};

export type UsuarioSistema = {
  id: string | number;
  email?: string | null;
  nombre?: string | null;
  perfiles: string[];
};

/** Excepciones individuales de un usuario por encima de la base de su tipo. */
export type ExcepcionUsuario = Record<string, Decision>;

/** Resultado del guardado de accesos (por tipo de usuario o por usuario). */
export type ResGuardarAccesos = { ok: boolean; error?: string };
