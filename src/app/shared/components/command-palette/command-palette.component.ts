import {
  Component,
  inject,
  signal,
  computed,
  effect,
  HostListener,
  ViewChild,
  ElementRef,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { CollectionService } from '../../../core/services/collection.service';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon.catalog';

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Navigation' | 'Quick Filters' | 'Platforms' | 'Games' | 'Toys';
  icon: IconName;
  badge?: string;
  action: () => void;
}

export interface CommandPaletteGroup {
  category: string;
  items: Array<{ item: CommandPaletteItem; flatIndex: number }>;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.css',
})
export class CommandPaletteComponent {
  public paletteService = inject(CommandPaletteService);
  private collectionService = inject(CollectionService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultsContainer') resultsContainer?: ElementRef<HTMLDivElement>;

  public query = signal('');
  public selectedIndex = signal(0);
  private wasOpen = false;

  constructor() {
    effect(() => {
      const open = this.paletteService.isOpen();
      if (open && !this.wasOpen) {
        this.wasOpen = true;
        this.query.set('');
        this.selectedIndex.set(0);
        if (this.collectionService.games().length === 0) {
          this.collectionService.refreshAll();
        }
        if (typeof document !== 'undefined') {
          document.body.style.overflow = 'hidden';
        }
        setTimeout(() => {
          this.searchInput?.nativeElement.focus();
        }, 50);
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
        if (typeof document !== 'undefined') {
          document.body.style.overflow = '';
        }
      }
    });

    this.destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    });
  }

  private navigationActions: CommandPaletteItem[] = [
    {
      id: 'nav-games',
      title: 'Games Catalog',
      subtitle: 'Browse all video games',
      category: 'Navigation',
      icon: 'gamepad',
      action: () => this.navigate('/collection/games'),
    },
    {
      id: 'nav-toys',
      title: 'Toys & Figures',
      subtitle: 'Browse Amiibo and collectibles',
      category: 'Navigation',
      icon: 'figure-toy',
      action: () => this.navigate('/collection/toys'),
    },
    {
      id: 'nav-insights',
      title: 'Collection Insights',
      subtitle: 'Stats, era decade breakdown, & completion graphs',
      category: 'Navigation',
      icon: 'flame',
      action: () => this.navigate('/collection/insights'),
    },
    {
      id: 'nav-discovery',
      title: 'Discovery Management',
      subtitle: 'Track missing releases and scan candidates',
      category: 'Navigation',
      icon: 'compass',
      action: () => this.navigate('/collection/discovery'),
    },
  ];

  private filterActions: CommandPaletteItem[] = [
    {
      id: 'filter-reset',
      title: 'Reset All Filters',
      subtitle: 'Clear all active filters and return to default owned view',
      category: 'Quick Filters',
      icon: 'refresh',
      action: () => this.resetAllFilters(),
    },
    {
      id: 'filter-deals',
      title: 'Unowned Deals',
      subtitle: 'Games currently on sale or below retail price',
      category: 'Quick Filters',
      icon: 'coins',
      action: () =>
        this.navigate('/collection/games', {
          deals_only: 'true',
          ownership: '0',
        }),
    },
    {
      id: 'filter-backlog',
      title: 'Backlog Queue',
      subtitle: 'Games queued up to play next',
      category: 'Quick Filters',
      icon: 'list-queued',
      action: () => this.navigate('/collection/games', { play_status: '3' }),
    },
    {
      id: 'filter-playing',
      title: 'Currently Playing',
      subtitle: 'Active playthroughs',
      category: 'Quick Filters',
      icon: 'play',
      action: () => this.navigate('/collection/games', { play_status: '2' }),
    },
    {
      id: 'filter-seeking',
      title: 'Seeking Wishlist',
      subtitle: 'Games marked as actively seeking',
      category: 'Quick Filters',
      icon: 'seeking',
      action: () => this.navigate('/collection/games', { ownership: '2' }),
    },
    {
      id: 'filter-missing-backups',
      title: 'Missing ROM Backups',
      subtitle: 'Physical items missing verified digital backup',
      category: 'Quick Filters',
      icon: 'missing-dump',
      action: () => this.navigate('/collection/games', { backup_status: '0' }),
    },
  ];

  public readonly flatResults = computed<CommandPaletteItem[]>(() => {
    const rawQuery = this.query().trim().toLowerCase();
    const platforms = this.collectionService.platforms();
    const games = this.collectionService.games();

    const ownedCountsByPlatform = new Map<number, number>();
    for (const g of games) {
      if (g.ownership_status === 1 && g.platform_id != null) {
        ownedCountsByPlatform.set(
          g.platform_id,
          (ownedCountsByPlatform.get(g.platform_id) || 0) + 1,
        );
      }
    }

    if (!rawQuery) {
      const sortedPlatforms = [...platforms].sort((a, b) => {
        const countA = ownedCountsByPlatform.get(a.id) || 0;
        const countB = ownedCountsByPlatform.get(b.id) || 0;
        if (countB !== countA) return countB - countA;
        return (a.display_name || a.name).localeCompare(
          b.display_name || b.name,
        );
      });

      const topPlatforms: CommandPaletteItem[] = sortedPlatforms
        .slice(0, 8)
        .map((p) => {
          const count = ownedCountsByPlatform.get(p.id) || 0;
          return {
            id: `platform-${p.id}`,
            title: p.display_name || p.name,
            subtitle: `${p.brand} platform${count > 0 ? ` • ${count} owned` : ''}`,
            category: 'Platforms',
            icon: 'gamepad' as IconName,
            action: () =>
              this.navigate('/collection/games', { platform_id: p.id }),
          };
        });

      return [
        ...this.navigationActions,
        ...this.filterActions,
        ...topPlatforms,
      ];
    }

    const tokens = rawQuery.split(/\s+/).filter(Boolean);
    const matchesTokens = (text: string) => {
      const lower = text.toLowerCase();
      return tokens.every((token) => lower.includes(token));
    };

    const matchingNav = this.navigationActions.filter(
      (a) =>
        matchesTokens(a.title) || (a.subtitle && matchesTokens(a.subtitle)),
    );

    const matchingFilters = this.filterActions.filter(
      (f) =>
        matchesTokens(f.title) || (f.subtitle && matchesTokens(f.subtitle)),
    );

    const matchingPlatforms: CommandPaletteItem[] = platforms
      .filter(
        (p) =>
          matchesTokens(p.name) ||
          matchesTokens(p.display_name || '') ||
          matchesTokens(p.brand || ''),
      )
      .sort((a, b) => {
        const countA = ownedCountsByPlatform.get(a.id) || 0;
        const countB = ownedCountsByPlatform.get(b.id) || 0;
        return countB - countA;
      })
      .slice(0, 6)
      .map((p) => {
        const count = ownedCountsByPlatform.get(p.id) || 0;
        return {
          id: `platform-${p.id}`,
          title: p.display_name || p.name,
          subtitle: `${p.brand} platform${count > 0 ? ` • ${count} owned` : ''}`,
          category: 'Platforms',
          icon: 'gamepad' as IconName,
          action: () =>
            this.navigate('/collection/games', { platform_id: p.id }),
        };
      });

    const matchingGames: CommandPaletteItem[] = games
      .filter(
        (g) =>
          matchesTokens(g.title) ||
          (g.series && matchesTokens(g.series)) ||
          (g.platform && matchesTokens(g.platform)),
      )
      .slice(0, 15)
      .map((g) => ({
        id: `game-${g.id || g.stable_id}`,
        title: g.title,
        subtitle: `${g.platform || ''}${g.series ? ' • ' + g.series : ''}`,
        category: 'Games',
        icon: 'disc' as IconName,
        badge:
          g.ownership_status === 1
            ? 'Owned'
            : g.ownership_status === 2
              ? 'Seeking'
              : g.ownership_status === 3
                ? 'Ordered'
                : undefined,
        action: () => this.navigate(`/collection/game/${g.id || g.stable_id}`),
      }));

    const toys = this.collectionService.toys();
    const matchingToys: CommandPaletteItem[] = toys
      .filter(
        (t) =>
          matchesTokens(t.name) ||
          (t.series_name && matchesTokens(t.series_name)) ||
          (t.line && matchesTokens(t.line)),
      )
      .slice(0, 10)
      .map((t) => ({
        id: `toy-${t.id || t.stable_id}`,
        title: t.name,
        subtitle: `${t.line || ''}${t.series_name ? ' • ' + t.series_name : ''}`,
        category: 'Toys',
        icon: 'figure-toy' as IconName,
        badge:
          t.ownership_status === 1
            ? 'Owned'
            : t.ownership_status === 2
              ? 'Seeking'
              : t.ownership_status === 3
                ? 'Ordered'
                : undefined,
        action: () => this.navigate(`/collection/toy/${t.id || t.stable_id}`),
      }));

    return [
      ...matchingNav,
      ...matchingFilters,
      ...matchingPlatforms,
      ...matchingGames,
      ...matchingToys,
    ];
  });

  public readonly groupedResults = computed<CommandPaletteGroup[]>(() => {
    const flat = this.flatResults();
    const map = new Map<
      string,
      Array<{ item: CommandPaletteItem; flatIndex: number }>
    >();

    const order: Array<CommandPaletteItem['category']> = [
      'Navigation',
      'Quick Filters',
      'Platforms',
      'Games',
      'Toys',
    ];
    order.forEach((cat) => map.set(cat, []));

    flat.forEach((item, flatIndex) => {
      if (!map.has(item.category)) {
        map.set(item.category, []);
      }
      map.get(item.category)!.push({ item, flatIndex });
    });

    const groups: CommandPaletteGroup[] = [];
    for (const [category, items] of map.entries()) {
      if (items.length > 0) {
        groups.push({ category, items });
      }
    }
    return groups;
  });

  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.paletteService.toggle();
      return;
    }

    if (!this.paletteService.isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.paletteService.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.executeSelected();
    }
  }

  public onInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.query.set(target.value);
    this.selectedIndex.set(0);
  }

  public moveSelection(delta: number) {
    const total = this.flatResults().length;
    if (total === 0) return;
    this.selectedIndex.update((i) => (i + delta + total) % total);
    this.scrollActiveItemIntoView();
  }

  public executeSelected() {
    const flat = this.flatResults();
    const idx = this.selectedIndex();
    if (flat[idx]) {
      flat[idx].action();
    }
  }

  public onSelect(item: CommandPaletteItem) {
    item.action();
  }

  public onHover(index: number) {
    this.selectedIndex.set(index);
  }

  private scrollActiveItemIntoView() {
    if (typeof document === 'undefined') return;
    setTimeout(() => {
      const activeEl = document.querySelector('.palette-item.selected');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }, 0);
  }

  private resetAllFilters() {
    this.paletteService.close();
    this.collectionService.resetListState();
    this.router.navigate(['/collection/games'], {
      queryParams: { reset: '1' },
    });
  }

  private navigate(
    path: string,
    queryParams?: Record<string, string | number>,
  ) {
    this.paletteService.close();
    this.router.navigate([path], { queryParams });
  }
}
