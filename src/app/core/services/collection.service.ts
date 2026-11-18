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
import { Router, RouteReuseStrategy } from '@angular/router';
import {
  Observable,
  firstValueFrom,
  catchError,
  of,
  map,
  tap,
  throwError,
} from 'rxjs';
import { CollectionRouteReuseStrategy } from '../routing/collection-route-reuse-strategy';
import { ProfileModalService } from './profile-modal.service';
import {
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  KitDegradedMode,
  KitOfflineStore,
  KitThemeService,
  checkUpstreamOidcStatus,
  clearCachedKitAuthSnapshot,
  clearSilentSsoAttempt,
  getCurrentReturnToPath,
  markSilentSsoAttempt,
  mergeDegradedUserProfile,
  notifyActiveThemeService,
  readCachedKitAuthSnapshot,
  shouldAttemptSilentSso,
  writeCachedKitAuthSnapshot,
} from '@wesdizzle/app-kit/angular';
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
  UserTrackingRule,
  CatalogSeedStatus,
  CronExecutionLogEntry,
  PublicUserProfile,
  AuthMeResponse,
  CatalogManifest,
  UserCollectionOverlayResponse,
  CatalogSyncProgress,
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
  private _oidcIssuer = signal<string | null>(null);
  public readonly oidcIssuer = this._oidcIssuer.asReadonly();
  private _oidcClientId = signal<string | null>(null);
  public readonly oidcClientId = this._oidcClientId.asReadonly();
  private _accountHubUrl = signal<string | null>(null);
  public readonly accountHubUrl = this._accountHubUrl.asReadonly();
  private _isAutoSigningIn = signal<boolean>(false);
  public readonly isAutoSigningIn = this._isAutoSigningIn.asReadonly();
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

  public readonly canShowPersonalState = computed(
    () => this.isAuthenticated() && !this._isPublicView(),
  );

  public readonly journalRevealed = computed(() => this.canShowPersonalState());

  private _journalEntriesMap = signal<Map<string, JournalEntry>>(new Map());
  public readonly journalEntriesMap = this._journalEntriesMap.asReadonly();

  private _journalLoaded = signal<boolean>(false);
  public readonly journalLoaded = this._journalLoaded.asReadonly();

  private _authInitialized = signal<boolean>(false);
  public readonly authInitialized = this._authInitialized.asReadonly();
  private _authPromise: Promise<UserProfile | null> | null = null;
  private _lastAuthCheckMs = 0;
  private _authDegradedMode = signal<KitDegradedMode>(null);
  private _dataDegradedMode = signal<KitDegradedMode>(null);
  private _browserOffline = signal<boolean>(false);
  private _degradedTimestamp = signal<string | Date | null>(null);
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
    if (typeof window !== 'undefined') {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this._browserOffline.set(true);
      }
      this.loadPersistedState();
      this.loadLastUpdated();
      this.checkAdminStatus();
      this.registerAuthVisibilityListeners();
    }
  }

  public ngOnDestroy(): void {
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
        Date.now() - this._lastAuthCheckMs >= 60_000
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
    clearCachedKitAuthSnapshot();
    this._authDegradedMode.set(null);
    this._dataDegradedMode.set(null);
    this._degradedTimestamp.set(null);
    notifyActiveThemeService({
      issuerUrl: null,
      authenticated: false,
    });
    this._currentUser.set(null);
    this._journalEntriesMap.set(new Map());
    this._journalLoaded.set(false);
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
    if (!this._isPublicView()) {
      const routerPath = (this.router.url || '').split('?')[0].split('#')[0];
      const windowPath =
        typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : '';
      const currentPath =
        routerPath && routerPath !== '/' ? routerPath : windowPath;
      if (
        currentPath === '/collection' ||
        currentPath.startsWith('/collection/') ||
        currentPath === '/discovery' ||
        currentPath.startsWith('/discovery/') ||
        currentPath === '/profile' ||
        currentPath.startsWith('/profile/')
      ) {
        void this.router.navigateByUrl('/');
      }
    }
  }

  /**
   * Applies the /api/auth/me response to signals and verifies that the
   * upstream OIDC identity provider session is still active.
   */
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

  private async applyAuthMeResponse(
    res: AuthMeResponse,
    headerDegraded?: string | null,
    headerTimestamp?: string | null,
  ): Promise<UserProfile | null> {
    this._lastAuthCheckMs = Date.now();
    const wasAuthenticated = this._currentUser() !== null;
    if (res.oidcIssuer !== undefined) {
      this._oidcIssuer.set(res.oidcIssuer || null);
    }
    if (res.oidcClientId !== undefined) {
      this._oidcClientId.set(res.oidcClientId || null);
    }
    if (res.accountHubUrl !== undefined) {
      this._accountHubUrl.set(res.accountHubUrl || null);
    }
    const issuer = res.oidcIssuer || this._oidcIssuer();
    const clientId = res.oidcClientId || this._oidcClientId();
    if (res.authenticated && res.user) {
      this._isAutoSigningIn.set(false);
      const isDegradedResponse = Boolean(res.degraded || headerDegraded);
      const cachedSnapshot = readCachedKitAuthSnapshot<UserProfile>();
      const cachedProfile = this._currentUser() ?? cachedSnapshot?.user ?? null;
      const effectiveUser = isDegradedResponse
        ? mergeDegradedUserProfile(res.user, cachedProfile)
        : res.user;
      this._currentUser.set(effectiveUser);

      if (isDegradedResponse) {
        const mode: KitDegradedMode =
          res.degradedReason === 'r2_backup' || headerDegraded === 'r2-backup'
            ? 'backup'
            : 'offline';
        this._authDegradedMode.set(mode);
        const ts =
          res.snapshotTimestamp ??
          headerTimestamp ??
          (cachedSnapshot?.updatedAt
            ? new Date(cachedSnapshot.updatedAt).toISOString()
            : null);
        if (ts) {
          this._degradedTimestamp.set(ts);
        }
        await this.hydrateFromOfflineStoreIfEmpty(effectiveUser.id);
      } else {
        this._authDegradedMode.set(null);
        if (this._dataDegradedMode() === null) {
          this._degradedTimestamp.set(null);
        }
      }

      writeCachedKitAuthSnapshot({
        user: effectiveUser,
        accountHubUrl: res.accountHubUrl ?? this._accountHubUrl(),
        oidcIssuer: res.oidcIssuer ?? this._oidcIssuer(),
        oidcClientId: res.oidcClientId ?? this._oidcClientId(),
        updatedAt: isDegradedResponse
          ? (cachedSnapshot?.updatedAt ?? Date.now())
          : Date.now(),
      });

      if (issuer) {
        const upstreamActive = await this.verifyUpstreamOidcSession(issuer);
        if (!upstreamActive) {
          this._authInitialized.set(true);
          return null;
        }
      }
      clearSilentSsoAttempt(clientId);
      if (
        !isDegradedResponse &&
        (!wasAuthenticated || !this._journalLoaded())
      ) {
        this.loadAllJournalEntries().subscribe();
      } else if (
        isDegradedResponse &&
        (!wasAuthenticated || !this._journalLoaded()) &&
        res.degradedReason !== 'offline'
      ) {
        this.loadAllJournalEntries().subscribe();
      }
    } else {
      clearCachedKitAuthSnapshot();
      this._authDegradedMode.set(null);
      if (
        !wasAuthenticated &&
        res.provisioned !== false &&
        issuer &&
        !this._isPublicView()
      ) {
        const redirected = await this.trySilentAutoSignIn(issuer, clientId);
        if (redirected) {
          this._authInitialized.set(true);
          return null;
        }
      }
      this.handleUnauthenticatedState(wasAuthenticated);
    }
    this._authInitialized.set(true);
    return this._currentUser();
  }

  /**
   * Attempts silent SSO redirect when locally unauthenticated if the user has an
   * active, authorized session on the central OIDC Account Server.
   */
  public async trySilentAutoSignIn(
    oidcIssuer: string,
    oidcClientId?: string | null,
  ): Promise<boolean> {
    if (!oidcIssuer || this._isPublicView()) {
      return false;
    }
    if (typeof window !== 'undefined' && window.location) {
      if ((window.location.pathname || '/').startsWith('/u/')) {
        return false;
      }
    }
    if (!shouldAttemptSilentSso(oidcClientId)) {
      return false;
    }
    const status = await checkUpstreamOidcStatus(oidcIssuer, oidcClientId);
    if (status.reachable && status.authenticated) {
      if (!status.authorized) {
        return false;
      }
      markSilentSsoAttempt(oidcClientId);
      this._isAutoSigningIn.set(true);
      const currentReturn = getCurrentReturnToPath('/collection/games');
      const targetReturn =
        currentReturn === '/' ? '/collection/games' : currentReturn;
      this.redirectTo(
        `/api/auth/login?return_to=${encodeURIComponent(targetReturn)}&prompt=none`,
      );
      return true;
    }

    if (status.reachable && status.cookiePresent === false) {
      markSilentSsoAttempt(oidcClientId);
      this._isAutoSigningIn.set(true);
      const currentReturn = getCurrentReturnToPath('/collection/games');
      const targetReturn =
        currentReturn === '/' ? '/collection/games' : currentReturn;
      this.redirectTo(
        `/api/auth/login?return_to=${encodeURIComponent(targetReturn)}&prompt=none`,
      );
      return true;
    }

    return false;
  }

  protected redirectTo(url: string): void {
    if (typeof window !== 'undefined' && window.location) {
      window.location.assign(url);
    }
  }

  /**
   * Verifies with the configured OIDC issuer whether the upstream identity session
   * is still active. If the user signed out on the Account Hub, clears the local
   * relying-party session cookie, resets the current user signal, and redirects
   * protected routes to the landing page.
   */
  public async verifyUpstreamOidcSession(oidcIssuer: string): Promise<boolean> {
    if (typeof fetch !== 'function' || !oidcIssuer || this.isDegraded()) {
      return true;
    }
    const status = await checkUpstreamOidcStatus(
      oidcIssuer,
      this._oidcClientId(),
    );
    if (!status.reachable || status.degraded || this.isDegraded()) {
      return true;
    }
    if (!status.authenticated && status.cookiePresent === false) {
      return true;
    }
    if (!status.authenticated || !status.authorized) {
      clearCachedKitAuthSnapshot();
      await fetch('/api/auth/logout?silent=1', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => {});
      this.handleUnauthenticatedState(true);
      return false;
    }
    if (status.authenticated && status.user && !status.degraded) {
      const localUser = this._currentUser();
      if (
        localUser &&
        ((status.user.username &&
          status.user.username.toLowerCase() !==
            localUser.username.toLowerCase()) ||
          (status.user.role && status.user.role !== localUser.role))
      ) {
        const oidcClientId = this._oidcClientId();
        if (!shouldAttemptSilentSso(oidcClientId)) {
          return false;
        }
        markSilentSsoAttempt(oidcClientId);
        const returnTo = getCurrentReturnToPath('/');
        this.redirectTo(
          `/api/auth/login?return_to=${encodeURIComponent(returnTo)}&prompt=none`,
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Re-fetches /api/auth/me to synchronize authentication state (e.g., when
   * returning to an open tab after signing out on the OIDC Account Hub).
   */
  public refreshAuthStatus(): Promise<UserProfile | null> {
    this._authPromise = firstValueFrom(
      this.http
        .get<AuthMeResponse>('/api/auth/me', { observe: 'response' })
        .pipe(
          map((resp) => ({
            body:
              resp.body ||
              ({ authenticated: false, user: null } as AuthMeResponse),
            headerDegraded: resp.headers?.get?.(KIT_DEGRADED_HEADER) ?? null,
            headerTimestamp:
              resp.headers?.get?.(KIT_SNAPSHOT_TIMESTAMP_HEADER) ?? null,
          })),
          catchError((err: unknown) => {
            const status =
              err instanceof HttpErrorResponse
                ? err.status
                : err && typeof err === 'object' && 'status' in err
                  ? Number((err as { status: unknown }).status)
                  : 0;
            if (status === 401 || status === 403) {
              return of({
                body: { authenticated: false, user: null } as AuthMeResponse,
                headerDegraded: null,
                headerTimestamp: null,
              });
            }
            const cachedSnapshot = readCachedKitAuthSnapshot<UserProfile>();
            const preservedUser =
              this._currentUser() ?? cachedSnapshot?.user ?? null;
            if (preservedUser) {
              return of({
                body: {
                  authenticated: true,
                  user: preservedUser,
                  oidcIssuer:
                    cachedSnapshot?.oidcIssuer ??
                    this._oidcIssuer() ??
                    undefined,
                  oidcClientId:
                    cachedSnapshot?.oidcClientId ??
                    this._oidcClientId() ??
                    undefined,
                  accountHubUrl:
                    cachedSnapshot?.accountHubUrl ??
                    this._accountHubUrl() ??
                    undefined,
                  degraded: true,
                  degradedReason: 'offline',
                  snapshotTimestamp: cachedSnapshot?.updatedAt
                    ? new Date(cachedSnapshot.updatedAt).toISOString()
                    : (this._lastUpdated()?.toISOString() ?? null),
                } as AuthMeResponse,
                headerDegraded: 'offline',
                headerTimestamp: null,
              });
            }
            return of({
              body: { authenticated: false, user: null } as AuthMeResponse,
              headerDegraded: null,
              headerTimestamp: null,
            });
          }),
        ),
    ).then(({ body, headerDegraded, headerTimestamp }) =>
      this.applyAuthMeResponse(body, headerDegraded, headerTimestamp),
    );
    return this._authPromise;
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
    return this.refreshAuthStatus();
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
    const prevUsername = this._publicProfile()?.username || null;
    const nextUsername = profile?.username || null;
    if (enabled !== this._isPublicView() || prevUsername !== nextUsername) {
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
    this._isPublicView.set(enabled);
    this._publicProfile.set(profile || null);
  }

  public exitPublicView(): void {
    this.setPublicView(false, null);
  }

  public getTabRoute(
    tab: 'games' | 'toys' | 'insights' | 'discovery' | string = 'games',
  ): string[] {
    if (tab === 'discovery') {
      return ['/discovery'];
    }
    if (
      this._isPublicView() &&
      this._publicProfile() &&
      (tab === 'games' || tab === 'toys')
    ) {
      return ['/u', this._publicProfile()!.username, tab];
    }
    return ['/collection', tab];
  }

  public getTabUrl(
    tab: 'games' | 'toys' | 'insights' | 'discovery' | string = 'games',
  ): string {
    if (tab === 'discovery') {
      return '/discovery';
    }
    if (
      this._isPublicView() &&
      this._publicProfile() &&
      (tab === 'games' || tab === 'toys')
    ) {
      return `/u/${encodeURIComponent(this._publicProfile()!.username)}/${tab}`;
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
   * Immutably updates a game release's backup_status in the in-memory games signal
   * and recalculates the parent game's backup_status when discBackups are present.
   */
  public patchDiscBackupOptimistic(discId: string, status: number): void {
    this._games.update((games) =>
      games.map((g) => {
        let matched = false;
        let nextReleases = g.releases;
        if (Array.isArray(g.releases)) {
          nextReleases = g.releases.map((r) => {
            if (r.id === discId) {
              matched = true;
              return { ...r, backup_status: status };
            }
            return r;
          });
        }
        let nextDiscBackups = g.discBackups;
        if (Array.isArray(g.discIds) && Array.isArray(g.discBackups)) {
          const idx = g.discIds.indexOf(discId);
          if (idx !== -1) {
            matched = true;
            nextDiscBackups = [...g.discBackups];
            nextDiscBackups[idx] = status;
          }
        }
        if (g.id === discId) {
          matched = true;
        }
        if (!matched) return g;
        const nextBackupStatus =
          Array.isArray(nextDiscBackups) && nextDiscBackups.length > 0
            ? nextDiscBackups.every((b) => b === 1)
              ? 1
              : 0
            : g.id === discId
              ? status
              : g.backup_status;
        return {
          ...g,
          releases: nextReleases,
          discBackups: nextDiscBackups,
          backup_status: nextBackupStatus,
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
      !baseGame.backup_status &&
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
          backup_status: Number(relUgr?.backup_status ?? 0),
          has_case: Number(relUgr?.has_case ?? 0),
          has_manual: Number(relUgr?.has_manual ?? 0),
        };
      });
    }

    let nextDiscBackups = baseGame.discBackups;
    if (Array.isArray(baseGame.discIds)) {
      nextDiscBackups = baseGame.discIds.map((discId) =>
        Number(ugrByReleaseId.get(discId)?.backup_status ?? 0),
      );
    }

    const rolledUpBackupStatus =
      Array.isArray(nextDiscBackups) && nextDiscBackups.length > 0
        ? nextDiscBackups.every((b) => Number(b) === 1)
          ? 1
          : 0
        : Number(ugrSelf?.backup_status ?? 0);

    const overlaid: Game = {
      ...baseGame,
      ownership_status: Number(
        ugrSelf?.ownership_status ?? 0,
      ) as OwnershipStatus,
      play_status: Number(ugRow?.play_status ?? 0) as PlayStatus,
      queued: Number(ugRow?.queued ?? 0),
      backup_status: rolledUpBackupStatus,
      has_case: Number(ugrSelf?.has_case ?? 0),
      has_manual: Number(ugrSelf?.has_manual ?? 0),
      ...(nextReleases !== undefined ? { releases: nextReleases } : {}),
      ...(nextDiscBackups !== undefined
        ? { discBackups: nextDiscBackups }
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
      backup_status: phase1Match.backup_status,
      has_case: phase1Match.has_case ?? overlaid.has_case,
      has_manual: phase1Match.has_manual ?? overlaid.has_manual,
      releases: phase1Match.releases ?? overlaid.releases,
      discBackups: phase1Match.discBackups ?? overlaid.discBackups,
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
            Boolean(overlaid.backup_status) !==
              Boolean(cachedGame.backup_status) ||
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
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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
            void this.clearServiceWorkerDataCaches();
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
    filterDigital = true,
  ): Observable<IGDBSearchResult[]> {
    let url = `/api/discovery/search?query=${encodeURIComponent(query)}&platformId=${platformId}`;
    if (filterDigital) {
      url += '&filterDigital=true';
    } else {
      url += '&filterDigital=false';
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
    const blocked = this.checkDegradedReadOnly();
    if (blocked) return blocked;
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

            this._games.update((games) => {
              const existingIdx = games.findIndex(
                (g) => g.id === res.gameId || g.game_id === res.gameId,
              );
              if (existingIdx !== -1) {
                const next = [...games];
                next[existingIdx] = newGame;
                return next;
              }
              return [newGame, ...games];
            });
            this._refreshTrigger.update((v) => v + 1);
            void this.clearServiceWorkerDataCaches();
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
    let filterDigital = true;
    let series: string | undefined;
    let offset: number | undefined;
    let limit: number | undefined;

    if (typeof optionsOrFilterDigital === 'boolean') {
      filterDigital = optionsOrFilterDigital;
    } else if (optionsOrFilterDigital) {
      filterDigital =
        optionsOrFilterDigital.filterDigital !== undefined
          ? !!optionsOrFilterDigital.filterDigital
          : true;
      series = optionsOrFilterDigital.series;
      offset = optionsOrFilterDigital.offset;
      limit = optionsOrFilterDigital.limit;
    }

    const params = new URLSearchParams();
    if (optionsOrFilterDigital !== undefined) {
      if (filterDigital) params.set('filterDigital', 'true');
      else params.set('filterDigital', 'false');
    }
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
    const filterDigital =
      options.filterDigital !== undefined ? !!options.filterDigital : true;
    if (filterDigital) params.set('filterDigital', 'true');
    else params.set('filterDigital', 'false');
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
   * Updates the 'backup_status' of a game.
   */
  updateBackupStatus(id: string, status: number): Observable<unknown> {
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
          void this.clearServiceWorkerDataCaches();
        }),
        catchError(this.handleMutationError),
      );
  }

  /**
   * Applies a batch backup scan diff (newly backed up releases, cleared missing backups,
   * and optional SKU-level ownership transfers) in a single atomic Worker request.
   */
  applyBackupScanDiff(payload: {
    setBackedUp: string[];
    clearBackedUp: string[];
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

    const requestBody: {
      setBackedUp: string[];
      clearBackedUp: string[];
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
      setBackedUp: payload.setBackedUp,
      clearBackedUp: payload.clearBackedUp,
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
      }>('/api/collection/backups/apply', requestBody)
      .pipe(
        tap(() => {
          const setIdSet = new Set(payload.setBackedUp);
          const clearIdSet = new Set(payload.clearBackedUp);
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
              let nextBackup = g.backup_status;
              let nextOwnership = g.ownership_status;
              let nextCase = g.has_case;
              let nextManual = g.has_manual;

              if (setIdSet.has(g.id)) {
                nextBackup = 1;
                changed = true;
              } else if (clearIdSet.has(g.id)) {
                nextBackup = 0;
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
                nextBackup = 1;
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
                  let rBackup = r.backup_status;
                  let rOwn = r.ownership_status;
                  let rCase = r.has_case;
                  let rManual = r.has_manual;
                  let rMod = false;

                  if (setIdSet.has(r.id)) {
                    rBackup = 1;
                    rMod = true;
                  } else if (clearIdSet.has(r.id)) {
                    rBackup = 0;
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
                    rBackup = 1;
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
                    backup_status: rBackup,
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

              let nextDiscBackups = g.discBackups;
              if (g.discIds && g.discBackups && g.discIds.length > 1) {
                let discChanged = false;
                const mappedDiscBackups = g.discIds.map((did, idx) => {
                  if (setIdSet.has(did)) {
                    discChanged = true;
                    return 1;
                  }
                  if (clearIdSet.has(did)) {
                    discChanged = true;
                    return 0;
                  }
                  return g.discBackups?.[idx] ?? 0;
                });
                if (discChanged) {
                  nextDiscBackups = mappedDiscBackups;
                  nextBackup = mappedDiscBackups.every((b) => b === 1) ? 1 : 0;
                  changed = true;
                }
              }

              if (!changed) return g;
              return {
                ...g,
                backup_status: nextBackup,
                ownership_status: nextOwnership,
                has_case: nextCase,
                has_manual: nextManual,
                releases: nextReleases,
                discBackups: nextDiscBackups,
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
   * If the user is not authenticated, redirects to /api/auth/login.
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
  private enrichGameTitle(rawGame: Game): Game {
    const game = rawGame;
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
