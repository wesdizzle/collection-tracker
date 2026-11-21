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

import { Injectable, OnDestroy, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouteReuseStrategy, Router } from '@angular/router';
import {
  Observable,
  firstValueFrom,
  catchError,
  of,
  map,
  tap,
  throwError,
  timeout,
} from 'rxjs';
import { CollectionRouteReuseStrategy } from '../routing/collection-route-reuse-strategy';
import { ProfileModalService } from './profile-modal.service';
import {
  AuthSessionAuthenticatedEvent,
  AuthSessionService,
} from './auth-session.service';
import { DialogService } from './dialog.service';
import {
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  KitDegradedMode,
  KitOfflineStore,
  KitThemeService,
  clearCachedKitAuthSnapshot,
} from '@wesdizzle/app-kit/angular';
import {
  Game,
  Toy,
  Platform,
  ListState,
  ViewMode,
  PlayStatus,
  OwnershipStatus,
  JournalEntry,
  UserProfile,
  UserTrackingRule,
  CatalogSeedStatus,
  CronExecutionLogEntry,
  PublicUserProfile,
  CatalogManifest,
  UserCollectionOverlayResponse,
  CatalogSyncProgress,
  EphemeralMarketPrice,
  MarketPriceItemType,
  MarketPriceScanProgress,
  MarketPricingRateLimitStatus,
  getMarketPriceKey,
  getPriceShardIndex,
  computeItemEstimatedValueCents,
  isMarketPriceFresh,
} from '../models/collection.models';

interface CollectionOfflineSnapshot {
  games: Game[];
  toys: Toy[];
  platforms: Platform[];
  journalEntries: JournalEntry[];
  catalogVersion?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class CollectionService implements OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private routeReuseStrategy = inject(RouteReuseStrategy, { optional: true });
  private profileModalService = inject(ProfileModalService, { optional: true });
  private themeService = inject(KitThemeService, { optional: true });
  private readonly authSession = inject(AuthSessionService);
  private readonly dialogService = inject(DialogService);

  /**
   * Persistence state for UI navigation (Split by tab).
   * Stores filters, scroll positions, and display limits.
   */
  private _gamesState = signal<ListState | null>(null);
  private _toysState = signal<ListState | null>(null);

  public readonly gamesState = this._gamesState.asReadonly();
  public readonly toysState = this._toysState.asReadonly();

  private readonly _currentUser = this.authSession._currentUser;
  public readonly currentUser = this.authSession.currentUser;
  private readonly _oidcIssuer = this.authSession._oidcIssuer;
  public readonly oidcIssuer = this.authSession.oidcIssuer;
  private readonly _oidcClientId = this.authSession._oidcClientId;
  public readonly oidcClientId = this.authSession.oidcClientId;
  private readonly _accountHubUrl = this.authSession._accountHubUrl;
  public readonly accountHubUrl = this.authSession.accountHubUrl;
  private readonly _isAutoSigningIn = this.authSession._isAutoSigningIn;
  public readonly isAutoSigningIn = this.authSession.isAutoSigningIn;
  public readonly isAuthenticated = this.authSession.isAuthenticated;
  public readonly isAdmin = this.authSession.isAdmin;
  public readonly homeRegion = this.authSession.homeRegion;

  private readonly _isPublicView = this.authSession._isPublicView;
  public readonly isPublicView = this.authSession.isPublicView;

  private readonly _publicProfile = this.authSession._publicProfile;
  public readonly publicProfile = this.authSession.publicProfile;

  public readonly canShowPersonalState = this.authSession.canShowPersonalState;
  public readonly trackIndividualMedia = this.authSession.trackIndividualMedia;
  public readonly canTrackIndividualMedia =
    this.authSession.canTrackIndividualMedia;

  public readonly journalRevealed = computed(() => this.canShowPersonalState());

  private _journalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  public readonly journalEntriesMap = this._journalEntriesMap.asReadonly();

  private _journalLoaded = signal<boolean>(false);
  public readonly journalLoaded = this._journalLoaded.asReadonly();

  private readonly _authInitialized = this.authSession._authInitialized;
  public readonly authInitialized = this.authSession.authInitialized;
  private readonly _authDegradedMode = this.authSession._authDegradedMode;
  private _dataDegradedMode = signal<KitDegradedMode>(null);
  private _browserOffline = signal<boolean>(false);
  private readonly _degradedTimestamp = this.authSession._degradedTimestamp;
  public readonly degradedMode = computed<KitDegradedMode>(() => {
    if (this._browserOffline()) return 'offline';
    const dataMode = this._dataDegradedMode();
    const authMode = this._authDegradedMode();
    if (dataMode === 'backup' || authMode === 'backup') {
      return dataMode === 'offline' ? 'offline' : 'backup';
    }
    return dataMode ?? authMode ?? null;
  });
  public readonly degradedTimestamp = computed<string | Date | null>(
    () => this._degradedTimestamp() ?? this._lastUpdated(),
  );
  public readonly isDegraded = computed(() => this.degradedMode() !== null);

  private readonly _activeTransitionItem = signal<{
    type: 'game' | 'toy';
    id: string;
  } | null>(null);
  public readonly activeTransitionItem =
    this._activeTransitionItem.asReadonly();

  public setActiveTransitionItem(
    type: 'game' | 'toy',
    id: string | number | null | undefined,
  ): void {
    if (!id) {
      this._activeTransitionItem.set(null);
      return;
    }
    this._activeTransitionItem.set({ type, id: String(id) });
  }

  private offlineStore = new KitOfflineStore<CollectionOfflineSnapshot>({
    dbName: 'collection_tracker_offline_db',
    storeName: 'collection_state',
    keyPrefix: 'user_collection_state',
  });

  private ephemeralPriceStore = new KitOfflineStore<
    Record<string, EphemeralMarketPrice>
  >({
    dbName: 'collection_tracker_price_cache',
    storeName: 'ephemeral_prices',
    keyPrefix: 'ebay_prices_v1',
    requestPersistenceOnInit: false,
  });

  private _marketPricesMap = signal<Map<string, EphemeralMarketPrice>>(
    new Map(),
  );
  public readonly marketPricesMap = this._marketPricesMap.asReadonly();

  private _priceOverridesMap = signal<Map<string, string>>(new Map());
  public readonly priceOverridesMap = this._priceOverridesMap.asReadonly();

  private _priceCanonicalAliases = new Map<string, string>();

  private _marketPricingConfigured = signal<boolean | null>(null);
  public readonly marketPricingConfigured =
    this._marketPricingConfigured.asReadonly();

  private _marketPriceNowMs = signal<number>(Date.now());
  public readonly marketPriceNowMs = this._marketPriceNowMs.asReadonly();

  private _marketPriceScanProgress = signal<MarketPriceScanProgress>({
    active: false,
    scopeLabel: '',
    totalItems: 0,
    completedItems: 0,
    cacheHits: 0,
    fetchedCount: 0,
    errorCount: 0,
    rateLimited: false,
    cancelled: false,
    lastError: null,
    cooldownSecondsRemaining: 0,
    waitingForWake: false,
    wakeLockActive: false,
    statusMessage: null,
  });
  public readonly marketPriceScanProgress =
    this._marketPriceScanProgress.asReadonly();

  public readonly canViewMarketPrices = computed(
    () => this.isAdmin() && !this._isPublicView(),
  );

  private _priceExpiryTimer: ReturnType<typeof setInterval> | null = null;
  private _activePriceScanId = 0;
  private _priceScanCancelled = false;
  private _marketPricesHydratedForUser: number | null = null;
  private _lastSyncedPriceUserId: number | null = null;
  private _wakeLockSentinel: {
    released?: boolean;
    release: () => Promise<void>;
  } | null = null;
  private _scanWakeCallbacks = new Set<() => void>();

  private _visibilityListener?: () => void;
  private _focusListener?: () => void;
  private _pageshowListener?: (event: PageTransitionEvent) => void;
  private _onlineListener?: () => void;
  private _offlineListener?: () => void;

  /**
   * Initializes the service and restores any saved navigation state from sessionStorage.
   * This ensures that when a user returns from a detail page, their context is restored.
   */
  constructor() {
    this.authSession.registerHooks({
      isDataDegraded: () =>
        this._browserOffline() || this._dataDegradedMode() !== null,
      getLastUpdated: () => this._lastUpdated(),
      onAuthenticated: (event) => this.handleAuthenticatedState(event),
      onUnauthenticated: (wasAuthenticated) =>
        this.handleUnauthenticatedState(wasAuthenticated),
      onPublicViewChanged: (changed) => this.handlePublicViewChanged(changed),
      redirectTo: (url) => this.redirectTo(url),
      getRouterUrl: () => this.router.url || '',
      navigateHome: () => {
        void this.router.navigateByUrl('/');
      },
    });

    if (typeof window !== 'undefined') {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this._browserOffline.set(true);
      }
      this.loadPersistedState();
      this.loadLastUpdated();
      this.checkAdminStatus();
      const initialUser = this.authSession.currentUser();
      if (this.authSession.authInitialized() && initialUser) {
        const degradedMode = this.authSession.authDegradedMode();
        void this.handleAuthenticatedState({
          user: initialUser,
          wasAuthenticated: false,
          isDegraded: degradedMode !== null,
          degradedReason:
            degradedMode === 'backup'
              ? 'r2_backup'
              : degradedMode === 'offline'
                ? 'offline'
                : undefined,
        });
      }
      this.registerAuthVisibilityListeners();
    }
  }

  public ngOnDestroy(): void {
    this.stopPriceExpiryTimer();
    this._activePriceScanId++;
    this._priceScanCancelled = true;
    this.notifyScanWaiters();
    void this.releaseScanWakeLock();
    if (typeof document !== 'undefined' && this._visibilityListener) {
      document.removeEventListener(
        'visibilitychange',
        this._visibilityListener,
      );
      this._visibilityListener = undefined;
    }
    if (typeof window !== 'undefined') {
      if (this._focusListener) {
        window.removeEventListener('focus', this._focusListener);
        this._focusListener = undefined;
      }
      if (this._pageshowListener) {
        window.removeEventListener('pageshow', this._pageshowListener);
        this._pageshowListener = undefined;
      }
      if (this._onlineListener) {
        window.removeEventListener('online', this._onlineListener);
        this._onlineListener = undefined;
      }
      if (this._offlineListener) {
        window.removeEventListener('offline', this._offlineListener);
        this._offlineListener = undefined;
      }
    }
  }

  /**
   * Listens for tab visibility, window focus, and BFCache restore events so that
   * signing out or updating identity details in another tab/window (such as the
   * OIDC Account Hub) is reflected immediately when returning to this tab.
   */
  private registerAuthVisibilityListeners(): void {
    const checkOnReturn = () => {
      if (
        this._authInitialized() &&
        Date.now() - this.authSession.getLastAuthCheckMs() >= 60_000
      ) {
        this.refreshAuthStatus().catch(() => {});
      }
    };
    if (typeof document !== 'undefined') {
      this._visibilityListener = () => {
        if (document.visibilityState === 'visible') {
          checkOnReturn();
        }
      };
      document.addEventListener('visibilitychange', this._visibilityListener);
    }
    if (typeof window !== 'undefined') {
      this._focusListener = () => {
        checkOnReturn();
      };
      this._pageshowListener = (event: PageTransitionEvent) => {
        if (event.persisted && this._authInitialized()) {
          this.refreshAuthStatus().catch(() => {});
        }
      };
      this._onlineListener = () => {
        this._browserOffline.set(false);
      };
      this._offlineListener = () => {
        this._browserOffline.set(true);
      };
      window.addEventListener('focus', this._focusListener);
      window.addEventListener('pageshow', this._pageshowListener);
      window.addEventListener('online', this._onlineListener);
      window.addEventListener('offline', this._offlineListener);
    }
  }

  /**
   * Resets authentication signals, clears cached private route handles, closes the
   * profile modal if open, and redirects protected routes (/collection/*, /profile)
   * back to the landing page ('/').
   */
  private handleUnauthenticatedState(wasAuthenticated: boolean): void {
    const prevUserId = this._currentUser()?.id ?? null;
    this._dataDegradedMode.set(null);
    this._journalEntriesMap.set(new Map());
    this._journalLoaded.set(false);
    this.resetEphemeralPricingState(prevUserId);
    if (wasAuthenticated) {
      if (!this._isPublicView()) {
        this._games.set([]);
        this._toys.set([]);
        this._loadedOwnerContext.set(null);
      }
      this._fullCatalogLoaded.set(false);
      this._fullCatalogPromise = null;
      this._catalogIsPartial.set(false);
      this._currentCatalogVersion = null;
      this._activeCatalogSyncId++;
      this._catalogSyncProgress.set({
        active: false,
        loadedRows: 0,
        totalRows: 0,
        loadedChunks: 0,
        totalChunks: 0,
        percent: 0,
      });
      if (this.routeReuseStrategy instanceof CollectionRouteReuseStrategy) {
        this.routeReuseStrategy.clearAll();
      }
      this.profileModalService?.close();
      void this.clearServiceWorkerDataCaches();
    }
  }

  private async handleAuthenticatedState(
    event: AuthSessionAuthenticatedEvent,
  ): Promise<void> {
    if (event.isDegraded) {
      await this.hydrateFromOfflineStoreIfEmpty(event.user.id);
    }
    if (event.user.role === 'admin' && !this._isPublicView()) {
      if (this._marketPricesHydratedForUser !== event.user.id) {
        this._marketPricesHydratedForUser = event.user.id;
        void this.hydrateEphemeralPricesFromStore(event.user.id);
      }
      if (!event.isDegraded && this._lastSyncedPriceUserId !== event.user.id) {
        this._lastSyncedPriceUserId = event.user.id;
        void this.syncCachedMarketPrices(true);
      }
    }
    if (
      !event.isDegraded &&
      (!event.wasAuthenticated || !this._journalLoaded())
    ) {
      this.loadAllJournalEntries().subscribe();
    } else if (
      event.isDegraded &&
      (!event.wasAuthenticated || !this._journalLoaded()) &&
      event.degradedReason !== 'offline'
    ) {
      this.loadAllJournalEntries().subscribe();
    }
  }

  private handlePublicViewChanged(changed: boolean): void {
    if (!changed) return;
    this._fullCatalogLoaded.set(false);
    this._fullCatalogPromise = null;
    this._catalogIsPartial.set(false);
    this._currentCatalogVersion = null;
    this._activeCatalogSyncId++;
    this._catalogSyncProgress.set({
      active: false,
      loadedRows: 0,
      totalRows: 0,
      loadedChunks: 0,
      totalChunks: 0,
      percent: 0,
    });
  }

  private checkDegradedReadOnly(): Observable<never> | null {
    if (this.isDegraded()) {
      return throwError(
        () =>
          new Error(
            'Read-only mode: editing is disabled while offline or using backup data.',
          ),
      );
    }
    return null;
  }

  public trySilentAutoSignIn(
    oidcIssuer: string,
    oidcClientId?: string | null,
  ): Promise<boolean> {
    return this.authSession.trySilentAutoSignIn(oidcIssuer, oidcClientId);
  }

  protected redirectTo(url: string): void {
    if (typeof window !== 'undefined' && window.location) {
      window.location.assign(url);
    }
  }

  public verifyUpstreamOidcSession(oidcIssuer: string): Promise<boolean> {
    return this.authSession.verifyUpstreamOidcSession(oidcIssuer);
  }

  public refreshAuthStatus(): Promise<UserProfile | null> {
    return this.authSession.refreshAuthStatus();
  }

  public ensureAuthLoaded(): Promise<UserProfile | null> {
    return this.authSession.ensureAuthLoaded();
  }

  public checkAdminStatus(): void {
    this.ensureAuthLoaded().catch(() => {});
  }

  /**
   * Helper method for testing to set administrative status.
   */
  public setAdminForTesting(authorized: boolean): void {
    this._authDegradedMode.set(null);
    this._dataDegradedMode.set(null);
    this._browserOffline.set(false);
    this._degradedTimestamp.set(null);
    if (authorized) {
      this._currentUser.set({
        id: 1,
        email: 'admin@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });
    } else {
      this._currentUser.set(null);
    }
    this._authInitialized.set(true);
  }

  public setCurrentUserForTesting(user: UserProfile | null): void {
    this._authDegradedMode.set(null);
    this._dataDegradedMode.set(null);
    this._browserOffline.set(false);
    this._degradedTimestamp.set(null);
    this._currentUser.set(user);
    this._authInitialized.set(true);
  }

  public getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>('/api/user/profile');
  }

  public updateProfile(data: Partial<UserProfile>): Observable<UserProfile> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
    return this.http.put<UserProfile>('/api/user/profile', data).pipe(
      tap((profile) => {
        this._currentUser.set(profile);
      }),
    );
  }

  public getHomeRegions(): Observable<string[]> {
    return this.http.get<string[]>('/api/user/regions');
  }

  public getTrackingRules(): Observable<UserTrackingRule[]> {
    return this.http
      .get<
        UserTrackingRule[] | { rules?: UserTrackingRule[] }
      >('/api/user/tracking-rules')
      .pipe(
        map((res) => {
          const list = Array.isArray(res) ? res : res?.rules || [];
          return list.map((r) => ({
            ...r,
            target_value: r.target_value || r.match_value || '',
            match_value: r.match_value || r.target_value || '',
          }));
        }),
      );
  }

  public saveTrackingRule(payload: {
    rule_type: 'series' | 'platform' | 'toy_line' | 'toy_series';
    target_value?: string;
    match_value?: string;
    is_ignored?: boolean;
    apply_retroactive?: boolean;
    clear_existing_seeking?: boolean;
  }): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
    const val = payload.match_value || payload.target_value || '';
    return this.http.post('/api/user/tracking-rules', {
      ...payload,
      match_value: val,
      target_value: val,
      clearExistingSeeking: payload.clear_existing_seeking,
    });
  }

  public deleteTrackingRule(
    ruleType: 'series' | 'platform' | 'toy_line' | 'toy_series',
    targetValue: string,
  ): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
    return this.http.delete(
      `/api/user/tracking-rules?rule_type=${encodeURIComponent(ruleType)}&match_value=${encodeURIComponent(targetValue)}&target_value=${encodeURIComponent(targetValue)}`,
    );
  }

  public getCatalogSeedStatus(): Observable<CatalogSeedStatus> {
    return this.http.get<CatalogSeedStatus>('/api/admin/catalog-seed');
  }

  public updateCatalogSeedControl(payload: {
    paused?: boolean;
    stage?: '2A' | '2B' | 'done';
    cursor?: number;
    runBatchNow?: boolean;
    runBackfillNow?: boolean;
    runRollingRefreshNow?: boolean;
    runSeriesDiscoveryNow?: boolean;
  }): Observable<CatalogSeedStatus> {
    return this.http
      .post<
        CatalogSeedStatus | { status: CatalogSeedStatus }
      >('/api/admin/catalog-seed', payload)
      .pipe(map((res) => (res && 'status' in res ? res.status : res)));
  }

  public getAdminCronLogs(
    limit = 40,
  ): Observable<{ logs: CronExecutionLogEntry[] }> {
    return this.http.get<{ logs: CronExecutionLogEntry[] }>(
      `/api/admin/diagnostics/jobs?limit=${limit}`,
    );
  }

  public getPublicUser(username: string): Observable<PublicUserProfile> {
    return this.authSession.getPublicUser(username);
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
    this.authSession.setPublicView(enabled, profile);
  }

  public exitPublicView(): void {
    this.authSession.exitPublicView();
  }

  public getTabRoute(
    tab: 'games' | 'toys' | 'insights' | 'stats' | 'admin' | string = 'games',
  ): string[] {
    if (tab === 'admin') {
      return ['/admin'];
    }
    if (
      this._isPublicView() &&
      this._publicProfile() &&
      (tab === 'games' || tab === 'toys' || tab === 'stats')
    ) {
      return ['/u', this._publicProfile()!.username, tab];
    }
    if (tab === 'stats') {
      return ['/collection/insights'];
    }
    return ['/collection', tab];
  }

  public getTabUrl(
    tab: 'games' | 'toys' | 'insights' | 'stats' | 'admin' | string = 'games',
  ): string {
    if (tab === 'admin') {
      return '/admin';
    }
    if (
      this._isPublicView() &&
      this._publicProfile() &&
      (tab === 'games' || tab === 'toys' || tab === 'stats')
    ) {
      return `/u/${encodeURIComponent(this._publicProfile()!.username)}/${tab}`;
    }
    if (tab === 'stats') {
      return '/collection/insights';
    }
    return `/collection/${tab}`;
  }

  public getItemRoute(
    type: 'game' | 'toy' | string,
    id: string | number,
  ): (string | number)[] {
    return ['/' + type, id];
  }

  /**
   * Hydrates the lastUpdated signal from localStorage.
   */
  private loadLastUpdated() {
    const saved = localStorage.getItem('app_last_updated');
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
      const saved = sessionStorage.getItem(`app_list_state_${tab}`);
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
  }

  private _games = signal<Game[]>([]);
  private _toys = signal<Toy[]>([]);
  private _platforms = signal<Platform[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _refreshTrigger = signal<number>(0);
  private _loadedOwnerContext = signal<string | null>(null);
  private _fullCatalogLoaded = signal<boolean>(false);
  private _fullCatalogPromise: Promise<void> | null = null;
  private _catalogIsPartial = signal<boolean>(false);
  private _currentCatalogVersion: string | null = null;
  private _activeCatalogSyncId = 0;
  private _catalogSyncProgress = signal<CatalogSyncProgress>({
    active: false,
    loadedRows: 0,
    totalRows: 0,
    loadedChunks: 0,
    totalChunks: 0,
    percent: 0,
  });

  /** --- Public Read-only Signal Views --- */
  public readonly games = this._games.asReadonly();
  public readonly toys = this._toys.asReadonly();
  public readonly platforms = this._platforms.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();
  public readonly loadedOwnerContext = this._loadedOwnerContext.asReadonly();
  public readonly catalogIsPartial = this._catalogIsPartial.asReadonly();
  public readonly catalogSyncProgress = this._catalogSyncProgress.asReadonly();

  public getExpectedOwnerContext(): string {
    return this._isPublicView() && this._publicProfile()
      ? `u:${this._publicProfile()!.username.toLowerCase()}`
      : 'self';
  }

  public isLoadedForCurrentContext(): boolean {
    return (
      this._loadedOwnerContext() === this.getExpectedOwnerContext() &&
      (this._games().length > 0 ||
        this._toys().length > 0 ||
        this._platforms().length > 0)
    );
  }

  /**
   * Immutably patches a game in the in-memory games signal so OnPush and
   * computed() consumers react immediately during optimistic UI updates.
   */
  public patchGameOptimistic(id: string, patch: Partial<Game>): void {
    this._games.update((games) =>
      games.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  }

  /**
   * Immutably patches a toy in the in-memory toys signal so OnPush and
   * computed() consumers react immediately during optimistic UI updates.
   */
  public patchToyOptimistic(id: string, patch: Partial<Toy>): void {
    this._toys.update((toys) =>
      toys.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  }

  /**
   * Immutably updates a game release's has_media in the in-memory games signal
   * and recalculates the parent game's has_media when discMediaOwned are present.
   */
  public patchDiscMediaOptimistic(discId: string, status: number): void {
    this._games.update((games) =>
      games.map((g) => {
        let matched = false;
        let nextReleases = g.releases;
        if (Array.isArray(g.releases)) {
          nextReleases = g.releases.map((r) => {
            if (r.id === discId) {
              matched = true;
              return { ...r, has_media: status };
            }
            return r;
          });
        }
        let nextDiscMediaOwned = g.discMediaOwned;
        if (Array.isArray(g.discIds) && Array.isArray(g.discMediaOwned)) {
          const idx = g.discIds.indexOf(discId);
          if (idx !== -1) {
            matched = true;
            nextDiscMediaOwned = [...g.discMediaOwned];
            nextDiscMediaOwned[idx] = status;
          }
        }
        if (g.id === discId) {
          matched = true;
        }
        if (!matched) return g;
        const nextHasMedia =
          Array.isArray(nextDiscMediaOwned) && nextDiscMediaOwned.length > 0
            ? nextDiscMediaOwned.every((b) => b === 1)
              ? 1
              : 0
            : g.id === discId
              ? status
              : g.has_media;
        return {
          ...g,
          releases: nextReleases,
          discMediaOwned: nextDiscMediaOwned,
          has_media: nextHasMedia,
        };
      }),
    );
  }

  /**
   * Timestamp of the last successful server synchronization.
   * Persisted to localStorage to provide context for stale data during offline use.
   */
  private _lastUpdated = signal<Date | null>(null);
  public readonly lastUpdated = this._lastUpdated.asReadonly();

  private _activeRefreshSawDegraded = false;
  private _activeRefreshSawError = false;

  private inspectDegradedHeaders(
    headers: { get?(name: string): string | null } | null | undefined,
  ): void {
    const rawMode = headers?.get?.(KIT_DEGRADED_HEADER);
    const rawTs = headers?.get?.(KIT_SNAPSHOT_TIMESTAMP_HEADER);
    if (rawMode === 'r2-backup' || rawMode === 'offline') {
      this._activeRefreshSawDegraded = true;
      this._dataDegradedMode.set(
        rawMode === 'r2-backup' ? 'backup' : 'offline',
      );
      if (rawTs) {
        this._degradedTimestamp.set(rawTs);
      }
    }
  }

  private async hydrateFromOfflineStoreIfEmpty(
    explicitUserId?: number | null,
  ): Promise<boolean> {
    if (this._isPublicView()) return false;
    const userId = explicitUserId ?? this._currentUser()?.id ?? null;
    if (!userId) return false;
    if (
      this._games().length > 0 &&
      this._toys().length > 0 &&
      this._platforms().length > 0
    ) {
      return false;
    }

    const stored = await this.offlineStore.getStoredState(userId);
    if (!stored?.state) return false;

    let hydratedAny = false;
    if (this._games().length === 0 && stored.state.games?.length) {
      this._games.set(stored.state.games);
      hydratedAny = true;
    }
    if (this._toys().length === 0 && stored.state.toys?.length) {
      this._toys.set(stored.state.toys);
      hydratedAny = true;
    }
    if (this._platforms().length === 0 && stored.state.platforms?.length) {
      this._platforms.set(stored.state.platforms);
      hydratedAny = true;
    }
    if (
      this._journalEntriesMap().size === 0 &&
      stored.state.journalEntries?.length
    ) {
      const nextMap = new Map<string, JournalEntry>();
      for (const entry of stored.state.journalEntries) {
        nextMap.set(`${entry.item_type}:${entry.item_id}`, entry);
      }
      this._journalEntriesMap.set(nextMap);
      this._journalLoaded.set(true);
      hydratedAny = true;
    }
    if (stored.updatedAt && !this._lastUpdated()) {
      this._lastUpdated.set(new Date(stored.updatedAt));
    }
    if (hydratedAny && !this._loadedOwnerContext()) {
      this._loadedOwnerContext.set('self');
    }
    return hydratedAny;
  }

  private async saveOfflineSnapshot(
    updatedAtMs: number = Date.now(),
    onlyIfNewer = false,
  ): Promise<void> {
    if (this._isPublicView()) return;
    const userId = this._currentUser()?.id ?? null;
    if (!userId) return;

    const existing = await this.offlineStore.getStoredState(userId);
    if (onlyIfNewer && existing && existing.updatedAt >= updatedAtMs) {
      return;
    }

    const currentGames = this._games();
    const currentToys = this._toys();
    const currentPlatforms = this._platforms();
    const preserveExistingFullCatalog =
      this._catalogIsPartial() &&
      !this._fullCatalogLoaded() &&
      (existing?.state?.games?.length ?? 0) > currentGames.length;
    const snapshot: CollectionOfflineSnapshot = {
      games: preserveExistingFullCatalog
        ? existing!.state.games
        : currentGames.length > 0
          ? currentGames
          : (existing?.state?.games ?? []),
      toys:
        currentToys.length > 0 ? currentToys : (existing?.state?.toys ?? []),
      platforms:
        currentPlatforms.length > 0
          ? currentPlatforms
          : (existing?.state?.platforms ?? []),
      journalEntries: Array.from(this._journalEntriesMap().values()),
      catalogVersion: preserveExistingFullCatalog
        ? (existing?.state?.catalogVersion ?? null)
        : (this._currentCatalogVersion ??
          existing?.state?.catalogVersion ??
          null),
    };
    await this.offlineStore.saveStateLocally(
      snapshot,
      updatedAtMs,
      false,
      userId,
    );
  }

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
    this._activeRefreshSawDegraded = false;
    this._activeRefreshSawError = false;
    this._fullCatalogLoaded.set(false);
    this._fullCatalogPromise = null;
    this._catalogIsPartial.set(false);
    this._activeCatalogSyncId++;
    this._catalogSyncProgress.set({
      active: false,
      loadedRows: 0,
      totalRows: 0,
      loadedChunks: 0,
      totalChunks: 0,
      percent: 0,
    });
    const targetOwner = this.getExpectedOwnerContext();
    try {
      const [games, toys, platforms] = await Promise.all([
        firstValueFrom(this.getGames()),
        firstValueFrom(this.getToys()),
        firstValueFrom(this.getPlatforms()),
      ]);
      const finalGames =
        this._activeRefreshSawError && games.length === 0
          ? this._games()
          : games;
      const finalToys =
        this._activeRefreshSawError && toys.length === 0 ? this._toys() : toys;
      const finalPlatforms =
        this._activeRefreshSawError && platforms.length === 0
          ? this._platforms()
          : platforms;
      this._games.set(finalGames);
      this._toys.set(finalToys);
      this._platforms.set(finalPlatforms);

      if (
        (this._activeRefreshSawError || this._activeRefreshSawDegraded) &&
        targetOwner === 'self' &&
        this._currentUser()?.id &&
        (finalGames.length === 0 ||
          finalToys.length === 0 ||
          finalPlatforms.length === 0)
      ) {
        await this.hydrateFromOfflineStoreIfEmpty(this._currentUser()!.id);
      }

      this._loadedOwnerContext.set(targetOwner);
      this._refreshTrigger.update((v) => v + 1);

      if (!this._activeRefreshSawDegraded && !this._activeRefreshSawError) {
        this._dataDegradedMode.set(null);
        if (this._authDegradedMode() === null) {
          this._degradedTimestamp.set(null);
        }
      }

      if (
        !this._activeRefreshSawError &&
        !this._error() &&
        this._dataDegradedMode() === null &&
        typeof window !== 'undefined' &&
        window.navigator.onLine
      ) {
        const now = new Date();
        this._lastUpdated.set(now);
        localStorage.setItem('app_last_updated', now.toISOString());
        if (targetOwner === 'self' && this._currentUser()?.id) {
          await this.saveOfflineSnapshot(now.getTime(), false);
        }
        if (this.canViewMarketPrices()) {
          void this.syncCachedMarketPrices(true);
        }
      } else if (
        !this._activeRefreshSawError &&
        this._dataDegradedMode() === 'backup' &&
        targetOwner === 'self' &&
        this._currentUser()?.id
      ) {
        const tsVal = this._degradedTimestamp();
        const parsedMs = tsVal ? new Date(tsVal).getTime() : NaN;
        const snapshotMs = Number.isFinite(parsedMs) ? parsedMs : 0;
        await this.saveOfflineSnapshot(snapshotMs, true);
      }

      if (
        !this._activeRefreshSawError &&
        !this._activeRefreshSawDegraded &&
        this._catalogIsPartial()
      ) {
        void this.ensureFullCatalogLoaded(true);
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
  getGames(platformId?: number, includeUnowned = false): Observable<Game[]> {
    let url = '/api/games';
    if (this._isPublicView() && this._publicProfile()) {
      url = `/api/u/${encodeURIComponent(this._publicProfile()!.username)}/games`;
    }
    const queryParams: string[] = [];
    if (platformId) {
      queryParams.push(`platform_id=${platformId}`);
    }
    if (includeUnowned) {
      queryParams.push('include_unowned=1');
    }
    if (queryParams.length > 0) {
      url += (url.includes('?') ? '&' : '?') + queryParams.join('&');
    }
    return this.http.get<Game[]>(url, { observe: 'response' }).pipe(
      tap((resp) => {
        this.inspectDegradedHeaders(resp.headers);
        if (!platformId && !includeUnowned) {
          this._catalogIsPartial.set(
            resp.headers?.get?.('X-Catalog-Partial') === '1',
          );
        }
      }),
      map((resp) =>
        (resp.body || []).map((game) => this.enrichGameTitle(game)),
      ),
      catchError((err) => {
        console.error('[CollectionService] Error fetching games:', err);
        this._activeRefreshSawError = true;
        this._dataDegradedMode.set('offline');
        this._error.set(
          err?.message ||
            'Failed to load games collection. Please try again later.',
        );
        return of(this._games());
      }),
    );
  }

  private applyOverlayToCatalogGame(
    rawGame: Game,
    ugrByReleaseId: Map<string, UserCollectionOverlayResponse['ugr'][number]>,
    ugByStableId: Map<number, UserCollectionOverlayResponse['ug'][number]>,
    phase1ById: Map<string, Game>,
    alreadyEnriched = false,
  ): Game {
    const baseGame = alreadyEnriched ? rawGame : this.enrichGameTitle(rawGame);
    const phase1Match = phase1ById.get(baseGame.id);
    const ugRow = ugByStableId.get(Number(baseGame.stable_id));
    const ugrSelf = ugrByReleaseId.get(baseGame.id);

    if (
      alreadyEnriched &&
      !phase1Match &&
      !ugRow &&
      !ugrSelf &&
      !baseGame.ownership_status &&
      !baseGame.play_status &&
      !baseGame.queued &&
      !baseGame.has_media &&
      !baseGame.has_case &&
      !baseGame.has_manual &&
      !baseGame.releases?.length &&
      !baseGame.discIds?.length
    ) {
      return baseGame;
    }

    let nextReleases = baseGame.releases;
    if (Array.isArray(baseGame.releases)) {
      nextReleases = baseGame.releases.map((r) => {
        const relUgr = ugrByReleaseId.get(r.id);
        return {
          ...r,
          ownership_status: Number(relUgr?.ownership_status ?? 0),
          has_media: Number(relUgr?.has_media ?? 0),
          has_case: Number(relUgr?.has_case ?? 0),
          has_manual: Number(relUgr?.has_manual ?? 0),
        };
      });
    }

    let nextDiscMediaOwned = baseGame.discMediaOwned;
    if (Array.isArray(baseGame.discIds)) {
      nextDiscMediaOwned = baseGame.discIds.map((discId) =>
        Number(ugrByReleaseId.get(discId)?.has_media ?? 0),
      );
    }

    const rolledUpHasMedia =
      Array.isArray(nextDiscMediaOwned) && nextDiscMediaOwned.length > 0
        ? nextDiscMediaOwned.every((b) => Number(b) === 1)
          ? 1
          : 0
        : Number(ugrSelf?.has_media ?? 0);

    const overlaid: Game = {
      ...baseGame,
      ownership_status: Number(
        ugrSelf?.ownership_status ?? 0,
      ) as OwnershipStatus,
      play_status: Number(ugRow?.play_status ?? 0) as PlayStatus,
      queued: Number(ugRow?.queued ?? 0),
      has_media: rolledUpHasMedia,
      has_case: Number(ugrSelf?.has_case ?? 0),
      has_manual: Number(ugrSelf?.has_manual ?? 0),
      ...(nextReleases !== undefined ? { releases: nextReleases } : {}),
      ...(nextDiscMediaOwned !== undefined
        ? { discMediaOwned: nextDiscMediaOwned }
        : {}),
    };

    if (!phase1Match) {
      return overlaid;
    }

    return {
      ...overlaid,
      ownership_status: phase1Match.ownership_status,
      play_status: phase1Match.play_status,
      queued: phase1Match.queued ?? overlaid.queued,
      has_media: phase1Match.has_media,
      has_case: phase1Match.has_case ?? overlaid.has_case,
      has_manual: phase1Match.has_manual ?? overlaid.has_manual,
      releases: phase1Match.releases ?? overlaid.releases,
      discMediaOwned: phase1Match.discMediaOwned ?? overlaid.discMediaOwned,
      retail_price: phase1Match.retail_price ?? overlaid.retail_price,
      retail_regular_price:
        phase1Match.retail_regular_price ?? overlaid.retail_regular_price,
      retail_discount_pct:
        phase1Match.retail_discount_pct ?? overlaid.retail_discount_pct,
      retail_on_sale: phase1Match.retail_on_sale ?? overlaid.retail_on_sale,
      retail_store: phase1Match.retail_store ?? overlaid.retail_store,
      retail_url: phase1Match.retail_url ?? overlaid.retail_url,
      retail_updated_at:
        phase1Match.retail_updated_at ?? overlaid.retail_updated_at,
    };
  }

  private async loadFullCatalogInChunks(syncId: number): Promise<void> {
    const userId = !this._isPublicView()
      ? (this._currentUser()?.id ?? null)
      : null;
    const overlayBaseUrl =
      this._isPublicView() && this._publicProfile()
        ? `/api/u/${encodeURIComponent(this._publicProfile()!.username)}/collection-overlay`
        : '/api/user/collection-overlay';

    const [manifestResp, existingSnapshot] = await Promise.all([
      firstValueFrom(
        this.http.get<CatalogManifest>('/api/catalog/games?manifest=1', {
          observe: 'response',
        }),
      ),
      userId ? this.offlineStore.getStoredState(userId) : Promise.resolve(null),
    ]);
    this.inspectDegradedHeaders(manifestResp.headers);
    if (syncId !== this._activeCatalogSyncId) {
      return;
    }

    const manifest = manifestResp.body;
    if (!manifest || !manifest.version) {
      this._fullCatalogLoaded.set(false);
      return;
    }

    const overlayUrl = `${overlayBaseUrl}?since_stable_id=${encodeURIComponent(
      String(manifest.maxStableId || 0),
    )}`;
    const overlayResp = await firstValueFrom(
      this.http.get<UserCollectionOverlayResponse>(overlayUrl, {
        observe: 'response',
      }),
    );
    this.inspectDegradedHeaders(overlayResp.headers);
    if (syncId !== this._activeCatalogSyncId) {
      return;
    }

    const overlay = overlayResp.body || {
      version: manifest.version,
      timestamp: manifest.timestamp,
      ugr: [],
      ug: [],
      deltaGames: [],
    };

    const ugrByReleaseId = new Map<
      string,
      UserCollectionOverlayResponse['ugr'][number]
    >();
    for (const row of overlay.ugr || []) {
      ugrByReleaseId.set(row.release_id, row);
    }

    const ugByStableId = new Map<
      number,
      UserCollectionOverlayResponse['ug'][number]
    >();
    for (const row of overlay.ug || []) {
      ugByStableId.set(Number(row.game_id), row);
    }

    const phase1Games = this._games();
    const phase1ById = new Map<string, Game>();
    for (const game of phase1Games) {
      phase1ById.set(game.id, game);
    }

    if (
      !this._isPublicView() &&
      existingSnapshot?.state?.catalogVersion === manifest.version &&
      (existingSnapshot.state.games?.length ?? 0) >= manifest.totalRows &&
      manifest.totalRows > 0
    ) {
      let stateChanged = (overlay.deltaGames?.length ?? 0) > 0;
      const mergedMap = new Map<string, Game>();
      for (const cachedGame of existingSnapshot.state.games) {
        const overlaid = this.applyOverlayToCatalogGame(
          cachedGame,
          ugrByReleaseId,
          ugByStableId,
          phase1ById,
          true,
        );
        if (
          !stateChanged &&
          overlaid !== cachedGame &&
          (overlaid.ownership_status !== cachedGame.ownership_status ||
            overlaid.play_status !== cachedGame.play_status ||
            Number(overlaid.queued ?? 0) !== Number(cachedGame.queued ?? 0) ||
            Boolean(overlaid.has_media) !== Boolean(cachedGame.has_media) ||
            Boolean(overlaid.has_case) !== Boolean(cachedGame.has_case) ||
            Boolean(overlaid.has_manual) !== Boolean(cachedGame.has_manual) ||
            overlaid.retail_updated_at !== cachedGame.retail_updated_at)
        ) {
          stateChanged = true;
        }
        mergedMap.set(overlaid.id, overlaid);
      }
      for (const deltaGame of overlay.deltaGames || []) {
        const overlaidDelta = this.applyOverlayToCatalogGame(
          deltaGame,
          ugrByReleaseId,
          ugByStableId,
          phase1ById,
        );
        mergedMap.set(overlaidDelta.id, overlaidDelta);
      }
      const merged = Array.from(mergedMap.values());
      this._games.set(merged);
      this._currentCatalogVersion = manifest.version;
      this._fullCatalogLoaded.set(true);
      this._catalogIsPartial.set(false);
      this._refreshTrigger.update((v) => v + 1);
      this._catalogSyncProgress.set({
        active: false,
        loadedRows: merged.length,
        totalRows: Math.max(manifest.totalRows, merged.length),
        loadedChunks: manifest.chunkCount,
        totalChunks: manifest.chunkCount,
        percent: 100,
      });
      if (userId && stateChanged) {
        await this.saveOfflineSnapshot(Date.now(), false);
      }
      return;
    }

    const mergedMap = new Map<string, Game>();
    for (const game of phase1Games) {
      mergedMap.set(game.id, game);
    }
    for (const deltaGame of overlay.deltaGames || []) {
      const overlaidDelta = this.applyOverlayToCatalogGame(
        deltaGame,
        ugrByReleaseId,
        ugByStableId,
        phase1ById,
      );
      mergedMap.set(overlaidDelta.id, overlaidDelta);
    }

    const totalChunks = Math.max(0, Number(manifest.chunkCount || 0));
    const initialTotalRows = Math.max(
      Number(manifest.totalRows || 0),
      mergedMap.size,
    );

    if (totalChunks === 0) {
      const merged = Array.from(mergedMap.values());
      this._games.set(merged);
      this._currentCatalogVersion = manifest.version;
      this._fullCatalogLoaded.set(true);
      this._catalogIsPartial.set(false);
      this._refreshTrigger.update((v) => v + 1);
      this._catalogSyncProgress.set({
        active: false,
        loadedRows: merged.length,
        totalRows: Math.max(initialTotalRows, merged.length),
        loadedChunks: 0,
        totalChunks: 0,
        percent: 100,
      });
      if (!this._isPublicView() && userId) {
        await this.saveOfflineSnapshot(Date.now(), false);
      }
      return;
    }

    this._catalogSyncProgress.set({
      active: true,
      loadedRows: mergedMap.size,
      totalRows: initialTotalRows,
      loadedChunks: 0,
      totalChunks,
      percent: 0,
    });

    let loadedChunks = 0;
    let nextChunkIndex = 0;

    const runChunkWorker = async (): Promise<void> => {
      while (true) {
        if (syncId !== this._activeCatalogSyncId) {
          return;
        }
        const chunkIndex = nextChunkIndex++;
        if (chunkIndex >= totalChunks) {
          return;
        }
        const chunkUrl = `/api/catalog/games?chunk=${chunkIndex}&v=${encodeURIComponent(manifest.version)}`;
        const chunkRows = await firstValueFrom(this.http.get<Game[]>(chunkUrl));
        if (syncId !== this._activeCatalogSyncId) {
          return;
        }
        if ((!chunkRows || chunkRows.length === 0) && chunkIndex > 0) {
          nextChunkIndex = totalChunks;
          return;
        }
        for (const rawRow of chunkRows || []) {
          const overlaid = this.applyOverlayToCatalogGame(
            rawRow,
            ugrByReleaseId,
            ugByStableId,
            phase1ById,
          );
          mergedMap.set(overlaid.id, overlaid);
        }
        loadedChunks++;
        const loadedCount = mergedMap.size;
        const effectiveTotalRows = Math.max(initialTotalRows, loadedCount);
        const percent = Math.min(
          100,
          Math.round((loadedChunks / totalChunks) * 100),
        );
        this._catalogSyncProgress.set({
          active: loadedChunks < totalChunks,
          loadedRows: loadedCount,
          totalRows: effectiveTotalRows,
          loadedChunks,
          totalChunks,
          percent,
        });
        if (nextChunkIndex < totalChunks) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    };

    const concurrency = Math.min(2, totalChunks);
    await Promise.all(
      Array.from({ length: concurrency }, () => runChunkWorker()),
    );

    if (syncId !== this._activeCatalogSyncId) {
      return;
    }

    const finalGames = Array.from(mergedMap.values());
    this._games.set(finalGames);
    this._currentCatalogVersion = manifest.version;
    this._fullCatalogLoaded.set(true);
    this._catalogIsPartial.set(false);
    this._refreshTrigger.update((v) => v + 1);
    this._catalogSyncProgress.set({
      active: false,
      loadedRows: finalGames.length,
      totalRows: Math.max(initialTotalRows, finalGames.length),
      loadedChunks: totalChunks,
      totalChunks,
      percent: 100,
    });
    if (!this._isPublicView() && userId) {
      await this.saveOfflineSnapshot(Date.now(), false);
    }
  }

  /**
   * Loads the full unowned + owned catalog on demand or progressively in
   * background chunks when the initial /api/games response is partial.
   */
  public async ensureFullCatalogLoaded(forceChunked = false): Promise<void> {
    if (this._fullCatalogPromise) {
      return this._fullCatalogPromise;
    }
    if (this._fullCatalogLoaded() || this.isDegraded()) {
      return;
    }
    const useChunkedPipeline = forceChunked || this._catalogIsPartial();
    const syncId = this._activeCatalogSyncId;
    this._fullCatalogLoaded.set(true);
    this._fullCatalogPromise = (async () => {
      try {
        if (useChunkedPipeline) {
          await this.loadFullCatalogInChunks(syncId);
        } else {
          const fullGames = await firstValueFrom(
            this.getGames(undefined, true),
          );
          if (syncId !== this._activeCatalogSyncId) {
            return;
          }
          if (fullGames.length > 0) {
            this._games.set(fullGames);
            this._refreshTrigger.update((v) => v + 1);
          } else {
            this._fullCatalogLoaded.set(false);
          }
        }
      } catch {
        if (syncId === this._activeCatalogSyncId) {
          this._fullCatalogLoaded.set(false);
          this._catalogSyncProgress.set({
            active: false,
            loadedRows: this._games().length,
            totalRows: this._games().length,
            loadedChunks: 0,
            totalChunks: 0,
            percent: 0,
          });
        }
      } finally {
        if (syncId === this._activeCatalogSyncId) {
          this._fullCatalogPromise = null;
        }
      }
    })();
    return this._fullCatalogPromise;
  }

  /**
   * Fetches the entire toys collection.
   */
  getToys(): Observable<Toy[]> {
    let url = '/api/toys';
    if (this._isPublicView() && this._publicProfile()) {
      url = `/api/u/${encodeURIComponent(this._publicProfile()!.username)}/toys`;
    }
    return this.http.get<Toy[]>(url, { observe: 'response' }).pipe(
      tap((resp) => this.inspectDegradedHeaders(resp.headers)),
      map((resp) => resp.body || []),
      catchError((err) => {
        console.error('[CollectionService] Error fetching toys:', err);
        this._activeRefreshSawError = true;
        this._dataDegradedMode.set('offline');
        this._error.set(
          err?.message ||
            'Failed to load toys collection. Please try again later.',
        );
        return of(this._toys());
      }),
    );
  }

  /**
   * Fetches the platform metadata list.
   */
  getPlatforms(): Observable<Platform[]> {
    return this.http
      .get<Platform[]>('/api/platforms', { observe: 'response' })
      .pipe(
        tap((resp) => this.inspectDegradedHeaders(resp.headers)),
        map((resp) => resp.body || []),
        catchError((err) => {
          console.error('[CollectionService] Error fetching platforms:', err);
          this._activeRefreshSawError = true;
          this._dataDegradedMode.set('offline');
          this._error.set(
            err?.message || 'Failed to load platforms. Please try again later.',
          );
          return of(this._platforms());
        }),
      );
  }

  /**
   * Synchronously looks up a game from the in-memory collection state for
   * instant detail hydration and View Transition snapshot continuity.
   */
  public getCachedGameById(id: string): Game | null {
    const cached = this._games().find(
      (g) => g.id === id || String(g.stable_id) === id || g.game_id === id,
    );
    if (!cached) {
      return null;
    }

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
          has_media: Number(r.has_media) || 0,
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
                has_media: Number(cached.has_media) || 0,
                ownership_status: Number(cached.ownership_status) || 0,
                release_date: cached.release_date || null,
              },
            ];
    }

    return this.enrichGameTitle({
      ...cached,
      releases,
    });
  }

  /**
   * Synchronously looks up a toy from the in-memory collection state.
   */
  public getCachedToyById(id: string): Toy | null {
    return (
      this._toys().find((t) => t.id === id || String(t.stable_id) === id) ??
      null
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
        const cached = this.getCachedGameById(id);
        if (cached) {
          return of(cached);
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
        const cached = this.getCachedToyById(id);
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

  public promptAdminLogin() {
    this.showConfirmation(
      'Sign In Required',
      'Sign in with your collector account to manage and update your collection?',
      () => {
        if (typeof window !== 'undefined') {
          window.location.assign('/api/auth/login');
        }
      },
    );
  }

  /**
   * Purges Angular Service Worker data caches (`ngsw:*:data:*`) so cached
   * authenticated API responses cannot leak to subsequent anonymous sessions.
   */
  public async clearServiceWorkerDataCaches(): Promise<void> {
    if (typeof window !== 'undefined' && 'caches' in window && window.caches) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.includes('ngsw:') && k.includes(':data:'))
            .map((k) => window.caches.delete(k)),
        );
      } catch {
        // Ignore CacheStorage errors
      }
    }
  }

  public getLogoutRedirectUrl(postLogoutPath = '/'): string {
    const issuer = this._oidcIssuer()?.replace(/\/+$/, '');
    if (issuer && typeof window !== 'undefined' && window.location) {
      const target = `${window.location.origin}${postLogoutPath.startsWith('/') ? postLogoutPath : '/'}`;
      return `${issuer}/logout?post_logout_redirect_uri=${encodeURIComponent(target)}`;
    }
    return postLogoutPath;
  }

  /**
   * Signs out the current user, clears in-memory and Service Worker data caches,
   * clears the local session cookie via POST fetch, and redirects to landing/IdP logout.
   */
  public async signOut(): Promise<void> {
    const targetUrl = this.getLogoutRedirectUrl('/');
    clearCachedKitAuthSnapshot();
    this._authDegradedMode.set(null);
    this._dataDegradedMode.set(null);
    this._degradedTimestamp.set(null);
    this._currentUser.set(null);
    this._games.set([]);
    this._toys.set([]);
    this._journalEntriesMap.set(new Map());
    this._journalLoaded.set(false);
    this._loadedOwnerContext.set(null);
    this.resetListState();
    this.profileModalService?.close();
    await this.clearServiceWorkerDataCaches();
    if (typeof fetch === 'function') {
      await fetch('/api/auth/logout?silent=1', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => {});
    }
    this.redirectTo(targetUrl);
  }

  public logoutAdmin() {
    this.showConfirmation(
      'Admin Log Out',
      'Are you sure you want to log out of Admin mode? This will revoke your session cookie and lock edit permissions.',
      () => {
        void this.signOut();
      },
    );
  }

  /**
   * Handles authentication errors by prompting the user to sign in with Cloudflare Access OTP.
   * Transient network errors (status === 0) do not invalidate the local user session.
   */
  private handleMutationError = (err: unknown) => {
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number }).status;
      if (status === 401) {
        this._currentUser.set(null);
        this.promptAdminLogin();
      } else if (status === 403 && !this.isAuthenticated()) {
        this.promptAdminLogin();
      }
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
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'play_status' of a game.
   */
  updatePlayStatus(id: string, status: PlayStatus): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'has_media' ownership status of a physical game release.
   */
  updateMediaOwned(id: string, status: number): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
        field: 'has_media',
      })
      .pipe(
        tap(() => {
          this._games.update((games) =>
            games.map((g) => {
              let nextDiscMediaOwned = g.discMediaOwned;
              if (Array.isArray(g.discIds) && Array.isArray(g.discMediaOwned)) {
                const discIdx = g.discIds.indexOf(id);
                if (discIdx !== -1) {
                  nextDiscMediaOwned = [...g.discMediaOwned];
                  nextDiscMediaOwned[discIdx] = status;
                }
              }

              if (g.id === id || g.game_id === id) {
                const rolledUp =
                  Array.isArray(nextDiscMediaOwned) &&
                  nextDiscMediaOwned.length > 0
                    ? nextDiscMediaOwned.every((b) => b === 1)
                      ? 1
                      : 0
                    : status;
                return {
                  ...g,
                  has_media: rolledUp,
                  ...(nextDiscMediaOwned !== undefined
                    ? { discMediaOwned: nextDiscMediaOwned }
                    : {}),
                };
              }
              if (g.releases) {
                const rIdx = g.releases.findIndex((r) => r.id === id);
                if (rIdx !== -1) {
                  const updatedReleases = [...g.releases];
                  updatedReleases[rIdx] = {
                    ...updatedReleases[rIdx],
                    has_media: status,
                  };
                  const allOwned = updatedReleases.every(
                    (r) => r.has_media === 1,
                  )
                    ? 1
                    : 0;
                  return {
                    ...g,
                    releases: updatedReleases,
                    has_media: allOwned,
                    ...(nextDiscMediaOwned !== undefined
                      ? { discMediaOwned: nextDiscMediaOwned }
                      : {}),
                  };
                }
              }
              return g;
            }),
          );
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Applies an admin ownership verification batch diff (newly verified media releases,
   * pruned missing releases, and optional SKU-level ownership transfers) in a single atomic Worker request.
   */
  applyOwnershipVerificationDiff(payload: {
    setMediaOwned: string[];
    clearMediaOwned: string[];
    ownershipTransfers?: Array<{
      fromReleaseIds: string[];
      toReleaseIds: string[];
      hasCase?: number;
      hasManual?: number;
    }>;
    ownershipDeclarations?: Array<{
      releaseId: string;
      hasCase?: number;
      hasManual?: number;
    }>;
  }): Observable<{
    success: boolean;
    setCount: number;
    clearCount: number;
    transferredCount: number;
    declaredOwnedCount?: number;
  }> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
    if (this._isPublicView()) {
      return throwError(() => new Error('Cannot modify public collection'));
    }
    if (!this.isAuthenticated()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Authentication required'),
      );
    }
    if (!this.isAdmin()) {
      return throwError(() => new Error('Forbidden: Admin access required.'));
    }

    const requestBody: {
      setMediaOwned: string[];
      clearMediaOwned: string[];
      ownershipTransfers: Array<{
        fromReleaseIds: string[];
        toReleaseIds: string[];
      }>;
      ownershipDeclarations?: Array<{
        releaseId: string;
        hasCase: number;
        hasManual: number;
      }>;
    } = {
      setMediaOwned: payload.setMediaOwned,
      clearMediaOwned: payload.clearMediaOwned,
      ownershipTransfers: (payload.ownershipTransfers || []).map((t) => ({
        fromReleaseIds: t.fromReleaseIds,
        toReleaseIds: t.toReleaseIds,
      })),
    };
    if (
      payload.ownershipDeclarations &&
      payload.ownershipDeclarations.length > 0
    ) {
      requestBody.ownershipDeclarations = payload.ownershipDeclarations.map(
        (d) => ({
          releaseId: d.releaseId,
          hasCase: d.hasCase ? 1 : 0,
          hasManual: d.hasManual ? 1 : 0,
        }),
      );
    }

    return this.http
      .post<{
        success: boolean;
        setCount: number;
        clearCount: number;
        transferredCount: number;
        declaredOwnedCount?: number;
      }>('/api/admin/verify-ownership/apply', requestBody)
      .pipe(
        tap(() => {
          const setIdSet = new Set(payload.setMediaOwned);
          const clearIdSet = new Set(payload.clearMediaOwned);
          const declareOwnedMap = new Map<
            string,
            { hasCase: number; hasManual: number }
          >();
          for (const d of payload.ownershipDeclarations || []) {
            const prev = declareOwnedMap.get(d.releaseId);
            declareOwnedMap.set(d.releaseId, {
              hasCase: Math.max(prev?.hasCase ?? 0, d.hasCase ? 1 : 0),
              hasManual: Math.max(prev?.hasManual ?? 0, d.hasManual ? 1 : 0),
            });
          }
          const transferFromSet = new Set<string>();
          const transferToMap = new Map<
            string,
            { hasCase: number; hasManual: number }
          >();

          const currentGames = this._games();
          const gameById = new Map<string, Game>();
          for (const g of currentGames) {
            gameById.set(g.id, g);
          }

          for (const t of payload.ownershipTransfers || []) {
            let migratedCase = t.hasCase ?? 0;
            let migratedManual = t.hasManual ?? 0;
            for (const fid of t.fromReleaseIds) {
              transferFromSet.add(fid);
              const existing = gameById.get(fid);
              if (existing) {
                if (existing.has_case) migratedCase = 1;
                if (existing.has_manual) migratedManual = 1;
              }
            }
            for (const tid of t.toReleaseIds) {
              transferToMap.set(tid, {
                hasCase: migratedCase,
                hasManual: migratedManual,
              });
            }
          }

          this._games.update((games) =>
            games.map((g) => {
              let changed = false;
              let nextHasMedia = g.has_media;
              let nextOwnership = g.ownership_status;
              let nextCase = g.has_case;
              let nextManual = g.has_manual;

              if (setIdSet.has(g.id)) {
                nextHasMedia = 1;
                changed = true;
              } else if (clearIdSet.has(g.id)) {
                nextHasMedia = 0;
                changed = true;
              }

              if (transferFromSet.has(g.id)) {
                nextOwnership = OwnershipStatus.Unowned;
                nextCase = 0;
                nextManual = 0;
                changed = true;
              } else if (transferToMap.has(g.id)) {
                const meta = transferToMap.get(g.id)!;
                nextOwnership = OwnershipStatus.Owned;
                nextCase = Math.max(Number(g.has_case || 0), meta.hasCase);
                nextManual = Math.max(
                  Number(g.has_manual || 0),
                  meta.hasManual,
                );
                changed = true;
              } else if (declareOwnedMap.has(g.id)) {
                const decl = declareOwnedMap.get(g.id)!;
                nextOwnership = OwnershipStatus.Owned;
                nextHasMedia = 1;
                nextCase = Math.max(Number(g.has_case || 0), decl.hasCase);
                nextManual = Math.max(
                  Number(g.has_manual || 0),
                  decl.hasManual,
                );
                changed = true;
              }

              let nextReleases = g.releases;
              if (g.releases && g.releases.length > 0) {
                let relChanged = false;
                const mappedReleases = g.releases.map((r) => {
                  let rMedia = r.has_media;
                  let rOwn = r.ownership_status;
                  let rCase = r.has_case;
                  let rManual = r.has_manual;
                  let rMod = false;

                  if (setIdSet.has(r.id)) {
                    rMedia = 1;
                    rMod = true;
                  } else if (clearIdSet.has(r.id)) {
                    rMedia = 0;
                    rMod = true;
                  }
                  if (transferFromSet.has(r.id)) {
                    rOwn = OwnershipStatus.Unowned;
                    rCase = 0;
                    rManual = 0;
                    rMod = true;
                  } else if (transferToMap.has(r.id)) {
                    const meta = transferToMap.get(r.id)!;
                    rOwn = OwnershipStatus.Owned;
                    rCase = Math.max(Number(r.has_case || 0), meta.hasCase);
                    rManual = Math.max(
                      Number(r.has_manual || 0),
                      meta.hasManual,
                    );
                    rMod = true;
                  } else if (declareOwnedMap.has(r.id)) {
                    const decl = declareOwnedMap.get(r.id)!;
                    rOwn = OwnershipStatus.Owned;
                    rMedia = 1;
                    rCase = Math.max(Number(r.has_case || 0), decl.hasCase);
                    rManual = Math.max(
                      Number(r.has_manual || 0),
                      decl.hasManual,
                    );
                    rMod = true;
                  }
                  if (!rMod) return r;
                  relChanged = true;
                  return {
                    ...r,
                    has_media: rMedia,
                    ownership_status: rOwn,
                    has_case: rCase,
                    has_manual: rManual,
                  };
                });
                if (relChanged) {
                  nextReleases = mappedReleases;
                  changed = true;
                }
              }

              let nextDiscMediaOwned = g.discMediaOwned;
              if (g.discIds && g.discMediaOwned && g.discIds.length > 1) {
                let discChanged = false;
                const mappedDiscMedia = g.discIds.map((did, idx) => {
                  if (setIdSet.has(did)) {
                    discChanged = true;
                    return 1;
                  }
                  if (clearIdSet.has(did)) {
                    discChanged = true;
                    return 0;
                  }
                  return g.discMediaOwned?.[idx] ?? 0;
                });
                if (discChanged) {
                  nextDiscMediaOwned = mappedDiscMedia;
                  nextHasMedia = mappedDiscMedia.every((b) => b === 1) ? 1 : 0;
                  changed = true;
                }
              }

              if (!changed) return g;
              return {
                ...g,
                has_media: nextHasMedia,
                ownership_status: nextOwnership,
                has_case: nextCase,
                has_manual: nextManual,
                releases: nextReleases,
                discMediaOwned: nextDiscMediaOwned,
              };
            }),
          );
          this._refreshTrigger.update((v) => v + 1);
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'has_case' flag of a game release.
   */
  updateHasCase(id: string, status: number): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the 'has_manual' flag of a game release.
   */
  updateHasManual(id: string, status: number): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Permanently deletes a game (and all of its releases and journal entry).
   * Accepts either the game ID or any of its release IDs. Admin-only.
   */
  deleteGame(id: string): Observable<{ success: boolean }> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Permanently deletes a single release (edition/copy) of a game. Admin-only.
   * The parent game remains, even if it ends up with no releases.
   */
  deleteRelease(releaseId: string): Observable<{ success: boolean }> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
    if (!this.isAdmin()) {
      this.promptAdminLogin();
      return throwError(
        () => new Error('Unauthorized: Admin session required'),
      );
    }
    return this.http
      .delete<{
        success: boolean;
        deletedGameId?: string;
      }>(`/api/collection/release?id=${encodeURIComponent(releaseId)}`)
      .pipe(
        tap((res) => {
          this._games.update((games) =>
            games
              .filter((g) => {
                if (
                  res?.deletedGameId &&
                  (g.id === res.deletedGameId ||
                    g.game_id === res.deletedGameId)
                ) {
                  return false;
                }
                return g.id !== releaseId;
              })
              .map((g) =>
                g.releases
                  ? {
                      ...g,
                      releases: g.releases.filter((r) => r.id !== releaseId),
                    }
                  : g,
              ),
          );
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Updates the sort_index for a collection item.
   */
  updateSortIndex(
    id: string,
    type: 'game' | 'toy',
    sortIndex: number,
  ): Observable<unknown> {
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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

  public readonly dialogState = this.dialogService.dialogState;

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
    this.dialogService.showConfirmation(title, message, onConfirm);
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
    this.dialogService.showInput(title, message, initialValue, onConfirm);
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
    this.dialogService.showOptions(title, message, options, onConfirm);
  }

  /**
   * Closes the global confirmation dialog.
   */
  public closeDialog() {
    this.dialogService.closeDialog();
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
        degraded?: boolean;
      }>('/api/journal/entries', { observe: 'response' })
      .pipe(
        tap((resp) => {
          this.inspectDegradedHeaders(resp.headers);
          const res = resp.body;
          if (res?.authorized) {
            const nextMap = new Map<string, JournalEntry>();
            for (const entry of res.entries || []) {
              nextMap.set(`${entry.item_type}:${entry.item_id}`, entry);
            }
            this._journalEntriesMap.set(nextMap);
            this._journalLoaded.set(true);
            if (
              !res.degraded &&
              !this._dataDegradedMode() &&
              this._games().length > 0
            ) {
              void this.saveOfflineSnapshot(Date.now(), false);
            }
          }
        }),
        map((resp) => (resp.body?.authorized ? resp.body.entries || [] : [])),
        catchError(() => {
          this._dataDegradedMode.set(
            this._dataDegradedMode() === 'backup' ? 'backup' : 'offline',
          );
          return of(Array.from(this._journalEntriesMap().values()));
        }),
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
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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

  /** --- Live eBay Ephemeral Market Pricing (Strict 6-Hour TTL) --- */

  public getMarketPrice(
    itemType: MarketPriceItemType,
    itemId: string,
    canonicalGameId?: string | null,
  ): EphemeralMarketPrice | null {
    if (!this.canViewMarketPrices()) return null;
    const nowMs = this._marketPriceNowMs();
    const map = this._marketPricesMap();
    const keysToTry: string[] = [];
    if (canonicalGameId) {
      keysToTry.push(getMarketPriceKey(itemType, canonicalGameId));
    }
    const directKey = getMarketPriceKey(itemType, itemId);
    keysToTry.push(directKey);
    const aliasedKey = this._priceCanonicalAliases.get(directKey);
    if (aliasedKey) {
      keysToTry.push(aliasedKey);
    }

    for (const key of keysToTry) {
      const candidate = map.get(key);
      if (candidate && isMarketPriceFresh(candidate, nowMs)) {
        return candidate;
      }
    }
    return null;
  }

  public getPriceQueryOverride(
    itemType: MarketPriceItemType,
    itemId: string,
    canonicalGameId?: string | null,
  ): string {
    const map = this._priceOverridesMap();
    if (canonicalGameId) {
      const canonical = map.get(getMarketPriceKey(itemType, canonicalGameId));
      if (canonical) return canonical;
    }
    const directKey = getMarketPriceKey(itemType, itemId);
    const direct = map.get(directKey);
    if (direct) return direct;
    const aliased = this._priceCanonicalAliases.get(directKey);
    return (aliased ? map.get(aliased) : undefined) || '';
  }

  public getEstimatedValue(
    item: Game | Toy,
    itemType: MarketPriceItemType,
  ): {
    cents: number | null;
    tierLabel: string;
    price: EphemeralMarketPrice | null;
  } {
    const canonicalId =
      itemType === 'game' ? (item as Game).game_id || item.id : item.id;
    const price = this.getMarketPrice(itemType, item.id, canonicalId);
    const valuation = computeItemEstimatedValueCents(item, price);
    return { ...valuation, price };
  }

  public async syncCachedMarketPrices(
    syncR2 = true,
  ): Promise<{ configured: boolean; count: number }> {
    if (!this.canViewMarketPrices()) {
      return { configured: false, count: 0 };
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{
          configured?: boolean;
          prices?: Record<string, EphemeralMarketPrice>;
          overrides?: Record<string, string>;
        }>(`/api/prices/cached${syncR2 ? '?sync=1' : ''}`),
      );
      if (typeof res?.configured === 'boolean') {
        this._marketPricingConfigured.set(res.configured);
      }
      const nowMs = Date.now();
      this._marketPriceNowMs.set(nowMs);
      const nextPrices = new Map<string, EphemeralMarketPrice>();
      for (const [k, v] of this._marketPricesMap().entries()) {
        if (isMarketPriceFresh(v, nowMs)) {
          nextPrices.set(k, v);
        }
      }
      if (res?.prices && typeof res.prices === 'object') {
        for (const [k, v] of Object.entries(res.prices)) {
          if (v && isMarketPriceFresh(v, nowMs)) {
            nextPrices.set(k, v);
          }
        }
      }
      this._marketPricesMap.set(nextPrices);

      const nextOverrides = new Map<string, string>();
      if (res?.overrides && typeof res.overrides === 'object') {
        for (const [k, q] of Object.entries(res.overrides)) {
          if (q) nextOverrides.set(k, q);
        }
      }
      this._priceOverridesMap.set(nextOverrides);
      this.ensurePriceExpiryTimer();
      await this.persistEphemeralPricesToStore(nextPrices);
      return {
        configured: Boolean(res?.configured),
        count: nextPrices.size,
      };
    } catch {
      return {
        configured: Boolean(this._marketPricingConfigured()),
        count: this._marketPricesMap().size,
      };
    }
  }

  public async checkLiveItemPrice(
    itemType: MarketPriceItemType,
    itemId: string,
    force = false,
  ): Promise<{
    price: EphemeralMarketPrice | null;
    cacheHit: boolean;
    error?: string;
    notConfigured?: boolean;
  }> {
    if (!this.canViewMarketPrices()) {
      return { price: null, cacheHit: false, error: 'Unauthorized.' };
    }
    try {
      const res = await firstValueFrom(
        this.http.post<{
          price: EphemeralMarketPrice | null;
          canonicalKey: string;
          cacheHit: boolean;
          error?: string;
        }>('/api/prices/live', { itemType, itemId, force }),
      );
      this._marketPricingConfigured.set(true);
      const nowMs = Date.now();
      this._marketPriceNowMs.set(nowMs);
      if (res?.price && isMarketPriceFresh(res.price, nowMs)) {
        const directKey = getMarketPriceKey(itemType, itemId);
        const canonicalKey =
          res.canonicalKey || getMarketPriceKey(itemType, res.price.item_id);
        if (canonicalKey !== directKey) {
          this._priceCanonicalAliases.set(directKey, canonicalKey);
        }
        const nextMap = new Map(this._marketPricesMap());
        nextMap.set(canonicalKey, res.price);
        this._marketPricesMap.set(nextMap);
        this.ensurePriceExpiryTimer();
        await this.persistEphemeralPricesToStore(nextMap);
      }
      return {
        price: res?.price ?? null,
        cacheHit: Boolean(res?.cacheHit),
        error: res?.error,
      };
    } catch (err: unknown) {
      const extracted = this.extractPricingHttpError(err);
      if (extracted.notConfigured) {
        this._marketPricingConfigured.set(false);
        return {
          price: null,
          cacheHit: false,
          notConfigured: true,
          error: extracted.message,
        };
      }
      return {
        price: null,
        cacheHit: false,
        error: extracted.message,
      };
    }
  }

  public async startCollectionValuationScan(
    items: Array<{ itemType: MarketPriceItemType; itemId: string }>,
    scopeLabel: string,
    force = false,
  ): Promise<void> {
    if (!this.canViewMarketPrices()) return;

    const scanId = ++this._activePriceScanId;
    this._priceScanCancelled = false;
    this.notifyScanWaiters();

    const uniqueByKey = new Map<
      string,
      { itemType: MarketPriceItemType; itemId: string }
    >();
    for (const item of items) {
      const cleanId = (item.itemId || '').trim();
      if (!cleanId) continue;
      const key = getMarketPriceKey(item.itemType, cleanId);
      if (!uniqueByKey.has(key)) {
        uniqueByKey.set(key, { itemType: item.itemType, itemId: cleanId });
      }
    }

    const deduped = Array.from(uniqueByKey.values());
    if (deduped.length === 0) {
      this._marketPriceScanProgress.set({
        active: false,
        scopeLabel,
        totalItems: 0,
        completedItems: 0,
        cacheHits: 0,
        fetchedCount: 0,
        errorCount: 0,
        rateLimited: false,
        cancelled: false,
        lastError: null,
        cooldownSecondsRemaining: 0,
        waitingForWake: false,
        wakeLockActive: false,
        statusMessage: null,
      });
      return;
    }

    let initialHits = 0;
    const misses: Array<{ itemType: MarketPriceItemType; itemId: string }> = [];
    for (const item of deduped) {
      if (!force && this.getMarketPrice(item.itemType, item.itemId)) {
        initialHits++;
      } else {
        misses.push(item);
      }
    }

    const totalItems = deduped.length;
    let completedItems = initialHits;
    let cacheHits = initialHits;
    let fetchedCount = 0;
    let errorCount = 0;
    let rateLimited = false;
    let lastError: string | null = null;

    if (misses.length === 0) {
      this._marketPriceScanProgress.set({
        active: false,
        scopeLabel,
        totalItems,
        completedItems,
        cacheHits,
        fetchedCount: 0,
        errorCount: 0,
        rateLimited: false,
        cancelled: false,
        lastError: null,
        cooldownSecondsRemaining: 0,
        waitingForWake: false,
        wakeLockActive: false,
        statusMessage: null,
      });
      return;
    }

    // Group misses by deterministic 8-shard hash in CPU-safe 5-item batches
    const shardBuckets = new Map<
      number,
      Array<{ itemType: MarketPriceItemType; itemId: string }>
    >();
    for (const miss of misses) {
      const shardIdx = getPriceShardIndex(miss.itemType, miss.itemId);
      const bucket = shardBuckets.get(shardIdx) || [];
      bucket.push(miss);
      shardBuckets.set(shardIdx, bucket);
    }

    const chunks: Array<
      Array<{ itemType: MarketPriceItemType; itemId: string }>
    > = [];
    for (const bucket of shardBuckets.values()) {
      for (let i = 0; i < bucket.length; i += 5) {
        chunks.push(bucket.slice(i, i + 5));
      }
    }

    const wakeAcquired = await this.acquireScanWakeLock();
    this._marketPriceScanProgress.set({
      active: true,
      scopeLabel,
      totalItems,
      completedItems,
      cacheHits,
      fetchedCount,
      errorCount,
      rateLimited: false,
      cancelled: false,
      lastError: null,
      cooldownSecondsRemaining: 0,
      waitingForWake: false,
      wakeLockActive: wakeAcquired,
      statusMessage: null,
    });

    const backoffSecSchedule = [5, 15, 30, 60];
    let currentInterBatchDelayMs = 400;
    let cleanStreak = 0;
    let consecutiveFailedChunks = 0;

    try {
      for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
          break;
        }

        const visibleBeforeChunk = await this.waitUntilDocumentVisible(scanId);
        if (!visibleBeforeChunk) {
          break;
        }
        await this.ensureScanWakeLock();

        let pendingChunk = [...chunks[chunkIdx]];
        let attempt = 0;
        let stopWholeScan = false;

        while (pendingChunk.length > 0) {
          if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
            break;
          }

          const visibleNow = await this.waitUntilDocumentVisible(scanId);
          if (!visibleNow) {
            break;
          }

          try {
            const res = await firstValueFrom(
              this.http
                .post<{
                  prices?: Record<string, EphemeralMarketPrice>;
                  cacheHits?: number;
                  fetchedCount?: number;
                  errors?: Record<string, string>;
                  rateLimited?: boolean;
                  retryableError?: boolean;
                  retryAfterSec?: number;
                }>('/api/prices/live-batch', { items: pendingChunk, force })
                .pipe(timeout(25_000)),
            );

            this._marketPricingConfigured.set(true);
            const nowMs = Date.now();
            this._marketPriceNowMs.set(nowMs);

            const returnedPrices = res?.prices || {};
            if (Object.keys(returnedPrices).length > 0) {
              const nextMap = new Map(this._marketPricesMap());
              for (const [k, price] of Object.entries(returnedPrices)) {
                if (price && isMarketPriceFresh(price, nowMs)) {
                  nextMap.set(k, price);
                }
              }
              this._marketPricesMap.set(nextMap);
              this.ensurePriceExpiryTimer();
              await this.persistEphemeralPricesToStore(nextMap);
            }

            const resErrors = res?.errors || {};
            const batchHits = Number(res?.cacheHits ?? 0);
            const batchFetched = Number(res?.fetchedCount ?? 0);
            cacheHits += batchHits;
            fetchedCount += batchFetched;

            const needsRetry = Boolean(res?.rateLimited || res?.retryableError);
            const stillMissing: Array<{
              itemType: MarketPriceItemType;
              itemId: string;
            }> = [];
            let permanentErrorsInAttempt = 0;

            if (needsRetry) {
              for (const item of pendingChunk) {
                const key = getMarketPriceKey(item.itemType, item.itemId);
                const errMsg = resErrors[key];
                if (errMsg === 'Item not found in catalog.') {
                  permanentErrorsInAttempt++;
                  lastError = errMsg;
                } else if (
                  !errMsg &&
                  Object.prototype.hasOwnProperty.call(returnedPrices, key)
                ) {
                  // Resolved cleanly in this attempt
                } else {
                  if (errMsg) lastError = errMsg;
                  stillMissing.push(item);
                }
              }
            } else {
              const errEntries = Object.entries(resErrors);
              if (errEntries.length > 0) {
                permanentErrorsInAttempt = errEntries.length;
                lastError = errEntries[0][1];
              }
            }

            const doneInAttempt = pendingChunk.length - stillMissing.length;
            completedItems = Math.min(
              totalItems,
              completedItems + doneInAttempt,
            );
            errorCount += permanentErrorsInAttempt;

            if (needsRetry && stillMissing.length > 0) {
              pendingChunk = stillMissing;
              currentInterBatchDelayMs = Math.min(
                1500,
                currentInterBatchDelayMs + 300,
              );
              cleanStreak = 0;

              if (attempt < backoffSecSchedule.length) {
                const baseSec = backoffSecSchedule[attempt];
                const retryAfter = Number(res?.retryAfterSec);
                const waitSec =
                  res?.rateLimited &&
                  Number.isFinite(retryAfter) &&
                  retryAfter > 0
                    ? Math.min(90, Math.max(baseSec, Math.ceil(retryAfter)))
                    : baseSec;
                attempt++;

                this._marketPriceScanProgress.update((p) => ({
                  ...p,
                  completedItems,
                  cacheHits,
                  fetchedCount,
                  errorCount,
                  lastError,
                }));

                const labelPrefix = res?.rateLimited
                  ? 'eBay rate limit reached'
                  : 'Temporary eBay API error';
                const resumed = await this.waitWithCountdown(
                  waitSec,
                  scanId,
                  labelPrefix,
                );
                if (!resumed) {
                  break;
                }
                continue;
              }

              // Retries exhausted on this batch
              errorCount += pendingChunk.length;
              consecutiveFailedChunks++;
              if (res?.rateLimited) {
                rateLimited = true;
                lastError =
                  lastError ||
                  'eBay API rate limit reached; partial results preserved.';
                stopWholeScan = true;
              } else if (consecutiveFailedChunks >= 3) {
                lastError =
                  lastError ||
                  'Stopping after repeated eBay API errors; partial results preserved.';
                stopWholeScan = true;
              }
              break;
            }

            // Chunk completed cleanly (or with only non-retryable per-item errors)
            consecutiveFailedChunks = 0;
            if (permanentErrorsInAttempt === 0) {
              cleanStreak++;
              if (cleanStreak >= 3) {
                currentInterBatchDelayMs = Math.max(
                  400,
                  currentInterBatchDelayMs - 200,
                );
              }
            }
            pendingChunk = [];
          } catch (err: unknown) {
            const extracted = this.extractPricingHttpError(err);
            if (extracted.notConfigured) {
              this._marketPricingConfigured.set(false);
              lastError = extracted.message;
              errorCount += pendingChunk.length;
              this._marketPriceScanProgress.set({
                active: false,
                scopeLabel,
                totalItems,
                completedItems,
                cacheHits,
                fetchedCount,
                errorCount,
                rateLimited: false,
                cancelled: false,
                lastError,
                cooldownSecondsRemaining: 0,
                waitingForWake: false,
                wakeLockActive: false,
                statusMessage: extracted.message,
              });
              return;
            }

            if (extracted.retryable && attempt < backoffSecSchedule.length) {
              const visibleAfterErr =
                await this.waitUntilDocumentVisible(scanId);
              if (!visibleAfterErr) {
                break;
              }

              currentInterBatchDelayMs = Math.min(
                1500,
                currentInterBatchDelayMs + 300,
              );
              cleanStreak = 0;

              const baseSec = backoffSecSchedule[attempt];
              const waitSec =
                extracted.retryAfterSec && extracted.retryAfterSec > 0
                  ? Math.min(
                      90,
                      Math.max(baseSec, Math.ceil(extracted.retryAfterSec)),
                    )
                  : baseSec;
              lastError = extracted.message;
              attempt++;

              const labelPrefix =
                extracted.status === 429
                  ? 'eBay rate limit reached'
                  : 'Temporary network / eBay API error';
              const resumed = await this.waitWithCountdown(
                waitSec,
                scanId,
                labelPrefix,
              );
              if (!resumed) {
                break;
              }
              continue;
            }

            if (extracted.status === 429) {
              rateLimited = true;
              stopWholeScan = true;
            } else {
              consecutiveFailedChunks++;
              if (consecutiveFailedChunks >= 3) {
                stopWholeScan = true;
              }
            }
            lastError = extracted.message;
            errorCount += pendingChunk.length;
            pendingChunk = [];
            break;
          }
        }

        if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
          break;
        }

        this._marketPriceScanProgress.set({
          active: !stopWholeScan,
          scopeLabel,
          totalItems,
          completedItems,
          cacheHits,
          fetchedCount,
          errorCount,
          rateLimited,
          cancelled: false,
          lastError,
          cooldownSecondsRemaining: 0,
          waitingForWake: false,
          wakeLockActive:
            this._wakeLockSentinel !== null && !this._wakeLockSentinel.released,
          statusMessage: null,
        });

        if (stopWholeScan) {
          break;
        }

        if (chunkIdx < chunks.length - 1) {
          const ok = await this.cancellableDelayMs(
            currentInterBatchDelayMs,
            scanId,
          );
          if (!ok) {
            break;
          }
        }
      }
    } finally {
      await this.releaseScanWakeLock();
      if (scanId === this._activePriceScanId) {
        this._marketPriceScanProgress.update((p) => ({
          ...p,
          active: false,
          completedItems,
          cacheHits,
          fetchedCount,
          errorCount,
          rateLimited,
          cancelled: this._priceScanCancelled,
          lastError,
          cooldownSecondsRemaining: 0,
          waitingForWake: false,
          wakeLockActive: false,
          statusMessage: this._priceScanCancelled
            ? 'Scan paused/cancelled — progress saved.'
            : rateLimited
              ? 'eBay rate limit reached; partial results preserved.'
              : null,
        }));
      }
    }
  }

  public cancelCollectionValuationScan(): void {
    this._priceScanCancelled = true;
    this._activePriceScanId++;
    this.notifyScanWaiters();
    void this.releaseScanWakeLock();
    this._marketPriceScanProgress.update((p) => ({
      ...p,
      active: false,
      cancelled: true,
      cooldownSecondsRemaining: 0,
      waitingForWake: false,
      wakeLockActive: false,
      statusMessage: 'Scan cancelled — partial results saved.',
    }));
  }

  public async savePriceQueryOverride(
    itemType: MarketPriceItemType,
    itemId: string,
    customQuery: string | null,
    refreshNow = true,
  ): Promise<{
    success: boolean;
    itemId: string;
    customQuery: string | null;
    price: EphemeralMarketPrice | null;
    priceError?: string | null;
    error?: string;
  }> {
    if (!this.canViewMarketPrices()) {
      return {
        success: false,
        itemId,
        customQuery,
        price: null,
        error: 'Unauthorized.',
      };
    }
    try {
      const res = await firstValueFrom(
        this.http.put<{
          success: boolean;
          itemType: MarketPriceItemType;
          itemId: string;
          customQuery: string | null;
          price: EphemeralMarketPrice | null;
          priceError?: string | null;
        }>('/api/prices/override', {
          itemType,
          itemId,
          customQuery,
          refreshNow,
        }),
      );
      const canonicalId = res.itemId || itemId;
      const canonicalKey = getMarketPriceKey(itemType, canonicalId);
      const directKey = getMarketPriceKey(itemType, itemId);
      if (canonicalKey !== directKey) {
        this._priceCanonicalAliases.set(directKey, canonicalKey);
      }

      const nextOverrides = new Map(this._priceOverridesMap());
      if (res.customQuery) {
        nextOverrides.set(canonicalKey, res.customQuery);
      } else {
        nextOverrides.delete(canonicalKey);
        nextOverrides.delete(directKey);
      }
      this._priceOverridesMap.set(nextOverrides);

      const nowMs = Date.now();
      this._marketPriceNowMs.set(nowMs);
      if (res.price && isMarketPriceFresh(res.price, nowMs)) {
        const nextPrices = new Map(this._marketPricesMap());
        nextPrices.set(canonicalKey, res.price);
        this._marketPricesMap.set(nextPrices);
        this.ensurePriceExpiryTimer();
        await this.persistEphemeralPricesToStore(nextPrices);
      }
      return {
        success: Boolean(res.success),
        itemId: canonicalId,
        customQuery: res.customQuery ?? null,
        price: res.price ?? null,
        priceError: res.priceError ?? null,
      };
    } catch (err: unknown) {
      const extracted = this.extractPricingHttpError(err);
      return {
        success: false,
        itemId,
        customQuery,
        price: null,
        error: extracted.message,
      };
    }
  }

  public getMarketPricingRateLimits(): Observable<MarketPricingRateLimitStatus> {
    return this.http.get<MarketPricingRateLimitStatus>(
      '/api/prices/rate-limits',
    );
  }

  public async clearMarketPriceCache(): Promise<boolean> {
    if (!this.canViewMarketPrices()) return false;
    try {
      const res = await firstValueFrom(
        this.http.post<{ cleared: boolean }>('/api/prices/cache/clear', {}),
      );
      if (res?.cleared) {
        this._marketPricesMap.set(new Map());
        this.stopPriceExpiryTimer();
        const userId = this._currentUser()?.id ?? null;
        if (userId) {
          await this.ephemeralPriceStore
            .saveStateLocally({}, Date.now(), false, userId)
            .catch(() => {});
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private resetEphemeralPricingState(previousUserId: number | null): void {
    this._activePriceScanId++;
    this._priceScanCancelled = true;
    this.notifyScanWaiters();
    void this.releaseScanWakeLock();
    this.stopPriceExpiryTimer();
    this._marketPricesMap.set(new Map());
    this._priceOverridesMap.set(new Map());
    this._priceCanonicalAliases.clear();
    this._marketPricingConfigured.set(null);
    this._marketPricesHydratedForUser = null;
    this._lastSyncedPriceUserId = null;
    this._marketPriceScanProgress.set({
      active: false,
      scopeLabel: '',
      totalItems: 0,
      completedItems: 0,
      cacheHits: 0,
      fetchedCount: 0,
      errorCount: 0,
      rateLimited: false,
      cancelled: false,
      lastError: null,
      cooldownSecondsRemaining: 0,
      waitingForWake: false,
      wakeLockActive: false,
      statusMessage: null,
    });
    if (previousUserId) {
      this.ephemeralPriceStore
        .saveStateLocally({}, Date.now(), false, previousUserId)
        .catch(() => {});
    }
  }

  private async hydrateEphemeralPricesFromStore(userId: number): Promise<void> {
    if (!userId || !this.canViewMarketPrices()) return;
    try {
      const stored = await this.ephemeralPriceStore.getStoredState(userId);
      if (!stored?.state) return;
      const nowMs = Date.now();
      this._marketPriceNowMs.set(nowMs);
      const next = new Map(this._marketPricesMap());
      let changed = false;
      for (const [k, v] of Object.entries(stored.state)) {
        if (v && isMarketPriceFresh(v, nowMs)) {
          if (!next.has(k)) {
            next.set(k, v);
          }
        } else {
          changed = true;
        }
      }
      if (next.size > 0) {
        this._marketPricesMap.set(next);
        this.ensurePriceExpiryTimer();
      }
      if (changed) {
        await this.persistEphemeralPricesToStore(next, userId);
      }
    } catch {
      // Ignore IndexedDB errors for ephemeral cache
    }
  }

  private async persistEphemeralPricesToStore(
    pricesMap: Map<string, EphemeralMarketPrice>,
    explicitUserId?: number | null,
  ): Promise<void> {
    const userId = explicitUserId ?? this._currentUser()?.id ?? null;
    if (!userId || !this.canViewMarketPrices()) return;
    const nowMs = Date.now();
    const record: Record<string, EphemeralMarketPrice> = {};
    for (const [k, v] of pricesMap.entries()) {
      if (isMarketPriceFresh(v, nowMs)) {
        record[k] = v;
      }
    }
    await this.ephemeralPriceStore
      .saveStateLocally(record, nowMs, false, userId)
      .catch(() => {});
  }

  private ensurePriceExpiryTimer(): void {
    if (typeof window === 'undefined') return;
    if (this._marketPricesMap().size === 0) {
      this.stopPriceExpiryTimer();
      return;
    }
    if (this._priceExpiryTimer !== null) return;
    this._priceExpiryTimer = setInterval(() => {
      this.pruneExpiredMarketPrices();
    }, 60_000);
  }

  private stopPriceExpiryTimer(): void {
    if (this._priceExpiryTimer !== null) {
      clearInterval(this._priceExpiryTimer);
      this._priceExpiryTimer = null;
    }
  }

  private pruneExpiredMarketPrices(): void {
    const nowMs = Date.now();
    this._marketPriceNowMs.set(nowMs);
    const cur = this._marketPricesMap();
    if (cur.size === 0) {
      this.stopPriceExpiryTimer();
      return;
    }
    let removed = false;
    const next = new Map<string, EphemeralMarketPrice>();
    for (const [k, v] of cur.entries()) {
      if (isMarketPriceFresh(v, nowMs)) {
        next.set(k, v);
      } else {
        removed = true;
      }
    }
    if (removed) {
      this._marketPricesMap.set(next);
      void this.persistEphemeralPricesToStore(next);
    }
    if (next.size === 0) {
      this.stopPriceExpiryTimer();
    }
  }

  private extractPricingHttpError(err: unknown): {
    status: number;
    message: string;
    notConfigured: boolean;
    retryable: boolean;
    retryAfterSec?: number;
  } {
    if (err instanceof HttpErrorResponse) {
      const body =
        err.error && typeof err.error === 'object'
          ? (err.error as Record<string, unknown>)
          : null;
      const code = typeof body?.['code'] === 'string' ? body['code'] : '';
      const rawMsg =
        typeof body?.['error'] === 'string'
          ? body['error']
          : err.message || 'eBay pricing request failed.';
      const bodyRetryRaw = Number(body?.['retryAfterSec']);
      const headerRetryRaw = err.headers?.get
        ? Number(err.headers.get('Retry-After'))
        : NaN;
      const retryAfterSec =
        Number.isFinite(bodyRetryRaw) && bodyRetryRaw > 0
          ? bodyRetryRaw
          : Number.isFinite(headerRetryRaw) && headerRetryRaw > 0
            ? headerRetryRaw
            : undefined;
      const notConfigured =
        err.status === 503 && code === 'ebay_not_configured';
      const retryable =
        !notConfigured &&
        (err.status === 0 ||
          err.status === 408 ||
          err.status === 429 ||
          err.status >= 500);
      return {
        status: err.status,
        message: rawMsg,
        notConfigured,
        retryable,
        retryAfterSec,
      };
    }
    const isTimeoutOrNetwork =
      err instanceof Error &&
      (err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        /timeout|network|fetch/i.test(err.message));
    return {
      status: 0,
      message:
        err instanceof Error ? err.message : 'eBay pricing request failed.',
      notConfigured: false,
      retryable: isTimeoutOrNetwork,
    };
  }

  private notifyScanWaiters(): void {
    for (const cb of Array.from(this._scanWakeCallbacks)) {
      cb();
    }
    this._scanWakeCallbacks.clear();
  }

  private async cancellableDelayMs(
    ms: number,
    scanId: number,
  ): Promise<boolean> {
    if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
      return false;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this._scanWakeCallbacks.delete(done);
        resolve();
      };
      this._scanWakeCallbacks.add(done);
      void this.delayMs(ms).then(done);
    });
    return !this._priceScanCancelled && scanId === this._activePriceScanId;
  }

  private async waitWithCountdown(
    totalSec: number,
    scanId: number,
    labelPrefix: string,
  ): Promise<boolean> {
    const cleanSec = Math.max(1, Math.round(totalSec));
    for (let rem = cleanSec; rem >= 1; rem--) {
      if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
        return false;
      }
      this._marketPriceScanProgress.update((p) => ({
        ...p,
        cooldownSecondsRemaining: rem,
        statusMessage: `${labelPrefix} — auto-resuming in ${rem}s...`,
      }));
      const ok = await this.cancellableDelayMs(1000, scanId);
      if (!ok) {
        return false;
      }
    }
    if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
      return false;
    }
    this._marketPriceScanProgress.update((p) => ({
      ...p,
      cooldownSecondsRemaining: 0,
      statusMessage: null,
    }));
    return true;
  }

  private async waitUntilDocumentVisible(scanId: number): Promise<boolean> {
    if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
      return false;
    }
    if (
      typeof document === 'undefined' ||
      document.visibilityState !== 'hidden'
    ) {
      return true;
    }

    await this.releaseScanWakeLock();
    this._marketPriceScanProgress.update((p) => ({
      ...p,
      waitingForWake: true,
      wakeLockActive: false,
      statusMessage:
        'Paused while screen locked / backgrounded — will resume automatically when you return.',
    }));

    await new Promise<void>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener('visibilitychange', onVisibility);
        this._scanWakeCallbacks.delete(cleanup);
        resolve();
      };
      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          cleanup();
        }
      };
      this._scanWakeCallbacks.add(cleanup);
      document.addEventListener('visibilitychange', onVisibility);
    });

    if (this._priceScanCancelled || scanId !== this._activePriceScanId) {
      return false;
    }

    const wakeAcquired = await this.acquireScanWakeLock();
    this._marketPriceScanProgress.update((p) => ({
      ...p,
      waitingForWake: false,
      wakeLockActive: wakeAcquired,
      statusMessage: null,
    }));
    return true;
  }

  private async acquireScanWakeLock(): Promise<boolean> {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return false;
    }
    if (this._wakeLockSentinel && this._wakeLockSentinel.released === false) {
      return true;
    }
    try {
      const nav =
        typeof navigator !== 'undefined'
          ? (navigator as unknown as {
              wakeLock?: {
                request: (type: 'screen') => Promise<{
                  released?: boolean;
                  release: () => Promise<void>;
                }>;
              };
            })
          : null;
      if (!nav?.wakeLock || typeof nav.wakeLock.request !== 'function') {
        return false;
      }
      this._wakeLockSentinel = await nav.wakeLock.request('screen');
      return true;
    } catch {
      this._wakeLockSentinel = null;
      return false;
    }
  }

  private async ensureScanWakeLock(): Promise<void> {
    if (this._wakeLockSentinel && this._wakeLockSentinel.released === false) {
      return;
    }
    const acquired = await this.acquireScanWakeLock();
    if (acquired) {
      this._marketPriceScanProgress.update((p) => ({
        ...p,
        wakeLockActive: true,
      }));
    }
  }

  private async releaseScanWakeLock(): Promise<void> {
    const sentinel = this._wakeLockSentinel;
    this._wakeLockSentinel = null;
    if (sentinel && typeof sentinel.release === 'function') {
      await sentinel.release().catch(() => {});
    }
  }

  protected delayMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
