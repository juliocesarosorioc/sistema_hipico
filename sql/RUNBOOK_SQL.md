> # ⛔ ESTE ARCHIVO NO ES SQL
>
> Es documentación en Markdown. **No lo pegues en el SQL Editor de Supabase ni en
> `psql`.** Al correrlo tal cual sale:
>
> ```
> ERROR: 42601: syntax error at or near "#"
> ```
>
> Para aplicar cambios copia el archivo **`.sql`** que se indica abajo, punto por
> punto. Los archivos con extensión `.md` son solo guía.

# Runbook de SQL — orden de aplicación

Los scripts se aplican en el **SQL Editor de Supabase**. No hay service role en el
repo, así que nadie lo puede correr por script: es manual y el orden importa.

Si tenés un error de sintaxis tipo `42601` apuntando a un `#` o a una línea de
texto con palabras, casi seguro que pegaste este archivo u otro `.md`. Los
ejecutables son los que terminan en `.sql`.

## Por qué el orden importa

Históricamente el repo resuelve los errores de permisos abriendo las tablas.
El síntoma ("new row violates row-level security policy") se tapaba con un
`grant all ... to anon` o un `with check (true)`. Eso hace que el error
desaparezca de la consola mientras el problema sigue existiendo: cualquiera con
la anon key, que va incrustada en el bundle que descarga el navegador, puede
escribir en la tabla.

Hoy los dos scripts de abajo cierran por RPC `security definer` con
`tiene_capacidad()`. **Si se corre un script viejo después de ellos, los
reabre** y el cierre queda sin efecto. Por eso este runbook existe.

## Orden recomendado para una base que ya está montada

Correlos en este orden. Ninguno depende de que se aplique el anterior, pero
este es el orden en que no se pisan entre sí:

0. `fix_tiene_capacidad.sql` — **prerequisito de todos los guards.**
   `public.tiene_capacidad` devolvía `NULL` cuando no había fila de usuario (o
   con `auth.uid()` null, como `anon`). En un guard
   `if not tiene_capacidad(...)` eso no cerraba nada: `not NULL` es `NULL` y el
   `IF` no dispara. El script lo envuelve en `coalesce(..., false)` sin cambiar
   la lógica de permisos. **Sin esto, los pasos 2, 9 y 11 dejan pasar a `anon`
   aunque digan que cierran en falso.** Es idempotente y conserva los grants.
1. `paquete_pendientes.sql` — completa el esquema que falte.
   Las secciones 7 y 15 (RLS apagado en todas las tablas) están **desactivadas**
   a propósito; no actives `app.permisos_globales_anon`.
2. `resultados_rpc.sql` — cierra la escritura de `resultados_carreras`.
3. `reclamos_storage.sql` — cierra la escritura de `clientes` y
   `tickets_apuestas`, y hace privado el bucket de reclamos.
4. `auditoria_rls.sql` — deja la lectura de `auditoria` solo para quien tiene
   `seguridad:celda_auditoria`.
5. `migrar-wps-tickets.sql` — una sola vez, para mover las jugadas W/P/S del
   legacy. No vuelve a debitar saldos.
6. `marcas_venta.sql` — **obligatorio antes de volver a vender Marcas.**
   Cambió la firma de `club_vender_marca`: el navegador ahora manda `p_rival`
   (el rival del match) y la función valida que sea legal. Sin correrlo, PostgREST
   responde que esa firma no existe y **toda venta de Marcas falla**. No hay
   vuelta atrás: el archivo es idempotente y el `drop function` de la firma vieja
   hace que el `create or replace` no choque.

### La jugada de Marcas cambió de regla: hay que aplicar SQL

Antes, elegir un caballo lo ponía a jugar contra *todas* las marcas. Ahora cada
jugada es **un match de a uno**: el operador elige de entre los caballos que el
elegido tiene legales **a su izquierda**, y ese es el único rival del ticket.

Consecuencias al aplicar:

- Los tickets **ya vendidos** no se tocan. `club_liquidar_marca` lee el rival del
  snapshot de cada ticket, así que los viejos se liquidan como se vendieron.
- `marcas_venta.sql` es el único archivo que hay que correr para esto. La RPC de
  liquidación **no cambia**.
- El servidor revalida `p_rival` contra la misma jerarquía que el navegador: si
  mandas un caballo de la derecha contra uno de la izquierda, la venta se rechaza
  en vez de registrarse.

### El rol real es `authenticated` (no `anon`) — dos scripts más

El login es real (`src/lib/auth/sesion.ts` → `signInWithPassword`): una vez que
hay sesión, Supabase adjunta el JWT a cada consulta y PostgREST ejecuta el rol
`authenticated`, **no** `anon`. Una policy `to anon` sola no aplica: la tabla
responde `200` con `[]` en silencio, el `catch` de la app no se dispara y la
pantalla muestra "0 filas" como si no hubiera datos.

7. `grupos_venta_lectura.sql` — lectura de `grupos_venta` y `clientes_grupos` para
   `anon` **y** `authenticated`, más `execute` de las RPC de grupos para
   `authenticated`. Sin esto, el modal de Grupos y Convenios sale vacío. Es **solo
   lectura**: no abre escritura.
8. `remates.sql` — esquema de Remates (`remates` + `remate_caballos`): agrega las
   columnas que faltan en la base viva (`hipodromo_id`, `carrera`, `comision_pct`,
   `fecha_registro`, `ejemplar_numero`, `created_at`) y las FK a
   `hipodromos`/`clientes`. Deja `remates` en **SOLO LECTURA** para `authenticated`
   (sin `anon`), igual que `remate_caballos`: las escrituras de la subasta van por
   las RPC de `remate_escritura_rpc.sql` (paso 12) y las de pujas por
   `remate_pujas_rpc.sql` (paso 11). Si se corre una versión vieja de este archivo
   después, vuelve a abrir la escritura a `anon`.
9. `remate_cierre.sql` — cierre económico del remate. Agrega `cerrado_at` y
   `liquidado_at` a `remates`, un índice por
   `nota_auditoria::jsonb ->> 'remate_caballo_id'` en `tickets_apuestas` y las
   RPC: `club_cerrar_remate` (ticket de venta + descuento de saldo en una sola
   transacción, idempotente, aborta si a un comprador no le alcanza),
   `club_reabrir_remate` (reabre sin borrar tickets ni devolver saldos) y
   `club_vender_caballo_remate` (venta de un ejemplar que estaba en CASA al
   reabrir). Las tres RPC verifican en el servidor
   `public.tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate')`, así que un
   `anon` o un usuario sin la capacidad son rechazados aunque se invoque directo.
   **Si ya se había aplicado la versión sin el guard, volver a correr el script**
   (`create or replace` es idempotente). **Sin este script el botón "Cerrar" avisa
   que la función no existe** y el remate no se liquida.
10. `remate_pujas.sql` — historial de pujas (`remate_pujas`) y columnas de
    escalera/incentivo (`escalera`, `nota_escalera`, `incentivo_pct`). Deja
    `remate_pujas` en **SOLO LECTURA** para `authenticated` (sin `anon`).
11. `remate_pujas_rpc.sql` — **obligatorio después del paso 10.** Mueve las
    escrituras de pujas a RPC `security definer`: `club_asignar_pujas_remate`,
    `club_pujar_caballo_remate` y `club_eliminar_caballo_remate` (insert/update/
    delete de `remate_caballos`, historial en `remate_pujas` y recálculo de
    `prob_porcentaje`/`prob_implicita` en una sola transacción). Cada una exige
    `tiene_capacidad` con `remates:fn_asignar_caballos` (asignar/pujar) o
    `remates:fn_eliminar_caballo` (quitar), envuelto en `coalesce(..., false)`
    para que un `auth.uid()` nulo cierre de verdad. Se concede **solo a
    `authenticated`** y se revoca `EXECUTE` de `PUBLIC`/`anon` (Postgres lo da a
    PUBLIC por defecto). **Sin este script, la pizarra de
    Remates no puede asignar, subir ni quitar pujas** (avisa que la función no
    existe). Requiere que `remates.sql` y `remate_pujas.sql` hayan dejado las
    tablas en solo-lectura.
12. `remate_escritura_rpc.sql` — **obligatorio después del paso 10** (usa las
    columnas `incentivo_pct`, `escalera` y `nota_escalera`). Mueve las escrituras
    de la subasta a RPC `security definer`: `club_crear_remate`,
    `club_eliminar_remate`, `club_guardar_incentivo_remate` y
    `club_guardar_escalera_remate`. Exigen `remates:fn_guardar_remate`
    (crear/incentivo/escalera) o `remates:fn_eliminar_remate` (borrar), envuelto en
    `coalesce(..., false)`, y se conceden **solo a `authenticated`** (con `EXECUTE`
    revocado de `PUBLIC`/`anon`). Aplica además la policy de solo-lectura de
    `remates`. **Sin este script la app no puede crear, editar
    (incentivo/escalera) ni borrar remates** (avisa que la función no existe).
13. `carreras.sql` — **crea la MATRIZ `carreras`, la fuente única de qué carreras
    hay** (unique `fecha` + `hipodromo` + `carrera`, con `estado`, `caballos`,
    `retirados`, `invalidado_remate`, `hipodromo_id`). Enlaza
    `resultados_carreras.carrera_id`. **Obligatorio**: a partir de ahora la app
    lista las carreras SOLO desde acá (`listarCarrerasCentrales`,
    `listarCarrerasPorDia`); se quitaron los fallbacks que cruzaban
    `resultados_carreras` / `programa_dia` / `tablas_fijas`. Sin este script los
    módulos de jugadas muestran el error "La matriz de carreras no está
    disponible". Idempotente y no borra datos.
14. `carrera_unica.sql` — **requiere el paso 13**. Deja una sola verdad sobre la
    carrera: crea `carrera_ejemplares` (inscripción 1:N, con trigger que refleja
    `carreras.caballos` para no duplicar), fuerza el resultado 1:1
    (`resultados_carreras.carrera_id` único), expone la vista `v_carrera` y agrega
    las FK `carrera_id` en `tablas_fijas` / `marcas_carrera` / `remates` (y
    `carrera1_id` / `carrera2_id` en `dupletas`), con backfill por
    fecha+hipódromo+carrera. Aditivo e idempotente.
15. `banqueros.sql` — banquero por (grupo, modalidad). Crea `banquero_convenio`,
    agrega las columnas de banquero a `tickets_apuestas` y dos triggers:
    `trg_fijar_banquero_ticket` (BEFORE INSERT: congela el banquero en cada ticket
    que traiga `grupo_cobro_id`, según `origen`) y `trg_aplicar_banquero_ticket`
    (BEFORE UPDATE: cuando el ticket pasa de 'Pendiente' a decidido, mueve el saldo
    del banquero en espejo total y le cobra la comisión que recibe el grupo). **Sin
    este script no se pueden configurar banqueros** (Grupos → Banquero por
    Modalidad) y ninguna jugada mueve al banquero. Idempotente.
    - **Para el banquero de REMATES** hay que **volver a correr** `remates.sql`
      (paso 8: agrega `remates.grupo_id`), `remate_escritura_rpc.sql` (paso 12:
      `club_crear_remate` acepta `p_grupo_id`) y `remate_cierre.sql` (paso 9: los
      tickets de remate salen con `grupo_cobro_id` y, al cerrar el remate, si hay
      banquero configurado para REMATES se liquidan contra él en la misma
      transacción). Luego se elige el grupo al **crear** el remate. Para el
      banquero de **WPS de Taquilla**, volver a correr `banqueros.sql` después
      del paso 23: el trigger ahora también lee `nota_auditoria.modalidad`
      cuando el `origen` es `'TAQUILLA'`.
16. `dupleta_venta.sql` — venta de Dupleta. Crea la RPC `club_vender_dupleta`
    (descuenta el saldo del jugador y crea el ticket `'Pendiente'` con
    `origen = 'DUPLETA'` y `grupo_cobro_id` en una transacción, idempotente) y su
    índice único de idempotencia. **Sin este script, "Vender" en Dupletas avisa que
    la función no existe.** Requiere el paso 15 para que el banquero de Dupleta se
    congele. Idempotente.
17. `dupleta_liquidacion.sql` — **requiere los pasos 15 y 16.** Crea
    `club_liquidar_dupleta`: el cuadro `n1 x n2` gana si `n1` gana la carrera1 y
    `n2` gana la carrera2; acredita al ganador el `premio` congelado, anula y
    devuelve el stake si `n1` o `n2` se retiró, y deja el ticket 'Perdedor' en el
    resto. **Sin este script, "Liquidar" en Dupletas avisa que la función no
    existe.** Aborta sin mover saldo si falta el orden de llegada de alguna de las
     dos carreras. Idempotente.
18. `dupleta_edicion.sql` — **requiere el paso 16.** Crea `club_reasignar_dupleta`
    (cambia el jugador de una combinación ya vendida: devuelve el monto al dueño
    anterior, cobra al nuevo —mismo grupo de la venta—, valida tope `saldo+aval`
    salvo `modo_juego='libre'` y transfiere el ticket) y `club_anular_dupleta`
    (anula la venta: devuelve el stake al jugador y deja el ticket `'Retirado'`,
    idempotente). **Sin este script, editar el jugador o anular una venta de
     Dupleta avisa que la función no existe.** Requiere `dupleta_venta.sql` porque
     opera sobre el `ticket_id` que esa RPC guarda. Idempotente.
19. `tablas_fijas_sincronizar_matriz.sql` — **requiere el paso 13.** Es el arreglo
    del incidente "las carreras de hoy solo aparecen en Tablas Fijas": instala el
    trigger `trg_tablas_fijas_matriz` (`tablas_fijas` → matriz `carreras`) y su
    respaldo, que da de alta en `carreras` **toda tabla ya publicada**. El trigger
    que existía (`tablas_fijas_sincronizar_central.sql`) sincroniza
    `resultados_carreras`, que es el libro de resultados, no el catálogo: por eso
    la carrera se veía en Tablas y en ningún otro módulo. Con este, publicar una
    tabla la deja disponible para Marcas, Gestión, Dupletas, Remates, Liquidación
    y Taquilla sin depender de que la sincronización del cliente acierte. No toca
    retiros, invalidados, auditoría ni resultados. Idempotente.
20. `cierres_jornada.sql` — habilita los botones **Cierre del Día**, **Cerrar
    Semana** y **Semanas Anteriores** del Centro de Control del Grupo
    (`/inicio`), que hasta ahora solo avisaban "En desarrollo". Crea la tabla
    `cierres_jornada` (un cierre por grupo + tipo + rango, con `balance`,
    `detalle` y `cerrado_por`), en RLS para `authenticated` y **sin** acceso a
    `anon`: el histórico de caja es información de la casa. Es idempotente por
    diseño, así que volver a cerrar una semana tras corregir una liquidación
    **actualiza** la foto en vez de duplicarla. **Sin este script los tres
    botones avisan que la tabla no está disponible.** Requiere que
    `grupos_venta` exista (FK del `grupo_id`).
21. `semana_vigente.sql` — agrega `grupos_venta.semana_vigente_inicio` (el inicio
    de la semana que se está operando) y la RPC `club_fijar_semana_vigente`.
    Sin esto la semana siempre se deducía de la fecha de hoy, y cuando la casa
    seguía con la semana anterior porque la nueva no había arrancado, el botón
    **Cerrar Semana** consolidaba un rango distinto del que mostraba la pantalla.
    **NULL = se sigue deduciendo de hoy**, así que la app funciona igual sin
    aplicarlo: solo falta el botón de fijarla (que además es del usuario
    principal). La RPC valida que el inicio caiga en un día de apertura del ciclo
    y usa `soy_principal()`; a `anon` no se le da `execute`. Requiere el paso 20
    (`grupos_venta` con `dia_inicio_semana`, que trae `ciclos_facturacion_semanal.sql`).
22. `whatsapp_integracion.sql` — tablas del **Centro WhatsApp conectado a la
    Cloud API de Meta**: `whatsapp_grupos` (grupos detectados por webhook, con
    índice único sobre `(vinculado) where vinculado` para que **solo uno** sea
    destino de envíos), `whatsapp_envios` (bitácora técnica de cada llamada a
    la API) y `whatsapp_automatizaciones` (toggles de envío automático, seed
    con los 4 módulos en `false`). RLS: lectura/escritura solo vía
    `soy_principal()` o `tiene_capacidad('whatsapp:...')`, grants solo a
    `authenticated`. Requiere `seguridad_maestro.sql` + re-aplicar
    `maestro_seed.sql` (agrega `whatsapp:vincular_grupo` y
    `whatsapp:enviar_grupo`). La app funciona igual sin aplicarlo: el Centro
    WhatsApp muestra el aviso "Integración no configurada" y los botones
    wa.me siguen operando.
23. `taquilla_venta.sql` — **venta individual de Taquilla (BetSlip / Gestión de
    Jugadas) persistida.** Crea `club_vender_jugada` (valida tope `saldo+aval`,
    pertenencia al grupo y cliente activo; descuenta el saldo y crea el ticket
    `'Pendiente'` con `origen='TAQUILLA'`, `nombre_jugada`, `caballo`,
    `cliente_juega_id`, `cliente_consigue_nombre` y `grupo_cobro_id` en UNA
    transacción, idempotente por `nota_auditoria.idempotencia`) y
    `club_anular_jugada` (devuelve el saldo exacto y deja el ticket
    `'Anulado'` + `anulada=true`, idempotente). Agrega las columnas
    `anulada*` y `cliente_consigue_nombre` si faltan. **Sin este script**, la
    Taquilla vuelve al modo memoria: no produce filas, W/P/S no congelan
    banquero y la liquidación explica tickets que nadie escribió. **Requiere
    volver a correr `banqueros.sql`** (paso 15) para que el trigger congele el
    banquero de WPS leyendo `nota_auditoria.modalidad`. Idempotente.


### La fuente de carreras pasó a ser una sola

Los módulos de jugadas (Taquilla/Gestión, Tablas, Marcas, Dupletas, Remates,
Carreras del Día) leían "qué carreras hay" cruzando hasta cuatro fuentes
(`programa_dia`, `carreras`, `resultados_carreras` y `tablas_fijas`) por texto
(`upper(trim(hipodromo))`). Eso producía carreras duplicadas o huérfanas
(`"LA RINCONADA"` vs `"RINCONADA"`). Ahora **todos leen la matriz `carreras`** y
`programa_dia` quedó como documento crudo del importador. Por eso el paso 13 no
es opcional.

## Scripts que NO hay que volver a aplicar

| Archivo | Qué hacía | Por qué ya no |
| --- | --- | --- |
| `fix_rls_insercion_manual.sql` | Políticas `for all ... with check (true)` + `grant all` a anon | Superado. Ahora es un script de remediación: si lo corriste antes, ejecuta su bloque final |
| `paquete_pendientes.sql` §7 y §15 | `disable row level security` en todas las tablas | Desactivadas tras el flag; requieren `set app.permisos_globales_anon = 'SI'` |
| `programa_dia.sql`, `reset_hipodromos.sql`, `crear_tabla_dupletas.sql`, `runbook_estabilizacion.sql` | `disable row level security` + grants amplios a anon | Siguen en el repo con esa forma; usarlos solo para crear la tabla y luego cerrar |

## Cómo verificar que quedó cerrado

```sql
-- (a) RLS activo y sin política abierta a anon
select c.relname, c.relrowsecurity, p.policyname, p.roles, p.qual
  from pg_class c
  left join pg_policies p on p.tablename = c.relname
 where c.relname in ('resultados_carreras','tickets_apuestas','auditoria','programa_dia')
   and c.relkind = 'r';
```

Lo esperado: `relrowsecurity = true`, y ninguna fila con `roles` que incluya
`anon` y `qual` en `(true)`.

```sql
-- (b) La anon key no escribe. Debe fallar.
update public.resultados_carreras set dividendos = '{}' where false;
```

## La regla de fondo

Un error de permisos se arregla viendo **qué consulta** falló y **por qué**, no
agrandando el privilegio hasta que deje de fallar. El log de esa investigación
va en el comentario del script: si dentro de seis meses alguien vuelve a abrir
una tabla, el comentario tiene que explicar qué estaba realmente roto.
