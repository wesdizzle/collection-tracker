import * as fs from 'fs';
import * as path from 'path';

const srcDir = path.resolve('node_modules/sql.js/dist');
const destDir = path.resolve('public');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

for (const file of ['sql-wasm.wasm', 'sql-wasm-browser.wasm']) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} to public/`);
  } else {
    console.warn(`Warning: ${src} not found`);
  }
}
