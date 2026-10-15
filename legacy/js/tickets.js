document.addEventListener('DOMContentLoaded', () => {

    const sesion = window.clubAuth.getSesion();

    const cuerpo = document.getElementById('cuerpoTickets');
    const txtFiltro = document.getElementById('filtroTicketsTexto');
    const selEstado = document.getElementById('filtroTicketsEstado');
    const contadores = document.getElementById('contadoresTickets');

    let tickets = [];

    const BADGES = {
        CREADO: 'bg-amber-100 text-amber-700',
        EN_REVISION: 'bg-sky-100 text-sky-700',
        SOLUCIONADO: 'bg-emerald-100 text-emerald-700'
    };

    const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function pintarContadores() {
        const n = (e) => tickets.filter(t => t.estado === e).length;
        const pill = (txt, cant, color) => `
            <span class="px-3 py-1 rounded-full text-[10px] font-black ${color}">
                ${txt}: <span class="font-mono">${cant}</span>
            </span>`;
        contadores.innerHTML =
            pill('TOTAL', tickets.length, 'bg-slate-100 text-slate-600') +
            pill('CREADO', n('CREADO'), 'bg-amber-100 text-amber-700') +
            pill('EN REVISIÓN', n('EN_REVISION'), 'bg-sky-100 text-sky-700') +
            pill('SOLUCIONADO', n('SOLUCIONADO'), 'bg-emerald-100 text-emerald-700');
    }

    function pintar() {
        const q = norm(txtFiltro.value);
        const est = selEstado.value;
        const visibles = tickets.filter(t => {
            const okEst = !est || t.estado === est;
            const okTexto = !q || norm([t.cliente_nombre, t.tipo_jugada, t.hipodromo, t.motivo, t.respuesta_casa].join(' ')).includes(q);
            return okEst && okTexto;
        });

        if (!visibles.length) {
            cuerpo.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-500 italic">Sin tickets que coincidan.</td></tr>';
            return;
        }

        cuerpo.innerHTML = visibles.map(t => {
            const fecha = t.created_at ? new Date(t.created_at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const badge = BADGES[t.estado] || 'bg-slate-100 text-slate-500';
            return `
                <tr class="hover:bg-sky-50">
                    <td class="p-3 font-mono font-bold text-sky-700">#${t.numero_ticket}</td>
                    <td class="p-3 text-slate-500">${fecha}</td>
                    <td class="p-3 font-bold text-slate-700">${esc(t.cliente_nombre || '—')}</td>
                    <td class="p-3">${esc(t.tipo_jugada || 'Jugada')}${t.hipodromo ? `<span class="block text-[9px] font-normal text-slate-400">${esc(t.hipodromo)}${t.carrera ? ' · C' + t.carrera : ''}</span>` : ''}</td>
                    <td class="p-3 max-w-[220px]"><span class="block truncate" title="${esc(t.motivo)}">${esc(t.motivo) || '—'}</span></td>
                    <td class="p-3 text-right font-mono font-bold">$ ${clubUI.formatoNumero(parseFloat(t.monto || 0), 2)}</td>
                    <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[9px] font-black ${badge}">${t.estado}</span></td>
                    <td class="p-3 text-center">
                        <button data-ver-ticket="${t.id}" class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white text-[9px] font-black uppercase tracking-wider">
                            <i class="fas fa-eye mr-1"></i> ${t.estado === 'SOLUCIONADO' ? 'Ver' : 'Responder'}
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    async function cargarTickets() {
        const { data, error } = await window.supabase
            .from('tickets_jugadas')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(300);
        if (error) {
            cuerpo.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-red-500 italic">Error: ' +
                (error.message || error.code) + '<br><span class="text-[10px]">¿Ejecutó el paquete SQL completo (sección 13: tickets_jugadas)?</span></td></tr>';
            return;
        }
        tickets = data || [];
        pintarContadores();
        pintar();
    }

    txtFiltro.addEventListener('input', pintar);
    selEstado.addEventListener('change', pintar);
    document.getElementById('btnRecargarTickets').addEventListener('click', cargarTickets);

    // ==========================================
    // MODAL DETALLE / RESPUESTA
    // ==========================================
    const modal = document.getElementById('modalTicket');
    const btnCerrar = document.getElementById('btnCerrarModalTicket');
    const ticketActual = { id: null };

    const cerrar = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); ticketActual.id = null; };
    btnCerrar.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) cerrar(); });

    function abrir(ident) {
        const t = tickets.find(x => x.id === ident);
        if (!t) return;
        ticketActual.id = t.id;

        document.getElementById('ticketNumero').textContent = '#' + t.numero_ticket;
        const mon = `$ ${clubUI.formatoNumero(parseFloat(t.monto || 0), 2)}`;
        const premio = t.premio_recalculado != null ? `$ ${clubUI.formatoNumero(parseFloat(t.premio_recalculado), 2)}` : '—';
        const campo = (lbl, val) => `<div class="bg-slate-50 border border-slate-100 rounded-lg p-2.5"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-wider">${lbl}</span><span class="text-xs font-bold text-slate-700">${val || '—'}</span></div>`;
        const estadoTxt = `<span class="px-2 py-0.5 rounded text-[9px] font-black ${BADGES[t.estado] || 'bg-slate-100 text-slate-500'}">${t.estado}</span>`;

        document.getElementById('ticketDatos').innerHTML =
            campo('Cliente', esc(t.cliente_nombre)) +
            campo('Jugada', esc((t.tipo_jugada || '—') + (t.hipodromo ? ' · ' + t.hipodromo + (t.carrera ? ' C' + t.carrera : '') : ''))) +
            campo('Fecha de jugada', t.fecha_jugada || t.created_at) +
            campo('Estado', estadoTxt) +
            campo('Motivo', esc(t.motivo)) +
            campo('Monto jugado', mon) +
            campo('Premio recalculado', premio) +
            campo('Creado', t.creado_por ? `Por ${t.creado_por}` : '—') +
            campo('Pendiente de evaluar', t.estado === 'SOLUCIONADO' ? (t.encuesta_satisfaccion ? `${t.encuesta_satisfaccion}/5${t.encuesta_comentario ? ' · ' + t.encuesta_comentario : ''}` : 'Sí (esperando al cliente)') : '—');

        const imgWrap = document.getElementById('ticketImagenWrap');
        if (t.imagen_soporte) {
            document.getElementById('ticketImagen').src = t.imagen_soporte;
            imgWrap.classList.remove('hidden');
        } else {
            imgWrap.classList.add('hidden');
            document.getElementById('ticketImagen').removeAttribute('src');
        }

        const sol = document.getElementById('ticketRespuestaSolucionada');
        const form = document.getElementById('ticketFormulario');
        if (t.estado === 'SOLUCIONADO') {
            sol.innerHTML = `
                <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-1">
                    <p class="font-black text-emerald-800 uppercase text-[10px]"><i class="fas fa-check-circle mr-1"></i> Resolución</p>
                    <p class="text-slate-700"><span class="font-bold text-slate-500">Acción:</span> ${t.accion_aplicada || '—'}${t.monto_resuelto != null ? ` · <span class="font-mono">$ ${clubUI.formatoNumero(parseFloat(t.monto_resuelto), 2)}</span>` : ''}</p>
                    <p class="text-slate-700"><span class="font-bold text-slate-500">Respuesta:</span> ${t.respuesta_casa || '—'}</p>
                    ${t.respondido_por ? `<p class="text-slate-400">Respondido por ${t.respondido_por} el ${t.respondido_at ? new Date(t.respondido_at).toLocaleString('es-VE') : ''}</p>` : ''}
                </div>`;
            sol.classList.remove('hidden');
            form.classList.add('hidden');
        } else {
            sol.classList.add('hidden');
            form.classList.remove('hidden');
            document.getElementById('respuestaAccion').value = t.accion_aplicada || '';
            document.getElementById('respuestaMonto').value = t.monto_resuelto != null ? t.monto_resuelto : '';
            document.getElementById('respuestaTexto').value = t.respuesta_casa || '';
        }
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    cuerpo.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ver-ticket]');
        if (btn) abrir(btn.dataset.verTicket);
    });

    async function actualizarEstado(id, estado, extra = {}) {
        const { error } = await window.supabase.from('tickets_jugadas')
            .update({ estado, updated_at: new Date().toISOString(), ...extra })
            .eq('id', id);
        if (error) return clubUI.toast('Error: ' + (error.message || error.code), 'error');
        cargarTickets();
        if (!modal.classList.contains('hidden')) abrir(id);
        return true;
    }

    document.getElementById('btnPasarRevision').addEventListener('click', async () => {
        if (!ticketActual.id) return;
        const ok = await actualizarEstado(ticketActual.id, 'EN_REVISION');
        if (ok) clubUI.toast('Ticket pasado a EN REVISIÓN.', 'success');
    });

    document.getElementById('btnRegresarCreado').addEventListener('click', async () => {
        if (!ticketActual.id) return;
        const ok = await actualizarEstado(ticketActual.id, 'CREADO');
        if (ok) clubUI.toast('Ticket devuelto a CREADO.', 'success');
    });

    document.getElementById('btnSolucionarTicket').addEventListener('click', async () => {
        if (!ticketActual.id) return;
        const accion = document.getElementById('respuestaAccion').value;
        const texto = document.getElementById('respuestaTexto').value.trim();
        const montoRaw = document.getElementById('respuestaMonto').value;

        if (!accion) return clubUI.toast('Seleccione la acción aplicada.', 'warning');
        if (!texto) return clubUI.toast('Escriba la respuesta para el cliente.', 'warning');
        if (['ABONO', 'REEMBOLSO', 'AJUSTE'].includes(accion) && !montoRaw) {
            return clubUI.toast('Indique el monto resuelto (puede ser 0.00).', 'warning');
        }

        const btn = document.getElementById('btnSolucionarTicket');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Solucionando...';

        const { error } = await window.supabase.from('tickets_jugadas')
            .update({
                estado: 'SOLUCIONADO',
                respuesta_casa: texto,
                accion_aplicada: accion,
                monto_resuelto: montoRaw !== '' ? parseFloat(montoRaw) : null,
                respondido_por: sesion ? sesion.nombre : 'desconocido',
                respondido_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', ticketActual.id);

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Marcar como SOLUCIONADO';

        if (error) return clubUI.toast('Error al solucionar: ' + (error.message || error.code), 'error');

        if (window.clubDB && window.clubDB.logAccion) {
            window.clubDB.logAccion('TICKETS', `Ticket #${ticketActual.id}: ${accion} (${texto.slice(0, 60)}) por ${sesion ? sesion.nombre : '?'}`);
        }
        clubUI.toast('Ticket solucionado. El cliente ya puede ver la respuesta por el portal.', 'success');

        const tAnt = tickets.find(x => x.id === ticketActual.id);
        if (['ABONO', 'REEMBOLSO', 'AJUSTE'].includes(accion) && tAnt && tAnt.cliente_id) {
            const montoRes = montoRaw !== '' ? parseFloat(montoRaw) : 0;
            if (montoRes > 0) {
                const { data: cl } = await window.supabase.from('clientes').select('saldo_actual').eq('id', tAnt.cliente_id).maybeSingle();
                if (cl) {
                    await window.supabase.from('clientes').update({
                        saldo_actual: (parseFloat(cl.saldo_actual) || 0) + montoRes
                    }).eq('id', tAnt.cliente_id);
                }
            }
        }

        cargarTickets();
        if (!modal.classList.contains('hidden')) abrir(ticketActual.id);
    });

    cargarTickets();
});