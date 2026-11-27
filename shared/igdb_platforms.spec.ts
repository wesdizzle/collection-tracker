import { describe, expect, it } from 'vitest';
import {
  getHardwareRevisionSiblingPlatformId,
  getIgdbCompanionPlatformIds,
  getIgdbQueryPlatformIds,
  HARDWARE_REVISION_SIBLING_MAP,
  IGDB_PLATFORM_TO_TRACKER_PLATFORM,
  LEGACY_PLATFORM_CONSOLIDATION,
  mapIgdbPlatformIdToTrackerPlatformId,
  normalizeLegacyPlatformId,
  registerIgdbAliasPlatforms,
  TRACKER_PLATFORM_TO_IGDB_QUERY_IDS,
} from './igdb_platforms.js';

describe('igdb_platforms compatibility layer', () => {
  it('consolidates retired PSVR/PSVR2 IDs onto PS4 and PS5', () => {
    expect(LEGACY_PLATFORM_CONSOLIDATION).toEqual({ 51: 34, 52: 35 });
    expect(normalizeLegacyPlatformId(51)).toBe(34);
    expect(normalizeLegacyPlatformId(52)).toBe(35);
    expect(normalizeLegacyPlatformId(53)).toBe(53); // Famicom remains intact
    expect(normalizeLegacyPlatformId(34)).toBe(34);
    expect(HARDWARE_REVISION_SIBLING_MAP).toEqual({
      23: 25,
      25: 23,
      14: 18,
      18: 14,
    });
    expect(getHardwareRevisionSiblingPlatformId(23)).toBe(25);
    expect(getHardwareRevisionSiblingPlatformId(25)).toBe(23);
    expect(getHardwareRevisionSiblingPlatformId(14)).toBe(18);
    expect(getHardwareRevisionSiblingPlatformId(26)).toBeNull();
  });

  it('expands outbound IGDB queries for PS4/PS5, Jaguar/CD, Neo Geo AES/MVS/X, and New 3DS', () => {
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[6]).toEqual([62, 410]);
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[9]).toEqual([80, 79]);
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[12]).toEqual([377, 80, 79]);
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[25]).toEqual([137, 37]);
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[34]).toEqual([48, 165]);
    expect(TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[35]).toEqual([167, 390]);
    expect(getIgdbQueryPlatformIds(6, 62)).toEqual([62, 410]);
    expect(getIgdbQueryPlatformIds(9, 80)).toEqual([80, 79]);
    expect(getIgdbQueryPlatformIds(12, 377)).toEqual([377, 80, 79]);
    expect(getIgdbQueryPlatformIds(25, 137)).toEqual([137, 37]);
    expect(getIgdbQueryPlatformIds(23, 37)).toEqual([37]);
    expect(getIgdbQueryPlatformIds(34)).toEqual([48, 165]);
    expect(getIgdbQueryPlatformIds(51)).toEqual([48, 165]);
    expect(getIgdbQueryPlatformIds(35)).toEqual([167, 390]);
    expect(getIgdbQueryPlatformIds(52)).toEqual([167, 390]);
    expect(getIgdbQueryPlatformIds(13, 18)).toEqual([18, 99]);
    expect(getIgdbQueryPlatformIds(26, 130)).toEqual([130]);
    expect(getIgdbQueryPlatformIds(26)).toEqual([]);
  });

  it('maps inbound IGDB VR platform IDs back to PS4 and PS5 and registers aliases', () => {
    expect(IGDB_PLATFORM_TO_TRACKER_PLATFORM[165]).toBe(34);
    expect(IGDB_PLATFORM_TO_TRACKER_PLATFORM[390]).toBe(35);
    expect(mapIgdbPlatformIdToTrackerPlatformId(165)).toBe(34);
    expect(mapIgdbPlatformIdToTrackerPlatformId(390)).toBe(35);
    expect(mapIgdbPlatformIdToTrackerPlatformId(130, 26)).toBe(26);
    expect(mapIgdbPlatformIdToTrackerPlatformId(130, 51)).toBe(34);
    expect(mapIgdbPlatformIdToTrackerPlatformId(999)).toBeNull();

    expect(getIgdbCompanionPlatformIds(48)).toEqual([48, 165]);
    expect(getIgdbCompanionPlatformIds(165)).toEqual([165, 48]);
    expect(getIgdbCompanionPlatformIds(167)).toEqual([167, 390]);
    expect(getIgdbCompanionPlatformIds(390)).toEqual([390, 167]);

    const byIgdbId = new Map<number, { id: number; name: string }>([
      [18, { id: 13, name: 'NES' }],
      [19, { id: 15, name: 'SNES' }],
      [48, { id: 34, name: 'PS4' }],
      [167, { id: 35, name: 'PS5' }],
    ]);
    registerIgdbAliasPlatforms(byIgdbId);
    expect(byIgdbId.get(99)?.id).toBe(13);
    expect(byIgdbId.get(58)?.id).toBe(15);
    expect(byIgdbId.get(165)?.id).toBe(34);
    expect(byIgdbId.get(390)?.id).toBe(35);
  });
});
