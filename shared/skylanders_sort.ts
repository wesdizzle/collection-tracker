/**
 * Canonical sorting, categorization, element resolution, and variant parsing
 * for the Skylanders Toys-to-Life catalog.
 *
 * Pure isomorphic module shared between seed generation, worker checks, and tests.
 */

export const SKYLANDERS_ELEMENT_ORDER: Readonly<Record<string, number>> = {
  air: 1,
  life: 2,
  undead: 3,
  earth: 4,
  fire: 5,
  water: 6,
  magic: 7,
  tech: 8,
  light: 9,
  dark: 10,
};

export const SKYLANDERS_SERIES_ORDER: Readonly<Record<string, number>> = {
  'skylanders-spyro-s-adventure': 1,
  'skylanders-giants': 2,
  'skylanders-swap-force': 3,
  'skylanders-trap-team': 4,
  'skylanders-superchargers': 5,
  'skylanders-imaginators': 6,
  'skylanders-eon-s-elite': 100,
};

const VALID_WHEEL_ELEMENTS = [
  'air',
  'life',
  'undead',
  'earth',
  'fire',
  'water',
  'magic',
  'tech',
  'light',
  'dark',
] as const;

const CHASE_VARIANT_MODIFIERS = [
  'event exclusive',
  'event-exclusive',
  'e3 exclusive',
  'e3-exclusive',
  'birthday bash',
  'birthday-bash',
  'steel plated',
  'steel-plated',
  'candy-coated',
  'candy coated',
  'spring ahead',
  'spring-ahead',
  'hard-boiled',
  'hard boiled',
  'jingle bell',
  'jingle-bell',
  'love potion',
  'love-potion',
  'missile-tow',
  'power punch',
  'power-punch',
  'solar flare',
  'solar-flare',
  'egg bomber',
  'egg-bomber',
  'power blue',
  'power-blue',
  'quick draw',
  'quick-draw',
  'eggscellent',
  'eggsellent',
  'springtime',
  'winterfest',
  'enchanted',
  'frightful',
  'legendary',
  'eggcited',
  'mystical',
  'volcanic',
  'granite',
  'kickoff',
  'scarlet',
  'golden',
  'gnarly',
  'molten',
  'jolly',
  'nitro',
  'polar',
  'punch',
  'royal',
  'dark',
  'jade',
].sort((a, b) => b.length - a.length);

const POSE_REPOSE_PREFIXES = [
  'anchors away',
  'anchors-away',
  'fizzy frenzy',
  'fizzy-frenzy',
  'double dare',
  'double-dare',
  'heavy duty',
  'heavy-duty',
  'horn blast',
  'horn-blast',
  'hyper beam',
  'hyper-beam',
  'thorn horn',
  'thorn-horn',
  'tidal wave',
  'tidal-wave',
  'twin blade',
  'twin-blade',
  'bone bash',
  'bone-bash',
  'deep dive',
  'deep-dive',
  'fire bone',
  'fire-bone',
  'full blast',
  'full-blast',
  'lava barf',
  'lava-barf',
  'super gulp',
  'super-gulp',
  'sure shot',
  'sure-shot',
  'big bang',
  'big-bang',
  'hog wild',
  'hog-wild',
  'mega ram',
  'mega-ram',
  'lightcore',
  'sidekick',
  'blizzard',
  'knockout',
  'phantom',
  'ninja',
  'turbo',
].sort((a, b) => b.length - a.length);

export interface SkylandersToyInput {
  id: string;
  name: string;
  series_id?: string | null;
  series?: string | null;
  type?: string | null;
  metadata_json?: string | null;
  sort_index?: number | null;
  series_sort_index?: number | null;
}

export interface SkylandersNameParts {
  baseName: string;
  variantName: string;
  poseName: string;
}

export interface SkylandersSortEntry<T extends SkylandersToyInput> {
  toy: T;
  sortIndex: number;
  gameOrder: number;
  categoryOrder: number;
  element: string;
  elemOrder: number;
  subtypePriority: number;
  groupPriority: number;
  baseName: string;
  variantName: string;
  poseName: string;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves the canonical lowercase element key for a Skylander toy.
 * Applies a defensive name-prefix fallback for Creation Crystals and Traps if
 * metadata is missing or corrupted (e.g. Fire Acorn).
 */
export function getSkylandersElement(toy: SkylandersToyInput): string {
  let rawElem = '';
  if (toy.metadata_json) {
    try {
      const meta = JSON.parse(toy.metadata_json) as Record<string, unknown>;
      if (typeof meta['element'] === 'string') {
        rawElem = meta['element'].toLowerCase().trim();
      }
    } catch {
      // Ignore malformed metadata JSON
    }
  }

  const typeLower = (toy.type || '').toLowerCase().trim();
  const nameLower = (toy.name || '').toLowerCase().trim();

  if (
    typeLower === 'creation crystal' ||
    typeLower === 'trap' ||
    nameLower.includes('crystal')
  ) {
    for (const elementPrefix of VALID_WHEEL_ELEMENTS) {
      if (
        nameLower.startsWith(`${elementPrefix} `) &&
        rawElem !== elementPrefix
      ) {
        return elementPrefix;
      }
    }
  }

  if (rawElem === 'kaos') {
    return 'kaos';
  }
  if (!rawElem || rawElem === 'none') {
    return 'kaos/other';
  }
  return rawElem;
}

/**
 * Assigns category sort tier:
 * 1 = Characters, 2 = Vehicles, 3 = Creation Crystals, 4 = Traps, 5 = Magic Items.
 */
export function getSkylandersCategoryOrder(
  toy: SkylandersToyInput,
  element: string,
): number {
  const typeLower = (toy.type || '').toLowerCase().trim();
  const nameLower = (toy.name || '').toLowerCase().trim();

  if (typeLower === 'vehicle') {
    return 2;
  }
  if (typeLower === 'creation crystal' || typeLower.includes('crystal')) {
    return 3;
  }
  // Strictly type === 'Trap' so character names containing "trap" (Trap Shadow) remain Characters.
  if (typeLower === 'trap') {
    return 4;
  }
  if (
    typeLower === 'magic item' ||
    typeLower === 'trophy' ||
    typeLower === 'adventure pack' ||
    nameLower.includes('trophy') ||
    nameLower.includes('adventure pack') ||
    !element ||
    element === 'kaos/other'
  ) {
    return 5;
  }
  return 1;
}

/**
 * Extracts base name, chase/deco variant modifier, and standard repose/pose prefix
 * so standard figures always sort before their deco/chase variants.
 */
export function extractSkylandersNameParts(
  name: string,
  categoryOrder = 1,
): SkylandersNameParts {
  let cleanName = (name || '').replace(/\s+/g, ' ').trim();

  cleanName = cleanName
    .replace(/\b(?:series\s*\d+|series-\d+)\b/gi, '')
    .replace(/\bgear\b/gi, '')
    .replace(/\bfigure\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const variantModifiers: string[] = [];
  const poseModifiers: string[] = [];

  if (categoryOrder === 5) {
    const leadMagicMod = cleanName.match(/^(legendary|golden)\s+/i);
    if (leadMagicMod) {
      variantModifiers.push(leadMagicMod[1]);
      cleanName = cleanName.slice(leadMagicMod[0].length).trim();
    }
    if (/mystery chest$/i.test(cleanName)) {
      const chestMod = cleanName.match(/^(bronze|gold|silver)\s+/i);
      if (chestMod) {
        variantModifiers.push(chestMod[1]);
        cleanName = cleanName.slice(chestMod[0].length).trim();
      }
    }
    return {
      baseName: cleanName,
      variantName: variantModifiers.join(' '),
      poseName: '',
    };
  }

  if (categoryOrder === 3 || categoryOrder === 4) {
    const leadMod = cleanName.match(/^(legendary)\s+/i);
    if (leadMod) {
      variantModifiers.push(leadMod[1]);
      cleanName = cleanName.slice(leadMod[0].length).trim();
    }
    return {
      baseName: cleanName,
      variantName: variantModifiers.join(' '),
      poseName: '',
    };
  }

  // Step A: Strip chase/deco variant modifiers (longest-first), protecting compound base names.
  for (const mod of CHASE_VARIANT_MODIFIERS) {
    if (mod === 'golden' && /\bgolden\s+queen\b/i.test(cleanName)) {
      continue;
    }
    if (mod === 'gold' && /\bgold\s+rusher\b/i.test(cleanName)) {
      continue;
    }
    if (mod === 'stone' && /\bdoom\s+stone\b/i.test(cleanName)) {
      continue;
    }
    const regex = new RegExp(`\\b${escapeRegExp(mod)}\\b`, 'gi');
    const match = cleanName.match(regex);
    if (match) {
      variantModifiers.push(match[0]);
      cleanName = cleanName.replace(regex, '').replace(/\s+/g, ' ').trim();
    }
  }

  if (
    cleanName.toLowerCase().startsWith('king ') &&
    !/\bking\s+pen\b/i.test(cleanName)
  ) {
    variantModifiers.push(cleanName.slice(0, 4));
    cleanName = cleanName.slice(5).trim();
  }

  // Step B: Strip standard repose / LightCore / Sidekick prefixes separately.
  for (const prefix of POSE_REPOSE_PREFIXES) {
    if (
      prefix === 'turbo' &&
      /\bturbo\s+charge\s+donkey\s+kong\b/i.test(cleanName)
    ) {
      continue;
    }
    const regex = new RegExp(`\\b${escapeRegExp(prefix)}\\b`, 'gi');
    const match = cleanName.match(regex);
    if (match) {
      poseModifiers.push(match[0]);
      cleanName = cleanName.replace(regex, '').replace(/\s+/g, ' ').trim();
    }
  }

  return {
    baseName: cleanName,
    variantName: variantModifiers.join(' '),
    poseName: poseModifiers.join(' '),
  };
}

function getCharacterPriorities(
  toy: SkylandersToyInput,
  categoryOrder: number,
): { subtypePriority: number; groupPriority: number } {
  if (categoryOrder !== 1) {
    return { subtypePriority: 5, groupPriority: 4 };
  }

  const tType = (toy.type || '').trim();
  const tNameLower = (toy.name || '').toLowerCase();

  let subtypePriority = 5;
  if (
    tType === 'Giants' ||
    tType === 'SWAP Force' ||
    tType === 'Trap Master' ||
    tType === 'Sensei'
  ) {
    subtypePriority = 1;
  } else if (
    tType === 'Mini' ||
    tType === 'Sidekicks' ||
    tType === 'Sidekick' ||
    tNameLower.includes('sidekick') ||
    tNameLower.startsWith('mini ') ||
    tNameLower.endsWith(' mini')
  ) {
    subtypePriority = 4;
  } else if (tType === 'LightCore') {
    subtypePriority = 3;
  } else if (
    tType.startsWith('Series') ||
    tType === 'SuperCharger' ||
    tType === 'Figure'
  ) {
    subtypePriority = 2;
  }

  let groupPriority = 4;
  if (subtypePriority === 1) {
    groupPriority = 1;
  } else if (subtypePriority === 2 || subtypePriority === 3) {
    groupPriority = 2;
  } else if (subtypePriority === 4) {
    groupPriority = 3;
  }

  return { subtypePriority, groupPriority };
}

/**
 * Computes canonical sequential 1-based `sort_index` assignments across Skylanders toys.
 */
export function computeSkylandersSortOrder<T extends SkylandersToyInput>(
  toys: readonly T[],
): Array<SkylandersSortEntry<T>> {
  const entries = toys.map((toy) => {
    const element = getSkylandersElement(toy);
    const categoryOrder = getSkylandersCategoryOrder(toy, element);
    const parts = extractSkylandersNameParts(toy.name, categoryOrder);
    const seriesOrder =
      toy.series_sort_index ??
      (toy.series_id ? (SKYLANDERS_SERIES_ORDER[toy.series_id] ?? 99) : 99);
    const elemOrder = SKYLANDERS_ELEMENT_ORDER[element] ?? 99;
    const { subtypePriority, groupPriority } = getCharacterPriorities(
      toy,
      categoryOrder,
    );

    return {
      toy,
      gameOrder: seriesOrder,
      categoryOrder,
      element,
      elemOrder,
      subtypePriority,
      groupPriority,
      baseName: parts.baseName,
      variantName: parts.variantName,
      poseName: parts.poseName,
    };
  });

  entries.sort((a, b) => {
    if (a.gameOrder !== b.gameOrder) {
      return a.gameOrder - b.gameOrder;
    }
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder;
    }
    if (a.elemOrder !== b.elemOrder) {
      return a.elemOrder - b.elemOrder;
    }
    if (a.groupPriority !== b.groupPriority) {
      return a.groupPriority - b.groupPriority;
    }

    const baseCompare = a.baseName
      .toLowerCase()
      .localeCompare(b.baseName.toLowerCase());
    if (baseCompare !== 0) {
      return baseCompare;
    }

    if (a.subtypePriority !== b.subtypePriority) {
      return a.subtypePriority - b.subtypePriority;
    }

    const aHasVariant = a.variantName !== '';
    const bHasVariant = b.variantName !== '';
    if (aHasVariant !== bHasVariant) {
      return aHasVariant ? 1 : -1;
    }

    const variantCompare = a.variantName
      .toLowerCase()
      .localeCompare(b.variantName.toLowerCase());
    if (variantCompare !== 0) {
      return variantCompare;
    }

    const nameCompare = a.toy.name
      .toLowerCase()
      .localeCompare(b.toy.name.toLowerCase());
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return a.toy.id.localeCompare(b.toy.id);
  });

  return entries.map((entry, idx) => ({
    ...entry,
    sortIndex: idx + 1,
  }));
}
