const fs = require('fs');
const path = require('path');

for (const f of fs.readdirSync('html').filter(f => f.endsWith('.html'))) {
    const c = fs.readFileSync(path.join('html', f), 'utf8');
    const body = c.match(/<body[^>]*>/);
    const main = c.match(/<(main|div)[^>]*class="[^"]*flex-1[^"]*"/);
    const nested = c.match(/<main[^>]*>/);
    console.log(f);
    console.log('  body:  ' + (body ? body[0].slice(0, 110) : '??'));
    console.log('  main:  ' + (nested ? nested[0].slice(0, 110) : '(sin <main>)'));
    console.log('  flex1: ' + (main ? main[0].slice(0, 120) : 'NO flex-1'));
    if (main && main[0].split(' ').join('').includes('absolute') ) console.log('  >> ATENCION wrapper con absolute/fixed');
    console.log('');
}