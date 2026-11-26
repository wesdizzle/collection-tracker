import { describe, it, expect, vi } from 'vitest';
import {
  cleanRetailTitle,
  decodeHtmlEntities,
  resolveRetailPlatformId,
  normalizeTitle,
  matchRetailGameProduct,
  matchRetailToyProduct,
  parseRetailToyTitle,
  isNonGameRetailTitle,
  parseRetailReleaseDate,
  fetchCadToUsdRate,
  fetchVgpDeals,
  fetchVgpAmiiboStock,
  fetchVgpNewPreOrders,
  fetchPnpDeals,
  fetchPnpAmiiboStock,
  fetchPnpPreOrders,
  fetchAllRetailDeals,
  fetchAllRetailPreOrders,
  RetailDealItem,
  CandidateGame,
  CandidateToy,
} from './retail.js';

describe('Retail Deals & Stock Client (VGP, PNP Games)', () => {
  describe('decodeHtmlEntities', () => {
    it('should decode named and numeric HTML entities from WooCommerce titles', () => {
      expect(
        decodeHtmlEntities('Mario &#038; Luigi: Brothership &#8211; Switch'),
      ).toBe('Mario & Luigi: Brothership - Switch');
      expect(decodeHtmlEntities('Demon&#8217;s Souls &amp; More')).toBe(
        "Demon's Souls & More",
      );
    });
    it('decodes extended HTML entities including multiplication signs', () => {
      expect(decodeHtmlEntities('Hunter&#215;Hunter Nen')).toBe(
        'Hunter×Hunter Nen',
      );
      expect(decodeHtmlEntities('A &times; B')).toBe('A × B');
    });
  });

  describe('cleanRetailTitle', () => {
    it('should strip trailing platform suffixes and VGP/PNP tags from titles', () => {
      expect(
        cleanRetailTitle("Marvel's Spider-Man: Miles Morales - PlayStation 4"),
      ).toBe("Marvel's Spider-Man: Miles Morales");

      expect(cleanRetailTitle('Super Mario Odyssey - Nintendo Switch')).toBe(
        'Super Mario Odyssey',
      );
      expect(
        cleanRetailTitle(
          'Astonishia Story - Playsation 5 PREORDER - ESTIMATED SHIP DATE FEB 11 2027',
        ),
      ).toBe('Astonishia Story');
      expect(cleanRetailTitle('Job Simulator - Sony PlayStation VR')).toBe(
        'Job Simulator',
      );

      expect(cleanRetailTitle('Halo Infinite - Xbox Series X')).toBe(
        'Halo Infinite',
      );

      expect(cleanRetailTitle('God of War - PS4')).toBe('God of War');

      expect(cleanRetailTitle("Demon's Souls [PlayStation 5]")).toBe(
        "Demon's Souls",
      );

      expect(
        cleanRetailTitle('Final Fantasy VII Rebirth Standard Edition'),
      ).toBe('Final Fantasy VII Rebirth');

      expect(
        cleanRetailTitle('Silent Hill 2 (PS5) [PEGI Import] - PlayStation 5'),
      ).toBe('Silent Hill 2');

      expect(
        cleanRetailTitle(
          'Mario &#038; Luigi: Brothership [US/ESRB] (Nintendo Switch)',
        ),
      ).toBe('Mario & Luigi: Brothership');

      expect(
        cleanRetailTitle('Celeste [Limited Run Games #198] - Nintendo Switch'),
      ).toBe('Celeste');

      expect(
        cleanRetailTitle(
          'Baten Kaitos [Asian English Import] [Play-Asia Exclusive]',
        ),
      ).toBe('Baten Kaitos');

      expect(
        cleanRetailTitle(
          'Limited Run #420: Guacamelee (JPIM) [SteelBook® Edition] [Free Shipping] (Extra Edition)',
        ),
      ).toBe('Guacamelee');

      expect(
        cleanRetailTitle(
          'Hunter&#215;Hunter (Multi-Lang) [Canadian Exclusive Retailer] [EU Import]',
        ),
      ).toBe('Hunter×Hunter');

      expect(
        cleanRetailTitle(
          'XB1 Cyberpunk 2077 - PAL IMPORT - DLC MAY NOT BE INCLUDED',
        ),
      ).toBe('Cyberpunk 2077');
      expect(cleanRetailTitle('XSX XB1 Hogwarts Legacy - PRE-OWNED')).toBe(
        'Hogwarts Legacy',
      );
      expect(isNonGameRetailTitle('Xbox One System - HW - Black')).toBe(true);
      expect(isNonGameRetailTitle('Halo Infinite - Manual Only')).toBe(true);
      expect(isNonGameRetailTitle('Gears 5 - Case Only')).toBe(true);
      expect(
        isNonGameRetailTitle(
          'PS4 PlayStation 4 - System HW - Original Model - 500 GB - Black - USED',
        ),
      ).toBe(true);
      expect(
        cleanRetailTitle("7'scarlet - (PSV) PlayStation Vita [Pre-Owned]"),
      ).toBe("7'scarlet");
      expect(
        cleanRetailTitle(
          '.hack//G.U. Last Recode - (PS4) PlayStation 4 [Pre-Owned]',
        ),
      ).toBe('.hack//G.U. Last Recode');
      expect(
        cleanRetailTitle(
          'PS4 Call of Duty - Black Ops III 3 - DLC MAY NOT BE INCLUDED',
        ),
      ).toBe('Call of Duty - Black Ops III 3');
    });

    it('should handle empty or undefined titles gracefully', () => {
      expect(cleanRetailTitle('')).toBe('');
    });
  });

  describe('resolveRetailPlatformId', () => {
    it('should resolve platform ID from explicit platform string or title suffix', () => {
      expect(resolveRetailPlatformId('PlayStation 5', 'Astro Bot')).toBe(35);

      expect(
        resolveRetailPlatformId(undefined, 'Metroid Prime Remastered [Switch]'),
      ).toBe(26);

      // Dual Xbox One / Xbox Series X classifies strictly as Xbox One (49)
      expect(
        resolveRetailPlatformId('Xbox Series X / Xbox One', 'Dual Release'),
      ).toBe(49);
      expect(
        resolveRetailPlatformId(
          undefined,
          'Hogwarts Legacy - Xbox One / Xbox Series X',
        ),
      ).toBe(49);
      expect(resolveRetailPlatformId(undefined, 'XSX XB1 Elden Ring')).toBe(49);
      expect(resolveRetailPlatformId(undefined, 'XB1 Halo 5')).toBe(49);
      expect(resolveRetailPlatformId(undefined, 'XSX Dead Space')).toBe(50);
      expect(resolveRetailPlatformId(undefined, 'PS4 God of War')).toBe(34);
      expect(resolveRetailPlatformId(undefined, 'PS5 Returnal')).toBe(35);
      expect(resolveRetailPlatformId(undefined, 'PSV Persona 4 Golden')).toBe(
        33,
      );
      expect(
        resolveRetailPlatformId('Xbox Series X', 'Dead Space Remake'),
      ).toBe(50);
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

  describe('matchRetailGameProduct', () => {
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
      const product: RetailDealItem = {
        store: 'VGP',
        sku: '5358600',
        name: 'God of War PS4 Edition',
        upc: '071171950550',
        regularPrice: 19.99,
        salePrice: 9.99,
        onSale: true,
        percentSavings: 50,
        url: 'https://videogamesplus.ca/products/gow-ps4',
        onlineAvailability: true,
      };

      const matchedId = matchRetailGameProduct(product, candidates);
      expect(matchedId).toBe(101);
    });

    it('should match game by title and platform when UPC is not present', () => {
      const product: RetailDealItem = {
        store: 'PNP Games',
        sku: '999999',
        name: 'Halo Infinite - Xbox Series X',
        platform: 'Xbox Series X',
        regularPrice: 59.99,
        salePrice: 19.99,
        onSale: true,
        percentSavings: 67,
        url: 'https://pnpgamesonline.com/product/halo',
        onlineAvailability: true,
      };

      const matchedId = matchRetailGameProduct(product, candidates);
      expect(matchedId).toBe(103);
    });

    it('should not match game if platform does not match', () => {
      const product: RetailDealItem = {
        store: 'VGP',
        sku: '888888',
        name: 'God of War - PlayStation 5',
        platform: 'PlayStation 5', // PS5 (35), but candidate is PS4 (34)
        regularPrice: 19.99,
        salePrice: 9.99,
        onSale: true,
        percentSavings: 50,
        url: 'https://videogamesplus.ca/products/gow-ps5',
        onlineAvailability: true,
      };

      const matchedId = matchRetailGameProduct(product, candidates);
      expect(matchedId).toBeNull();
    });

    it('should not falsely match a standalone amiibo figure to a game with the same title', () => {
      const product: RetailDealItem = {
        store: 'PNP Games',
        sku: '777777',
        name: 'Metroid - amiibo',
        regularPrice: 21.99,
        salePrice: 14.99,
        onSale: true,
        percentSavings: 32,
        url: 'https://pnpgamesonline.com/product/metroid-amiibo/',
        onlineAvailability: true,
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

  describe('isNonGameRetailTitle & parseRetailReleaseDate', () => {
    it('should filter out hardware, accessories, soundtracks, guides, and TCG items', () => {
      expect(isNonGameRetailTitle('Nintendo Switch 2 Pro Controller')).toBe(
        true,
      );
      expect(isNonGameRetailTitle('Metroid Dread Vinyl Soundtrack OST')).toBe(
        true,
      );
      expect(
        isNonGameRetailTitle('Pokemon Scarlet & Violet Booster Box TCG'),
      ).toBe(true);
      expect(isNonGameRetailTitle('Metroid Prime 4: Beyond - Switch 2')).toBe(
        false,
      );
    });

    it('should parse shipped/release dates and skip Dec 31 placeholders', () => {
      expect(
        parseRetailReleaseDate('<p>ESTIMATED SHIP DATE MAY 22 2026</p>'),
      ).toBe('2026-05-22');
      expect(parseRetailReleaseDate('Release Date: October 17, 2026')).toBe(
        '2026-10-17',
      );
      expect(
        parseRetailReleaseDate('ESTIMATED SHIP DATE DECEMBER 31 2026'),
      ).toBeNull();
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
    it('should aggregate VGP and PNP deals cleanly', async () => {
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
      expect(result.deals.length).toBe(2);
    });
  });

  describe('fetchAllRetailPreOrders & pre-order scrapers', () => {
    it('should fetch and parse VGP and PNP game pre-orders while excluding non-games', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('open.er-api.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ rates: { USD: 0.75 } }),
          });
        }
        if (
          url.includes('videogamesplus.ca/collections/pre-orders/products.json')
        ) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                products: [
                  {
                    id: 1001,
                    title: 'Yooka-Replaylee - Nintendo Switch 2 (PRE-ORDER)',
                    handle: 'yooka-replaylee-ns2',
                    product_type: 'Nintendo Switch 2',
                    tags: ['PRE-ORDER'],
                    body_html: '<p>Release Date: November 12, 2026</p>',
                    variants: [
                      {
                        id: 10011,
                        price: '69.99',
                        compare_at_price: null,
                        available: true,
                      },
                    ],
                  },
                  {
                    id: 1002,
                    title: 'Switch 2 Pro Controller (PRE-ORDER)',
                    handle: 'switch-2-pro-controller',
                    product_type: 'Accessory',
                    tags: ['PRE-ORDER'],
                    variants: [
                      {
                        id: 10021,
                        price: '99.99',
                        compare_at_price: null,
                        available: true,
                      },
                    ],
                  },
                ],
              }),
          });
        }
        if (url.includes('pnpgamesonline.com') && url.includes('13767')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'x-wp-totalpages': '1' }),
            json: () =>
              Promise.resolve([
                {
                  id: 2001,
                  name: 'Metroid Prime 4: Beyond &#8211; Switch 2',
                  permalink:
                    'https://pnpgamesonline.com/product/metroid-prime-4-ns2/',
                  sku: 'PNP-2001',
                  on_sale: false,
                  is_in_stock: false,
                  short_description: '<p>ESTIMATED SHIP DATE MAY 22 2026</p>',
                  prices: {
                    price: '8999',
                    regular_price: '8999',
                    sale_price: '8999',
                    currency_minor_unit: 2,
                  },
                  attributes: [
                    {
                      taxonomy: 'pa_platform',
                      terms: [{ name: 'Nintendo Switch 2' }],
                    },
                  ],
                },
              ]),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });

      const vgpOnly = await fetchVgpNewPreOrders(
        mockFetch as unknown as typeof fetch,
        1,
        0.75,
      );
      expect(vgpOnly).toHaveLength(1);
      expect(vgpOnly[0].releaseDate).toBe('2026-11-12');
      expect(vgpOnly[0].isPreOrder).toBe(true);

      const pnpOnly = await fetchPnpPreOrders(
        mockFetch as unknown as typeof fetch,
        1,
        0.75,
      );
      expect(pnpOnly).toHaveLength(1);
      expect(pnpOnly[0].releaseDate).toBe('2026-05-22');
      expect(pnpOnly[0].isPreOrder).toBe(true);

      const all = await fetchAllRetailPreOrders({
        fetchFn: mockFetch as unknown as typeof fetch,
        maxVgpPages: 1,
        maxPnpPages: 1,
      });
      expect(all.sources).toEqual({ vgp: 1, pnp: 1 });
      expect(all.preOrders).toHaveLength(2);
    });

    it('falls back to /collections/all/products.json when /collections/pre-orders returns 403/404', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/collections/pre-orders/products.json')) {
          return Promise.resolve({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
          });
        }
        if (url.includes('/collections/all/products.json')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                products: [
                  {
                    id: 991,
                    title: 'Fallback PreOrder - PS5 (PRE-ORDER)',
                    handle: 'fallback-ps5',
                    product_type: 'PlayStation 5',
                    tags: ['PRE-ORDER'],
                    variants: [{ id: 1, price: '59.99', available: true }],
                  },
                ],
              }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });
      });

      const res = await fetchVgpNewPreOrders(
        mockFetch as unknown as typeof fetch,
        1,
        0.73,
      );
      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('Fallback PreOrder - PS5 (PRE-ORDER)');
    });

    it('rejects storefront multi-game cart mega-packs while cleaning merch add-on suffixes from single games', () => {
      expect(isNonGameRetailTitle('Series 9 "Standard" Mega Pack')).toBe(true);
      expect(
        isNonGameRetailTitle(
          'PlayStation Series 1 Preorder Mega Pack + Bonus!',
        ),
      ).toBe(true);
      expect(isNonGameRetailTitle('Taito CE Bundle')).toBe(true);
      expect(isNonGameRetailTitle('Indie Action RPG Bundle')).toBe(true);
      expect(isNonGameRetailTitle('Couch Co-Op Fun Collector Bundle')).toBe(
        true,
      );
      expect(isNonGameRetailTitle('Irem Collection Volume 1 - 5 Bundle')).toBe(
        true,
      );
      expect(
        isNonGameRetailTitle(
          'Toaplan Arcade Collection Volume 1 and 2 Complete Bundle',
        ),
      ).toBe(true);
      expect(isNonGameRetailTitle('Frostpunk: Console Edition')).toBe(false);

      // Single-game merch add-on bundles remain matchable for existence/retail links without spawning merch variants
      expect(
        isNonGameRetailTitle('Bubble Bobble 4 Friends Plushie Bundle'),
      ).toBe(false);
      expect(cleanRetailTitle('Bubble Bobble 4 Friends Plushie Bundle')).toBe(
        'Bubble Bobble 4 Friends',
      );
      expect(
        cleanRetailTitle('Astonishia Story + Store Exclusive Key Art Stand'),
      ).toBe('Astonishia Story');
      expect(
        cleanRetailTitle(
          'Final Fantasy VII Revelation (With Exclusive MTG FF Promo Card)',
        ),
      ).toBe('Final Fantasy VII Revelation');
    });
  });
});
