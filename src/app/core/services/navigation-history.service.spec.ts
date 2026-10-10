import '../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { Location } from '@angular/common';
import { Subject } from 'rxjs';
import { NavigationHistoryService } from './navigation-history.service';

describe('NavigationHistoryService', () => {
  let service: NavigationHistoryService;
  let routerEvents$: Subject<unknown>;
  let mockLocation: { back: ReturnType<typeof vi.fn> };
  let mockRouter: {
    events: Subject<unknown>;
    navigate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    routerEvents$ = new Subject();
    mockLocation = {
      back: vi.fn(),
    };
    mockRouter = {
      events: routerEvents$,
      navigate: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        NavigationHistoryService,
        { provide: Router, useValue: mockRouter },
        { provide: Location, useValue: mockLocation },
      ],
    });

    service = TestBed.inject(NavigationHistoryService);
  });

  it('should track NavigationEnd events and correctly update hasInternalHistory', () => {
    expect(service.getNavigationCount()).toBe(0);
    expect(service.hasInternalHistory()).toBe(false);

    // First navigation (e.g. initial landing page)
    routerEvents$.next(
      new NavigationEnd(1, '/collection/games', '/collection/games'),
    );
    expect(service.getNavigationCount()).toBe(1);
    expect(service.hasInternalHistory()).toBe(false);

    // Second navigation (e.g. clicked item card)
    routerEvents$.next(
      new NavigationEnd(2, '/collection/game/1', '/collection/game/1'),
    );
    expect(service.getNavigationCount()).toBe(2);
    expect(service.hasInternalHistory()).toBe(true);
  });

  it('should call location.back() when internal history exists', () => {
    service.resetCountForTesting(2);
    expect(service.hasInternalHistory()).toBe(true);

    service.back(['/collection', 'games']);

    expect(mockLocation.back).toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should fallback to router.navigate with replaceUrl when no internal history exists', () => {
    service.resetCountForTesting(1);
    expect(service.hasInternalHistory()).toBe(false);

    service.back(['/collection', 'toys']);

    expect(mockLocation.back).not.toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/collection', 'toys'], {
      replaceUrl: true,
    });
  });

  it('should use default fallback url when no arguments are provided to back()', () => {
    service.resetCountForTesting(0);

    service.back();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/collection', 'games'], {
      replaceUrl: true,
    });
  });
});
