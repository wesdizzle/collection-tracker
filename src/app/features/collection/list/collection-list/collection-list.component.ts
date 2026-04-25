/**
 * COLLECTION LIST COMPONENT
 * 
 * The primary view for browsing the user's game and toy collection.
 * It provides a high-performance, infinite-scrolling grid with sophisticated 
 * grouping and filtering capabilities.
 * 
 * DESIGN RATIONALE:
 * - **State Persistence**: Uses an effect and HostListener to synchronize the UI 
 *   state (filters, scroll position) with the CollectionService. This enables a 
 *   "browser-like" navigation experience where the user never loses their place.
 * - **Infinite Scrolling**: Implements an IntersectionObserver pattern to lazily 
 *   increase the 'displayLimit' signal, ensuring the DOM remains lean and the 
 *   initial paint is fast even for thousands of items.
 * - **Normalization**: Series filtering uses a diacritic-insensitive normalization 
 *   heuristic to handle international titles and variations (e.g. Pokémon vs Pokemon).
 * - **Retry-based Scroll Restoration**: Accounts for the asynchronous nature of 
 *   Angular rendering by attempting to restore scroll position over several frames.
 */

import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, signal, computed, effect, HostListener } from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Platform, FilterState, PlatformGroup, ToyGroup, ListState } from '../../../../core/models/collection.models';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';

interface GameGroup {
  platformName: string;
  platformLogo?: string;
  launchYear?: string;
  games: Game[];
  totalCount: number;
}

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [RouterModule, CollectionFiltersComponent],
  template: `
    <div class="animate-expressive" data-version="final-v12">
      <app-collection-filters
        [currentTab]="currentTab()"
        [platformGroups]="platformGroups()"
        [filters]="filters()"
        [uniqueLines]="uniqueLines()"
        [uniqueTypes]="uniqueTypes()"
        [uniqueSeries]="uniqueSeries()"
        [resultCount]="currentTab() === 'games' ? filteredGames().length : filteredToys().length"
        (filtersChange)="onFiltersChange($event)">
      </app-collection-filters>
    
      @if (currentTab() === 'games') {
        <div class="groups-container animate-expressive animate-stagger-2">
          @for (group of groupedGames(); track group.platformName) {
            <div class="platform-section mb-xl">
              <header class="platform-header">
                <div class="header-content">
                  <div class="platform-logo-frame">
                    @if (group.platformLogo) {
                      <img [src]="group.platformLogo" [alt]="group.platformName" class="platform-logo">
                    } @else {
                      <div class="platform-logo-placeholder">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                          <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3-3c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                        </svg>
                      </div>
                    }
                  </div>
                  <h2 class="platform-title">
                    {{ group.platformName }}
                    @if (group.launchYear) {
                      <span class="platform-year">({{ group.launchYear }})</span>
                    }
                  </h2>
                  <div class="platform-badge">{{ group.totalCount }} Items</div>
                </div>
              </header>
              
              <div class="grid">
                @for (game of group.games; track game.id) {
                  <a [routerLink]="['/collection', 'game', game.id]" 
                     class="m3-card m3-card-elevated state-layer flex flex-col overflow-hidden">
                    <div class="card-art-frame">
                      @if (game.image_url) {
                        <img 
                          [src]="game.image_url" 
                          alt="Cover" 
                          class="card-art"
                          loading="lazy"
                          decoding="async">
                      } @else {
                        <div class="card-art-placeholder text-secondary text-2xs uppercase letter-spacing-wide">
                          No Image
                        </div>
                      }
                      <div class="region-flag" [title]="'Region: ' + game.region">
                        {{ game.region }}
                      </div>
                    </div>
                    
                    <div class="card-content">
                      <div class="content-header">
                        <div class="flex gap-2xs items-center">
                          @if (game.igdb_id) {
                            <span class="igdb-icon" title="Verified by IGDB">🆔</span>
                          }
                          @if (game.pricecharting_url) {
                            <span class="physical-badge" title="Physical Release Verified">📦</span>
                          }
                        </div>
                        @if (game.release_date) {
                          <span class="release-year">{{ game.release_date.substring(0, 4) }}</span>
                        }
                      </div>
                      <h3 class="card-title">{{game.title}}</h3>
                      @if (game.canonical_series) {
                        <div class="card-subtitle" title="Series">{{game.canonical_series}}</div>
                      }
                    </div>
                  </a>
                }
              </div>
            </div>
          }
        </div>
      }
    
      @if (currentTab() === 'toys') {
        <div class="groups-container animate-expressive animate-stagger-2">
          @for (group of groupedToys(); track group.lineName) {
            <div class="platform-section mb-xl">
              <header class="platform-header">
                <div class="header-content">
                  <div class="platform-logo-frame">
                    <div class="platform-logo-placeholder">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
                      </svg>
                    </div>
                  </div>
                  <h2 class="platform-title uppercase letter-spacing-wide">
                    {{ group.lineName }}
                  </h2>
                  <div class="platform-badge">{{ group.totalCount }} Items</div>
                </div>
              </header>
  
              <div class="grid">
                @for (toy of group.toys; track toy.id) {
                  <a [routerLink]="['/collection', 'toy', toy.id]" 
                     class="m3-card m3-card-elevated state-layer flex flex-col overflow-hidden">
                    <div class="card-art-frame toy-frame">
                      @if (toy.image_url) {
                        <img 
                          [src]="toy.image_url" 
                          alt="Toy" 
                          class="card-art toy-art"
                          loading="lazy"
                          decoding="async">
                      } @else {
                        <div class="card-art-placeholder text-secondary text-2xs uppercase letter-spacing-wide">
                          No Image
                        </div>
                      }
                      <div class="region-flag" [title]="'Region: ' + toy.region">
                        {{ toy.region }}
                      </div>
                    </div>
  
                    <div class="card-content">
                      <div class="content-header">
                        <div class="flex gap-2xs items-center">
                          @if (toy.verified) {
                            <span class="igdb-icon" title="Verified Metadata">✨</span>
                          }
                          <span class="release-year">{{ toy.type }}</span>
                        </div>
                        @if (toy.release_date) {
                          <span class="release-year">{{ toy.release_date.substring(0, 4) }}</span>
                        }
                      </div>
                      <div class="text-2xs text-secondary font-medium uppercase letter-spacing-wide">{{toy.line}}</div>
                      <h3 class="card-title mt-2xs">{{toy.name}}</h3>
                      @if (toy.series_name) {
                        <div class="card-subtitle" title="Series">{{toy.series_name}}</div>
                      }
                    </div>
                  </a>
                }
              </div>
            </div>
          }
        </div>
      }
    
      <div #scrollTrigger class="scroll-trigger" style="height: 50px; width: 100%;"></div>
    </div>
    `,
  styles: [`
    .mb-xl { margin-bottom: 4rem; }
    .mb-md { margin-bottom: 1.25rem; }
    .p-md { padding: 1rem; }
    .gap-xs { gap: 0.5rem; }
    .gap-2xs { gap: 0.25rem; }
 
    .platform-header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--m3-surface);
      padding: 1rem 0;
      margin-bottom: 1.5rem;
    }
 
    .header-content {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem 1.25rem;
      background: var(--m3-surface-container-high);
      border-radius: var(--radius-xl);
      border: 1px solid var(--m3-outline-variant);
    }
 
    .platform-logo-frame {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--m3-surface-container-highest);
      border-radius: 8px;
      padding: 0.25rem;
    }
 
    .platform-logo { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)); }
    .platform-logo-placeholder { font-weight: 700; color: var(--m3-primary); font-family: var(--font-heading); }
    .platform-title { font-size: 1.25rem; font-weight: 600; color: var(--m3-on-surface); flex: 1; display: flex; align-items: center; gap: var(--spacing-8); }
    .platform-year { font-size: 0.9rem; font-weight: 400; color: var(--m3-on-surface-variant); opacity: 0.8; }
    
    .platform-badge {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--m3-on-secondary-container);
      background: var(--m3-secondary-container);
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
    }
 
    .grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); 
      gap: 1.25rem; 
    }
 
    @media (max-width: 480px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 0.75rem;
      }
    }
 
    .card-art-frame { 
      width: 100%; 
      aspect-ratio: 3/4; 
      background: var(--m3-surface-container-highest); 
      overflow: hidden; 
      position: relative; 
    }
    
    .card-art { width: 100%; height: 100%; object-fit: cover; }
    
    .region-flag {
      position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.2rem 0.4rem;
      background: rgba(0,0,0,0.8); border-radius: 4px; font-size: 0.6rem; font-weight: 700;
      color: #fff; z-index: 2;
    }
 
    .toy-frame {
      background: radial-gradient(circle at center, var(--m3-surface-container-highest), var(--m3-surface-container-high));
      padding: 1rem;
    }
 
    .toy-art {
      object-fit: contain !important;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
    }
 
    .card-content {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
 
    .content-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
    }
 
    .card-title {
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.3;
      color: var(--m3-on-surface);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
 
    .card-subtitle {
      font-size: 0.75rem;
      color: var(--m3-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
 
    .release-year {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--m3-on-primary-container);
      background: var(--m3-primary-container);
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      letter-spacing: 0.02em;
    }
 
    .igdb-icon { font-size: 0.8rem; }
    .physical-badge { font-size: 0.8rem; }
  `]
})
export class CollectionListComponent implements OnInit, AfterViewInit, OnDestroy {
  private collectionService = inject(CollectionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private observer?: IntersectionObserver;
  @ViewChild('scrollTrigger') scrollTrigger?: ElementRef;
 
  private restorationPending = true;
  private stateInitialized = false;

  /** --- Reactive Application State --- */
  public currentTab = signal<'games' | 'toys'>('games');
  public filters = signal<FilterState>({ ownership: 'owned', platform_id: undefined, line: '', type: '', series: '', seriesExact: false });
  public displayLimit = signal<number>(100);
 
  /**
   * Computes a grouped list of platforms for use in the filter dropdown.
   * Groups by 'brand' (e.g. Nintendo, Sony) to improve selection ergonomics.
   */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();
    
    [...data].forEach(p => {
      const b = p.brand || 'Other';
      if (!grouped.has(b)) grouped.set(b, []);
      grouped.get(b)!.push(p);
    });
    
    return Array.from(grouped.entries()).map(([brand, platforms]) => ({ brand, platforms }));
  });
 
  /**
   * Reactive pipeline that applies active filters to the full games collection.
   * Handles ownership, platform, region, and series matching.
   */
  public filteredGames = computed(() => {
    const allGames = this.collectionService.games();
    const f = this.filters();
    return allGames.filter(g => {
      // Basic Ownership Filter
      const isOwned = g.owned === 1 || g.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;
 
      // Platform Filter (Checks both direct platform and parent platform for cross-compatible hardware)
      if (f.platform_id) {
        if (g.platform_id !== f.platform_id && g.parent_platform_id !== f.platform_id) return false;
      }
 
      // Region Filter
      if (f.region && g.region !== f.region) return false;
 
      // Linked Status Filter (IGDB connectivity)
      if (f.is_linked !== undefined) {
        const hasIgdb = !!g.igdb_id;
        if (f.is_linked !== hasIgdb) return false;
      }
 
      // Series Filter (Case & Accent Insensitive)
      if (f.series) {
        const normalizedFilter = this.normalizeString(f.series);
        const normalizedSeries = this.normalizeString(g.canonical_series || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedFilter)) return false;
        }
      }
 
      return true;
    }).sort((a, b) => {
      /**
       * DESIGN RATIONALE: Client-side Sorting
       * We perform the "strict" sort in TypeScript rather than SQL for several reasons:
       * 1. Natural Language Sorting: Stripping articles (A/An/The) and diacritics is 
       *    significantly more complex and brittle in SQLite/D1 than in JS.
       * 2. Reactivity: Ensures the list remains perfectly ordered even after client-side 
       *    filters (like search text) are applied to the cached signals.
       * 3. Consistency: Guarantees identical behavior across local dev (SQLite) and 
       *    production (Cloudflare D1) despite potential collation differences.
       */

      // 1. Platform Launch Date (ASC)
      const dateA = a.platform_launch_date || '9999-99-99';
      const dateB = b.platform_launch_date || '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      // 2. Platform Brand (ASC)
      const brandA = this.normalizeForSort(a.brand || '');
      const brandB = this.normalizeForSort(b.brand || '');
      if (brandA !== brandB) return brandA.localeCompare(brandB);

      // 3. Game Canonical Series (ASC, fallback to title)
      const seriesA = this.normalizeForSort(a.canonical_series || a.title);
      const seriesB = this.normalizeForSort(b.canonical_series || b.title);
      if (seriesA !== seriesB) return seriesA.localeCompare(seriesB);

      // 4. Game Release Date (ASC, nulls last)
      const relA = a.release_date || '9999-99-99';
      const relB = b.release_date || '9999-99-99';
      if (relA !== relB) return relA.localeCompare(relB);

      // 5. Sort Index (ASC, nulls last)
      const sortA = a.sort_index ?? 9999;
      const sortB = b.sort_index ?? 9999;
      return sortA - sortB;
    });
  });
 
  /**
   * Normalizes a string by removing diacritics and converting to lowercase.
   * Crucial for supporting international titles (e.g. Pokémon) in search.
   * 
   * @param str The string to normalize.
   * @returns The normalized string.
   */
  private normalizeString(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Normalizes a string for strict alphabetical sorting.
   * In addition to diacritic removal and lowercasing, it strips leading 
   * articles (a, an, the) to ensure more natural "book-style" sorting.
   * 
   * @param str The string to normalize.
   * @returns The normalized string for sorting.
   */
  private normalizeForSort(str: string): string {
    let s = this.normalizeString(str).trim();
    
    if (s.startsWith('the ')) s = s.substring(4);
    else if (s.startsWith('a ')) s = s.substring(2);
    else if (s.startsWith('an ')) s = s.substring(3);
    
    return s.trim();
  }
 
  /** Virtual list window based on displayLimit for infinite scroll performance */
  public displayGames = computed(() => this.filteredGames().slice(0, this.displayLimit()));

  /**
   * Computes the final UI grouping for games, organized by Platform.
   * Each group includes a totalCount that reflects the FULL filtered result set, 
   * even if only a subset are currently displayed in the DOM.
   */
  public groupedGames = computed(() => {
    const allFiltered = this.filteredGames();
    const displayed = this.displayGames();
    
    // 1. Calculate total counts per platform from ALL filtered games
    const counts = new Map<string, number>();
    for (const g of allFiltered) {
      const p = g.display_name || g.platform;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
 
    // 2. Build groups from DISPLAYED games
    const groups: GameGroup[] = [];
    const groupMap = new Map<string, GameGroup>();
    
    for (const game of displayed) {
      const p = game.display_name || game.platform;
      let group = groupMap.get(p);
      if (!group) {
        group = { 
          platformName: p, 
          platformLogo: game.platform_logo, 
          launchYear: game.platform_launch_date ? new Date(game.platform_launch_date).getFullYear().toString() : undefined,
          games: [],
          totalCount: counts.get(p) || 0
        };
        groups.push(group);
        groupMap.set(p, group);
      }
      group.games.push(game);
    }
    return groups;
  });
 
  /**
   * Reactive pipeline for filtering the toy collection.
   */
  public filteredToys = computed(() => {
    const allToys = this.collectionService.toys();
    const f = this.filters();
    return allToys.filter(toy => {
      // Ownership Filter
      const isOwned = toy.owned === 1 || toy.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;
 
      // Line Filter (e.g. Amiibo, Skylanders)
      if (f.line && toy.line !== f.line) return false;
 
      // Type Filter (e.g. Figure, Card)
      if (f.type && toy.type !== f.type) return false;

      // Region Filter
      if (f.region && toy.region !== f.region) return false;
 
      // Series Filter (Case & Accent Insensitive)
      if (f.series) {
        const normalizedFilter = this.normalizeString(f.series);
        const normalizedSeries = this.normalizeString(toy.series_name || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedFilter)) return false;
        }
      }
 
      return true;
    }).sort((a, b) => {
      /**
       * DESIGN RATIONALE: Client-side Sorting
       * Ensures consistent natural sorting (article stripping/diacritics) 
       * across all toy product lines and series.
       */

      // 1. Line (ASC)
      const lineA = this.normalizeForSort(a.line);
      const lineB = this.normalizeForSort(b.line);
      if (lineA !== lineB) return lineA.localeCompare(lineB);

      // 2. Series (ASC)
      const seriesA = this.normalizeForSort(a.series_name || '');
      const seriesB = this.normalizeForSort(b.series_name || '');
      if (seriesA !== seriesB) return seriesA.localeCompare(seriesB);

      // 3. Release Date (ASC, nulls last)
      const relA = a.release_date || '9999-99-99';
      const relB = b.release_date || '9999-99-99';
      if (relA !== relB) return relA.localeCompare(relB);

      // 4. Sort Index (ASC, nulls last)
      const sortA = a.sort_index ?? 9999;
      const sortB = b.sort_index ?? 9999;
      return sortA - sortB;
    });
  });
 
  /** Virtual list window for toys */
  public displayToys = computed(() => this.filteredToys().slice(0, this.displayLimit()));
 
  /**
   * Computes the UI grouping for toys, organized by 'Line'.
   */
  public groupedToys = computed(() => {
    const displayed = this.displayToys();
    const allFiltered = this.filteredToys();
    
    // 1. Get counts for all filtered toys per line
    const counts = new Map<string, number>();
    for (const f of allFiltered) {
      const line = f.line || 'Unknown';
      counts.set(line, (counts.get(line) || 0) + 1);
    }
 
    // 2. Build groups from DISPLAYED toys
    const groups: ToyGroup[] = [];
    const groupMap = new Map<string, ToyGroup>();
    
    for (const toy of displayed) {
      const line = toy.line || 'Unknown';
      let group = groupMap.get(line);
      if (!group) {
        group = { 
          lineName: line, 
          toys: [],
          totalCount: counts.get(line) || 0
        };
        groups.push(group);
        groupMap.set(line, group);
      }
      group.toys.push(toy);
    }
    return groups;
  });
 
  /** --- Utility Selectors for Filter Dropdowns --- */
  public uniqueLines = computed(() => Array.from(new Set(this.collectionService.toys().map(f => f.line)))
    .filter(Boolean)
    .sort((a, b) => this.normalizeForSort(a).localeCompare(this.normalizeForSort(b))));

  public uniqueTypes = computed(() => Array.from(new Set(this.collectionService.toys().map(f => f.type)))
    .filter(Boolean)
    .sort((a, b) => this.normalizeForSort(a).localeCompare(this.normalizeForSort(b))));

  public uniqueSeries = computed(() => {
    const list = this.currentTab() === 'games' 
      ? this.collectionService.games().map(g => g.canonical_series)
      : this.collectionService.toys().map(f => f.series_name);
    
    return Array.from(new Set(list))
      .filter(Boolean)
      .sort((a, b) => this.normalizeForSort(a || '').localeCompare(this.normalizeForSort(b || '')));
  });
 
  /**
   * Initializes the component and sets up the state persistence effect.
   * This effect ensures that any change to filters or display limits is 
   * automatically mirrored in the CollectionService and sessionStorage.
   */
  constructor() {
    effect(() => {
      const state: ListState = {
        tab: this.currentTab(),
        filters: this.filters(),
        displayLimit: this.displayLimit(),
        scrollX: window.scrollX,
        scrollY: window.scrollY
      };
      if (this.stateInitialized) {
        this.collectionService.updateListState(state);
      }
    });
  }
 
  /**
   * Listens for scroll events to update the saved navigation context.
   * This allows the user to return to their exact scroll position after viewing 
   * an item detail page.
   */
  @HostListener('window:scroll')
  onScroll() {
    const currentState = this.collectionService.getListState(this.currentTab());
    if (this.stateInitialized && currentState) {
      this.collectionService.updateListState({
        ...currentState,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      });
    }
  }
 
  /**
   * Attempts to restore the previously saved scroll position after navigation.
   * Uses a retry mechanism to account for lazy-loading and rendering delays.
   * 
   * WHY: Since images are lazy-loaded and the DOM is reactive, the height of 
   * the page may shift several times during the first 500ms of loading.
   */
  private restoreScroll() {
    const savedState = this.collectionService.getListState(this.currentTab());
    if (!savedState || savedState.scrollY === undefined) {
      this.stateInitialized = true;
      return;
    }
 
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryScroll = () => {
      if (attempts >= maxAttempts) {
        this.stateInitialized = true;
        return;
      }
      
      window.scrollTo({ left: savedState.scrollX, top: savedState.scrollY, behavior: 'auto' });
      
      // If we are close enough or have tried enough, mark as initialized
      if (Math.abs(window.scrollY - (savedState.scrollY || 0)) < 2 || attempts > 5) {
         this.stateInitialized = true;
      } else {
        attempts++;
        setTimeout(tryScroll, 100);
      }
    };
 
    setTimeout(tryScroll, 200);
  }
 
  /**
   * Component Lifecycle: Restores previous tab state and initiates data refresh.
   */
  async ngOnInit() {
    this.stateInitialized = false;
    this.currentTab.set(this.route.snapshot.url[0]?.path as 'games' | 'toys' || 'games');
    
    const savedState = this.collectionService.getListState(this.currentTab());
    if (savedState) {
      this.filters.set({ ...savedState.filters });
      this.displayLimit.set(savedState.displayLimit);
    }
    
    await this.collectionService.refreshAll();
    this.restoreScroll();
  }
 
  /**
   * Sets up the IntersectionObserver for infinite scrolling after the view is ready.
   */
  ngAfterViewInit() { this.setupIntersectionObserver(); }
 
  /**
   * Cleanup: disconnects observer to prevent memory leaks and persists final state.
   */
  ngOnDestroy() { 
    if (this.observer) this.observer.disconnect(); 
    this.collectionService.persistState(this.currentTab());
  }
 
  /**
   * Initializes the IntersectionObserver that triggers 'loadMore' when the 
   * user reaches the bottom of the list.
   */
  setupIntersectionObserver() {
    this.observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) this.loadMore(); }, { root: null, rootMargin: '200px', threshold: 0.1 });
    if (this.scrollTrigger?.nativeElement) this.observer.observe(this.scrollTrigger.nativeElement);
  }
 
  /**
   * Increases the virtual display limit, triggering the computed reactive 
   * pipelines to slice a larger portion of the collection into the DOM.
   */
  loadMore() { this.displayLimit.update(limit => limit + 100); }
 
  /**
   * Event handler for filter updates from the child component.
   * Resets the display limit to ensure performance.
   */
  onFiltersChange(newFilters: FilterState) { this.filters.set({ ...newFilters }); this.displayLimit.set(100); }
}
