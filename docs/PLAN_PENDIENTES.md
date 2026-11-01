# Plan de trabajo pendiente — sistema_hipico

Fecha base: 2026-11-01. Rama: `main` (HEAD `c6815f57`).
Alcance: todo lo que quedó pendiente tras unificar saldos y los primeros cambios del agente WhatsApp.

---

## Fase 0 — Cierre del trabajo de saldos (HECHO)

- [x] `clientes.saldo_actual` como única fuente de verdad (portal, estado de cuenta, cartera, reportes).
- [x] `calcularResumenContableCliente` respeta `saldoEnBase`; sin auto-curación SAM/PEDRO ni escrituras al leer.
- [x] `disponibleParaJugar = saldo + aval − riesgo`.
- [x] `sincronizarSaldosRealesClientes` solo enriquece con datos de período.
- [x] Reporte: CARTERA por defecto, "Resultado del Rango" como vista alternativa, etiquetas/tooltips.
- [x] Estado de cuenta: "Saldo Actual (Libro)" principal, resultado del período secundario.
- [x] Ocultar devolución/incentivo cuando no están configurados.
- [x] Buscadores con escritura (SearchableSelect) en estado de cuenta, cuaderno y cruce.
- [x] Fuente Inter (cifras sin rayas), base 17px.
- [x] Botón de desglose saldo + devolución/incentivo (oculto por defecto).
- [x] Verificación live: 11 clientes × 4 vistas coinciden con el libro.
- [x] Commit + push a `origin/main`.
- [x] tsc + build OK.

---

## Fase 1 — Auditoría de saldos negativos (datos) — PRIORIDAD ALTA

**Objetivo:** decidir si los saldos negativos del libro son legítimos o corrupción.

**Clientes afectados:** SAM (−3064,37), AYARI (−499,08), NEWCASTLE (−132), SPEEDY (−31,70), RUCIO (−162,50).

**Tareas**
1. Para cada cliente, reconstruir el libro desde movimientos:
   - `saldo_inicial` (si existe) + depósitos (`depositos`) − retiros (`transacciones_financieras` tipo retiro) + impacto neto de tickets (jugadas ganadas − perdidas − comisiones + incentivos + comisiones de socio) + ajustes manuales.
   - Comparar con `saldo_actual`.
2. Documentar la diferencia (si la hay) y su causa probable (jugada por encima de saldo histórico, retiro sin fondos, doble acreditación).
3. Si es corrupción: crear un **movimiento auditado** (no auto-curación silenciosa) que corrija `saldo_actual`, con asiento NIIF y registro en `notificaciones`/bitácora.
4. Si es legítimo: dejarlo y documentar por qué un cliente puede tener saldo negativo (aval cubre el riesgo).

**Archivos:** script de auditoría en `pruebas/` (temporal, no commiteado) usando service role; `movimientos-operador.ts`, `contabilidad.ts`.

**Criterio de salida:** tabla reconciliada cliente → saldo calculado vs. saldo libro, con explicación por cada diferencia.

---

## Fase 2 — Agente WhatsApp completo — PRIORIDAD ALTA

### 2.1 Registrar jugadas desde el grupo (falta)
- Parser de sintaxis de apuestas (consigo/juego, modalidades 1P..6Y7NY7N, PP, 10A, etc.) reutilizando `evaluarPropuestaJugada` / `procesarMensajeSalaJugadas` de `sala-jugadas-whatsapp.ts`.
- Validación de carrera abierta (ya existe el check CERRADA/PIZARRA).
- Clipping al saldo disponible ("Solo dispone de X").
- Creación de ticket en `tickets_apuestas` con `grupo_id` (whatsapp group) y cliente resuelto por teléfono.
- Bloqueo de saldo del jugador y del dador.
- **No self-play:** rechazar si jugador == dador.

**Archivos:** `supabase/functions/whatsapp-webhook/index.ts`, `src/features/portal/lib/sala-jugadas-whatsapp.ts` (portar lógica a Deno o exponer como RPC).

**Decisión de arquitectura:** portar la lógica pura a Deno es frágil. Alternativa recomendada: crear RPCs en Supabase (`registrar_jugada_whatsapp`, `liquidar_carrera_whatsapp`) que encapsulen la lógica en PL/pgSQL/SQL y que el webhook solo invoque. Esto mantiene una sola fuente de verdad.

### 2.2 Liquidación con pizarra (falta)
- Al recibir `Pizarra:`, invocar `pagarYCerrar.ts` (o su equivalente como RPC) para:
  - Calcular ganadores/perdedores, premios, comisiones, incentivos, comisiones de socio.
  - Actualizar `saldo_actual` de cada cliente (créditos/débitos).
  - Generar asientos NIIF (partida doble) por cliente y por concepto.
  - Marcar carrera como LIQUIDADA.
- Responder al grupo con resumen (ganadores, montos pagados, comisiones).

### 2.3 Corrección / reversión (falta)
- Comando `Corregir: <pizarra>` o `Reversar` que invoque `reversar-nucleo.ts` / `reversar.ts`.
- Revertir saldos, asientos NIIF y estado de carrera a ABIERTA.

### 2.4 NIIF en la Edge Function (falta)
- Por cada movimiento de saldo (depósito, retiro, jugada, liquidación, reversión), generar asiento en `contabilidad_asientos` + líneas en `contabilidad_asientos_lineas` con las cuentas del plan (`plan-cuentas.ts`).
- Usar la tasa de cambio del día para moneda origen → USD.

### 2.5 Top-up web + admin (parcial)
- [x] Solicitud con monto y cliente resuelto por teléfono.
- [x] Aprobación con `SÍ <código>`.
- [ ] Subida de comprobante (URL) y validación por el admin en la web (`ModalCobroYValidacionCliente`).
- [ ] Notificación al cliente al aprobar/rechazar (ya envía WhatsApp; falta notificación in-app).

### 2.6 Per-group isolation (hecho)
- [x] Migración aplicada; índice único por grupo.
- [ ] Verificar que `whatsapp_grupos` se vincule a `grupos.id` cuando el admin configure el grupo (hoy no hay vínculo).

### 2.7 Tests y docs (falta)
- Pruebas de integración del webhook (Mock de Graph API).
- Actualizar `MANUAL_JUGADAS_WHATSAPP.md` con los comandos finales.
- Documentar los RPCs nuevos.

**Criterio de salida Fase 2:** un grupo de WhatsApp puede abrir carrera, recibir jugadas, cerrar, recibir pizarra, liquidar saldos y NIIF, y corregir; DM consulta saldo y abona con aprobación `SÍ`.

---

## Fase 3 — Infraestructura y despliegue — PRIORIDAD MEDIA

1. **Desplegar la app Next** a producción (hosting) para que los cambios de fuente/saldos se vean en el entorno real.
2. **Meta UI:** "Verify and Save" del webhook, publicación de la app, prueba real en grupos (requiere acción del usuario; los números de prueba no se pueden agregar a grupos).
3. Verificar en el dashboard de Supabase que el índice nuevo y las tablas WhatsApp existan.
4. Rotar el PAT de Supabase usado (`sbp_fcd12...`) por seguridad.

---

## Fase 4 — Tests y calidad — PRIORIDAD MEDIA

1. Corregir la prueba `contabilidad-cruces-7col` ("detecta jugada ANULADA") — ajustar la aserción al contrato actual.
2. Investigar las 3 fallas pre-existentes (`anuladas-reportes`, `apuestas-evento-especial`, `saldos-en-curso`) y decidir si se corrigen o se documentan como baseline.
3. Agregar pruebas de regresión para:
   - `sincronizarSaldosRealesClientes` no modifica `saldo_actual`.
   - `calcularResumenContableCliente` con `saldoEnBase` respeta el libro.
   - Estado de cuenta oculta devolución/incentivo cuando `devPct === 0`.

---

## Fase 5 — Cosmético / opcional — PRIORIDAD BAJA

1. Revisar que no queden referencias a JetBrains Mono en CSS/docs (ya limpio en `src`).
2. Revisar tamaños de fuente en componentes que usan `text-[9px]`/`text-[10px]` para que el aumento a 17px no rompa layouts.
3. Mejorar el desglose del reporte: separar devolución vs. incentivo en dos líneas cuando ambos existan (hoy se agrupan en `devPct`).

---

## Orden sugerido de ejecución

1. Fase 1 (auditoría de saldos) — 1 sesión.
2. Fase 2.1–2.2 (jugadas + liquidación) — varias sesiones, requiere decisión de arquitectura (RPC vs. portar a Deno).
3. Fase 3 (deploy + Meta) — bloqueado por acción del usuario.
4. Fase 4 (tests) — en paralelo con Fase 2.
5. Fase 5 — al final.

## Riesgos

- **Portar el motor de liquidación a Deno** duplica lógica y puede divergir. Mitigación: RPCs en Supabase (recomendado).
- **NIIF en la Edge Function** requiere conocer el plan de cuentas y las reglas de partida doble; ya existe `plan-cuentas.ts` y `pagos-comprobantes.ts` como referencia.
- **Saldo negativo legítimo vs. corrupción** no se puede resolver sin datos; requiere auditoría manual (Fase 1).
- **Meta no permite probar grupos con números de prueba** → la validación real del WhatsApp dependerá de la publicación de la app.