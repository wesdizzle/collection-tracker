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
        expect(ownedGames.count).toBe(1977);
    });

    it('should have the correct total number of games wanted', () => {
        // Query the 'games' table directly for wanted items (owned = 0).
        const wantedGames = db.prepare('SELECT COUNT(*) as count FROM games WHERE owned = 0').get() as { count: number };
        expect(wantedGames.count).toBe(2363);
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
            "Nintendo DS (Wanted)": 162,
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
            "PlayStation 3 (Wanted)": 183,
            "PlayStation Vita (Owned)": 36,
            "PlayStation Vita (Wanted)": 48,
            "PlayStation 4 (Owned)": 311,
            "PlayStation 4 (Wanted)": 213,
            "PlayStation 5 (Owned)": 124,
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

    it('should correctly map PlayStation VR to PlayStation 4', () => {
        // Specifically verify that a known PSVR game (id 51) is correctly 
        // associated with the PS4 display name in the reporting query.
        const psvrGame = db.prepare(`
            SELECT COALESCE(pp.display_name, p.display_name) as parent_name
            FROM games g
            JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            WHERE p.id = 51
            LIMIT 1
        `).get() as { parent_name: string };

        expect(psvrGame.parent_name).toBe('PlayStation 4');
    });

    describe('Toy Integrity', () => {
        it('should have the correct total number of toys', () => {
            // Verify the total count of all toys (amiibo, Skylanders, Starlink)
            // matches the master dataset snapshot.
            const totalToys = db.prepare('SELECT COUNT(*) as count FROM toys').get() as { count: number };
            expect(totalToys.count).toBe(1492);
        });

        it('should have the correct total number of toys owned', () => {
            const ownedToys = db.prepare('SELECT COUNT(*) as count FROM toys WHERE owned = 1').get() as { count: number };
            expect(ownedToys.count).toBe(626);
        });

        it('should have the correct total number of toys wanted', () => {
            const wantedToys = db.prepare('SELECT COUNT(*) as count FROM toys WHERE owned = 0').get() as { count: number };
            expect(wantedToys.count).toBe(866);
        });

        it('should have the correct number of owned and wanted toys per line', () => {
            const lineCounts = db.prepare(`
                SELECT line, owned, COUNT(*) as count 
                FROM toys 
                GROUP BY line, owned 
                ORDER BY line ASC, owned DESC
            `).all() as { line: string, owned: number, count: number }[];

            const expected = {
                'Skylanders (Owned)': 351,
                'Skylanders (Wanted)': 161,
                'Starlink (Owned)': 35,
                'amiibo (Owned)': 240,
                'amiibo (Wanted)': 705
            };

            const actual = lineCounts.reduce((acc, row) => {
                const status = row.owned === 1 ? 'Owned' : 'Wanted';
                acc[`${row.line} (${status})`] = row.count;
                return acc;
            }, {} as Record<string, number>);

            expect(actual).toEqual(expected);
        });

        it('should have all toys correctly associated with a series', () => {
            // Ensure no toys are "orphaned" by having a missing or 
            // invalid series_id reference.
            const orphanedToys = db.prepare(`
                SELECT COUNT(*) as count 
                FROM toys t
                LEFT JOIN toy_series ts ON t.series_id = ts.id
                WHERE t.series_id IS NULL OR ts.id IS NULL
            `).get() as { count: number };

            expect(orphanedToys.count).toBe(0);
        });
    });
});
