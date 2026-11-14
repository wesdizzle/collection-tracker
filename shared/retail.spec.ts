import { describe, it, expect, vi } from 'vitest';
import {
  cleanBestBuyTitle,
  decodeHtmlEntities,
  resolveRetailPlatformId,
  normalizeTitle,
  matchBestBuyProduct,
  matchRetailGameProduct,
  matchRetailToyProduct,
  parseRetailToyTitle,
  fetchBestBuyDeals,
  fetchCadToUsdRate,
  fetchVgpDeals,
  fetchVgpAmiiboStock,
  fetchPnpDeals,
  fetchPnpAmiiboStock,
  fetchAllRetailDeals,
  BestBuyProduct,
  CandidateGame,
  CandidateToy,
} from './retail.js';

describe('Retail Deals & Stock Client (VGP, PNP Games, Best Buy)', () => {
  describe('decodeHtmlEntities', () => {
    it('should decode named and numeric HTML entities from WooCommerce titles', () => {
      expect(
        decodeHtmlEntities('Mario &#038; Luigi: Brothership &#8211; Switch'),
      ).toBe('Mario & Luigi: Brothership - Switch');
      expect(decodeHtmlEntities('Demon&#8217;s Souls &amp; More')).toBe(
        "Demon's Souls & More",
      );
    });
  });

  describe('cleanBestBuyTitle', () => {
    it('should strip trailing platform suffixes and VGP/PNP tags from titles', () => {
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

      expect(
        cleanBestBuyTitle('Silent Hill 2 (PS5) [PEGI Import] - PlayStation 5'),
      ).toBe('Silent Hill 2');

      expect(
        cleanBestBuyTitle(
          'Mario &#038; Luigi: Brothership [US/ESRB] (Nintendo Switch)',
        ),
      ).toBe('Mario & Luigi: Brothership');
    });

    it('should handle empty or undefined titles gracefully', () => {
      expect(cleanBestBuyTitle('')).toBe('');
    });
  });

  describe('resolveRetailPlatformId', () => {
    it('should resolve platform ID from explicit platform string or title suffix', () => {
      expect(resolveRetailPlatformId('PlayStation 5', 'Astro Bot')).toBe(35);

      expect(
        resolveRetailPlatformId(undefined, 'Metroid Prime Remastered [Switch]'),
      ).toBe(26);
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

  describe('matchRetailGameProduct / matchBestBuyProduct', () => {
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
      {
        stable_id: 104,
        title: 'Metroid',
        platform_id: 1, // NES
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

      const matchedId = matchRetailGameProduct(product, candidates);
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

    it('should not falsely match a standalone amiibo figure to a game with the same title', () => {
      const product: BestBuyProduct = {
        sku: 777777,
        name: 'Metroid - amiibo',
        regularPrice: 21.99,
        salePrice: 14.99,
        onSale: true,
        url: 'https://pnpgamesonline.com/product/metroid-amiibo/',
      };

      expect(matchRetailGameProduct(product, candidates)).toBeNull();
    });
  });

  describe('parseRetailToyTitle & matchRetailToyProduct', () => {
    const toyCandidates: CandidateToy[] = [
      {
        id: 'samus-amiibo-super-smash-bros',
        name: 'Samus',
        line: 'amiibo',
        series: 'Super Smash Bros.',
        type: 'Figure',
      },
      {
        id: 'samus-amiibo-metroid',
        name: 'Samus',
        line: 'amiibo',
        series: 'Metroid',
        type: 'Figure',
      },
      {
        id: 'metroid-amiibo-metroid',
        name: 'Metroid',
        line: 'amiibo',
        series: 'Metroid',
        type: 'Figure',
      },
      {
        id: 'isabelle-winter-outfit-amiibo-animal-crossing',
        name: 'Isabelle - Winter Outfit',
        line: 'amiibo',
        series: 'Animal Crossing',
        type: 'Figure',
      },
      {
        id: 'solaire-of-astora-amiibo-dark-souls',
        name: 'Solaire of Astora',
        line: 'amiibo',
        series: 'Dark Souls',
        type: 'Figure',
      },
      {
        id: 'donkey-kong-pauline-amiibo-donkey-kong',
        name: 'Donkey Kong & Pauline',
        line: 'amiibo',
        series: 'Donkey Kong',
        type: 'Figure',
      },
      {
        id: 'isabelle-001-amiibo-card',
        name: '001 Isabelle',
        line: 'amiibo',
        series: 'Animal Crossing',
        type: 'Card',
      },
    ];

    it('should parse retailer amiibo titles and extract series hints', () => {
      const parsed1 = parseRetailToyTitle(
        'Metroid &#8211; Metroid Series &#8211; amiibo (JPIM)',
      );
      expect(parsed1.cleanName).toBe('Metroid');
      expect(parsed1.seriesHint).toBe('Metroid');
      expect(parsed1.isCard).toBe(false);

      const parsed2 = parseRetailToyTitle(
        'Nintendo Amiibo - Samus [Super Smash Bros. Series] (Reprint)',
      );
      expect(parsed2.cleanName).toBe('Samus');
      expect(parsed2.seriesHint).toBe('Super Smash Bros.');
    });

    it('should disambiguate same-named amiibo figures by series hint', () => {
      expect(
        matchRetailToyProduct(
          {
            store: 'PNP Games',
            sku: '1',
            name: 'Samus - Metroid Series - amiibo (JPIM)',
            regularPrice: 21.99,
            salePrice: 18.99,
            onSale: true,
            percentSavings: 14,
            url: 'https://pnpgamesonline.com/samus-metroid',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBe('samus-amiibo-metroid');

      expect(
        matchRetailToyProduct(
          {
            store: 'VGP',
            sku: '2',
            name: 'Nintendo Amiibo - Samus [Super Smash Bros. Series]',
            regularPrice: 21.99,
            salePrice: 21.99,
            onSale: false,
            percentSavings: 0,
            url: 'https://videogamesplus.ca/products/samus-ssb',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBe('samus-amiibo-super-smash-bros');
    });

    it('should match multi-character and outfit-qualified amiibo figures', () => {
      expect(
        matchRetailToyProduct(
          {
            store: 'PNP Games',
            sku: '3',
            name: 'Isabelle (Winter Outfit) - Animal Crossing Series - amiibo',
            regularPrice: 14.99,
            salePrice: 9.99,
            onSale: true,
            percentSavings: 33,
            url: 'https://pnpgamesonline.com/isabelle',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBe('isabelle-winter-outfit-amiibo-animal-crossing');

      expect(
        matchRetailToyProduct(
          {
            store: 'VGP',
            sku: '4',
            name: 'Nintendo Amiibo - Donkey Kong & Pauline 2-Pack - Donkey Kong',
            regularPrice: 36.99,
            salePrice: 36.99,
            onSale: false,
            percentSavings: 0,
            url: 'https://videogamesplus.ca/products/dk-pauline',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBe('donkey-kong-pauline-amiibo-donkey-kong');
    });

    it('should reject carrying cases, protectors, and used items', () => {
      expect(
        matchRetailToyProduct(
          {
            store: 'PNP Games',
            sku: '5',
            name: 'Metroid - Clear Box Protector for Amiibo',
            regularPrice: 4.99,
            salePrice: 3.99,
            onSale: true,
            percentSavings: 20,
            url: 'https://pnpgamesonline.com/protector',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBeNull();

      expect(
        matchRetailToyProduct(
          {
            store: 'PNP Games',
            sku: '6',
            name: 'Solaire of Astora - amiibo (Used)',
            regularPrice: 39.99,
            salePrice: 39.99,
            onSale: false,
            percentSavings: 0,
            url: 'https://pnpgamesonline.com/solaire-used',
            onlineAvailability: true,
            categoryHint: 'toy',
          },
          toyCandidates,
        ),
      ).toBeNull();
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

  describe('fetchCadToUsdRate', () => {
    it('should return parsed USD exchange rate or fallback to 0.73 on error', async () => {
      const okFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rates: { USD: 0.71 } }),
      });
      expect(await fetchCadToUsdRate(okFetch as unknown as typeof fetch)).toBe(
        0.71,
      );

      const failFetch = vi.fn().mockRejectedValue(new Error('network error'));
      expect(
        await fetchCadToUsdRate(failFetch as unknown as typeof fetch),
      ).toBe(0.73);
    });
  });

  describe('fetchVgpDeals & fetchVgpAmiiboStock', () => {
    it('should parse Shopify JSON sales products and convert CAD to USD', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            products: [
              {
                id: 777,
                title: 'Unicorn Overlord - PlayStation 5',
                handle: 'unicorn-overlord-ps5',
                product_type: 'PlayStation 5',
                variants: [
                  {
                    id: 7771,
                    price: '39.99',
                    compare_at_price: '79.99',
                    available: true,
                    barcode: '0730865220496',
                  },
                ],
              },
              {
                id: 778,
                title: 'Sold Out Game - Switch',
                handle: 'sold-out-switch',
                product_type: 'Nintendo Switch',
                variants: [
                  {
                    id: 7781,
                    price: '19.99',
                    compare_at_price: '49.99',
                    available: false,
                  },
                ],
              },
            ],
          }),
      });

      const deals = await fetchVgpDeals(
        mockFetch as unknown as typeof fetch,
        1,
        0.75,
      );
      expect(deals.length).toBe(1);
      expect(deals[0].store).toBe('VGP');
      expect(deals[0].salePrice).toBe(29.99);
      expect(deals[0].regularPrice).toBe(59.99);
      expect(deals[0].upc).toBe('0730865220496');
      expect(deals[0].url).toBe(
        'https://videogamesplus.ca/products/unicorn-overlord-ps5',
      );
    });

    it('should fetch VGP amiibo collection and predictive search results', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('amiibo-collection')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                products: [
                  {
                    id: 901,
                    title: 'Nintendo Amiibo - Samus [Metroid Series]',
                    handle: 'samus-metroid-amiibo',
                    variants: [
                      {
                        id: 9011,
                        price: '29.99',
                        compare_at_price: null,
                        available: true,
                      },
                    ],
                  },
                ],
              }),
          });
        }
        if (url.includes('search/suggest.json')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                resources: {
                  results: {
                    products: [
                      {
                        id: 902,
                        title: 'Nintendo Amiibo - Kirby [Kirby Series]',
                        url: '/products/kirby-amiibo?_pos=1',
                        available: true,
                        price: '19.99',
                        compare_at_price_max: '29.99',
                      },
                    ],
                  },
                },
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const items = await fetchVgpAmiiboStock(
        mockFetch as unknown as typeof fetch,
        0.75,
      );
      expect(items.length).toBe(2);
      expect(items[0].categoryHint).toBe('toy');
      expect(items[0].onSale).toBe(false);
      expect(items[0].salePrice).toBe(22.49);
      expect(items[1].onSale).toBe(true);
      expect(items[1].salePrice).toBe(14.99);
      expect(items[1].regularPrice).toBe(22.49);
      expect(items[1].url).toBe(
        'https://videogamesplus.ca/products/kirby-amiibo',
      );
    });
  });

  describe('fetchPnpDeals & fetchPnpAmiiboStock', () => {
    it('should parse WooCommerce Store API v1 deals and convert CAD to USD', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 888,
              name: 'Dragon Quest III HD-2D Remake &#8211; Switch',
              permalink: 'https://pnpgamesonline.com/product/dq3-switch/',
              sku: 'PNP-888',
              on_sale: true,
              is_in_stock: true,
              prices: {
                price: '5499',
                regular_price: '7999',
                sale_price: '5499',
                currency_minor_unit: 2,
              },
              attributes: [
                {
                  taxonomy: 'pa_platform',
                  terms: [{ name: 'Nintendo Switch' }],
                },
              ],
            },
          ]),
      });

      const deals = await fetchPnpDeals(
        mockFetch as unknown as typeof fetch,
        1,
        0.75,
      );
      expect(deals.length).toBe(1);
      expect(deals[0].store).toBe('PNP Games');
      expect(deals[0].name).toBe('Dragon Quest III HD-2D Remake - Switch');
      expect(deals[0].platform).toBe('Nintendo Switch');
      expect(deals[0].salePrice).toBe(41.24);
      expect(deals[0].regularPrice).toBe(59.99);
    });

    it('should parse regular-price and on-sale in-stock amiibo from PNP category 6779', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 890,
              name: 'Metroid &#8211; Metroid Series &#8211; amiibo (JPIM)',
              permalink: 'https://pnpgamesonline.com/product/metroid-amiibo/',
              sku: 'PNP-890',
              on_sale: false,
              is_in_stock: true,
              prices: {
                price: '2999',
                regular_price: '2999',
                sale_price: '2999',
                currency_minor_unit: 2,
              },
            },
          ]),
      });

      const items = await fetchPnpAmiiboStock(
        mockFetch as unknown as typeof fetch,
        1,
        0.75,
      );
      expect(items.length).toBe(1);
      expect(items[0].categoryHint).toBe('toy');
      expect(items[0].onSale).toBe(false);
      expect(items[0].salePrice).toBe(22.49);
    });
  });

  describe('fetchAllRetailDeals', () => {
    it('should aggregate VGP and PNP deals even without a Best Buy API key', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('open.er-api.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ rates: { USD: 0.75 } }),
          });
        }
        if (url.includes('videogamesplus.ca/collections/sales')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                products: [
                  {
                    id: 10,
                    title: 'Persona 3 Reload - PS5',
                    handle: 'p3r-ps5',
                    product_type: 'PlayStation 5',
                    variants: [
                      {
                        id: 101,
                        price: '29.99',
                        compare_at_price: '59.99',
                        available: true,
                      },
                    ],
                  },
                ],
              }),
          });
        }
        if (url.includes('videogamesplus.ca')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ products: [] }),
          });
        }
        if (url.includes('pnpgamesonline.com') && url.includes('38368')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: 20,
                  name: 'Metaphor: ReFantazio [PS5]',
                  permalink: 'https://pnpgamesonline.com/product/metaphor/',
                  on_sale: true,
                  is_in_stock: true,
                  prices: {
                    price: '4999',
                    regular_price: '8999',
                    sale_price: '4999',
                    currency_minor_unit: 2,
                  },
                  attributes: [
                    {
                      taxonomy: 'pa_platform',
                      terms: [{ name: 'PlayStation 5' }],
                    },
                  ],
                },
              ]),
          });
        }
        if (url.includes('pnpgamesonline.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const result = await fetchAllRetailDeals({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.cadToUsdRate).toBe(0.75);
      expect(result.sources.vgp).toBe(1);
      expect(result.sources.pnp).toBe(1);
      expect(result.sources.bestbuy).toBe(0);
      expect(result.deals.length).toBe(2);
    });
  });
});
