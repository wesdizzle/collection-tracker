/**
 * SHARED TOY-GAME COMPATIBILITY ENGINE
 *
 * Pure isomorphic compatibility resolvers for:
 * - amiibo (via AmiiboAPI `?showusage` across 3DS, New 3DS, Wii U, Switch, Switch 2,
 *   including multi-pose expansions and Skylanders Bowser/DK amiibo hybrids)
 * - Skylanders (debut generation forward + repose/LightCore/Elite backwards, Sidekicks/Minis,
 *   Nintendo-exclusive SuperChargers, Traps, Vehicles, Trophies, Creation Crystals, Senseis)
 * - Starlink: Battle for Atlas (Fox McCloud / Arwing limited to Switch; all other toys multiplatform)
 */

export interface ToyCompatibilityToyInput {
  stable_id: number;
  id: string;
  name: string;
  line: string;
  series?: string | null;
  type?: string | null;
  amiibo_id?: string | null;
  metadata_json?: string | null;
}

export interface ToyCompatibilityGameInput {
  stable_id: number;
  title: string;
  platform_id: number;
}

export interface AmiiboUsageEntry {
  Usage?: string;
  write?: boolean;
}

export interface AmiiboUsageGameRef {
  gameName?: string;
  gameID?: string[];
  amiiboUsage?: AmiiboUsageEntry[];
}

export interface AmiiboApiUsageItem {
  head: string;
  tail: string;
  name: string;
  amiiboSeries?: string;
  gameSeries?: string;
  type?: string;
  games3DS?: AmiiboUsageGameRef[];
  gamesWiiU?: AmiiboUsageGameRef[];
  gamesSwitch?: AmiiboUsageGameRef[];
  gamesSwitch2?: AmiiboUsageGameRef[];
}

export interface ToyGameCompatibilityRow {
  toy_stable_id: number;
  game_stable_id: number;
  can_read: 0 | 1;
  can_write: 0 | 1;
  description: string | null;
}

export const AMIIBO_CONSOLE_PLATFORMS: Record<
  'games3DS' | 'gamesWiiU' | 'gamesSwitch' | 'gamesSwitch2',
  readonly number[]
> = {
  games3DS: [23, 25], // Nintendo 3DS & New Nintendo 3DS
  gamesWiiU: [24], // Wii U
  gamesSwitch: [26], // Nintendo Switch
  gamesSwitch2: [27], // Nintendo Switch 2
};

/**
 * Physical catalog aliases where AmiiboAPI lists a sub-game, Japanese title,
 * or upgraded Switch 2 title under a different string than the physical SKU in `games`.
 */
export const AMIIBO_GAME_TITLE_ALIASES: Record<string, string[]> = {
  'games3DS::azurestrikergunvolt2': [
    'azurestrikergunvoltstrikerpack',
    'armedbluegunvoltstrikerpack',
  ],
  'games3DS::byebyeboxboy': ['hakoboyhakozumebox'],
  'games3DS::fireemblemfates': [
    'fireemblemfatesbirthright',
    'fireemblemfatesconquest',
    'fireemblemfatesspecialedition',
  ],
  'games3DS::metroidprimeblastball': ['metroidprimefederationforce'],
  'games3DS::yoshiswoollyworld': [
    'poochyyoshiswoollyworld',
    'poochywayoshiwoollyworld',
  ],
  'gamesWiiU::taikodrumasteratsumetetomodachidaisakusen': [
    'taikonotatsujinatsumetetomodachidaisakusen',
  ],
  'gamesWiiU::taikodrumasteratsumetotomodachidaisakusen': [
    'taikonotatsujinatsumetetomodachidaisakusen',
  ],
  'gamesSwitch::residentevilrevelations2': [
    'residentevilrevelationscollection',
    'biohazardrevelationscollection',
  ],
  'gamesSwitch::shovelknight': ['shovelknighttreasuretrove'],
  'gamesSwitch::shovelknightshowdown': ['shovelknighttreasuretrove'],
  'gamesSwitch::supermariogalaxy': ['supermariogalaxysupermariogalaxy2'],
  'gamesSwitch::supermariogalaxy2': ['supermariogalaxysupermariogalaxy2'],
  'gamesSwitch2::metroidprime4beyondnintendoswitch2edition': [
    'metroidprime4beyond',
  ],
  'gamesSwitch2::streetfighter6': [
    'streetfighter6years122fightersedition',
    'streetfighter6years12fightersedition',
  ],
};

/**
 * Maps Nintendo Skylanders/amiibo hybrid `amiibo_id` values (`head + tail`)
 * to the corresponding Skylander figure names (regular & Dark variants) stored under `line='Skylanders'`.
 */
export const AMIIBO_HYBRID_SKYLANDER_NAMES: Record<string, string[]> = {
  '0005ff00023a0702': ['hammer slam bowser', 'dark hammer slam bowser'],
  '0008ff00023b0702': [
    'turbo charge donkey kong',
    'dark turbo charge donkey kong',
  ],
};

export function normalizeCompatTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function mergeCompatibilityRow(
  map: Map<string, ToyGameCompatibilityRow>,
  row: ToyGameCompatibilityRow,
): void {
  const key = `${row.toy_stable_id}:${row.game_stable_id}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row });
    return;
  }
  const mergedRead: 0 | 1 = existing.can_read || row.can_read ? 1 : 0;
  const mergedWrite: 0 | 1 = existing.can_write || row.can_write ? 1 : 0;
  const descParts = [existing.description, row.description]
    .filter((d): d is string => Boolean(d && d.trim()))
    .flatMap((d) => d.split(' | '))
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueDesc = Array.from(new Set(descParts));
  existing.can_read = mergedRead;
  existing.can_write = mergedWrite;
  existing.description =
    uniqueDesc.length > 0 ? uniqueDesc.join(' | ').slice(0, 600) : null;
}

/**
 * Builds deduplicated `toy_game_compatibility` rows from AmiiboAPI `?showusage` records,
 * matching strictly within each Nintendo console family (`3DS/New 3DS`, `Wii U`, `Switch`, `Switch 2`),
 * expanding multi-pose amiibo, and attaching Bowser/DK Skylanders-amiibo hybrids.
 */
export function buildAmiiboCompatibilityEntries(
  amiiboApiItems: AmiiboApiUsageItem[],
  toys: ToyCompatibilityToyInput[],
  games: ToyCompatibilityGameInput[],
): ToyGameCompatibilityRow[] {
  const gamesByPlatNorm = new Map<number, Map<string, number[]>>();
  for (const g of games) {
    if (![23, 24, 25, 26, 27].includes(g.platform_id)) continue;
    const norm = normalizeCompatTitle(g.title);
    if (!norm) continue;
    let platMap = gamesByPlatNorm.get(g.platform_id);
    if (!platMap) {
      platMap = new Map();
      gamesByPlatNorm.set(g.platform_id, platMap);
    }
    const list = platMap.get(norm) || [];
    list.push(g.stable_id);
    platMap.set(norm, list);
  }

  const toysByAmiiboId = new Map<string, number[]>();
  const skylanderByNameLower = new Map<string, ToyCompatibilityToyInput>();
  for (const t of toys) {
    if (t.line === 'amiibo' && t.amiibo_id) {
      const aid = t.amiibo_id.trim().toLowerCase();
      const list = toysByAmiiboId.get(aid) || [];
      list.push(t.stable_id);
      toysByAmiiboId.set(aid, list);
    } else if (t.line === 'Skylanders') {
      skylanderByNameLower.set(t.name.trim().toLowerCase(), t);
    }
  }

  const hybridTargetsByAmiiboId = new Map<string, number[]>();
  for (const [aid, names] of Object.entries(AMIIBO_HYBRID_SKYLANDER_NAMES)) {
    const matchedIds = names
      .map((n) => skylanderByNameLower.get(n)?.stable_id)
      .filter((sid): sid is number => typeof sid === 'number');
    if (matchedIds.length > 0) {
      hybridTargetsByAmiiboId.set(aid, matchedIds);
    }
  }

  const resultMap = new Map<string, ToyGameCompatibilityRow>();

  for (const item of amiiboApiItems) {
    const aid = `${item.head || ''}${item.tail || ''}`.trim().toLowerCase();
    if (!aid) continue;

    const amiiboToyIds = toysByAmiiboId.get(aid) || [];
    const hybridToyIds = hybridTargetsByAmiiboId.get(aid) || [];
    if (amiiboToyIds.length === 0 && hybridToyIds.length === 0) continue;

    const targetToys: Array<{ stableId: number; isHybrid: boolean }> = [
      ...amiiboToyIds.map((sid) => ({ stableId: sid, isHybrid: false })),
      ...hybridToyIds.map((sid) => ({ stableId: sid, isHybrid: true })),
    ];

    const consoleKeys = [
      'games3DS',
      'gamesWiiU',
      'gamesSwitch',
      'gamesSwitch2',
    ] as const;

    for (const key of consoleKeys) {
      const platformIds = AMIIBO_CONSOLE_PLATFORMS[key];
      const refs = item[key];
      if (!Array.isArray(refs) || refs.length === 0) continue;

      for (const ref of refs) {
        const gameName = (ref.gameName || '').trim();
        if (!gameName) continue;
        const norm = normalizeCompatTitle(gameName);
        if (!norm) continue;

        const candidateNorms = AMIIBO_GAME_TITLE_ALIASES[`${key}::${norm}`] || [
          norm,
        ];
        const matchedGameStableIds = new Set<number>();
        for (const pid of platformIds) {
          const platMap = gamesByPlatNorm.get(pid);
          if (!platMap) continue;
          for (const candNorm of candidateNorms) {
            const ids = platMap.get(candNorm);
            if (ids) {
              for (const gid of ids) matchedGameStableIds.add(gid);
            }
          }
        }
        if (matchedGameStableIds.size === 0) continue;

        const usages = Array.isArray(ref.amiiboUsage) ? ref.amiiboUsage : [];
        let canWrite: 0 | 1 = 0;
        const usageTexts: string[] = [];
        for (const u of usages) {
          if (u.write) canWrite = 1;
          const txt = (u.Usage || '').trim();
          if (txt && !usageTexts.includes(txt)) {
            usageTexts.push(txt);
          }
        }
        const rawDesc =
          usageTexts.length > 0 ? usageTexts.join(' | ').slice(0, 560) : null;

        for (const gid of matchedGameStableIds) {
          for (const tt of targetToys) {
            const description =
              tt.isHybrid && rawDesc
                ? `amiibo mode: ${rawDesc}`.slice(0, 600)
                : tt.isHybrid
                  ? 'Compatible in amiibo mode'
                  : rawDesc;
            mergeCompatibilityRow(resultMap, {
              toy_stable_id: tt.stableId,
              game_stable_id: gid,
              can_read: 1,
              can_write: canWrite,
              description,
            });
          }
        }
      }
    }
  }

  return Array.from(resultMap.values());
}

const SKYLANDER_ORIGINAL_SIDEKICK_BASES = new Set([
  'terrabite',
  'gill runt',
  'trigger snappy',
  'whisper elf',
  'barkley',
  'thumpling',
  'mini jini',
  'eye small',
]);

const SKYLANDER_SIDEKICK_SSA_BASES = new Set([
  'terrabite',
  'gill runt',
  'trigger snappy',
  'whisper elf',
]);

const SKYLANDER_NINTENDO_ONLY_NAMES = new Set([
  'hammer slam bowser',
  'dark hammer slam bowser',
  'turbo charge donkey kong',
  'dark turbo charge donkey kong',
  'clown cruiser',
  'dark clown cruiser',
  'barrel blaster',
  'dark barrel blaster',
]);

const NINTENDO_CONSOLE_IDS = new Set([22, 23, 24, 26]); // Wii, 3DS, Wii U, Switch

const SKYLANDER_VARIANT_PREFIX_RE =
  /^(?:series\s+\d+(?:\.\d+)?\*?|lightcore|legendary|dark|nitro|jade|polar|enchanted|springtime|volcanic|molten|gnarly|granite|quickdraw|royal|scarlet|punch|winterfest|crimson|obsidian|easter|love potion|kickoff|power blue|steel plated|birthday bash|frightful|missile-tow|eggcited|event exclusive|golden)\s+/i;

function stripSkylanderVariantPrefixes(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(SKYLANDER_VARIANT_PREFIX_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseSkylanderSeriesGen(
  series: string | null | undefined,
): number | null {
  if (!series) return null;
  const s = series.trim();
  if (s === '1') return 1;
  if (s === '2') return 2;
  if (s === '3') return 3;
  if (s === '4') return 4;
  if (s === '5') return 5;
  if (s === '6') return 6;
  return null;
}

function resolveSkylanderGameGen(title: string): number | null {
  const lower = title.toLowerCase();
  if (!lower.includes('skylander')) return null;
  if (lower.includes('spyro')) return 1;
  if (lower.includes('giants')) return 2;
  if (lower.includes('swap force')) return 3;
  if (lower.includes('trap team')) return 4;
  if (lower.includes('superchargers')) return 5;
  if (lower.includes('imaginators')) return 6;
  return null;
}

/**
 * Builds Skylanders `toy_game_compatibility` entries covering forward compatibility
 * from each toy's debut release through Imaginators, backwards compatibility for reposes/LightCore/
 * Eon's Elite/original-Sidekick Minis, and console/hardware restrictions (Bowser/DK hybrids, Traps, Vehicles).
 */
export function buildSkylandersCompatibilityEntries(
  toys: ToyCompatibilityToyInput[],
  games: ToyCompatibilityGameInput[],
): ToyGameCompatibilityRow[] {
  const skylanderGamesByGen = new Map<number, ToyCompatibilityGameInput[]>();
  for (const g of games) {
    const gen = resolveSkylanderGameGen(g.title);
    if (!gen) continue;
    const list = skylanderGamesByGen.get(gen) || [];
    list.push(g);
    skylanderGamesByGen.set(gen, list);
  }

  const skylanders = toys.filter((t) => t.line === 'Skylanders');

  // Map every base character name to its earliest debut generation (1..4)
  const baseCharDebutGen = new Map<string, number>();
  for (const t of skylanders) {
    const gen = parseSkylanderSeriesGen(t.series);
    if (!gen || gen > 4) continue;
    const typeLower = (t.type || '').toLowerCase();
    if (
      typeLower === 'series 1' ||
      typeLower === 'giants' ||
      typeLower === 'swap force' ||
      typeLower === 'trap master'
    ) {
      const stripped = stripSkylanderVariantPrefixes(t.name).toLowerCase();
      if (stripped) {
        const prev = baseCharDebutGen.get(stripped);
        if (prev === undefined || gen < prev) {
          baseCharDebutGen.set(stripped, gen);
        }
      }
      const rawLower = t.name.trim().toLowerCase();
      const prevRaw = baseCharDebutGen.get(rawLower);
      if (prevRaw === undefined || gen < prevRaw) {
        baseCharDebutGen.set(rawLower, gen);
      }
    }
  }
  const sortedBaseNames = Array.from(baseCharDebutGen.keys()).sort(
    (a, b) => b.length - a.length,
  );

  const findBaseCharDebutGen = (toyName: string): number | null => {
    const clean = stripSkylanderVariantPrefixes(toyName).toLowerCase();
    if (baseCharDebutGen.has(clean)) {
      return baseCharDebutGen.get(clean)!;
    }
    const rawLower = toyName.trim().toLowerCase();
    for (const base of sortedBaseNames) {
      if (rawLower === base || rawLower.endsWith(` ${base}`)) {
        return baseCharDebutGen.get(base)!;
      }
    }
    return null;
  };

  const resultMap = new Map<string, ToyGameCompatibilityRow>();

  for (const toy of skylanders) {
    const nameLower = toy.name.trim().toLowerCase();
    const typeLower = (toy.type || '').toLowerCase().trim();
    const seriesLower = (toy.series || '').toLowerCase().trim();
    const isNintendoExclusive = SKYLANDER_NINTENDO_ONLY_NAMES.has(nameLower);
    const isElite = seriesLower.includes('elite');
    const releaseGen = isElite ? 4 : parseSkylanderSeriesGen(toy.series);
    if (!releaseGen) continue;

    // 1. Traps (Gen 4): Console Trap Team, Console/Wii SuperChargers (no 3DS), Console Imaginators (no Switch)
    if (typeLower === 'trap') {
      for (const gen of [4, 5, 6]) {
        for (const game of skylanderGamesByGen.get(gen) || []) {
          if (gen === 4 && game.platform_id === 23) continue; // 3DS Trap Team uses touch screen, no Trap slot
          if (gen === 5 && game.platform_id === 23) continue; // 3DS SuperChargers Racing has no Trap slot
          if (gen === 6 && game.platform_id === 26) continue; // Switch Imaginators has no Portal/Trap support
          const desc =
            gen === 4
              ? 'Trap villains and switch between Villain and Skylander play'
              : gen === 5
                ? 'Unlocks Villain Skystones card and Elemental Vehicle Ammo'
                : 'Grants bonus gold in Imaginators';
          mergeCompatibilityRow(resultMap, {
            toy_stable_id: toy.stable_id,
            game_stable_id: game.stable_id,
            can_read: 1,
            can_write: gen === 4 ? 1 : 0,
            description: desc,
          });
        }
      }
      continue;
    }

    // 2. Vehicles (Gen 5): SuperChargers / SuperChargers Racing + console Imaginators (no Switch; Bowser/DK Nintendo-only)
    if (typeLower === 'vehicle') {
      for (const gen of [5, 6]) {
        for (const game of skylanderGamesByGen.get(gen) || []) {
          if (
            isNintendoExclusive &&
            !NINTENDO_CONSOLE_IDS.has(game.platform_id)
          ) {
            continue;
          }
          if (gen === 6 && game.platform_id === 26) {
            continue; // Switch Imaginators omits SuperChargers racing mode
          }
          const desc =
            gen === 5
              ? isNintendoExclusive
                ? 'Playable vehicle (Nintendo consoles only)'
                : 'Playable vehicle'
              : 'Playable in Imaginators Racing mode';
          mergeCompatibilityRow(resultMap, {
            toy_stable_id: toy.stable_id,
            game_stable_id: game.stable_id,
            can_read: 1,
            can_write: 1,
            description: desc,
          });
        }
      }
      continue;
    }

    // 3. Creation Crystals & Senseis (Gen 6 Imaginators ONLY)
    if (typeLower === 'creation crystal' || typeLower === 'sensei') {
      const desc =
        typeLower === 'creation crystal'
          ? 'Stores and loads a custom Imaginator Skylander'
          : 'Playable Sensei Skylander (unlocks Sky-Chi, class shrine & level cap boost)';
      for (const game of skylanderGamesByGen.get(6) || []) {
        mergeCompatibilityRow(resultMap, {
          toy_stable_id: toy.stable_id,
          game_stable_id: game.stable_id,
          can_read: 1,
          can_write: 1,
          description: desc,
        });
      }
      continue;
    }

    // 4. Sidekicks (Gen 1 & 2 -> companions in 1-3, playable Minis in 4-6)
    if (typeLower === 'sidekick' || typeLower === 'sidekicks') {
      for (let gen = releaseGen; gen <= 6; gen++) {
        for (const game of skylanderGamesByGen.get(gen) || []) {
          const desc =
            gen <= 3
              ? 'Non-playable Sidekick companion'
              : 'Playable Mini Skylander';
          mergeCompatibilityRow(resultMap, {
            toy_stable_id: toy.stable_id,
            game_stable_id: game.stable_id,
            can_read: 1,
            can_write: gen >= 4 ? 1 : 0,
            description: desc,
          });
        }
      }
      continue;
    }

    // 5. Minis (Gen 4 playable; the 9 original Sidekick variants also work backwards as Sidekicks)
    if (typeLower === 'mini') {
      const cleanMiniName = stripSkylanderVariantPrefixes(
        toy.name,
      ).toLowerCase();
      const isOriginalSidekickMini =
        SKYLANDER_ORIGINAL_SIDEKICK_BASES.has(cleanMiniName);
      const minGen = isOriginalSidekickMini
        ? SKYLANDER_SIDEKICK_SSA_BASES.has(cleanMiniName)
          ? 1
          : 2
        : 4;

      for (let gen = minGen; gen <= 6; gen++) {
        for (const game of skylanderGamesByGen.get(gen) || []) {
          const desc =
            gen <= 3
              ? 'Non-playable Sidekick companion (backwards compatible)'
              : 'Playable Mini Skylander';
          mergeCompatibilityRow(resultMap, {
            toy_stable_id: toy.stable_id,
            game_stable_id: game.stable_id,
            can_read: 1,
            can_write: gen >= 4 ? 1 : 0,
            description: desc,
          });
        }
      }
      continue;
    }

    // 6. Magic Items & Trophies
    if (typeLower === 'magic item') {
      if (releaseGen === 6) {
        for (const game of skylanderGamesByGen.get(6) || []) {
          if (game.platform_id === 26) continue;
          mergeCompatibilityRow(resultMap, {
            toy_stable_id: toy.stable_id,
            game_stable_id: game.stable_id,
            can_read: 1,
            can_write: 0,
            description: 'Unlocks Imaginators adventure level or chest rewards',
          });
        }
      } else if (releaseGen === 5) {
        for (const gen of [5, 6]) {
          for (const game of skylanderGamesByGen.get(gen) || []) {
            if (gen === 6 && game.platform_id === 26) continue;
            mergeCompatibilityRow(resultMap, {
              toy_stable_id: toy.stable_id,
              game_stable_id: game.stable_id,
              can_read: 1,
              can_write: 0,
              description:
                gen === 5
                  ? 'Unlocks racing cup, tracks, and playable villains'
                  : 'Unlocks racing tracks in Imaginators Racing mode',
            });
          }
        }
      } else {
        for (let gen = releaseGen; gen <= 6; gen++) {
          for (const game of skylanderGamesByGen.get(gen) || []) {
            if (gen === 6 && game.platform_id === 26) continue;
            const desc =
              gen === releaseGen
                ? 'Unlocks debut adventure expansion or Magic Item ability'
                : gen <= 4
                  ? 'Grants Magic Item effect or bonus gold in battle'
                  : 'Grants bonus gold / Skylander rewards';
            mergeCompatibilityRow(resultMap, {
              toy_stable_id: toy.stable_id,
              game_stable_id: game.stable_id,
              can_read: 1,
              can_write: 0,
              description: desc,
            });
          }
        }
      }
      continue;
    }

    // 7. Standard, Giant, SWAP Force, Trap Master, SuperCharger, LightCore, Repose, Eon's Elite figures
    const isRepose =
      isElite ||
      typeLower === 'series 2' ||
      typeLower === 'series 3' ||
      typeLower === 'series 4' ||
      typeLower.startsWith('series 1.5') ||
      typeLower === 'lightcore';
    const charDebutGen = isRepose ? findBaseCharDebutGen(toy.name) : null;
    const minGen =
      charDebutGen !== null && charDebutGen < releaseGen
        ? charDebutGen
        : releaseGen;

    for (let gen = minGen; gen <= 6; gen++) {
      for (const game of skylanderGamesByGen.get(gen) || []) {
        if (
          isNintendoExclusive &&
          !NINTENDO_CONSOLE_IDS.has(game.platform_id)
        ) {
          continue;
        }
        let desc = 'Playable Skylander figure';
        if (isNintendoExclusive) {
          desc =
            gen === 5
              ? 'Playable SuperCharger (Nintendo consoles only; twist base for amiibo mode)'
              : 'Playable guest Skylander (Nintendo consoles only; twist base for amiibo mode)';
        } else if (isElite) {
          desc =
            gen < 4
              ? 'Playable Skylander (without Elite stat abilities)'
              : "Playable Eon's Elite Skylander";
        } else if (typeLower === 'lightcore' && gen < releaseGen) {
          desc = 'Playable Skylander (without LightCore flash ability)';
        } else if (
          (typeLower === 'series 2' ||
            typeLower === 'series 3' ||
            typeLower === 'series 4' ||
            typeLower.startsWith('series 1.5')) &&
          gen < releaseGen
        ) {
          desc = 'Playable Skylander (without newer Wow Pow upgrade)';
        } else if (
          typeLower === 'series 2' ||
          typeLower === 'series 3' ||
          typeLower === 'series 4'
        ) {
          desc = 'Playable Skylander (with Wow Pow upgrade unlocked)';
        }

        mergeCompatibilityRow(resultMap, {
          toy_stable_id: toy.stable_id,
          game_stable_id: game.stable_id,
          can_read: 1,
          can_write: 1,
          description: desc,
        });
      }
    }
  }

  return Array.from(resultMap.values());
}

const STARLINK_SWITCH_EXCLUSIVE_NAMES = new Set(['fox mccloud', 'arwing']);

/**
 * Builds Starlink: Battle for Atlas `toy_game_compatibility` entries:
 * Fox McCloud and Arwing are restricted to the Nintendo Switch release;
 * all other Starlink Pilots, Starships, and Weapons work across Switch, PS4, and Xbox One.
 */
export function buildStarlinkCompatibilityEntries(
  toys: ToyCompatibilityToyInput[],
  games: ToyCompatibilityGameInput[],
): ToyGameCompatibilityRow[] {
  const starlinkGames = games.filter((g) =>
    g.title.toLowerCase().includes('starlink: battle for atlas'),
  );
  const starlinkToys = toys.filter((t) => t.line === 'Starlink');
  const results: ToyGameCompatibilityRow[] = [];

  for (const toy of starlinkToys) {
    const nameLower = toy.name.trim().toLowerCase();
    const isSwitchOnly = STARLINK_SWITCH_EXCLUSIVE_NAMES.has(nameLower);
    const toyType = (toy.type || 'Modular Toy').trim();

    for (const game of starlinkGames) {
      if (isSwitchOnly && game.platform_id !== 26) continue;
      results.push({
        toy_stable_id: toy.stable_id,
        game_stable_id: game.stable_id,
        can_read: 1,
        can_write: 0,
        description: isSwitchOnly
          ? `Nintendo Switch exclusive ${toyType}`
          : `Unlocks in-game Starlink ${toyType}`,
      });
    }
  }

  return results;
}
