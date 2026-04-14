const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('collection.sqlite');

function resetItems() {
    const reportPath = 'discovery_report.md';
    if (!fs.existsSync(reportPath)) {
        console.log('No discovery report found.');
        return;
    }

    const report = fs.readFileSync(reportPath, 'utf8');
    const syncSectionMatch = report.match(/## Action Required: Sync Suggestions[\r\n]+([\s\S]*?)(?:[\r\n]## [^#]|$)/);
    
    if (!syncSectionMatch) {
        console.log('No sync suggestions found in report.');
        return;
    }

    const section = syncSectionMatch[1];
    console.log(`Searching in section of length: ${section.length}`);
    const itemMatches = [...section.matchAll(/### (.*?) \((.*?)\)/g)];
    console.log(`Found ${itemMatches.length} candidates.`);
    
    for (const match of itemMatches) {
        const title = match[1].trim();
        const platformName = match[2].trim();
        
        console.log(`Attempting reset for: "${title}" on "${platformName}"`);
        
        const platform = db.prepare('SELECT id FROM platforms WHERE display_name = ?').get(platformName);
        if (platform) {
            const result = db.prepare('UPDATE games SET region = NULL WHERE title = ? AND platform_id = ?').run(title, platform.id);
            console.log(`  Processed: ${result.changes} changes.`);
        } else {
            console.log(`  Platform not found: "${platformName}"`);
        }
    }
}

resetItems();
