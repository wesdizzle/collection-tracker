/**
 * CENTRALIZED IGDB <-> TRACKER PLATFORM COMPATIBILITY LAYER
 *
 * PlayStation VR (`165`) and PlayStation VR2 (`390`) are tracked on IGDB as
 * standalone platform IDs, whereas physical catalog sources and user tracking
 * consolidate them under PlayStation 4 (`34`) and PlayStation 5 (`35`).
 *
 * Outbound IGDB queries expand `34 -> [48, 165]` and `35 -> [167, 390]`, and
 * inbound IGDB responses fold `165 -> 34` and `390 -> 35`.
 */

/** Retired child VR platform IDs mapped to their canonical base tracker platform IDs. */
export const LEGACY_PLATFORM_CONSOLIDATION: Record<number, number> = {
  51: 34, // PlayStation VR -> PlayStation 4
  52: 35, // PlayStation VR2 -> PlayStation 5
};

/** Maps IGDB platform IDs to Collection Tracker base platform IDs. */
export const IGDB_PLATFORM_TO_TRACKER_PLATFORM: Record<number, number> = {
  48: 34, // PlayStation 4
  165: 34, // PlayStation VR -> PlayStation 4
  167: 35, // PlayStation 5
  390: 35, // PlayStation VR2 -> PlayStation 5
};

/** Companion IGDB platform IDs queried together for a unified tracker platform. */
export const TRACKER_PLATFORM_TO_IGDB_QUERY_IDS: Record<
  number,
  readonly number[]
> = {
  34: [48, 165], // PS4 + PSVR
  35: [167, 390], // PS5 + PSVR2
};

/** Alias IGDB platform IDs (`[aliasId, primaryIgdbId]`) merged onto a shared local platform. */
export const IGDB_PLATFORM_ALIAS_PAIRS: ReadonlyArray<
  readonly [aliasIgdbId: number, primaryIgdbId: number]
> = [
  [99, 18], // Family Computer -> NES
  [58, 19], // Super Famicom -> SNES
  [165, 48], // PlayStation VR -> PS4
  [390, 167], // PlayStation VR2 -> PS5
];

/**
 * Normalizes retired PSVR (`51`) and PSVR2 (`52`) tracker platform IDs onto PS4 (`34`) and PS5 (`35`).
 */
export function normalizeLegacyPlatformId(platformId: number): number {
  return LEGACY_PLATFORM_CONSOLIDATION[platformId] ?? platformId;
}

/**
 * Returns the companion IGDB platform IDs paired with `igdbPlatformId`
 * (NES/Famicom, SNES/Super Famicom, PS4/PSVR, PS5/PSVR2).
 */
export function getIgdbCompanionPlatformIds(igdbPlatformId: number): number[] {
  switch (igdbPlatformId) {
    case 18:
      return [18, 99];
    case 99:
      return [99, 18];
    case 19:
      return [19, 58];
    case 58:
      return [58, 19];
    case 48:
      return [48, 165];
    case 165:
      return [165, 48];
    case 167:
      return [167, 390];
    case 390:
      return [390, 167];
    default:
      return [igdbPlatformId];
  }
}

/**
 * Returns outbound IGDB platform IDs to query for a Collection Tracker `trackerPlatformId`,
 * expanding PS4 (`34`) -> `[48, 165]` and PS5 (`35`) -> `[167, 390]`.
 */
export function getIgdbQueryPlatformIds(
  trackerPlatformId: number,
  defaultIgdbId?: number | null,
): number[] {
  const normalizedId = normalizeLegacyPlatformId(trackerPlatformId);
  const mapped = TRACKER_PLATFORM_TO_IGDB_QUERY_IDS[normalizedId];
  if (mapped) {
    return [...mapped];
  }
  if (
    typeof defaultIgdbId === 'number' &&
    Number.isFinite(defaultIgdbId) &&
    defaultIgdbId > 0
  ) {
    return getIgdbCompanionPlatformIds(defaultIgdbId);
  }
  return [];
}

/**
 * Resolves an incoming IGDB platform ID onto a Collection Tracker base platform ID,
 * folding IGDB PSVR (`165`) -> PS4 (`34`) and PSVR2 (`390`) -> PS5 (`35`).
 */
export function mapIgdbPlatformIdToTrackerPlatformId(
  igdbId: number,
  fallbackTrackerId?: number | null,
): number | null {
  if (IGDB_PLATFORM_TO_TRACKER_PLATFORM[igdbId] !== undefined) {
    return IGDB_PLATFORM_TO_TRACKER_PLATFORM[igdbId];
  }
  if (
    typeof fallbackTrackerId === 'number' &&
    Number.isFinite(fallbackTrackerId)
  ) {
    return normalizeLegacyPlatformId(fallbackTrackerId);
  }
  return null;
}

/**
 * Registers secondary/VR IGDB platform aliases (Famicom, Super Famicom, PSVR, PSVR2)
 * onto an `igdbId -> platform` lookup map without creating separate tracker platforms.
 */
export function registerIgdbAliasPlatforms<T>(byIgdbId: Map<number, T>): void {
  for (const [aliasIgdbId, primaryIgdbId] of IGDB_PLATFORM_ALIAS_PAIRS) {
    const primary = byIgdbId.get(primaryIgdbId);
    if (primary && !byIgdbId.has(aliasIgdbId)) {
      byIgdbId.set(aliasIgdbId, primary);
    }
  }
}
