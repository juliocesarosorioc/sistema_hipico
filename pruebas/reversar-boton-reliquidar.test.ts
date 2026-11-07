import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("Reversión de liquidación desbloquea inmediatamente el botón 'Liquidar Carrera'", () => {
  const rutaGestion = join(process.cwd(), "src/features/gestion/components/GestionJugadasModule.tsx");
  const codigo = readFileSync(rutaGestion, "utf8");

  // 1. Debe existir el estado carrerasReversadas para desacoplar inmediatamente la UI
  assert.ok(
    codigo.includes("const [carrerasReversadas, setCarrerasReversadas] = useState<Set<number>>(new Set())"),
    "Debe existir el estado local carrerasReversadas"
  );

  // 2. carreraLiquidada debe retornar false de inmediato si la carrera está en carrerasReversadas
  assert.ok(
    codigo.includes("if (carrerasReversadas.has(numCarrera))"),
    "carreraLiquidada debe evaluar inmediatamente carrerasReversadas.has(numCarrera)"
  );

  // 3. carrerasLiquidadasDelDia debe excluir cualquier carrera que esté en carrerasReversadas
  assert.ok(
    codigo.includes("if (carrerasReversadas.has(n)) continue"),
    "carrerasLiquidadasDelDia debe omitir carreras reversadas para no pintar el semáforo en rojo"
  );

  // 4. ejecutarReversar debe agregar la carrera a carrerasReversadas tras completarse exitosamente
  assert.ok(
    codigo.includes("setCarrerasReversadas((prev) => new Set([...prev, Number(carrera)]))"),
    "ejecutarReversar debe registrar la carrera en carrerasReversadas"
  );

  // 5. Al liquidar de nuevo con éxito, debe remover la carrera de carrerasReversadas
  assert.ok(
    codigo.includes("next.delete(Number(carrera))"),
    "Al finalizar liquidación debe limpiar la carrera de carrerasReversadas"
  );

  // 6. El botón alternativo renderiza 'Liquidar Carrera' cuando carreraLiquidada es false
  assert.ok(
    codigo.includes("carreraLiquidada ?") && codigo.includes("Reversar Liquidación") && codigo.includes("Liquidar Carrera"),
    "La UI conmuta entre 'Reversar Liquidación' y 'Liquidar Carrera'"
  );
});

test("revertirResultadoCentral en carreras-dia limpia resultados_carreras y matriz sin resucitar fila", () => {
  const rutaCarrerasDia = join(process.cwd(), "src/features/carreras/lib/carreras-dia.ts");
  const codigo = readFileSync(rutaCarrerasDia, "utf8");

  // No debe llamar a guardarResultado en el revertir central (evita que reviva la fila)
  const fnRevertir = codigo.slice(codigo.indexOf("export async function revertirResultadoCentral"));
  assert.ok(
    !fnRevertir.includes("await guardarResultado(f, hip, carrera"),
    "revertirResultadoCentral no debe resucitar la fila con guardarResultado"
  );
});
