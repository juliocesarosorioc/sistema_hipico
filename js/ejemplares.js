document.addEventListener('DOMContentLoaded', () => {

    const cuerpoPadron = document.getElementById('cuerpoPadron');
    const buscarEjemplar = document.getElementById('buscarEjemplar');

    let padronCompleto = [];

    function fmtFecha(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }

    function renderPadron(filtro = '') {
        const f = filtro.trim().toUpperCase();
        const FLAGS = { VE: '🇻🇪', USA: '🇺🇸', BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽', PA: '🇵🇦', PE: '🇵🇪', CO: '🇨🇴', EC: '🇪🇨', UY: '🇺🇾' };
        const PAISES = { VE: 'Venezuela', USA: 'Estados Unidos', BR: 'Brasil', AR: 'Argentina', CL: 'Chile', MX: 'México', PA: 'Panamá', PE: 'Perú', CO: 'Colombia', EC: 'Ecuador', UY: 'Uruguay' };
        const filas = padronCompleto
            .filter(e => !f || e.nombre.includes(f) || e.nacionalidad.includes(f))
            .sort((a, b) => b.totalTablas - a.totalTablas || (a.nombre > b.nombre ? 1 : -1));

        document.getElementById('statEjemplares').textContent = padronCompleto.length;
        document.getElementById('statNacionalidades').textContent = new Set(padronCompleto.map(e => e.nacionalidad)).size;
        document.getElementById('statVinculados').textContent = padronCompleto.filter(e => e.totalTablas > 0).length;

        // Chips de nacionalidad con bandera: clic filtra el listado
        const gridNac = document.getElementById('gridNacionalidades');
        const porNac = {};
        padronCompleto.forEach(e => {
            const nac = (e.nacionalidad || 'VE').toUpperCase();
            porNac[nac] = (porNac[nac] || 0) + 1;
        });
        const chipsNac = Object.entries(porNac)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([nac, n]) => {
                const active = f && f === nac;
                return `<button type="button" class="chk-nacionalidad inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-black border transition-colors ${active ? 'bg-amber-500 text-white border-amber-600 shadow' : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'}" data-nac="${nac}" title="${PAISES[nac] || nac} — toque para filtrar">
                    <span class="w-5 h-5 flex items-center justify-center rounded-full bg-white shadow-sm border border-slate-200 text-sm leading-none">${FLAGS[nac] || '🏳️'}</span>
                    <span>${nac}</span>
                    <span class="rounded-full ${active ? 'bg-white/25' : 'bg-white'} px-1.5 text-[10px]">${n}</span>
                </button>`;
            }).join('') || '<p class="text-[11px] text-slate-400 italic">Sin ejemplares registrados.</p>';
        if (gridNac) {
            gridNac.innerHTML = chipsNac;
            gridNac.querySelectorAll('.chk-nacionalidad').forEach(chip => {
                chip.addEventListener('click', () => {
                    const nac = chip.dataset.nac;
                    if (buscarEjemplar.value.trim().toUpperCase() === nac) {
                        buscarEjemplar.value = '';
                    } else {
                        buscarEjemplar.value = nac;
                    }
                    renderPadron(buscarEjemplar.value);
                });
            });
        }

        if (filas.length === 0) {
            cuerpoPadron.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 italic">Sin resultados.</td></tr>';
            return;
        }

        cuerpoPadron.innerHTML = filas.map(e => {
            const nac = (e.nacionalidad || 'VE').toUpperCase();
            const flag = FLAGS[nac] || '🏳️';
            const pais = PAISES[nac] || nac;
            return `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="p-2 font-bold">${e.nombre}</td>
                <td class="p-2 text-center">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black ${nac === 'VE' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-50 text-slate-700 border border-slate-200'}" title="${pais}">
                        <span class="w-5 h-5 flex items-center justify-center rounded-full bg-white shadow-sm border border-slate-200 text-sm leading-none">${flag}</span>
                        <span>${nac}</span>
                    </span>
                </td>
                <td class="p-2 text-center font-bold ${e.totalTablas > 0 ? 'text-emerald-600' : 'text-slate-400'}">${e.totalTablas || 0}</td>
                <td class="p-2 text-slate-600">${e.ultimaTabla || '-'}</td>
                <td class="p-2 text-right text-slate-500">${fmtFecha(e.registrado)}</td>
            </tr>`;
        }).join('');
    }

    async function cargarPadron() {
        cuerpoPadron.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 italic">Cargando padrón...</td></tr>';
        const gridNac = document.getElementById('gridNacionalidades');
        if (gridNac) gridNac.innerHTML = '<p class="text-[11px] text-slate-400 italic">Cargando nacionalidades...</p>';

        const safe = (p) => p.then(r => ({ data: r.data, error: r.error || null })).catch(e => ({ data: null, error: { message: e?.message || String(e) } }));

        // Lee el padrón intentando la RPC segura (funciona aunque el RLS de
        // ejemplares esté activo); si la RPC no existe, cae al SELECT directo.
        async function leerPadron() {
            const rpc = await safe(window.supabase.rpc('club_listar_ejemplares'));
            if (!rpc.error && Array.isArray(rpc.data)) return rpc;
            return safe(window.supabase.from('ejemplares').select('id, nombre, nacionalidad, created_at').order('nombre'));
        }

        const [rE, rT] = await Promise.all([
            leerPadron(),
            safe(window.supabase.from('tablas_fijas').select('id, hipodromo, carrera, caballos'))
        ]);

        if (rE.error) {
            const mensaje = (rE.error.message || rE.error.code || String(rE.error));
            const rls = /row-level security|permission denied|42501|401/i.test(mensaje);
            cuerpoPadron.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500"><b>Error cargando el padrón.</b><br><span class="text-[11px]">${rls ? 'Permisos bloqueados (RLS). Ejecute el SQL del paquete en Supabase (sección 5 desactiva RLS en ejemplares).' : mensaje}</span></td></tr>`;
            if (gridNac) gridNac.innerHTML = '<p class="text-[11px] text-red-400 italic">No se pudo cargar el padrón: ' + mensaje + '</p>';
            return;
        }

        const ejemplares = rE.data || [];
        const tablas = rT.data || [];
        if (rT.error) {
            console.warn("No se pudieron cargar tablas para el conteo:", rT.error);
            clubUI.toast('No se pudieron cargar las tablas para el conteo: ' + (rT.error.message || rT.error), 'warning');
        }

        const conteo = new Map();   // ejemplar_id -> { tablas:Set, ultimaId, ultimaTxt }
        (tablas || []).forEach(t => {
            (t.caballos || []).forEach(c => {
                if (!c || !c.ejemplar_id) return;
                if (!conteo.has(c.ejemplar_id)) conteo.set(c.ejemplar_id, { tablas: new Set(), ultimaId: 0, ultimaTxt: '' });
                const info = conteo.get(c.ejemplar_id);
                info.tablas.add(t.id);
                if (t.id > info.ultimaId) {
                    info.ultimaId = t.id;
                    info.ultimaTxt = `${t.hipodromo || '?'} C${t.carrera ?? '?'}`;
                }
            });
        });

        padronCompleto = (ejemplares || []).map(e => {
            const info = conteo.get(e.id);
            return {
                nombre: e.nombre,
                nacionalidad: e.nacionalidad || 'VE',
                registrado: e.created_at,
                totalTablas: info ? info.tablas.size : 0,
                ultimaTabla: info ? info.ultimaTxt : ''
            };
        });

        renderPadron(buscarEjemplar.value);
    }

    function exportarCSV() {
        const encabezado = ['Nombre', 'Nacionalidad', 'Apariciones en Tablas', 'Ultima Aparicion'];
        const lineas = [encabezado.join(';')];
        padronCompleto
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
            .forEach(e => lineas.push([e.nombre, e.nacionalidad, e.totalTablas || 0, e.ultimaTabla].join(';')));
        const blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'padron_ejemplares.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    buscarEjemplar.addEventListener('input', () => renderPadron(buscarEjemplar.value));
    document.getElementById('btnRecargarPadron').addEventListener('click', cargarPadron);
    document.getElementById('btnExportarPadron').addEventListener('click', exportarCSV);

    // Al volver a la pestaña "Registro de Ejemplares", refresca el padrón
    // para reflejar los ejemplares registrados desde la Gaceta (IA) o el Ensamblaje.
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab !== 'padron') return;
        btn.addEventListener('click', () => cargarPadron());
    });

    cargarPadron();
});