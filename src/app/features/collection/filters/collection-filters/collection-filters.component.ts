import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Platform } from '../../../../core/services/collection.service';

export interface FilterState {
  ownership: 'all' | 'owned' | 'wanted';
  platform?: string;
  line?: string;
  series?: string;
}

export interface PlatformGroup {
  brand: string;
  platforms: Platform[];
}

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="filter-bar glass-panel flex p-md gap-md items-center mb-lg flex-wrap animate-fade-in animate-stagger-1">
      <div class="filter-group flex items-center gap-sm">
        <label>Status:</label>
        <select [(ngModel)]="filters.ownership" (change)="onFilterChange()" class="glass-input">
          <option value="all">All</option>
          <option value="owned">Owned</option>
          <option value="wanted">Wanted</option>
        </select>
      </div>

      <div class="filter-group flex items-center gap-sm" *ngIf="currentTab === 'games'">
        <label>Platform:</label>
        <select [(ngModel)]="filters.platform" (change)="onFilterChange()" class="glass-input">
          <option value="">All Platforms</option>
          <optgroup *ngFor="let group of platformGroups" [label]="group.brand">
            <option *ngFor="let p of group.platforms" [value]="p.name">{{p.name}}</option>
          </optgroup>
        </select>
      </div>

      <div class="filter-group flex items-center gap-sm" *ngIf="currentTab === 'figures'">
        <label>Line:</label>
        <select [(ngModel)]="filters.line" (change)="onFilterChange()" class="glass-input">
          <option value="">All Lines</option>
          <option *ngFor="let l of uniqueLines" [value]="l">{{l}}</option>
        </select>
      </div>

      <div class="filter-group flex items-center gap-sm">
        <label>Series:</label>
        <input list="series-list" [(ngModel)]="filters.series" (change)="onFilterChange()" class="glass-input list-input" placeholder="All Series">
        <datalist id="series-list">
          <option value="">All Series</option>
          <option *ngFor="let s of uniqueSeries" [value]="s"></option>
        </datalist>
      </div>
      
      <div class="filter-group flex items-center gap-sm ml-auto text-secondary text-sm">
        <span>{{resultCount}} items found</span>
      </div>
    </div>
  `,
  styles: [`
    .mb-lg { margin-bottom: 2rem; }
    .p-md { padding: 1rem 1.5rem; }
    .ml-auto { margin-left: auto; }
    .text-sm { font-size: 0.875rem; }
    .text-secondary { color: var(--text-secondary); }
    .filter-bar {
      border-radius: 12px;
      justify-content: flex-start;
      margin-top: -1rem;
    }
    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary);
    }
    .glass-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-family: var(--font-body);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .list-input {
      width: 140px;
    }
    .glass-input:focus {
      border-color: var(--accent-color);
      box-shadow: 0 0 10px var(--accent-glow);
    }
    .glass-input option, .glass-input optgroup {
      background: var(--bg-color);
    }
    .glass-input optgroup {
      font-weight: 700;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
  `]
})
export class CollectionFiltersComponent {
  @Input() currentTab: 'games' | 'figures' = 'games';
  @Input() platformGroups: PlatformGroup[] = [];
  @Input() uniqueLines: string[] = [];
  @Input() uniqueSeries: string[] = [];
  @Input() resultCount: number = 0;
  
  @Output() filtersChange = new EventEmitter<FilterState>();

  filters: FilterState = {
    ownership: 'owned',
    platform: '',
    line: '',
    series: ''
  };

  onFilterChange() {
    this.filtersChange.emit({ ...this.filters });
  }
}
