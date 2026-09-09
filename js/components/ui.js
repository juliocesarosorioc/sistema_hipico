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

    // ==========================================
    // BANCOS DE VENEZUELA (códigos SUDEBAN)
    // Nota (administrador): revise/ajuste los códigos si su banco
    // aparece con dígitos distintos en la lista oficial vigente.
    // ==========================================
    const BANCOS_VZLA = [
        { codigo: '0102', nombre: 'BANCO DE VENEZUELA' },
        { codigo: '0104', nombre: 'BANCO VENEZOLANO DE CREDITO' },
        { codigo: '0105', nombre: 'BANCO MERCANTIL' },
        { codigo: '0108', nombre: 'BBVA PROVINCIAL' },
        { codigo: '0114', nombre: 'BANCO OCCIDENTAL DE DESCUENTO (BOD)' },
        { codigo: '0115', nombre: 'BANCO EXTERIOR' },
        { codigo: '0128', nombre: 'BANCO CARONI' },
        { codigo: '0134', nombre: 'BANESCO' },
        { codigo: '0137', nombre: 'BANCO SOFITASA' },
        { codigo: '0138', nombre: 'BANCO PLAZA' },
        { codigo: '0146', nombre: 'BANCARIBE' },
        { codigo: '0151', nombre: 'BANCO DEL SUR' },
        { codigo: '0156', nombre: 'BANCO PICHINCHA' },
        { codigo: '0157', nombre: 'BANCO SUDEBAN' },
        { codigo: '0163', nombre: 'BANCO DEL TESORO' },
        { codigo: '0164', nombre: 'MIBANCO' },
        { codigo: '0166', nombre: 'BANCO AGRICOLA' },
        { codigo: '0171', nombre: 'BANCO ACTIVO' },
        { codigo: '0172', nombre: 'BANCAMIGA' },
        { codigo: '0173', nombre: 'BANCO CAFETERO' },
        { codigo: '0175', nombre: 'BANCO BICENTENARIO' },
        { codigo: '0191', nombre: 'BANCO NACIONAL DE CREDITO (BNC)' }
    ];

    // ==========================================
    // PAÍSES / CÓDIGOS DE TELÉFONO (búsqueda inteligente)
    // ==========================================
    const PAISES_TELEFONO = [
        { codigo: '+58', pais: 'Venezuela' },
        { codigo: '+1', pais: 'EE. UU. / Canadá' },
        { codigo: '+57', pais: 'Colombia' },
        { codigo: '+58', pais: 'Venezuela' },
        { codigo: '+507', pais: 'Panamá' },
        { codigo: '+52', pais: 'México' },
        { codigo: '+34', pais: 'España' },
        { codigo: '+51', pais: 'Perú' },
        { codigo: '+56', pais: 'Chile' },
        { codigo: '+54', pais: 'Argentina' },
        { codigo: '+593', pais: 'Ecuador' },
        { codigo: '+55', pais: 'Brasil' },
        { codigo: '+44', pais: 'Reino Unido' },
        { codigo: '+351', pais: 'Portugal' },
        { codigo: '+39', pais: 'Italia' },
        { codigo: '+49', pais: 'Alemania' }
    ];

    // Modalidades de pago completas: simples + Zelle/Binance + bancos Vzla
    const METODOS_PAGO = [
        'EFECTIVO', 'DIVISA', 'PAGO MÓVIL', 'TRANSFERENCIA', 'PAYPAL',
        'ZELLE', 'BINANCE', 'OTRO'
    ];

    const listMetodosPago = (incluirBancos = true) => {
        return incluirBancos
            ? [...METODOS_PAGO, ...BANCOS_VZLA.map(b => `${b.codigo} · ${b.nombre}`)]
            : [...METODOS_PAGO];
    };

    const esBancoVzla = (metodo) => /^\d{4}\s·\s/.test(metodo || '');

    // Options para selects de banco (pago móvil y banco receptor)
    const htmlOpcionesBancosVzla = (actual = '') => BANCOS_VZLA
        .map(b => `<option value="${b.codigo} · ${b.nombre}" ${(actual === `${b.codigo} · ${b.nombre}` || actual === b.nombre) ? 'selected' : ''}>${b.codigo} · ${b.nombre}</option>`)
        .join('');

    // ==========================================
    // FORMATO REGIONAL DE VENEZUELA (es-VE)
    // 1.234,56  ->  decimales con coma, millares con punto
    // ==========================================
    function formatoNumero(v, dec = 2) {
        const n = parseFloat(v);
        if (isNaN(n)) return (0).toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        return n.toLocaleString('es-VE', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }

    function formatoMoneda(m, v, dec = 2) {
        const esVes = String(m || '').toUpperCase() === 'VES' || String(m || '').toUpperCase() === 'BS';
        return (esVes ? 'Bs ' : '$ ') + formatoNumero(v, dec);
    }

    // ==========================================
    // TELÉFONO INTELIGENTE (código de país)
    // ==========================================
    // construye "+58 4121234567" quitando el 0 nacional inicial
    function componerTelefono(codigo, numero) {
        let dig = String(numero || '').replace(/[^\d]/g, '');
        if (codigo === '+58' && dig.startsWith('0')) dig = dig.slice(1);
        return codigo + ' ' + dig;
    }

    // separa "+58 4121234567" en { codigo: '+58', numero: '4121234567' }
    function desglosarTelefono(tel) {
        const t = String(tel || '').trim();
        if (!t) return { codigo: '+58', numero: '' };
        const m = t.match(/^(\+?\d{1,4})\s*([\d\s-]*)$/);
        if (m) return { codigo: (m[1] || '+58'), numero: m[2].replace(/[^\d]/g, '') };
        const dig = t.replace(/[^\d]/g, '');
        return { codigo: '+58', numero: dig.startsWith('0') ? dig : dig };
    }

    function htmlOpcionesCodigoPais(actual) {
        const unicos = [];
        PAISES_TELEFONO.forEach(p => {
            if (!unicos.some(u => u.codigo === p.codigo)) unicos.push(p);
        });
        return unicos.map(p => `<option value="${p.codigo}" ${p.codigo === actual ? 'selected' : ''}>${p.codigo} ${p.pais}</option>`).join('');
    }

    function htmlOpcionesMetodos(actual, incluirBancos = true) {
        return listMetodosPago(incluirBancos).map(m => `<option ${m === actual ? 'selected' : ''}>${m}</option>`).join('');
    }

    // resumen corto para mostrar en tablas: "BANESCO (0134) · CtA CORRIENTE ·•1234"
    function resumenDatosPago(dp) {
        if (!dp || typeof dp !== 'object') return '';
        if (dp.telefono) {
            // Pago móvil: siempre muestra el banco vinculado
            const nom = dp.banco || dp.nombre || '';
            const cod = dp.codigo ? `(${dp.codigo})` : '';
            const tlf = ` Telf •${String(dp.telefono || '').replace(/\D/g, '').slice(-4)}`;
            return `${nom} ${cod}${tlf}`.trim();
        }
        if (dp.banco || dp.codigo) {
            const banco = dp.nombre || dp.banco || '';
            const cod = dp.codigo || '';
            const num = dp.numero_cuenta ? ` · ${dp.tipo_cuenta || ''} ${cod}••${String(dp.numero_cuenta).replace(/\D/g, '').slice(-4)}` : '';
            return `${banco} (${cod})${num}`.trim();
        }
        if (dp.tipo_contacto || dp.dato) {
            return `${dp.tipo_contacto === 'telefono' ? 'Tlf' : dp.tipo_contacto === 'correo' ? 'Correo' : 'Dato'}: ${dp.dato || ''}`;
        }
        return '';
    }

    return { toast, paginar, BANCOS_VZLA, PAISES_TELEFONO, METODOS_PAGO, listMetodosPago, esBancoVzla, htmlOpcionesBancosVzla, formatoNumero, formatoMoneda, componerTelefono, desglosarTelefono, htmlOpcionesCodigoPais, htmlOpcionesMetodos, resumenDatosPago };
})();