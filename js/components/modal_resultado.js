// ==========================================
// COMPONENTE ESTÁNDAR: MODAL DE RESULTADO DE LA CARRERA (ejemplares/caballos)
// Estilo Ensamblaje. Reutilizable desde cualquier sección:
//   window.clubModalResultado.abrir({
//     titulo: '...',
//     subtitulo: 'Hipódromo · Carrera · Dist. · Superficie · Moneda · Estado',
//     datosIniciales: { premioOriginal, sumaBase, premioRecalculado },
//     ejemplares: [{ numero, nombre, nacionalidad, valor_ejemplar, ganador, retirado, orden, dividendo }],
//     onRegistrar: async (datos) => { /* guarda en BD */ ; return true; }, // true => cierra
//     onCancelar: () => {}
//   });
// Registra POR EJEMPLAR: ganador (varios = empate), orden de llegada,
// dividendo que paga y retiro. La comisión de grupo NO se gestiona aquí:
// solo vive en "Convenios por tipo de jugadas por grupo" (Grupos y Convenios).
// ==========================================
window.clubModalResultado = (() => {
    const NACIONES = ['VE', 'USA', 'BR', 'AR', 'CL', 'MX', 'PA', 'PE', 'CO', 'EC', 'UY', 'OTRA'];
    const BANDERAS = { VE: '🇻🇪', USA: '🇺🇸', BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽', PA: '🇵🇦', PE: '🇵🇪', CO: '🇨🇴', EC: '🇪🇨', UY: '🇺🇾', OTRA: '🏳️' };
    const PALETA = [
        { bg: '#FF0000', fg: '#FFFFFF' }, { bg: '#FFFFFF', fg: '#000000' },
        { bg: '#0000FF', fg: '#FFFFFF' }, { bg: '#FFFF00', fg: '#000000' },
        { bg: '#008000', fg: '#FFFFFF' }, { bg: '#000000', fg: '#FFFF00' },
        { bg: '#FFA500', fg: '#000000' }, { bg: '#FFC0CB', fg: '#000000' },
        { bg: '#40E0D0', fg: '#000000' }, { bg: '#800080', fg: '#FFFFFF' },
        { bg: '#808080', fg: '#FF0000' }, { bg: '#32CD32', fg: '#000000' },
        { bg: '#8B4513', fg: '#FFFFFF' }, { bg: '#800000', fg: '#FFFFFF' }
    ];
    const aNum = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        const n = parseFloat(s.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : null;
    };
    const colorDeNumero = (n) => { const x = parseInt(n, 10); return x ? PALETA[((x - 1) % 14)].bg : '#94a3b8'; };
    const textoDeNumero = (n) => { const x = parseInt(n, 10); return x ? PALETA[((x - 1) % 14)].fg : '#FFFFFF'; };
    const fmt = (v) => { const n = Number(v) || 0; return window.clubUI?.formatoNumero ? window.clubUI.formatoNumero(n, 2) : n.toFixed(2); };

    let raiz = null;
    let conf = null;
    let punteroLista = null;

    function cerrar() {
        if (raiz) { raiz.remove(); raiz = null; }
        conf = null;
        punteroLista = null;
    }

    document.addEventListener('keydown', (e) => {
        if (raiz && e.key === 'Escape') { e.stopPropagation(); cancelar(); }
    });

    function filaHTML(c, i) {
        const num = c?.numero ?? '';
        const nombre = (c?.nombre || '').trim().toUpperCase();
        const nac = (c?.nacionalidad || 'VE').toUpperCase();
        const valor = c?.valor_ejemplar ?? c?.valor ?? '';
        const orden = c?.orden ?? '';
        const dividendo = c?.dividendo ?? '';
        const retirado = !!c?.retirado;
        return `
        <div class="fila-mr flex gap-0.5 items-center bg-slate-50 border rounded px-1 py-0.5 ${retirado ? 'border-red-200 opacity-60' : 'border-slate-200'}">
            <input type="text" inputmode="numeric" class="mr-num w-4 h-5 shrink-0 border rounded px-0 py-px text-center text-[8px] font-black outline-none focus:ring-1 focus:ring-indigo-400" value="${num}" placeholder="Nº" title="Número del ejemplar" style="background-color:${colorDeNumero(num)};color:${textoDeNumero(num)};border-color:${colorDeNumero(num)}">
            <input type="text" class="mr-nombre flex-1 min-w-0 border border-slate-200 rounded px-1 py-px text-[10px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400" value="${nombre}" placeholder="Ejemplar" title="Nombre del ejemplar">
            <select class="mr-nac w-5 shrink-0 border-0 bg-transparent text-[13px] leading-none cursor-pointer" title="Nacionalidad">
                ${NACIONES.map(n => `<option value="${n}" ${nac === n ? 'selected' : ''}>${BANDERAS[n] || '🏳️'}</option>`).join('')}
            </select>
            <input type="text" inputmode="decimal" class="mr-valor w-11 shrink-0 border border-slate-200 rounded px-0.5 py-px text-right text-[11px] font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400 ${retirado ? 'bg-slate-100 text-slate-400' : ''}" value="${valor ?? ''}" placeholder="$" title="Valor / monta del ejemplar">
            <input type="text" inputmode="numeric" class="mr-orden w-6 shrink-0 border border-slate-300 rounded px-0.5 py-px text-center text-[11px] font-black text-slate-700 outline-none focus:ring-1 focus:ring-indigo-400 ${retirado ? 'bg-slate-100 text-slate-400' : ''}" value="${orden ?? ''}" placeholder="L" title="Orden de llegada (1=ganador, 2=segundo...)" style="background-color:${retirado ? '#f1f5f9' : (orden == 1 ? '#fef3c7' : 'transparent')}">
            <input type="text" inputmode="decimal" class="mr-dividendo w-12 shrink-0 border border-slate-300 rounded px-0.5 py-px text-right text-[11px] font-black text-emerald-700 outline-none focus:ring-1 focus:ring-indigo-400 ${retirado ? 'bg-slate-100 text-slate-400' : ''}" value="${dividendo ?? ''}" placeholder="$" title="Dividendo que paga este ejemplar (por $1)">
            <label class="mr-lbl-ganador relative w-5 h-5 shrink-0 flex items-center justify-center rounded cursor-pointer border border-slate-200 bg-white" title="Ganador (marque varios si hubo empate)">
                <input type="checkbox" class="mr-ganador sr-only" data-i="${i}" ${c?.ganador ? 'checked' : ''}>
                <i class="fas fa-trophy text-[9px] pointer-events-none ${c?.ganador ? 'text-amber-500' : 'text-slate-300'}"></i>
            </label>
            <label class="mr-lbl-retiro relative w-5 h-5 shrink-0 flex items-center justify-center rounded cursor-pointer border border-slate-200 bg-white" title="Marcar como retirado">
                <input type="checkbox" class="mr-retirado sr-only" data-i="${i}" ${retirado ? 'checked' : ''}>
                <i class="fas fa-times text-[10px] pointer-events-none ${retirado ? 'text-red-500' : 'text-slate-300'}"></i>
            </label>
            <button type="button" class="mr-del w-5 h-5 shrink-0 flex items-center justify-center text-red-400 hover:text-red-600" title="Quitar ejemplar"><i class="fas fa-trash-alt text-[9px]"></i></button>
        </div>`;
    }

    function contador() {
        return punteroLista ? punteroLista.querySelectorAll('.fila-mr').length : 0;
    }

    function retiradosValor() {
        if (!punteroLista) return 0;
        let sum = 0;
        punteroLista.querySelectorAll('.fila-mr').forEach(fila => {
            if (fila.querySelector('.mr-retirado')?.checked) sum += aNum(fila.querySelector('.mr-valor')?.value) || 0;
        });
        return sum;
    }

    function recalcular() {
        if (!conf || !raiz) return;
        const inpOrig = raiz.querySelector('#mr-premio-original');
        const inpBase = raiz.querySelector('#mr-suma-base');
        const inpRec = raiz.querySelector('#mr-premio-recalculado');
        const big = raiz.querySelector('#mr-premio-big');
        const desg = raiz.querySelector('#mr-desglose');
        if (!inpOrig || !inpBase || !inpRec) return;
        const orig = aNum(inpOrig.value) || 0;
        const base = aNum(inpBase.value) || 0;
        const valRet = retiradosValor();
        let p = orig;
        let desc = `Premio oficial ${fmt(orig)} por tabla — sin descuento por retiros`;
        if (base > 0 && valRet > 0) {
            const pct = (valRet / base) * 100;
            p = Math.max(0, orig * (1 - (valRet / base)));
            desc = `Premio original ${fmt(orig)} − retiros ${fmt(valRet)} (${(pct).toFixed(1)}%) = ${fmt(p)}`;
        }
        inpRec.value = fmt(p);
        if (big) big.textContent = fmt(p);
        if (desg) desg.textContent = desc;
    }

    function leerDatos() {
        const d = { premioOriginal: 0, sumaBase: 0, premioRecalculado: 0, ejemplares: [], retirados: [], ganadores: [] };
        if (!raiz) return d;
        d.premioOriginal = aNum(raiz.querySelector('#mr-premio-original')?.value) || 0;
        d.sumaBase = aNum(raiz.querySelector('#mr-suma-base')?.value) || 0;
        d.premioRecalculado = aNum(raiz.querySelector('#mr-premio-recalculado')?.value) || 0;
        punteroLista.querySelectorAll('.fila-mr').forEach(fila => {
            const numero = fila.querySelector('.mr-num')?.value?.trim() || '';
            d.ejemplares.push({
                numero,
                nombre: (fila.querySelector('.mr-nombre')?.value || '').trim().toUpperCase(),
                nacionalidad: fila.querySelector('.mr-nac')?.value || 'VE',
                valor_ejemplar: aNum(fila.querySelector('.mr-valor')?.value) || 0,
                orden: fila.querySelector('.mr-orden')?.value?.trim() || '',
                dividendo: aNum(fila.querySelector('.mr-dividendo')?.value) || 0,
                ganador: !!fila.querySelector('.mr-ganador')?.checked,
                retirado: !!fila.querySelector('.mr-retirado')?.checked
            });
        });
        d.ganadores = d.ejemplares.filter(e => e.ganador).map(e => e.numero);
        d.retirados = d.ejemplares.filter(e => e.retirado).map(e => e.numero);
        return d;
    }

    function quitarFila(fila) {
        fila.remove();
        recalcular();
    }

    function pintarGanador() {
        if (!punteroLista) return;
        punteroLista.querySelectorAll('.fila-mr').forEach((fila, i) => {
            fila.dataset.i = i;
            const chk = fila.querySelector('.mr-ganador');
            if (chk) chk.dataset.i = i;
            const icono = fila.querySelector('.mr-lbl-ganador .fas');
            const retirado = !!fila.querySelector('.mr-retirado')?.checked;
            const activo = !!chk?.checked && !retirado;
            if (icono) icono.className = 'fas fa-trophy text-[9px] pointer-events-none ' + (activo ? 'text-amber-500' : 'text-slate-300');
        });
    }

    function pintarRetiros() {
        if (!punteroLista) return;
        punteroLista.querySelectorAll('.fila-mr').forEach((fila, i) => {
            fila.dataset.i = i;
            const chk = fila.querySelector('.mr-retirado');
            if (chk) chk.dataset.i = i;
            const icono = fila.querySelector('.mr-lbl-retiro .fas');
            const valor = fila.querySelector('.mr-valor');
            const orden = fila.querySelector('.mr-orden');
            const dividendo = fila.querySelector('.mr-dividendo');
            const retirado = !!chk?.checked;
            fila.classList.toggle('opacity-60', retirado);
            fila.classList.toggle('border-red-200', retirado);
            fila.classList.toggle('border-slate-200', !retirado);
            if (icono) icono.className = 'fas fa-times text-[10px] pointer-events-none ' + (retirado ? 'text-red-500' : 'text-slate-300');
            if (valor) { valor.classList.toggle('bg-slate-100', retirado); valor.classList.toggle('text-slate-400', retirado); }
            if (orden) { orden.classList.toggle('bg-slate-100', retirado); orden.classList.toggle('text-slate-400', retirado); }
            if (dividendo) { dividendo.classList.toggle('bg-slate-100', retirado); dividendo.classList.toggle('text-slate-400', retirado); }
            if (retirado) {
                const r = chk.closest('.fila-mr').querySelector('.mr-ganador');
                if (r) r.checked = false;
            }
        });
        pintarGanador();
        recalcular();
    }

    function navegar(e) {
        if (!['Enter', 'Tab'].includes(e.key)) return;
        const t = e.target;
        if (!(t instanceof HTMLInputElement)) return;
        const esNav = t.classList.contains('mr-valor') || t.classList.contains('mr-orden') || t.classList.contains('mr-dividendo');
        if (!esNav) return;
        e.preventDefault();
        const valores = [...punteroLista.querySelectorAll('.mr-valor, .mr-orden, .mr-dividendo')];
        const i = valores.indexOf(t);
        if (i === -1) return;
        const dir = (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
        const sig = valores[(i + dir + valores.length) % valores.length];
        sig.focus(); sig.select();
    }

    function cancelar() {
        const cb = conf?.onCancelar;
        cerrar();
        if (typeof cb === 'function') cb();
    }

    function abrir(opciones) {
        cerrar();
        conf = opciones || {};
        const titulo = conf.titulo || 'Resultado de la Carrera';
        const subtitulo = conf.subtitulo || '';
        const di = conf.datosIniciales || {};
        const ejemplares = Array.isArray(conf.ejemplares) ? conf.ejemplares : [];

        raiz = document.createElement('div');
        raiz.className = 'fixed inset-0 z-[70] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto';
        raiz.setAttribute('role', 'dialog');
        raiz.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-auto overflow-hidden flex flex-col max-h-[94vh]">
                <header class="bg-indigo-600 px-4 py-3 text-white shrink-0">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <h3 class="text-sm font-black uppercase tracking-wide flex items-center gap-2">
                                <i class="fas fa-clipboard-check mr-1"></i> ${titulo}
                            </h3>
                            <p class="text-[10px] font-bold text-indigo-200 uppercase tracking-wider mt-0.5 truncate">${subtitulo}</p>
                        </div>
                        <button type="button" class="btn-cerrar text-indigo-200 hover:text-white text-xl leading-none shrink-0" title="Cerrar"><i class="fas fa-times"></i></button>
                    </div>
                </header>
                <div class="p-4 grid gap-4 lg:grid-cols-[300px_1fr] overflow-y-auto flex-1">
                    <div class="space-y-3 shrink-0">
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                            <div>
                                <label class="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5" for="mr-premio-original">Premio Original (oficial)</label>
                                <input type="text" inputmode="decimal" id="mr-premio-original" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" value="${fmt(di.premioOriginal)}">
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5" for="mr-suma-base">Suma Base de la Tabla</label>
                                <input type="text" inputmode="decimal" id="mr-suma-base" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" value="${fmt(di.sumaBase)}">
                            </div>
                            <div>
                                <label class="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-0.5" for="mr-premio-recalculado">Premio Recalculado (resultado)</label>
                                <div class="flex gap-1">
                                    <input type="text" inputmode="decimal" id="mr-premio-recalculado" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-2 py-1.5 text-sm font-black text-emerald-700 outline-none focus:ring-2 focus:ring-emerald-500" value="${fmt(di.premioRecalculado)}">
                                    <button type="button" id="mr-recalcular" title="Recalcular automáticamente con los retiros" class="bg-emerald-100 text-emerald-700 px-2.5 rounded-lg hover:bg-emerald-200 font-bold text-sm shrink-0"><i class="fas fa-sync-alt"></i></button>
                                </div>
                            </div>
                            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                                <p class="text-[9px] font-bold text-emerald-800 uppercase tracking-wider">Premio a publicar (tras retiros)</p>
                                <p class="text-2xl font-black text-emerald-600" id="mr-premio-big">${fmt(di.premioRecalculado)}</p>
                                <p class="text-[8px] font-bold text-emerald-700 mt-0.5 leading-tight" id="mr-desglose"></p>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col min-w-0">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <p class="text-[10px] font-black text-slate-600 uppercase tracking-wider">
                                <i class="fas fa-horse-head text-amber-500 mr-1"></i> Ejemplares
                                <span class="ml-1 bg-slate-100 text-slate-600 px-1.5 rounded-full font-black mr-cont">${ejemplares.length}</span>
                            </p>
                            <button type="button" id="mr-agregar" class="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded-lg text-[10px] font-bold shadow transition-colors shrink-0"><i class="fas fa-plus mr-1"></i> Agregar</button>
                        </div>
                        <p class="text-[9px] text-slate-400 uppercase tracking-wider mb-1 px-1">Por ejemplar → Nº · Nombre · 🇨🇴 · Valor($) · Orden(1º) · Dividendo($ por $1) · 🏆 Ganador (varios = empate) · ✗ Retirado</p>
                        <div class="overflow-y-auto max-h-[46vh] border border-slate-200 rounded-xl p-1 space-y-0.5 bg-slate-100/60">
                            ${ejemplares.map((c, i) => filaHTML(c, i)).join('') || '<p class="text-[11px] text-slate-400 italic text-center py-3">Sin ejemplares. Use "Agregar" para incluir participantes.</p>'}
                        </div>
                    </div>
                </div>
                <footer class="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 shrink-0">
                    <button type="button" id="mr-cancelar" class="bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-xs font-bold hover:bg-slate-400 transition-colors">Cancelar</button>
                    <button type="button" id="mr-registrar" class="bg-amber-500 hover:bg-amber-600 text-slate-900 px-5 py-2 rounded-lg text-xs font-black shadow-md uppercase transition-colors"><i class="fas fa-check mr-1"></i> Registrar Resultado</button>
                </footer>
            </div>`;
        document.body.appendChild(raiz);
        punteroLista = raiz.querySelector('.overflow-y-auto');

        raiz.addEventListener('click', (e) => {
            if (e.target === raiz) { cancelar(); return; }
            const cerrarBtn = e.target.closest('.btn-cerrar');
            if (cerrarBtn) { cancelar(); return; }
            if (e.target.closest('#mr-cancelar')) { cancelar(); return; }
            if (e.target.closest('#mr-agregar')) {
                const maxN = [...punteroLista.querySelectorAll('.mr-num')].reduce((a, x) => Math.max(a, parseInt(x.value) || 0), 0);
                const idx = contador();
                punteroLista.insertAdjacentHTML('beforeend', filaHTML({ numero: maxN + 1, nombre: '', nacionalidad: 'VE', valor_ejemplar: '' }, idx));
                pintarRetiros();
                punteroLista.querySelector('.fila-mr:last-child .mr-nombre')?.focus();
                const cnt = raiz.querySelector('.mr-cont'); if (cnt) cnt.textContent = contador();
                return;
            }
            if (e.target.closest('.mr-del')) {
                const fila = e.target.closest('.fila-mr');
                if (fila && confirm('¿Quitar este ejemplar?')) {
                    quitarFila(fila);
                    const cnt = raiz.querySelector('.mr-cont'); if (cnt) cnt.textContent = contador();
                }
                return;
            }
            if (e.target.closest('#mr-recalcular')) { recalcular(); return; }
            if (e.target.closest('#mr-registrar')) {
                const btn = e.target.closest('#mr-registrar');
                const origHTML = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Guardando…';
                Promise.resolve(conf.onRegistrar ? conf.onRegistrar(leerDatos()) : null)
                    .then(ok => { if (ok === true) cerrar(); else { btn.disabled = false; btn.innerHTML = origHTML; } })
                    .catch(err => {
                        console.error('Error al registrar resultado:', err);
                        window.clubUI?.toast('No se pudo registrar: ' + (err?.message || err), 'error');
                        btn.disabled = false;
                        btn.innerHTML = origHTML;
                    });
                return;
            }
        });
        raiz.addEventListener('input', (e) => {
            if (e.target.classList.contains('mr-num')) {
                const style = `background-color:${colorDeNumero(e.target.value)};color:${textoDeNumero(e.target.value)};border-color:${colorDeNumero(e.target.value)}`;
                e.target.setAttribute('style', style);
            }
            if (e.target.classList.contains('mr-valor')) recalcular();
            if (e.target.classList.contains('mr-orden')) {
                const ret = !!e.target.closest('.fila-mr')?.querySelector('.mr-retirado')?.checked;
                const esPrimero = !ret && parseInt(e.target.value, 10) === 1;
                e.target.style.backgroundColor = esPrimero ? '#fef3c7' : '';
                pintarGanador();
            }
            if (e.target.id === 'mr-premio-original' || e.target.id === 'mr-suma-base') recalcular();
        });
        raiz.addEventListener('change', (e) => {
            if (e.target.classList.contains('mr-ganador')) pintarGanador();
            if (e.target.classList.contains('mr-retirado')) pintarRetiros();
        });
        raiz.addEventListener('keydown', navegar);

        recalcular();
        pintarGanador();
        pintarRetiros();
        const cnt = raiz.querySelector('.mr-cont'); if (cnt) cnt.textContent = contador();
        const primerInput = raiz.querySelector('#mr-premio-original');
        if (primerInput) primerInput.focus();

        return { cerrar, leerDatos };
    }

    return { abrir, cerrar, leerDatos };
})();