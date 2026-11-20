import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import {
  clearCachedKitAuthSnapshot,
  clearSilentSsoAttempt,
  writeCachedKitAuthSnapshot,
} from '@wesdizzle/app-kit/angular';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    clearSilentSsoAttempt();
    clearCachedKitAuthSnapshot();
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(AuthSessionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    clearCachedKitAuthSnapshot();
    clearSilentSsoAttempt();
  });

  it('loads and deduplicates /api/auth/me calls via ensureAuthLoaded', async () => {
    const p1 = service.ensureAuthLoaded();
    const p2 = service.ensureAuthLoaded();

    const req = httpMock.expectOne('/api/auth/me');
    req.flush({
      authenticated: true,
      user: {
        id: 7,
        email: 'admin@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
      },
    });

    const [u1, u2] = await Promise.all([p1, p2]);
    expect(u1?.username).toBe('alice');
    expect(u2?.username).toBe('alice');
    expect(service.authInitialized()).toBe(true);
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isAdmin()).toBe(true);
  });

  it('falls back to offline cached profile on 5xx error and clears on 401', async () => {
    writeCachedKitAuthSnapshot({
      user: {
        id: 2,
        email: 'user@example.com',
        username: 'bob',
        role: 'user',
        isPublic: false,
      },
      accountHubUrl: null,
      oidcIssuer: null,
      oidcClientId: null,
      updatedAt: Date.now(),
    });

    const pOffline = service.refreshAuthStatus();
    const reqOffline = httpMock.expectOne('/api/auth/me');
    reqOffline.flush('Down', { status: 503, statusText: 'Unavailable' });

    const offlineUser = await pOffline;
    expect(offlineUser?.username).toBe('bob');
    expect(service.authDegradedMode()).toBe('offline');

    const pUnauth = service.refreshAuthStatus();
    const reqUnauth = httpMock.expectOne('/api/auth/me');
    reqUnauth.flush('Unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
    });

    const unauthUser = await pUnauth;
    expect(unauthUser).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.authDegradedMode()).toBeNull();
  });

  it('tracks public view profile and invokes hooks on state transitions', () => {
    const onPublicViewChanged = vi.fn();
    service.registerHooks({ onPublicViewChanged });

    service.setPublicView(true, {
      username: 'alice',
      displayName: 'Alice',
      bio: 'Collector',
      homeRegion: 'USA',
    });
    expect(service.isPublicView()).toBe(true);
    expect(service.publicProfile()?.username).toBe('alice');
    expect(onPublicViewChanged).toHaveBeenCalledWith(true);

    service.exitPublicView();
    expect(service.isPublicView()).toBe(false);
    expect(service.publicProfile()).toBeNull();
    expect(onPublicViewChanged).toHaveBeenLastCalledWith(true);
  });

  it('uses redirectTo hook during silent auto sign-in when upstream session is active', async () => {
    const redirectTo = vi.fn();
    service.registerHooks({ redirectTo });
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          authorized: true,
          user: { id: 1, username: 'alice', role: 'admin' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const redirected = await service.trySilentAutoSignIn(
        'https://auth.example.com',
        'client-1',
      );
      expect(redirected).toBe(true);
      expect(service.isAutoSigningIn()).toBe(true);
      expect(redirectTo).toHaveBeenCalledWith(
        '/api/auth/login?return_to=%2Fcollection%2Fgames&prompt=none',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('computes trackIndividualMedia and canTrackIndividualMedia gated by auth and public view', () => {
    expect(service.trackIndividualMedia()).toBe(false);
    expect(service.canTrackIndividualMedia()).toBe(false);

    service._currentUser.set({
      id: 1,
      username: 'alice',
      role: 'user',
      isPublic: false,
      homeRegion: 'USA',
      displayName: null,
      bio: null,
      trackIndividualMedia: false,
    });
    expect(service.trackIndividualMedia()).toBe(false);
    expect(service.canTrackIndividualMedia()).toBe(false);

    service._currentUser.set({
      id: 1,
      username: 'alice',
      role: 'user',
      isPublic: true,
      homeRegion: 'USA',
      displayName: null,
      bio: null,
      trackIndividualMedia: true,
    });
    expect(service.trackIndividualMedia()).toBe(true);
    expect(service.canTrackIndividualMedia()).toBe(true);

    service.setPublicView(true, {
      username: 'alice',
      displayName: 'Alice',
      bio: null,
      homeRegion: 'USA',
    });
    expect(service.trackIndividualMedia()).toBe(true);
    expect(service.canTrackIndividualMedia()).toBe(false);
  });
});
