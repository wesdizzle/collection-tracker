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
});
