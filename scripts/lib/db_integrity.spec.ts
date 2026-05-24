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

  it('should have the correct total number of games for each ownership status', () => {
    // Query the 'game_releases' table joined with games to ensure the count of items by status
    // matches the hardcoded snapshot. This catches accidental deletions or status changes.
    const counts = db
      .prepare(
        `
        SELECT COALESCE(max_ownership, 0) as ownership_status, COUNT(*) as count
        FROM games g
        LEFT JOIN (
            SELECT game_id, MAX(ownership_status) as max_ownership
            FROM game_releases
            GROUP BY game_id
        ) r ON g.stable_id = r.game_id
        GROUP BY COALESCE(max_ownership, 0)
      `,
      )
      .all() as { ownership_status: number; count: number }[];
    const actual = counts.reduce(
      (acc, row) => {
        acc[row.ownership_status] = row.count;
        return acc;
      },
      {} as Record<number, number>,
    );

    expect(actual[0] ?? 0).toBe(2363); // Unowned (Not in collection)
    expect(actual[1] ?? 0).toBe(1977); // Owned (In collection)
    expect(actual[2] ?? 0).toBe(0); // Seeking (Actively looking to acquire)
    expect(actual[3] ?? 0).toBe(0); // Ordered (Purchased but not yet received)
  });

  it('should have the correct number of games per platform for each status', () => {
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
    const platformCounts = db
      .prepare(
        `
            SELECT COALESCE(pp.display_name, p.display_name) as display_name, COALESCE(r.ownership_status, 0) as ownership_status, COUNT(g.stable_id) as count
            FROM games g
            LEFT JOIN (
                SELECT game_id, MAX(ownership_status) as ownership_status
                FROM game_releases
                GROUP BY game_id
            ) r ON g.stable_id = r.game_id
            JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            GROUP BY COALESCE(pp.display_name, p.display_name), COALESCE(r.ownership_status, 0)
            ORDER BY COALESCE(pp.brand, p.brand) ASC, COALESCE(pp.launch_date, p.launch_date) ASC, COALESCE(r.ownership_status, 0) DESC
        `,
      )
      .all() as {
      display_name: string;
      ownership_status: number;
      count: number;
    }[];

    const expected = {
      '3DO Interactive Multiplayer (Unowned)': 3,
      'Atari 2600 (Owned)': 6,
      'Atari 2600 (Unowned)': 10,
      'Atari 5200 (Owned)': 3,
      'Atari 5200 (Unowned)': 4,
      'Atari 7800 (Owned)': 2,
      'Atari 7800 (Unowned)': 4,
      'Atari Lynx (Unowned)': 5,
      'Atari Jaguar (Unowned)': 5,
      'ColecoVision (Owned)': 1,
      'ColecoVision (Unowned)': 1,
      'Intellivision (Owned)': 1,
      'Intellivision (Unowned)': 4,
      'Neo Geo Pocket Color (Unowned)': 2,
      'Famicom (Owned)': 1,
      'Nintendo Entertainment System (Owned)': 49,
      'Nintendo Entertainment System (Unowned)': 45,
      'Game Boy (Owned)': 26,
      'Game Boy (Unowned)': 62,
      'Super Nintendo Entertainment System (Owned)': 42,
      'Super Nintendo Entertainment System (Unowned)': 42,
      'Virtual Boy (Owned)': 3,
      'Virtual Boy (Unowned)': 1,
      'Nintendo 64 (Owned)': 40,
      'Nintendo 64 (Unowned)': 27,
      'Game Boy Color (Owned)': 18,
      'Game Boy Color (Unowned)': 55,
      'Game Boy Advance (Owned)': 69,
      'Game Boy Advance (Unowned)': 123,
      'Nintendo GameCube (Owned)': 56,
      'Nintendo GameCube (Unowned)': 85,
      'Nintendo DS (Owned)': 71,
      'Nintendo DS (Unowned)': 162,
      'Wii (Owned)': 63,
      'Wii (Unowned)': 103,
      'Nintendo 3DS (Owned)': 71,
      'Nintendo 3DS (Unowned)': 93,
      'Wii U (Owned)': 50,
      'Wii U (Unowned)': 41,
      'New Nintendo 3DS (Owned)': 3,
      'Nintendo Switch (Owned)': 333,
      'Nintendo Switch (Unowned)': 96,
      'Nintendo Switch 2 (Owned)': 11,
      'Philips CD-i (Owned)': 3,
      'Philips CD-i (Unowned)': 5,
      'PlayStation (Owned)': 46,
      'PlayStation (Unowned)': 80,
      'PlayStation 2 (Owned)': 78,
      'PlayStation 2 (Unowned)': 148,
      'PlayStation Portable (Owned)': 27,
      'PlayStation Portable (Unowned)': 75,
      'PlayStation 3 (Owned)': 103,
      'PlayStation 3 (Unowned)': 183,
      'PlayStation Vita (Owned)': 36,
      'PlayStation Vita (Unowned)': 48,
      'PlayStation 4 (Owned)': 311,
      'PlayStation 4 (Unowned)': 213,
      'PlayStation 5 (Owned)': 124,
      'PlayStation 5 (Unowned)': 19,
      'Sega Master System (Owned)': 1,
      'Sega Master System (Unowned)': 15,
      'Sega Genesis (Owned)': 14,
      'Sega Genesis (Unowned)': 43,
      'Sega Game Gear (Owned)': 14,
      'Sega Game Gear (Unowned)': 28,
      'Sega CD (Owned)': 4,
      'Sega CD (Unowned)': 6,
      'Sega Pico (Unowned)': 3,
      'Sega 32X (Owned)': 3,
      'Sega 32X (Unowned)': 2,
      'Sega Saturn (Owned)': 4,
      'Sega Saturn (Unowned)': 22,
      'Dreamcast (Owned)': 8,
      'Dreamcast (Unowned)': 20,
      'Game.com (Unowned)': 1,
      'TurboGrafx-16 (Owned)': 6,
      'TurboGrafx-16 (Unowned)': 3,
      'TurboGrafx CD (Unowned)': 6,
      'Xbox (Owned)': 25,
      'Xbox (Unowned)': 95,
      'Xbox 360 (Owned)': 81,
      'Xbox 360 (Unowned)': 202,
      'Xbox One (Owned)': 153,
      'Xbox One (Unowned)': 171,
      'Xbox Series X (Owned)': 17,
      'Xbox Series X (Unowned)': 2,
    };

    // Reduce the SQL result rows into a flat lookup object formatted as "Platform (Status)": Count
    // e.g., "PlayStation 4 (Owned)": 311
    // This allows for a clean deep-equality check against the 'expected' snapshot.
    const actual = platformCounts.reduce(
      (acc, row) => {
        const statusStr =
          row.ownership_status === 1
            ? 'Owned'
            : row.ownership_status === 2
              ? 'Seeking'
              : row.ownership_status === 3
                ? 'Ordered'
                : 'Unowned';
        acc[`${row.display_name} (${statusStr})`] = row.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    expect(actual).toEqual(expected);
  });

  it('should correctly map PlayStation VR to PlayStation 4', () => {
    // Specifically verify that a known PSVR game (id 51) is correctly
    // associated with the PS4 display name in the reporting query.
    const psvrGame = db
      .prepare(
        `
            SELECT COALESCE(pp.display_name, p.display_name) as parent_name
            FROM games g
            JOIN platforms p ON g.platform_id = p.id
            LEFT JOIN platforms pp ON p.parent_platform_id = pp.id
            WHERE p.id = 51
            LIMIT 1
        `,
      )
      .get() as { parent_name: string };

    expect(psvrGame.parent_name).toBe('PlayStation 4');
  });

  describe('Toy Integrity', () => {
    it('should have the correct total number of toys', () => {
      // Verify the total count of all toys (amiibo, Skylanders, Starlink)
      // matches the master dataset snapshot.
      const totalToys = db
        .prepare('SELECT COUNT(*) as count FROM toys')
        .get() as { count: number };
      expect(totalToys.count).toBe(1492);
    });

    it('should have the correct total number of toys for each ownership status', () => {
      const counts = db
        .prepare(
          'SELECT ownership_status, COUNT(*) as count FROM toys GROUP BY ownership_status',
        )
        .all() as { ownership_status: number; count: number }[];
      const actual = counts.reduce(
        (acc, row) => {
          acc[row.ownership_status] = row.count;
          return acc;
        },
        {} as Record<number, number>,
      );

      expect(actual[0] ?? 0).toBe(866); // Unowned (Not in collection)
      expect(actual[1] ?? 0).toBe(626); // Owned (In collection)
      expect(actual[2] ?? 0).toBe(0); // Seeking (Actively looking to acquire)
      expect(actual[3] ?? 0).toBe(0); // Ordered (Purchased but not yet received)
    });

    it('should have the correct number of toys per line for each status', () => {
      const lineCounts = db
        .prepare(
          `
                SELECT line, ownership_status, COUNT(*) as count 
                FROM toys 
                GROUP BY line, ownership_status 
                ORDER BY line ASC, ownership_status DESC
            `,
        )
        .all() as { line: string; ownership_status: number; count: number }[];

      const expected = {
        'Skylanders (Owned)': 351,
        'Skylanders (Unowned)': 161,
        'Starlink (Owned)': 35,
        'amiibo (Owned)': 240,
        'amiibo (Unowned)': 705,
      };

      const actual = lineCounts.reduce(
        (acc, row) => {
          const statusStr =
            row.ownership_status === 1
              ? 'Owned'
              : row.ownership_status === 2
                ? 'Seeking'
                : row.ownership_status === 3
                  ? 'Ordered'
                  : 'Unowned';
          acc[`${row.line} (${statusStr})`] = row.count;
          return acc;
        },
        {} as Record<string, number>,
      );

      expect(actual).toEqual(expected);
    });

    it('should have all toys correctly associated with a series', () => {
      // Ensure no toys are "orphaned" by having a missing or
      // invalid series_id reference.
      const orphanedToys = db
        .prepare(
          `
                SELECT COUNT(*) as count 
                FROM toys t
                LEFT JOIN toy_series ts ON t.series_id = ts.id
                WHERE t.series_id IS NULL OR ts.id IS NULL
            `,
        )
        .get() as { count: number };

      expect(orphanedToys.count).toBe(0);
    });
  });
});
