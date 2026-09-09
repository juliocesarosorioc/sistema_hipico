document.addEventListener('DOMContentLoaded', () => {

    const contenedorCaballos = document.getElementById('contenedorCaballos');
    const btnAgregarCaballo = document.getElementById('btnAgregarCaballo');
    const lblTotalIncidencia = document.getElementById('totalIncidencia');
    const btnGuardarTabla = document.getElementById('btnGuardarTabla');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    
    // ==========================================
    // 1. CONSTRUCTOR DINÁMICO DE CABALLOS
    // ==========================================
    function crearFilaCaballo() {
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-center fila-caballo-config';
        div.innerHTML = `
            <input type="text" class="input-tbl w-16 text-center in-num-cab font-bold" placeholder="N°">
            <input type="text" class="input-tbl flex-1 in-nom-cab" placeholder="Nombre del Caballo">
            <div class="relative w-24">
                <input type="number" class="input-tbl w-full text-center text-red-700 font-bold in-incidencia pr-6" placeholder="%">
                <span class="absolute right-2 top-1.5 text-xs text-slate-400 font-bold">%</span>
            </div>
            <button type="button" class="text-red-400 hover:text-red-600 px-1 btn-quitar-cab"><i class="fas fa-trash-alt"></i></button>
        `;
        
        contenedorCaballos.appendChild(div);

        // Eventos
        div.querySelector('.btn-quitar-cab').addEventListener('click', () => {
            div.remove();
            calcularIncidenciaTotal();
        });
        div.querySelector('.in-incidencia').addEventListener('input', calcularIncidenciaTotal);
    }

    function calcularIncidenciaTotal() {
        let total = 0;
        document.querySelectorAll('.in-incidencia').forEach(input => {
            const val = parseFloat(input.value) || 0;
            total += val;
        });
        lblTotalIncidencia.textContent = total.toFixed(1);
        lblTotalIncidencia.className = total === 100 ? 'text-emerald-600' : 'text-red-500';
    }

    btnAgregarCaballo.addEventListener('click', crearFilaCaballo);
    
    // Iniciar con 2 caballos mínimos
    crearFilaCaballo();
    crearFilaCaballo();

    // ==========================================
    // 2. REGISTRO EN BASE DE DATOS
    // ==========================================
    btnGuardarTabla.addEventListener('click', async () => {
        const hipodromo = document.getElementById('hipodromoTabla').value.trim().toUpperCase();
        const carrera = parseInt(document.getElementById('carreraTabla').value);
        const monto = parseFloat(document.getElementById('montoTabla').value);
        const premio = parseFloat(document.getElementById('premioTabla').value);

        if (!hipodromo || isNaN(carrera) || isNaN(monto) || isNaN(premio)) {
            return alert("Complete Hipódromo, Carrera, Valor y Premio.");
        }

        const sumaIncidencia = parseFloat(lblTotalIncidencia.textContent);
        if (sumaIncidencia !== 100) {
            return alert("El peso de incidencia de los caballos debe sumar exactamente 100%. Actualmente suma: " + sumaIncidencia + "%");
        }

        let caballosArr = [];
        let errorCaballos = false;
        
        document.querySelectorAll('.fila-caballo-config').forEach(fila => {
            const num = fila.querySelector('.in-num-cab').value.trim();
            const nom = fila.querySelector('.in-nom-cab').value.trim().toUpperCase();
            const inc = parseFloat(fila.querySelector('.in-incidencia').value);

            if (!num || !nom || isNaN(inc)) errorCaballos = true;
            caballosArr.push({ numero: num, nombre: nom, incidencia_porcentaje: inc, retirado: false });
        });

        if (errorCaballos || caballosArr.length < 2) return alert("Revise la lista de caballos. Faltan datos o hay menos de 2.");

        const btnOrig = btnGuardarTabla.innerHTML;
        btnGuardarTabla.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        btnGuardarTabla.disabled = true;

        const { error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, carrera,
            monto_tabla: monto, premio_original: premio, premio_recalculado: premio,
            caballos: caballosArr, estado: 'Abierta'
        }]);

        if (error) {
            alert("Error al guardar la tabla.");
            console.error(error);
        } else {
            // Limpiar form
            document.getElementById('montoTabla').value = '';
            document.getElementById('premioTabla').value = '';
            contenedorCaballos.innerHTML = '';
            crearFilaCaballo(); crearFilaCaballo();
            calcularIncidenciaTotal();
            cargarTablas();
        }

        btnGuardarTabla.innerHTML = btnOrig;
        btnGuardarTabla.disabled = false;
    });

    // ==========================================
    // 3. MONITOR Y MOTOR DE AUDITORÍA
    // ==========================================
    async function cargarTablas() {
        const { data, error } = await window.supabase.from('tablas_fijas')
            .select('*')
            .order('id', { ascending: false });

        if (error || !data) {
            tbodyMonitor.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar.</td></tr>';
            return;
        }

        tbodyMonitor.innerHTML = '';
        data.forEach(t => {
            let caballosHTML = t.caballos.map(c => 
                `<span class="${c.retirado ? 'line-through text-red-500' : 'text-slate-700'}">${c.numero}-${c.nombre} <span class="text-[9px] text-slate-400">(${c.incidencia_porcentaje}%)</span></span>`
            ).join(', ');

            let badgeEstado = '';
            if (t.estado === 'Abierta') badgeEstado = '<span class="bg-green-100 text-green-700 px-2 rounded text-[10px] font-bold">ABIERTA</span>';
            else if (t.estado === 'Auditada') badgeEstado = '<span class="bg-blue-100 text-blue-700 px-2 rounded text-[10px] font-bold">AUDITADA</span>';
            
            // Botón de auditoría (solo si no está auditada aún para simplificar el flujo)
            let btnAccion = t.estado === 'Abierta' 
                ? `<button class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded shadow text-[10px] font-bold hover:bg-amber-500" data-id="${t.id}" data-premio="${t.premio_original}" data-caballos='${JSON.stringify(t.caballos)}'><i class="fas fa-balance-scale"></i> Auditar Retiros</button>`
                : `<span class="text-[10px] text-slate-400 font-bold"><i class="fas fa-check-double text-blue-500"></i> Listo</span>`;

            tbodyMonitor.innerHTML += `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="p-2 border-b border-slate-100 font-bold text-slate-800">${t.hipodromo} <br><span class="text-blue-600">C${t.carrera}</span></td>
                    <td class="p-2 border-b border-slate-100 text-[10px] leading-tight">${caballosHTML}</td>
                    <td class="p-2 border-b border-slate-100 text-right font-bold text-slate-600">$${parseFloat(t.monto_tabla).toFixed(2)}</td>
                    <td class="p-2 border-b border-slate-100 text-right font-bold text-blue-700">$${parseFloat(t.premio_recalculado).toFixed(2)}</td>
                    <td class="p-2 border-b border-slate-100 text-center">${badgeEstado}</td>
                    <td class="p-2 border-b border-slate-100 text-center">${btnAccion}</td>
                </tr>
            `;
        });

        // Asignar eventos de Auditoría
        document.querySelectorAll('.btn-auditar').forEach(btn => {
            btn.addEventListener('click', function() {
                abrirModalAuditoria(this.dataset.id, this.dataset.premio, JSON.parse(this.dataset.caballos));
            });
        });
    }

    // LÓGICA MATEMÁTICA DEL MODAL
    const modalAuditoria = document.getElementById('modalAuditoria');
    let caballosModalTemp = [];
    let premioOrigTemp = 0;

    function abrirModalAuditoria(id, premioOrig, caballosJSON) {
        document.getElementById('auditoriaTablaId').value = id;
        premioOrigTemp = parseFloat(premioOrig);
        document.getElementById('lblPremioOrig').textContent = '$' + premioOrigTemp.toFixed(2);
        
        caballosModalTemp = caballosJSON;
        const contenedor = document.getElementById('listaCaballosAuditoria');
        contenedor.innerHTML = '';

        caballosModalTemp.forEach((c, index) => {
            contenedor.innerHTML += `
                <label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer hover:bg-red-50">
                    <input type="checkbox" class="chk-retiro" data-index="${index}" data-incidencia="${c.incidencia_porcentaje}">
                    <span class="font-bold text-slate-700">${c.numero} - ${c.nombre}</span>
                    <span class="ml-auto text-xs text-red-500 font-bold bg-red-100 px-2 rounded">-${c.incidencia_porcentaje}%</span>
                </label>
            `;
        });

        actualizarCalculoModal();
        
        document.querySelectorAll('.chk-retiro').forEach(chk => {
            chk.addEventListener('change', actualizarCalculoModal);
        });

        modalAuditoria.classList.remove('hidden');
    }

    function actualizarCalculoModal() {
        let porcentajeDeducir = 0;
        document.querySelectorAll('.chk-retiro:checked').forEach(chk => {
            porcentajeDeducir += parseFloat(chk.dataset.incidencia);
        });

        // Fórmula: Premio Original * (1 - (PorcentajeRetirado / 100))
        const multiplicador = 1 - (porcentajeDeducir / 100);
        const nuevoPremio = premioOrigTemp * multiplicador;
        
        document.getElementById('lblPremioRecalculado').textContent = '$' + nuevoPremio.toFixed(2);
    }

    document.getElementById('btnProcesarAuditoria').addEventListener('click', async () => {
        const idTabla = document.getElementById('auditoriaTablaId').value;
        const nuevoPremio = parseFloat(document.getElementById('lblPremioRecalculado').textContent.replace('$', ''));
        
        // Actualizar el JSON de caballos marcando los retirados
        let nombresRetirados = [];
        document.querySelectorAll('.chk-retiro').forEach(chk => {
            const index = chk.dataset.index;
            if (chk.checked) {
                caballosModalTemp[index].retirado = true;
                nombresRetirados.push(caballosModalTemp[index].numero);
            } else {
                caballosModalTemp[index].retirado = false;
            }
        });

        const strRetirados = nombresRetirados.length > 0 ? nombresRetirados.join(', ') : 'Ninguno';

        const { error } = await window.supabase.from('tablas_fijas').update({
            premio_recalculado: nuevoPremio,
            caballos: caballosModalTemp,
            estado: 'Auditada',
            retirados_oficiales: strRetirados
        }).eq('id', idTabla);

        if (error) {
            alert('Error en base de datos al auditar.');
        } else {
            modalAuditoria.classList.add('hidden');
            cargarTablas();
        }
    });

    document.querySelectorAll('.cerrar-modal').forEach(btn => {
        btn.addEventListener('click', () => modalAuditoria.classList.add('hidden'));
    });

    document.getElementById('btnRecargarTablas').addEventListener('click', cargarTablas);

    cargarTablas();
});