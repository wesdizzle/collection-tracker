import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, signal, computed } from '@angular/core';

import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { Platform, FilterState, PlatformGroup } from '../../../../core/models/collection.models';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';

interface GameGroup {
  platformName: string;
  platformLogo?: string;
  games: Game[];
}

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [RouterModule, CollectionFiltersComponent],
  template: `
    <div class="animate-fade-in" data-version="final-v11">
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
              <header class="platform-header flex items-center gap-md mb-md">
                <div class="platform-logo-frame">
                  @if (group.platformLogo) {
                    <img [src]="group.platformLogo" [alt]="group.platformName" class="platform-logo">
                  } @else {
                    <div class="platform-logo-placeholder">{{ group.platformName.charAt(0) }}</div>
                  }
                </div>
                <h2 class="platform-title">{{ group.platformName }}</h2>
                <span class="group-count">{{ group.games.length }} Items</span>
              </header>
              
              <div class="grid">
                @for (game of group.games; track game.id) {
                  <a [routerLink]="['/collection', 'game', game.id]" 
                     class="glass-panel interactive-card flex flex-col overflow-hidden">
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
                    
                    <div class="p-md flex flex-col gap-xs">
                      <div class="badge-container flex justify-between items-center">
                        <div class="flex gap-2xs items-center">
                          @if (game.igdb_id) {
                            <span class="igdb-icon" title="Verified by IGDB">🆔</span>
                          }
                        </div>
                      </div>
                      <h3 class="mt-xs text-base truncate">{{game.title}}</h3>
                      <p class="text-xs text-secondary truncate">{{game.series || 'No Series'}}</p>
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
               class="glass-panel interactive-card p-md flex flex-col gap-xs">
              <div class="badge-container flex justify-between items-center gap-2xs">
                @if (figure.owned) {
                  <span class="badge owned">Owned</span>
                } @else {
                  <span class="badge wanted">Wanted</span>
                }
                <span class="badge type">{{figure.type}}</span>
              </div>
              <div class="text-2xs text-secondary font-medium">{{figure.line}}</div>
              <h3 class="mt-xs text-base truncate">{{figure.name}}</h3>
              <p class="text-xs text-secondary truncate">{{figure.series_name}}</p>
            </a>
          }
        </div>
      }
    
      <!-- Invisible element used to trigger load more when scrolled into view -->
      <div #scrollTrigger class="scroll-trigger" style="height: 50px; width: 100%;"></div>
    </div>
    `,
  styles: [`
    .mt-xs { margin-top: 0.25rem; }
    .p-md { padding: 0.75rem; }
    .text-base { font-size: 0.9375rem; font-weight: 600; line-height: 1.2; }
    .text-xs { font-size: 0.75rem; }
    .text-2xs { font-size: 0.65rem; }
    .text-secondary { color: var(--text-secondary); }
    .font-medium { font-weight: 500; }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gap-xs { gap: 0.25rem; }
    .gap-2xs { gap: 0.15rem; }
    
    .badge { padding: 0.15rem 0.4rem; font-size: 0.6rem; }
    .badge.type { background: rgba(148, 163, 184, 0.1); color: var(--text-secondary); border: 1px solid rgba(148, 163, 184, 0.2); }
    
    .mb-xl { margin-bottom: 3.5rem; }
    .mb-md { margin-bottom: 1.25rem; }
    .gap-md { gap: 1rem; }

    .platform-header {
      position: sticky; top: 0; z-index: 10;
      background: rgba(15, 23, 42, 0.82); backdrop-filter: blur(12px);
      padding: 0.75rem 1rem; margin-left: -1rem; margin-right: -1rem;
      border-bottom: 1px solid var(--glass-border);
    }

    .platform-logo-frame {
      width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
      background: rgba(255, 255, 255, 0.05); border-radius: 8px; border: 1px solid var(--glass-border);
      padding: 0.25rem;
    }

    .platform-logo { max-width: 100%; max-height: 100%; object-fit: contain; }
    .platform-logo-placeholder { font-weight: 800; color: var(--accent-color); font-size: 1.25rem; }
    .platform-title { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; color: #f8fafc; }
    .platform-divider { flex: 1; height: 1px; background: linear-gradient(90deg, var(--glass-border), transparent); }
    .group-count { font-size: 0.75rem; color: var(--text-secondary); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }

    .badge.played-badge { background: rgba(34, 197, 94, 0.15); color: #4ade80; border-color: rgba(34, 197, 94, 0.3); }
    
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 2rem;
      padding-top: 2rem;
      border: none !important;
      outline: none !important;
    }
    
    .genre-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding-bottom: 0.5rem;
      border: none !important;
    }
    
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 1.25rem; }
    .card-art-frame { width: 100%; aspect-ratio: 3/4; background: rgba(0,0,0,0.2); overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; }
    .card-art { width: 100%; height: 100%; object-fit: cover; transition: none; }
    
    /* Removed All Hover Movement */
    .interactive-card:hover .card-art { transform: none !important; }

    .region-flag {
      position: absolute; top: 0.25rem; right: 0.25rem; padding: 0.1rem 0.3rem;
      background: rgba(0,0,0,0.85); border-radius: 3px; font-size: 0.55rem; font-weight: 700;
      color: #fff; border: 1px solid rgba(255,255,255,0.1); z-index: 2;
    }

    .igdb-icon { font-size: 0.75rem; filter: drop-shadow(0 0 5px var(--accent-glow)); }
  `]
})
export class CollectionListComponent implements OnInit, AfterViewInit, OnDestroy {
  private collectionService = inject(CollectionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private observer?: IntersectionObserver;
  @ViewChild('scrollTrigger') scrollTrigger?: ElementRef;
  
  private restorationPending = true;
  public currentTab = signal<'games' | 'figures'>('games');
  public filters = signal<FilterState>({ ownership: 'owned', platform_id: undefined, line: '', type: '', series: '' });
  public displayLimit = signal<number>(100);
  
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();
    [...data].sort((a,b) => (a.brand || 'Other').localeCompare(b.brand || 'Other')).forEach(p => {
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
      
      // Series Filter
      if (f.series && !g.series?.toLowerCase().includes(f.series.toLowerCase())) return false;
      
      return true;
    });
  });

  public displayGames = computed(() => this.filteredGames().slice(0, this.displayLimit()));
  public groupedGames = computed(() => {
    const games = this.displayGames();
    const groups: GameGroup[] = [];
    games.forEach(game => {
      let group = groups.find(g => g.platformName === (game.display_name || game.platform));
      if (!group) {
        group = { platformName: game.display_name || game.platform, platformLogo: game.platform_logo, games: [] };
        groups.push(group);
      }
      group.games.push(game);
    });
    return groups;
  });

  public filteredFigures = computed(() => {
    const allFigures = this.collectionService.figures();
    const f = this.filters();
    return allFigures.filter(fig => {
      const isOwned = fig.owned === 1 || fig.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;
      return true;
    });
  });

  public displayFigures = computed(() => this.filteredFigures().slice(0, this.displayLimit()));
  public uniqueLines = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.line))).filter(Boolean).sort());
  public uniqueTypes = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.type))).filter(Boolean).sort());
  public uniqueSeries = computed(() => Array.from(new Set(this.collectionService.games().map(g => g.series || g.title))).filter(Boolean).sort());

  constructor() {}

  ngOnInit() {
    this.currentTab.set(this.route.snapshot.url[0]?.path as 'games' | 'figures' || 'games');
    const savedState = this.collectionService.listState;
    if (savedState && savedState.tab === this.currentTab()) {
      this.filters.set({ ...savedState.filters });
      this.displayLimit.set(savedState.displayLimit);
    }
    this.collectionService.refreshAll();
  }

  ngAfterViewInit() { this.setupIntersectionObserver(); }
  ngOnDestroy() { if (this.observer) this.observer.disconnect(); }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) this.loadMore(); }, { root: null, rootMargin: '200px', threshold: 0.1 });
    if (this.scrollTrigger?.nativeElement) this.observer.observe(this.scrollTrigger.nativeElement);
  }

  loadMore() { this.displayLimit.update(limit => limit + 100); }
  onFiltersChange(newFilters: FilterState) { this.filters.set({ ...newFilters }); this.displayLimit.set(100); }
}
