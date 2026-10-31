// ============================================================================
// PRUEBAS DE AUTOMATIZACIÓN: USUARIOS CONECTADOS, ACTIVIDAD Y RETENCIÓN 10 DÍAS
// ============================================================================
// Verifica:
//   1. Seguimiento de usuarios conectados en tiempo real y latidos.
//   2. Cálculo y formateo del tiempo de conexión activa.
//   3. Registro y consulta de páginas visitadas por usuario.
//   4. Registro y consulta de acciones operativas ejecutadas por usuario.
//   5. Limpieza automática estricta cada 10 días (purga de registros antiguos).
//   6. Integración en la Matriz de Seguridad y sección de usuario.
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatearNombreRuta,
  formatearDuracion,
  registrarLatidoPresencia,
  registrarActividad,
  consultarUsuariosConectados,
  consultarActividadUsuario,
  purgarActividadAntigua10Dias,
} from "../src/features/seguridad/lib/seguimiento-usuarios";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ✅ ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  ❌ FALLA ${nombre}`);
  }
}

// Mock simple de window y localStorage para pruebas Node.js
if (typeof window === "undefined") {
  const store: Record<string, string> = {};
  (global as any).window = {
    location: { pathname: "/tablas" },
    navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0" },
  };
  (global as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

async function ejecutarPruebas() {
  console.log("\n=======================================================");
  console.log("🏁 PRUEBAS: USUARIOS CONECTADOS, ACTIVIDAD Y RETENCIÓN 10 DÍAS");
  console.log("=======================================================\n");

  const raiz = process.cwd();

  // --------------------------------------------------------------------------
  // 1. FORMATEO DE RUTAS Y TIEMPO DE CONEXIÓN
  // --------------------------------------------------------------------------
  console.log("[1] FORMATEO Y NOMBRES AMIGABLES DE PÁGINAS Y DURACIÓN");

  ok("Ruta /tablas normalizada a 'Tablas Fijas'", formatearNombreRuta("/tablas").includes("Tablas Fijas"));
  ok("Ruta /carreras normalizada a 'Carreras del Día'", formatearNombreRuta("/carreras").includes("Carreras del Día"));
  ok("Ruta /reportes normalizada a 'Reportes'", formatearNombreRuta("/reportes").includes("Reportes"));
  ok("Ruta /remates normalizada a 'Remates'", formatearNombreRuta("/remates").includes("Remates"));
  ok("Ruta /seguridad normalizada a 'Matriz de Seguridad'", formatearNombreRuta("/seguridad").includes("Matriz de Seguridad"));
  ok("Ruta raíz / normalizada a 'Inicio'", formatearNombreRuta("/").includes("Inicio"));

  ok("formatearDuracion(30000) es 30s", formatearDuracion(30000) === "30s");
  ok("formatearDuracion(90000) es 1m 30s", formatearDuracion(90000) === "1m 30s");
  ok("formatearDuracion(3600000) es 1h 0m", formatearDuracion(3600000) === "1h 0m");
  ok("formatearDuracion(7500000) es 2h 5m", formatearDuracion(7500000) === "2h 5m");

  // --------------------------------------------------------------------------
  // 2. REGISTRO DE LATIDOS Y CONSULTA DE USUARIOS CONECTADOS
  // --------------------------------------------------------------------------
  console.log("\n[2] REGISTRO DE PRESENCIA Y TIEMPO DE CONEXIÓN");

  await registrarLatidoPresencia({
    usuarioId: "operador_demo",
    nombre: "Operador Demo",
    rol: "Operador de Taquilla",
    grupoId: "1",
    paginaActual: "/tablas",
  });

  await registrarLatidoPresencia({
    usuarioId: "admin_general",
    nombre: "Administrador General",
    rol: "Admin",
    grupoId: null,
    paginaActual: "/seguridad",
  });

  const conectados = await consultarUsuariosConectados();
  ok("consultarUsuariosConectados devuelve al menos 2 sesiones", conectados.length >= 2);

  const opDemo = conectados.find((u) => u.usuarioId === "operador_demo");
  ok("operador_demo encontrado en lista de conectados", !!opDemo);
  ok("operador_demo marcado como online", opDemo?.online === true);
  ok("operador_demo tiene tiempo de conexión", !!opDemo?.tiempoConexionTexto);
  ok("operador_demo tiene página actual /tablas", opDemo?.paginaActual === "/tablas");

  const adm = conectados.find((u) => u.usuarioId === "admin_general");
  ok("admin_general encontrado en lista de conectados", !!adm);
  ok("admin_general marcado como online", adm?.online === true);

  // --------------------------------------------------------------------------
  // 3. REGISTRO DE PÁGINAS QUE VISITA Y ACCIONES QUE EJECUTA
  // --------------------------------------------------------------------------
  console.log("\n[3] PÁGINAS QUE VISITA Y ACCIONES QUE EJECUTA EL USUARIO");

  // Visita páginas
  await registrarActividad({
    usuarioId: "operador_demo",
    tipo: "PAGINA",
    ruta: "/tablas",
  });
  await registrarActividad({
    usuarioId: "operador_demo",
    tipo: "PAGINA",
    ruta: "/reportes",
  });

  // Ejecuta acciones
  await registrarActividad({
    usuarioId: "operador_demo",
    tipo: "ACCION",
    accion: "Venta de Tabla Fija #105",
    detalle: "Carrera 4 - Gulfstream Park - Monto: 100",
  });
  await registrarActividad({
    usuarioId: "operador_demo",
    tipo: "ACCION",
    accion: "Consulta de Reporte Diario de Ventas",
    detalle: "Filtro grupo 1",
  });

  const historialOp = await consultarActividadUsuario("operador_demo");
  ok("operador_demo tiene al menos 2 páginas visitadas", historialOp.paginas.length >= 2);
  ok("operador_demo tiene al menos 2 acciones ejecutadas", historialOp.acciones.length >= 2);

  const pagTablas = historialOp.paginas.find((p) => p.ruta === "/tablas");
  ok("Página /tablas registrada en el historial del usuario", !!pagTablas);

  const accVenta = historialOp.acciones.find((a) => a.accion?.includes("Venta de Tabla"));
  ok("Acción de venta registrada con detalle", !!accVenta && (accVenta.detalle ?? "").includes("Gulfstream"));

  // --------------------------------------------------------------------------
  // 4. RETENCIÓN Y LIMPIEZA AUTOMÁTICA CADA 10 DÍAS
  // --------------------------------------------------------------------------
  console.log("\n[4] PURGA AUTOMÁTICA DE REGISTROS DE MÁS DE 10 DÍAS");

  // Inyectar artificialmente registros con más de 10 días (ej. 12 días atrás)
  const fecha12DiasAtras = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
  const rawAct = JSON.parse(localStorage.getItem("hipico_track_actividad_v1") || "[]");
  rawAct.push({
    id: "antiguo_1",
    usuarioId: "operador_demo",
    tipo: "PAGINA",
    ruta: "/ruta_vieja_12d",
    fecha: fecha12DiasAtras,
  });
  rawAct.push({
    id: "antiguo_2",
    usuarioId: "operador_demo",
    tipo: "ACCION",
    accion: "Acción obsoleta de hace 12 días",
    fecha: fecha12DiasAtras,
  });
  localStorage.setItem("hipico_track_actividad_v1", JSON.stringify(rawAct));

  // Ejecutar purga de 10 días
  const eliminados = await purgarActividadAntigua10Dias();
  ok("purgarActividadAntigua10Dias eliminó los registros de más de 10 días", eliminados >= 2);

  // Verificar que los registros de más de 10 días ya no aparecen
  const historialPostPurga = await consultarActividadUsuario("operador_demo");
  const existeViejo = historialPostPurga.paginas.some((p) => p.ruta === "/ruta_vieja_12d");
  ok("Registros mayores a 10 días fueron eliminados del historial", existeViejo === false);
  ok("Registros recientes de menos de 10 días se conservaron intactos", historialPostPurga.paginas.length >= 2);

  // --------------------------------------------------------------------------
  // 5. COMPONENTES Y VINCULACIÓN EN LA MATRIZ DE SEGURIDAD
  // --------------------------------------------------------------------------
  console.log("\n[5] COMPONENTES Y MATRIZ DE SEGURIDAD");

  const seguridadSrc = readFileSync(join(raiz, "src", "features", "seguridad", "components", "SeguridadModule.tsx"), "utf8");
  ok("SeguridadModule incluye pestaña 'Usuarios Conectados & Actividad'", seguridadSrc.includes("Usuarios Conectados & Actividad"));
  ok("SeguridadModule renderiza SeccionUsuariosConectados", seguridadSrc.includes("<SeccionUsuariosConectados"));
  ok("SeguridadModule tiene sub-vista de conexiones en sección de usuarios", seguridadSrc.includes("Conexiones y Actividad en Vivo"));
  ok("SeguridadModule menciona regla de retención de 10 días", seguridadSrc.includes("10 días"));

  const seccionConectadosSrc = readFileSync(join(raiz, "src", "features", "seguridad", "components", "SeccionUsuariosConectados.tsx"), "utf8");
  ok("SeccionUsuariosConectados muestra tiempo conectado", seccionConectadosSrc.includes("Tiempo conectado"));
  ok("SeccionUsuariosConectados muestra páginas que visita", seccionConectadosSrc.includes("Páginas que Visita"));
  ok("SeccionUsuariosConectados muestra acciones que ejecuta", seccionConectadosSrc.includes("Acciones que Ejecuta"));
  ok("SeccionUsuariosConectados incluye botón de purga de 10 días", seccionConectadosSrc.includes("&gt;10 días"));

  const sqlSrc = readFileSync(join(raiz, "sql", "usuarios_actividad_sesiones.sql"), "utf8");
  ok("Script SQL define tabla usuario_sesion", sqlSrc.includes("create table if not exists public.usuario_sesion"));
  ok("Script SQL define tabla usuario_actividad", sqlSrc.includes("create table if not exists public.usuario_actividad"));
  ok("Script SQL define función de purga club_purgar_actividad_10_dias", sqlSrc.includes("club_purgar_actividad_10_dias"));
  ok("Script SQL purga con intervalo de 10 days", sqlSrc.includes("10 days"));

  const authBootstrapSrc = readFileSync(join(raiz, "src", "features", "auth", "components", "AuthBootstrap.tsx"), "utf8");
  ok("AuthBootstrap registra páginas visitadas en cada cambio de ruta", authBootstrapSrc.includes("registrarVisitaPagina"));
  ok("AuthBootstrap emite latido de presencia periódicamente", authBootstrapSrc.includes("registrarLatidoPresencia"));
  ok("AuthBootstrap ejecuta purga automática de 10 días", authBootstrapSrc.includes("purgarActividadAntigua10Dias"));

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`📊 RESULTADO DE LA SUITE: ${pasan} pasaron, ${fallan} fallaron.`);
  console.log("=======================================================\n");

  if (fallan > 0) {
    process.exit(1);
  }
}

void ejecutarPruebas();
