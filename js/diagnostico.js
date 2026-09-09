document.addEventListener('DOMContentLoaded', () => {

    const tbody = document.getElementById('cuerpoChecklist');
    const resumen = document.getElementById('resumenGlobal');
    const sqlCaja = document.getElementById('sqlPendiente');

    // El SQL pendiente se mantiene IGUAL al archivo sql/paquete_pendientes.sql
    // Aparece aqui para que lo copies con un clic aunque estes fuera del repo.
    fetch('../sql/paquete_pendientes.sql')
        .then(r => r.ok ? r.text() : Promise.reject('no-sql'))
        .then(txt => { sqlCaja.value = txt; })
        .catch(() => {
            sqlCaja.value = '// No se pudo leer sql/paquete_pendientes.sql desde Pages.\n' +
                '// Pide el contenido del archivo en el repo (C:\\Users\\julio\\sistema_hipico\\sql\\paquete_pendientes.sql).';
        });

    const cl = (m, r, e) => `<tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="p-2.5 font-bold text-slate-800">${m}</td>
        <td class="p-2.5 text-slate-700">${r}</td>
        <td class="p-2.5">${e}</td>
    </tr>`;

    const okLbl = '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black text-[10px]"><i class="fas fa-check mr-1"></i>OK</span>';
    const faltaLbl = (actor) => '<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-black text-[10px]"><i class="fas fa-times mr-1"></i>FALTA</span>';
    const warnLbl = '<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black text-[10px]"><i class="fas fa-exclamation mr-1"></i>REVISAR</span>';

    const filas = [];
    let oks = 0, faltan = 0, warn = 0;

    function esErrorColumna(e) {
        const msg = (e && e.message) || '';
        return /Could not find the '(.*?)' column|schema cache|Could not find the function|does not exist|The schema must|Invalid.*table/i.test(msg);
    }

    function registrar(m, r, ok, detalle) {
        if (ok === true) { oks++; filas.push(cl(m, r, okLbl + ' ' + (detalle || ''))); }
        else if (ok === false) { faltan++; filas.push(cl(m, r, faltaLbl() + '<span class="block text-[10px] text-slate-500 mt-1">' + (detalle || '') + '</span>')); }
        else { warn++; filas.push(cl(m, r, warnLbl() + '<span class="block text-[10px] text-slate-500 mt-1">' + (detalle || '') + '</span>')); }
    }

    // Verifica una serie de columnas de una tabla: devuelve { ok, faltantes }
    async function chequearColumnas(tabla, cols) {
        const faltantes = [];
        for (const c of cols) {
            try {
                const { error } = await window.supabase.from(tabla).select(c).limit(1);
                if (error && esErrorColumna(error)) faltantes.push(c);
            } catch (e) { faltantes.push(c); }
        }
        return { ok: faltantes.length === 0, faltantes };
    }

    async function correr() {
        tbody.innerHTML = '<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">Ejecutando verificaciones...</td></tr>';
        filas.length = 0; oks = 0; faltan = 0; warn = 0;
        const RPC_ACTORS = 'Ejecutar: sql/paquete_pendientes.sql (o tasas_referencia.sql + seguridad.sql + limpieza_auditoria.sql)';

        // --- TABLAS Y COLUMNAS CLAVE ---
        const recurso = [
            ['clientes', ['email', 'cedula_rif', 'direccion', 'codigo_pais', 'datos_pago', 'telefono', 'comision', 'grupo_id', 'seudonimo', 'apellido', 'modo_juego']],
            ['depositos', ['modalidad', 'referencia', 'moneda', 'tasa_cambio', 'monto_usd']],
            ['transacciones_financieras', ['referencia', 'moneda', 'tasa_cambio', 'monto_usd', 'numero_cuenta', 'tipo_cuenta', 'cedula_rif', 'nombre_beneficiario']],
            ['notificaciones', ['tipo', 'titulo', 'mensaje', 'cliente_id', 'cliente_nombre', 'datos', 'estado']],
            ['grupos_venta', ['tabla_id', 'grupo_id', 'numero_boleto', 'estado']],
            ['solicitudes_tablas', ['tabla_id', 'grupo_id', 'solicitante', 'estado']],
            ['tabla_grupos', ['tabla_id', 'grupo_id']],
            ['tasas_referencia', ['tipo', 'tasa', 'fecha_aplicar']],
            ['auditoria', ['usuario', 'modulo', 'accion']]
        ];
        for (const [tabla, cols] of recurso) {
            const r = await chequearColumnas(tabla, cols);
            registrar(tabla.toUpperCase(), cols.join(', '), r.ok,
                r.ok ? '' : 'Faltan: ' + r.faltantes.join(', ') + ' → ' + RPC_ACTORS);
        }

        // --- RPC: club_log_accion (escribe una linea de diagnostico, benigna) ---
        try {
            const { error } = await window.supabase.rpc('club_log_accion', {
                p_usuario: window.clubAuth?.getSesion?.()?.nombre || 'diagnostico',
                p_modulo: 'DIAGNOSTICO',
                p_accion: 'verificacion de esquema desde la pagina de diagnostico'
            });
            registrar('RPC', 'club_log_accion', !error, error ? (RPC_ACTORS) : '');
        } catch (e) {
            registrar('RPC', 'club_log_accion', false, RPC_ACTORS);
        }

        // --- RPC: club_limpiar_auditoria (no se llama: borraria filas; solo se verifica via info del script) ---
        registrar('RPC', 'club_limpiar_auditoria', null, 'Se crea en sql/paquete_pendientes.sql; úsalo luego con: select public.club_limpiar_auditoria(30);');

        // --- RENDER ---
        tbody.innerHTML = filas.join('');

        const totalCheck = oks + faltan + warn;
        const pctOk = totalCheck ? Math.round((oks / totalCheck) * 100) : 0;
        resumen.innerHTML = `
            <div class="bg-emerald-600 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${oks}<span class="text-emerald-200 text-xs font-bold ml-1">/${totalCheck}</span></p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-emerald-100">Correctos</p>
            </div>
            <div class="bg-red-600 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${faltan}</p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-red-100">Faltantes (SQL)</p>
            </div>
            <div class="bg-amber-500 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${warn}</p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-amber-100">Revisar</p>
            </div>
            <div class="bg-slate-800 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${pctOk}%</p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-slate-300">Completitud</p>
            </div>`.replace('${cl(c, )}', '');

        if (faltan > 0) {
            clubUI.toast(`Faltan ${faltan} recursos: copia el SQL y pégalo en el SQL Editor.`, 'warning');
        } else {
            clubUI.toast('Esquema verificado: todo en orden.', 'success');
        }
    }

    document.getElementById('btnRepetir').addEventListener('click', correr);
    document.getElementById('btnCopiarSql').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(sqlCaja.value);
            clubUI.toast('SQL copiado al portapapeles.', 'success');
        } catch (e) {
            sqlCaja.select();
            document.execCommand('copy');
            clubUI.toast('SQL copiado (método alternativo).', 'success');
        }
    });

    correr();
});