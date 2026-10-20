// ============================================================================
// COMISIÓN POR CONVENIO DE PRODUCTO — núcleo + cableado.
//
// El dueño pidió separar la comisión de las jugadas ENTRE TERCIOS de la de cada
// producto (marcas, tablas fijas, remates, polla, WPS, dupletas): el grupo
// PRINCIPAL coloca la jugada habilitada para los jugadores de todos los grupos y
// le PAGA al grupo cuyo cliente compró el % pactado sobre el MONTO DECIDIDO.
//
// Acá se blinda el núcleo PURO (`comisiones-convenio.ts`): clasificación de cada
// ticket por su `origen`, herencia del % por producto, consolidación del reporte
// por grupo/producto/moneda y la conversión formulario ⇄ columnas. Además se
// comprueba, leyendo los fuentes, que el % nuevo SÍ se persiste (SQL + RPC + edge
// function) y que la UI lo usa en el alta, la edición y el reporte.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLUMNAS_DETALLE,
  CONCEPTOS_CONVENIO,
  agruparPorGrupo,
  columnasConvenioCompletas,
  columnasConvenioDesde,
  comisionDeDetalle,
  comisionEnDinero,
  comisionPctDeGrupo,
  consolidarReporte,
  csvDetalle,
  esConcepto,
  fechaEnRango,
  fechaLegible,
  filtrarDetalle,
  formatearDinero,
  hoyLocalISO,
  kpisDeDetalle,
  matrizDetalle,
  montoDecidido,
  productoDeNota,
  productoDeTicket,
  redondear2,
  textoReporteWhatsApp,
  totalesPorMoneda,
  valoresConvenioDeGrupo,
  valoresConvenioInicial,
  type DetalleJugada,
  type GrupoComisiones,
} from "../src/features/grupos/lib/comisiones-convenio";

let pasan = 0;
let fallan = 0;
const ok = (c: boolean, m: string) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}`);
  }
};
const raiz = process.cwd();

// ---------------------------------------------------------------------------
console.log("\n[1] Producto de un ticket por su `origen`/`modalidad`");
// ---------------------------------------------------------------------------
// El `origen` lo escribe cada RPC en `nota_auditoria`. Clasificar mal un ticket
// aplica el % equivocado, así que se prueban todos los valores documentados.
{
  ok(productoDeTicket("TAQUILLA") === "entre_tercios", "TAQUILLA → entre tercios");
  ok(productoDeTicket("taquilla") === "entre_tercios", "no depende de mayúsculas");
  ok(productoDeTicket("MARCAS") === "marcas", "MARCAS → marcas");
  ok(productoDeTicket("TABLAS_FIJAS") === "tablas", "TABLAS_FIJAS → tablas");
  ok(productoDeTicket("TABLAS") === "tablas", "TABLAS (legacy) → tablas");
  ok(productoDeTicket("REMATE") === "remates", "REMATE → remates");
  ok(productoDeTicket("REMATES") === "remates", "REMATES → remates");
  ok(productoDeTicket("DUPLETA") === "dupletas", "DUPLETA → dupletas");
  ok(productoDeTicket("DUPLETAS") === "dupletas", "DUPLETAS → dupletas");
  ok(productoDeTicket("POLLA") === "polla", "POLLA → polla");
  ok(productoDeTicket("POLLAS") === "polla", "POLLAS → polla");

  // WPS viaja por Taquilla con `modalidad='WPS'`, o migrado como WPS_LEGACY.
  ok(productoDeTicket("TAQUILLA", "WPS") === "wps", "TAQUILLA + modalidad WPS → wps");
  ok(productoDeTicket("WPS") === "wps", "origen WPS → wps");
  ok(productoDeTicket("WPS_LEGACY") === "wps", "origen WPS_LEGACY → wps");

  // No se adivina un producto: lo inclasificable no suma al reporte.
  ok(productoDeTicket("OTRO") === null, "origen desconocido → null");
  ok(productoDeTicket(null) === null, "origen nulo → null");
  ok(productoDeTicket("") === null, "origen vacío → null");
}

console.log("\n[2] Lectura de la nota de auditoría (texto o jsonb)");
{
  const a = productoDeNota('{"origen":"MARCAS"}');
  ok(a === "marcas", "nota de texto JSON → marcas");
  ok(productoDeNota('{"origen":"TABLAS_FIJAS"}') === "tablas", "nota JSON → tablas");
  ok(productoDeNota({ origen: "POLLA" }) === "polla", "nota ya object → polla");
  ok(productoDeNota('{"origen":"TAQUILLA","modalidad":"WPS"}') === "wps", "modalidad manda → wps");
  ok(productoDeNota("no-es-json") === null, "texto no JSON → null");
  ok(productoDeNota("{roto") === null, "JSON roto → null");
  ok(productoDeNota(null) === null, "nota nula → null");
  ok(productoDeNota(42) === null, "nota no textual → null");
}

console.log("\n[3] El monto del convenio es el MONTO DECIDIDO");
{
  ok(montoDecidido(100, 50) === 100, "usa el decidido cuando existe");
  ok(montoDecidido(0, 50) === 50, "si el decidido es 0 resbala al jugado");
  ok(montoDecidido(null, 50) === 50, "sin decidido → jugado (legacy)");
  ok(montoDecidido("120.5") === 120.5, "acepta el monto como texto");
  ok(montoDecidido(null, null) === 0, "sin montos → 0");
}

console.log("\n[4] % por grupo: propio, heredado y en cero");
{
  const base: GrupoComisiones = { id: "g", comision_default: 2.5 };
  ok(comisionPctDeGrupo(base, "entre_tercios") === 2.5, "entre tercios = comision_default");
  ok(comisionPctDeGrupo(base, "marcas") === 2.5, "producto sin pactar HEREDA el default");
  ok(comisionPctDeGrupo(base, "dupletas") === 2.5, "dupletas hereda el default");

  const propia: GrupoComisiones = { id: "g", comision_default: 2.5, comision_marcas: 1 };
  ok(comisionPctDeGrupo(propia, "marcas") === 1, "producto pactado usa su propio %");
  ok(comisionPctDeGrupo(propia, "tablas") === 2.5, "los no pactados siguen heredando");

  // 0 es un porcentaje VÁLIDO: no debe confundirse con "vacío" y heredar.
  const cero: GrupoComisiones = { id: "g", comision_default: 2.5, comision_marcas: 0 };
  ok(comisionPctDeGrupo(cero, "marcas") === 0, "un 0% pactado NO hereda");

  ok(comisionPctDeGrupo({ id: "g" }, "entre_tercios") === null, "sin default → null");
  ok(comisionPctDeGrupo({ id: "g" }, "marcas") === null, "sin default ni propio → null");
  ok(comisionPctDeGrupo(null, "marcas") === null, "grupo nulo → null");
}

console.log("\n[5] Comisión en dinero");
{
  ok(comisionEnDinero(1000, 2.5) === 25, "1000 al 2,5% = 25");
  ok(comisionEnDinero(100, 33.333) === 33.33, "redondea a 2 decimales");
  ok(comisionEnDinero(1000, 0) === 0, "0% → 0");
  ok(comisionEnDinero(1000, null) === 0, "sin % → 0");
  ok(comisionEnDinero(0, 5) === 0, "monto 0 → 0");
  ok(comisionEnDinero(-10, 5) === 0, "monto negativo → 0");
  ok(redondear2(1.005) >= 1 && redondear2(1.005) <= 1.01, "redondear2 es estable");
}

console.log("\n[6] Consolidación del reporte (por grupo, producto y moneda)");
{
  const grupos: GrupoComisiones[] = [
    { id: "p", nombre: "Principal", es_principal: true, comision_default: 2.5 },
    { id: "a", nombre: "Aliada", comision_default: 2.5, comision_marcas: 1 },
  ];
  const filas = consolidarReporte(
    [
      { grupoId: "a", producto: "marcas", moneda: "USD", monto: 1000 },
      { grupoId: "a", producto: "marcas", moneda: "USD", monto: 500 },
      { grupoId: "a", producto: "entre_tercios", moneda: "USD", monto: 2000 },
      { grupoId: "a", producto: "marcas", moneda: "VES", monto: 300 },
      { grupoId: "p", producto: "tablas", moneda: "USD", monto: 400 },
      { grupoId: "p", producto: "tablas", moneda: "USD", monto: 0 }, // no suma
    ],
    grupos
  );

  const buscar = (g: string, prod: string, mon: string) =>
    filas.find((f) => f.grupoId === g && f.producto === prod && f.moneda === mon);

  ok(filas.length === 4, `se armaron 4 filas (monto 0 descartado): ${filas.length}`);

  const marcasUsd = buscar("a", "marcas", "USD")!;
  ok(marcasUsd.tickets === 2, "marca/USD agrupa 2 tickets");
  ok(marcasUsd.monto === 1500, "marca/USD suma 1500");
  ok(marcasUsd.pct === 1, "usa el 1% pactado de la aliada");
  ok(marcasUsd.comision === 15, "1% de 1500 = 15");

  const tercio = buscar("a", "entre_tercios", "USD")!;
  ok(tercio.pct === 2.5 && tercio.comision === 50, "entre tercios al 2,5% → 50");

  const marcasVes = buscar("a", "marcas", "VES")!;
  ok(marcasVes.moneda === "VES" && marcasVes.comision === 3, "USD y VES no se mezclan");

  const tablas = buscar("p", "tablas", "USD")!;
  ok(tablas.pct === 2.5 && tablas.comision === 10, "el principal hereda el default: 10");
  ok(tablas.esPrincipal === true, "marca la fila del grupo principal");

  // Orden del núcleo: grupo alfabético y luego el orden del catálogo.
  ok(filas[0].grupo === "Aliada", "primero el grupo alfabético");
  ok(
    filas[0].producto === "entre_tercios" && filas[1].producto === "marcas",
    "dentro del grupo, entre tercios antes que marcas"
  );

  const totales = totalesPorMoneda(filas);
  ok(totales.length === 2, "hay totales por cada moneda");
  ok(totales[0].moneda === "USD" && totales[0].monto === 3900, "USD: 3900 decididos");
  ok(totales[0].comision === 75, "USD: 75 a pagar");
  ok(totales[1].moneda === "VES" && totales[1].comision === 3, "VES: 3 a pagar");

  const porGrupo = agruparPorGrupo(filas);
  ok(porGrupo.length === 2, "el reporte se agrupa por grupo");
  ok(porGrupo[0].grupo === "Aliada" && porGrupo[0].filas.length === 3, "Aliada trae sus 3 filas");
  ok(porGrupo[0].comision === 68, "Aliada acumula 68 (15+50+3)");
  ok(porGrupo[1].comision === 10, "Principal acumula 10");
}

console.log("\n[7] Conversión formulario ⇄ columnas (pura)");
{
  ok(CONCEPTOS_CONVENIO.length === 7, "son 7 conceptos");
  ok(CONCEPTOS_CONVENIO[0].clave === "entre_tercios", "entre tercios va primero");
  ok(CONCEPTOS_CONVENIO[0].propio === false, "entre tercios reutiliza comision_default");
  ok(esConcepto("marcas") && !esConcepto("otro"), "esConcepto valida contra el catálogo");

  const ini = valoresConvenioInicial("2.5");
  ok(ini.entre_tercios === "2.5" && ini.marcas === undefined, "estado inicial solo pisa entre tercios");

  const desde = valoresConvenioDeGrupo({ comision_default: 2.5, comision_marcas: 1 });
  ok(desde.entre_tercios === "2.5" && desde.marcas === "1", "lee las columnas del grupo");
  ok(desde.tablas === "", "columna ausente = vacío (hereda)");

  const conCero = columnasConvenioDesde({ entre_tercios: "2.5", marcas: "0" });
  ok(conCero.comision_default === 2.5 && conCero.comision_marcas === 0, "0% viaja como 0, no como null");
  ok(columnasConvenioDesde({ entre_tercios: "2.5", marcas: "1,5" }).comision_marcas === 1.5, "acepta coma decimal");
  ok(columnasConvenioDesde({ marcas: "" }).comision_marcas === null, "vacío = null (hereda)");
  ok(columnasConvenioDesde({ marcas: "-1" }).comision_marcas === null, "negativo → null (inválido)");
}

console.log("\n[7b] Payload COMPLETO de comisiones (guardado y reapertura del modal)");
{
  // El bug de guardado: la edición escribía solo las columnas "tocadas" y el
  // UPDATE/RPC quedaba a medias. `columnasConvenioCompletas` SIEMPRE devuelve
  // las 7 columnas para que Supabase reciba el payload entero.
  const completas = columnasConvenioCompletas({
    comision_default: 2.5,
    comision_marcas: 1.5,
    comision_tablas: 0,
    comision_remates: "",
    comision_polla: null,
  });
  ok(Object.keys(completas).length === 7, "viajan SIEMPRE las 7 columnas de comisión");
  ok(completas.comision_default === 2.5, "entre tercios conserva su %");
  ok(completas.comision_marcas === 1.5, "marcas conserva su %");
  ok(completas.comision_tablas === 0, "un 0% pactado viaja como 0 (no como null)");
  ok(completas.comision_remates === null, "vacío = null (hereda)");
  ok(completas.comision_polla === null, "columna ausente = null");
  ok(completas.comision_dupletas === null, "los no pactados quedan null");
  ok(
    columnasConvenioCompletas({ comision_marcas: 3 }).comision_default === 5,
    "entre tercios vacío no queda sin tasa: cae al default"
  );

  // Reapertura del modal: lo que la base guardó, leído de vuelta, pinta los
  // inputs con los mismos porcentajes (antes se veían los valores viejos).
  const reabierto = valoresConvenioDeGrupo(completas as unknown as Record<string, unknown>);
  ok(reabierto.entre_tercios === "2.5", "al reabrir, Entre Tercios muestra lo guardado");
  ok(reabierto.marcas === "1.5" && reabierto.tablas === "0", "al reabrir, los inputs muestran lo guardado");
  ok(reabierto.remates === "" && reabierto.dupletas === "", "los heredados se muestran vacíos");
}

console.log("\n[8] El % por producto se GUARDA (SQL, RPC y alta de grupos)");
{
  const sql = readFileSync(join(raiz, "sql", "grupos_comisiones_convenio.sql"), "utf8");
  const grupos = readFileSync(join(raiz, "src", "features", "grupos", "lib", "grupos.ts"), "utf8");
  const edge = readFileSync(
    join(raiz, "supabase", "functions", "crear-grupo", "index.ts"),
    "utf8"
  );
  const mod = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
    "utf8"
  );

  const columnas = [
    "comision_marcas",
    "comision_tablas",
    "comision_remates",
    "comision_polla",
    "comision_wps",
    "comision_dupletas",
  ];
  for (const col of columnas) {
    ok(
      new RegExp(`add column if not exists\\s+${col}\\b`).test(sql),
      `${col}: la agrega el ALTER idempotente`
    );
    ok(new RegExp(`\\b${col}\\b`).test(grupos), `${col}: está en GrupoRow/grupos.ts`);
    ok(new RegExp(`\\b${col}\\b`).test(edge), `${col}: la edge function la propaga`);
  }

  ok(/create or replace function public\.club_guardar_grupo/.test(sql), "redefine club_guardar_grupo");
  ok(/create or replace function public\.club_actualizar_grupo/.test(sql), "redefine club_actualizar_grupo");
  ok(/create or replace function public\.club_listar_grupos/.test(sql), "redefine club_listar_grupos");
  ok(/columnasConvenioDesde\(formConvenio\)/.test(mod), "el alta convierte el formulario a columnas");
  ok(/columnasConvenioCompletas\(editando/.test(mod), "la edición arma el payload COMPLETO de comisiones");
  ok(/comision_marcas:\s*comisiones\.comision_marcas/.test(mod), "la edición manda TODOS los % (marcas incluido)");
  ok(/await recargar\(\)[\s\S]*setEditando\(null\)/.test(mod), "recarga desde Supabase antes de cerrar el modal");
  ok(/Comisiones por convenio guardadas/.test(mod), "avisa con toast al guardar las comisiones");
  ok(/<ReporteComisionesConvenioModal/.test(mod), "el módulo abre el reporte de comisiones");
}

console.log("\n[9] El reporte liquida por grupo y producto");
{
  const reporte = readFileSync(
    join(raiz, "src", "features", "grupos", "lib", "reporte-comisiones.ts"),
    "utf8"
  );
  const modal = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "ReporteComisionesConvenioModal.tsx"),
    "utf8"
  );
  ok(/from\("tickets_apuestas"\)/.test(reporte), "lee los tickets de la base");
  ok(/from\("polla_ventas"\)/.test(reporte), "suma las pollas por separado");
  ok(/consolidarReporte/.test(reporte), "delega la consolidación al núcleo puro");
  ok(/agruparPorGrupo/.test(modal), "el modal agrupa el reporte por grupo");
  ok(/totalesPorMoneda/.test(modal), "el modal totaliza por moneda");
}

// ===========================================================================
// PROMPT #3 — REINGENIERÍA DE GRUPOS Y REPORTE DE COMISIONES POR CONVENIO
// ===========================================================================
console.log("\n[10] Detalle por jugada, filtros y KPIs (núcleo puro)");
{
  const filas: DetalleJugada[] = [
    {
      fecha: "2026-03-10", hipodromo: "La Rinconada", carrera: "3", cliente: "Ana",
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "marcas",
      detalle: "4 × 1", estado: "PAGADO", moneda: "USD", monto: 1000, pct: 5, comision: 50,
    },
    {
      fecha: "2026-03-11", hipodromo: "Valencia", carrera: "5", cliente: "Luis",
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "tablas",
      detalle: "7", estado: "PAGADO", moneda: "USD", monto: 2000, pct: 2.5, comision: 50,
    },
    {
      fecha: "2026-03-12", hipodromo: "La Rinconada", carrera: "3", cliente: "Eva",
      grupoId: "g2", grupo: "Grupo Dos", esPrincipal: false, producto: "marcas",
      detalle: "2", estado: "ANULADA", moneda: "USD", monto: 500, pct: 5, comision: 25,
    },
  ];

  ok(comisionDeDetalle({ monto: 1000, pct: 5 }) === 50, "comisión de detalle = monto × % / 100");
  ok(comisionDeDetalle({ monto: 1000, pct: 0 }) === 0, "0% no genera comisión");

  ok(fechaEnRango("2026-03-10", "2026-03-01", "2026-03-31") === true, "fecha dentro del rango");
  ok(fechaEnRango("2026-02-28", "2026-03-01", "2026-03-31") === false, "fecha antes del rango queda fuera");
  ok(fechaEnRango("2026-03-10") === true, "sin rango no discrimina");

  const porGrupo = filtrarDetalle(filas, { grupoId: "g1" });
  ok(porGrupo.length === 2 && porGrupo.every((f) => f.grupoId === "g1"), "filtro por grupo");

  const porHipodromo = filtrarDetalle(filas, { hipodromo: "valencia" });
  ok(porHipodromo.length === 1 && porHipodromo[0].cliente === "Luis", "filtro por hipódromo (sin mayúsculas)");

  const porCarrera = filtrarDetalle(filas, { carrera: "3" });
  ok(porCarrera.length === 2, "filtro por carrera");

  const porProducto = filtrarDetalle(filas, { producto: "tablas" });
  ok(porProducto.length === 1 && porProducto[0].producto === "tablas", "filtro por tipo de jugada (producto)");

  const porRango = filtrarDetalle(filas, { desde: "2026-03-11", hasta: "2026-03-11" });
  ok(porRango.length === 1 && porRango[0].fecha === "2026-03-11", "filtro por rango de fechas");

  const k = kpisDeDetalle(filas);
  ok(k.moneda === "USD", "KPI: moneda dominante");
  ok(k.volumen === 3500, "KPI: volumen total jugado");
  ok(k.decididas === 2, "KPI: jugadas decididas (PAGADO)");
  ok(k.jugadas === 3, "KPI: total de jugadas incluye no decididas");
  ok(k.comision === 125, "KPI: comisión total");
  ok(k.pctAplicado === 3.57, "KPI: % de convenio aplicado = comisión / volumen");

  ok(hoyLocalISO(new Date(2026, 2, 5)) === "2026-03-05", "hoyLocalISO sin desfase de zona horaria");
}

console.log("\n[11] Exportaciones: texto WhatsApp y matriz CSV (puro)");
{
  const k = kpisDeDetalle([
    {
      fecha: "2026-03-10", hipodromo: "La Rinconada", carrera: "3", cliente: "Ana",
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "marcas",
      detalle: "4 × 1", estado: "PAGADO", moneda: "USD", monto: 1000, pct: 5, comision: 50,
    },
  ]);
  const texto = textoReporteWhatsApp(k, [
    {
      fecha: "2026-03-10", hipodromo: "La Rinconada", carrera: "3", cliente: "Ana",
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "marcas",
      detalle: "4 × 1", estado: "PAGADO", moneda: "USD", monto: 1000, pct: 5, comision: 50,
    },
  ], { grupo: "Grupo Uno", desde: "2026-03-01", hasta: "2026-03-31" });

  ok(/REPORTE DE COMISIONES POR CONVENIO/.test(texto), "el texto de WhatsApp lleva el título");
  ok(/Grupo Uno/.test(texto), "el texto de WhatsApp nombra el grupo");
  ok(/10\/03\/2026/.test(texto), "el texto usa fecha legible DD/MM/AAAA");
  ok(/Ana/.test(texto), "el texto lista al cliente de la jugada");

  ok(formatearDinero(1234.5, "USD") === "$1.234,50", "formatea USD");
  ok(formatearDinero(1234.5, "VES") === "Bs 1.234,50", "formatea VES con Bs");
  ok(fechaLegible("2026-03-10") === "10/03/2026", "fechaLegible convierte ISO");
  ok(COLUMNAS_DETALLE[0] === "Fecha" && COLUMNAS_DETALLE.includes("% Convenio"), "columnas del detalle");

  const matriz = matrizDetalle([
    {
      fecha: "2026-03-10", hipodromo: "La Rinconada", carrera: "3", cliente: 'Ana, "la jefa"',
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "marcas",
      detalle: "4 × 1", estado: "PAGADO", moneda: "USD", monto: 1000, pct: 5, comision: 50,
    },
  ]);
  ok(matriz.length === 2 && matriz[1].length === COLUMNAS_DETALLE.length, "matriz = encabezado + fila");

  const csv = csvDetalle([
    {
      fecha: "2026-03-10", hipodromo: "La Rinconada", carrera: "3", cliente: 'Ana, "la jefa"',
      grupoId: "g1", grupo: "Grupo Uno", esPrincipal: false, producto: "marcas",
      detalle: "4 × 1", estado: "PAGADO", moneda: "USD", monto: 1000, pct: 5, comision: 50,
    },
  ]);
  ok(/\"Ana, \"\"la jefa\"\"\"/.test(csv), "el CSV escapa comas y comillas");
}

console.log("\n[12] Fila de grupo en UNA sola línea (Single-Row Layout)");
{
  const mod = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
    "utf8"
  );
  ok(
    /flex items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-line bg-slate-50/.test(mod),
    "la fila del grupo es una sola línea"
  );
  ok(!/whitespace-nowrap overflow-x-auto/.test(mod), "la fila ya NO tiene barra de desplazamiento horizontal");
  ok(/<LogoDisplay src=\{g\.logo_url\}/.test(mod), "la fila arranca con el logo del grupo");
  ok(/🎯 \{strNum\(g\.comision_default\)/.test(mod), "badge del % de Puestos (Entre Tercios)");
  ok(/CONCEPTOS_CONVENIO\.filter\(\(c\) => c\.propio\)\.map/.test(mod), "badges de % por producto del convenio");
  ok(/🔀 \{g\.permite_cruces !== false \? "Sí" : "No"\}/.test(mod), "estado de cruces en la fila");
  ok(/setReporteGrupo\(String\(g\.id\)\)/.test(mod), "botón de reporte por grupo en la fila");
  ok(/setEditarComisiones\(true\)/.test(mod), "botón de comisiones del grupo en la fila");
}

console.log("\n[13] Eliminada la sección «🤝 Convenios por Tipo de Jugada y Grupo»");
{
  const mod = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
    "utf8"
  );
  ok(!/Convenios por Tipo de Jugada y Grupo/.test(mod), "ya no existe la sección duplicada de convenios");
  ok(!/guardarConveniosGrupo/.test(mod), "el módulo ya no guarda convenios por tipo de jugada");
  ok(!/listarConveniosGrupo/.test(mod), "el módulo ya no lista convenios por tipo de jugada");
  ok(!/FilasConvenioEditable/.test(mod), "se retiró el tipo de filas de convenio por tipo de jugada");
  ok(!/const guardarConvenios =/.test(mod), "se retiró la función de guardado por tipo de jugada");
  ok(/Banquero por Modalidad/.test(mod), "la sección de banquero por modalidad se conserva");
  ok(/Seleccione un grupo para configurar su banquero/.test(mod), "el banquero conserva su propio selector de grupo");
}

console.log("\n[14] Reporte de comisiones: lector con detalle + exportaciones del modal");
{
  const lector = readFileSync(
    join(raiz, "src", "features", "grupos", "lib", "reporte-comisiones.ts"),
    "utf8"
  );
  const modal = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "ReporteComisionesConvenioModal.tsx"),
    "utf8"
  );
  const exp = readFileSync(
    join(raiz, "src", "features", "grupos", "lib", "reporte-comisiones-export.ts"),
    "utf8"
  );

  ok(/detalle: DetalleJugada\[\]/.test(lector), "el lector devuelve el detalle por jugada");
  ok(/filtrarDetalle/.test(lector), "el lector aplica los filtros al detalle");
  ok(/estadoDeTicket/.test(lector), "el lector deduce el estado del ticket");

  ok(/kpisDeDetalle/.test(modal), "el modal calcula los KPIs");
  ok(/Volumen jugado/.test(modal), "KPI de volumen jugado");
  ok(/Comisión a favor del grupo/.test(modal), "KPI de comisión a favor del grupo");
  ok(/% convenio aplicado/.test(modal), "KPI de % de convenio aplicado");
  ok(/Detalle de jugadas/.test(modal), "tabla detallada de jugadas");
  ok(/Enviar al grupo por WhatsApp/.test(modal), "botón de envío por WhatsApp");
  ok(/Copiar imagen PNG/.test(modal), "botón de copiar imagen PNG");
  ok(/Exportar Excel/.test(modal), "botón de exportar Excel");
  ok(/grupoFijoId/.test(modal), "el reporte admite el grupo fijo del admin de grupo");

  ok(/descargarExcel/.test(exp), "la capa navegador exporta Excel");
  ok(/imagenReportePng/.test(exp), "la capa navegador dibuja el PNG con canvas nativo");
  ok(/ClipboardItem/.test(exp), "copia el PNG al portapapeles con ClipboardItem");
}

console.log("\n[15] Pestañas: Grupos · Banquero · Tipos de Jugada");
{
  const mod = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
    "utf8"
  );
  ok(/useState<"grupos" \| "tipos" \| "banquero">/.test(mod), "el módulo tiene estado de pestaña activa");
  ok(/setPestana\(t\.clave\)/.test(mod), "los botones de pestaña cambian la vista");
  ok(/Grupos Registrados/.test(mod) && /Banquero por Modalidad/.test(mod) && /Tipos de Jugada/.test(mod),
     "las tres secciones conviven como pestañas");
  ok(/pestana === "grupos"/.test(mod), "el listado de grupos vive en su pestaña");
  ok(/pestana === "banquero"/.test(mod), "el banquero vive en su pestaña");
  ok(/pestana === "tipos"/.test(mod), "los tipos de jugada viven en su pestaña");
  ok(!/lg:grid-cols-2 gap-6/.test(mod), "ya no hay dos columnas apretadas: cada pestaña ocupa el ancho");
}

console.log(`\nTODO ${fallan === 0 ? "OK" : "FALLA"}: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
