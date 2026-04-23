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
});
