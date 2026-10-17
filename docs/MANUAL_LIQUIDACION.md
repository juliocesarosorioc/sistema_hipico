# Manual del Motor de Liquidación

Documento vivo del motor de liquidación de la casa. Su cara visible dentro de
la plataforma es el componente
`src/features/gestion/components/ManualLiquidacion.tsx`, que se abre desde el
**Reporte de Liquidación** (Gestión de Jugadas → 🧾 Reporte de Liquidación → 📖 Manual).

> Si cambia una regla de cálculo, se cambia **acá** y en el motor
> (`src/features/motores/lib/*`). El manual es el contrato visible.

---

## 0 · Regla estricta de nomenclatura

En la plataforma, **TODAS** las jugadas relacionadas con posiciones se
denominan, se procesan y se muestran **única y exclusivamente** como
**«Jugadas de Puestos»**.

Está **prohibido** categorizarlas o mostrarlas en los reportes bajo nombres
como *fijas*, *fraccionadas*, *con nini* o *de bloques*. El sistema solo lee el
código, hace la matemática y muestra el resultado bajo la etiqueta universal.

La única otra etiqueta es **«Jugadas a Premio»**: las que se pactan con una
**relación de pago fija**.

Implementación: `categoriaJugada(codigo)` y `etiquetaModalidad(m)` en
`src/features/taquilla/lib/nomenclatura.ts` (fuente única de la clasificación).

| Etiqueta | Aplica a |
| --- | --- |
| **Jugadas de Puestos** | Puesto puro, pelo a pelo, nini, combinada, compuesta, enfrentamiento sin proporción. |
| **Jugadas a Premio** | A premio (Modalidad A) y enfrentamiento con proporción (Modalidad B). |

---

## 1 · Jugadas de Puestos

No dependen de los dividendos de pista: se pagan por **proporción y monto
pactado**. La letra **n** (nini) significa «ni ganas ni pierdes» (devolución del
monto de esa fracción).

### Códigos de 1 factor

| Código | Llega 1° | Llega 2° | Llega 3° o peor |
| --- | --- | --- | --- |
| `1p` | Gana 100 % | Pierde | Pierde |
| `2p` | Gana 100 % | Gana 100 % | Pierde |
| `2n` | Gana 100 % | Devuelve (nini) | Pierde |
| `3n` | Gana 100 % | Gana 100 % | Devuelve (nini) si llega 3° · pierde el resto |

### Códigos de 2 factores

Ej.: `1/2`, `2/2`, `2/3`. El **50 %** del monto se evalúa bajo la lógica del
número a la **izquierda** de la barra y el otro **50 %** bajo la lógica del
número a la **derecha**.

### Códigos unidos por «y»

Ej.: `1p y 1/2`, `1/2 y 2n`, `2n y 2/2`, `2/2 y 2p`, `2p y 2/3`. El monto total
se divide en dos partes iguales (**50 % / 50 %**): la primera se juega a la
condición de la izquierda de la «y» y la segunda a la de la derecha.

---

## 2 · Jugadas a Premio

### Modalidad A · Caballo Ganador (proporción fija)

Formatos: `10/1`, `10/1.5`, `10/2`, `10/2,5`, `10/3`, `10A3`, `10a3`,
`10/9.75`, `10a9,75`…

El cliente apuesta a que el caballo llega **1°**. La nomenclatura indica la
**relación de pago**: se juegan 10 unidades para ganar la cantidad indicada
después de la barra `/` o de la letra `A`/`a` (ej.: en `10/2.5` se juega 10 para
ganar 2.5). **Pierde el 100 %** si el caballo llega 2° o peor.

### Modalidad B · Matchs de Ejemplares (duelos)

Formato: *relación de pago*, espacio, *Ejemplar(es) A* `x` *Ejemplar(es) B*.
Los ejemplares se agrupan con guion `-`, coma `,` o espacio.

- Individual: `10/8 10x3`
- Agrupados: `10/7 10-9x3-2` · `10/7 10,9x3,2` · `10/7 10 9x3 2`

La relación inicial (ej. `10/8`) define la proporción: el jugador que respalda a
los ejemplares de la **izquierda** juega 10 para ganar 8; el que respalda a los
de la **derecha** juega ese segundo número (8) para ganar 10. **Gana** el jugador
cuyo ejemplar (o uno de los suyos, si están agrupados) llegue **más cerca del 1°
lugar** en la pizarra oficial.

---

## 3 · Comisión de la casa

Se aplica una retención exacta del **5 %** únicamente sobre las **ganancias
netas** de la jugada, sin importar si es de Puestos o a Premio. Si la jugada
pierde o devuelve (nini), no hay comisión.

```
comisión = gananciaNeta × 0.05      saldo = gananciaNeta − comisión
```

---

## 4 · Estructura del reporte

- **Encabezado (contexto):** Grupo hípico, hipódromo, carrera, fecha y pizarra
  oficial (orden de llegada 1°…5°).
- **Cuerpo (tabla de jugadas):** Juega · Apostó (monto que arriesga el que
  juega) · Jugó (código exacto) · Da · Apostó (monto que arriesga el que da) ·
  Resultado. Cada lado del pareo muestra lo que arriesga en su propia columna, y
  el resultado solo aparece cuando la jugada se decide: positivo (verde),
  negativo (rojo) o nulo (verde claro, `+0,00` para los ninis); mientras está
  pendiente, la celda queda vacía.
- **Jugadas adelantadas / especiales:** Parada Adelantadas, Tablas Fijas, Marcas
  Adelantadas y Jugadas Entre Tercios Adelantadas.
- **Resumen de saldos:** GANAN (verde, nulos al final) y PIERDEN (rojo),
  consolidados por participante.

---

## 5 · Filtros del reporte

El reporte es dinámico y filtrable **en cascada**:

- **Temporal:** fecha (días recientes o pasados; atajos «Hoy» / «Ayer»).
- **Ubicación:** hipódromo y carrera.
- **Clasificación:** las secciones de adelantadas (Tablas Fijas, Marcas,
  Tercios).

Elegir una carrera fija su hipódromo y su fecha; cambiar el hipódromo reencuadra
las carreras disponibles. La lista de «resultados cargados» permite saltar entre
carreras recientes o pasadas sin cambiar la fecha.

---

_Motor de liquidación · las jugadas de posición se muestran siempre como
**Jugadas de Puestos**._
