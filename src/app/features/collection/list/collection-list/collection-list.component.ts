import { Component, inject, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService, Game, Figure, Platform } from '../../../../core/services/collection.service';
import { CollectionFiltersComponent, FilterState, PlatformGroup } from '../../filters/collection-filters/collection-filters.component';

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [CommonModule, RouterModule, CollectionFiltersComponent],
  template: `
    <div class="animate-fade-in">
      <app-collection-filters 
        [currentTab]="currentTab"
        [platformGroups]="platformGroups"
        [filters]="filters"
        [uniqueLines]="uniqueLines"
        [uniqueTypes]="uniqueTypes"
        [uniqueSeries]="uniqueSeries"
        [resultCount]="currentTab === 'games' ? filteredGames.length : filteredFigures.length"
        (filtersChange)="onFiltersChange($event)">
      </app-collection-filters>

      <div class="grid animate-fade-in animate-stagger-2" *ngIf="currentTab === 'games'">
        <a *ngFor="let game of displayGames" [routerLink]="['/collection', 'game', game.id]" class="glass-panel interactive-card p-lg flex flex-col gap-sm">
          <div class="badge-container flex justify-between items-center">
            <span class="badge owned" *ngIf="game.owned">Owned</span>
            <span class="badge wanted" *ngIf="!game.owned">Wanted</span>
            <span class="text-xs text-secondary ml-auto text-right font-medium">{{game.display_name || game.platform}}</span>
          </div>
          <h3 class="mt-md text-xl">{{game.title}}</h3>
          <p class="text-sm text-secondary truncate">{{game.series}} • {{game.release_date || 'Unknown Date'}}</p>
        </a>
      </div>

      <div class="grid animate-fade-in animate-stagger-2" *ngIf="currentTab === 'figures'">
        <a *ngFor="let figure of displayFigures" [routerLink]="['/collection', 'figure', figure.id]" class="glass-panel interactive-card p-lg flex flex-col gap-sm">
          <div class="badge-container flex justify-between items-center gap-xs">
            <span class="badge owned" *ngIf="figure.owned">Owned</span>
            <span class="badge wanted" *ngIf="!figure.owned">Wanted</span>
            <span class="badge type">{{figure.type}}</span>
            <span class="text-xs text-secondary font-medium ml-auto text-right">{{figure.line}}</span>
          </div>
          <h3 class="mt-md text-xl">{{figure.name}}</h3>
          <p class="text-sm text-secondary">{{figure.series_name}}</p>
        </a>
      </div>
      
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
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .bg-dark {
      background: rgba(15, 23, 42, 0.6);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }
  `]
})
export class CollectionListComponent implements OnInit, AfterViewInit, OnDestroy {
  private collectionService = inject(CollectionService);
  private route = inject(ActivatedRoute);
  private scroller = inject(ViewportScroller);
  
  currentTab: 'games' | 'figures' = 'games';
  
  games: Game[] = [];
  figures: Figure[] = [];

  filteredGames: Game[] = [];
  filteredFigures: Figure[] = [];
  
  displayGames: Game[] = [];
  displayFigures: Figure[] = [];
  displayLimit = 40;

  platformGroups: PlatformGroup[] = [];
  platformMap = new Map<number, Platform>(); // For parent lookup
  uniqueLines: string[] = [];
  uniqueTypes: string[] = [];
  uniqueSeries: string[] = [];

  filters: FilterState = { ownership: 'owned', platform_id: undefined, line: '', type: '', series: '' };

  @ViewChild('scrollTrigger') scrollTrigger!: ElementRef;
  private observer: IntersectionObserver | null = null;
  private currentScrollPosition: [number, number] = [0, 0];

  @HostListener('window:scroll')
  onScroll() {
    this.currentScrollPosition = this.scroller.getScrollPosition();
  }

  ngOnInit() {
    this.currentTab = this.route.snapshot.url[0]?.path as 'games' | 'figures' || 'games';

    const savedState = this.collectionService.listState;
    if (savedState && savedState.tab === this.currentTab) {
      this.filters = { ...savedState.filters };
      this.displayLimit = savedState.displayLimit;
    }

    if (this.currentTab === 'games') {
      this.collectionService.getGames().subscribe(data => {
        // Fallback series to title
        this.games = data.map(g => ({ ...g, series: g.series || g.title }));
        this.uniqueSeries = Array.from(new Set(this.games.map(g => g.series))).filter(Boolean).sort();
        this.updateFilteredGames();
        this.restoreScroll();
      });
      // Load platforms purely for building the dropdown filter.
      this.collectionService.getPlatforms().subscribe(data => {
        const grouped = new Map<string, Platform[]>();
        data.forEach(p => this.platformMap.set(p.id, p));
        
        data.sort((a,b) => {
           if (a.brand !== b.brand) return (a.brand || 'Other').localeCompare(b.brand || 'Other');
           // Sort accessories to follow their parents
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
        this.platformGroups = Array.from(grouped.entries()).map(([brand, platforms]) => ({ brand, platforms }));
        this.updateFilteredGames();
      });
    } else if (this.currentTab === 'figures') {
      this.collectionService.getFigures().subscribe(data => {
        this.figures = data;
        this.uniqueLines = Array.from(new Set(data.map(f => f.line))).filter(Boolean).sort();
        this.uniqueTypes = Array.from(new Set(data.map(f => f.type))).filter(Boolean).sort();
        this.uniqueSeries = Array.from(new Set(data.map(f => f.series_name))).filter(Boolean).sort();
        this.updateFilteredFigures();
        this.restoreScroll();
      });
    }
  }

  restoreScroll() {
    const savedState = this.collectionService.listState;
    if (savedState && savedState.tab === this.currentTab && savedState.scrollPosition) {
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
      tab: this.currentTab,
      filters: { ...this.filters },
      displayLimit: this.displayLimit,
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
    this.displayLimit += 40;
    if (this.currentTab === 'games') {
      this.displayGames = this.filteredGames.slice(0, this.displayLimit);
    } else if (this.currentTab === 'figures') {
      this.displayFigures = this.filteredFigures.slice(0, this.displayLimit);
    }
  }

  onFiltersChange(newFilters: FilterState) {
    this.filters = { ...newFilters };
    this.displayLimit = 40; 
    if (this.currentTab === 'games') this.updateFilteredGames();
    if (this.currentTab === 'figures') this.updateFilteredFigures();
  }

  updateFilteredGames() {
    this.filteredGames = this.games.filter(g => {
      const isOwned = g.owned === 1 || g.owned === true;
      if (this.filters.ownership === 'owned' && !isOwned) return false;
      if (this.filters.ownership === 'wanted' && isOwned) return false;
      
      if (this.filters.platform_id) {
        // Find the record for the current game's platform to check its parentage
        const p = this.platformMap.get(g.platform_id);
        const match = g.platform_id === this.filters.platform_id || p?.parent_platform_id === this.filters.platform_id;
        if (!match) return false;
      }
      
      if (this.filters.series && !g.series?.toLowerCase().includes(this.filters.series.toLowerCase())) return false;
      return true;
    });
    this.displayGames = this.filteredGames.slice(0, this.displayLimit);
  }

  updateFilteredFigures() {
    this.filteredFigures = this.figures.filter(f => {
      const isOwned = f.owned === 1 || f.owned === true;
      if (this.filters.ownership === 'owned' && !isOwned) return false;
      if (this.filters.ownership === 'wanted' && isOwned) return false;
      if (this.filters.line && f.line !== this.filters.line) return false;
      if (this.filters.type && f.type !== this.filters.type) return false;
      if (this.filters.series && !f.series_name?.toLowerCase().includes(this.filters.series.toLowerCase())) return false;
      return true;
    });
    this.displayFigures = this.filteredFigures.slice(0, this.displayLimit);
  }
}
