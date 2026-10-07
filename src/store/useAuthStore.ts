"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  cerrarSesion as cerrarSesionSupabase,
  conTimeout,
  iniciarSesion as login,
  sesionActual,
  TIMEOUT_SESION_MS,
} from "@/lib/auth/sesion";
import { esUsuarioPrincipal, resolverAccesos, USUARIO_PRINCIPAL } from "@/lib/seguridad/resolver";
import { atributosDeUsuario, claveDeUsuario, leerTipoDeUsuario, permisosIndividuales } from "@/lib/seguridad/accesos";
import { limpiarAccesosVigentes, setAccesosVigentes } from "@/lib/seguridad/vigente";
import type { ExcepcionUsuario, TipoUsuario } from "@/lib/seguridad/tipos";

const CLAVE_PERFIL = "hipico_perfil";
const CLAVE_PERMISOS = "hipico_permisos";
const CLAVE_USUARIO = "hipico_usuario";
const CLAVE_ACCESO = "hipico_acceso";

/**
 * Red de seguridad del arranque. De que `inicializada` llegue a `true` depende
 * que el login aparezca; pero una promesa que no termina (un fetch colgado, un
 * socket que nunca cierra) no dispara el `finally`, y el estado se queda en
 * false para siempre: el botón queda en "Verificando sesión..." para siempre y
 * no se puede escribir nada.
 *
 * El corte es de RED, no de lógica: si la respuesta llegó y fue mala, cada
 * consulta ya trae su propio `conTimeout` y esta carrera ni se entera. Acá solo
 * se corta lo que no volvió nunca.
 */
const MS_CARGA_INICIAL = TIMEOUT_SESION_MS;

/** Un arranque a la vez: las llamadas superpuestas se pegan al que ya corre. */
let carreraCarga: Promise<void> | null = null;

/**
 * Deja los permisos en cookies para que src/middleware.ts pueda bloquear rutas.
 * Se publica también el identificador del usuario: el perfil del principal es
 * "admin" (su tipo), y el middleware necesitaba poder distinguir a josorioc de
 * un admin más sin depender de la lista de permisos.
 *
 * `hipico_acceso` es el sello que separa "entró pero no tiene nada" de "entró y
 * tiene permisos". Sin ese sello el middleware no podía distinguir un perfil
 * vacío de una cookie ausente: era indistinguible de no haber iniciado sesión,
 * y un usuario sin tipo asignado quedaba rebotando entre /login y /dashboard
 * para siempre, sin ver un solo mensaje de error.
 */
export function publicarPermisosEnCookies(
  perfiles: string[],
  permisos: string[],
  usuario = ""
): string {
  const estado: "ok" | "sin" = perfiles.length > 0 || permisos.length > 0 ? "ok" : "sin";
  if (typeof document === "undefined") return estado;
  const exp = "; path=/; max-age=86400; SameSite=Lax";
  try {
    document.cookie = `${CLAVE_PERFIL}=${encodeURIComponent(perfiles.join(","))}${exp}`;
    document.cookie = `${CLAVE_PERMISOS}=${encodeURIComponent([...permisos].join(","))}${exp}`;
    document.cookie = `${CLAVE_USUARIO}=${encodeURIComponent(usuario)}${exp}`;
    document.cookie = `${CLAVE_ACCESO}=${estado}${exp}`;
  } catch {
    /* sinop */
  }
  return estado;
}

/** Borra todas las cookies de acceso que dejó el store. */
function borrarCookiesDeAcceso(): void {
  if (typeof document === "undefined") return;
  const exp = "; path=/; max-age=0; SameSite=Lax";
  try {
    document.cookie = `${CLAVE_PERFIL}=${exp}`;
    document.cookie = `${CLAVE_PERMISOS}=${exp}`;
    document.cookie = `${CLAVE_USUARIO}=${exp}`;
    document.cookie = `${CLAVE_ACCESO}=${exp}`;
  } catch {
    /* sinop */
  }
}

export type EstadoAuth = {
  /** true después del primer ciclo de carga inicial. */
  inicializada: boolean;
  /** true cuando ya se sembró el RBAC por primera vez (evita pisar permisos simulados). */
  sembrada: boolean;
  /** Identificación local del operador (sin Supabase Auth se usa el usuario demo). */
  usuario: string;
  email?: string | null;
  /** Nombres de perfil asignados (ej. ["Admin"]). */
  perfiles: string[];
  /** Set exacto de permisos vigentes del usuario actual (en memoria). */
  permisos: string[];
  cargando: boolean;
  /** Error de la última tentativa de login, para mostrarlo en el formulario. */
  errorLogin: string | null;
  /** Tipo de usuario asignado, ya resueltos sus requisitos. */
  tipoUsuario: TipoUsuario | null;
  /** Excepciones individuales por encima de la base del tipo. */
  excepciones: ExcepcionUsuario;
  /** true si la sesión es del usuario principal (acceso total). */
  esPrincipal: boolean;
  /** Inicia sesión contra Supabase Auth y siembra los permisos del perfil. */
  iniciarSesion: (identificador: string, clave: string) => Promise<boolean>;
  inicializar: () => Promise<void>;
  salir: () => Promise<void>;
};

/**
 * Estado de partida: SIN ACCESO NINGUNO.
 *
 * Antes arrancaba con los permisos de Admin, lo que dejaba la interfaz
 * completamente abierta durante el primer render y mientras se comprobaba la
 * sesión. Ahora el acceso empieza en cero y lo concede el maestro de seguridad
 * una vez verificada la sesión real de Supabase.
 */
const inicioDefault = {
  usuario: "",
  email: null as string | null,
  perfiles: [] as string[],
  permisos: [] as string[],
};

/**
 * Resuelve los accesos de la sesión con el MAESTRO: tipo de usuario + excepciones
 * individuales, con el usuario principal como atajo de acceso total.
 *
 * Devuelve además el set de capacidades ya resueltas, que es lo que consumen los
 * guards y las cookies del middleware.
 *
 * `falloLectura` distingue dos situaciones que antes salían igual y hay que
 * tratar distinto: "no se pudo leer el maestro" (la base no contesta, un RLS
 * bloquea la lectura, el usuario no tiene fila en `usuario_sistema`) y "se leyó
 * bien y no tiene nada". La primera se puede reintentar; la segunda hay que
 * avisarle a un administrador. Sin la distinción, ambas terminaban en un login
 * que aceptaba la contraseña y no dejaba entrar, sin explicación.
 */
type ResolucionAccesos = {
  tipoUsuario: TipoUsuario | null;
  excepciones: ExcepcionUsuario;
  esPrincipal: boolean;
  permisos: string[];
  perfiles: string[];
  falloLectura: boolean;
};

async function aplicarAccesos(identificador: string): Promise<ResolucionAccesos> {
  // Se normaliza aquí y no en cada consulta: `usuario_sistema.id` guarda la
  // parte local del correo, así que entrar como "josorioc" y recargar con
  // "josorioc@sistemahipico.local" tienen que dar el MISMO resultado.
  const id = claveDeUsuario(identificador);
  const principal = esUsuarioPrincipal(id);
  // Estas consultas van con corte de tiempo: si la base no contesta, el login
  // NO puede quedar esperando en el spinner. Se cae al peor caso —sin tipo, sin
  // excepciones, sin permisos— que es el fallo seguro: mejor que abrir el
  // sistema de menos que dejarlo colgado.
  let falloLectura = false;
  const [tipo, excepciones, atributos] = await Promise.all([
    principal
      ? Promise.resolve<TipoUsuario | null>(null)
      : conTimeout(leerTipoDeUsuario(id), TIMEOUT_SESION_MS, "La lectura del tipo de usuario").catch(
          () => {
            falloLectura = true;
            return null;
          }
        ),
    principal
      ? Promise.resolve<ExcepcionUsuario>({})
      : conTimeout(permisosIndividuales(id), TIMEOUT_SESION_MS, "La lectura de excepciones").catch(
          () => {
            falloLectura = true;
            return {} as ExcepcionUsuario;
          }
        ),
    principal
      ? Promise.resolve<Record<string, unknown>>({})
      : conTimeout(atributosDeUsuario(id), TIMEOUT_SESION_MS, "La lectura de atributos").catch(() => {
          falloLectura = true;
          return {} as Record<string, unknown>;
        }),
  ]);
  const resolucion = resolverAccesos({ identificador: id, tipo, excepciones });
  const permisos = [...resolucion.permitidas];
  const perfiles = tipo ? [tipo.nombre] : principal ? ["admin"] : [];
  publicarPermisosEnCookies(perfiles, permisos, id);
  // Espejo para las funciones de escritura de src/lib, que no son componentes y
  // no pueden leer el store (ver src/lib/seguridad/vigente.ts).
  //
  // Van también el TIPO y los ATRIBUTOS porque el ABAC los necesita: el
  // ámbito `tipo:operador` decide con el primero, y las reglas `en_atributo`
  // (el operador solo trabaja sus hipódromos) con el segundo. Sin esto, el
  // ABAC quedaría con permiso pero sin contexto y bloquearía siempre.
  setAccesosVigentes({
    permisos,
    esPrincipal: resolucion.total,
    usuario: id,
    tipoUsuario: tipo?.nombre ?? (principal ? "admin" : ""),
    atributos,
  });
  return {
    tipoUsuario: tipo,
    excepciones,
    esPrincipal: resolucion.total,
    permisos,
    perfiles,
    falloLectura,
  };
}

/**
 * Texto único para "la contraseña era correcta pero no hay nada detrás".
 *
 * Lo comparten el login y la pantalla de acceso, para que el motivo se lea igual
 * se llegue por el botón o por la redirección del middleware. Cita el usuario
 * que se escribió, que es el que hay que revisar en Seguridad.
 */
export function mensajeSinAcceso(identificador: string, falloLectura: boolean): string {
  if (falloLectura) {
    return "Tu contraseña es correcta, pero no pudimos leer los permisos del usuario. Revisá la conexión y probá de nuevo.";
  }
  const quien = (identificador ?? "").trim();
  return `Tu contraseña es correcta, pero ${quien ? `el usuario "${quien}"` : "el usuario"} no tiene ningún tipo asignado, o su tipo está desactivado. Pedile a un administrador que lo asigne en Seguridad.`;
}

/**
 * Resuelve la sesión de arranque y deja el store en un estado terminal.
 *
 * Se separa del store para poder envolverla con un `finally` en `inicializar`:
 * la Guarantee de que la pantalla se libera no depende de que esta función
 * termine bien. Termina siempre en `inicializada: true`, y el caso "no hay
 * sesión" es un estado legítimo, no un error.
 */
async function cargarSesion(set: (parcial: Partial<EstadoAuth>) => void): Promise<void> {
  const sesion = await sesionActual();
  if (!sesion) {
    limpiarAccesosVigentes();
    set({
      inicializada: true,
      sembrada: false,
      cargando: false,
      usuario: inicioDefault.usuario,
      email: inicioDefault.email,
      perfiles: inicioDefault.perfiles,
      permisos: inicioDefault.permisos,
      tipoUsuario: null,
      excepciones: {},
      esPrincipal: false,
    });
    return;
  }
  const id = claveDeUsuario(sesion.correo);
  // Misma protección que en `iniciarSesion`: una excepción al leer el maestro
  // no puede dejar la pantalla en "verificando sesión" para siempre.
  let a: ResolucionAccesos;
  try {
    a = await aplicarAccesos(id);
  } catch {
    limpiarAccesosVigentes();
    a = {
      tipoUsuario: null,
      excepciones: {},
      esPrincipal: false,
      permisos: [],
      perfiles: [],
      falloLectura: true,
    };
  }
  // Sesión abierta sin nada detrás (alta sin tipo, tipo desactivado, maestro
  // ilegible): para la interfaz es lo mismo que no tener sesión. Se deja la
  // identidad sin sembrar para que el `AuthBootstrap` no la mande al escritorio
  // y el operador se quede en el login leyendo el motivo, en vez de quedar
  // rebotando entre /login y /dashboard. El sello `hipico_acceso=sin` sigue
  // cerrando las rutas por URL directa.
  if (!a.perfiles.length && !a.permisos.length && !a.esPrincipal) {
    set({
      inicializada: true,
      sembrada: false,
      cargando: false,
      usuario: inicioDefault.usuario,
      email: sesion.correo,
      perfiles: inicioDefault.perfiles,
      permisos: inicioDefault.permisos,
      tipoUsuario: null,
      excepciones: {},
      esPrincipal: false,
      errorLogin: mensajeSinAcceso(id, a.falloLectura),
    });
    return;
  }
  set({
    inicializada: true,
    sembrada: true,
    cargando: false,
    usuario: id,
    email: sesion.correo,
    tipoUsuario: a.tipoUsuario,
    excepciones: a.excepciones,
    esPrincipal: a.esPrincipal,
    permisos: a.permisos,
    perfiles: a.perfiles,
  });
}

/**
 * Store de autenticación y RBAC. Los permisos NO son un dato guardado: se
 * recalculan en cada arranque contra la sesión real de Supabase y contra la
 * matriz vigente del maestro (tipo del usuario + excepciones individuales).
 *
 * El store no expone ninguna forma de escribir los permisos a mano: se
 * quitaron `setPermisos` y `simularPerfil`, que permitían abrir la interfaz
 * completa desde la consola sin sesión. Para "ver como otro tipo" está
 * /seguridad, que muestra el cálculo sin tocar la sesión real.
 */
export const useAuthStore = create<EstadoAuth>()(
  persist(
    (set, get) => ({
      inicializada: false,
      sembrada: false,
      usuario: inicioDefault.usuario,
      email: inicioDefault.email,
      perfiles: inicioDefault.perfiles,
      permisos: inicioDefault.permisos,
      tipoUsuario: null,
      excepciones: {},
      esPrincipal: false,
      cargando: false,
      errorLogin: null,

      iniciarSesion: async (identificador, clave) => {
        set({ cargando: true, errorLogin: null });
        const r = await login(identificador, clave);
        if (!r.ok) {
          set({ cargando: false, errorLogin: r.error });
          return false;
        }
        const id = claveDeUsuario(identificador);
        // Sin este try, una excepción al resolver el maestro (respuesta con
        // forma distinta a la esperada, cliente de Supabase caído a mitad de la
        // consulta) escapaba hacia el formulario y dejaba `cargando` en true
        // PARA SIEMPRE: el botón se quedaba en "Autenticando..." y no pasaba
        // absolutamente nada, sin un solo mensaje. Es el peor síntoma posible
        // de un login, porque no deja distinguir "contraseña mala" de "el
        // sistema falló por dentro".
        let a: ResolucionAccesos;
        try {
          a = await aplicarAccesos(id);
        } catch {
          limpiarAccesosVigentes();
          a = {
            tipoUsuario: null,
            excepciones: {},
            esPrincipal: false,
            permisos: [],
            perfiles: [],
            falloLectura: true,
          };
        }
        // La contraseña era correcta pero no hay nada detrás del usuario: ni
        // tipo asignado, ni tipo desactivado, ni alta dada de baja, ni se pudo
        // leer el maestro. Antes se lo llevaba al /dashboard y el middleware lo
        // devolvía al login, y la pantalla lo volvía a mandar al dashboard: un
        // bucle sin un solo mensaje, que es exactamente "ingresé el usuario y
        // no me dejó entrar". Ahora se dice qué pasó y por quién se resuelve.
        if (!a.perfiles.length && !a.permisos.length && !a.esPrincipal) {
          set({
            cargando: false,
            inicializada: true,
            sembrada: false,
            usuario: inicioDefault.usuario,
            email: r.correo,
            perfiles: inicioDefault.perfiles,
            permisos: inicioDefault.permisos,
            tipoUsuario: null,
            excepciones: {},
            esPrincipal: false,
            errorLogin: a.falloLectura
              ? mensajeSinAcceso(identificador, true)
              : mensajeSinAcceso(identificador, false),
          });
          return false;
        }
        set({
          cargando: false,
          errorLogin: null,
          sembrada: true,
          inicializada: true,
          usuario: id,
          email: r.correo,
          tipoUsuario: a.tipoUsuario,
          excepciones: a.excepciones,
          esPrincipal: a.esPrincipal,
          permisos: a.permisos,
          perfiles: a.perfiles,
        });
        return true;
      },

      inicializar: async () => {
        // La sesión REAL de Supabase decide siempre el tipo de usuario. Antes,
        // si localStorage traía `sembrada`, se re-publicaban los permisos
        // cacheados sin volver a preguntarle a la base: bastaba con editar el
        // localStorage del navegador para quedarse con todos los permisos.
        //
        // Una sola carga a la vez. `AuthBootstrap` dispara esto desde dos
        // efectos y otra vez en cada evento de sesión; sin este cerrojo se
        // apilan varias consultas al maestro y, con la base lenta, la pantalla
        // queda dando vueltas en el spinner en vez de mostrar el formulario.
        if (carreraCarga) return carreraCarga;
        set({ cargando: true });
        carreraCarga = (async () => {
          // `AppShell` no dibuja nada hasta que `inicializada` sea true. Si esta
          // promesa se cuelga, la aplicación entera queda girando en el spinner
          // y no se ve NI el login. El corte de tiempo resuelve eso, y el
          // `finally` libera la pantalla pase lo que pase: sin sesión
          // verificada no hay acceso, y el login aparece.
          try {
            await Promise.race([
              cargarSesion(set),
              new Promise<void>((r) => setTimeout(r, MS_CARGA_INICIAL)),
            ]);
          } catch {
            limpiarAccesosVigentes();
          } finally {
            if (!useAuthStore.getState().inicializada) {
              limpiarAccesosVigentes();
              set({
                inicializada: true,
                cargando: false,
                usuario: inicioDefault.usuario,
                email: inicioDefault.email,
                perfiles: inicioDefault.perfiles,
                permisos: inicioDefault.permisos,
              });
            }
          }
        })().finally(() => {
          carreraCarga = null;
        });
        return carreraCarga;
      },

      salir: async () => {
        await cerrarSesionSupabase();
        borrarCookiesDeAcceso();
        limpiarAccesosVigentes();
        set({
          // `inicializada: true` a propósito. La sesión ESTÁ verificada: lo que
          // se verificó es que no hay ninguna. Antes se ponía en false, que
          // significa "todavía no sé quién sos", y eso dejaba el spinner de
          // AppShell girando para siempre en /login (nadie volvía a llamar a
          // `inicializar`, porque el redirect ya no cambia de ruta).
          inicializada: true,
          sembrada: false,
          usuario: inicioDefault.usuario,
          email: inicioDefault.email,
          perfiles: inicioDefault.perfiles,
          permisos: inicioDefault.permisos,
          tipoUsuario: null,
          excepciones: {},
          esPrincipal: false,
          errorLogin: null,
        });
      },
    }),
    {
      name: "sistema-hipico:auth",
      // No se persiste NADA. La identidad sale de la sesión de Supabase y los
      // permisos se recalculan contra el maestro en cada arranque.
      //
      // Antes se guardaban `usuario`, `email` y `sembrada`. Con la rehidratación
      // de zustand, el store recovería `usuario: "josorioc"` de localStorage
      // ANTES de que `inicializar()` preguntara a Supabase, y durante esa
      // ventana el Topbar mostraba el nombre de una sesión que ya no existía.
      // Como nada de eso sobrevive a una recarga real, guardarlo solo servía
      // para filtrar identidad vieja.
      partialize: () => ({}),
    }
  )
);

/**
 * Utilidad RBAC síncrona. Devuelve true si el usuario actual posee TODOS los
 * permisos indicados (una clave o una lista).
 *
 * `permisos` contiene capacidades del maestro (ej. "contabilidad:btn_eliminar_banco").
 * Las claves del catálogo viejo siguen funcionando: se lookup en el maestro.
 */
export function hasPermission(permiso: string | string[]): boolean {
  const st = useAuthStore.getState();
  if (st.esPrincipal) return true;
  // Antes de resolver la sesión no se concede nada: negar por omisión.
  if (!st.inicializada) return false;
  const set = new Set(st.permisos);
  if (Array.isArray(permiso)) return permiso.every((p) => set.has(p));
  return set.has(permiso);
}

export default useAuthStore;