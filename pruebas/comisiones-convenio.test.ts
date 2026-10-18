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
  CONCEPTOS_CONVENIO,
  agruparPorGrupo,
  columnasConvenioDesde,
  comisionEnDinero,
  comisionPctDeGrupo,
  consolidarReporte,
  esConcepto,
  montoDecidido,
  productoDeNota,
  productoDeTicket,
  redondear2,
  totalesPorMoneda,
  valoresConvenioDeGrupo,
  valoresConvenioInicial,
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
  ok(/comision_marcas: editando\.comision_marcas/.test(mod), "la edición manda el % pactado");
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

console.log(`\nTODO ${fallan === 0 ? "OK" : "FALLA"}: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
