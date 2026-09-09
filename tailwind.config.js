module.exports = {
    content: [
        './html/**/*.html',
        './js/**/*.js',
        './index.html'
    ],
    theme: {
        extend: {}
    },
    plugins: [],
    safelist: [
        // Clases realmente dinámicas (template-literal condicional) que JIT podría perder.
        // La mayoría de clases condicionales en JS son strings literales y se detectan vía content.
        'text-emerald-600', 'text-red-600', 'text-amber-600', 'text-blue-600', 'text-purple-600',
        'bg-emerald-100', 'bg-emerald-500',
        'bg-red-100', 'bg-red-500',
        'bg-amber-100', 'bg-amber-500',
        'bg-blue-100', 'bg-blue-500',
        'bg-slate-400', 'bg-slate-500',
    ]
};
