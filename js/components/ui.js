// Archivo: js/components/ui.js
// Propósito: UI compartida — toasts no bloqueantes y utilidades de formato.
// window.clubUI.toast(mensaje, tipo) donde tipo: success | error | warning | info

window.clubUI = (() => {
    const COLORS = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    const ICONS = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    function toast(mensaje, tipo = 'info', duracionMs = 3500) {
        const color = COLORS[tipo] || COLORS.info;
        const icono = ICONS[tipo] || ICONS.info;

        let contenedor = document.getElementById('clubToasts');
        if (!contenedor) {
            contenedor = document.createElement('div');
            contenedor.id = 'clubToasts';
            contenedor.setAttribute('aria-live', 'polite');
            contenedor.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;max-width:min(22rem,calc(100vw - 2rem));pointer-events:none;';
            document.body.appendChild(contenedor);
        }

        const item = document.createElement('div');
        item.style.cssText = `display:flex;align-items:flex-start;gap:0.6rem;background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-left:4px solid ${color};border-radius:0.5rem;padding:0.75rem 1rem;font-size:0.8125rem;font-weight:600;line-height:1.35;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);transform:translateX(110%);transition:transform 0.25s ease;pointer-events:auto;max-width:100%;`;
        item.innerHTML = `<i class="fas ${icono}" style="color:${color};margin-top:0.15rem;"></i><span style="word-break:break-word;">${mensaje}</span>`;
        contenedor.appendChild(item);

        requestAnimationFrame(() => { item.style.transform = 'translateX(0)'; });

        const cerrar = () => {
            item.style.transform = 'translateX(110%)';
            item.style.opacity = '0';
            item.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            setTimeout(() => item.remove(), 260);
        };

        const timer = setTimeout(cerrar, duracionMs);
        item.addEventListener('click', () => { clearTimeout(timer); cerrar(); });
    }

    // ==========================================
    // PAGINACIÓN CLIENT-SIDE REUTILIZABLE
    // Uso:
    //   clubUI.paginar(tbody, filasHtml, 25, (filasPagina) => {
    //       tbody.innerHTML = filasPagina.join('');
    //       asignarEventosFila(); // re-vincular acciones por fila
    //   });
    // ==========================================
    function paginar(tbody, filas, porPagina = 25, alCambiar) {
        if (!tbody) return;
        porPagina = Math.max(1, porPagina);
        const total = filas.length;
        const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
        let pagina = 1;

        const padre = tbody.parentElement;
        const navId = 'pag-' + (tbody.id || ('tabla-' + Math.random().toString(36).slice(2)));
        document.getElementById(navId)?.remove();

        const nav = document.createElement('div');
        nav.id = navId;
        nav.className = 'flex flex-wrap items-center justify-between gap-2 p-2 text-[11px] text-slate-600';
        padre.appendChild(nav);

        const render = () => {
            const ini = (pagina - 1) * porPagina;
            const paginaActual = filas.slice(ini, ini + porPagina);
            if (alCambiar) alCambiar(paginaActual, { pagina, totalPaginas, ini, total });

            const btnBase = 'px-2 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-bold ';
            nav.innerHTML = `
                <span>Mostrando ${total ? ini + 1 : 0}-${ini + paginaActual.length} de ${total} registros</span>
                <div class="flex items-center gap-1">
                    <button data-pag="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}
                            class="${btnBase} bg-white border-slate-300 text-slate-600 hover:bg-slate-100">‹ Anterior</button>
                    <span class="px-2">Pág. ${pagina} / ${totalPaginas}</span>
                    <button data-pag="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''}
                            class="${btnBase} bg-white border-slate-300 text-slate-600 hover:bg-slate-100">Siguiente ›</button>
                </div>`;

            nav.querySelectorAll('button[data-pag]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const nueva = parseInt(btn.dataset.pag, 10);
                    if (nueva >= 1 && nueva <= totalPaginas) { pagina = nueva; render(); }
                });
            });
        };

        render();
    }

    return { toast, paginar };
})();