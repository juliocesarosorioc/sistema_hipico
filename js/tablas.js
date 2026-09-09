document.addEventListener('DOMContentLoaded', () => {

    const contenedorCaballos = document.getElementById('contenedorCaballos');
    const btnAgregarCaballo = document.getElementById('btnAgregarCaballo');
    const lblSumaBase = document.getElementById('totalSumaBase');
    const btnGuardarTabla = document.getElementById('btnGuardarTabla');
    const tbodyMonitor = document.getElementById('cuerpoMonitorTablas');
    const lblRiesgo = document.getElementById('lblRiesgoEnVivo');
    
    let tasaCambioGlobal = 1.0;
    let datosTablaCompleta = [];

    // ==========================================
    // 1. CARGA INICIAL Y CÁLCULOS EN VIVO
    // ==========================================
    async function cargarTasaGlobal() {
        try {
            const { data } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (data && data.tasa_cambio) {
                tasaCambioGlobal = parseFloat(data.tasa_cambio);
                document.getElementById('lblTasaGlobal').textContent = tasaCambioGlobal.toLocaleString();
            }
        } catch (e) {
            console.warn("Fallo al cargar tasa global, usando 1.0");
        }
    }

    // Calcular Riesgo en vivo (Límite x Premio)
    function actualizarRiesgo() {
        const lim = parseInt(document.getElementById('limiteVentas').value) || 0;
        const prem = parseFloat(document.getElementById('premioTabla').value) || 0;
        lblRiesgo.textContent = (lim * prem).toLocaleString(undefined, {minimumFractionDigits: 2});
    }

    document.querySelectorAll('.cal-riesgo, #limiteVentas').forEach(el => {
        el.addEventListener('input', actualizarRiesgo);
    });

    function crearFilaCaballo(numSugerido = '', nomSugerido = '', valorSugerido = '') {
        const div = document.createElement('div');
        div.className = 'flex gap-2 items-center fila-caballo-config';
        div.innerHTML = `
            <input type="text" class="input-tbl w-16 text-center in-num-cab font-bold" value="${numSugerido}" placeholder="N°">
            <input type="text" class="input-tbl flex-1 in-nom-cab" value="${nomSugerido}" placeholder="Ejemplar">
            <input type="number" step="0.1" class="input-tbl w-24 text-center text-blue-700 font-bold in-valor-ej" value="${valorSugerido}" placeholder="Pts">
            <button type="button" class="text-red-400 hover:text-red-600 px-1 btn-quitar-cab"><i class="fas fa-trash-alt"></i></button>
        `;
        contenedorCaballos.appendChild(div);
        div.querySelector('.btn-quitar-cab').addEventListener('click', () => { div.remove(); calcularSumaBaseTotal(); });
        div.querySelector('.in-valor-ej').addEventListener('input', calcularSumaBaseTotal);
    }

    function calcularSumaBaseTotal() {
        let suma = 0;
        document.querySelectorAll('.in-valor-ej').forEach(input => { suma += parseFloat(input.value) || 0; });
        lblSumaBase.textContent = suma.toFixed(1);
    }

    btnAgregarCaballo.addEventListener('click', () => crearFilaCaballo());
    crearFilaCaballo('1', 'Ejemplar A', '50');
    crearFilaCaballo('2', 'Ejemplar B', '60');
    crearFilaCaballo('3', 'Ejemplar C', '50');
    calcularSumaBaseTotal();

    // ==========================================
    // 2. CREACIÓN ORIGINAL DE TABLA
    // ==========================================
    btnGuardarTabla.addEventListener('click', async () => {
        const hipodromo = document.getElementById('hipodromoTabla').value.trim().toUpperCase();
        const carrera = parseInt(document.getElementById('carreraTabla').value);
        const grupo = document.getElementById('grupoTabla').value.trim().toUpperCase() || 'GENERAL';
        const moneda = document.getElementById('monedaTabla').value;
        const limiteVentas = parseInt(document.getElementById('limiteVentas').value) || 100;
        const comisionGrupo = parseFloat(document.getElementById('comisionTabla').value) || 0;
        const montoTabla = parseFloat(document.getElementById('montoTabla').value);
        const premioOriginal = parseFloat(document.getElementById('premioTabla').value);
        const sumaBaseTabla = parseFloat(lblSumaBase.textContent);

        if (!hipodromo || isNaN(carrera) || isNaN(montoTabla) || isNaN(premioOriginal) || sumaBaseTabla <= 0) {
            return clubUI.toast("Faltan campos obligatorios o la base de ponderación es cero.");
        }

        let caballosArr = [];
        document.querySelectorAll('.fila-caballo-config').forEach(fila => {
            const numero = fila.querySelector('.in-num-cab').value.trim();
            const nombre = fila.querySelector('.in-nom-cab').value.trim().toUpperCase();
            const valor = parseFloat(fila.querySelector('.in-valor-ej').value);
            if (numero && nombre && !isNaN(valor)) {
                caballosArr.push({ numero, nombre, valor_ejemplar: valor, retirado: false });
            }
        });

        if (caballosArr.length < 2) return clubUI.toast("Ingrese al menos 2 ejemplares.");

        const btnOrigText = btnGuardarTabla.innerHTML;
        btnGuardarTabla.innerHTML = 'Guardando...'; btnGuardarTabla.disabled = true;

        const { error } = await window.supabase.from('tablas_fijas').insert([{
            hipodromo, carrera, grupo_venta: grupo, moneda, tasa_cambio: tasaCambioGlobal,
            suma_base_tabla: sumaBaseTabla, limite_ventas: limiteVentas, cantidad_vendida: 0,
            monto_tabla: montoTabla, premio_original: premioOriginal, premio_recalculado: premioOriginal,
            comision_grupo: comisionGrupo, caballos: caballosArr, estado: 'Abierta'
        }]);

        if (error) {
            console.error("Error BD:", error.message || error);
            clubUI.toast("Error al registrar en la base de datos.");
        } else {
            document.getElementById('montoTabla').value = '';
            contenedorCaballos.innerHTML = '';
            crearFilaCaballo(); crearFilaCaballo();
            calcularSumaBaseTotal(); cargarTablas();
        }
        btnGuardarTabla.innerHTML = btnOrigText; btnGuardarTabla.disabled = false;
    });

    // ==========================================
    // 3. MONITOR Y ACCIONES (EDITAR / DUPLICAR / AUDITAR)
    // ==========================================
    async function cargarTablas() {
        try {
            const { data, error } = await window.supabase.from('tablas_fijas').select('*').order('id', { ascending: false });
            if (error) throw error;
            
            datosTablaCompleta = data || [];
            tbodyMonitor.innerHTML = '';

            if (datosTablaCompleta.length === 0) {
                tbodyMonitor.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">No hay tablas registradas.</td></tr>';
                return;
            }

            datosTablaCompleta.forEach(t => {
                let badgeEstado = t.estado === 'Abierta' ? '<span class="text-green-600 font-bold">ABIERTA</span>' : '<span class="text-blue-600 font-bold">AUDITADA</span>';
                let simbolo = t.moneda === 'VES' ? 'Bs' : '$';
                
                let disponibles = (t.limite_ventas || 100) - (t.cantidad_vendida || 0);

                let btnAcciones = `
                    <div class="flex flex-wrap gap-1 justify-center">
                        <button class="btn-editar bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300" data-id="${t.id}" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-clonar bg-indigo-100 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-200" data-id="${t.id}" title="Clonar"><i class="fas fa-copy"></i></button>
                        ${t.estado === 'Abierta' ? `<button class="btn-auditar bg-amber-400 text-slate-900 px-2 py-1 rounded hover:bg-amber-500 font-bold" data-id="${t.id}">Auditar</button>` : ''}
                    </div>
                `;

                tbodyMonitor.innerHTML += `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-2 font-bold">${t.hipodromo}<br><span class="text-blue-600">C${t.carrera}</span></td>
                        <td class="p-2 text-[10px]">
                            <span class="font-bold text-slate-700 uppercase">${t.grupo_venta}</span> (${t.moneda})<br>
                            Disp: <span class="text-red-600 font-bold">${disponibles}</span> / ${t.limite_ventas || 100}
                        </td>
                        <td class="p-2 text-right">
                            Costo: ${simbolo}${t.monto_tabla}<br>
                            <span class="text-blue-700 font-bold">Paga: ${simbolo}${parseFloat(t.premio_recalculado).toLocaleString()}</span>
                        </td>
                        <td class="p-2 text-center text-[10px]">${badgeEstado}</td>
                        <td class="p-2 text-center">${btnAcciones}</td>
                    </tr>
                `;
            });

            document.querySelectorAll('.btn-editar').forEach(b => b.addEventListener('click', (e) => abrirModalEditar(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-clonar').forEach(b => b.addEventListener('click', (e) => abrirModalClonar(e.currentTarget.dataset.id)));
            document.querySelectorAll('.btn-auditar').forEach(b => b.addEventListener('click', (e) => abrirModalAuditoria(e.currentTarget.dataset.id)));
        } catch (e) {
            tbodyMonitor.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error cargando tablas.</td></tr>`;
        }
    }

    // --- LÓGICA DE EDICIÓN ---
    function abrirModalEditar(id) {
        const tabla = datosTablaCompleta.find(t => t.id == id);
        if(!tabla) return;
        document.getElementById('editId').value = id;
        document.getElementById('editCosto').value = tabla.monto_tabla;
        document.getElementById('editPremio').value = tabla.premio_original;
        document.getElementById('editLimite').value = tabla.limite_ventas || 100;
        document.getElementById('modalEditar').classList.remove('hidden');
    }

    document.getElementById('btnProcesarEdicion').addEventListener('click', async () => {
        const id = document.getElementById('editId').value;
        const costo = parseFloat(document.getElementById('editCosto').value);
        const premio = parseFloat(document.getElementById('editPremio').value);
        const limite = parseInt(document.getElementById('editLimite').value);

        const { error } = await window.supabase.from('tablas_fijas').update({
            monto_tabla: costo, premio_original: premio, premio_recalculado: premio, limite_ventas: limite
        }).eq('id', id);

        if(!error) { document.getElementById('modalEditar').classList.add('hidden'); cargarTablas(); }
        else { clubUI.toast("Error al editar."); }
    });

    // --- LÓGICA DE CLONACIÓN MASIVA ---
    function abrirModalClonar(id) {
        document.getElementById('dupId').value = id;
        document.getElementById('txtGruposDuplicar').value = '';
        document.getElementById('modalDuplicar').classList.remove('hidden');
    }

    document.getElementById('btnProcesarDuplicado').addEventListener('click', async () => {
        const idOriginal = document.getElementById('dupId').value;
        const gruposTexto = document.getElementById('txtGruposDuplicar').value.toUpperCase();
        
        const gruposNuevos = gruposTexto.split(',').map(g => g.trim()).filter(g => g !== '');
        if(gruposNuevos.length === 0) return clubUI.toast("Escriba al menos un grupo válido.");

        const tablaRef = datosTablaCompleta.find(t => t.id == idOriginal);
        if(!tablaRef) return;

        const registrosMasivos = gruposNuevos.map(grupo => {
            return {
                hipodromo: tablaRef.hipodromo, carrera: tablaRef.carrera,
                grupo_venta: grupo, moneda: tablaRef.moneda, tasa_cambio: tablaRef.tasa_cambio,
                suma_base_tabla: tablaRef.suma_base_tabla, limite_ventas: tablaRef.limite_ventas, cantidad_vendida: 0,
                monto_tabla: tablaRef.monto_tabla, premio_original: tablaRef.premio_original, premio_recalculado: tablaRef.premio_original,
                comision_grupo: tablaRef.comision_grupo, caballos: tablaRef.caballos, estado: 'Abierta'
            }
        });

        const btn = document.getElementById('btnProcesarDuplicado');
        btn.textContent = "Clonando..."; btn.disabled = true;

        const { error } = await window.supabase.from('tablas_fijas').insert(registrosMasivos);
        
        btn.textContent = "Ejecutar Clonación Masiva"; btn.disabled = false;
        
        if(!error) {
            document.getElementById('modalDuplicar').classList.add('hidden');
            cargarTablas();
        } else { clubUI.toast("Error al clonar."); }
    });

    // --- LÓGICA DE AUDITORÍA (Descuento Proporcional) ---
    let premioOrigTemp=0, sumaBaseTemp=0, caballosModalTemp=[];
    function abrirModalAuditoria(id) {
        const t = datosTablaCompleta.find(x => x.id == id);
        document.getElementById('auditoriaTablaId').value = id;
        premioOrigTemp = t.premio_original; sumaBaseTemp = t.suma_base_tabla;
        caballosModalTemp = t.caballos;
        
        document.getElementById('lblSumaBase').textContent = sumaBaseTemp;
        
        const ctn = document.getElementById('listaCaballosAuditoria'); ctn.innerHTML = '';
        caballosModalTemp.forEach((c, i) => {
            ctn.innerHTML += `<label class="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded cursor-pointer text-xs">
                <input type="checkbox" class="chk-retiro" data-index="${i}" data-valor="${c.valor_ejemplar}">
                <span class="font-bold text-slate-700">${c.numero} - ${c.nombre} (Valor: ${c.valor_ejemplar})</span>
            </label>`;
        });
        document.getElementById('lblPremioRecalculado').textContent = premioOrigTemp;
        document.querySelectorAll('.chk-retiro').forEach(chk => chk.addEventListener('change', actualizarCalculoRecalculado));
        document.getElementById('modalAuditoria').classList.remove('hidden');
    }

    function actualizarCalculoRecalculado() {
        let valRet = 0;
        document.querySelectorAll('.chk-retiro:checked').forEach(c => valRet += parseFloat(c.dataset.valor));
        let p = premioOrigTemp;
        if(sumaBaseTemp > 0 && valRet > 0) p = premioOrigTemp * (1 - (valRet / sumaBaseTemp));
        document.getElementById('lblPremioRecalculado').textContent = Math.max(0, p).toFixed(2);
    }

    document.getElementById('btnProcesarAuditoria').addEventListener('click', async () => {
        const id = document.getElementById('auditoriaTablaId').value;
        const np = parseFloat(document.getElementById('lblPremioRecalculado').textContent);
        let ret = [];
        document.querySelectorAll('.chk-retiro').forEach(c => {
            const idx = c.dataset.index;
            caballosModalTemp[idx].retirado = c.checked;
            if(c.checked) ret.push(caballosModalTemp[idx].numero);
        });
        const { error } = await window.supabase.from('tablas_fijas').update({
            premio_recalculado: np, caballos: caballosModalTemp, estado: 'Auditada', retirados_oficiales: ret.length>0?ret.join(','):'Ninguno'
        }).eq('id', id);
        if(!error) { document.getElementById('modalAuditoria').classList.add('hidden'); cargarTablas(); }
    });

    document.querySelectorAll('.cerrar-modal').forEach(b => b.addEventListener('click', () => {
        document.getElementById('modalAuditoria').classList.add('hidden');
        document.getElementById('modalDuplicar').classList.add('hidden');
        document.getElementById('modalEditar').classList.add('hidden');
    }));

    document.getElementById('btnRecargarTablas').addEventListener('click', cargarTablas);
    
    // Arranque
    cargarTasaGlobal(); 
    cargarTablas();
    actualizarRiesgo();
});