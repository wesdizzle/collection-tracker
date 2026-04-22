import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, signal, computed, effect, HostListener } from '@angular/core';

import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Platform, FilterState, PlatformGroup, ListState } from '../../../../core/models/collection.models';
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
    <div class="animate-fade-in" data-version="final-v12">
      <app-collection-filters
        [currentTab]="currentTab()"
        [platformGroups]="platformGroups()"
        [filters]="filters()"
        [uniqueLines]="uniqueLines()"
        [uniqueTypes]="uniqueTypes()"
        [uniqueSeries]="uniqueSeries()"
        [resultCount]="currentTab() === 'games' ? filteredGames().length : filteredFigures().length"
        (filtersChange)="onFiltersChange($event)">
      </app-collection-filters>
    
      @if (currentTab() === 'games') {
        <div class="groups-container animate-fade-in animate-stagger-2">
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
    
      @if (currentTab() === 'figures') {
        <div class="grid animate-fade-in animate-stagger-2">
          @for (figure of displayFigures(); track figure.id) {
            <a [routerLink]="['/collection', 'figure', figure.id]" 
               class="m3-card m3-card-elevated state-layer p-md flex flex-col gap-xs">
              <div class="badge-container flex justify-between items-center gap-2xs">
                @if (figure.owned) {
                  <span class="m3-chip active">Owned</span>
                } @else {
                  <span class="m3-chip">Wanted</span>
                }
                <span class="m3-chip type">{{figure.type}}</span>
              </div>
              <div class="text-2xs text-secondary font-medium">{{figure.line}}</div>
              <h3 class="mt-xs text-base truncate">{{figure.name}}</h3>
              <p class="text-xs text-secondary truncate">{{figure.series_name}}</p>
            </a>
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
  public currentTab = signal<'games' | 'figures'>('games');
  public filters = signal<FilterState>({ ownership: 'owned', platform_id: undefined, line: '', type: '', series: '' });
  public displayLimit = signal<number>(100);

  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();
    
    // Maintain the chronological order from the server
    [...data]
      .forEach(p => {
        const b = p.brand || 'Other';
        if (!grouped.has(b)) grouped.set(b, []);
        grouped.get(b)!.push(p);
      });
    
    return Array.from(grouped.entries()).map(([brand, platforms]) => ({ brand, platforms }));
  });

  public filteredGames = computed(() => {
    const allGames = this.collectionService.games();
    const f = this.filters();
    return allGames.filter(g => {
      // Basic Ownership Filter
      const isOwned = g.owned === 1 || g.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;

      // Platform Filter
      if (f.platform_id && g.platform_id !== f.platform_id) return false;

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
        if (!normalizedSeries.includes(normalizedFilter)) return false;
      }

      return true;
    });
  });

  private normalizeString(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  public displayGames = computed(() => this.filteredGames().slice(0, this.displayLimit()));
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

  public filteredFigures = computed(() => {
    const allFigures = this.collectionService.figures();
    const f = this.filters();
    return allFigures.filter(fig => {
      // Ownership Filter
      const isOwned = fig.owned === 1 || fig.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;

      // Line Filter
      if (f.line && fig.line !== f.line) return false;

      // Type Filter
      if (f.type && fig.type !== f.type) return false;

      // Series Filter (Case & Accent Insensitive)
      if (f.series) {
        const normalizedFilter = this.normalizeString(f.series);
        const normalizedSeries = this.normalizeString(fig.series_name || '');
        if (!normalizedSeries.includes(normalizedFilter)) return false;
      }

      return true;
    });
  });

  public displayFigures = computed(() => this.filteredFigures().slice(0, this.displayLimit()));
  public uniqueLines = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.line))).filter(Boolean).sort());
  public uniqueTypes = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.type))).filter(Boolean).sort());
  public uniqueSeries = computed(() => Array.from(new Set(this.collectionService.games().map(g => g.canonical_series))).filter(Boolean).sort());

  constructor() {
    // Automatically save state whenever it changes
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

    // Initial delay to allow rendering to start
    setTimeout(tryScroll, 200);
  }

  async ngOnInit() {
    this.stateInitialized = false;
    this.currentTab.set(this.route.snapshot.url[0]?.path as 'games' | 'figures' || 'games');
    
    const savedState = this.collectionService.getListState(this.currentTab());
    if (savedState) {
      this.filters.set({ ...savedState.filters });
      this.displayLimit.set(savedState.displayLimit);
    }
    
    // Refresh data and then attempt to restore scroll position
    await this.collectionService.refreshAll();
    this.restoreScroll();
  }

  ngAfterViewInit() { this.setupIntersectionObserver(); }
  ngOnDestroy() { 
    if (this.observer) this.observer.disconnect(); 
    this.collectionService.persistState(this.currentTab());
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) this.loadMore(); }, { root: null, rootMargin: '200px', threshold: 0.1 });
    if (this.scrollTrigger?.nativeElement) this.observer.observe(this.scrollTrigger.nativeElement);
  }

  loadMore() { this.displayLimit.update(limit => limit + 100); }
  onFiltersChange(newFilters: FilterState) { this.filters.set({ ...newFilters }); this.displayLimit.set(100); }
}
