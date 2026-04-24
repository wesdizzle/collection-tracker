import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router, ParamMap } from '@angular/router';
import { of, BehaviorSubject } from 'rxjs';
import { ItemDetailComponent } from './item-detail.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Figure } from '../../../../core/models/collection.models';

/**
 * UNIT TEST: ItemDetailComponent
 * 
 * Verifies that the detail view correctly loads and displays item information.
 * Uses modern Angular 21+ provider-based mocking for HTTP and Routing.
 */
describe('ItemDetailComponent', () => {
  let component: ItemDetailComponent;
  let fixture: ComponentFixture<ItemDetailComponent>;
  let collectionService: CollectionService;
  let router: Router;
  let paramMapSubject: BehaviorSubject<ParamMap>;

  const mockGame: Game = {
    stable_id: 1,
    id: 'super-mario-world-snes',
    title: 'Super Mario World',
    series: 'Mario',
    canonical_series: 'Mario',
    platform: 'SNES',
    platform_id: 19,
    release_date: '1990-11-21',
    image_url: 'mario.jpg',
    genres: 'Platformer',
    summary: 'A classic game.',
    owned: true,
    played: true,
    backed_up: true
  };

  const mockFigure: Figure = {
    id: 'amiibo-1',
    name: 'Mario',
    line: 'amiibo',
    type: 'Figure',
    series_name: 'Super Mario',
    series_line: 'Super Mario',
    release_date: '2014-11-21',
    image_url: 'mario-amiibo.jpg',
    owned: true,
    verified: 1
  };

  beforeEach(async () => {
    paramMapSubject = new BehaviorSubject(convertToParamMap({ id: '1', type: 'game' }));

    await TestBed.configureTestingModule({
      imports: [ItemDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMapSubject.asObservable()
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ItemDetailComponent);
    component = fixture.componentInstance;
    collectionService = TestBed.inject(CollectionService);
    router = TestBed.inject(Router);
    
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(of(mockGame));
    vi.spyOn(collectionService, 'getFigureById').mockReturnValue(of(mockFigure));
    
    fixture.detectChanges();
  });

  it('should load and display game details', async () => {
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.game()).toEqual(mockGame);
    expect(component.formattedDate()).toContain('Wednesday, November 21, 1990');
    
    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('.item-title').textContent).toContain('Super Mario World');
  });

  it('should load and display figure details', async () => {
    paramMapSubject.next(convertToParamMap({ id: 'amiibo-1', type: 'figure' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.figure()).toEqual(mockFigure);
    expect(component.type()).toBe('figure');
    
    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('.item-title').textContent).toContain('Mario');
    expect(compiled.querySelector('.item-series').textContent).toContain('Super Mario');
  });

  it('should navigate to collection with exact series filter', () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    const updateStateSpy = vi.spyOn(collectionService, 'updateListState');

    component.filterBySeries('Mario');

    expect(updateStateSpy).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        series: 'Mario',
        seriesExact: true
      })
    }));
    expect(navigateSpy).toHaveBeenCalledWith(['/collection', 'games']);
  });

  it('should handle missing release dates gracefully', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(of({ ...mockGame, release_date: '' }));
    
    // Force reload
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.formattedDate()).toBeNull();
  });
});
