// Archivo: js/whatsapp.js
// Propósito: Centro de notificaciones WhatsApp: reporte general (editable), envío
// individual con plantillas dinámicas editables, editor de mensajes de la plataforma
// (persistencia local) y registro del historial en notificaciones (tipo 'whatsapp').

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // MENSAJES DE LA PLATAFORMA (editables)
    //   Persistencia: localStorage (por ahora solo
    //   se aplican aquí; el resto queda listo para
    //   conectar a Caja / Ventas de Tablas / Tablas).
    // ==========================================
    const CLAVE_MSJ = 'club_mensajes_whatsapp';

    const MENSAJES_DEFAULT = {
        saldo: {
            grupo: 'Plantillas del Centro WhatsApp',
            label: 'Saldo actual',
            variables: '{nombre} {saldo} {aval} {club}',
            txt: 'Hola {nombre} 👋\n\n*{club}*\n\nTu saldo actual es:\n💰 *$ {saldo} USD*\n\nAval vigente: $ {aval}\n\n¡Gracias por tu confianza!'
        },
        aval: {
            grupo: 'Plantillas del Centro WhatsApp',
            label: 'Recordatorio de aval',
            variables: '{nombre} {aval} {club}',
            txt: 'Hola {nombre} ⚠️\n\n*{club}*\n\nTe recordamos que tienes un aval pendiente de *$ {aval} USD*.\n\nPara mantener tu cuenta al día, pasa por taquilla o coordina tu abono. ¡Gracias!'
        },
        bienvenida: {
            grupo: 'Plantillas del Centro WhatsApp',
            label: 'Bienvenida',
            variables: '{nombre} {saldo}',
            txt: '¡Hola {nombre}! 🎉\n\nBienvenido(a) al *Club del Dinero*.\nTu cuenta queda activa con un saldo de *$ {saldo} USD*.\n\n¡Éxitos y buenas jugadas! 🏇'
        },
        negativo: {
            grupo: 'Plantillas del Centro WhatsApp',
            label: 'Saldo pendiente por abonar',
            variables: '{nombre} {saldo} {club}',
            txt: 'Hola {nombre} 🙏\n\n*{club}*\n\nTu cuenta presenta un saldo pendiente de *$ {saldo} USD*.\nTe pedimos abonar para continuar disfrutando del servicio.\n\n¡Gracias!'
        },
        personalizada: {
            grupo: 'Plantillas del Centro WhatsApp',
            label: 'Mensaje personalizado',
            variables: '{nombre}',
            txt: 'Hola {nombre} 👋\n\n'
        },
        reporte_general: {
            grupo: 'Reportes de saldos',
            label: 'Reporte general (Centro WhatsApp)',
            variables: '{fecha} {club} {lineas} {balance}',
            txt: '📊 *REPORTE DE SALDOS - {club}*\n📅 Fecha: {fecha}\n\n{lineas}💰 *BALANCE GLOBAL (A favor de los clientes):* $ {balance}'
        },
        reporte_caja: {
            grupo: 'Reportes de saldos',
            label: 'Reporte de saldos (Caja)',
            variables: '{fecha} {club} {lineas} {balance}',
            txt: '📊 *REPORTE DE SALDOS - {club}*\n📅 Fecha: {fecha}\n\n{lineas}💰 *BALANCE GLOBAL (A favor de los clientes):* $ {balance}'
        },
        resumen_ventas: {
            grupo: 'Ventas y recibos',
            label: 'Resumen de ventas del día',
            variables: '{fecha} {lineas} {total}',
            txt: '🐎 *VENTA DE TABLAS FIJAS*\n📅 {fecha}\n\n{lineas}✅ *Total: {total}*'
        },
        recibo_venta: {
            grupo: 'Ventas y recibos',
            label: 'Recibo de venta de tablas',
            variables: '{cliente} {carrera} {tickets} {lineas_cliente} {total} {premio} {fecha} {folio}',
            txt: '🎫 *RECIBO DE VENTA — TABLA FIJA*\n🧑 *Jugador(es):* {cliente}\n🏇 *Carrera:* {carrera}\n\n{tickets}\n👥 *Totales por cliente:*\n{lineas_cliente}\n✅ *Total Pagado:* {total}\n🏆 *Premio si gana:* {premio}\n\n📅 {fecha}\nFolio: {folio}'
        }
    };

    function cargarMensajes() {
        let guardados = {};
        try { guardados = JSON.parse(localStorage.getItem(CLAVE_MSJ) || '{}'); } catch (e) { guardados = {}; }
        const m = {};
        Object.entries(MENSAJES_DEFAULT).forEach(([k, v]) => {
            m[k] = { ...v, txt: (guardados[k] && typeof guardados[k].txt === 'string') ? guardados[k].txt : v.txt };
        });
        return m;
    }

    let MENSAJES = cargarMensajes();

    // Las plantillas del envío individual son referencias vivas a MENSAJES:
    // si el usuario edita el texto, el cambio se aplica de inmediato.
    const PLANTILLAS = {
        saldo: MENSAJES.saldo,
        aval: MENSAJES.aval,
        bienvenida: MENSAJES.bienvenida,
        negativo: MENSAJES.negativo,
        personalizada: MENSAJES.personalizada
    };

    function persistirMensajes() {
        const pers = {};
        Object.keys(MENSAJES).forEach(k => { pers[k] = { txt: MENSAJES[k].txt }; });
        localStorage.setItem(CLAVE_MSJ, JSON.stringify(pers));
    }

    const CLUB = 'Club del Dinero';
    const el = id => document.getElementById(id);

    const selectCliente = el('wspCliente');
    const selectPais = el('wspCodigoPais');
    const inputTel = el('wspTelefono');
    const avisoTel = el('wspAvisoTel');
    const selectPlantilla = el('wspPlantilla');
    const areaMensaje = el('wspMensaje');
    const divPreview = el('wspPreview');
    const areaReporte = el('textoReporte');
    const cuerpoHistorial = document.getElementById('tablaHistorialWsp');

    let clientes = [];
    let clienteSel = null;

    // ==========================================
    // UTILIDADES
    // ==========================================
    const fechaHoy = () => new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const reemplazarVars = (txt, c) => txt
        .replace(/\{nombre\}/g, c ? c.nombre : '—')
        .replace(/\{saldo\}/g, clubUI.formatoNumero(c ? Number(c.saldo_actual) : 0, 2))
        .replace(/\{aval\}/g, clubUI.formatoNumero(c ? Number(c.aval) : 0, 2))
        .replace(/\{fecha\}/g, fechaHoy())
        .replace(/\{club\}/g, CLUB);

    const telefonoInt = () => {
        const codigo = selectPais.value.replace(/[^\d]/g, '');
        const numero = inputTel.value.replace(/[^\d]/g, '');
        return codigo + numero;
    };

    const forzarPlantilla = (tipo, c) => {
        const plantilla = PLANTILLAS[tipo];
        if (!plantilla) return;
        if (tipo === 'personalizada') {
            areaMensaje.value = plantilla.txt;
            areaMensaje.focus();
        } else {
            areaMensaje.value = plantilla.txt;
        }
        actualizarPreview(c);
    };

    const actualizarPreview = (c) => {
        divPreview.textContent = reemplazarVars(areaMensaje.value || '…', c);
    };

    // ==========================================
    // REPORTE GENERAL DE SALDOS
    // ==========================================
    function generarReporte() {
        const t = MENSAJES.reporte_general.txt;
        let lineas = '';
        let totalCaja = 0, conSaldo = 0;
        clientes.forEach(c => {
            const s = Number(c.saldo_actual);
            if (s !== 0) {
                const icono = s > 0 ? '🟢' : '🔴';
                lineas += `${icono} *${c.nombre}:* $${clubUI.formatoNumero(s, 2)}\n`;
                totalCaja += s; conSaldo++;
            }
        });

        if (conSaldo === 0) lineas += 'Sin movimientos pendientes. ✅\n';

        return t
            .replace(/\{fecha\}/g, fechaHoy())
            .replace(/\{club\}/g, CLUB)
            .replace(/\{lineas\}/g, lineas)
            .replace(/\{balance\}/g, clubUI.formatoNumero(totalCaja, 2));
    }

    async function refrescarReporte() {
        areaReporte.value = generarReporte();
        clubUI.toast('Reporte general actualizado.');
    }

    // ==========================================
    // ENVÍO INDIVIDUAL
    // ==========================================
    async function cargarClientes() {
        const { data, error } = await window.supabase
            .from('clientes')
            .select('id, nombre, saldo_actual, aval, telefono, codigo_pais')
            .order('nombre');

        if (error) return clubUI.toast('No se pudo cargar clientes: ' + error.message, 'error');

        clientes = data || [];
        const opc = clientes.map(c => {
            const tel = c.telefono ? ' · ' + c.telefono : ' · sin tel';
            return `<option value="${c.id}">${c.nombre} ($${clubUI.formatoNumero(Number(c.saldo_actual), 2)} ${tel})</option>`;
        }).join('');

        selectCliente.innerHTML = '<option value="">— Selecciona un cliente —</option>' + opc;
        selectPais.innerHTML = clubUI.htmlOpcionesCodigoPais();

        if (clientes.length === 1) {
            selectCliente.value = clientes[0].id;
            seleccionarCliente(clientes[0]);
        }
        renderResumen();
        cargarHistorial();
    }

    function seleccionarCliente(c) {
        if (!c) return;
        clienteSel = c;
        const tel = clubUI.desglosarTelefono(c.telefono);
        selectPais.value = c.codigo_pais || tel.codigo || '+58';
        inputTel.value = tel.numero;
        avisoTel.classList.toggle('hidden', Boolean(c.telefono && tel.numero));
        forzarPlantilla(selectPlantilla.value, c);
    }

    selectCliente.addEventListener('change', () => {
        const c = clientes.find(x => x.id === selectCliente.value);
        seleccionarCliente(c);
    });

    selectPlantilla.addEventListener('change', () => forzarPlantilla(selectPlantilla.value, clienteSel));
    inputTel.addEventListener('input', () => actualizarPreview(clienteSel));
    areaMensaje.addEventListener('input', () => actualizarPreview(clienteSel));

    el('btnGuardarTelefono').addEventListener('click', async () => {
        if (!clienteSel) return clubUI.toast('Selecciona primero un cliente.', 'warning');
        const numero = inputTel.value.replace(/[^\d]/g, '');
        if (numero.length < 8) return clubUI.toast('Número de teléfono no válido.', 'warning');

        const telefono = clubUI.componerTelefono(selectPais.value, numero);
        const { error } = await window.supabase.from('clientes')
            .update({ telefono, codigo_pais: selectPais.value })
            .eq('id', clienteSel.id);

        if (error) return clubUI.toast('No se guardó: ' + error.message, 'error');

        clienteSel.telefono = telefono;
        clienteSel.codigo_pais = selectPais.value;
        avisoTel.classList.add('hidden');
        clubUI.toast('Teléfono actualizado para ' + clienteSel.nombre + '.');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('WHATSAPP', `telefono_guardado: ${clienteSel.nombre} ${telefono}`);
        renderResumen();
    });

    function registrarEnvio(tipo, tel, texto, c) {
        return window.supabase.from('notificaciones').insert([{
            tipo: 'whatsapp',
            titulo: 'WhatsApp · ' + tipo,
            mensaje: texto,
            cliente_id: c ? c.id : null,
            cliente_nombre: c ? c.nombre : 'GENERAL',
            datos: { telefono: tel, tipo },
            estado: 'Enviado'
        }]);
    }

    el('btnAbrirWsp').addEventListener('click', async () => {
        if (!clienteSel) return clubUI.toast('Selecciona un cliente.', 'warning');
        const tel = telefonoInt();
        if (tel.length < 10) return clubUI.toast('Teléfono WhatsApp no válido. Revisa el número.', 'warning');

        const texto = areaMensaje.value.trim();
        const final = reemplazarVars(texto, clienteSel);
        if (!final) return clubUI.toast('Escribe un mensaje para enviar.', 'warning');

        const url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(final);
        window.open(url, '_blank');

        const r = await registrarEnvio(PLANTILLAS[selectPlantilla.value].label, selectPais.value.replace(/[^\d]/g, '') + ' ' + inputTel.value.replace(/[^\d]/g, ''), final, clienteSel);
        if (r.error) console.warn('No se registró el envío:', r.error.message);

        clubUI.toast('WhatsApp abierto con el mensaje de ' + clienteSel.nombre + '.');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('WHATSAPP', `envio: ${clienteSel.nombre} · ${PLANTILLAS[selectPlantilla.value].label}`);
        cargarHistorial();
    });

    // ==========================================
    // REPORTE GENERAL (acciones)
    // ==========================================
    el('btnGenerarReporte').addEventListener('click', refrescarReporte);

    el('btnCopiarReporte').addEventListener('click', () => {
        areaReporte.select();
        document.execCommand('copy');
        clubUI.toast('Reporte copiado al portapapeles.');
    });

    el('btnAbrirReporte').addEventListener('click', async () => {
        const texto = areaReporte.value.trim();
        if (!texto) return clubUI.toast('Genera primero el reporte.', 'warning');

        window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');

        const r = await registrarEnvio('Reporte general', '—', texto, null);
        if (r.error) console.warn('No se registró el envío:', r.error.message);

        clubUI.toast('WhatsApp abierto con el reporte general.');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('WHATSAPP', 'envio: reporte general');
        cargarHistorial();
    });

    // ==========================================
    // HISTORIAL DE ENVÍOS
    // ==========================================
    function leerDatos(n) {
        try { return (typeof n === 'object' && n) ? n : JSON.parse(n || '{}'); }
        catch (e) { return {}; }
    }

    function badgeEstado(e) {
        return '<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black text-[10px] uppercase">' + e + '</span>';
    }

    async function cargarHistorial() {
        const { data, error } = await window.supabase
            .from('notificaciones')
            .select('*')
            .eq('tipo', 'whatsapp')
            .order('created_at', { ascending: false })
            .limit(60);

        if (error) {
            cuerpoHistorial.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-red-400 italic">No se pudo cargar el historial: ' + error.message + '</td></tr>';
            return;
        }

        if (!data || data.length === 0) {
            cuerpoHistorial.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Aún no hay envíos registrados. ¡Usa el centro para hacer tu primer envío!</td></tr>';
            renderResumen();
            return;
        }

        cuerpoHistorial.innerHTML = data.map(n => {
            const fecha = n.created_at || n.fecha ? new Date(n.created_at || n.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
            const dp = leerDatos(n.datos);
            const tel = dp.telefono || '—';
            return `<tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="p-2.5 text-slate-500 whitespace-nowrap">${fecha}</td>
                <td class="p-2.5 font-bold text-slate-800">${n.cliente_nombre || '—'}</td>
                <td class="p-2.5"><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase">${n.titulo || dp.tipo || '—'}</span></td>
                <td class="p-2.5 font-mono text-slate-600">${tel}</td>
                <td class="p-2.5 text-slate-600 max-w-xs"><span class="block truncate" title="${String(n.mensaje || '').replace(/"/g, '&quot;')}">${String(n.mensaje || '').slice(0, 90)}${(n.mensaje || '').length > 90 ? '…' : ''}</span></td>
                <td class="p-2.5 text-center">${badgeEstado(n.estado || 'Enviado')}</td>
            </tr>`;
        }).join('');

        renderResumen();
    }

    // ==========================================
    // RESUMEN SUPERIOR
    // ==========================================
    function renderResumen() {
        const conTel = clientes.filter(c => c.telefono && clubUI.desglosarTelefono(c.telefono).numero).length;
        const sinTel = clientes.length - conTel;
        el('resumenWsp').innerHTML = `
            <div class="bg-emerald-600 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${clubUI.formatoNumero(conTel, 0)}</p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-emerald-200">Clientes con teléfono</p>
            </div>
            <div class="bg-amber-500 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black">${clubUI.formatoNumero(sinTel, 0)}</p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-amber-100">Sin teléfono registrado</p>
            </div>
            <div class="bg-slate-800 text-white rounded-xl p-4 shadow">
                <p class="text-2xl font-black"><span id="conteoEnvios">…</span></p>
                <p class="text-[10px] uppercase tracking-widest font-bold text-slate-300">Envíos registrados</p>
            </div>`;

        window.supabase.from('notificaciones').select('id', { count: 'exact', head: true }).eq('tipo', 'whatsapp')
            .then(({ count }) => { el('conteoEnvios').textContent = clubUI.formatoNumero(count || 0, 0); });
    }

    // ==========================================
    // EDITOR DE MENSAJES DE LA PLATAFORMA
    // ==========================================
    const selectMsj = el('msjMensaje');
    const areaMsj = el('msjTexto');
    const avisoMsj = el('msjVars');

    function poblarSelectMensajes() {
        const grupos = [...new Set(Object.values(MENSAJES_DEFAULT).map(v => v.grupo))];
        selectMsj.innerHTML = grupos.map(grp => {
            const opts = Object.entries(MENSAJES_DEFAULT)
                .filter(([, v]) => v.grupo === grp)
                .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
            return `<optgroup label="${grp}">${opts}</optgroup>`;
        }).join('');
        selectMsj.value = 'saldo';
    }

    function mostrarMensajeSeleccionado() {
        const m = MENSAJES[selectMsj.value];
        if (!m) return;
        areaMsj.value = m.txt;
        avisoMsj.textContent = 'Variables disponibles: ' + m.variables;
    }

    function guardarMensajeActual() {
        const k = selectMsj.value;
        if (!k) return clubUI.toast('Selecciona un mensaje.', 'warning');
        MENSAJES[k].txt = areaMsj.value;
        persistirMensajes();
        actualizarPreview(clienteSel);
        clubUI.toast('Mensaje guardado: ' + MENSAJES[k].label + '.');
        if (window.clubDB?.logAccion) window.clubDB.logAccion('WHATSAPP', 'mensaje_editado: ' + k);
    }

    function restaurarMensajeActual() {
        const k = selectMsj.value;
        if (!k || !MENSAJES_DEFAULT[k]) return;
        MENSAJES[k].txt = MENSAJES_DEFAULT[k].txt;
        persistirMensajes();
        mostrarMensajeSeleccionado();
        actualizarPreview(clienteSel);
        clubUI.toast('Mensaje restaurado al texto original.', 'info');
    }

    function restaurarTodosMensajes() {
        Object.keys(MENSAJES_DEFAULT).forEach(k => { MENSAJES[k].txt = MENSAJES_DEFAULT[k].txt; });
        persistirMensajes();
        mostrarMensajeSeleccionado();
        actualizarPreview(clienteSel);
        clubUI.toast('Todos los mensajes restaurados.', 'info');
    }

    selectMsj.addEventListener('change', mostrarMensajeSeleccionado);
    el('btnGuardarMensaje').addEventListener('click', guardarMensajeActual);
    el('btnRestaurarMensaje').addEventListener('click', restaurarMensajeActual);
    el('btnRestaurarMensajes').addEventListener('click', () => {
        if (typeof clubUI.aviso === 'function') {
            return clubUI.aviso('Restaurar mensajes', '¿Restaurar todos los mensajes WhatsApp a su texto original?', 'warning', restaurarTodosMensajes);
        }
        restaurarTodosMensajes();
    });
    el('btnCopiarMensaje').addEventListener('click', () => {
        areaMsj.select();
        document.execCommand('copy');
        clubUI.toast('Texto copiado al portapapeles.');
    });

    // ==========================================
    // ARRANQUE
    // ==========================================
    el('fechaHeaderWsp').textContent = new Date().toLocaleString('es-ES');
    selectPlantilla.innerHTML = Object.entries(PLANTILLAS)
        .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    selectPlantilla.value = 'saldo';
    poblarSelectMensajes();
    mostrarMensajeSeleccionado();

    el('btnRefrescarHistorial').addEventListener('click', cargarHistorial);
    cargarClientes();
});