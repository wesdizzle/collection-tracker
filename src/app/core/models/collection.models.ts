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

export interface Game {
  stable_id: number;
  id: string; // The durable slug: game-title-platform-name
  title: string;
  series: string;
  canonical_series: string;
  release_date: string;
  platform: string;
  platform_id: number;
  igdb_id?: number;
  region?: string;
  display_name?: string;
  ownership_status: OwnershipStatus;
  play_status: PlayStatus;
  backup_status: boolean | number;
  image_url: string;
  summary?: string;
  genres?: string;
  collections?: string;
  franchises?: string;
  brand?: string;
  platform_launch_date?: string;
  platform_logo?: string;
  pricecharting_url?: string;
  parent_platform_id?: number;
  sort_index?: number;
  variants?: string;
  rom_name?: string;
  rom_crc?: string;
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
}

export interface ToySeriesGroup {
  seriesName: string;
  toys: Toy[];
  totalCount: number;
}

export interface ToyGroup {
  lineName: string;
  seriesGroups: ToySeriesGroup[];
  totalCount: number;
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
  ownership: 'all' | OwnershipStatus;
  play_status?: 'all' | PlayStatus;
  backup_status?: 'all' | 0 | 1;
  platform_id?: number;
  regions?: string[];
  is_linked?: boolean;
  line?: string;
  type?: string;
  seriesOrName?: string;
  seriesExact?: boolean;
}

export interface PlatformGroup {
  brand: string;
  platforms: Platform[];
}

export interface ListState {
  tab: 'games' | 'toys';
  filters: FilterState;
  displayLimit: number;
  scrollX?: number;
  scrollY?: number;
}
