import Database from 'better-sqlite3';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const db = new Database('collection.sqlite');

interface AmiiboApiItem {
    name: string;
    head: string;
    tail: string;
    amiiboSeries: string;
    gameSeries: string;
    image: string;
    type: string;
    release: {
        na?: string;
        jp?: string;
        eu?: string;
        au?: string;
    };
}

interface DiscoveryOption {
    name: string;
    platform: string;
    id: string;
    image_url: string;
    summary: string;
}

interface DiscoveryItem {
    title: string;
    platform: string;
    options: DiscoveryOption[];
}

async function discoverAmiibo() {
    console.log('--- Discovering Amiibo ---');
    try {
        const response = await axios.get('https://amiiboapi.org/api/amiibo/');
        const allAmiibo = response.data.amiibo as AmiiboApiItem[];
        
        const localAmiibos = db.prepare("SELECT * FROM figures WHERE line = 'amiibo'").all() as { name: string; amiibo_id?: string; verified?: number }[];
        const localAmiiboIds = new Set(localAmiibos.map(f => f.amiibo_id).filter(Boolean));
        const localNames = new Set(localAmiibos.map(f => f.name.toLowerCase()));

        const discoveryItems: DiscoveryItem[] = [];

        // 1. Find local amiibos that are NOT verified
        const unverified = localAmiibos.filter(f => !f.verified);
        for (const local of unverified) {
            const matches = allAmiibo.filter((a: AmiiboApiItem) => 
                a.name.toLowerCase().includes(local.name.toLowerCase()) ||
                local.name.toLowerCase().includes(a.name.toLowerCase())
            ).slice(0, 5);

            if (matches.length > 0) {
                discoveryItems.push({
                    title: local.name,
                    platform: 'amiibo',
                    options: matches.map((m: AmiiboApiItem) => ({
                        name: `${m.name} (${m.amiiboSeries})`,
                        platform: 'amiibo',
                        id: `amiibo-${m.head}${m.tail}`,
                        image_url: m.image,
                        summary: `Game Series: ${m.gameSeries}`
                    }))
                });
            }
        }

        // 2. Find amiibo in API that are NOT in local collection at all (New Discoveries)
        const newItems = allAmiibo.filter((a: AmiiboApiItem) => {
            const id = `${a.head}${a.tail}`;
            return !localAmiiboIds.has(id) && !localNames.has(a.name.toLowerCase());
        });

        console.log(`Found ${unverified.length} unverified local amiibos and ${newItems.length} new items in API.`);

        // Generate Markdown
        let markdown = '\n\n## Figure Discovery (Amiibo)\n\n';
        
        if (discoveryItems.length === 0 && newItems.length === 0) {
            markdown += 'All local amiibos are verified and no new items found.\n';
        }

        for (const item of discoveryItems) {
            markdown += `### ${item.title} (amiibo)\n`;
            for (const opt of item.options) {
                markdown += `- [ ] **Link to:** ${opt.name} (amiibo) - ID: ${opt.id}\n`;
                markdown += `  - ![image](${opt.image_url})\n`;
                markdown += `  - *${opt.summary}*\n`;
            }
            markdown += '\n';
        }

        if (newItems.length > 0) {
            markdown += `### New Amiibo Available (Not in Collection)\n`;
            markdown += `The following items were found in the AmiiboAPI but are not in your collection yet:\n\n`;
            for (const item of newItems.slice(0, 10)) {
                markdown += `- **${item.name}** (${item.amiiboSeries}) - *${item.gameSeries}*\n`;
            }
            if (newItems.length > 10) {
                markdown += `\n*...and ${newItems.length - 10} more items.*\n`;
            }
        }

        const reportPath = path.join(process.cwd(), 'discovery_report.md');
        fs.appendFileSync(reportPath, markdown);
        console.log('Appended figure discovery to discovery_report.md');

    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Amiibo Discovery Error:', error.message);
        } else {
            console.error('Amiibo Discovery Error:', error);
        }
    }
}

discoverAmiibo();
