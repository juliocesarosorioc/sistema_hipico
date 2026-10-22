const fs=require('fs');
const s=fs.readFileSync('C:/Users/julio/sistema_hipico/legacy/css/style.css','utf8');
const lines=s.split(/\n/);
console.log(lines.length);
console.log(lines.slice(-20).join('\n'));
