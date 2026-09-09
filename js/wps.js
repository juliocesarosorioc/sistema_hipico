// Archivo: js/wps.js
// Propósito: Motor lógico WPS, cálculo de dividendos americanos y gestión de saldos.

document.addEventListener('DOMContentLoaded', () => {

    const formRegistrar = document.getElementById('formRegistrarJugadaWPS');
    const formProcesar = document.getElementById('formProcesarCarreraWPS');
    const formRetirados = document.getElementById('formRetiradosWPS');
    const tablaJugadas = document.getElementById('tablaJugadasHoy');
    
    document.getElementById('fechaHeader').textContent = new Date().toLocaleString('es-ES');

    let clientesGlobal = [];
    
    // ==========================================
    // 1. CARGAR DATOS BASE (Hipódromos, Clientes y Tabla)
    // ==========================================
    async function inicializarModulo() {
        // Cargar Hipódromos en los 3 selects
        const { data: hipodromos } = await supabase.from('hipodromos').select('id, nombre').order('nombre');
        const optionsHip = hipodromos ? hipodromos.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('') : '';
        const opcBase = '<option value="">— Selecciona —</option>';
        
        document.getElementById('wpsHipodromo').innerHTML = opcBase + optionsHip;
        document.getElementById('procHipodromo').innerHTML = opcBase + optionsHip;
        document.getElementById('retHipodromo').innerHTML = opcBase + optionsHip;

        // Cargar Clientes
        const { data: clientes } = await supabase.from('clientes').select('id, nombre, saldo_actual, aval, libre, modo_juego').order('nombre');
        if (clientes) {
            clientesGlobal = clientes;
            document.getElementById('wpsCliente').innerHTML = opcBase + clientes.map(c => `<option value="${c.id}">${c.nombre} (Disp: $${clubUI.formatoNumero(Number(c.saldo_actual), 2)})</option>`).join('');
        }

        cargarJugadasHoy();
    }

    async function cargarJugadasHoy() {
        // Traemos los tickets ordenados
        const inicioDia = new Date();
        inicioDia.setHours(0,0,0,0);

        const { data: tickets } = await supabase
            .from('wps_tickets')
            .select(`*, clientes(nombre), hipodromos(nombre)`)
            .gte('fecha_registro', inicioDia.toISOString())
            .order('fecha_registro', { ascending: false });

        if (!tickets || tickets.length === 0) {
            tablaJugadas.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-500">Sin jugadas registradas hoy.</td></tr>';
            return;
        }

        tablaJugadas.innerHTML = '';
        tickets.forEach(t => {
            const hora = new Date(t.fecha_registro).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'});
            const cli = t.clientes ? t.clientes.nombre : '—';
            const hip = t.hipodromos ? t.hipodromos.nombre : '—';
            
            let colorEstado = 'bg-slate-200 text-slate-700';
            if (t.estado === 'Ganador') colorEstado = 'bg-emerald-100 text-emerald-700';
            else if (t.estado === 'Perdedor') colorEstado = 'bg-red-100 text-red-700';
            else if (t.estado === 'Retirado') colorEstado = 'bg-amber-100 text-amber-700';

            tablaJugadas.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="p-2 text-slate-500">${hora}</td>
                    <td class="p-2 font-bold">${cli}</td>
                    <td class="p-2">${hip}</td>
                    <td class="p-2 text-center font-bold">${t.carrera}</td>
                    <td class="p-2 text-center font-bold text-slate-800">${t.caballo}</td>
                    <td class="p-2 text-center font-bold text-blue-600">${t.tipo}</td>
                    <td class="p-2 text-right font-bold text-slate-700">$${clubUI.formatoNumero(Number(t.monto_usd), 2)}</td>
                    <td class="p-2 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${colorEstado}">${t.estado}</span></td>
                    <td class="p-2 text-right font-bold ${t.premio > 0 ? 'text-emerald-600' : 'text-slate-400'}">$${clubUI.formatoNumero(Number(t.premio), 2)}</td>
                </tr>
            `;
        });
    }

    // ==========================================
    // 2. REGISTRAR JUGADA Y DESCONTAR SALDO
    // ==========================================
    if (formRegistrar) {
        formRegistrar.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const checks = ['chkW', 'chkP', 'chkS'].filter(id => document.getElementById(id).checked);
            if (checks.length === 0) { clubUI.toast("Seleccione al menos un tipo (W, P o S)."); return; }

            const clienteId = document.getElementById('wpsCliente').value;
            const montoPorJugada = parseFloat(document.getElementById('wpsMonto').value);
            const montoTotal = montoPorJugada * checks.length;
            
            const cliente = clientesGlobal.find(c => c.id === clienteId);

            // REGLA DE NEGOCIO (AVAL): límite de pérdida. Si no juega libre,
            // su saldo puede quedar negativo pero nunca pasar de -AVAL.
            // Si juega con POZO, solo puede jugar lo que tiene abonado.
            const nuevoSaldo = Number(cliente.saldo_actual) - montoTotal;
            const modoJuega = cliente.modo_juego || (cliente.libre ? 'libre' : 'aval');
            if (modoJuega === 'pozo') {
                if (montoTotal > Number(cliente.saldo_actual)) {
                    return clubUI.toast(`El cliente ${cliente.nombre} juega con Pozo y no tiene saldo disponible (tiene $${clubUI.formatoNumero(cliente.saldo_actual, 2)} y esta jugada cuesta $${clubUI.formatoNumero(montoTotal, 2)}). Debe abonar antes de jugar.`);
                }
            } else if (!cliente.libre) {
                const limiteAval = parseFloat(cliente.aval || 0);
                if (nuevoSaldo < -limiteAval) {
                    return clubUI.toast(`El cliente ${cliente.nombre} supera su límite de AVAL ($${clubUI.formatoNumero(limiteAval, 2)}). Debe abonar antes de jugar.`);
                }
            } else if (montoTotal > cliente.saldo_actual) {
                if(!confirm(`Saldo insuficiente (Tiene $${cliente.saldo_actual}). ¿Forzar jugada en negativo?`)) return;
            }

            const btn = this.querySelector('button[type="submit"]');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...'; btn.disabled = true;

            // Descontar total
            await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', clienteId);
            cliente.saldo_actual = nuevoSaldo; // actualizar caché

            // Insertar tickets (uno por cada tipo seleccionado)
            const promesas = checks.map(id => {
                const tipoLetra = document.getElementById(id).value;
                return supabase.from('wps_tickets').insert([{
                    cliente_id: clienteId,
                    hipodromo_id: document.getElementById('wpsHipodromo').value,
                    carrera: document.getElementById('wpsCarrera').value,
                    caballo: document.getElementById('wpsCaballo').value.trim().toUpperCase(),
                    tipo: tipoLetra,
                    monto_usd: montoPorJugada
                }]);
            });

            await Promise.all(promesas);

            this.reset();
            btn.innerHTML = 'Registrar Jugada'; btn.disabled = false;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('WPS', `jugadas_registradas: ${cliente.nombre} ${checks.length} tipo(s) x $${montoPorJugada} (${document.getElementById('wpsHipodromo').value} C${document.getElementById('wpsCarrera').value})`);
            inicializarModulo(); // Recargar todo para actualizar saldos en el select y la tabla
        });
    }

    // ==========================================
    // 3. PROCESAR RESULTADOS Y PAGAR
    // ==========================================
    if (formProcesar) {
        formProcesar.addEventListener('submit', async function(e) {
            e.preventDefault();
            if(!confirm("¿Confirma procesar los resultados oficiales?\nSe abonarán los premios automáticamente.")) return;

            const btn = this.querySelector('button[type="submit"]');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...'; btn.disabled = true;

            const hipodromoId = document.getElementById('procHipodromo').value;
            const carrera = document.getElementById('procCarrera').value;

            // Caballos ganadores
            const winCab = document.getElementById('procGanador').value.trim().toUpperCase();
            const plaCab = document.getElementById('procPlace').value.trim().toUpperCase();
            const shoCab = document.getElementById('procShow').value.trim().toUpperCase();

            // Leer matriz de dividendos (Parsear a 0 si están vacíos)
            const getNum = (id) => parseFloat(document.getElementById(id).value) || 0;
            const div = {
                WW: getNum('divWinWin'), WP: getNum('divWinPlace'), WS: getNum('divWinShow'),
                PP: getNum('divPlacePlace'), PS: getNum('divPlaceShow'),
                SS: getNum('divShowShow')
            };

            // Traer tickets pendientes de esta carrera
            const { data: pendientes } = await supabase.from('wps_tickets')
                .select('*')
                .eq('hipodromo_id', hipodromoId)
                .eq('carrera', carrera)
                .eq('estado', 'Pendiente');

            if (pendientes && pendientes.length > 0) {
                // Diccionario temporal para acumular los premios por cliente y sumarles el saldo de una vez
                let abonosPorCliente = {};
                
                for (let t of pendientes) {
                    let premio = 0;
                    let estado = 'Perdedor';

                    // LÓGICA DE DIVIDENDOS (Monto / 2 * Dividendo)
                    const basePremio = (Number(t.monto_usd) / 2);

                    if (t.tipo === 'W' && t.caballo === winCab) { premio = basePremio * div.WW; }
                    
                    else if (t.tipo === 'P') {
                        if (t.caballo === winCab) premio = basePremio * div.WP;
                        else if (t.caballo === plaCab) premio = basePremio * div.PP;
                    }
                    
                    else if (t.tipo === 'S') {
                        if (t.caballo === winCab) premio = basePremio * div.WS;
                        else if (t.caballo === plaCab) premio = basePremio * div.PS;
                        else if (t.caballo === shoCab) premio = basePremio * div.SS;
                    }

                    if (premio > 0) {
                        estado = 'Ganador';
                        abonosPorCliente[t.cliente_id] = (abonosPorCliente[t.cliente_id] || 0) + premio;
                    }

                    // Actualizar el estado del ticket en BD
                    await supabase.from('wps_tickets').update({ estado: estado, premio: premio }).eq('id', t.id);
                }

                // Abonar premios acumulados a los saldos de los clientes
                for (let cId in abonosPorCliente) {
                    const premioTotal = abonosPorCliente[cId];
                    const clienteActual = clientesGlobal.find(c => c.id === cId);
                    if (clienteActual) {
                        const nuevoSaldo = Number(clienteActual.saldo_actual) + premioTotal;
                        await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', cId);
                    }
                }
            }

            clubUI.toast("✅ Carrera procesada. Saldos y premios actualizados.");
            this.reset();
            btn.innerHTML = 'Procesar y Pagar'; btn.disabled = false;
            if (window.clubDB?.logAccion) window.clubDB.logAccion('WPS', `resultados_procesados: carrera ${carrera} ganador=${winCab} place=${plaCab} show=${shoCab}`);
            inicializarModulo();
        });
    }

    // ==========================================
    // 4. RETIRADOS Y DEVOLUCIONES
    // ==========================================
    if (formRetirados) {
        formRetirados.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const hipodromoId = document.getElementById('retHipodromo').value;
            const carrera = document.getElementById('retCarrera').value;
            const caballosStr = document.getElementById('retCaballos').value.toUpperCase();
            
            if (!confirm(`¿Confirmas retirar a [${caballosStr}]?\nSe devolverá el saldo a los clientes.`)) return;
            
            const btn = this.querySelector('button[type="submit"]');
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true;

            const caballosArr = caballosStr.split(',').map(s => s.trim());

            // Buscar tickets pendientes de esos caballos
            const { data: ticketsAfectados } = await supabase.from('wps_tickets')
                .select('*')
                .eq('hipodromo_id', hipodromoId)
                .eq('carrera', carrera)
                .eq('estado', 'Pendiente')
                .in('caballo', caballosArr);

            if (ticketsAfectados && ticketsAfectados.length > 0) {
                let reembolsos = {};
                
                for (let t of ticketsAfectados) {
                    // Cambiar estado a Retirado
                    await supabase.from('wps_tickets').update({ estado: 'Retirado' }).eq('id', t.id);
                    reembolsos[t.cliente_id] = (reembolsos[t.cliente_id] || 0) + Number(t.monto_usd);
                }

                // Devolver dinero
                for (let cId in reembolsos) {
                    const devuelto = reembolsos[cId];
                    const clienteActual = clientesGlobal.find(c => c.id === cId);
                    if (clienteActual) {
                        const nuevoSaldo = Number(clienteActual.saldo_actual) + devuelto;
                        await supabase.from('clientes').update({ saldo_actual: nuevoSaldo }).eq('id', cId);
                    }
                }
                clubUI.toast(`✅ Caballos retirados. Se reembolsaron ${ticketsAfectados.length} jugadas.`);
                if (window.clubDB?.logAccion) window.clubDB.logAccion('WPS', `retirados: carrera ${carrera} caballos=[${caballosStr}] reembolsos=${ticketsAfectados.length}`);
            } else {
                clubUI.toast("No se encontraron jugadas pendientes para los caballos indicados.");
            }

            this.reset();
            btn.innerHTML = 'Marcar Retirados'; btn.disabled = false;
            inicializarModulo();
        });
    }

    // Arranque
    inicializarModulo();
});