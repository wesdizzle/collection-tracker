import { describe, it, expect, vi } from 'vitest';
import {
  cleanBoutiqueTitle,
  fetchBoutiquePreOrders,
  fetchLimitedGameNewsReleases,
  BoutiqueFeedConfig,
  BOUTIQUE_FEED_CONFIGS,
} from './physical_feeds.js';

describe('Boutique Physical Publisher & Pre-Order Feeds', () => {
  describe('cleanBoutiqueTitle', () => {
    it('should strip store catalog prefixes like LRG and SRG', () => {
      const lrg = cleanBoutiqueTitle(
        'LRG #550: Clock Tower: Rewind (PlayStation 5)',
      );
      expect(lrg.cleanTitle).toBe('Clock Tower: Rewind');
      expect(lrg.platformId).toBe(35);
      expect(lrg.isGame).toBe(true);

      const lrgFull = cleanBoutiqueTitle(
        'Limited Run #273: Oddworld: Stranger Wrath (PlayStation Vita)',
      );
      expect(lrgFull.cleanTitle).toBe('Oddworld: Stranger Wrath');
      expect(lrgFull.platformId).toBe(33);

      const multiNum = cleanBoutiqueTitle(
        'Limited Run #336 & #337: Double Pack Collection (Nintendo Switch)',
      );
      expect(multiNum.cleanTitle).toBe('Double Pack Collection');
      expect(multiNum.platformId).toBe(26);

      const srg = cleanBoutiqueTitle('SRG#120: Tinykin (Switch)');
      expect(srg.cleanTitle).toBe('Tinykin');
      expect(srg.platformId).toBe(26);
      expect(srg.isGame).toBe(true);
    });

    it('should detect pre-order flags from titles', () => {
      const res = cleanBoutiqueTitle(
        '[PRE-ORDER] Shantae Advance: Risky Revolution (Switch)',
      );
      expect(res.cleanTitle).toBe('Shantae Advance: Risky Revolution');
      expect(res.platformId).toBe(26);
      expect(res.isPreOrder).toBe(true);
      expect(res.isGame).toBe(true);

      const colonPre = cleanBoutiqueTitle(
        'PRE-ORDER: Castlevania Dominus Collection (PS5)',
      );
      expect(colonPre.cleanTitle).toBe('Castlevania Dominus Collection');
      expect(colonPre.platformId).toBe(35);
      expect(colonPre.isPreOrder).toBe(true);
    });

    it('should strip common edition fluff while keeping base title intact and extracting edition name', () => {
      const res1 = cleanBoutiqueTitle(
        "Sea of Stars Collector's Edition (Switch)",
      );
      expect(res1.cleanTitle).toBe('Sea of Stars');
      expect(res1.platformId).toBe(26);
      expect(res1.edition).toBe("Collector's Edition");

      const res2 = cleanBoutiqueTitle(
        'Metaphor: ReFantazio Standard Edition - PS5',
      );
      expect(res2.cleanTitle).toBe('Metaphor: ReFantazio');
      expect(res2.platformId).toBe(35);
      expect(res2.edition).toBeNull();

      const res3 = cleanBoutiqueTitle(
        'Celeste Deluxe Edition (Nintendo Switch)',
      );
      expect(res3.cleanTitle).toBe('Celeste');
      expect(res3.platformId).toBe(26);
      expect(res3.edition).toBe('Deluxe Edition');
    });

    it('should filter out non-game merchandise like vinyl, soundtracks, and apparel', () => {
      const vinyl = cleanBoutiqueTitle(
        'Persona 3 Reload 4xLP Vinyl Soundtrack',
      );
      expect(vinyl.isGame).toBe(false);

      const plush = cleanBoutiqueTitle('Hollow Knight Knight Plush');
      expect(plush.isGame).toBe(false);

      const pin = cleanBoutiqueTitle('Celeste Enamel Pin Set');
      expect(pin.isGame).toBe(false);

      expect(cleanBoutiqueTitle('Mario Desk Mat').isGame).toBe(false);
      expect(cleanBoutiqueTitle('Game X Slipcover').isGame).toBe(false);
      expect(cleanBoutiqueTitle('Hollow Knight Acrylic Stand').isGame).toBe(
        false,
      );
      expect(cleanBoutiqueTitle('Game Y (Digital Code Only)').isGame).toBe(
        false,
      );
    });

    it('should recognize retro console cartridges', () => {
      const md = cleanBoutiqueTitle(
        'Strictly Limited #42: Rainbow Islands Extra (Mega Drive)',
      );
      expect(md.cleanTitle).toBe('Rainbow Islands Extra');
      expect(md.platformId).toBe(37); // Sega Genesis / Mega Drive
      expect(md.isGame).toBe(true);

      const snes = cleanBoutiqueTitle('Earthion (Super Nintendo / SNES)');
      expect(snes.cleanTitle).toBe('Earthion');
      expect(snes.platformId).toBe(15);
      expect(snes.isGame).toBe(true);
    });

    it('should strip connective prepositions (for, on) and trademark symbols', () => {
      const ps4 = cleanBoutiqueTitle('UNDERTALE for PlayStation 4');
      expect(ps4.cleanTitle).toBe('UNDERTALE');
      expect(ps4.platformId).toBe(34);
      expect(ps4.isGame).toBe(true);

      const switchTm = cleanBoutiqueTitle('UNDERTALE for Nintendo Switch™');
      expect(switchTm.cleanTitle).toBe('UNDERTALE');
      expect(switchTm.platformId).toBe(26);

      const pizzaTower = cleanBoutiqueTitle(
        "Pizza Tower for Nintendo Switch™ Collector's Edition",
      );
      expect(pizzaTower.cleanTitle).toBe('Pizza Tower');
      expect(pizzaTower.edition).toBe("Collector's Edition");
      expect(pizzaTower.platformId).toBe(26);
    });

    it('should extract region from parentheticals and trailing delimiters', () => {
      const jp = cleanBoutiqueTitle(
        'Castlevania Dominus Collection - Switch (JP)',
      );
      expect(jp.cleanTitle).toBe('Castlevania Dominus Collection');
      expect(jp.region).toBe('Japan');
      expect(jp.platformId).toBe(26);

      const eu = cleanBoutiqueTitle(
        'Shantae Advance: Risky Revolution (Switch) (EU)',
      );
      expect(eu.cleanTitle).toBe('Shantae Advance: Risky Revolution');
      expect(eu.region).toBe('Europe');
      expect(eu.platformId).toBe(26);

      const euVersion = cleanBoutiqueTitle('Sea of Stars (PS5) (EU Version)');
      expect(euVersion.cleanTitle).toBe('Sea of Stars');
      expect(euVersion.region).toBe('Europe');
      expect(euVersion.platformId).toBe(35);

      const jpDash = cleanBoutiqueTitle(
        'Metaphor: ReFantazio Standard Edition - PS5 - JP',
      );
      expect(jpDash.cleanTitle).toBe('Metaphor: ReFantazio');
      expect(jpDash.region).toBe('Japan');
      expect(jpDash.platformId).toBe(35);
    });
  });

  describe('fetchBoutiquePreOrders', () => {
    it('should fetch and parse Shopify product catalogs', async () => {
      const mockShopify = {
        products: [
          {
            id: 11111,
            title: 'LRG #590: Persona 4 Golden (Switch)',
            handle: 'persona-4-golden-switch',
            tags: ['game', 'pre-order', 'switch'],
            published_at: '2026-10-01T00:00:00Z',
            images: [{ src: 'https://cdn.shopify.com/p4g.jpg' }],
            variants: [{ price: '34.99' }],
          },
          {
            id: 22222,
            title: 'Persona 4 Golden Vinyl Soundtrack',
            handle: 'p4g-vinyl',
            tags: ['vinyl'],
            images: [],
            variants: [{ price: '99.99' }],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockShopify,
      });

      const singleStore: BoutiqueFeedConfig[] = [
        {
          store: 'Limited Run Games',
          url: 'https://limitedrungames.com/collections/all/products.json?limit=250',
          baseUrl: 'https://limitedrungames.com',
          type: 'shopify',
        },
      ];

      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        singleStore,
      );
      expect(results).toHaveLength(1);
      expect(results[0].cleanTitle).toBe('Persona 4 Golden');
      expect(results[0].platformId).toBe(26);
      expect(results[0].isPreOrder).toBe(true);
      expect(results[0].priceUsd).toBe(34.99);
      expect(results[0].priceCents).toBe(3499);
      expect(results[0].productUrl).toBe(
        'https://limitedrungames.com/products/persona-4-golden-switch',
      );
      expect(results[0].imageUrl).toBe('https://cdn.shopify.com/p4g.jpg');
    });

    it('should contain the configured boutique & physical publisher storefronts', () => {
      const storeNames = BOUTIQUE_FEED_CONFIGS.map((c) => c.store);
      expect(storeNames).toEqual([
        'Limited Run Games',
        'Super Rare Games',
        'iam8bit',
        'Fangamer',
        'Strictly Limited Games',
        'NIS America',
        'Aksys Games',
        'Clear River Games',
        'Serenity Forge',
        'Premium Edition Games',
        'CastleMania',
        'Silver Lining Direct',
        'First Press Games',
      ]);
      expect(storeNames).not.toContain('VGP');
      expect(storeNames).not.toContain('PNP Games');
    });

    it('should extract regularPriceCents, discountPct, and onSale when compare_at_price is higher than price', async () => {
      const mockShopify = {
        products: [
          {
            id: 55555,
            title: 'Disgaea 7 Complete (Switch)',
            handle: 'disgaea-7-switch',
            variants: [
              {
                price: '39.99',
                compare_at_price: '59.99',
                available: true,
              },
            ],
          },
        ],
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockShopify,
      });
      const singleStore: BoutiqueFeedConfig[] = [
        {
          store: 'NIS America',
          url: 'https://store.nisamerica.com/collections/games/products.json?limit=250',
          baseUrl: 'https://store.nisamerica.com',
          type: 'shopify',
        },
      ];
      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        singleStore,
      );
      expect(results).toHaveLength(1);
      expect(results[0].priceCents).toBe(3999);
      expect(results[0].regularPriceCents).toBe(5999);
      expect(results[0].discountPct).toBe(33);
      expect(results[0].onSale).toBe(true);
    });

    it('should fetch and parse WooCommerce product catalogs with CAD conversion', async () => {
      const mockWc = [
        {
          id: 33333,
          name: 'Super Mario Party Jamboree (NSW) [Pre-Order]',
          permalink:
            'https://boutique.example.com/product/super-mario-party-jamboree-nsw/',
          images: [{ src: 'https://boutique.example.com/jamboree.jpg' }],
          prices: { price: '7999' },
          date_created: '2026-09-15T12:00:00',
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockWc,
      });

      const singleStore: BoutiqueFeedConfig[] = [
        {
          store: 'Super Rare Games',
          url: 'https://boutique.example.com/wp-json/wc/store/v1/products?per_page=100',
          baseUrl: 'https://boutique.example.com',
          type: 'woocommerce',
          isCad: true,
        },
      ];

      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        singleStore,
      );
      expect(results).toHaveLength(1);
      expect(results[0].cleanTitle).toBe('Super Mario Party Jamboree');
      expect(results[0].platformId).toBe(26);
      expect(results[0].isPreOrder).toBe(true);
      // 79.99 CAD * 0.73 ~= 58.39 USD
      expect(results[0].priceUsd).toBe(58.39);
      expect(results[0].priceCents).toBe(5839);
    });

    it('should correctly flag stock availability based on Shopify variants', async () => {
      const mockShopify = {
        products: [
          {
            id: 301,
            title: 'Limited Game In Stock (Switch)',
            handle: 'game-in-stock',
            variants: [
              { price: '34.99', available: false },
              { price: '34.99', available: true },
            ],
          },
          {
            id: 302,
            title: 'Limited Game Sold Out (PS5)',
            handle: 'game-sold-out',
            variants: [{ price: '34.99', available: false }],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockShopify,
      });

      const singleStore: BoutiqueFeedConfig[] = [
        {
          store: 'Limited Run Games',
          url: 'https://limitedrungames.com/collections/all/products.json?limit=250',
          baseUrl: 'https://limitedrungames.com',
          type: 'shopify',
        },
      ];

      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        singleStore,
      );
      expect(results).toHaveLength(2);
      expect(results[0].cleanTitle).toBe('Limited Game In Stock');
      expect(results[0].isAvailable).toBe(true);
      expect(results[0].region).toBe('USA');

      expect(results[1].cleanTitle).toBe('Limited Game Sold Out');
      expect(results[1].isAvailable).toBe(false);
      expect(results[1].region).toBe('USA');
    });

    it('should handle network failures gracefully without throwing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
      );
      expect(results).toEqual([]);
    });

    it('should support multi-page Shopify pagination when maxPages > 1', async () => {
      const page1Products = Array.from({ length: 250 }, (_, idx) => ({
        id: idx + 1,
        title: `Paged Game ${idx + 1} (Switch)`,
        handle: `paged-game-${idx + 1}`,
        variants: [{ price: '39.99', available: true }],
      }));
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('page=2')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              products: [
                {
                  id: 251,
                  title: 'Final Page Game (PS5)',
                  handle: 'final-page-game',
                  variants: [{ price: '49.99', available: true }],
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ products: page1Products }),
        });
      });

      const store: BoutiqueFeedConfig[] = [
        {
          store: 'Silver Lining Direct',
          url: 'https://direct.silverliningint.com/products.json?limit=250',
          baseUrl: 'https://direct.silverliningint.com',
          type: 'shopify',
        },
      ];

      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        store,
        3,
      );
      expect(results).toHaveLength(251);
      expect(results[250].store).toBe('Silver Lining Direct');
      expect(results[250].platformId).toBe(35);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should parse multi-platform Shopify variants and enforce Xbox One forward-compat rules', async () => {
      const mockShopify = {
        products: [
          {
            id: 7001,
            title: 'TUNIC',
            handle: 'tunic',
            tags: ['Physical Games'],
            variants: [
              { title: 'Nintendo Switch', price: '45.00', available: true },
              { title: 'PlayStation 4', price: '45.00', available: true },
              { title: 'Steam (Digital)', price: '29.99', available: true },
            ],
          },
          {
            id: 7002,
            title: 'Psychonauts 2 (Xbox)',
            handle: 'psychonauts-2-xbox',
            tags: ['Xbox One'],
            body_html:
              '<p>Includes Xbox One and Xbox Series X Smart Delivery</p>',
            variants: [
              { title: 'Standard Edition', price: '49.99', available: true },
            ],
          },
          {
            id: 7003,
            title: 'Mystic Dual Disc (Xbox One / Xbox Series X)',
            handle: 'mystic-dual-disc',
            tags: [],
            variants: [
              { title: 'Xbox One', price: '39.99', available: true },
              { title: 'Xbox Series X', price: '39.99', available: true },
            ],
          },
          {
            id: 7004,
            title: 'Series Exclusive Game',
            handle: 'series-exclusive-game',
            tags: ['Xbox Series X'],
            variants: [{ title: 'Xbox', price: '59.99', available: true }],
          },
          {
            id: 7005,
            title: 'Ambiguous Bare Xbox Game (Xbox)',
            handle: 'ambiguous-xbox-game',
            tags: ['Xbox'],
            variants: [
              { title: 'Default Title', price: '39.99', available: true },
            ],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockShopify,
      });

      const store: BoutiqueFeedConfig[] = [
        {
          store: 'Fangamer',
          url: 'https://www.fangamer.com/collections/games/products.json?limit=250',
          baseUrl: 'https://www.fangamer.com',
          type: 'shopify',
        },
      ];

      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
        store,
      );

      // TUNIC -> Switch (26) & PS4 (34), skipping Steam
      const tunicItems = results.filter((r) => r.cleanTitle === 'TUNIC');
      expect(tunicItems.map((r) => r.platformId)).toEqual([26, 34]);
      expect(tunicItems.map((r) => r.id)).toEqual([
        'Fangamer_7001_26',
        'Fangamer_7001_34',
      ]);

      // Psychonauts 2 -> resolved to Xbox One (49) via tags/body, not ambiguous
      const psychonauts = results.find((r) => r.cleanTitle === 'Psychonauts 2');
      expect(psychonauts?.platformId).toBe(49);
      expect(psychonauts?.ambiguousXbox).toBeUndefined();

      // Dual Xbox One / Xbox Series X -> emits 49 only (never double-emits 50)
      const dualItems = results.filter(
        (r) => r.cleanTitle === 'Mystic Dual Disc',
      );
      expect(dualItems).toHaveLength(1);
      expect(dualItems[0].platformId).toBe(49);

      // Explicit XSX in tags without Xbox One -> resolves to 50
      const seriesOnly = results.find(
        (r) => r.cleanTitle === 'Series Exclusive Game',
      );
      expect(seriesOnly?.platformId).toBe(50);

      // Bare Xbox without clarifying tags -> defaults 49 with ambiguousXbox=true
      const ambig = results.find(
        (r) => r.cleanTitle === 'Ambiguous Bare Xbox Game',
      );
      expect(ambig?.platformId).toBe(49);
      expect(ambig?.ambiguousXbox).toBe(true);
    });
  });

  describe('fetchLimitedGameNewsReleases', () => {
    it('should parse multi-platform announcements, publisher framing, and Asia English tags', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/categories')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { id: 4, name: 'Nintendo Switch', slug: 'nintendo-switch' },
              { id: 3, name: 'PlayStation 5', slug: 'playstation-5' },
              { id: 10022, name: 'Asia English', slug: 'asia-english' },
            ],
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 501,
              date_gmt: '2026-11-20T12:00:00',
              link: 'https://limitedgamenews.com/2026/11/castlevania/',
              title: {
                rendered:
                  'Red Art Games announces Castlevania Dominus Collection for Nintendo Switch and PS5',
              },
              excerpt: {
                rendered:
                  '<p>Physical editions open for pre-order on Switch and PS5.</p>',
              },
              categories: [4, 3],
            },
            {
              id: 502,
              date_gmt: '2026-11-21T09:00:00',
              link: 'https://limitedgamenews.com/2026/11/shiren/',
              title: {
                rendered: 'Shiren the Wanderer &#8211; Switch 2 (Asia English)',
              },
              excerpt: {
                rendered: '<p>Import physical edition available.</p>',
              },
              categories: [10022],
            },
            {
              id: 503,
              date_gmt: '2026-11-21T10:00:00',
              link: 'https://limitedgamenews.com/2026/11/roundup/',
              title: { rendered: 'Weekly Physical Release Roundup' },
              excerpt: { rendered: '<p>Everything released this week.</p>' },
              categories: [4],
            },
            {
              id: 504,
              date_gmt: '2026-11-22T10:00:00',
              link: 'https://limitedgamenews.com/2026/11/sektori/',
              title: {
                rendered: 'Tenebris Somnia | PlayStation 5, , Xbox Series X|S',
              },
              excerpt: {
                rendered: '<p>Console physical release announced.</p>',
              },
              categories: [3],
            },
            {
              id: 505,
              date_gmt: '2026-11-22T11:00:00',
              link: 'https://limitedgamenews.com/2026/11/bundle/',
              title: {
                rendered: 'Castlevania Collection | Konami Classics (Switch)',
              },
              excerpt: {
                rendered: '<p>Double pack physical edition.</p>',
              },
              categories: [4],
            },
          ],
        });
      });

      const items = await fetchLimitedGameNewsReleases(
        mockFetch as unknown as typeof fetch,
      );
      expect(items).toHaveLength(6);
      expect(items[0].store).toBe('Limited Game News');
      expect(items[0].cleanTitle).toBe('Castlevania Dominus Collection');
      expect(items.slice(0, 2).map((i) => i.platformId)).toEqual([26, 35]);

      expect(items[2].cleanTitle).toBe('Shiren the Wanderer');
      expect(items[2].platformId).toBe(27);
      expect(items[2].region).toBe('Asia');

      expect(items[3].cleanTitle).toBe('Tenebris Somnia');
      expect(items[3].platformId).toBe(35);
      expect(items[4].cleanTitle).toBe('Tenebris Somnia');
      expect(items[4].platformId).toBe(50);

      expect(items[5].cleanTitle).toBe(
        'Castlevania Collection | Konami Classics',
      );
      expect(items[5].platformId).toBe(26);
    });

    it('should skip promotional deal roundup headlines such as Free Shipping Deals', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/categories')) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 3, name: 'PS5', slug: 'ps5' }],
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 601,
              date_gmt: '2026-11-23T12:00:00',
              link: 'https://limitedgamenews.com/2026/11/playasia-week-2026-free-shipping-deals/',
              title: {
                rendered: 'Playasia Week-2026 &#8211; Free Shipping Deals',
              },
              excerpt: { rendered: '<p>Save on weekly Playasia deals.</p>' },
              categories: [3],
            },
            {
              id: 602,
              date_gmt: '2026-11-23T13:00:00',
              link: 'https://limitedgamenews.com/2026/11/actual-game/',
              title: { rendered: 'Valid Physical Title | PlayStation 5' },
              excerpt: { rendered: '<p>Physical release announced.</p>' },
              categories: [3],
            },
          ],
        });
      });

      const items = await fetchLimitedGameNewsReleases(
        mockFetch as unknown as typeof fetch,
      );
      expect(items).toHaveLength(1);
      expect(items[0].cleanTitle).toBe('Valid Physical Title');
    });
  });
});
