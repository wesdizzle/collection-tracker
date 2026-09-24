import { describe, it, expect, vi } from 'vitest';
import {
  cleanBestBuyTitle,
  normalizeTitle,
  matchBestBuyProduct,
  fetchBestBuyDeals,
  BestBuyProduct,
  CandidateGame,
} from './bestbuy.js';

describe('Best Buy Deals Client', () => {
  describe('cleanBestBuyTitle', () => {
    it('should strip trailing platform suffixes from titles', () => {
      expect(
        cleanBestBuyTitle("Marvel's Spider-Man: Miles Morales - PlayStation 4"),
      ).toBe("Marvel's Spider-Man: Miles Morales");

      expect(cleanBestBuyTitle('Super Mario Odyssey - Nintendo Switch')).toBe(
        'Super Mario Odyssey',
      );

      expect(cleanBestBuyTitle('Halo Infinite - Xbox Series X')).toBe(
        'Halo Infinite',
      );

      expect(cleanBestBuyTitle('God of War - PS4')).toBe('God of War');

      expect(cleanBestBuyTitle("Demon's Souls [PlayStation 5]")).toBe(
        "Demon's Souls",
      );

      expect(
        cleanBestBuyTitle('Final Fantasy VII Rebirth Standard Edition'),
      ).toBe('Final Fantasy VII Rebirth');
    });

    it('should handle empty or undefined titles gracefully', () => {
      expect(cleanBestBuyTitle('')).toBe('');
    });
  });

  describe('normalizeTitle', () => {
    it('should normalize accents, ampersands, and punctuation', () => {
      expect(normalizeTitle("Pokémon: Let's Go, Pikachu!")).toBe(
        'pokemonletsgopikachu',
      );
      expect(normalizeTitle('Ratchet & Clank: Rift Apart')).toBe(
        'ratchetandclankriftapart',
      );
    });
  });

  describe('matchBestBuyProduct', () => {
    const candidates: CandidateGame[] = [
      {
        stable_id: 101,
        title: 'God of War',
        platform_id: 34, // PS4
        barcode: '071171950550',
      },
      {
        stable_id: 102,
        title: 'Super Mario Odyssey',
        platform_id: 26, // Switch
        barcode: '045496590420',
      },
      {
        stable_id: 103,
        title: 'Halo Infinite',
        platform_id: 50, // Xbox Series X
      },
    ];

    it('should match game by exact UPC barcode when present', () => {
      const product: BestBuyProduct = {
        sku: 5358600,
        name: 'God of War PS4 Edition',
        upc: '071171950550',
        regularPrice: 19.99,
        salePrice: 9.99,
        onSale: true,
        url: 'https://bestbuy.com/gow',
      };

      const matchedId = matchBestBuyProduct(product, candidates);
      expect(matchedId).toBe(101);
    });

    it('should match game by title and platform when UPC is not present', () => {
      const product: BestBuyProduct = {
        sku: 999999,
        name: 'Halo Infinite - Xbox Series X',
        platform: 'Xbox Series X',
        regularPrice: 59.99,
        salePrice: 19.99,
        onSale: true,
        url: 'https://bestbuy.com/halo',
      };

      const matchedId = matchBestBuyProduct(product, candidates);
      expect(matchedId).toBe(103);
    });

    it('should not match game if platform does not match', () => {
      const product: BestBuyProduct = {
        sku: 888888,
        name: 'God of War - PlayStation 5',
        platform: 'PlayStation 5', // PS5 (35), but candidate is PS4 (34)
        regularPrice: 19.99,
        salePrice: 9.99,
        onSale: true,
        url: 'https://bestbuy.com/gow-ps5',
      };

      const matchedId = matchBestBuyProduct(product, candidates);
      expect(matchedId).toBeNull();
    });
  });

  describe('fetchBestBuyDeals', () => {
    it('should fetch pages of deals and aggregate products', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        const urlObj = new URL(url);
        const page = urlObj.searchParams.get('page') || '1';

        if (page === '1') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                from: 1,
                to: 2,
                total: 3,
                currentPage: 1,
                totalPages: 2,
                products: [
                  {
                    sku: 1,
                    name: 'Game 1 - PS4',
                    regularPrice: 29.99,
                    salePrice: 9.99,
                    onSale: true,
                    percentSavings: '67',
                    url: 'https://bb.com/1',
                  },
                  {
                    sku: 2,
                    name: 'Game 2 - Switch',
                    regularPrice: 59.99,
                    salePrice: 29.99,
                    onSale: true,
                    percentSavings: '50',
                    url: 'https://bb.com/2',
                  },
                ],
              }),
          });
        }

        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              from: 3,
              to: 3,
              total: 3,
              currentPage: 2,
              totalPages: 2,
              products: [
                {
                  sku: 3,
                  name: 'Game 3 - Xbox One',
                  regularPrice: 19.99,
                  salePrice: 4.99,
                  onSale: true,
                  percentSavings: '75',
                  url: 'https://bb.com/3',
                },
              ],
            }),
        });
      });

      const deals = await fetchBestBuyDeals(
        'test_key',
        mockFetch as unknown as typeof fetch,
        2,
      );
      expect(deals.length).toBe(3);
      expect(deals[0].sku).toBe(1);
      expect(deals[2].sku).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error when api key is missing', async () => {
      await expect(fetchBestBuyDeals('')).rejects.toThrow(
        'Best Buy API key is required',
      );
    });
  });
});
