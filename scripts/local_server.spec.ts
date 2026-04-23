import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { handleRequest } from './local_server';
import { EventEmitter } from 'events';

/**
 * UNIT TEST: Local Server API Logic
 * 
 * Verifies that the Node.js standalone server correctly implements 
 * the collection API using shared queries and handles platform hierarchy.
 */

describe('Local Server API Logic', () => {
    let mockDb: Database.Database;

    beforeEach(() => {
        // Setup in-memory DB
        mockDb = new Database(':memory:');
        mockDb.exec(`
            CREATE TABLE platforms (
                id INTEGER PRIMARY KEY, 
                display_name TEXT, 
                brand TEXT, 
                launch_date DATE, 
                parent_platform_id INTEGER,
                image_url TEXT
            );
            CREATE TABLE games (
                stable_id INTEGER PRIMARY KEY, 
                id TEXT, 
                title TEXT, 
                series TEXT, 
                canonical_series TEXT,
                release_date DATE, 
                platform_id INTEGER, 
                owned BOOLEAN,
                sort_index INTEGER
            );
        `);

        // Seed data
        mockDb.prepare('INSERT INTO platforms (id, display_name, brand, launch_date, parent_platform_id) VALUES (?, ?, ?, ?, ?)').run(
            34, 'PlayStation 4', 'Sony', '2013-11-15', null
        );
        mockDb.prepare('INSERT INTO platforms (id, display_name, brand, launch_date, parent_platform_id) VALUES (?, ?, ?, ?, ?)').run(
            51, 'PlayStation VR', 'Sony', '2016-10-13', 34
        );
        mockDb.prepare('INSERT INTO games (stable_id, id, title, platform_id, release_date) VALUES (?, ?, ?, ?, ?)').run(
            1, 'game-1', 'Bloodborne', 34, '2015-03-24'
        );
        mockDb.prepare('INSERT INTO games (stable_id, id, title, platform_id, release_date) VALUES (?, ?, ?, ?, ?)').run(
            2, 'game-2', 'PSVR Demo Disc', 51, '2016-10-13'
        );
    });

    /**
     * Helper to mock Node.js req/res
     */
    const createMocks = (url: string, method = 'GET') => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req = new EventEmitter() as any;
        req.url = url;
        req.method = method;
        req.headers = {};

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = new EventEmitter() as any;
        res.setHeader = vi.fn();
        res.end = vi.fn();
        res.statusCode = 200;

        return { req, res };
    };

    it('should return games list with normalized platform info', async () => {
        const { req, res } = createMocks('/api/games');
        const handler = handleRequest(mockDb);

        await handler(req, res);

        expect(res.end).toHaveBeenCalled();
        const output = JSON.parse(res.end.mock.calls[0][0]);
        
        // Both games should be returned
        expect(output.length).toBe(2);

        // PSVR game should have PS4 info coalesced
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const psvrGame = output.find((g: any) => g.platform_id === 51);
        expect(psvrGame.display_name).toBe('PlayStation 4'); // Coalesced from parent
        expect(psvrGame.parent_platform_id).toBe(34);
    });

    it('should filter games by parent platform (including child platforms)', async () => {
        const { req, res } = createMocks('/api/games?platform=34'); // Filter by PS4
        const handler = handleRequest(mockDb);

        await handler(req, res);

        const output = JSON.parse(res.end.mock.calls[0][0]);
        
        // Should include both PS4 game and PSVR game
        expect(output.length).toBe(2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(output.every((g: any) => g.platform_id === 34 || g.parent_platform_id === 34)).toBe(true);
    });

    it('should return game detail with normalized platform info', async () => {
        const { req, res } = createMocks('/api/games/game-2'); // The PSVR game
        const handler = handleRequest(mockDb);

        await handler(req, res);

        const output = JSON.parse(res.end.mock.calls[0][0]);
        
        expect(output.title).toBe('PSVR Demo Disc');
        expect(output.display_name).toBe('PlayStation 4'); // Coalesced
        expect(output.platform_launch_date).toBe('2013-11-15'); // PS4 launch date
    });

    it('should list platforms excluding children', async () => {
        const { req, res } = createMocks('/api/platforms');
        const handler = handleRequest(mockDb);

        await handler(req, res);

        const output = JSON.parse(res.end.mock.calls[0][0]);
        
        // Should only have PS4, not PSVR
        expect(output.length).toBe(1);
        expect(output[0].id).toBe(34);
        expect(output[0].parent_platform_id).toBeNull();
    });
});
