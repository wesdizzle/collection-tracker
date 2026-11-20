import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  KitDegradedMode,
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
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';
import {
  AuthMeResponse,
  PublicUserProfile,
  UserProfile,
} from '../models/collection.models';

export interface AuthSessionAuthenticatedEvent {
  user: UserProfile;
  wasAuthenticated: boolean;
  isDegraded: boolean;
  degradedReason?: string | null;
}

export interface AuthSessionHooks {
  isDataDegraded?: () => boolean;
  getLastUpdated?: () => Date | null;
  onAuthenticated?: (
    event: AuthSessionAuthenticatedEvent,
  ) => void | Promise<void>;
  onUnauthenticated?: (wasAuthenticated: boolean) => void;
  onPublicViewChanged?: (changed: boolean) => void;
  redirectTo?: (url: string) => void;
  getRouterUrl?: () => string;
  navigateHome?: () => void;
}

@Injectable({
  providedIn: 'root',
})
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly _currentUser = signal<UserProfile | null>(null);
  public readonly currentUser = this._currentUser.asReadonly();

  readonly _oidcIssuer = signal<string | null>(null);
  public readonly oidcIssuer = this._oidcIssuer.asReadonly();

  readonly _oidcClientId = signal<string | null>(null);
  public readonly oidcClientId = this._oidcClientId.asReadonly();

  readonly _accountHubUrl = signal<string | null>(null);
  public readonly accountHubUrl = this._accountHubUrl.asReadonly();

  readonly _isAutoSigningIn = signal<boolean>(false);
  public readonly isAutoSigningIn = this._isAutoSigningIn.asReadonly();

  readonly _authInitialized = signal<boolean>(false);
  public readonly authInitialized = this._authInitialized.asReadonly();

  readonly _authDegradedMode = signal<KitDegradedMode>(null);
  public readonly authDegradedMode = this._authDegradedMode.asReadonly();

  readonly _degradedTimestamp = signal<string | Date | null>(null);
  public readonly degradedTimestamp = this._degradedTimestamp.asReadonly();

  readonly _isPublicView = signal<boolean>(false);
  public readonly isPublicView = this._isPublicView.asReadonly();

  readonly _publicProfile = signal<PublicUserProfile | null>(null);
  public readonly publicProfile = this._publicProfile.asReadonly();

  public readonly isAuthenticated = computed(
    () => this._currentUser() !== null,
  );
  public readonly isAdmin = computed(
    () => this._currentUser()?.role === 'admin',
  );
  public readonly homeRegion = computed(
    () => this._currentUser()?.homeRegion || 'USA',
  );
  public readonly canShowPersonalState = computed(
    () => this.isAuthenticated() && !this._isPublicView(),
  );
  public readonly trackIndividualMedia = computed(() =>
    Boolean(this._currentUser()?.trackIndividualMedia),
  );
  public readonly canTrackIndividualMedia = computed(
    () => this.canShowPersonalState() && this.trackIndividualMedia(),
  );

  private _authPromise: Promise<UserProfile | null> | null = null;
  private _lastAuthCheckMs = 0;
  private hooks: AuthSessionHooks | null = null;

  public registerHooks(hooks: AuthSessionHooks): void {
    this.hooks = hooks;
  }

  public getLastAuthCheckMs(): number {
    return this._lastAuthCheckMs;
  }

  private isAnyDegraded(): boolean {
    return (
      this._authDegradedMode() !== null ||
      Boolean(this.hooks?.isDataDegraded?.())
    );
  }

  private performRedirect(url: string): void {
    if (this.hooks?.redirectTo) {
      this.hooks.redirectTo(url);
      return;
    }
    this.redirectTo(url);
  }

  protected redirectTo(url: string): void {
    if (typeof window !== 'undefined' && window.location) {
      window.location.assign(url);
    }
  }

  private handleUnauthenticatedState(wasAuthenticated: boolean): void {
    clearCachedKitAuthSnapshot();
    this._authDegradedMode.set(null);
    this._degradedTimestamp.set(null);
    notifyActiveThemeService({
      issuerUrl: null,
      authenticated: false,
    });
    this.hooks?.onUnauthenticated?.(wasAuthenticated);
    this._currentUser.set(null);
    if (!this._isPublicView()) {
      const rawUrl = this.hooks?.getRouterUrl
        ? this.hooks.getRouterUrl()
        : this.router.url || '';
      const routerPath = rawUrl.split('?')[0].split('#')[0];
      const windowPath =
        typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : '';
      const currentPath =
        routerPath && routerPath !== '/' ? routerPath : windowPath;
      if (
        currentPath === '/collection' ||
        currentPath.startsWith('/collection/') ||
        currentPath === '/admin' ||
        currentPath.startsWith('/admin/') ||
        currentPath === '/profile' ||
        currentPath.startsWith('/profile/')
      ) {
        if (this.hooks?.navigateHome) {
          this.hooks.navigateHome();
        } else {
          void this.router.navigateByUrl('/');
        }
      }
    }
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
      } else {
        this._authDegradedMode.set(null);
        if (!this.hooks?.isDataDegraded?.()) {
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
      await this.hooks?.onAuthenticated?.({
        user: effectiveUser,
        wasAuthenticated,
        isDegraded: isDegradedResponse,
        degradedReason: res.degradedReason,
      });
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
      this.performRedirect(
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
      this.performRedirect(
        `/api/auth/login?return_to=${encodeURIComponent(targetReturn)}&prompt=none`,
      );
      return true;
    }

    return false;
  }

  public async verifyUpstreamOidcSession(oidcIssuer: string): Promise<boolean> {
    if (typeof fetch !== 'function' || !oidcIssuer || this.isAnyDegraded()) {
      return true;
    }
    const status = await checkUpstreamOidcStatus(
      oidcIssuer,
      this._oidcClientId(),
    );
    if (!status.reachable || status.degraded || this.isAnyDegraded()) {
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
        this.performRedirect(
          `/api/auth/login?return_to=${encodeURIComponent(returnTo)}&prompt=none`,
        );
        return false;
      }
    }
    return true;
  }

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
                    : (this.hooks?.getLastUpdated?.()?.toISOString() ?? null),
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

  public ensureAuthLoaded(): Promise<UserProfile | null> {
    if (this._authInitialized()) {
      return Promise.resolve(this._currentUser());
    }
    if (this._authPromise) {
      return this._authPromise;
    }
    return this.refreshAuthStatus();
  }

  public getPublicUser(username: string): Observable<PublicUserProfile> {
    return this.http.get<PublicUserProfile>(
      `/api/u/${encodeURIComponent(username)}`,
    );
  }

  public setPublicView(
    enabled: boolean,
    profile?: PublicUserProfile | null,
  ): void {
    const prevUsername = this._publicProfile()?.username || null;
    const nextUsername = profile?.username || null;
    const changed =
      enabled !== this._isPublicView() || prevUsername !== nextUsername;
    this.hooks?.onPublicViewChanged?.(changed);
    this._isPublicView.set(enabled);
    this._publicProfile.set(profile || null);
  }

  public exitPublicView(): void {
    this.setPublicView(false, null);
  }
}
