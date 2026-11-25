/**
 * SOURCE-AWARE EXTERNAL VERIFICATION LINKS
 *
 * Maps each physical verification `source` (`redump`, `dat`, `no_intro`, `mame`,
 * `ps5db`, `serialstation`, `nscollectors`, `nintendo_revised`, `retail_catalog`,
 * `lgn`, `boutique`) to an actionable external
 * reference URL + tooltip for display in Game Detail views without storing
 * duplicate per-row URLs in D1.
 */

import { REDUMP_TARGETS, REDUMP_WIP_TARGETS } from './dat_targets.js';
import { SW1_SHEET_ID, SW2_SHEET_ID } from './nscollectors.js';
import { SWITCH_REVISIONS_ATTRIBUTION_URL } from './switch_revisions.js';

export interface VerificationSourceLink {
  source: string;
  label: string;
  url: string | null;
  tooltip: string;
}

export interface VerificationLinkInput {
  source?: string | null;
  platformId?: number | null;
  title?: string | null;
  serialCode?: string | null;
  retailUrl?: string | null;
  manuallyVerified?: number | boolean | null;
}

const OPTICAL_REDUMP_PLATFORM_IDS = new Set<number>([
  ...REDUMP_TARGETS.map((t) => t.platformId),
  ...REDUMP_WIP_TARGETS.map((t) => t.platformId),
]);

const PS5DB_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1LNoL9HTVyLutj9T_bWNM54qkyrPGV1tSkiTBJAus-cE/edit';
const GENERAL_COMMUNITY_PRESERVATION_URL = 'https://www.serialstation.com/';
const MAME_ARCADE_DB_SEARCH_BASE =
  'https://adb.arcadeitalia.net/lista_mame.php?ricerca=';
const SAFE_HTTP_URL_REGEX = /^https?:\/\/\S+$/i;

function cleanQueryTerm(raw: string | null | undefined): string {
  return (raw || '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s*\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw || '').trim();
  return SAFE_HTTP_URL_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Resolves a verification badge label, external URL (or null for manual
 * verification), and descriptive tooltip from a release or game's verification metadata.
 */
export function getVerificationSourceLink(
  input: VerificationLinkInput,
): VerificationSourceLink | null {
  const rawSource = (input.source || '').trim().toLowerCase();
  const titleQuery = cleanQueryTerm(input.title);
  const serialQuery = (input.serialCode || '').trim();
  const safeRetailUrl = normalizeHttpUrl(input.retailUrl);

  if (
    !rawSource &&
    (input.manuallyVerified === 1 || input.manuallyVerified === true)
  ) {
    return {
      source: 'manual',
      label: 'Manually Verified',
      url: null,
      tooltip:
        'Physical release manually verified by collection administrator.',
    };
  }

  if (!rawSource) return null;

  const isOpticalPlatform =
    input.platformId !== null &&
    input.platformId !== undefined &&
    OPTICAL_REDUMP_PLATFORM_IDS.has(Number(input.platformId));

  switch (rawSource) {
    case 'redump':
    case 'dat': {
      if (rawSource === 'redump' || isOpticalPlatform) {
        const term = serialQuery || titleQuery;
        const encoded = encodeURIComponent(term);
        return {
          source: 'redump',
          label: 'Redump',
          url: term
            ? `https://redump.org/discs/quicksearch/${encoded}`
            : 'https://redump.org/discs/',
          tooltip: serialQuery
            ? `Verify disc serial ${serialQuery} on Redump.org`
            : `Search Redump.org optical disc database${titleQuery ? ` for "${titleQuery}"` : ''}`,
        };
      }
      const encodedTitle = encodeURIComponent(titleQuery);
      return {
        source: 'no_intro',
        label: 'No-Intro DAT',
        url: titleQuery
          ? `https://datomatic.no-intro.org/index.php?page=search&s=0&search=${encodedTitle}`
          : 'https://datomatic.no-intro.org/',
        tooltip: `Verify ROM/cartridge release in No-Intro Dat-o-MATIC${titleQuery ? ` for "${titleQuery}"` : ''}`,
      };
    }

    case 'no_intro': {
      const encodedTitle = encodeURIComponent(titleQuery);
      return {
        source: 'no_intro',
        label: 'No-Intro DAT',
        url: titleQuery
          ? `https://datomatic.no-intro.org/index.php?page=search&s=0&search=${encodedTitle}`
          : 'https://datomatic.no-intro.org/',
        tooltip: `Verify cartridge release in No-Intro Dat-o-MATIC${titleQuery ? ` for "${titleQuery}"` : ''}`,
      };
    }

    case 'mame': {
      const term = titleQuery || serialQuery;
      return {
        source: 'mame',
        label: 'MAME Database',
        url: term
          ? `${MAME_ARCADE_DB_SEARCH_BASE}${encodeURIComponent(term)}`
          : 'https://www.mamedev.org/',
        tooltip:
          'Verify AES/arcade physical release against MAME Software Lists',
      };
    }

    case 'neogeo_x':
      return {
        source: 'neogeo_x',
        label: 'Neo Geo X Archive',
        url: 'https://en.wikipedia.org/wiki/Neo_Geo_X',
        tooltip: 'Verified against documented Neo Geo X Game Card releases',
      };

    case 'ps5db':
      return {
        source: 'ps5db',
        label: 'PS5DB Sheet',
        url: PS5DB_SHEET_URL,
        tooltip: 'Verified via PS5 Physical Database (PS5DB) community sheet',
      };

    case 'serialstation': {
      const term = serialQuery || titleQuery;
      return {
        source: 'serialstation',
        label: 'SerialStation',
        url: term
          ? `https://www.serialstation.com/titles/?search=${encodeURIComponent(term)}`
          : 'https://www.serialstation.com/',
        tooltip: serialQuery
          ? `Inspect PlayStation serial ${serialQuery} on SerialStation`
          : `Search SerialStation PlayStation database${titleQuery ? ` for "${titleQuery}"` : ''}`,
      };
    }

    case 'nscollectors':
    case 'nscollectors_upcoming':
    case 'nscollectors_ciab': {
      const isSw2 = Number(input.platformId) === 27;
      const sheetId = isSw2 ? SW2_SHEET_ID : SW1_SHEET_ID;
      return {
        source: rawSource,
        label: 'r/NSCollectors Sheet',
        url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
        tooltip:
          rawSource === 'nscollectors_upcoming'
            ? 'Listed on r/NSCollectors Upcoming Switch physical releases sheet'
            : rawSource === 'nscollectors_ciab'
              ? 'Listed on r/NSCollectors Code-in-a-Box Switch sheet'
              : 'Verified via r/NSCollectors Switch physical releases sheet',
      };
    }

    case 'nintendo_revised':
      return {
        source: 'nintendo_revised',
        label: 'Nintendo Revised Sheet',
        url: SWITCH_REVISIONS_ATTRIBUTION_URL,
        tooltip:
          'Physical revision verified via Nintendo Revised Cartridge Revisions spreadsheet',
      };

    case 'boutique':
      return safeRetailUrl
        ? {
            source: 'boutique',
            label: 'Boutique Listing',
            url: safeRetailUrl,
            tooltip: 'Open boutique publisher physical store listing',
          }
        : {
            source: 'boutique',
            label: 'Boutique Verified',
            url: null,
            tooltip: 'Verified physical release from boutique publisher feed',
          };

    case 'retail_catalog': {
      if (safeRetailUrl) {
        return {
          source: 'retail_catalog',
          label: 'Retail Storefront',
          url: safeRetailUrl,
          tooltip: 'Verify physical edition on retail storefront listing',
        };
      }
      return {
        source: 'retail_catalog',
        label: 'Retail Catalog Search',
        url: titleQuery
          ? `https://videogamesplus.ca/search?q=${encodeURIComponent(titleQuery)}`
          : 'https://videogamesplus.ca/',
        tooltip: `Search VGP physical retail catalog${titleQuery ? ` for "${titleQuery}"` : ''}`,
      };
    }

    case 'lgn': {
      if (safeRetailUrl) {
        return {
          source: 'lgn',
          label: 'Limited Game News',
          url: safeRetailUrl,
          tooltip: 'Open Limited Game News release announcement',
        };
      }
      return {
        source: 'lgn',
        label: 'Limited Game News',
        url: titleQuery
          ? `https://limitedgamenews.com/?s=${encodeURIComponent(titleQuery)}`
          : 'https://limitedgamenews.com/',
        tooltip: `Search Limited Game News catalog${titleQuery ? ` for "${titleQuery}"` : ''}`,
      };
    }

    case 'community': {
      const pid = Number(input.platformId ?? 0);
      if (pid === 35) {
        return {
          source: rawSource,
          label: 'PS5DB Community Catalog',
          url: PS5DB_SHEET_URL,
          tooltip: 'Verified via PS5DB community physical catalog CSV',
        };
      }
      if (pid === 26 || pid === 27) {
        const sheetId = pid === 27 ? SW2_SHEET_ID : SW1_SHEET_ID;
        return {
          source: rawSource,
          label: 'NSCollectors Community CSV',
          url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
          tooltip:
            'Verified via Nintendo Switch community physical catalog CSV',
        };
      }
      return {
        source: rawSource,
        label: 'Community Preservation DB',
        url: titleQuery
          ? `https://www.serialstation.com/titles/?search=${encodeURIComponent(titleQuery)}`
          : GENERAL_COMMUNITY_PRESERVATION_URL,
        tooltip: 'Verified via curated community physical preservation catalog',
      };
    }

    case 'manual':
    case 'manually_verified':
      return {
        source: 'manual',
        label: 'Manually Verified',
        url: null,
        tooltip:
          'Physical release manually verified by collection administrator.',
      };

    default:
      return null;
  }
}
