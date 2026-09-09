const fs = require('fs');
const path = require('path');

const root = process.cwd();
const htmlDir = path.join(root, 'html');
const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
const CDN_RE = /\s*<script\s+src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g;
const NEW_LINK = '\n    <link rel="stylesheet" href="../css/tailwind.css">';
let changes = 0;

for (const file of files) {
    const fp = path.join(htmlDir, file);
    let content = fs.readFileSync(fp, 'utf8');
    if (!CDN_RE.test(content)) continue;
    fs.writeFileSync(fp, content.replace(CDN_RE, NEW_LINK), 'utf8');
    console.log('OK ' + file);
    changes++;
}
console.log('Total: ' + changes + ' archivos modificados');
