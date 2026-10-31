# Manual · Sala de Jugadas de Puestos (estilo WhatsApp) y flujos relacionados

Este manual documenta las pantallas y flujos añadidos en la refactorización:

## 1. Sala de Jugadas de Puestos (estilo WhatsApp)

**Ubicación:** Widget del Agente IA (botón flotante 🤖) → pestaña **🎯 Jugadas**.

- Se sincroniza con los **clientes reales del grupo activo** y muestra su **saldo disponible** (Total / Bloqueado / Disp.).
- El jugador activo se selecciona en "Escribir como:". Los mensajes se envían como ese jugador.
- **Propuestas:** `consigo 1p del 5 con 50`, `juego 1p del 2 con 40`, etc.
  - `1n` (y cualquier variante con `n` donde `N_corredores <= X`) se **rechaza siempre**.
  - Si la carrera está **cerrada**, la IA responde: `⛔ Esta carrera ya se encuentra cerrada...`.
  - Si se propone por encima del saldo disponible: `Solo dispone de X monto`.
- **Concreción obligatoria sobre el mensaje:** se debe pulsar **↩️ Responder** en el mensaje de la propuesta y escribir `voy`, `te doy`, `jugaste`, etc.
  - Roles incompatibles → `Favor aclarar: ...`.
  - Saldo insuficiente del aceptante → `*Jugaron X monto*` (topado al saldo disponible).
  - Saldo suficiente de ambos → `*Aquí Jugaron*` (en negritas) y se bloquea el saldo de ambos.
- **Control de carrera:** botones **🔴 Cerrar Carrera** / **🟢 Abrir Carrera** dentro de la sala (estado global compartido).

## 2. Apuestas de Evento Especial (modal independiente)

**Ubicación:** Gestión de Jugadas → botón "🎯 Apuesta de Evento Especial".

- Pestañas **📝 Registrar Apuesta** y **📊 Reporte & Ganador**.
- El reporte lista las apuestas registradas; la **última fila** es un botón dashed **＋ Nueva apuesta (formulario independiente)** que limpia el formulario y vuelve a la pestaña de registro (flujo independiente, sin anidar modales).
- Selección de ganador: botón **🏆 Ganador** abre un **modal compacto de confirmación** con resumen (evento, cliente, monto jugado, cuota/logro, pago potencial) y botones Cancelar / 🏆 Confirmar ganador.

## 3. Recalcular Jornada

**Ubicación:** Gestión de Jugadas → barra de comandos → **🔄 Recalcular Jornada**.

- Recalcula **toda la jornada** de la fecha activa (todas las carreras con resultado oficial) usando el motor idempotente `recalcularJornadaCompleta`.
- Sincroniza los saldos reales de los clientes contra `contabilidad-central`.
- Idempotente: no duplica cobros ni premios.

## 4. Contabilidad automática y socios

- Toda la lógica de saldos proviene de `src/features/saldos/lib/contabilidad-central.ts`.
- Toda la lógica de puestos proviene de `src/features/motores/lib/puestos.ts`.
- La comisión del socio se imputa al saldo del socio, sin alterar el cobro/pago nominal del ticket.
- `comision_socio_devengada` se incluye una sola vez en `saldoContable`/`disponibleParaJugar`.
- Al asignar un socio a un cliente, se solicita fecha de inicio y se recalculan las comisiones.
- El reporte individual del socio segmenta las comisiones ganadas por otros jugadores y permite expandir cada jugada contribuyente.

## 5. Migración SQL

Ejecutar `sql/comision_socio_por_cliente.sql` (idempotente) para agregar columnas `comision_socio_pct`, `fecha_inicio_comision_socio`, migrar valores legacy nombre→ID y asignar afiliados.