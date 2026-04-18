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
    brand?: string;
    platform_launch_date?: string;
    platform_logo?: string;
}

export interface Figure {
    id: string;
    name: string;
    line: string;
    type: string;
    series_name: string;
    series_line: string;
    release_date: string;
    owned: boolean | number;
    image_url: string;
    platform_id?: number;
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
    options: DiscoveryOption[];
}

export interface DiscoveryPayload {
    currentTitle: string;
    currentPlatform: string;
    selectedIgdbId: string | number;
    selectedName: string;
    region: string;
}

export interface FilterState {
  ownership: 'all' | 'owned' | 'wanted';
  platform_id?: number;
  region?: string;
  is_linked?: boolean;
  line?: string;
  type?: string;
  series?: string;
}

export interface PlatformGroup {
  brand: string;
  platforms: Platform[];
}

export interface ListState {
  tab: 'games' | 'figures';
  filters: FilterState;
  displayLimit: number;
}
