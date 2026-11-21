/**
 * CORE COLLECTION MODELS
 *
 * Centralized high-performance interfaces for the Collection Tracker.
 * Resolves circular dependencies between services and components.
 *
 * DOMAIN MODEL GLOSSARY (Conceptual 3 Tiers -> Physical 2-Table D1 Schema):
 * - **Platform Game (`games` + `user_games`)**: A title on a specific platform (e.g., Chrono
 *   Trigger on SNES vs. DS; optional `igdb_id` links cross-platform editions). Tracks per-platform
 *   `play_status` and `queued`.
 * - **Retail Release / SKU (`RetailReleaseView`)**: A commercial regional/edition SKU on that
 *   platform. Grouped virtually in `release-grouping.ts` by `(game_id, region, variants,
 *   getRomGroupingKey)` with SKU ownership (`ownership_status`, `has_case`, `has_manual`)
 *   fanned out atomically across its sibling media rows in `user_game_releases`.
 * - **Physical Media (`GameRelease` / `PhysicalMedia`, `ReleaseMediaItem`)**: An individual
 *   disc, cartridge, or card (`game_releases` + `canonical_releases` + `user_game_releases.has_media`).
 *   Backend list/chunk APIs emit flat 1-row-per-media `CatalogMediaRow` records for compact R2
 *   snapshots and O(1) overlay merging, which `groupCatalogMediaIntoReleases` aggregates into
 *   `RetailReleaseView.mediaItems[]`.
 */

export enum OwnershipStatus {
  Unowned = 0,
  Owned = 1,
  Seeking = 2,
  Ordered = 3,
  PrioritySeeking = 4,
}

export enum PlayStatus {
  Unplayed = 0,
  Played = 1,
  Playing = 2,
  Queued = 3,
  Paused = 4,
  Dropped = 5,
}

export type PhysicalStatus =
  | 'verified_physical'
  | 'likely_physical'
  | 'digital_extracted_rom'
  | 'digital_only'
  | 'unreleased_prototype'
  | 'unverified';

export type ReleaseMedium =
  | 'physical_retail'
  | 'physical_limited'
  | 'digital_extracted_rom'
  | 'digital_native'
  | 'unreleased_prototype';

/**
 * Represents a single physical media item (`game_releases` + optional `canonical_releases`
 * metadata) within a Platform Game's Retail Release (SKU).
 */
export interface GameRelease {
  id: string;
  game_id: number;
  title?: string | null;
  region?: string | null;
  variants?: string | null;
  also_released_as?: string | null;
  rom_name?: string | null;
  rom_crc?: string | null;
  canonical_release_id?: number | null;
  serial_code?: string | null;
  is_source_verified?: number;
  source?: string | null;
  has_media: number;
  ownership_status: number;
  release_date?: string | null;
  image_url?: string | null;
  barcode?: string | null;
  has_case?: boolean | number;
  has_manual?: boolean | number;
  disc_label?: string | null;
  is_companion_base_disc?: boolean;
  companion_game_id?: string;
  companion_game_title?: string;
  comments?: string | null;
}

/** Semantic alias clarifying that each `game_releases` row is an individual physical media item. */
export type PhysicalMedia = GameRelease;

/**
 * Normalized individual physical media entry attached to a virtually grouped Retail Release
 * (`RetailReleaseView`) on the frontend so ID, label, media ownership, and filename metadata stay
 * 1-to-1 aligned without parallel arrays.
 */
export interface ReleaseMediaItem {
  id: string;
  label: string;
  hasMedia: 0 | 1;
  romName?: string | null;
  romCrc?: string | null;
  isCompanionBase?: boolean;
}

export interface SharedMediaReleaseLink {
  id: string;
  title: string;
  region?: string | null;
  variants?: string | null;
  rom_name?: string | null;
  ownership_status: number;
  has_media: number;
}

/**
 * Unified Game / Catalog Media Row / Detail View interface.
 *
 * - In `GET /api/games` & R2 catalog chunks (`CatalogMediaRow`): represents 1 physical media row
 *   (`game_releases` joined to its parent `games` row, where `id` is the media row ID,
 *   `stable_id` is the platform-game integer PK, and `game_id` is the platform-game slug).
 * - In `CollectionListComponent` (`RetailReleaseView`): represents a virtually merged Retail
 *   Release (SKU) carrying 1+ individual discs/carts in `mediaItems`.
 * - In `/api/item/game/:id` detail view: carries SKU-sibling media rows in `releases` and sibling
 *   regional/edition SKUs of the same Platform Game in `other_releases`.
 */
export interface Game {
  stable_id: number;
  /** Primary physical media row ID in list/chunk rows (`game_releases.id`), or fallback game slug. */
  id: string;
  /** Parent Platform Game slug (`games.id`). */
  game_id?: string | null;
  title: string;
  base_title?: string | null;
  series: string;
  canonical_series: string;
  release_date?: string | null;
  platform: string;
  platform_id: number;
  igdb_id?: number | null;
  igdb_url?: string | null;
  region?: string | null;
  display_name?: string | null;
  ownership_status: OwnershipStatus;
  play_status: PlayStatus;
  queued?: boolean | number;
  has_media: boolean | number;
  has_case?: boolean | number;
  has_manual?: boolean | number;
  retail_price?: number | null;
  retail_regular_price?: number | null;
  retail_discount_pct?: number | null;
  retail_on_sale?: boolean | number;
  retail_store?: string | null;
  retail_url?: string | null;
  retail_updated_at?: string | null;
  image_url?: string | null;
  summary?: string | null;
  genres?: string | null;
  collections?: string | null;
  franchises?: string | null;
  brand?: string | null;
  platform_launch_date?: string | null;
  platform_logo?: string | null;
  parent_platform_id?: number | null;
  sort_index?: number | null;
  variants?: string | null;
  also_released_as?: string | null;
  rom_name?: string | null;
  rom_crc?: string | null;
  canonical_release_id?: number | null;
  serial_code?: string | null;
  is_source_verified?: number;
  source?: string | null;
  physical_status?: PhysicalStatus;
  release_medium?: ReleaseMedium;
  origin_metadata?: string | null;
  metadata_json?: string | null;
  bundle_parent_id?: number | null;
  bundle_disc_number?: number | null;
  bundle_count?: number;
  verification_tier?: number;
  barcode?: string | null;
  disc_label?: string | null;
  companion_game_id?: string;
  companion_game_title?: string;
  is_companion_base_disc?: boolean;
  /** Detail view: individual physical media rows belonging to the currently viewed SKU. */
  releases?: GameRelease[];
  /** Detail view: alternate regional/variant releases belonging to the same Platform Game. */
  other_releases?: GameRelease[];
  bundled_games?: BundledGame[];
  shared_media_releases?: SharedMediaReleaseLink[];
  voucher_notes?: string[];
  /** Virtually grouped list view: structured list of all individual media items in this SKU. */
  mediaItems?: ReleaseMediaItem[];
  searchableNames?: string[];
  searchableSeries?: string[];
}

/** Semantic alias for raw 1-row-per-media catalog items returned by list/chunk APIs. */
export type CatalogMediaRow = Game;

/** Virtually merged Retail Release (SKU) view model containing 1+ structured media items. */
export interface RetailReleaseView extends Game {
  mediaItems: ReleaseMediaItem[];
}

export interface BundledGame {
  stable_id: number;
  id: string;
  title: string;
  platform_id: number;
  platform_name?: string;
  bundle_disc_number?: number;
  release_medium?: string;
  origin_metadata?: string | null;
  rom_name?: string | null;
  has_media?: number;
}

export interface Toy {
  stable_id: number;
  id: string;
  name: string;
  line: string;
  type: string;
  series_name: string;
  series_line: string;
  series?: string;
  release_date: string;
  ownership_status: OwnershipStatus;
  image_url: string;
  platform_id?: number;
  amiibo_id?: string;
  scl_url?: string;
  region?: string;
  verified?: boolean | number;
  metadata_json?: string;
  sort_index?: number;
  series_index?: number;
  details?: string | null;
  retail_price?: number | null;
  retail_regular_price?: number | null;
  retail_discount_pct?: number | null;
  retail_on_sale?: number | boolean | null;
  retail_store?: string | null;
  retail_url?: string | null;
  retail_updated_at?: string | null;
}

export function isItemAvailableAtRetail(item: {
  retail_price?: number | null;
  retail_url?: string | null;
  retail_on_sale?: number | boolean | null;
}): boolean {
  return Boolean(
    (item.retail_price && item.retail_price > 0) ||
    item.retail_url ||
    item.retail_on_sale,
  );
}

export interface ToySeriesGroup {
  seriesName: string;
  toys: Toy[];
  totalCount: number;
  catalogCount?: number;
  completionPct?: number;
}

export interface ToyGroup {
  lineName: string;
  seriesGroups: ToySeriesGroup[];
  totalCount: number;
  catalogCount?: number;
  completionPct?: number;
}

export interface Platform {
  id: number;
  name: string;
  display_name: string;
  parent_platform_id?: number;
  brand: string;
  launch_date: string;
  image_url: string;
}

export type ProvenanceStatusFilter =
  | 'all'
  | 'recorded'
  | 'missing'
  | 'missing_date'
  | 'missing_price'
  | 'exact_date'
  | 'approximate_date'
  | 'gifted'
  | 'free'
  | 'has_receipt'
  | 'has_notes';

export type ConditionFilter =
  | 'all'
  | 'cib'
  | 'boxed_only'
  | 'loose'
  | 'manual_only';

export type ReleaseDecadeFilter =
  | 'all'
  | '70s_80s'
  | '90s'
  | '00s'
  | '10s'
  | '20s';

export interface FilterState {
  ownership:
    | 'all'
    | 'seeking_or_unowned'
    | 'home_region_and_owned'
    | OwnershipStatus;
  play_status?: 'all' | PlayStatus;
  has_media?: 'all' | 0 | 1;
  physical_verified?: 'all' | 0 | 1;
  budget_label?:
    | 'all'
    | 'standard_only'
    | 'standard_and_budget'
    | 'budget_only';
  condition?: ConditionFilter;
  release_decade?: ReleaseDecadeFilter;
  platform_id?: number;
  regions?: string[];
  is_linked?: boolean;
  line?: string;
  type?: string;
  name?: string;
  nameExact?: boolean;
  series?: string;
  seriesExact?: boolean;
  tag?: string;
  tagExact?: boolean;
  seriesOrName?: string;
  deals_only?: boolean;
  retail_available?: boolean;
  provenance_status?: ProvenanceStatusFilter;
  provenance_source?: string;
  provenanceSourceExact?: boolean;
  acquired_year?: number | 'all' | 'undated';
  acquired_from?: string;
  acquired_to?: string;
  price_paid_min?: number | null;
  price_paid_max?: number | null;
  sortBy?:
    | 'default'
    | 'retail_asc'
    | 'discount_desc'
    | 'market_value_desc'
    | 'market_value_asc'
    | 'release_desc'
    | 'release_asc'
    | 'acquired_desc'
    | 'acquired_asc'
    | 'price_paid_desc'
    | 'price_paid_asc';
}

export interface PlatformGroup {
  brand: string;
  platforms: Platform[];
}

export type ViewMode = 'grid' | 'compact';

export interface ListState {
  tab: 'games' | 'toys';
  filters: FilterState;
  displayLimit: number;
  viewMode?: ViewMode;
  scrollX?: number;
  scrollY?: number;
}

export interface PhysicalAnnouncementScope {
  seeking?: boolean;
  uncataloged?: boolean;
  special_editions?: boolean;
  unowned?: boolean;
}

export interface DealNotificationPreferences {
  enabled: boolean;
  scope:
    | 'priority_seeking_only'
    | 'all_seeking'
    | 'seeking_only'
    | 'seeking_and_unowned'
    | 'all';
  minDiscountPct: number;
  maxPriceCents?: number | null;
  platformIds: number[];
  stores: string[];
  notify_game_releases?: boolean;
  notify_physical_announcements?: boolean;
  notify_watched_series?: boolean;
  physical_announcement_scope?: PhysicalAnnouncementScope;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  preferences?: DealNotificationPreferences;
}

export function isOpticalPlatform(
  platform: string | null | undefined,
): boolean {
  if (!platform) return false;
  const p = platform.toLowerCase();
  if (p.includes('vita') || p.includes('psv')) return false;
  return (
    p.includes('playstation') ||
    p.includes('ps1') ||
    p.includes('ps2') ||
    p.includes('ps3') ||
    p.includes('ps4') ||
    p.includes('ps5') ||
    p.includes('psx') ||
    p.includes('psp') ||
    p.includes('saturn') ||
    p.includes('sega cd') ||
    p.includes('mega-cd') ||
    p.includes('mega cd') ||
    p.includes('dreamcast') ||
    p.includes('gamecube') ||
    p.includes('gcn') ||
    p.includes('ngc') ||
    p.includes('wii') ||
    p.includes('xbox') ||
    p.includes('x360') ||
    p.includes('xb1') ||
    p.includes('xbsx') ||
    p.includes('3do') ||
    p.includes('cd-rom') ||
    p.includes('cd-i') ||
    p.includes('turbografx-cd') ||
    p.includes('turbografx cd') ||
    p.includes('pc engine cd') ||
    p.includes('pc-engine cd') ||
    p.includes('neo geo cd') ||
    p.includes('laseractive')
  );
}

export function getMediaIconName(
  platform: string | null | undefined,
  mediaOwned: boolean | number,
): 'disc' | 'rom-archive' | 'missing-dump' {
  if (!mediaOwned) return 'missing-dump';
  return isOpticalPlatform(platform) ? 'disc' : 'rom-archive';
}

export function getMediaNoun(
  platform: string | null | undefined,
  plural = false,
): string {
  const optical = isOpticalPlatform(platform);
  if (plural) return optical ? 'Discs' : 'Carts';
  return optical ? 'Disc' : 'Cart';
}

export function getOwnRecordValue<T>(
  record: Record<string, T>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

export const SERIES_CROSS_LANGUAGE_ALIASES: Record<string, string[]> = {
  'mega man': ['rockman', 'ロックマン'],
  rockman: ['mega man', 'ロックマン'],
  pokemon: ['pocket monsters', 'pokémon', 'ポケットモンスター'],
  pokémon: ['pocket monsters', 'pokemon', 'ポケットモンスター'],
  'pocket monsters': ['pokemon', 'pokémon', 'ポケットモンスター'],
  mario: ['super mario', 'マリオ'],
  'super mario': ['mario', 'マリオ'],
  'f-zero': ['f zero', 'エフゼロ'],
  'star fox': ['starwing', 'lylat wars', 'スターフォックス'],
  'resident evil': ['biohazard', 'バイオハザード'],
  biohazard: ['resident evil', 'バイオハザード'],
  castlevania: ['akumajou dracula', 'dracula', '悪魔城ドラキュラ'],
  'akumajou dracula': ['castlevania', '悪魔城ドラキュラ'],
  contra: ['probotector', 'gryzor', '魂斗羅'],
  'dragon quest': ['dragon warrior', 'ドラゴンクエスト'],
  'dragon warrior': ['dragon quest', 'ドラゴンクエスト'],
  mother: ['earthbound', 'マザー'],
  earthbound: ['mother', 'マザー'],
};

export function getSeriesCrossLanguageAliases(
  normSeries: string,
): string[] | undefined {
  return getOwnRecordValue(SERIES_CROSS_LANGUAGE_ALIASES, normSeries);
}

export interface JournalEntry {
  id: number;
  item_type: 'game' | 'toy';
  item_id: string;
  purchase_date?: string | null;
  is_approximate_date?: number | boolean | null;
  price_paid?: number | null;
  merchant?: string | null;
  gifted_by?: string | null;
  receipt_url?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const STANDARD_MERCHANTS: readonly string[] = [
  'Amazon',
  'eBay',
  'Best Buy',
  'GameStop',
  'Target',
  'Walmart',
  'Toys "R" Us',
  'Limited Run Games',
  'Play-Asia',
  'Video Games Plus',
  'PNP Games',
  'Fangamer',
  'iam8bit',
  'Super Rare Games',
  'Strictly Limited Games',
  'Special Reserve Games',
  'Square Enix Store',
  'Nintendo Store',
  'Club Nintendo',
  'My Nintendo',
  'Sony Rewards',
  'NIS America',
  'Atlus Shop',
  'NewEgg',
  'Groupon',
  'Kickstarter',
  'BackerKit',
];

const FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Formats an acquisition date with support for approximate ("Around ...") dates:
 * - "2013" -> "Around 2013"
 * - "2009-06" -> "Around June 2009"
 * - "2021-02-10" (exact) -> "Feb 10, 2021"
 * - "2021-02-10" (isApproximate=true) -> "Around Feb 10, 2021"
 */
export function formatJournalDate(
  dateStr?: string | null,
  isApproximate?: number | boolean | null,
): string {
  if (!dateStr) return 'Unrecorded';
  let cleaned = dateStr.trim();
  if (!cleaned) return 'Unrecorded';

  let approx = Boolean(isApproximate);
  if (/^(~|around\s+|circa\s+)/i.test(cleaned)) {
    approx = true;
    cleaned = cleaned.replace(/^(~|around\s+|circa\s+)/i, '').trim();
  }

  if (/^\d{4}$/.test(cleaned)) {
    return `Around ${cleaned}`;
  }

  const ymMatch = cleaned.match(/^(\d{4})-(\d{2})$/);
  if (ymMatch) {
    const year = ymMatch[1];
    const monthIndex = parseInt(ymMatch[2], 10) - 1;
    const monthName = FULL_MONTH_NAMES[monthIndex] || ymMatch[2];
    return `Around ${monthName} ${year}`;
  }

  const ymdMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const monthIndex = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const shortMonth = SHORT_MONTH_NAMES[monthIndex] || ymdMatch[2];
    const formatted = `${shortMonth} ${day}, ${year}`;
    return approx ? `Around ${formatted}` : formatted;
  }

  return approx ? `Around ${cleaned}` : cleaned;
}

/**
 * DEFAULT USER HOME REGION
 * Currently defaults to 'USA'.
 * In the future, this should be sourced from the authenticated user's profile settings
 * to provide multi-user / personalized regional scoping.
 */
export const DEFAULT_USER_HOME_REGION = 'USA';

/**
 * Regional hierarchy lookup map.
 * Defines which broader geographical regions encompass each country or sub-region.
 * Note: 'World' contains all regions by definition and is evaluated directly.
 */
const REGION_ANCESTORS: Record<string, string[]> = {
  // North America
  usa: ['north america', 'americas'],
  canada: ['north america', 'americas'],
  mexico: ['north america', 'americas', 'latin america'],

  // Europe & European countries
  uk: ['europe', 'pal'],
  'united kingdom': ['europe', 'pal'],
  ireland: ['europe', 'pal'],
  france: ['europe', 'pal'],
  germany: ['europe', 'pal'],
  italy: ['europe', 'pal'],
  spain: ['europe', 'pal'],
  portugal: ['europe', 'pal'],
  netherlands: ['europe', 'pal'],
  austria: ['europe', 'pal'],
  switzerland: ['europe', 'pal'],
  sweden: ['europe', 'scandinavia', 'pal'],
  norway: ['europe', 'scandinavia', 'pal'],
  denmark: ['europe', 'scandinavia', 'pal'],
  finland: ['europe', 'scandinavia', 'pal'],
  scandinavia: ['europe', 'pal'],
  poland: ['europe', 'pal'],
  russia: ['europe'],
  greece: ['europe', 'pal'],
  turkey: ['europe'],

  // Asia
  japan: ['asia'],
  korea: ['asia'],
  china: ['asia'],
  taiwan: ['asia'],
  'hong kong': ['asia'],

  // Oceania
  australia: ['oceania', 'pal'],
  'new zealand': ['oceania', 'pal'],

  // Americas
  brazil: ['americas', 'latin america'],
  'latin america': ['americas'],
};

/**
 * Checks whether an item's region tag matches the user's home region, taking
 * regional hierarchies and superset containers into account.
 *
 * Rules:
 * - Empty / null item region is considered not matching.
 * - If an item is labeled 'World', it satisfies all home regions.
 * - If an item region exactly matches the home region (case-insensitive), it matches.
 * - If an item region is a recognized ancestor of the home region (e.g. item is 'Europe'
 *   and home region is 'UK', or item is 'North America' and home region is 'USA'), it matches.
 * - Handles comma-separated multi-region strings (e.g. 'USA, Europe', 'Japan, Asia').
 *
 * @param itemRegion The comma-delimited or single region from the game/toy (e.g. 'USA', 'World', 'Europe').
 * @param homeRegion The user's home region (defaults to DEFAULT_USER_HOME_REGION = 'USA').
 */
export function isRegionMatchingHome(
  itemRegion: string | null | undefined,
  homeRegion: string = DEFAULT_USER_HOME_REGION,
): boolean {
  if (!itemRegion) return false;
  const cleanHome = homeRegion.trim().toLowerCase();
  if (!cleanHome) return false;

  const itemTokens = itemRegion
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  if (itemTokens.length === 0) return false;

  // 'World' contains everything
  if (itemTokens.includes('world')) {
    return true;
  }

  // Direct match
  if (itemTokens.includes(cleanHome)) {
    return true;
  }

  // Check if any item token is an ancestor region containing the home region
  const homeAncestors = getOwnRecordValue(REGION_ANCESTORS, cleanHome) || [];
  for (const ancestor of homeAncestors) {
    if (itemTokens.includes(ancestor)) {
      return true;
    }
  }

  // Also check reverse if the user's home region is a broader region (e.g. user set home to 'Europe')
  // and the item is tagged with a sub-region (e.g. 'UK')
  for (const token of itemTokens) {
    const tokenAncestors = getOwnRecordValue(REGION_ANCESTORS, token) || [];
    if (tokenAncestors.includes(cleanHome)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes a raw budget edition token into a standard canonical budget label string.
 */
export function normalizeBudgetToken(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (
    /^Greatest Hits$/i.test(t) ||
    /^Double Pack Greatest Hits$/i.test(t) ||
    /:\s*Greatest Hits$/i.test(t) ||
    /\(Greatest Hits\)$/i.test(t)
  ) {
    return 'Greatest Hits';
  }
  if (
    /^Platinum Hits$/i.test(t) ||
    /^Best of Platinum Hits$/i.test(t) ||
    /^Platinum Family Hits$/i.test(t) ||
    /\(Platinum Hits\)$/i.test(t) ||
    /:\s*Platinum Hits$/i.test(t)
  ) {
    return 'Platinum Hits';
  }
  if (
    /^Platinum$/i.test(t) ||
    /^Platinum - Twin Pack$/i.test(t) ||
    /^Platinum:\s*(?:The Best of|EA Most Wanted)/i.test(t)
  ) {
    return 'Platinum';
  }
  if (/^Platinum Collection$/i.test(t) || /\(Platinum Collection\)$/i.test(t)) {
    return 'Platinum Collection';
  }
  if (/^Player's Choice/i.test(t) || /^Players Choice/i.test(t)) {
    return "Player's Choice";
  }
  if (/^Nintendo Selects$/i.test(t)) {
    return 'Nintendo Selects';
  }
  if (/^PlayStation Hits$/i.test(t)) {
    return 'PlayStation Hits';
  }
  if (
    /^Xbox Classics$/i.test(t) ||
    /^Classics$/i.test(t) ||
    /^Classic$/i.test(t) ||
    /\(Classics\)$/i.test(t)
  ) {
    return 'Xbox Classics';
  }
  if (
    /^(?:PSP\s+|PS3\s+|PlayStation\s+)?Essentials$/i.test(t) ||
    /Classics HD:\s*Essentials/i.test(t)
  ) {
    return 'Essentials';
  }
  if (/^Favorites$/i.test(t) || /^Favourites$/i.test(t)) return 'Favorites';
  if (/^Sega All Stars$/i.test(t)) return 'Sega All Stars';
  if (/^PS\s*one Books$/i.test(t)) return 'PSone Books';
  if (
    /\bthe Best(?:\s+for\s+Family)?$/i.test(t) ||
    /^EA Best Hits$/i.test(t) ||
    /^Satakore$/i.test(t) ||
    /^DreKore$/i.test(t) ||
    /^BigHit Series$/i.test(t) ||
    /^Happy Price Selection$/i.test(t)
  ) {
    return t;
  }
  return null;
}

export interface UserProfile {
  id: number;
  email?: string | null;
  username: string;
  role: 'admin' | 'user';
  isPublic: boolean;
  homeRegion: string;
  displayName: string | null;
  bio: string | null;
  autoTrackSeriesOnAdd?: boolean;
  trackIndividualMedia?: boolean;
}

export interface UserTrackingRule {
  user_id?: number;
  rule_type: 'series' | 'platform' | 'toy_line' | 'toy_series';
  match_value?: string;
  target_value?: string;
  target_status?: number;
  auto_status?: number;
  region_scope?: 'home' | 'any';
  is_ignored: number;
  created_at?: string;
}

export interface CatalogSeedStatus {
  paused: boolean;
  stage: '2A' | '2B' | 'done' | string;
  cursor: number;
  cursorId?: number;
  dailyWriteBudget: number;
  writesUsedToday: number;
  dailyWritesUsed?: number;
  dailyDate?: string;
  gamesIngestedToday?: number;
  releasesIngestedToday?: number;
  lastUpdatedAt?: string | null;
  canonicalMinId?: number;
  canonicalMaxId?: number;
  currentPlatformName?: string | null;
  maxGameStableId?: number;
  igdbBackfill?: {
    cursor: number;
    lastWrapDate: string | null;
    matchedTotal: number;
    rulesAppliedTotal: number;
    lastRunAt: string | null;
  };
  igdbRolling?: {
    cursorOffset: number;
    refreshedTotal: number;
    updatedTotal: number;
    selfHealedRulesTotal: number;
    lastRunAt: string | null;
  };
  upstreamSources?: {
    switchRevisionsUpdatedAt: string | null;
    amiiboCatalogUpdatedAt: string | null;
  };
  seriesDiscovery?: {
    cursor: number;
    totalSeriesRules: number;
    seriesScannedTotal: number;
    discoveredGamesTotal: number;
    lastRunAt: string | null;
  };
}

/**
 * Formats a toy's comma-separated region list for card/row badges.
 * Preserves the full verifiable region list (e.g. 'USA, Europe, Japan, Australia', 'Japan', 'USA').
 */
export function formatToyRegionBadge(
  region: string | null | undefined,
): string {
  if (!region) return 'USA';
  const trimmed = region.trim();
  return trimmed || 'USA';
}

export interface PublicUserProfile {
  username: string;
  displayName: string | null;
  bio: string | null;
  homeRegion: string;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: UserProfile | null;
  oidcIssuer?: string | null;
  oidcClientId?: string | null;
  accountHubUrl?: string | null;
  provisioned?: boolean;
  email?: string;
  degraded?: boolean;
  degradedReason?: string;
  snapshotTimestamp?: string | null;
}

export interface CatalogManifest {
  version: string;
  timestamp: string;
  totalRows: number;
  chunkSize: number;
  chunkCount: number;
  maxStableId: number;
  toysTotalRows?: number;
  toysChunkCount?: number;
}

export interface UserCollectionOverlayResponse {
  version: string;
  timestamp: string;
  maxStableId?: number;
  ugr: Array<{
    release_id: string;
    ownership_status: number;
    has_media?: number;
    has_case: number;
    has_manual: number;
  }>;
  ug: Array<{
    game_id: number;
    play_status: number;
    queued: number;
  }>;
  ut?: Array<{
    toy_id: string;
    ownership_status: number;
  }>;
  deltaGames?: Game[];
}

export interface CatalogSyncProgress {
  active: boolean;
  loadedRows: number;
  totalRows: number;
  loadedChunks: number;
  totalChunks: number;
  percent: number;
}

export {
  type EphemeralMarketPrice,
  type EbaySampleListing,
  type MarketPriceConfidence,
  type MarketPriceConditionBucket,
  type MarketPriceItemType,
  EBAY_PRICE_TTL_MS,
  PRICE_CACHE_SHARD_COUNT,
  getMarketPriceKey,
  getPriceShardIndex,
  computeItemEstimatedValueCents,
  isMarketPriceFresh,
  formatPriceAge,
} from '../../../../shared/market_pricing';

export interface EbayRateLimitSnapshot {
  limit: number;
  remaining: number;
  count: number;
  reset: string | null;
  timeWindowSeconds: number;
}

export interface MarketPricingRateLimitStatus {
  configured: boolean;
  ebayRateLimit: EbayRateLimitSnapshot | null;
  cachedCount: number;
  shardCount: number;
  ttlHours: number;
}

export interface MarketPriceScanProgress {
  active: boolean;
  scopeLabel: string;
  totalItems: number;
  completedItems: number;
  cacheHits: number;
  fetchedCount: number;
  errorCount: number;
  rateLimited: boolean;
  cancelled: boolean;
  lastError: string | null;
  cooldownSecondsRemaining?: number;
  waitingForWake?: boolean;
  wakeLockActive?: boolean;
  statusMessage?: string | null;
}

/**
 * Returns the structured list of physical media items for a game release row,
 * falling back to a single-item entry derived from `id` and `has_media` when
 * inspecting an ungrouped `CatalogMediaRow`.
 */
export function getReleaseMediaItems(game: Game): ReleaseMediaItem[] {
  if (Array.isArray(game.mediaItems) && game.mediaItems.length > 0) {
    return game.mediaItems;
  }
  if (!game.id) {
    return [];
  }
  const noun = getMediaNoun(game.display_name || game.platform, false);
  return [
    {
      id: game.id,
      label: noun,
      hasMedia: game.has_media ? 1 : 0,
      romName: game.rom_name ?? null,
      romCrc: game.rom_crc ?? null,
    },
  ];
}

export function getOwnedMediaCount(game: Game): number {
  return getReleaseMediaItems(game).filter((m) => m.hasMedia === 1).length;
}

export function getTotalMediaCount(game: Game): number {
  return getReleaseMediaItems(game).length || 1;
}

export function getMissingMediaCount(game: Game): number {
  return Math.max(0, getTotalMediaCount(game) - getOwnedMediaCount(game));
}

export function isMultiMediaRelease(game: Game): boolean {
  return getReleaseMediaItems(game).length > 1;
}
