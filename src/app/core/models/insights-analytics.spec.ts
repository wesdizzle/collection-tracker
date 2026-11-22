import { describe, it, expect } from 'vitest';
import {
  EBAY_PRICE_TTL_MS,
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  OwnershipStatus,
  Platform,
  PlayStatus,
  Toy,
} from './collection.models';
import {
  computePhysicalMediaStats,
  computeScopedJournalSummary,
  computeScopedValuation,
  computeToyLineStats,
} from './insights-analytics';

describe('insights-analytics', () => {
  const nowMs = Date.UTC(2026, 10, 19, 12, 0, 0);

  function makePrice(
    itemType: 'game' | 'toy',
    itemId: string,
    looseCents: number | null,
    cibCents: number | null,
    expired = false,
  ): EphemeralMarketPrice {
    const fetchedMs = nowMs - (expired ? EBAY_PRICE_TTL_MS + 60_000 : 300_000);
    return {
      item_type: itemType,
      item_id: itemId,
      loose_cents: looseCents,
      cib_cents: cibCents,
      new_cents: null,
      loose_sample_size: looseCents ? 4 : 0,
      cib_sample_size: cibCents ? 4 : 0,
      new_sample_size: 0,
      confidence: 'medium',
      source: 'ebay_browse',
      fetched_at: new Date(fetchedMs).toISOString(),
      expires_at: new Date(fetchedMs + EBAY_PRICE_TTL_MS).toISOString(),
      query_used: itemId,
      sample_listings: { loose: [], cib: [], new: [] },
    };
  }

  const platforms: Platform[] = [
    {
      id: 1,
      name: 'SNES',
      display_name: 'Super Nintendo',
      brand: 'Nintendo',
      launch_date: '1991-08-23',
      image_url: '',
    },
    {
      id: 2,
      name: 'PS1',
      display_name: 'PlayStation',
      brand: 'Sony',
      launch_date: '1995-09-09',
      image_url: '',
    },
  ];

  const ownedGames: Game[] = [
    {
      stable_id: 1,
      id: 'ct-snes',
      game_id: 'ct-snes',
      title: 'Chrono Trigger',
      series: 'Chrono',
      canonical_series: 'Chrono',
      platform: 'SNES',
      platform_id: 1,
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      has_media: 1,
      has_case: 1,
      has_manual: 1,
    },
    {
      stable_id: 2,
      id: 'ff7-ps1',
      game_id: 'ff7-ps1',
      title: 'Final Fantasy VII',
      series: 'Final Fantasy',
      canonical_series: 'Final Fantasy',
      platform: 'PS1',
      platform_id: 2,
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Playing,
      has_media: 0,
      has_case: 1,
      has_manual: 0,
    },
  ];

  const ownedToys: Toy[] = [
    {
      stable_id: 101,
      id: 'mario-amiibo',
      name: 'Mario',
      line: 'amiibo',
      type: 'Figure',
      series_name: 'Super Mario',
      series_line: 'Super Mario',
      release_date: '2015-03-20',
      ownership_status: OwnershipStatus.Owned,
      image_url: '',
    },
  ];

  const journalMap = new Map<string, JournalEntry>([
    [
      'game:ct-snes',
      {
        id: 1,
        item_type: 'game',
        item_id: 'ct-snes',
        purchase_date: '2021-06-01',
        price_paid: 150,
        merchant: 'eBay',
      },
    ],
    [
      'toy:mario-amiibo',
      {
        id: 2,
        item_type: 'toy',
        item_id: 'mario-amiibo',
        purchase_date: null,
        price_paid: 15,
        merchant: 'Best Buy',
      },
    ],
  ]);

  const marketPricesMap = new Map<string, EphemeralMarketPrice>([
    ['game:ct-snes', makePrice('game', 'ct-snes', 18000, 35000)],
    ['toy:mario-amiibo', makePrice('toy', 'mario-amiibo', 2500, null)],
  ]);

  it('computes scoped valuation, matched ROI, topCostBasis fallback, and scoped journal summary consistently', () => {
    const allVal = computeScopedValuation({
      ownedGames,
      ownedToys,
      platforms,
      journalMap,
      marketPricesMap,
      nowMs,
      scope: 'all_owned',
      canViewMarketPrices: true,
    });

    expect(allVal.totalOwnedCount).toBe(3);
    expect(allVal.pricedCount).toBe(2);
    expect(allVal.totalEstimatedCents).toBe(37500);
    expect(allVal.matchedCount).toBe(2);
    expect(allVal.matchedCostBasisCents).toBe(16500);
    expect(allVal.unrealizedDeltaCents).toBe(21000);
    expect(allVal.topValuable.map((e) => e.routeId)).toEqual([
      '1',
      'mario-amiibo',
    ]);
    expect(allVal.topCostBasis.map((e) => e.routeId)).toEqual([
      '1',
      'mario-amiibo',
    ]);

    const snesVal = computeScopedValuation({
      ownedGames,
      ownedToys,
      platforms,
      journalMap,
      marketPricesMap,
      nowMs,
      scope: 'platform:1',
      canViewMarketPrices: false,
    });
    expect(snesVal.totalOwnedCount).toBe(1);
    expect(snesVal.pricedCount).toBe(0);
    expect(snesVal.topCostBasis[0].pricePaidCents).toBe(15000);

    const snesJournal = computeScopedJournalSummary({
      ownedGames,
      ownedToys,
      journalMap,
      scope: 'platform:1',
    });
    expect(snesJournal.totalOwnedCount).toBe(1);
    expect(snesJournal.recordedCount).toBe(1);
    expect(snesJournal.totalTrackedSpendDollars).toBe(150);
    expect(snesJournal.datedCount).toBe(1);
    expect(snesJournal.undatedCount).toBe(0);

    const allJournal = computeScopedJournalSummary({
      ownedGames,
      ownedToys,
      journalMap,
      scope: 'all_owned',
    });
    expect(allJournal.totalOwnedCount).toBe(3);
    expect(allJournal.recordedCount).toBe(2);
    expect(allJournal.missingCount).toBe(1);
    expect(allJournal.undatedCount).toBe(2);
    expect(allJournal.totalTrackedSpendDollars).toBe(165);
    expect(allJournal.averagePricePaidDollars).toBe(82.5);
  });

  it('computes toy line and nested series completion stats', () => {
    const toys: Toy[] = [
      ...ownedToys,
      {
        stable_id: 102,
        id: 'luigi-amiibo',
        name: 'Luigi',
        line: 'amiibo',
        type: 'Figure',
        series_name: 'Super Mario',
        series_line: 'Super Mario',
        release_date: '2015-03-20',
        ownership_status: OwnershipStatus.Unowned,
        image_url: '',
      },
      {
        stable_id: 103,
        id: 'link-amiibo',
        name: 'Link',
        line: 'amiibo',
        type: 'Figure',
        series_name: 'Legend of Zelda',
        series_line: 'Legend of Zelda',
        release_date: '2017-03-03',
        ownership_status: OwnershipStatus.Owned,
        image_url: '',
      },
      {
        stable_id: 104,
        id: 'spyro-skylander',
        name: 'Spyro',
        line: 'Skylanders',
        type: 'Figure',
        series_name: 'Spyro Adventure',
        series_line: 'Spyro Adventure',
        release_date: '2011-10-16',
        ownership_status: OwnershipStatus.Unowned,
        image_url: '',
      },
    ];

    const stats = computeToyLineStats(toys);
    expect(stats.length).toBe(2);
    expect(stats[0].name).toBe('amiibo');
    expect(stats[0].ownedCount).toBe(2);
    expect(stats[0].catalogCount).toBe(3);
    expect(stats[0].completionPct).toBe(67);
    expect(stats[0].topSeries.length).toBe(2);
    expect(stats[1].name).toBe('Skylanders');
    expect(stats[1].ownedCount).toBe(0);
    expect(stats[1].catalogCount).toBe(1);
  });

  it('computes physical media ownership stats across multi-disc releases excluding unowned games', () => {
    const games: Game[] = [
      ...ownedGames,
      {
        stable_id: 3,
        id: 'ff7-ps1-disc2',
        game_id: 'ff7-ps1',
        title: 'Final Fantasy VII (Disc 2)',
        series: 'Final Fantasy',
        canonical_series: 'Final Fantasy',
        platform: 'PS1',
        platform_id: 2,
        ownership_status: OwnershipStatus.Owned,
        play_status: PlayStatus.Playing,
        has_media: 1,
      },
      {
        stable_id: 4,
        id: 'seeking-ps1',
        game_id: 'seeking-ps1',
        title: 'Unowned PS1 Game',
        series: 'Misc',
        canonical_series: 'Misc',
        platform: 'PS1',
        platform_id: 2,
        ownership_status: OwnershipStatus.Seeking,
        play_status: PlayStatus.Unplayed,
        has_media: 0,
      },
    ];

    const mediaSummary = computePhysicalMediaStats(games, platforms);
    expect(mediaSummary.physicalCount).toBe(3);
    expect(mediaSummary.ownedMediaCount).toBe(2);
    expect(mediaSummary.missingCount).toBe(1);
    expect(mediaSummary.mediaOwnedRatePct).toBe(67);
    expect(mediaSummary.platformBreakdown[0].id).toBe(2);
    expect(mediaSummary.platformBreakdown[0].missingCount).toBe(1);
    expect(mediaSummary.platformBreakdown[0].physicalCount).toBe(2);
  });
});
