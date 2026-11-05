/**
 * GAME & TOY DISCOVERY CENTER COMPONENT
 *
 * This component provides three comprehensive discovery and ingestion workflows:
 * 1. Manual Search: Allows user-triggered IGDB searches on a specific platform, physical DAT file matching,
 *    and configuration of metadata (ownership status, play status, backup status) before adding to SQLite / D1.
 * 2. Series Discovery: Triggers an automated scan of all tracked franchises/series on IGDB to suggest missing games,
 *    supporting one-click and bulk checkbox ingestion.
 * 3. Amiibo Discovery: Scans the canonical AmiiboAPI to discover unowned/newly released figures & cards missing
 *    from the user's collection, supporting one-click and bulk ingestion.
 *
 * DESIGN DECISIONS:
 * - Direct, tabbed navigation between Game Search, Franchise Discovery, and Amiibo Discovery.
 * - M3 styling and glassmorphic aesthetics for a responsive, clean collection experience.
 * - Robust fallback logic to handle unit tests context where some service signals are mocked.
 */

import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Platform,
  PlatformGroup,
  IGDBSearchResult,
  ScanSuggestion,
  DiscoveryRelease,
  AmiiboDiscoveryItem,
  Toy,
} from '../../../../core/models/collection.models';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-discovery-list',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './discovery-list.component.html',
  styleUrls: ['./discovery-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryListComponent implements OnInit, OnDestroy {
  public collectionService = inject(CollectionService);

  /** Active navigation tab. Defaults to Game Search ('search'). */
  public activeTab = signal<'search' | 'scan' | 'amiibo'>('search');

  /** Manual search logic signals. */
  public searchResults = signal<IGDBSearchResult[]>([]);
  public searchLoading = signal<boolean>(false);
  public searchError = signal<string | null>(null);
  public searchPerformed = signal<boolean>(false);
  public lastQuery = signal<string>('');
  public filterDigital = signal<boolean>(true);
  public selectedPlatformsByGame = signal<Map<string, Set<number>>>(new Map());

  public bulkActionBarVisible = computed<boolean>(() => {
    const tab = this.activeTab();
    if (tab === 'scan') return this.selectedScanGameIds().size > 0;
    if (tab === 'amiibo') return this.selectedAmiiboIds().size > 0;
    return false;
  });

  /** Series scan logic signals. */
  public scanResults = signal<ScanSuggestion[]>([]);
  public scanLoading = signal<boolean>(false);
  public scanError = signal<string | null>(null);
  public scanPerformed = signal<boolean>(false);
  public selectedScanGameIds = signal<Set<string>>(new Set());

  /** Selected series for targeted franchise scan. Empty string means All Franchises. */
  public selectedSeries = signal<string>('');

  /** Progress tracking for progressive series scan. */
  public scanProgress = signal<{
    scanned: number;
    total: number;
    percent: number;
  } | null>(null);

  /** Whether the user stopped / cancelled the progressive scan early. */
  public scanCancelled = signal<boolean>(false);

  /** Cancellation flag for the progressive scan loop. */
  private scanCancelRequested = false;

  /** Sequence counters to prevent out-of-order HTTP responses from overwriting newer UI state. */
  private searchRequestSeq = 0;
  private modalMatchesRequestSeq = 0;

  /** Tracked franchise series list derived from collected games. */
  public trackedSeriesList = computed<{ name: string; count: number }[]>(() => {
    const games =
      this.collectionService && this.collectionService.games
        ? this.collectionService.games()
        : [];
    const map = new Map<string, number>();
    for (const g of games) {
      if (g.canonical_series && g.canonical_series.trim()) {
        const s = g.canonical_series.trim();
        map.set(s, (map.get(s) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  /** Amiibo discovery logic signals. */
  public amiiboResults = signal<AmiiboDiscoveryItem[]>([]);
  public amiiboLoading = signal<boolean>(false);
  public amiiboError = signal<string | null>(null);
  public amiiboPerformed = signal<boolean>(false);
  public selectedAmiiboIds = signal<Set<string>>(new Set());
  public amiiboSeriesFilter = signal<string>('all');
  public amiiboTypeFilter = signal<string>('all');
  public amiiboSearchQuery = signal<string>('');

  /** Ingestion modal status signals. */
  public showModal = signal<boolean>(false);
  public modalLoading = signal<boolean>(false);
  public modalGame = signal<IGDBSearchResult | null>(null);
  public modalPlatformId = signal<number>(0);
  public matchedReleases = signal<DiscoveryRelease[]>([]);
  public selectedReleaseIds = signal<Set<string>>(new Set());

  /** Ingestion form data signals. */
  public ownershipStatus = signal<number>(1);
  public playStatus = signal<number>(0);
  public backupStatus = signal<number>(0);

  /** Tracks the initial platform ID selected when the modal is opened. */
  public modalInitialPlatformId = signal<number>(0);

  /** Active toast message displayed at the bottom of the screen. */
  public toastMessage = signal<string | null>(null);

  /** Reference to the active toast auto-dismiss timer. */
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Preserved window scroll coordinate before opening the ingestion modal. */
  private savedScrollY = 0;

  /** Computes the platform list grouped by brand for platform selector optgroups. */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms
      ? this.collectionService.platforms()
      : [];
    const grouped = new Map<string, Platform[]>();

    [...data].forEach((p) => {
      const b = p.brand || 'Other';
      if (!grouped.has(b)) grouped.set(b, []);
      grouped.get(b)!.push(p);
    });

    return Array.from(grouped.entries())
      .map(([brand, platforms]) => ({ brand, platforms }))
      .sort((a, b) => a.brand.localeCompare(b.brand));
  });

  /** Computes unique Amiibo series options for filtering. */
  public amiiboSeriesList = computed<string[]>(() => {
    const seriesSet = new Set<string>();
    this.amiiboResults().forEach((a) => {
      if (a.series_name) seriesSet.add(a.series_name);
    });
    return Array.from(seriesSet).sort();
  });

  /** Computes unique Amiibo types for filtering. */
  public amiiboTypesList = computed<string[]>(() => {
    const typeSet = new Set<string>();
    this.amiiboResults().forEach((a) => {
      if (a.type) typeSet.add(a.type);
    });
    return Array.from(typeSet).sort();
  });

  /** Filtered search results (all search results). */
  public filteredSearchResults = computed<IGDBSearchResult[]>(() => {
    return this.searchResults();
  });

  /** Filtered franchise series scan results. */
  public filteredScanResults = computed<ScanSuggestion[]>(() => {
    return this.scanResults();
  });

  /** Filtered Amiibo view. */
  public filteredAmiiboResults = computed<AmiiboDiscoveryItem[]>(() => {
    const sFilter = this.amiiboSeriesFilter();
    const tFilter = this.amiiboTypeFilter();
    const query = this.amiiboSearchQuery().toLowerCase().trim();

    return this.amiiboResults().filter((item) => {
      if (sFilter !== 'all' && item.series_name !== sFilter) return false;
      if (tFilter !== 'all' && item.type !== tFilter) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  /**
   * Initializes component and triggers load.
   */
  ngOnInit() {
    this.loadPlatformsGracefully();
  }

  ngOnDestroy(): void {
    this.scanCancelRequested = true;
    this.searchRequestSeq++;
    this.modalMatchesRequestSeq++;
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }

  /**
   * Defensive getter for database platforms to support testing mocks.
   */
  get platformsList() {
    return this.collectionService.platforms
      ? this.collectionService.platforms()
      : [];
  }

  /**
   * Loads platforms list during initialization if not populated.
   */
  async loadPlatformsGracefully() {
    if (
      this.collectionService.platforms &&
      this.collectionService.platforms().length === 0
    ) {
      if (this.collectionService.refreshAll) {
        try {
          await this.collectionService.refreshAll();
        } catch (e) {
          console.error('[DiscoveryList] Platform preload failed:', e);
        }
      }
    }
  }

  onFilterDigitalChange(event: Event) {
    const isChecked = (event.target as HTMLInputElement).checked;
    this.filterDigital.set(isChecked);
  }

  toggleReleaseSelection(rel: DiscoveryRelease) {
    const key = rel.romCrc || rel.romName || rel.name;
    const current = new Set(this.selectedReleaseIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedReleaseIds.set(current);
  }

  /**
   * Invokes manual search on IGDB.
   *
   * @param query The search term.
   * @param platformIdStr The platform ID select option value.
   */
  async triggerSearch(query: string, platformIdStr: string) {
    if (!query) {
      alert('Please enter a search query.');
      return;
    }
    const platformId = Number(platformIdStr || 0);

    if (!this.collectionService.searchGames) {
      console.warn('[DiscoveryList] searchGames API is not available.');
      return;
    }

    const reqSeq = ++this.searchRequestSeq;
    this.searchLoading.set(true);
    this.searchError.set(null);
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lastQuery.set(query);

    try {
      const results = await firstValueFrom(
        this.collectionService.searchGames(
          query,
          platformId,
          this.filterDigital(),
        ),
      );
      if (reqSeq !== this.searchRequestSeq) {
        return;
      }
      this.searchResults.set(results || []);
      this.searchPerformed.set(true);

      // Initialize default platform selections for multi-platform results
      const initialMap = new Map<string, Set<number>>();
      for (const g of results || []) {
        const gKey = String(g.id);
        const set = new Set<number>();
        if (g.physical_platforms && g.physical_platforms.length > 0) {
          for (const p of g.physical_platforms) {
            if (!p.is_owned) set.add(p.platform_id);
          }
        } else if (g.platform_id && !g.ownership_status) {
          set.add(g.platform_id);
        }
        initialMap.set(gKey, set);
      }
      this.selectedPlatformsByGame.set(initialMap);

      if (!results || results.length === 0) {
        if (this.collectionService.showConfirmation) {
          this.collectionService.showConfirmation(
            'No Results Found',
            `No games matching "${query}" were found on IGDB.`,
            () => {},
          );
        }
      }
    } catch (err: unknown) {
      if (reqSeq !== this.searchRequestSeq) {
        return;
      }
      this.searchError.set(
        this.extractErrorMessage(err, 'Error occurred during IGDB search.'),
      );
    } finally {
      if (reqSeq === this.searchRequestSeq) {
        this.searchLoading.set(false);
      }
    }
  }

  /**
   * Extracts a human-readable error message from HTTP error responses or Error objects.
   */
  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === 'object') {
      const errObj = err as {
        error?: { error?: unknown } | unknown;
        message?: unknown;
      };
      if (
        errObj.error &&
        typeof errObj.error === 'object' &&
        'error' in errObj.error &&
        typeof (errObj.error as { error?: unknown }).error === 'string'
      ) {
        return (errObj.error as { error: string }).error;
      }
      if (typeof errObj.message === 'string' && errObj.message) {
        return errObj.message;
      }
    }
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return fallback;
  }

  public isUpcomingDate(dateStr?: string | null): boolean {
    if (!dateStr) return false;
    return new Date(dateStr) > new Date();
  }

  /**
   * Resets the search state to initial view.
   */
  clearSearchState() {
    this.searchRequestSeq++;
    this.searchLoading.set(false);
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lastQuery.set('');
    this.searchError.set(null);
    this.selectedPlatformsByGame.set(new Map());
  }

  /**
   * Selects only platforms that have verified physical releases or matched releases.
   */
  selectVerifiedPlatforms(game: IGDBSearchResult): void {
    if (!game.physical_platforms) return;
    const gKey = String(game.id);
    const map = new Map(this.selectedPlatformsByGame());
    const verifiedPids = game.physical_platforms
      .filter(
        (p) =>
          !p.is_owned &&
          (p.physical_status === 'verified_physical' ||
            p.matched_releases_count > 0 ||
            p.is_physical),
      )
      .map((p) => p.platform_id);
    map.set(gKey, new Set(verifiedPids));
    this.selectedPlatformsByGame.set(map);
  }

  /**
   * Selects all unowned platforms for a search card.
   */
  selectAllPlatforms(game: IGDBSearchResult): void {
    if (!game.physical_platforms) return;
    const gKey = String(game.id);
    const map = new Map(this.selectedPlatformsByGame());
    const allPids = game.physical_platforms
      .filter((p) => !p.is_owned)
      .map((p) => p.platform_id);
    map.set(gKey, new Set(allPids));
    this.selectedPlatformsByGame.set(map);
  }

  /**
   * Clears platform selection for a search card.
   */
  deselectAllPlatforms(game: IGDBSearchResult): void {
    const gKey = String(game.id);
    const map = new Map(this.selectedPlatformsByGame());
    map.set(gKey, new Set());
    this.selectedPlatformsByGame.set(map);
  }

  /**
   * Selects only verified physical releases in the ingestion modal checklist.
   */
  selectVerifiedReleasesOnly(): void {
    const rels = this.matchedReleases();
    const verifiedKeys = new Set<string>();
    rels.forEach((r) => {
      if (r.is_physical) {
        verifiedKeys.add(r.romCrc || r.romName || r.name);
      }
    });
    this.selectedReleaseIds.set(verifiedKeys);
  }

  /**
   * Selects all releases in the modal checklist.
   */
  selectAllReleases(): void {
    const rels = this.matchedReleases();
    const allKeys = new Set<string>();
    rels.forEach((r) => allKeys.add(r.romCrc || r.romName || r.name));
    this.selectedReleaseIds.set(allKeys);
  }

  /**
   * Clears release selection in the modal checklist.
   */
  clearReleaseSelection(): void {
    this.selectedReleaseIds.set(new Set());
  }

  /**
   * Determines if a search result can be ingested as a physical watch item.
   * A game can only be watched for physical release if it has NO verified physical releases
   * across any platform.
   */
  canWatchPhysical(game: IGDBSearchResult): boolean {
    if (game.platform_id === 0) return false;

    // If game-level status is verified physical, cannot watch physical
    if (game.physical_status === 'verified_physical') return false;

    // If any platform has verified physical status, is_physical flag, or matched physical releases, cannot watch physical
    if (
      game.physical_platforms?.some(
        (p) =>
          p.physical_status === 'verified_physical' ||
          p.is_physical ||
          p.matched_releases_count > 0,
      )
    ) {
      return false;
    }

    // Only allow watching if overall game or its platforms are digital only, pending, or unverified
    return (
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending' ||
      game.physical_status === 'digital_only' ||
      game.physical_status === 'unverified' ||
      Boolean(
        game.physical_platforms?.length &&
        game.physical_platforms.every(
          (p) =>
            p.physical_status === 'not_yet_physical' ||
            p.physical_status === 'physical_pending' ||
            p.physical_status === 'digital_only' ||
            p.physical_status === 'unverified',
        ),
      )
    );
  }

  /**
   * Ingests a search candidate into Platform 0 (No Platform) as Physical Pending / Watch.
   */
  async ingestPhysicalWatchForGame(game: IGDBSearchResult): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const cleanIgdbId =
      typeof game.id === 'string'
        ? parseInt(game.id.replace('igdb-', ''), 10)
        : Number(game.id);

    const payload = {
      game: {
        title: game.name,
        platform_id: 0,
        igdb_id: isNaN(cleanIgdbId) ? null : cleanIgdbId,
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region: 'USA',
        image_url: game.image_url || null,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: 2, // Seeking
        play_status: 0,
        backup_status: 0,
        physical_status: 'not_yet_physical' as const,
        verification_tier: 0,
        release_date: game.first_release_date || null,
      },
      releases: [],
    };

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.searchResults.update((current) =>
        current.filter((g) => g.id !== game.id),
      );
      this.showToast(`Watching "${game.name}" for Physical Release!`);
    } catch (err: unknown) {
      console.error(`Failed to watch physical for ${game.name}:`, err);
      this.showToast(`Failed to add "${game.name}" to watch list.`);
    }
  }

  /**
   * Toggles selection of a platform for a specific search result card.
   */
  togglePlatformSelection(gameId: string | number, platformId: number): void {
    const gKey = String(gameId);
    const map = new Map(this.selectedPlatformsByGame());
    let currentSet = map.get(gKey);
    if (!currentSet) {
      const game = this.searchResults().find((g) => String(g.id) === gKey);
      currentSet = new Set<number>();
      if (game?.physical_platforms) {
        for (const p of game.physical_platforms) {
          if (!p.is_owned) currentSet.add(p.platform_id);
        }
      } else if (game?.platform_id) {
        currentSet.add(game.platform_id);
      }
    } else {
      currentSet = new Set(currentSet);
    }

    if (currentSet.has(platformId)) {
      currentSet.delete(platformId);
    } else {
      currentSet.add(platformId);
    }

    map.set(gKey, currentSet);
    this.selectedPlatformsByGame.set(map);
  }

  /**
   * Checks whether a platform is currently selected for a search result card.
   */
  isPlatformSelected(gameId: string | number, platformId: number): boolean {
    const gKey = String(gameId);
    const set = this.selectedPlatformsByGame().get(gKey);
    if (set) {
      return set.has(platformId);
    }
    const game = this.searchResults().find((g) => String(g.id) === gKey);
    const plat = game?.physical_platforms?.find(
      (p) => p.platform_id === platformId,
    );
    return plat ? !plat.is_owned : true;
  }

  /**
   * Returns the list of selected platform IDs for a search result card.
   */
  getSelectedPlatformIds(game: IGDBSearchResult): number[] {
    const gKey = String(game.id);
    const set = this.selectedPlatformsByGame().get(gKey);
    if (set) {
      return Array.from(set);
    }
    if (game.physical_platforms && game.physical_platforms.length > 0) {
      return game.physical_platforms
        .filter((p) => !p.is_owned)
        .map((p) => p.platform_id);
    }
    return game.platform_id ? [game.platform_id] : [];
  }

  /**
   * Returns the count of selected platforms for a search result card.
   */
  getSelectedPlatformsCount(game: IGDBSearchResult): number {
    return this.getSelectedPlatformIds(game).length;
  }

  /**
   * Ingests all selected platforms for a search candidate in one click.
   */
  async ingestSelectedForGame(game: IGDBSearchResult): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.addGame) {
      console.warn('[DiscoveryList] addGame API is not available.');
      return;
    }

    const selectedPids = this.getSelectedPlatformIds(game);
    if (selectedPids.length === 0) {
      this.showToast('Please select at least one platform to ingest.');
      return;
    }

    const cleanIgdbId = Number(game.id.toString().replace('igdb-', ''));
    let successCount = 0;

    for (const pid of selectedPids) {
      const platOption = game.physical_platforms?.find(
        (p) => p.platform_id === pid,
      );
      const releases =
        platOption?.matched_releases ||
        (game.platform_id === pid ? game.matched_releases : []) ||
        [];

      const payload = {
        game: {
          title: game.name,
          platform_id: pid,
          igdb_id: cleanIgdbId,
          igdb_url: game.igdb_url || null,
          summary: game.summary || null,
          genres: game.genres || null,
          region: releases[0]?.region || game.region || 'USA',
          image_url: game.image_url || null,
          collections: game.collections || null,
          franchises: game.franchises || null,
          ownership_status: 0, // Default Unowned when ingesting from search
          play_status: 0,
          backup_status: 0,
          physical_status:
            platOption?.physical_status || game.physical_status || 'unverified',
          verification_tier: game.verification_tier || 0,
          release_date: game.first_release_date || null,
        },
        releases: releases.map((r) => ({
          region: r.region || null,
          variants: r.variants || null,
          rom_name: r.romName || r.name || null,
          rom_crc: r.romCrc || null,
          ownership_status: 0,
          backup_status: 0,
          release_date: r.releaseDate || null,
          canonical_release_id: r.canonical_release_id || null,
          serial_code: r.serial_code || null,
          barcode: r.barcode || null,
          is_physical: r.is_physical ?? 1,
        })),
      };

      try {
        await firstValueFrom(this.collectionService.addGame(payload));
        successCount++;
      } catch (err: unknown) {
        console.error(`Failed to ingest ${game.name} on platform ${pid}:`, err);
      }
    }

    if (successCount > 0) {
      if (game.physical_platforms) {
        const remainingUnowned = game.physical_platforms.filter(
          (p) => !selectedPids.includes(p.platform_id) && !p.is_owned,
        );
        if (remainingUnowned.length === 0) {
          this.searchResults.update((current) =>
            current.filter((g) => g.id !== game.id),
          );
        } else {
          this.searchResults.update((current) =>
            current.map((g) => {
              if (g.id !== game.id) return g;
              return {
                ...g,
                physical_platforms: g.physical_platforms?.map((p) =>
                  selectedPids.includes(p.platform_id)
                    ? { ...p, is_owned: true }
                    : p,
                ),
              };
            }),
          );
          const map = new Map(this.selectedPlatformsByGame());
          map.delete(String(game.id));
          this.selectedPlatformsByGame.set(map);
        }
      } else {
        this.searchResults.update((current) =>
          current.filter((g) => g.id !== game.id),
        );
      }

      this.showToast(
        `Successfully ingested "${game.name}" (${successCount} edition${successCount > 1 ? 's' : ''}) as unowned!`,
      );
    }
  }

  /**
   * 1-Click ingestion for Platform 0 ('No Platform') wishlist titles.
   */
  async ingestWishlistForGame(game: IGDBSearchResult): Promise<void> {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const cleanIgdbId =
      typeof game.id === 'string'
        ? parseInt(game.id.replace('igdb-', ''), 10)
        : Number(game.id);

    const payload = {
      game: {
        title: game.name,
        platform_id: 0,
        igdb_id: isNaN(cleanIgdbId) ? null : cleanIgdbId,
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region: 'USA',
        image_url: game.image_url || null,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: 2, // Seeking
        play_status: 0,
        backup_status: 0,
        physical_status: 'not_yet_physical' as const,
        verification_tier: 0,
        release_date: game.first_release_date || null,
      },
      releases: [],
    };

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.searchResults.update((current) =>
        current.filter((g) => g.id !== game.id),
      );
      this.showToast(`Added "${game.name}" to Physical Wishlist!`);
    } catch (err: unknown) {
      console.error(`Failed to wishlist ${game.name}:`, err);
      this.showToast(`Failed to add "${game.name}" to wishlist.`);
    }
  }

  /**
   * Fetches releases and opens the ingestion setup modal wizard.
   *
   * @param game The search candidate game object.
   * @param platformIdStr The selected platform ID.
   */
  async openIngestionModal(game: IGDBSearchResult, platformIdStr: string) {
    let platformId = Number(platformIdStr || 0) || game.platform_id || 0;
    if (!platformId && game.platform) {
      const match = this.platformsList.find(
        (p) =>
          (p.display_name &&
            p.display_name.toLowerCase() === game.platform.toLowerCase()) ||
          (p.name && p.name.toLowerCase() === game.platform.toLowerCase()),
      );
      if (match) {
        platformId = match.id;
      }
    }
    const cleanIgdbId = game.id.toString().replace('igdb-', '');
    const reqSeq = ++this.modalMatchesRequestSeq;

    this.showModal.set(true);
    this.modalLoading.set(false);
    this.modalGame.set(game);
    this.modalPlatformId.set(platformId);
    this.modalInitialPlatformId.set(platformId);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());

    // Pre-populate releases from physical_platforms if already matched
    const platOption = game.physical_platforms?.find(
      (p) => p.platform_id === platformId,
    );
    if (
      platOption?.matched_releases &&
      platOption.matched_releases.length > 0
    ) {
      this.matchedReleases.set(platOption.matched_releases);
      const autoSelected = new Set<string>();
      platOption.matched_releases.forEach((r) =>
        autoSelected.add(r.romCrc || r.romName || r.name),
      );
      this.selectedReleaseIds.set(autoSelected);
    }

    // Reset forms to defaults (Seeking for upcoming/pending, else Unowned)
    const isUpcomingOrPending =
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending' ||
      Boolean(
        game.first_release_date &&
        new Date(game.first_release_date) > new Date(),
      );
    this.ownershipStatus.set(isUpcomingOrPending ? 2 : 0);
    this.playStatus.set(0);
    this.backupStatus.set(0);

    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }
    if (typeof window !== 'undefined') {
      this.savedScrollY = window.scrollY || window.pageYOffset || 0;
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }

    if (platformId && this.collectionService.getGameMatches) {
      this.modalLoading.set(true);
      try {
        const data = await firstValueFrom(
          this.collectionService.getGameMatches(cleanIgdbId, platformId),
        );
        if (reqSeq !== this.modalMatchesRequestSeq) {
          return;
        }
        if (data) {
          if (data.game) {
            this.modalGame.set(data.game);
          }
          const rels = data.matchedReleases || [];
          this.matchedReleases.set(rels);
          const autoSelected = new Set<string>();
          rels.forEach((r) =>
            autoSelected.add(r.romCrc || r.romName || r.name),
          );
          this.selectedReleaseIds.set(autoSelected);
        }
      } catch (err: unknown) {
        if (reqSeq !== this.modalMatchesRequestSeq) {
          return;
        }
        console.warn('[DiscoveryList] Matches lookup fallback:', err);
      } finally {
        if (reqSeq === this.modalMatchesRequestSeq) {
          this.modalLoading.set(false);
        }
      }
    }
  }

  /**
   * Handles platform selection changes from within the manual ingestion modal.
   */
  async onModalPlatformChange(event: Event) {
    const platformId = Number((event.target as HTMLSelectElement).value || 0);
    this.modalPlatformId.set(platformId);
    const reqSeq = ++this.modalMatchesRequestSeq;

    if (!platformId) {
      this.modalLoading.set(false);
      this.matchedReleases.set([]);
      this.selectedReleaseIds.set(new Set());
      return;
    }

    const game = this.modalGame();
    if (!game) return;

    const cleanIgdbId = game.id.toString().replace('igdb-', '');

    if (!this.collectionService.getGameMatches) return;

    this.modalLoading.set(true);
    try {
      const data = await firstValueFrom(
        this.collectionService.getGameMatches(cleanIgdbId, platformId),
      );
      if (reqSeq !== this.modalMatchesRequestSeq) {
        return;
      }
      if (data) {
        if (data.game) {
          this.modalGame.set(data.game);
        }
        const rels = data.matchedReleases || [];
        this.matchedReleases.set(rels);
        const autoSelected = new Set<string>();
        rels.forEach((r) => autoSelected.add(r.romCrc || r.romName || r.name));
        this.selectedReleaseIds.set(autoSelected);
      }
    } catch (err: unknown) {
      if (reqSeq !== this.modalMatchesRequestSeq) {
        return;
      }
      console.warn('[DiscoveryList] Modal matches lookup error:', err);
    } finally {
      if (reqSeq === this.modalMatchesRequestSeq) {
        this.modalLoading.set(false);
      }
    }
  }

  /**
   * Displays a toast notification message at the bottom of the screen.
   */
  public showToast(message: string) {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastMessage.set(message);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 4000);
  }

  /**
   * Closes ingestion modal and cleans up active states.
   */
  closeIngestionModal() {
    this.modalMatchesRequestSeq++;
    this.modalLoading.set(false);
    this.showModal.set(false);
    this.modalGame.set(null);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
    if (typeof window !== 'undefined' && this.savedScrollY > 0) {
      const targetY = this.savedScrollY;
      this.savedScrollY = 0;
      window.scrollTo({ top: targetY, behavior: 'instant' as ScrollBehavior });
    }
  }

  onOwnershipChange(event: Event) {
    this.ownershipStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  onPlayChange(event: Event) {
    this.playStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  onBackupChange(event: Event) {
    this.backupStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Finalizes ingestion from manual search by calling addGame.
   */
  async submitIngestion() {
    const game = this.modalGame();
    if (!game) return;

    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    if (!this.collectionService.addGame) {
      console.warn('[DiscoveryList] addGame API is not available.');
      return;
    }

    const platformId = this.modalPlatformId();
    const allReleases = this.matchedReleases();
    const selectedKeys = this.selectedReleaseIds();
    const selectedReleases = allReleases.filter((r) =>
      selectedKeys.has(r.romCrc || r.romName || r.name),
    );

    const payload = {
      game: {
        title: game.name,
        platform_id: platformId,
        igdb_id: Number(game.id.toString().replace('igdb-', '')),
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region: selectedReleases[0]?.region || game.region || 'USA',
        image_url: game.image_url || null,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: this.ownershipStatus(),
        play_status: this.playStatus(),
        backup_status: this.backupStatus(),
        physical_status: game.physical_status || 'unverified',
        verification_tier: game.verification_tier || 0,
        release_date: game.first_release_date || null,
      },
      releases: selectedReleases.map((r) => ({
        region: r.region || null,
        variants: r.variants || null,
        rom_name: r.romName || r.name || null,
        rom_crc: r.romCrc || null,
        ownership_status: this.ownershipStatus(),
        backup_status: this.backupStatus(),
        release_date: r.releaseDate || null,
        canonical_release_id: r.canonical_release_id || null,
        serial_code: r.serial_code || null,
        barcode: r.barcode || null,
        is_physical: r.is_physical ?? 1,
      })),
    };

    this.modalLoading.set(true);

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.closeIngestionModal();

      // Remove from search results for immediate visual feedback
      this.searchResults.update((current) =>
        current.filter((g) => g.id.toString() !== game.id.toString()),
      );

      this.showToast(`Successfully ingested "${game.name}"!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Ingestion failed: ' + msg);
    } finally {
      this.modalLoading.set(false);
    }
  }

  onSeriesSelectChange(event: Event) {
    const val = (event.target as HTMLSelectElement).value || '';
    this.selectedSeries.set(val);
  }

  /**
   * Triggers either a targeted single-franchise scan or a progressive full-library scan.
   */
  async triggerSeriesScan() {
    if (this.selectedSeries()) {
      await this.triggerSingleSeriesScan(this.selectedSeries());
    } else {
      await this.startProgressiveScan();
    }
  }

  /**
   * Scans a specific single franchise instantly against IGDB.
   */
  async triggerSingleSeriesScan(seriesName: string) {
    if (!this.collectionService.scanSeries) {
      console.warn('[DiscoveryList] scanSeries API is not available.');
      return;
    }

    this.scanLoading.set(true);
    this.scanError.set(null);
    this.scanResults.set([]);
    this.selectedScanGameIds.set(new Set());
    this.scanProgress.set(null);
    this.scanCancelled.set(false);
    this.scanPerformed.set(false);

    try {
      const results = await firstValueFrom(
        this.collectionService.scanSeries({
          series: seriesName,
          filterDigital: this.filterDigital(),
        }),
      );
      this.scanResults.set(this.filterOwnedSuggestions(results || []));
      this.scanPerformed.set(true);
    } catch (err: unknown) {
      this.scanError.set(
        this.extractErrorMessage(
          err,
          `Franchise scan for "${seriesName}" failed.`,
        ),
      );
    } finally {
      this.scanLoading.set(false);
    }
  }

  /**
   * Filters candidate franchise suggestions against games already owned in local collection state.
   */
  private filterOwnedSuggestions(
    suggestions: ScanSuggestion[],
  ): ScanSuggestion[] {
    const games =
      this.collectionService && this.collectionService.games
        ? this.collectionService.games()
        : [];
    if (!games || games.length === 0) return suggestions;

    const ownedIgdbKeys = new Set<string>();
    const ownedTitleKeys = new Set<string>();

    for (const g of games) {
      if (g.igdb_id && g.platform_id) {
        ownedIgdbKeys.add(`${g.igdb_id}-${g.platform_id}`);
      }
      if (g.title && g.platform_id) {
        ownedTitleKeys.add(
          `${g.title.toLowerCase().replace(/[^a-z0-9]/g, '')}-${g.platform_id}`,
        );
      }
    }

    return suggestions.filter((s) => {
      const igdbKey = `${s.id}-${s.platform_id}`;
      const titleKey = `${(s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}-${s.platform_id}`;
      return !ownedIgdbKeys.has(igdbKey) && !ownedTitleKeys.has(titleKey);
    });
  }

  /**
   * Scans all tracked franchises in the collection progressively in batches.
   * Renders streaming results live and updates progress percentage.
   */
  async startProgressiveScan() {
    // If scanSeriesPaged is not available (e.g. mock test context), fallback to scanSeries()
    if (
      !this.collectionService.scanSeriesPaged &&
      this.collectionService.scanSeries
    ) {
      this.scanLoading.set(true);
      this.scanError.set(null);
      this.scanResults.set([]);
      this.selectedScanGameIds.set(new Set());
      this.scanPerformed.set(false);
      try {
        const results = await firstValueFrom(
          this.collectionService.scanSeries({
            filterDigital: this.filterDigital(),
          }),
        );
        this.scanResults.set(this.filterOwnedSuggestions(results || []));
        this.scanPerformed.set(true);
      } catch (err: unknown) {
        this.scanError.set(
          this.extractErrorMessage(err, 'Franchise series scan failed.'),
        );
      } finally {
        this.scanLoading.set(false);
      }
      return;
    }

    if (!this.collectionService.scanSeriesPaged) return;

    this.scanLoading.set(true);
    this.scanError.set(null);
    this.scanResults.set([]);
    this.selectedScanGameIds.set(new Set());
    this.scanCancelled.set(false);
    this.scanPerformed.set(false);
    this.scanCancelRequested = false;

    const batchSize = 30;
    let offset = 0;

    try {
      while (!this.scanCancelRequested) {
        const paged = await firstValueFrom(
          this.collectionService.scanSeriesPaged({
            offset,
            limit: batchSize,
            filterDigital: this.filterDigital(),
          }),
        );

        const totalSeries = paged.totalSeries;
        const newSuggestions = this.filterOwnedSuggestions(
          paged.suggestions || [],
        );

        if (newSuggestions.length > 0) {
          this.scanResults.update((current) => {
            const seen = new Set(
              current.map((g) => `${g.id}-${g.platform_id}`),
            );
            const toAdd = newSuggestions.filter(
              (g) => !seen.has(`${g.id}-${g.platform_id}`),
            );
            return [...current, ...toAdd];
          });
        }

        const scanned = Math.min(offset + batchSize, totalSeries);
        const percent =
          totalSeries > 0 ? Math.round((scanned / totalSeries) * 100) : 100;
        this.scanProgress.set({ scanned, total: totalSeries, percent });

        if (!paged.hasMore || this.scanCancelRequested) {
          break;
        }

        // Pacing throttle to ensure compliance with IGDB rate limits (<= 4 req/sec)
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (this.scanCancelRequested) {
          break;
        }

        offset += batchSize;
      }

      if (this.scanCancelRequested) {
        this.scanCancelled.set(true);
      }
      this.scanPerformed.set(true);
    } catch (err: unknown) {
      this.scanError.set(
        this.extractErrorMessage(err, 'Franchise series scan failed.'),
      );
    } finally {
      this.scanLoading.set(false);
    }
  }

  /**
   * Pauses or stops an active progressive scan, keeping all results found so far.
   */
  stopScan() {
    this.scanCancelRequested = true;
    this.scanLoading.set(false);
    this.scanCancelled.set(true);
  }

  toggleScanSelection(game: ScanSuggestion) {
    const key = game.id + '-' + game.platform_id;
    const current = new Set(this.selectedScanGameIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedScanGameIds.set(current);
  }

  toggleSelectAllScan() {
    const current = this.selectedScanGameIds();
    const results = this.filteredScanResults();
    if (current.size === results.length) {
      this.selectedScanGameIds.set(new Set());
    } else {
      const set = new Set<string>();
      results.forEach((g) => set.add(g.id + '-' + g.platform_id));
      this.selectedScanGameIds.set(set);
    }
  }

  selectVerifiedScanOnly() {
    const results = this.filteredScanResults();
    const verifiedSet = new Set<string>();
    results.forEach((g) => {
      if (
        g.physical_status === 'verified_physical' ||
        g.verification_tier === 1
      ) {
        verifiedSet.add(g.id + '-' + g.platform_id);
      }
    });
    this.selectedScanGameIds.set(verifiedSet);
  }

  async addGameFromSeries(game: ScanSuggestion) {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.addGame) return;

    const payload = {
      game: {
        title: game.title,
        platform_id: game.platform_id,
        igdb_id: Number(game.id.toString().replace('igdb-', '')),
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region:
          (game.releases && game.releases[0]?.region) || game.region || 'USA',
        image_url: game.image_url,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: 0, // Unowned
        play_status: 0, // Unplayed
        backup_status: 0, // Not Backed Up
        physical_status: game.physical_status || 'unverified',
        verification_tier: game.verification_tier || 0,
        release_date: game.first_release_date || null,
      },
      releases: game.releases
        ? game.releases.map((r: DiscoveryRelease) => ({
            region: r.region || null,
            variants: r.variants || null,
            rom_name: r.romName || r.name || null,
            rom_crc: r.romCrc || null,
            ownership_status: 0,
            backup_status: 0,
            release_date: r.releaseDate || null,
            canonical_release_id: r.canonical_release_id || null,
            serial_code: r.serial_code || null,
            barcode: r.barcode || null,
            is_physical: r.is_physical ?? 1,
          }))
        : [],
    };

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.scanResults.update((current) =>
        current.filter(
          (g) => !(g.id === game.id && g.platform_id === game.platform_id),
        ),
      );

      const key = game.id + '-' + game.platform_id;
      this.selectedScanGameIds.update((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });

      this.showToast(`Successfully ingested "${game.title}"!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to add game "${game.title}": ` + msg);
    }
  }

  async bulkAddSeriesGames() {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }

    const selected = this.filteredScanResults().filter((g) =>
      this.selectedScanGameIds().has(g.id + '-' + g.platform_id),
    );
    if (selected.length === 0) return;

    if (!this.collectionService.addGame) return;

    this.scanLoading.set(true);
    let count = 0;
    const failedTitles: string[] = [];

    for (const game of selected) {
      const payload = {
        game: {
          title: game.title,
          platform_id: game.platform_id,
          igdb_id: Number(game.id.toString().replace('igdb-', '')),
          igdb_url: game.igdb_url || null,
          summary: game.summary,
          genres: game.genres,
          region:
            (game.releases && game.releases[0]?.region) || game.region || 'USA',
          image_url: game.image_url,
          collections: game.collections,
          franchises: game.franchises,
          ownership_status: 0,
          play_status: 0,
          backup_status: 0,
          physical_status: game.physical_status || 'unverified',
          verification_tier: game.verification_tier || 0,
          release_date: game.first_release_date || null,
        },
        releases: game.releases
          ? game.releases.map((r: DiscoveryRelease) => ({
              region: r.region || null,
              variants: r.variants || null,
              rom_name: r.romName || r.name || null,
              rom_crc: r.romCrc || null,
              ownership_status: 0,
              backup_status: 0,
              release_date: r.releaseDate || null,
              canonical_release_id: r.canonical_release_id || null,
              serial_code: r.serial_code || null,
              barcode: r.barcode || null,
              is_physical: r.is_physical ?? 1,
            }))
          : [],
      };

      try {
        await firstValueFrom(this.collectionService.addGame(payload));
        count++;

        this.scanResults.update((current) =>
          current.filter(
            (g) => !(g.id === game.id && g.platform_id === game.platform_id),
          ),
        );

        const key = game.id + '-' + game.platform_id;
        this.selectedScanGameIds.update((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      } catch (err: unknown) {
        console.error(`Failed to bulk add "${game.title}":`, err);
        failedTitles.push(game.title);
      }
    }

    this.scanLoading.set(false);
    if (failedTitles.length > 0) {
      this.showToast(
        `Added ${count} games. Failed (${failedTitles.length}): ${failedTitles.join(', ')}`,
      );
    } else {
      this.showToast(
        `Successfully bulk ingested ${count} franchise series games.`,
      );
    }
  }

  clearScanSelection() {
    this.selectedScanGameIds.set(new Set());
  }

  /**
   * Amiibo Discovery Functions.
   */
  async triggerAmiiboScan() {
    if (!this.collectionService.scanAmiibo) return;

    this.amiiboLoading.set(true);
    this.amiiboError.set(null);
    this.amiiboResults.set([]);
    this.selectedAmiiboIds.set(new Set());
    this.amiiboPerformed.set(false);

    try {
      const results = await firstValueFrom(this.collectionService.scanAmiibo());
      this.amiiboResults.set(results || []);
      this.amiiboPerformed.set(true);
    } catch (err: unknown) {
      this.amiiboError.set(
        this.extractErrorMessage(err, 'Amiibo scan failed.'),
      );
    } finally {
      this.amiiboLoading.set(false);
    }
  }

  onAmiiboSearchInput(event: Event) {
    this.amiiboSearchQuery.set((event.target as HTMLInputElement).value || '');
  }

  onAmiiboSeriesChange(event: Event) {
    this.amiiboSeriesFilter.set(
      (event.target as HTMLSelectElement).value || 'all',
    );
  }

  onAmiiboTypeChange(event: Event) {
    this.amiiboTypeFilter.set(
      (event.target as HTMLSelectElement).value || 'all',
    );
  }

  toggleAmiiboSelection(item: AmiiboDiscoveryItem) {
    const key = item.amiibo_id || item.id;
    const current = new Set(this.selectedAmiiboIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedAmiiboIds.set(current);
  }

  toggleSelectAllAmiibo() {
    const visible = this.filteredAmiiboResults();
    const current = this.selectedAmiiboIds();
    if (current.size === visible.length) {
      this.selectedAmiiboIds.set(new Set());
    } else {
      const set = new Set<string>();
      visible.forEach((a) => set.add(a.amiibo_id || a.id));
      this.selectedAmiiboIds.set(set);
    }
  }

  clearAmiiboSelection() {
    this.selectedAmiiboIds.set(new Set());
  }

  async addSingleAmiibo(item: AmiiboDiscoveryItem) {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.addToy) return;
    try {
      const slugify = (s: string) =>
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const toyPayload: Partial<Toy> = {
        id: `amiibo-${slugify(item.name)}-${slugify(item.series_name || 'amiibo')}`,
        name: item.name,
        line: 'amiibo',
        series: item.series_name,
        series_name: item.series_name,
        type: item.type || 'Figure',
        image_url: item.image_url,
        release_date: item.release_date || undefined,
        region: item.region || 'USA',
        amiibo_id: item.amiibo_id,
        ownership_status: 0, // Unowned
        verified: 1,
        metadata_json: JSON.stringify(item),
      };

      await firstValueFrom(this.collectionService.addToy(toyPayload));
      this.amiiboResults.update((list) =>
        list.filter(
          (a) => (a.amiibo_id || a.id) !== (item.amiibo_id || item.id),
        ),
      );
      this.selectedAmiiboIds.update((s) => {
        const next = new Set(s);
        next.delete(item.amiibo_id || item.id);
        return next;
      });

      this.showToast(`Successfully added amiibo "${item.name}" as unowned!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to add amiibo "${item.name}": ` + msg);
    }
  }

  async bulkAddAmiibo() {
    if (!this.collectionService.isAdmin()) {
      this.collectionService.promptAdminLogin();
      return;
    }
    if (!this.collectionService.addToy) return;
    const selectedIds = this.selectedAmiiboIds();
    const itemsToAdd = this.amiiboResults().filter((a) =>
      selectedIds.has(a.amiibo_id || a.id),
    );
    if (itemsToAdd.length === 0) return;

    this.amiiboLoading.set(true);
    let count = 0;
    const slugify = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    for (const item of itemsToAdd) {
      try {
        const toyPayload: Partial<Toy> = {
          id: `amiibo-${slugify(item.name)}-${slugify(item.series_name || 'amiibo')}`,
          name: item.name,
          line: 'amiibo',
          series: item.series_name,
          series_name: item.series_name,
          type: item.type || 'Figure',
          image_url: item.image_url,
          release_date: item.release_date || undefined,
          region: item.region || 'USA',
          amiibo_id: item.amiibo_id,
          ownership_status: 0,
          verified: 1,
          metadata_json: JSON.stringify(item),
        };
        await firstValueFrom(this.collectionService.addToy(toyPayload));
        count++;

        this.amiiboResults.update((list) =>
          list.filter(
            (a) => (a.amiibo_id || a.id) !== (item.amiibo_id || item.id),
          ),
        );
        this.selectedAmiiboIds.update((s) => {
          const next = new Set(s);
          next.delete(item.amiibo_id || item.id);
          return next;
        });
      } catch (e) {
        console.error(`Failed to ingest amiibo ${item.name}:`, e);
      }
    }

    this.amiiboLoading.set(false);
    this.showToast(`Successfully ingested ${count} amiibo items as unowned.`);
  }
}
