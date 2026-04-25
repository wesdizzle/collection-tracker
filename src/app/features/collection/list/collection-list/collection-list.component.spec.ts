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
 * games or toys fetched from the API layer.
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
    httpMock.expectOne('/api/toys').flush([]);
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
    const reqToys = httpMock.expectOne('/api/toys');
    reqToys.flush([]);
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
    httpMock.expectOne('/api/toys').flush([]);
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
    httpMock.expectOne('/api/toys').flush([]);
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
    httpMock.expectOne('/api/toys').flush([]);
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
    httpMock.expectOne('/api/toys').flush([]);
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

  it('should filter toys by line, type, and series', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/toys').flush([
      { id: 'f1', name: 'Mario', line: 'amiibo', type: 'Figure', series_name: 'Super Mario', owned: 1 },
      { id: 'f2', name: 'Link', line: 'amiibo', type: 'Figure', series_name: 'Zelda', owned: 1 },
      { id: 'f3', name: 'Isabelle', line: 'amiibo', type: 'Card', series_name: 'Animal Crossing', owned: 0 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Filter by ownership (wanted)
    component.filters.set({ ownership: 'wanted', line: '', type: '', series: '' });
    expect(component.filteredToys().length).toBe(1);
    expect(component.filteredToys()[0].name).toBe('Isabelle');

    // Filter by line
    component.filters.set({ ownership: 'all', line: 'amiibo', type: '', series: '' });
    expect(component.filteredToys().length).toBe(3);

    // Filter by type
    component.filters.set({ ownership: 'all', line: '', type: 'Figure', series: '' });
    expect(component.filteredToys().length).toBe(2);

    // Filter by series (normalized)
    component.filters.set({ ownership: 'all', line: '', type: '', series: 'super mario' });
    expect(component.filteredToys().length).toBe(1);
    expect(component.filteredToys()[0].series_name).toBe('Super Mario');
  });

  it('should group toys correctly with total counts', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/toys').flush([
      { id: '1', name: 'A1', line: 'Line A', owned: 1 },
      { id: '2', name: 'A2', line: 'Line A', owned: 1 },
      { id: '3', name: 'B1', line: 'Line B', owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;
    fixture.detectChanges();

    const groups = component.groupedToys();
    expect(groups.length).toBe(2);
    expect(groups.find(g => g.lineName === 'Line A')?.totalCount).toBe(2);
    expect(groups.find(g => g.lineName === 'Line B')?.totalCount).toBe(1);
  });

  it('should sort games strictly by platform launch, brand, series, release date, and sort index', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([
      { id: 'g1', title: 'The Legend of Zelda', canonical_series: 'The Legend of Zelda', release_date: '2020-01-01', sort_index: 1, platform: 'P1', platform_launch_date: '2000-01-01', brand: 'Nintendo', owned: 1 },
      { id: 'g2', title: 'Metroid', canonical_series: 'Metroid', release_date: '2020-01-01', sort_index: 1, platform: 'P1', platform_launch_date: '2000-01-01', brand: 'Nintendo', owned: 1 },
      { id: 'g3', title: 'Pokémon', canonical_series: 'Pokémon', release_date: '2020-01-01', sort_index: 1, platform: 'P1', platform_launch_date: '2000-01-01', brand: 'Nintendo', owned: 1 },
      { id: 'g4', title: 'Game D', canonical_series: 'Series A', release_date: '2020-01-01', sort_index: 1, platform: 'P2', platform_launch_date: '1995-01-01', brand: 'Sega', owned: 1 },
      { id: 'g5', title: 'Game E', canonical_series: 'Series A', release_date: '2020-01-01', sort_index: 1, platform: 'P1', platform_launch_date: '2000-01-01', brand: 'Apple', owned: 1 }
    ]);
    httpMock.expectOne('/api/toys').flush([]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    const games = component.filteredGames();
    // 1. Platform Launch Date: g4 (1995) comes first
    expect(games[0].id).toBe('g4');
    // 2. Brand: g5 (Apple) comes before g1/g2/g3 (Nintendo) because both launched in 2000
    expect(games[1].id).toBe('g5');
    // 3. Series (Normalized):
    // "The Legend of Zelda" -> "legend of zelda"
    // "Metroid" -> "metroid"
    // "Pokémon" -> "pokemon"
    // "Series A" -> "series a"
    // Order: legend of zelda (g1), metroid (g2), pokemon (g3), series a (from g5)
    expect(games[2].id).toBe('g1'); // L
    expect(games[3].id).toBe('g2'); // M
    expect(games[4].id).toBe('g3'); // P
  });

  it('should sort toys strictly by line, series, release date, and sort index', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    component.currentTab.set('toys');
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/toys').flush([
      { id: 't1', name: 'Toy 1', line: 'The Line B', series_name: 'Series A', release_date: '2020-01-01', sort_index: 1, owned: 1 },
      { id: 't2', name: 'Toy 2', line: 'A Line A', series_name: 'The Series B', release_date: '2020-01-01', sort_index: 1, owned: 1 },
      { id: 't3', name: 'Toy 3', line: 'Line A', series_name: 'An Series A', release_date: '2021-01-01', sort_index: 1, owned: 1 },
      { id: 't4', name: 'Toy 4', line: 'Line A', series_name: 'Series A', release_date: '2020-01-01', sort_index: 2, owned: 1 },
      { id: 't5', name: 'Toy 5', line: 'Line A', series_name: 'Series A', release_date: '2020-01-01', sort_index: 1, owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    const toys = component.filteredToys();
    // 1. Line (Normalized): 
    // "A Line A" -> "line a"
    // "Line A" -> "line a"
    // "The Line B" -> "line b"
    // Line A group: t2, t3, t4, t5. Line B group: t1
    expect(toys[4].id).toBe('t1');

    // 2. Series (Normalized) within Line A:
    // "The Series B" (t2) -> "series b"
    // "An Series A" (t3) -> "series a"
    // "Series A" (t4/t5) -> "series a"
    // Series A group: t3, t4, t5. Series B group: t2
    expect(toys[3].id).toBe('t2');

    // 3. Release Date within Series A: t4/t5 (2020) vs t3 (2021)
    expect(toys[2].id).toBe('t3');

    // 4. Sort Index within 2020: t5 (1) vs t4 (2)
    expect(toys[0].id).toBe('t5');
    expect(toys[1].id).toBe('t4');
  });

  it('should calculate uniqueSeries based on the active tab', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([
      { id: 'g1', title: 'Game 1', canonical_series: 'Zelda', owned: 1 }
    ]);
    httpMock.expectOne('/api/toys').flush([
      { id: 'f1', name: 'Toy 1', series_name: 'Mario', owned: 1 },
      { id: 'f2', name: 'Toy 2', series_name: 'Metroid', owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    // Default tab is 'games'
    let series = component.uniqueSeries();
    expect(series).toContain('Zelda');
    expect(series).not.toContain('Mario');
    expect(series.length).toBe(1);

    // Switch to 'toys'
    component.currentTab.set('toys');
    series = component.uniqueSeries();
    expect(series).not.toContain('Zelda');
    expect(series).toContain('Mario');
    expect(series).toContain('Metroid');
    expect(series.length).toBe(2);
  });

  it('should sort dropdown options using normalized logic', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const initPromise = component.ngOnInit();
    
    httpMock.expectOne('/api/games').flush([]);
    httpMock.expectOne('/api/toys').flush([
      { id: 't1', line: 'amiibo', owned: 1 },
      { id: 't2', line: 'LEGO', owned: 1 },
      { id: 't3', line: 'The Black Series', owned: 1 }
    ]);
    httpMock.expectOne('/api/platforms').flush([]);
    
    await initPromise;

    const lines = component.uniqueLines();
    // Normalized for sort:
    // "amiibo" -> "amiibo" (A)
    // "LEGO" -> "lego" (L)
    // "The Black Series" -> "black series" (B)
    // Correct Order: amiibo (A), The Black Series (B), LEGO (L)
    expect(lines[0]).toBe('amiibo');
    expect(lines[1]).toBe('The Black Series');
    expect(lines[2]).toBe('LEGO');
  });
});
