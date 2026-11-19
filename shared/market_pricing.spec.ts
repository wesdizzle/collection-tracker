import { describe, it, expect } from 'vitest';
import {
  EBAY_PRICE_TTL_MS,
  EBAY_TOYS_TO_LIFE_CATEGORY_ID,
  EBAY_VIDEO_GAMES_CATEGORY_ID,
  EbayItemSummary,
  PRICE_CACHE_SHARD_COUNT,
  PricingItemDescriptor,
  buildEbaySearchPlan,
  buildEphemeralMarketPrice,
  classifyListingCondition,
  computeItemEstimatedValueCents,
  computeMarketValuation,
  filterAndNormalizeEbaySummaries,
  formatPriceAge,
  getPriceShardIndex,
  isMarketPriceFresh,
} from './market_pricing';

function makeGame(
  overrides: Partial<PricingItemDescriptor> = {},
): PricingItemDescriptor {
  return {
    itemType: 'game',
    itemId: 'chrono-trigger-super-nintendo-entertainment-system',
    title: 'Chrono Trigger',
    platformId: 15,
    platformName: 'Super Nintendo Entertainment System / Super Famicom',
    region: 'USA',
    ...overrides,
  };
}

function makeToy(
  overrides: Partial<PricingItemDescriptor> = {},
): PricingItemDescriptor {
  return {
    itemType: 'toy',
    itemId: 'link-archer-amiibo',
    title: 'Link (Archer)',
    toyLine: 'amiibo',
    toyType: 'Figure',
    toySeries: 'The Legend of Zelda',
    ...overrides,
  };
}

describe('shared/market_pricing', () => {
  describe('buildEbaySearchPlan', () => {
    it('builds positive-only eBay search queries without minus operators for video games', () => {
      const plan = buildEbaySearchPlan(makeGame());
      expect(plan.primaryQuery.categoryId).toBe(EBAY_VIDEO_GAMES_CATEGORY_ID);
      expect(plan.primaryQuery.q).toBe('Chrono Trigger SNES');
      expect(plan.primaryQuery.q).not.toContain(' -');
    });

    it('uses regional platform alias and Japan hint for Japan-only releases', () => {
      const plan = buildEbaySearchPlan(
        makeGame({
          title: 'Mother 2',
          region: 'Japan',
        }),
      );
      expect(plan.primaryQuery.q).toBe('Mother 2 Super Famicom Japan');
    });

    it('uses GTIN fast-path with keyword fallback when a valid barcode is present', () => {
      const plan = buildEbaySearchPlan(
        makeGame({
          title: 'Super Mario Odyssey',
          platformId: 26,
          platformName: 'Nintendo Switch',
          barcode: '045496590741',
        }),
      );
      expect(plan.primaryQuery.gtin).toBe('045496590741');
      expect(plan.fallbackQuery?.q).toBe('Super Mario Odyssey Nintendo Switch');
    });

    it('builds distinct queries for amiibo Figures vs amiibo Cards', () => {
      const figPlan = buildEbaySearchPlan(makeToy());
      expect(figPlan.primaryQuery.categoryId).toBe(
        EBAY_TOYS_TO_LIFE_CATEGORY_ID,
      );
      expect(figPlan.primaryQuery.q).toBe('Link Archer amiibo');

      const cardPlan = buildEbaySearchPlan(
        makeToy({
          itemId: 'raymond-card-amiibo',
          title: 'Raymond',
          toyType: 'Card',
          toySeries: 'Animal Crossing',
        }),
      );
      expect(cardPlan.primaryQuery.q).toBe('Raymond amiibo card');
    });

    it('normalizes Skylanders variants and includes Starlink pack types', () => {
      const skySeries1 = buildEbaySearchPlan(
        makeToy({
          toyLine: 'Skylanders',
          toyType: 'Series 1 *',
          toySeries: "Spyro's Adventure",
          title: 'Spyro',
        }),
      );
      expect(skySeries1.primaryQuery.q).toBe('Spyro Skylanders');

      const skyTrapMaster = buildEbaySearchPlan(
        makeToy({
          toyLine: 'Skylanders',
          toyType: 'Trap Master',
          title: 'Snap Shot',
        }),
      );
      expect(skyTrapMaster.primaryQuery.q).toBe(
        'Snap Shot Skylanders Trap Master',
      );

      const starlinkPlan = buildEbaySearchPlan(
        makeToy({
          toyLine: 'Starlink',
          toyType: 'Starship',
          title: 'Arwing',
        }),
      );
      expect(starlinkPlan.primaryQuery.q).toBe('Arwing Starlink Starship');
    });

    it('honors custom search query overrides verbatim', () => {
      const plan = buildEbaySearchPlan(
        makeGame(),
        'Chrono Trigger SNES authentic cart',
      );
      expect(plan.primaryQuery.q).toBe('Chrono Trigger SNES authentic cart');
      expect(plan.displayQuery).toBe('Chrono Trigger SNES authentic cart');
    });
  });

  describe('filterAndNormalizeEbaySummaries & condition bucketing', () => {
    it('drops multi-variation, repro, manual-only, non-USD, and wrong-sequel listings', () => {
      const game = makeGame({
        title: 'Final Fantasy VII',
        platformId: 29,
        platformName: 'PlayStation',
      });

      const raw: EbayItemSummary[] = [
        {
          title: 'Final Fantasy VII PS1 Black Label Complete CIB',
          price: { value: '39.99', currency: 'USD' },
          shippingOptions: [
            {
              shippingCostType: 'FIXED',
              shippingCost: { value: '4.50', currency: 'USD' },
            },
          ],
          conditionId: '3000',
          buyingOptions: ['FIXED_PRICE'],
          itemWebUrl: 'https://www.ebay.com/itm/1',
        },
        {
          title: 'Final Fantasy VII PS1 Manual Only Instruction Booklet',
          price: { value: '9.99', currency: 'USD' },
          conditionId: '3000',
        },
        {
          title: 'Pick Your PlayStation 1 PS1 Game Complete CIB',
          price: { value: '4.99', currency: 'USD' },
          conditionId: '3000',
          itemGroupType: 'SELLER_DEFINED_VARIATIONS',
        },
        {
          title: 'Final Fantasy VIII PS1 Complete CIB',
          price: { value: '24.99', currency: 'USD' },
          conditionId: '3000',
        },
        {
          title: 'Final Fantasy VII PS1 Japanese Version NTSC-J CIB',
          price: { value: '18.00', currency: 'USD' },
          conditionId: '3000',
        },
        {
          title: 'Final Fantasy VII PS1 Disc Only Loose Tested',
          price: { value: '19.99', currency: 'USD' },
          shippingOptions: [{ shippingCostType: 'FREE' }],
          conditionId: '3000',
          itemWebUrl: 'https://www.ebay.com/itm/6',
        },
        {
          title: 'Final Fantasy VII PS1 Case Only No Game',
          price: { value: '50.00', currency: 'CAD' },
          conditionId: '3000',
        },
      ];

      const filtered = filterAndNormalizeEbaySummaries(raw, game);
      expect(filtered).toHaveLength(2);
      expect(filtered[0]).toMatchObject({
        bucket: 'cib',
        totalCents: 4449,
        url: 'https://www.ebay.com/itm/1',
      });
      expect(filtered[1]).toMatchObject({
        bucket: 'loose',
        totalCents: 1999,
      });
    });

    it('keeps amiibo cards when pricing a Card toy and blocks cards when pricing a Figure', () => {
      const cardListing: EbayItemSummary = {
        title: 'Raymond #431 Animal Crossing Amiibo Card Official',
        price: { value: '12.00', currency: 'USD' },
        shippingOptions: [{ shippingCostType: 'FREE' }],
        conditionId: '3000',
      };

      const figToy = makeToy({ title: 'Raymond', toyType: 'Figure' });
      const cardToy = makeToy({ title: 'Raymond', toyType: 'Card' });

      expect(
        filterAndNormalizeEbaySummaries([cardListing], figToy),
      ).toHaveLength(0);
      expect(
        filterAndNormalizeEbaySummaries([cardListing], cardToy),
      ).toHaveLength(1);
    });

    it('classifies modern Switch/PS5 unspecified Used copies as CIB and retro SNES carts as Loose', () => {
      const switchGame = makeGame({
        title: 'Super Mario Odyssey',
        platformId: 26,
        platformName: 'Nintendo Switch',
      });
      const snesGame = makeGame();

      const genericUsed: EbayItemSummary = {
        title: 'Super Mario Odyssey Nintendo Switch Tested',
        price: { value: '35.00', currency: 'USD' },
        conditionId: '3000',
      };
      expect(classifyListingCondition(genericUsed, switchGame)).toBe('cib');

      const switchLoose: EbayItemSummary = {
        title: 'Super Mario Odyssey Nintendo Switch Cart Only Loose',
        price: { value: '28.00', currency: 'USD' },
        conditionId: '3000',
      };
      expect(classifyListingCondition(switchLoose, switchGame)).toBe('loose');

      const genericSnes: EbayItemSummary = {
        title: 'Chrono Trigger SNES Authentic',
        price: { value: '195.00', currency: 'USD' },
        conditionId: '3000',
      };
      expect(classifyListingCondition(genericSnes, snesGame)).toBe('loose');
    });

    it('adds conservative $5 shipping estimate for calculated shipping without a value', () => {
      const game = makeGame({
        title: 'Metroid Dread',
        platformId: 26,
        platformName: 'Nintendo Switch',
      });
      const calcListing: EbayItemSummary = {
        title: 'Metroid Dread Nintendo Switch',
        price: { value: '30.00', currency: 'USD' },
        shippingOptions: [{ shippingCostType: 'CALCULATED' }],
        conditionId: '3000',
      };
      const filtered = filterAndNormalizeEbaySummaries([calcListing], game);
      expect(filtered[0]?.totalCents).toBe(3500);
    });
  });

  describe('computeMarketValuation (IQR active floor + confidence)', () => {
    it('rejects IQR outliers and computes the 25th-percentile active floor with sample links', () => {
      const switchGame = makeGame({
        title: 'Xenoblade Chronicles 3',
        platformId: 26,
        platformName: 'Nintendo Switch',
      });

      const prices = [
        '5.00', // low outlier (mistaken/junk)
        '34.00',
        '36.00',
        '38.00',
        '40.00',
        '41.00',
        '42.00',
        '43.00',
        '45.00',
        '46.00',
        '48.00',
        '250.00', // high reseller outlier
      ];

      const summaries: EbayItemSummary[] = prices.map((val, idx) => ({
        title: 'Xenoblade Chronicles 3 Nintendo Switch Complete',
        price: { value: val, currency: 'USD' },
        shippingOptions: [{ shippingCostType: 'FREE' }],
        conditionId: '3000',
        itemWebUrl: `https://www.ebay.com/itm/${idx + 1}`,
      }));

      const val = computeMarketValuation(summaries, switchGame);
      expect(val.cib_sample_size).toBe(10);
      expect(val.confidence).toBe('high');
      expect(val.cib_cents).toBeGreaterThanOrEqual(3600);
      expect(val.cib_cents).toBeLessThanOrEqual(4000);
      expect(val.sample_listings.cib).toHaveLength(2);
      expect(val.sample_listings.cib[0].totalCents).toBe(3400);
    });

    it('falls back to median and low confidence when fewer than 3 listings exist', () => {
      const game = makeGame({
        title: 'Panzer Dragoon Saga',
        platformId: 42,
        platformName: 'Sega Saturn',
      });
      const summaries: EbayItemSummary[] = [
        {
          title: 'Panzer Dragoon Saga Sega Saturn Complete CIB',
          price: { value: '900.00', currency: 'USD' },
          conditionId: '3000',
        },
        {
          title: 'Panzer Dragoon Saga Sega Saturn Complete with Box and Manual',
          price: { value: '1100.00', currency: 'USD' },
          conditionId: '3000',
        },
      ];
      const val = computeMarketValuation(summaries, game);
      expect(val.cib_cents).toBe(100000);
      expect(val.cib_sample_size).toBe(2);
      expect(val.confidence).toBe('low');
    });
  });

  describe('completeness mapping, sharding, and hard 6h TTL', () => {
    it('maps owned CIB, Boxed-no-manual midpoint, Loose, and Toy values accurately', () => {
      const gamePrice = buildEphemeralMarketPrice(
        makeGame(),
        {
          loose_cents: 18000,
          cib_cents: 42000,
          new_cents: 95000,
          loose_sample_size: 8,
          cib_sample_size: 5,
          new_sample_size: 2,
          confidence: 'medium',
          sample_listings: { loose: [], cib: [], new: [] },
        },
        'Chrono Trigger SNES',
      );

      expect(
        computeItemEstimatedValueCents(
          { ownership_status: 1, has_case: 1, has_manual: 1 },
          gamePrice,
        ),
      ).toEqual({ cents: 42000, tierLabel: 'CIB' });

      expect(
        computeItemEstimatedValueCents(
          { ownership_status: 1, has_case: 1, has_manual: 0 },
          gamePrice,
        ),
      ).toEqual({ cents: 30000, tierLabel: 'Boxed (est.)' });

      expect(
        computeItemEstimatedValueCents(
          { ownership_status: 1, has_case: 0, has_manual: 0 },
          gamePrice,
        ),
      ).toEqual({ cents: 18000, tierLabel: 'Loose' });

      const toyPrice = buildEphemeralMarketPrice(
        makeToy(),
        {
          loose_cents: 1600,
          cib_cents: null,
          new_cents: 3200,
          loose_sample_size: 6,
          cib_sample_size: 0,
          new_sample_size: 4,
          confidence: 'medium',
          sample_listings: { loose: [], cib: [], new: [] },
        },
        'Link Archer amiibo',
      );
      expect(
        computeItemEstimatedValueCents({ ownership_status: 1 }, toyPrice),
      ).toEqual({ cents: 1600, tierLabel: 'Loose' });
    });

    it('enforces strict 6-hour expiration and deterministic 8-shard hashing', () => {
      const now = Date.parse('2026-11-18T12:00:00.000Z');
      const price = buildEphemeralMarketPrice(
        makeGame(),
        {
          loose_cents: 10000,
          cib_cents: null,
          new_cents: null,
          loose_sample_size: 4,
          cib_sample_size: 0,
          new_sample_size: 0,
          confidence: 'medium',
          sample_listings: { loose: [], cib: [], new: [] },
        },
        'Chrono Trigger SNES',
        now,
      );

      expect(isMarketPriceFresh(price, now + EBAY_PRICE_TTL_MS - 1000)).toBe(
        true,
      );
      expect(isMarketPriceFresh(price, now + EBAY_PRICE_TTL_MS)).toBe(false);
      expect(
        formatPriceAge(price.fetched_at, price.expires_at, now + 30 * 60_000),
      ).toContain('30m ago');
      expect(
        formatPriceAge(
          price.fetched_at,
          price.expires_at,
          now + EBAY_PRICE_TTL_MS + 1000,
        ),
      ).toContain('Expired');

      const shard = getPriceShardIndex('game', 'chrono-trigger-snes');
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(PRICE_CACHE_SHARD_COUNT);
      expect(getPriceShardIndex('game', 'chrono-trigger-snes')).toBe(shard);
    });
  });
});
