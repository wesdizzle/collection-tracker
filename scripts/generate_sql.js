const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

async function parseCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

function escapeSql(str) {
    if (str === null || str === undefined || str === '') return 'NULL';
    str = String(str);
    return `'${str.replace(/'/g, "''")}'`;
}

function parseBool(str) {
    if (!str) return 0;
    return str.trim().toLowerCase() === 'yes' ? 1 : 0;
}

function parseDate(str) {
    if (!str) return 'NULL';
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
        return escapeSql(date.toISOString().split('T')[0]);
    }
    return escapeSql(str);
}

function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

async function generate() {
    try {
        const platforms = await parseCsv(path.join(__dirname, '../Collection - Platforms.csv'));
        const games = await parseCsv(path.join(__dirname, '../Collection - Games.csv'));
        const figures = await parseCsv(path.join(__dirname, '../Collection - Figures.csv'));

        let sql = 'PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n';

        // Insert Platforms
        for (const p of platforms) {
            if (!p.Platform) continue;
            sql += `INSERT INTO platforms (name, brand, launch_date) VALUES (${escapeSql(p.Platform)}, ${escapeSql(p.Brand)}, ${parseDate(p.Launch)});\n`;
        }

        // Insert Games
        let seenGameIds = new Set();
        for (const g of games) {
            if (!g.Title) continue;
            let baseId = slugify(g.Title) + '-' + slugify(g.Platform);
            let gameId = baseId;
            let counter = 2;
            while(seenGameIds.has(gameId)) {
                gameId = baseId + '-' + counter++;
            }
            seenGameIds.add(gameId);
            
            sql += `INSERT INTO games (id, title, series, release_date, platform, owned, queued) VALUES (${escapeSql(gameId)}, ${escapeSql(g.Title)}, ${escapeSql(g.Series)}, ${parseDate(g.Release)}, ${escapeSql(g.Platform)}, ${parseBool(g.Owned)}, ${parseBool(g.Queued)});\n`;
        }

        // Insert Figures
        let seriesMap = new Map();
        for (const f of figures) {
            const line = f.Line || '';
            const seriesName = f.Series || '';
            if (!line && !seriesName) continue;
            
            const key = `${line}|||${seriesName}`;
            if (!seriesMap.has(key)) {
                let sId = slugify(line) + '-' + slugify(seriesName);
                if (!sId || sId === '-') sId = 'series-' + Math.random().toString(36).substring(7);
                seriesMap.set(key, { id: sId, line, name: seriesName, sort_index: 'NULL' });
            }
            if (line === 'Skylanders' && f.Grouping) {
                let sIdx = parseInt(f.Grouping, 10);
                if (!isNaN(sIdx)) {
                    seriesMap.get(key).sort_index = sIdx;
                }
            }
        }

        for (const s of seriesMap.values()) {
            sql += `INSERT INTO figure_series (id, line, name, sort_index) VALUES (${escapeSql(s.id)}, ${escapeSql(s.line)}, ${escapeSql(s.name)}, ${s.sort_index});\n`;
        }

        let seenFigureIds = new Set();
        for (const f of figures) {
            if (!f.Name && !f.Line && !f.Series) continue;
            const key = `${f.Line || ''}|||${f.Series || ''}`;
            const seriesData = seriesMap.get(key);
            const sId = seriesData ? escapeSql(seriesData.id) : 'NULL';
            
            let sortIndex = parseInt(f.Index, 10);
            sortIndex = isNaN(sortIndex) ? 'NULL' : sortIndex;
            
            let baseId = slugify(f.Name) + '-' + slugify(f.Line) + '-' + slugify(f.Series);
            let figId = baseId;
            let counter = 2;
            while(seenFigureIds.has(figId)) {
                figId = baseId + '-' + counter++;
            }
            seenFigureIds.add(figId);

            sql += `INSERT INTO figures (id, name, line, series_id, sort_index, owned) VALUES (${escapeSql(figId)}, ${escapeSql(f.Name)}, ${escapeSql(f.Line)}, ${sId}, ${sortIndex}, ${parseBool(f.Owned)});\n`;
        }

        sql += 'COMMIT;\nPRAGMA foreign_keys = ON;\n';

        fs.writeFileSync(path.join(__dirname, '../data.sql'), sql);
        console.log('data.sql generated successfully.');
    } catch (e) {
        console.error(e);
    }
}

generate();
