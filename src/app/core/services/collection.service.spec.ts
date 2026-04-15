import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CollectionService } from './collection.service';

/**
 * UNIT TEST: CollectionService
 * 
 * Verifies that the frontend service correctly communicates with the 
 * hybrid API server to retrieve games, figures, and platforms.
 */
describe('CollectionService', () => {
  let service: CollectionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CollectionService]
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

  it('should fetch games list', () => {
    const mockGames = [{ stable_id: 1, title: 'Super Mario' }];

    service.getGames().subscribe(games => {
      expect(games.length).toBe(1);
      expect(games[0].title).toBe('Super Mario');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/games');
    expect(req.request.method).toBe('GET');
    req.flush(mockGames);
  });

  it('should fetch figures list', () => {
    const mockFigures = [{ id: 1, name: 'Mario Amiibo' }];

    service.getFigures().subscribe(figures => {
        expect(figures.length).toBe(1);
        expect(figures[0].name).toBe('Mario Amiibo');
    });

    const req = httpMock.expectOne('http://localhost:3000/api/figures');
    expect(req.request.method).toBe('GET');
    req.flush(mockFigures);
  });
});
