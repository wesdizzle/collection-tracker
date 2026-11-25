/**
 * Unit Tests for Offline Canonical Source Adapters
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CURATED_NEOGEO_X_RELEASES,
  fetchNeoGeoSources,
  loadNeoGeoReleases,
  parseMameNeoGeoXml,
} from './neogeo.js';
import {
  fetchNsCollectorsSources,
  loadNsCollectorsReleases,
} from './nscollectors_sync.js';
import { fetchPs5DbSource, loadPs5DbReleases, parsePs5DbCsv } from './ps5db.js';
import {
  fetchSerialStationSources,
  loadSerialStationReleases,
  mapSerialStationTitleIdToPlatformId,
  parseSerialStationRecords,
} from './serialstation.js';
import {
  fetchRetailBackCatalogSources,
  loadRetailBackCatalogReleases,
} from './retail_backcatalog.js';

describe('Offline Canonical Source Adapters', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-adapters-spec-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('neogeo (MAME AES & Neo Geo X)', () => {
    it('parses official AES releases, extracts NGH serials, and skips clones/bootlegs/MVS-only entries', async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<softwarelist name="neogeo" description="SNK Neo-Geo cartridges">
  <software name="nam1975">
    <description>NAM-1975 (NGM-001 ~ NGH-001)</description>
    <publisher>SNK</publisher>
    <info name="serial" value="NGM-001 (MVS), NGH-001 (AES)"/>
    <sharedfeat name="release" value="MVS,AES" />
  </software>
  <software name="nam1975a" cloneof="nam1975">
    <description>NAM-1975 (Alt)</description>
    <publisher>SNK</publisher>
    <sharedfeat name="release" value="AES" />
  </software>
  <software name="mvsonly">
    <description>Shock Troopers (NGM-2380)</description>
    <publisher>Saurus</publisher>
    <sharedfeat name="release" value="MVS" />
  </software>
  <software name="bootleg">
    <description>Metal Slug 2 (Bootleg)</description>
    <publisher>Bootleg</publisher>
    <sharedfeat name="release" value="AES" />
  </software>
</softwarelist>`;

      const mockFetch = async () => new Response(xml, { status: 200 });
      const fetchRes = await fetchNeoGeoSources(
        tmpDir,
        mockFetch as typeof fetch,
      );
      expect(fetchRes.aesCount).toBe(1);
      expect(fs.existsSync(fetchRes.savedPath)).toBe(true);

      const direct = parseMameNeoGeoXml(xml);
      expect(direct).toHaveLength(1);
      expect(direct[0]).toMatchObject({
        platform_id: 9,
        raw_title: 'NAM-1975',
        serial_code: 'NGH-001',
        publisher: 'SNK',
        source: 'mame',
        is_verified_physical: 1,
      });

      const allNeoGeo = loadNeoGeoReleases(tmpDir);
      expect(allNeoGeo).toHaveLength(1 + CURATED_NEOGEO_X_RELEASES.length);
      expect(
        allNeoGeo.some(
          (r) =>
            r.platform_id === 12 &&
            r.source === 'neogeo_x' &&
            r.raw_title.includes("Ninja Master's"),
        ),
      ).toBe(true);
    });
  });

  describe('nscollectors_sync (5-tab r/NSCollectors sheets)', () => {
    it('fetches and loads all 5 CSV tabs distinguishing master, upcoming, CIAB, and Game-Key Cards', async () => {
      const mockFetch = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('gid=2004832329')) {
          return new Response(
            'Title,Publisher,Region,Release Date\nMetroid Dread,Nintendo,NA,Oct 8 2021\n',
            { status: 200 },
          );
        }
        if (url.includes('gid=1406641930')) {
          return new Response(
            'Title,Publisher,Region\nOverwatch,Blizzard,NA\n',
            { status: 200 },
          );
        }
        if (url.includes('gid=764784245')) {
          return new Response(
            'Title,Publisher,Region,Format,Release Date\nBravely Default Flying Fairy HD,Square Enix,NA,Game-Key Card,Jun 5 2025\n',
            { status: 200 },
          );
        }
        return new Response(
          'Title,Publisher,Region,Release Date\nHollow Knight: Silksong,Team Cherry,NA,2026-06-01\n',
          { status: 200 },
        );
      };

      const res = await fetchNsCollectorsSources(
        tmpDir,
        mockFetch as typeof fetch,
      );
      expect(res.tabsFetched).toBe(5);
      expect(res.totalEntries).toBeGreaterThanOrEqual(4);

      const loaded = loadNsCollectorsReleases(tmpDir);
      const sw1Master = loaded.releases.find(
        (r) => r.platform_id === 26 && r.source === 'nscollectors',
      );
      const ciab = loaded.releases.find(
        (r) => r.source === 'nscollectors_ciab',
      );
      const sw2KeyCard = loaded.releases.find(
        (r) => r.platform_id === 27 && r.source === 'nscollectors',
      );
      expect(sw1Master?.is_verified_physical).toBe(1);
      expect(ciab?.is_verified_physical).toBe(0);
      expect(ciab?.variants).toBe('Code in a Box (Download Only)');
      expect(sw2KeyCard?.variants).toBe('Game-Key Card');
    });
  });

  describe('ps5db', () => {
    it('parses PS5DB CSV mapping ESRB/PEGI regions, Limited Print variants, and Physical Publisher', async () => {
      const csv = [
        'Title,Developer,Game Publisher,Physical Publisher,Limited,ESRB SKU,PEGI Rating,Release Date',
        '1000xRESIST,Sunset Visitor,Fellow Traveller,Aerosoft Move,-,PPSA-12345,PEGI 12,2024-11-04',
        'Rare Indie PS5,Dev,Pub,Limited Run Games,Yes,810105670001,-,2025-02-01',
      ].join('\n');

      const mockFetch = async () => new Response(csv, { status: 200 });
      const fetched = await fetchPs5DbSource(tmpDir, mockFetch as typeof fetch);
      expect(fetched.count).toBe(2);

      const direct = parsePs5DbCsv(csv);
      expect(direct[0]).toMatchObject({
        platform_id: 35,
        raw_title: '1000xRESIST',
        region: 'USA, Europe',
        publisher: 'Aerosoft Move',
        serial_code: 'PPSA-12345',
        source: 'ps5db',
        is_verified_physical: 1,
      });
      expect(direct[1]).toMatchObject({
        platform_id: 35,
        region: 'USA',
        variants: 'Limited Print',
        barcode: '810105670001',
        source: 'ps5db',
      });
      expect(loadPs5DbReleases(tmpDir)).toHaveLength(2);
    });
  });

  describe('serialstation', () => {
    it('maps PlayStation Title ID prefixes and paginates limit<=100 endpoints', async () => {
      expect(mapSerialStationTitleIdToPlatformId('PPSA01234')).toBe(35);
      expect(mapSerialStationTitleIdToPlatformId('CUSA00900')).toBe(34);
      expect(mapSerialStationTitleIdToPlatformId('PCSE00001')).toBe(33);
      expect(mapSerialStationTitleIdToPlatformId('BCUS98114')).toBe(32);
      expect(mapSerialStationTitleIdToPlatformId('ULUS10509')).toBe(31);
      expect(mapSerialStationTitleIdToPlatformId('CUSA05685', ['PS4'], 1)).toBe(
        34,
      );
      expect(mapSerialStationTitleIdToPlatformId('PPSA09999', ['PS5'], 1)).toBe(
        35,
      );

      // Default fetch skips /v1/tmdb/ (PS3-only) and limits to Vita/PS4/PS5 while filtering noise
      const defaultFetchUrls: string[] = [];
      const defaultMockFetch = async (input: string | URL | Request) => {
        const url = String(input);
        defaultFetchUrls.push(url);
        return new Response(
          JSON.stringify({
            count: 4,
            items: [
              {
                name: 'Bloodborne',
                regions: ['America'],
                title_id: 'CUSA00900',
                edition: 'Original',
                release_type: 'PHYSICAL',
                barcode: '711719501237',
              },
              {
                name: 'Bloodborne',
                regions: ['Europe'],
                title_id: 'CUSA00207',
                edition: 'PlayStation Hits',
                release_type: 'PHYSICAL',
              },
              {
                name: 'Demons Souls PS3',
                regions: ['America'],
                title_id: 'BLUS30443',
                edition: 'Original',
                release_type: 'PHYSICAL',
              },
              {
                name: 'Astro Bot',
                regions: ['Europe'],
                title_id: 'PPSA21564',
                edition: 'Launch Edition',
                release_type: 'PHYSICAL',
                barcode: null,
              },
            ],
          }),
          { status: 200 },
        );
      };

      const defaultFetched = await fetchSerialStationSources(tmpDir, {
        maxPages: 2,
        delayMs: 0,
        fetchFn: defaultMockFetch as typeof fetch,
      });
      expect(defaultFetchUrls).toHaveLength(1);
      expect(defaultFetchUrls[0]).toContain('/v1/releases/');
      expect(defaultFetched.tmdbCount).toBe(0);

      const defaultLoaded = loadSerialStationReleases(tmpDir);
      expect(defaultLoaded).toHaveLength(2);
      expect(defaultLoaded.some((r) => r.platform_id === 32)).toBe(false);
      expect(defaultLoaded.some((r) => r.variants === 'PlayStation Hits')).toBe(
        false,
      );

      // Explicit includeTmdb: true still supports legacy TMDB opt-in when requested
      const requestedUrls: string[] = [];
      const mockFetch = async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        expect(url).toContain('limit=100');
        if (url.includes('/v1/releases/')) {
          return new Response(
            JSON.stringify({
              count: 2,
              items: [
                {
                  name: 'Bloodborne',
                  regions: ['America'],
                  title_id: 'CUSA00900',
                  edition: 'Original',
                  release_type: 'PHYSICAL',
                  barcode: '711719501237',
                },
                {
                  name: 'Astro Bot',
                  regions: ['Europe'],
                  title_id: 'PPSA21564',
                  edition: 'Launch Edition',
                  release_type: 'PHYSICAL',
                  barcode: null,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            count: 1,
            items: [
              {
                title_id: 'CUSA05685',
                console: ['PS4'],
                name: 'Resident Evil 7 VR Disc',
                media_type: 'disc',
                ps_vr: 1,
                names: [{ language: '1', name: 'Resident Evil 7 biohazard' }],
              },
            ],
          }),
          { status: 200 },
        );
      };

      const fetched = await fetchSerialStationSources(tmpDir, {
        maxPages: 2,
        delayMs: 0,
        includeTmdb: true,
        fetchFn: mockFetch as typeof fetch,
      });
      expect(fetched.releasesCount).toBe(2);
      expect(fetched.tmdbCount).toBe(1);
      expect(requestedUrls).toHaveLength(2);

      const loaded = loadSerialStationReleases(tmpDir, { includeTmdb: true });
      expect(loaded).toHaveLength(3);
      expect(loaded.find((r) => r.serial_code === 'CUSA00900')).toMatchObject({
        platform_id: 34,
        region: 'USA',
        variants: null,
        barcode: '711719501237',
        source: 'serialstation',
      });
      expect(loaded.find((r) => r.serial_code === 'PPSA21564')).toMatchObject({
        platform_id: 35,
        region: 'Europe',
        variants: 'Launch Edition',
      });
      expect(loaded.find((r) => r.serial_code === 'CUSA05685')).toMatchObject({
        platform_id: 34,
        raw_title: 'Resident Evil 7 biohazard',
      });

      const direct = parseSerialStationRecords([], []);
      expect(direct).toEqual([]);
    });

    it('retries with cooldown on transient errors, skips persistently failing pages, and resumes from partial checkpoints', async () => {
      const makeItem = (idx: number) => ({
        name: `PS5 Title ${idx}`,
        regions: ['America'],
        title_id: `PPSA${String(10000 + idx).padStart(5, '0')}`,
        edition: 'Original',
        release_type: 'PHYSICAL',
      });

      // (a) Retry-with-cooldown succeeds after transient 504 on page 0;
      // (b) Page 1 fails all retries (skipped cleanly); page 2 succeeds with short tail.
      let page0Calls = 0;
      let page1Calls = 0;
      const seenOffsets: number[] = [];
      const mockFetch = async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const offset = Number(url.searchParams.get('offset'));
        seenOffsets.push(offset);

        if (offset === 0) {
          page0Calls++;
          if (page0Calls === 1) {
            return new Response('Gateway Timeout', { status: 504 });
          }
          return new Response(
            JSON.stringify({
              count: 250,
              items: Array.from({ length: 100 }, (_, i) => makeItem(i)),
            }),
            { status: 200 },
          );
        }
        if (offset === 100) {
          page1Calls++;
          return new Response('Gateway Timeout', { status: 504 });
        }
        if (offset === 200) {
          return new Response(
            JSON.stringify({
              count: 250,
              items: Array.from({ length: 50 }, (_, i) => makeItem(200 + i)),
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ count: 250, items: [] }), {
          status: 200,
        });
      };

      const res = await fetchSerialStationSources(tmpDir, {
        maxPages: 5,
        delayMs: 0,
        cooldownBaseMs: 0,
        maxRetries: 2,
        fetchFn: mockFetch as typeof fetch,
      });

      expect(page0Calls).toBe(2);
      expect(page1Calls).toBe(3); // 1 initial attempt + 2 retries before skipping
      expect(res.skippedPages).toBe(1);
      expect(res.releasesCount).toBe(150);
      expect(res.parsedCount).toBe(150);
      expect(seenOffsets).toContain(200);

      // (c) Resuming from an existing partial checkpoint skips pages < nextPage and removes checkpoint on completion
      const partialPath = path.join(
        tmpDir,
        'serialstation_releases.partial.json',
      );
      fs.writeFileSync(
        partialPath,
        JSON.stringify({
          nextPage: 2,
          totalCount: 250,
          items: [makeItem(0), makeItem(1)],
        }),
        'utf8',
      );

      const resumeOffsets: number[] = [];
      const resumeFetch = async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const offset = Number(url.searchParams.get('offset'));
        resumeOffsets.push(offset);
        if (offset === 200) {
          return new Response(
            JSON.stringify({
              count: 250,
              items: [makeItem(200)],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ count: 250, items: [] }), {
          status: 200,
        });
      };

      const resumed = await fetchSerialStationSources(tmpDir, {
        maxPages: 5,
        delayMs: 0,
        cooldownBaseMs: 0,
        fetchFn: resumeFetch as typeof fetch,
      });

      expect(resumeOffsets).toEqual([200]);
      expect(resumed.releasesCount).toBe(3);
      expect(resumed.parsedCount).toBe(3);
      expect(fs.existsSync(partialPath)).toBe(false);
    });
  });

  describe('retail_backcatalog & lgn', () => {
    it('fetches and parses boutique, LGN, and VGP/PNP retail releases into canonical records', async () => {
      const mockFetch = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
          return new Response(
            JSON.stringify([
              { id: 10, name: 'Nintendo Switch', slug: 'switch' },
            ]),
            { status: 200 },
          );
        }
        if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
          return new Response(
            JSON.stringify([
              {
                id: 500,
                link: 'https://limitedgamenews.com/2026/11/game',
                title: {
                  rendered: 'Atelier Yumia Switch Asian English Announced',
                },
                excerpt: { rendered: '<p>Physical Switch</p>' },
                categories: [10],
              },
            ]),
            { status: 200 },
          );
        }
        if (url.includes('videogamesplus.ca/')) {
          return new Response(
            JSON.stringify({
              products: [
                {
                  id: 777,
                  title:
                    'Trails in the Sky 1st Chapter - Nintendo Switch (Pre-Order)',
                  handle: 'trails-sky-1st-switch',
                  product_type: 'Nintendo Switch',
                  variants: [
                    {
                      price: '79.99',
                      sku: 'VGP-777',
                      barcode: '0123456789012',
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ products: [] }), { status: 200 });
      };

      const res = await fetchRetailBackCatalogSources(tmpDir, {
        maxPages: 1,
        fetchFn: mockFetch as typeof fetch,
      });
      expect(res.totalParsed).toBeGreaterThanOrEqual(2);

      const releases = loadRetailBackCatalogReleases(tmpDir);
      expect(
        releases.some(
          (r) =>
            r.source === 'lgn' && r.platform_id === 26 && r.region === 'Asia',
        ),
      ).toBe(true);
      expect(
        releases.some(
          (r) =>
            r.source === 'retail_catalog' &&
            r.platform_id === 26 &&
            r.barcode === '0123456789012',
        ),
      ).toBe(true);
    });

    it('fetches VGP all-xbox-one and all-xbox-series-x collections and enforces Xbox One forward-compat', async () => {
      const mockFetch = async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/collections/all-xbox-one/products.json')) {
          return new Response(
            JSON.stringify({
              products: [
                {
                  id: 881,
                  title: 'Control Ultimate Edition',
                  handle: 'control-xbox',
                  product_type: 'Xbox Series X / Xbox One',
                  variants: [{ price: '39.99', sku: 'VGP-881' }],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('/collections/all-xbox-series-x/products.json')) {
          return new Response(
            JSON.stringify({
              products: [
                {
                  id: 882,
                  title: 'Dead Space - Xbox Series X',
                  handle: 'dead-space-xsx',
                  variants: [{ price: '49.99', sku: 'VGP-882' }],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('limitedgamenews.com/wp-json/wp/v2/categories')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('limitedgamenews.com/wp-json/wp/v2/posts')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(JSON.stringify({ products: [] }), { status: 200 });
      };

      await fetchRetailBackCatalogSources(tmpDir, {
        maxPages: 1,
        fetchFn: mockFetch as typeof fetch,
      });
      const releases = loadRetailBackCatalogReleases(tmpDir);
      expect(
        releases.find((r) => r.raw_title === 'Control Ultimate Edition')
          ?.platform_id,
      ).toBe(49);
      expect(
        releases.find((r) => r.raw_title === 'Dead Space')?.platform_id,
      ).toBe(50);
    });
  });
});
