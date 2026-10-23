# REPORTE DE CULMINACIÓN - Sistema Hípico

## Tareas realizadas (2026-10-23)

### 1. Eliminación definitiva de `legacy/` y limpieza de raíz
- `legacy/html`, `legacy/css` y `legacy/js` eliminados por completo.
- Scripts de parcheo de la raíz eliminados: `add_godet_button.js`,
  `add_godet_mod.js`, `check.js`…`check6.js`, `check_imp.js`,
  `check_pollas*.js`, `f.cjs`, `f2.cjs`, `find_det.js`, `find_tabla.js`,
  `fix_card.js`, `fix_imp2.js`, `fix_import.js`, `fix_mod2.js`,
  `fix_pollas4.js`…`fix_pollas14.js`, `get_pollas.js` y `tmp_patch.js`.
- `index.html` (redirección a `legacy/html/index.html`) y el prototipo suelto
  `modal_hipico_godet_ia-v3.html` eliminados.
- Scripts de auditoría CSS del legacy eliminados (`scripts/audit-css*.cjs`,
  `check-css*.cjs`, `inspect-layout.cjs`).
- Colisión de rutas resuelta: `src/app/dashboard/` (duplicado) eliminado; la
  única fuente es `src/app/(dashboard)/`. Se dejó un alias
  `src/app/(dashboard)/dashboard/page.tsx` con `redirect("/inicio")` para que
  los enlaces viejos y las pestañas guardadas no caigan en 404.
- `tailwind.config.js` escanea solo `src/**`; `package.json` ya no tiene
  `build:css` (escribía en `legacy/css/tailwind.css`).

### 2. Blindaje de seguridad en línea
- `.gitignore`: `.env`, `.env.*` (con `!.env.example`), `*.pem`, `*.key`,
  `*.sql.bak`, `*.dump`, `supabase/.temp/`.
- `next.config.mjs`: `poweredByHeader: false`, `reactStrictMode: true` y
  cabeceras de seguridad (HSTS, `X-Frame-Options`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, CSP con `*.supabase.co`,
  `wss://*.supabase.co` y `generativelanguage.googleapis.com`). Compatibilidad
  condicional con `GITHUB_ACTIONS === "true"`.
- `src/middleware.ts`: **403** para `.sql`, `.mjs`, `.cjs` y para `/pruebas`
  y `/sondas`.

### 3. "Inteligencia Hípica → Proyecciones" operativa
- Ruta `/inteligencia-hipica/proyecciones` registrada en el maestro de
  capacidades (módulo `inteligencia_hipica`) y en `maestro_seed.sql`
  regenerado.
- La entrada del menú ya no se esconde en silencio (`visibleSiempre`).
- Pantalla operativa: lee las carreras del día de la matriz `carreras`, cruza
  los ejemplares con la memoria histórica (RPC
  `rpc_obtener_memoria_historica_caballos`, con respaldo local al padrón) y
  muestra el **ranking de probabilidad actuarial** (Bühlmann-Straub, Índice de
  Consistencia Godet, riesgo de Cox).
- Botón que abre `ModalAnalisisActuarialGodet` con los datos REALES de la
  carrera.
- `sql/memoria_historica.sql` (nuevo).

### 4. Carga de gaceta completa y acumulativa
- Segmentación del texto por encabezados de carrera y envío de 2-3 carreras
  por llamada (`src/features/gaceta/lib/segmentar.ts`).
- Consolidación en `Map<number, Carrera>`: la carrera partida entre bloques se
  une; dos carreras con el mismo número no se colapsan.
- Upsert acumulativo por `(hipodromo_id, fecha, numero_carrera)` con fusión de
  ejemplares por número de gualdrapa; `sql/gaceta_lote_carreras.sql` (nuevo).
- El ledger local acumula en vez de reemplazar (`fusionarLote`).
- Fecha de jornada normalizada bajo `America/Caracas` (UTC-4).

### 5. Estado "Caballo Invalidado" en Tablas Fijas
- Tipos, RPC `rpc_toggle_caballo_invalidado_tabla_fija`, botón
  `🚫 INVALIDADO` / `✔ VÁLIDO` en el editor, insignia en el monitor, y
  exclusión de los invalidados de premios y liquidaciones.
- `sql/tablas_caballo_invalidado.sql` (nuevo).

### 6. Contabilidad NIIF
- `monedaExacta()` y `calcularComisionExacta()` (centavos enteros).
- `registrarAsientoPartidaDobleNIIF()` (partida doble, tasa histórica NIC 21,
  `Debe = Haber` validado en cliente y servidor, reverso por contra-asiento sin
  `DELETE`) y `obtenerBalanceComprobacionNIIF()`.
- Pestaña **📘 Balance NIIF** con KPIs, filtros y exportación CSV.
- `sql/contabilidad_niif.sql` (nuevo).

### 7. Bugs reales corregidos de paso
- `rutaPermitida()`: la rama `algunas` era **código muerto** (el chequeo
  `if (!p.capacidad) return false` la cortocircuitaba). Toda puerta declarada
  con `algunas` quedaba cerrada para todo el mundo.
- `pruebas/reporte-carrera.test.ts`: verificaba la paleta de gualdrapas
  anterior; la app ya usa la codificación oficial.
- `ModalAnalisisActuarialGodet` se llamaba con props que no existían
  (`onClose` en vez de `abierto`/`onCerrar`/`ejemplares`) y el botón que lo
  abría nunca se conectó.

## Estado actual
- `npx tsc --noEmit`: **0 errores**.
- `node pruebas/correr.cjs`: **3181 aserciones OK, 0 fallaron · 69 archivos ·
  SUITE OK**.
- `npm run build`: **exit 0**, 37 páginas generadas (incluye
  `/inteligencia-hipica/proyecciones`).

## SQL pendiente de aplicar en Supabase (a mano)
1. `sql/memoria_historica.sql` — memoria histórica + RPC de gaceta e historial.
2. `sql/gaceta_lote_carreras.sql` — carga por lotes acumulativa.
3. `sql/tablas_caballo_invalidado.sql` — estado INVALIDADO.
4. `sql/contabilidad_niif.sql` — partida doble y balance de comprobación.
5. `src/core/db/maestro_seed.sql` — capacidades de `inteligencia_hipica`.
