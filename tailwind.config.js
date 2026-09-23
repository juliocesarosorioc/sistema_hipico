module.exports = {
    content: [
        // Sistema legacy (HTML estático + JS)
        './html/**/*.html',
        './js/**/*.js',
        './index.html',
        // SPA Next.js (App Router + componentes React)
        './src/**/*.{ts,tsx}',
    ],
    theme: {
        extend: {
            keyframes: {
                'bet-slip-slide': {
                    '0%': { opacity: '0', transform: 'translateX(16px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                'bet-slip-dock': {
                    '0%': { opacity: '0', transform: 'translateY(16px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'flash-total': {
                    '0%': { backgroundColor: 'rgba(16,185,129,0.9)' },
                    '100%': { backgroundColor: 'transparent' },
                },
            },
            animation: {
                'bet-slip-slide': 'bet-slip-slide 0.22s ease-out',
                'bet-slip-dock': 'bet-slip-dock 0.22s ease-out',
                'flash-total': 'flash-total 0.6s ease-out',
            },
        },
    },
    plugins: [],
    safelist: [
        // Clases realmente dinámicas (template-literal condicional) que JIT podría perder.
        'text-emerald-600', 'text-red-600', 'text-amber-600', 'text-blue-600', 'text-purple-600',
        'bg-emerald-100', 'bg-emerald-500',
        'bg-red-100', 'bg-red-500',
        'bg-amber-100', 'bg-amber-500',
        'bg-blue-100', 'bg-blue-500',
    ],
};
