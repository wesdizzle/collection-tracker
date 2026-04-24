
import fs from 'fs';
import path from 'path';

const filePath = path.resolve(process.cwd(), 'deploy.sql');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Replacing figure_series with toy_series...');
content = content.replace(/figure_series/g, 'toy_series');

console.log('Replacing figures with toys...');
// We need to be careful with "figures" as it might appear in words like "configures" or "configured".
// However, in SQL, it's usually "TABLE figures" or "INTO figures".
// Let's use word boundaries if possible, but SQLite doesn't always have them in JS regex.
// Looking at deploy.sql, it's mostly "TABLE figures", "INTO figures", "FROM figures".
content = content.replace(/\bfigures\b/g, 'toys');

fs.writeFileSync(filePath, content);
console.log('deploy.sql updated successfully!');
