import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { CollectionService } from './collection.service';
import {
  EBAY_PRICE_TTL_MS,
  EphemeralMarketPrice,
  Game,
  formatJournalDate,
  getPriceShardIndex,
} from '../models/collection.models';
import {
  KIT_DEGRADED_HEADER,
  KIT_SNAPSHOT_TIMESTAMP_HEADER,
  clearCachedKitAuthSnapshot,
  clearSilentSsoAttempt,
  readCachedKitAuthSnapshot,
  writeCachedKitAuthSnapshot,
} from '@wesdizzle/app-kit/angular';
import { Router } from '@angular/router';

/**
 * UNIT TEST: CollectionService
 *
 * Verifies the core data-fetching logic and signal-based state management
 * for the game and toy collection.
 * Updated for Angular 21 and Vitest.
 */
describe('CollectionService', () => {
  let service: CollectionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    clearSilentSsoAttempt();
    clearCachedKitAuthSnapshot();
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        CollectionService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(CollectionService);
    httpMock = TestBed.inject(HttpTestingController);

    const authReqs = httpMock.match(
      (r) => r.url === '/api/auth/me' || r.url === '/api/admin/me',
    );
    authReqs.forEach((r) =>
      r.flush({ authenticated: false, authorized: false, user: null }),
    );
  });

  afterEach(() => {
    clearCachedKitAuthSnapshot();
    sessionStorage.clear();
    localStorage.clear();
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Deletion', () => {
    beforeEach(() => {
      service.setAdminForTesting(true);
    });

    it('deleteGame issues DELETE and removes the game from local state', () => {
      (
        service as unknown as {
          _games: { set(v: Partial<Game>[]): void };
        }
      )._games.set([
        { id: 'rel-a', game_id: 'g1' },
        { id: 'rel-b', game_id: 'g1' },
        { id: 'other', game_id: 'g2' },
      ]);

      let result: { success: boolean } | undefined;
      service.deleteGame('g1').subscribe((r) => (result = r));

      const req = httpMock.expectOne('/api/collection/game?id=g1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });

      expect(result?.success).toBe(true);
      expect(service.games().map((g) => g.id)).toEqual(['other']);
    });

    it('deleteRelease issues DELETE for the release id', () => {
      let result: { success: boolean } | undefined;
      service.deleteRelease('rel a/1').subscribe((r) => (result = r));

      const req = httpMock.expectOne('/api/collection/release?id=rel%20a%2F1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
      expect(result?.success).toBe(true);
    });
  });

  it('should fetch games list using relative path', () => {
    const mockGames = [{ stable_id: 1, title: 'Super Mario' }];

    service.getGames().subscribe((games) => {
      expect(games.length).toBe(1);
      expect(games[0].title).toBe('Super Mario');
    });

    // Production code uses relative root paths
    const req = httpMock.expectOne('/api/games');
    expect(req.request.method).toBe('GET');
    req.flush(mockGames);
  });

  it('should fetch toys list using relative path', () => {
    const mockToys = [{ id: 1, name: 'Mario Amiibo' }];

    service.getToys().subscribe((toys) => {
      expect(toys.length).toBe(1);
      expect(toys[0].name).toBe('Mario Amiibo');
    });

    const req = httpMock.expectOne('/api/toys');
    expect(req.request.method).toBe('GET');
    req.flush(mockToys);
  });

  describe('List State Persistence', () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    it('should update and persist list state', () => {
      const mockState = {
        tab: 'games' as const,
        filters: { ownership: 1 as const },
        displayLimit: 200,
        scrollX: 0,
        scrollY: 500,
      };

      service.updateListState(mockState);
      expect(service.gamesState()).toEqual(mockState);

      const saved = sessionStorage.getItem('app_list_state_games');
      expect(saved).toBeTruthy();
      expect(JSON.parse(saved!)).toEqual(mockState);
    });

    it('should load persisted state from sessionStorage', () => {
      const mockState = {
        tab: 'toys' as const,
        filters: { ownership: 'wanted' as const },
        displayLimit: 300,
        scrollX: 0,
        scrollY: 1000,
      };

      sessionStorage.setItem('app_list_state_toys', JSON.stringify(mockState));
      service.loadPersistedState();

      expect(service.toysState()).toEqual(mockState);
    });

    it('should persist viewMode and restore from localStorage if absent in session', () => {
      const mockState = {
        tab: 'games' as const,
        filters: { ownership: 1 as const },
        displayLimit: 200,
        viewMode: 'compact' as const,
        scrollX: 0,
        scrollY: 500,
      };

      service.updateListState(mockState);
      expect(localStorage.getItem('app_preferred_view_mode')).toBe('compact');

      // Clear service in-memory state and load again
      sessionStorage.clear();
      const stateWithoutViewMode = {
        tab: 'games' as const,
        filters: { ownership: 1 as const },
        displayLimit: 200,
        scrollX: 0,
        scrollY: 0,
      };
      sessionStorage.setItem(
        'app_list_state_games',
        JSON.stringify(stateWithoutViewMode),
      );

      service.loadPersistedState();
      expect(service.gamesState()?.viewMode).toBe('compact');
    });

    it('should handle malformed JSON in sessionStorage', () => {
      sessionStorage.setItem('app_list_state_games', 'invalid-json');
      // Should not throw
      service.loadPersistedState();
      expect(service.gamesState()).toBeNull();
    });
  });

  describe('Game Title Enrichment', () => {
    it('should preserve canonical database title and not overwrite with DAT ROM naming discrepancies', () => {
      const mockGames = [
        {
          stable_id: 1,
          title: "Marvel's Spider-Man",
          rom_name: 'Marvel Spider-Man (USA, Brazil) (En,Fr,Es,Pt).iso',
        },
        {
          stable_id: 2,
          title: "Marvel's Iron Man VR",
          rom_name: 'Marvel Iron Man VR (USA).iso',
        },
        {
          stable_id: 3,
          title: 'Spider-Man: Edge of Time',
          rom_name: '13B1B679\\TU_10LC25I_0000008000000.0000000000082',
        },
        {
          stable_id: 4,
          title: 'Pokemon Colosseum',
          rom_name: 'Pokemon Colosseum (USA) (Bonus Disc).gcm',
        },
        {
          stable_id: 5,
          title: 'Legend of Zelda, The',
          rom_name: 'Legend of Zelda, The (USA) (Rev A).nes',
        },
        {
          stable_id: 6,
          title: 'Final Fantasy VII',
          rom_name: 'Final Fantasy VII (USA) (Disc 1).cue',
        },
        { stable_id: 7, title: 'Metroid', rom_name: undefined },
      ];

      service.getGames().subscribe((games) => {
        expect(games.length).toBe(7);
        expect(games[0].title).toBe("Marvel's Spider-Man");
        expect(games[1].title).toBe("Marvel's Iron Man VR");
        expect(games[2].title).toBe('Spider-Man: Edge of Time');
        expect(games[3].title).toBe('Pokemon Colosseum (Bonus Disc)');
        expect(games[4].title).toBe('The Legend of Zelda');
        expect(games[5].title).toBe('Final Fantasy VII');
        expect(games[6].title).toBe('Metroid');
      });

      const req = httpMock.expectOne('/api/games');
      req.flush(mockGames);
    });

    it('should enrich single game by ID while preserving canonical title', () => {
      const mockGame = {
        stable_id: 1,
        title: "Marvel's Spider-Man",
        rom_name: 'Marvel Spider-Man (USA) (Disc 1).iso',
      };

      service.getGameById('1').subscribe((game) => {
        expect(game.title).toBe("Marvel's Spider-Man");
      });

      const req = httpMock.expectOne('/api/games/1');
      req.flush(mockGame);
    });

    it('should fall back to in-memory game if API request fails', () => {
      const mockGame: Game = {
        stable_id: 1,
        id: 'game-1',
        title: "Marvel's Spider-Man",
        rom_name: 'Marvel Spider-Man (USA) (Disc 1).iso',
        series: 'Spider-Man',
        canonical_series: 'Spider-Man',
        platform_id: 29,
        platform: 'PlayStation',
        display_name: 'PlayStation',
        brand: 'Sony',
        platform_launch_date: '1995-09-09',
        platform_logo: 'ps.png',
        release_date: '2018-09-07',
        ownership_status: 1,
        has_media: 1,
        play_status: 0,
        sort_index: 1,
        image_url: 'spiderman.jpg',
        igdb_id: 1234,
        igdb_url: 'https://igdb.com/spiderman',
        summary: 'Action adventure game',
        genres: 'Action',
        collections: 'Marvel',
        franchises: 'Spider-Man',
      };

      const internalService = service as unknown as {
        _games: { set: (games: Game[]) => void };
      };
      internalService._games.set([mockGame]);

      let receivedGame: Game | undefined;
      service.getGameById('game-1').subscribe((game) => {
        receivedGame = game;
      });

      const req = httpMock.expectOne('/api/games/game-1');
      req.flush('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = receivedGame as unknown as Game;
      expect(result).toBeDefined();
      expect(result.id).toBe('game-1');
      expect(result.title).toBe("Marvel's Spider-Man");
      expect(result.releases).toBeDefined();
      expect(result.releases?.length).toBe(1);
    });

    it('should throw error if API fails and game is not in memory', () => {
      const internalService = service as unknown as {
        _games: { set: (games: Game[]) => void };
      };
      internalService._games.set([]);

      let hasError = false;
      service.getGameById('missing-game').subscribe({
        next: () => {},
        error: () => {
          hasError = true;
        },
      });

      const req = httpMock.expectOne('/api/games/missing-game');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });

      expect(hasError).toBe(true);
    });
  });

  describe('Collection Journal & Provenance', () => {
    it('formats exact and approximate acquisition dates using "Around"', () => {
      expect(formatJournalDate(null)).toBe('Unrecorded');
      expect(formatJournalDate('2013')).toBe('Around 2013');
      expect(formatJournalDate('~2013')).toBe('Around 2013');
      expect(formatJournalDate('2009-06')).toBe('Around June 2009');
      expect(formatJournalDate('~2009-06')).toBe('Around June 2009');
      expect(formatJournalDate('2021-02-10', 0)).toBe('Feb 10, 2021');
      expect(formatJournalDate('2021-02-10', 1)).toBe('Around Feb 10, 2021');
    });

    it('reflects journal visibility based on authentication status', () => {
      service.setAdminForTesting(false);
      expect(service.journalRevealed()).toBe(false);

      service.setAdminForTesting(true);
      expect(service.journalRevealed()).toBe(true);
    });

    it('fetches, saves, and deletes journal entries and updates in-memory map', () => {
      service.setAdminForTesting(true);
      const mockEntry = {
        id: 1,
        item_type: 'game' as const,
        item_id: 'combat-atari-2600',
        purchase_date: '2019-02-18',
        is_approximate_date: 0,
        price_paid: 4.1,
        merchant: 'eBay',
        gifted_by: null,
        receipt_url: 'https://mail.google.com/mail/u/0/#all/16867f8a6f04196d',
        notes: 'Purchased standalone for $4.10',
      };

      service.getJournalEntry('game', 'combat-atari-2600').subscribe((res) => {
        expect(res.authorized).toBe(true);
        expect(res.entry).toEqual(mockEntry);
      });

      const getReq = httpMock.expectOne(
        '/api/journal?item_type=game&item_id=combat-atari-2600',
      );
      expect(getReq.request.method).toBe('GET');
      getReq.flush({ authorized: true, entry: mockEntry });

      expect(service.journalEntriesMap().get('game:combat-atari-2600')).toEqual(
        mockEntry,
      );

      // Save updated entry
      const updatedEntry = { ...mockEntry, price_paid: 5.0 };
      service
        .saveJournalEntry({
          item_type: 'game',
          item_id: 'combat-atari-2600',
          price_paid: 5.0,
        })
        .subscribe((res) => {
          expect(res.success).toBe(true);
          expect(res.entry?.price_paid).toBe(5.0);
        });

      const postReq = httpMock.expectOne('/api/journal');
      expect(postReq.request.method).toBe('POST');
      postReq.flush({ success: true, entry: updatedEntry });

      expect(
        service.journalEntriesMap().get('game:combat-atari-2600')?.price_paid,
      ).toBe(5.0);

      // Delete entry
      service
        .deleteJournalEntry('game', 'combat-atari-2600')
        .subscribe((res) => {
          expect(res.success).toBe(true);
        });

      const delReq = httpMock.expectOne(
        '/api/journal?item_type=game&item_id=combat-atari-2600',
      );
      expect(delReq.request.method).toBe('DELETE');
      delReq.flush({ success: true });

      expect(service.journalEntriesMap().has('game:combat-atari-2600')).toBe(
        false,
      );
    });

    it('rejects mutation methods when not authorized admin and prompts login', () => {
      service.setAdminForTesting(false);
      const promptSpy = vi
        .spyOn(service, 'promptAdminLogin')
        .mockImplementation(() => {});

      let errResult: unknown;
      service.toggleOwnership('g1', 'game', 1).subscribe({
        error: (err) => (errResult = err),
      });
      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(errResult).toBeTruthy();

      service.updateMediaOwned('g1', 1).subscribe({
        error: (err) => (errResult = err),
      });
      expect(promptSpy).toHaveBeenCalledTimes(2);

      service.updateHasCase('g1', 1).subscribe({
        error: (err) => (errResult = err),
      });
      expect(promptSpy).toHaveBeenCalledTimes(3);

      service.updateHasManual('g1', 1).subscribe({
        error: (err) => (errResult = err),
      });
      expect(promptSpy).toHaveBeenCalledTimes(4);

      service.saveJournalEntry({ item_type: 'game', item_id: 'g1' }).subscribe({
        error: (err) => (errResult = err),
      });
      expect(promptSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe('Optimistic Updates, Error Preservation & SW Cache Purge', () => {
    it('preserves existing games and sets error signal when getGames fails', async () => {
      const p1 = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush([{ stable_id: 1, id: 'g1', title: 'Initial Game' }]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await p1;
      expect(service.games().length).toBe(1);
      expect(service.error()).toBeNull();

      let fallbackGames: Game[] = [];
      service.getGames().subscribe((g) => (fallbackGames = g));
      httpMock.expectOne('/api/games').flush('Gateway Timeout', {
        status: 504,
        statusText: 'Gateway Timeout',
      });

      expect(fallbackGames.length).toBe(1);
      expect(fallbackGames[0].title).toBe('Initial Game');
      expect(service.error()).toContain('504 Gateway Timeout');
    });

    it('immutably patches games, toys, and disc media ownership for OnPush consumers', async () => {
      const p1 = service.refreshAll();
      httpMock.expectOne('/api/games').flush([
        {
          stable_id: 1,
          id: 'g1',
          title: 'Final Fantasy VII',
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
          releases: [{ id: 'g1-d1', region: 'USA', has_media: 0 }],
          discIds: ['g1-d1'],
          discMediaOwned: [0],
        },
      ]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await p1;

      const beforeGame = service.games()[0];
      service.patchGameOptimistic('g1', { ownership_status: 1 });
      const afterGame = service.games()[0];
      expect(afterGame).not.toBe(beforeGame);
      expect(afterGame.ownership_status).toBe(1);

      service.patchDiscMediaOptimistic('g1-d1', 1);
      const afterDiscGame = service.games()[0];
      expect(afterDiscGame).not.toBe(afterGame);
      expect(afterDiscGame.releases?.[0].has_media).toBe(1);
      expect(afterDiscGame.discMediaOwned?.[0]).toBe(1);
      expect(afterDiscGame.has_media).toBe(1);
    });

    it('gates applyOwnershipVerificationDiff to admins and posts setMediaOwned/clearMediaOwned to /api/admin/verify-ownership/apply', async () => {
      service.setCurrentUserForTesting({
        id: 2,
        email: 'user@example.com',
        username: 'bob',
        role: 'user',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Bob',
        bio: null,
      });

      const p1 = service.refreshAll();
      httpMock.expectOne('/api/games').flush([
        {
          stable_id: 1,
          id: 'g1',
          title: 'Chrono Cross',
          ownership_status: 1,
          play_status: 0,
          has_media: 0,
          releases: [{ id: 'g1', region: 'USA', has_media: 0 }],
        },
      ]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await p1;

      let nonAdminErr: unknown;
      service
        .applyOwnershipVerificationDiff({
          setMediaOwned: ['g1'],
          clearMediaOwned: [],
        })
        .subscribe({ error: (err) => (nonAdminErr = err) });
      expect(nonAdminErr).toBeTruthy();

      service.setCurrentUserForTesting({
        id: 1,
        email: 'admin@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });

      let result:
        | {
            success: boolean;
            setCount: number;
            clearCount: number;
            transferredCount: number;
          }
        | undefined;
      service
        .applyOwnershipVerificationDiff({
          setMediaOwned: ['g1'],
          clearMediaOwned: [],
        })
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne('/api/admin/verify-ownership/apply');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        setMediaOwned: ['g1'],
        clearMediaOwned: [],
        ownershipTransfers: [],
      });
      req.flush({
        success: true,
        setCount: 1,
        clearCount: 0,
        transferredCount: 0,
        declaredOwnedCount: 0,
      });

      expect(result?.success).toBe(true);
      expect(service.games()[0].has_media).toBe(1);
    });

    it('tracks owner context across refreshAll and clears SW data caches on signOut', async () => {
      expect(service.isLoadedForCurrentContext()).toBe(false);

      const refreshPromise = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush([{ stable_id: 1, id: 'g1', title: 'Mario' }]);
      httpMock
        .expectOne('/api/toys')
        .flush([{ id: 't1', name: 'Mario Amiibo' }]);
      httpMock.expectOne('/api/platforms').flush([{ id: 1, name: 'NES' }]);
      await refreshPromise;

      expect(service.isLoadedForCurrentContext()).toBe(true);
      service.setPublicView(true, {
        username: 'alice',
        displayName: 'Alice',
        bio: null,
        homeRegion: 'USA',
      });
      expect(service.isLoadedForCurrentContext()).toBe(false);

      const deleteMock = vi.fn().mockResolvedValue(true);
      Object.defineProperty(window, 'caches', {
        value: {
          keys: vi
            .fn()
            .mockResolvedValue([
              'ngsw:1:data:dynamic:api-collection:cache',
              'ngsw:1:assets:app:cache',
            ]),
          delete: deleteMock,
        },
        configurable: true,
        writable: true,
      });

      await service.clearServiceWorkerDataCaches();
      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledWith(
        'ngsw:1:data:dynamic:api-collection:cache',
      );
    });

    it('clears currentUser and calls silent logout when upstream OIDC session is signed out', async () => {
      service.setCurrentUserForTesting({
        id: 1,
        email: 'admin@example.com',
        username: 'collector',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Collector',
        bio: null,
      });
      expect(service.isAuthenticated()).toBe(true);

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url === 'https://auth.example.com/api/auth/status') {
            return new Response(JSON.stringify({ authenticated: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url === '/api/auth/logout?silent=1') {
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(null, { status: 404 });
        });

      try {
        const active = await service.verifyUpstreamOidcSession(
          'https://auth.example.com',
        );
        expect(active).toBe(false);
        expect(service.isAuthenticated()).toBe(false);
        expect(service.currentUser()).toBeNull();
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://auth.example.com/api/auth/status',
          expect.objectContaining({
            method: 'GET',
            credentials: 'include',
          }),
        );
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/auth/logout?silent=1',
          expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
          }),
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('returns false when upstream OIDC session reports a changed username', async () => {
      service.setCurrentUserForTesting({
        id: 1,
        username: 'old_handle',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Collector',
        bio: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: 1, username: 'new_handle', role: 'admin' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        const inSync = await service.verifyUpstreamOidcSession(
          'https://auth.example.com',
        );
        expect(inSync).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('hydrates KitThemeService from upstream OIDC /api/auth/status preferences', async () => {
      const themeService = TestBed.inject(
        (await import('@wesdizzle/app-kit/angular')).KitThemeService,
      );
      themeService.init('collection-theme', [], 'light');
      expect(themeService.theme()).toBe('light');

      service.setCurrentUserForTesting({
        id: 1,
        username: 'collector',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Collector',
        bio: null,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: true,
            authorized: true,
            user: {
              id: 1,
              username: 'collector',
              role: 'admin',
              preferences: { theme: 'dark' },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        const active = await service.verifyUpstreamOidcSession(
          'https://auth.example.com',
        );
        expect(active).toBe(true);
        expect(themeService.theme()).toBe('dark');
        expect(localStorage.getItem('collection-theme')).toBe('dark');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('redirects protected /collection/* routes to / when session becomes unauthenticated', async () => {
      service.setCurrentUserForTesting({
        id: 1,
        username: 'collector',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Collector',
        bio: null,
      });

      const routerInstance = (
        service as unknown as {
          router: {
            url: string;
            navigateByUrl: (url: string) => Promise<boolean>;
          };
        }
      ).router;
      vi.spyOn(routerInstance, 'url', 'get').mockReturnValue(
        '/collection/games',
      );
      const navSpy = vi
        .spyOn(routerInstance, 'navigateByUrl')
        .mockResolvedValue(true);

      const p = service.refreshAuthStatus();
      const req = httpMock.expectOne('/api/auth/me');
      req.flush({ authenticated: false, user: null });

      const user = await p;
      expect(user).toBeNull();
      expect(service.isAuthenticated()).toBe(false);
      expect(navSpy).toHaveBeenCalledWith('/');
    });

    it('signOut clears session cookie via POST fetch before redirecting to landing or IdP logout', async () => {
      service.setCurrentUserForTesting({
        id: 1,
        username: 'collector',
        role: 'admin',
        isPublic: true,
        homeRegion: 'USA',
        displayName: 'Collector',
        bio: null,
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      const redirectSpy = vi
        .spyOn(
          service as unknown as { redirectTo: (url: string) => void },
          'redirectTo',
        )
        .mockImplementation(() => {});
      const createElementSpy = vi.spyOn(document, 'createElement');

      try {
        await service.signOut();
        expect(service.isAuthenticated()).toBe(false);
        expect(service.currentUser()).toBeNull();
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/auth/logout?silent=1',
          expect.objectContaining({
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
          }),
        );
        expect(redirectSpy).toHaveBeenCalledWith('/');
        expect(createElementSpy).not.toHaveBeenCalledWith('form');
      } finally {
        fetchSpy.mockRestore();
        redirectSpy.mockRestore();
        createElementSpy.mockRestore();
      }
    });

    it('automatically initiates OIDC login when unauthenticated locally but authorized on Account Hub', async () => {
      const redirectSpy = vi
        .spyOn(
          service as unknown as { redirectTo: (url: string) => void },
          'redirectTo',
        )
        .mockImplementation(() => {});

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: true,
            authorized: true,
            user: { id: 1, username: 'collector', role: 'admin' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        const p = service.refreshAuthStatus();
        const req = httpMock.expectOne('/api/auth/me');
        req.flush({
          authenticated: false,
          user: null,
          oidcIssuer: 'https://auth.example.com',
          oidcClientId: 'collection-tracker',
        });

        await p;
        expect(service.isAutoSigningIn()).toBe(true);
        expect(redirectSpy).toHaveBeenCalledWith(
          '/api/auth/login?return_to=%2Fcollection%2Fgames&prompt=none',
        );
      } finally {
        fetchSpy.mockRestore();
        redirectSpy.mockRestore();
      }
    });

    it('does not auto-redirect when authenticated on Account Hub but unauthorized for this client', async () => {
      const redirectSpy = vi
        .spyOn(
          service as unknown as { redirectTo: (url: string) => void },
          'redirectTo',
        )
        .mockImplementation(() => {});

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: true,
            authorized: false,
            user: { id: 2, username: 'other', role: 'user' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        const p = service.refreshAuthStatus();
        const req = httpMock.expectOne('/api/auth/me');
        req.flush({
          authenticated: false,
          user: null,
          oidcIssuer: 'https://auth.example.com',
          oidcClientId: 'collection-tracker',
        });

        await p;
        expect(service.isAutoSigningIn()).toBe(false);
        expect(redirectSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        redirectSpy.mockRestore();
      }
    });

    it('falls back to top-level prompt=none OIDC redirect when cross-origin cookie is blocked in background fetch', async () => {
      const redirectSpy = vi
        .spyOn(
          service as unknown as { redirectTo: (url: string) => void },
          'redirectTo',
        )
        .mockImplementation(() => {});

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: false,
            authorized: false,
            cookiePresent: false,
            user: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      try {
        const p = service.refreshAuthStatus();
        const req = httpMock.expectOne('/api/auth/me');
        req.flush({
          authenticated: false,
          user: null,
          oidcIssuer: 'https://auth.example.com',
          oidcClientId: 'collection-tracker',
        });

        await p;
        expect(service.isAutoSigningIn()).toBe(true);
        expect(redirectSpy).toHaveBeenCalledWith(
          '/api/auth/login?return_to=%2Fcollection%2Fgames&prompt=none',
        );
      } finally {
        fetchSpy.mockRestore();
        redirectSpy.mockRestore();
      }
    });
  });

  describe('Offline & R2 Degraded Quota Resilience', () => {
    it('retains authenticated session and offline store data on /api/auth/me 503 without wiping state or redirecting', async () => {
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      const getStoredSpy = vi
        .spyOn(
          (
            service as unknown as {
              offlineStore: {
                getStoredState: (userId?: number | null) => Promise<unknown>;
                saveStateLocally: (...args: unknown[]) => Promise<void>;
              };
            }
          ).offlineStore,
          'getStoredState',
        )
        .mockResolvedValue({
          state: {
            games: [
              { id: 'g1', game_id: 'g1', stable_id: 1, title: 'Offline Mario' },
            ],
            toys: [],
            platforms: [{ id: 1, name: 'NES', display_name: 'NES' }],
            journalEntries: [],
          },
          updatedAt: Date.now() - 60_000,
          pendingSync: false,
        });
      const saveStoredSpy = vi
        .spyOn(
          (
            service as unknown as {
              offlineStore: {
                saveStateLocally: (...args: unknown[]) => Promise<void>;
              };
            }
          ).offlineStore,
          'saveStateLocally',
        )
        .mockResolvedValue(undefined);

      // 1. Live non-degraded auth caches profile snapshot in localStorage
      const p1 = service.refreshAuthStatus();
      httpMock.expectOne('/api/auth/me').flush({
        authenticated: true,
        user: {
          id: 1,
          username: 'alice',
          role: 'admin',
          isPublic: true,
          homeRegion: 'USA',
          displayName: 'Alice',
          bio: 'Collector',
        },
      });
      await p1;
      httpMock
        .expectOne('/api/journal/entries')
        .flush({ authorized: true, entries: [] });
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );
      expect(service.isAuthenticated()).toBe(true);
      expect(readCachedKitAuthSnapshot()?.user.username).toBe('alice');

      // 2. Refresh collection and save offline store snapshot
      const refreshP = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush([
          { id: 'g1', game_id: 'g1', stable_id: 1, title: 'Offline Mario' },
        ]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock
        .expectOne('/api/platforms')
        .flush([{ id: 1, name: 'NES', display_name: 'NES' }]);
      await refreshP;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );
      expect(saveStoredSpy).toHaveBeenCalled();

      // 3. Simulate D1 503 on subsequent /api/auth/me -> session and games stay intact!
      const p2 = service.refreshAuthStatus();
      httpMock
        .expectOne('/api/auth/me')
        .flush(
          { error: 'Database read quota exceeded', degraded: true },
          { status: 503, statusText: 'Service Unavailable' },
        );
      await p2;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()?.username).toBe('alice');
      expect(service.degradedMode()).toBe('offline');
      expect(service.isDegraded()).toBe(true);
      expect(service.games().length).toBe(1);
      expect(navSpy).not.toHaveBeenCalled();

      // 4. Cold-start /api/auth/me network error hydrates from localStorage + KitOfflineStore
      writeCachedKitAuthSnapshot({
        user: {
          id: 1,
          username: 'alice',
          role: 'admin',
          isPublic: true,
          homeRegion: 'USA',
          displayName: 'Alice',
        },
        accountHubUrl: null,
        oidcIssuer: null,
        oidcClientId: null,
        updatedAt: Date.now(),
      });
      (
        service as unknown as {
          _games: { set(v: unknown[]): void };
          _currentUser: { set(v: unknown): void };
        }
      )._games.set([]);
      (
        service as unknown as {
          _currentUser: { set(v: unknown): void };
        }
      )._currentUser.set(null);

      const p3 = service.refreshAuthStatus();
      httpMock.expectOne('/api/auth/me').error(new ProgressEvent('error'));
      await p3;

      expect(getStoredSpy).toHaveBeenCalledWith(1);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.games()[0].title).toBe('Offline Mario');

      // 5. Explicit 401 clears cached auth session
      const p4 = service.refreshAuthStatus();
      httpMock
        .expectOne('/api/auth/me')
        .flush(
          { error: 'Unauthorized' },
          { status: 401, statusText: 'Unauthorized' },
        );
      await p4;
      expect(service.isAuthenticated()).toBe(false);
      expect(readCachedKitAuthSnapshot()).toBeNull();
    });

    it('detects R2 backup headers on /api/auth/me and /api/games and blocks mutations in read-only mode', async () => {
      const pAuth = service.refreshAuthStatus();
      httpMock.expectOne('/api/auth/me').flush(
        {
          authenticated: true,
          degraded: true,
          degradedReason: 'r2_backup',
          snapshotTimestamp: '2026-11-16T03:00:00.000Z',
          user: {
            id: 1,
            username: 'alice',
            role: 'admin',
            isPublic: false,
            homeRegion: 'USA',
            displayName: 'Alice',
            bio: null,
          },
        },
        {
          headers: {
            [KIT_DEGRADED_HEADER]: 'r2-backup',
            [KIT_SNAPSHOT_TIMESTAMP_HEADER]: '2026-11-16T03:00:00.000Z',
          },
        },
      );
      await pAuth;
      httpMock
        .expectOne('/api/journal/entries')
        .flush({ authorized: true, entries: [] });

      expect(service.degradedMode()).toBe('backup');
      expect(service.isDegraded()).toBe(true);

      const pRefresh = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush(
          [{ id: 'g1', game_id: 'g1', stable_id: 1, title: 'Backup Game' }],
          {
            headers: {
              [KIT_DEGRADED_HEADER]: 'r2-backup',
              [KIT_SNAPSHOT_TIMESTAMP_HEADER]: '2026-11-16T03:00:00.000Z',
            },
          },
        );
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRefresh;

      expect(service.degradedMode()).toBe('backup');
      expect(service.degradedTimestamp()).toBe('2026-11-16T03:00:00.000Z');

      // Verify write operations reject without hitting the network
      const errMessages: string[] = [];
      service.toggleOwnership('g1', 'game', 1).subscribe({
        error: (err: Error) => errMessages.push(err.message),
      });
      service.updatePlayStatus('g1', 1).subscribe({
        error: (err: Error) => errMessages.push(err.message),
      });
      service
        .saveJournalEntry({
          item_type: 'game',
          item_id: 'g1',
          merchant: 'Test',
        })
        .subscribe({
          error: (err: Error) => errMessages.push(err.message),
        });
      service.updateProfile({ displayName: 'New' }).subscribe({
        error: (err: Error) => errMessages.push(err.message),
      });
      service.deleteGame('g1').subscribe({
        error: (err: Error) => errMessages.push(err.message),
      });

      expect(errMessages.length).toBe(5);
      for (const msg of errMessages) {
        expect(msg).toContain('Read-only mode');
      }
      httpMock.expectNone('/api/collection/toggle');
      httpMock.expectNone('/api/journal');
      httpMock.expectNone('/api/user/profile');
      httpMock.expectNone('/api/collection/game');

      // Recovery on non-degraded refresh + auth check clears degraded mode
      const pRecoverAuth = service.refreshAuthStatus();
      httpMock.expectOne('/api/auth/me').flush({
        authenticated: true,
        user: {
          id: 1,
          username: 'alice',
          role: 'admin',
          isPublic: false,
          homeRegion: 'USA',
          displayName: 'Alice',
          bio: null,
        },
      });
      await pRecoverAuth;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      const pRecoverData = service.refreshAll();
      httpMock.expectOne('/api/games').flush([]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRecoverData;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      expect(service.degradedMode()).toBeNull();
      expect(service.isDegraded()).toBe(false);
    });

    it('persists cached auth snapshot during degraded /api/auth/me and prevents SSO mismatch reload loops across visibility changes', async () => {
      clearCachedKitAuthSnapshot();
      clearSilentSsoAttempt();
      expect(readCachedKitAuthSnapshot()).toBeNull();

      const redirectSpy = vi
        .spyOn(
          service as unknown as { redirectTo: (url: string) => void },
          'redirectTo',
        )
        .mockImplementation(() => {});

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            authenticated: true,
            authorized: true,
            user: { id: 1, username: 'other_user', role: 'user' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      try {
        // 1. Degraded /api/auth/me still writes localStorage snapshot and does NOT redirect on upstream mismatch
        const pDegraded = service.refreshAuthStatus();
        httpMock.expectOne('/api/auth/me').flush(
          {
            authenticated: true,
            degraded: true,
            degradedReason: 'r2_backup',
            snapshotTimestamp: '2026-11-16T04:00:00.000Z',
            oidcIssuer: 'https://auth.example.com',
            oidcClientId: 'collection-tracker',
            user: {
              id: 1,
              username: 'alice',
              role: 'admin',
              isPublic: false,
              homeRegion: 'USA',
              displayName: 'Alice',
              bio: null,
            },
          },
          {
            headers: {
              [KIT_DEGRADED_HEADER]: 'r2-backup',
              [KIT_SNAPSHOT_TIMESTAMP_HEADER]: '2026-11-16T04:00:00.000Z',
            },
          },
        );
        await pDegraded;
        httpMock
          .expectOne('/api/journal/entries')
          .flush({ authorized: true, entries: [] });

        const saved = readCachedKitAuthSnapshot();
        expect(saved?.user?.username).toBe('alice');
        expect(redirectSpy).not.toHaveBeenCalled();

        // 2. Healthy /api/auth/me with upstream username mismatch redirects once with prompt=none, and cooldown blocks repeat loops even after visibilitychange hidden
        const pHealthy1 = service.refreshAuthStatus();
        httpMock.expectOne('/api/auth/me').flush({
          authenticated: true,
          oidcIssuer: 'https://auth.example.com',
          oidcClientId: 'collection-tracker',
          user: {
            id: 1,
            username: 'alice',
            role: 'admin',
            isPublic: false,
            homeRegion: 'USA',
            displayName: 'Alice',
            bio: null,
          },
        });
        await pHealthy1;
        httpMock
          .match('/api/prices/cached?sync=1')
          .forEach((r) =>
            r.flush({ configured: false, prices: {}, overrides: {} }),
          );

        expect(redirectSpy).toHaveBeenCalledTimes(1);
        expect(redirectSpy).toHaveBeenCalledWith(
          '/api/auth/login?return_to=%2F&prompt=none',
        );

        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });

        const pHealthy2 = service.refreshAuthStatus();
        httpMock.expectOne('/api/auth/me').flush({
          authenticated: true,
          oidcIssuer: 'https://auth.example.com',
          oidcClientId: 'collection-tracker',
          user: {
            id: 1,
            username: 'alice',
            role: 'admin',
            isPublic: false,
            homeRegion: 'USA',
            displayName: 'Alice',
            bio: null,
          },
        });
        await pHealthy2;
        httpMock
          .match('/api/prices/cached?sync=1')
          .forEach((r) =>
            r.flush({ configured: false, prices: {}, overrides: {} }),
          );
        expect(redirectSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
        redirectSpy.mockRestore();
      }
    });

    it('preserves existing IndexedDB games during loadAllJournalEntries() when _games is empty, waits for live requests in refreshAll(), and supports ensureFullCatalogLoaded()', async () => {
      const storeMap = new Map<
        number,
        { state: { games: Game[] }; updatedAt: number }
      >();
      storeMap.set(1, {
        state: {
          games: [
            {
              id: 'saved-1',
              game_id: 'saved-1',
              stable_id: 1,
              title: 'Existing Saved Game',
            } as Game,
          ],
        },
        updatedAt: 1000,
      });

      const internal = service as unknown as {
        offlineStore: {
          getStoredState: (uid: number) => Promise<unknown>;
          saveStateLocally: (
            state: {
              games: Game[];
              toys: unknown[];
              platforms: unknown[];
              journalEntries: unknown[];
            },
            updatedAtMs: number,
            pendingSync: boolean,
            uid: number,
          ) => Promise<void>;
        };
      };

      const saveSpy = vi
        .spyOn(internal.offlineStore, 'saveStateLocally')
        .mockImplementation(async (state, updatedAt, _pending, uid) => {
          storeMap.set(uid, {
            state: { games: state.games },
            updatedAt,
          });
        });
      vi.spyOn(internal.offlineStore, 'getStoredState').mockImplementation(
        async (uid: number) => storeMap.get(uid) ?? null,
      );

      service.setCurrentUserForTesting({
        id: 1,
        email: 'alice@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });

      expect(service.games().length).toBe(0);
      service.loadAllJournalEntries().subscribe();
      httpMock.expectOne('/api/journal/entries').flush({
        authorized: true,
        entries: [{ id: 1, item_type: 'game', item_id: 'saved-1' }],
      });
      await Promise.resolve();
      // Journal load before games finish must NOT wipe out saved IndexedDB games
      expect(saveSpy).not.toHaveBeenCalled();
      expect(storeMap.get(1)?.state.games[0]?.title).toBe(
        'Existing Saved Game',
      );

      // refreshAll() serves live D1 games and saves them without prematurely hydrating stale offline data
      const pRefresh = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush([
          { id: 'live-1', game_id: 'live-1', stable_id: 2, title: 'Live Game' },
        ]);
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRefresh;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      expect(service.games().map((g) => g.title)).toEqual(['Live Game']);
      expect(service.isDegraded()).toBe(false);

      // ensureFullCatalogLoaded() fetches unowned + owned games via ?include_unowned=1 once
      const pFull = service.ensureFullCatalogLoaded();
      httpMock.expectOne('/api/games?include_unowned=1').flush([
        { id: 'live-1', game_id: 'live-1', stable_id: 2, title: 'Live Game' },
        {
          id: 'unowned-1',
          game_id: 'unowned-1',
          stable_id: 3,
          title: 'Unowned Catalog Game',
        },
      ]);
      await pFull;
      expect(service.games().length).toBe(2);

      // Calling ensureFullCatalogLoaded() again is a no-op once loaded
      await service.ensureFullCatalogLoaded();
      httpMock.expectNone('/api/games?include_unowned=1');
    });

    it('automatically syncs R2 catalog chunks on X-Catalog-Partial: 1, merges live D1 overlay + delta games, and persists catalogVersion', async () => {
      const storeMap = new Map<
        number,
        {
          state: { games: Game[]; catalogVersion?: string | null };
          updatedAt: number;
        }
      >();
      const internal = service as unknown as {
        offlineStore: {
          getStoredState: (uid: number) => Promise<unknown>;
          saveStateLocally: (
            state: {
              games: Game[];
              toys: unknown[];
              platforms: unknown[];
              journalEntries: unknown[];
              catalogVersion?: string | null;
            },
            updatedAtMs: number,
            pendingSync: boolean,
            uid: number,
          ) => Promise<void>;
        };
      };
      vi.spyOn(internal.offlineStore, 'getStoredState').mockImplementation(
        async (uid: number) => storeMap.get(uid) ?? null,
      );
      vi.spyOn(internal.offlineStore, 'saveStateLocally').mockImplementation(
        async (state, updatedAt, _pending, uid) => {
          storeMap.set(uid, {
            state: {
              games: state.games,
              catalogVersion: state.catalogVersion ?? null,
            },
            updatedAt,
          });
        },
      );

      service.setCurrentUserForTesting({
        id: 1,
        email: 'alice@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });

      const pRefresh = service.refreshAll();
      httpMock.expectOne('/api/games').flush(
        [
          {
            id: 'owned-1',
            game_id: 'owned-1',
            stable_id: 1,
            title: 'Owned Game',
            platform: 'Switch',
            platform_id: 1,
            ownership_status: 1,
            play_status: 2,
            has_media: 1,
          },
        ],
        { headers: { 'X-Catalog-Partial': '1' } },
      );
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRefresh;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      expect(service.catalogIsPartial()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      httpMock.expectOne('/api/catalog/games?manifest=1').flush({
        version: 'v2026-11-17',
        timestamp: '2026-11-17T00:05:00Z',
        totalRows: 4,
        chunkSize: 2,
        chunkCount: 2,
        maxStableId: 4,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock
        .expectOne('/api/user/collection-overlay?since_stable_id=4')
        .flush({
          version: 'v2026-11-17',
          timestamp: '2026-11-17T00:05:00Z',
          maxStableId: 4,
          ugr: [
            {
              release_id: 'owned-1',
              ownership_status: 1,
              has_media: 1,
              has_case: 1,
              has_manual: 1,
            },
            {
              release_id: 'catalog-2',
              ownership_status: 2,
              has_media: 0,
              has_case: 0,
              has_manual: 0,
            },
          ],
          ug: [{ game_id: 1, play_status: 2, queued: 1 }],
          deltaGames: [
            {
              id: 'delta-5',
              game_id: 'delta-5',
              stable_id: 5,
              title: 'Added After Midnight',
              platform: 'Switch',
              platform_id: 1,
              ownership_status: 0,
              play_status: 0,
              has_media: 0,
            },
          ],
        });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.catalogSyncProgress().active).toBe(true);
      expect(service.catalogSyncProgress().totalChunks).toBe(2);

      const chunk0Req = httpMock.expectOne(
        '/api/catalog/games?chunk=0&v=v2026-11-17',
      );
      const chunk1Req = httpMock.expectOne(
        '/api/catalog/games?chunk=1&v=v2026-11-17',
      );

      chunk0Req.flush([
        {
          id: 'owned-1',
          game_id: 'owned-1',
          stable_id: 1,
          title: 'Owned Game',
          platform: 'Switch',
          platform_id: 1,
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
        },
        {
          id: 'catalog-2',
          game_id: 'catalog-2',
          stable_id: 2,
          title: 'Seeking Game',
          platform: 'Switch',
          platform_id: 1,
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
        },
      ]);
      chunk1Req.flush([
        {
          id: 'catalog-3',
          game_id: 'catalog-3',
          stable_id: 3,
          title: 'Unowned Game Three',
          platform: 'Switch',
          platform_id: 1,
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
        },
        {
          id: 'catalog-4',
          game_id: 'catalog-4',
          stable_id: 4,
          title: 'Unowned Game Four',
          platform: 'Switch',
          platform_id: 1,
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
        },
      ]);

      await service.ensureFullCatalogLoaded();

      expect(service.catalogSyncProgress().active).toBe(false);
      expect(service.catalogSyncProgress().percent).toBe(100);
      expect(service.catalogIsPartial()).toBe(false);
      expect(service.games().length).toBe(5);

      const owned = service.games().find((g) => g.id === 'owned-1');
      const seeking = service.games().find((g) => g.id === 'catalog-2');
      const delta = service.games().find((g) => g.id === 'delta-5');
      expect(owned?.ownership_status).toBe(1);
      expect(owned?.has_media).toBe(1);
      expect(owned?.queued).toBe(1);
      expect(seeking?.ownership_status).toBe(2);
      expect(delta?.title).toBe('Added After Midnight');
      expect(storeMap.get(1)?.state.catalogVersion).toBe('v2026-11-17');
      expect(storeMap.get(1)?.state.games.length).toBe(5);
    });

    it('skips R2 chunk fetches when IndexedDB matches manifest.version and resets stale ownership via live overlay', async () => {
      const storeMap = new Map<
        number,
        {
          state: { games: Game[]; catalogVersion?: string | null };
          updatedAt: number;
        }
      >();
      storeMap.set(1, {
        state: {
          catalogVersion: 'v2026-11-17',
          games: [
            {
              id: 'stale-unowned-1',
              game_id: 'stale-unowned-1',
              stable_id: 1,
              title: 'Previously Owned',
              platform: 'Switch',
              platform_id: 1,
              ownership_status: 1,
              play_status: 3,
              queued: 1,
              has_media: 1,
            } as Game,
            {
              id: 'active-owned-2',
              game_id: 'active-owned-2',
              stable_id: 2,
              title: 'Still Owned',
              platform: 'Switch',
              platform_id: 1,
              ownership_status: 0,
              play_status: 0,
              has_media: 0,
            } as Game,
          ],
        },
        updatedAt: 1000,
      });

      const internal = service as unknown as {
        offlineStore: {
          getStoredState: (uid: number) => Promise<unknown>;
          saveStateLocally: (
            state: {
              games: Game[];
              toys: unknown[];
              platforms: unknown[];
              journalEntries: unknown[];
              catalogVersion?: string | null;
            },
            updatedAtMs: number,
            pendingSync: boolean,
            uid: number,
          ) => Promise<void>;
        };
      };
      vi.spyOn(internal.offlineStore, 'getStoredState').mockImplementation(
        async (uid: number) => storeMap.get(uid) ?? null,
      );
      vi.spyOn(internal.offlineStore, 'saveStateLocally').mockImplementation(
        async (state, updatedAt, _pending, uid) => {
          storeMap.set(uid, {
            state: {
              games: state.games,
              catalogVersion: state.catalogVersion ?? null,
            },
            updatedAt,
          });
        },
      );

      service.setCurrentUserForTesting({
        id: 1,
        email: 'alice@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });

      const pRefresh = service.refreshAll();
      httpMock.expectOne('/api/games').flush(
        [
          {
            id: 'active-owned-2',
            game_id: 'active-owned-2',
            stable_id: 2,
            title: 'Still Owned',
            platform: 'Switch',
            platform_id: 1,
            ownership_status: 1,
            play_status: 2,
            has_media: 1,
          },
        ],
        { headers: { 'X-Catalog-Partial': '1' } },
      );
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRefresh;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      // Phase 1 snapshot save must preserve the full IndexedDB catalogVersion & games
      expect(storeMap.get(1)?.state.catalogVersion).toBe('v2026-11-17');
      expect(storeMap.get(1)?.state.games.length).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock.expectOne('/api/catalog/games?manifest=1').flush({
        version: 'v2026-11-17',
        timestamp: '2026-11-17T00:05:00Z',
        totalRows: 2,
        chunkSize: 3500,
        chunkCount: 1,
        maxStableId: 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock
        .expectOne('/api/user/collection-overlay?since_stable_id=2')
        .flush({
          version: 'v2026-11-17',
          timestamp: '2026-11-17T00:05:00Z',
          maxStableId: 2,
          ugr: [
            {
              release_id: 'active-owned-2',
              ownership_status: 1,
              has_media: 1,
              has_case: 1,
              has_manual: 0,
            },
          ],
          ug: [{ game_id: 2, play_status: 2, queued: 0 }],
          deltaGames: [],
        });

      await service.ensureFullCatalogLoaded();
      httpMock.expectNone('/api/catalog/games?chunk=0&v=v2026-11-17');

      const staleReset = service
        .games()
        .find((g) => g.id === 'stale-unowned-1');
      const liveOwned = service.games().find((g) => g.id === 'active-owned-2');
      expect(staleReset?.ownership_status).toBe(0);
      expect(staleReset?.play_status).toBe(0);
      expect(staleReset?.queued).toBe(0);
      expect(staleReset?.has_media).toBe(0);
      expect(liveOwned?.ownership_status).toBe(1);
      expect(liveOwned?.has_media).toBe(1);
      expect(liveOwned?.play_status).toBe(2);
    });

    it('stops fetching trailing chunks early when a non-zero chunk returns empty rows due to primary-key gaps', async () => {
      service.setCurrentUserForTesting({
        id: 1,
        email: 'alice@example.com',
        username: 'alice',
        role: 'admin',
        isPublic: false,
        homeRegion: 'USA',
        displayName: 'Alice',
        bio: null,
      });

      const pRefresh = service.refreshAll();
      httpMock
        .expectOne('/api/games')
        .flush([], { headers: { 'X-Catalog-Partial': '1' } });
      httpMock.expectOne('/api/toys').flush([]);
      httpMock.expectOne('/api/platforms').flush([]);
      await pRefresh;
      httpMock
        .match('/api/prices/cached?sync=1')
        .forEach((r) =>
          r.flush({ configured: false, prices: {}, overrides: {} }),
        );

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock.expectOne('/api/catalog/games?manifest=1').flush({
        version: 'v2026-11-18-gap',
        timestamp: '2026-11-18T00:05:00Z',
        totalRows: 1,
        chunkSize: 3500,
        chunkCount: 3,
        maxStableId: 50000,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock
        .expectOne('/api/user/collection-overlay?since_stable_id=50000')
        .flush({
          version: 'v2026-11-18-gap',
          timestamp: '2026-11-18T00:05:00Z',
          maxStableId: 50000,
          ugr: [],
          ug: [],
          deltaGames: [],
        });

      await new Promise((resolve) => setTimeout(resolve, 0));
      httpMock.expectOne('/api/catalog/games?chunk=0&v=v2026-11-18-gap').flush([
        {
          id: 'gap-game-50000',
          game_id: 'gap-game-50000',
          stable_id: 50000,
          title: 'Surviving Gap Game',
          platform: 'Switch',
          platform_id: 26,
          ownership_status: 0,
          play_status: 0,
          has_media: 0,
        },
      ]);
      httpMock
        .expectOne('/api/catalog/games?chunk=1&v=v2026-11-18-gap')
        .flush([]);

      await service.ensureFullCatalogLoaded();
      httpMock.expectNone('/api/catalog/games?chunk=2&v=v2026-11-18-gap');
      expect(service.catalogSyncProgress().active).toBe(false);
      expect(service.catalogSyncProgress().percent).toBe(100);
      expect(service.games().map((g) => g.id)).toEqual(['gap-game-50000']);
    });
  });

  describe('Live eBay Market Pricing (6h Ephemeral Cache)', () => {
    beforeEach(() => {
      service.setAdminForTesting(true);
      service.setPublicView(false, null);
    });

    function makePrice(
      itemType: 'game' | 'toy',
      itemId: string,
      offsetMs = -60_000,
    ): EphemeralMarketPrice {
      const fetchedAtMs = Date.now() + offsetMs;
      return {
        item_type: itemType,
        item_id: itemId,
        loose_cents: 1900,
        cib_cents: itemType === 'game' ? 4500 : null,
        new_cents: 9500,
        loose_sample_size: 4,
        cib_sample_size: itemType === 'game' ? 3 : 0,
        new_sample_size: 1,
        confidence: 'medium',
        source: 'ebay_browse',
        fetched_at: new Date(fetchedAtMs).toISOString(),
        expires_at: new Date(fetchedAtMs + EBAY_PRICE_TTL_MS).toISOString(),
        query_used: itemId,
        sample_listings: { loose: [], cib: [], new: [] },
      };
    }

    it('syncCachedMarketPrices populates fresh entries, filters expired >6h entries, and tracks configuration', async () => {
      const fresh = makePrice('game', 'chrono-trigger');
      const expired = makePrice(
        'game',
        'stale-game',
        -(EBAY_PRICE_TTL_MS + 60_000),
      );

      const syncPromise = service.syncCachedMarketPrices(true);
      const req = httpMock.expectOne('/api/prices/cached?sync=1');
      expect(req.request.method).toBe('GET');
      req.flush({
        configured: true,
        prices: {
          'game:chrono-trigger': fresh,
          'game:stale-game': expired,
        },
        overrides: {
          'game:chrono-trigger': 'Chrono Trigger SNES',
        },
      });

      const res = await syncPromise;
      expect(res.configured).toBe(true);
      expect(res.count).toBe(1);
      expect(service.marketPricingConfigured()).toBe(true);
      expect(
        service.getMarketPrice('game', 'chrono-trigger')?.loose_cents,
      ).toBe(1900);
      expect(service.getMarketPrice('game', 'stale-game')).toBeNull();
      expect(service.getPriceQueryOverride('game', 'chrono-trigger')).toBe(
        'Chrono Trigger SNES',
      );
    });

    it('checkLiveItemPrice handles 503 ebay_not_configured gracefully and caches 200 live responses', async () => {
      const unconfPromise = service.checkLiveItemPrice('game', 'mario');
      const req503 = httpMock.expectOne('/api/prices/live');
      req503.flush(
        {
          error: 'eBay API credentials not configured.',
          code: 'ebay_not_configured',
        },
        { status: 503, statusText: 'Service Unavailable' },
      );
      const unconf = await unconfPromise;
      expect(unconf.notConfigured).toBe(true);
      expect(unconf.price).toBeNull();
      expect(service.marketPricingConfigured()).toBe(false);

      const livePrice = makePrice('game', 'mario');
      const livePromise = service.checkLiveItemPrice('game', 'gb-mario');
      const req200 = httpMock.expectOne('/api/prices/live');
      expect(req200.request.body).toEqual({
        itemType: 'game',
        itemId: 'gb-mario',
        force: false,
      });
      req200.flush({
        price: livePrice,
        canonicalKey: 'game:mario',
        cacheHit: false,
      });
      const liveRes = await livePromise;
      expect(liveRes.notConfigured).toBeUndefined();
      expect(liveRes.price?.cib_cents).toBe(4500);
      expect(service.marketPricingConfigured()).toBe(true);
      // Both canonical ID and aliased release ID resolve the live snapshot
      expect(service.getMarketPrice('game', 'mario')?.cib_cents).toBe(4500);
      expect(service.getMarketPrice('game', 'gb-mario')?.cib_cents).toBe(4500);
    });

    it('startCollectionValuationScan skips fresh items, groups misses by shard, and supports cancellation', async () => {
      // Seed 1 already-fresh item
      const syncP = service.syncCachedMarketPrices(false);
      httpMock.expectOne('/api/prices/cached').flush({
        configured: true,
        prices: { 'game:fresh-one': makePrice('game', 'fresh-one') },
        overrides: {},
      });
      await syncP;

      // Pick 2 IDs that map to two different R2 shards
      const idA = 'miss-alpha-1';
      const shardA = getPriceShardIndex('game', idA);
      let idB = 'miss-beta-2';
      for (let i = 2; i < 50; i++) {
        const candidate = `miss-beta-${i}`;
        if (getPriceShardIndex('game', candidate) !== shardA) {
          idB = candidate;
          break;
        }
      }

      const scanPromise = service.startCollectionValuationScan(
        [
          { itemType: 'game', itemId: 'fresh-one' },
          { itemType: 'game', itemId: idA },
          { itemType: 'game', itemId: idB },
        ],
        'Test Scan',
      );

      // Should skip fresh-one and issue separate shard-grouped batches for idA and idB
      const firstBatch = await vi.waitFor(() =>
        httpMock.expectOne('/api/prices/live-batch'),
      );
      expect(firstBatch.request.body.items.length).toBe(1);
      const returnedId = firstBatch.request.body.items[0].itemId;
      firstBatch.flush({
        prices: { [`game:${returnedId}`]: makePrice('game', returnedId) },
        cacheHits: 0,
        fetchedCount: 1,
        errors: {},
        rateLimited: false,
      });

      // Wait for IndexedDB persistence to settle before cancelling mid-scan
      await vi.waitFor(() =>
        expect(service.getMarketPrice('game', returnedId)?.loose_cents).toBe(
          1900,
        ),
      );
      service.cancelCollectionValuationScan();
      await scanPromise;

      httpMock.expectNone('/api/prices/live-batch');
      expect(service.marketPriceScanProgress().cancelled).toBe(true);
      expect(service.marketPriceScanProgress().active).toBe(false);
    });

    it('backs off automatically and retries only the unpriced remainder on HTTP 200 rateLimited=true', async () => {
      const delaySpy = vi
        .spyOn(
          service as unknown as { delayMs: (ms: number) => Promise<void> },
          'delayMs',
        )
        .mockResolvedValue(undefined);

      try {
        // Pick 2 IDs in the SAME R2 shard so both go into one batch
        const id1 = 'shard-mate-0';
        const targetShard = getPriceShardIndex('game', id1);
        let id2 = 'shard-mate-1';
        for (let i = 1; i < 100; i++) {
          const candidate = `shard-mate-${i}`;
          if (getPriceShardIndex('game', candidate) === targetShard) {
            id2 = candidate;
            break;
          }
        }

        const scanPromise = service.startCollectionValuationScan(
          [
            { itemType: 'game', itemId: id1 },
            { itemType: 'game', itemId: id2 },
          ],
          'Retry Scope',
        );

        const req1 = await vi.waitFor(() =>
          httpMock.expectOne('/api/prices/live-batch'),
        );
        expect(req1.request.body.items.length).toBe(2);
        // Simulate partial success + rate limit on id2
        req1.flush({
          prices: { [`game:${id1}`]: makePrice('game', id1) },
          cacheHits: 0,
          fetchedCount: 1,
          errors: { [`game:${id2}`]: 'eBay Browse API rate limit exceeded.' },
          rateLimited: true,
          retryableError: true,
          retryAfterSec: 2,
        });

        // Wait for IndexedDB write + backoff countdown before retry #2 with ONLY id2
        const req2 = await vi.waitFor(
          () => httpMock.expectOne('/api/prices/live-batch'),
          { timeout: 2000, interval: 5 },
        );
        expect(req2.request.body.items).toEqual([
          { itemType: 'game', itemId: id2 },
        ]);
        req2.flush({
          prices: { [`game:${id2}`]: makePrice('game', id2) },
          cacheHits: 0,
          fetchedCount: 1,
          errors: {},
          rateLimited: false,
        });

        await scanPromise;
        expect(delaySpy).toHaveBeenCalled();
        expect(service.marketPriceScanProgress().rateLimited).toBe(false);
        expect(service.marketPriceScanProgress().completedItems).toBe(2);
        expect(service.marketPriceScanProgress().errorCount).toBe(0);
        expect(service.getMarketPrice('game', id2)?.loose_cents).toBe(1900);
      } finally {
        delaySpy.mockRestore();
      }
    });

    it('retries and recovers cleanly on transient HTTP 503 during batch scan', async () => {
      const delaySpy = vi
        .spyOn(
          service as unknown as { delayMs: (ms: number) => Promise<void> },
          'delayMs',
        )
        .mockResolvedValue(undefined);

      try {
        const scanPromise = service.startCollectionValuationScan(
          [{ itemType: 'toy', itemId: 'amiibo-retry' }],
          'Toy Scope',
        );

        const req503 = await vi.waitFor(() =>
          httpMock.expectOne('/api/prices/live-batch'),
        );
        req503.flush(
          { error: 'Worker CPU timeout' },
          { status: 503, statusText: 'Service Unavailable' },
        );

        const reqRetry = await vi.waitFor(
          () => httpMock.expectOne('/api/prices/live-batch'),
          { timeout: 2000, interval: 5 },
        );
        reqRetry.flush({
          prices: {
            'toy:amiibo-retry': makePrice('toy', 'amiibo-retry'),
          },
          cacheHits: 0,
          fetchedCount: 1,
          errors: {},
          rateLimited: false,
        });

        await scanPromise;
        expect(service.marketPriceScanProgress().completedItems).toBe(1);
        expect(service.marketPriceScanProgress().errorCount).toBe(0);
        expect(service.getMarketPrice('toy', 'amiibo-retry')?.loose_cents).toBe(
          1900,
        );
      } finally {
        delaySpy.mockRestore();
      }
    });

    it('cancels immediately during backoff cooldown without hanging', async () => {
      const scanPromise = service.startCollectionValuationScan(
        [{ itemType: 'game', itemId: 'cancel-cooldown-1' }],
        'Cancel Scope',
      );

      const req = await vi.waitFor(() =>
        httpMock.expectOne('/api/prices/live-batch'),
      );
      req.flush({
        prices: {},
        cacheHits: 0,
        fetchedCount: 0,
        errors: { 'game:cancel-cooldown-1': 'rate limited' },
        rateLimited: true,
        retryableError: true,
        retryAfterSec: 30,
      });

      await vi.waitFor(() =>
        expect(service.marketPriceScanProgress().cooldownSecondsRemaining).toBe(
          30,
        ),
      );

      service.cancelCollectionValuationScan();
      await scanPromise;

      expect(service.marketPriceScanProgress().cancelled).toBe(true);
      expect(service.marketPriceScanProgress().active).toBe(false);
      expect(service.marketPriceScanProgress().cooldownSecondsRemaining).toBe(
        0,
      );
    });

    it('wipes ephemeral marketPricesMap and priceOverridesMap on unauthenticated sign-out', async () => {
      const syncP = service.syncCachedMarketPrices(false);
      httpMock.expectOne('/api/prices/cached').flush({
        configured: true,
        prices: { 'toy:mario-amiibo': makePrice('toy', 'mario-amiibo') },
        overrides: { 'toy:mario-amiibo': 'Mario Amiibo Smash' },
      });
      await syncP;
      expect(service.marketPricesMap().size).toBe(1);
      expect(service.priceOverridesMap().size).toBe(1);

      const authP = service.refreshAuthStatus();
      httpMock
        .expectOne('/api/auth/me')
        .flush({ authenticated: false, user: null });
      await authP;

      expect(service.marketPricesMap().size).toBe(0);
      expect(service.priceOverridesMap().size).toBe(0);
      expect(service.marketPricingConfigured()).toBeNull();
    });
  });
});
