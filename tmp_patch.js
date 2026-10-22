const fs = require('fs');
const p = 'C:/Users/julio/sistema_hipico/src/features/taquilla/lib/nomenclatura.ts';
let s = fs.readFileSync(p, 'utf8');
const old = "  /* --- Condicion + \"el/la\" + lista: \"2n el 3, 4 y 8\" � \"1p el 5\" � \"PP el 5\" --- */\n  const conLista = new RegExp(\n    String.raw`^(pp|[1-8]\\s*[pn])\\s*(?:el|la)\\s*(` + RE_LISTA + String.raw`)$`,\n    \"i\"\n  ).exec(t);";
const neu = "  /* --- Condicion + \"el/la\" + lista: \"2n el 3, 4 y 8\" � \"1p el 5\" � \"PP el 5\" ---\n     Tambi\u00E9n acepta \"1p 2-3\", \"1p 2 y 3\" (sin \"el/la\"). */\n  const conLista = new RegExp(\n    String.raw`^(pp|[1-8]\\s*[pn])\\s+(?:el|la\\s+)?(` + RE_LISTA + String.raw`)$`,\n    \"i\"\n  ).exec(t);";
if (s.indexOf(old) >= 0) { s = s.split(old).join(neu); fs.writeFileSync(p,s); console.log('ok1'); } else { console.log('no1'); }
