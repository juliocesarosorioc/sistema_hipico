/* R23-FIX-CARRERAS-COLORES-ESTADO
   Actualiza poblarCarrerasDeHoy en taquilla.js:
   - Colores por estado: pendiente=amarillo, abierta=verde, cerrada=rojo
   - Selección activa: anillo azul
   - Contenedor horizontal scroll (ya aplicado)
   - Filtro por fecha/hipódromo (ya implementado) */
var fs = require('fs');
var file = 'C:/Users/julio/sistema_hipico/js/taquilla.js';
var js = fs.readFileSync(file, 'utf8');

var nuevo = js.replace(
  /async function poblarCarrerasDeHoy\(\) \{[\s\S]*?poblarCarrerasDeHoy\(\);/,
  `async function poblarCarrerasDeHoy() {
        const cont = document.getElementById('carrerasDeHoy');
        const selCarr = document.getElementById('selectCarrera');
        const selHip = document.getElementById('selectHipodromo');
        const fc = document.getElementById('fechaCarrera');
        if (!cont || !selCarr) return;
        const hip = selHip?.value || '';
        const fecha = fc?.value || new Date().toISOString().slice(0, 10);
        let nums = [...selCarr.options].map(o => o.value);
        let carrerasInfo = {};
        try {
            const prog = window.clubPrograma?.cargar ? await window.clubPrograma.cargar() : null;
            const lista = (prog && Array.isArray(prog.carreras)) ? prog.carreras : [];
            if (lista.length) {
                nums = lista.map(c => String(c.carrera ?? c.numero ?? c));
                lista.forEach(c => {
                    const key = String(c.carrera ?? c.numero ?? c);
                    carrerasInfo[key] = {
                        estado: (c.estado || c.status || 'pendiente').toLowerCase(),
                        hora: c.hora || c.hora_carrera || ''
                    };
                });
            }
        } catch (e) { /* respaldo: opciones del selector */ }
        if (!fc?.value) { fc.value = new Date().toISOString().slice(0, 10); }
        if (!nums.length) {
            cont.innerHTML = '<span class="text-[10px] text-slate-400">Sin carreras cargadas hoy.</span>';
            return;
        }
        let contadas = {};
        try {
            const q = window.supabase.from('tickets_jugadas').select('carrera').eq('fecha_carrera', fecha);
            if (hip) q.eq('hipodromo', hip);
            const { data, error } = await q;
            if (error) throw error;
            (data || []).forEach(t => { contadas[String(t.carrera)] = (contadas[String(t.carrera)] || 0) + 1; });
        } catch (e) { /* sin base o columna distinta */ }
        cont.innerHTML = nums.map(num => {
            const n = contadas[num] || 0;
            const activa = String(selCarr.value) === String(num);
            const info = carrerasInfo[num] || {};
            const estado = info.estado || 'pendiente';
            let cls = '';
            if (activa) {
                cls = 'ring-2 ring-blue-500 bg-blue-600 text-white';
            } else if (estado === 'abierta' || estado === 'open') {
                cls = 'bg-emerald-100 text-emerald-800 border border-emerald-300';
            } else if (estado === 'cerrada' || estado === 'closed' || estado === 'finalizada') {
                cls = 'bg-red-100 text-red-800 border border-red-300';
            } else {
                cls = 'bg-amber-100 text-amber-800 border border-amber-300';
            }
            const nDisplay = n ? ' · ' + n : '';
            return '<button type="button" data-carrera="' + num + '" class="carreraDeHoyChip px-2 py-0.5 rounded text-[10px] font-bold ' + cls + '">C' + num + nDisplay + '</button>';
        }).join(' ');
        cont.querySelectorAll('.carreraDeHoyChip').forEach(btn => {
            btn.addEventListener('click', () => {
                selCarr.value = btn.getAttribute('data-carrera');
                selCarr.dispatchEvent(new Event('change'));
                poblarCarrerasDeHoy();
            });
        });
    }
    [document.getElementById('selectHipodromo'), document.getElementById('selectCarrera')].forEach(el => el?.addEventListener('change', poblarCarrerasDeHoy));
    window.clubCarrerasDeHoy = poblarCarrerasDeHoy;
    poblarCarrerasDeHoy();`
);

fs.writeFileSync('C:/Users/julio/sistema_hipico/js/taquilla.js', nuevo, 'utf8');
console.log('ACTUALIZADO poblarCarrerasDeHoy con colores por estado');