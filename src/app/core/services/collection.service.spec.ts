import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { CollectionService } from './collection.service';

/**
 * UNIT TEST: CollectionService
 * 
 * Verifies the core data-fetching logic and signal-based state management
 * for the game and figure collection.
 * Updated for Angular 21 and Vitest.
 */
describe('CollectionService', () => {
  let service: CollectionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CollectionService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(CollectionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch games list using relative path', () => {
    const mockGames = [{ stable_id: 1, title: 'Super Mario' }];

    service.getGames().subscribe(games => {
      expect(games.length).toBe(1);
      expect(games[0].title).toBe('Super Mario');
    });

    // Production code uses relative root paths
    const req = httpMock.expectOne('/api/games');
    expect(req.request.method).toBe('GET');
    req.flush(mockGames);
  });

  it('should fetch figures list using relative path', () => {
    const mockFigures = [{ id: 1, name: 'Mario Amiibo' }];

    service.getFigures().subscribe(figures => {
        expect(figures.length).toBe(1);
        expect(figures[0].name).toBe('Mario Amiibo');
    });

    const req = httpMock.expectOne('/api/figures');
    expect(req.request.method).toBe('GET');
    req.flush(mockFigures);
  });

  describe('List State Persistence', () => {
    beforeEach(() => {
      sessionStorage.clear();
    });

    it('should update and persist list state', () => {
      const mockState = {
        tab: 'games' as const,
        filters: { ownership: 'owned' as const },
        displayLimit: 200,
        scrollX: 0,
        scrollY: 500
      };

      service.updateListState(mockState);
      expect(service.listState).toEqual(mockState);
      
      const saved = sessionStorage.getItem('gagglog_list_state');
      expect(saved).toBeTruthy();
      expect(JSON.parse(saved!)).toEqual(mockState);
    });

    it('should load persisted state from sessionStorage', () => {
      const mockState = {
        tab: 'figures' as const,
        filters: { ownership: 'wanted' as const },
        displayLimit: 300,
        scrollX: 0,
        scrollY: 1000
      };

      sessionStorage.setItem('gagglog_list_state', JSON.stringify(mockState));
      service.loadPersistedState();
      
      expect(service.listState).toEqual(mockState);
    });

    it('should handle malformed JSON in sessionStorage', () => {
      sessionStorage.setItem('gagglog_list_state', 'invalid-json');
      // Should not throw
      service.loadPersistedState();
      expect(service.listState).toBeNull();
    });
  });
});
