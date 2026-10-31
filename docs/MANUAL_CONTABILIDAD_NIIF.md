# 📖 MANUAL DE CONTABILIDAD AUTOMATIZADA, NIIF Y PARTIDA DOBLE HÍPICA

Este manual establece los procedimientos contables oficiales del **Sistema Hípico**, diseñado bajo principios de contabilidad **NIIF (Normas Internacionales de Información Financiera)** y partida doble estricta (`Debe === Haber` en centavos exactos).

---

## 1. Estructura General del Plan Único de Cuentas (PUC)

El plan contable se organiza jerárquicamente en 7 clases fundamentales:

| Clase | Nombre | Naturaleza | Propósito |
| :---: | :--- | :---: | :--- |
| **1** | **Activo** | Deudora | Efectivo, bancos (`1.1`) y cuentas por cobrar a clientes avalados y convenios (`1.2`). |
| **2** | **Pasivo** | Acreedora | Fondos en custodia de jugadores (`2.1.01.001`), cuentas por pagar premios a avalados (`2.1.01.003`), honorarios por pagar (`2.1.06.001`). |
| **3** | **Patrimonio** | Acreedora | Capital operativo de la casa y resultados acumulados de ejercicios/semanas. |
| **4** | **Ingresos** | Acreedora | Comisiones ganadas por intermediación según modalidad y ventas netas inter-grupos. |
| **5** | **Costos e Incentivos** | Deudora | Costos de premios pagados por la casa, reembolsos por cruces y devoluciones a jugadores. |
| **6** | **Gastos Operativos** | Deudora | Comisiones bancarias, diferencial cambiario y honorarios del equipo de trabajo. |
| **7** | **Cuentas de Orden** | Deudora / Acreedora | Control de exposición y riesgo contingente en curso por carreras vivas. |

---

## 2. Tratamiento Contable Estricto: Clientes Avalados vs Prepago

### A. Clientes Avalados (Operación a Crédito / Aval)
- **Cuando un cliente avalado GANA**:
  - Su ganancia neta representa una **obligación exigible y líquida** para la casa.
  - Se acredita a la cuenta de Pasivo: **`2.1.01.003 — Cuentas por Pagar Premios Clientes Avalados`**.
  - Asiento: `Debe: 2.1.01.001 (si hubo cruce) o Ganancia Casa / Haber: 2.1.01.003`.
- **Cuando un cliente avalado PIERDE**:
  - Su pérdida genera un **derecho de cobro a favor de la casa**.
  - Se debita a la cuenta de Activo: **`1.2.02.001 — Cartera de Avales Otorgados por Cobrar`**.
  - Asiento: `Debe: 1.2.02.001 (Cuentas por Cobrar Aval) / Haber: 4.1.01.x (Comisión de la Casa)`.

### B. Clientes Regulares (Saldo en Custodia / Prepago)
- **Al Ganar**: Se acredita a su saldo en custodia: **`2.1.01.001 — Depósitos y Saldos Acreedores`**.
- **Al Perder**: Se debita de su saldo en custodia: **`2.1.01.001`**.

---

## 3. Desglose Analítico de Ingresos por Comisión según Modalidad

Para garantizar trazabilidad absoluta de ingresos, cada modalidad de apuesta cuenta con su respectiva subcuenta:

- **`4.1.01.001`**: Ingresos por Comisión — Cruces y Apuestas Entre Tercios.
- **`4.1.01.002`**: Ingresos por Comisión — Tablas Fijas.
- **`4.1.01.003`**: Ingresos por Comisión — Marcas.
- **`4.1.01.004`**: Ingresos por Comisión — Dupletas.
- **`4.1.01.005`**: Ingresos por Comisión — Pollas Hípicas y Remates.
- **`4.1.01.006`**: Ingresos por Comisión — Taquilla WPS (Win, Place, Show).
- **`4.1.01.007`**: Ingresos por Comisión — Eventos Especiales y Libres.

---

## 4. Regla de Imputación Inter-Grupos para "Argentina"

Cuando una jugada de **Tablas Fijas, Marcas o Dupletas** se vende en otro grupo pero su riesgo o pozo está respaldado por el **Grupo Argentina**:

1. **Caso 1: NO resulta un ganador (La casa retiene la jugada / pozo)**:
   - Todo el monto recaudado representa **ganancia neta para Argentina**.
   - Asiento en Argentina:
     - `Debe: 1.2.03.001 (Cuentas por Cobrar a Grupos en Convenio - Grupo Origen)`
     - `Haber: 4.3.01.002 (Ingresos Venta Neta Inter-Grupos Argentina)`

2. **Caso 2: SI resulta un ganador (Argentina paga el premio)**:
   - Argentina asume el costo del premio y percibe la recaudación de la jugada.
   - Asiento en Argentina:
     - `Debe: 5.2.01.001 / 5.2.02.001 (Costo de Premios Pagados)` por el monto del premio.
     - `Haber: 2.1.01.001 (Cuentas por Pagar Premios Ganadores)` por el monto del premio.
     - `Debe: 1.2.03.001 (Cuentas por Cobrar al Grupo Origen)` por el monto cobrado al jugador.
     - `Haber: 4.3.01.002 (Ingresos Venta Inter-Grupos Argentina)` por el monto cobrado.
   - **Resultado Neto**: `Ingreso Cobrado - Costo del Premio`.

---

## 5. Honorarios del Equipo de Trabajo

Cada miembro del equipo (Operador de taquilla, Liquidador, Administrador, Supervisor) se encuentra registrado con sus datos de identificación (Cédula, Teléfono, Cargo y Método de Pago).

- **Si los honorarios son PAGADOS de inmediato**:
  - `Debe: 6.1.03.001 (Gastos de Honorarios y Operadores de Equipo)`
  - `Haber: 1.1.01.001 (Caja) o 1.1.02.001/002/003 (Bancos / Pago Móvil / Zelle)`
- **Si quedan PENDIENTES POR PAGAR (Causación)**:
  - `Debe: 6.1.03.001 (Gastos de Honorarios de Equipo)`
  - `Haber: 2.1.06.001 (Cuentas por Pagar Honorarios Equipo de Trabajo)`

---

## 6. Aislamiento Contable Individual por Grupo

Cada grupo de concesión tiene su propio libro diario y balances aislados. Al seleccionar un grupo en la cabecera del módulo contable, todos los reportes (PUC, Libro Diario, Estado de Resultados y Balance NIIF) se recalculan exclusivamente con las operaciones pertenecientes a ese `grupo_id`.

---

## 7. Motor de Actualización Asíncrona en Segundo Plano

Para que el pago de carreras en taquilla sea instantáneo y fluido:
- Al momento de liquidar la carrera, el motor despacha la tarea contable a la **Cola Asíncrona en Segundo Plano** (`contabilidad-automatica.ts`).
- La UI no se congela ni espera la confirmación contable: los tickets se actualizan inmediatamente y la contabilidad asienta los asientos en segundo plano.
- En caso de error de red, la cola reintenta automáticamente preservando la idempotencia por clave única.

---

## 8. Copiloto Contable IA

El Copiloto Contable asiste en el registro de transacciones atípicas o manuales mediante preguntas estructuradas:
1. Tipo de operación.
2. Beneficiario o cliente.
3. Importe en USD.
4. Medio de pago o si queda por pagar.
El Copiloto valida la igualdad matemática `Debe === Haber` y asienta el registro con un solo clic.
