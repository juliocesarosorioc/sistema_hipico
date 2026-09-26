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

> ⏳ **REMATES (pendiente):** los remates deben tomar sus ejemplares de las **carreras ya cargadas
> en los hipódromos y días** (programa del día), en lugar de capturarse manualmente. Al elegir
> un **hipódromo** y una **fecha/día**, el sistema debe listar las **carreras de ese día** y sus
> **ejemplares** (los mismos del programa/Gaceta) para asignarlos al remate.

| Tipo | Descripción | Estado |
|------|-------------|--------|
| **Remate manual** | Caballos cargados a mano en el remate (actual) | En uso |
| **Remate por programa** | Ejemplares tomados de las carreras cargadas en hipódromos y días | ⏳ **Pendiente** |

### Esquema propuesto (a validar)
- El formulario de nuevo remate debe cargar: **Hipódromo** → **Día/Fecha** → **Carrera** (select),
  y de ahí poblar automáticamente los **ejemplares** de esa carrera (de `programa_dia`/Gaceta o del
  padrón de la carrera), sin escribirlos a mano.
- Vincular cada caballo del remate con su origen: `hipodromo_id`, `fecha`, `carrera`, `ejemplar_numero`.

---

## Pendientes Relacionados

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

### Módulo de Resultados (pendiente de conectar a reportes)
- [ ] Mostrar `dividendos` y `orden_llegada` en los reportes de liquidación y en el portal.
  - (Infra lista: `resultados_carreras.dividendos/orden_llegada` ya existen como columnas — paquete SQL, sección 10.)

### Módulo de Remates
- [ ] Cargar los ejemplares del remate desde las **carreras cargadas en los hipódromos y días**
      (programa del día) en vez de capturarlos manualmente.
- [ ] Encadenar el formulario: **Hipódromo → Fecha/Día → Carrera → Ejemplares** (selects poblados
      desde el programa/Gaceta).

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
- [ ] Portal: botón **"Disputar jugada"** por fila en *Reportes de Jugadas del cliente*.
- [ ] Modal de disputa: selección de jugada, motivo, **imagen pegada (Ctrl+V)** y confirmación.
- [ ] `html/tickets.html` + `js/tickets.js`: consola de la casa (listado por estado, detalle, responder
      con acción y monto, cambiar estados CREADO→EN_REVISIÓN→SOLUCIONADO).
- [ ] Vista del cliente de **mis tickets** (portal): estado, respuesta de la casa, y la encuesta al cerrar.
- [ ] Encuesta de satisfacción: *"¿Cómo considera la atención brindada?"* (1–5 estrellas + comentario).
- [ ] Notificación por WhatsApp/plataforma al abrir y al responder (reutilizar `js/whatsapp.js` si aplica).

---

## MÓDULOS DEL DASHBOARD PENDIENTES DE MIGRACIÓN

> Backlog de la vista principal de Grupos (`/inicio`, migración 1:1 del legacy).
> Los módulos enumerados **no están migrados/conectados al backend** en la SPA:
> en el Dashboard sus tarjetas de Acceso Rápido se muestran "Pronto" y los botones
> de cierre emiten `toast.info` hasta que exista implementación real.

### Pendientes de migración / conexión al backend
- [ ] **Depósitos** — ingreso de dinero/saldos a clientes (afecta `clientes.saldo_actual`).
- [ ] **Retiros** — egresos y pagos a socios.
- [ ] **Transferencias** — movimientos entre clientes/grupos.
- [ ] **Monedas / Tasas** — tabla de tasas de cambio y monedas de juego.
- [ ] **Bancos Reales** — cuentas bancarias del club por grupo (ya hay `cuenta_bancaria` en `grupos_venta`).
- [ ] **Winner / Place / Show (W.P.S.)** — motor americano de dividendos (legacy `html/wps.html`).
- [ ] **Pollas** — registro y pago de pollas.
- [ ] **Remates** — toma ejemplares de carreras cargadas (requiere el formato de remates).
- [ ] **Auditoría** — bitácora de acciones del operador.
- [ ] **Ingresos / Avales** — abonos y avales por cliente.
- [ ] **Reglas de Jugadas** — administración de `tipos_jugadas` y dividendos.
- [ ] **Operadores** — gestión de usuarios del sistema.
- [ ] **Diagnóstico** — utilidad de sanidad del sistema.

### Lógica de cierre (Caja / Semana)
- [ ] **Cierre del Día** — consolidación de caja de la jornada (botón visible en `/inicio`).
- [ ] **Cerrar Semana** — consolida el balance de la semana fiscal del grupo usando
      `dia_inicio_semana` / `dia_fin_semana` de `grupos_venta` (ver
      `src/lib/liquidacion/semana.ts` → `rangoSemanaDeGrupo`). Los **Saldos
      Consolidados** deben evaluar este rango para la "Semana en curso".
- [ ] **Semanas Anteriores** — consulta de semanas cerradas con su balance.
- [ ] Marcar días de la semana como **CERRADO (verde)** una vez exista el cierre de caja diario.

---

## Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `js/components/modal_resultado.js` | Componente reutilizable de modal de resultado/caballos |
| `js/components/calculo_dividendos.js` | Motor de dividendos win/place/show/puestos/marcas (`window.clubDividendos`) |
| `js/taquilla.js` | Taquilla — carga central de resultados + modal de dividendos |
| `js/grupos.js` + `html/grupos.html` | Grupos y convenios (selector de banco uniforme + matriz `convenio_tipo_grupo`) |
| `js/tablas.js` | Tablas fijas — ya sin carga de resultados |
| `sql/paquete_pendientes.sql` sec. 10 | Definición SQL de `resultados_carreras` |
| `html/wps.html` + `js/wps.js` | Motor WPS separado (dividendos americanos) |
| `html/remates.html` + `js/remates.js` | Remates — (pendiente) tomar ejemplares de las carreras cargadas en hipódromos y días |
| `html/tickets.html` + `js/tickets.js` | (NUEVO) Tickets por solucionar — disputas de jugadas |
| `js/gaceta_helpers.js` · `js/gaceta_ia.js` · `js/gaceta_padron.js` | (NUEVO) Segmentación del módulo gaceta |

---

*Última actualización: 2026-09-16 (remates desde carreras cargadas en hipódromos y días)*
