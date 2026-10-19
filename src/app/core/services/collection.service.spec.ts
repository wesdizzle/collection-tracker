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

    const meReqs = httpMock.match('/api/admin/me');
    meReqs.forEach((r) => r.flush({ authenticated: false, authorized: false }));
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
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

    it('should fallback to legacy gagglog_list_state keys when app_list_state is absent', () => {
      sessionStorage.removeItem('app_list_state_toys');
      const legacyState = {
        tab: 'toys' as const,
        filters: { ownership: 'owned' as const },
        displayLimit: 150,
        scrollX: 0,
        scrollY: 200,
      };

      sessionStorage.setItem(
        'gagglog_list_state_toys',
        JSON.stringify(legacyState),
      );
      service.loadPersistedState();

      expect(service.toysState()).toEqual(legacyState);
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
      expect(service.dialogState().title).toBe('Admin Authentication');
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
      expect(service.dialogState().title).toBe('Admin Authentication');
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

    it('toggles journal visibility when authorized admin', () => {
      const internal = service as unknown as {
        _isAdmin: { set: (val: boolean) => void };
      };
      internal._isAdmin.set(true);

      expect(service.journalRevealed()).toBe(false);
      service.toggleJournalVisibility();
      expect(service.journalRevealed()).toBe(true);
      expect(sessionStorage.getItem('app_journal_revealed')).toBe('true');

      service.toggleJournalVisibility();
      expect(service.journalRevealed()).toBe(false);
      expect(sessionStorage.getItem('app_journal_revealed')).toBe('false');
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
});
