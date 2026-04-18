import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { Game, Figure, Platform, DiscoveryItem, DiscoveryPayload, ListState } from '../models/collection.models';

@Injectable({
  providedIn: 'root'
})
/**
 * COLLECTION DATA SERVICE (SIGNALS-FIRST)
 * 
 * This service manages the state and retrieval of the user's game and figure 
 * collection. It utilizes Angular Signals for high-performance reactive 
 * delivery to UI components.
 */
export class CollectionService {
  private http = inject(HttpClient);
  private router = inject(Router);
  
  // Persistence state for UI navigation
  public listState: ListState | null = null;

  constructor() {}

  public persistState() {
    if (this.listState) {
      sessionStorage.setItem('gagglog_list_state', JSON.stringify(this.listState));
    }
  }

  public updateListState(state: ListState) {
    this.listState = state;
    this.persistState();
  }

  public loadPersistedState() {
    const saved = sessionStorage.getItem('gagglog_list_state');
    if (saved) {
      try {
        this.listState = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved list state', e);
      }
    }
  }

  // Core Collection Signals
  private _games = signal<Game[]>([]);
  private _figures = signal<Figure[]>([]);
  private _platforms = signal<Platform[]>([]);
  private _discoveryItems = signal<DiscoveryItem[]>([]);
  private _loading = signal<boolean>(false);

  // Public Read-only Signals
  public readonly games = this._games.asReadonly();
  public readonly figures = this._figures.asReadonly();
  public readonly platforms = this._platforms.asReadonly();
  public readonly discoveryItems = this._discoveryItems.asReadonly();
  public readonly loading = this._loading.asReadonly();

  /**
   * REFRESH LOGIC
   * We pull fresh data from the API and update the signals.
   */
  async refreshAll(): Promise<void> {
    this._loading.set(true);
    try {
      const [games, figures, platforms] = await Promise.all([
        firstValueFrom(this.getGames()),
        firstValueFrom(this.getFigures()),
        firstValueFrom(this.getPlatforms())
      ]);
      this._games.set(games);
      this._figures.set(figures);
      this._platforms.set(platforms);
    } finally {
      this._loading.set(false);
    }
  }

  // --- API Tier (Observables) ---

  getGames(platformId?: number): Observable<Game[]> {
    let url = '/api/games';
    if (platformId) {
      url += `?platform_id=${platformId}`;
    }
    return this.http.get<Game[]>(url);
  }

  getFigures(): Observable<Figure[]> {
    return this.http.get<Figure[]>('/api/figures');
  }

  getPlatforms(): Observable<Platform[]> {
    return this.http.get<Platform[]>('/api/platforms');
  }

  getGameById(id: string): Observable<Game> { 
    return this.http.get<Game>(`/api/games/${id}`); 
  }
  
  getFigureById(id: string): Observable<Figure> { 
    return this.http.get<Figure>(`/api/figures/${id}`); 
  }
  
  getPlatformById(id: number): Observable<Platform> { 
    return this.http.get<Platform>(`/api/platforms/${id}`); 
  }

  async refreshDiscovery(): Promise<void> {
    const items = await firstValueFrom(this.http.get<DiscoveryItem[]>('/api/discovery'));
    this._discoveryItems.set(items);
  }

  applyDiscovery(payload: DiscoveryPayload): Observable<unknown> {
    return this.http.post('/api/discovery/apply', payload);
  }
}
