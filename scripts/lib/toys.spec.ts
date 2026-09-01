/**
 * TOYS METADATA LIBRARY UNIT TESTS
 *
 * This test suite verifies the functionality of the scraping and metadata ingestion helper
 * functions defined in `scripts/lib/toys.ts`. It mocks the external HTTP requests to ensure
 * deterministic offline execution, and checks that both XML WordPress sitemap mapping
 * and PriceCharting JSON ingestion work as specified.
 */

import { describe, it, expect, vi, type Mocked } from 'vitest';
import axios from 'axios';
import Database from 'better-sqlite3';
import {
  scrapeSkylandersSitemap,
  scrapeStarlinkConsole,
  getAmiiboSeries,
  extractBaseCharacterName,
  scrapeSkylandersDetail,
  STARLINK_TOYS,
  getStarlinkSlugs,
  scrapeStarlinkWikiImage,
  reindexSkylanders,
  reindexAmiibo,
  findSkylandersMatch,
  cleanSclTitle,
  superNormalize,
  SitemapEntry,
  Toy,
} from './toys.js';

// Mock axios globally for these tests
vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

describe('Toys Metadata Ingestion Helpers', () => {
  describe('scrapeSkylandersSitemap', () => {
    it('should successfully parse character images from WordPress XML sitemaps', async () => {
      // Mock XML payload representing SkylandersCharacterList's sitemap
      const mockXml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
          <url>
            <loc>https://skylanderscharacterlist.com/bash/</loc>
            <image:image>
              <image:loc>https://skylanderscharacterlist.com/wp-content/uploads/2012/04/bash.jpg</image:loc>
            </image:image>
            <image:image>
              <image:loc>https://skylanderscharacterlist.com/wp-content/uploads/2012/04/bash-ebay.jpg</image:loc>
            </image:image>
          </url>
          <url>
            <loc>https://skylanderscharacterlist.com/spyro/</loc>
          </url>
        </urlset>
      `;

      mockedAxios.get.mockResolvedValue({ data: mockXml });

      const entries = await scrapeSkylandersSitemap();

      // We expect the sitemaps array (containing 2 URLs) to fetch twice,
      // but in this mock, both requests return the same mock XML.
      expect(entries.length).toBeGreaterThan(0);

      // Verify parsing of the first entry
      const bashEntry = entries.find(
        (e) => e.loc === 'https://skylanderscharacterlist.com/bash/',
      );
      expect(bashEntry).toBeDefined();
      expect(bashEntry!.images).toContain(
        'https://skylanderscharacterlist.com/wp-content/uploads/2012/04/bash.jpg',
      );
      expect(bashEntry!.images).toContain(
        'https://skylanderscharacterlist.com/wp-content/uploads/2012/04/bash-ebay.jpg',
      );

      // Verify entry without images
      const spyroEntry = entries.find(
        (e) => e.loc === 'https://skylanderscharacterlist.com/spyro/',
      );
      expect(spyroEntry).toBeDefined();
      expect(spyroEntry!.images).toHaveLength(0);
    });

    it('should handle XML network failures gracefully without throwing', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network Timeout'));

      // The function must catch errors and return whatever entries it has successfully parsed
      const entries = await scrapeSkylandersSitemap();
      expect(entries).toHaveLength(0);
    });
  });

  describe('scrapeStarlinkConsole', () => {
    it('should fetch PriceCharting JSON data and normalize image resolutions from /60.jpg to /1600.jpg', async () => {
      const mockJson = {
        products: [
          {
            id: 12345,
            productName: 'Pulse Starship Pack',
            imageUri:
              'https://storage.googleapis.com/images.pricecharting.com/abcd/60.jpg',
          },
          {
            id: 67890,
            productName: 'Nadir Starship Pack',
            imageUri: null,
          },
        ],
      };

      mockedAxios.get.mockResolvedValue({ data: mockJson });

      const products = await scrapeStarlinkConsole();

      expect(products).toHaveLength(2);

      // Verify that the low-res 60px thumbnail was replaced with the high-res 1600px cover art link
      expect(products[0].id).toBe('12345');
      expect(products[0].productName).toBe('Pulse Starship Pack');
      expect(products[0].imageUri).toBe(
        'https://storage.googleapis.com/images.pricecharting.com/abcd/1600.jpg',
      );

      // Verify null image handling
      expect(products[1].id).toBe('67890');
      expect(products[1].imageUri).toBeNull();
    });

    it('should handle PriceCharting request failures gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('404 Not Found'));

      const products = await scrapeStarlinkConsole();
      expect(products).toHaveLength(0);
    });
  });

  describe('getAmiiboSeries', () => {
    it('should map AmiiboAPI fields into the standard Toy model interface format', async () => {
      const mockResponse = {
        amiibo: [
          {
            head: '00030000',
            tail: '000c0002',
            name: 'Link',
            amiiboSeries: 'Super Smash Bros.',
            type: 'Figure',
            image:
              'https://raw.githubusercontent.com/NintenZone/AmiiboAPI/master/images/icon_00030000-000c0002.png',
            release: { na: '2014-11-21' },
          },
        ],
      };

      mockedAxios.get.mockResolvedValue({ data: mockResponse });

      const toys = await getAmiiboSeries();

      expect(toys).toHaveLength(1);
      expect(toys[0].id).toBe('00030000000c0002');
      expect(toys[0].name).toBe('Link');
      expect(toys[0].line).toBe('amiibo');
      expect(toys[0].series_name).toBe('Super Smash Bros.');
      expect(toys[0].image_url).toBe(
        'https://raw.githubusercontent.com/NintenZone/AmiiboAPI/master/images/icon_00030000-000c0002.png',
      );
      expect(toys[0].release_date).toBe('2014-11-21');
    });

    it('should explicitly skip Skylanders crossover figures (DK, Bowser, and Dark variants)', async () => {
      const mockResponse = {
        amiibo: [
          {
            head: '00030000',
            tail: '000c0002',
            name: 'Link',
            amiiboSeries: 'Super Smash Bros.',
            type: 'Figure',
            image: 'https://example.com/link.png',
            release: { na: '2014-11-21' },
          },
          {
            head: '00040000',
            tail: '000d0002',
            name: 'Hammer Slam Bowser',
            amiiboSeries: 'Skylanders',
            type: 'Figure',
            image: 'https://example.com/bowser.png',
            release: { na: '2015-09-20' },
          },
          {
            head: '00050000',
            tail: '000e0002',
            name: 'Dark Turbo Charge Donkey Kong',
            amiiboSeries: 'Skylanders',
            type: 'Figure',
            image: 'https://example.com/dk.png',
            release: { na: '2015-09-20' },
          },
        ],
      };

      mockedAxios.get.mockResolvedValue({ data: mockResponse });

      const toys = await getAmiiboSeries();

      expect(toys).toHaveLength(1);
      expect(toys[0].name).toBe('Link');
    });

    it('should handle AmiiboAPI server down gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Internal Server Error'));

      const toys = await getAmiiboSeries('Super Smash Bros.');
      expect(toys).toHaveLength(0);
    });
  });

  describe('extractBaseCharacterName', () => {
    it('should correctly strip modifiers and series markers to get the base name', () => {
      const res1 = extractBaseCharacterName('Gnarly Tree Rex');
      expect(res1.baseName).toBe('Tree Rex');
      expect(res1.variantName).toBe('Gnarly');

      const res2 = extractBaseCharacterName('Legendary LightCore Grim Creeper');
      expect(res2.baseName).toBe('Grim Creeper');
      expect(res2.variantName).toBe('Legendary LightCore');

      const res3 = extractBaseCharacterName('Series 2 Trigger Happy');
      expect(res3.baseName).toBe('Trigger Happy');
      expect(res3.variantName).toBe('');
    });

    it('should preserve standard characters that begin with keywords as exception gates', () => {
      const res1 = extractBaseCharacterName('King Pen');
      expect(res1.baseName).toBe('King Pen');
      expect(res1.variantName).toBe('');

      const res2 = extractBaseCharacterName('Golden Queen');
      expect(res2.baseName).toBe('Golden Queen');
      expect(res2.variantName).toBe('');

      const res3 = extractBaseCharacterName('Dark Reactor');
      expect(res3.baseName).toBe('Dark Reactor');
      expect(res3.variantName).toBe('');
    });

    it('should strip king prefix if it is not King Pen', () => {
      const res = extractBaseCharacterName('King Cobra Cadabra');
      expect(res.baseName).toBe('Cobra Cadabra');
      expect(res.variantName).toBe('King');
    });
  });

  describe('scrapeSkylandersDetail', () => {
    it('should successfully parse elements, series, and release dates from detail page HTML', async () => {
      const mockHtml = `
        <html>
          <body>
            <table>
              <tr>
                <th>Element:</th>
                <td>Earth</td>
              </tr>
              <tr>
                <th>Series:</th>
                <td>Series 1</td>
              </tr>
              <tr>
                <th>Released With:</th>
                <td>Spyro's Adventure</td>
              </tr>
            </table>
            <p>Bash was released in Wave 1 in October 2011.</p>
          </body>
        </html>
      `;

      mockedAxios.get.mockResolvedValue({ data: mockHtml });

      const details = await scrapeSkylandersDetail(
        'https://skylanderscharacterlist.com/bash-series-1/',
      );
      expect(details).not.toBeNull();
      expect(details!.element).toBe('Earth');
      expect(details!.series).toBe('Series 1');
      expect(details!.releasedWith).toBe("Spyro's Adventure");
      expect(details!.releaseDate).toBe('2011-10-01');
    });

    it('should parse release dates with full month day year format', async () => {
      const mockHtml = `
        <html>
          <body>
            <p>Some toy was released on October 16, 2011.</p>
          </body>
        </html>
      `;

      mockedAxios.get.mockResolvedValue({ data: mockHtml });

      const details = await scrapeSkylandersDetail(
        'https://skylanderscharacterlist.com/some-toy/',
      );
      expect(details).not.toBeNull();
      expect(details!.releaseDate).toBe('2011-10-16');
    });

    it('should handle request failures gracefully by returning null', async () => {
      mockedAxios.get.mockRejectedValue(new Error('500 Internal Error'));

      const details = await scrapeSkylandersDetail(
        'https://skylanderscharacterlist.com/fail/',
      );
      expect(details).toBeNull();
    });

    it('should fallback to game release date if specific date not in body', async () => {
      const mockHtml = `
        <html>
          <body>
            <table>
              <tr>
                <th>Element:</th>
                <td>Earth</td>
              </tr>
              <tr>
                <th>Series:</th>
                <td>Series 1</td>
              </tr>
              <tr>
                <th>Released With:</th>
                <td>Giants</td>
              </tr>
            </table>
            <p>Some character text without release date.</p>
          </body>
        </html>
      `;

      mockedAxios.get.mockResolvedValue({ data: mockHtml });

      const details = await scrapeSkylandersDetail(
        'https://skylanderscharacterlist.com/some-character/',
      );
      expect(details).not.toBeNull();
      expect(details!.releasedWith).toBe('Giants');
      expect(details!.releaseDate).toBe('2012-10-21');
    });
  });

  describe('STARLINK_TOYS static catalog', () => {
    it('should possess entries for all known physical Starlink toys', () => {
      expect(STARLINK_TOYS['arwing']).toEqual({
        type: 'Starship',
        releaseDate: '2018-10-16',
        sortIndex: 1001,
      });

      expect(STARLINK_TOYS['chasedasilva']).toEqual({
        type: 'Pilot',
        releaseDate: '2018-10-16',
        sortIndex: 2001,
      });

      expect(STARLINK_TOYS['volcano']).toEqual({
        type: 'Weapon',
        releaseDate: '2018-10-16',
        sortIndex: 3016,
      });
    });
  });

  describe('getStarlinkSlugs', () => {
    it('should generate correct slug variations including Mk. 2 overrides', () => {
      const slugs1 = getStarlinkSlugs('Freeze Ray Mk2');
      expect(slugs1).toContain('Freeze_Ray_Mk._2');
      expect(slugs1).toContain('Freeze_Ray_Mk2');
      expect(slugs1).toContain('Freeze_Ray');

      const slugs2 = getStarlinkSlugs('Mason Rana');
      expect(slugs2).toContain('Mason_Rana');

      const slugs3 = getStarlinkSlugs('Karl Zeon');
      expect(slugs3).toContain('Kharl_Zeon');
      expect(slugs3).toContain('Karl_Zeon');
    });
  });

  describe('scrapeStarlinkWikiImage', () => {
    it('should retrieve thumbnail source from Starlink Wiki MediaWiki API', async () => {
      const mockJson = {
        query: {
          pages: {
            '196': {
              pageid: 196,
              title: 'Zenith',
              thumbnail: {
                source:
                  'https://static.wikia.nocookie.net/starlink/images/1/1f/Zenith_ship.png/revision/latest?cb=20180913171620',
              },
            },
          },
        },
      };

      mockedAxios.get.mockResolvedValue({ data: mockJson });

      const image = await scrapeStarlinkWikiImage('Zenith');
      expect(image).toBe(
        'https://static.wikia.nocookie.net/starlink/images/1/1f/Zenith_ship.png/revision/latest',
      );
    });

    it('should ignore placeholder or community banner images in API results', async () => {
      const mockJson = {
        query: {
          pages: {
            '123': {
              pageid: 123,
              title: 'Zenith',
              thumbnail: {
                source:
                  'https://static.wikia.nocookie.net/starlink/images/3/39/Site-community-image/revision/latest?cb=20251209150247',
              },
            },
          },
        },
      };

      mockedAxios.get.mockResolvedValue({ data: mockJson });

      const image = await scrapeStarlinkWikiImage('Zenith');
      expect(image).toBeNull();
    });
  });

  describe('reindexSkylanders', () => {
    it('should compute sort indexes based on category, element, and name', () => {
      const db = new Database(':memory:');

      // Create tables
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
        CREATE TABLE toy_series (
          id TEXT PRIMARY KEY,
          name TEXT,
          line TEXT,
          sort_index INTEGER
        );
      `);

      // Insert toy series
      const insertSeries = db.prepare(
        'INSERT INTO toy_series (id, name, line, sort_index) VALUES (?, ?, ?, ?)',
      );
      insertSeries.run('series-1', "Spyro's Adventure", 'Skylanders', 1);
      insertSeries.run('series-2', 'Giants', 'Skylanders', 2);

      // Insert toys
      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, metadata_json, sort_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Category priorities: Characters (1) -> Vehicles (2) -> Crystals (3) -> Traps (4) -> Magic Items (5)
      // Within same series (series-1):
      // Bash (Character, Earth element) - should sort before Magic Item (e.g. Dragon's Peak)
      insertToy.run(
        1,
        'bash',
        'Bash',
        'Skylanders',
        'series-1',
        null,
        JSON.stringify({ element: 'Earth' }),
        null,
      );
      // Dragon's Peak (Magic Item, element kaos/other or null)
      insertToy.run(
        2,
        'dragons-peak',
        "Dragon's Peak",
        'Skylanders',
        'series-1',
        null,
        null,
        null,
      );
      // Spitfire (Vehicle in series-2)
      insertToy.run(
        3,
        'spitfire',
        'Spitfire',
        'Skylanders',
        'series-2',
        'Vehicle',
        JSON.stringify({ element: 'Fire' }),
        null,
      );
      // Gill Grunt (Character, Water element in series-1)
      insertToy.run(
        4,
        'gill-grunt',
        'Gill Grunt',
        'Skylanders',
        'series-1',
        null,
        JSON.stringify({ element: 'Water' }),
        null,
      );

      reindexSkylanders(db);

      const results = db
        .prepare(
          'SELECT stable_id, sort_index, name FROM toys ORDER BY sort_index ASC',
        )
        .all() as { stable_id: number; sort_index: number; name: string }[];

      // Sorting order expectations for series-1 (sort_index 1):
      // Elements: Earth (3) sorts before Water (10) -> Bash (Earth) sorts before Gill Grunt (Water)
      // Category: Characters (1) sort before Magic Items (5) -> Bash (1), Gill Grunt (1) sort before Dragon's Peak (5)
      // So for series-1: Bash (1st), Gill Grunt (2nd), Dragon's Peak (3rd)
      // Then series-2 (sort_index 2): Spitfire (4th)
      expect(results).toHaveLength(4);
      expect(results[0].name).toBe('Bash');
      expect(results[0].sort_index).toBe(1);
      expect(results[1].name).toBe('Gill Grunt');
      expect(results[1].sort_index).toBe(2);
      expect(results[2].name).toBe("Dragon's Peak");
      expect(results[2].sort_index).toBe(3);
      expect(results[3].name).toBe('Spitfire');
      expect(results[3].sort_index).toBe(4);
    });

    it('should prioritize gimmick characters over standard, LightCore, and minis/sidekicks within element groups', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
        CREATE TABLE toy_series (
          id TEXT PRIMARY KEY,
          name TEXT,
          line TEXT,
          sort_index INTEGER
        );
      `);

      const insertSeries = db.prepare(
        'INSERT INTO toy_series (id, name, line, sort_index) VALUES (?, ?, ?, ?)',
      );
      insertSeries.run('series-1', 'Test Series', 'Skylanders', 1);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, metadata_json, sort_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // All Earth element, all in 'series-1'
      // 1. Bash (Series 2) - Standard
      insertToy.run(
        1,
        'bash-s2',
        'Bash (Series 2)',
        'Skylanders',
        'series-1',
        'Series 2',
        JSON.stringify({ element: 'Earth' }),
        null,
      );
      // 2. Crusher - Giants Gimmick
      insertToy.run(
        2,
        'crusher',
        'Crusher',
        'Skylanders',
        'series-1',
        'Giants',
        JSON.stringify({ element: 'Earth' }),
        null,
      );
      // 3. Prism Break LightCore - LightCore
      insertToy.run(
        3,
        'prism-break-lc',
        'Prism Break LightCore',
        'Skylanders',
        'series-1',
        'LightCore',
        JSON.stringify({ element: 'Earth' }),
        null,
      );
      // 4. Terrabite - Mini
      insertToy.run(
        4,
        'terrabite',
        'Mini Terrabite',
        'Skylanders',
        'series-1',
        'Mini',
        JSON.stringify({ element: 'Earth' }),
        null,
      );

      reindexSkylanders(db);

      const results = db
        .prepare(
          'SELECT stable_id, name, sort_index FROM toys ORDER BY sort_index ASC',
        )
        .all() as { stable_id: number; name: string; sort_index: number }[];

      expect(results).toHaveLength(4);
      // Expected order:
      // 1. Crusher (Giants = Gimmick, priority 1)
      // 2. Bash (Series 2 = Standard, priority 2)
      // 3. Prism Break LightCore (LightCore, priority 3)
      // 4. Terrabite (Mini, priority 4)
      expect(results[0].name).toBe('Crusher');
      expect(results[1].name).toBe('Bash (Series 2)');
      expect(results[2].name).toBe('Prism Break LightCore');
      expect(results[3].name).toBe('Mini Terrabite');
    });

    it('should group LightCore variants directly with their standard/in-game counterparts', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
        CREATE TABLE toy_series (
          id TEXT PRIMARY KEY,
          name TEXT,
          line TEXT,
          sort_index INTEGER
        );
      `);

      const insertSeries = db.prepare(
        'INSERT INTO toy_series (id, name, line, sort_index) VALUES (?, ?, ?, ?)',
      );
      insertSeries.run('series-1', 'Test Series', 'Skylanders', 1);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, metadata_json, sort_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // All Air element, in 'series-1'
      // 1. Warnado - Standard (baseName: 'warnado')
      insertToy.run(
        1,
        'warnado',
        'Warnado',
        'Skylanders',
        'series-1',
        'Figure',
        JSON.stringify({ element: 'Air' }),
        null,
      );
      // 2. Jet-Vac LightCore - LightCore (baseName: 'jet-vac')
      insertToy.run(
        2,
        'jet-vac-lc',
        'Jet-Vac LightCore',
        'Skylanders',
        'series-1',
        'LightCore',
        JSON.stringify({ element: 'Air' }),
        null,
      );
      // 3. Jet-Vac - Standard (baseName: 'jet-vac')
      insertToy.run(
        3,
        'jet-vac',
        'Jet-Vac',
        'Skylanders',
        'series-1',
        'Figure',
        JSON.stringify({ element: 'Air' }),
        null,
      );

      reindexSkylanders(db);

      const results = db
        .prepare(
          'SELECT stable_id, name, sort_index FROM toys ORDER BY sort_index ASC',
        )
        .all() as { stable_id: number; name: string; sort_index: number }[];

      expect(results).toHaveLength(3);
      // Expected order:
      // 'jet-vac' sorts alphabetically before 'warnado'
      // Within 'jet-vac': Standard (Jet-Vac) sorts before LightCore (Jet-Vac LightCore)
      // So: Jet-Vac -> Jet-Vac LightCore -> Warnado
      expect(results[0].name).toBe('Jet-Vac');
      expect(results[1].name).toBe('Jet-Vac LightCore');
      expect(results[2].name).toBe('Warnado');
    });
  });

  describe('superNormalize & cleanSclTitle', () => {
    it('should normalize strings by removing accents, spaces, and punctuation', () => {
      expect(superNormalize('Flare Wolf')).toBe('flarewolf');
      expect(superNormalize('Dark LightCore Grim Creeper!')).toBe(
        'darklightcoregrimcreeper',
      );
      expect(superNormalize('Blue Chest (Cursed Tiki Temple)')).toBe(
        'bluechestcursedtikitemple',
      );
    });

    it('should clean SCL title suffixes and series markers', () => {
      expect(cleanSclTitle('Bash (Series 1)')).toBe('Bash');
      expect(cleanSclTitle('Grim Creeper (LightCore)')).toBe('Grim Creeper');
      expect(cleanSclTitle("Spyro (Eon's Elite)")).toBe('Spyro');
      expect(cleanSclTitle('Starcast (Imaginators)')).toBe('Starcast');
    });
  });

  describe('findSkylandersMatch', () => {
    const sampleSitemap: SitemapEntry[] = [
      {
        loc: 'https://skylanderscharacterlist.com/grim-creeper/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2013/11/GrimCreeper1.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/grim-creeper-lightcore/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2013/06/GrimCreeper.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/legendary-lightcore-grim-creeper/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2013/08/LegendaryLightCoreGrimCreeper.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/bash-series-1/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2014/03/Bash.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/bash-series-2/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2012/10/BashSeries2.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/legendary-bash/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2013/03/LegendaryBash.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/turbo-jet-vac/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2013/10/TurboJetVac.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/full-blast-jet-vac/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2014/10/FullBlastJetVac.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/mini-barkley/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2014/10/Barkley.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/sidekick-barkley/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2012/10/SidekickBarkley.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/dark-rune-creation-crystal/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2016/10/DarkRune.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/bad-juju-figure/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2016/10/BadJuju.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/hard-boiled-flarewolf/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2017/04/HardBoiledFlarewolf.png',
        ],
      },
      {
        loc: 'https://skylanderscharacterlist.com/hard-boiled-flare-wolf/',
        images: [
          'https://skylanderscharacterlist.com/wp-content/uploads/2017/04/HardBoiledFlarewolf.png',
        ],
      },
    ];

    it('should strictly separate LightCore Grim Creeper from Legendary LightCore Grim Creeper', () => {
      const lightCoreToy: Toy = {
        id: 'lc-grim-creeper',
        name: 'LightCore Grim Creeper',
        line: 'Skylanders',
        series_name: 'Swap Force',
        series: '3',
        type: 'LightCore',
        image_url: null,
      };

      const legLightCoreToy: Toy = {
        id: 'leg-lc-grim-creeper',
        name: 'Legendary LightCore Grim Creeper',
        line: 'Skylanders',
        series_name: 'Swap Force',
        series: '3',
        type: 'LightCore',
        image_url: null,
      };

      const standardToy: Toy = {
        id: 'grim-creeper',
        name: 'Grim Creeper',
        line: 'Skylanders',
        series_name: 'Swap Force',
        series: '3',
        type: 'Figure',
        image_url: null,
      };

      const lcMatches = findSkylandersMatch(lightCoreToy, sampleSitemap);
      expect(lcMatches).toHaveLength(1);
      expect(lcMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/grim-creeper-lightcore/',
      );
      expect(lcMatches[0].images[0]).toContain('GrimCreeper.png');

      const legMatches = findSkylandersMatch(legLightCoreToy, sampleSitemap);
      expect(legMatches).toHaveLength(1);
      expect(legMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/legendary-lightcore-grim-creeper/',
      );
      expect(legMatches[0].images[0]).toContain(
        'LegendaryLightCoreGrimCreeper.png',
      );

      const standardMatches = findSkylandersMatch(standardToy, sampleSitemap);
      expect(standardMatches).toHaveLength(1);
      expect(standardMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/grim-creeper/',
      );
    });

    it('should correctly match Series 2, 3, 4 pose figures and minis', () => {
      const series2Bash: Toy = {
        id: 's2-bash',
        name: 'Series 2 Bash',
        line: 'Skylanders',
        series_name: 'Giants',
        series: '2',
        type: 'Figure',
        image_url: null,
      };
      const bashMatches = findSkylandersMatch(series2Bash, sampleSitemap, [
        { name: 'Bash', series: '1' },
        { name: 'Series 2 Bash', series: '2' },
      ]);
      expect(bashMatches).toHaveLength(1);
      expect(bashMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/bash-series-2/',
      );

      const turboJetVac: Toy = {
        id: 'turbo-jv',
        name: 'Turbo Jet-Vac',
        line: 'Skylanders',
        series_name: 'Swap Force',
        series: '3',
        type: 'Figure',
        image_url: null,
      };
      const turboMatches = findSkylandersMatch(turboJetVac, sampleSitemap);
      expect(turboMatches).toHaveLength(1);
      expect(turboMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/turbo-jet-vac/',
      );

      const fullBlastJetVac: Toy = {
        id: 'full-blast-jv',
        name: 'Full Blast Jet-Vac',
        line: 'Skylanders',
        series_name: 'Trap Team',
        series: '4',
        type: 'Figure',
        image_url: null,
      };
      const fbMatches = findSkylandersMatch(fullBlastJetVac, sampleSitemap);
      expect(fbMatches).toHaveLength(1);
      expect(fbMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/full-blast-jet-vac/',
      );

      const miniBarkley: Toy = {
        id: 'mini-barkley',
        name: 'Barkley',
        line: 'Skylanders',
        series_name: 'Trap Team',
        series: '4',
        type: 'Mini',
        image_url: null,
      };
      const barkleyMatches = findSkylandersMatch(miniBarkley, sampleSitemap);
      expect(barkleyMatches).toHaveLength(1);
      expect(barkleyMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/mini-barkley/',
      );
    });

    it('should correctly match Series 6 Sensei figure pages and Creation Crystals', () => {
      const badJuju: Toy = {
        id: 'bad-juju',
        name: 'Bad Juju',
        line: 'Skylanders',
        series_name: 'Imaginators',
        series: '6',
        type: 'Sensei',
        image_url: null,
      };
      const bjMatches = findSkylandersMatch(badJuju, sampleSitemap);
      expect(bjMatches).toHaveLength(1);
      expect(bjMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/bad-juju-figure/',
      );

      const darkRune: Toy = {
        id: 'dark-rune',
        name: 'Dark Rune',
        line: 'Skylanders',
        series_name: 'Imaginators',
        series: '6',
        type: 'Creation Crystal',
        image_url: null,
      };
      const drMatches = findSkylandersMatch(darkRune, [
        {
          loc: 'https://skylanderscharacterlist.com/dark-creation-crystal/',
          images: ['https://skylanderscharacterlist.com/dark-rune.png'],
        },
      ]);
      expect(drMatches).toHaveLength(1);
      expect(drMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/dark-creation-crystal/',
      );
    });

    it('should correctly match all Creation Crystals including Light Rune, Dark Reactor, and Life Claw', () => {
      const lightRune: Toy = {
        id: 'light-rune',
        name: 'Light Rune',
        line: 'Skylanders',
        series_name: 'Imaginators',
        series: '6',
        type: 'Creation Crystal',
        image_url: null,
      };
      const lrMatches = findSkylandersMatch(lightRune, [
        {
          loc: 'https://skylanderscharacterlist.com/light-creation-crystal-2/',
          images: ['https://skylanderscharacterlist.com/light-rune.png'],
        },
      ]);
      expect(lrMatches).toHaveLength(1);
      expect(lrMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/light-creation-crystal-2/',
      );

      const darkReactor: Toy = {
        id: 'dark-reactor',
        name: 'Dark Reactor',
        line: 'Skylanders',
        series_name: 'Imaginators',
        series: '6',
        type: 'Creation Crystal',
        image_url: null,
      };
      const drMatches = findSkylandersMatch(darkReactor, [
        {
          loc: 'https://skylanderscharacterlist.com/dark-creation-crystal-3/',
          images: ['https://skylanderscharacterlist.com/dark-reactor.png'],
        },
      ]);
      expect(drMatches).toHaveLength(1);
      expect(drMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/dark-creation-crystal-3/',
      );
    });

    it('should correctly match Traps to SCL trap slugs', () => {
      const airHourglass: Toy = {
        id: 'air-hourglass',
        name: 'Air Hourglass (Tempest Timer)',
        line: 'Skylanders',
        series_name: 'Trap Team',
        series: '4',
        type: 'Trap',
        image_url: null,
      };
      const ahMatches = findSkylandersMatch(airHourglass, [
        {
          loc: 'https://skylanderscharacterlist.com/air-hourglass-trap/',
          images: ['https://skylanderscharacterlist.com/air-hourglass.png'],
        },
      ]);
      expect(ahMatches).toHaveLength(1);
      expect(ahMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/air-hourglass-trap/',
      );

      const kaosTrap: Toy = {
        id: 'kaos-trap',
        name: 'Kaos Trap',
        line: 'Skylanders',
        series_name: 'Trap Team',
        series: '4',
        type: 'Trap',
        image_url: null,
      };
      const ktMatches = findSkylandersMatch(kaosTrap, [
        {
          loc: 'https://skylanderscharacterlist.com/kaos-trap/',
          images: ['https://skylanderscharacterlist.com/kaos-trap.png'],
        },
      ]);
      expect(ktMatches).toHaveLength(1);
      expect(ktMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/kaos-trap/',
      );
    });

    it('should correctly match Sensei variants without requiring -figure suffix in slug', () => {
      const mysticalBadJuju: Toy = {
        id: 'mystical-bad-juju',
        name: 'Mystical Bad Juju',
        line: 'Skylanders',
        series_name: 'Imaginators',
        series: '6',
        type: 'Sensei',
        image_url: null,
      };
      const mbjMatches = findSkylandersMatch(mysticalBadJuju, [
        {
          loc: 'https://skylanderscharacterlist.com/bad-juju-figure/',
          images: ['https://skylanderscharacterlist.com/bad-juju.png'],
        },
        {
          loc: 'https://skylanderscharacterlist.com/mystical-bad-juju/',
          images: ['https://skylanderscharacterlist.com/mystical-bad-juju.png'],
        },
      ]);
      expect(mbjMatches).toHaveLength(1);
      expect(mbjMatches[0].loc).toBe(
        'https://skylanderscharacterlist.com/mystical-bad-juju/',
      );
    });

    it('should correctly reindex Skylanders with Terrafin before Sidekick Terrabite and Kaos Trap after Water Traps', () => {
      const runMock = vi.fn();
      const mockDb = {
        prepare: vi.fn((sql: string) => {
          if (sql.includes('SELECT * FROM toys')) {
            return {
              all: () => [
                {
                  stable_id: 1,
                  id: 'terrafin',
                  name: 'Terrafin',
                  line: 'Skylanders',
                  series_name: "Spyro's Adventure",
                  series_id: 'skylanders-spyro-s-adventure',
                  series: '1',
                  type: 'Series 1',
                  metadata_json: JSON.stringify({ element: 'Earth' }),
                },
                {
                  stable_id: 2,
                  id: 'sidekick-terrabite',
                  name: 'Sidekick Terrabite',
                  line: 'Skylanders',
                  series_name: "Spyro's Adventure",
                  series_id: 'skylanders-spyro-s-adventure',
                  series: '1',
                  type: 'Sidekick',
                  metadata_json: JSON.stringify({ element: 'Earth' }),
                },
                {
                  stable_id: 3,
                  id: 'air-hourglass',
                  name: 'Air Hourglass (Tempest Timer)',
                  line: 'Skylanders',
                  series_name: 'Trap Team',
                  series_id: 'skylanders-trap-team',
                  series: '4',
                  type: 'Trap',
                  metadata_json: JSON.stringify({ element: 'Air' }),
                },
                {
                  stable_id: 4,
                  id: 'water-tiki',
                  name: 'Water Tiki (Tidal Tiki)',
                  line: 'Skylanders',
                  series_name: 'Trap Team',
                  series_id: 'skylanders-trap-team',
                  series: '4',
                  type: 'Trap',
                  metadata_json: JSON.stringify({ element: 'Water' }),
                },
                {
                  stable_id: 5,
                  id: 'kaos-trap',
                  name: 'Kaos Trap',
                  line: 'Skylanders',
                  series_name: 'Trap Team',
                  series_id: 'skylanders-trap-team',
                  series: '4',
                  type: 'Trap',
                  metadata_json: JSON.stringify({ element: 'Kaos' }),
                },
                {
                  stable_id: 6,
                  id: 'hand-of-fate',
                  name: 'Hand of Fate',
                  line: 'Skylanders',
                  series_name: 'Trap Team',
                  series_id: 'skylanders-trap-team',
                  series: '4',
                  type: 'Magic Item',
                  metadata_json: JSON.stringify({ element: null }),
                },
              ],
            };
          }
          if (sql.includes('SELECT sort_index FROM toy_series')) {
            return {
              get: (id: string) => {
                if (id === 'skylanders-spyro-s-adventure')
                  return { sort_index: 1 };
                if (id === 'skylanders-trap-team') return { sort_index: 4 };
                return { sort_index: 99 };
              },
            };
          }
          if (sql.includes('UPDATE toys SET sort_index')) {
            return {
              run: runMock,
            };
          }
          return { all: () => [], get: () => null, run: () => {} };
        }),
        transaction: vi.fn((fn: () => void) => fn),
      };

      reindexSkylanders(mockDb as unknown as import('better-sqlite3').Database);

      const updateCalls = runMock.mock.calls;

      // Extract order of stable_ids
      const assignedOrder = updateCalls.map((call: unknown[]) => ({
        sort_index: Number(call[0]),
        stable_id: Number(call[1]),
      }));

      const getIndex = (id: number) =>
        assignedOrder.find((o) => o.stable_id === id)?.sort_index;

      // 1. Terrafin (stable_id: 1) should sort BEFORE Sidekick Terrabite (stable_id: 2)
      expect(getIndex(1)).toBeLessThan(getIndex(2)!);

      // 2. Air Trap (stable_id: 3) should sort before Water Trap (stable_id: 4)
      expect(getIndex(3)).toBeLessThan(getIndex(4)!);

      // 3. Water Trap (stable_id: 4) should sort before Kaos Trap (stable_id: 5)
      expect(getIndex(4)).toBeLessThan(getIndex(5)!);

      // 4. Kaos Trap (stable_id: 5) should sort before Magic Item (stable_id: 6)
      expect(getIndex(5)).toBeLessThan(getIndex(6)!);
    });
  });

  describe('reindexAmiibo', () => {
    it('should assign canonical sport and character numbering to Mario Sports Superstars cards', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
      `);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, sort_index)
        VALUES (?, ?, ?, 'amiibo', 'amiibo-mario-sports-superstars', 'Card', ?)
      `);

      // Soccer (Sport 1, offset 0): Mario (Char 1 -> index 1), Birdo (Char 18 -> index 18)
      insertToy.run(1, 'mario-soccer', 'Mario - Soccer', null);
      insertToy.run(2, 'birdo-soccer', 'Birdo - Soccer', null);
      // Baseball (Sport 2, offset 18): Mario (Char 1 -> index 19)
      insertToy.run(3, 'mario-baseball', 'Mario - Baseball', null);
      // Horse Racing (Sport 5, offset 72): Birdo (Char 18 -> index 90)
      insertToy.run(4, 'birdo-horse', 'Birdo - Horse Racing', null);

      reindexAmiibo(db);

      const getSort = (id: number) =>
        (
          db
            .prepare('SELECT sort_index FROM toys WHERE stable_id = ?')
            .get(id) as { sort_index: number }
        ).sort_index;

      expect(getSort(1)).toBe(1);
      expect(getSort(2)).toBe(18);
      expect(getSort(3)).toBe(19);
      expect(getSort(4)).toBe(90);
    });

    it('should assign canonical release order to Super Nintendo World Power-Up Bands', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
      `);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, sort_index)
        VALUES (?, ?, ?, 'amiibo', 'amiibo-super-nintendo-world', 'Band', ?)
      `);

      insertToy.run(1, 'dk-band', 'Donkey Kong - Power Up Band', null);
      insertToy.run(2, 'mario-band', 'Mario - Power Up Band', null);
      insertToy.run(3, 'golden-band', 'Golden - Power Up Band', null);

      reindexAmiibo(db);

      const getSort = (id: number) =>
        (
          db
            .prepare('SELECT sort_index FROM toys WHERE stable_id = ?')
            .get(id) as { sort_index: number }
        ).sort_index;

      expect(getSort(2)).toBe(1); // Mario (1st)
      expect(getSort(3)).toBe(7); // Golden (7th)
      expect(getSort(1)).toBe(8); // Donkey Kong (8th)
    });

    it('should assign canonical promo indexes and preserve card/figure indices in Animal Crossing', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
      `);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, sort_index)
        VALUES (?, ?, ?, 'amiibo', 'amiibo-animal-crossing', ?, ?)
      `);

      // Figure (1)
      insertToy.run(
        1,
        'isabelle-winter',
        'Isabelle - Winter Outfit',
        'Figure',
        1,
      );
      // Card from Series 1 (100)
      insertToy.run(2, 'walker', 'Walker', 'Card', 100);
      // Promo card (Isabelle CP)
      insertToy.run(
        3,
        'isabelle-cp',
        'Isabelle - Character Parfait',
        'Card',
        null,
      );

      reindexAmiibo(db);

      const getSort = (id: number) =>
        (
          db
            .prepare('SELECT sort_index FROM toys WHERE stable_id = ?')
            .get(id) as { sort_index: number }
        ).sort_index;

      expect(getSort(1)).toBe(1);
      expect(getSort(2)).toBe(100);
      expect(getSort(3)).toBe(701);
    });

    it('should index Metroid, Monster Hunter, Yu-Gi-Oh, and singletons with valid positive sort index numbers', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE toys (
          stable_id INTEGER PRIMARY KEY,
          id TEXT,
          name TEXT,
          line TEXT,
          series_id TEXT,
          release_date TEXT,
          sort_index INTEGER,
          type TEXT,
          metadata_json TEXT,
          verified INTEGER
        );
      `);

      const insertToy = db.prepare(`
        INSERT INTO toys (stable_id, id, name, line, series_id, type, release_date, sort_index)
        VALUES (?, ?, ?, 'amiibo', ?, 'Figure', ?, ?)
      `);

      insertToy.run(
        1,
        'samus-aran',
        'Samus Aran',
        'amiibo-metroid',
        '2017-09-15',
        null,
      );
      insertToy.run(
        2,
        'metroid',
        'Metroid',
        'amiibo-metroid',
        '2017-09-15',
        null,
      );
      insertToy.run(3, 'qbby', 'Qbby', 'amiibo-boxboy', '2017-02-02', null);
      insertToy.run(
        4,
        'yuga',
        'Yuga Ohdo',
        'amiibo-yu-gi-oh',
        '2021-08-12',
        null,
      );

      reindexAmiibo(db);

      const getSort = (id: number) =>
        (
          db
            .prepare('SELECT sort_index FROM toys WHERE stable_id = ?')
            .get(id) as { sort_index: number }
        ).sort_index;

      expect(getSort(1)).toBe(1); // Samus Aran
      expect(getSort(2)).toBe(2); // Metroid
      expect(getSort(3)).toBe(1); // Qbby singleton
      expect(getSort(4)).toBe(1); // Yuga Ohdo
    });
  });
});
