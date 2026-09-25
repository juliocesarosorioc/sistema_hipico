## Objective
- Mantener migrado el sistema hípico legacy a un **SPA Next.js/Tailwind** (tsc y build verdes; build de prod: 17 páginas estáticas), **nunca tocar** los archivos legacy fuera de `src/`, y verificar **ACUERDO 1/1** (HEAD local == remoto) tras cada push a `main`.
- **Último commit pusheado (estado actual HEAD debe == origin/main):** `1bee8fb` — **Fix: Filtro de hipódromos activos en Taquilla y redirección de botón hacia Gaceta IA** (FASE 1).
- **Objetivo de la ronda en curso:** — (FASE 1 completada; ver Work State).

## Important Details
- **Regla de oro:** nunca modificar/eliminar legacy (`html/`, `js/`, `css/` fuera de `src/`); el SPA coexiste en paralelo. Los scripts SQL de creación nuevos viven en `sql/`.
- **Reglas de trabajo:** tsc es la única verdad (`npx tsc --noEmit` verde) y `next build` verde; writes pequeños; rutas con paréntesis (`src/app\(dashboard)`) requieren comillas; `tsconfig.tsbuildinfo` trackeado → `git restore tsconfig.tsbuildinfo` antes de commit; `.opencode/` NUNCA se commitea.
- **Patrón Toasts:** `window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }))` + `<ToastHost />`.
- **Supabase:** import `"@/lib/supabase"`, upsert con `onConflict`, scripts SQL idempotentes con `GRANT` anon/authenticated/service_role + policy RLS permisiva (patrón `sql/crear_tabla_dupletas.sql` / `sql/crear_tabla_marcas.sql`).
- **Motor (bettingEngine):** `src/lib/motores/oficiales.ts` **Motor Universal** — `claveDeModalidad()` decide `tabla`/`marcas`/`nini`/`win`/`puestos`/`remate`; `liquidarOficial` paga `monto × dividendo` (pago por $1) cuando existe dividendo oficial, comisión 5% SOLO sobre ganancia bruta (usa `finalizar` exportado de `puestos.ts`); `liquidarTabla` (gana `N(\d+)` 1º o "TABLA COMPLETA"; bruto = monto × premio_por_tabla o dividendos.tabla). Registra procesadores `"oficial"`, `"tabla"`, `"ganador"`.
- **`premio_por_tabla`:** nuevo campo opcional en `TicketMotor` (bettingEngine.ts).
- **Liquidación:** `src/lib/liquidacion/pagarYCerrar.ts` ya usa `liquidarOficial`, acepta `dividendos` + parsea comando "100 2N" o "TABLA …", y lee dividendos persistidos vía `dividendosDe()` (resultados_carreras).
- **Saldos transaccionales (nuevo `src/lib/liquidacion/saldos.ts`):** `aplicarLiquidacionSaldos` decide tickets Pendientes por (fecha/hipodromo/carrera) con `liquidarOficial` y aplica estado Ganador/Perdedor + premio_pagar + incremento `clientes.saldo_actual` en el mismo lote (Promise.all). Idempotente: si ya hay decididos → `yaAplicado: true`.
- **Tickets (B1):** `src/lib/tickets.ts` → `disputarJugada` (en `portal.ts`): inserta tipo DISPUTA referenciando `jugada_id` (tickets_apuestas) + imagen pegada (bucket `reclamos`); `telefonoDeCliente` + `enlaceWhatsAppTicket` (numero con codigo_pais, wa.me con mensaje encodeURIComponent). `TicketsModule` abre el enlace wa.me al resolver y muestra botón "Enviar por WhatsApp" en tarjetas SOLUCIONADO.
- **Impresión (B4):** `src/lib/impresion/tablas.ts` (motor client-side réplica `impresion_tablas.js`: vista densa oculta `position:fixed; left:-9999px`, cabeceras azul marino, 15 tarjetas/hoja, paleta 14, fuente adaptativa; PDF vía `new jsPDF(landscape letter)` paginado por canvas, JPG/PNG vía `html2canvas` + `<a download>`), `src/lib/impresion/reporte.ts` (reporte por jugador/grupo/nivel leyendo `tickets_apuestas` + meta de `tablas_fijas`; PDF portrait), `src/components/tablas/ConfigImpresionModal.tsx` (réplica `#modalConfigImpresion` de html/tablas.html: Hipódromo + Día + Tablas Publicadas/Reporte + PDF/JPG/PNG). Botón verde "Imprimir Tablas" de `TablasModule` ahora abre el modal (antes `window.print()`). Dependencias: `html2canvas@1.4.1`, `jspdf@4.2.1`.
- **`fecha_creacion`:** nuevo campo opcional en `TablaFijaRow` (tablas-fijas.ts) + normalizado en `normalizarFilas` y persistido en `payloadDeTabla` (rpc.ts). Es el "Día (fecha del programa)" del modal (el legacy filtraba por `fecha_creacion`; `fecha` puede ser NULL).
- **FASE 1 (borrado lógico + enrutamiento):** `listarHipodromos` (rpc.ts) ahora orquesta el filtro de borrado lógico con 3 intentos — `.is("deleted_at", null)` → `.eq("estado", "Activo")` (schema mínimo legacy) → `.eq("estatus", "Activo")` — y mapea/ordena; si los 3 fallan usa respaldo local (nunca hipódromos eliminados). El botón "📋 Pegar desde Gaceta" de TablasModule ya NO crea una carrera en blanco: `router.push("/ejemplares?tab=gaceta")`; EjemplaresModule lee `?tab=` (padron|gaceta|programa) en mount vía `window.location.search` (build SSG con output:export, sin useSearchParams/Suspense).
- **Notificaciones/realtime:** sin cambios adicionales.

## Work State
### Completed (ronda B3+B1)
- **B3 · Motor Universal (implementado + tsc/build verdes):**
  - `src/lib/motores/oficiales.ts` (nuevo) + `finalizar` exportado en `src/lib/motores/puestos.ts`.
  - `src/lib/bettingEngine.ts`: `premio_por_tabla?` en `TicketMotor`.
  - `src/lib/liquidacion/pagarYCerrar.ts`: migrado a `liquidarOficial` + `dividendosDe()`.
  - `src/components/liquidacion/CargaResultadosModal.tsx`: `PizarraResultados` con `dividendos?` + `premio_por_tabla?` + inputs opcionales en el modal.
  - `src/lib/liquidacion/saldos.ts` (nuevo): `aplicarLiquidacionSaldos` (transaccional/idempotente).
  - `src/components/taquilla/PagarCarreraModal.tsx`: pasa `dividendos`/`premio_por_tabla` del `CargaResultadosModal` a `liquidarCarreraYCerrarTabla`, persiste en `upsertResultadoCentral` (ganadores, orden_llegada, dividendos) y llama a `aplicarLiquidacionSaldos` tras el pago.
- **B1 · Cierre flujo Tickets (implementado + tsc/build verdes):**
  - `src/lib/portal.ts`: `disputarJugada()` (ticket DISPUTA + imagen a bucket `reclamos`).
  - `src/components/portal/PortalModule.tsx`: botón "Disputar" por fila en ResumenView + `DisputarModal` con área `onPaste` (Ctrl+V) para pegar imagen de soporte.
  - `src/lib/tickets.ts`: `telefonoDeCliente()` + `enlaceWhatsAppTicket()`.
  - `src/components/tickets/TicketsModule.tsx`: al resolver abre wa.me con el cliente + botón "Enviar por WhatsApp" en SOLUCIONADO.
- Commits previos (pushed, ACUERDO 1/1): `1bee8fb` (FASE 1), `55457fb` (B4), `bad396b` (B3+B1), `ed369b8`, `15f5104`, `29ba1ba`, `20c636d`, `4f0cff7`, `8670cc0`, `393d498` y previos.
- tsc y `next build` verdes (17 páginas estáticas).

### Completed (FASE 1 · Corrección de rutas y filtro de borrado lógico)
- **Filtro de hipódromos vigentes (Taquilla/Gestión de Jugadas):** `listarHipodromos()` en `src/lib/tablas/rpc.ts` orquesta hasta 3 variantes de borrado lógico (`deleted_at` null → `estado='Activo'` → `estatus='Activo'`), mapea/ordena los hipódromos y sólo recurre al respaldo local si las 3 fallan. Evita listar hipódromos eliminados/desactivados en el selector.
- **Botón "Pegar desde Gaceta" (Tablas Fijas):** ya no crea tarjeta en blanco; redirige con `router.push("/ejemplares?tab=gaceta")` al módulo de Gacetas IA (`EjemplaresModule` abre la pestaña gaceta leyendo `?tab=` con `window.location.search`).
- tsc y `next build` verdes (17 páginas estáticas).

### Active
- — (FASE 1 entregada y pusheada, ACUERDO 1/1. Sin tareas en curso.)

### Blocked / Opcionales (requieren acción manual del operador, NO son tareas del motor ni de la UI)
- **Ejecución de SQL en Supabase** (idempotentes, runbook): `sql/runbook_estabilizacion.sql` (tablas `dupletas`, `marcas_dia`, `tickets_jugadas` + realtime) y `sql/crear_tabla_dupletas.sql` / `sql/crear_tabla_marcas.sql`. Sin credenciales → se entregan como runbook.
- **Bloques pendientes para siguiente ronda (no pedidos):** Resultados dentro de reportes (export/pantalla de programación + resultados), Dupleta como modalidad de venta en Taquilla, Remates por programa, y enlazar tickets de Taquilla (sin `cliente_id`) al saldo real mediante `tickets_apuestas` → `clientes` (patrón `reembolsarTicketsRetirado` en `src/lib/tablas/rpc.ts` ~línea 348).

## Next Move
- Responder confirmación de la FASE 1: hipódromos vigentes únicamente (borrado lógico en 3 variantes) + "Pegar desde Gaceta" abre el módulo de Gacetas IA (`/ejemplares?tab=gaceta`). Recordar al usuario que el dev server corre en **http://localhost:3001** (no 3000) para probar.
- Si hay feedback del usuario: nuevos commits con tsc verde + ACUERDO 1/1.

## Relevant Files
### FASE 1 (filtrar hipódromos + enrutar a Gaceta IA)
- `src/lib/tablas/rpc.ts` (`listarHipodromos` con borrado lógico orquestado).
- `src/components/tablas/TablasModule.tsx` (botón "Pegar desde Gaceta" → `router.push("/ejemplares?tab=gaceta")`).
- `src/components/ejemplares/EjemplaresModule.tsx` (abre pestaña según `?tab=`).
### Módulos de impresión (ronda B4)
- `src/lib/impresion/tablas.ts` + `src/lib/impresion/reporte.ts` + `src/lib/impresion/index.ts`.
- `src/components/tablas/ConfigImpresionModal.tsx` + `src/components/tablas/TablasModule.tsx` (botón "Imprimir Tablas" → modal).
- `src/lib/tablas-fijas.ts` + `src/lib/tablas/rpc.ts` (`fecha_creacion`).
- Dependencias: `html2canvas@1.4.1`, `jspdf@4.2.1` (package.json).
### Módulos de la ronda B3+B1
- `src/lib/motores/oficiales.ts` (nuevo, motor universal) + `src/lib/motores/puestos.ts`.
- `src/lib/liquidacion/saldos.ts` (nuevo) + `src/lib/liquidacion/pagarYCerrar.ts`.
- `src/components/liquidacion/CargaResultadosModal.tsx` + `src/components/taquilla/PagarCarreraModal.tsx`.
- `src/lib/portal.ts` + `src/components/portal/PortalModule.tsx`.
- `src/lib/tickets.ts` + `src/components/tickets/TicketsModule.tsx`.
- `src/lib/bettingEngine.ts` (`premio_por_tabla?`).
### Módulos de la ronda anterior de Tickets
- `sql/runbook_estabilizacion.sql` + `src/app/(dashboard)/tickets/page.tsx`.
### Legacy (NO modificar — solo lectura de referencia)
- `html/tablas.html`, `js/tablas.js`, `js/components/programa_dia.js`, etc.