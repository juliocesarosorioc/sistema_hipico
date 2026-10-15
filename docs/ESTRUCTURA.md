# Estructura del repositorio

## Raíz

La raíz guarda **solo la estructura** (carpetas) y los archivos de
configuración; ningún archivo suelto de negocio, documentación o del sistema
viejo.

```text
sistema_hipico/
├── src/          # App Next.js (ver abajo)
├── docs/         # Documentación (guías, planificación, manuales, arquitectura)
├── scripts/      # Utilidades de build y auditoría (Node)
├── sondas/       # Scripts de diagnóstico puntual (TS)
├── supabase/     # Edge Functions (Deno) + SQL
├── legacy/       # Sistema estático anterior (html/ + css/ + js/), solo referencia
├── respaldos/    # Datos locales (ignorado por git)
├── index.html    # Entrada que redirige a legacy/html/index.html
├── next.config.mjs · tsconfig.json · tailwind.config.js · postcss.config.js
├── package.json · package-lock.json · next-env.d.ts · deno.lock · .gitignore
└── .env.local    # Secretos locales (ignorado por git)
```

- **`legacy/`** agrupa el sitio estático anterior (`legacy/html`, `legacy/css`,
  `legacy/js`). Los HTML se enlazan entre sí con rutas relativas (`../css`,
  `../js`), que siguen resolviendo dentro de `legacy/`. El código nuevo lo cita
  solo como referencia histórica.
- `package.json#build:css` compila `src/input.css` → `legacy/css/tailwind.css`
  (CSS del sitio legacy).

# Estructura del código (`src/`)

Arquitectura **feature-first**: el código de negocio vive agrupado por dominio.
Así un programador nuevo encuentra rápido "dónde está cada cosa" y cada módulo
es autocontenido (componentes + lógica + tipos juntos).

```text
src/
├── app/         # Rutas de Next.js (App Router) — NO se reubica
├── core/        # Núcleo transversal: infra, tipos y utilidades puras
├── shared/      # Reutilizable entre dominios: UI, layout, hooks, stores
├── features/    # Un directorio por dominio de negocio
├── core/db/     # SQL / DDL de Supabase (operativo, no se compila)
├── middleware.ts
└── input.css
```

## Reglas de oro

- **`app/` no se mueve.** Next.js exige rutas y `middleware.ts` ahí.
- **Un dominio = una carpeta en `features/`.** Cada feature agrupa:
  - `components/` → componentes React del dominio (`PascalCase.tsx`)
  - `lib/` → lógica, servicios, acceso a datos (`kebab-case.ts` o `camelCase.ts`)
- **`shared/`** = lo que usan varios dominios (UI genérica, layout, stores globales).
- **`core/`** = infraestructura sin negocio (`supabase`, `fechas`, `types`, `db`).
- **Imports con alias `@/`** (nunca rutas relativas que crucen carpetas):
  `@/features/<dominio>/...`, `@/shared/...`, `@/core/...`.

```ts
import TaquillaModule from "@/features/taquilla/components/TaquillaModule";
import { Button } from "@/shared/components/ui/Button";
import { supabase } from "@/core/supabase";
```

## Mapa de dominios (`src/features/`)

| Feature | Rutas / módulo UI | Contiene |
|---|---|---|
| `taquilla` | `/taquilla` | Venta de apuestas, reparto, nomenclatura |
| `betting` | — | Núcleo matemático (`bettingEngine`) |
| `liquidacion` | — | Resultados, pagos, saldos, reportes de carrera |
| `gestion` | `/gestion-jugadas` | Gestión de jugadas + historial |
| `jugadas` | `/jugadas` | Monitor de jugadas |
| `carreras` | — | Carreras del día, maestro, central |
| `tablas` | `/tablas-fijas` | Tablas fijas (config, venta, impresión) |
| `marcas` | `/marcas` | Pizarra de marcas |
| `remates` | `/remates` | Remates |
| `pollas` | `/pollas` | Pollas |
| `dupletas` | `/dupleta` | Dupletas |
| `clientes` | `/clientes` | Clientes y saldos |
| `contabilidad` | `/contabilidad` | Depósitos, caja, monedas |
| `grupos` | `/grupos` | Grupos de venta |
| `operadores` | `/operadores` | Personal y sus hipódromos |
| `seguridad` | `/seguridad` | RBAC/ABAC, auditoría |
| `hipodromos` | `/hipodromos` | Hipódromos |
| `gaceta` | — | Gaceta, programa, padrón |
| `ejemplares` | `/ejemplares` | Ejemplares / gaceta IA |
| `portal` | `/portal` | Portal del cliente |
| `tickets` | `/tickets` | Tickets / reclamos |
| `whatsapp` | `/whatsapp` | Centro WhatsApp |
| `reglas-jugadas` | `/reglas-jugadas` | Tipos de jugadas |
| `saldos` | `/saldos-reportes` | Reportes de saldos |
| `impresion` | — | Exportación e impresión (Excel, reportes) |
| `motores` | — | Motores de puestos / oficiales / WPS |
| `diagnostico` | — | Diagnóstico y reparación de matriz |
| `dashboard` | `/inicio` | Dashboard |
| `auth` | `/login` | Autenticación |
| `carreras` / `clientes` / ... | | |

## `shared/`

```text
shared/
├── components/
│   ├── ui/        # Button, Card, EmptyState, ToastHost, HorseChips, ...
│   └── layout/    # AppShell, Sidebar, Topbar
├── lib/           # utils.ts, horseColors.ts, vzla.ts (helpers compartidos)
└── store/         # Zustand globales (auth, carreras-dia, taquilla, ...)
```

## `core/`

```text
core/
├── supabase.ts    # Cliente Supabase (infra)
├── utils/         # fechas.ts (única fuente de verdad de fechas)
├── types/         # *.d.ts de tipos globales
└── db/            # SQL/DDL de Supabase (maestro, RBAC, RLS)
```

## Convenciones de nombres

| Tipo | Convención | Ejemplo |
|---|---|---|
| Componente React | `PascalCase.tsx` | `TaquillaModule.tsx` |
| Módulo/lógica | `camelCase.ts` o `kebab-case.ts` | `bettingEngine.ts`, `carreras-dia.ts` |
| Hook | `use-*.ts` / `useX.ts` | `useCarrerasDiaStore.ts` |
| Tipos | `types.ts` o `*.d.ts` | `tipos.ts` |

## Alias (`tsconfig.json` + `next.config.mjs`)

- `@/*` → `src/*`
- `@/app`, `@/shared`, `@/core`, `@/features` (aliases explícitos para webpack)

## Verificación

```bash
npx tsc --noEmit   # tipos
npm run build      # compilación Next.js
```
