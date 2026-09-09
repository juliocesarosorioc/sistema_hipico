document.addEventListener('DOMContentLoaded', () => {

    const contenedorCaballos = document.getElementById('contenedorCaballos');
    const btnAgregarCaballo = document.getElementById('btnAgregarCaballo');
    const lblSumaBase = document.getElementById('totalSumaBase');
    const btnGuardarTabla = document.getElementById('btnGuardarTabla');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    
    let tasaCambioGlobal = 1.0;

    // Obtener la tasa global de conversión
    async function cargarTasaGlobal() {
        try {
            const { data, error } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (data && data.tasa_cambio) {
                tasaCambioGlobal = parseFloat(data.tasa_cambio);
                document.getElementById('lblTasaGlobal').textContent = tasaCambioGlobal.toLocaleString(undefined, {minimumFractionDigits: 2});
            } else {
                document.getElementById('lblTasaGlobal').textContent = '1.00';
            }
        } catch (e) {
            document.getElementById('lblTasaGlobal').textContent = '1.00';
        }
    }

    // ==========================================
    // 1. CONSTRUCTOR DE EJEMPLARES (PONDERACIÓN)
    // ==========================================
    function crearFilaCaballo(numSugerido = '', nomSugerido = '', valorSugerido = '') {
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-center fila-caballo-config';
        div.innerHTML = `
            <input type="text" class="input-tbl w-16 text-center in-num-cab font-bold" value="${numSugerido}" placeholder="N°">
            <input type="text" class="input-tbl flex-1 in-nom-cab" value="${nomSugerido}" placeholder="Nombre del Ejemplar">
            <input type="number" step="0.1" class="input-tbl w-24 text-center text-blue-700 font-bold in-valor-ej" value="${valorSugerido}" placeholder="Valor (Pts)">
            <button type="button" class="text-red-400 hover:text-red-600 px-1 btn-quitar-cab"><i class="fas fa-trash-alt"></i></button>
        `;
        
        contenedorCaballos.appendChild(div);

        div.querySelector('.btn-quitar-cab').addEventListener('click', () => {
            div.remove();
            calcularSumaBaseTotal();
        });
        div.querySelector('.in-valor-ej').addEventListener('input', calcularSumaBaseTotal);
    }

    function calcularSumaBaseTotal() {
        let suma = 0;
        document.querySelectorAll('.in-valor-ej').forEach(input => {
            suma += parseFloat(input.value) || 0;
        });
        lblSumaBase.textContent = suma.toFixed(1);
    }

    btnAgregarCaballo.addEventListener('click', () => crearFilaCaballo());
    
    // Iniciar con 3 ejemplares de prueba
    crearFilaCaballo('1', 'Ejemplar A', '50');
    crearFilaCaballo('2', 'Ejemplar B', '60');
    crearFilaCaballo('3', 'Ejemplar C', '50');
    calcularSumaBaseTotal();

    // ==========================================
    // 2. REGISTRO EN BASE DE DATOS
    // ==========================================
    btnGuardarTabla.addEventListener('click', async () => {
        const hipodromo = document.getElementById('hipodromoTabla').value.trim().toUpperCase();
        const carrera = parseInt(document.getElementById('carreraTabla').value);
        const grupo = document.getElementById('grupoTabla').value.trim().toUpperCase() || 'GENERAL';
        const moneda = document.getElementById('monedaTabla').value;
        const cantidadTablas = parseInt(document.getElementById('cantidadTablas').value) || 1;
        const comisionGrupo = parseFloat(document.getElementById('comisionTabla').value) || 0;
        const montoTabla = parseFloat(document.getElementById('montoTabla').value);
        const premioOriginal = parseFloat(document.getElementById('premioTabla').value);

        if (!hipodromo || isNaN(carrera) || isNaN(montoTabla) || isNaN(premioOriginal)) {
            return alert("Complete los campos obligatorios de la tabla (Hipódromo, Carrera, Costo, Premio).");
        }

        const sumaBaseTabla = parseFloat(lblSumaBase.textContent);
        if (sumaBaseTabla <= 0) {
            return alert("La suma base de los ejemplares (Ponderación) no puede ser cero.");
        }

        let caballosArr = [];
        let errorCaballos = false;
        
        document.querySelectorAll('.fila-caballo-config').forEach(fila => {
            const numero = fila.querySelector('.in-num-cab').value.trim();
            const nombre = fila.querySelector('.in-nom-cab').value.trim().toUpperCase();
            const valor = parseFloat(fila.querySelector('.in-valor-ej').value);

            if (!numero || !nombre || isNaN(valor)) errorCaballos = true;
            caballosArr.push({ numero, nombre, valor_ejemplar: valor, retirado: false });
        });

        if (errorCaballos || caballosArr.length < 2) return alert("Revise los ejemplares. Faltan datos o hay menos de 2 ejemplares.");

        const btnOrigText = btnGuardarTabla.innerHTML;
        btnGuardarTabla.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        btnGuardarTabla.disabled = true;

        const { error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, 
            carrera,
            grupo_venta: grupo,
            moneda,
            tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla,
            cantidad_tablas: cantidadTablas,
            monto_tabla: montoTabla,
            premio_original: premioOriginal,
            premio_recalculado: premioOriginal, // Inicialmente paga el 100%
            comision_grupo: comisionGrupo,
            caballos: caballosArr,
            estado: 'Abierta'
        }]);

        if (error) {
            alert("Error al registrar la tabla en la base de datos.");
            console.error(error);
        } else {
            document.getElementById('montoTabla').value = '';
            contenedorCaballos.innerHTML = '';
            crearFilaCaballo('1', '', '');
            crearFilaCaballo('2', '', '');
            calcularSumaBaseTotal();
            cargarTablas();
        }

        btnGuardarTabla.innerHTML = btnOrigText;
        btnGuardarTabla.disabled = false;
    });

    // ==========================================
    // 3. MONITOR Y MOTOR DE AUDITORÍA PROPORCIONAL
    // ==========================================
    async function cargarTablas() {
        const { data, error } = await window.supabase.from('tablas_fijas')
            .select('*')
            .order('id', { ascending: false });

        if (error || !data) {
            tbodyMonitor.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos.</td></tr>';
            return;
        }

        tbodyMonitor.innerHTML = '';
        data.forEach(t => {
            let caballosHTML = t.caballos.map(c => 
                `<span class="${c.retirado ? 'line-through text-red-500 font-bold' : 'text-slate-700'}">${c.numero}-${c.nombre} <span class="text-[9px] text-slate-400">(${c.valor_ejemplar} pts)</span></span>`
            ).join(', ');

            let badgeEstado = t.estado === 'Abierta' 
                ? '<span class="bg-green-100 text-green-700 px-2 rounded text-[10px] font-bold">ABIERTA</span>' 
                : '<span class="bg-blue-100 text-blue-700 px-2 rounded text-[10px] font-bold">AUDITADA</span>';

            let btnAccion = t.estado === 'Abierta' 
                ? `<button type="button" class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded shadow text-[10px] font-bold hover:bg-amber-500" data-id="${t.id}" data-premio="${t.premio_original}" data-sumabase="${t.suma_base_tabla}" data-caballos='${JSON.stringify(t.caballos)}'><i class="fas fa-balance-scale"></i> Auditar</button>`
                : `<span class="text-[10px] text-blue-600 font-bold"><i class="fas fa-check-double"></i> Retirados: ${t.retirados_oficiales}</span>`;

            let simboloMoneda = t.moneda === 'VES' ? 'Bs' : '$';

            tbodyMonitor.innerHTML += `
                <tr class="hover:bg-blue-50 transition-colors">
                    <td class="p-2 border-b border-slate-100 font-bold text-slate-800">${t.hipodromo} <br><span class="text-blue-600">C${t.carrera}</span></td>
                    <td class="p-2 border-b border-slate-100 text-[11px] font-medium text-slate-600">${t.grupo_venta} <br><span class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[10px] font-bold">${t.moneda}</span></td>
                    <td class="p-2 border-b border-slate-100 text-[10px] leading-tight max-w-xs">${caballosHTML}</td>
                    <td class="p-2 border-b border-slate-100 text-right font-bold text-slate-700">
                        Costo: ${simboloMoneda}${parseFloat(t.monto_tabla).toLocaleString()}<br>
                        <span class="text-blue-700">Premio: ${simboloMoneda}${parseFloat(t.premio_recalculado).toLocaleString()}</span>
                    </td>
                    <td class="p-2 border-b border-slate-100 text-center">${badgeEstado}</td>
                    <td class="p-2 border-b border-slate-100 text-center">${btnAccion}</td>
                </tr>
            `;
        });

        document.querySelectorAll('.btn-auditar').forEach(btn => {
            btn.addEventListener('click', function() {
                abrirModalAuditoria(this.dataset.id, this.dataset.premio, this.dataset.sumabase, JSON.parse(this.dataset.caballos));
            });
        });
    }

    // ==========================================
    // 4. LÓGICA DEL MODAL DE AUDITORÍA
    // ==========================================
    const modalAuditoria = document.getElementById('modalAuditoria');
    let caballosModalTemp = [];
    let premioOrigTemp = 0;
    let sumaBaseTemp = 0;

    function abrirModalAuditoria(id, premioOrig, sumaBase, caballosJSON) {
        document.getElementById('auditoriaTablaId').value = id;
        premioOrigTemp = parseFloat(premioOrig);
        sumaBaseTemp = parseFloat(sumaBase);
        
        document.getElementById('lblPremioOrig').textContent = premioOrigTemp.toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('lblSumaBase').textContent = sumaBaseTemp.toLocaleString();
        
        caballosModalTemp = caballosJSON;
        const contenedor = document.getElementById('listaCaballosAuditoria');
        contenedor.innerHTML = '';

        caballosModalTemp.forEach((c, index) => {
            contenedor.innerHTML += `
                <label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer hover:bg-red-50 text-xs">
                    <input type="checkbox" class="chk-retiro" data-index="${index}" data-valor="${c.valor_ejemplar}">
                    <span class="font-bold text-slate-700">${c.numero} - ${c.nombre}</span>
                    <span class="ml-auto text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded">Valor: ${c.valor_ejemplar}</span>
                </label>
            `;
        });

        actualizarCalculoProporcionalModal();
        
        document.querySelectorAll('.chk-retiro').forEach(chk => {
            chk.addEventListener('change', actualizarCalculoProporcionalModal);
        });

        modalAuditoria.classList.remove('hidden');
    }

    function actualizarCalculoProporcionalModal() {
        let valorRetirados = 0;
        document.querySelectorAll('.chk-retiro:checked').forEach(chk => {
            valorRetirados += parseFloat(chk.dataset.valor);
        });

        // FÓRMULA PROPORCIONAL DE PROTECCIÓN DE BANCA:
        // Premio Final = Premio Base * (1 - (Valor Ejemplares Retirados / Suma Base Total))
        let nuevoPremio = premioOrigTemp;
        if (sumaBaseTemp > 0 && valorRetirados > 0) {
            const proporcionDescuento = valorRetirados / sumaBaseTemp;
            nuevoPremio = premioOrigTemp * (1 - proporcionDescuento);
            if (nuevoPremio < 0) nuevoPremio = 0;
        }

        document.getElementById('lblPremioRecalculado').textContent = nuevoPremio.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    document.getElementById('btnProcesarAuditoria').addEventListener('click', async () => {
        const idTabla = document.getElementById('auditoriaTablaId').value;
        const nuevoPremio = parseFloat(document.getElementById('lblPremioRecalculado').textContent.replace(/,/g, ''));
        
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
            alert('Error en base de datos al auditar la tabla.');
        } else {
            modalAuditoria.classList.add('hidden');
            cargarTablas();
        }
    });

    document.querySelectorAll('.cerrar-modal').forEach(btn => {
        btn.addEventListener('click', () => modalAuditoria.classList.add('hidden'));
    });

    document.getElementById('btnRecargarTablas').addEventListener('click', cargarTablas);

    // Arranque
    cargarTasaGlobal();
    cargarTablas();
});