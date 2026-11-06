import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { CollectionRouteReuseStrategy } from './collection-route-reuse-strategy';

describe('CollectionRouteReuseStrategy', () => {
  let strategy: CollectionRouteReuseStrategy;

  const createSnapshot = (path: string): ActivatedRouteSnapshot => {
    return {
      routeConfig: { path },
    } as unknown as ActivatedRouteSnapshot;
  };

  const createMockHandle = (): DetachedRouteHandle => {
    return {} as unknown as DetachedRouteHandle;
  };

  beforeEach(() => {
    strategy = new CollectionRouteReuseStrategy();

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
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set history.scrollRestoration to manual if supported', () => {
      Object.defineProperty(window.history, 'scrollRestoration', {
        value: 'auto',
        writable: true,
        configurable: true,
      });
      new CollectionRouteReuseStrategy();
      expect(window.history.scrollRestoration).toBe('manual');
    });
  });

  describe('shouldDetach', () => {
    it('should return true for games and toys routes and capture current scroll', () => {
      Object.defineProperty(window, 'scrollY', { value: 2350 });
      Object.defineProperty(window, 'scrollX', { value: 10 });

      expect(strategy.shouldDetach(createSnapshot('games'))).toBe(true);
      expect(strategy.shouldDetach(createSnapshot('toys'))).toBe(true);

      // Now simulate outlet detach where window scroll collapses to 0
      Object.defineProperty(window, 'scrollY', { value: 0 });
      Object.defineProperty(window, 'scrollX', { value: 0 });

      // Storing after detachment should still retain the captured scroll
      strategy.store(createSnapshot('games'), createMockHandle());
      expect(strategy.getStoredScroll('games')).toEqual({
        scrollX: 10,
        scrollY: 2350,
      });
    });

    it('should return false for detail, discovery, and other routes', () => {
      expect(strategy.shouldDetach(createSnapshot(':type/:id'))).toBe(false);
      expect(strategy.shouldDetach(createSnapshot('discovery'))).toBe(false);
      expect(strategy.shouldDetach(createSnapshot(''))).toBe(false);
      expect(strategy.shouldDetach(createSnapshot('u/alice/games/123'))).toBe(
        false,
      );
      expect(strategy.shouldDetach(createSnapshot('u/alice/games'))).toBe(true);
      expect(strategy.shouldDetach(createSnapshot('collection/toys'))).toBe(
        true,
      );
    });
  });

  describe('store and shouldAttach', () => {
    it('should capture window scroll coordinates when storing a detached handle directly', () => {
      Object.defineProperty(window, 'scrollY', { value: 1450 });
      Object.defineProperty(window, 'scrollX', { value: 0 });

      const handle = createMockHandle();
      strategy.store(createSnapshot('games'), handle);

      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(true);
      expect(strategy.hasStoredRoute('games')).toBe(true);
      expect(strategy.getStoredScroll('games')).toEqual({
        scrollX: 0,
        scrollY: 1450,
      });
    });

    it('should remove handle without destroying its live componentRef when Angular Router stores null on reattach', () => {
      const destroySpy = vi.fn();
      const handle = {
        componentRef: { destroy: destroySpy },
      } as unknown as DetachedRouteHandle;
      strategy.store(createSnapshot('games'), handle);
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(true);

      const retrieved = strategy.retrieve(createSnapshot('games'));
      expect(retrieved).toBe(handle);

      // Angular Router calls store(snapshot, null) right after retrieve() and before outlet.attach()
      strategy.store(createSnapshot('games'), null);
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.hasStoredRoute('games')).toBe(false);
      expect(destroySpy).not.toHaveBeenCalled();
    });

    it('should destroy previous componentRef when replacing a stored handle with a new one', () => {
      const destroyFirstSpy = vi.fn();
      const firstHandle = {
        componentRef: { destroy: destroyFirstSpy },
      } as unknown as DetachedRouteHandle;
      const secondHandle = createMockHandle();

      strategy.store(createSnapshot('games'), firstHandle);
      strategy.store(createSnapshot('games'), secondHandle);

      expect(destroyFirstSpy).toHaveBeenCalledTimes(1);
      expect(strategy.retrieve(createSnapshot('games'))).toBe(secondHandle);
    });
  });

  describe('retrieve', () => {
    it('should return null if route handle is not stored', () => {
      expect(strategy.retrieve(createSnapshot('games'))).toBeNull();
    });

    it('should return stored handle and restore scroll coordinates', async () => {
      Object.defineProperty(window, 'scrollY', { value: 820 });
      const handle = createMockHandle();
      strategy.store(createSnapshot('games'), handle);

      const scrollToSpy = vi
        .spyOn(window, 'scrollTo')
        .mockImplementation(() => {});

      const retrieved = strategy.retrieve(createSnapshot('games'));
      expect(retrieved).toBe(handle);

      expect(scrollToSpy).toHaveBeenCalledWith({
        left: 0,
        top: 820,
        behavior: 'instant',
      });
    });
  });

  describe('resetScroll', () => {
    it('should reset scroll coordinates for a specific tab', () => {
      Object.defineProperty(window, 'scrollY', { value: 1200 });
      strategy.store(createSnapshot('games'), createMockHandle());
      strategy.store(createSnapshot('toys'), createMockHandle());

      strategy.resetScroll('games');

      expect(strategy.getStoredScroll('games')).toEqual({
        scrollX: 0,
        scrollY: 0,
      });
      expect(strategy.getStoredScroll('toys')).toEqual({
        scrollX: 0,
        scrollY: 1200,
      });
    });

    it('should reset scroll coordinates for all stored tabs when no path specified', () => {
      Object.defineProperty(window, 'scrollY', { value: 1200 });
      strategy.store(createSnapshot('games'), createMockHandle());
      strategy.store(createSnapshot('toys'), createMockHandle());

      strategy.resetScroll();

      expect(strategy.getStoredScroll('games')).toEqual({
        scrollX: 0,
        scrollY: 0,
      });
      expect(strategy.getStoredScroll('toys')).toEqual({
        scrollX: 0,
        scrollY: 0,
      });
    });
  });

  describe('clearRoute and clearAll', () => {
    it('should clear specific route handle and destroy its componentRef', () => {
      const destroyGamesSpy = vi.fn();
      const destroyToysSpy = vi.fn();
      strategy.store(createSnapshot('games'), {
        componentRef: { destroy: destroyGamesSpy },
      } as unknown as DetachedRouteHandle);
      strategy.store(createSnapshot('toys'), {
        componentRef: { destroy: destroyToysSpy },
      } as unknown as DetachedRouteHandle);

      strategy.clearRoute('games');
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.shouldAttach(createSnapshot('toys'))).toBe(true);
      expect(destroyGamesSpy).toHaveBeenCalledTimes(1);
      expect(destroyToysSpy).not.toHaveBeenCalled();
    });

    it('should clear all route handles and destroy all componentRefs on clearAll', () => {
      const destroyGamesSpy = vi.fn();
      const destroyToysSpy = vi.fn();
      strategy.store(createSnapshot('games'), {
        componentRef: { destroy: destroyGamesSpy },
      } as unknown as DetachedRouteHandle);
      strategy.store(createSnapshot('toys'), {
        componentRef: { destroy: destroyToysSpy },
      } as unknown as DetachedRouteHandle);

      strategy.clearAll();
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.shouldAttach(createSnapshot('toys'))).toBe(false);
      expect(destroyGamesSpy).toHaveBeenCalledTimes(1);
      expect(destroyToysSpy).toHaveBeenCalledTimes(1);
    });
  });
});
