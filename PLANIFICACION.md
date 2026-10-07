# Planificación — Sistema Hípico

## Arquitectura de Resultados de Carreras

La carga de resultados se hace **una sola vez desde Taquilla**, no en módulos individuales.  
La tabla central es `resultados_carreras` (ya definida en `sql/paquete_pendientes.sql` sección 10):

| Campo | Tipo | Clave |
|-------|------|-------|
| `fecha` | date | PK |
| `hipodromo` | text | PK |
| `carrera` | int | PK |
| `ganadores` | text[] | números ganadores (empates = varios) |
| `retirados` | text | ej. `'2, 5'` o `'NO HUBO RETIROS'` |
| `premio_oficial` | numeric | premio publicado en la gaceta |
| `premio_recalculado` | numeric | premio con baja proporcional aplicada |
| `detalle` | jsonb `[{numero, valor, retirado}]` | caballos de la tabla |
| `aplicado_a_tablas` | boolean | si ya se usó para recalcular tablas |
| `cargado_por` | text | quién lo cargó |

Restricción: `resultados_carreras_unico unique (fecha, hipodromo, carrera)`.

### Funcionamiento
1. Taquilla abre la carrera por **(día + hipódromo + carrera)**.
2. Se cargan **retirados** y **ganadores**.
3. Se calculan **dividendos** por cada tipo de jugada activo.
4. La baja proporcional del premio se aplica a `tablas_fijas` de forma automática.
5. `aplicado_a_tablas` pasa a `true` una vez procesadas las tablas afectadas.

> **NO se carga resultados desde la sección de Tablas ni desde ningún otro módulo individual.**

---

## Tipos de Jugada — Roadmap

| Tipo | Descripción | Estado |
|------|-------------|--------|
| **Win (Ganador)** | Acierta al ganador de la carrera | ✅ Motor de dividendos implementado en Taquilla |
| **Place (Lugar)** | Acierta 1.er o 2.º puesto | ✅ Motor de dividendos implementado en Taquilla |
| **Show (Mostrar)** | Acierta 1.er, 2.º o 3.er puesto | ✅ Motor de dividendos implementado en Taquilla |
| **Puestos** | Acierta posición exacta o combinación ordenada (exacta) | ✅ Motor de dividendos implementado en Taquilla |
| **Marcas** | Marcaciones especiales (trifecta o formato propio) | ✅ Motor de dividendos implementado en Taquilla |
| **Tabla** | Por tabla fija (ya existe `tablas_fijas` + `tickets_apuestas`) | En uso |
| **Dupleta** | Acierta 1.er y 2.º puesto en orden exacto (formato de dupleta) | ⏳ **Pendiente de crear el formato** |

> ⏳ **DUPELETA (pendiente):** crear el formato/entrada del boleto de dupleta (selección del 1.er y
> 2.º puesto en orden), su precio/monto, el cálculo de dividendo, el parseo en Taquilla y el registro
> en `tickets_apuestas`/`resultados_carreras.dividendos`.

Cada tipo genera su propio **dividendo** cuando se registra el resultado central.  
Los dividendos se calculan a partir de los montos apostados (pozo) y el tipo de jugada.  
El motor está en `js/components/calculo_dividendos.js` (`window.clubDividendos`): sugiere el pago
por cada `$1` (win/place/show/puestos/marcas), editable en la Taquilla antes de guardarse en
`resultados_carreras.dividendos` (jsonb).

---

## Módulo de Remates — Roadmap

> ✅ **REMATES (implementado):** los remates toman sus ejemplares de las **carreras ya cargadas
> en los hipódromos y días** (programa del día). Al registrar el remate se elige
> **Hipódromo → Fecha/Día → Carrera**, y los **ejemplares** (los mismos del programa/Gaceta)
> se asignan desde ahí, conservando su vínculo de origen (`hipodromo_id`, `fecha`, `carrera`,
> `ejemplar_numero`).

| Tipo | Descripción | Estado |
|------|-------------|--------|
| **Remate manual** | Caballos cargados a mano en el remate (legacy) | Solo lectura |
| **Remate por programa** | Ejemplares tomados de las carreras cargadas en hipódromos y días | ✅ **Implementado** |

### Cierre económico
- [x] **Cerrar** liquida en UNA transacción (`club_cerrar_remate`): cada ejemplar con comprador
  emite ticket de venta en `tickets_apuestas` y descuenta `clientes.saldo_actual`; los
  ejemplares **sin comprador quedan en CASA** (sin ticket ni descuento).
- [x] Idempotente: reintentar el cierre (o el corte de red) no vuelve a cobrar el mismo ejemplar.
- [x] **Reabrir** (`club_reabrir_remate`) no borra tickets ni devuelve saldos: permite asignar
  comprador a los que siguen en CASA y bloquea los ya vendidos.
- [x] Venta posterior de un CASA (`club_vender_caballo_remate`) con el mismo descuento e
  idempotencia.
- [x] Migración `sql/remate_cierre.sql` (columnas `cerrado_at`/`liquidado_at`, índice e
  idempotencia por `nota_auditoria::jsonb`): **aplicada** en Supabase.
- [x] Prueba funcional contra `REMATE DE PRUEBA 1`: cierre 4 ventas / 4 CASA / 590 USD,
  doble cierre rechazado, reapertura, venta posterior y doble venta rechazada.
- [ ] Limpieza manual en el SQL Editor: borrar los 5 tickets que dejó la prueba
  (`nota_auditoria like '%22e96d14-...%'`). `anon`/`authenticated` no tienen DELETE.

### Esquema propuesto (a validar)
- El formulario de nuevo remate carga: **Hipódromo** → **Día/Fecha** → **Carrera** (select),
  y de ahí se pueblan los **ejemplares** de esa carrera (de `programa_dia`/Gaceta o del
  padrón de la carrera), sin escribirlos a mano.
- Cada caballo del remate queda vinculado con su origen: `hipodromo_id`, `fecha`, `carrera`,
  `ejemplar_numero`.

---

## Pendientes Relacionados

### AVAL: se activa, pero hay saldos inflados que reparar a mano

**La regla que quedo implementada.** El aval es crédito negado, **no efectivo**:
autoriza a jugar por encima del saldo y el saldo queda debitado en negativo (esa
deuda se cobra). El tope de juego es `saldo + aval`, o sea: un cliente con saldo
`-200` y aval `300` tiene `$100` disponibles, no `$0`. Modo `libre` = sin tope.

Repartida en los tres lados, porque si el navegador topa distinto que la RPC el
caja autoriza de más (la RPC lo rechaza y se pierde la venta) o topa donde sí
había crédito (no se vende):

- `src/lib/taquilla/reparto.ts` — `disponibleParaJugar` = saldo + aval. Es el
  módulo PURO y la única definición de la regla.
- `src/lib/grupos.ts` — `limiteDeJugar`, `esClienteLibre` y `textoDisponible`
  **delegan** en el anterior; no lo reimplementan.
- Modales: `ModalMarcas`, `MonitorTablas`, `EjemplarModal`, `GestionJugadasModule`
  y el selector de `DupletaModule`.
- SQL: `club_vender_marca` y `club_vender_tabla` topan contra `saldo + aval` y
  eximen al modo `libre`.

**Tres bugs que aparecieron de paso, y que ya están corregidos:**

1. `club_vender_tabla` **no validaba saldo en absoluto**: cualquier monto pasaba
   y el cliente podía quedar en negativo sin límite. Además leía el cliente sin
   `for update`, así que dos cajas leían el mismo saldo y la segunda `UPDATE` se
   lo pisaba a la primera.
2. El modo `libre` solo existía en el navegador: la RPC rechazaba la venta, así
   que un cliente libre no podía comprar ni una marca.
3. `club_registrar_deposito` sumaba el aval a `saldo_actual` **y** a `aval` en
   `Otorgar Aval`, y `Pagar Aval` abonaba el saldo. Eso hacía tres cosas malas:
   el aval contaba **dos veces** como poder de compra (dar `$500` de aval concedía
   `$1000`), el cliente podía **retirar** esos `$500` como si fueran efectivo, y
   "pagar el aval" le **creaba** saldo. Ahora el aval solo mueve `aval`, y
   `Pagar Aval` cancela primero la deuda del saldo y lo que sobra reduce el aval.

**Lo que falta: reparar los saldos ya inflados.** Corregir la RPC no deshace el
doble conteo ya aplicado. Este reporte dice a quién y cuánto; **no lo ejecutes a
ciegas, míralo primero**:

```sql
with d as (
  select cliente_id,
         sum(case when tipo_operacion = 'Otorgar Aval' then coalesce(monto, 0) else 0 end)
       - sum(case when tipo_operacion = 'Pagar Aval'   then coalesce(monto, 0) else 0 end) as doble
    from public.depositos
   where tipo_operacion in ('Otorgar Aval', 'Pagar Aval')
   group by cliente_id
)
select c.nombre,
       c.saldo_actual              as saldo_actual,
       coalesce(c.aval, 0)         as aval,
       d.doble                     as doble_contado,
       c.saldo_actual - d.doble    as saldo_corregido
  from public.clientes c
  join d on d.cliente_id = c.id
 where d.doble <> 0
 order by d.doble desc;
```

`doble_contado` es la plata que el banco le regaló por error. Se corrige con
`update public.clientes set saldo_actual = saldo_actual - <doble_contado>`, pero
**solo después de que alguien confirme la cifra contra el libro**: si un cliente
compró con ese saldo inflatado, ya gastó plata que no tenía, y eso es una
decisión del banco, no una corrección de un `UPDATE`.

Ojo al monto: se usa `depositos.monto` (crudo), no `monto_usd`, porque eso era
exactamente lo que la RPC sumaba — incluso cuando el movimiento era en Bs.

- [ ] **Aplicar `sql/contabilidad.sql`, `sql/marcas_venta.sql` y
      `sql/tablas_venta.sql`** en el SQL Editor de Supabase. Hasta que se apliquen,
      el navegador topa con `saldo + aval` y el servidor con `saldo_actual`: la
      diferencia es exactamente el aval, o sea **toda venta con aval se rechaza**.

### Validar los caballos al cargar una jugada (HECHO)

Al cargar una jugada, la columna **caballo** no puede llevar un número que no
sea uno de los caballos **registrados en esa carrera**. Antes se aceptaba cualquier
número y el error aparecía después, en la liquidación, como "el caballo N no
aparece en el orden de llegada" - o peor, se liquidaba un ticket de un caballo que
nunca corrió.

Regla implementada:

- **Si la carrera tiene caballos registrados:** solo se aceptan esos números.
  La revisión es **por conjunto**, no por rango: si corren 1, 5 y 9, el 2 y el 10
  se rechazan aunque quepan en el rango.
- **Si la carrera NO tiene caballos registrados:** se acepta como máximo hasta el
  **16**. Si la carrera cargada muestra más de 16 caballos, el tope sube al
  número más alto que muestre: el número que la carrera muestra es un hecho, y
  toparlo en 16 sería inventar que ese caballo no existe.
- **El campo vacío no es error** (una jugada de Taquilla, 2n o triples no lleva
  ejemplar), y una expresión con un número malo se rechaza **entera**: si
  "1,2x3" tiene el 3 malo, no entra medio tiempo.

Dónde va:

- `src/lib/taquilla/caballos.ts` — módulo PURO con la regla. No es lo mismo que
  `marcas/registradas.ts`: aquel exige que la carrera tenga ejemplares (sin lista
  no se *configuran* Marcas) y este tiene que tolerar la carrera vacía, porque la
  Taquilla carga jugadas sobre carreras que aún no pasaron por Marcas.
- `GestionJugadasModule` — la celda CABALLO se pinta roja con "No corre" apenas
  se escribe, y `cargarAtaquilla` **bloquea la fila** diciendo qué número está mal,
  en vez de dejarla pasar. La Carga Rápida avisa cuántas líneas salieron con
  caballo inválido y las conserva para corregirlas (no las descarta como las
  ilegibles: un número malo es un tipeo, una línea ilegible no se puede recuperar
  sin releerla).

Sobre la RPC: **hoy no hay RPC en este camino.** Los tickets de Taquilla viven en
el store del navegador (`useTaquillaStore`, persistido en localStorage) y nada los
escribe en la base todavía - es el backlog de "BetSlip no persiste en
`tickets_apuestas`". Cuando se escriba esa RPC, la regla de arriba tiene que
repetirse ahí, leyendo los participantes de `resultados_carreras` igual que hace
`club_vender_marca`. Las dos RPC de venta que **sí** existen hoy ya validan contra
la carrera: `club_vender_marca` rechaza una marca que no corre, y
`club_vender_tabla` vende solo los caballos de la tabla.


### La jugada de Marcas cambió: de un paquete a un match de a uno (SQL pendiente)

**Regla anterior:** elegir un caballo lo ponía a jugar contra *todas* las marcas
(`CONTRA_TODAS`), y una marca contra todas las que tenía a su izquierda
(`CONTRA_IZQUIERDA`). Elegir no significaba nada: el paquete se armaba solo.

**Regla nueva:** cada jugada es **de un caballo contra un caballo**. El operador
elige cuál, y la norma de derecha a izquierda acota la lista:

- Solo se puede jugar un caballo **de la derecha** (una marca que no sea la
  primera) o **fuera de la marca**.
- Sigue bloqueado lo que no vale: el NV y, con el switch apagado, los debutantes.
- La **punta de la izquierda sigue bloqueada**: no tiene a nadie a su izquierda,
  así que no tiene con qué emparejarse.
- El rival **siempre** es uno de la izquierda. Un caballo de la izquierda contra
  uno de la derecha es un cruce que la norma prohíbe y que el selector ni siquiera
  ofrece; si se fuerza por API, la RPC lo rechaza.

Implementación: `calcularRivales()` en `src/lib/marcas/jerarquia.ts` devuelve
ahora `candidatos` (la lista legal) y `rival` (el elegido, cayendo al primero si
el que llega no es legal). La RPC `club_vender_marca` recibió `p_rival` y lo
revalida contra esa misma lista antes de escribir el ticket.

Lo que **no** hubo que tocar:

- `club_liquidar_marca` sigue igual. Lee `rivales_snapshot` del ticket y gana si
  llega por delante de lo que ahí está. Con la regla nueva la lista tiene un
  elemento; con los tickets viejos tiene la de antes. **Cada ticket se liquida
  como se vendió**, sin importar cuándo se liquidó.
- Los tickets ya vendidos no se reescriben ni se re-cobran.

Pendiente real: **aplicar `sql/marcas_venta.sql`** (ver `sql/RUNBOOK_SQL.md`).
Sin eso la firma con `p_rival` no existe y toda venta de Marcas falla.

### Apply de seguridad: lo que falta para que esto sea una frontera real

Estado: el código ya está completo y verificado; lo que falta es **aplicarlo**.
Ningún punto de esta lista se puede cerrar desde el repo, porque todos tocan la
base o la consola de Supabase.

- [ ] **Aplicar `src/db/seguridad_maestro.sql` en el SQL Editor de Supabase.** No
      está aplicado: las cinco tablas (`capacidad`, `tipo_usuario`,
      `tipo_usuario_capacidad`, `usuario_sistema`, `usuario_capacidad`) dan
      `404 Could not find the table`. Mientras tanto no hay login funcional, y
      `pruebas/auditar-base-maestro.mjs` lo dice exacto en cada corrida.
- [ ] **Aplicar `src/db/maestro_seed.sql`** (128 capacidades, 16 módulos, matriz
      de los 4 tipos y el usuario principal, más las 10 reglas ABAC).
- [ ] **Aplicar `src/db/rls-negocio.sql`** (después del seed, no antes). Cierra
      `anon` en las tablas de negocio y mueve la decisión a `authenticated`.
- [ ] **`node pruebas/crear-admin.mjs josorioc "CLAVE"`** con
      `SUPABASE_SERVICE_ROLE_KEY`. Además del alta en Auth, el script ahora ata
      el `auth_id` de la fila en `usuario_sistema`: sin ese enlace las policies
      no reconocen a nadie y el usuario entra al login sin ver un permiso.
- [ ] **Rotar las credenciales expuestas** antes de aplicar el RLS. El orden
      importa: mientras `portal_token`, `portal_clave` y las 3 contraseñas del
      legacy sigan vivos, cerrar la lectura es cerrar la puerta con la llave
      puesta. Todavía no se puede leer nada con anon.
- [ ] **Revisar la tabla `operadores` del legacy.** El login viejo comparaba
      contraseñas en texto plano contra ella. Si esas filas siguen ahí, son un
      diccionario listo para usar contra cualquier otro servicio que comparta
      usuarios. No se tocó: es dato del legacy y borrarlo es decisión del dueño.
- [ ] **Ejecutar `sql/reclamos_storage.sql`**: el bucket `reclamos` **no existe**
      (verificado: el proyecto no tiene ningún bucket), así que hoy la imagen de
      una disputa falla con `NoSuchBucket`. El archivo se reescribió porque la
      versión anterior era una trampa: creaba el bucket **público**, le ponía
      policies para `anon` y hacía `disable row level security` sobre `clientes`
      y `tickets_apuestas` — es decir, abría la cartera y las apuestas de todo el
      club. La versión nueva lo deja **privado** (subida y lectura por URL firmada
      que emite la Edge Function), tira las policies viejas y reactiva el RLS.
- [ ] **`auditoria` es de lectura pública** (`anon_read_temporal` en
      `sql/seguridad.sql`). Es una concesión consciente porque la app todavía
      no usa Supabase Auth para el personal, así que no hay `auth.uid()` contra
      el cual filtrar. Contiene `usuario`, `ip` y `navegador`. Se cierra junto con
      la migración a Auth de más arriba.

**Lo que ya quedó hecho y verificado** (todo en verde: `tsc` 0, `validar-rbac`
269 checks, `maestro-seguridad` 106 tests, `deno check` de la Edge Function y
`npm run build`):

- [x] Las 5 tablas del maestro con RLS, y `public.tiene_capacidad()` /
      `public.puede_contexto()` como `security definer` con `search_path` fijo
      (sin eso, un atacante mete un esquema delante y la función lee su tabla).
- [x] ABAC: 10 reglas, 8 de integridad y 2 límites operativos, con `clase`
      explícita en el maestro. `integridad` no la salta ni el principal;
      `limite` sí, y ahí la excepción es el comportamiento esperado.
- [x] Los guards están conectados en las operaciones de verdad, no solo en la
      UI: liquidar, retiros, movimientos contables, resolver ticket y
      crear/editar/borrar hipódromos.
- [x] El portal ya no se apoya en el `role` del JWT. La Edge Function verifica
      con `auth.getUser` y, además, pregunta a la matriz: un JWT válido no
      convierte a cualquiera en staff.

**Lo que sigue siendo una limitación honesta**, y no un bug pendiente de
arreglar:

- `src/lib/portal.ts` y los guards del navegador son **comodidad, no
  seguridad**. El build es `output: "export"`, así que no hay servidor donde
  validar nada. La frontera es Postgres.
- La regla `ticket:anular:accion_valida` **no se puede evaluar en RLS**: la
  acción es lo que el operador eligió y no hay columna que la guarde. En la base
  se comprueba el invariante del estado (que sí está en la fila); la acción se
  comprueba en `resolverTicket()`. Una regla de ABAC solo pasa a ser frontera de
  la base cuando el dato que necesita está en la fila.
- `actualizarHipodromo` valida **los dos** nombres: el que tiene la fila y el
  que queda. Validar solo el del `patch` permitía editar el hipódromo de otro
  mandando el nombre propio con el id ajeno.
- Las RPC contables son `security definer`, así que **no están sujetas a RLS**.
  Hay que revisarlas una por una y meterles el ABAC adentro, o pasarlas a
  `security invoker`. Mientras tanto el `INSERT` directo por PostgREST sí cae en
  la policy, y por eso `transacciones_financieras` tiene la suya.
- El resto de tablas de negocio que la app escribe directo
  (`resultados_carreras`, `tablas_fijas`, `bancos`, `clientes_grupos`, ...)
  sigue sin auditar. `sql/grupos_venta_lectura.sql` cubre parte, pero es un
  parche, no el sistema.

### Módulo de Inicio de Sesión (`/login`)
Estado: el login con usuario/contraseña contra **Supabase Auth** ya funciona
(`src/app/login/page.tsx` + `src/lib/auth/sesion.ts`). El operador escribe su
usuario corto (`josorioc`) y `resolverCorreo()` lo traduce a
`<usuario>@<NEXT_PUBLIC_AUTH_DOMAIN>` (por defecto `sistemahipico.local`).
La contraseña nunca se valida ni se guarda en el navegador: se verifica contra
Supabase y queda la sesión firmada del servidor. `AuthBootstrap` expulsa a
`/login` si no hay sesión y `salir()` hace `signOut` + borra las cookies de
permisos del middleware.

- [x] Formulario de usuario + contraseña con error de acceso y estado de carga.
- [x] Verificación real vía `supabase.auth.signInWithPassword` (sin credenciales en el código).
- [x] Bloqueo de la app sin sesión (`AuthBootstrap` -> `/login`).
- [x] Cierre de sesión: `signOut` + limpieza de cookies de permisos.
- [x] Script de alta del administrador: `pruebas/crear-admin.mjs` (requiere `SUPABASE_SERVICE_ROLE_KEY`).
- [ ] **reCAPTCHA / Cloudflare Turnstile** en el envío del formulario. Al agregarlo:
      widget invisible o v2 checkbox, clave pública en `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
      y **verificación del token en el servidor** (nunca confiar en el cliente).
      Hoy NO se puede hacer: el build es `output: "export"` y no hay Route Handlers
      ni API donde validar. Poner el widget sin verificación sería seguridad de
      mentira. Hay que elegir: migrar a un host con funciones de servidor (Vercel,
      Node propio) o levantar una Supabase Edge Function que verifique el token
      y que el login consulte antes de llamar a `signInWithPassword`.
      Mitigación mientras tanto: Supabase Auth ya aplica rate limiting por IP y
      por cuenta en `signInWithPassword`, que es lo que evita el 99% del
      fuerza bruta. El Turnstile agrega capa, no sustituye.
- [x] **"Olvidé contraseña"**. `pedirRecuperacion()` (`resetPasswordForEmail` con
      `redirectTo` armado sobre `window.location.origin`, porque el build es
      estático) + página `/reset-password` que solo funciona con la sesión de
      recuperación que deja el enlace del correo. El aviso es SIEMPRE el mismo,
      exista o no la cuenta: un mensaje distinto convierte el formulario en un
      enumerador de quién tiene cuenta (chequeado en `validar-rbac.mjs` [13]).
      Falta, del lado de Supabase y no del código: agregar el origen del sitio a
      **Authentication → URL Configuration → Redirect URLs**, y definir la
      plantilla de correo de recuperación.
- [ ] Decidir si el ingreso por `usuario` sin dominio se normaliza a un correo
      único o se admiten varios correos por operador (hoy es 1:1 con el dominio).

### Módulo de Taquilla
- [x] Implementar sección **"Carga de Resultados"** usando `resultados_carreras` (botón **Ctrl+Y** activo).
- [x] Reutilizar el componente compartido `js/components/modal_resultado.js` (`clubModalResultado`) para el modal de carga.
- [x] Activar el botón **"Preliminar Resultado (Ctrl+Y)"** (`html/taquilla.html:150`).
- [x] Conectar el campo `inputRetirados` (`html/taquilla.html:79`) — pre-marca retiros y recibe el resultado.
- [x] Desarrollar motor de dividendos por tipo de jugada (`js/components/calculo_dividendos.js`) + modal de captura/ajuste.
- [ ] Aplicar el resultado de `resultados_carreras` en **liquidaciones/Saldos** (vincular dividendos al pago de premios).

### Tablas Fijas
- [x] Eliminar carga de resultados desde el módulo de Tablas (completado).
- [x] Botón de auditoría/resultado removido del monitor de tablas.

### Convenios por tipo de jugada y grupo
- [x] Crear tabla de convenios: `convenio_tipo_grupo(tipo_jugada_id, grupo_id, comision, comision_base, permite_cruces)` (SQL idempotente).
- [x] Implementar sección UI en "Grupos y Convenios" (`html/grupos.html`): matriz % / base $ / cruces por tipo y grupo.
- [x] Selector de banco uniforme aplicado en Grupos (crear y editar usan el catálogo `BANCOS_VZLA`).
- [x] Comentarios referenciados en `js/tablas.js` y `js/components/modal_resultado.js` — van aquí.

### Gaceta del Día
- [x] Cards de gaceta idénticas a Tablas Fijas (grilla, Nº 4×5, valor, "Monto a Pagar/Tabla" $100, "Suma de la Tabla").
- [x] Segmentación de `js/gaceta.js` en 4 archivos: `gaceta_helpers.js`, `gaceta_ia.js`, `gaceta_padron.js` y `gaceta.js` (UI).
- [x] Grilla de resultados en 3 columnas desde ≥640px (`#carrerasGaceta`, `#carrerasEnsamblaje`, `#carrerasVenta`) + cache-busting CSS/JS.

### Venta de Tablas Fijas
- [x] Tarjetas de venta con el mismo visual de Gaceta/Ensamblaje (clic sobre ejemplar abre la venta).
- [x] Modal de venta con jugador + grupo que COBRA (auto = grupo de venta) + grupo que recibe COMISIÓN (seleccionable).
- [x] El ticket congela grupos: `grupo_cobro_id/nombre` y `grupo_comision_id/nombre` (paquete SQL, sección 11).
- [x] Reportes de riesgo/ventas agrupados por grupo que cobra con columna de grupo comisión.

### Módulo de Resultados — conectado a los reportes
- [x] Mostrar `dividendos` y `orden_llegada` en los reportes de liquidación y en el portal.
  - `leerPizarra()` (`src/lib/liquidacion/reportes.ts`) ya no selectea solo `ganadores`: lee
    `orden_llegada` + `dividendos`, prefiere el orden oficial y pasa los dividendos a
    `ticketMotorDe()` — antes iban hardcodeados en `null`, así que **todo se liquidaba a la par de
    la casa (2×/120×)**.
  - `leerResultadoOficial()` (`src/lib/carreras-dia.ts`) reutilizable para cualquier consumidor.
  - `MetaCarrera.dividendos`: la Relación de Resultados (`relacionResultados`) y la de WhatsApp
    toman el pago NINI del dividendo oficial en vez del 2× fijo.
  - `puestosDesdeOrdenLlegada()` (`src/lib/motores/oficiales.ts`) normaliza las **cuatro** formas
    en que el orden de llegada se guardó en el proyecto: `[{numero,puesto}]` (la canónica),
    `["7","9"]`, `{1:"7"}` y `{primero,segundo…}`. Sin esto se leía `"[object Object]"`.
  - En producción las 131 filas de `resultados_carreras` tienen `dividendos` y `orden_llegada` en
    NULL: falta que las cargas de resultado los graben.

### Escritura de resultados: ya no es abierta a `anon` (⚠️ SQL pendiente de correr)
- [x] La app escribe por `club_guardar_resultado_carrera` (RPC `security definer` que valida la
      capacidad **en el servidor**), con caída al upsert directo solo si la RPC no existe.
- [ ] **Ejecutar `sql/resultados_rpc.sql` en el SQL Editor de Supabase.** Antes de correrlo la app
      sigue igual (cae al upsert); después, `anon` solo puede LEER la tabla.
  - Verificado con la anon key que hoy `UPDATE`/`DELETE` sobre `resultados_carreras` están
    permitidos: cualquiera que abriera el sitio podía cambiar los dividendos que mueven la
    liquidación de dinero.

### El orden de los scripts de SQL era la vulnerabilidad (⚠️ cerrado en el repo, falta aplicar)
- [x] El problema de fondo no eran las tablas sueltas: era que el cierre de una y la apertura de
      otra vivían en scripts distintos, sin orden. `paquete_pendientes.sql` cerraba el paso por
      RPC y **en su propia sección 7 y en el bloque final (15) apagaba el RLS de todas las tablas y
      le abría `INSERT/UPDATE/DELETE` a `anon`** — con un comentario que decía que se podía
      re-ejecutar "sin romper nada". Correrlo después de `resultados_rpc.sql` deshacía el cierre.
- [x] `paquete_pendientes.sql`: las secciones 7 y 15 quedaron detrás del flag
      `app.permisos_globales_anon`, apagado por defecto, y el "se puede re-ejecutar sin romper
      nada" del encabezado quedó corregido. El resto del archivo (columnas, tasas, siembra) sigue
      siendo idempotente y útil.
- [x] `fix_rls_insercion_manual.sql` reescrito: ya no crea políticas `for all ... with check
      (true)` ni `grant all` a `anon`. Ahora es un script de **remediación** para quien haya
      corrido la versión vieja.
- [x] `sql/RUNBOOK_SQL.md`: el orden de aplicación, la lista de scripts que no hay que volver a
      correr y las consultas de verificación.
- [x] **La causa raíz del aperture era un bug de la app, no del SQL.** `guardarPrograma()` se
      tragaba *cualquier* fallo de `club_guardar_programa_dia` y caía a un `.upsert()` directo,
      que el RLS rechazaba; como no se podía cerrar la tabla, alguien la abrió con
      `fix_rls_insercion_manual.sql`. Corregido en `src/lib/gaceta/programa.ts`: el fallback ahora
      solo se usa si la RPC **no está instalada** (42883 / PGRST202). Cualquier otro error se le
      propaga al operador, que antes veía "guardado" por un atajo que no pasó por ninguna
      validación.
- [ ] Aplicar en este orden: `paquete_pendientes.sql` → `resultados_rpc.sql` →
      `reclamos_storage.sql` → `auditoria_rls.sql` → `migrar-wps-tickets.sql`.

### El log de auditoría era legible por cualquiera (⚠️ SQL pendiente de correr)
- [x] `seguridad.sql` y `paquete_pendientes.sql` creaban `anon_read_temporal` con `using (true)`
      sobre `auditoria`, justificándolo con que *"la app todavía no usa Supabase Auth"*. Ese día ya
      pasó: la app autentica y resuelve permisos con `tiene_capacidad()`. La política quedó como
      andamiaje de una transición que nunca se desarmó.
- Lo que exponía no es dato de negocio: `ip`, `navegador`, `ubicacion` y `accion` de cada
      operación. Es decir, quién y desde dónde operó la casa.
- [x] La lectura pública se eliminó de ambos scripts y quedó en `sql/auditoria_rls.sql`, que la
      condiciona a la capacidad `seguridad:celda_auditoria` — la misma que exige el botón en la UI.
  Un usuario logueado **sin** esa capacidad recibe 0 filas, no un volcado.
- [x] La escritura no se tocó: sigue pasando por `club_log_accion`, que es `security definer` y por
  eso corre con los permisos del dueño de la tabla. `anon` puede invocar la RPC sin poder escribir
  directo.
- [ ] **Ejecutar `sql/auditoria_rls.sql`.** Efecto esperado: el `SELECT` sobre `auditoria` con la
      anon key pasa de N filas a 0.

### El gate de encoding no miraba `sql/`
- [x] `maestro-seguridad.test.mjs` escaneaba `src/`, `supabase/` y `pruebas/`, pero no `sql/`:
      justo donde el SQL se mantiene a mano con comentarios en español. Al incluirlo aparecieron
      **3 archivos con U+FFFD real** (`crear_parametros_semana_grupo.sql`,
      `crear_rpc_parametros_semana.sql`, `plataforma_tablas.sql`), ya reparados.
- Queda como nota, no como fallo, el mojibake latin1 heredado (`da-as`, `dA-a`) en esos mismos
  comentarios: es daño viejo de conversión, anterior a este trabajo.

### El mismo bug, otra vez: la jugada sin ejemplar se cobraba como perdida
- [x] `indeterminado` cubría el **dividendo** faltante, pero no el **ejemplar** faltante, y ese camino
      era igual de silencioso.
- Qué pasaba: el BetSlip no tenía forma de capturar el ejemplar y `PagarCarreraModal` reenviaba los
  tickets al motor sin el campo `caballo` (`pagarYCerrar.ts` lo lee con `String(t.caballo ?? "")`).
  Al llegar con `""`, `posicionesDePizarra(...).get("")` daba `undefined`, el motor lo interpretaba como
  "el ejemplar no llegó al top 3" y devolvía **pérdida** con `balanceBanca = monto`. Como
  `saldos.ts` persiste `estado='Perdedor'` con premio 0 y eso no se revierte al liquidar de nuevo,
  la casa se quedaba el stake entero de una jugada que podía haber ganado, sin error visible.
- Peor todavía: `BetSlip` guardaba `comando: \`${monto} ${tipo}\``, y `tipo` para un nini es
  `"NINIS"`, no la nomenclatura `"2n"`. Es decir, también se perdía la estructura de la jugada.
- [x] `liquidarWps` ahora devuelve `indeterminado` cuando el ejemplar viene vacío **o** cuando no
      aparece en la pizarra. No se puede distinguir desde el motor si está retirado, si la pizarra
      quedó a medias o si el operador se equivocó de número, y adivinar "perdida" cobra el stake sin
      aviso.
- [x] `BetSlip` tiene campo **CABALLO** propio (1–8), se lo pasa a `validarComando`, lo guarda en el
      ticket y **bloquea el registro** si el número no es válido. Se guardaba el comando tal como lo
      escribió el operador, no uno reconstruido.
- [x] `PagarCarreraModal` reenvía `caballo` a `liquidarCarreraYCerrarTabla`.
- Pruebas: 80 casos en `pruebas/wps.test.ts` (8 nuevos cubren ejemplar vacío y ejemplar ausente).

### Pendiente estructural: el BetSlip no persiste en `tickets_apuestas`
- [ ] Verificado por búsqueda en todo `src/`: `tickets_apuestas` se **lee** (clientes, reportes,
      impresión, saldos) pero **nunca se inserta** desde el frontend. Los tickets del BetSlip viven
      solo en `localStorage` (zustand `persist`).
- Consecuencia: la venta individual de Taquilla **no genera filas en `tickets_apuestas`**. Al pagar
  la carrera, `aplicarLiquidacionSaldos` liquida los tickets que otro flujo haya creado
  (marcas, tablas, portal), no los que el operador acaba de vender. El resultado que sí se persiste
  es la matriz de dividendos en `resultados_carreras`.
- Esto es anterior a la migración de W/P/S y excede su alcance, pero conviene decidirlo: si la
  Taquilla debe producir tickets reales, falta el paso de INSERT (con `nombre_jugada`, `caballo`,
  `monto_jugado`, cliente y grupo de cobro) antes de liquidar.

### Las pruebas rompían `next build` al compilar dentro de `src/`
- [x] `pruebas/tsconfig.json` tiene `noEmit: false` (node no corre TS), así que **emite**. El harness
      oficial (`run-marcas.ps1`) le pasa `--outDir %TEMP%` y todo bien, pero un
      `npx tsc -p pruebas/tsconfig.json` a pelo deja el `.js` de cada módulo **junto al `.ts`**.
- Se juntaron 23 `.js` dentro de `src/` y `next build` empezó a compilar
      `src/lib/seguridad/capacidades.js`, que falló con
      `Module parse failed: Cannot use 'import.meta' outside a module`.
- Lo que lo hace peligroso: el síntoma es un error de build en una ruta que nadie tocó
      (`/contabilidad/bancos`), y `.gitignore` no ayuda porque esos archivos nunca se commitean.
      Aparecen, rompen y desaparecen con un `clean`.
- [x] `pruebas/tsconfig.json` declara `outDir: ../.tsbuild-pruebas`. La CLI lo sobreescribe, así que
      los dos caminos quedan cubiertos.
- [x] Gate en `maestro-seguridad.test.mjs`: falla si hay un `.js` junto a un `.ts` dentro de `src/`,
      y verifica que el tsconfig declare `outDir`.
- [x] `.gitignore`: `.tsbuild-pruebas/`, `*.tsbuildinfo` y `pruebas/*.js`.
- [ ] `tsconfig.tsbuildinfo` está **trackeado** en git. Con `*.tsbuildinfo` ignorado, hay que
      desindexarlo (`git rm --cached tsconfig.tsbuildinfo`) para que el ignore surta efecto: hoy
      `npx tsc --noEmit` lo reescribe y ensucia el `git status`. No se hizo porque toca el índice.

### El hueco de los dividendos sin cargar (corregido en el motor)
- [x] **Una jugada que GANA por posición pero no tiene dividendo cargado ya no se cobra $0.**
      Este no era un detalle de W/P/S: aplicaba a toda modalidad que dependa de un dividendo.
- Contexto medido en producción: las **131 filas de `resultados_carreras` tienen
  `dividendos = null`**, y `CargaResultadosModal` sí tenía la casilla de captura, pero sin los
  campos que el motor necesita para W/P/S.
- El problema: para todos los consumidores del motor, `ok: false` significa **"Perdedor"**.
  `saldos.ts` escribía `estado = 'Perdedor'` y `premio_pagar = 0`, y como el estado queda
  persistido, volver a liquidar ya no lo revierte: el operador no veía ningún error y la casa
  perdía el pago de una jugada ganadora.
- Solución: `ResultadoMotor.indeterminado`. El motor lo devuelve cuando sabe que el ejemplar
  ocupaba el puesto que paga pero falta el dato que cuantifica el premio. Los tres consumidores
  lo respetan:
  - `saldos.ts` deja el ticket **PENDIENTE**, no lo toca, y reporta el motivo en `errores`.
  - `reportes.ts` lo cuenta como `ok: null` (pendiente), no como derrota.
  - `pagarYCerrar.ts` lo reporta en el mensaje de la liquidación.
- Ojo: la "par de la casa" (2×) de `oficiales.ts` NO aplica a este caso. Un `W` que llegó 1º no se
  puede pagar a 2× solo porque falte el dividendo.

### Módulo de Remates
- [x] Cargar los ejemplares del remate desde las **carreras cargadas en los hipódromos y días**
      (programa del día) en vez de capturarlos manualmente.
- [x] Encadenar el formulario: **Hipódromo → Fecha/Día → Carrera → Ejemplares** (selects poblados
      desde el programa/Gaceta).
- [x] **Cierre económico** atómico, **reapertura** y **venta posterior de un CASA**
      (`sql/remate_cierre.sql`, aplicado y probado).
- [x] Endurecer los permisos de las RPC de Remates (`club_cerrar_remate`,
      `club_reabrir_remate`, `club_vender_caballo_remate`): verifican en el
      servidor `tiene_capacidad(auth.uid(), 'remates:fn_guardar_remate')`, así que
      un `anon` o un usuario sin la capacidad no puede invocarlas directo.
- [x] **Fix del guard que no cerraba** (`sql/fix_tiene_capacidad.sql`):
      `public.tiene_capacidad` devolvía `NULL` sin fila de usuario (o con
      `auth.uid()` null), y `if not NULL` no dispara: los guards dejaban pasar a
      `anon`. Se envolvió el resultado en `coalesce(..., false)` (fuente:
      `src/db/seguridad_maestro.sql`) y los guards de `remate_cierre.sql` y
      `remate_pujas_rpc.sql` usan `coalesce(...)` directo. Las RPC de pujas ahora
      revocan `EXECUTE` de `PUBLIC`/`anon` (Postgres lo da a PUBLIC por defecto).
- [x] Mover las **escrituras de pujas** a RPC `security definer`
      (`sql/remate_pujas_rpc.sql`: `club_asignar_pujas_remate`,
      `club_pujar_caballo_remate`, `club_eliminar_caballo_remate`, con recálculo de
      probabilidades e historial en la misma transacción) y dejar `remate_caballos`
      y `remate_pujas` en **solo lectura** para `authenticated` (sin `anon`). El
      navegador ya no escribe esas tablas directo.
- [x] Mover las **escrituras de la subasta** a RPC `security definer`
      (`sql/remate_escritura_rpc.sql`: `club_crear_remate`, `club_eliminar_remate`,
      `club_guardar_incentivo_remate`, `club_guardar_escalera_remate`) y dejar
      `remates` en **solo lectura** para `authenticated` (sin `anon`). Se cierra la
      última tabla de Remates que el navegador escribía directo.
- [x] **Retiros en su lugar** (`RematesModule.tsx`): la lista "Ejemplares del
      programa" ahora es una sola lista en el orden original del programa (como
      Tablas Fijas). El retirado/invalidado se marca tachado **en su renglón**, en
      vez de saltar a un bloque aparte al final. Los ya asignados siguen viviendo
      en la pizarra, así que una puja nunca "se mueve" del remate.
- [ ] Pendiente relacionado: el tope de **saldo/aval/Libre** se sigue validando en
      el navegador (`autorizarPujasRemate`); un operador con la capacidad podría
      saltarlo. Mover esa validación a las RPC de pujas para cerrarlo en servidor.

### Fuente única de carreras (una sola verdad) ⭐
Antes "qué carreras hay" se respondía desde hasta **cuatro** lugares
(`programa_dia`, `carreras`, `resultados_carreras`, `tablas_fijas`) y se unían por
texto (`upper(trim(hipodromo))` + `carrera` + `fecha`). Eso generaba carreras
duplicadas o huérfanas (`"LA RINCONADA"` vs `"RINCONADA"`) y que un módulo viera
una carrera y otro no. Se centralizó en la **matriz `carreras`**.

- [x] `listarCarrerasCentrales` (`src/lib/carreras/central.ts`) lee **solo la
      matriz**: se quitó el fallback legacy a `resultados_carreras`.
- [x] `listarCarrerasPorDia` (`src/lib/tablas/rpc.ts`) lee **solo la matriz**: se
      quitaron los cruces con `programa_dia`, `tablas_fijas` y `resultados_carreras`
      (incluido el fallback por `fecha_creacion`). Alimenta el semáforo de la
      Taquilla/Gestión, Marcas, Reportes y Dupleta.
- [x] `guardarCarreraCentral` / `eliminarCarreraCentral` escriben **solo la
      matriz**: sin upsert/delete de respaldo en `resultados_carreras`.
- [x] **Documento crudo vs. verdad**: `programa_dia` queda como documento que solo
      consume el importador; `resultados_carreras` queda como libro de resultados.
      Ninguno lista carreras.
- [x] SQL fundacional `sql/carrera_unica.sql` (requiere `sql/carreras.sql`): crea
      `carrera_ejemplares` (inscripción 1:N con trigger que refleja
      `carreras.caballos`), fuerza el resultado **1:1** (`resultados_carreras.carrera_id`
      único), expone la vista `v_carrera` y agrega FK `carrera_id` en
      `tablas_fijas` / `marcas_carrera` / `remates` y `carrera1_id` / `carrera2_id`
      en `dupletas`, con backfill por fecha+hipódromo+carrera.
- [x] `sql/RUNBOOK_SQL.md`: `carreras.sql` pasa a ser **paso 13 obligatorio** (sin
      él la app muestra "La matriz de carreras no está disponible") y
      `carrera_unica.sql` el paso 14.
- [x] **Write-path unificado** (`src/lib/carreras-dia.ts`): `registrarCarreraProgramada`
      escribe **solo la matriz** (se quitó el upsert a `resultados_carreras` y el
      fallback a `programa_dia`). `cargarCarrerasDelDia` arma la jornada desde la
      matriz y solo adjunta el resultado/ventas del libro por carrera; ya no lista
      carreras que existan únicamente en `resultados_carreras`.

---

## Ticket por jugada (venta) y Banquero por modalidad

### Venta con ticket y preview
- Cada venta de **Marcas**, **Dupleta** y **Tablas Fijas** genera su propio ticket en
  `tickets_apuestas` (registro de la jugada en espera del resultado). Antes de escribir,
  las tres modalidades muestran un **preview editable** (`TicketVentaPreview`) con
  Corregir/Confirmar; nada se escribe hasta Confirmar.
- Componente compartido: `src/components/tickets/TicketVentaPreview.tsx` (`TicketVentaModel`).
- Marcas: `ModalMarcas.tsx` (`solicitarVenta`/`confirmarVenta`) → RPC `club_vender_marca`.
- Tablas: `MonitorTablas.tsx` (`lanzarVenta`/`confirmarVentaPreview`) → `club_vender_tabla_fija`.
- Dupleta: `DupletaModule.tsx` (`venderCelda`/`confirmarVentaDupleta`) → RPC nueva
  `club_vender_dupleta` (`sql/dupleta_venta.sql`). Antes la celda se guardaba solo en el
  JSON de `dupletas`; ahora además descuenta saldo y crea ticket.
- Bugs corregidos: el monto de Venta Rápida contaba tablas como dinero (ahora
  `item.monto = valor × cantidad`); Tablas nunca persistía (`persistirVenta` con `cantidad`).

### Banquero por (grupo, modalidad)
- Un banquero es un **cliente del grupo** que toma el lado contrario. Al liquidar, su
  saldo se mueve en **espejo total** (pierde el jugador → +monto_jugado; gana →
  −premio_pagar; retirado → 0) y paga una **comisión** (típico 2,5% sobre el monto
  decidido; configurable: decidido / jugado / ganancia) que recibe el **grupo**. 0% =
  passthrough (no se le cobra nada).
- Config: `GruposModule.tsx` → sección **Banquero por Modalidad**; datos en
  `src/lib/banqueros.ts`, tabla `banquero_convenio`.
- SQL `sql/banqueros.sql`: `trg_fijar_banquero_ticket` (BEFORE INSERT: congela en el
  ticket por `grupo_cobro_id` + `origen`) y `trg_aplicar_banquero_ticket` (BEFORE UPDATE:
  espejo + comisión al liquidar). No edita los RPCs de venta.
- **Remates con banquero:** `remates.grupo_id` (se elige al crear el remate). Sus
  tickets salen con `grupo_cobro_id`; al cerrar el remate, si el grupo tiene banquero
  para `REMATES`, el ticket se pasa a decidido y el trigger le mueve el saldo espejo
  (+monto de la venta) y le cobra la comisión que recibe el grupo. Sin grupo, el
  ticket queda como antes (`grupo = 'REMATE'`, `Pendiente`).
- **WPS sigue sin banquero:** no hay venta WPS persistida (el `BetSlip` vive en un
  store en memoria), así que no hay ticket al que congelarle el banquero.
- **Liquidación de Dupleta** (`sql/dupleta_liquidacion.sql`, RPC `club_liquidar_dupleta`):
  el cuadro `n1 x n2` gana si `n1` gana la carrera1 y `n2` gana la carrera2; acredita el
  `premio` congelado, anula y devuelve el stake si `n1`/`n2` se retiró, y el resto queda
  'Perdedor'. Botón **Liquidar dupleta** en `DupletaModule.tsx`. El movimiento del
  banquero lo aplica el trigger al liquidar. Aborta si falta el orden de llegada.

---

## Módulo de Tickets por Solucionar ⭐ (nuevo — actividad a desarrollar)

El cliente debe poder **disputar una jugada** desde la sección de *Reportes de Cuentas / Reportes de
Jugadas* del Portal, y la **casa** (operador/admin) responde a través del módulo de Tickets.

### Flujo
1. En **Reportes de Jugadas del cliente**: el cliente selecciona una jugada (fecha, hipódromo, carrera,
   tipo y monto) y la somete a **reconsideración**.
2. Anexa una **imagen de soporte** (pegada con Ctrl+V desde el portapapeles o desde archivo).
3. Se crea automáticamente un **ticket** con número propio y estado **CREADO**.
4. La casa abre el ticket en **Ticket / Solucionar**: pasa a **EN REVISIÓN**, escribe la respuesta
   (aceptación, ajuste o rechazo) y lo cierra como **SOLUCIONADO** (con reembolso/abono si aplica).
5. Al cerrar, el cliente recibe la **encuesta de satisfacción** simple: *"¿Cómo considera la atención
   brindada?"* con estrellas/nivel (1 a 5) + campo opcional de comentario.

### Estados del Ticket
| Estado | Significado |
|--------|-------------|
| `CREADO` | El cliente submite la disputa (pendiente de la casa) |
| `EN_REVISION` | La casa marcó que está atendiendo la disputa |
| `SOLUCIONADO` | Respondido y cerrado (opcional: abono/reembolso a saldo) |

### Esquema propuesto (SQL idempotente, tabla nueva)
```sql
create table if not exists tickets_jugadas (
  id uuid primary key default gen_random_uuid(),
  numero_ticket serial unique,               -- visible para el cliente: "T-2026-001"
  cliente_id uuid references clientes(id),
  cliente_nombre text,
  jugada_origen text,                          -- descriptor: "TABLA LA RINCONADA C3 · N° 5-$50" o id de ticket
  jugada_id text,                              -- id de tickets_apuestas / tablas vendidas si aplica
  tipo_jugada text,                            -- TABLA / WIN / PLACE / SHOW / PUESTOS / MARCAS
  fecha_jugada date, hipodromo text, carrera int,
  monto numeric, premio_recalculado numeric,
  motivo text,                                 -- motivo de la disputa (cliente)
  imagen_soporte text,                         -- dataURL/base64 o URL de la imagen pegada
  estado text not null default 'CREADO'
    check (estado in ('CREADO','EN_REVISION','SOLUCIONADO')),
  respuesta_casa text,                         -- decisión escrita de la casa
  accion_aplicada text,                        -- 'ABONO'|'REEMBOLSO'|'RECHAZO'|'AJUSTE'|null
  monto_resuelto numeric,                      -- monto abonado/reembolsado si aplica
  respondido_por text, respondido_at timestamptz,
  encuesta_satisfaccion int check (encuesta_satisfaccion between 1 and 5),
  encuesta_comentario text, encuesta_at timestamptz,
  creado_por text, creado_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Entregables
- [x] SQL de la tabla `tickets_jugadas` (paquete pendientes, sección 13) con estados CREADO/EN_REVISION/SOLUCIONADO, abono/reembolso y encuesta 1-5.
- [x] Portal: botón **"Disputar jugada"** por fila en *Reportes de Jugadas del cliente*.
- [x] Modal de disputa: selección de jugada, motivo, **imagen pegada (Ctrl+V)** y confirmación.
- [x] Consola de la casa (migrada a React en `/tickets`): listado por estado, detalle, responder
      con acción y monto, cambiar estados CREADO→EN_REVISIÓN→SOLUCIONADO.
- [x] Vista del cliente de **mis tickets** (portal): estado, respuesta de la casa, y la encuesta al cerrar.
- [x] Encuesta de satisfacción: *"¿Cómo considera la atención brindada?"* (1–5 estrellas + comentario).
- [ ] Notificación **automática** por WhatsApp/plataforma al abrir y al responder. Hoy el envío
      es manual (botón "Enviar por WhatsApp" en la consola); falta el disparador automático.

---

## MÓDULOS DEL DASHBOARD PENDIENTES DE MIGRACIÓN

> Backlog de la vista principal de Grupos (`/inicio`, migración 1:1 del legacy).
> Los que **no** están migrados muestran su tarjeta como "Pronto" y los botones de
> cierre emiten `toast.info` hasta que exista implementación real.

### Ya migrados (se rewirenaron; NO eran backlog)
- [x] **Depósitos** → `/contabilidad/ingresos` (`ContabilidadModule tabInicial="ingresos"`).
- [x] **Retiros** → `/contabilidad/caja` (`modo: "retiro"`).
- [x] **Transferencias** → `/contabilidad/caja` (`modo: "traslado"`).
- [x] **Monedas / Tasas** → `/contabilidad/monedas`.
- [x] **Bancos** → `/contabilidad/bancos`.
- [x] **Auditoría** → pestaña nueva de `/seguridad?pestana=auditoria`
      (`AuditoriaPanel`, lee `public.auditoria` con filtros de fecha/módulo/usuario/acción).
      Cumple la capacidad `seguridad:celda_auditoria`, que estaba **declarada en el maestro y
      sin ninguna pantalla que la aplicara** (igual que `seguridad:celda_simulacion`, que sigue
      huérfana). El acceso del dashboard y el del Sidebar ya no son stubs.
- [x] **Dupletas** — la pestaña de Taquilla que decía "DupletasEngine en construcción" era un
      resto del legacy: el módulo real vive en `/dupleta` y la pestaña ahora lo enlaza.

### Pendientes de migración / conexión al backend
- [x] **Winner / Place / Show (W.P.S.)** — motor americano de dividendos (legacy `html/wps.html`).
      **MIGRADO**: el motor quedó en `src/lib/motores/wps.ts` y la jugada es un ticket normal
      (`tickets_apuestas` con `nombre_jugada` = `W`/`P`/`S`), no una tabla aparte como `wps_tickets`:
      - El pago depende de DOS cosas a la vez (qué se apostó × en qué puesto llegó), así que usa una
        **matriz** de 6 celdas en `resultados_carreras.dividendos`: `wps_WW`, `wps_WP`, `wps_WS`,
        `wps_PP`, `wps_PS`, `wps_SS`. El prefijo `wps_` es necesario porque `PP` sin calificar ya es
        el Pareo y `win`/`puestos` ya son claves de otras modalidades. La matriz es la del legacy
        (`js/wps.js` §3): un `W` que llega 2º no paga, y un `P` que llega 2º paga `PP`, no `WP`.
      - El tablero cotiza "paga $ por $2" y el motor trabaja por $1: `pagoPorUno()` hace la conversión
        una sola vez, al cargar el resultado (nuevo bloque "Cargar matriz americana W/P/S" en
        `CargaResultadosModal`).
      - Comisión 5% sobre el premio bruto, como el resto de modalidades (el legacy de WPS no cobraba).
      - Pestaña real en Taquilla que comparte el flujo de Puestos; la nomenclatura es `100 W|P|S`.
      - Pruebas: `pruebas/wps.test.ts` (72 casos, con regresión de `PP`/`1P` para que no entren).
      - SQL a mano: `sql/migrar-wps-tickets.sql` convierte las jugadas que quedaron en `wps_tickets`.
- [ ] **Pollas** — registro y pago de pollas.
- [ ] **Remates** — toma ejemplares de carreras cargadas (requiere el formato de remates).
- [ ] **Dupletas: "spin"** — pendiente de definición. El módulo `/dupleta` ya está migrado y
      funcional (lee el registro central, centraliza el retiro con `alternarRetiroCarrera` y
      persiste la matriz completa en `public.dupletas`), pero NO existe ninguna implementación de
      "spin" ni en `src/components/dupletas/DupletaModule.tsx`, ni en `src/lib/dupletas.ts`, ni en
      `sql/crear_tabla_dupletas.sql`, ni en el legacy (`js/` y `html/` no tienen módulo de
      dupletas). Queda anotado aquí a falta de que se precise qué debe hacer:
      - [ ] ¿Girar/invertir la matriz (intercambiar `carrera1` ↔ `carrera2` en `claveDupleta`)?
      - [ ] ¿Ruleta o animación al generar la matriz o al elegir 1.er y 2.º puesto?
      - [ ] ¿Autocompletar precio/distancia/premio desde la carrera central al elegir el par?
- [ ] **Ingresos / Avales** — abonos y avales por cliente.
- [ ] **Reglas de Jugadas** — administración de `tipos_jugadas` y dividendos.
- [ ] **Operadores** — la pestaña *Usuarios* de `/seguridad` cubre alta y permisos, pero no el
      modelo legacy de `operadores` (tabla + relación con hipódromos).
- [x] **Diagnóstico** — utilidad de sanidad del sistema. Implementado en `/diagnostico`
      (`src/lib/diagnostico.ts` + `src/components/diagnostico/DiagnosticoModule.tsx`), con la
      puerta de `/seguridad` porque es herramienta de administración. Mide lo que dolía: si la
      matriz `carreras` está aplicada, si **toda carrera publicada en Tablas Fijas tiene fila en la
      matriz** (el fallo que hacía hipódromos "no existir"), hipódromos sin `hipodromo_id`,
      resultados sin `carrera_id`, si el SQL de cierres está aplicado, y la operación del día.
      El botón **🔧 Reparar matriz** completa lo que falta y nada más: crea las carreras ausentes,
      enlaza `hipodromo_id` con un update de UNA columna (no un upsert, que pisaría caballos y
      estados del operador) y enlaza resultados sueltos. Es idempotente y exige
      `carreras:fn_registrar_carrera`.

### Lógica de cierre (Caja / Semana)
> Implementado en `src/lib/liquidacion/cierres.ts` + `sql/cierres_jornada.sql` (paso 20 del
> runbook). Los tres botones consolidación de verdad: calculan el balance con el MISMO reporte que
> muestra `/saldos-reportes` (`construirReporteSemana`), piden confirmación con la cifra a la vista
> y registran la foto del balance en `cierres_jornada`. El cierre NO mueve saldos ni bloquea la
> operatoria —consolidar es una lectura, no un pago— y por eso es idempotente por
> (grupo, tipo, rango): corregir una liquidación y volver a cerrar actualiza la foto.
- [x] **Cierre del Día** — consolidación de caja de la jornada (botón visible en `/inicio`).
- [x] **Cerrar Semana** — consolida el balance de la semana fiscal del grupo usando
      `dia_inicio_semana` / `dia_fin_semana` de `grupos_venta` (ver
      `src/lib/liquidacion/semana.ts` → `rangoSemanaDeGrupo`). El chip de la semana pasa a
      **CERRADA**.
- [x] **Semanas Anteriores** — histórico de cierres de día y de semana con su balance, con
      **Reabrir** (borra la foto para poder reconsolidar).
- [x] Marcar días de la semana como **CERRADO (verde)** una vez exista el cierre de caja diario.
- [ ] La capacidad usada es la existente `contabilidad:fn_registrar_movimiento` (consolidar caja es
      escribir en caja). Si algún día se quiere separar "ver cierres" de "cerrar", declararlas en
      `capacidades.ts` **con fila en la base**, o el botón queda muerto para todos.

---

## Iconos de la SPA: emoji, no FontAwesome

- [x] La app **nunca cargó** FontAwesome (ni por CDN ni por `next/font`), así que los ~140
      `<i className="fas fa-*">` que arrastraba el legacy se veían **en blanco**: el botón
      quedaba sin icono y sin explicación. Todos se sustituyeron por emoji (`<span>`, con las
      mismas clases de tamaño/color) en Clientes, Estado de Cuenta, Datos de Pago, ModalCliente,
      ModalPortalCliente, Notificaciones, Contabilidad (módulo y tabs), DashboardGrupos,
      GruposModule, JugadasModule, PortalModule y TicketsModule. No queda ningún `fas`/`fab`
      en `src/`.
- Convención desde ahora: **emoji**, no clases de icono. Si alguna vez se quiere FontAwesome de
  verdad, es una decisión explícita (cargar la fuente + un mapa de nombres), no un `<i>` suelto.

---

| Archivo | Propósito |
|---------|-----------|
| `js/components/modal_resultado.js` | Componente reutilizable de modal de resultado/caballos |
| `js/components/calculo_dividendos.js` | Motor de dividendos win/place/show/puestos/marcas (`window.clubDividendos`) |
| `js/taquilla.js` | Taquilla — carga central de resultados + modal de dividendos |
| `js/grupos.js` + `html/grupos.html` | Grupos y convenios (selector de banco uniforme + matriz `convenio_tipo_grupo`) |
| `js/tablas.js` | Tablas fijas — ya sin carga de resultados |
| `sql/paquete_pendientes.sql` sec. 10 | Definición SQL de `resultados_carreras` |
| `sql/resultados_rpc.sql` | RPC `club_guardar_resultado_carrera` + cierre de la policy abierta a `anon` |
| `sql/reclamos_storage.sql` | Bucket privado `reclamos` (firmas por Edge Function) + estado `RECHAZADO` |
| `src/lib/motores/oficiales.ts` | `puestosDesdeOrdenLlegada()` — normaliza las 4 formas de orden de llegada |
| `src/lib/carreras-dia.ts` | `leerResultadoOficial()` + escritura de resultados vía RPC |
| `src/components/seguridad/AuditoriaPanel.tsx` | Visor de `public.auditoria` (pestana de Seguridad) |
| `html/wps.html` + `js/wps.js` | Motor WPS separado (dividendos americanos) |
| `html/remates.html` + `js/remates.js` | Remates — (pendiente) tomar ejemplares de las carreras cargadas en hipódromos y días |
| `html/tickets.html` + `js/tickets.js` | (NUEVO) Tickets por solucionar — disputas de jugadas |
| `js/gaceta_helpers.js` · `js/gaceta_ia.js` · `js/gaceta_padron.js` | (NUEVO) Segmentación del módulo gaceta |

---

*Última actualización: 2026-09-30 (resultados conectados a los reportes; escritura de
`resultados_carreras` detrás de RPC; bucket de reclamos privado; visor de auditoría; stubs de
contabilidad y dupletas rewirenados)*
