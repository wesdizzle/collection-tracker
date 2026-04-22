
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

/**
 * DATABASE INTEGRITY TESTS
 * 
 * These tests ensure the collection database maintains its expected state.
 * Any manual edits that accidentally delete or add games will trigger a failure here.
 * This acts as a "safety net" for the sqlite file.
 */
describe('Database Integrity', () => {
    const db = new Database('collection.sqlite');

    it('should have the correct total number of games owned', () => {
        // Query the 'games' table directly to ensure the raw count of owned items (owned = 1)
        // matches the hardcoded snapshot. This catches accidental deletions or status changes.
        const ownedGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE owned = 1').get() as { count: number };
        expect(ownedGames.count).toBe(1978);
    });

    it('should have the correct total number of games wanted', () => {
        // Query the 'games' table directly for wanted items (owned = 0).
        const wantedGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE owned = 0').get() as { count: number };
        expect(wantedGames.count).toBe(2362);
    });

    it('should have the correct number of owned and wanted games per platform', () => {
        /**
         * COMPLEX PLATFORM AGGREGATION QUERY
         * 
         * This query retrieves game counts grouped by their "parent" platform.
         * 
         * 1. COALESCE(pp.display_name, p.display_name): If a platform has a parent_platform_id (e.g., PSVR -> PS4),
         *    it uses the parent's display name for grouping. This ensures PSVR games are counted under "PlayStation 4".
         * 2. LEFT JOIN platforms pp: Links sub-platforms to their parent definitions.
         * 3. ORDER BY: Sorts by brand and launch date (using parent metadata where applicable) to match 
         *    the consistent ordering in the 'expected' object below.
         */
        const platformCounts = db.prepare(`
            SELECT COALESCE(pp.display_name, p.display_name) as display_name, g.owned, COUNT(g.stable_id) as count
            FROM games g
            JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            GROUP BY COALESCE(pp.display_name, p.display_name), g.owned
            ORDER BY COALESCE(pp.brand, p.brand) ASC, COALESCE(pp.launch_date, p.launch_date) ASC, g.owned DESC
        `).all() as { display_name: string, owned: number, count: number }[];

        const expected = {
            "3DO Interactive Multiplayer (Wanted)": 3,
            "Atari 2600 (Owned)": 6,
            "Atari 2600 (Wanted)": 10,
            "Atari 5200 (Owned)": 3,
            "Atari 5200 (Wanted)": 4,
            "Atari 7800 (Owned)": 2,
            "Atari 7800 (Wanted)": 4,
            "Atari Lynx (Wanted)": 5,
            "Atari Jaguar (Wanted)": 5,
            "ColecoVision (Owned)": 1,
            "ColecoVision (Wanted)": 1,
            "Intellivision (Owned)": 1,
            "Intellivision (Wanted)": 4,
            "Neo Geo Pocket Color (Wanted)": 2,
            "Famicom (Owned)": 1,
            "Nintendo Entertainment System (Owned)": 49,
            "Nintendo Entertainment System (Wanted)": 45,
            "Game Boy (Owned)": 26,
            "Game Boy (Wanted)": 62,
            "Super Nintendo Entertainment System (Owned)": 42,
            "Super Nintendo Entertainment System (Wanted)": 42,
            "Virtual Boy (Owned)": 3,
            "Virtual Boy (Wanted)": 1,
            "Nintendo 64 (Owned)": 40,
            "Nintendo 64 (Wanted)": 27,
            "Game Boy Color (Owned)": 18,
            "Game Boy Color (Wanted)": 55,
            "Game Boy Advance (Owned)": 69,
            "Game Boy Advance (Wanted)": 123,
            "Nintendo GameCube (Owned)": 56,
            "Nintendo GameCube (Wanted)": 85,
            "Nintendo DS (Owned)": 71,
            "Nintendo DS (Wanted)": 161,
            "Wii (Owned)": 63,
            "Wii (Wanted)": 103,
            "Nintendo 3DS (Owned)": 71,
            "Nintendo 3DS (Wanted)": 93,
            "Wii U (Owned)": 50,
            "Wii U (Wanted)": 41,
            "New Nintendo 3DS (Owned)": 3,
            "Nintendo Switch (Owned)": 333,
            "Nintendo Switch (Wanted)": 96,
            "Nintendo Switch 2 (Owned)": 11,
            "Philips CD-i (Owned)": 3,
            "Philips CD-i (Wanted)": 5,
            "PlayStation (Owned)": 46,
            "PlayStation (Wanted)": 80,
            "PlayStation 2 (Owned)": 78,
            "PlayStation 2 (Wanted)": 148,
            "PlayStation Portable (Owned)": 27,
            "PlayStation Portable (Wanted)": 75,
            "PlayStation 3 (Owned)": 103,
            "PlayStation 3 (Wanted)": 184,
            "PlayStation Vita (Owned)": 36,
            "PlayStation Vita (Wanted)": 48,
            "PlayStation 4 (Owned)": 311,
            "PlayStation 4 (Wanted)": 212,
            "PlayStation 5 (Owned)": 125,
            "PlayStation 5 (Wanted)": 19,
            "Sega Master System (Owned)": 1,
            "Sega Master System (Wanted)": 15,
            "Sega Genesis (Owned)": 14,
            "Sega Genesis (Wanted)": 43,
            "Sega Game Gear (Owned)": 14,
            "Sega Game Gear (Wanted)": 28,
            "Sega CD (Owned)": 4,
            "Sega CD (Wanted)": 6,
            "Sega Pico (Wanted)": 3,
            "Sega 32X (Owned)": 3,
            "Sega 32X (Wanted)": 2,
            "Sega Saturn (Owned)": 4,
            "Sega Saturn (Wanted)": 22,
            "Dreamcast (Owned)": 8,
            "Dreamcast (Wanted)": 20,
            "Game.com (Wanted)": 1,
            "TurboGrafx-16 (Owned)": 6,
            "TurboGrafx-16 (Wanted)": 3,
            "TurboGrafx CD (Wanted)": 6,
            "Xbox (Owned)": 25,
            "Xbox (Wanted)": 95,
            "Xbox 360 (Owned)": 81,
            "Xbox 360 (Wanted)": 202,
            "Xbox One (Owned)": 153,
            "Xbox One (Wanted)": 171,
            "Xbox Series X (Owned)": 17,
            "Xbox Series X (Wanted)": 2
        };

        // Reduce the SQL result rows into a flat lookup object formatted as "Platform (Status)": Count
        // e.g., "PlayStation 4 (Owned)": 311
        // This allows for a clean deep-equality check against the 'expected' snapshot.
        const actual = platformCounts.reduce((acc, row) => {
            const status = row.owned === 1 ? 'Owned' : 'Wanted';
            acc[`${row.display_name} (${status})`] = row.count;
            return acc;
        }, {} as Record<string, number>);

        expect(actual).toEqual(expected);
    });
});
