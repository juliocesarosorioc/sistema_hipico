# SISTEMA HIPICO - ARQUITECTURA Y PLAN DE MIGRACION
> Fase 1 (auditoria) + Fase 2 (plan de ramas + riesgos reales + receta vida real).
> Generado por canal verificado (write -> node -> releido byte-exact, ASCII puro).

## 1. Monolitos reales (medidos, nada inventado)

| Archivo | Lineas | Que mezcla |
|---|---|---|
| js/tablas.js | 2 563 | UI + negocio + DB + impresion + export |
| js/venta_tablas.js | 1 377 | Venta + render + WhatsApp |
| js/taquilla.js | 885 | Apuestas + resultados + dividendos |
| js/portal.js | 805 | Clientes + tickets + saldos |
| js/clientes.js | 748 | CRUD + saldos + depositos |

## 2. Duplicacion / DRY detectada

- WhatsApp: js/whatsapp.js (457 L) + js/wps.js (302 L) -> un solo services/whatsapp.js.
- Formato moneda/fecha repetido en saldos/depositos/taquilla -> core/utils/formato.js.
- Tooling: audit-css.cjs != audit-css2.cjs y check-css.cjs != check-css2.cjs (SHA distintos).
  => No son gemelos: NO eliminar a ciegas. Verificar contenido antes de borrar.

## 3. Arbol objetivo (capas)

sistema_hipico/
|-- index.html
|-- src/
|   |-- core/            db/ (repo.js, schema.js) -> unica capa supabase
|   |                     domain/ (tablasFijas, apuestas, monetaria, remates)
|   |                     services/ (imprimirTablas, whatsapp, taquilla, saldos)
|   |                     utils/ (formato, fecha, numero)
|   |-- ui/              components/ (monitorGrid, barraCarrito, modalResultado, toast)
|   |                     pages/ (ventaTablas, taquilla, portal) - 1 entry por vista
|   |-- shared/          constantes.js, tipos.js
|-- html/                solo maquetado sin logica
|-- css/                 solo estilos compilados
|-- js/components/       MODULOS NUEVOS ya creados (tablero impresion, reporte)
|-- docs/                esta arquitectura + plan

## 4. Como implementarlo: plan por ramas (1 modulo por rama, PR revisable)

RAMA A -> core/db  : crear repo.js + schema.js nuevos (no toca monolitos).
RAMA B -> services : unificar whatsapp.js + wps.js en uno solo (DRY wa.me).
RAMA C -> ui/components : extraer monitorGrid + barraCarrito como componentes.
RAMA D -> pages : que cada vista HTML solo enganche components + services.
RAMA E (ya listo) -> tablero_impresion_tablas_fijas.js + reporte_tablas_fijas.js.

Regla por rama: git checkout -b ramas/XX -> crear 1 archivo nuevo -> verificar
byte-exact + ASCII puro -> commit -> push -> PR en GitHub -> merge solo tras PD.

## 5. Riesgos REALES investigados (con plan de contencion)

- Riesgo 1: Monolitos gigantes (tablas.js 2563 L) impossible de razonar.
  Contencion: extraer 1 modulo POR rama; nunca reescribir el monolito entero.
- Riesgo 2: Canal de escritura directa corrompe js/*.js (probado 25+ veces).
  Contencion: el UNICO canal fiable es crear archivo NUEVO via write->node->read
  + verificar byte-exact; los diffs sobre monolitos los pega el humano y yo
  hago commit+push verificados cuando git status muestre el M real.
- Riesgo 3: Duplicacion WhatsApp (wa.me en whatsapp.js + wps.js).
  Contencion: Rama B unifica en services/whatsapp.js con un unico constructor.
- Riesgo 4: Borrar tooling a ciegas (sha distinto => no gemelo).
  Contencion: auditar contenido real antes de cualquier rm.

## 6. Receta VIDA REAL (el flujo que ya uso, paso a paso)

1) Yo entrego un bloque codigo exacto (boton / componente / contenedor).
2) Tu lo pegas en VS Code (30 s).
3) Dices "sube" / "adelante".
4) Verifico con git status que existe el diff o archivo REAL (canal git, SHA).
5) git add SOLO lo nuevo + commit + push -> te muestro SHA + enlace verificado.
6) Sino existe diff real, NO invento commit: te digo la verdad y espero.

## 7. Estado actual

- Modulo NUEVO subido: js/components/tablero_impresion_tablas_fijas.js (impresion
  tablas fijas publicadas, 5x3 por hoja, numero con color + fondo, normas al pie).
- Modulo NUEVO subido: js/components/reporte_tablas_fijas.js (reporte por fecha/grupo/
  hipodromo/carrera/jugador, monto jugado + monto pagado, total por jugador y nivel).

