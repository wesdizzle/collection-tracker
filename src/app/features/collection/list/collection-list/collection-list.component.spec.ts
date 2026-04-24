import '../../../../../test-setup';
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { CollectionListComponent } from './collection-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { ListState } from '../../../../core/models/collection.models';

/**
 * UNIT TEST: CollectionListComponent
 * 
 * Verifies that the data grid correctly renders lists of 
 * games or figures fetched from the API layer.
 * Uses modern Angular 21+ provider-based mocking for HTTP and Routing.
 */
describe('CollectionListComponent', () => {
  let component: CollectionListComponent;
  let fixture: ComponentFixture<CollectionListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { url: [{ path: 'games' }] }
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CollectionListComponent);
    component = fixture.componentInstance;
    
    // Reset service state between tests to avoid pollution from sessionStorage
    TestBed.inject(CollectionService).resetListState();
  });

  it('should create', () => {
    const httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/figures').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    expect(component).toBeTruthy();
  });

  it('should restore state from service on init', async () => {
    const service = TestBed.inject(CollectionService);
    const httpMock = TestBed.inject(HttpTestingController);
    
    const mockState: ListState = {
      tab: 'games',
      filters: { ownership: 'wanted' },
      displayLimit: 500,
      scrollX: 0,
      scrollY: 1500
    };
    
    // Inject mock state into service
    service.updateListState(mockState);
    
    // Trigger ngOnInit
    const initPromise = component.ngOnInit();
    
    // Handle the HTTP requests triggered by refreshAll
    const reqGames = httpMock.expectOne('/api/games');
    reqGames.flush([]);
    const reqFigures = httpMock.expectOne('/api/figures');
    reqFigures.flush([]);
    const reqPlatforms = httpMock.expectOne('/api/platforms');
    reqPlatforms.flush([]);
    
    await initPromise;
    
    expect(component.filters().ownership).toBe('wanted');
    expect(component.displayLimit()).toBe(500);
  });

  it('should filter games by series with case and accent insensitivity', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    
    // Trigger ngOnInit to start data load
    const initPromise = component.ngOnInit();
    
    // Provide mock data with accents
    httpMock.expectOne('/api/games').flush([
      { id: '1', title: 'Game 1', canonical_series: 'Pokémon', owned: 1, platform: 'Switch' },
      { id: '2', title: 'Game 2', canonical_series: 'Mario', owned: 1, platform: 'Switch' }
    ]);
    httpMock.expectOne('/api/figures').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Test case insensitive match
    component.filters.set({ ownership: 'all', series: 'pokemon' });
    expect(component.filteredGames().length).toBe(1);
    expect(component.filteredGames()[0].canonical_series).toBe('Pokémon');

    // Test substring match
    component.filters.set({ ownership: 'all', series: 'poke' });
    expect(component.filteredGames().length).toBe(1);

    // Test accent insensitive match
    component.filters.set({ ownership: 'all', series: 'POKEMON' });
    expect(component.filteredGames().length).toBe(1);

    // Test non-match
    component.filters.set({ ownership: 'all', series: 'Zelda' });
    expect(component.filteredGames().length).toBe(0);
  });

  it('should correctly calculate group totals even when displayLimit is small', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    
    const initPromise = component.ngOnInit();
    
    // Provide 5 games for Switch, but we will set displayLimit to 2
    httpMock.expectOne('/api/games').flush([
      { id: '1', title: 'G1', platform: 'Switch', owned: 1 },
      { id: '2', title: 'G2', platform: 'Switch', owned: 1 },
      { id: '3', title: 'G3', platform: 'Switch', owned: 1 },
      { id: '4', title: 'G4', platform: 'Switch', owned: 1 },
      { id: '5', title: 'G5', platform: 'Switch', owned: 1 }
    ]);
    httpMock.expectOne('/api/figures').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;
    fixture.detectChanges();

    component.displayLimit.set(2);
    fixture.detectChanges();
    
    const groups = component.groupedGames();
    expect(groups.length).toBe(1);
    expect(groups[0].platformName).toBe('Switch');
    expect(groups[0].games.length).toBe(2); // Only 2 displayed
    expect(groups[0].totalCount).toBe(5); // But total count should be 5
  });

  it('should include sub-platform games when filtering by parent platform', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    
    const initPromise = component.ngOnInit();
    
    // PS4 (id 34), PSVR (id 51, parent 34)
    httpMock.expectOne('/api/games').flush([
      { id: 'ps4-game', title: 'PS4 Game', platform_id: 34, owned: 1, platform: 'PS4' },
      { id: 'psvr-game', title: 'PSVR Game', platform_id: 51, parent_platform_id: 34, owned: 1, platform: 'PSVR' }
    ]);
    httpMock.expectOne('/api/figures').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Filter by PS4
    component.filters.set({ ownership: 'all', platform_id: 34 });
    expect(component.filteredGames().length).toBe(2);
  });

  it('should support exact normalized matching for series', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([
      { id: '1', title: 'N+', canonical_series: 'N', owned: 1, platform: 'PSP' },
      { id: '2', title: 'N++', canonical_series: 'N', owned: 1, platform: 'Switch' },
      { id: '3', title: 'Batman Arkham Knight', canonical_series: 'Batman', owned: 1, platform: 'PS4' }
    ]);
    httpMock.expectOne('/api/figures').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Without exact match, searching "n" should find everything with "n"
    component.filters.set({ ownership: 'all', series: 'n', seriesExact: false });
    // "N" has "n", "Batman" has "n"
    expect(component.filteredGames().length).toBe(3);

    // With exact match, searching "n" should only find games in series "N"
    component.filters.set({ ownership: 'all', series: 'n', seriesExact: true });
    expect(component.filteredGames().length).toBe(2);
    expect(component.filteredGames().every(g => g.canonical_series === 'N')).toBe(true);

    // Should still be case and accent insensitive
    component.filters.set({ ownership: 'all', series: 'N', seriesExact: true });
    expect(component.filteredGames().length).toBe(2);
  });

  it('should filter figures by line, type, and series', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/figures').flush([
      { id: 'f1', name: 'Mario', line: 'amiibo', type: 'Figure', series_name: 'Super Mario', owned: 1 },
      { id: 'f2', name: 'Link', line: 'amiibo', type: 'Figure', series_name: 'Zelda', owned: 1 },
      { id: 'f3', name: 'Isabelle', line: 'amiibo', type: 'Card', series_name: 'Animal Crossing', owned: 0 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Filter by ownership (wanted)
    component.filters.set({ ownership: 'wanted', line: '', type: '', series: '' });
    expect(component.filteredFigures().length).toBe(1);
    expect(component.filteredFigures()[0].name).toBe('Isabelle');

    // Filter by line
    component.filters.set({ ownership: 'all', line: 'amiibo', type: '', series: '' });
    expect(component.filteredFigures().length).toBe(3);

    // Filter by type
    component.filters.set({ ownership: 'all', line: '', type: 'Figure', series: '' });
    expect(component.filteredFigures().length).toBe(2);

    // Filter by series (normalized)
    component.filters.set({ ownership: 'all', line: '', type: '', series: 'super mario' });
    expect(component.filteredFigures().length).toBe(1);
    expect(component.filteredFigures()[0].series_name).toBe('Super Mario');
  });

  it('should group figures correctly with total counts', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/figures').flush([
      { id: '1', name: 'A1', line: 'Line A', owned: 1 },
      { id: '2', name: 'A2', line: 'Line A', owned: 1 },
      { id: '3', name: 'B1', line: 'Line B', owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;
    fixture.detectChanges();

    const groups = component.groupedFigures();
    expect(groups.length).toBe(2);
    expect(groups.find(g => g.lineName === 'Line A')?.totalCount).toBe(2);
    expect(groups.find(g => g.lineName === 'Line B')?.totalCount).toBe(1);
  });

  it('should calculate uniqueSeries from both games and figures', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([
      { id: 'g1', title: 'Game 1', canonical_series: 'Zelda', owned: 1 }
    ]);
    httpMock.expectOne('/api/figures').flush([
      { id: 'f1', name: 'Figure 1', series_name: 'Mario', owned: 1 },
      { id: 'f2', name: 'Figure 2', figure_series: 'Metroid', owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    const series = component.uniqueSeries();
    expect(series).toContain('Zelda');
    expect(series).toContain('Mario');
    expect(series).toContain('Metroid');
    expect(series.length).toBe(3);
  });
});
