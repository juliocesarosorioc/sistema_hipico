/**
 * ============================================================================
 * PLAN ÚNICO DE CUENTAS (PUC-NIIF HÍPICO) Y MOTOR DE PARTIDA DOBLE AUTOMÁTICA
 * ============================================================================
 *
 * Motor contable central para registrar asientos de doble partida estrictos
 * (Debe === Haber en centavos enteros exactos) vinculados en tiempo real con:
 *   - Depósitos, Retiros y Traslados de Tesorería.
 *   - Liquidación de Apuestas entre Tercios y Comisiones.
 *   - Cruces de Apuestas (`🔀 CRUCE` Modalidad CON CRUCES).
 *   - Devolución de Incentivos a Clientes / Avaladores (+ a favor del cliente).
 *   - Avales (Otorgamiento, Pago y Liquidación).
 *   - Reversiones y Contra-asientos simétricos.
 */

import { supabase } from "@/core/supabase";
import { aCentavos, deCentavos, sumarDinero, restarDinero } from "@/shared/lib/dinero";

export type ClaseCuenta =
  | "ACTIVO"
  | "PASIVO"
  | "PATRIMONIO"
  | "INGRESO"
  | "COSTO_CONTRA_INGRESO"
  | "GASTO"
  | "ORDEN";

export type NaturalezaCuenta = "DEUDORA" | "ACREEDORA";

export type ModuloOrigenCuenta =
  | "TESORERIA"
  | "CLIENTES"
  | "AVALES"
  | "APUESTAS_TERCIOS"
  | "CRUCES"
  | "INCENTIVOS"
  | "TABLAS_FIJAS"
  | "MARCAS"
  | "REMATES"
  | "POLLAS"
  | "DUPLETAS"
  | "TAQUILLA_WPS"
  | "CONVENIOS"
  | "CIERRE_SEMANAL";

export interface CuentaContableDef {
  codigo: string;
  nombre: string;
  clase: ClaseCuenta;
  naturaleza: NaturalezaCuenta;
  nivel: number;
  codigo_padre?: string | null;
  acepta_movimientos: boolean;
  modulo_origen?: ModuloOrigenCuenta;
  activa: boolean;
}

/** Catálogo oficial del Plan Único de Cuentas NIIF Hípico en memoria */
export const PLAN_CUENTAS_HIPICO: readonly CuentaContableDef[] = [
  // 1. ACTIVOS
  { codigo: "1", nombre: "ACTIVO", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1", nombre: "ACTIVO CORRIENTE - EFECTIVO Y EQUIVALENTES", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.01", nombre: "Caja y Efectivo Disponible", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "1.1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.01.001", nombre: "Caja General y Efectivo Divisas", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.1.01", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.02", nombre: "Bancos y Entidades Financieras", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "1.1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.02.001", nombre: "Banco Pozo Principal Operativo", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.1.02", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.02.002", nombre: "Bancos Nacionales (Pago Móvil / Transferencias)", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.1.02", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.1.02.003", nombre: "Pasarelas Internacionales y Cripto (Zelle / USDT)", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.1.02", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "1.2", nombre: "CUENTAS POR COBRAR OPERACIONALES", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "1", acepta_movimientos: false, modulo_origen: "CLIENTES", activa: true },
  { codigo: "1.2.01", nombre: "Cartera de Clientes Deudores", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "1.2", acepta_movimientos: false, modulo_origen: "CLIENTES", activa: true },
  { codigo: "1.2.01.001", nombre: "Cuentas por Cobrar Clientes — Saldos Deudores", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.2.01", acepta_movimientos: true, modulo_origen: "CLIENTES", activa: true },
  { codigo: "1.2.02", nombre: "Cartera de Avales y Respaldo Financiero", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "1.2", acepta_movimientos: false, modulo_origen: "AVALES", activa: true },
  { codigo: "1.2.02.001", nombre: "Cartera de Avales Otorgados por Cobrar", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.2.02", acepta_movimientos: true, modulo_origen: "AVALES", activa: true },
  { codigo: "1.2.03", nombre: "Cuentas por Cobrar Convenios", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "1.2", acepta_movimientos: false, modulo_origen: "CONVENIOS", activa: true },
  { codigo: "1.2.03.001", nombre: "Cuentas por Cobrar Grupos en Convenio", clase: "ACTIVO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "1.2.03", acepta_movimientos: true, modulo_origen: "CONVENIOS", activa: true },

  // 2. PASIVOS
  { codigo: "2", nombre: "PASIVO", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "CLIENTES", activa: true },
  { codigo: "2.1", nombre: "PASIVO CORRIENTE - CUSTODIA Y OBLIGACIONES", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 2, codigo_padre: "2", acepta_movimientos: false, modulo_origen: "CLIENTES", activa: true },
  { codigo: "2.1.01", nombre: "Fondos en Custodia de Clientes", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "2.1", acepta_movimientos: false, modulo_origen: "CLIENTES", activa: true },
  { codigo: "2.1.01.001", nombre: "Depósitos y Saldos Acreedores de Clientes (Custodia Jugadores)", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.01", acepta_movimientos: true, modulo_origen: "CLIENTES", activa: true },
  { codigo: "2.1.01.002", nombre: "Retiros de Clientes Pendientes por Pagar", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.01", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "2.1.02", nombre: "Bolsa de Apuestas en Tránsito", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "2.1", acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "2.1.02.001", nombre: "Bolsa en Tránsito — Jugadas en Vivo", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.02", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "2.1.02.002", nombre: "Bolsa en Tránsito — Jugadas Adelantadas", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.02", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "2.1.02.003", nombre: "Saldos Comprometidos por Jugadas en Curso (Retención Transitoria)", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.02", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "2.1.03", nombre: "Premios y Pozos Pendientes de Liquidar", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "2.1", acepta_movimientos: false, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "2.1.03.001", nombre: "Premios y Pozos por Pagar (Pollas, Remates, Tablas, Dupletas)", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.03", acepta_movimientos: true, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "2.1.04", nombre: "Incentivos y Devoluciones por Acreditar", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "2.1", acepta_movimientos: false, modulo_origen: "INCENTIVOS", activa: true },
  { codigo: "2.1.04.001", nombre: "Devoluciones e Incentivos por Acreditar a Clientes", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.04", acepta_movimientos: true, modulo_origen: "INCENTIVOS", activa: true },
  { codigo: "2.1.05", nombre: "Obligaciones por Convenios Inter-Grupos", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "2.1", acepta_movimientos: false, modulo_origen: "CONVENIOS", activa: true },
  { codigo: "2.1.05.001", nombre: "Comisiones por Pagar a Grupos en Convenio", clase: "PASIVO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "2.1.05", acepta_movimientos: true, modulo_origen: "CONVENIOS", activa: true },

  // 3. PATRIMONIO
  { codigo: "3", nombre: "PATRIMONIO", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1", nombre: "CAPITAL Y RESERVAS OPERATIVAS", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 2, codigo_padre: "3", acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.01", nombre: "Capital de la Casa", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "3.1", acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.01.001", nombre: "Capital Operativo de la Casa / Grupo", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "3.1.01", acepta_movimientos: true, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.02", nombre: "Fondo de Avales y Garantías", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "3.1", acepta_movimientos: false, modulo_origen: "AVALES", activa: true },
  { codigo: "3.1.02.001", nombre: "Fondo de Respaldo Banco Aval", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "3.1.02", acepta_movimientos: true, modulo_origen: "AVALES", activa: true },
  { codigo: "3.1.03", nombre: "Resultados de Ejercicios Anteriores", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "3.1", acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.03.001", nombre: "Resultados Acumulados de Semanas Anteriores", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "3.1.03", acepta_movimientos: true, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.04", nombre: "Resultados del Ejercicio Activo", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "3.1", acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.04.001", nombre: "Resultado Neto de la Semana Activa", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "3.1.04", acepta_movimientos: true, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.05", nombre: "Cuentas Puente de Cierre", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "3.1", acepta_movimientos: false, modulo_origen: "CIERRE_SEMANAL", activa: true },
  { codigo: "3.1.05.001", nombre: "Cuenta Puente de Cierre Semanal (Modo RESET / ARRASTRE)", clase: "PATRIMONIO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "3.1.05", acepta_movimientos: true, modulo_origen: "CIERRE_SEMANAL", activa: true },

  // 4. INGRESOS OPERACIONALES
  { codigo: "4", nombre: "INGRESOS", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "4.1", nombre: "INGRESOS POR COMISIÓN DE INTERMEDIACIÓN", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 2, codigo_padre: "4", acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "4.1.01", nombre: "Comisión Apuestas entre Tercios", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.1", acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "4.1.01.001", nombre: "Ingresos por Comisión — Apuestas entre Tercios", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.1.01", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "4.1.02", nombre: "Comisión Remates Hípicos", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.1", acepta_movimientos: false, modulo_origen: "REMATES", activa: true },
  { codigo: "4.1.02.001", nombre: "Ingresos por Comisión — Remates Hípicos", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.1.02", acepta_movimientos: true, modulo_origen: "REMATES", activa: true },
  { codigo: "4.1.03", nombre: "Comisión Pollas Hípicas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.1", acepta_movimientos: false, modulo_origen: "POLLAS", activa: true },
  { codigo: "4.1.03.001", nombre: "Ingresos por Comisión — Pollas Hípicas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.1.03", acepta_movimientos: true, modulo_origen: "POLLAS", activa: true },
  { codigo: "4.1.04", nombre: "Comisión Dupletas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.1", acepta_movimientos: false, modulo_origen: "DUPLETAS", activa: true },
  { codigo: "4.1.04.001", nombre: "Ingresos por Comisión — Dupletas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.1.04", acepta_movimientos: true, modulo_origen: "DUPLETAS", activa: true },
  { codigo: "4.2", nombre: "INGRESOS POR VENTA DIRECTA DE PRODUCTOS", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 2, codigo_padre: "4", acepta_movimientos: false, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "4.2.01", nombre: "Ventas Tablas Fijas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.2", acepta_movimientos: false, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "4.2.01.001", nombre: "Ingresos por Ventas — Tablas Fijas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.2.01", acepta_movimientos: true, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "4.2.02", nombre: "Ventas Marcas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.2", acepta_movimientos: false, modulo_origen: "MARCAS", activa: true },
  { codigo: "4.2.02.001", nombre: "Ingresos por Ventas — Marcas", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.2.02", acepta_movimientos: true, modulo_origen: "MARCAS", activa: true },
  { codigo: "4.2.03", nombre: "Ventas Taquilla WPS", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.2", acepta_movimientos: false, modulo_origen: "TAQUILLA_WPS", activa: true },
  { codigo: "4.2.03.001", nombre: "Ingresos por Ventas — Taquilla WPS", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.2.03", acepta_movimientos: true, modulo_origen: "TAQUILLA_WPS", activa: true },
  { codigo: "4.3", nombre: "INGRESOS POR CONVENIOS", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 2, codigo_padre: "4", acepta_movimientos: false, modulo_origen: "CONVENIOS", activa: true },
  { codigo: "4.3.01", nombre: "Comisión Convenios Inter-Grupos", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 3, codigo_padre: "4.3", acepta_movimientos: false, modulo_origen: "CONVENIOS", activa: true },
  { codigo: "4.3.01.001", nombre: "Ingresos por Convenios Inter-Grupos", clase: "INGRESO", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "4.3.01", acepta_movimientos: true, modulo_origen: "CONVENIOS", activa: true },

  // 5. REBAJAS SOBRE INGRESOS, CRUCES, INCENTIVOS Y COSTOS DE PREMIOS
  { codigo: "5", nombre: "COSTOS, CRUCES E INCENTIVOS", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "CRUCES", activa: true },
  { codigo: "5.1", nombre: "REBAJAS SOBRE COMISIONES, CRUCES E INCENTIVOS", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "5", acepta_movimientos: false, modulo_origen: "CRUCES", activa: true },
  { codigo: "5.1.01", nombre: "Cruces de Apuestas", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.1", acepta_movimientos: false, modulo_origen: "CRUCES", activa: true },
  { codigo: "5.1.01.001", nombre: "Reembolso de Comisión por Cruces (🔀 CRUCE Modalidad CON CRUCES)", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.1.01", acepta_movimientos: true, modulo_origen: "CRUCES", activa: true },
  { codigo: "5.1.02", nombre: "Incentivos a Clientes", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.1", acepta_movimientos: false, modulo_origen: "INCENTIVOS", activa: true },
  { codigo: "5.1.02.001", nombre: "Devolución de Incentivos a Clientes (A favor del cliente)", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.1.02", acepta_movimientos: true, modulo_origen: "INCENTIVOS", activa: true },
  { codigo: "5.1.03", nombre: "Incentivos a Avaladores", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.1", acepta_movimientos: false, modulo_origen: "AVALES", activa: true },
  { codigo: "5.1.03.001", nombre: "Devolución de Comisión a Avaladores / Corredores", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.1.03", acepta_movimientos: true, modulo_origen: "AVALES", activa: true },
  { codigo: "5.2", nombre: "COSTO DE PREMIOS PAGADOS POR LA CASA", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "5", acepta_movimientos: false, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "5.2.01", nombre: "Premios Tablas Fijas", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.2", acepta_movimientos: false, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "5.2.01.001", nombre: "Costo de Premios Pagados — Tablas Fijas", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.2.01", acepta_movimientos: true, modulo_origen: "TABLAS_FIJAS", activa: true },
  { codigo: "5.2.02", nombre: "Premios Marcas y Dupletas", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.2", acepta_movimientos: false, modulo_origen: "MARCAS", activa: true },
  { codigo: "5.2.02.001", nombre: "Costo de Premios Pagados — Marcas y Dupletas", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.2.02", acepta_movimientos: true, modulo_origen: "MARCAS", activa: true },
  { codigo: "5.2.03", nombre: "Premios Taquilla WPS", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "5.2", acepta_movimientos: false, modulo_origen: "TAQUILLA_WPS", activa: true },
  { codigo: "5.2.03.001", nombre: "Costo de Premios Pagados — Taquilla WPS", clase: "COSTO_CONTRA_INGRESO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "5.2.03", acepta_movimientos: true, modulo_origen: "TAQUILLA_WPS", activa: true },

  // 6. GASTOS OPERATIVOS
  { codigo: "6", nombre: "GASTOS OPERATIVOS", clase: "GASTO", naturaleza: "DEUDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1", nombre: "GASTOS DE OPERACIÓN Y ADMINISTRACIÓN", clase: "GASTO", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "6", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.01", nombre: "Gastos Financieros", clase: "GASTO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "6.1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.01.001", nombre: "Gastos de Comisiones Bancarias", clase: "GASTO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "6.1.01", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.02", nombre: "Diferencial Cambiario", clase: "GASTO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "6.1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.02.001", nombre: "Diferencial Cambiario", clase: "GASTO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "6.1.02", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.03", nombre: "Administración y Operadores", clase: "GASTO", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "6.1", acepta_movimientos: false, modulo_origen: "TESORERIA", activa: true },
  { codigo: "6.1.03.001", nombre: "Gastos de Operadores y Administración", clase: "GASTO", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "6.1.03", acepta_movimientos: true, modulo_origen: "TESORERIA", activa: true },

  // 7. CUENTAS DE ORDEN (RIESGO EN CURSO)
  { codigo: "7", nombre: "CUENTAS DE ORDEN", clase: "ORDEN", naturaleza: "DEUDORA", nivel: 1, codigo_padre: null, acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "7.1", nombre: "CUENTAS DE ORDEN POR CONTINGENCIAS Y RIESGOS", clase: "ORDEN", naturaleza: "DEUDORA", nivel: 2, codigo_padre: "7", acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "7.1.01", nombre: "Control de Exposición Financiera", clase: "ORDEN", naturaleza: "DEUDORA", nivel: 3, codigo_padre: "7.1", acepta_movimientos: false, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "7.1.01.001", nombre: "Riesgo Comprometido en Curso (Peor Caso Simulado)", clase: "ORDEN", naturaleza: "DEUDORA", nivel: 4, codigo_padre: "7.1.01", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
  { codigo: "7.1.01.002", nombre: "Contra-cuenta de Riesgo Comprometido en Curso", clase: "ORDEN", naturaleza: "ACREEDORA", nivel: 4, codigo_padre: "7.1.01", acepta_movimientos: true, modulo_origen: "APUESTAS_TERCIOS", activa: true },
];

/** Mapa de búsqueda rápida por código de cuenta */
export const MAPA_CUENTAS_HIPICO = new Map<string, CuentaContableDef>(
  PLAN_CUENTAS_HIPICO.map((c) => [c.codigo, c])
);

export function obtenerCuentaPorCodigo(codigo: string): CuentaContableDef | undefined {
  return MAPA_CUENTAS_HIPICO.get(codigo);
}

// ============================================================================
// TIPOS PARA ASIENTOS CONTABLES
// ============================================================================

export type TipoEventoContable =
  | "DEPOSITO_CLIENTE"
  | "RETIRO_CLIENTE"
  | "TRASLADO_CLIENTES"
  | "AVAL_OTORGADO"
  | "AVAL_PAGADO"
  | "AVAL_RETIRADO"
  | "COMPROMISO_JUGADA"
  | "LIBERACION_COMPROMISO_JUGADA"
  | "LIQUIDACION_APUESTAS"
  | "REEMBOLSO_CRUCE"
  | "DEVOLUCION_INCENTIVO"
  | "REVERSION_LIQUIDACION"
  | "ANULACION_JUGADA"
  | "GASTO_OPERATIVO"
  | "AJUSTE_AUDITORIA"
  | "CIERRE_SEMANAL";

export interface LineaAsientoContable {
  cuenta_codigo: string;
  cuenta_nombre?: string;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  debe: number;
  haber: number;
  concepto?: string;
}

export interface AsientoContableParam {
  grupo_id?: string | null;
  fecha_contable?: string;
  tipo_evento: TipoEventoContable;
  referencia_id?: string | null;
  clave_idempotencia?: string | null;
  descripcion: string;
  creado_por?: string | null;
  lineas: LineaAsientoContable[];
}

export interface AsientoContableRegistrado {
  id: string;
  numero_asiento: number;
  fecha_contable: string;
  tipo_evento: TipoEventoContable;
  referencia_id?: string | null;
  clave_idempotencia?: string | null;
  descripcion: string;
  estado: "PUBLICADO" | "REVERSADO";
  total_debe: number;
  total_haber: number;
  lineas: LineaAsientoContable[];
  creado_el: string;
}

/** Memoria volátil para ejecución sin conexión o pruebas */
const ASIENTOS_MEMORIA: AsientoContableRegistrado[] = [];

// ============================================================================
// MOTOR CENTRAL DE PARTIDA DOBLE
// ============================================================================

/**
 * Valida y registra un asiento contable en partida doble estricta.
 * Garantiza en centavos enteros exactos que: Suma(Debe) === Suma(Haber).
 */
export async function generarAsientoPartidaDoble(
  param: AsientoContableParam
): Promise<{ ok: boolean; asiento?: AsientoContableRegistrado; error?: string }> {
  // 1. Validar líneas presentes
  if (!param.lineas || param.lineas.length === 0) {
    return { ok: false, error: "El asiento debe contener al menos dos líneas contables." };
  }

  // 2. Normalizar líneas y enriquecer nombre de cuenta
  let totalDebeCentavos = 0;
  let totalHaberCentavos = 0;

  const lineasNormalizadas: LineaAsientoContable[] = [];

  for (const l of param.lineas) {
    const debeCent = Math.max(0, aCentavos(l.debe));
    const haberCent = Math.max(0, aCentavos(l.haber));

    if (debeCent === 0 && haberCent === 0) continue;

    totalDebeCentavos += debeCent;
    totalHaberCentavos += haberCent;

    const ctaDef = obtenerCuentaPorCodigo(l.cuenta_codigo);
    const nombre = l.cuenta_nombre || ctaDef?.nombre || `Cuenta ${l.cuenta_codigo}`;

    lineasNormalizadas.push({
      cuenta_codigo: l.cuenta_codigo.trim(),
      cuenta_nombre: nombre,
      cliente_id: l.cliente_id ?? null,
      cliente_nombre: l.cliente_nombre ?? null,
      debe: deCentavos(debeCent),
      haber: deCentavos(haberCent),
      concepto: l.concepto || param.descripcion,
    });
  }

  // 3. Verificación de balance estricto en centavos
  if (totalDebeCentavos !== totalHaberCentavos) {
    const dif = deCentavos(Math.abs(totalDebeCentavos - totalHaberCentavos));
    return {
      ok: false,
      error: `Descuadre de partida doble: Total Debe (${deCentavos(totalDebeCentavos)}) no es igual a Total Haber (${deCentavos(totalHaberCentavos)}). Diferencia: ${dif}`,
    };
  }

  if (totalDebeCentavos === 0) {
    return { ok: false, error: "El asiento no puede registrarse con montos en cero." };
  }

  const totalDebe = deCentavos(totalDebeCentavos);
  const totalHaber = deCentavos(totalHaberCentavos);
  const fecha = param.fecha_contable || new Date().toISOString().slice(0, 10);

  // 4. Idempotencia en memoria
  if (param.clave_idempotencia) {
    const ya = ASIENTOS_MEMORIA.find((a) => a.clave_idempotencia === param.clave_idempotencia);
    if (ya) {
      return { ok: true, asiento: ya };
    }
  }

  // 5. Persistir en Supabase si está disponible
  let asientoId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let numeroAsiento = ASIENTOS_MEMORIA.length + 1;

  if (supabase) {
    try {
      const { data, error } = await supabase.rpc("rpc_registrar_asiento_contable_v2", {
        p_grupo_id: param.grupo_id || null,
        p_fecha: fecha,
        p_tipo_evento: param.tipo_evento,
        p_referencia_id: param.referencia_id || null,
        p_clave_idempotencia: param.clave_idempotencia || null,
        p_descripcion: param.descripcion,
        p_creado_por: param.creado_por || "sistema",
        p_lineas: lineasNormalizadas,
      });

      if (!error && data && data.ok) {
        asientoId = String(data.asiento_id || asientoId);
        if (data.numero_asiento) numeroAsiento = Number(data.numero_asiento);
      }
    } catch {
      // Fallback a almacenamiento en memoria si Supabase no tiene la RPC
    }
  }

  const registrado: AsientoContableRegistrado = {
    id: asientoId,
    numero_asiento: numeroAsiento,
    fecha_contable: fecha,
    tipo_evento: param.tipo_evento,
    referencia_id: param.referencia_id || null,
    clave_idempotencia: param.clave_idempotencia || null,
    descripcion: param.descripcion,
    estado: "PUBLICADO",
    total_debe: totalDebe,
    total_haber: totalHaber,
    lineas: lineasNormalizadas,
    creado_el: new Date().toISOString(),
  };

  ASIENTOS_MEMORIA.unshift(registrado);
  return { ok: true, asiento: registrado };
}

// ============================================================================
// GENERADORES AUTOMÁTICOS POR OPERACIÓN DEL ERP
// ============================================================================

/** Depósito o Abono a favor de la cuenta del cliente */
export async function generarAsientoDepositoCliente(p: {
  grupoId?: string | null;
  fecha?: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  referencia?: string | null;
  bancoCodigo?: string;
  usuario?: string | null;
}) {
  const monto = Math.abs(p.monto);
  const bancoCta = p.bancoCodigo || "1.1.02.001"; // Banco Pozo Principal Operativo

  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "DEPOSITO_CLIENTE",
    referencia_id: p.referencia,
    clave_idempotencia: p.referencia ? `DEP:${p.referencia}` : undefined,
    descripcion: `Depósito en cuenta de ${p.clienteNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: bancoCta,
        debe: monto,
        haber: 0,
        concepto: `Ingreso a banco por abono de ${p.clienteNombre}`,
      },
      {
        cuenta_codigo: "2.1.01.001", // Depósitos y Saldos Acreedores Clientes
        cliente_id: p.clienteId,
        cliente_nombre: p.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Abono a favor en cuenta de ${p.clienteNombre}`,
      },
    ],
  });
}

/** Retiro de saldo por parte de un cliente */
export async function generarAsientoRetiroCliente(p: {
  grupoId?: string | null;
  fecha?: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  referencia?: string | null;
  bancoCodigo?: string;
  usuario?: string | null;
}) {
  const monto = Math.abs(p.monto);
  const bancoCta = p.bancoCodigo || "1.1.02.001";

  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "RETIRO_CLIENTE",
    referencia_id: p.referencia,
    clave_idempotencia: p.referencia ? `RET:${p.referencia}` : undefined,
    descripcion: `Retiro de fondos cliente ${p.clienteNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: "2.1.01.001", // Disminución de saldo acreedor
        cliente_id: p.clienteId,
        cliente_nombre: p.clienteNombre,
        debe: monto,
        haber: 0,
        concepto: `Débito por retiro de ${p.clienteNombre}`,
      },
      {
        cuenta_codigo: bancoCta,
        debe: 0,
        haber: monto,
        concepto: `Salida de banco para retiro de ${p.clienteNombre}`,
      },
    ],
  });
}

/** Traslado de saldo entre clientes */
export async function generarAsientoTrasladoClientes(p: {
  grupoId?: string | null;
  fecha?: string;
  origenId: string;
  origenNombre: string;
  destinoId: string;
  destinoNombre: string;
  monto: number;
  referencia?: string | null;
  usuario?: string | null;
}) {
  const monto = Math.abs(p.monto);

  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "TRASLADO_CLIENTES",
    referencia_id: p.referencia,
    clave_idempotencia: p.referencia ? `TRAS:${p.referencia}` : undefined,
    descripcion: `Traslado de fondos de ${p.origenNombre} a ${p.destinoNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: "2.1.01.001", // Origen se debita
        cliente_id: p.origenId,
        cliente_nombre: p.origenNombre,
        debe: monto,
        haber: 0,
        concepto: `Traslado emitido hacia ${p.destinoNombre}`,
      },
      {
        cuenta_codigo: "2.1.01.001", // Destino se acredita
        cliente_id: p.destinoId,
        cliente_nombre: p.destinoNombre,
        debe: 0,
        haber: monto,
        concepto: `Traslado recibido de ${p.origenNombre}`,
      },
    ],
  });
}

/** Otorgar o pagar aval */
export async function generarAsientoAval(p: {
  grupoId?: string | null;
  fecha?: string;
  clienteId: string;
  clienteNombre: string;
  monto: number;
  tipo: "OTORGAR" | "PAGAR" | "RETIRAR";
  usuario?: string | null;
}) {
  const monto = Math.abs(p.monto);

  if (p.tipo === "OTORGAR") {
    return generarAsientoPartidaDoble({
      grupo_id: p.grupoId,
      fecha_contable: p.fecha,
      tipo_evento: "AVAL_OTORGADO",
      descripcion: `Otorgamiento de límite aval a ${p.clienteNombre}`,
      creado_por: p.usuario,
      lineas: [
        {
          cuenta_codigo: "1.2.02.001", // Cartera de Avales Otorgados por Cobrar (Debe)
          cliente_id: p.clienteId,
          cliente_nombre: p.clienteNombre,
          debe: monto,
          haber: 0,
          concepto: `Límite aval otorgado a ${p.clienteNombre}`,
        },
        {
          cuenta_codigo: "3.1.02.001", // Fondo de Respaldo Banco Aval (Haber)
          debe: 0,
          haber: monto,
          concepto: `Respaldo patrimonial aval otorgado a ${p.clienteNombre}`,
        },
      ],
    });
  }

  if (p.tipo === "PAGAR") {
    return generarAsientoPartidaDoble({
      grupo_id: p.grupoId,
      fecha_contable: p.fecha,
      tipo_evento: "AVAL_PAGADO",
      descripcion: `Pago de aval liquidado por ${p.clienteNombre}`,
      creado_por: p.usuario,
      lineas: [
        {
          cuenta_codigo: "1.1.02.001", // Banco receptor (Debe)
          debe: monto,
          haber: 0,
          concepto: `Ingreso bancario por pago de aval de ${p.clienteNombre}`,
        },
        {
          cuenta_codigo: "1.2.02.001", // Cartera de Avales se cancela (Haber)
          cliente_id: p.clienteId,
          cliente_nombre: p.clienteNombre,
          debe: 0,
          haber: monto,
          concepto: `Cancelación de cartera aval cobrada a ${p.clienteNombre}`,
        },
      ],
    });
  }

  // RETIRAR AVAL
  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "AVAL_RETIRADO",
    descripcion: `Retiro/Reducción de aval a ${p.clienteNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: "3.1.02.001",
        debe: monto,
        haber: 0,
        concepto: `Liberación de fondo de respaldo por retiro de aval a ${p.clienteNombre}`,
      },
      {
        cuenta_codigo: "1.2.02.001",
        cliente_id: p.clienteId,
        cliente_nombre: p.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Disminución de cartera de aval por retiro a ${p.clienteNombre}`,
      },
    ],
  });
}

/**
 * Liquidación de Carrera en Apuestas entre Tercios:
 *  - Carga a perdedores (`2.1.01.001` / `1.2.01.001`).
 *  - Abona a ganadores netos (`2.1.01.001`).
 *  - Abona el ingreso por comisión a la casa (`4.1.01.001`).
 *  - Si es modalidad CON CRUCES, genera el asiento de reembolso:
 *    Debe `5.1.01.001` (Reembolso de Comisión por Cruces) / Haber `2.1.01.001` (Cliente).
 */
export async function generarAsientoLiquidacionCarrera(p: {
  grupoId?: string | null;
  fecha?: string;
  carreraId: string;
  carreraNumero: number;
  hipodromo: string;
  perdedores: Array<{ clienteId: string; clienteNombre: string; montoPerdido: number }>;
  ganadores: Array<{ clienteId: string; clienteNombre: string; montoGanadoNeto: number }>;
  totalComisionCasa: number;
  crucesReembolso?: Array<{ clienteId: string; clienteNombre: string; montoReembolso: number }>;
  usuario?: string | null;
}) {
  const lineas: LineaAsientoContable[] = [];

  // Perdedores (Debe: disminución de su saldo acreedor o aumento de cuenta por cobrar)
  for (const perd of p.perdedores) {
    if (perd.montoPerdido <= 0) continue;
    lineas.push({
      cuenta_codigo: "2.1.01.001",
      cliente_id: perd.clienteId,
      cliente_nombre: perd.clienteNombre,
      debe: perd.montoPerdido,
      haber: 0,
      concepto: `Pérdida en carrera C${p.carreraNumero} ${p.hipodromo} - ${perd.clienteNombre}`,
    });
  }

  // Ganadores netos (Haber: aumento de saldo a favor del jugador)
  for (const gan of p.ganadores) {
    if (gan.montoGanadoNeto <= 0) continue;
    lineas.push({
      cuenta_codigo: "2.1.01.001",
      cliente_id: gan.clienteId,
      cliente_nombre: gan.clienteNombre,
      debe: 0,
      haber: gan.montoGanadoNeto,
      concepto: `Premio neto ganado en C${p.carreraNumero} ${p.hipodromo} - ${gan.clienteNombre}`,
    });
  }

  // Comisión de intermediación de la Casa (Haber: Ingreso Operacional)
  if (p.totalComisionCasa > 0) {
    lineas.push({
      cuenta_codigo: "4.1.01.001", // Ingresos por Comisión — Apuestas entre Tercios
      debe: 0,
      haber: p.totalComisionCasa,
      concepto: `Comisión de intermediación C${p.carreraNumero} ${p.hipodromo}`,
    });
  }

  const resAsiento = await generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "LIQUIDACION_APUESTAS",
    referencia_id: p.carreraId,
    clave_idempotencia: `LIQ:${p.hipodromo}:${p.carreraNumero}:${p.fecha || "hoy"}`,
    descripcion: `Liquidación de carrera C${p.carreraNumero} ${p.hipodromo}`,
    creado_por: p.usuario,
    lineas,
  });

  // Si hubo cruces reembolsados (Modalidad CON CRUCES)
  if (p.crucesReembolso && p.crucesReembolso.length > 0) {
    for (const cr of p.crucesReembolso) {
      if (cr.montoReembolso <= 0) continue;
      await generarAsientoReembolsoCruce({
        grupoId: p.grupoId,
        fecha: p.fecha,
        carreraId: p.carreraId,
        carreraNumero: p.carreraNumero,
        hipodromo: p.hipodromo,
        clienteId: cr.clienteId,
        clienteNombre: cr.clienteNombre,
        montoReembolso: cr.montoReembolso,
        usuario: p.usuario,
      });
    }
  }

  return resAsiento;
}

/** Reembolso de comisión por cruce (`🔀 CRUCE` Modalidad CON CRUCES) */
export async function generarAsientoReembolsoCruce(p: {
  grupoId?: string | null;
  fecha?: string;
  carreraId: string;
  carreraNumero: number;
  hipodromo: string;
  clienteId: string;
  clienteNombre: string;
  montoReembolso: number;
  usuario?: string | null;
}) {
  const monto = Math.abs(p.montoReembolso);

  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "REEMBOLSO_CRUCE",
    referencia_id: p.carreraId,
    clave_idempotencia: `CRUCE:${p.hipodromo}:${p.carreraNumero}:${p.clienteId}:${p.fecha || "hoy"}`,
    descripcion: `Reembolso de comisión por cruce C${p.carreraNumero} ${p.hipodromo} a ${p.clienteNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: "5.1.01.001", // Reembolso de Comisión por Cruces (🔀 CRUCE)
        debe: monto,
        haber: 0,
        concepto: `Reembolso comisión por cruce de jugada a favor de ${p.clienteNombre}`,
      },
      {
        cuenta_codigo: "2.1.01.001", // Acreditación a favor del cliente
        cliente_id: p.clienteId,
        cliente_nombre: p.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Abono de reembolso por cruce a ${p.clienteNombre}`,
      },
    ],
  });
}

/** Devolución de incentivo a favor del cliente (+ saldo a favor) */
export async function generarAsientoDevolucionIncentivo(p: {
  grupoId?: string | null;
  fecha?: string;
  clienteId: string;
  clienteNombre: string;
  montoIncentivo: number;
  referenciaId?: string | null;
  esAvalador?: boolean;
  usuario?: string | null;
}) {
  const monto = Math.abs(p.montoIncentivo);
  const ctaCosto = p.esAvalador ? "5.1.03.001" : "5.1.02.001"; // Devolución de Incentivos

  return generarAsientoPartidaDoble({
    grupo_id: p.grupoId,
    fecha_contable: p.fecha,
    tipo_evento: "DEVOLUCION_INCENTIVO",
    referencia_id: p.referenciaId,
    clave_idempotencia: p.referenciaId ? `INC:${p.referenciaId}:${p.clienteId}` : undefined,
    descripcion: `Devolución de incentivo a favor de ${p.clienteNombre}`,
    creado_por: p.usuario,
    lineas: [
      {
        cuenta_codigo: ctaCosto,
        debe: monto,
        haber: 0,
        concepto: `Devolución de incentivo bonificado a ${p.clienteNombre}`,
      },
      {
        cuenta_codigo: "2.1.01.001", // Saldo a favor del cliente
        cliente_id: p.clienteId,
        cliente_nombre: p.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Incentivo acreditado a favor de ${p.clienteNombre}`,
      },
    ],
  });
}

/** Reversión de liquidación o anulación: genera el contra-asiento simétrico */
export async function generarContraAsientoSimetrico(asientoOriginal: AsientoContableRegistrado, usuario?: string) {
  const lineasReverso: LineaAsientoContable[] = asientoOriginal.lineas.map((l) => ({
    cuenta_codigo: l.cuenta_codigo,
    cuenta_nombre: l.cuenta_nombre,
    cliente_id: l.cliente_id,
    cliente_nombre: l.cliente_nombre,
    debe: l.haber, // Se invierte simétricamente
    haber: l.debe,
    concepto: `Reverso de asiento N°${asientoOriginal.numero_asiento}: ${l.concepto || ""}`,
  }));

  const res = await generarAsientoPartidaDoble({
    tipo_evento: "REVERSION_LIQUIDACION",
    referencia_id: asientoOriginal.referencia_id,
    clave_idempotencia: `REV:${asientoOriginal.clave_idempotencia || asientoOriginal.id}`,
    descripcion: `Contra-asiento simétrico de N°${asientoOriginal.numero_asiento} (${asientoOriginal.descripcion})`,
    creado_por: usuario || "sistema",
    lineas: lineasReverso,
  });

  if (res.ok) {
    asientoOriginal.estado = "REVERSADO";
  }

  return res;
}

/**
 * 7. ASIENTO DE SALDOS COMPROMETIDOS POR JUGADA EN CURSO (RETENCIÓN TRANSITORIA)
 *
 * Al momento exacto en que un cliente realiza una jugada en cualquier modal/módulo:
 *   - DEBE: 2.1.01.001 (Depósitos y Saldos Acreedores de Clientes / Cuentas de Jugadores)
 *           -> Descuenta de inmediato el monto jugado del saldo del cliente, dejándolo
 *              en negativo si no tenía saldo previo hasta que se liquide o se anule.
 *   - HABER: 2.1.02.003 (Saldos Comprometidos por Jugadas en Curso - Retención Transitoria)
 *   - CUENTAS DE ORDEN: 7.1.01.001 (Debe) / 7.1.01.002 (Haber) para control de exposición.
 */
export async function generarAsientoCompromisoJugada(params: {
  ticketId?: string | number | null;
  clienteId?: string | number | null;
  clienteNombre: string;
  contraparteId?: string | number | null;
  contraparteNombre?: string | null;
  montoJugador: number;
  montoContraparte?: number;
  hipodromo: string;
  carrera: number | string;
  fecha: string;
  jugada: string;
  caballo: string;
  esAdelantada?: boolean;
  grupoId?: string | null;
  usuario?: string | null;
}) {
  const monto1 = deCentavos(Math.max(0, aCentavos(params.montoJugador)));
  const monto2 = deCentavos(Math.max(0, aCentavos(params.montoContraparte ?? 0)));
  const cuentaBolsa = params.esAdelantada ? "2.1.02.002" : "2.1.02.003";
  const lineas: LineaAsientoContable[] = [];

  if (monto1 > 0) {
    lineas.push(
      {
        cuenta_codigo: "2.1.01.001",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: monto1,
        haber: 0,
        concepto: `Descuento inmediato por jugada en curso: ${params.jugada} (#${params.caballo}) · ${params.hipodromo} C${params.carrera}`,
      },
      {
        cuenta_codigo: cuentaBolsa,
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: 0,
        haber: monto1,
        concepto: `Saldo comprometido en tránsito: ${params.jugada} (#${params.caballo}) · ${params.hipodromo} C${params.carrera}`,
      },
      {
        cuenta_codigo: "7.1.01.001",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: monto1,
        haber: 0,
        concepto: `Exposición en curso Jugador 1 (${params.clienteNombre})`,
      },
      {
        cuenta_codigo: "7.1.01.002",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: 0,
        haber: monto1,
        concepto: `Contra-cuenta exposición en curso Jugador 1 (${params.clienteNombre})`,
      }
    );
  }

  if (monto2 > 0 && params.contraparteNombre) {
    lineas.push(
      {
        cuenta_codigo: "2.1.01.001",
        cliente_id: params.contraparteId != null ? String(params.contraparteId) : null,
        cliente_nombre: params.contraparteNombre,
        debe: monto2,
        haber: 0,
        concepto: `Descuento inmediato por compromiso (Da): ${params.jugada} (#${params.caballo}) · ${params.hipodromo} C${params.carrera}`,
      },
      {
        cuenta_codigo: cuentaBolsa,
        cliente_id: params.contraparteId != null ? String(params.contraparteId) : null,
        cliente_nombre: params.contraparteNombre,
        debe: 0,
        haber: monto2,
        concepto: `Saldo comprometido en tránsito (Da): ${params.jugada} (#${params.caballo}) · ${params.hipodromo} C${params.carrera}`,
      }
    );
  }

  return generarAsientoPartidaDoble({
    grupo_id: params.grupoId ?? null,
    fecha_contable: params.fecha,
    tipo_evento: "COMPROMISO_JUGADA",
    referencia_id: params.ticketId != null ? String(params.ticketId) : `${params.hipodromo}-C${params.carrera}-${params.clienteNombre}`,
    clave_idempotencia: params.ticketId != null ? `COMPROMISO:${params.ticketId}` : undefined,
    descripcion: `Compromiso inmediato de saldo por jugada ${params.jugada} (#${params.caballo}) en ${params.hipodromo} C${params.carrera} (${params.fecha})`,
    creado_por: params.usuario ?? "sistema",
    lineas,
  });
}

/**
 * 8. LIBERACIÓN DE SALDO COMPROMETIDO (POR ANULACIÓN, RETIRO O LIQUIDACIÓN)
 */
export async function generarAsientoLiberacionCompromisoJugada(params: {
  ticketId?: string | number | null;
  clienteId?: string | number | null;
  clienteNombre: string;
  montoLiberado: number;
  motivo: "ANULACION" | "RETIRO" | "LIQUIDACION";
  hipodromo?: string;
  carrera?: number | string;
  fecha?: string;
  esAdelantada?: boolean;
  grupoId?: string | null;
  usuario?: string | null;
}) {
  const monto = deCentavos(Math.max(0, aCentavos(params.montoLiberado)));
  const cuentaBolsa = params.esAdelantada ? "2.1.02.002" : "2.1.02.003";
  return generarAsientoPartidaDoble({
    grupo_id: params.grupoId ?? null,
    fecha_contable: params.fecha,
    tipo_evento: "LIBERACION_COMPROMISO_JUGADA",
    referencia_id: params.ticketId != null ? String(params.ticketId) : undefined,
    clave_idempotencia: params.ticketId != null ? `LIBERACION:${params.motivo}:${params.ticketId}` : undefined,
    descripcion: `Liberación de saldo comprometido (${params.motivo}) · ${params.clienteNombre}`,
    creado_por: params.usuario ?? "sistema",
    lineas: [
      {
        cuenta_codigo: cuentaBolsa,
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: monto,
        haber: 0,
        concepto: `Liberación de retención transitoria (${params.motivo})`,
      },
      {
        cuenta_codigo: "2.1.01.001",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Restitución de saldo comprometido (${params.motivo})`,
      },
      {
        cuenta_codigo: "7.1.01.002",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: monto,
        haber: 0,
        concepto: `Cierre de contra-cuenta de exposición (${params.motivo})`,
      },
      {
        cuenta_codigo: "7.1.01.001",
        cliente_id: params.clienteId != null ? String(params.clienteId) : null,
        cliente_nombre: params.clienteNombre,
        debe: 0,
        haber: monto,
        concepto: `Cierre de exposición en curso (${params.motivo})`,
      },
    ],
  });
}

// ============================================================================
// CONSULTAS DEL LIBRO MAYOR Y REPORTES FINANCIEROS (NIIF)
// ============================================================================

export function obtenerAsientosMemoria(): AsientoContableRegistrado[] {
  return [...ASIENTOS_MEMORIA];
}

/**
 * Calcula los saldos acumulados de todas las cuentas del PUC (Debe - Haber según naturaleza)
 */
export function calcularSaldosPlanCuentas(
  asientos: AsientoContableRegistrado[] = ASIENTOS_MEMORIA
): Map<string, { saldo: number; totalDebe: number; totalHaber: number }> {
  const mapa = new Map<string, { saldo: number; totalDebe: number; totalHaber: number }>();

  // Inicializar todas las cuentas
  for (const cta of PLAN_CUENTAS_HIPICO) {
    mapa.set(cta.codigo, { saldo: 0, totalDebe: 0, totalHaber: 0 });
  }

  for (const as of asientos) {
    for (const l of as.lineas) {
      const reg = mapa.get(l.cuenta_codigo) || { saldo: 0, totalDebe: 0, totalHaber: 0 };
      const ctaDef = obtenerCuentaPorCodigo(l.cuenta_codigo);
      const debe = l.debe || 0;
      const haber = l.haber || 0;

      reg.totalDebe = sumarDinero(reg.totalDebe, debe);
      reg.totalHaber = sumarDinero(reg.totalHaber, haber);

      // Naturaleza: DEUDORA = Debe - Haber; ACREEDORA = Haber - Debe
      if (ctaDef?.naturaleza === "DEUDORA") {
        reg.saldo = restarDinero(reg.totalDebe, reg.totalHaber);
      } else {
        reg.saldo = restarDinero(reg.totalHaber, reg.totalDebe);
      }

      mapa.set(l.cuenta_codigo, reg);
    }
  }

  return mapa;
}

/**
 * Estado de Resultados de la Semana:
 *   + Ingresos Brutos (4.x)
 *   - Reembolsos por Cruces (5.1.01.001)
 *   - Devolución de Incentivos (5.1.02.001 / 5.1.03.001)
 *   = Ingreso Neto Operacional de la Casa
 *   - Costos de Premios Pagados (5.2.x)
 *   - Gastos Operativos (6.x)
 *   = Utilidad Neta de la Semana
 */
export function calcularEstadoResultadosSemana(
  asientos: AsientoContableRegistrado[] = ASIENTOS_MEMORIA
) {
  const saldos = calcularSaldosPlanCuentas(asientos);

  // 4. Ingresos por comisión y ventas
  const comisionTercios = saldos.get("4.1.01.001")?.saldo || 0;
  const comisionRemates = saldos.get("4.1.02.001")?.saldo || 0;
  const comisionPollas = saldos.get("4.1.03.001")?.saldo || 0;
  const comisionDupletas = saldos.get("4.1.04.001")?.saldo || 0;
  const ventasTablas = saldos.get("4.2.01.001")?.saldo || 0;
  const ventasMarcas = saldos.get("4.2.02.001")?.saldo || 0;
  const ventasWps = saldos.get("4.2.03.001")?.saldo || 0;
  const convenios = saldos.get("4.3.01.001")?.saldo || 0;

  const totalIngresosBrutos = sumarDinero(
    comisionTercios,
    comisionRemates,
    comisionPollas,
    comisionDupletas,
    ventasTablas,
    ventasMarcas,
    ventasWps,
    convenios
  );

  // 5.1 Rebajas por Cruces e Incentivos
  const reembolsosCruces = saldos.get("5.1.01.001")?.saldo || 0;
  const incentivosClientes = saldos.get("5.1.02.001")?.saldo || 0;
  const incentivosAvaladores = saldos.get("5.1.03.001")?.saldo || 0;
  const totalRebajasEIncentivos = sumarDinero(reembolsosCruces, incentivosClientes, incentivosAvaladores);

  // Ingreso Neto Operacional
  const ingresoNetoOperacional = restarDinero(totalIngresosBrutos, totalRebajasEIncentivos);

  // 5.2 Costo de Premios
  const premiosTablas = saldos.get("5.2.01.001")?.saldo || 0;
  const premiosMarcasDupletas = saldos.get("5.2.02.001")?.saldo || 0;
  const premiosWps = saldos.get("5.2.03.001")?.saldo || 0;
  const totalPremios = sumarDinero(premiosTablas, premiosMarcasDupletas, premiosWps);

  // 6. Gastos Operativos
  const comisionesBancarias = saldos.get("6.1.01.001")?.saldo || 0;
  const diferencialCambiario = saldos.get("6.1.02.001")?.saldo || 0;
  const administracionOperadores = saldos.get("6.1.03.001")?.saldo || 0;
  const totalGastos = sumarDinero(comisionesBancarias, diferencialCambiario, administracionOperadores);

  // Utilidad Neta
  const utilidadNeta = restarDinero(ingresoNetoOperacional, sumarDinero(totalPremios, totalGastos));

  return {
    ingresos: {
      comisionTercios,
      comisionRemates,
      comisionPollas,
      comisionDupletas,
      ventasTablas,
      ventasMarcas,
      ventasWps,
      convenios,
      totalIngresosBrutos,
    },
    rebajasEIncentivos: {
      reembolsosCruces,
      incentivosClientes,
      incentivosAvaladores,
      totalRebajasEIncentivos,
    },
    ingresoNetoOperacional,
    costosPremios: {
      premiosTablas,
      premiosMarcasDupletas,
      premiosWps,
      totalPremios,
    },
    gastos: {
      comisionesBancarias,
      diferencialCambiario,
      administracionOperadores,
      totalGastos,
    },
    utilidadNeta,
  };
}
