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

  describe('shouldDetach', () => {
    it('should return true for games and toys routes', () => {
      expect(strategy.shouldDetach(createSnapshot('games'))).toBe(true);
      expect(strategy.shouldDetach(createSnapshot('toys'))).toBe(true);
    });

    it('should return false for detail, discovery, and other routes', () => {
      expect(strategy.shouldDetach(createSnapshot(':type/:id'))).toBe(false);
      expect(strategy.shouldDetach(createSnapshot('discovery'))).toBe(false);
      expect(strategy.shouldDetach(createSnapshot(''))).toBe(false);
    });
  });

  describe('store and shouldAttach', () => {
    it('should capture window scroll coordinates when storing a detached handle', () => {
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

    it('should remove handle when storing null', () => {
      const handle = createMockHandle();
      strategy.store(createSnapshot('games'), handle);
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(true);

      strategy.store(createSnapshot('games'), null);
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.hasStoredRoute('games')).toBe(false);
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
    it('should clear specific route handle', () => {
      strategy.store(createSnapshot('games'), createMockHandle());
      strategy.store(createSnapshot('toys'), createMockHandle());

      strategy.clearRoute('games');
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.shouldAttach(createSnapshot('toys'))).toBe(true);
    });

    it('should clear all route handles on clearAll', () => {
      strategy.store(createSnapshot('games'), createMockHandle());
      strategy.store(createSnapshot('toys'), createMockHandle());

      strategy.clearAll();
      expect(strategy.shouldAttach(createSnapshot('games'))).toBe(false);
      expect(strategy.shouldAttach(createSnapshot('toys'))).toBe(false);
    });
  });
});
