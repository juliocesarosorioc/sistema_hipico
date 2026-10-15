// Archivo: js/components/auth.js
// Propósito: Manejo centralizado de sesión y permisos.
// Se usa desde layout.js y desde las páginas que requieren autenticación.

window.clubAuth = {
    KEY: 'club_sesion_activa',

    getSesion() {
        try {
            return JSON.parse(localStorage.getItem(this.KEY)) || null;
        } catch (e) {
            return null;
        }
    },

    requireAuth(redirect = 'index.html') {
        if (!this.getSesion()) {
            window.location.href = redirect;
            return null;
        }
        return this.getSesion();
    },

    cerrarSesion(redirect = 'index.html') {
        localStorage.removeItem(this.KEY);
        window.location.href = redirect;
    },

    requiereRol(rolesPermitidos) {
        const sesion = this.getSesion();
        if (!sesion) {
            this.cerrarSesion();
            return false;
        }
        return rolesPermitidos.some(r => sesion.rol.includes(r));
    }
};