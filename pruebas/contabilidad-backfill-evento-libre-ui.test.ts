import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  crearEventoLibre,
  liquidarEventoLibre,
  calcularRiesgosLogro,
} from "../src/features/eventos-libres/lib/eventos-libres";
import { sincronizarYAuditarContabilidadCompleta } from "../src/features/contabilidad/lib/motor-backfill-retroactivo";
import { procesarIntencionDataAnalystCpa } from "../src/features/ia-copiloto/lib/analista-cpa-auditor";

describe("FASE 2: Contabilidad Retroactiva NIIF, UI Cambio de Pizarra, Evento Libre P2P y Copiloto CPA", () => {
  it("1. Motor Contable Silencioso: Backfill y auditoría contable idempotente", async () => {
    const res = await sincronizarYAuditarContabilidadCompleta({ silencioso: true });

    assert.equal(res.ok, true, "El motor contable debe reportar ok");
    assert.equal(res.cuadrePerfecto, true, "El cuadre de partida doble debe ser perfecto");
    assert.equal(res.diferenciaCentavos, 0, "Diferencia Debe - Haber debe ser 0");
    assert.ok(res.mensajes.length >= 4, "Debe registrar los pasos de la mensajería progresiva");
    assert.ok(res.mensajes[0].includes("Paso 1/4"), "Paso 1/4 debe estar presente");
    assert.ok(res.mensajes[1].includes("Paso 2/4"), "Paso 2/4 debe estar presente");
    assert.ok(res.mensajes[2].includes("Paso 3/4"), "Paso 3/4 debe estar presente");
    assert.ok(res.mensajes[3].includes("Paso 4/4"), "Paso 4/4 debe estar presente");
  });

  it("2. Verificación de UI: Botón 'Cambio de Pizarra', altura vertical del resaltador y limpieza al cerrar", () => {
    // 2.1 Verificar que el botón fue renombrado a "Cambio de Pizarra"
    const fileGestion = fs.readFileSync(
      path.join(process.cwd(), "src/features/gestion/components/GestionJugadasModule.tsx"),
      "utf8"
    );
    assert.ok(
      fileGestion.includes("Cambio de Pizarra"),
      "El botón en GestionJugadasModule debe llamarse exactamente 'Cambio de Pizarra'"
    );

    // 2.2 Verificar limpieza de hipódromo y mesa de trabajo al liquidar/cerrar carrera
    assert.ok(
      fileGestion.includes('setHipodromo("");') && fileGestion.includes("setCarreraConfirmada(false);"),
      "Debe limpiar el estado del hipódromo y la mesa de trabajo al liquidar la carrera"
    );

    // 2.3 Verificar altura suficiente en la barra de carreras (min-h-[44px] py-2 overflow-y-visible)
    const fileSemaforo = fs.readFileSync(
      path.join(process.cwd(), "src/features/gestion/components/SemaforoCarreras.tsx"),
      "utf8"
    );
    assert.ok(
      fileSemaforo.includes("min-h-[44px]") && fileSemaforo.includes("overflow-y-visible"),
      "La barra de números de carrera debe tener min-h-[44px] y overflow-y-visible para que el resaltador de la carrera 1 no se corte"
    );
    assert.ok(
      fileSemaforo.includes("h-8 w-8") && fileSemaforo.includes("ml-2") && fileSemaforo.includes("ring-2 ring-indigo-600 ring-offset-1"),
      "Los números de carrera deben ser más compactos, con margen izquierdo y resaltado que no se recorte"
    );
    assert.equal(
      (fileGestion.match(/onClick=\{\(\) => void solicitarLiquidarCarrera\(\)\}/g) ?? []).length,
      1,
      "El botón Liquidar Carrera debe aparecer solo en la sección superior"
    );
    assert.equal(
      (fileGestion.match(/onClick=\{\(\) => setModalAgentePizarra\(true\)\}/g) ?? []).length,
      1,
      "El botón Cambio de Pizarra debe aparecer solo en la sección superior"
    );
  });

  it("3. Ciclo completo de Evento Libre P2P con riesgos asimétricos tipo 10/6 y liquidación", async () => {
    // Cálculo de riesgo asimétrico 10/6
    const rLogro = calcularRiesgosLogro(1000, "10/6");
    assert.equal(rLogro.riesgoJuega, 1000);
    assert.equal(rLogro.riesgoDa, 600, "En 10/6, 1000 que juega equivale a 600 que da");

    // Crear Evento Libre
    const resCrear = await crearEventoLibre({
      categoria: "BEISBOL",
      concepto: "Yankees vs Dodgers - Yankees Ganador",
      mercado: "10/6",
      jugador1: { id: "j1", nombre: "PEDRO", disponible: 2000 },
      jugador2: { id: "j2", nombre: "JUAN", disponible: 2000 },
      riesgo1: rLogro.riesgoJuega,
      riesgo2: rLogro.riesgoDa,
    });

    assert.equal(resCrear.ok, true);
    assert.ok(resCrear.evento);
    const evId = resCrear.evento!.id;

    // Liquidar: Gana Jugador 1 (Pedro)
    // Pedro tiene comision particular 3%, incentivo 1% y socio EDDIE al 1%
    const resLiq = await liquidarEventoLibre({
      eventoId: evId,
      ganador: "JUGADOR_1",
      config1: {
        clienteId: "j1",
        clienteNombre: "PEDRO",
        comision_particular_pct: 3.0,
        incentivo_pct: 1.0,
        incentivo_base: "MONTO_DECIDIDO",
        socio_id: "soc-1",
        socio_nombre: "EDDIE",
        socio_comision_pct: 1.0,
        socio_base: "MONTO_DECIDIDO",
      },
      config2: {
        clienteId: "j2",
        clienteNombre: "JUAN",
      },
      comisionGrupoDefault: 5.0,
    });

    assert.equal(resLiq.ok, true);
    assert.ok(resLiq.resultado);

    // Pedro gana el riesgo de Juan (600)
    assert.equal(resLiq.resultado?.jugador1.gananciaBruta, 600);
    // Aplica su comisión particular de 3%: 3% sobre 600 = 18.00
    assert.equal(resLiq.resultado?.jugador1.comisionCasa, 18.0);
    assert.equal(resLiq.resultado?.jugador1.gananciaNeta, 582.0);
    // Incentivo de Pedro: 1% sobre 1000 decidido = 10.00
    assert.equal(resLiq.resultado?.jugador1.incentivoDevolucion, 10.0);
    assert.equal(resLiq.resultado?.jugador1.impactoSaldoTotal, 592.0);

    // Comisión al socio EDDIE: 1% sobre 1000 decidido = 10.00
    assert.equal(resLiq.resultado?.socioJugador1?.montoAcreditado, 10.0);
    assert.equal(resLiq.resultado?.socioJugador1?.socioNombre, "EDDIE");

    // Asiento contable cuadrado
    assert.equal(resLiq.resultado?.asientoContableSugerido.cuadrado, true);

    // Los eventos manuales guardan el porcentaje al registrarlos y liquidan
    // la ganancia bruta indicada por el operador, no la cuota estimada.
    const manual = await crearEventoLibre({
      categoria: "LIBRE",
      concepto: "Evento libre con monto acordado",
      mercado: "LOGRO MANUAL",
      jugador1: { id: "m1", nombre: "JUGADOR UNO", disponible: 500 },
      jugador2: { id: "m2", nombre: "JUGADOR DOS", disponible: 500 },
      riesgo1: 300,
      riesgo2: 200,
      comisionGrupoPct: 7,
    });
    assert.equal(manual.ok, true);
    assert.equal(manual.evento?.riesgoJugador1, 300);
    assert.equal(manual.evento?.riesgoJugador2, 200);
    assert.equal(manual.evento?.comisionGrupoPct, 7);
    assert.match(manual.evento!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const exceso = await liquidarEventoLibre({
      eventoId: manual.evento!.id,
      ganador: "JUGADOR_1",
      montoGanancia: 201,
      config1: { clienteId: "m1", clienteNombre: "JUGADOR UNO" },
      config2: { clienteId: "m2", clienteNombre: "JUGADOR DOS" },
    });
    assert.equal(exceso.ok, false, "La ganancia no puede exceder el riesgo acordado del perdedor");

    const liquidacionManual = await liquidarEventoLibre({
      eventoId: manual.evento!.id,
      ganador: "JUGADOR_1",
      montoGanancia: 150,
      config1: { clienteId: "m1", clienteNombre: "JUGADOR UNO" },
      config2: { clienteId: "m2", clienteNombre: "JUGADOR DOS" },
    });
    assert.equal(liquidacionManual.ok, true);
    assert.equal(liquidacionManual.resultado?.jugador1.gananciaBruta, 150);
    assert.equal(liquidacionManual.resultado?.jugador1.comisionCasa, 10.5);
    assert.equal(liquidacionManual.resultado?.jugador1.gananciaNeta, 139.5);
    assert.equal(liquidacionManual.resultado?.jugador2?.perdida, 150);

    const manualJ2 = await crearEventoLibre({
      categoria: "LIBRE",
      concepto: "Evento libre con ganador jugador dos",
      mercado: "MERCADO MANUAL",
      jugador1: { id: "n1", nombre: "NUEVO UNO", disponible: 500 },
      jugador2: { id: "n2", nombre: "NUEVO DOS", disponible: 500 },
      riesgo1: 300,
      riesgo2: 200,
      comisionGrupoPct: 8,
    });
    assert.equal(manualJ2.ok, true);
    const liquidacionJ2 = await liquidarEventoLibre({
      eventoId: manualJ2.evento!.id,
      ganador: "JUGADOR_2",
      montoGanancia: 120,
      config1: { clienteId: "n1", clienteNombre: "NUEVO UNO" },
      config2: { clienteId: "n2", clienteNombre: "NUEVO DOS" },
    });
    assert.equal(liquidacionJ2.ok, true);
    assert.equal(liquidacionJ2.resultado?.jugador1.perdida, 120);
    assert.equal(liquidacionJ2.resultado?.jugador2?.gananciaBruta, 120);
    assert.equal(liquidacionJ2.resultado?.jugador2?.comisionCasa, 9.6);
    assert.equal(liquidacionJ2.resultado?.jugador2?.gananciaNeta, 110.4);
  });

  it("4. Perfil Senior Data Analyst & CPA Auditor en IA Copiloto", async () => {
    // Consulta analítica de rentabilidad
    const rRentabilidad = await procesarIntencionDataAnalystCpa("¿Cuánto generó la casa hoy y cuánto ganaron los socios?");
    assert.equal(rRentabilidad.esAnalitico, true);
    assert.equal(rRentabilidad.tipo, "RENTABILIDAD_CARRERAS");
    assert.ok(rRentabilidad.texto.includes("REPORTE ANALÍTICO"));

    // Auditoría contable en 1 clic
    const rAuditoria = await procesarIntencionDataAnalystCpa("Verificar cuadre contable y auditoría NIIF");
    assert.equal(rAuditoria.esAnalitico, true);
    assert.equal(rAuditoria.tipo, "CUADRE_CONTABLE");
    assert.ok(rAuditoria.texto.includes("INFORME DE AUDITORÍA CONTABLE"));

    // Creación de Evento Libre por texto conversacional
    const rEventoVoz = await procesarIntencionDataAnalystCpa("En evento libre juega Andres 500 a Boston Celtics 10/6 da Marcos");
    assert.equal(rEventoVoz.esAnalitico, true);
    assert.equal(rEventoVoz.tipo, "EVENTO_LIBRE_ACCION");
    assert.ok(rEventoVoz.texto.includes("Evento Libre P2P creado exitosamente"));
  });
});
