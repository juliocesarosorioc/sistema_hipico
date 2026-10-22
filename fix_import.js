const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/pollas/components/PollasModule.tsx';
let s = fs.readFileSync(p, 'utf8');
const old = "import { SearchableSelect } from \"@/shared/ui/SearchableSelect\";\n";
if (s.includes(old)) {
  s = s.split(old).join("");
  fs.writeFileSync(p, s);
  console.log('ok');
} else {
  console.log('no');
}
