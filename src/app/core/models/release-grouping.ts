import {
  CatalogMediaRow,
  PlayStatus,
  ReleaseMediaItem,
  RetailReleaseView,
  OwnershipStatus,
} from './collection.models';
import {
  COMPANION_DISC1_PAIRS,
  CompanionDiscPair,
  getRomGroupingKey,
  normalizeForLabelMatch,
} from './title-mappings';

const COMPANION_CANDIDATE_TITLE_RE =
  /(?:oblivion|skyrim|fallout|dishonored|dragon\s*age|borderlands|killzone|saints\s*row|mafia|outlast|modern\s*warfare|double\s*dash|metroid\s*prime|resident\s*evil|persona|gran\s*turismo|fable|splinter\s*cell|alan\s*wake|bioshock|dead\s*rising|gears\s*of\s*war|mass\s*effect|perfect\s*dark|quake|viva\s*pi)/i;

const companionPairsByPlatform = (() => {
  const map = new Map<number, CompanionDiscPair[]>();
  for (const pair of COMPANION_DISC1_PAIRS) {
    let list = map.get(pair.platformId);
    if (!list) {
      list = [];
      map.set(pair.platformId, list);
    }
    list.push(pair);
  }
  return map;
})();

const companionSupersetIds = new Set<number>(
  COMPANION_DISC1_PAIRS.map((p) => p.supersetStableId).filter(
    (id): id is number => id !== undefined,
  ),
);

/**
 * Extracts a human-readable disc/cart label (e.g. `Disc 1`, `Install Disc`, `Bonus Disc`)
 * from a catalog release filename or variant string.
 */
export function extractMediaLabel(
  romName: string,
  index: number,
  fallbackVariants?: string | null,
): string {
  const matches: string[] = [];
  const regex =
    /\(((?:disc|disco|disque|disk)\s+[0-9a-z]+|install\s+disc|play\s+disc|data\s+disc|bonus\s+disc|game\s+disc|add-on[^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(romName || '')) !== null) {
    if (m[1]) {
      matches.push(m[1].trim());
    }
  }
  if (matches.length > 0) {
    return matches.join(' · ');
  }
  if (
    fallbackVariants &&
    /disc|disk|install|play|bonus/i.test(fallbackVariants)
  ) {
    return fallbackVariants.trim();
  }
  return `Disc ${index + 1}`;
}

function isPackInCompanionDemo(row: CatalogMediaRow): boolean {
  if (!row.rom_name) return false;
  return (
    (row.platform_id === 29 &&
      /^mega man legends 2.*\(demo\)/i.test(row.rom_name)) ||
    (row.platform_id === 30 &&
      /^metal gear solid 2 - sons of liberty - trial edition.*\(demo\)/i.test(
        row.rom_name,
      )) ||
    (row.platform_id === 30 &&
      /^final fantasy xii\s*\(usa\)\s*\(demo\)/i.test(row.rom_name))
  );
}

/**
 * Groups flat 1-row-per-media catalog rows into virtual Retail Release (SKU) view models
 * with a unified `mediaItems` list, folding pack-in demos and pairing GOTY/expanded
 * companion Disc 1 releases when applicable.
 */
export function groupCatalogMediaIntoReleases(
  rows: readonly CatalogMediaRow[],
): RetailReleaseView[] {
  const groupedMap = new Map<string, RetailReleaseView>();

  for (const g of rows) {
    const romKey = getRomGroupingKey(g.rom_name);
    let baseKey = romKey.startsWith('multi:')
      ? `${g.game_id || g.id}_${romKey}`
      : `${g.game_id || g.id}_${g.region || ''}_${g.variants || ''}_${g.canonical_release_id || ''}_${romKey}`;

    if (isPackInCompanionDemo(g)) {
      // Pack-in companion bonus discs merge into the host game's primary SKU group.
      const hostEntry = Array.from(groupedMap.entries()).find(
        ([k, val]) =>
          (val.game_id === g.game_id || val.stable_id === g.stable_id) &&
          val.region === g.region &&
          !k.includes('_Demo_') &&
          !k.includes('_demo_'),
      );
      baseKey = hostEntry
        ? hostEntry[0]
        : `${g.game_id || g.id}_${g.region || ''}_primary`;
    }

    const mediaItem: ReleaseMediaItem = {
      id: g.id,
      label: extractMediaLabel(
        g.rom_name || '',
        groupedMap.get(baseKey)?.mediaItems.length ?? 0,
        g.variants,
      ),
      hasMedia: g.has_media ? 1 : 0,
      romName: g.rom_name ?? null,
      romCrc: g.rom_crc ?? null,
    };

    const existing = groupedMap.get(baseKey);
    if (!existing) {
      groupedMap.set(baseKey, {
        ...g,
        mediaItems: [mediaItem],
      });
    } else {
      existing.mediaItems.push(mediaItem);
      existing.ownership_status = Math.max(
        existing.ownership_status,
        g.ownership_status,
      ) as OwnershipStatus;
      existing.play_status = Math.max(
        existing.play_status,
        g.play_status,
      ) as PlayStatus;
      if (g.also_released_as) {
        const merged = new Set(
          [
            ...(existing.also_released_as || '').split(','),
            ...g.also_released_as.split(','),
          ]
            .map((s) => s.trim())
            .filter(Boolean),
        );
        existing.also_released_as = Array.from(merged).join(', ');
      }
    }
  }

  // Pre-index candidate rows only for platforms with configured companion disc pairs
  const allRowsByPlatform = new Map<number, CatalogMediaRow[]>();
  for (const row of rows) {
    if (
      row.platform_id != null &&
      companionPairsByPlatform.has(row.platform_id)
    ) {
      let pList = allRowsByPlatform.get(row.platform_id);
      if (!pList) {
        pList = [];
        allRowsByPlatform.set(row.platform_id, pList);
      }
      pList.push(row);
    }
  }

  const groupedList = Array.from(groupedMap.values());
  for (const g of groupedList) {
    const mediaItems = [...g.mediaItems];
    const platPairs =
      g.platform_id != null
        ? companionPairsByPlatform.get(g.platform_id)
        : undefined;

    if (
      platPairs &&
      (companionSupersetIds.has(g.stable_id) ||
        COMPANION_CANDIDATE_TITLE_RE.test(g.title || '') ||
        COMPANION_CANDIDATE_TITLE_RE.test(g.rom_name || ''))
    ) {
      // If a 2-disc GOTY/expanded SKU only catalogs Disc 2 (reusing the standalone release as Disc 1),
      // prepend the companion Base Release Disc 1 item so every field stays 1-to-1 aligned.
      const hasDisc1InGroup = mediaItems.some((m) =>
        /\((?:disc|disco|disque|disk)\s+1\b/i.test(m.romName || ''),
      );
      if (!hasDisc1InGroup) {
        const romLower = (g.rom_name || '').toLowerCase();
        const normRom = normalizeForLabelMatch(g.rom_name || g.title || '');
        const normTitle = normalizeForLabelMatch(g.title || '');
        const regTokens = (g.region || '')
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        for (const pair of platPairs) {
          const isSupersetMatch =
            (!pair.supersetRomMarker ||
              romLower.includes(pair.supersetRomMarker)) &&
            ((pair.supersetStableId !== undefined &&
              pair.supersetStableId === g.stable_id) ||
              normRom === pair.supersetNormalizedTitle ||
              normTitle === pair.supersetNormalizedTitle) &&
            !pair.excludedRegions?.some((ex) => regTokens.includes(ex));
          if (!isSupersetMatch) continue;

          const platformCandidates =
            allRowsByPlatform.get(pair.platformId) || [];
          const companionCandidates = platformCandidates.filter((cand) => {
            if (cand.id === g.id) return false;
            const candRomLower = (cand.rom_name || '').toLowerCase();
            if (
              pair.supersetRomMarker &&
              candRomLower.includes(pair.supersetRomMarker)
            ) {
              return false;
            }
            if (
              pair.originalExcludeMarker &&
              candRomLower.includes(pair.originalExcludeMarker)
            ) {
              return false;
            }
            const candNorm = normalizeForLabelMatch(
              cand.rom_name || cand.title || '',
            );
            if (
              cand.stable_id !== pair.originalStableId &&
              candNorm !== pair.originalNormalizedTitle
            ) {
              return false;
            }
            const candRegs = (cand.region || '')
              .toLowerCase()
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            if (regTokens.includes('world') || candRegs.includes('world')) {
              return true;
            }
            return regTokens.some((r) => candRegs.includes(r));
          });

          if (companionCandidates.length > 0) {
            const companionPreferred =
              companionCandidates.find((c) => Boolean(c.has_media)) ??
              companionCandidates[0];
            const companionHasMedia: 0 | 1 = companionCandidates.some((c) =>
              Boolean(c.has_media),
            )
              ? 1
              : 0;
            mediaItems.unshift({
              id: companionPreferred.id,
              label: 'Disc 1 (Base Release)',
              hasMedia: companionHasMedia,
              romName: companionPreferred.rom_name ?? null,
              romCrc: companionPreferred.rom_crc ?? null,
              isCompanionBase: true,
            });
          }
          break;
        }
      }
    }

    // Release SKU is considered media-complete when all its physical media items are owned.
    g.mediaItems = mediaItems;
    g.has_media = mediaItems.every((m) => m.hasMedia === 1) ? 1 : 0;
  }

  return groupedList;
}

/**
 * Deduplicates flat catalog/release rows down to one representative row per distinct Platform Game
 * (`game_id || stable_id || id`) for collection-wide game counts and condition analytics.
 */
export function deduplicateOwnedPlatformGames(
  rows: readonly CatalogMediaRow[],
): CatalogMediaRow[] {
  const seen = new Set<string | number>();
  const distinct: CatalogMediaRow[] = [];
  for (const g of rows) {
    const key = g.game_id || g.stable_id || g.id;
    if (!seen.has(key)) {
      seen.add(key);
      distinct.push(g);
    }
  }
  return distinct;
}
