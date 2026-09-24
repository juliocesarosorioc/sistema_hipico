/** Tipos del módulo RBAC (Control de Acceso Basado en Roles). */

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

/** Resultado del guardado de accesos (por perfil o usuario). */
export type ResGuardarAccesos = { ok: boolean; error?: string };