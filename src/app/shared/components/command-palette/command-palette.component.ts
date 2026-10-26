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
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { CollectionService } from '../../../core/services/collection.service';
import { getMediaIconName } from '../../../core/models/collection.models';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon.catalog';
import { HighlightTokensPipe } from '../../pipes/highlight-tokens.pipe';

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  region?: string;
  category:
    | 'Recent Searches'
    | 'Navigation'
    | 'Quick Filters'
    | 'Platforms'
    | 'Games'
    | 'Toys';
  icon: IconName;
  badge?: string;
  action: () => void;
  url?: string;
  queryParams?: Record<string, string | number>;
  isResetAction?: boolean;
}

export const PLATFORM_NAME_TO_ALIASES: Record<string, string[]> = {
  PlayStation: ['ps1', 'psx', 'psone'],
  'PlayStation 2': ['ps2'],
  'PlayStation 3': ['ps3'],
  'PlayStation 4': ['ps4'],
  'PlayStation 5': ['ps5'],
  'PlayStation Portable': ['psp'],
  'PlayStation Vita': ['psv', 'vita'],
  'Super Nintendo Entertainment System': ['snes', 'super nintendo', 'sfc'],
  'Super Nintendo Entertainment System / Super Famicom': [
    'snes',
    'super nintendo',
    'sfc',
    'super famicom',
  ],
  'Nintendo Entertainment System': ['nes', 'famicom'],
  'Nintendo Entertainment System / Famicom': ['nes', 'famicom'],
  'Nintendo 64': ['n64'],
  'Nintendo 64DD': ['64dd', 'n64dd'],
  'Famicom Disk System': ['fds'],
  'Game Boy': ['gb'],
  'Game Boy Color': ['gbc'],
  'Game Boy Advance': ['gba'],
  'Nintendo DS': ['nds', 'ds'],
  'Nintendo 3DS': ['3ds'],
  'Nintendo GameCube': ['ngc', 'gcn', 'gamecube'],
  'Nintendo Wii': ['wii'],
  'Nintendo Wii U': ['wiiu', 'wii u'],
  'Nintendo Switch': ['switch', 'nsw'],
  'Sega Genesis': ['gen', 'genesis', 'md', 'mega drive'],
  'Sega Master System': ['sms', 'master system'],
  'Sega Game Gear': ['gg', 'game gear'],
  'Sega Saturn': ['saturn'],
  'Sega Dreamcast': ['dc', 'dreamcast'],
  'Sega CD': ['segacd', 'mega cd', 'mcd'],
  'Sega 32X': ['32x'],
  'TurboGrafx-16': ['tg16', 'pce', 'pc engine'],
  'TurboGrafx-CD': ['pcecd', 'turbografx-cd'],
  Xbox: ['xbox', 'ogx'],
  'Xbox 360': ['x360', '360'],
  'Xbox One': ['xone', 'xbone'],
  'Xbox Series X/S': ['xsx', 'xss', 'series x', 'series s'],
};

export interface CommandPaletteGroup {
  category: string;
  items: Array<{ item: CommandPaletteItem; flatIndex: number }>;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, IconComponent, HighlightTokensPipe],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.css',
})
export class CommandPaletteComponent implements AfterViewInit {
  public paletteService = inject(CommandPaletteService);
  private collectionService = inject(CollectionService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  @ViewChild('dialogEl') dialogRef?: ElementRef<HTMLDialogElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultsContainer') resultsContainer?: ElementRef<HTMLDivElement>;

  public query = signal('');
  public selectedIndex = signal(0);
  private wasOpen = false;

  public isEntering = signal(false);
  public isClosing = signal(false);
  public sheetTransformY = signal(0);
  public isDraggingSheet = signal(false);
  private sheetDragStartY = 0;

  public readonly effectiveTransformY = computed<number | null>(() => {
    if (this.isClosing()) {
      return null;
    }
    if (this.isDraggingSheet()) {
      return this.sheetTransformY();
    }
    if (
      this.paletteService.isDragging() &&
      this.paletteService.dragTranslateY() !== null
    ) {
      return this.paletteService.dragTranslateY();
    }
    return null;
  });

  public readonly activeOptionId = computed<string | null>(() => {
    const flat = this.flatResults();
    const idx = this.selectedIndex();
    if (flat.length === 0 || idx < 0 || idx >= flat.length) {
      return null;
    }
    return `palette-opt-${flat[idx].id}`;
  });

  constructor() {
    effect(() => {
      const open = this.paletteService.isOpen();
      const dragging = this.paletteService.isDragging();
      if (open && !this.wasOpen) {
        this.wasOpen = true;
        this.query.set('');
        this.selectedIndex.set(0);
        this.isClosing.set(false);
        if (this.collectionService.games().length === 0) {
          this.collectionService.refreshAll();
        }
        if (typeof document !== 'undefined') {
          document.body.style.overflow = 'hidden';
        }
        this.openDialog();

        if (!dragging) {
          this.isEntering.set(true);
          setTimeout(() => {
            this.isEntering.set(false);
          }, 280);
          setTimeout(() => {
            this.searchInput?.nativeElement.focus();
          }, 50);
        }
      } else if (open && this.wasOpen && !dragging) {
        setTimeout(() => {
          this.searchInput?.nativeElement.focus();
        }, 50);
      } else if (!open && this.wasOpen) {
        this.wasOpen = false;
        this.isClosing.set(false);
        this.isEntering.set(false);
        if (typeof document !== 'undefined') {
          document.body.style.overflow = '';
        }
        this.closeDialog();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    });
  }

  public ngAfterViewInit(): void {
    if (this.paletteService.isOpen()) {
      this.openDialog();
    }
  }

  private openDialog(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      } else {
        dialog.setAttribute('open', '');
      }
    }
  }

  private closeDialog(): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    if (dialog.open) {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close();
        } catch {
          dialog.removeAttribute('open');
        }
      } else {
        dialog.removeAttribute('open');
      }
    }
  }

  public onDialogClick(event: MouseEvent): void {
    const dialog = this.dialogRef?.nativeElement;
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) {
      this.paletteService.close();
    }
  }

  public onDialogCancel(event: Event): void {
    event.preventDefault();
    this.paletteService.close();
  }

  private navigationActions: CommandPaletteItem[] = [
    {
      id: 'nav-games',
      title: 'Games Catalog',
      subtitle: 'Browse all video games',
      category: 'Navigation',
      icon: 'gamepad',
      url: '/collection/games',
      action: () => this.navigate('/collection/games'),
    },
    {
      id: 'nav-toys',
      title: 'Toys & Figures',
      subtitle: 'Browse Amiibo and collectibles',
      category: 'Navigation',
      icon: 'figure-toy',
      url: '/collection/toys',
      action: () => this.navigate('/collection/toys'),
    },
    {
      id: 'nav-insights',
      title: 'Collection Insights',
      subtitle: 'Stats, era decade breakdown, & completion graphs',
      category: 'Navigation',
      icon: 'flame',
      url: '/collection/insights',
      action: () => this.navigate('/collection/insights'),
    },
    {
      id: 'nav-discovery',
      title: 'Discovery Management',
      subtitle: 'Track missing releases and scan candidates',
      category: 'Navigation',
      icon: 'compass',
      url: '/collection/discovery',
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
      isResetAction: true,
      action: () => this.resetAllFilters(),
    },
    {
      id: 'filter-deals',
      title: 'Unowned Deals',
      subtitle: 'Games currently on sale or below retail price',
      category: 'Quick Filters',
      icon: 'coins',
      url: '/collection/games',
      queryParams: {
        deals_only: 'true',
        ownership: '0',
      },
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
      url: '/collection/games',
      queryParams: { play_status: '3' },
      action: () => this.navigate('/collection/games', { play_status: '3' }),
    },
    {
      id: 'filter-playing',
      title: 'Currently Playing',
      subtitle: 'Active playthroughs',
      category: 'Quick Filters',
      icon: 'play',
      url: '/collection/games',
      queryParams: { play_status: '2' },
      action: () => this.navigate('/collection/games', { play_status: '2' }),
    },
    {
      id: 'filter-seeking',
      title: 'Seeking Wishlist',
      subtitle: 'Games marked as actively seeking',
      category: 'Quick Filters',
      icon: 'seeking',
      url: '/collection/games',
      queryParams: { ownership: '2' },
      action: () => this.navigate('/collection/games', { ownership: '2' }),
    },
    {
      id: 'filter-missing-backups',
      title: 'Missing ROM Backups',
      subtitle: 'Physical items missing verified digital backup',
      category: 'Quick Filters',
      icon: 'missing-dump',
      url: '/collection/games',
      queryParams: { backup_status: '0' },
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
      const recentItems: CommandPaletteItem[] = this.paletteService
        .recentItems()
        .map((r) => ({
          id: `recent-${r.id}`,
          title: r.title,
          subtitle: r.subtitle,
          region: r.region,
          category: 'Recent Searches' as const,
          icon: r.icon,
          badge: r.badge,
          url: r.url,
          queryParams: r.queryParams,
          isResetAction: r.isResetAction,
          action: () => {
            if (r.isResetAction) {
              this.resetAllFilters();
            } else if (r.url) {
              this.navigate(r.url, r.queryParams);
            }
          },
        }));

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
            url: '/collection/games',
            queryParams: { platform_id: p.id },
            action: () =>
              this.navigate('/collection/games', { platform_id: p.id }),
          };
        });

      return [
        ...recentItems,
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
      .filter((p) => {
        const aliases = PLATFORM_NAME_TO_ALIASES[p.name] || [];
        const platformSearchText = [
          p.name,
          p.display_name || '',
          p.brand || '',
          ...aliases,
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => platformSearchText.includes(token));
      })
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
          url: '/collection/games',
          queryParams: { platform_id: p.id },
          action: () =>
            this.navigate('/collection/games', { platform_id: p.id }),
        };
      });

    const matchingGames: CommandPaletteItem[] = games
      .filter((g) => {
        const aliases =
          (g.platform && PLATFORM_NAME_TO_ALIASES[g.platform]) || [];
        const gameSearchText = [
          g.title,
          g.series || '',
          g.canonical_series || '',
          g.platform || '',
          g.region || '',
          ...aliases,
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => gameSearchText.includes(token));
      })
      .slice(0, 15)
      .map((g) => ({
        id: `game-${g.id || g.stable_id}`,
        title: g.title,
        subtitle: `${g.platform || ''}${g.series ? ' • ' + g.series : ''}`,
        region: g.region || undefined,
        category: 'Games',
        icon: getMediaIconName(
          g.display_name || g.platform,
          g.backup_status,
        ) as IconName,
        badge:
          g.ownership_status === 1
            ? 'Owned'
            : g.ownership_status === 2
              ? 'Seeking'
              : g.ownership_status === 3
                ? 'Ordered'
                : undefined,
        url: `/collection/game/${g.id || g.stable_id}`,
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
        url: `/collection/toy/${t.id || t.stable_id}`,
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
      'Recent Searches',
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
      this.recordRecentItem(flat[idx]);
      flat[idx].action();
    }
  }

  public onSelect(item: CommandPaletteItem) {
    this.recordRecentItem(item);
    item.action();
  }

  public onClearRecents(event: MouseEvent): void {
    event.stopPropagation();
    this.paletteService.clearRecentItems();
  }

  public onRemoveRecent(id: string, event: MouseEvent): void {
    event.stopPropagation();
    const rawId = id.startsWith('recent-') ? id.replace('recent-', '') : id;
    this.paletteService.removeRecentItem(rawId);
  }

  private recordRecentItem(item: CommandPaletteItem): void {
    const rawId = item.id.startsWith('recent-')
      ? item.id.replace('recent-', '')
      : item.id;
    const category =
      item.category === 'Recent Searches'
        ? ('Navigation' as const)
        : item.category;

    this.paletteService.addRecentItem({
      id: rawId,
      title: item.title,
      subtitle: item.subtitle,
      region: item.region,
      category,
      icon: item.icon,
      badge: item.badge,
      url: item.url,
      queryParams: item.queryParams,
      isResetAction: item.isResetAction,
    });
  }

  public onHover(index: number) {
    this.selectedIndex.set(index);
  }

  // --- Mobile Bottom Sheet Drag-to-Dismiss Gesture ---

  public onDragHandleTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) return;
    this.sheetDragStartY = event.touches[0].clientY;
    this.isDraggingSheet.set(true);
    this.sheetTransformY.set(0);
  }

  public onDragHandleTouchMove(event: TouchEvent): void {
    if (!this.isDraggingSheet() || event.touches.length !== 1) return;
    const deltaY = event.touches[0].clientY - this.sheetDragStartY;
    if (deltaY > 0) {
      this.sheetTransformY.set(deltaY);
    } else {
      this.sheetTransformY.set(0);
    }
  }

  public onDragHandleTouchEnd(): void {
    if (!this.isDraggingSheet()) return;
    const currentDelta = this.sheetTransformY();
    this.isDraggingSheet.set(false);

    if (currentDelta >= 60) {
      this.isClosing.set(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(10);
        } catch {
          // Ignore vibration limitations
        }
      }
      setTimeout(() => {
        this.paletteService.close();
        this.isClosing.set(false);
        this.sheetTransformY.set(0);
      }, 220);
    } else {
      this.sheetTransformY.set(0);
    }
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
