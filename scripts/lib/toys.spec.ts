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
import {
  scrapeSkylandersSitemap,
  scrapeStarlinkConsole,
  getAmiiboSeries,
  extractBaseCharacterName,
  scrapeSkylandersDetail,
  STARLINK_TOYS,
  getStarlinkSlugs,
  scrapeStarlinkWikiImage,
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
});
