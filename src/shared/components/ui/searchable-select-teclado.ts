/**
 * Reglas de teclado del SearchableSelect, sacadas del componente React para que
 * se puedan probar sin montar nada en el navegador.
 *
 * Es la parte más frágil del combo: si un día cambia qué hace cada tecla, el
 * archivo .tsx compila igual y el fallo aparece recién cuando el operador está
 * frente al formulario. Acá se prueba directo.
 *
 * El componente (src/components/ui/SearchableSelect.tsx) tiene su propia copia
 * que se pasa por props; esta función es esa misma lógica, no una simulación.
 */
export type OpcionSelect = { value: string; label: string };

export type EstadoCombo = {
  key: string;
  filtradas: OpcionSelect[];
  activo: number;
  texto: string;
  allowCustom: boolean;
  /** Salidas, para que la prueba vea qué se llamó. */
  abierto?: boolean;
  activoResultante?: number;
  elegido?: string | null;
  escapado?: boolean;
  preventDefault?: boolean;
};

/**
 * Aplica una tecla y devuelve el estado resultante. Puro: no toca React ni el
 * DOM, así se puede probar en Node.
 *
 * Devuelve la tecla CONSUMIDA (la que cancela el evento) o "" si la tecla
 * tiene que seguir su curso normal hacia el input.
 */
export function aplicarTeclaCombo(estado: EstadoCombo): EstadoCombo {
  const prevent = () => {
    estado.preventDefault = true;
  };

  if (estado.key === "ArrowDown") {
    prevent();
    return {
      ...estado,
      abierto: true,
      // No pasa del último: con una lista corta, el operador que insistía con
      // la flecha terminaba en el primer elemento al reiniciar el ciclo.
      activoResultante: Math.min(estado.activo + 1, Math.max(estado.filtradas.length - 1, 0)),
      elegido: null,
    };
  }

  if (estado.key === "ArrowUp") {
    prevent();
    return {
      ...estado,
      activoResultante: Math.max(estado.activo - 1, 0),
      elegido: null,
    };
  }

  if (estado.key === "Enter") {
    prevent();
    const op = estado.filtradas[estado.activo];
    if (op) return { ...estado, elegido: op.value, escapado: false };
    // Sin coincidencia: si el campo admite texto libre, lo que se escribió ES el
    // valor. Sin `allowCustom` no se elige nada y Enter no inventa un cliente.
    if (estado.allowCustom && estado.texto.trim()) {
      return { ...estado, elegido: estado.texto.trim().toUpperCase(), escapado: false };
    }
    return { ...estado, elegido: null, escapado: false };
  }

  if (estado.key === "Escape") {
    prevent();
    return { ...estado, abierto: false, escapado: true, elegido: null };
  }

  // Cualquier otra tecla (letras, espacio, backspace) no se consume: el input
  // tiene que recibirla normalmente para escribir.
  return { ...estado, elegido: null, escapado: false, preventDefault: false };
}

/** Texto con el que queda el campo al cerrar: la etiqueta elegida, no lo escrito. */
export function etiquetaDeValor(
  options: OpcionSelect[],
  value: string,
  displayValue?: string | null
): string {
  if (displayValue != null) return displayValue;
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Filtro del combo: por etiqueta, sin distinguir mayúsculas ni acentos. */
export function filtrarOpciones(options: OpcionSelect[], texto: string): OpcionSelect[] {
  const q = texto.trim().toUpperCase();
  if (!q) return options;
  return options.filter((o) => o.label.toUpperCase().includes(q));
}

/** Si lo escrito NO es ninguna etiqueta, el combo ofrece crearlo. */
export function hayTextoLibre(options: OpcionSelect[], texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  return !options.some((o) => o.label === t);
}