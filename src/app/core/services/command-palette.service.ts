import { Injectable, signal } from '@angular/core';
import { IconName } from '../../shared/components/icon/icon.catalog';

export interface CommandPaletteRecentRecord {
  id: string;
  title: string;
  subtitle?: string;
  region?: string;
  category: 'Navigation' | 'Quick Filters' | 'Platforms' | 'Games' | 'Toys';
  icon: IconName;
  badge?: string;
  url?: string;
  queryParams?: Record<string, string | number>;
  isResetAction?: boolean;
  timestamp: number;
}

export const PALETTE_RECENTS_STORAGE_KEY = 'collection_tracker_palette_recents';
export const MAX_RECENT_ITEMS = 6;

@Injectable({
  providedIn: 'root',
})
export class CommandPaletteService {
  private _isOpen = signal(false);
  public readonly isOpen = this._isOpen.asReadonly();

  private _recentItems = signal<CommandPaletteRecentRecord[]>(
    this.loadRecents(),
  );
  public readonly recentItems = this._recentItems.asReadonly();

  public open(): void {
    this._isOpen.set(true);
  }

  public close(): void {
    this._isOpen.set(false);
  }

  public toggle(): void {
    this._isOpen.update((v) => !v);
  }

  private loadRecents(): CommandPaletteRecentRecord[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(PALETTE_RECENTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_RECENT_ITEMS);
      }
      return [];
    } catch {
      return [];
    }
  }

  private persistRecents(items: CommandPaletteRecentRecord[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(PALETTE_RECENTS_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Ignore quota errors
    }
  }

  public addRecentItem(
    item: Omit<CommandPaletteRecentRecord, 'timestamp'>,
  ): void {
    const record: CommandPaletteRecentRecord = {
      ...item,
      timestamp: Date.now(),
    };
    const filtered = this._recentItems().filter((r) => r.id !== record.id);
    const updated = [record, ...filtered].slice(0, MAX_RECENT_ITEMS);
    this._recentItems.set(updated);
    this.persistRecents(updated);
  }

  public removeRecentItem(id: string): void {
    const updated = this._recentItems().filter((r) => r.id !== id);
    this._recentItems.set(updated);
    this.persistRecents(updated);
  }

  public clearRecentItems(): void {
    this._recentItems.set([]);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(PALETTE_RECENTS_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
  }
}
