// ============================================================================
// MENSAJERÍA CENTRALIZADA + LOGOS EN CALIENTE (núcleo puro).
//
// Protege las piezas sin navegador de las 2 mejoras del PROMPT #2:
//
//   1) Un solo núcleo de mensajería (`shared/lib/mensajeria`): los 4 tipos, su
//      ícono, su etiqueta y su clase CSS. Cualquier tipo desconocido cae a INFO
//      (nunca revienta la UI).
//   2) Logos en caliente (`shared/lib/logos`): `conCacheBust` agrega la marca
//      para forzar el repintado del `<img>` sin tocar el contenido guardado.
//
// También verifica que la mensajería y los logos estén CABLEADOS en los
// componentes reales (leídos del fuente): el ToastHost usa las clases `.msg-*`,
// el ConfirmHost reemplaza a window.confirm, y el LogoDisplay usa
// `object-contain` sin deformar.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLASE_MENSAJE,
  ETIQUETA_MENSAJE,
  ICONO_MENSAJE,
  TIPOS_MENSAJE,
  esTipoMensaje,
  normalizarTipo,
} from "../src/shared/lib/mensajeria";
import { conCacheBust, marcarLogosActualizados, versionLogosActual } from "../src/shared/lib/logos";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
};
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(
    JSON.stringify(a) === JSON.stringify(b),
    m,
    `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`
  );

const RAIZ = process.cwd();
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

console.log("\nMENSAJERÍA — los 4 tipos maestros");

igual([...TIPOS_MENSAJE], ["success", "warning", "error", "info"], "existen exactamente 4 tipos");
igual(ICONO_MENSAJE.success, "✅", "SUCCESS lleva ✅");
igual(ICONO_MENSAJE.warning, "⚠️", "WARNING lleva ⚠️");
igual(ICONO_MENSAJE.error, "🚫", "ERROR lleva 🚫");
igual(ICONO_MENSAJE.info, "ℹ️", "INFO lleva ℹ️");

igual(CLASE_MENSAJE.success, "msg-success", "SUCCESS usa la clase centralizada");
igual(CLASE_MENSAJE.warning, "msg-warning", "WARNING usa la clase centralizada");
igual(CLASE_MENSAJE.error, "msg-error", "ERROR usa la clase centralizada");
igual(CLASE_MENSAJE.info, "msg-info", "INFO usa la clase centralizada");

igual(ETIQUETA_MENSAJE.error, "Error", "ERROR tiene etiqueta legible");

console.log("\nMENSAJERÍA — normalización defensiva");

igual(normalizarTipo("SUCCESS"), "success", "tipo con mayúsculas se normaliza");
igual(normalizarTipo("  warning  "), "warning", "tipo con espacios se normaliza");
igual(normalizarTipo("banana"), "info", "tipo desconocido cae a INFO");
igual(normalizarTipo(undefined), "info", "tipo ausente cae a INFO");
si(esTipoMensaje("error"), "esTipoMensaje reconoce 'error'");
si(!esTipoMensaje("otro"), "esTipoMensaje rechaza un tipo inválido");

console.log("\nLOGOS EN CALIENTE — cache-busting");

const dataUrl = "data:image/png;base64,AAAA";
igual(conCacheBust(null, 3), null, "logo vacío devuelve null");
igual(conCacheBust("", 3), null, "logo con string vacío devuelve null");
si(String(conCacheBust(dataUrl, 3)).startsWith(dataUrl), "el Data URL se conserva íntegro");
si(String(conCacheBust(dataUrl, 3)).endsWith("#v=3"), "agrega el fragmento #v=<marca>");
igual(
  conCacheBust(`${dataUrl}#v=1`, 7),
  `${dataUrl}#v=7`,
  "no apila fragmentos: reemplaza la marca vieja"
);
igual(
  conCacheBust("https://x/logo.png?a=1", 9),
  "https://x/logo.png?a=1&v=9",
  "si ya hay query usa & para la marca"
);
si(conCacheBust(dataUrl, 1) !== conCacheBust(dataUrl, 2), "distinta marca → distinto src (repinta el img)");

console.log("\nLOGOS EN CALIENTE — marca global avanza");

const antes = versionLogosActual();
const marca = marcarLogosActualizados();
si(marca > antes, "marcarLogosActualizados avanza la marca");
igual(versionLogosActual(), marca, "versionLogosActual refleja la última marca");

console.log("\nCABLEADO — ToastHost y ConfirmHost (leídos del fuente)");

const toastHost = leer("src/shared/components/ui/ToastHost.tsx");
si(/CLASE_MENSAJE/.test(toastHost), "ToastHost usa las clases centralizadas");
si(/ICONO_MENSAJE/.test(toastHost), "ToastHost pinta el ícono por tipo");
si(!/bg-emerald-50 text-emerald/.test(toastHost), "ToastHost ya no tiene colores improvisados");

const confirmHost = leer("src/shared/components/ui/ConfirmHost.tsx");
si(/useConfirmStore/.test(confirmHost), "ConfirmHost usa el store de confirmación");
si(/claseMarcoConfirm/.test(confirmHost), "ConfirmHost usa el marco de mensajería");

const appShell = leer("src/shared/components/layout/AppShell.tsx");
si(/<ConfirmHost\s*\/>/.test(appShell), "AppShell monta el ConfirmHost global");

console.log("\nCABLEADO — CSS centralizado y LogoDisplay");

const css = leer("src/app/globals.css");
si(/\.msg-success\s*\{/.test(css), "globals.css define .msg-success");
si(/\.msg-warning\s*\{/.test(css), "globals.css define .msg-warning");
si(/\.msg-error\s*\{/.test(css), "globals.css define .msg-error");
si(/\.msg-info\s*\{/.test(css), "globals.css define .msg-info");
si(/bg-emerald-950\/95/.test(css), "SUCCESS usa el fondo emerald-950/95 pedido");
si(/bg-amber-950\/95/.test(css), "WARNING usa el fondo amber-950/95 pedido");
si(/bg-rose-950\/95/.test(css), "ERROR usa el fondo rose-950/95 pedido");
si(/bg-indigo-950\/95/.test(css), "INFO usa el fondo indigo-950/95 pedido");

const logoDisplay = leer("src/shared/components/ui/LogoDisplay.tsx");
si(/object-contain/.test(logoDisplay), "LogoDisplay usa object-contain (no recorta)");
si(/useVersionLogos/.test(logoDisplay), "LogoDisplay escucha la versión de logos");
si(/conCacheBust/.test(logoDisplay), "LogoDisplay aplica cache-busting");

console.log("\nCABLEADO — propagación reactiva de logos");

const store = leer("src/shared/store/useHipodromosStore.ts");
si(/logos-updated/.test(store), "el store escucha el evento logos-updated");
si(/bumpLogos/.test(store), "el store expone bumpLogos");

const hipMod = leer("src/features/hipodromos/components/HipodromosModule.tsx");
si(/emitirLogosActualizados/.test(hipMod), "Hipódromos emite logos-updated al guardar");
si(!/window\.(confirm|alert)\s*\(/.test(hipMod), "Hipódromos ya no usa window.confirm");

const gruMod = leer("src/features/grupos/components/GruposModule.tsx");
si(/emitirLogosActualizados/.test(gruMod), "Grupos emite logos-updated al guardar");
si(!/[^.\w](window\.)?confirm\s*\(/.test(gruMod), "Grupos ya no usa confirm() del navegador");

console.log("\nSIN window.confirm/alert EN LOS MÓDULOS MIGRADOS");

for (const rel of [
  "src/features/reglas-jugadas/components/ReglasJugadasModule.tsx",
  "src/features/dupletas/components/DupletaModule.tsx",
  "src/features/marcas/components/ModalMarcasEditor.tsx",
  "src/features/ejemplares/components/GacetaIA.tsx",
  "src/features/remates/components/RematesModule.tsx",
  "src/features/tablas/components/EjemplarModal.tsx",
  "src/features/gestion/components/GestionJugadasModule.tsx",
  "src/features/contabilidad/components/ContabilidadTabs.tsx",
]) {
  const src = leer(rel);
  si(!/window\.(confirm|alert)\s*\(/.test(src), `sin window.confirm/alert → ${rel.split("/").pop()}`);
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
