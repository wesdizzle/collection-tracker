/**
 * CORE COLLECTION MODELS
 * 
 * Centralized high-performance interfaces for the Collection Tracker.
 * Resolves circular dependencies between services and components.
 */

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
    owned: boolean | number;
    played: boolean | number;
    backed_up: boolean | number;
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
    owned: boolean | number;
    image_url: string;
    platform_id?: number;
    amiibo_id?: string;
    scl_url?: string;
    region?: string;
    verified?: boolean | number;
    metadata_json?: string;
    sort_index?: number;
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
  ownership: 'all' | 'owned' | 'wanted';
  platform_id?: number;
  region?: string;
  is_linked?: boolean;
  line?: string;
  type?: string;
  series?: string;
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
