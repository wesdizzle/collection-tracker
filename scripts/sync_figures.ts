/**
 * FIGURE SYNCHRONIZATION PIPELINE
 * 
 * This script automates the retrieval of metadata for physical figures (amiibo, 
 * Skylanders). It bridges the gap between local database entries and specialized 
 * figure APIs/fan-maintained lists.
 * 
 * ARCHITECTURAL DESIGN:
 * 1. **AmiiboAPI Integration**: Uses the comprehensive amiiboapi.org to 
 *    fetch high-resolution images, release dates (prioritized by region), 
 *    and canonical IDs.
 * 2. **SCL Scraping (Skylanders)**: Since no official API exists for 
 *    Skylanders, this script scrapes the 'Skylanders Character List' (SCL) 
 *    to retrieve verified character URLs for documentation.
 * 3. **Normalization Heuristics**: Employs `superNormalize` to handle name 
 *    variations (e.g. "Series 2", "Chase Variants") that often differ 
 *    between local logs and online databases.
 */

import Database from 'better-sqlite3';
import axios from 'axios';
import * as cheerio from 'cheerio';

axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const db = new Database('collection.sqlite');

interface AmiiboApiItem {
    name: string;
    character: string;
    amiiboSeries: string;
    gameSeries: string;
    image: string;
    head: string;
    tail: string;
    type: string;
    release: {
        na?: string;
        jp?: string;
        eu?: string;
        au?: string;
    };
}

interface LocalFigure {
    id: string;
    name: string;
    line: string;
    verified?: number;
}

function superNormalize(s: string) {
    return (s || '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .replace(/series[0-9]+/g, '')
        .trim();
}

async function syncAmiibo() {
    console.log('--- Syncing Amiibo ---');
    try {
        const response = await axios.get('https://amiiboapi.org/api/amiibo/');
        const allAmiibo = response.data.amiibo as AmiiboApiItem[];
        console.log(`Fetched ${allAmiibo.length} amiibo from API.`);

        const localAmiibos = db.prepare("SELECT * FROM figures WHERE line = 'amiibo'").all() as LocalFigure[];
        console.log(`Matching against ${localAmiibos.length} local amiibos.`);

        const updateStmt = db.prepare(`
            UPDATE figures 
            SET image_url = ?, release_date = ?, amiibo_id = ?, region = ?, game_series = ?, figure_series = ?, type = ?, verified = 1, metadata_json = ?
            WHERE id = ?
        `);

        let matched = 0;
        for (const local of localAmiibos) {
            const match = allAmiibo.find(a => 
                a.name.toLowerCase() === local.name.toLowerCase() ||
                `${a.character} - ${a.amiiboSeries}`.toLowerCase() === local.name.toLowerCase()
            );

            if (match) {
                // Determine primary region and date
                let region = 'NA';
                let releaseDate = match.release.na;
                if (!releaseDate) { region = 'JP'; releaseDate = match.release.jp; }
                if (!releaseDate) { region = 'EU'; releaseDate = match.release.eu; }
                if (!releaseDate) { region = 'AU'; releaseDate = match.release.au; }

                updateStmt.run(
                    match.image, 
                    releaseDate, 
                    `${match.head}${match.tail}`, 
                    region,
                    match.gameSeries,
                    match.amiiboSeries,
                    match.type,
                    JSON.stringify(match), 
                    local.id
                );
                matched++;
            }
        }
        console.log(`Successfully matched and updated ${matched} amiibo.`);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Amiibo Sync Error:', error.message);
        } else {
            console.error('Amiibo Sync Error:', error);
        }
    }
}

async function syncSkylanders() {
    console.log('--- Syncing Skylanders ---');
    // Note: User requested to pause image scraping for now.
    // We will only sync the SCL URL (scl_url) from the master list.
    
    const listPages = [
        'https://skylanderscharacterlist.com/spyros-adventure-figures/',
        'https://skylanderscharacterlist.com/giants-figures/',
        'https://skylanderscharacterlist.com/swap-force-figures/',
        'https://skylanderscharacterlist.com/trap-team-figures/',
        'https://skylanderscharacterlist.com/superchargers-figures/',
        'https://skylanderscharacterlist.com/imaginators-figures/',
        'https://skylanderscharacterlist.com/chase-variants/',
        'https://skylanderscharacterlist.com/in-game-variants/'
    ];

    try {
        const characterData: { name: string, url: string }[] = [];
        
        for (const page of listPages) {
            console.log(`Fetching ${page}...`);
            const response = await axios.get(page);
            const $ = cheerio.load(response.data);
            
            $('.post-content a.fusion-no-lightbox').each((_, el) => {
                const $el = $(el);
                const url = $el.attr('href');
                const name = $el.find('img').attr('alt')?.replace(/ - SCL$/, '').trim() || '';
                
                if (name && url) {
                    characterData.push({ name, url });
                }
            });
        }

        const localSkylanders = db.prepare("SELECT * FROM figures WHERE line = 'Skylanders'").all() as LocalFigure[];
        console.log(`Matching against ${localSkylanders.length} local Skylanders.`);

        const updateStmt = db.prepare(`
            UPDATE figures 
            SET scl_url = ?, verified = 1
            WHERE id = ?
        `);

        let matchedCount = 0;
        for (const local of localSkylanders) {
            const localNorm = superNormalize(local.name);
            const match = characterData.find(c => {
                const apiNorm = superNormalize(c.name);
                return apiNorm === localNorm || apiNorm.includes(localNorm) || localNorm.includes(apiNorm);
            });

            if (match) {
                updateStmt.run(match.url, local.id);
                matchedCount++;
            }
        }
        console.log(`Successfully matched and updated ${matchedCount} Skylanders metadata.`);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Skylanders Sync Error:', error.message);
        } else {
            console.error('Skylanders Sync Error:', error);
        }
    }
}

async function run() {
    await syncAmiibo();
    await syncSkylanders();
    console.log('--- Sync Complete ---');
}

run();
