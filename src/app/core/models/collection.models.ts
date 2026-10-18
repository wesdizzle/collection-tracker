/**
 * CORE COLLECTION MODELS
 *
 * Centralized high-performance interfaces for the Collection Tracker.
 * Resolves circular dependencies between services and components.
 */

export enum OwnershipStatus {
  Unowned = 0,
  Owned = 1,
  Seeking = 2,
  Ordered = 3,
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
  | 'announced_unreleased'
  | 'physical_pending'
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

export interface GameRelease {
  id: string;
  game_id: number;
  region?: string | null;
  variants?: string | null;
  also_released_as?: string | null;
  rom_name?: string | null;
  rom_crc?: string | null;
  backup_status: number;
  ownership_status: number;
  release_date?: string | null;
  image_url?: string | null;
  canonical_release_id?: number | null;
  barcode?: string | null;
  is_physical?: boolean | number;
  has_case?: boolean | number;
  has_manual?: boolean | number;
  disc_label?: string | null;
  is_companion_base_disc?: boolean;
  companion_game_id?: string;
  companion_game_title?: string;
}

export interface SharedBackupReleaseLink {
  id: string;
  title: string;
  region?: string | null;
  variants?: string | null;
  rom_name?: string | null;
  ownership_status: number;
  backup_status: number;
}

export interface Game {
  stable_id: number;
  id: string; // The durable slug: game-title-platform-name
  game_id?: string | null; // Grouped game slug reference
  title: string;
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
  backup_status: boolean | number;
  has_case?: boolean | number;
  has_manual?: boolean | number;
  gameye_id?: number | null;
  gameye_platform_id?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_updated_at?: string | null;
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
  physical_status?: PhysicalStatus;
  release_medium?: ReleaseMedium;
  origin_metadata?: string | null;
  bundle_parent_id?: number | null;
  bundle_disc_number?: number | null;
  bundle_count?: number;
  verification_tier?: number;
  barcode?: string | null;
  disc_label?: string | null;
  companion_game_id?: string;
  companion_game_title?: string;
  is_companion_base_disc?: boolean;
  releases?: GameRelease[];
  bundled_games?: BundledGame[];
  shared_backup_releases?: SharedBackupReleaseLink[];
  voucher_notes?: string[];
  discIds?: string[];
  discBackups?: number[];
  discRomNames?: string[];
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
  backup_status?: number;
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
  gameye_id?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_updated_at?: string | null;
}

export interface ToySeriesGroup {
  seriesName: string;
  toys: Toy[];
  totalCount: number;
  totalValue?: number;
}

export interface ToyGroup {
  lineName: string;
  seriesGroups: ToySeriesGroup[];
  totalCount: number;
  totalValue?: number;
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

export interface DiscoveryOption {
  name: string;
  platform: string;
  id: string;
  image_url: string | null;
  summary: string | null;
}

export interface DiscoveryItem {
  title: string;
  platform: string;
  line?: string;
  series?: string;
  options: DiscoveryOption[];
}

export interface DiscoveryPayload {
  currentTitle: string;
  currentPlatform: string;
  currentLine?: string;
  currentSeries?: string;
  selectedIgdbId: string | number;
  selectedName: string;
  selectedPlatform: string;
  region: string;
  summary?: string;
  imageUrl?: string;
}

export interface FilterState {
  ownership: 'all' | 'seeking_or_unowned' | 'upcoming' | OwnershipStatus;
  play_status?: 'all' | PlayStatus;
  backup_status?: 'all' | 0 | 1;
  physical_verified?: 'all' | 0 | 1;
  media_type?: 'physical_only' | 'all' | 'digital_extracted';
  budget_label?:
    | 'all'
    | 'standard_only'
    | 'standard_and_budget'
    | 'budget_only';
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
  sortBy?:
    | 'default'
    | 'value_desc'
    | 'value_asc'
    | 'retail_asc'
    | 'discount_desc';
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

export interface DiscoveryRelease {
  name: string;
  romName: string;
  romCrc: string | null;
  region: string | null;
  variants: string | null;
  releaseDate: string | null;
  canonical_release_id?: number | null;
  serial_code?: string | null;
  barcode?: string | null;
  is_physical?: boolean | number;
}

export interface IGDBSearchResult {
  id: string | number;
  name: string;
  platform: string;
  platform_id?: number;
  image_url: string | null;
  summary?: string | null;
  genres?: string | null;
  igdb_url?: string | null;
  collections?: string | null;
  franchises?: string | null;
  region?: string | null;
  ownership_status?: number;
  play_status?: number;
  backup_status?: number;
  physical_status?: PhysicalStatus;
  verification_tier?: number;
  is_physical?: boolean;
  physical_regions?: string[];
  matched_releases?: DiscoveryRelease[];
  verification_reasons?: string[];
  first_release_date?: string | null;
}

export interface ScanSuggestion {
  id: string | number;
  title: string;
  platform: string;
  platform_id: number;
  image_url: string | null;
  summary?: string | null;
  collections?: string | null;
  franchises?: string | null;
  genres?: string | null;
  igdb_url?: string | null;
  region?: string | null;
  releases: DiscoveryRelease[];
  physical_status?:
    | 'verified_physical'
    | 'likely_physical'
    | 'digital_only'
    | 'unverified';
  verification_tier?: number;
  is_physical?: boolean;
  physical_regions?: string[];
  verification_reasons?: string[];
}

export interface AmiiboDiscoveryItem {
  id: string;
  amiibo_id: string;
  name: string;
  line: string;
  series_name: string;
  game_series?: string | null;
  type: string;
  image_url: string;
  release_date?: string | null;
  region?: string | null;
}

export interface PagedScanSeriesResult {
  suggestions: ScanSuggestion[];
  offset: number;
  limit: number;
  totalSeries: number;
  hasMore: boolean;
}

export interface PhysicalAnnouncementScope {
  seeking?: boolean;
  watch_physical?: boolean;
  uncataloged?: boolean;
  special_editions?: boolean;
  unowned?: boolean;
}

export interface DealNotificationPreferences {
  enabled: boolean;
  scope: 'seeking_only' | 'seeking_and_unowned' | 'all';
  minDiscountPct: number;
  maxPriceCents?: number | null;
  platformIds: number[];
  stores: string[];
  notify_game_releases?: boolean;
  notify_physical_announcements?: boolean;
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
  backedUp: boolean | number,
): 'disc' | 'rom-archive' | 'missing-dump' {
  if (!backedUp) return 'missing-dump';
  return isOpticalPlatform(platform) ? 'disc' : 'rom-archive';
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
