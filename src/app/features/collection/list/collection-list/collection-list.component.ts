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

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  effect,
  untracked,
  NgZone,
} from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { Subscription } from 'rxjs';
import { CollectionService } from '../../../../core/services/collection.service';

import { BrandingService } from '../../../../core/services/branding.service';
import {
  Game,
  Toy,
  Platform,
  FilterState,
  PlatformGroup,
  ToyGroup,
  ListState,
  ViewMode,
  OwnershipStatus,
  PlayStatus,
  isRegionMatchingHome,
  isItemAvailableAtRetail,
  normalizeBudgetToken,
  SERIES_CROSS_LANGUAGE_ALIASES,
} from '../../../../core/models/collection.models';
import {
  COMPANION_DISC1_PAIRS,
  normalizeForLabelMatch,
  getRomGroupingKey,
} from '../../../../core/models/title-mappings';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';
import { GameCardComponent } from '../game-card/game-card.component';
import { ToyCardComponent } from '../toy-card/toy-card.component';
import { CompactTableComponent } from '../compact-table/compact-table.component';

interface GameGroup {
  platformName: string;
  platformLogo?: string | null;
  launchYear?: string;
  games: Game[];
  totalCount: number;
}

@Component({
  selector: 'app-collection-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    CollectionFiltersComponent,
    GameCardComponent,
    ToyCardComponent,
    CompactTableComponent,
  ],
  templateUrl: './collection-list.component.html',
  styleUrls: ['./collection-list.component.css'],
})
export class CollectionListComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  public readonly collectionService = inject(CollectionService);
  private branding = inject(BrandingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private observer?: IntersectionObserver;
  @ViewChild('scrollTrigger') scrollTrigger?: ElementRef;
  private ngZone = inject(NgZone);
  private elementRef = inject(ElementRef);

  private restorationPending = true;
  private stateInitialized = signal(false);
  private queryParamsSub?: Subscription;
  private statePersistTimer: ReturnType<typeof setTimeout> | null = null;

  private applyQueryParams(qp: Record<string, unknown>) {
    if (!qp || Object.keys(qp).length === 0) return;

    if (qp['reset'] === '1' || qp['reset'] === 'true') {
      this.filters.set({
        ownership: 1,
        play_status: 'all',
        backup_status: 'all',
        physical_verified: 'all',
        platform_id: undefined,
        regions: [],
        line: '',
        type: '',
        name: '',
        nameExact: false,
        series: '',
        seriesExact: false,
        tag: '',
        tagExact: false,
        sortBy: 'default',
        deals_only: false,
        retail_available: false,
        budget_label: 'all',
      });
      this.displayLimit.set(100);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
      return;
    }

    const qpFilters: Partial<FilterState> = {};
    if (qp['platform_id'] !== undefined) {
      const pid = parseInt(String(qp['platform_id']), 10);
      if (!isNaN(pid)) qpFilters.platform_id = pid;
    }
    if (
      qp['backup_status'] !== undefined &&
      !this.collectionService.isPublicView()
    ) {
      const val = String(qp['backup_status']);
      if (val === '0' || val === 'missing') {
        qpFilters.backup_status = 0;
      } else if (val === '1' || val === 'backed_up') {
        qpFilters.backup_status = 1;
      } else if (val === 'uncataloged') {
        qpFilters.backup_status = 'uncataloged';
      } else if (val === 'all') {
        qpFilters.backup_status = 'all';
      }
    }
    if (qp['play_status'] !== undefined) {
      const psVal = String(qp['play_status']);
      if (psVal === 'backlog' || psVal === 'queued') {
        qpFilters.play_status = 3;
      } else if (psVal === 'playing') {
        qpFilters.play_status = 2;
      } else if (psVal === 'played') {
        qpFilters.play_status = 1;
      } else {
        const ps = parseInt(psVal, 10);
        if (!isNaN(ps)) qpFilters.play_status = ps as PlayStatus;
      }
    }
    if (qp['quick_status'] !== undefined) {
      const qs = String(qp['quick_status']);
      if (qs === 'deals') {
        qpFilters.deals_only = true;
        qpFilters.ownership = 0;
      } else if (qs === 'priority_seeking') {
        qpFilters.ownership = 4;
      } else if (qs === 'seeking') {
        qpFilters.ownership = 2;
      } else if (qs === 'home_region_and_owned') {
        qpFilters.ownership = 'home_region_and_owned';
      }
    }
    if (qp['ownership'] !== undefined) {
      const ownStr = String(qp['ownership']);
      if (
        ownStr === 'all' ||
        ownStr === 'seeking_or_unowned' ||
        ownStr === 'home_region_and_owned' ||
        ownStr === 'upcoming'
      ) {
        qpFilters.ownership = ownStr;
      } else {
        const own = parseInt(ownStr, 10);
        if (!isNaN(own)) qpFilters.ownership = own as OwnershipStatus;
      }
    }
    if (qp['deals_only'] !== undefined) {
      qpFilters.deals_only =
        String(qp['deals_only']) === 'true' || String(qp['deals_only']) === '1';
    }
    if (qp['retail_available'] !== undefined) {
      qpFilters.retail_available =
        String(qp['retail_available']) === 'true' ||
        String(qp['retail_available']) === '1';
    }
    if (qp['search'] || qp['name'] || qp['q']) {
      qpFilters.name = String(qp['search'] || qp['name'] || qp['q']);
      if (qpFilters.ownership === undefined && qp['ownership'] === undefined) {
        qpFilters.ownership = 'all';
      }
    }
    if (Object.keys(qpFilters).length > 0) {
      this.filters.update((f) => ({ ...f, ...qpFilters }));
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  /** --- Reactive Application State --- */
  public currentTab = signal<'games' | 'toys'>('games');
  public filters = signal<FilterState>({
    ownership: 1,
    play_status: 'all',
    backup_status: 'all',
    physical_verified: 'all',
    platform_id: undefined,
    regions: [],
    line: '',
    type: '',
    name: '',
    nameExact: false,
    series: '',
    seriesExact: false,
    tag: '',
    tagExact: false,
    sortBy: 'default',
  });
  public displayLimit = signal<number>(100);
  public viewMode = signal<ViewMode>('grid');
  public lastUpdated = this.collectionService.lastUpdated;

  /**
   * Computes a grouped list of platforms for use in the filter dropdown.
   * Groups by 'brand' (e.g. Nintendo, Sony) to improve selection ergonomics.
   */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
    const grouped = new Map<string, Platform[]>();

    [...data].forEach((p) => {
      if (
        p.id === 0 ||
        p.name === 'No Platform' ||
        p.name === 'Physical Watch' ||
        p.display_name === 'No Platform' ||
        p.display_name === 'Physical Watch'
      ) {
        return;
      }
      const b = p.brand || 'Other';
      if (!grouped.has(b)) grouped.set(b, []);
      grouped.get(b)!.push(p);
    });

    return Array.from(grouped.entries())
      .map(([brand, platforms]) => ({ brand, platforms }))
      .sort((a, b) => {
        if (a.brand === 'Other' && b.brand !== 'Other') return 1;
        if (b.brand === 'Other' && a.brand !== 'Other') return -1;
        return a.brand.localeCompare(b.brand);
      });
  });

  private readonly COMPANION_DISC1_PAIRS = COMPANION_DISC1_PAIRS;

  private normalizeForLabelMatch(name: string): string {
    return normalizeForLabelMatch(name);
  }

  private normalizeBudgetToken(token: string): string | null {
    return normalizeBudgetToken(token);
  }

  public isBudgetLabel(label: string): boolean {
    return this.normalizeBudgetToken(label) !== null;
  }

  public getOptionalBudgetLabels(game: Game): string[] {
    if (!game.also_released_as) return [];
    const existingVariants = new Set(
      (game.variants || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    );
    const result: string[] = [];
    for (const rawToken of game.also_released_as.split(',')) {
      const canonical = this.normalizeBudgetToken(rawToken);
      if (!canonical) continue;
      const lower = canonical.toLowerCase();
      if (existingVariants.has(lower)) continue;
      if (!result.some((r) => r.toLowerCase() === lower)) {
        result.push(canonical);
      }
    }
    return result;
  }

  /**
   * Pre-computed grouped games list (disc grouping and companion disc GOTY matching).
   * Depends strictly on collectionService.games(), decoupling expensive multi-disc grouping
   * and candidate scans from active filter and search keystrokes.
   */
  public discMergedGames = computed(() => {
    const allGames = this.collectionService.games();

    // Group multiple discs of the same release version (game_id, region, variants, and base rom name)
    const groupedMap = new Map<
      string,
      Game & {
        discIds: string[];
        discBackups: number[];
        discRomNames: string[];
        discRomCrcs: string[];
      }
    >();
    for (const g of allGames) {
      const isPackIn =
        g.rom_name &&
        ((g.platform_id === 29 &&
          /^mega man legends 2.*\(demo\)/i.test(g.rom_name)) ||
          (g.platform_id === 30 &&
            /^metal gear solid 2 - sons of liberty - trial edition.*\(demo\)/i.test(
              g.rom_name,
            )) ||
          (g.platform_id === 30 &&
            /^final fantasy xii\s*\(usa\)\s*\(demo\)/i.test(g.rom_name)));

      const romKey = this.getRomGroupingKey(g.rom_name);
      let baseKey = romKey.startsWith('multi:')
        ? `${g.game_id || g.id}_${romKey}`
        : `${g.game_id || g.id}_${g.region || ''}_${g.variants || ''}_${g.canonical_release_id || ''}_${romKey}`;

      if (isPackIn) {
        // Pack-in companion bonus discs (e.g. Mega Man Legends 2 Demo inside Tron Bonne)
        // merge into the host game's primary release group so they don't spawn duplicate cards.
        const hostEntry = Array.from(groupedMap.entries()).find(
          ([k, val]) =>
            (val.game_id === g.game_id || val.stable_id === g.stable_id) &&
            val.region === g.region &&
            !k.includes('_Demo_') &&
            !k.includes('_demo_'),
        );
        if (hostEntry) {
          baseKey = hostEntry[0];
        } else {
          baseKey = `${g.game_id || g.id}_${g.region || ''}_primary`;
        }
      }
      if (!groupedMap.has(baseKey)) {
        groupedMap.set(baseKey, {
          ...g,
          discIds: [g.id],
          discBackups: [g.backup_status ? 1 : 0],
          discRomNames: [g.rom_name || ''],
          discRomCrcs: [g.rom_crc || ''],
        });
      } else {
        const existing = groupedMap.get(baseKey)!;
        existing.discIds.push(g.id);
        existing.discBackups.push(g.backup_status ? 1 : 0);
        existing.discRomNames.push(g.rom_name || '');
        if (g.rom_crc) {
          existing.discRomCrcs.push(g.rom_crc);
        }
        existing.ownership_status = Math.max(
          existing.ownership_status,
          g.ownership_status,
        );
        existing.play_status = Math.max(existing.play_status, g.play_status);
        if (g.also_released_as) {
          const merged = new Set(
            [
              ...(existing.also_released_as || '').split(','),
              ...g.also_released_as.split(','),
            ]
              .map((s) => s.trim())
              .filter(Boolean),
          );
          existing.also_released_as = Array.from(merged).join(', ');
        }
      }
    }

    // Pre-index candidate games by platform_id to accelerate companion disc matching
    const allGamesByPlatform = new Map<number, typeof allGames>();
    for (const g of allGames) {
      if (g.platform_id != null) {
        let pList = allGamesByPlatform.get(g.platform_id);
        if (!pList) {
          pList = [];
          allGamesByPlatform.set(g.platform_id, pList);
        }
        pList.push(g);
      }
    }

    return Array.from(groupedMap.values()).map((g) => {
      const discBackups = [...g.discBackups];

      // If this is a 2-disc GOTY/expanded release that only catalogs Disc 2 under its own game_id
      // (reusing the original release as Disc 1), include the regional companion Disc 1's backup_status
      // so the GOTY release is only marked backed up when BOTH Disc 1 and Disc 2 are backed up.
      const hasDisc1InGroup = g.discRomNames.some((rn) =>
        /\((?:disc|disco|disque|disk)\s+1\b/i.test(rn),
      );
      if (!hasDisc1InGroup) {
        const romLower = (g.rom_name || '').toLowerCase();
        const normRom = this.normalizeForLabelMatch(
          g.rom_name || g.title || '',
        );
        const normTitle = this.normalizeForLabelMatch(g.title || '');
        const regTokens = (g.region || '')
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const pair of this.COMPANION_DISC1_PAIRS) {
          const isSupersetMatch =
            pair.platformId === g.platform_id &&
            (!pair.supersetRomMarker ||
              romLower.includes(pair.supersetRomMarker)) &&
            ((pair.supersetStableId !== undefined &&
              pair.supersetStableId === g.stable_id) ||
              normRom === pair.supersetNormalizedTitle ||
              normTitle === pair.supersetNormalizedTitle) &&
            !pair.excludedRegions?.some((ex) => regTokens.includes(ex));
          if (isSupersetMatch) {
            const platformCandidates =
              allGamesByPlatform.get(pair.platformId) || [];
            const companionCandidates = platformCandidates.filter((cand) => {
              if (cand.id === g.id) {
                return false;
              }
              const candRomLower = (cand.rom_name || '').toLowerCase();
              if (
                pair.supersetRomMarker &&
                candRomLower.includes(pair.supersetRomMarker)
              ) {
                return false;
              }
              if (
                pair.originalExcludeMarker &&
                candRomLower.includes(pair.originalExcludeMarker)
              ) {
                return false;
              }
              const candNorm = this.normalizeForLabelMatch(
                cand.rom_name || cand.title || '',
              );
              if (
                cand.stable_id !== pair.originalStableId &&
                candNorm !== pair.originalNormalizedTitle
              ) {
                return false;
              }
              const candRegs = (cand.region || '')
                .toLowerCase()
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              if (regTokens.includes('world') || candRegs.includes('world')) {
                return true;
              }
              return regTokens.some((r) => candRegs.includes(r));
            });
            if (companionCandidates.length > 0) {
              const companionBackedUp = companionCandidates.some((c) =>
                Boolean(c.backup_status),
              )
                ? 1
                : 0;
              discBackups.unshift(companionBackedUp);
            }
            break;
          }
        }
      }

      // Release is considered backed up if all its discs are backed up
      const allBackedUp = discBackups.every((b) => b === 1) ? 1 : 0;

      // Precompute cross-language searchable names and series for optimal filter performance
      const names = new Set<string>();
      if (g.title) names.add(this.normalizeString(g.title));
      if (g.base_title && g.base_title !== g.title) {
        names.add(this.normalizeString(g.base_title));
      }
      if (g.rom_name) names.add(this.normalizeString(g.rom_name));
      if (g.discRomNames) {
        for (const rn of g.discRomNames) {
          if (rn) names.add(this.normalizeString(rn));
        }
      }
      if (g.also_released_as) {
        for (const alias of g.also_released_as.split(',')) {
          const trimmed = alias.trim();
          if (trimmed) names.add(this.normalizeString(trimmed));
        }
      }
      if (Array.isArray(g.searchableNames)) {
        for (const n of g.searchableNames) {
          if (n) names.add(this.normalizeString(n));
        }
      }
      if (g.metadata_json) {
        try {
          const parsed = JSON.parse(g.metadata_json);
          if (Array.isArray(parsed.alternative_names)) {
            for (const alt of parsed.alternative_names) {
              if (alt?.name) names.add(this.normalizeString(alt.name));
            }
          }
          if (Array.isArray(parsed.game_localizations)) {
            for (const loc of parsed.game_localizations) {
              if (loc?.name) names.add(this.normalizeString(loc.name));
            }
          }
        } catch {
          // Ignore unparseable metadata JSON
        }
      }

      const seriesSet = new Set<string>();
      const addSeriesAndAliases = (s: string | null | undefined) => {
        if (!s) return;
        const norm = this.normalizeString(s);
        if (norm) {
          seriesSet.add(norm);
          const aliases = SERIES_CROSS_LANGUAGE_ALIASES[norm];
          if (aliases) {
            for (const a of aliases) seriesSet.add(this.normalizeString(a));
          }
        }
      };

      addSeriesAndAliases(g.canonical_series);
      addSeriesAndAliases(g.series);
      if (g.franchises) {
        for (const f of g.franchises.split(',')) {
          addSeriesAndAliases(f.trim());
        }
      }
      if (g.collections) {
        for (const c of g.collections.split(',')) {
          addSeriesAndAliases(c.trim());
        }
      }

      return {
        ...g,
        backup_status: allBackedUp,
        searchableNames: Array.from(names),
        searchableSeries: Array.from(seriesSet),
      };
    });
  });

  /**
   * Reactive pipeline that applies active filters to the full games collection.
   * Handles ownership, platform, region, name, series, and tag matching.
   */
  public filteredGames = computed(() => {
    const groupedGames = this.discMergedGames();
    const f = this.filters();

    // Hoist filter string normalizations outside the iteration loop for optimal O(N) performance
    const activeNameFilter = f.name || f.seriesOrName;
    const normalizedNameFilter = activeNameFilter
      ? this.normalizeString(activeNameFilter)
      : '';
    const normalizedSeriesFilter = f.series
      ? this.normalizeString(f.series)
      : '';
    const normalizedTagFilter = f.tag ? this.normalizeString(f.tag) : '';

    const filteredGamesList = groupedGames.filter((g) => {
      // Option A: Hide bundled child discs/games from top-level collection list
      if (g.bundle_parent_id) {
        return false;
      }

      // Basic Ownership Filter
      const status = g.ownership_status ?? 0;
      if (f.ownership === 'seeking_or_unowned') {
        const isSeekingOrUnowned =
          status === OwnershipStatus.PrioritySeeking ||
          status === OwnershipStatus.Seeking ||
          status === OwnershipStatus.Unowned;
        if (!isSeekingOrUnowned) return false;
      } else if (f.ownership === 'home_region_and_owned') {
        const isOwnedOrOrdered =
          status === OwnershipStatus.Owned ||
          status === OwnershipStatus.Ordered;
        if (!isOwnedOrOrdered) {
          // For unowned or seeking games, only include if matching user's home region (with regional hierarchy)
          if (
            !isRegionMatchingHome(g.region, this.collectionService.homeRegion())
          ) {
            return false;
          }
        }
      } else if (f.ownership === 'upcoming') {
        const isUpcoming =
          (g.release_date && new Date(g.release_date) > new Date()) ||
          g.physical_status === 'not_yet_physical' ||
          (g.physical_status === 'physical_pending' &&
            status !== OwnershipStatus.Owned) ||
          status === OwnershipStatus.Ordered;
        if (!isUpcoming) return false;
      } else if (f.ownership !== 'all' && f.ownership !== status) {
        return false;
      }

      // Deals Only & Available at Retail Filters
      if (f.deals_only) {
        const isOnSale = Boolean(g.retail_on_sale);
        if (!isOnSale) return false;
      }
      if (f.retail_available) {
        if (!isItemAvailableAtRetail(g)) return false;
      }

      // Play Status Filter
      if (f.play_status !== undefined && f.play_status !== 'all') {
        const pStatus = g.play_status ?? 0;
        if (f.play_status !== pStatus) return false;
      }

      // Backup Status Filter
      if (
        !this.collectionService.isPublicView() &&
        f.backup_status !== undefined &&
        f.backup_status !== 'all'
      ) {
        if (f.backup_status === 'uncataloged') {
          const isBackedUp = (g.backup_status ? 1 : 0) === 1;
          const hasNoCrc =
            !g.rom_crc ||
            (g.discRomCrcs && g.discRomCrcs.some((c: string) => !c));
          if (!isBackedUp || !hasNoCrc) return false;
        } else {
          const bStatus = g.backup_status ? 1 : 0;
          if (f.backup_status !== bStatus) return false;
        }
      }

      // Physical Release Verified Filter
      if (f.physical_verified !== undefined && f.physical_verified !== 'all') {
        const isVerified =
          (g.is_source_verified ?? (g.rom_name ? 1 : 0)) ? 1 : 0;
        if (f.physical_verified !== isVerified) return false;
      }

      // Pre-release Guard: hide betas, protos, demos, and kiosk samplers unless it is an owned pack-in companion bonus disc
      const isPreRelease =
        (/\b(beta|proto|taikenban|trial version|promo)\b/i.test(
          g.rom_name || '',
        ) ||
          /\b(beta|proto|taikenban|trial version|promo)\b/i.test(
            g.variants || '',
          ) ||
          (/\bdemo\b/i.test(g.rom_name || '') &&
            !/demo disc/i.test(g.title || '')) ||
          (/\bdemo\b/i.test(g.variants || '') &&
            !/demo disc/i.test(g.title || ''))) &&
        !/^prototype/i.test(g.title || '');
      if (
        isPreRelease &&
        !g.companion_game_id &&
        !g.is_companion_base_disc &&
        !g.ownership_status
      ) {
        return false;
      }

      // Budget Label Status Filter (Strict Release-Level Semantics)
      if (f.budget_label && f.budget_label !== 'all') {
        const hasOptionalBudget = this.getOptionalBudgetLabels(g).length > 0;
        const hasExclusiveBudget = (g.variants || '')
          .split(',')
          .some((v) => this.isBudgetLabel(v.trim()));

        if (f.budget_label === 'standard_and_budget') {
          if (!hasOptionalBudget) return false;
        } else if (f.budget_label === 'budget_only') {
          if (!hasExclusiveBudget || hasOptionalBudget) return false;
        } else if (f.budget_label === 'standard_only') {
          if (hasExclusiveBudget || hasOptionalBudget) return false;
        }
      }

      // Platform Filter (Checks both direct platform and parent platform for cross-compatible hardware)
      if (f.platform_id) {
        if (
          g.platform_id !== f.platform_id &&
          g.parent_platform_id !== f.platform_id
        )
          return false;
      }

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (g.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some(
          (r) => r === 'World' || f.regions!.includes(r),
        );
        if (!match) return false;
      }

      // Linked Status Filter (IGDB connectivity)
      if (f.is_linked !== undefined) {
        const hasIgdb = !!g.igdb_id;
        if (f.is_linked !== hasIgdb) return false;
      }

      // Name Filter (Case, Accent, Ampersand, and Cross-Language Insensitive)
      if (normalizedNameFilter) {
        const query = normalizedNameFilter;
        const queryWithAnd = query.replace(/\s*&\s*/g, ' and ');
        const queryWithAmp = query.replace(/\band\b/g, '&');

        const matchesTerm = (term: string) => {
          if (f.nameExact) {
            return (
              term === query || term === queryWithAnd || term === queryWithAmp
            );
          }
          return (
            term.includes(query) ||
            (queryWithAnd !== query && term.includes(queryWithAnd)) ||
            (queryWithAmp !== query && term.includes(queryWithAmp))
          );
        };

        const namesList = g.searchableNames || [
          this.normalizeString(g.title || ''),
          this.normalizeString(g.rom_name || ''),
          this.normalizeString(g.also_released_as || ''),
        ];
        const seriesList = g.searchableSeries || [
          this.normalizeString(g.canonical_series || g.series || ''),
        ];

        const hasNameMatch = namesList.some(matchesTerm);
        const hasSeriesMatch = seriesList.some(matchesTerm);

        if (!hasNameMatch && !hasSeriesMatch) {
          return false;
        }
      }

      // Series Filter (Case, Accent, and Cross-Language Insensitive)
      if (normalizedSeriesFilter) {
        const query = normalizedSeriesFilter;
        const queryAliases = SERIES_CROSS_LANGUAGE_ALIASES[query] || [];
        const allQueries = [
          query,
          ...queryAliases.map((a) => this.normalizeString(a)),
        ];

        const seriesList = g.searchableSeries || [
          this.normalizeString(g.canonical_series || g.series || ''),
        ];

        const matchesSeries = (term: string) => {
          if (f.seriesExact) {
            return allQueries.some((q) => term === q);
          }
          return allQueries.some((q) => term.includes(q));
        };

        const hasSeriesMatch = seriesList.some(matchesSeries);
        if (!hasSeriesMatch) return false;
      }

      // Tag / Variant Filter (Case & Accent Insensitive)
      if (normalizedTagFilter) {
        const itemTags = (g.variants || '')
          .split(',')
          .map((v) => this.normalizeString(v.trim()))
          .filter(Boolean);
        if (g.also_released_as) {
          for (const raw of g.also_released_as.split(',')) {
            const normRaw = this.normalizeString(raw.trim());
            if (normRaw) {
              itemTags.push(normRaw);
              itemTags.push(`± ${normRaw}`);
            }
          }
          for (const optLbl of this.getOptionalBudgetLabels(g)) {
            const normOpt = this.normalizeString(optLbl);
            if (normOpt) {
              itemTags.push(normOpt);
              itemTags.push(`± ${normOpt}`);
            }
          }
        }
        if (itemTags.length === 0) return false;
        if (f.tagExact) {
          if (!itemTags.some((t) => t === normalizedTagFilter)) return false;
        } else {
          if (!itemTags.some((t) => t.includes(normalizedTagFilter)))
            return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform (Decorate-Sort-Undecorate)
     * Sorting 2,000+ games previously invoked normalizeForSort() (NFD diacritics stripping,
     * regex, and lowercase) over 35,000 times per sort trigger.
     * Precomputing sort keys once per filtered item reduces normalizations and price calculations
     * from O(N log N) to O(N).
     */
    const decoratedGames = filteredGamesList.map((g) => ({
      item: g,
      retailPrice: g.retail_price ?? null,
      discountPct: g.retail_discount_pct ?? 0,
      isPhysicalWatch:
        g.platform_id === 0 ||
        g.platform === 'Physical Watch' ||
        g.platform === 'No Platform' ||
        g.display_name === 'Physical Watch' ||
        g.display_name === 'No Platform',
      platformLaunchDate: g.platform_launch_date || '9999-99-99',
      normBrand: this.normalizeForSort(g.brand || ''),
      normSeries: this.normalizeForSort(g.canonical_series || g.title),
      releaseDate: g.release_date || '9999-99-99',
      sortIndex: g.sort_index ?? 9999,
      variantPriority: this.getVariantPriority(g.variants),
      region: g.region || '',
      id: g.id || '',
    }));

    decoratedGames.sort((a, b) => {
      // Retail Price Sorting (Low to High)
      if (f.sortBy === 'retail_asc') {
        if (a.retailPrice !== null || b.retailPrice !== null) {
          if (a.retailPrice === null) return 1;
          if (b.retailPrice === null) return -1;
          if (a.retailPrice !== b.retailPrice)
            return a.retailPrice - b.retailPrice;
        }
      }

      // Deepest Sale Discount Sorting (High to Low)
      if (f.sortBy === 'discount_desc') {
        if (a.discountPct !== b.discountPct)
          return b.discountPct - a.discountPct;
        const priceA = a.retailPrice ?? 999999;
        const priceB = b.retailPrice ?? 999999;
        if (priceA !== priceB) return priceA - priceB;
      }

      // Release Date Sorting
      if (f.sortBy === 'release_desc' || f.sortBy === 'release_asc') {
        const isDesc = f.sortBy === 'release_desc';
        // Treat placeholder/null '9999-99-99' as unknown and sort them to the end in both directions
        const aKnown = a.releaseDate !== '9999-99-99';
        const bKnown = b.releaseDate !== '9999-99-99';
        if (aKnown && bKnown) {
          if (a.releaseDate !== b.releaseDate) {
            return isDesc
              ? b.releaseDate.localeCompare(a.releaseDate)
              : a.releaseDate.localeCompare(b.releaseDate);
          }
        } else if (aKnown !== bKnown) {
          return aKnown ? -1 : 1;
        }
      }

      const isBypassPlatformGroupSort =
        f.sortBy === 'retail_asc' ||
        f.sortBy === 'discount_desc' ||
        f.sortBy === 'release_desc' ||
        f.sortBy === 'release_asc';

      if (!isBypassPlatformGroupSort) {
        // 0. Always sort Platform 0 ('Physical Watch') after all hardware platforms
        if (a.isPhysicalWatch !== b.isPhysicalWatch) {
          return a.isPhysicalWatch ? 1 : -1;
        }

        // 1. Platform Launch Date (ASC)
        if (a.platformLaunchDate !== b.platformLaunchDate) {
          return a.platformLaunchDate.localeCompare(b.platformLaunchDate);
        }

        // 2. Platform Brand (ASC)
        if (a.normBrand !== b.normBrand) {
          return a.normBrand.localeCompare(b.normBrand);
        }
      }

      // 3. Game Canonical Series (ASC, fallback to title)
      if (a.normSeries !== b.normSeries) {
        return a.normSeries.localeCompare(b.normSeries);
      }

      // 4. Game Release Date (ASC, nulls last)
      if (a.releaseDate !== b.releaseDate) {
        return a.releaseDate.localeCompare(b.releaseDate);
      }

      // 5. Sort Index (ASC, nulls last)
      if (a.sortIndex !== b.sortIndex) {
        return a.sortIndex - b.sortIndex;
      }

      // 5.5. Variant Priority (ASC)
      if (a.variantPriority !== b.variantPriority) {
        return a.variantPriority - b.variantPriority;
      }

      // 6. Region (ASC)
      if (a.region !== b.region) {
        return a.region.localeCompare(b.region);
      }

      // 7. Release ID (ASC)
      return a.id.localeCompare(b.id);
    });

    return decoratedGames.map((entry) => entry.item);
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

  private getVariantPriority(variants: string | null | undefined): number {
    if (!variants) return 0;
    const lower = variants.toLowerCase();
    if (/\b(beta|proto|prototype|demo|kiosk|sample|promo)\b/i.test(lower)) {
      return 2;
    }
    return 1;
  }

  private getToyTypeOrder(type: string | null | undefined): number {
    switch (type) {
      case 'Figure':
        return 1;
      case 'Yarn':
        return 2;
      case 'Block':
        return 3;
      case 'Band':
        return 4;
      case 'Card':
        return 5;
      default:
        return 99;
    }
  }

  private getRomGroupingKey(filename: string | null | undefined): string {
    return getRomGroupingKey(filename);
  }

  /** Virtual list window based on displayLimit for infinite scroll performance */
  public displayGames = computed(() =>
    this.filteredGames().slice(0, this.displayLimit()),
  );

  /**
   * Computes the final UI grouping for games, organized by Platform.
   * When any retail/release sort mode is active, bypasses platform grouping and presents
   * a single unified list ranked across platforms.
   */
  public groupedGames = computed(() => {
    const allFiltered = this.filteredGames();
    const displayed = this.displayGames();
    const f = this.filters();

    const isPriceSort =
      f.sortBy === 'retail_asc' || f.sortBy === 'discount_desc';

    const isReleaseDateSort =
      f.sortBy === 'release_desc' || f.sortBy === 'release_asc';
    const isFlatSort = isPriceSort || isReleaseDateSort;

    if (isFlatSort) {
      const sortLabel =
        f.sortBy === 'retail_asc'
          ? 'Ranked by Lowest Retail Price'
          : f.sortBy === 'discount_desc'
            ? 'Ranked by Biggest Sale %'
            : f.sortBy === 'release_desc'
              ? 'Ranked by Release Date (Newest First)'
              : 'Ranked by Release Date (Oldest First)';
      const headerTitle = f.platform_id
        ? `${displayed[0]?.display_name || displayed[0]?.platform || 'Platform'} (${sortLabel})`
        : `All Platforms (${sortLabel})`;
      return [
        {
          platformName: headerTitle,
          platformLogo: f.platform_id ? displayed[0]?.platform_logo : null,
          games: displayed,
          totalCount: allFiltered.length,
        },
      ];
    }

    // 1. Calculate total counts per platform from ALL filtered games
    const counts = new Map<string, number>();
    for (const g of allFiltered) {
      const rawPlat = g.display_name || g.platform;
      const p =
        g.platform_id === 0 || rawPlat === 'No Platform'
          ? 'Physical Watch'
          : rawPlat;
      counts.set(p, (counts.get(p) || 0) + 1);
    }

    // 2. Build groups from DISPLAYED games
    const groups: GameGroup[] = [];
    const groupMap = new Map<string, GameGroup>();

    for (const game of displayed) {
      const rawPlat = game.display_name || game.platform;
      const p =
        game.platform_id === 0 || rawPlat === 'No Platform'
          ? 'Physical Watch'
          : rawPlat;
      let group = groupMap.get(p);
      if (!group) {
        group = {
          platformName: p,
          platformLogo: game.platform_logo,
          launchYear: game.platform_launch_date
            ? (() => {
                const parts = game.platform_launch_date.split('-');
                if (parts.length === 3) {
                  const y = parseInt(parts[0], 10);
                  const m = parseInt(parts[1], 10) - 1;
                  const d = parseInt(parts[2], 10);
                  const dt = new Date(y, m, d);
                  return new Intl.DateTimeFormat('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(dt);
                }
                return game.platform_launch_date;
              })()
            : undefined,
          games: [],
          totalCount: counts.get(p) || 0,
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

    const activeNameFilter = f.name || f.seriesOrName;
    const normalizedNameFilter = activeNameFilter
      ? this.normalizeString(activeNameFilter)
      : '';
    const normalizedSeriesFilter = f.series
      ? this.normalizeString(f.series)
      : '';

    const filteredToysList = allToys.filter((toy) => {
      // Ownership Filter
      const status = toy.ownership_status ?? 0;
      if (f.ownership === 'seeking_or_unowned') {
        const isSeekingOrUnowned =
          status === OwnershipStatus.PrioritySeeking ||
          status === OwnershipStatus.Seeking ||
          status === OwnershipStatus.Unowned;
        if (!isSeekingOrUnowned) return false;
      } else if (f.ownership === 'home_region_and_owned') {
        const isOwnedOrOrdered =
          status === OwnershipStatus.Owned ||
          status === OwnershipStatus.Ordered;
        if (!isOwnedOrOrdered) {
          if (
            !isRegionMatchingHome(
              toy.region,
              this.collectionService.homeRegion(),
            )
          ) {
            return false;
          }
        }
      } else if (f.ownership !== 'all' && f.ownership !== status) {
        return false;
      }

      // Deals Only & Available at Retail Filters
      if (f.deals_only) {
        if (!toy.retail_on_sale) return false;
      }
      if (f.retail_available) {
        if (!isItemAvailableAtRetail(toy)) return false;
      }

      // Line Filter (e.g. Amiibo, Skylanders)
      if (f.line && toy.line !== f.line) return false;

      // Type Filter (e.g. Figure, Card)
      if (f.type && toy.type !== f.type) return false;

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (toy.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some(
          (r) => r === 'World' || f.regions!.includes(r),
        );
        if (!match) return false;
      }

      // Name Filter (Case, Accent, and Ampersand Insensitive)
      if (normalizedNameFilter) {
        const query = normalizedNameFilter;
        const queryWithAnd = query.replace(/\s*&\s*/g, ' and ');
        const queryWithAmp = query.replace(/\band\b/g, '&');
        const normalizedName = this.normalizeString(toy.name || '');
        const normalizedSeries = this.normalizeString(toy.series_name || '');

        const matchesToyTerm = (term: string) => {
          if (f.nameExact) {
            return (
              term === query || term === queryWithAnd || term === queryWithAmp
            );
          }
          return (
            term.includes(query) ||
            (queryWithAnd !== query && term.includes(queryWithAnd)) ||
            (queryWithAmp !== query && term.includes(queryWithAmp))
          );
        };

        if (
          !matchesToyTerm(normalizedName) &&
          !matchesToyTerm(normalizedSeries)
        ) {
          return false;
        }
      }

      // Series Filter (Case & Accent Insensitive)
      if (normalizedSeriesFilter) {
        const normalizedSeries = this.normalizeString(toy.series_name || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedSeriesFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedSeriesFilter)) return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform for Toys
     * Precomputing line, series name, toy name, and type orders reduces string normalization
     * overhead during sorting across hundreds of toys.
     */
    const decoratedToys = filteredToysList.map((toy) => ({
      item: toy,
      retailPrice: toy.retail_price ?? null,
      discountPct: toy.retail_discount_pct ?? 0,
      normLine: this.normalizeForSort(toy.line),
      seriesIndex: toy.series_index ?? 9999,
      normSeries: this.normalizeForSort(toy.series_name || ''),
      isAmiibo: toy.line === 'amiibo',
      toyTypeOrder: this.getToyTypeOrder(toy.type),
      releaseDate: toy.release_date || '9999-99-99',
      sortIndex: toy.sort_index ?? 9999,
      normName: this.normalizeForSort(toy.name || ''),
    }));

    decoratedToys.sort((a, b) => {
      // Retail Price Sorting (Low to High)
      if (f.sortBy === 'retail_asc') {
        if (a.retailPrice !== null || b.retailPrice !== null) {
          if (a.retailPrice === null) return 1;
          if (b.retailPrice === null) return -1;
          if (a.retailPrice !== b.retailPrice)
            return a.retailPrice - b.retailPrice;
        }
      }

      // Deepest Sale Discount Sorting (High to Low)
      if (f.sortBy === 'discount_desc') {
        if (a.discountPct !== b.discountPct)
          return b.discountPct - a.discountPct;
        const priceA = a.retailPrice ?? 999999;
        const priceB = b.retailPrice ?? 999999;
        if (priceA !== priceB) return priceA - priceB;
      }

      // Release Date Sorting
      if (f.sortBy === 'release_desc' || f.sortBy === 'release_asc') {
        const isDesc = f.sortBy === 'release_desc';
        const aKnown = a.releaseDate !== '9999-99-99';
        const bKnown = b.releaseDate !== '9999-99-99';
        if (aKnown && bKnown) {
          if (a.releaseDate !== b.releaseDate) {
            return isDesc
              ? b.releaseDate.localeCompare(a.releaseDate)
              : a.releaseDate.localeCompare(b.releaseDate);
          }
        } else if (aKnown !== bKnown) {
          return aKnown ? -1 : 1;
        }
      }

      const isBypassLineGroupSort =
        f.sortBy === 'retail_asc' ||
        f.sortBy === 'discount_desc' ||
        f.sortBy === 'release_desc' ||
        f.sortBy === 'release_asc';

      if (!isBypassLineGroupSort) {
        // 1. Line (ASC)
        if (a.normLine !== b.normLine) {
          return a.normLine.localeCompare(b.normLine);
        }

        // 2. Series Sort Index or Name (ASC)
        if (a.seriesIndex !== b.seriesIndex) {
          return a.seriesIndex - b.seriesIndex;
        }
        if (a.normSeries !== b.normSeries) {
          return a.normSeries.localeCompare(b.normSeries);
        }
      }

      // 3. Toy-level sorting
      if (a.isAmiibo) {
        // Priority 1: Type (Figure -> Yarn -> Block -> Band -> Card)
        if (a.toyTypeOrder !== b.toyTypeOrder) {
          return a.toyTypeOrder - b.toyTypeOrder;
        }

        // Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }

        // Priority 3: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }
      } else {
        // Non-amiibo Priority 1: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }

        // Non-amiibo Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }
      }

      // 4. Name (ASC) fallback
      return a.normName.localeCompare(b.normName);
    });

    return decoratedToys.map((entry) => entry.item);
  });

  /** Virtual list window for toys */
  public displayToys = computed(() =>
    this.filteredToys().slice(0, this.displayLimit()),
  );

  /**
   * Computes the UI grouping for toys, organized by 'Line'.
   */
  public groupedToys = computed(() => {
    const displayed = this.displayToys();
    const allFiltered = this.filteredToys();
    const f = this.filters();

    const isFlatSort =
      f.sortBy === 'retail_asc' ||
      f.sortBy === 'discount_desc' ||
      f.sortBy === 'release_desc' ||
      f.sortBy === 'release_asc';

    if (isFlatSort) {
      const sortLabel =
        f.sortBy === 'retail_asc'
          ? 'Ranked by Lowest Retail Price'
          : f.sortBy === 'discount_desc'
            ? 'Ranked by Biggest Sale %'
            : f.sortBy === 'release_desc'
              ? 'Ranked by Release Date (Newest First)'
              : 'Ranked by Release Date (Oldest First)';
      const lineTitle = f.line
        ? `${f.line} (${sortLabel})`
        : `All Lines (${sortLabel})`;
      return [
        {
          lineName: lineTitle,
          seriesGroups: [
            {
              seriesName: sortLabel,
              toys: displayed,
              totalCount: allFiltered.length,
            },
          ],
          totalCount: allFiltered.length,
        },
      ];
    }

    // 1. Get total counts per line and per series from ALL filtered toys
    const lineCounts = new Map<string, number>();
    const seriesCounts = new Map<string, Map<string, number>>();

    for (const toy of allFiltered) {
      const line = toy.line || 'Unknown';
      const series = toy.series_name || 'No Series';

      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);

      if (!seriesCounts.has(line)) seriesCounts.set(line, new Map());
      const sMap = seriesCounts.get(line)!;
      sMap.set(series, (sMap.get(series) || 0) + 1);
    }

    // 2. Build nested groups from DISPLAYED toys
    const groups: ToyGroup[] = [];
    const lineMap = new Map<string, ToyGroup>();

    for (const toy of displayed) {
      const lineName = toy.line || 'Unknown';
      const seriesName = toy.series_name || 'No Series';

      let lineGroup = lineMap.get(lineName);
      if (!lineGroup) {
        lineGroup = {
          lineName,
          seriesGroups: [],
          totalCount: lineCounts.get(lineName) || 0,
        };
        groups.push(lineGroup);
        lineMap.set(lineName, lineGroup);
      }

      let seriesGroup = lineGroup.seriesGroups.find(
        (sg) => sg.seriesName === seriesName,
      );
      if (!seriesGroup) {
        seriesGroup = {
          seriesName,
          toys: [],
          totalCount: seriesCounts.get(lineName)?.get(seriesName) || 0,
        };
        lineGroup.seriesGroups.push(seriesGroup);
      }
      seriesGroup.toys.push(toy);
    }
    return groups;
  });

  /** --- Utility Selectors for Filter Dropdowns --- */
  public uniqueLines = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.line)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  public uniqueTypes = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.type)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  public uniqueNames = computed<string[]>(() => {
    if (this.currentTab() === 'games') {
      const list = this.collectionService.games().map((g) => g.title);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    } else {
      const list = this.collectionService.toys().map((t) => t.name);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    }
  });

  public uniqueSeries = computed(() => {
    if (this.currentTab() === 'games') {
      const list = this.collectionService
        .games()
        .map((g) => g.canonical_series);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    } else {
      const seriesMap = new Map<string, number | undefined>();
      for (const toy of this.collectionService.toys()) {
        if (toy.series_name) {
          if (
            !seriesMap.has(toy.series_name) ||
            (seriesMap.get(toy.series_name) === undefined &&
              toy.series_index !== undefined)
          ) {
            seriesMap.set(toy.series_name, toy.series_index);
          }
        }
      }
      return Array.from(seriesMap.keys())
        .filter(Boolean)
        .sort((a, b) => {
          const indexA = seriesMap.get(a) ?? 9999;
          const indexB = seriesMap.get(b) ?? 9999;
          if (indexA !== indexB) {
            return indexA - indexB;
          }
          return this.normalizeForSort(a).localeCompare(
            this.normalizeForSort(b),
          );
        });
    }
  });

  public uniqueTags = computed<string[]>(() => {
    const tagsSet = new Set<string>();
    for (const g of this.collectionService.games()) {
      if (g.variants) {
        g.variants.split(',').forEach((v) => {
          const trimmed = v.trim();
          if (trimmed) tagsSet.add(trimmed);
        });
      }
    }
    return Array.from(tagsSet).sort((a, b) =>
      this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
    );
  });

  public uniqueRegions = computed<string[]>(() => {
    const regionsSet = new Set<string>();

    for (const g of this.collectionService.games()) {
      if (g.region) {
        g.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    for (const t of this.collectionService.toys()) {
      if (t.region) {
        t.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    return Array.from(regionsSet).sort();
  });

  /**
   * Initializes the component and sets up the state persistence effect.
   * This effect ensures that any change to filters or display limits is
   * automatically mirrored in the CollectionService and sessionStorage.
   */
  constructor() {
    effect(() => {
      const tab = this.currentTab();
      const filters = this.filters();
      const displayLimit = this.displayLimit();
      const viewMode = this.viewMode();
      const initialized = this.stateInitialized();

      if (initialized) {
        const current = untracked(() =>
          this.collectionService.getListState(tab),
        );
        const state: ListState = {
          tab,
          filters,
          displayLimit,
          viewMode,
          scrollX: current?.scrollX ?? 0,
          scrollY: current?.scrollY ?? 0,
        };
        if (this.statePersistTimer) {
          clearTimeout(this.statePersistTimer);
        }
        this.statePersistTimer = setTimeout(() => {
          this.statePersistTimer = null;
          this.collectionService.updateListState(state);
        }, 150);
      }
    });
  }

  /**
   * Listens for scroll events outside of Angular's zone to prevent change detection
   * from firing on every frame, which causes severe scroll jank. Throttled.
   */
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isScrollListenerAttached = false;

  private attachScrollListener() {
    if (this.isScrollListenerAttached || typeof window === 'undefined') return;
    this.isScrollListenerAttached = true;
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.onScrollHandler, {
        passive: true,
      });
    });
  }

  private onScrollHandler = () => {
    if (!this.elementRef.nativeElement.isConnected) return;
    if (this.scrollTimeout) return;
    this.scrollTimeout = setTimeout(() => {
      this.scrollTimeout = null;
      if (!this.elementRef.nativeElement.isConnected) return;
      if (this.stateInitialized() && window.scrollY >= 0) {
        const currentState = this.collectionService.getListState(
          this.currentTab(),
        );
        const state: ListState = currentState || {
          tab: this.currentTab(),
          filters: this.filters(),
          displayLimit: this.displayLimit(),
          scrollX: 0,
          scrollY: 0,
        };

        this.collectionService.updateListState({
          ...state,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
    }, 100);
  };

  /**
   * Restores the previously saved scroll position after rendering.
   * Since displayLimit is hydrated before initial render, all items are present
   * in the DOM tree upfront.
   */
  private restoreScroll() {
    const savedState = this.collectionService.getListState(this.currentTab());
    if (
      !savedState ||
      savedState.scrollY === undefined ||
      savedState.scrollY <= 0
    ) {
      this.stateInitialized.set(true);
      this.attachScrollListener();
      return;
    }

    const targetY = savedState.scrollY;
    const targetX = savedState.scrollX || 0;

    if (typeof window === 'undefined') {
      this.stateInitialized.set(true);
      return;
    }

    window.scrollTo({
      left: targetX,
      top: targetY,
      behavior: 'instant' as ScrollBehavior,
    });

    this.stateInitialized.set(true);
    this.attachScrollListener();
  }

  private isInitialized = false;

  /**
   * Component Lifecycle: Restores previous tab state and initiates data refresh.
   */
  async ngOnInit() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.stateInitialized.set(false);
    this.currentTab.set(
      (this.route.snapshot.url[0]?.path as 'games' | 'toys') || 'games',
    );

    const savedState = this.collectionService.getListState(this.currentTab());
    if (savedState) {
      const validSorts = new Set([
        'default',
        'retail_asc',
        'discount_desc',
        'release_desc',
        'release_asc',
      ]);
      const normalizedSortBy =
        savedState.filters.sortBy && validSorts.has(savedState.filters.sortBy)
          ? savedState.filters.sortBy
          : 'default';
      this.filters.set({
        ...savedState.filters,
        sortBy: normalizedSortBy,
      });
      this.displayLimit.set(savedState.displayLimit);
      if (savedState.viewMode) {
        this.viewMode.set(savedState.viewMode);
      }
    } else if (typeof localStorage !== 'undefined') {
      const globalPref = localStorage.getItem(
        'app_preferred_view_mode',
      ) as ViewMode | null;
      if (globalPref === 'grid' || globalPref === 'compact') {
        this.viewMode.set(globalPref);
      }
    }

    // Apply any inbound query parameters (e.g. from Insights drill-down links)
    if (this.route?.snapshot?.queryParams) {
      this.applyQueryParams(this.route.snapshot.queryParams);
    }
    if (this.route?.queryParams) {
      this.queryParamsSub = this.route.queryParams.subscribe((params) => {
        this.applyQueryParams(params);
      });
    }

    const hasData =
      this.collectionService.isLoadedForCurrentContext() &&
      (this.currentTab() === 'games'
        ? this.collectionService.games().length > 0
        : this.collectionService.toys().length > 0);

    if (hasData) {
      this.restoreScroll();
    } else {
      await this.collectionService.refreshAll();
      this.restoreScroll();
    }
  }

  /**
   * Sets up the IntersectionObserver for infinite scrolling after the view is ready.
   */
  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  /**
   * Cleanup: disconnects observer to prevent memory leaks and persists final state.
   */
  ngOnDestroy() {
    this.isInitialized = false;
    if (this.statePersistTimer) {
      clearTimeout(this.statePersistTimer);
      this.statePersistTimer = null;
    }
    if (this.queryParamsSub) {
      this.queryParamsSub.unsubscribe();
    }
    if (this.observer) this.observer.disconnect();
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScrollHandler);
      this.isScrollListenerAttached = false;
      if (this.stateInitialized()) {
        const currentState = this.collectionService.getListState(
          this.currentTab(),
        );
        const state: ListState = currentState || {
          tab: this.currentTab(),
          filters: this.filters(),
          displayLimit: this.displayLimit(),
          viewMode: this.viewMode(),
          scrollX: 0,
          scrollY: 0,
        };
        this.collectionService.updateListState({
          ...state,
          displayLimit: this.displayLimit(),
          viewMode: this.viewMode(),
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
    }
    this.collectionService.persistState(this.currentTab());
  }

  /**
   * Initializes the IntersectionObserver that triggers 'loadMore' when the
   * user reaches the bottom of the list.
   */
  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.loadMore();
      },
      { root: null, rootMargin: '200px', threshold: 0.1 },
    );
    if (this.scrollTrigger?.nativeElement)
      this.observer.observe(this.scrollTrigger.nativeElement);
  }

  /**
   * Increases the virtual display limit, triggering the computed reactive
   * pipelines to slice a larger portion of the collection into the DOM.
   */
  loadMore() {
    if (!this.stateInitialized()) return;
    this.displayLimit.update((limit) => limit + 100);
  }

  /**
   * Event handler for filter updates from the child component.
   * Resets the display limit to ensure performance.
   */
  onFiltersChange(newFilters: FilterState) {
    this.filters.set({ ...newFilters });
    this.displayLimit.set(100);
    if (
      this.route?.snapshot?.queryParams &&
      Object.keys(this.route.snapshot.queryParams).length > 0
    ) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  /**
   * Event handler for view mode toggle updates (grid vs compact rows).
   */
  onViewModeChange(mode: ViewMode) {
    this.viewMode.set(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('app_preferred_view_mode', mode);
    }
  }

  /** --- Toggle Ownership Handlers --- */
  onToggleStatus(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    if (this.collectionService.isPublicView()) {
      return;
    }

    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const name = (item as Game).title || (item as Toy).name;
    const prevStatus = item.ownership_status;

    this.collectionService.showOptions(
      `Change Status`,
      `Set status for "${name}":`,
      [
        { label: 'Unowned', value: 0 },
        { label: 'Owned', value: 1 },
        { label: 'Priority Seeking', value: 4 },
        { label: 'Seeking', value: 2 },
        { label: 'Ordered', value: 3 },
      ],
      (newValue) => {
        const numValue =
          typeof newValue === 'string' ? parseInt(newValue, 10) : newValue;
        if (isNaN(numValue) || numValue < 0 || numValue > 4) return;

        item.ownership_status = numValue;
        if (type === 'game') {
          this.collectionService.patchGameOptimistic(item.id, {
            ownership_status: numValue,
          });
        } else {
          this.collectionService.patchToyOptimistic(item.id, {
            ownership_status: numValue,
          });
        }
        this.collectionService
          .toggleOwnership(item.id, type, numValue)
          .subscribe({
            error: (err) => {
              item.ownership_status = prevStatus;
              if (type === 'game') {
                this.collectionService.patchGameOptimistic(item.id, {
                  ownership_status: prevStatus,
                });
              } else {
                this.collectionService.patchToyOptimistic(item.id, {
                  ownership_status: prevStatus,
                });
              }
              console.error('Failed to set status:', err);
            },
          });
      },
    );
  }

  onEditSortIndex(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const name = (item as Game).title || (item as Toy).name;
    const currentSort = item.sort_index ?? 0;
    const prevSort = item.sort_index;

    this.collectionService.showInput(
      `Edit Sort Index`,
      `Set sort index for "${name}":`,
      currentSort,
      (newValue) => {
        const numValue =
          newValue === '' || newValue === null
            ? 0
            : typeof newValue === 'string'
              ? parseInt(newValue, 10)
              : newValue;
        if (isNaN(numValue)) return;

        item.sort_index = numValue;
        if (type === 'game') {
          this.collectionService.patchGameOptimistic(item.id, {
            sort_index: numValue,
          });
        } else {
          this.collectionService.patchToyOptimistic(item.id, {
            sort_index: numValue,
          });
        }
        this.collectionService
          .updateSortIndex(item.id, type, numValue)
          .subscribe({
            error: (err) => {
              item.sort_index = prevSort;
              if (type === 'game') {
                this.collectionService.patchGameOptimistic(item.id, {
                  sort_index: prevSort,
                });
              } else {
                this.collectionService.patchToyOptimistic(item.id, {
                  sort_index: prevSort ?? undefined,
                });
              }
              console.error('Failed to update sort index:', err);
            },
          });
      },
    );
  }

  public getGamePriceBadge(
    game: Game,
  ): { cents: number; label: string } | null {
    if (game.retail_price) {
      return { cents: game.retail_price, label: game.retail_store || 'Retail' };
    }
    return null;
  }

  onToggleCase(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const prevStatus = game.has_case;
    const current = Boolean(game.has_case);
    const newStatus = current ? 0 : 1;
    game.has_case = newStatus;
    this.collectionService.patchGameOptimistic(game.id, {
      has_case: newStatus,
    });
    this.collectionService.updateHasCase(game.id, newStatus).subscribe({
      error: (err) => {
        game.has_case = prevStatus;
        this.collectionService.patchGameOptimistic(game.id, {
          has_case: prevStatus,
        });
        console.error('Failed to toggle case:', err);
      },
    });
  }

  onToggleManual(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const prevStatus = game.has_manual;
    const current = Boolean(game.has_manual);
    const newStatus = current ? 0 : 1;
    game.has_manual = newStatus;
    this.collectionService.patchGameOptimistic(game.id, {
      has_manual: newStatus,
    });
    this.collectionService.updateHasManual(game.id, newStatus).subscribe({
      error: (err) => {
        game.has_manual = prevStatus;
        this.collectionService.patchGameOptimistic(game.id, {
          has_manual: prevStatus,
        });
        console.error('Failed to toggle manual:', err);
      },
    });
  }

  public getBackedUpDiscCount(game: Game): number {
    return (game.discBackups || []).filter((b) => b === 1).length;
  }

  public onToggleDiscBackup(
    event: MouseEvent,
    game: Game,
    discIndex: number,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.collectionService.isPublicView()) {
      return;
    }
    if (!this.collectionService.isAuthenticated()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    const discId = game.discIds?.[discIndex];
    if (!discId) return;
    const prevDiscBackups = game.discBackups
      ? [...game.discBackups]
      : undefined;
    const prevBackupStatus = game.backup_status;
    const current = game.discBackups?.[discIndex] === 1;
    const newStatus = current ? 0 : 1;
    if (game.discBackups) {
      game.discBackups[discIndex] = newStatus;
      game.backup_status = game.discBackups.every((b) => b === 1) ? 1 : 0;
    }
    this.collectionService.patchDiscBackupOptimistic(discId, newStatus);
    this.collectionService.updateBackupStatus(discId, newStatus).subscribe({
      error: (err) => {
        if (game.discBackups && prevDiscBackups) {
          game.discBackups = prevDiscBackups;
          game.backup_status = prevBackupStatus;
        }
        this.collectionService.patchDiscBackupOptimistic(
          discId,
          current ? 1 : 0,
        );
        console.error('Failed to toggle disc backup:', err);
      },
    });
  }
}
