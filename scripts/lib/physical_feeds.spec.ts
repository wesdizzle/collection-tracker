import { describe, it, expect, vi } from 'vitest';
import {
  cleanBoutiqueTitle,
  fetchBoutiquePreOrders,
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

    it('should strictly contain only the 5 boutique limited-print publishers', () => {
      const storeNames = BOUTIQUE_FEED_CONFIGS.map((c) => c.store);
      expect(storeNames).toEqual([
        'Limited Run Games',
        'Super Rare Games',
        'iam8bit',
        'Fangamer',
        'Strictly Limited Games',
      ]);
      expect(storeNames).not.toContain('VGP');
      expect(storeNames).not.toContain('PNP Games');
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

    it('should handle network failures gracefully without throwing', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      const results = await fetchBoutiquePreOrders(
        mockFetch as unknown as typeof fetch,
      );
      expect(results).toEqual([]);
    });
  });
});
