export function cn(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(" ");
}

/** Formatea número sin símbolos de moneda ($ / Bs / USD / VES). */
export function formatMoney(n: number): string {
  const val = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

/* ===========================================================================
   ARITMÉTICA MONETARIA EXACTA
   ---------------------------------------------------------------------------
   POR QUÉ EXISTE ESTE BLOQUE

   En JavaScript los números son IEEE-754 de doble precisión: NO son
   decimales. Ninguna operación con dinero es exacta, y el error se cuela
   justo donde más duele:

     0.1 + 0.2            -> 0.30000000000000004
     1.005 * 100          -> 100.49999999999999   (redondea a 1.00, no a 1.01)
     19.99 * 0.10         -> 1.9990000000000001
     1000 * 0.075         -> 74.99999999999999

   En una liquidación eso significa que el total de la columna NO coincide con
   la suma de las filas, que el comprobante "no cuadra" aunque el operador
   hayatyped todo bien, y que una comisión del 2,5 % sobre 199,99 dé 5,00 en
   una pantalla y 4,99 en otra. En el mundo real el banco cobra de un lado y
   la casa paga del otro: un centavo de diferencia es una diferencia real.

   LA REGLA DEL REPOSO: la plata se cuenta en CENTAVOS ENTEROS. Se redondea
   UNA vez, al final, y se suman enteros. Eso es lo que hacen `monedaExacta` y
   `calcularComisionExacta` de abajo, y lo que replican las funciones SQL
   (numeric de PostgreSQL es decimal exacto) de `sql/contabilidad_niif.sql`.
   =========================================================================== */

/**
 * Convierte cualquier entrada a número, tolerando lo que llega de la base y
 * de los formularios.
 *
 * POR QUÉ EXISTE: las columnas `numeric` de PostgreSQL vuelven como TEXTO
 * ("1234.56"), y los campos de los formularios llegan como `""`, `null` o
 * `undefined` cuando el operador todavía no escribió nada. Sin esta
 * conversión, un `Number("")` da 0 pero un `parseFloat("1.234,56")` da 1.234
 * (¡se comió los miles!) y un `NaN` envenena toda una suma.
 *
 * Acepta el separador decimal con coma o con punto: si el texto trae los dos,
 * el ÚLTIMO es el decimal ("1.234,56" → 1234.56 y "1,234.56" → 1234.56).
 * Cualquier cosa que no sea un número (texto, `null`, `NaN`, `Infinity`)
 * devuelve 0, que es el valor neutro de la contabilidad: "no hay monto".
 */
export function aNumero(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor !== "string") return 0;

  const limpio = valor.trim().replace(/\s/g, "").replace(/[^0-9,.\-]/g, "");
  if (!limpio) return 0;

  const coma = limpio.lastIndexOf(",");
  const punto = limpio.lastIndexOf(".");
  let normalizado = limpio;
  if (coma > punto) {
    // El decimal es la coma: se quitan los puntos de miles.
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else if (punto > coma) {
    // El decimal es el punto: se quitan las comas de miles.
    normalizado = limpio.replace(/,/g, "");
  }

  const n = parseFloat(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Redondea a DOS DECIMALES con aritmética de centavos enteros.
 *
 * POR QUÉ NO `Math.round(n * 100) / 100`: ese redondeo falla en el medio
 * centavo exacto. `1.005 * 100` da `100.49999999999999` en coma flotante y
 * `Math.round` lo lleva a `1.00` cuando el número correcto es `1.01`. El
 * `Number.EPSILON` que se suma antes de multiplicar empuja el valor por
 * encima del medio centavo cuando corresponde, y es invisible para el resto
 * de las operaciones (es 2,22e-16: mucho más chico que un centavo).
 *
 * Es la función que hay que usar para TODO importe que se sume, se compare o
 * se muestre: liquidaciones, dividendos, comisiones, saldos de banco y saldos
 * de cliente. Un `toFixed(2)` sirve para MOSTRAR, pero no para CALCULAR: la
 * suma de varios `toFixed(2)` puede no cuadrar con el `toFixed(2)` del total.
 */
export function monedaExacta(valor: unknown): number {
  const n = aNumero(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Comisión sobre un monto bruto, calculada EXACTA en centavos.
 *
 * POR QUÉ NO `monto * porcentaje / 100`: en coma flotante el resultado no es
 * el que dice la cuenta. Con 1.005 como porcentaje, `monto * 1.005 / 100`
 * multiplica primero (y ya arrastra el error) y recién después divide,
 * amplifyando el desvío. Sobre un lote de liquidaciones esos centavos se
 * acumulan y la comisión total cobrada NO es la que dice el contrato.
 *
 * CÓMO SE CALCULA: se trabaja con enteros de punta a punta.
 *   · el bruto pasa a CENTAVOS enteros (0,01 = 1 centavo),
 *   · el porcentaje pasa a ENTEROS con 4 decimales (7,5 % = 750000),
 *   · se multiplica en enteros (centavos · puntos / 1.000.000) y recién ahí
 *     se redondea al centavo.
 * Ningún paso intermedio toca un decimal, así que no hay error que arrastrar.
 *
 * Devuelve 0 con entradas inválidas (texto, `null`, `NaN`, porcentaje 0):
 * una comisión inválida NO es un error de la casa, es un dato que no existe.
 * El signo sigue al del monto (un contra-asiento tiene monto negativo).
 */
export function calcularComisionExacta(montoBruto: number, porcentaje: number): number {
  const bruto = monedaExacta(montoBruto);
  const pct = aNumero(porcentaje);
  if (!Number.isFinite(bruto) || !Number.isFinite(pct)) return 0;
  if (bruto === 0 || pct === 0) return 0;

  const centavos = Math.round(bruto * 100); // centavos enteros del bruto
  const puntos = Math.round(pct * 10000); // porcentaje con 4 decimales, entero
  // centavos × (puntos / 10000) ÷ 100  ->  centavos × puntos / 1.000.000
  const comisionCentavos = Math.round((centavos * puntos) / 1_000_000);
  return comisionCentavos / 100;
}

/* ===========================================================================
   EXPORTACIÓN CSV
   ---------------------------------------------------------------------------
   POR QUÉ EXISTE ESTE BLOQUE

   Los reportes de Contabilidad se revisan en Excel, no en la pantalla. El
   repo ya tenía dos exportadores CSV, cada uno atado a SU propio dato
   (`exportarPadronCSV` del padrón de gaceta y `descargarCsv` del reporte de
   comisiones). Los dos hacen lo mismo —BOM UTF-8 para que Excel respete los
   acentos, separador `;` que es el que espera el Excel en español y celdas
   entrecomilladas con comillas dobladas— así que acá está la versión
   GENÉRICA: la misma convención, pero abierta a cualquier tabla.
   =========================================================================== */

/** Celda segura para CSV/Excel (comillas, punto y coma y saltos de línea). */
function celdaCSV(valor: unknown): string {
  const s = String(valor ?? "");
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Descarga una tabla como CSV (BOM UTF-8, separador `;`).
 *
 * `cabeceras` y cada fila son arrays de celdas: el que llama decide el
 * contenido y el orden, y el formato (una coma o un punto decimal) se lo
 * pasa ya resuelto. Devuelve `false` si el navegador no cooperate (no hay
 * `document`): el llamador avisa con un toast en vez de fallar en silencio.
 */
export function exportarCSV(
  nombreArchivo: string,
  cabeceras: string[],
  filas: Array<Array<unknown>>
): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return false;
  }
  const lineas = [cabeceras, ...filas].map((fila) => fila.map(celdaCSV).join(";"));
  const csv = "\uFEFF" + lineas.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo.toLowerCase().endsWith(".csv") ? nombreArchivo : `${nombreArchivo}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Se libera el objeto diferido: si se revoca de entrada, algunos navegadores
  // cancelan la descarga antes de que el archivo llegue al disco.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
