// ============================================================
// CORE COMPARTIDO DE VENTA DE TABLAS FIJAS
// Usado por: Página de Ventas (venta_tablas.js) y
//            Monitor de Tablas Fijas (tablas.js)
// ------------------------------------------------------------
// GARANTÍA IMPORTANTE: cada venta CONGELA en el ticket:
//   - premio_por_tabla  : el premio recalculado en el momento
//   - pts_ejemplar      : el valor del ejemplar en el momento
// Por eso editar los valores de la tabla después NO modifica
// lo que ya se vendió; los tickets conservan sus cifras.
// ============================================================
(function () {
    'use strict';

    const aNum = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        const n = parseFloat(s.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : null;
    };

    const fmt = (v, d = 2) => {
        const n = parseFloat(v);
        if (!Number.isFinite(n)) v = 0;
        return (window.clubUI && window.clubUI.formatoNumero)
            ? window.clubUI.formatoNumero(n, d)
            : Number(n).toFixed(d);
    };

    const simboloMoneda = (m) => m === 'VES' ? 'Bs ' : '$';

    // ============================================================
    // VENTA: crea el ticket (premio/valor congelados), descuenta
    // el cupo del grupo que COBRA y ajusta el saldo del cliente.
    // Se registra además el grupo que recibe la COMISIÓN.
    // Retorna { ok, costoTotal, premioTotal, gananciaTotal,
    //           comisionEstimada, comisionPorc, premio, pts,
    //           cantidad, esVES }
    // ============================================================
    async function venderTabla({ cliente, cantidad, ejemplar, tabla, tg, grupo, grupoComision, tasaCambio, permitirSobregiro = false }) {
        if (!grupo) return { ok: false, error: 'Grupo no encontrado.' };
        const pts = parseFloat(ejemplar.valor_ejemplar) || 0;
        const costoTotal = pts * cantidad;
        const esVES = grupo.moneda === 'VES';
        const tasa = parseFloat(tasaCambio) || 1;
        const costoUSD = esVES ? costoTotal / (tasa || 1) : costoTotal;
        const gCom = grupoComision || grupo;

        const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
        if (!permitirSobregiro) {
            if (modoJuega === 'pozo') {
                const disp = parseFloat(cliente.saldo_actual) || 0;
                if (disp < costoUSD) return { ok: false, error: `El cliente ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${fmt(disp)}). Debe abonar antes.` };
            } else if (!cliente.libre) {
                const limiteAval = parseFloat(cliente.aval || 0);
                if ((parseFloat(cliente.saldo_actual) || 0) - costoUSD < -limiteAval) {
                    return { ok: false, error: `El cliente ${cliente.nombre} supera su límite de AVAL ($${fmt(limiteAval)}). Debe abonar antes.` };
                }
            }
            if (!esVES && (parseFloat(cliente.saldo_actual) || 0) < costoTotal) {
                return { ok: false, error: `El cliente ${cliente.nombre} tiene saldo insuficiente ($${fmt(cliente.saldo_actual)}).` };
            }
        }

        const vendidas = tg.cantidad_vendida || 0;
        const disponibles = (tg.cupos || 0) - vendidas;
        if (cantidad > disponibles) return { ok: false, error: `No hay suficientes tablas disponibles. Solo quedan ${disponibles}.` };

        const premio = parseFloat(tabla.premio_recalculado) || 0;
        const premioTotal = premio * cantidad;
        const gananciaTotal = Math.max(0, premioTotal - costoTotal);
        const comisionTabla = parseFloat(tabla.comision_grupo);
        const comisionPorc = !isNaN(comisionTabla) ? comisionTabla : parseFloat(gCom.comision_default || 2.5);
        const comisionEstimada = gananciaTotal * (comisionPorc / 100);

        const { error: errTk } = await window.supabase.from('tickets_apuestas').insert([{
            cliente_juega_id: cliente.id,
            cliente_juega_nombre: cliente.nombre,
            grupo: grupo.nombre,
            grupo_cobro_id: grupo.id,
            grupo_cobro_nombre: grupo.nombre,
            grupo_comision_id: gCom.id,
            grupo_comision_nombre: gCom.nombre,
            hipodromo: tabla.hipodromo,
            carrera: tabla.carrera,
            nombre_jugada: `TABLA FIJA (${tabla.hipodromo} C${tabla.carrera})`,
            caballo: ejemplar.nombre,
            ejemplar_numero: parseInt(ejemplar.numero, 10) || null,
            cantidad_tablas: cantidad,
            monto_jugado: costoTotal,
            premio_por_tabla: premio,       // CONGELADO al momento de la venta
            pts_ejemplar: pts,              // CONGELADO al momento de la venta
            monto_decidido: gananciaTotal,
            comision_porcentaje: comisionPorc,
            moneda: grupo.moneda,
            tasa_cambio: tasa,
            estado: 'Pendiente'
        }]);
        if (errTk) return { ok: false, error: 'Ticket: ' + (errTk.message || errTk.code) };

        const { error: errTg } = await window.supabase.from('tabla_grupos').update({
            cantidad_vendida: vendidas + cantidad
        }).eq('id', tg.id);
        if (errTg) return { ok: false, error: 'Inventario: ' + (errTg.message || errTg.code) };

        const { error: errCl } = await window.supabase.from('clientes').update({
            saldo_actual: (parseFloat(cliente.saldo_actual) || 0) - costoUSD
        }).eq('id', cliente.id);
        if (errCl) return { ok: false, error: 'Saldo: ' + (errCl.message || errCl.code) };

        return { ok: true, costoTotal, premioTotal, gananciaTotal, comisionEstimada, comisionPorc, premio, pts, cantidad, esVES };
    }

    // ============================================================
    // IMPRESIÓN: abre una ventana limpia lista para imprimir
    // ============================================================
    function printHTML(titulo, html) {
        const w = window.open('', '_blank', 'width=460,height=680');
        if (!w) { alert('Permita ventanas emergentes para poder imprimir el documento.'); return; }
        w.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titulo}</title>
<style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;margin:22px;font-size:13px}
    h1{font-size:16px;text-align:center;border-bottom:2px solid #10b981;padding-bottom:8px;margin:0 0 4px}
    .sub{text-align:center;color:#64748b;font-size:11px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    td,th{border:1px solid #cbd5e1;padding:5px 8px;text-align:left;font-size:12px}
    th{background:#f1f5f9}
    .r{text-align:right}.b{font-weight:700}
    .gran{border-top:3px double #0f172a;margin-top:6px;background:#ecfdf5;font-weight:700}
    .aviso{font-size:10px;color:#475569;margin-top:10px;text-align:center}
</style></head><body>${html}</body></html>`);
        w.document.close();
        w.focus();
        setTimeout(() => { w.print(); }, 350);
    }

    // ============================================================
    // COMPROBANTE PARA EL JUGADOR (HTML imprimible)
    // ============================================================
    function comprobanteHTML({ cliente, ejemplar, tabla, grupo, cantidad, res, tasaCambio, saldoPosterior }) {
        const simb = simboloMoneda(grupo.moneda);
        const fecha = new Date().toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const folio = `T-${tabla.hipodromo}-C${tabla.carrera}-N${ejemplar.numero || ejemplar.nombre}-${Date.now().toString().slice(-6)}`;
        const notas = [];
        if (parseFloat(saldoPosterior) < 0) {
            notas.push(`Aviso: tras la venta, el cliente ${cliente.nombre} queda con saldo negativo de $${fmt(Math.abs(saldoPosterior))} (aval activo).`);
        }
        return `
            <h1>Comprobante de Venta · Tabla Fija</h1>
            <div class="sub">Folio: ${folio} &nbsp;·&nbsp; ${fecha}</div>
            <table>
                <tr><th>Cliente</th><td class="b">${cliente.nombre}</td></tr>
                <tr><th>Grupo</th><td>${grupo.nombre}</td></tr>
                <tr><th>Carrera</th><td>${tabla.hipodromo} · C${tabla.carrera}</td></tr>
                <tr><th>Ejemplar</th><td>N° ${ejemplar.numero || '-'} — ${ejemplar.nombre}</td></tr>
                <tr><th>Cantidad de Tablas</th><td class="r b">${res.cantidad}</td></tr>
                <tr><th>Valor por Tabla</th><td class="r b">${simb}${fmt(res.pts)}</td></tr>
                <tr><th>Premio por Tabla (tras retiros)</th><td class="r b">${simb}${fmt(res.premio)}</td></tr>
                <tr><th>Total Pagado</th><td class="r b">${simb}${fmt(res.costoTotal)}</td></tr>
                <tr><th>Premio a Cobrar (si gana)</th><td class="r b">${simb}${fmt(res.premioTotal)}</td></tr>
                <tr><th>Ganancia (si gana)</th><td class="r b">${simb}${fmt(res.gananciaTotal)}</td></tr>
                <tr class="gran"><th>Comisión del Grupo (${fmt(res.comisionPorc, 1)}% s/ganancia)</th><td class="r b">${simb}${fmt(res.comisionEstimada)}</td></tr>
            </table>
            <div class="aviso">
                El premio indicado ya está ajustado por los retiros oficiales de la carrera.<br>
                La liquidación del premio se realiza al cierre de la carrera.
                ${notas.length ? '<br>' + notas.join('<br>') : ''}
            </div>
        `;
    }

    window.VentaTablasCore = { venderTabla, printHTML, comprobanteHTML, simboloMoneda, aNum };
})();