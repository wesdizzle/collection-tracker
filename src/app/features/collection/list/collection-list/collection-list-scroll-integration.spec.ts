import '../../../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { CollectionListComponent } from './collection-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { ListState } from '../../../../core/models/collection.models';

describe('CollectionListComponent - DOM Scroll Restoration Integration', () => {
  let component: CollectionListComponent;
  let fixture: ComponentFixture<CollectionListComponent>;
  let httpMock: HttpTestingController;
  let collectionService: CollectionService;

  beforeEach(async () => {
    // Mock IntersectionObserver for JSDOM
    class MockIntersectionObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: MockIntersectionObserver,
    });

    await TestBed.configureTestingModule({
      imports: [CollectionListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { url: [{ path: 'games' }] },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionListComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    collectionService = TestBed.inject(CollectionService);

    collectionService.resetListState();

    Object.defineProperty(window, 'scrollY', {
      value: 0,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'scrollX', {
      value: 0,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    fixture.destroy();
    httpMock.match(() => true).forEach((req) => req.flush([]));
    vi.restoreAllMocks();
  });

  it('should restore scroll position without spurious loadMore triggers or displayLimit mutations during initialization', async () => {
    // 1. Seed saved state
    const savedState: ListState = {
      tab: 'games',
      filters: { ownership: 'all' },
      displayLimit: 100,
      scrollX: 0,
      scrollY: 800,
    };
    collectionService.updateListState(savedState);

    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation((opts?: ScrollToOptions | number, y?: number) => {
        if (typeof opts === 'object' && opts !== null) {
          Object.defineProperty(window, 'scrollY', {
            value: opts.top || 0,
            configurable: true,
          });
        } else if (typeof y === 'number') {
          Object.defineProperty(window, 'scrollY', {
            value: y,
            configurable: true,
          });
        }
      });

    // 2. Initialize component
    const initPromise = component.ngOnInit();

    // Flush all HTTP requests
    httpMock.match(() => true).forEach((req) => req.flush([]));

    await initPromise;
    fixture.detectChanges();

    // Verify displayLimit was correctly hydrated upfront from saved state
    expect(component.displayLimit()).toBe(100);

    // Verify window.scrollTo was called with top: 800
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ top: 800, left: 0 }),
    );
  });

  it('should not call scrollTo if target scrollY is 0', async () => {
    const savedState: ListState = {
      tab: 'games',
      filters: { ownership: 'all' },
      displayLimit: 100,
      scrollX: 0,
      scrollY: 0,
    };
    collectionService.updateListState(savedState);

    const scrollToSpy = vi.spyOn(window, 'scrollTo');

    const initPromise = component.ngOnInit();
    httpMock.match(() => true).forEach((req) => req.flush([]));
    await initPromise;
    fixture.detectChanges();

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('should reset tab scroll to 0 when resetTabScroll is called', () => {
    const savedState: ListState = {
      tab: 'games',
      filters: { ownership: 'all' },
      displayLimit: 100,
      scrollX: 0,
      scrollY: 800,
    };
    collectionService.updateListState(savedState);
    expect(collectionService.getListState('games')?.scrollY).toBe(800);

    collectionService.resetTabScroll('games');
    expect(collectionService.getListState('games')?.scrollY).toBe(0);
  });
});
