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
    service.listState = mockState;
    
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
});
