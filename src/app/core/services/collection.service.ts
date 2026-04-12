import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Game {
    id: string;
    title: string;
    series: string;
    release_date: string;
    platform: string;
    owned: boolean | number;
    queued: boolean | number;
    image_url: string;
    platform_launch_date?: string;
    brand?: string;
}

export interface Figure {
    id: string;
    name: string;
    line: string;
    series_name: string;
    series_line: string;
    release_date: string;
    owned: boolean | number;
    image_url: string;
}

export interface Platform {
    id: number;
    name: string;
    brand: string;
    launch_date: string;
    image_url: string;
}

@Injectable({
  providedIn: 'root'
})
export class CollectionService {
  public listState: any = null;
  private http = inject(HttpClient);

  getGames(platform?: string): Observable<Game[]> {
    let url = '/api/games';
    if (platform) {
      url += `?platform=${encodeURIComponent(platform)}`;
    }
    return this.http.get<Game[]>(url);
  }

  getFigures(): Observable<Figure[]> {
    return this.http.get<Figure[]>('/api/figures');
  }

  getPlatforms(): Observable<Platform[]> {
    return this.http.get<Platform[]>('/api/platforms');
  }

  getGameById(id: string): Observable<Game> { return this.http.get<Game>(`/api/games/${id}`); }
  getFigureById(id: string): Observable<Figure> { return this.http.get<Figure>(`/api/figures/${id}`); }
  getPlatformById(id: string): Observable<Platform> { return this.http.get<Platform>(`/api/platforms/${id}`); }
}
