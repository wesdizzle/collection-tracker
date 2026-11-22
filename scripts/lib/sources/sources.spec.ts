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
import {
  loadCommunityCsvReleases,
  parseCommunityCsv,
} from './community_csv.js';

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
        51,
      );
      expect(mapSerialStationTitleIdToPlatformId('PPSA09999', ['PS5'], 1)).toBe(
        52,
      );

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
        fetchFn: mockFetch as typeof fetch,
      });
      expect(fetched.releasesCount).toBe(2);
      expect(fetched.tmdbCount).toBe(1);
      expect(requestedUrls).toHaveLength(2);

      const loaded = loadSerialStationReleases(tmpDir);
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
        platform_id: 51,
        raw_title: 'Resident Evil 7 biohazard',
      });

      const direct = parseSerialStationRecords([], []);
      expect(direct).toEqual([]);
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
  });

  describe('community_csv', () => {
    it('loads optional user CSV files from data/sources/community and returns [] when absent', () => {
      expect(loadCommunityCsvReleases(tmpDir)).toEqual([]);

      const commDir = path.join(tmpDir, 'community');
      fs.mkdirSync(commDir, { recursive: true });
      fs.writeFileSync(
        path.join(commDir, 'trueachievements_xbox.csv'),
        'Title,Platform,Region,Barcode,Publisher\nHalo Infinite,Xbox Series X|S,USA,889842725216,Xbox Game Studios\nFable II,Xbox 360,USA,882224645966,Microsoft\n',
        'utf8',
      );

      const direct = parseCommunityCsv(
        'Game,System,Region\nLost Odyssey,X360,NA\n',
      );
      expect(direct[0]).toMatchObject({
        platform_id: 48,
        raw_title: 'Lost Odyssey',
        region: 'USA',
        source: 'community_csv',
      });

      const loaded = loadCommunityCsvReleases(tmpDir);
      expect(loaded).toHaveLength(2);
      expect(loaded[0]).toMatchObject({
        platform_id: 50,
        raw_title: 'Halo Infinite',
        barcode: '889842725216',
        publisher: 'Xbox Game Studios',
        source: 'community_csv',
      });
      expect(loaded[1]?.platform_id).toBe(48);
    });
  });
});
