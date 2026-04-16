import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener, signal, computed } from '@angular/core';
import { ViewportScroller } from '@angular/common';

import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { Platform, FilterState, PlatformGroup } from '../../../../core/models/collection.models';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [RouterModule, CollectionFiltersComponent],
  template: `
    <div class="animate-fade-in">
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
        <div class="grid animate-fade-in animate-stagger-2">
          @for (game of displayGames(); track game.id) {
            <a [routerLink]="['/collection', 'game', game.id]" class="glass-panel interactive-card flex flex-col overflow-hidden">
              <div class="card-art-frame">
                @if (game.image_url) {
                  <img [src]="game.image_url" alt="Cover" class="card-art">
                } @else {
                  <div class="card-art-placeholder text-secondary text-xs uppercase letter-spacing-wide">
                    No Image
                  </div>
                }
                <div class="region-flag" [title]="'Region: ' + game.region">
                  {{ game.region }}
                </div>
              </div>
              
              <div class="p-lg flex flex-col gap-sm">
                <div class="badge-container flex justify-between items-center">
                  <div class="flex gap-xs items-center">
                    @if (game.owned) {
                      <span class="badge owned">Owned</span>
                    } @else {
                      <span class="badge wanted">Wanted</span>
                    }
                    @if (game.igdb_id) {
                      <span class="igdb-icon" title="Verified by IGDB">🆔</span>
                    }
                  </div>
                  <span class="text-xs text-secondary ml-auto text-right font-medium">{{game.display_name || game.platform}}</span>
                </div>
                <h3 class="mt-md text-xl">{{game.title}}</h3>
                <p class="text-sm text-secondary truncate">{{game.series}} • {{game.release_date || 'Unknown Date'}}</p>
              </div>
            </a>
          }
        </div>
      }
    
      @if (currentTab() === 'figures') {
        <div class="grid animate-fade-in animate-stagger-2">
          @for (figure of displayFigures(); track figure.id) {
            <a [routerLink]="['/collection', 'figure', figure.id]" class="glass-panel interactive-card p-lg flex flex-col gap-sm">
              <div class="badge-container flex justify-between items-center gap-xs">
                @if (figure.owned) {
                  <span class="badge owned">Owned</span>
                } @else {
                  <span class="badge wanted">Wanted</span>
                }
                <span class="badge type">{{figure.type}}</span>
                <span class="text-xs text-secondary font-medium ml-auto text-right">{{figure.line}}</span>
              </div>
              <h3 class="mt-md text-xl">{{figure.name}}</h3>
              <p class="text-sm text-secondary">{{figure.series_name}}</p>
            </a>
          }
        </div>
      }
    
      <!-- Invisible element used to trigger load more when scrolled into view -->
      <div #scrollTrigger class="scroll-trigger" style="height: 50px; width: 100%;"></div>
    </div>
    `,
  styles: [`
    .mt-md { margin-top: var(--spacing-md); }
    .p-lg { padding: var(--spacing-lg); }
    .text-xl { font-size: 1.25rem; font-weight: 600; line-height: 1.3; }
    .text-sm { font-size: 0.875rem; }
    .text-xs { font-size: 0.75rem; }
    .text-secondary { color: var(--text-secondary); }
    .font-medium { font-weight: 500; }
    .ml-auto { margin-left: auto; }
    .text-right { text-align: right; }
    .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gap-xs { gap: 0.5rem; }
    
    .badge.type {
      background: rgba(148, 163, 184, 0.1);
      color: var(--text-secondary);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1.5rem;
    }

    .card-art-frame {
      width: 100%;
      aspect-ratio: 3/4;
      background: rgba(0,0,0,0.2);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .card-art {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.5s var(--ease-premium);
    }

    .interactive-card:hover .card-art {
      transform: scale(1.05);
    }

    .region-flag {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      padding: 0.15rem 0.4rem;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      border-radius: 4px;
      font-size: 0.65rem;
      font-weight: 700;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .igdb-icon {
      font-size: 0.9rem;
      filter: drop-shadow(0 0 5px var(--accent-glow));
      cursor: help;
    }
  `]
})
/**
 * COLLECTION LIST COMPONENT (SIGNALS-FIRST)
 * 
 * Renders a searchable, filterable grid of the user's collection.
 * Utilizes Angular Signals and computed() properties for high-performance 
 * reactive state management.
 */
export class CollectionListComponent implements OnInit, AfterViewInit, OnDestroy {
  private collectionService = inject(CollectionService);
  private route = inject(ActivatedRoute);
  private scroller = inject(ViewportScroller);
  
  // State Signals
  public currentTab = signal<'games' | 'figures'>('games');
  public filters = signal<FilterState>({ ownership: 'owned', platform_id: undefined, line: '', type: '', series: '' });
  public displayLimit = signal<number>(40);
  
  // Computed Selections
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();
    
    [...data].sort((a,b) => {
       if (a.brand !== b.brand) return (a.brand || 'Other').localeCompare(b.brand || 'Other');
       const aKey = a.parent_platform_id || a.id;
       const bKey = b.parent_platform_id || b.id;
       if (aKey !== bKey) {
          const pa = data.find(p => p.id === aKey);
          const pb = data.find(p => p.id === bKey);
          return (pa?.launch_date || '1970').localeCompare(pb?.launch_date || '1970');
       }
       return new Date(a.launch_date || '1970').getTime() - new Date(b.launch_date || '1970').getTime();
    }).forEach(p => {
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
      const isOwned = g.owned === 1 || g.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;
      
      if (f.platform_id) {
        const p = this.collectionService.platforms().find(plat => plat.id === g.platform_id);
        const match = g.platform_id === f.platform_id || p?.parent_platform_id === f.platform_id;
        if (!match) return false;
      }

      if (f.region && g.region !== f.region) return false;
      if (f.is_linked !== undefined) {
        const linked = !!g.igdb_id;
        if (f.is_linked !== linked) return false;
      }
      
      if (f.series && !g.series?.toLowerCase().includes(f.series.toLowerCase())) return false;
      return true;
    });
  });

  public displayGames = computed(() => this.filteredGames().slice(0, this.displayLimit()));

  public filteredFigures = computed(() => {
    const allFigures = this.collectionService.figures();
    const f = this.filters();
    
    return allFigures.filter(fig => {
      const isOwned = fig.owned === 1 || fig.owned === true;
      if (f.ownership === 'owned' && !isOwned) return false;
      if (f.ownership === 'wanted' && isOwned) return false;
      if (f.line && fig.line !== f.line) return false;
      if (f.type && fig.type !== f.type) return false;
      if (f.series && !fig.series_name?.toLowerCase().includes(f.series.toLowerCase())) return false;
      return true;
    });
  });

  public displayFigures = computed(() => this.filteredFigures().slice(0, this.displayLimit()));

  // Unique Selection Signals (Computed)
  public uniqueLines = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.line))).filter(Boolean).sort());
  public uniqueTypes = computed(() => Array.from(new Set(this.collectionService.figures().map(f => f.type))).filter(Boolean).sort());
  public uniqueSeries = computed(() => {
    if (this.currentTab() === 'games') {
      return Array.from(new Set(this.collectionService.games().map(g => g.series || g.title))).filter(Boolean).sort();
    }
    return Array.from(new Set(this.collectionService.figures().map(f => f.series_name))).filter(Boolean).sort();
  });

  @ViewChild('scrollTrigger') scrollTrigger!: ElementRef;
  private observer: IntersectionObserver | null = null;
  private currentScrollPosition: [number, number] = [0, 0];

  @HostListener('window:scroll')
  onScroll() {
    this.currentScrollPosition = this.scroller.getScrollPosition();
  }

  ngOnInit() {
    this.currentTab.set(this.route.snapshot.url[0]?.path as 'games' | 'figures' || 'games');

    const savedState = this.collectionService.listState;
    if (savedState && savedState.tab === this.currentTab()) {
      this.filters.set({ ...savedState.filters });
      this.displayLimit.set(savedState.displayLimit);
    }

    // Trigger initial service load
    this.collectionService.refreshAll().then(() => {
      this.restoreScroll();
    });
  }

  restoreScroll() {
    const savedState = this.collectionService.listState;
    if (savedState && savedState.tab === this.currentTab() && savedState.scrollPosition) {
      setTimeout(() => {
        this.scroller.scrollToPosition(savedState.scrollPosition);
      }, 100);
    }
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  ngOnDestroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    this.collectionService.listState = {
      tab: this.currentTab(),
      filters: { ...this.filters() },
      displayLimit: this.displayLimit(),
      scrollPosition: this.currentScrollPosition
    };
  }

  setupIntersectionObserver() {
    const options = { root: null, rootMargin: '200px', threshold: 0.1 };
    this.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        this.loadMore();
      }
    }, options);

    if (this.scrollTrigger?.nativeElement) {
      this.observer.observe(this.scrollTrigger.nativeElement);
    }
  }

  loadMore() {
    this.displayLimit.update(limit => limit + 40);
  }

  onFiltersChange(newFilters: FilterState) {
    this.filters.set({ ...newFilters });
    this.displayLimit.set(40); 
  }
}
