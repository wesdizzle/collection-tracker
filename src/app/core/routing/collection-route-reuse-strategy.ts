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
  private readonly pendingScroll = new Map<
    string,
    { scrollX: number; scrollY: number }
  >();

  constructor() {
    super();
    if (
      typeof window !== 'undefined' &&
      'scrollRestoration' in window.history
    ) {
      window.history.scrollRestoration = 'manual';
    }
  }

  /**
   * Determines if a route should be detached for later reuse.
   * Only the primary collection list views ('games' and 'toys') are preserved.
   *
   * Crucially, this is called BEFORE Angular's RouterOutlet detaches the component
   * view from the DOM. Capturing window.scrollX and window.scrollY here records the
   * true scroll coordinates before the document collapses to 0 height.
   */
  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    if (this.isCollectionListView(key)) {
      if (typeof window !== 'undefined') {
        this.pendingScroll.set(key!, {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Stores the detached route handle along with its preserved scroll coordinates.
   */
  override store(
    route: ActivatedRouteSnapshot,
    handle: DetachedRouteHandle | null,
  ): void {
    const key = this.getRouteKey(route);
    if (!key) return;

    if (handle) {
      const pending = this.pendingScroll.get(key);
      const scrollX =
        pending?.scrollX ??
        (typeof window !== 'undefined' ? window.scrollX : 0);
      const scrollY =
        pending?.scrollY ??
        (typeof window !== 'undefined' ? window.scrollY : 0);
      this.pendingScroll.delete(key);
      this.storedHandles.set(key, { handle, scrollX, scrollY });
    } else {
      this.storedHandles.delete(key);
      this.pendingScroll.delete(key);
    }
  }

  /**
   * Determines if a stored route handle is available to be reattached.
   */
  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    return !!key && this.storedHandles.has(key);
  }

  /**
   * Retrieves the stored route handle for reattachment and schedules
   * scroll restoration to the preserved coordinate.
   *
   * Note: The component view is reattached to the DOM synchronously right AFTER
   * retrieve() returns. We schedule restoration across animation frames to guarantee
   * the host elements are mounted and reflowed before restoring scroll.
   */
  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.getRouteKey(route);
    if (!key) return null;

    const stored = this.storedHandles.get(key);
    if (!stored) return null;

    if (typeof window !== 'undefined') {
      const { scrollX, scrollY } = stored;
      // Immediate attempt in case the DOM is already sized
      window.scrollTo({
        left: scrollX,
        top: scrollY,
        behavior: 'instant' as ScrollBehavior,
      });

      // Frame 1: Restore scroll as soon as the outlet attaches the hostView to the DOM
      requestAnimationFrame(() => {
        window.scrollTo({
          left: scrollX,
          top: scrollY,
          behavior: 'instant' as ScrollBehavior,
        });

        // Frame 2: Guard against any post-attachment micro-reflows
        requestAnimationFrame(() => {
          if (window.scrollY !== scrollY) {
            window.scrollTo({
              left: scrollX,
              top: scrollY,
              behavior: 'instant' as ScrollBehavior,
            });
          }
        });
      });
    }

    return stored.handle;
  }

  /**
   * Resets the preserved scroll coordinates for a route back to the top.
   * Used when clicking primary navigation tabs or the brand link.
   */
  public resetScroll(path?: 'games' | 'toys' | string): void {
    if (path) {
      this.storedHandles.forEach((stored, key) => {
        if (key === path || key.endsWith(`/${path}`)) {
          stored.scrollX = 0;
          stored.scrollY = 0;
        }
      });
      this.pendingScroll.forEach((_, key) => {
        if (key === path || key.endsWith(`/${path}`)) {
          this.pendingScroll.delete(key);
        }
      });
    } else {
      this.storedHandles.forEach((stored) => {
        stored.scrollX = 0;
        stored.scrollY = 0;
      });
      this.pendingScroll.clear();
    }
  }

  /**
   * Clears a stored route handle completely.
   * Used when applying franchise series filters or forcing a fresh reload.
   */
  public clearRoute(path: 'games' | 'toys' | string): void {
    this.storedHandles.forEach((_, key) => {
      if (key === path || key.endsWith(`/${path}`)) {
        this.storedHandles.delete(key);
      }
    });
    this.pendingScroll.forEach((_, key) => {
      if (key === path || key.endsWith(`/${path}`)) {
        this.pendingScroll.delete(key);
      }
    });
  }

  /**
   * Clears all stored route handles.
   */
  public clearAll(): void {
    this.storedHandles.clear();
    this.pendingScroll.clear();
  }

  /**
   * Returns whether a given route is currently preserved.
   */
  public hasStoredRoute(path: 'games' | 'toys' | string): boolean {
    if (this.storedHandles.has(path)) return true;
    for (const key of this.storedHandles.keys()) {
      if (key.endsWith(`/${path}`)) return true;
    }
    return false;
  }

  /**
   * Returns the stored scroll coordinate for a given route.
   */
  public getStoredScroll(
    path: 'games' | 'toys' | string,
  ): { scrollX: number; scrollY: number } | null {
    const direct = this.storedHandles.get(path);
    if (direct) return { scrollX: direct.scrollX, scrollY: direct.scrollY };
    for (const [key, stored] of this.storedHandles.entries()) {
      if (key.endsWith(`/${path}`)) {
        return { scrollX: stored.scrollX, scrollY: stored.scrollY };
      }
    }
    return null;
  }

  private isCollectionListView(key: string | null): boolean {
    if (!key) return false;
    return (
      key === 'games' ||
      key === 'toys' ||
      key.endsWith('/games') ||
      key.endsWith('/toys')
    );
  }

  /**
   * Extracts the identifying path segment from the route snapshot.
   * Resolves the full URL path from root (e.g. 'u/alice/games' vs 'collection/games')
   * to prevent collisions across public profiles and primary collection lists.
   */
  private getRouteKey(route: ActivatedRouteSnapshot): string | null {
    if (route.pathFromRoot && route.pathFromRoot.length > 0) {
      const fullPath = route.pathFromRoot
        .map(
          (it) => it.url?.map((segment) => segment.toString()).join('/') || '',
        )
        .filter((it) => it.length > 0)
        .join('/');
      if (fullPath) return fullPath;
    }
    return route.routeConfig?.path || null;
  }
}
