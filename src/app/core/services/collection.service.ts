/**
 * COLLECTION SERVICE
 *
 * Central data orchestrator for the Collection Tracker.
 * Manages the state of games, toys, and platforms using Angular Signals.
 * Handles API interactions, local state persistence via sessionStorage,
 * and data discovery workflows.
 *
 * DESIGN RATIONALE:
 * - Uses private signals with public read-only views to enforce one-way data flow.
 * - Separates state persistence by 'tab' (games vs toys) to allow independent
 *   browsing contexts.
 * - Utilizes firstValueFrom for async/await compatibility while keeping the
 *   underlying API layer based on RxJS Observables.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  Observable,
  firstValueFrom,
  catchError,
  of,
  map,
  tap,
  throwError,
} from 'rxjs';
import {
  Game,
  Toy,
  Platform,
  ListState,
  ViewMode,
  PlayStatus,
  PhysicalStatus,
  OwnershipStatus,
  IGDBSearchResult,
  DiscoveryRelease,
  ScanSuggestion,
  AmiiboDiscoveryItem,
  PagedScanSeriesResult,
  JournalEntry,
  UserProfile,
  PublicUserProfile,
  AuthMeResponse,
} from '../models/collection.models';

@Injectable({
  providedIn: 'root',
})
export class CollectionService {
  private http = inject(HttpClient);
  private router = inject(Router);

  /**
   * Persistence state for UI navigation (Split by tab).
   * Stores filters, scroll positions, and display limits.
   */
  private _gamesState = signal<ListState | null>(null);
  private _toysState = signal<ListState | null>(null);

  public readonly gamesState = this._gamesState.asReadonly();
  public readonly toysState = this._toysState.asReadonly();

  private _currentUser = signal<UserProfile | null>(null);
  public readonly currentUser = this._currentUser.asReadonly();
  public readonly isAuthenticated = computed(
    () => this._currentUser() !== null,
  );
  public readonly isAdmin = computed(
    () => this._currentUser()?.role === 'admin',
  );
  public readonly homeRegion = computed(
    () => this._currentUser()?.homeRegion || 'USA',
  );

  private _isPublicView = signal<boolean>(false);
  public readonly isPublicView = this._isPublicView.asReadonly();

  private _publicProfile = signal<PublicUserProfile | null>(null);
  public readonly publicProfile = this._publicProfile.asReadonly();

  public readonly journalRevealed = computed(() => this.isAuthenticated());

  private _journalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  public readonly journalEntriesMap = this._journalEntriesMap.asReadonly();

  private _journalLoaded = signal<boolean>(false);
  public readonly journalLoaded = this._journalLoaded.asReadonly();

  private _authInitialized = signal<boolean>(false);
  public readonly authInitialized = this._authInitialized.asReadonly();
  private _authPromise: Promise<UserProfile | null> | null = null;

  /**
   * Initializes the service and restores any saved navigation state from sessionStorage.
   * This ensures that when a user returns from a detail page, their context is restored.
   */
  constructor() {
    if (typeof window !== 'undefined') {
      this.loadPersistedState();
      this.loadLastUpdated();
      this.checkAdminStatus();
    }
  }

  /**
   * Ensures auth status has been verified via /api/auth/me before resolving.
   * Caches the promise to prevent duplicate requests during initial app load.
   */
  public ensureAuthLoaded(): Promise<UserProfile | null> {
    if (this._authInitialized()) {
      return Promise.resolve(this._currentUser());
    }
    if (this._authPromise) {
      return this._authPromise;
    }
    this._authPromise = firstValueFrom(
      this.http.get<AuthMeResponse>('/api/auth/me').pipe(
        catchError(() => of({ authenticated: false, user: null })),
        map((res) => {
          if (res.authenticated && res.user) {
            this._currentUser.set(res.user);
            this.loadAllJournalEntries().subscribe();
          } else {
            this._currentUser.set(null);
          }
          this._authInitialized.set(true);
          return this._currentUser();
        }),
      ),
    );
    return this._authPromise;
  }

  /**
   * Checks whether the current user has an active session via /api/auth/me.
   */
  public checkAdminStatus(): void {
    this.ensureAuthLoaded().catch(() => {});
  }

  /**
   * Helper method for testing to set administrative status.
   */
  public setAdminForTesting(authorized: boolean): void {
    if (authorized) {
      this._currentUser.set({
        id: 1,
        email: 'admin@example.com',
        username: 'wesley',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Wesley',
        bio: null,
      });
    } else {
      this._currentUser.set(null);
    }
    this._authInitialized.set(true);
  }

  public setCurrentUserForTesting(user: UserProfile | null): void {
    this._currentUser.set(user);
    this._authInitialized.set(true);
  }

  public getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>('/api/user/profile');
  }

  public updateProfile(data: Partial<UserProfile>): Observable<UserProfile> {
    return this.http.put<UserProfile>('/api/user/profile', data).pipe(
      tap((profile) => {
        this._currentUser.set(profile);
      }),
    );
  }

  public getHomeRegions(): Observable<string[]> {
    return this.http.get<string[]>('/api/user/regions');
  }

  public getPublicUser(username: string): Observable<PublicUserProfile> {
    return this.http.get<PublicUserProfile>(
      `/api/u/${encodeURIComponent(username)}`,
    );
  }

  public getPublicGames(
    username: string,
    platformId?: number,
  ): Observable<Game[]> {
    const url = platformId
      ? `/api/u/${encodeURIComponent(username)}/games?platform=${platformId}`
      : `/api/u/${encodeURIComponent(username)}/games`;
    return this.http.get<Game[]>(url);
  }

  public getPublicToys(username: string): Observable<Toy[]> {
    return this.http.get<Toy[]>(`/api/u/${encodeURIComponent(username)}/toys`);
  }

  public setPublicView(
    enabled: boolean,
    profile?: PublicUserProfile | null,
  ): void {
    this._isPublicView.set(enabled);
    this._publicProfile.set(profile || null);
  }

  public exitPublicView(): void {
    this.setPublicView(false, null);
  }

  /**
   * Hydrates the lastUpdated signal from localStorage.
   */
  private loadLastUpdated() {
    const saved =
      localStorage.getItem('app_last_updated') ??
      localStorage.getItem('gagglog_last_updated');
    if (saved) {
      const date = new Date(saved);
      if (!isNaN(date.getTime())) {
        this._lastUpdated.set(date);
      }
    }
  }

  /**
   * Persists the current list state for a specific tab to sessionStorage.
   *
   * @param tab The collection tab to persist ('games' or 'toys').
   */
  public persistState(tab: 'games' | 'toys') {
    const state = tab === 'games' ? this._gamesState() : this._toysState();
    if (state) {
      sessionStorage.setItem(`app_list_state_${tab}`, JSON.stringify(state));
      if (state.viewMode) {
        localStorage.setItem('app_preferred_view_mode', state.viewMode);
      }
    }
  }

  /**
   * Updates the in-memory state and immediately persists it.
   *
   * @param state The new state object containing filters and navigation data.
   */
  public updateListState(state: ListState) {
    if (state.tab === 'games') {
      this._gamesState.set(state);
    } else {
      this._toysState.set(state);
    }
    this.persistState(state.tab);
  }

  /**
   * Retrieves the current list state for a specific tab.
   *
   * @param tab The collection tab to query.
   * @returns The current ListState or null if not set.
   */
  public getListState(tab: 'games' | 'toys') {
    return tab === 'games' ? this._gamesState() : this._toysState();
  }

  /**
   * Synchronously loads saved state from sessionStorage.
   * Called during construction to hydrate signals before first render.
   */
  public loadPersistedState() {
    const savedGlobalViewMode = localStorage.getItem(
      'app_preferred_view_mode',
    ) as ViewMode | null;

    ['games', 'toys'].forEach((tab) => {
      const saved =
        sessionStorage.getItem(`app_list_state_${tab}`) ??
        sessionStorage.getItem(`gagglog_list_state_${tab}`);
      if (saved) {
        try {
          const state = JSON.parse(saved);
          if (state?.filters?.seriesOrName && !state.filters.name) {
            state.filters.name = state.filters.seriesOrName;
            delete state.filters.seriesOrName;
          }
          if (!state.viewMode && savedGlobalViewMode) {
            state.viewMode = savedGlobalViewMode;
          }
          if (tab === 'games') this._gamesState.set(state);
          else this._toysState.set(state);
        } catch (e) {
          console.error(
            `[CollectionService] Failed to parse saved ${tab} state`,
            e,
          );
        }
      }
    });
  }

  /**
   * Resets the scroll coordinates for a given tab back to the top.
   * Invoked when navigating via top/bottom navigation tabs or brand link.
   */
  public resetTabScroll(tab: 'games' | 'toys') {
    const state = tab === 'games' ? this._gamesState() : this._toysState();
    if (state) {
      this.updateListState({
        ...state,
        scrollX: 0,
        scrollY: 0,
      });
    }
  }

  /**
   * Clears all persisted and in-memory list state.
   * Useful for "hard refresh" or logout scenarios.
   */
  public resetListState() {
    this._gamesState.set(null);
    this._toysState.set(null);
    sessionStorage.removeItem('app_list_state_games');
    sessionStorage.removeItem('app_list_state_toys');
    sessionStorage.removeItem('gagglog_list_state_games');
    sessionStorage.removeItem('gagglog_list_state_toys');
  }

  private _games = signal<Game[]>([]);
  private _toys = signal<Toy[]>([]);
  private _platforms = signal<Platform[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _refreshTrigger = signal<number>(0);

  /** --- Public Read-only Signal Views --- */
  public readonly games = this._games.asReadonly();
  public readonly toys = this._toys.asReadonly();
  public readonly platforms = this._platforms.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();

  /**
   * Timestamp of the last successful server synchronization.
   * Persisted to localStorage to provide context for stale data during offline use.
   */
  private _lastUpdated = signal<Date | null>(null);
  public readonly lastUpdated = this._lastUpdated.asReadonly();

  /**
   * Orchestrates a full refresh of the collection data.
   * Fetches games, toys, and platforms in parallel to minimize load time.
   *
   * WHY: Parallellizing these requests ensures the application shell stays
   * snappy even as the collection grows.
   */
  async refreshAll(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [games, toys, platforms] = await Promise.all([
        firstValueFrom(this.getGames()),
        firstValueFrom(this.getToys()),
        firstValueFrom(this.getPlatforms()),
      ]);
      this._games.set(games);
      this._toys.set(toys);
      this._platforms.set(platforms);
      this._refreshTrigger.update((v) => v + 1);

      // Update sync timestamp if we are reasonably sure we hit the network
      if (typeof window !== 'undefined' && window.navigator.onLine) {
        const now = new Date();
        this._lastUpdated.set(now);
        localStorage.setItem('app_last_updated', now.toISOString());
      }
    } catch (err: unknown) {
      console.error('[CollectionService] Global refresh failed:', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to load collection data. Please try again later.';
      this._error.set(errorMessage);
    } finally {
      this._loading.set(false);
    }
  }

  /** --- API Tier (Reactive Observables) --- */

  /**
   * Fetches the games collection, optionally filtered by platform.
   */
  getGames(platformId?: number): Observable<Game[]> {
    let url = '/api/games';
    if (this._isPublicView() && this._publicProfile()) {
      url = `/api/u/${encodeURIComponent(this._publicProfile()!.username)}/games`;
    }
    if (platformId) {
      url += (url.includes('?') ? '&' : '?') + `platform_id=${platformId}`;
    }
    return this.http.get<Game[]>(url).pipe(
      map((games) => games.map((game) => this.enrichGameTitle(game))),
      catchError((err) => {
        console.error('[CollectionService] Error fetching games:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches the entire toys collection.
   */
  getToys(): Observable<Toy[]> {
    let url = '/api/toys';
    if (this._isPublicView() && this._publicProfile()) {
      url = `/api/u/${encodeURIComponent(this._publicProfile()!.username)}/toys`;
    }
    return this.http.get<Toy[]>(url).pipe(
      catchError((err) => {
        console.error('[CollectionService] Error fetching toys:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches the platform metadata list.
   */
  getPlatforms(): Observable<Platform[]> {
    return this.http.get<Platform[]>('/api/platforms').pipe(
      catchError((err) => {
        console.error('[CollectionService] Error fetching platforms:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches a single game by its stable identifier.
   * Falls back to in-memory collection state if network or edge API is unavailable.
   */
  getGameById(id: string): Observable<Game> {
    return this.http.get<Game>(`/api/games/${id}`).pipe(
      map((game) => this.enrichGameTitle(game)),
      catchError((err) => {
        const cached = this._games().find(
          (g) => g.id === id || String(g.stable_id) === id || g.game_id === id,
        );
        if (cached) {
          let releases = cached.releases;
          if (!releases || releases.length === 0) {
            const matchingReleases = this._games()
              .filter(
                (g) =>
                  g.stable_id === cached.stable_id &&
                  (g.region || null) === (cached.region || null),
              )
              .map((r) => ({
                id: r.id,
                game_id: r.stable_id,
                region: r.region || null,
                variants: r.variants || null,
                rom_name: r.rom_name || null,
                rom_crc: r.rom_crc || null,
                backup_status: Number(r.backup_status) || 0,
                ownership_status: Number(r.ownership_status) || 0,
                release_date: r.release_date || null,
                also_released_as: r.also_released_as || null,
                has_case: Number(r.has_case) || 0,
                has_manual: Number(r.has_manual) || 0,
              }));

            releases =
              matchingReleases.length > 0
                ? matchingReleases
                : [
                    {
                      id: cached.id,
                      game_id: cached.stable_id,
                      region: cached.region || null,
                      variants: cached.variants || null,
                      rom_name: cached.rom_name || null,
                      rom_crc: cached.rom_crc || null,
                      backup_status: Number(cached.backup_status) || 0,
                      ownership_status: Number(cached.ownership_status) || 0,
                      release_date: cached.release_date || null,
                    },
                  ];
          }

          const fallbackGame: Game = {
            ...cached,
            releases,
          };
          return of(this.enrichGameTitle(fallbackGame));
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Fetches a single toy by its unique identifier.
   * Falls back to in-memory toys state if network or edge API is unavailable.
   */
  getToyById(id: string): Observable<Toy> {
    return this.http.get<Toy>(`/api/toys/${id}`).pipe(
      catchError((err) => {
        const cached = this._toys().find(
          (t) => t.id === id || String(t.stable_id) === id,
        );
        if (cached) {
          return of(cached);
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Fetches platform details by its unique identifier.
   * Falls back to in-memory platform state if network or edge API is unavailable.
   */
  getPlatformById(id: number): Observable<Platform> {
    return this.http.get<Platform>(`/api/platforms/${id}`).pipe(
      catchError((err) => {
        const cached = this._platforms().find((p) => p.id === id);
        if (cached) {
          return of(cached);
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Performs an Amiibo scan against the AmiiboAPI to discover unowned/missing figures & cards.
   *
   * @returns Observable of missing amiibo items.
   */
  scanAmiibo(): Observable<AmiiboDiscoveryItem[]> {
    return this.http
      .get<AmiiboDiscoveryItem[]>('/api/discovery/scan-amiibo')
      .pipe(catchError(this.handleMutationError));
  }

  /**
   * Triggers a retail deals and clearance scan across Best Buy, VGP, and PNP Games.
   */
  syncRetailDeals(): Observable<{
    success: boolean;
    matchedCount?: number;
    totalDeals?: number;
  }> {
    return this.http.post<{
      success: boolean;
      matchedCount?: number;
      totalDeals?: number;
    }>('/api/retail/sync-deals', {});
  }

  /**
   * Ingests a new toy (e.g. amiibo) into the collection.
   *
   * @param toy Object containing toy fields to insert or update.
   * @returns Observable denoting success status of the ingestion.
   */
  addToy(toy: Partial<Toy>): Observable<{ success: boolean; id: string }> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .post<{ success: boolean; id: string }>('/api/discovery/add-toy', toy)
      .pipe(
        tap((res) => {
          if (res?.success && res.id) {
            const newToy: Toy = {
              stable_id: Date.now(),
              id: res.id,
              name: toy.name || 'Unknown Item',
              line: toy.line || 'Amiibo',
              series_name: toy.series_name || toy.series || 'Other',
              series_line:
                toy.series_line || toy.series_name || toy.series || 'Other',
              series: toy.series || toy.series_name || 'Other',
              type: toy.type || 'Figure',
              release_date: toy.release_date || '',
              ownership_status: toy.ownership_status ?? 1,
              image_url: toy.image_url || '',
              amiibo_id: toy.amiibo_id || undefined,
              metadata_json: toy.metadata_json || undefined,
              region: toy.region || 'USA',
            };
            this._toys.update((toys) => [newToy, ...toys]);
            this._refreshTrigger.update((v) => v + 1);
          }
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Searches for games on IGDB via the local discovery proxy.
   *
   * @param query The search query string.
   * @param platformId The platform ID to filter matches.
   * @param filterDigital Whether to hide digital-only / Virtual Console fluff.
   * @returns Observable of normalized game search result candidates.
   */
  searchGames(
    query: string,
    platformId: number,
    filterDigital = false,
  ): Observable<IGDBSearchResult[]> {
    let url = `/api/discovery/search?query=${encodeURIComponent(query)}&platformId=${platformId}`;
    if (filterDigital) {
      url += '&filterDigital=true';
    }
    return this.http
      .get<IGDBSearchResult[]>(url)
      .pipe(catchError(this.handleMutationError));
  }

  /**
   * Retrieves detail metadata and physical DAT release matches for a specific IGDB game.
   *
   * @param igdbId The IGDB identifier.
   * @param platformId The platform ID.
   * @returns Observable containing the game metadata and matched releases checklist.
   */
  getGameMatches(
    igdbId: string,
    platformId: number,
  ): Observable<{
    game: IGDBSearchResult;
    matchedReleases: DiscoveryRelease[];
  }> {
    return this.http.get<{
      game: IGDBSearchResult;
      matchedReleases: DiscoveryRelease[];
    }>(`/api/discovery/matches?igdbId=${igdbId}&platformId=${platformId}`);
  }

  /**
   * Adds a newly discovered game and its checklist of releases to the SQLite database.
   *
   * @param payload Object containing game fields and selected releases to track.
   * @returns Observable denoting success status of the transactional insert.
   */
  addGame(payload: {
    game: Partial<Game> & {
      ownership_status?: number;
      play_status?: number;
      backup_status?: number;
    };
    releases: Array<
      Partial<DiscoveryRelease> & {
        rom_name?: string | null;
        rom_crc?: string | null;
        release_date?: string | null;
        ownership_status?: number;
        backup_status?: number;
      }
    >;
  }): Observable<{ success: boolean; gameId: string; stableId?: number }> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .post<{
        success: boolean;
        gameId: string;
        stableId?: number;
      }>('/api/discovery/add', payload)
      .pipe(
        tap((res) => {
          if (res?.success && res.gameId) {
            const platform = this._platforms().find(
              (p) => p.id === payload.game.platform_id,
            );
            const stableId = res.stableId || Date.now();
            const newGame: Game = {
              stable_id: stableId,
              id: res.gameId,
              game_id: res.gameId,
              title: payload.game.title || 'Unknown Game',
              series: payload.game.series || payload.game.title || 'Unknown',
              canonical_series:
                payload.game.canonical_series ||
                payload.game.title ||
                'Unknown',
              platform_id: payload.game.platform_id ?? 0,
              platform: platform?.name || 'Unknown',
              display_name:
                platform?.display_name || platform?.name || 'Unknown',
              image_url: payload.game.image_url || null,
              ownership_status:
                (payload.game.ownership_status as OwnershipStatus) ?? 0,
              play_status: (payload.game.play_status as PlayStatus) ?? 0,
              backup_status: payload.game.backup_status ? 1 : 0,
              physical_status:
                (payload.game.physical_status as PhysicalStatus) ||
                'unverified',
              verification_tier: payload.game.verification_tier ?? 0,
              release_date: payload.game.release_date || null,
              region: payload.game.region || 'USA',
              summary: payload.game.summary || null,
              genres: payload.game.genres || null,
              collections: payload.game.collections || null,
              franchises: payload.game.franchises || null,
              igdb_id: payload.game.igdb_id || null,
              igdb_url: payload.game.igdb_url || null,
              sort_index: 0,
              releases: (payload.releases || []).map((r, idx) => ({
                id: `${res.gameId}-${r.romCrc || r.rom_crc || r.romName || r.rom_name || `rel-${idx + 1}`}`,
                game_id: stableId,
                region: r.region || 'USA',
                variants: r.variants || null,
                rom_name: r.romName || r.rom_name || null,
                rom_crc: r.romCrc || r.rom_crc || null,
                ownership_status:
                  r.ownership_status ?? payload.game.ownership_status ?? 0,
                backup_status: r.backup_status ?? 0,
                release_date:
                  r.releaseDate ||
                  r.release_date ||
                  payload.game.release_date ||
                  null,
                canonical_release_id: r.canonical_release_id || null,
                barcode: r.barcode || null,
              })),
            };

            this._games.update((games) => [newGame, ...games]);
            this._refreshTrigger.update((v) => v + 1);
          }
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Performs a series scan to discover missing games for tracked series and platforms.
   * Supports optional specific franchise targeting or boolean digital filter.
   */
  scanSeries(
    optionsOrFilterDigital?:
      | boolean
      | {
          filterDigital?: boolean;
          series?: string;
          offset?: number;
          limit?: number;
        },
  ): Observable<ScanSuggestion[]> {
    let filterDigital = false;
    let series: string | undefined;
    let offset: number | undefined;
    let limit: number | undefined;

    if (typeof optionsOrFilterDigital === 'boolean') {
      filterDigital = optionsOrFilterDigital;
    } else if (optionsOrFilterDigital) {
      filterDigital = !!optionsOrFilterDigital.filterDigital;
      series = optionsOrFilterDigital.series;
      offset = optionsOrFilterDigital.offset;
      limit = optionsOrFilterDigital.limit;
    }

    const params = new URLSearchParams();
    if (filterDigital) params.set('filterDigital', 'true');
    if (series) params.set('series', series);
    if (offset !== undefined) params.set('offset', offset.toString());
    if (limit !== undefined) params.set('limit', limit.toString());

    const qs = params.toString();
    const url = qs
      ? `/api/discovery/scan-series?${qs}`
      : '/api/discovery/scan-series';
    return this.http
      .get<ScanSuggestion[]>(url)
      .pipe(catchError(this.handleMutationError));
  }

  /**
   * Performs a paginated/batched series scan to progressively discover missing games.
   */
  scanSeriesPaged(
    options: {
      filterDigital?: boolean;
      series?: string;
      offset?: number;
      limit?: number;
    } = {},
  ): Observable<PagedScanSeriesResult> {
    const params = new URLSearchParams();
    if (options.filterDigital) params.set('filterDigital', 'true');
    if (options.series) params.set('series', options.series);
    params.set('offset', (options.offset ?? 0).toString());
    params.set('limit', (options.limit ?? 30).toString());

    const url = `/api/discovery/scan-series?${params.toString()}`;
    return this.http
      .get<PagedScanSeriesResult>(url)
      .pipe(catchError(this.handleMutationError));
  }

  public promptAdminLogin() {
    this.showConfirmation(
      'Admin Authentication',
      'Sign in with Cloudflare Access (Email OTP) to manage and update your collection?',
      () => {
        if (typeof window !== 'undefined') {
          window.location.assign('/admin/login');
        }
      },
    );
  }

  public logoutAdmin() {
    this.showConfirmation(
      'Admin Log Out',
      'Are you sure you want to log out of Admin mode? This will revoke your session cookie and lock edit permissions.',
      () => {
        if (typeof window !== 'undefined') {
          window.location.assign('/admin/logout');
        }
      },
    );
  }

  /**
   * Handles authentication errors by prompting the user to sign in with Cloudflare Access OTP.
   */
  private handleMutationError = (err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'status' in err &&
      ((err as { status: number }).status === 0 ||
        (err as { status: number }).status === 401 ||
        (err as { status: number }).status === 403)
    ) {
      this._currentUser.set(null);
      this.promptAdminLogin();
    }
    return throwError(() => err);
  };

  /**
   * Toggles or updates the 'ownership_status' of a collection item.
   */
  toggleOwnership(
    id: string,
    type: 'game' | 'toy',
    status: number,
  ): Observable<unknown> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type,
        status,
        field: 'ownership_status',
      })
      .pipe(
        tap(() => {
          if (type === 'game') {
            this._games.update((games) =>
              games.map((g) =>
                g.id === id || g.game_id === id
                  ? { ...g, ownership_status: status }
                  : g,
              ),
            );
          } else {
            this._toys.update((toys) =>
              toys.map((t) =>
                t.id === id ? { ...t, ownership_status: status } : t,
              ),
            );
          }
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'play_status' of a game.
   */
  updatePlayStatus(id: string, status: PlayStatus): Observable<unknown> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type: 'game',
        status,
        field: 'play_status',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) =>
              g.id === id || g.game_id === id
                ? { ...g, play_status: status }
                : g,
            ),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'backup_status' of a game.
   */
  updateBackupStatus(id: string, status: number): Observable<unknown> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type: 'game',
        status,
        field: 'backup_status',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) => {
              if (g.id === id || g.game_id === id) {
                return { ...g, backup_status: status };
              }
              if (g.releases) {
                const rIdx = g.releases.findIndex((r) => r.id === id);
                if (rIdx !== -1) {
                  const updatedReleases = [...g.releases];
                  updatedReleases[rIdx] = {
                    ...updatedReleases[rIdx],
                    backup_status: status,
                  };
                  const allBackedUp = updatedReleases.every(
                    (r) => r.backup_status === 1,
                  )
                    ? 1
                    : 0;
                  return {
                    ...g,
                    releases: updatedReleases,
                    backup_status: allBackedUp,
                  };
                }
              }
              return g;
            }),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'has_case' flag of a game release.
   */
  updateHasCase(id: string, status: number): Observable<unknown> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type: 'game',
        status,
        field: 'has_case',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) =>
              g.id === id || g.game_id === id ? { ...g, has_case: status } : g,
            ),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'has_manual' flag of a game release.
   */
  updateHasManual(id: string, status: number): Observable<unknown> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type: 'game',
        status,
        field: 'has_manual',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) =>
              g.id === id || g.game_id === id
                ? { ...g, has_manual: status }
                : g,
            ),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'physical_status' of a game (e.g. 'physical_pending' for physical watch).
   */
  updatePhysicalStatus(
    id: string,
    status: PhysicalStatus | string,
  ): Observable<unknown> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .post('/api/collection/toggle', {
        id,
        type: 'game',
        status,
        field: 'physical_status',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) =>
              g.id === id || g.game_id === id
                ? { ...g, physical_status: status as PhysicalStatus }
                : g,
            ),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Permanently deletes a game (and all of its releases and journal entry).
   * Accepts either the game ID or any of its release IDs. Admin-only.
   */
  deleteGame(id: string): Observable<{ success: boolean }> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .delete<{
        success: boolean;
      }>(`/api/collection/game?id=${encodeURIComponent(id)}`)
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.filter((g) => g.id !== id && g.game_id !== id),
          );
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Permanently deletes a single release (edition/copy) of a game. Admin-only.
   * The parent game remains, even if it ends up with no releases.
   */
  deleteRelease(releaseId: string): Observable<{ success: boolean }> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .delete<{
        success: boolean;
      }>(`/api/collection/release?id=${encodeURIComponent(releaseId)}`)
      .pipe(catchError(this.handleMutationError));
  }

  /**
   * Updates the sort_index for a collection item.
   */
  updateSortIndex(
    id: string,
    type: 'game' | 'toy',
    sortIndex: number,
  ): Observable<unknown> {
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .post('/api/collection/sort', {
        id,
        type,
        sort_index: sortIndex,
      })
      .pipe(
        tap(() => {
          if (type === 'game') {
            this._games.update((games) =>
              games.map((g) =>
                g.id === id || g.game_id === id
                  ? { ...g, sort_index: sortIndex }
                  : g,
              ),
            );
          } else {
            this._toys.update((toys) =>
              toys.map((t) =>
                t.id === id ? { ...t, sort_index: sortIndex } : t,
              ),
            );
          }
        }),
        catchError(this.handleMutationError),
      );
  }

  /** --- Global Confirmation Dialog State --- */
  private _dialogState = signal<{
    visible: boolean;
    type: 'confirm' | 'input' | 'options';
    title: string;
    message: string;
    inputValue?: string | number;
    options?: { label: string; value: string | number }[];
    onConfirm?: (value?: string | number) => void;
  }>({ visible: false, type: 'confirm', title: '', message: '' });

  public readonly dialogState = this._dialogState.asReadonly();

  /**
   * Triggers the global confirmation dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param onConfirm Callback function executed when user confirms.
   */
  public showConfirmation(
    title: string,
    message: string,
    onConfirm: () => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'confirm',
      title,
      message,
      onConfirm,
    });
  }

  /**
   * Triggers the global input dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param initialValue Initial value for the input field.
   * @param onConfirm Callback function executed when user confirms.
   */
  public showInput(
    title: string,
    message: string,
    initialValue: string | number,
    onConfirm: (value: string | number) => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'input',
      title,
      message,
      inputValue: initialValue,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  /**
   * Triggers the global options dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param options Array of options to present.
   * @param onConfirm Callback function executed when user selects an option.
   */
  public showOptions(
    title: string,
    message: string,
    options: { label: string; value: string | number }[],
    onConfirm: (value: string | number) => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'options',
      title,
      message,
      options,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  /**
   * Closes the global confirmation dialog.
   */
  public closeDialog() {
    this._dialogState.set({ ...this._dialogState(), visible: false });
  }

  /**
   * Toggles the visibility of private acquisition journal data.
   * If the user is not authenticated, redirects to /api/auth/login (Cloudflare Access).
   */
  public toggleJournalVisibility(): void {
    if (!this.isAuthenticated()) {
      if (typeof window !== 'undefined') {
        window.location.href = '/api/auth/login';
      }
      return;
    }
  }

  /**
   * Fetches the acquisition journal entry for a single item (admin-only).
   */
  public getJournalEntry(
    itemType: 'game' | 'toy',
    itemId: string,
  ): Observable<{ authorized: boolean; entry: JournalEntry | null }> {
    return this.http
      .get<{
        authorized: boolean;
        entry: JournalEntry | null;
      }>(
        `/api/journal?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      )
      .pipe(
        tap((res) => {
          if (res.authorized && res.entry) {
            const nextMap = new Map(this._journalEntriesMap());
            nextMap.set(
              `${res.entry.item_type}:${res.entry.item_id}`,
              res.entry,
            );
            nextMap.set(`${itemType}:${itemId}`, res.entry);
            this._journalEntriesMap.set(nextMap);
          }
        }),
        catchError(() => of({ authorized: false, entry: null })),
      );
  }

  /**
   * Fetches all acquisition journal entries for the Collection Insights cost-basis view (admin-only).
   */
  public loadAllJournalEntries(): Observable<JournalEntry[]> {
    return this.http
      .get<{
        authorized: boolean;
        entries: JournalEntry[];
      }>('/api/journal/entries')
      .pipe(
        tap((res) => {
          if (res.authorized) {
            const nextMap = new Map<string, JournalEntry>();
            for (const entry of res.entries || []) {
              nextMap.set(`${entry.item_type}:${entry.item_id}`, entry);
            }
            this._journalEntriesMap.set(nextMap);
            this._journalLoaded.set(true);
          }
        }),
        map((res) => (res.authorized ? res.entries || [] : [])),
        catchError(() => of([])),
      );
  }

  /**
   * Saves or updates an acquisition journal entry for the current user.
   */
  public saveJournalEntry(
    payload: Partial<JournalEntry> & {
      item_type: 'game' | 'toy';
      item_id: string;
    },
  ): Observable<{ success: boolean; entry: JournalEntry | null }> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .post<{
        success: boolean;
        entry: JournalEntry | null;
      }>('/api/journal', payload)
      .pipe(
        tap((res) => {
          if (res.success && res.entry) {
            const nextMap = new Map(this._journalEntriesMap());
            nextMap.set(
              `${res.entry.item_type}:${res.entry.item_id}`,
              res.entry,
            );
            nextMap.set(`${payload.item_type}:${payload.item_id}`, res.entry);
            this._journalEntriesMap.set(nextMap);
          }
        }),
      );
  }

  /**
   * Deletes an acquisition journal entry for the current user.
   */
  public deleteJournalEntry(
    itemType: 'game' | 'toy',
    itemId: string,
  ): Observable<{ success: boolean }> {
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    return this.http
      .delete<{
        success: boolean;
      }>(
        `/api/journal?item_type=${encodeURIComponent(itemType)}&item_id=${encodeURIComponent(itemId)}`,
      )
      .pipe(
        tap((res) => {
          if (res.success) {
            const nextMap = new Map(this._journalEntriesMap());
            nextMap.delete(`${itemType}:${itemId}`);
            this._journalEntriesMap.set(nextMap);
          }
        }),
      );
  }

  /**
   * Enriches a game object by overriding its title with the clean ROM filename
   * (excluding the file extension) when a verified backup rom_name is present.
   * This ensures the ROM filename is displayed in the UI and used for search filters.
   *
   * @param game The source Game object to enrich.
   * @returns A new Game object with the title updated if a ROM name is present.
   */
  private formatTitle(title: string): string {
    const match = title.match(/^(.*),\s*(the|a|an)$/i);
    if (match) {
      const article = match[2];
      const rest = match[1];
      const formattedArticle =
        article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
      return `${formattedArticle} ${rest}`;
    }
    return title;
  }

  /**
   * Enriches a game object by formatting its title and appending special descriptors
   * (such as "(Bonus Disc)") from verified backup rom_name metadata while preserving
   * the canonical database / IGDB title (avoiding DAT/ROM title mutilation or 's removal).
   *
   * @param game The source Game object to enrich.
   * @returns A new Game object with the appropriately formatted title.
   */
  private enrichGameTitle(game: Game): Game {
    const baseTitle = this.formatTitle(game.title || '');
    if (!game.rom_name) {
      return {
        ...game,
        title: baseTitle,
      };
    }

    // Check if the ROM has a Bonus Disc indicator
    const isBonusDisc = /\bBonus\s+Disc\b/i.test(game.rom_name);
    const hasBonusDiscInBase = /\bBonus\s+Disc\b/i.test(baseTitle);

    if (baseTitle) {
      if (isBonusDisc && !hasBonusDiscInBase) {
        return {
          ...game,
          title: `${baseTitle} (Bonus Disc)`,
        };
      }
      return {
        ...game,
        title: baseTitle,
      };
    }

    // Fallback only if baseTitle is missing
    const lastDot = game.rom_name.lastIndexOf('.');
    let name =
      lastDot > 0 ? game.rom_name.substring(0, lastDot) : game.rom_name;

    // Ignore Xbox 360 Title Update hash paths
    if (name.includes('\\') || /^[0-9a-f]{8}\\/i.test(name)) {
      return {
        ...game,
        title: baseTitle || 'Unknown Game',
      };
    }

    name = name.replace(/\(([^)]+)\)|\[([^\]]+)\]/g, (match) => {
      if (/\bBonus\s+Disc\b/i.test(match)) {
        return '(Bonus Disc)';
      }
      return '';
    });
    name = name.replace(/\b-\s*disc\s+[0-9a-z]\b|\bdisc\s+[0-9a-z]\b/gi, '');
    name = name.replace(/\s+/g, ' ').trim();

    return {
      ...game,
      title: this.formatTitle(name) || 'Unknown Game',
    };
  }
}
