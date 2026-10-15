// Archivo: js/auditoria.js
// Propósito: Consultar el log de auditoría real desde la tabla `auditoria` de Supabase.
// Los registros los genera la función RPC club_log_accion (ver sql/seguridad.sql).

document.addEventListener('DOMContentLoaded', function() {

    const formFiltros = document.getElementById('formFiltrosAuditoria');
    const btnLimpiar = document.getElementById('btnLimpiarFiltros');
    const inputDesde = document.getElementById('filtroDesde');
    const inputHasta = document.getElementById('filtroHasta');
    const resumen = document.getElementById('resumenRegistros');
    const tbody = document.getElementById('tablaRegistrosAuditoria');
    const totalRegistros = document.getElementById('totalRegistrosBig');

    const LIMITE = 100;

    // ==========================================
    // 1. CONSULTA Y RENDERIZADO
    // ==========================================
    async function buscarRegistros(filtros) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 font-bold">Consultando servicios...⌛</td></tr>';
        resumen.textContent = 'Consultando...';

        let query = window.supabase.from('auditoria').select('*', { count: 'exact' }).limit(LIMITE).order('fecha', { ascending: false });

        if (filtros.desde) query = query.gte('fecha', `${filtros.desde}T00:00:00`);
        if (filtros.hasta) query = query.lte('fecha', `${filtros.hasta}T23:59:59`);
        if (filtros.modulo) query = query.eq('modulo', filtros.modulo);
        if (filtros.usuario) query = query.ilike('usuario', `%${filtros.usuario}%`);
        if (filtros.accion) query = query.ilike('accion', `%${filtros.accion}%`);
        if (filtros.ip) query = query.ilike('ip', `%${filtros.ip}%`);

        const { data, error, count } = await query;

        if (error) {
            resumen.textContent = 'Error al consultar auditoría';
            tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-red-500 font-bold">
                ${error.message.includes('does not exist')
                    ? 'La tabla <code>auditoria</code> no existe todavía. Ejecuta <b>sql/seguridad.sql</b> en el SQL Editor de Supabase.'
                    : 'Error: ' + escapeHtml(error.message)}</td></tr>`;
            return;
        }

        const registros = data || [];
        resumen.textContent = registros.length
            ? `Mostrando ${registros.length} de ${(count ?? registros.length)} registros — ordenados por fecha descendente`
            : 'Sin registros para los filtros aplicados';
        if (totalRegistros) totalRegistros.textContent = (count ?? registros.length);

        if (!registros.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 font-bold">Sin registros de auditoría.</td></tr>';
            return;
        }

        tbody.innerHTML = registros.map((r, i) => {
            const fecha = r.fecha ? new Date(r.fecha) : null;
            const fechaTxt = fecha
                ? `${fecha.toLocaleDateString('es-ES')}<br><span class="text-[10px] font-normal text-slate-500">${fecha.toLocaleTimeString('es-ES')}</span>`
                : '—';
            const esLogin = (r.modulo || '').toUpperCase() === 'LOGIN';
            return `
                <tr class="hover:bg-slate-50">
                    <td class="p-3 text-slate-400">${(count ?? 0) - i - registros.length + 1}</td>
                    <td class="p-3 font-bold">${fechaTxt}</td>
                    <td class="p-3 font-bold text-slate-900">${escapeHtml(r.usuario || '—')}</td>
                    <td class="p-3"><span class="bg-slate-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold">${escapeHtml((r.modulo || '—').toUpperCase())}</span></td>
                    <td class="p-3 ${esLogin ? 'text-emerald-600 font-medium' : ''}">${escapeHtml(r.accion || '—')}</td>
                    <td class="p-3 font-mono text-[11px]">${escapeHtml(r.ip || '—')}</td>
                    <td class="p-3 text-slate-400">${escapeHtml(r.ubicacion || '—')}</td>
                    <td class="p-3 text-slate-400 truncate max-w-[200px]" title="${escapeHtml(r.navegador || '')}">${escapeHtml(truncar(r.navegador, 32) || '—')}</td>
                </tr>`;
        }).join('');
    }

    function escapeHtml(texto) {
        return String(texto).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function truncar(texto, max) {
        texto = String(texto || '');
        return texto.length > max ? texto.slice(0, max) + '...' : texto;
    }

    // ==========================================
    // 2. PROCESAMIENTO DEL FILTRO
    // ==========================================
    if (formFiltros) {
        formFiltros.addEventListener('submit', function(e) {
            e.preventDefault();
            const filtros = {
                desde: inputDesde.value,
                hasta: inputHasta.value,
                modulo: document.getElementById('filtroModulo').value,
                usuario: document.getElementById('filtroUsuario').value,
                accion: document.getElementById('filtroAccion').value,
                ip: document.getElementById('filtroIP').value
            };
            buscarRegistros(filtros);
        });
    }

    // ==========================================
    // 3. BOTONES DE FECHA RÁPIDA
    // ==========================================
    document.querySelectorAll('.btn-fecha-rapida').forEach(boton => {
        boton.addEventListener('click', function() {
            const rango = this.getAttribute('data-rango');
            const hoy = new Date();
            const formatearFecha = (fecha) => fecha.toISOString().split('T')[0];

            if (rango === 'hoy') {
                inputDesde.value = formatearFecha(hoy);
                inputHasta.value = formatearFecha(hoy);
            } else if (rango === '7dias') {
                const hace7Dias = new Date(hoy);
                hace7Dias.setDate(hoy.getDate() - 7);
                inputDesde.value = formatearFecha(hace7Dias);
                inputHasta.value = formatearFecha(hoy);
            } else if (rango === 'mes') {
                const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
                inputDesde.value = formatearFecha(primerDiaMes);
                inputHasta.value = formatearFecha(hoy);
            }

            formFiltros.dispatchEvent(new Event('submit'));
        });
    });

    // ==========================================
    // 4. ESTADÍSTICAS REALES POR MÓDULO
    // ==========================================
    const GRUPOS_STATS = [
        ['CLIENTES', 'CLIENTES'],
        ['HIPODROMOS', 'HIPODROMOS'],
        ['TABLAS', 'TABLAS'],
        ['VENTA_TABLAS', 'VENTA_TABLAS'],
        ['TAQUILLA', 'TAQUILLA'],
        ['SALDOS', 'SALDOS'],
        ['MONEDAS', 'MONEDAS'],
        ['OPERADORES', 'OPERADORES'],
        ['WPS', 'WPS'],
        ['REMATES', 'REMATES'],
        ['FINANZAS', ['BANCOS', 'CAJA', 'DEPOSITOS', 'BANCOS_REALES']],
        ['LOGIN', 'LOGIN']
    ];

    async function cargarStats() {
        for (const [statKey, modulos] of GRUPOS_STATS) {
            const lista = Array.isArray(modulos) ? modulos : [modulos];
            let total = 0;
            for (const m of lista) {
                const { count } = await window.supabase.from('auditoria')
                    .select('id', { count: 'exact', head: true })
                    .eq('modulo', m);
                total += (count ?? 0);
            }
            const el = document.querySelector(`[data-stats="${statKey}"]`);
            if (el) el.textContent = total;
        }
    }

    // ==========================================
    // 5. LIMPIEZA DE AUDITORÍA (RPC segura)
    // ==========================================
    document.getElementById('btnLimpiarAuditoria')?.addEventListener('click', async function() {
        const dias = parseInt(document.getElementById('diasLimpiar').value);
        if (isNaN(dias) || dias < 1) return window.clubUI.toast('Ingrese una cantidad válida de días.', 'error');

        const fechaCorte = new Date();
        fechaCorte.setDate(fechaCorte.getDate() - dias);
        const corteTxt = fechaCorte.toLocaleDateString('es-ES');

        if (!confirm(`⚠️ LIMPIEZA DE AUDITORÍA\n\n¿Eliminar los registros de auditoría ANTIGUOS (más de ${dias} días, antes del ${corteTxt})?\n\nEsta acción no se puede deshacer.`)) return;

        const btn = this;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Limpiando...';

        try {
            const { data, error } = await window.supabase.rpc('club_limpiar_auditoria', { p_dias: dias });
            if (error) throw error;

            window.clubUI.toast(`Limpieza completada: ${data ?? 0} registro(s) eliminados.`, 'success');
            cargarStats();
            formFiltros.dispatchEvent(new Event('submit'));
        } catch (e) {
            console.error(e);
            window.clubUI.toast('Error al limpiar: ejecuta primero sql/limpieza_auditoria.sql en Supabase. ' + (e.message || ''), 'error');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-broom mr-1"></i> Limpiar registros';
    });

    // ==========================================
    // 6. LIMPIAR FILTROS
    // ==========================================
    if (btnLimpiar) {
        btnLimpiar.addEventListener('click', function() {
            formFiltros.reset();
            const hoyFormat = new Date().toISOString().split('T')[0];
            inputDesde.value = hoyFormat;
            inputHasta.value = hoyFormat;
            formFiltros.dispatchEvent(new Event('submit'));
        });
    }

    // Carga inicial (hoy)
    const hoy = new Date().toISOString().split('T')[0];
    inputDesde.value = hoy;
    inputHasta.value = hoy;
    buscarRegistros({ desde: hoy, hasta: hoy, modulo: '', usuario: '', accion: '', ip: '' });
    cargarStats();

});