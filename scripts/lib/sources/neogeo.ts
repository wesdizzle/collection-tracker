/**
 * NEO GEO AES (MAME HASH) & NEO GEO X OFFLINE SOURCE ADAPTER
 *
 * Parses MAME's public CC0 `hash/neogeo.xml` software list for official home-console
 * AES cartridges (`platform_id = 9`, `source = 'mame'`) and supplies the curated list
 * of all 21 official SNK/Tommo Neo Geo X SD card releases (`platform_id = 12`,
 * `source = 'neogeo_x'`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRelease } from '../../../shared/canonical_releases.js';
import { normalizeTitleForMatching } from '../../../shared/title_matching.js';

export const MAME_NEOGEO_XML_URL =
  'https://raw.githubusercontent.com/mamedev/mame/master/hash/neogeo.xml';

const EXCLUDED_SOFTWARE_REGEX =
  /\b(bootleg|prototype|proto|hack|homebrew|demo|unlicensed|sample|kiosk|test)\b/i;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function detectNeoGeoRegion(desc: string): string {
  if (/\((?:[^)]*\b)?japan\b/i.test(desc)) return 'Japan';
  if (/\((?:[^)]*\b)?(?:us|usa)\b/i.test(desc)) return 'USA';
  if (/\((?:[^)]*\b)?europe\b/i.test(desc)) return 'Europe';
  return 'USA, Japan';
}

function cleanMameNeoGeoTitle(desc: string): string {
  return desc
    .replace(/\s*\([^)]*(?:NGM|NGH|MVS|AES)[^)]*\)\s*/gi, ' ')
    .replace(/\s*\((?:Ver\.?[^)]*|Set\s*\d+|Alt)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses MAME `hash/neogeo.xml` content and extracts verified official Neo Geo AES
 * home cartridge releases (skipping clones, bootlegs, prototypes, and MVS-only software).
 */
export function parseMameNeoGeoXml(xml: string): CanonicalRelease[] {
  if (!xml || !xml.trim()) return [];
  const results: CanonicalRelease[] = [];
  const seenKeys = new Set<string>();

  const softwareRegex = /<software\s+([^>]*)>([\s\S]*?)<\/software>/gi;
  let match: RegExpExecArray | null;
  while ((match = softwareRegex.exec(xml)) !== null) {
    const attrs = match[1] || '';
    const body = match[2] || '';

    if (/\bcloneof\s*=/i.test(attrs) || /\bsupported\s*=\s*"no"/i.test(attrs)) {
      continue;
    }

    const descMatch = body.match(/<description>([\s\S]*?)<\/description>/i);
    if (!descMatch) continue;
    const rawDesc = decodeXmlEntities(descMatch[1]).trim();
    if (!rawDesc || EXCLUDED_SOFTWARE_REGEX.test(rawDesc)) {
      continue;
    }

    const releaseFeatMatch = body.match(
      /<sharedfeat\s+name="release"\s+value="([^"]*)"/i,
    );
    const serialInfoMatch = body.match(
      /<info\s+name="serial"\s+value="([^"]*)"/i,
    );
    const releaseFeat = releaseFeatMatch?.[1] || '';
    const serialVal = serialInfoMatch?.[1]
      ? decodeXmlEntities(serialInfoMatch[1]).trim()
      : '';

    const hasAesRelease =
      /\bAES\b/i.test(releaseFeat) ||
      /\bNGH-/i.test(serialVal) ||
      /\(AES\)/i.test(serialVal) ||
      /\bNGH-/i.test(rawDesc);
    if (!hasAesRelease) {
      continue;
    }

    const nghMatch =
      serialVal.match(/\b(NGH-\d+[A-Z]?)\b/i) ||
      rawDesc.match(/\b(NGH-\d+[A-Z]?)\b/i);
    const serialCode = nghMatch ? nghMatch[1].toUpperCase() : serialVal || null;

    const rawTitle = cleanMameNeoGeoTitle(rawDesc);
    const normTitle = normalizeTitleForMatching(rawTitle);
    if (!rawTitle || !normTitle) continue;

    const region = detectNeoGeoRegion(rawDesc);
    const dedupKey = `${normTitle}::${region}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const pubMatch = body.match(/<publisher>([\s\S]*?)<\/publisher>/i);
    const publisher = pubMatch
      ? decodeXmlEntities(pubMatch[1]).trim() || null
      : null;

    results.push({
      platform_id: 9,
      raw_title: rawTitle,
      normalized_title: normTitle,
      region,
      variants: null,
      rom_name: null,
      rom_crc: null,
      serial_code: serialCode,
      barcode: null,
      publisher,
      source: 'mame',
      is_verified_physical: 1,
    });
  }

  return results;
}

/**
 * Official licensed Neo Geo X SD game card releases by Tommo / SNK Playmore (2012-2013):
 * pack-in Ninja Master's cartridge, Mega Pack Vol. 1 compilation SD, and Classic Game Volumes 1-5.
 */
export const CURATED_NEOGEO_X_RELEASES: ReadonlyArray<{
  rawTitle: string;
  region: string;
}> = [
  { rawTitle: "Ninja Master's: Haoh Ninpo Cho", region: 'USA, Europe, Japan' },
  { rawTitle: '3 Count Bout', region: 'USA, Europe, Japan' },
  { rawTitle: 'Alpha Mission II', region: 'USA, Europe, Japan' },
  { rawTitle: 'Art of Fighting', region: 'USA, Europe, Japan' },
  { rawTitle: 'Art of Fighting 3', region: 'USA, Europe, Japan' },
  { rawTitle: 'Baseball Stars 2', region: 'USA, Europe, Japan' },
  { rawTitle: 'Blazing Star', region: 'USA, Europe, Japan' },
  { rawTitle: 'Cyber-Lip', region: 'USA, Europe, Japan' },
  { rawTitle: 'Fatal Fury', region: 'USA, Europe, Japan' },
  { rawTitle: 'Fatal Fury Special', region: 'USA, Europe, Japan' },
  { rawTitle: 'Garou: Mark of the Wolves', region: 'USA, Europe, Japan' },
  { rawTitle: "The King of Fighters '96", region: 'USA, Europe, Japan' },
  { rawTitle: 'The Last Blade', region: 'USA, Europe, Japan' },
  { rawTitle: 'Metal Slug', region: 'USA, Europe, Japan' },
  { rawTitle: 'Metal Slug 2', region: 'USA, Europe, Japan' },
  { rawTitle: 'Samurai Shodown III', region: 'USA, Europe, Japan' },
  { rawTitle: 'Sengoku', region: 'USA, Europe, Japan' },
  { rawTitle: 'Shock Troopers', region: 'USA, Europe, Japan' },
  { rawTitle: 'Super Sidekicks', region: 'USA, Europe, Japan' },
  { rawTitle: 'Top Hunter: Roddy & Cathy', region: 'USA, Europe, Japan' },
  { rawTitle: 'World Heroes Jet', region: 'USA, Europe, Japan' },
];

export function getCuratedNeoGeoXReleases(): CanonicalRelease[] {
  return CURATED_NEOGEO_X_RELEASES.map((entry) => ({
    platform_id: 12,
    raw_title: entry.rawTitle,
    normalized_title: normalizeTitleForMatching(entry.rawTitle),
    region: entry.region,
    variants: null,
    rom_name: null,
    rom_crc: null,
    serial_code: null,
    barcode: null,
    publisher: 'Tommo / SNK Playmore',
    source: 'neogeo_x',
    is_verified_physical: 1,
  }));
}

/**
 * Fetches MAME `neogeo.xml` into `<sourcesDir>/neogeo.xml`.
 */
export async function fetchNeoGeoSources(
  sourcesDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ savedPath: string; bytes: number; aesCount: number }> {
  fs.mkdirSync(sourcesDir, { recursive: true });
  const res = await fetchFn(MAME_NEOGEO_XML_URL, {
    headers: { 'User-Agent': 'CollectionTracker/2.0 (NeoGeoSourceFetch)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch MAME neogeo.xml (${res.status} ${res.statusText})`,
    );
  }
  const xml = await res.text();
  if (!xml.includes('<softwarelist')) {
    throw new Error('Invalid MAME neogeo.xml response: missing <softwarelist>');
  }
  const savedPath = path.join(sourcesDir, 'neogeo.xml');
  fs.writeFileSync(savedPath, xml, 'utf8');
  const parsed = parseMameNeoGeoXml(xml);
  return {
    savedPath,
    bytes: Buffer.byteLength(xml, 'utf8'),
    aesCount: parsed.length,
  };
}

/**
 * Loads parsed MAME Neo Geo AES releases (when `<sourcesDir>/neogeo.xml` exists locally)
 * alongside curated Neo Geo X physical releases.
 */
export function loadNeoGeoReleases(sourcesDir: string): CanonicalRelease[] {
  const xmlPath = path.join(sourcesDir, 'neogeo.xml');
  const aesReleases = fs.existsSync(xmlPath)
    ? parseMameNeoGeoXml(fs.readFileSync(xmlPath, 'utf8'))
    : [];
  return [...aesReleases, ...getCuratedNeoGeoXReleases()];
}
