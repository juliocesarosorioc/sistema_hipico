document.addEventListener('DOMContentLoaded', () => {

    const tbody = document.getElementById('cuerpoTaquilla');
    const btnAgregarLineas = document.getElementById('btnAgregarLineas');
    const btnRegistrarCarrera = document.getElementById('btnRegistrarCarrera');
    const btnModalidadCruces = document.getElementById('btnModalidadCruces');
    const datalistClientes = document.getElementById('listaClientesDB');
    const datalistJugadas = document.getElementById('listaJugadasDB');
    const modalProcesando = document.getElementById('modalProcesando');
    const calc = window.clubCalculo;

    document.getElementById('fechaCarrera').valueAsDate = new Date();

    let clientesList = [];
    let jugadasList = [];
    let tablasConfigList = [];
    let tasaCambioGlobal = 1.0;
    let crucesActivo = true;

    // ------------------------------------------------------------------
    // CARGAS (robustas: no rompe si falta el SQL de columnas)
    // ------------------------------------------------------------------
    async function inicializarDatos() {
        window.clubIndicador?.accion('Cargando clientes, saldos y jugadas…');
        const segura = (promesa) => promesa.catch(e => ({ data: null, error: e }));
        const [rClientes, rJugadas, rTablas, rMoneda, rHipodromos] = await Promise.all([
            segura(window.supabase.from('clientes').select('*').order('nombre')),
            segura(window.supabase.from('tipos_jugadas').select('*').eq('activo', true).order('nombre')),
            segura(window.supabase.from('tablas_fijas').select('*').eq('estado', 'Abierta')),
            segura(window.supabase.from('monedas').select('tasa_cambio').limit(1).single()),
            segura(window.supabase.from('hipodromos').select('nombre').order('nombre'))
        ]);

        const clientes = rClientes.data;
        const jugadas = rJugadas.data;
        const tablas = rTablas.data;
        const monedaData = rMoneda.data;
        const hipodromosDB = rHipodromos.data;

        if (rClientes.error) {
            clubUI.toast('No se pudieron cargar los clientes. Ejecute el paquete SQL (secciones 0 y 7) y recargue.', 'error');
        }
        if (rJugadas.error) {
            clubUI.toast('No se pudieron cargar las jugadas. Revisa la tabla tipos_jugadas.', 'error');
        }

        if (hipodromosDB && hipodromosDB.length) {
            const selectHip = document.getElementById('selectHipodromo');
            if (selectHip) {
                selectHip.innerHTML = hipodromosDB
                    .map(h => `<option value="${h.nombre}">${h.nombre}</option>`)
                    .join('');
            }
        }

        if (clientes) {
            clientesList = clientes;
            datalistClientes.innerHTML = '';
            clientes.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.seudonimo || c.nombre;
                datalistClientes.appendChild(opt);
            });
        }

        if (jugadas) {
            jugadasList = jugadas;
            datalistJugadas.innerHTML = '';
            jugadas.forEach(j => {
                const opt = document.createElement('option');
                opt.value = j.nombre;
                datalistJugadas.appendChild(opt);
            });
        }

        if (tablas) tablasConfigList = tablas;
        if (monedaData && monedaData.tasa_cambio) tasaCambioGlobal = parseFloat(monedaData.tasa_cambio);

        aplicarProgramaDiaTaquilla();

        for (let i = 1; i <= 10; i++) agregarFila(i);
        window.clubIndicador?.fin();
    }

    // Programa del día compartido: precarga el hipódromo y muestra cuántas
    // carreras fueron cargadas desde la Gaceta/Ensamblaje.
    async function aplicarProgramaDiaTaquilla() {
        const sel = document.getElementById('selectHipodromo');
        if (!sel || !window.clubPrograma) return;
        const prog = await window.clubPrograma.cargar();
        const nombres = (prog.hipodromos || []).filter(Boolean);
        const existentes = [...sel.options].map(o => o.value.toUpperCase());
        nombres.forEach(n => {
            if (n && !existentes.includes(n.toUpperCase())) {
                sel.appendChild(new Option(n, n));
                existentes.push(n.toUpperCase());
            }
        });
        if (nombres.length && !sel.value) sel.value = nombres[0];
        const lbl = document.getElementById('clubProgramaResumen');
        if (lbl) {
            if (prog.carreras.length) {
                lbl.textContent = `<i class="fas fa-calendar-day mr-1"></i> Programa del día: ${prog.carreras.length} carrera(s) · ${nombres.join(', ')}`;
                lbl.classList.remove('hidden');
            } else {
                lbl.classList.add('hidden');
            }
        }
    }

    // Busca por nombre, seudónimo o apellido (insensible a mayúsculas)
    function buscarCliente(txt) {
        const t = String(txt || '').trim().toUpperCase();
        if (!t) return null;
        return clientesList.find(c =>
            c.nombre === t ||
            (c.seudonimo || '').toUpperCase() === t ||
            (c.apellido || '').toUpperCase() === t
        ) || null;
    }

    // ------------------------------------------------------------------
    // FILAS DE TAQUILLA
    // ------------------------------------------------------------------
    function agregarFila(indice = null) {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-200 fila-ticket hover:bg-slate-50 transition-colors';
        const numLinea = indice || document.querySelectorAll('.fila-ticket').length + 1;

        tr.innerHTML = `
            <td class="p-1 border-r border-slate-200 text-center font-bold text-slate-700 bg-slate-100 w-8">${numLinea}</td>
            <td class="p-1 border-r border-slate-200 text-center w-16">
                <button type="button" class="text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50 text-[10px] btn-borrar"><i class="fas fa-times"></i></button>
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaJugadasDB" class="input-tbl in-jugada" placeholder="ESCRIBA...">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" class="input-tbl in-caballo" placeholder="Ej: 5 o 2x3 o 4*8">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="number" step="0.01" class="input-tbl in-monto text-right font-bold text-emerald-700" placeholder="0.00">
            </td>
            <td class="p-1 border-r border-slate-200 text-center">
                <span class="out-cobro text-slate-400 font-mono text-[10px] font-bold">-</span>
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaClientesDB" class="input-tbl in-juega" placeholder="Buscar Cliente...">
            </td>
            <td class="p-1 border-r border-slate-200">
                <input type="text" list="listaClientesDB" class="input-tbl in-consigue" placeholder="Buscar Cliente...">
            </td>
            <td class="p-1 border-r border-slate-200 text-center text-slate-500 font-bold text-[11px] out-disp1">-</td>
            <td class="p-1 text-center text-slate-500 font-bold text-[11px] out-disp2">-</td>
        `;

        tbody.appendChild(tr);
        asignarEventosFila(tr);
    }

    function recalcularCobro(tr) {
        const monto = parseFloat(tr.querySelector('.in-monto').value);
        const caballo = tr.querySelector('.in-caballo').value.trim();
        const outCobro = tr.querySelector('.out-cobro');
        if (isNaN(monto) || monto <= 0 || !caballo) { outCobro.textContent = '-'; return; }
        const n = crucesActivo ? (calc.numeroDeCruces(caballo) || 1) : 1;
        const total = calc.costoDeLinea(monto, n);
        outCobro.textContent = n > 1 ? `${n}× $${clubUI.formatoNumero(total, 2)}` : `$${clubUI.formatoNumero(total, 2)}`;
        outCobro.className = `out-cobro font-mono text-[10px] font-bold ${n > 1 ? 'text-orange-600' : 'text-slate-500'}`;
    }

    function asignarEventosFila(tr) {
        tr.querySelector('.btn-borrar').addEventListener('click', () => {
            tr.querySelectorAll('.input-tbl').forEach(i => i.value = '');
            tr.querySelector('.out-disp1').textContent = '-';
            tr.querySelector('.out-disp2').textContent = '-';
            tr.querySelector('.out-cobro').textContent = '-';
            tr.querySelector('.out-cobro').className = 'out-cobro text-slate-400 font-mono text-[10px] font-bold';
        });

        ['in-caballo', 'in-monto', 'in-jugada'].forEach(sel => {
            tr.querySelector('.' + sel).addEventListener('input', () => recalcularCobro(tr));
        });

        tr.querySelector('.in-juega').addEventListener('blur', function() {
            const cliente = buscarCliente(this.value);
            const celda = tr.querySelector('.out-disp1');
            if (cliente) {
                celda.textContent = clubUI.formatoNumero(parseFloat(cliente.saldo_actual || 0), 2);
                celda.className = `p-1 border-r border-slate-200 text-center font-bold text-[11px] out-disp1 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });

        tr.querySelector('.in-consigue').addEventListener('blur', function() {
            const cliente = buscarCliente(this.value);
            const celda = tr.querySelector('.out-disp2');
            if (cliente) {
                celda.textContent = clubUI.formatoNumero(parseFloat(cliente.saldo_actual || 0), 2);
                celda.className = `p-1 text-center font-bold text-[11px] out-disp2 ${cliente.saldo_actual < 0 ? 'text-red-500' : 'text-slate-800'}`;
            } else { celda.textContent = '-'; }
        });
    }

    btnAgregarLineas.addEventListener('click', () => {
        for (let i = 0; i < 3; i++) agregarFila();
    });

    // Toggle de cruces
    btnModalidadCruces?.addEventListener('click', () => {
        crucesActivo = !crucesActivo;
        btnModalidadCruces.innerHTML = crucesActivo
            ? '<i class="fas fa-random text-blue-500 mr-1"></i> Modalidad: CON CRUCES'
            : '<i class="fas fa-minus-circle text-slate-400 mr-1"></i> Modalidad: SIN CRUCES (un número por línea)';
        btnModalidadCruces.className = crucesActivo
            ? 'w-full bg-slate-100 border border-slate-300 rounded p-1.5 text-slate-700 font-bold hover:bg-slate-200 transition-colors text-xs'
            : 'w-full bg-white border border-slate-200 rounded p-1.5 text-slate-500 font-bold hover:bg-slate-50 transition-colors text-xs';
        document.querySelectorAll('.fila-ticket').forEach(recalcularCobro);
    });

    // ------------------------------------------------------------------
    // REGISTRO DE CARRERA (cobro + pago quedan estructurados)
    // ------------------------------------------------------------------
    btnRegistrarCarrera.addEventListener('click', async () => {
        const hipodromo = document.getElementById('selectHipodromo').value.trim();
        const carrera = document.getElementById('selectCarrera').value;
        const comisionGlobalInput = parseFloat(document.getElementById('inputComision')?.value) || 5;

        let ticketsValidos = [];
        let errores = [];

        document.querySelectorAll('.fila-ticket').forEach((tr, index) => {
            const jugada = tr.querySelector('.in-jugada').value.trim().toUpperCase();
            const caballo = tr.querySelector('.in-caballo').value.trim().toUpperCase();
            const monto = parseFloat(tr.querySelector('.in-monto').value);
            const clienteJuegaNombre = tr.querySelector('.in-juega').value.trim().toUpperCase();
            const clienteConsigueNombre = tr.querySelector('.in-consigue').value.trim().toUpperCase();

            if (!jugada && !caballo && isNaN(monto)) return;
            if (!jugada || !caballo || isNaN(monto) || monto <= 0 || !clienteJuegaNombre) {
                errores.push(`Línea ${index + 1}: Faltan datos obligatorios (Jugada, Caballo, Monto, Juega).`);
                return;
            }

            const cJuega = buscarCliente(clienteJuegaNombre);
            const cConsigue = clienteConsigueNombre ? buscarCliente(clienteConsigueNombre) : null;
            const jugadaRegla = jugadasList.find(j => j.nombre === jugada);

            if (!cJuega) {
                errores.push(`Línea ${index + 1}: El cliente "${clienteJuegaNombre}" no existe.`);
                return;
            }

            // Cruces y COBRO total de la línea
            const cruces = crucesActivo ? calc.numeroDeCruces(caballo) : 1;
            if (!cruces) {
                errores.push(`Línea ${index + 1}: Caballo inválido ("${caballo}"). Use un número (5) o cruce (2x3).`);
                return;
            }
            if (cruces === 1 && !/^\d+$/.test(caballo)) {
                errores.push(`Línea ${index + 1}: El caballo "${caballo}" no parece un número válido.`);
                return;
            }
            const costoLinea = calc.costoDeLinea(monto, cruces);

            // REGLA DE NEGOCIO (AVAL): límite de pérdida nunca supera -AVAL
            const modoJuega = cJuega.modo_juego || (cJuega.libre ? 'libre' : 'aval');
            const saldoJuega = parseFloat(cJuega.saldo_actual || 0);
            if (modoJuega === 'pozo') {
                if (saldoJuega < costoLinea) {
                    errores.push(`Línea ${index + 1}: ${cJuega.nombre} juega con Pozo y solo tiene $${clubUI.formatoNumero(saldoJuega, 2)} (cuesta $${clubUI.formatoNumero(costoLinea, 2)}). Debe abonar antes de jugar.`);
                    return;
                }
            } else if (!cJuega.libre && modoJuega !== 'libre') {
                const limiteAval = parseFloat(cJuega.aval || 0);
                if ((saldoJuega - costoLinea) < -limiteAval) {
                    errores.push(`Línea ${index + 1}: ${cJuega.nombre} superaría su límite de AVAL ($${clubUI.formatoNumero(limiteAval, 2)}). Debe abonar antes de jugar.`);
                    return;
                }
            }

            // Jugada por tabla (fija/pizarra) o por unidad
            const esTabla = calc.esPorTabla(jugadaRegla, jugada);
            let tablaAsociada = null;
            if (esTabla) {
                tablaAsociada = tablasConfigList.find(t =>
                    String(t.hipodromo || '').toUpperCase() === hipodromo.toUpperCase() && t.carrera == carrera
                );
                if (!tablaAsociada) {
                    errores.push(`Línea ${index + 1}: No hay tabla "Abierta" para ${hipodromo} C${carrera}.`);
                    return;
                }
            }

            const premio = calc.premioPorTicket(monto, jugadaRegla, tablaAsociada);
            const comision = (premio.comision_porcentaje != null)
                ? premio.comision_porcentaje
                : (jugadaRegla && !isNaN(parseFloat(jugadaRegla.comision_porcentaje))
                    ? parseFloat(jugadaRegla.comision_porcentaje)
                    : comisionGlobalInput);

            // Uno o varios tickets: uno POR CADA EJEMPLAR del cruce (así se paga por ganador)
            const ejemplares = crucesActivo ? calc.parsearCaballos(caballo) : [caballo];

            ejemplares.forEach(ej => {
                ticketsValidos.push({
                    hipodromo,
                    carrera,
                    tipo_jugada_id: jugadaRegla ? jugadaRegla.id : null,
                    nombre_jugada: jugada,
                    caballo: ej,
                    monto_jugado: monto,
                    monto_decidido: monto,
                    cliente_juega_id: cJuega.id,
                    cliente_juega_nombre: cJuega.nombre,
                    cliente_consigue_id: cConsigue ? cConsigue.id : null,
                    cliente_consigue_nombre: cConsigue ? cConsigue.nombre : null,
                    grupo: premio.grupo,
                    moneda: premio.moneda,
                    tasa_cambio: tasaCambioGlobal,
                    cantidad_tablas: premio.cantidad_tablas,
                    premio_por_tabla: premio.premio_por_tabla,
                    comision_porcentaje: comision,
                    estado: 'Pendiente'
                });
            });
        });

        if (errores.length > 0) return clubUI.toast("CORRIJA LOS SIGUIENTES ERRORES:\n\n" + errores.join('\n'));
        if (ticketsValidos.length === 0) return clubUI.toast("No hay tickets ingresados.");

        modalProcesando.classList.remove('hidden');
        window.clubIndicador?.accion('Guardando boletos y saldos…');

        try {
            const { error: errTickets } = await window.supabase.from('tickets_apuestas').insert(ticketsValidos);
            if (errTickets) throw errTickets;

            // Descuento solo para modo POZO (el monto de cada ticket)
            for (const t of ticketsValidos) {
                const cJuega = clientesList.find(c => c.id === t.cliente_juega_id);
                const modo = cJuega.modo_juego || (cJuega.libre ? 'libre' : 'aval');
                if (modo !== 'pozo') continue;
                const nuevoSaldo = parseFloat(cJuega.saldo_actual || 0) - parseFloat(t.monto_jugado);
                await window.supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', t.cliente_juega_id);
                cJuega.saldo_actual = nuevoSaldo;
            }

            const uni = [...new Set(ticketsValidos.map(t => `${t.hipodromo} C${t.carrera}`))].join(', ') || '-';
            clubUI.toast(`⏺ ¡ÉXITO! ${ticketsValidos.length} boleto(s) registrados (${[...new Set(ticketsValidos.map(t => t.caballo))].join(',')}) en ${uni}.`);
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TAQUILLA', `apuestas_registradas: ${ticketsValidos.length} boletos, ${[...new Set(ticketsValidos.map(t => t.hipodromo + ' C' + t.carrera))].join(', ') || '-'}`);
            document.querySelectorAll('.btn-borrar').forEach(b => b.click());

        } catch (err) {
            console.error(err);
            clubUI.toast("Error al guardar en la base de datos.", 'error');
        } finally {
            modalProcesando.classList.add('hidden');
            window.clubIndicador?.fin();
        }
    });

    // ------------------------------------------------------------------
    // CARGA CENTRAL DE RESULTADOS (Taquilla)
    // Los resultados de la carrera (ganador/empate, retiros, premio con baja
    // proporcional y dividendos por tipo de jugada) se registran AQUÍ, una vez,
    // usando la tabla resultados_carreras con clave (fecha, hipodromo, carrera).
    // Los módulos individuales NO cargan resultados.
    // ------------------------------------------------------------------
    const btnPreliminarResultado = document.getElementById('btnPreliminarResultado');
    const chipResultadoEstado = document.getElementById('chipResultadoEstado');
    const inputRetirados = document.getElementById('inputRetirados');
    const fFecha = document.getElementById('fechaCarrera');
    const fHipo = document.getElementById('selectHipodromo');
    const fCarrera = document.getElementById('selectCarrera');

    const DIV_LABELS = {
        win: 'Win / Ganador',
        place: 'Place / Lugar',
        show: 'Show / Mostrar',
        puestos: 'Puestos (exacta)',
        marcas: 'Marcas (trifecta)'
    };

    function ctxResultado() {
        return {
            fecha: fFecha?.value || new Date().toISOString().slice(0, 10),
            hipodromo: (fHipo?.value || '').trim(),
            carrera: String(fCarrera?.value || ''),
            preRetirados: (inputRetirados?.value || '').trim()
        };
    }

    function sesionOperador() {
        try {
            const s = window.clubAuth?.getSesion?.();
            return (s && s.nombre) ? s.nombre : 'anon';
        } catch (e) { return 'anon'; }
    }

    // (Re)consulta el resultado ya cargado para (fecha, hipodromo, carrera)
    async function resultadoCargado(ctx) {
        try {
            const { data, error } = await window.supabase.from('resultados_carreras')
                .select('*')
                .eq('fecha', ctx.fecha)
                .eq('hipodromo', ctx.hipodromo)
                .eq('carrera', parseInt(ctx.carrera, 10))
                .maybeSingle();
            if (error && error.code === 'PGRST205') {
                clubUI.toast('Falta la tabla resultados_carreras. Ejecute el SQL del paquete (sección 10).', 'warning');
                return null;
            }
            if (error) return null;
            return data || null;
        } catch (e) { return null; }
    }

    // Busca la tabla fija del día para precargar los caballos y premios
    async function buscarTablaDelDia(ctx) {
        const lista = tablasConfigList.length ? tablasConfigList : null;
        if (lista) {
            const t = lista.find(x => String(x.hipodromo || '').toUpperCase() === ctx.hipodromo.toUpperCase() && String(x.carrera) === ctx.carrera);
            if (t) return t;
        }
        try {
            const { data } = await window.supabase.from('tablas_fijas')
                .select('*').eq('estado', 'Abierta')
                .eq('hipodromo', ctx.hipodromo.toUpperCase())
                .eq('carrera', parseInt(ctx.carrera, 10));
            return (data && data[0]) || null;
        } catch (e) { return null; }
    }

    function marcarRetirosEnCaballos(caballos, textoRetirados) {
        const nums = new Set(String(textoRetirados || '').split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => n > 0));
        if (!nums.size) return caballos;
        return caballos.map(c => ({ ...c, retirado: nums.has(parseInt(c.numero, 10)) || !!c.retirado, ganador: nums.has(parseInt(c.numero, 10)) ? false : c.ganador }));
    }

    async function guardarResultadoCentral(ctx, datos, dividendos) {
        const ganadores = (datos.ejemplares || []).filter(e => e.ganador).map(e => String(e.numero));
        const ret = datos.retirados || [];
        const dividendosPorEjemplar = {};
        const ordenLlegada = [];
        (datos.ejemplares || []).forEach(e => {
            const div = parseFloat(e.dividendo) || 0;
            if (div > 0) dividendosPorEjemplar[String(e.numero)] = div;
            const puesto = parseInt(e.orden, 10);
            if (puesto >= 1) ordenLlegada.push({ numero: String(e.numero), puesto });
        });
        ordenLlegada.sort((a, b) => a.puesto - b.puesto);
        const fila = {
            fecha: ctx.fecha,
            hipodromo: ctx.hipodromo,
            carrera: parseInt(ctx.carrera, 10),
            ganadores: ganadores.length ? ganadores : null,
            retirados: ret.length ? ret.join(',') : 'NO HUBO RETIROS',
            premio_oficial: datos.premioOriginal,
            premio_recalculado: datos.premioRecalculado,
            detalle: datos.ejemplares,
            dividendos: Object.keys(dividendosPorEjemplar).length ? dividendosPorEjemplar : (dividendos || {}),
            orden_llegada: ordenLlegada.length ? ordenLlegada : null,
            aplicado_a_tablas: true,
            cargado_por: sesionOperador(),
            updated_at: new Date().toISOString()
        };
        try {
            const { error } = await window.supabase.from('resultados_carreras')
                .upsert([fila], { onConflict: 'fecha,hipodromo,carrera' });
            if (error) throw error;
            return { ok: true, fila };
        } catch (err) {
            clubUI.toast('Resultado guardado en la tabla fija, pero el central no se registró: ' + (err?.message || err), 'warning');
            return { ok: false, fila };
        }
    }

    // Aplica la baja proporcional + retirados + ganador a la tabla fija del día
    async function aplicarResultadoATablas(ctx, datos) {
        const tabla = await buscarTablaDelDia(ctx);
        if (!tabla) { clubUI.toast(`No hay tabla "Abierta" para ${ctx.hipodromo} C${ctx.carrera}.`, 'warning'); return; }
        const ret = (datos.retirados || []).map(String);
        try {
            const caballosActualizados = (datos.ejemplares || []).map(e => {
                const prev = (tabla.caballos || []).find(x => String(x.numero) === String(e.numero));
                return {
                    numero: e.numero, nombre: e.nombre, nacionalidad: e.nacionalidad || prev?.nacionalidad || 'VE',
                    valor_ejemplar: prev?.valor_ejemplar ?? e.valor_ejemplar,
                    orden: e.orden ?? prev?.orden ?? '',
                    dividendo: e.dividendo ?? prev?.dividendo ?? '',
                    retirado: !!e.retirado, ganador: !!e.ganador,
                    ejemplar_id: prev?.ejemplar_id || null
                };
            });
            const { error } = await window.supabase.from('tablas_fijas').update({
                premio_recalculado: datos.premioRecalculado,
                retirados_oficiales: ret.length ? ret.join(',') : 'NO HUBO RETIROS',
                caballos: caballosActualizados
            }).eq('id', tabla.id);
            if (error) throw error;
            tablasConfigList = tablasConfigList.map(t => t.id === tabla.id ? { ...t, premio_recalculado: datos.premioRecalculado, retirados_oficiales: ret.length ? ret.join(',') : 'NO HUBO RETIROS', caballos: caballosActualizados } : t);
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TAQUILLA', `resultado_aplicado_tabla: ${ctx.hipodromo} C${ctx.carrera} premio=${datos.premioRecalculado} retirados=[${ret.join(',') || 'ninguno'}]`);
        } catch (err) {
            clubUI.toast('No se pudo aplicar el resultado a la tabla fija: ' + (err?.message || err), 'error');
        }
    }

    function actualizarChipResultado(res, conDivs) {
        if (!chipResultadoEstado) return;
        if (!res) {
            chipResultadoEstado.className = 'text-[10px] font-bold inline-flex items-center gap-1 bg-rose-100 border border-rose-300 text-rose-600 px-2 py-1.5 rounded-full';
            chipResultadoEstado.innerHTML = '<i class="fas fa-hourglass-half"></i> Sin resultado';
            return;
        }
        const ganadores = res.ganadores || [];
        const ganador = ganadores.length > 1 ? ganadores.join(' = ') : ganadores.join(',');
        const conDivsFormato = conDivs
            ? '<br><span class="text-[9px] text-emerald-700">' + Object.entries(res.dividendos || {}).filter(([k]) => ganadores.includes(k)).map(([k, v]) => `💲${k}: ${v}`).join(' · ') + (Object.entries(res.dividendos || {}).filter(([k]) => ganadores.includes(k)).length ? ' <i>(por ejemplar)</i>' : 'dividendos guardados') + '</span>'
            : '';
        chipResultadoEstado.className = 'text-[10px] font-bold inline-flex items-center gap-1 bg-emerald-100 border border-emerald-300 text-emerald-700 px-2 py-1.5 rounded-full';
        chipResultadoEstado.innerHTML = `<i class="fas fa-check-circle"></i> C${res.carrera} · G:${ganador || '—'} ${conDivsFormato}`;
    }

    async function abrirCargaResultados() {
        if (!window.clubModalResultado) return clubUI.toast('Falta el componente js/components/modal_resultado.js', 'error');
        const ctx = ctxResultado();
        if (!ctx.hipodromo || !ctx.carrera) return clubUI.toast('Seleccione hipódromo y carrera.', 'warning');

        window.clubIndicador?.accion('Preparando carga de resultados…');
        let tabla = await buscarTablaDelDia(ctx);
        const existente = await resultadoCargado(ctx);

        const caballosBase = (tabla?.caballos && Array.isArray(tabla.caballos) ? tabla.caballos : Array.isArray(existente?.detalle) ? existente.detalle : []).map(c => ({ ...c, valor_ejemplar: c.valor_ejemplar ?? c.valor ?? c.pts ?? '' }));
        // Si ya había resultado, restaurar estado marcado (ganadores/empates/orden/dividendo/retirados)
        if (existente) {
            (caballosBase).forEach(c => {
                c.ganador = (existente.ganadores || []).includes(String(c.numero));
                const ord = (existente.orden_llegada || []).find(o => String(o.numero) === String(c.numero));
                if (ord) c.orden = ord.puesto;
                if (existente.dividendos && existente.dividendos[String(c.numero)] != null) c.dividendo = existente.dividendos[String(c.numero)];
            });
            const retNums = new Set(String(existente.retirados || '').split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => n > 0));
            caballosBase.forEach(c => { if (retNums.has(parseInt(c.numero, 10))) c.retirado = true; });
        }
        // Pre-marcar retiros escritos en el campo RETIRADOS
        const conRetirosInput = marcarRetirosEnCaballos(caballosBase, ctx.preRetirados);
        // También sincronizar el input con retiros ya registrados
        if (existente && inputRetirados && !ctx.preRetirados) {
            inputRetirados.value = (existente.retirados || '').toString().toUpperCase() === 'NO HUBO RETIROS' ? '' : existente.retirados;
        }

        const premioOrig = parseFloat(existente?.premio_oficial ?? tabla?.premio_original ?? 100) || 100;
        const sumaBase = parseFloat(tabla?.suma_base_tabla ?? 160) || 160;
        const premioInicial = parseFloat(existente?.premio_recalculado ?? tabla?.premio_recalculado ?? premioOrig) || premioOrig;

        window.clubModalResultado.abrir({
            titulo: 'Carga de Resultados',
            subtitulo: `${ctx.hipodromo || '-'} · Carrera ${ctx.carrera ?? '-'} · ${ctx.fecha}${tabla ? ' · Premio a Pagar/Tabla: $' + clubUI.formatoNumero(tabla.premio_recalculado, 2) : ''}`,
            datosIniciales: { premioOriginal: premioOrig, sumaBase: sumaBase, premioRecalculado: premioInicial },
            ejemplares: conRetirosInput,
            onRegistrar: async (datos) => {
                if (inputRetirados) {
                    const ret = datos.retirados || [];
                    inputRetirados.value = ret.length ? ret.join(', ') : '';
                }
                modalProcesando.classList.remove('hidden');
                window.clubIndicador?.accion('Guardando resultado central y aplicando a tablas…');
                try {
                    await aplicarResultadoATablas(ctx, datos);
                    const guardado = await guardarResultadoCentral(ctx, datos, null);
                    actualizarChipResultado({ ...guardado.fila }, !!guardado.fila.dividendos && Object.keys(guardado.fila.dividendos).length);
                } finally {
                    modalProcesando.classList.add('hidden');
                    window.clubIndicador?.fin();
                }
                return true;
            }
        });
    }

    async function abrirModalDividendos(ctx, datos, dividendosPrevios) {
        try {
            const { data: tickets } = await window.supabase.from('tickets_apuestas')
                .select('*').eq('hipodromo', ctx.hipodromo).eq('carrera', parseInt(ctx.carrera, 10));
            const ganadores = (datos.ejemplares || []).filter(e => e.ganador).map(e => String(e.numero));
            const calcRes = window.clubDividendos?.calcular(tickets || [], ganadores) || { sugeridos: {}, por_tipo: {}, pool_total: 0, orden: ganadores };
            const sugeridos = calcRes.sugeridos || {};
            const poolTotal = calcRes.pool_total || 0;
            const porTipo = calcRes.por_tipo || {};

            const modal = document.getElementById('modalDividendos');
            const resumen = document.getElementById('divResumenCarrera');
            const grid = document.getElementById('gridDividendos');
            const resumenPool = document.getElementById('divResumenPool');
            if (!modal || !grid) return;

            if (resumen) resumen.textContent = `${ctx.hipodromo} · Carrera ${ctx.carrera} · ${ctx.fecha} · Ganador: ${calcRes.orden.join(', ') || '—'}`;
            grid.innerHTML = '';
            window.clubDividendos.CLAVES.forEach(clave => {
                const label = DIV_LABELS[clave] || clave;
                const val = dividendosPrevios?.[clave] != null ? dividendosPrevios[clave] : (sugeridos[clave] ?? '');
                const div = document.createElement('div');
                div.innerHTML = `
                    <label class="block text-[10px] font-black uppercase tracking-wider text-indigo-700 mb-0.5" for="div-${clave}">${label}</label>
                    <div class="relative">
                        <span class="absolute left-2 top-1.5 text-[10px] font-black text-slate-400">$</span>
                        <input type="number" step="0.01" min="0" id="div-${clave}" value="${val}" placeholder="—"
                               class="w-full border border-slate-300 rounded-lg pl-6 pr-2 py-1.5 text-sm font-black text-emerald-700 outline-none focus:ring-2 focus:ring-indigo-500"
                               title="Pago por cada $1 apostado a ${label}">
                    </div>`;
                grid.appendChild(div);
            });
            if (resumenPool) {
                resumenPool.innerHTML = `
                    <p class="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1"><i class="fas fa-money-bill-wave text-emerald-500 mr-1"></i> Pozo de la carrera: $${clubUI.formatoNumero(poolTotal, 2)}</p>
                    <p class="text-[9px] text-slate-500 leading-relaxed">WIN $${clubUI.formatoNumero(porTipo.win || 0, 2)} · PLACE $${clubUI.formatoNumero(porTipo.place || 0, 2)} · SHOW $${clubUI.formatoNumero(porTipo.show || 0, 2)} · PUESTOS $${clubUI.formatoNumero(porTipo.puestos || 0, 2)} · MARCAS $${clubUI.formatoNumero(porTipo.marcas || 0, 2)}</p>`;
            }
            modal.classList.remove('hidden');
        } catch (e) {
            console.error('Error abriendo dividendos:', e);
            clubUI.toast('No se pudo abrir el registro de dividendos: ' + (e?.message || e), 'error');
        }
    }

    function leerDividendosDelModal() {
        const divs = {};
        window.clubDividendos.CLAVES.forEach(clave => {
            const inp = document.getElementById('div-' + clave);
            const v = inp ? parseFloat(inp.value) : null;
            if (v && v > 0) divs[clave] = v;
        });
        return divs;
    }

    document.getElementById('btnGuardarDividendos')?.addEventListener('click', async () => {
        const ctx = ctxResultado();
        const divs = leerDividendosDelModal();
        try {
            const { data } = await window.supabase.from('resultados_carreras').select('*')
                .eq('fecha', ctx.fecha).eq('hipodromo', ctx.hipodromo).eq('carrera', parseInt(ctx.carrera, 10)).maybeSingle();
            if (!data) { clubUI.toast('Primero registre el resultado de la carrera.', 'warning'); return; }
            const { error } = await window.supabase.from('resultados_carreras').update({ dividendos: divs, updated_at: new Date().toISOString() })
                .eq('fecha', ctx.fecha).eq('hipodromo', ctx.hipodromo).eq('carrera', parseInt(ctx.carrera, 10));
            if (error) throw error;
            document.getElementById('modalDividendos').classList.add('hidden');
            actualizarChipResultado(data, true);
            clubUI.aviso('Dividendos guardados', 'Pago por $1: ' + Object.entries(divs).map(([k, v]) => `<b>${DIV_LABELS[k]}</b> $${v}`).join(' · ') || 'Sin dividendos.', 'success');
            if (window.clubDB?.logAccion) window.clubDB.logAccion('TAQUILLA', `dividendos_guardados: ${JSON.stringify(divs)} (${ctx.hipodromo} C${ctx.carrera})`);
        } catch (err) {
            clubUI.toast('Error al guardar dividendos: ' + (err?.message || err), 'error');
        }
    });

    document.getElementById('btnCerrarSinDividendos')?.addEventListener('click', () => {
        document.getElementById('modalDividendos').classList.add('hidden');
    });

    document.getElementById('cerrarModalDividendos')?.addEventListener('click', () => {
        document.getElementById('modalDividendos').classList.add('hidden');
    });

    btnPreliminarResultado?.addEventListener('click', abrirCargaResultados);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            abrirCargaResultados();
        }
    });

    // Estado inicial del chip: si ya hay resultado hoy, mostrarlo
    (async () => {
        try {
            const ctx = ctxResultado();
            const res = await resultadoCargado(ctx);
            actualizarChipResultado(res, res?.dividendos && Object.keys(res.dividendos).length ? true : false);
        } catch (e) { /* silencioso */ }
    })();

    // Refrescar el chip al cambiar hipódromo/carrera/fecha
    [fHipo, fCarrera, fFecha].forEach(el => el?.addEventListener('change', async () => {
        const ctx = ctxResultado();
        if (!ctx.hipodromo || !ctx.carrera) { actualizarChipResultado(null); return; }
        try {
            const res = await resultadoCargado(ctx);
            actualizarChipResultado(res, res?.dividendos && Object.keys(res.dividendos).length ? true : false);
        } catch (e) { /* silencioso */ }
    }));

    // ------------------------------------------------------------------
    // VENTANA FLOTANTE: COMANDOS RÁPIDOS
    // Luis +100 (abono) · Juan -100 (retiro) · Frank 100 Luis (traslado)
    // Luis aval +100 (otorgar aval) · Pedro aval -50 (pagar aval)
    // ------------------------------------------------------------------
    const ventana = document.getElementById('ventanaTransacciones');
    const cabecera = document.getElementById('cabeceraTransacciones');
    let isDragging = false, offsetX, offsetY;

    cabecera.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - ventana.getBoundingClientRect().left;
        offsetY = e.clientY - ventana.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        ventana.style.left = `${e.clientX - offsetX}px`;
        ventana.style.top = `${e.clientY - offsetY}px`;
        ventana.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => isDragging = false);

    const textoTransacciones = document.getElementById('textoTransacciones');
    const resultadoTransacciones = document.getElementById('resultadoTransacciones');
    const btnProcesarTransacciones = document.getElementById('btnProcesarTransacciones');
    const btnLimpiarTransacciones = document.getElementById('btnLimpiarTransacciones');

    // Columnas reales de depositos (tolerante si falta el SQL)
    let colsDepCmd = null;
    async function columnasDepositosCmd() {
        if (colsDepCmd) return colsDepCmd;
        try {
            const { data } = await window.supabase.from('depositos').select('*').limit(1);
            colsDepCmd = (data && data[0]) ? new Set(Object.keys(data[0])) : null;
        } catch (e) { colsDepCmd = null; }
        return colsDepCmd;
    }

    function resolverClienteRapido(nombre) {
        const n = (nombre || '').trim().toUpperCase();
        if (!n) return { error: 'nombre vacío' };
        const clave = (c) => ((c.seudonimo || c.nombre || '').trim().toUpperCase());
        const exactos = clientesList.filter(c => clave(c) === n || (c.nombre || '').trim().toUpperCase() === n);
        if (exactos.length === 1) return { cliente: exactos[0] };
        if (exactos.length > 1) return { error: `cliente ambiguo "${nombre}"` };
        const parcial = clientesList.filter(c => clave(c).includes(n) || (c.nombre || '').toUpperCase().includes(n));
        if (parcial.length === 1) return { cliente: parcial[0] };
        if (parcial.length > 1) return { error: `cliente ambiguo "${nombre}"` };
        return { error: `cliente "${nombre}" no encontrado` };
    }

    function parsearComando(linea) {
        const t = (linea || '').trim().replace(/\s+/g, ' ');
        if (!t || t.startsWith('#')) return null;
        let m = t.match(/^(.+?)\s+aval\s*([+-])\s*(\d+(?:\.\d+)?)$/i);
        if (m) return { tipo: m[2] === '+' ? 'otorgar_aval' : 'pagar_aval', nombre: m[1].trim(), monto: parseFloat(m[3]) };
        m = t.match(/^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
        if (m) return { tipo: m[2] === '+' ? 'abono' : 'retiro', nombre: m[1].trim(), monto: parseFloat(m[3]) };
        m = t.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+(.+)$/);
        if (m) return { tipo: 'traslado', origen: m[1].trim(), monto: parseFloat(m[2]), destino: m[3].trim() };
        return { error: `formato no reconocido: "${t}"` };
    }

    async function procesarTransacciones() {
        const lineas = (textoTransacciones.value || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        if (lineas.length === 0) return clubUI.toast('Escriba al menos un comando.', 'warning');
        await columnasDepositosCmd();
        const filtrar = (obj) => (!colsDepCmd ? obj : Object.fromEntries(Object.entries(obj).filter(([k]) => colsDepCmd.has(k))));

        btnProcesarTransacciones.disabled = true;
        window.clubIndicador?.accion('Procesando comandos rápidos…');

        // Saldos en memoria (sembrados desde lo cargado) para que varias
        // líneas del mismo cliente en un lote queden consistentes entre sí.
        const saldos = new Map(clientesList.map(c => [c.id, { saldo: parseFloat(c.saldo_actual || 0), aval: parseFloat(c.aval || 0) }]));
        const bal = (id) => saldos.get(id);
        const okLineas = [], errLineas = [];
        const fmt = (v) => '$' + clubUI.formatoNumero(v, 2);

        async function filaDeposito(fila) {
            const { error } = await window.supabase.from('depositos').insert([filtrar(fila)]);
            if (error) throw new Error('no se pudo guardar el historial: ' + (error.message || 'BD'));
        }
        async function guardarCliente(id) {
            const b = bal(id);
            const { error } = await window.supabase.from('clientes').update({ saldo_actual: b.saldo, aval: b.aval }).eq('id', id);
            if (error) throw new Error('no se pudo actualizar el saldo: ' + (error.message || 'BD'));
        }
        const baseFila = (c) => ({
            cliente_id: c.id, cliente_nombre: c.seudonimo || c.nombre,
            modalidad: 'TAQUILLA · comando rápido',
            banco_id: null, banco_nombre: null, banco_codigo: null, referencia: null,
            moneda: 'USD', tasa_cambio: 1
        });

        for (const linea of lineas) {
            try {
                const cmd = parsearComando(linea);
                if (!cmd) continue;
                if (cmd.error) throw new Error(cmd.error);
                if (!(cmd.monto > 0)) throw new Error(`monto inválido en "${linea}"`);

                if (cmd.tipo === 'abono' || cmd.tipo === 'retiro' || cmd.tipo === 'otorgar_aval' || cmd.tipo === 'pagar_aval') {
                    const r = resolverClienteRapido(cmd.nombre);
                    if (r.error) throw new Error(r.error);
                    const c = r.cliente, b = bal(c.id);
                    if (cmd.tipo === 'abono') {
                        b.saldo += cmd.monto;
                        await filaDeposito({ ...baseFila(c), tipo_operacion: 'Normal', monto: cmd.monto, monto_usd: cmd.monto, nota: `Abono (comando rápido taquilla): ${linea}` });
                        await guardarCliente(c.id);
                        okLineas.push(`✓ ${linea} → saldo ${fmt(b.saldo)}`);
                    } else if (cmd.tipo === 'retiro') {
                        if ((b.saldo - cmd.monto) < -b.aval) throw new Error(`${c.seudonimo || c.nombre} superaría su límite de AVAL (${fmt(b.aval)}). Debe abonar antes.`);
                        b.saldo -= cmd.monto;
                        await filaDeposito({ ...baseFila(c), tipo_operacion: 'Normal', monto: -cmd.monto, monto_usd: -cmd.monto, nota: `Retiro/pago (comando rápido taquilla): ${linea}` });
                        await guardarCliente(c.id);
                        okLineas.push(`✓ ${linea} → saldo ${fmt(b.saldo)}`);
                    } else if (cmd.tipo === 'otorgar_aval') {
                        b.saldo += cmd.monto; b.aval += cmd.monto;
                        await filaDeposito({ ...baseFila(c), tipo_operacion: 'Otorgar Aval', monto: cmd.monto, monto_usd: cmd.monto, nota: `Otorgar aval (comando rápido taquilla): ${linea}` });
                        await guardarCliente(c.id);
                        okLineas.push(`✓ ${linea} → aval ${fmt(b.aval)}`);
                    } else {
                        if (b.aval <= 0) throw new Error(`${c.seudonimo || c.nombre} no tiene aval pendiente.`);
                        const aplicado = Math.min(cmd.monto, b.aval);
                        b.aval -= aplicado;
                        await filaDeposito({ ...baseFila(c), tipo_operacion: 'Pagar Aval', monto: aplicado, monto_usd: aplicado, nota: `Pagar aval (comando rápido taquilla): ${linea}` });
                        await guardarCliente(c.id);
                        okLineas.push(`✓ ${linea} → aval ${fmt(b.aval)}`);
                    }
                } else if (cmd.tipo === 'traslado') {
                    const ro = resolverClienteRapido(cmd.origen);
                    if (ro.error) throw new Error(ro.error);
                    const rd = resolverClienteRapido(cmd.destino);
                    if (rd.error) throw new Error(rd.error);
                    if (ro.cliente.id === rd.cliente.id) throw new Error('origen y destino son el mismo cliente.');
                    const bo = bal(ro.cliente.id), bd = bal(rd.cliente.id);
                    if ((bo.saldo - cmd.monto) < -bo.aval) throw new Error(`${ro.cliente.seudonimo || ro.cliente.nombre} superaría su límite de AVAL (${fmt(bo.aval)}). Debe abonar antes.`);
                    bo.saldo -= cmd.monto; bd.saldo += cmd.monto;
                    await filaDeposito({ ...baseFila(ro.cliente), tipo_operacion: 'Normal', monto: -cmd.monto, monto_usd: -cmd.monto, nota: `Traslado a ${rd.cliente.seudonimo || rd.cliente.nombre} (comando rápido taquilla): ${linea}` });
                    await filaDeposito({ ...baseFila(rd.cliente), tipo_operacion: 'Normal', monto: cmd.monto, monto_usd: cmd.monto, nota: `Traslado desde ${ro.cliente.seudonimo || ro.cliente.nombre} (comando rápido taquilla): ${linea}` });
                    await guardarCliente(ro.cliente.id);
                    await guardarCliente(rd.cliente.id);
                    okLineas.push(`✓ ${linea} → ${fmt(bo.saldo)} / ${fmt(bd.saldo)}`);
                }
            } catch (eOp) {
                errLineas.push(`✗ ${linea} → ${eOp.message || eOp}`);
            }
        }

        // Refresca saldos para las jugadas de taquilla
        try {
            const { data } = await window.supabase.from('clientes').select('*').order('nombre');
            if (data) {
                clientesList = data;
                datalistClientes.innerHTML = '';
                data.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.seudonimo || c.nombre;
                    datalistClientes.appendChild(opt);
                });
            }
        } catch (e) { /* nada */ }

        if (resultadoTransacciones) {
            resultadoTransacciones.classList.remove('hidden');
            resultadoTransacciones.innerHTML =
                okLineas.map(l => `<p class="text-emerald-700 font-bold">${l}</p>`).join('') +
                errLineas.map(l => `<p class="text-red-600 font-bold">${l}</p>`).join('') || '<p class="text-slate-400 italic">Sin líneas procesables.</p>';
        }
        if (window.clubDB?.logAccion) window.clubDB.logAccion('TAQUILLA', `comandos_rapidos: ${okLineas.length} ok, ${errLineas.length} errores`);
        clubUI.toast(
            errLineas.length === 0 ? `Comandos listos: ${okLineas.length} aplicado(s).` : `${okLineas.length} aplicado(s), ${errLineas.length} con error (ver detalle en la ventana).`,
            errLineas.length === 0 ? 'success' : 'warning');

        btnProcesarTransacciones.disabled = false;
        window.clubIndicador?.fin();
    }

    btnProcesarTransacciones?.addEventListener('click', procesarTransacciones);
    btnLimpiarTransacciones?.addEventListener('click', () => {
        textoTransacciones.value = '';
        if (resultadoTransacciones) { resultadoTransacciones.innerHTML = ''; resultadoTransacciones.classList.add('hidden'); }
        textoTransacciones.focus();
    });
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
            e.preventDefault();
            procesarTransacciones();
        }
    });

    inicializarDatos();
});