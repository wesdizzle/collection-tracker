import { describe, it, expect } from 'vitest';
import {
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  OwnershipStatus,
  PlayStatus,
  Toy,
  getMarketPriceKey,
} from './collection.models';
import {
  computeCollectionGrowthSeries,
  findGameJournalEntry,
  findToyJournalEntry,
  formatCompactProvenanceBadge,
  hasActiveProvenanceFilter,
  matchesProvenanceFilters,
  parseJournalDate,
} from './provenance-analytics';

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    stable_id: 1,
    id: 'game-1-switch',
    game_id: 'game-1-switch',
    title: 'Sample Game',
    series: 'Sample',
    canonical_series: 'Sample',
    platform: 'Nintendo Switch',
    platform_id: 26,
    ownership_status: OwnershipStatus.Owned,
    play_status: PlayStatus.Unplayed,
    has_media: 0,
    has_case: 1,
    has_manual: 1,
    ...overrides,
  };
}

function makeToy(overrides: Partial<Toy> = {}): Toy {
  return {
    stable_id: 100,
    id: 'mario-amiibo',
    name: 'Mario',
    line: 'amiibo',
    type: 'Figure',
    series_name: 'Super Mario',
    series_line: 'amiibo',
    release_date: '2015-03-20',
    ownership_status: OwnershipStatus.Owned,
    image_url: '',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 1,
    item_type: 'game',
    item_id: 'game-1-switch',
    purchase_date: '2024-02-10',
    is_approximate_date: 0,
    price_paid: 59.99,
    merchant: 'Best Buy',
    gifted_by: null,
    receipt_url: null,
    notes: null,
    ...overrides,
  };
}

function makePrice(
  itemType: 'game' | 'toy',
  itemId: string,
  cibCents: number | null,
  looseCents: number | null,
  nowMs: number,
  expired = false,
): EphemeralMarketPrice {
  return {
    item_type: itemType,
    item_id: itemId,
    loose_cents: looseCents,
    cib_cents: cibCents,
    new_cents: null,
    loose_sample_size: looseCents !== null ? 5 : 0,
    cib_sample_size: cibCents !== null ? 5 : 0,
    new_sample_size: 0,
    confidence: 'medium',
    source: 'ebay_browse',
    fetched_at: new Date(nowMs - 60_000).toISOString(),
    expires_at: new Date(
      expired ? nowMs - 1_000 : nowMs + 3_600_000,
    ).toISOString(),
    query_used: itemId,
    sample_listings: { loose: [], cib: [], new: [] },
  };
}

describe('provenance-analytics', () => {
  describe('parseJournalDate', () => {
    it('parses exact, month, year, approximate prefixes, and leap years while rejecting invalid dates', () => {
      expect(parseJournalDate('2024-02-29', 0)).toEqual({
        raw: '2024-02-29',
        precision: 'exact',
        isApproximate: false,
        year: 2024,
        month: 2,
        day: 29,
        quarter: 1,
        startIso: '2024-02-29',
        endIso: '2024-02-29',
        sortKey: '2024-02-29',
      });

      expect(parseJournalDate('2023-02-29', 0)).toBeNull();

      expect(parseJournalDate('2009-06', 0)).toEqual({
        raw: '2009-06',
        precision: 'month',
        isApproximate: true,
        year: 2009,
        month: 6,
        day: null,
        quarter: 2,
        startIso: '2009-06-01',
        endIso: '2009-06-30',
        sortKey: '2009-06-01',
      });

      expect(parseJournalDate('~2013', 0)).toEqual({
        raw: '2013',
        precision: 'year',
        isApproximate: true,
        year: 2013,
        month: null,
        day: null,
        quarter: null,
        startIso: '2013-01-01',
        endIso: '2013-12-31',
        sortKey: '2013-01-01',
      });

      expect(parseJournalDate('around 2018-11-15', false)?.isApproximate).toBe(
        true,
      );
      expect(parseJournalDate(null)).toBeNull();
      expect(parseJournalDate('invalid')).toBeNull();
    });
  });

  describe('lookup and compact badge formatting', () => {
    it('resolves game entries via game_id, id, or stable_id and toy entries via toy:id', () => {
      const gEntry = makeEntry({ item_id: 'canonical-zelda' });
      const tEntry = makeEntry({
        item_type: 'toy',
        item_id: 'mario-amiibo',
        merchant: null,
        gifted_by: 'Mom',
        price_paid: 0,
        purchase_date: '2016',
      });
      const map = new Map<string, JournalEntry>([
        ['game:canonical-zelda', gEntry],
        ['toy:mario-amiibo', tEntry],
      ]);

      expect(
        findGameJournalEntry(
          makeGame({ id: 'zelda-usa', game_id: 'canonical-zelda' }),
          map,
        ),
      ).toBe(gEntry);
      expect(findToyJournalEntry(makeToy(), map)).toBe(tEntry);

      const gameBadge = formatCompactProvenanceBadge(gEntry);
      expect(gameBadge).toEqual({
        text: 'Feb 2024 · $59.99 · Best Buy',
        title: 'Acquired: Feb 10, 2024 · Paid: $59.99 · Source: Best Buy',
        icon: 'book-open',
      });

      const giftBadge = formatCompactProvenanceBadge(tEntry);
      expect(giftBadge).toEqual({
        text: '~2016 · Gift (Mom)',
        title:
          'Acquired: Around 2016 · Price: Free / $0.00 · Source: Gift (Mom)',
        icon: 'gift',
      });

      expect(
        formatCompactProvenanceBadge(
          makeEntry({
            purchase_date: null,
            price_paid: null,
            merchant: null,
            gifted_by: null,
            receipt_url: 'https://example.com/receipt',
          }),
        )?.text,
      ).toBe('Receipt');

      expect(
        formatCompactProvenanceBadge(
          makeEntry({
            purchase_date: null,
            price_paid: null,
            merchant: null,
            gifted_by: null,
            receipt_url: null,
            notes: null,
          }),
        ),
      ).toBeNull();
    });
  });

  describe('matchesProvenanceFilters', () => {
    it('filters accurately across status variants, sources, years, date windows, and $0 vs null price bounds', () => {
      const recorded = makeEntry();
      const giftedFree = makeEntry({
        purchase_date: '2020',
        is_approximate_date: 1,
        price_paid: 0,
        merchant: null,
        gifted_by: 'Parents',
        receipt_url: 'https://mail.example/1',
        notes: 'Holiday gift',
      });
      const emptyEntry = makeEntry({
        purchase_date: null,
        price_paid: null,
        merchant: null,
        gifted_by: null,
        receipt_url: null,
        notes: null,
      });

      expect(
        matchesProvenanceFilters(
          recorded,
          { ownership: 1, provenance_status: 'recorded' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          null,
          { ownership: 1, provenance_status: 'missing' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          emptyEntry,
          { ownership: 1, provenance_status: 'missing' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          recorded,
          { ownership: 1, provenance_status: 'exact_date' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, provenance_status: 'approximate_date' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, provenance_status: 'gifted' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, provenance_status: 'free' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, provenance_status: 'has_receipt' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, provenance_status: 'has_notes' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          emptyEntry,
          { ownership: 1, provenance_status: 'missing_date' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          emptyEntry,
          { ownership: 1, provenance_status: 'missing_price' },
          normalize,
        ),
      ).toBe(true);

      // Source filtering (substring & exact)
      expect(
        matchesProvenanceFilters(
          recorded,
          { ownership: 1, provenance_source: 'best' },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          recorded,
          {
            ownership: 1,
            provenance_source: 'best',
            provenanceSourceExact: true,
          },
          normalize,
        ),
      ).toBe(false);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          {
            ownership: 1,
            provenance_source: 'Gift (Parents)',
            provenanceSourceExact: true,
          },
          normalize,
        ),
      ).toBe(true);

      // Year & Undated
      expect(
        matchesProvenanceFilters(
          recorded,
          { ownership: 1, acquired_year: 2024 },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          null,
          { ownership: 1, acquired_year: 'undated' },
          normalize,
        ),
      ).toBe(true);

      // Date bounds & price bounds ($0 matches min=0, null fails min=0)
      expect(
        matchesProvenanceFilters(
          recorded,
          {
            ownership: 1,
            acquired_from: '2024-01-01',
            acquired_to: '2024-03-31',
          },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          giftedFree,
          { ownership: 1, price_paid_min: 0, price_paid_max: 0 },
          normalize,
        ),
      ).toBe(true);
      expect(
        matchesProvenanceFilters(
          emptyEntry,
          { ownership: 1, price_paid_min: 0 },
          normalize,
        ),
      ).toBe(false);

      expect(
        hasActiveProvenanceFilter({ ownership: 1, price_paid_min: 0 }),
      ).toBe(true);
      expect(hasActiveProvenanceFilter({ ownership: 1 })).toBe(false);
    });
  });

  describe('computeCollectionGrowthSeries', () => {
    it('gap-fills periods, preserves cumulative baseline across 1y window, and computes matched ROI without expired comps', () => {
      const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
      const games: Game[] = [
        makeGame({
          stable_id: 1,
          id: 'g1-disc1',
          game_id: 'g1',
          platform_id: 26,
        }),
        makeGame({
          stable_id: 1,
          id: 'g1-disc2',
          game_id: 'g1',
          platform_id: 26,
        }),
        makeGame({ stable_id: 2, id: 'g2', game_id: 'g2', platform_id: 35 }),
        makeGame({
          stable_id: 3,
          id: 'g3-undated',
          game_id: 'g3',
          platform_id: 26,
        }),
      ];
      const toys: Toy[] = [makeToy({ stable_id: 10, id: 't1' })];

      const journalMap = new Map<string, JournalEntry>([
        [
          'game:g1',
          makeEntry({
            item_id: 'g1',
            purchase_date: '2024-03-10',
            price_paid: 40,
          }),
        ],
        [
          'game:g2',
          makeEntry({
            item_id: 'g2',
            purchase_date: '2026-02-15',
            price_paid: 60,
          }),
        ],
        [
          'toy:t1',
          makeEntry({
            item_type: 'toy',
            item_id: 't1',
            purchase_date: '2025',
            is_approximate_date: 1,
            price_paid: 15,
          }),
        ],
      ]);

      const marketPricesMap = new Map<string, EphemeralMarketPrice>([
        [
          getMarketPriceKey('game', 'g1'),
          makePrice('game', 'g1', 7500, 5000, nowMs),
        ],
        [
          getMarketPriceKey('game', 'g2'),
          makePrice('game', 'g2', 5000, 3000, nowMs),
        ],
        // Expired toy price should be ignored
        [
          getMarketPriceKey('toy', 't1'),
          makePrice('toy', 't1', null, 4000, nowMs, true),
        ],
      ]);

      const yearly = computeCollectionGrowthSeries({
        ownedGames: games,
        ownedToys: toys,
        journalMap,
        marketPricesMap,
        nowMs,
        canViewMarketPrices: true,
        scope: 'all_owned',
        granularity: 'year',
        range: 'all',
        includeApproximateDates: true,
        matchedOnly: false,
        referenceDate: new Date(2026, 10, 18),
      });

      expect(yearly.summary.totalOwnedInScope).toBe(4); // 3 deduped games + 1 toy
      expect(yearly.summary.datedItemCount).toBe(3);
      expect(yearly.summary.undatedItemCount).toBe(1);
      expect(yearly.summary.approximateDateCount).toBe(1);
      expect(yearly.buckets.map((b) => b.key)).toEqual([
        '2024',
        '2025',
        '2026',
      ]);

      expect(yearly.buckets[0].cumulativeItemCount).toBe(1);
      expect(yearly.buckets[0].cumulativeCostBasisCents).toBe(4000);
      expect(yearly.buckets[0].cumulativeCurrentValueCents).toBe(7500);

      expect(yearly.buckets[1].cumulativeItemCount).toBe(2);
      expect(yearly.buckets[1].cumulativeCostBasisCents).toBe(5500);
      // t1 has expired price, so cumulative matched still only covers g1 ($40 cost vs $75 value)
      expect(yearly.buckets[1].cumulativeMatchedCount).toBe(1);
      expect(yearly.buckets[1].cumulativeMatchedDeltaCents).toBe(3500);

      expect(yearly.buckets[2].cumulativeItemCount).toBe(3);
      expect(yearly.buckets[2].cumulativeCostBasisCents).toBe(11500);
      expect(yearly.buckets[2].cumulativeCurrentValueCents).toBe(12500);
      expect(yearly.buckets[2].cumulativeMatchedCount).toBe(2);
      expect(yearly.buckets[2].cumulativeMatchedCostBasisCents).toBe(10000);
      expect(yearly.buckets[2].cumulativeMatchedValueCents).toBe(12500);
      expect(yearly.buckets[2].cumulativeMatchedDeltaCents).toBe(2500);
      expect(yearly.buckets[2].cumulativeMatchedRoiPct).toBe(25);

      // 1Y window should start in late 2025 with prior cumulative baseline intact
      const oneYear = computeCollectionGrowthSeries({
        ownedGames: games,
        ownedToys: toys,
        journalMap,
        marketPricesMap,
        nowMs,
        canViewMarketPrices: true,
        scope: 'all_owned',
        granularity: 'quarter',
        range: '1y',
        includeApproximateDates: true,
        matchedOnly: false,
        referenceDate: new Date(2026, 10, 18),
      });
      expect(oneYear.buckets[0].key).toBe('2025-Q4');
      expect(oneYear.buckets[0].cumulativeItemCount).toBe(2);
      expect(oneYear.buckets[oneYear.buckets.length - 1].key).toBe('2026-Q4');
      expect(
        oneYear.buckets[oneYear.buckets.length - 1].cumulativeItemCount,
      ).toBe(3);

      // Platform scope filters strictly to platform 26 (excluding platform 35 and toys)
      const switchOnly = computeCollectionGrowthSeries({
        ownedGames: games,
        ownedToys: toys,
        journalMap,
        marketPricesMap,
        nowMs,
        canViewMarketPrices: false,
        scope: 'platform:26',
        granularity: 'auto',
        range: 'all',
        includeApproximateDates: true,
        matchedOnly: false,
      });
      expect(switchOnly.summary.totalOwnedInScope).toBe(2);
      expect(switchOnly.summary.datedItemCount).toBe(1);
      expect(switchOnly.summary.hasFreshMarketPrices).toBe(false);
      expect(switchOnly.buckets[0].cumulativeCurrentValueCents).toBeNull();
    });
  });
});
