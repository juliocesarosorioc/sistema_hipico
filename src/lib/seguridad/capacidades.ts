/**
 * ============================================================================
 * REGISTRO MAESTRO DE CAPACIDADES — el módulo de seguridad es el dueño de esto
 * ============================================================================
 *
 * Este archivo ES el esquema del sistema. Cada módulo de la plataforma queda
 * esquematizado acá con TODO lo que expone, clasificado por tipo:
 *
 *   ruta     → la pantalla del módulo (¿se puede entrar?)
 *   boton    → un control que dispara una acción
 *   modal    → una ventana emergente
 *   celda    → una columna de tabla o un campo con dato/acción sensible
 *   campo    → un input de formulario
 *   funcion  → una operación de negocio (escritura en la BD)
 *
 * REGLAS DE ORO (si tocás una pantalla, tocás este archivo):
 *  1. Todo control nuevo va acá. Sin registro, el maestro no lo controla.
 *  2. La `clave` es el identificador ESTABLE que usa la UI. Nunca la renombres
 *     sin migrar los usos: es lo que se guarda en la matriz por tipo de usuario.
 *  3. `fuente` deja la trazabilidad al código (archivo:línea). Sirve para la
 *     pestaña "Cobertura", que detecta capacidades declaradas y nunca aplicadas.
 *  4. `riesgo` ordena las capacidades para la UI: primero lo que mueve dinero.
 *
 * La resolución de "quién puede qué" NO vive acá: vive en `resolver.ts`.
 */

import type { Capacidad, ModuloEsquema, Riesgo, TipoCapacidad } from "@/lib/seguridad/tipos";

/** Helper de construcción: una capacidad siempre con su clave y su tipo. */
const c = (
  modulo: string,
  tipo: TipoCapacidad,
  sufijo: string,
  titulo: string,
  riesgo: Riesgo,
  fuente: string,
  extra: Partial<Capacidad> = {}
): Capacidad => ({
  clave: `${modulo}:${sufijo}`,
  modulo,
  tipo,
  titulo,
  riesgo,
  fuente,
  descripcion: extra.descripcion ?? "",
  ...extra,
});

// ============================================================================
// MÓDULOS
// ============================================================================

export const MODULOS_ESQUEMA: ModuloEsquema[] = [
  // --------------------------------------------------------------------------
  {
    clave: "general",
    nombre: "General",
    ruta: "/dashboard",
    icono: "home",
    descripcion: "Escritorio, inicio, grupos activos y saldos.",
    capacidades: [
      c("general", "ruta", "ruta_dashboard", "Ver el Escritorio (/dashboard)", "lectura", "src/app/dashboard/page.tsx:1"),
      c("general", "ruta", "ruta_inicio", "Ver Inicio", "lectura", "src/app/(dashboard)/inicio/page.tsx:16", { ruta: "/inicio" }),
      c("general", "ruta", "ruta_saldos", "Ver Saldos y Reportes", "lectura", "src/app/(dashboard)/saldos-reportes/page.tsx:8", { ruta: "/saldos-reportes" }),
      c("general", "celda", "celda_saldo_cliente", "Ver saldo de un cliente", "lectura", "src/components/clientes/ClientesModule.tsx", {
        descripcion: "Columna de saldo en la cartera. Ocultarla evita exponer saldos.",
      }),
      // "Cerrar semana" / "Abrir semana" NO se declaran como capacidades propias: la
      // consolidación usa `contabilidad:fn_registrar_movimiento` (cerrar caja es
      // escribir en caja) y reabrir borra la foto del registro, no mueve saldo.
      // Declarar una capacidad sin fila en la base es peor que no declararla: el
      // maestro deja de ser el inventario de lo que el sistema REALMENTE hace y el
      // botón queda muerto para todo el mundo. Ver `src/lib/liquidacion/cierres.ts`.
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "seguridad",
    nombre: "Seguridad",
    ruta: "/seguridad",
    icono: "shield",
    descripcion:
      "MÓDULO MAESTRO. Esquematiza la plataforma completa y define, por tipo de usuario, qué se ve y qué se puede hacer.",
    capacidades: [
      c("seguridad", "ruta", "ruta_seguridad", "Entrar al módulo de Seguridad", "critico", "src/app/(dashboard)/seguridad/page.tsx:13"),
      c("seguridad", "celda", "celda_esquema", "Ver el esquema de módulos y capacidades", "lectura", "src/components/seguridad/SeguridadModule.tsx", {
        descripcion: "Pestaña Esquema: inventario completo del sistema.",
      }),
      c("seguridad", "celda", "celda_matriz", "Ver la matriz de tipos de usuario", "lectura", "src/components/seguridad/SeguridadModule.tsx", {
        descripcion: "Pestaña Tipos de usuario: qué ve y qué hace cada tipo.",
      }),
      c("seguridad", "funcion", "fn_editar_matriz", "Editar la matriz de un tipo de usuario", "critico", "src/components/seguridad/SeguridadModule.tsx:163", {
        descripcion: "Guarda la matriz completa de capacidades de un tipo.",
      }),
      c("seguridad", "funcion", "fn_crear_tipo", "Crear un tipo de usuario nuevo", "critico", "src/components/seguridad/SeguridadModule.tsx", {
        descripcion: "Alta de un tipo (rol) con su base genérica de accesos.",
      }),
      c("seguridad", "funcion", "fn_editar_tipo", "Activar o desactivar un tipo de usuario", "critico", "src/lib/seguridad/accesos.ts", {
        descripcion: "Un tipo desactivado no reparte ninguna capacidad a quienes lo tienen asignado.",
      }),
      c("seguridad", "funcion", "fn_asignar_tipo", "Asignar o cambiar el tipo de un usuario", "critico", "src/lib/seguridad/accesos.ts"),
      c("seguridad", "funcion", "fn_personalizar_usuario", "Personalizar accesos de un usuario", "critico", "src/lib/seguridad/accesos.ts", {
        descripcion: "Excepciones individuales por encima de la base del tipo.",
      }),
      c("seguridad", "celda", "celda_auditoria", "Ver la auditoría de cobertura", "lectura", "src/components/seguridad/SeguridadModule.tsx", {
        descripcion: "Qué capacidades están declaradas pero nunca se aplican en el código.",
      }),
      c("seguridad", "celda", "celda_simulacion", "Previsualizar qué vería otro tipo", "lectura", "src/components/seguridad/SeguridadModule.tsx", {
        descripcion:
          "Cálculo en lectura: muestra el set queTENDRÍA otro tipo sin tocar la sesión. Antes esto era `fn_simular` con escritura, y esa escalada de privilegios quedó eliminada del store.",
      }),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "clientes",
    nombre: "Clientes",
    ruta: "/clientes",
    icono: "users",
    descripcion: "Cartera de clientes, saldos, portal y reclamos.",
    capacidades: [
      c("clientes", "ruta", "ruta_clientes", "Ver la cartera de clientes", "lectura", "src/app/(dashboard)/clientes/page.tsx:15"),
      c("clientes", "boton", "btn_crear", "Crear cliente", "escritura", "src/components/clientes/ClientesModule.tsx:166"),
      c("clientes", "boton", "btn_editar", "Editar cliente", "escritura", "src/components/clientes/ClientesModule.tsx:224"),
      c("clientes", "boton", "btn_eliminar", "Eliminar cliente", "critico", "src/components/clientes/ClientesModule.tsx:372", {
        descripcion: "Borrado real del registro en clientes.",
      }),
      c("clientes", "boton", "btn_ver_ventas", "Ver ventas del cliente", "lectura", "src/components/clientes/ClientesModule.tsx:353"),
      c("clientes", "modal", "modal_editar", "Modal de edición de cliente", "escritura", "src/components/clientes/ClientesModule.tsx"),
      c("clientes", "modal", "modal_reclamos", "Modal de reclamos y devoluciones", "critico", "src/components/clientes/ClientesModule.tsx", {
        descripcion: "Incluye devoluciones masivas de saldos.",
      }),
      c("clientes", "celda", "celda_saldo", "Ver la columna de saldo", "lectura", "src/components/clientes/ClientesModule.tsx"),
      c("clientes", "celda", "celda_acciones", "Ver la columna de acciones", "lectura", "src/components/clientes/ClientesModule.tsx"),
      c("clientes", "funcion", "fn_guardar_cliente", "Guardar cliente", "escritura", "src/lib/clientes.ts:243", {
        descripcion:
          "Cubre el alta, la edición y la configuración del portal de un cliente: las tres terminan en un UPDATE/INSERT sobre `clientes`.",
      }),
      c("clientes", "funcion", "fn_eliminar_cliente", "Eliminar cliente", "critico", "src/lib/clientes.ts:273"),
      // Se quitó `fn_mover_saldo`: no existe ninguna función en clientes.ts que
      // mueva saldo o impute pagos. El maestro apuntaba a `guardarPortal`, que
      // solo persiste la configuración del portal. Declarar esa capacidad era
      // prometer un control de saldo que el sistema no tiene.
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "grupos",
    nombre: "Grupos",
    ruta: "/grupos",
    icono: "users",
    descripcion: "Grupos de juego y sus integrantes.",
    capacidades: [
      c("grupos", "ruta", "ruta_grupos", "Ver los grupos", "lectura", "src/app/(dashboard)/grupos/page.tsx:14"),
      c("grupos", "boton", "btn_crear", "Crear grupo", "escritura", "src/components/grupos/GruposModule.tsx"),
      c("grupos", "boton", "btn_editar", "Editar grupo", "escritura", "src/components/grupos/GruposModule.tsx"),
      c("grupos", "boton", "btn_eliminar", "Eliminar grupo", "critico", "src/components/grupos/GruposModule.tsx"),
      c("grupos", "modal", "modal_miembros", "Modal de integrantes del grupo", "escritura", "src/components/grupos/GruposModule.tsx"),
      c("grupos", "funcion", "fn_guardar_grupo", "Guardar grupo con sus miembros", "escritura", "src/lib/grupos.ts:276", {
        descripcion: "Borra y reinscribe TODOS los miembros: afecta a los grupos ya vendidos.",
      }),
      // NO se declara "asignar un cliente a un grupo" como capacidad. El campo se
      // abre solo al USUARIO PRINCIPAL, que ya tiene acceso total sin depender de
      // la matriz. Declarar la capacidad obligaría a poner una fila en
      // `tipo_usuario_capacidad` para que sirviera de algo; si esa fila falta,
      // el botón queda muerto para todo el mundo (es el motivo por el que "Cerrar
      // Semana" usa `contabilidad:fn_registrar_movimiento` y no la suya).
      // Ver el gate en src/components/clientes/ModalCliente.tsx.
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "hipodromos",
    nombre: "Hipódromos",
    ruta: "/hipodromos",
    icono: "flag",
    descripcion: "Catálogo de hipódromos.",
    capacidades: [
      c("hipodromos", "ruta", "ruta_hipodromos", "Ver los hipódromos", "lectura", "src/app/(dashboard)/hipodromos/page.tsx:1"),
      c("hipodromos", "boton", "btn_crear", "Crear hipódromo", "escritura", "src/components/hipodromos/HipodromosModule.tsx"),
      c("hipodromos", "boton", "btn_editar", "Editar hipódromo", "escritura", "src/components/hipodromos/HipodromosModule.tsx"),
      c("hipodromos", "boton", "btn_eliminar", "Eliminar hipódromo", "critico", "src/components/hipodromos/HipodromosModule.tsx"),
      c("hipodromos", "funcion", "fn_guardar_hipodromo", "Guardar hipódromo", "escritura", "src/lib/hipodromos/servicio.ts:82"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "ejemplares",
    nombre: "Ejemplares",
    ruta: "/ejemplares",
    icono: "horse",
    descripcion: "Padrón de ejemplares y gaceta del día.",
    capacidades: [
      c("ejemplares", "ruta", "ruta_ejemplares", "Ver ejemplares y gaceta", "lectura", "src/app/(dashboard)/ejemplares/page.tsx:1"),
      c("ejemplares", "boton", "btn_crear", "Alta de ejemplar", "escritura", "src/components/ejemplares/EjemplaresModule.tsx"),
      c("ejemplares", "boton", "btn_editar", "Editar ejemplar", "escritura", "src/components/ejemplares/EjemplaresModule.tsx"),
      c("ejemplares", "boton", "btn_eliminar", "Eliminar ejemplar", "critico", "src/components/ejemplares/EjemplaresModule.tsx"),
      c("ejemplares", "celda", "celda_retirado", "Ver la columna de retirado", "lectura", "src/components/ejemplares/EjemplaresModule.tsx"),
        c("ejemplares", "funcion", "fn_guardar_ejemplar", "Guardar ejemplar", "escritura", "src/lib/gaceta/padron.ts:193"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "carreras",
    nombre: "Carreras del Día",
    ruta: "/carreras",
    icono: "calendar",
    descripcion: "Registro de la jornada: qué carreras hay, su estado y su venta.",
    capacidades: [
      c("carreras", "ruta", "ruta_carreras", "Ver Carreras del Día", "lectura", "src/app/(dashboard)/carreras/page.tsx:1", { ruta: "/carreras" }),
      c("carreras", "celda", "celda_estado", "Ver el estado de la carrera", "lectura", "src/components/carreras/CarrerasDiaModule.tsx", {
        descripcion: "Programada / con resultados / liquidada / anulada.",
      }),
      c("carreras", "celda", "celda_venta", "Ver la venta de la carrera", "lectura", "src/components/carreras/CarrerasDiaModule.tsx"),
      c("carreras", "funcion", "fn_registrar_carrera", "Registrar una carrera programada", "escritura", "src/lib/carreras-dia.ts:97", {
        descripcion: "Alta en el central con fecha, hipodromo, carrera y ejemplares.",
      }),
      c("carreras", "funcion", "fn_eliminar_carrera", "Quitar una carrera del central", "critico", "src/lib/carreras/central.ts:201", {
        descripcion:
          "Borra la oferta de la carrera del día. NO toca tablas fijas publicadas ni jugadas ya registradas.",
      }),
      c("carreras", "boton", "btn_verificar_carrera", "Marcar una carrera como verificada", "escritura", "src/components/carreras/CarrerasDiaModule.tsx", {
        descripcion:
          "Deja registro de quién revisó la carrera y cuándo. No cambia el resultado ni el estado comercial.",
      }),
      c("carreras", "boton", "btn_invalidate_remate", "Invalidar un ejemplar solo para Remates (INV)", "escritura", "src/components/carreras/CarrerasDiaModule.tsx", {
        descripcion:
          "El ejemplar no puja ni requiere valor en Remates, pero sigue corriendo en Tablas, Marcas, Taquilla y Gestión. Es distinto de retirar, que sí lo saca de todos los módulos.",
      }),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "gestion_jugadas",
    nombre: "Gestión de Jugadas",
    ruta: "/gestion-jugadas",
    icono: "ticket",
    descripcion: "Carga y operación de jugadas, retiros y liquidación de una carrera.",
    capacidades: [
      c("gestion_jugadas", "ruta", "ruta_gestion", "Entrar a Gestión de Jugadas", "lectura", "src/app/(dashboard)/gestion-jugadas/page.tsx:1"),
      c("gestion_jugadas", "boton", "btn_cargar", "Cargar jugada(s)", "escritura", "src/components/gestion/GestionJugadasModule.tsx:935"),
      c("gestion_jugadas", "boton", "btn_editar_jugada", "Editar una jugada cargada", "escritura", "src/components/gestion/GestionJugadasModule.tsx:970"),
      c("gestion_jugadas", "boton", "btn_quitar_jugada", "Quitar una jugada", "critico", "src/components/gestion/GestionJugadasModule.tsx:979", {
        descripcion: "Elimina el ticket. Si ya se vendió, hay que reponer el saldo del cliente.",
      }),
      c("gestion_jugadas", "boton", "btn_retirar_ejemplar", "Retirar o reponer un ejemplar", "critico", "src/components/gestion/GestionJugadasModule.tsx:739", {
        descripcion: "Click sobre el ejemplar. Cambia la oferta de la carrera.",
      }),
      c("gestion_jugadas", "boton", "btn_aplicar_retiros", "Aplicar retiros a los tickets", "critico", "src/components/gestion/GestionJugadasModule.tsx:662", {
        descripcion: "Reembolsa tickets y recalcula premios de toda la carrera.",
      }),
      c("gestion_jugadas", "boton", "btn_modo_manual", "Cargar en Modo Manual", "escritura", "src/components/gestion/GestionJugadasModule.tsx:690"),
      c("gestion_jugadas", "boton", "btn_cargar_resultados", "Cargar resultados de la carrera", "critico", "src/components/gestion/GestionJugadasModule.tsx:1024", {
        descripcion: "Es el Ctrl+Y. Escribe el resultado en el central.",
      }),
      c("gestion_jugadas", "boton", "btn_liquidar", "Registrar y Finalizar (liquidar)", "critico", "src/components/gestion/GestionJugadasModule.tsx:1031", {
        descripcion: "El Ctrl+R. Liquida los tickets Y cierra la tabla en una sola operación. La acción más delicada del módulo.",
        requiere: ["gestion_jugadas:ruta_gestion"],
      }),
      c("gestion_jugadas", "boton", "btn_poblar", "Poblar la tabla de la carrera", "escritura", "src/components/gestion/GestionJugadasModule.tsx:1247"),
      c("gestion_jugadas", "modal", "modal_finalizar", "Modal de Registrar y Finalizar", "critico", "src/components/gestion/GestionJugadasModule.tsx:1178"),
      c("gestion_jugadas", "celda", "celda_monto", "Ver el monto de la jugada", "lectura", "src/components/gestion/GestionJugadasModule.tsx"),
      c("gestion_jugadas", "celda", "celda_cliente", "Ver el cliente de la jugada", "lectura", "src/components/gestion/GestionJugadasModule.tsx"),
      c("gestion_jugadas", "funcion", "fn_liquidar_carrera", "Liquidar carrera y cerrar tabla", "critico", "src/lib/liquidacion/pagarYCerrar.ts:172", {
        descripcion: "Escribe el resultado central y cambia el estado de la tabla.",
      }),
      c("gestion_jugadas", "funcion", "fn_aplicar_retiros", "Aplicar retiros y reembolsos", "critico", "src/lib/carreras/retiros.ts:196", {
        descripcion: "RPC que reembolsa tickets y recalcula premios.",
      }),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "jugadas",
    nombre: "Monitor de Jugadas",
    ruta: "/jugadas",
    icono: "chart-line",
    descripcion:
      "Monitor de progreso de resultados por carrera y estado de las jugadas, con corrección y anulación auditadas.",
    capacidades: [
      c("jugadas", "ruta", "ruta_jugadas", "Entrar al Monitor de Jugadas", "lectura", "src/app/(dashboard)/jugadas/page.tsx:1", {
        ruta: "/jugadas",
      }),
      c("jugadas", "celda", "celda_resumen", "Ver las tarjetas de resumen y el progreso", "lectura", "src/components/jugadas/JugadasModule.tsx", {
        descripcion: "En juego / por pagar / liquidadas / anuladas y la barra de resultados cargados.",
      }),
      c("jugadas", "celda", "celda_detalle", "Ver el detalle de jugadas de una carrera", "lectura", "src/components/jugadas/JugadasModule.tsx", {
        descripcion: "Incluye cliente, monto, premio, operador y estado de cada jugada.",
      }),
      c("jugadas", "funcion", "fn_editar_jugada", "Corregir una jugada", "escritura", "src/lib/jugadas.ts", {
        descripcion: "Cambia montos, ejemplar o estado de una jugada y deja motivo en la auditoría.",
        requiere: ["jugadas:ruta_jugadas"],
      }),
      c("jugadas", "funcion", "fn_anular_jugada", "Anular una jugada", "critico", "src/lib/jugadas.ts", {
        descripcion: "Marca la jugada como anulada y guarda motivo e imagen de verificación.",
        requiere: ["jugadas:ruta_jugadas"],
      }),
      c("jugadas", "funcion", "fn_restaurar_jugada", "Restaurar una jugada anulada", "escritura", "src/lib/jugadas.ts"),
      c("jugadas", "funcion", "fn_marcar_pagada", "Marcar una jugada como pagada", "critico", "src/lib/jugadas.ts", {
        descripcion: "Deja constancia de pago en `pagado_en`/`pagado_por`, sin mover saldos.",
      }),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "tablas",
    nombre: "Tablas Fijas",
    ruta: "/tablas-fijas",
    icono: "grid",
    descripcion: "Armado, publicación, venta, edición y liquidación de tablas.",
    capacidades: [
      c("tablas", "ruta", "ruta_tablas", "Ver Tablas Fijas", "lectura", "src/app/(dashboard)/tablas-fijas/page.tsx:1"),
      c("tablas", "boton", "btn_publicar", "Publicar una tabla del ensamblaje", "escritura", "src/components/tablas/TarjetaEnsamblaje.tsx:295", {
        ruta: "/tablas-fijas",
      }),
      c("tablas", "boton", "btn_publicar_todas", "Publicar todas las tablas", "escritura", "src/components/tablas/TablasModule.tsx:545"),
      c("tablas", "boton", "btn_editar", "Editar tabla y carrera", "escritura", "src/components/tablas/MonitorTablas.tsx:711", {
        descripcion: "El botón de edición, abajo de SUMA.",
      }),
      c("tablas", "boton", "btn_editar_cuadro", "Editar un cuadro de la tabla", "escritura", "src/components/tablas/MonitorTablas.tsx:623"),
      c("tablas", "boton", "btn_agregar_cuadro", "Añadir un cuadro", "escritura", "src/components/tablas/MonitorTablas.tsx:647"),
      c("tablas", "boton", "btn_quitar_cuadro", "Quitar un cuadro", "escritura", "src/components/tablas/MonitorTablas.tsx:633"),
      c("tablas", "boton", "btn_vender", "Vender la tabla", "escritura", "src/components/tablas/MonitorTablas.tsx:659", {
        descripcion: "Genera el boleto de venta de la tabla.",
      }),
      c("tablas", "boton", "btn_liquidar", "Liquidar la tabla", "critico", "src/components/tablas/MonitorTablas.tsx:662"),
      c("tablas", "boton", "btn_eliminar", "Eliminar la tabla publicada", "critico", "src/components/tablas/MonitorTablas.tsx:665"),
      c("tablas", "boton", "btn_imprimir", "Imprimir las tablas publicadas", "escritura", "src/components/tablas/TablasModule.tsx:607"),
      c("tablas", "modal", "modal_venta", "Modal de venta de la tabla", "escritura", "src/components/tablas/MonitorTablas.tsx:746"),
      c("tablas", "modal", "modal_ejemplar", "Modal de ejemplar", "escritura", "src/components/tablas/MonitorTablas.tsx:845"),
      c("tablas", "modal", "modal_cuadro", "Modal de cuadro", "escritura", "src/components/tablas/MonitorTablas.tsx:854"),
      c("tablas", "modal", "modal_liquidar", "Modal de liquidación", "critico", "src/components/tablas/MonitorTablas.tsx:924"),
      c("tablas", "modal", "modal_corregir", "Modal de corregir tabla", "escritura", "src/components/tablas/MonitorTablas.tsx:928"),
      c("tablas", "celda", "celda_suma", "Ver el total SUMA de la tabla", "lectura", "src/components/tablas/MonitorTablas.tsx"),
      c("tablas", "celda", "celda_estado", "Ver el estado de la tabla", "lectura", "src/components/tablas/MonitorTablas.tsx"),
      c("tablas", "funcion", "fn_publicar", "Publicar tabla", "escritura", "src/lib/tablas/rpc.ts", {
        descripcion: "Escribe en tablas_fijas. NO crea la carrera en el central: esa se registra aparte, en Carreras del Día.",
      }),
      c("tablas", "funcion", "fn_cerrar_tabla", "Cerrar la tabla al liquidar", "critico", "src/lib/tablas-fijas.ts:53"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "marcas",
    nombre: "Marcas",
    ruta: "/marcas",
    icono: "target",
    descripcion: "Marcas, debutantes y configuración por carrera.",
    capacidades: [
      c("marcas", "ruta", "ruta_marcas", "Ver Marcas", "lectura", "src/app/(dashboard)/marcas/page.tsx:1"),
      c("marcas", "boton", "btn_editar_marcas", "Editar las marcas de la carrera", "escritura", "src/components/marcas/PanelMarcas.tsx", {
        descripcion: "Las marcas se escriben con barra (1/2/3) o con el separador manual '/'. La primera marca no se juega.",
      }),
      c("marcas", "boton", "btn_guardar_marcas", "Guardar la configuración de marcas", "critico", "src/lib/marcas.ts:232", {
        descripcion: "Afecta cómo se venden las jugadas de la carrera. Los tickets ya vendidos conservan su snapshot.",
        requiere: ["marcas:ruta_marcas"],
      }),
      c("marcas", "boton", "btn_marcar_debutantes", "Marcar debutantes", "escritura", "src/components/marcas/PanelMarcas.tsx"),
      c("marcas", "celda", "celda_marcas", "Ver la columna de marcas", "lectura", "src/components/marcas/PanelMarcas.tsx"),
      c("marcas", "celda", "celda_debutantes", "Ver la columna de debutantes", "lectura", "src/components/marcas/PanelMarcas.tsx"),
      c("marcas", "funcion", "fn_guardar_marcas", "Escribir la configuración de marcas y debutantes", "critico", "src/lib/marcas.ts:132"),
      c("marcas", "funcion", "fn_liquidar_marcas", "Liquidar una marca", "critico", "src/lib/marcas.ts:298", {
        descripcion:
          "Deja la marca pagada y cierra el ciclo. Antes compartía clave con el guardado de la configuración: poder guardar la configuración no debería implicar poder liquidar.",
      }),
      c("marcas", "funcion", "fn_registrar_orden_llegada", "Registrar el orden de llegada de una marca", "critico", "src/lib/marcas.ts:349"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "dupleta",
    nombre: "Dúpleta",
    ruta: "/dupleta",
    icono: "link",
    descripcion: "Combinaciones y dúpletas para las carreras del día.",
    capacidades: [
      c("dupleta", "ruta", "ruta_dupleta", "Ver Dúpleta", "lectura", "src/app/(dashboard)/dupleta/page.tsx:1"),
      c("dupleta", "celda", "celda_carreras", "Ver las carreras disponibles", "lectura", "src/components/dupletas/DupletaModule.tsx:52"),
      c("dupleta", "funcion", "fn_armar_dupleta", "Armar una dúpleta", "escritura", "src/lib/dupletas.ts:51"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "taquilla",
    nombre: "Taquilla",
    ruta: "/taquilla",
    icono: "cart",
    descripcion: "Venta de jugadas y boletos al cliente.",
    capacidades: [
      c("taquilla", "ruta", "ruta_taquilla", "Ver Taquilla", "lectura", "src/app/(dashboard)/taquilla/page.tsx:1"),
      c("taquilla", "boton", "btn_registrar_jugada", "Registrar una jugada", "escritura", "src/components/taquilla/PagarCarreraModal.tsx", {
        descripcion: "Descuenta saldo del cliente y emite el boleto.",
      }),
      c("taquilla", "boton", "btn_anular_ticket", "Anular un ticket", "critico", "src/lib/tickets.ts:104", {
        descripcion: "Devuelve el saldo al cliente.",
      }),
        c("taquilla", "boton", "btn_cargar_resultados", "Carga de Resultados (Ctrl+Y)", "critico", "src/components/liquidacion/CargaResultadosModal.tsx:77", {
        descripcion: "Formulario presentacional: escribe a través de la función de liquidación, no directo a la BD.",
      }),
      c("taquilla", "modal", "modal_pagar", "Modal de pago de carrera", "critico", "src/components/taquilla/PagarCarreraModal.tsx"),
        c("taquilla", "modal", "modal_carga_resultados", "Modal de carga de resultados", "critico", "src/components/liquidacion/CargaResultadosModal.tsx:77"),
      c("taquilla", "celda", "celda_boleto", "Ver los datos del boleto", "lectura", "src/components/taquilla/PagarCarreraModal.tsx"),
      // Se quitó `fn_guardar_llegadas`: la pizarra de llegadas NO tiene una
      // escritura propia. CargaResultadosModal solo deja el resultado en estado
      // de React; las ocho posiciones llegan a la base dentro de la liquidación
      // (`gestion_jugadas:fn_liquidar_carrera`). Declarar una capacidad de
      // escritura para algo que no existe deja un control que nunca se aplica.
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "tickets",
    nombre: "Tickets",
    ruta: "/tickets",
    icono: "ticket",
    descripcion: "Consulta de tickets emitidos.",
    capacidades: [
      c("tickets", "ruta", "ruta_tickets", "Ver Tickets", "lectura", "src/app/(dashboard)/tickets/page.tsx:1"),
      c("tickets", "celda", "celda_ticket", "Ver los datos de un ticket", "lectura", "src/components/tickets/TicketsModule.tsx", {
        descripcion: "Incluye monto, cliente y estado de liquidación.",
      }),
         c("tickets", "funcion", "fn_anular_ticket", "Anular ticket", "critico", "src/lib/tickets.ts:104"),
         c("tickets", "boton", "btn_tomar", "Tomar ticket para revisión", "escritura", "src/lib/tickets.ts:81", {
           descripcion: "Pasa el ticket de CREADO a EN_REVISION y lo asigna al que lo toma.",
           requiere: ["tickets:ruta_tickets", "tickets:celda_ticket"],
         }),
       ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "contabilidad",
    nombre: "Contabilidad",
    ruta: "/contabilidad",
    icono: "cash",
    descripcion: "Ingresos, caja, bancos y monedas.",
    capacidades: [
      c("contabilidad", "ruta", "ruta_contabilidad", "Ver Contabilidad", "lectura", "src/app/(dashboard)/contabilidad/page.tsx:8"),
      c("contabilidad", "ruta", "ruta_ingresos", "Ver Ingresos", "lectura", "src/app/(dashboard)/contabilidad/ingresos/page.tsx:8"),
      c("contabilidad", "ruta", "ruta_caja", "Ver Caja", "lectura", "src/app/(dashboard)/contabilidad/caja/page.tsx:8"),
      c("contabilidad", "ruta", "ruta_bancos", "Ver Bancos", "lectura", "src/app/(dashboard)/contabilidad/bancos/page.tsx:8"),
      c("contabilidad", "ruta", "ruta_monedas", "Ver Monedas", "lectura", "src/app/(dashboard)/contabilidad/monedas/page.tsx:8"),
      c("contabilidad", "boton", "btn_registrar_ingreso", "Registrar ingreso o aval", "critico", "src/components/contabilidad/ContabilidadTabs.tsx:248"),
      c("contabilidad", "boton", "btn_registrar_traslado", "Registrar traslado de caja", "critico", "src/components/contabilidad/ContabilidadTabs.tsx:605"),
      c("contabilidad", "boton", "btn_registrar_retiro", "Registrar retiro de caja", "critico", "src/components/contabilidad/ContabilidadTabs.tsx:605"),
      c("contabilidad", "boton", "btn_crear_banco", "Crear cuenta bancaria", "escritura", "src/components/contabilidad/ContabilidadTabs.tsx:761"),
      c("contabilidad", "boton", "btn_editar_banco", "Editar cuenta bancaria", "escritura", "src/components/contabilidad/ContabilidadTabs.tsx:793"),
      c("contabilidad", "boton", "btn_eliminar_banco", "Eliminar cuenta bancaria", "critico", "src/components/contabilidad/ContabilidadTabs.tsx:796", {
        descripcion: "Borrado duro del banco.",
        requiere: ["contabilidad:ruta_bancos"],
      }),
      c("contabilidad", "boton", "btn_registrar_tasa", "Registrar tasa de cambio", "escritura", "src/components/contabilidad/ContabilidadTabs.tsx:943"),
      c("contabilidad", "boton", "btn_crear_moneda", "Crear moneda", "escritura", "src/components/contabilidad/ContabilidadTabs.tsx:978"),
      c("contabilidad", "celda", "celda_movimientos", "Ver los movimientos de caja", "lectura", "src/components/contabilidad/ContabilidadTabs.tsx"),
      c("contabilidad", "funcion", "fn_registrar_movimiento", "Escribir un movimiento de caja", "critico", "src/lib/contabilidad.ts:445"),
      c("contabilidad", "funcion", "fn_registrar_tasa", "Escribir la tasa de cambio o de referencia", "escritura", "src/lib/contabilidad.ts:182", {
        descripcion:
          "La tasa manda sobre el valor de todo lo que se registre después, así que se separa del botón de la UI.",
      }),
      c("contabilidad", "funcion", "fn_eliminar_banco", "Eliminar banco", "critico", "src/lib/contabilidad.ts:183"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "portal",
    nombre: "Portal del Cliente",
    ruta: "/portal",
    icono: "user",
    descripcion: "Acceso del cliente: jugar, ver saldos y tickets.",
    capacidades: [
      c("portal", "ruta", "ruta_portal", "Entrar al Portal del Cliente", "lectura", "src/app/portal/page.tsx:1"),
      c("portal", "boton", "btn_jugar", "Registrar una jugada en el portal", "escritura", "src/components/portal/PortalModule.tsx"),
      c("portal", "celda", "celda_saldo_portal", "Ver el saldo del portal", "lectura", "src/components/portal/PortalModule.tsx"),
      c("portal", "funcion", "fn_operar_portal", "Operar el portal del cliente", "escritura", "src/lib/portal.ts:196"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "whatsapp",
    nombre: "WhatsApp",
    ruta: "/whatsapp",
    icono: "chat",
    descripcion: "Avisos y mensajería por WhatsApp.",
    capacidades: [
      c("whatsapp", "ruta", "ruta_whatsapp", "Ver WhatsApp", "lectura", "src/app/(dashboard)/whatsapp/page.tsx:1"),
      c("whatsapp", "boton", "btn_enviar", "Enviar un aviso", "escritura", "src/components/whatsapp/WhatsappModule.tsx"),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "remates",
    nombre: "Remates",
    ruta: "/remates",
    icono: "bell",
    descripcion: "Subastas de ejemplares tomados del programa del día.",
    capacidades: [
      c("remates", "ruta", "ruta_remates", "Ver Remates", "lectura", "src/app/(dashboard)/remates/page.tsx:1", { ruta: "/remates" }),
      c("remates", "celda", "celda_ejemplares", "Ver los ejemplares del programa", "lectura", "src/components/remates/RematesModule.tsx"),
      c("remates", "funcion", "fn_guardar_remate", "Crear o editar un remate", "escritura", "src/lib/remates.ts"),
      c("remates", "funcion", "fn_eliminar_remate", "Eliminar un remate", "critico", "src/lib/remates.ts"),
      c("remates", "funcion", "fn_asignar_caballos", "Asignar ejemplares al remate", "escritura", "src/lib/remates.ts"),
      c("remates", "funcion", "fn_eliminar_caballo", "Quitar un ejemplar del remate", "escritura", "src/lib/remates.ts"),
      c("remates", "funcion", "fn_pujar", "Pujar con el botón Subir", "escritura", "src/lib/remates.ts", {
        descripcion:
          "Sube la puja de un ejemplar con el botón Subir. Es la ÚNICA escritura que puede hacer un usuario de solo consulta: no crea, no edita, no cierra y no puede comprar a nombre de otro (puja siempre con el cliente vinculado a su usuario).",
      }),
    ],
  },

  // --------------------------------------------------------------------------
  {
    clave: "pollas",
    nombre: "Pollas",
    ruta: "/pollas",
    icono: "target",
    descripcion:
      "Juego de aciertos por puntos sobre el programa del día: la casa elige carreras, puntos, precio y premios; el jugador compra combinaciones y gana quien más puntos suma.",
    capacidades: [
      c("pollas", "ruta", "ruta_pollas", "Ver Pollas", "lectura", "src/app/(dashboard)/pollas/page.tsx:1", { ruta: "/pollas" }),
      c("pollas", "boton", "btn_crear_polla", "Crear o editar una Polla", "escritura", "src/components/pollas/PollasModule.tsx"),
      c("pollas", "boton", "btn_registrar_venta", "Registrar una venta de Polla", "escritura", "src/components/pollas/PollasModule.tsx"),
      c("pollas", "boton", "btn_liquidar", "Liquidar la Polla y pagar premios", "critico", "src/components/pollas/PollasModule.tsx"),
      c("pollas", "boton", "btn_marcar_invalido", "Invalidar un ejemplar solo para Pollas", "escritura", "src/components/pollas/PollasModule.tsx", {
        descripcion:
          "El ejemplar no se puede colocar en una Polla pero sigue corriendo en Tablas, Marcas, Taquilla, Gestión y Remates. Es distinto de retirarlo, que lo saca de todos los módulos.",
      }),
      c("pollas", "funcion", "fn_guardar_polla", "Guardar la Polla por RPC", "escritura", "sql/pollas.sql"),
      c("pollas", "funcion", "fn_registrar_venta", "Registrar la venta y sus combinaciones", "escritura", "sql/pollas.sql"),
      c("pollas", "funcion", "fn_liquidar_polla", "Liquidar, mover y pagar el acumulado", "critico", "sql/pollas.sql", {
        descripcion:
          "Mueve el saldo del acumulado y marca a quién se le pagó. La guarda de la RPC impide que el mismo acumulado se pague dos veces.",
      }),
    ],
  },
];

// ============================================================================
// ÍNDICES Y BÚSQUEDA
// ============================================================================

/** Todas las capacidades, aplanadas. */
export const CAPACIDADES: Capacidad[] = MODULOS_ESQUEMA.flatMap((m) => m.capacidades);

/** Índice por clave: la vía rápida que consulta la UI en cada render. */
export const CAPACIDADES_POR_CLAVE: Map<string, Capacidad> = new Map(CAPACIDADES.map((x) => [x.clave, x]));

/** Capacidades de un módulo. */
export function capacidadesDeModulo(claveModulo: string): Capacidad[] {
  return CAPACIDADES.filter((x) => x.modulo === claveModulo);
}

/** Buscador del maestro: filtra por texto libre en título, descripción y clave. */
export function buscarCapacidades(texto: string, tipo?: TipoCapacidad): Capacidad[] {
  const q = texto.trim().toLowerCase();
  return CAPACIDADES.filter((x) => {
    if (tipo && x.tipo !== tipo) return false;
    if (!q) return true;
    return (
      x.clave.toLowerCase().includes(q) ||
      x.titulo.toLowerCase().includes(q) ||
      x.descripcion.toLowerCase().includes(q)
    );
  });
}

/** Etiquetas legibles de cada tipo de capacidad. */
export const ETIQUETA_TIPO: Record<TipoCapacidad, string> = {
  ruta: "Ruta",
  boton: "Botón",
  modal: "Modal",
  celda: "Celda",
  campo: "Campo",
  funcion: "Función",
};

/** Etiquetas de riesgo, ordenadas de menos a más grave. */
export const ETIQUETA_RIESGO: Record<Riesgo, string> = {
  lectura: "Lectura",
  escritura: "Escritura",
  critico: "Crítico",
};

/**
 * Capacidad de tipo "ruta" de un módulo: la que el middleware y `RutaProtegida`
 * exigen para dejar entrar a la pantalla. Derivada del esquema, no escrita a
 * mano, para que no se desincronice.
 */
export function permisoDeRuta(claveModulo: string): string {
  const m = MODULOS_ESQUEMA.find((x) => x.clave === claveModulo);
  const primera = m?.capacidades.find((x) => x.tipo === "ruta");
  return primera?.clave ?? `${claveModulo}:ruta`;
}

/**
 *Puertas de entrada a la plataforma: qué ruta exige qué capacidad.
 *
 * El middleware y las páginas consultan ESTA tabla, que sale del esquema. Si un
 * módulo nuevo se registra en el maestro, acá queda cubierto solo: no hay una
 * segunda lista que mantener.
 *
 * "algunas" = acceso con una sola de ellas (lectura o escritura sobre lo mismo).
 */
export const PUERTAS: Array<{
  ruta: string;
  capacidad?: string;
  algunas?: string[];
  publica?: boolean;
  acceso?: boolean;
}> = [
  // La raíz ES el login. Se lo modela como puerta pública explícita y no como
  // "sin puerta": una ruta sin entrada en PUERTAS se NIEGA (ver rutaPermitida),
  // así que sin esta declaración "/" quedaría cerrada y el usuario vería el
  // spinner en vez del formulario. `/login` se conserva como acceso directo por
  // enlace viejo.
  // `acceso` marca las pantallas DONDE SE ESCRIBE LA CONTRASEÑA. No es lo mismo
  // que `publica`: /reset-password también se abre sin sesión, pero si al
  // renovar el token se redirigiera al escritorio, el operador perdería la
  // página a medio cambiar la clave. "Pública" y "pantalla de acceso" son dos
  // preguntas distintas y por eso son dos banderas.
  { ruta: "/", publica: true, acceso: true },
  { ruta: "/login", publica: true, acceso: true },
  // La página donde se pone la contraseña nueva. Es pública por necesidad: se
  // abre desde el enlace del correo, o sea sin sesión, y la
  // autorización real la lleva la sesión de recuperación de Supabase, que es
  // de un solo uso y vence. La página sola no cambia ninguna contraseña: sin
  // esa sesión, `updateUser()` no tiene a quién y no hace nada.
  { ruta: "/reset-password", publica: true },
  { ruta: "/dashboard", capacidad: "general:ruta_dashboard" },
  { ruta: "/seguridad", capacidad: "seguridad:ruta_seguridad" },
  // Diagnóstico es una utilidad de sanidad del sistema (matriz de carreras,
  // catalogue de hipódromos, SQL pendientes). Se entra con la misma puerta que
  // Seguridad para no inventar una capacidad que nadie tiene en la base: es la
  // herramienta de quien administra, no una pantalla de operación.
  { ruta: "/diagnostico", capacidad: "seguridad:ruta_seguridad" },
  { ruta: "/clientes", capacidad: "clientes:ruta_clientes" },
  { ruta: "/grupos", capacidad: "grupos:ruta_grupos" },
  { ruta: "/hipodromos", capacidad: "hipodromos:ruta_hipodromos" },
  { ruta: "/ejemplares", capacidad: "ejemplares:ruta_ejemplares" },
  { ruta: "/carreras", capacidad: "carreras:ruta_carreras" },
  { ruta: "/gestion-jugadas", capacidad: "gestion_jugadas:ruta_gestion" },
  { ruta: "/jugadas", capacidad: "jugadas:ruta_jugadas" },
  { ruta: "/tablas-fijas", capacidad: "tablas:ruta_tablas" },
  { ruta: "/marcas", capacidad: "marcas:ruta_marcas" },
  { ruta: "/dupleta", capacidad: "dupleta:ruta_dupleta" },
  { ruta: "/taquilla", capacidad: "taquilla:ruta_taquilla" },
  { ruta: "/tickets", capacidad: "tickets:ruta_tickets" },
  { ruta: "/contabilidad", capacidad: "contabilidad:ruta_contabilidad" },
  { ruta: "/contabilidad/ingresos", capacidad: "contabilidad:ruta_ingresos" },
  { ruta: "/contabilidad/caja", capacidad: "contabilidad:ruta_caja" },
  { ruta: "/contabilidad/bancos", capacidad: "contabilidad:ruta_bancos" },
  { ruta: "/contabilidad/monedas", capacidad: "contabilidad:ruta_monedas" },
  { ruta: "/inicio", capacidad: "general:ruta_inicio" },
  { ruta: "/saldos-reportes", capacidad: "general:ruta_saldos" },
  { ruta: "/whatsapp", capacidad: "whatsapp:ruta_whatsapp" },
  { ruta: "/remates", capacidad: "remates:ruta_remates" },
  { ruta: "/pollas", capacidad: "pollas:ruta_pollas" },
  { ruta: "/portal", capacidad: "portal:ruta_portal" },
];

/** Todas las rutas de la plataforma, para el matcher del middleware. */
export const RUTAS_PROTEGIDAS: string[] = [...new Set(PUERTAS.map((p) => p.ruta))];

/**
 * La puerta que gobierna una ruta, o null si no está registrada.
 * Coincide la más larga: /contabilidad/caja gana sobre /contabilidad.
 *
 * OJO con "/": `pathname.startsWith("//")` nunca es true, así que la raíz solo
 * captura la ruta raíz exacta y no se convierte en comodín de todo el sitio.
 */
export function puertaDeRuta(pathname: string): (typeof PUERTAS)[number] | null {
  return (
    PUERTAS.filter((x) => pathname === x.ruta || pathname.startsWith(`${x.ruta}/`)).sort(
      (a, b) => b.ruta.length - a.ruta.length
    )[0] ?? null
  );
}

/**
 * ¿Esta ruta se abre sin sesión?
 *
 * Sale de `PUERTAS`, no de una lista escrita a mano en el componente. La lista
 * hardcodeada ya rompió el sistema una vez: `AppShell` comparaba contra
 * `"/" | "/login"` y `AuthBootstrap` contra `"/login"`, así que al agregar
 * `/reset-password` quedó una página pública que el shell envolvía con el menú
 * y que además redirigía al login. El enlace de recuperación de contraseña
 * llegaba a una página que lo expulsaba antes de poder cambiar la clave. Una
 * sola fuente, y que todo el que pregunta lea de acá.
 */
export function esRutaPublica(pathname: string): boolean {
  return puertaDeRuta(pathname)?.publica === true;
}

/**
 * ¿Esta ruta es una pantalla donde se ingressa la contraseña?
 *
 * Es un subconjunto de las públicas: las dos que renderizan `PantallaLogin`.
 * Lo que tenga sesión y esté acá, va al escritorio. Lo que sea pública pero NO
 * de acceso —`/reset-password`— se queda donde está: mandar a esa pantalla al
 * dashboard en medio de una recuperación deja al operador sin poder terminar.
 */
export function esPantallaDeAcceso(pathname: string): boolean {
  return puertaDeRuta(pathname)?.acceso === true;
}

/**
 * La capacidad que exige una ruta, o null si la ruta no está registrada o es
 * pública. Null y "exige algo" son cosas distintas: el login no exige nada, y
 * quien llame tiene que poder distinguirlo de una ruta protegida.
 */
export function capacidadDeRuta(pathname: string): string | null {
  const p = puertaDeRuta(pathname);
  if (!p) return null;
  if (p.publica) return null;
  if (p.algunas?.length) return p.algunas[0];
  return p.capacidad ?? null;
}

/** Si la ruta puede abrirse con cualquiera de estas capacidades. */
export function capacidadesDeRuta(pathname: string): string[] {
  const p = puertaDeRuta(pathname);
  if (!p) return [];
  if (p.publica) return [];
  if (p.algunas?.length) return p.algunas;
  return p.capacidad ? [p.capacidad] : [];
}

/**
 * Decide si un set de capacidades abre una ruta. Fuente ÚNICA de la decisión,
 * para que el middleware (que corre antes de renderizar) y `RutaProtegida`
 * (que corre en el cliente) nunca discrepen: si discreparan, el usuario ve la
 * redirección del middleware o, peor, la página que el middleware dejó pasar.
 *
 * `registrada: false` significa que la ruta NO está en el maestro, y se niega.
 * Antes una ruta sin puerta pasaba: una página nueva sin declarar se abría por
 * URL directa sin comprobar nada.
 */
export function rutaPermitida(pathname: string, permisos: Set<string> | string[]): boolean {
  const p = puertaDeRuta(pathname);
  if (!p) return false;
  // Puerta pública (el login): no exige ninguna capacidad. Solo la pueden
  // abrir rutas declaradas como tales acá; no es un atajo para lo demás.
  if (p.publica) return true;
  if (!p.capacidad) return false;
  const set = permisos instanceof Set ? permisos : new Set(permisos);
  return p.algunas?.length
    ? p.algunas.some((c) => set.has(c))
    : set.has(p.capacidad);
}

/**
 * PRIMERA ruta que este usuario puede abrir, o null si no puede abrir ninguna.
 *
 * Para dónde va quien intentó entrar a algo que no le corresponde. Se recorre el
 * registro en su orden, que es el del menú: cada quien aterriza en la primera
 * pantalla que de verdad puede ver.
 *
 * Existe por el bucle de redirecciones: el destino fijo era `/dashboard`, que
 * exige `general:ruta_dashboard`. Un operador con permisos —de Taquilla, de
 * Marcas, del Portal— no la tiene, así que el middleware lo echaba de
 * `/dashboard` a `/dashboard`, para siempre. Con cero capacidades no hay
 * destino válido y se devuelve null: el que llama debe mandarlo al login.
 */
export function primeraRutaPermitida(permisos: Set<string> | string[]): string | null {
  const set = permisos instanceof Set ? permisos : new Set(permisos);
  for (const p of PUERTAS) {
    if (p.publica) continue;
    if (rutaPermitida(p.ruta, set)) return p.ruta;
  }
  return null;
}

/** Todo lo que el portal necesita para funcionar y nada más. */
const CAPS_PORTAIL = ["portal:ruta_portal", "portal:btn_jugar", "portal:celda_saldo_portal"];

/**
 * ¿Es un usuario "cliente/jugador" puro, que solo puede ver el portal?
 *
 * Vive acá y no en el middleware porque es una decisión del MAESTRO —igual que
 * `rutaPermitida`— y las dos capas (servidor y cliente) tienen que responder lo
 * mismo: si el middleware lo echara del escritorio pero `RutaProtegida` lo
 * dejara entrar, el usuario vería una página a la que según el servidor no
 * puede llegar.
 *
 * Solo cuenta como cliente puro si NO tiene ninguna capacidad fuera del portal:
 * alguien con perfil "cliente" y un permiso de administration opera como
 * administrador, no como jugador.
 */
export function esRolCliente(perfil: string, permisos: Set<string> | string[]): boolean {
  const nombres = perfil
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!nombres.some((n) => n === "cliente" || n === "jugador")) return false;
  const set = permisos instanceof Set ? permisos : new Set(permisos);
  return ![...set].some((p) => !CAPS_PORTAIL.includes(p));
}
