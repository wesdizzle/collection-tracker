import { Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  BaseRouteReuseStrategy,
  DetachedRouteHandle,
} from '@angular/router';

export interface StoredRouteHandle {
  handle: DetachedRouteHandle;
  scrollX: number;
  scrollY: number;
}

/**
 * COLLECTION ROUTE REUSE STRATEGY
 *
 * Preserves the DOM, reactive state, and scroll position of primary collection
 * list views ('games' and 'toys') when navigating to child detail routes or
 * across tabs.
 *
 * DESIGN RATIONALE:
 * - Preserving the component view eliminates expensive DOM destruction and re-creation
 *   of thousands of collection cards on back navigation.
 * - Restores scroll position instantaneously without race conditions or brittle
 *   requestAnimationFrame retry loops.
 * - Integrates cleanly with reactive signals in CollectionService: mutations
 *   performed in the detail view automatically update the preserved list view.
 */
@Injectable({
  providedIn: 'root',
})
export class CollectionRouteReuseStrategy extends BaseRouteReuseStrategy {
  private readonly storedHandles = new Map<string, StoredRouteHandle>();

  /**
   * Determines if a route should be detached for later reuse.
   * Only the primary collection list views ('games' and 'toys') are preserved.
   */
  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const path = this.getRoutePath(route);
    return path === 'games' || path === 'toys';
  }

  /**
   * Stores the detached route handle along with its current scroll coordinates.
   */
  override store(
    route: ActivatedRouteSnapshot,
    handle: DetachedRouteHandle | null,
  ): void {
    const path = this.getRoutePath(route);
    if (!path) return;

    if (handle) {
      const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
      const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
      this.storedHandles.set(path, { handle, scrollX, scrollY });
    } else {
      this.storedHandles.delete(path);
    }
  }

  /**
   * Determines if a stored route handle is available to be reattached.
   */
  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const path = this.getRoutePath(route);
    return !!path && this.storedHandles.has(path);
  }

  /**
   * Retrieves the stored route handle for reattachment and schedules
   * scroll restoration to the preserved coordinate.
   */
  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const path = this.getRoutePath(route);
    if (!path) return null;

    const stored = this.storedHandles.get(path);
    if (!stored) return null;

    if (typeof window !== 'undefined') {
      const { scrollX, scrollY } = stored;
      // Immediate scroll restore
      window.scrollTo({
        left: scrollX,
        top: scrollY,
        behavior: 'instant' as ScrollBehavior,
      });

      // Frame guard to ensure layout reflow does not clamp the position
      requestAnimationFrame(() => {
        if (window.scrollY !== scrollY) {
          window.scrollTo({
            left: scrollX,
            top: scrollY,
            behavior: 'instant' as ScrollBehavior,
          });
        }
      });
    }

    return stored.handle;
  }

  /**
   * Resets the preserved scroll coordinates for a route back to the top.
   * Used when clicking primary navigation tabs or the brand link.
   */
  public resetScroll(path?: 'games' | 'toys'): void {
    if (path) {
      const stored = this.storedHandles.get(path);
      if (stored) {
        stored.scrollX = 0;
        stored.scrollY = 0;
      }
    } else {
      this.storedHandles.forEach((stored) => {
        stored.scrollX = 0;
        stored.scrollY = 0;
      });
    }
  }

  /**
   * Clears a stored route handle completely.
   * Used when applying franchise series filters or forcing a fresh reload.
   */
  public clearRoute(path: 'games' | 'toys'): void {
    this.storedHandles.delete(path);
  }

  /**
   * Clears all stored route handles.
   */
  public clearAll(): void {
    this.storedHandles.clear();
  }

  /**
   * Returns whether a given route is currently preserved.
   */
  public hasStoredRoute(path: 'games' | 'toys'): boolean {
    return this.storedHandles.has(path);
  }

  /**
   * Returns the stored scroll coordinate for a given route.
   */
  public getStoredScroll(
    path: 'games' | 'toys',
  ): { scrollX: number; scrollY: number } | null {
    const stored = this.storedHandles.get(path);
    if (!stored) return null;
    return { scrollX: stored.scrollX, scrollY: stored.scrollY };
  }

  /**
   * Extracts the identifying path segment from the route snapshot.
   */
  private getRoutePath(route: ActivatedRouteSnapshot): string | null {
    return route.routeConfig?.path || null;
  }
}
