const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/taquilla/lib/reparto.ts';
let s = fs.readFileSync(p,'utf8');
const start = s.indexOf('export function extraerProporcion');
const end = s.indexOf('/* ---', start);
if(start>=0 && end>start){
  const nb = "export function extraerProporcion(jugada: string): { p: number; q: number; base: string } | null {\r\n  const t = String(jugada ?? \"\")\r\n    .trim()\r\n    .replace(/\\bdel\\b/gi, \" \")\r\n    .replace(/\\bde\\b/gi, \" \")\r\n    .replace(/\\s+/g, \" \");\r\n  if (!t) return null;\r\n\r\n  // \\\"PP\\\" es la paridad: 10:10, y no deja nomenclatura de puestos detr\u00E1s.\r\n  if (/^pp$/i.test(t)) return { p: 10, q: 10, base: \"\" };\r\n\r\n  // \\\"10a8 1p\\\" / \\\"10/8 1p\\\" / \\\"10a3,5 1p\\\": proporci\u00F3n adelante y nomenclatura de puestos despu\u00E9s.\r\n  const mix = /^(\\d+(?:[.,]\\d+)?)\\s*(?:a|\\/)\\s*(\\d+(?:[.,]\\d+)?)\\s+(.+)$/i.exec(t);\r\n  if (mix) {\r\n    const p = parseFloat(String(mix[1]).replace(\",\", \".\"));\r\n    const q = parseFloat(String(mix[2]).replace(\",\", \".\"));\r\n    const base = mix[3].trim();\r\n    if (p > 0 && q > 0 && base) return { p, q, base };\r\n    return null;\r\n  }\r\n\r\n";
  s = s.slice(0,start) + nb + s.slice(end);
  fs.writeFileSync(p,s);
  console.log('ok');
}else console.log('no');
