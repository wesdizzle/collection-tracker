import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { CollectionService } from './collection.service';
import { Game, formatJournalDate } from '../models/collection.models';
import { clearSilentSsoAttempt } from '@wesdizzle/app-kit/angular';

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

    it('addGame issues POST /api/discovery/add and immediately prepends to _games signal', () => {
      let result: { success: boolean; gameId: string } | undefined;
      service
        .addGame({
          game: {
            title: 'Mega Man & Bass',
            platform_id: 2,
            physical_status: 'verified_physical',
          },
          releases: [{ rom_name: 'Mega Man & Bass (USA)', region: 'USA' }],
        })
        .subscribe((r) => (result = r));

      const req = httpMock.expectOne('/api/discovery/add');
      expect(req.request.method).toBe('POST');
      req.flush({
        success: true,
        gameId: 'mega-man-bass-snes',
        stableId: 9999,
      });

      expect(result?.success).toBe(true);
      expect(result?.gameId).toBe('mega-man-bass-snes');
      const games = service.games();
      expect(games.length).toBeGreaterThan(0);
      expect(games[0].id).toBe('mega-man-bass-snes');
      expect(games[0].title).toBe('Mega Man & Bass');
      expect(games[0].physical_status).toBe('verified_physical');
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
        backup_status: 1,
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

  describe('Discovery Auth & Error Propagation', () => {
    it('should prompt admin login and propagate error when scanSeries returns 403', () => {
      let caughtError: unknown = null;
      service.scanSeries().subscribe({
        next: () => {},
        error: (err) => {
          caughtError = err;
        },
      });

      const req = httpMock.expectOne('/api/discovery/scan-series');
      req.flush(
        { error: 'Unauthorized: Admin authentication required.' },
        { status: 403, statusText: 'Forbidden' },
      );

      expect(caughtError).toBeTruthy();
      expect(service.dialogState().visible).toBe(true);
      expect(service.dialogState().title).toBe('Sign In Required');
    });

    it('should prompt admin login and propagate error when scanAmiibo returns 403', () => {
      let caughtError: unknown = null;
      service.scanAmiibo().subscribe({
        next: () => {},
        error: (err) => {
          caughtError = err;
        },
      });

      const req = httpMock.expectOne('/api/discovery/scan-amiibo');
      req.flush(
        { error: 'Unauthorized: Admin authentication required.' },
        { status: 403, statusText: 'Forbidden' },
      );

      expect(caughtError).toBeTruthy();
      expect(service.dialogState().visible).toBe(true);
      expect(service.dialogState().title).toBe('Sign In Required');
    });

    it('should query scanSeries with options and query parameters', () => {
      service
        .scanSeries({ series: 'Super Mario', filterDigital: true })
        .subscribe();
      const req = httpMock.expectOne(
        '/api/discovery/scan-series?filterDigital=true&series=Super+Mario',
      );
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should query scanSeriesPaged with offset and limit parameters', () => {
      service
        .scanSeriesPaged({ offset: 30, limit: 30, filterDigital: true })
        .subscribe();
      const req = httpMock.expectOne(
        '/api/discovery/scan-series?filterDigital=true&offset=30&limit=30',
      );
      expect(req.request.method).toBe('GET');
      req.flush({
        suggestions: [],
        offset: 30,
        limit: 30,
        totalSeries: 100,
        hasMore: true,
      });
    });

    it('should default filterDigital to true in searchGames', () => {
      service.searchGames('Metroid', 19).subscribe();
      const req = httpMock.expectOne(
        '/api/discovery/search?query=Metroid&platformId=19&filterDigital=true',
      );
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should allow filterDigital to be disabled in searchGames', () => {
      service.searchGames('Metroid', 19, false).subscribe();
      const req = httpMock.expectOne(
        '/api/discovery/search?query=Metroid&platformId=19&filterDigital=false',
      );
      expect(req.request.method).toBe('GET');
      req.flush([]);
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

      service.updateBackupStatus('g1', 1).subscribe({
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

    it('immutably patches games, toys, and disc backups for OnPush consumers', async () => {
      const p1 = service.refreshAll();
      httpMock.expectOne('/api/games').flush([
        {
          stable_id: 1,
          id: 'g1',
          title: 'Final Fantasy VII',
          ownership_status: 0,
          play_status: 0,
          backup_status: 0,
          releases: [{ id: 'g1-d1', region: 'USA', backup_status: 0 }],
          discIds: ['g1-d1'],
          discBackups: [0],
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

      service.patchDiscBackupOptimistic('g1-d1', 1);
      const afterDiscGame = service.games()[0];
      expect(afterDiscGame).not.toBe(afterGame);
      expect(afterDiscGame.releases?.[0].backup_status).toBe(1);
      expect(afterDiscGame.discBackups?.[0]).toBe(1);
      expect(afterDiscGame.backup_status).toBe(1);
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
          '/api/auth/login?return_to=%2Fcollection%2Fgames',
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
});
