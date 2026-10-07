# Fechas y jornadas: por qué se partió el 04-10-2026 y cómo evitarlo

> Documento de referencia. Si tocás una fecha en este repo, leé la sección 2
> antes de escribir código. Si publicás carreras, la sección 3 es tuya.

---

## 1. Qué pasó

El 4 de octubre de 2026 se publicaron 13 carreras de **LA RINCONADA**.

| Carreras | Dónde quedaron en `tablas_fijas` | Dónde quedaron en el central |
|---|---|---|
| C1 … C9 | 2026-10-04 | 2026-10-04 |
| **C10, C11, C12** | **2026-04-10** | **2026-04-10** |
| C13 | 2026-10-04 | 2026-10-04 |

C10-C12 quedaron fechadas el **10 de abril**. No se veían:

- En **Tablas Fijas** ni en **Gestión de Jugadas**, porque ambas pantallas
  filtran por fecha y esas filas estaban en `2026-04-10`.
- En **Marcas**, que además lee el central, donde tampoco existían.

Y de las 13, solo C13 había llegado a `resultados_carreras`. Las otras 12 estaban
publicadas (o sea, se vendían) pero **existían únicamente para la Taquilla**.

Hubo un segundo defecto, independiente del de la fecha: **publicar una tabla no
creaba la carrera en el central**. Ese camino solo lo hacía el Modo Manual, y
solo para carreras vacías. Por eso el 04-10-2026 hay 13 tablas y 1 carrera
central: son dos bugs distintos, y pasar por el filtro de fecha no arregla ninguno
de los dos.

---

## 2. La causa raíz

No fue un error de tecleo. Fue un **diseño que fallaba abierto**.

### La cadena, paso a paso

**1.** El operador escribió la fecha como `04-10-2026` — día/mes, que es como se
escribe y se lee en Venezuela.

**2.** `normalizarFechaIso()` en `src/lib/gaceta/ui.ts` decía en su comentario
aceptar `DD-MM-YYYY`, pero su expresión regular era:

```ts
s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
//                       ↑ la clase [/.] NO incluye el guion
```

`04-10-2026` no cuadraba con ninguna de las tres ramas, así que la función
devolvía **`null`**.

**3.** Devolver `null` no era *fallar*: era **no opinar**. Los llamadores trataban
el `null` como "no hay fecha conocida" y dejaban pasar **el texto crudo**.

**4.** El texto crudo `"04-10-2026"` llegó tal cual a Postgres. Ni Postgres ni
JavaScript tienen una convención propia para ese formato: lo leen como
**MM-DD-YYYY**. De ahí el `2026-04-10`.

### Las dos lecciones

> **Lección 1 — Un validador que devuelve `null` y deja pasar lo que no validó es
> PEOR que no tener validador.** Aparenta protección y no da ninguna. Un validador
> tiene que ser *fail-closed*: o da una respuesta buena, o detiene la operación.

> **Lección 2 — No puede haber dos intérpretes de la misma fecha.** La app leía
> DD/MM y el servidor leía MM/DD. `04/10` es el caso ambiguo clásico (4 de octubre
> o 10 de abril); cuando ambos pueden pasar, el sistema **elige en silencio**. Y
> elige el que no se está mirando.

Por eso el arreglo no fue "corregir el regex". Fue **quitarle la decisión al
servidor**: la app normaliza una sola vez y a la base solo sale ISO.

---

## 3. Las reglas (las tres capas)

### Capa 1 — Una sola fuente de verdad: `src/lib/fechas.ts`

| Función | Para qué | Devuelve |
|---|---|---|
| `interpretarFecha(v)` | **Leer** (Gaceta, IA, correcciones) | `{ iso, ambigua, alternativas, motivo }` |
| `esFechaIso(v)` | ¿Es ISO y existe en el calendario? | `boolean` |
| `exigirFechaIso(v, ctx)` | **Guardar** | ISO, o **lanza** |
| `fechaOpcional(v)` | UI que distingue vacío de escrito mal | igual que `interpretarFecha` |

- **Regla A:** a la base solo sale `YYYY-MM-DD`. Nunca texto libre.
- **Regla B:** una entrada ambigua se **declara** ambigua y se muestran las dos
  lecturas. No se resuelve en silencio.
- **Regla C:** la validación **falla cerrada**. `exigirFechaIso` lanza con un
  mensaje accionable; no existe el camino "devuelve null y sigue".

`normalizarFechaIso` en `src/lib/gaceta/ui.ts` ahora **delega** en este módulo.
No escribas un segundo parser de fechas: ese duplicado es exactamente lo que
rompió la jornada.

### Capa 2 — No se puede escribir una fecha ambigua

Los tres campos de fecha son `<input type="date">`, no texto libre:

- `TarjetaEnsamblaje.tsx` — corregir borrador
- `MonitorTablas.tsx` — editar tabla publicada
- `CarreraGacetaCard.tsx` — ya era `type="date"`

El calendario del navegador solo emite ISO, así que `04-10-2026` es imposible de
escribir. El campo de `MonitorTablas` merece atención aparte: ahí se cambia el
**día** de una tabla ya publicada, y mover una tabla de día parte la jornada
(las ventas quedan en un día y la oferta en otro).

### Capa 3 — La barrera de publicación: `src/lib/tablas/validar-carga.ts`

Antes de tocar la base, `publicarDraft()` y `publicarTodas()` en
`TablasModule.tsx` revisan **todas** las tarjetas y rechazan el lote si:

1. Una fecha no se puede interpretar.
2. Una fecha es ambigua.
3. La fecha de una tarjeta **no es la jornada abierta** en pantalla.
4. Lo que sale no es ISO estricto.

Las tres primeras se resuelven juntas, en un mensaje que nombra cada carrera y
dice cómo corregirla, para no tener que corregir de a uno.

`draftATabla()` recibe la fecha ya validada como parámetro y **no vuelve a leer
`d.fecha`**. Si se armara con el texto de la tarjeta, la fecha sin validar
volvería a llegar al `INSERT`.

> **Por qué la regla 3 es la importante.** Convierte un error de captura en un
> error visible. Si una tarjeta dice otra fecha, casi siempre es que se mezclaron
> dos jornadas en el mismo ensamblaje, y eso hay que verlo, no publicarlo.

---

## 4. La base de datos: coherencia por construcción

`sql/tablas_fijas_sincronizar_central.sql` instala un trigger
`AFTER INSERT OR UPDATE` sobre `tablas_fijas` que mantiene la fila de
`resultados_carreras` mientras exista la tabla.

La sincronización del cliente es **una** de las formas de escribir en
`tablas_fijas`. También escriben el Monitor al editar caballos, las RPC de
publicación, los scripts de carga y un PostgREST directo (la tabla tiene RLS
desactivado). Cada uno puede olvidarse, y entonces la carrera se vende pero no se
ve.

Con el trigger, la fila del central **no se puede olvidar**.

**Lo que el trigger NO hace, a propósito:**

- **No corrige fechas.** Para la base, `2026-04-10` es una fecha válida. Un
  trigger no sabe qué quería el operador. La ambigüedad se resuelve en la
  aplicación, donde sí se conoce la convención de la operación.
- **No toca la liquidación.** `ganadores`, `dividendos`, `premio_recalculado`,
  `detalle`, `orden_llegada` y `aplicado_a_tablas` no aparecen en el `SET`, y el
  `ON CONFLICT` tiene un `WHERE` que solo actualiza filas **sin** ganadores. Un
  trigger que "fuera de sí las carreras" volvería a cargar desde la tabla con
  datos desactualizados.
- **No borra el central** cuando se borra la tabla: cerrar una tabla no significa
  que la carrera no exista.

Aplica el SQL **a mano** en el SQL Editor de Supabase (no hay `psql` ni
`service_role`). Antes, el validador estático corre en el runner.

---

## 5. Cómo se comprueba

```bash
npx tsc --noEmit
powershell -ExecutionPolicy Bypass -File pruebas\run-marcas.ps1
```

Pruebas que fijan este contrato:

| Prueba | Qué fija |
|---|---|
| `pruebas/fechas.test.ts` | Reglas A, B y C. Reproduce el incidente. |
| `pruebas/validar-carga.test.ts` | La barrera de publicación. Reproduce el incidente. |
| `pruebas/validar-trigger-central.mjs` | Que el trigger sea seguro de aplicar a mano. |
| `pruebas/auditar-jornadas.mjs` | El estado **real** de la base. |

`auditar-jornadas.mjs` mira los datos, no el código, porque el daño ya estaba en
la base. Busca cuatro síntomas:

1. **Publicada sin central** — se vende pero no se ve en Marcas/Gestión.
2. **Día partido** — el mismo hipódromo con la misma carrera en dos fechas
   cercanas (la huella de DD-MM vs MM-DD).
3. **Hermanas huérfanas** — huecos de 3 o más carreras dentro de una jornada
   (1..9 y luego 13, sin 10, 11 ni 12).
4. **Fecha cruda o año disparatado.**

Sale con código 1 si encuentra algo, así que el runner y el CI paran.

### Si la auditoría falla

```bash
node pruebas/auditar-jornadas.mjs     # ver qué está mal
```

Luego, en el SQL Editor de Supabase, en este orden:

1. `sql/tablas_fijas_sincronizar_central.sql` — para que no vuelva a pasar.
2. `sql/reparar_central_desde_tablas.sql` — para arreglar lo que ya está roto.

El orden importa: primero el trigger, después la reparación. Al revés, el
trigger puede volver a crear filas al vuelo mientras se corrigen las fechas y el
informe de la segunda queda desactualizado.

---

## 6. El proceso, en corto

**Al publicar una jornada:**

1. Abrí la fecha en el filtro universal. Es la jornada que vas a publicar.
2. Revisá las tarjetas del ensamblaje. Si alguna trae fecha, tiene que ser **la
   misma** que la del filtro.
3. Publicá. Si la barrera rechaza el lote, el mensaje dice qué carrera y por qué:
   eso no se ignora, es una jornada mezclada o una fecha mal escrita.
4. Después de publicar, corré `auditar-jornadas.mjs`. Cero problemas.

**Al tocar código de fechas:**

- Nada de `new Date(algo)` sobre una fecha que venga de una persona. Eso es lo
  que interpreta `04-10-2026` como abril.
- Para leer, `interpretarFecha`. Para guardar, `exigirFechaIso`.
- No escribas un parser nuevo. Si falta un formato, se agrega a `fechas.ts`,
  con su prueba.
- Un campo de fecha nuevo, `type="date"`. Sin excepción.

**Regla general:** si un dato no se puede interpretar, se detiene la operación y
se le pregunta a la persona. Nunca se rellena con un valor por defecto.
