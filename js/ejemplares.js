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
        const filas = padronCompleto
            .filter(e => !f || e.nombre.includes(f) || e.nacionalidad.includes(f))
            .sort((a, b) => b.totalTablas - a.totalTablas || (a.nombre > b.nombre ? 1 : -1));

        document.getElementById('statEjemplares').textContent = padronCompleto.length;
        document.getElementById('statNacionalidades').textContent = new Set(padronCompleto.map(e => e.nacionalidad)).size;
        document.getElementById('statVinculados').textContent = padronCompleto.filter(e => e.totalTablas > 0).length;

        if (filas.length === 0) {
            cuerpoPadron.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 italic">Sin resultados.</td></tr>';
            return;
        }

        cuerpoPadron.innerHTML = filas.map(e => `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="p-2 font-bold">${e.nombre}</td>
                <td class="p-2 text-center">
                    <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${e.nacionalidad === 'VE' ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}">${e.nacionalidad}</span>
                </td>
                <td class="p-2 text-center font-bold ${e.totalTablas > 0 ? 'text-emerald-600' : 'text-slate-400'}">${e.totalTablas || 0}</td>
                <td class="p-2 text-slate-600">${e.ultimaTabla || '-'}</td>
                <td class="p-2 text-right text-slate-500">${fmtFecha(e.registrado)}</td>
            </tr>
        `).join('');
    }

    async function cargarPadron() {
        cuerpoPadron.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 italic">Cargando padrón...</td></tr>';

        const [{ data: ejemplares, error: errE }, { data: tablas, error: errT }] = await Promise.all([
            window.supabase.from('ejemplares').select('id, nombre, nacionalidad, created_at').order('nombre'),
            window.supabase.from('tablas_fijas').select('id, hipodromo, carrera, caballos')
        ]);

        if (errE) { cuerpoPadron.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-red-500">Error cargando el padrón (¿ejecutó el SQL del paquete?).</td></tr>'; return; }
        if (errT) console.warn("No se pudieron cargar tablas para el conteo:", errT);

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

    cargarPadron();
});