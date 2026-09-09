<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestión de Clientes - Club del Dinero</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script>if (!localStorage.getItem('club_sesion_activa')) window.location.href = 'index.html';</script>
</head>
<body class="bg-[#f0f4f8] font-sans text-xs h-screen flex flex-col overflow-x-hidden">

    <!-- NAVEGACIÓN SUPERIOR -->
    <header class="bg-white border-b border-slate-300 px-3 py-2 flex flex-wrap gap-2 items-center shadow-sm text-xs">
        <a href="dashboard.html" class="bg-slate-600 text-white px-3 py-1 rounded hover:bg-slate-700 transition shadow-sm font-medium"><i class="fas fa-arrow-left mr-1"></i> Volver</a>
        <a href="depositos.html" class="bg-emerald-600 text-white px-3 py-1 rounded shadow-sm hover:bg-emerald-700 font-medium">Depósitos</a>
        <a href="retiros.html" class="bg-red-500 text-white px-3 py-1 rounded shadow-sm hover:bg-red-600 font-medium">Retiros</a>
        <a href="transferencias.html" class="bg-amber-400 text-slate-900 px-3 py-1 rounded shadow-sm hover:bg-amber-500 font-medium">Transferencias</a>
        <a href="taquilla.html" class="bg-blue-600 text-white px-3 py-1 rounded shadow-sm hover:bg-blue-700 font-medium">Apuestas</a>
        <a href="saldos.html" class="bg-slate-800 text-white px-3 py-1 rounded shadow-sm hover:bg-slate-900 font-medium">Saldos/Reportes</a>
        <span class="bg-amber-100 border border-amber-300 text-amber-900 px-3 py-1 rounded shadow-sm font-bold"><i class="fas fa-lock mr-1"></i> Clientes del Sistema</span>
        <span class="bg-slate-200 text-slate-700 px-3 py-1 rounded shadow-sm font-medium"><i class="fas fa-camera mr-1"></i> Snapshots de Cierre</span>
    </header>

    <main class="p-4 flex-1 overflow-y-auto space-y-4 max-w-[1700px] mx-auto w-full">
        
        <!-- CABECERA -->
        <div class="bg-white px-4 py-3 rounded-lg shadow-sm border border-slate-200 flex justify-between items-center text-slate-800">
            <h1 class="text-base font-bold flex items-center"><i class="fas fa-users text-slate-700 mr-2"></i> Gestión de Clientes</h1>
            <span id="fechaRelojCabecera" class="text-slate-500 text-xs">Cargando fecha...</span>
        </div>

        <!-- FORMULARIO NUEVO CLIENTE -->
        <div class="bg-white p-4 rounded-lg shadow-sm border border-slate-200 space-y-3">
            <form id="formNuevoCliente" class="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Nombre</label>
                    <input type="text" id="nombreCliente" class="w-full border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500 uppercase" required>
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Teléfono</label>
                    <input type="text" id="telefonoCliente" class="w-full border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Comisión (%)</label>
                    <input type="number" id="comisionCliente" step="0.01" value="0.00" class="w-full border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500">
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Libre</label>
                    <select id="libreCliente" class="w-full border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500">
                        <option value="false">No</option>
                        <option value="true">Sí</option>
                    </select>
                </div>
                <div>
                    <label class="block font-bold text-slate-700 mb-1">Socio / Agencia</label>
                    <select id="socioCliente" class="w-full border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-blue-500">
                        <option value="">— Ninguno (Directo) —</option>
                        <!-- Se llena vía JS -->
                    </select>
                </div>
                <div class="pt-1 flex items-center gap-2">
                    <label class="flex items-center gap-1 font-bold text-slate-700 cursor-pointer text-[10px]">
                        <input type="checkbox" id="checkMostrarS" class="rounded"> Mostrar Saldo al Socio
                    </label>
                    <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-1.5 rounded shadow flex-1 text-center transition-colors">
                        Agregar
                    </button>
                </div>
            </form>
        </div>

        <!-- ACORDEÓN GESTIÓN DE SOCIOS -->
        <div id="btnAcordeonSocios" class="bg-slate-800 text-white px-4 py-2.5 rounded-lg shadow-sm flex justify-between items-center font-bold cursor-pointer hover:bg-slate-900 transition-colors">
            <span class="flex items-center"><i class="fas fa-handshake mr-2 text-amber-400"></i> Gestión de Socios y Agencias</span>
            <i id="iconoAcordeon" class="fas fa-chevron-down text-xs transition-transform duration-300"></i>
        </div>
        
        <div id="panelSocios" class="hidden bg-white p-4 rounded-lg shadow-sm border border-slate-200">
            <p class="text-slate-500 mb-3">Aquí puedes registrar a clientes que actuarán como "Socios" o "Agencias" para tener afiliados bajo su estructura.</p>
            <div class="flex gap-2">
                <input type="text" id="nombreNuevoSocio" placeholder="Nombre del Socio/Agencia" class="border border-slate-300 rounded px-3 py-1.5 outline-none focus:border-amber-500 uppercase">
                <button id="btnCrearSocio" class="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-4 py-1.5 rounded shadow">Convertir a Socio</button>
            </div>
            <div id="msgSocio" class="mt-2 text-green-600 font-bold text-[10px] hidden">Socio registrado correctamente.</div>
        </div>

        <!-- TABLA DE CLIENTES -->
        <div class="space-y-2">
            <h2 class="text-sm font-bold text-slate-800">Cartera de Clientes</h2>
            
            <div class="flex flex-wrap justify-between items-center gap-2">
                <div class="flex items-center gap-2">
                    <div class="relative w-64">
                        <i class="fas fa-search absolute left-3 top-2 text-slate-400"></i>
                        <input type="text" id="buscadorClientes" placeholder="Buscar cliente o teléfono..." class="w-full border border-slate-300 rounded pl-8 pr-3 py-1.5 outline-none focus:border-blue-500">
                    </div>
                    <button id="btnRecargarClientes" class="border border-slate-300 bg-white px-2.5 py-1.5 rounded hover:bg-slate-50 text-slate-600 shadow-sm"><i class="fas fa-sync-alt"></i></button>
                </div>
                <button id="btnAbrirDevoluciones" class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded font-bold shadow flex items-center transition-colors">
                    <i class="fas fa-money-bill-wave mr-1.5"></i> Gestionar Devoluciones Masivas <i class="fas fa-chevron-right ml-1.5 text-[10px]"></i>
                </button>
            </div>

            <!-- TABLA EXTENDIDA -->
            <div class="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
                            <tr>
                                <th class="p-2 font-semibold whitespace-nowrap">Nombre</th>
                                <th class="p-2 font-semibold whitespace-nowrap">Teléfono</th>
                                <th class="p-2 text-center font-semibold whitespace-nowrap">Libre</th>
                                <th class="p-2 text-center font-semibold whitespace-nowrap">Comisión</th>
                                <th class="p-2 text-right font-semibold whitespace-nowrap">Saldo USD</th>
                                <th class="p-2 text-right font-semibold whitespace-nowrap">Aval USD</th>
                                <th class="p-2 text-right font-semibold whitespace-nowrap">Devolución</th>
                                <th class="p-2 text-center font-semibold whitespace-nowrap" title="Mostrar Saldo al Socio">M.S.</th>
                                <th class="p-2 font-semibold whitespace-nowrap">Socio</th>
                                <th class="p-2 font-semibold whitespace-nowrap">Afiliado</th>
                                <th class="p-2 text-center font-semibold whitespace-nowrap">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="cuerpoTablaClientes" class="divide-y divide-slate-200 text-slate-700 text-[11px]">
                            <tr><td colspan="11" class="p-6 text-center text-slate-500">Cargando datos...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </main>

    <!-- =====================================
         MODALES 
         ===================================== -->
         
    <!-- Modal Devoluciones Masivas -->
    <div id="modalDevoluciones" class="hidden modal-overlay">
        <div class="modal-container">
            <div class="bg-purple-600 p-4 text-white font-bold flex justify-between items-center">
                <span><i class="fas fa-percentage mr-2"></i> Asignar Devolución Masiva</span>
                <button class="cerrar-modal hover:text-slate-200"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6 text-sm">
                <p class="text-slate-600 mb-4">Esta acción aplicará un porcentaje fijo de devolución al saldo de todos los clientes filtrados o activos en la tabla actualmente.</p>
                <div class="mb-4">
                    <label class="block font-bold text-slate-700 mb-1">Porcentaje de Devolución Global (%)</label>
                    <input type="number" id="inputDevolucionMasiva" step="0.01" placeholder="Ej: 5.00" class="w-full border border-slate-300 rounded px-3 py-2 outline-none focus:border-purple-500 font-mono text-lg">
                </div>
                <div class="bg-yellow-50 border border-yellow-200 p-3 rounded text-yellow-800 text-xs flex gap-2">
                    <i class="fas fa-exclamation-triangle mt-0.5"></i>
                    <p>Precaución: Esta operación sobreescribirá el campo de devolución de todos los clientes listados.</p>
                </div>
            </div>
            <div class="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
                <button type="button" class="cerrar-modal bg-slate-500 text-white px-4 py-2 rounded font-medium hover:bg-slate-600">Cancelar</button>
                <button id="btnEjecutarDevolucion" class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-bold shadow-sm">
                    Aplicar a Todos
                </button>
            </div>
        </div>
    </div>

    <!-- Modal Editar Cliente -->
    <div id="modalEditarCliente" class="hidden modal-overlay">
        <div class="modal-container">
            <div class="bg-blue-600 p-4 text-white font-bold flex justify-between items-center">
                <span><i class="fas fa-user-edit mr-2"></i> Editar Cliente</span>
                <button class="cerrar-modal hover:text-slate-200"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6">
                <form id="formEditarCliente" class="space-y-4">
                    <input type="hidden" id="editId">
                    <div class="grid grid-cols-2 gap-4">
                        <div class="col-span-2">
                            <label class="block text-xs font-bold text-slate-700 mb-1">Nombre</label>
                            <input type="text" id="editNombre" class="w-full border border-slate-300 rounded px-3 py-2 uppercase outline-none focus:border-blue-500" required>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">Teléfono</label>
                            <input type="text" id="editTelefono" class="w-full border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">Comisión (%)</label>
                            <input type="number" id="editComision" step="0.01" class="w-full border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">Libre</label>
                            <select id="editLibre" class="w-full border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500">
                                <option value="false">No</option>
                                <option value="true">Sí</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-700 mb-1">Mostrar S.</label>
                            <select id="editMostrarS" class="w-full border border-slate-300 rounded px-3 py-2 outline-none focus:border-blue-500">
                                <option value="false">Oculto al Socio</option>
                                <option value="true">Visible al Socio</option>
                            </select>
                        </div>
                    </div>
                </form>
            </div>
            <div class="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 text-xs">
                <button type="button" class="cerrar-modal bg-slate-500 text-white px-4 py-2 rounded font-medium hover:bg-slate-600">Cancelar</button>
                <button type="submit" form="formEditarCliente" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold shadow-sm">Guardar</button>
            </div>
        </div>
    </div>

    <!-- Scripts Base -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="js/conexion.js"></script>
    <script src="js/clientes.js"></script>
    <script>
        setInterval(() => document.getElementById('fechaRelojCabecera').textContent = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }), 1000);
    </script>
</body>
</html>