/**
 * COLLECTION SERVICE
 *
 * Central data orchestrator for the Gagglog Collection Tracker.
 * Manages the state of games, toys, and platforms using Angular Signals.
 * Handles API interactions, local state persistence via sessionStorage,
 * and data discovery workflows.
 *
 * DESIGN RATIONALE:
 * - Uses private signals with public read-only views to enforce one-way data flow.
 * - Separates state persistence by 'tab' (games vs toys) to allow independent
 *   browsing contexts.
 * - Utilizes firstValueFrom for async/await compatibility while keeping the
 *   underlying API layer based on RxJS Observables.
 */

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, catchError, of, map } from 'rxjs';
import {
  Game,
  Toy,
  Platform,
  DiscoveryItem,
  DiscoveryPayload,
  ListState,
  PlayStatus,
} from '../models/collection.models';

@Injectable({
  providedIn: 'root',
})
export class CollectionService {
  private http = inject(HttpClient);
  private router = inject(Router);

  /**
   * Persistence state for UI navigation (Split by tab).
   * Stores filters, scroll positions, and display limits.
   */
  private _gamesState = signal<ListState | null>(null);
  private _toysState = signal<ListState | null>(null);

  public readonly gamesState = this._gamesState.asReadonly();
  public readonly toysState = this._toysState.asReadonly();

  /**
   * Initializes the service and restores any saved navigation state from sessionStorage.
   * This ensures that when a user returns from a detail page, their context is restored.
   */
  constructor() {
    if (typeof window !== 'undefined') {
      this.loadPersistedState();
      this.loadLastUpdated();
    }
  }

  /**
   * Hydrates the lastUpdated signal from localStorage.
   */
  private loadLastUpdated() {
    const saved = localStorage.getItem('gagglog_last_updated');
    if (saved) {
      const date = new Date(saved);
      if (!isNaN(date.getTime())) {
        this._lastUpdated.set(date);
      }
    }
  }

  /**
   * Persists the current list state for a specific tab to sessionStorage.
   *
   * @param tab The collection tab to persist ('games' or 'toys').
   */
  public persistState(tab: 'games' | 'toys') {
    const state = tab === 'games' ? this._gamesState() : this._toysState();
    if (state) {
      sessionStorage.setItem(
        `gagglog_list_state_${tab}`,
        JSON.stringify(state),
      );
    }
  }

  /**
   * Updates the in-memory state and immediately persists it.
   *
   * @param state The new state object containing filters and navigation data.
   */
  public updateListState(state: ListState) {
    if (state.tab === 'games') {
      this._gamesState.set(state);
    } else {
      this._toysState.set(state);
    }
    this.persistState(state.tab);
  }

  /**
   * Retrieves the current list state for a specific tab.
   *
   * @param tab The collection tab to query.
   * @returns The current ListState or null if not set.
   */
  public getListState(tab: 'games' | 'toys') {
    return tab === 'games' ? this._gamesState() : this._toysState();
  }

  /**
   * Synchronously loads saved state from sessionStorage.
   * Called during construction to hydrate signals before first render.
   */
  public loadPersistedState() {
    ['games', 'toys'].forEach((tab) => {
      const saved = sessionStorage.getItem(`gagglog_list_state_${tab}`);
      if (saved) {
        try {
          const state = JSON.parse(saved);
          if (tab === 'games') this._gamesState.set(state);
          else this._toysState.set(state);
        } catch (e) {
          console.error(
            `[CollectionService] Failed to parse saved ${tab} state`,
            e,
          );
        }
      }
    });
  }

  /**
   * Clears all persisted and in-memory list state.
   * Useful for "hard refresh" or logout scenarios.
   */
  public resetListState() {
    this._gamesState.set(null);
    this._toysState.set(null);
    sessionStorage.removeItem('gagglog_list_state_games');
    sessionStorage.removeItem('gagglog_list_state_toys');
  }

  private _games = signal<Game[]>([]);
  private _toys = signal<Toy[]>([]);
  private _platforms = signal<Platform[]>([]);
  private _discoveryItems = signal<DiscoveryItem[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _refreshTrigger = signal<number>(0);

  /** --- Public Read-only Signal Views --- */
  public readonly games = this._games.asReadonly();
  public readonly toys = this._toys.asReadonly();
  public readonly platforms = this._platforms.asReadonly();
  public readonly discoveryItems = this._discoveryItems.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly refreshTrigger = this._refreshTrigger.asReadonly();

  /**
   * Timestamp of the last successful server synchronization.
   * Persisted to localStorage to provide context for stale data during offline use.
   */
  private _lastUpdated = signal<Date | null>(null);
  public readonly lastUpdated = this._lastUpdated.asReadonly();

  /**
   * Orchestrates a full refresh of the collection data.
   * Fetches games, toys, and platforms in parallel to minimize load time.
   *
   * WHY: Parallellizing these requests ensures the application shell stays
   * snappy even as the collection grows.
   */
  async refreshAll(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [games, toys, platforms] = await Promise.all([
        firstValueFrom(this.getGames()),
        firstValueFrom(this.getToys()),
        firstValueFrom(this.getPlatforms()),
      ]);
      this._games.set(games);
      this._toys.set(toys);
      this._platforms.set(platforms);
      this._refreshTrigger.update((v) => v + 1);

      // Update sync timestamp if we are reasonably sure we hit the network
      if (typeof window !== 'undefined' && window.navigator.onLine) {
        const now = new Date();
        this._lastUpdated.set(now);
        localStorage.setItem('gagglog_last_updated', now.toISOString());
      }
    } catch (err: unknown) {
      console.error('[CollectionService] Global refresh failed:', err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Failed to load collection data. Please try again later.';
      this._error.set(errorMessage);
    } finally {
      this._loading.set(false);
    }
  }

  /** --- API Tier (Reactive Observables) --- */

  /**
   * Fetches the games collection, optionally filtered by platform.
   */
  getGames(platformId?: number): Observable<Game[]> {
    let url = '/api/games';
    if (platformId) {
      url += `?platform_id=${platformId}`;
    }
    return this.http.get<Game[]>(url).pipe(
      map((games) => games.map((game) => this.enrichGameTitle(game))),
      catchError((err) => {
        console.error('[CollectionService] Error fetching games:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches the entire toys collection.
   */
  getToys(): Observable<Toy[]> {
    return this.http.get<Toy[]>('/api/toys').pipe(
      catchError((err) => {
        console.error('[CollectionService] Error fetching toys:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches the platform metadata list.
   */
  getPlatforms(): Observable<Platform[]> {
    return this.http.get<Platform[]>('/api/platforms').pipe(
      catchError((err) => {
        console.error('[CollectionService] Error fetching platforms:', err);
        return of([]);
      }),
    );
  }

  /**
   * Fetches a single game by its stable identifier.
   */
  getGameById(id: string): Observable<Game> {
    return this.http
      .get<Game>(`/api/games/${id}`)
      .pipe(map((game) => this.enrichGameTitle(game)));
  }

  /**
   * Fetches a single toy by its unique identifier.
   */
  getToyById(id: string): Observable<Toy> {
    return this.http.get<Toy>(`/api/toys/${id}`);
  }

  /**
   * Fetches platform details by its unique identifier.
   */
  getPlatformById(id: number): Observable<Platform> {
    return this.http.get<Platform>(`/api/platforms/${id}`);
  }

  /**
   * Refreshes the list of discovery items (unmatched or suggested items).
   */
  async refreshDiscovery(): Promise<void> {
    try {
      const items = await firstValueFrom(
        this.http.get<DiscoveryItem[]>('/api/discovery'),
      );
      this._discoveryItems.set(items);
    } catch (err) {
      console.error('[CollectionService] Error refreshing discovery:', err);
    }
  }

  /**
   * Applies a discovery match to the database.
   *
   * @param payload The mapping between current local metadata and external ID.
   */
  applyDiscovery(payload: DiscoveryPayload): Observable<unknown> {
    return this.http.post('/api/discovery/apply', payload);
  }

  /**
   * Toggles or updates the 'ownership_status' of a collection item.
   * ONLY functional on local server via proxy.
   */
  toggleOwnership(
    id: string,
    type: 'game' | 'toy',
    status: number,
  ): Observable<unknown> {
    return this.http.post('/api/collection/toggle', {
      id,
      type,
      status,
      field: 'ownership_status',
    });
  }

  /**
   * Updates the 'play_status' of a game.
   */
  updatePlayStatus(id: string, status: PlayStatus): Observable<unknown> {
    return this.http.post('/api/collection/toggle', {
      id,
      type: 'game',
      status,
      field: 'play_status',
    });
  }

  /**
   * Updates the 'backup_status' of a game.
   */
  updateBackupStatus(id: string, status: number): Observable<unknown> {
    return this.http.post('/api/collection/toggle', {
      id,
      type: 'game',
      status,
      field: 'backup_status',
    });
  }

  /**
   * Updates the sort_index for a collection item.
   * ONLY functional on local server via proxy.
   */
  updateSortIndex(
    id: string,
    type: 'game' | 'toy',
    sortIndex: number,
  ): Observable<unknown> {
    return this.http.post('/api/collection/sort', {
      id,
      type,
      sort_index: sortIndex,
    });
  }

  /** --- Global Confirmation Dialog State --- */
  private _dialogState = signal<{
    visible: boolean;
    type: 'confirm' | 'input' | 'options';
    title: string;
    message: string;
    inputValue?: string | number;
    options?: { label: string; value: string | number }[];
    onConfirm?: (value?: string | number) => void;
  }>({ visible: false, type: 'confirm', title: '', message: '' });

  public readonly dialogState = this._dialogState.asReadonly();

  /**
   * Triggers the global confirmation dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param onConfirm Callback function executed when user confirms.
   */
  public showConfirmation(
    title: string,
    message: string,
    onConfirm: () => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'confirm',
      title,
      message,
      onConfirm,
    });
  }

  /**
   * Triggers the global input dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param initialValue Initial value for the input field.
   * @param onConfirm Callback function executed when user confirms.
   */
  public showInput(
    title: string,
    message: string,
    initialValue: string | number,
    onConfirm: (value: string | number) => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'input',
      title,
      message,
      inputValue: initialValue,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  /**
   * Triggers the global options dialog.
   *
   * @param title Dialog title.
   * @param message Dialog message.
   * @param options Array of options to present.
   * @param onConfirm Callback function executed when user selects an option.
   */
  public showOptions(
    title: string,
    message: string,
    options: { label: string; value: string | number }[],
    onConfirm: (value: string | number) => void,
  ) {
    this._dialogState.set({
      visible: true,
      type: 'options',
      title,
      message,
      options,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  /**
   * Closes the global confirmation dialog.
   */
  public closeDialog() {
    this._dialogState.set({ ...this._dialogState(), visible: false });
  }

  /**
   * Enriches a game object by overriding its title with the clean ROM filename
   * (excluding the file extension) when a verified backup rom_name is present.
   * This ensures the ROM filename is displayed in the UI and used for search filters.
   *
   * @param game The source Game object to enrich.
   * @returns A new Game object with the title updated if a ROM name is present.
   */
  private enrichGameTitle(game: Game): Game {
    if (game.rom_name) {
      const lastDot = game.rom_name.lastIndexOf('.');
      let name =
        lastDot > 0 ? game.rom_name.substring(0, lastDot) : game.rom_name;

      // Remove all parentheses and square brackets except when containing "Bonus Disc"
      name = name.replace(/\(([^)]+)\)|\[([^\]]+)\]/g, (match) => {
        if (/\bBonus\s+Disc\b/i.test(match)) {
          return '(Bonus Disc)';
        }
        return '';
      });

      // Strip disc indicators outside brackets
      name = name.replace(/\b-\s*disc\s+[0-9a-z]\b|\bdisc\s+[0-9a-z]\b/gi, '');

      // Collapse whitespace and trim
      name = name.replace(/\s+/g, ' ').trim();

      const cleanTitle = name || game.title;
      return {
        ...game,
        title: cleanTitle,
      };
    }
    return game;
  }
}
