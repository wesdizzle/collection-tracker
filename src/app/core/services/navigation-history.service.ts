import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Location } from '@angular/common';
import { filter } from 'rxjs/operators';

/**
 * NAVIGATION HISTORY SERVICE
 *
 * Tracks in-app route transitions to manage history stack integrity.
 * Distinguishes between internal multi-page sessions (where popping history
 * via Location.back() is safe) and direct deep-link or fresh-tab entries
 * (where back navigation must fall back to a safe route without exiting the app).
 */
@Injectable({
  providedIn: 'root',
})
export class NavigationHistoryService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private navigationCount = 0;

  constructor() {
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
      )
      .subscribe(() => {
        this.navigationCount++;
      });
  }

  /**
   * Indicates whether the user has navigated at least once within this application session.
   */
  public hasInternalHistory(): boolean {
    return this.navigationCount > 1;
  }

  /**
   * Returns the count of completed navigations observed in this session.
   */
  public getNavigationCount(): number {
    return this.navigationCount;
  }

  /**
   * Navigates back by popping the browser history stack if internal history exists,
   * or falls back to replacing the current URL with the provided fallback URL.
   *
   * @param fallbackUrl Route segments to navigate to if no prior internal history exists.
   */
  public back(fallbackUrl: string[] = ['/collection', 'games']): void {
    if (this.hasInternalHistory()) {
      this.location.back();
    } else {
      this.router.navigate(fallbackUrl, { replaceUrl: true });
    }
  }

  /**
   * Resets internal navigation count. Primarily used for unit testing isolation.
   */
  public resetCountForTesting(count = 0): void {
    this.navigationCount = count;
  }
}
