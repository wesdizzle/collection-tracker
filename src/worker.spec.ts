import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import worker from './worker';

/**
 * UNIT TEST: Cloudflare Worker Logic
 * 
 * We mock the D1 binding using an in-memory Better-SQLite3 instance.
 * This allows us to verify the SQL logic and route handling without 
 * relying on the stability of the Cloudflare test runner/local disk state.
 */
describe('Worker API Logic', () => {
    let mockDb: any;
    let mockEnv: any;

    beforeEach(() => {
        // Initialize an in-memory database for clean, isolated tests
        const db = new Database(':memory:');
        
        // Setup schema - must include columns used in complex ORDER BY clauses
        db.exec(`
            CREATE TABLE platforms (
                id INTEGER PRIMARY KEY, 
                display_name TEXT, 
                brand TEXT, 
                launch_date DATE, 
                parent_platform_id INTEGER
            );
            CREATE TABLE games (
                stable_id INTEGER PRIMARY KEY, 
                id TEXT, 
                title TEXT, 
                series TEXT, 
                release_date DATE, 
                platform_id INTEGER, 
                owned BOOLEAN,
                sort_index INTEGER
            );
            CREATE TABLE figures (
                id INTEGER PRIMARY KEY, 
                name TEXT, 
                series_id INTEGER, 
                release_date DATE,
                sort_index INTEGER
            );
            CREATE TABLE figure_series (
                id INTEGER PRIMARY KEY, 
                name TEXT, 
                line TEXT,
                sort_index INTEGER
            );
            
            INSERT INTO platforms (id, display_name, brand, launch_date) VALUES (1, 'NES', 'Nintendo', '1985-10-18');
            INSERT INTO games (stable_id, id, title, series, platform_id, owned, sort_index) VALUES (1, 'mario', 'Super Mario Bros', 'Mario', 1, 1, 0);
            INSERT INTO figure_series (id, name, line, sort_index) VALUES (1, 'Smash', 'Amiibo', 0);
            INSERT INTO figures (id, name, series_id, sort_index) VALUES (1, 'Link', 1, 0);
        `);

        // Mock the Cloudflare D1 interface
        mockDb = {
            prepare: (query: string) => ({
                bind: (...params: any[]) => ({
                    all: async () => ({ results: db.prepare(query).all(...params) }),
                    first: async () => db.prepare(query).get(...params),
                }),
                all: async () => ({ results: db.prepare(query).all() }),
                first: async () => db.prepare(query).get(),
            }),
        };

        mockEnv = {
            DB: mockDb,
            ASSETS: { fetch: vi.fn().mockResolvedValue(new Response('Asset Content')) }
        };
    });

    it('GET /api/games returns matched game list', async () => {
        const req = new Request('http://localhost/api/games');
        const res = await worker.fetch(req, mockEnv);
        
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data[0].title).toBe('Super Mario Bros');
    });

    it('GET /api/figures joins with series info', async () => {
        const req = new Request('http://localhost/api/figures');
        const res = await worker.fetch(req, mockEnv);
        
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data[0].name).toBe('Link');
        expect(data[0].series_name).toBe('Smash');
    });

    it('GET /api/platforms excludes empty ones (implicitly via join/exists)', async () => {
        const req = new Request('http://localhost/api/platforms');
        const res = await worker.fetch(req, mockEnv);
        
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data[0].brand).toBe('Nintendo');
    });

    it('Delegates non-API routes to static assets', async () => {
        const req = new Request('http://localhost/index.html');
        const res = await worker.fetch(req, mockEnv);
        
        expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
        const text = await res.text();
        expect(text).toBe('Asset Content');
    });

    it('Handles database errors gracefully', async () => {
        mockDb.prepare = () => { throw new Error('DB Down'); };
        const req = new Request('http://localhost/api/games');
        const res = await worker.fetch(req, mockEnv);
        
        expect(res.status).toBe(500);
        const data: any = await res.json();
        expect(data.error).toBe('DB Down');
    });
});
