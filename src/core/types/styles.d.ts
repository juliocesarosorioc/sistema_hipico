// Declara los `import "./*.css"` (globals.css, Tailwind) para tsc strict.
// Next maneja esto vía next-env.d.ts; esto último da soporte a TypeScript 7.x.
declare module "*.css";
