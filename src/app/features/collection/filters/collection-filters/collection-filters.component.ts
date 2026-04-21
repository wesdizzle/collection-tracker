import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilterState, PlatformGroup } from '../../../../core/models/collection.models';

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="filter-wrapper animate-fade-in animate-stagger-1">
      <button class="filter-toggle desktop-hidden" (click)="showFilters.set(!showFilters())">
        <span class="icon">{{ showFilters() ? '✕' : '🔍' }}</span>
        <span>{{ showFilters() ? 'Hide Filters' : 'Show Filters' }}</span>
        @if (!showFilters()) {
          <span class="result-badge">{{resultCount()}}</span>
        }
      </button>

      <div class="filter-bar glass-panel glass-blur flex p-md gap-md items-center mb-lg flex-wrap" [class.mobile-collapsed]="!showFilters()">
        <div class="filter-group flex items-center gap-sm">
          <label>Status:</label>
          <select [ngModel]="filters().ownership" (ngModelChange)="onPartialChange('ownership', $event)" class="glass-input">
            <option value="all">All</option>
            <option value="owned">Owned</option>
            <option value="wanted">Wanted</option>
          </select>
        </div>
      
        @if (currentTab() === 'games') {
          <div class="filter-group flex items-center gap-sm">
            <label>Platform:</label>
            <select [ngModel]="filters().platform_id" (ngModelChange)="onPartialChange('platform_id', $event)" class="glass-input">
              <option [ngValue]="undefined">All Platforms</option>
              @for (group of platformGroups(); track group.brand) {
                <optgroup [label]="group.brand">
                  @for (p of group.platforms; track p.id) {
                    @if (!p.parent_platform_id) {
                      <option [ngValue]="p.id">{{p.display_name || p.name}}</option>
                    } @else {
                      <option [ngValue]="p.id">&nbsp;&nbsp;↳ {{p.display_name || p.name}}</option>
                    }
                  }
                </optgroup>
              }
            </select>
          </div>
        }
      
        @if (currentTab() === 'figures') {
          <div class="filter-group flex items-center gap-sm">
            <label>Line:</label>
            <select [ngModel]="filters().line" (ngModelChange)="onPartialChange('line', $event)" class="glass-input">
              <option value="">All Lines</option>
              @for (l of uniqueLines(); track l) {
                <option [value]="l">{{l}}</option>
              }
            </select>
          </div>
        }
      
        @if (currentTab() === 'figures') {
          <div class="filter-group flex items-center gap-sm">
            <label>Type:</label>
            <select [ngModel]="filters().type" (ngModelChange)="onPartialChange('type', $event)" class="glass-input">
              <option value="">All Types</option>
              @for (t of uniqueTypes(); track t) {
                <option [value]="t">{{t}}</option>
              }
            </select>
          </div>
        }
      
        @if (currentTab() === 'figures') {
          <div class="filter-group flex items-center gap-sm">
            <label>Series:</label>
            <input list="series-list" [ngModel]="filters().series" (ngModelChange)="onPartialChange('series', $event)" class="glass-input list-input" placeholder="All Series">
            <datalist id="series-list">
              <option value="">All Series</option>
              @for (s of uniqueSeries(); track s) {
                <option [value]="s"></option>
              }
            </datalist>
          </div>
        }
  
        @if (currentTab() === 'games') {
          <div class="filter-group flex items-center gap-sm">
            <label>Series:</label>
            <input list="series-list" [ngModel]="filters().series" (ngModelChange)="onPartialChange('series', $event)" class="glass-input list-input" placeholder="All Series">
            <datalist id="series-list">
              <option value="">All Series</option>
              @for (s of uniqueSeries(); track s) {
                <option [value]="s"></option>
              }
            </datalist>
          </div>
        }
  
        <div class="filter-group flex items-center gap-sm">
          <label>Region:</label>
          <select [ngModel]="filters().region" (ngModelChange)="onPartialChange('region', $event)" class="glass-input">
            <option [ngValue]="undefined">All Regions</option>
            <option value="EU">Europe</option>
            <option value="JP">Japan</option>
            <option value="NA">North America</option>
            <option value="SEA">Southeast Asia</option>
          </select>
        </div>
  
        <div class="filter-group flex items-center gap-sm">
          <label>Linked:</label>
          <select [ngModel]="filters().is_linked" (ngModelChange)="onPartialChange('is_linked', $event)" class="glass-input">
            <option [ngValue]="undefined">All Items</option>
            <option [ngValue]="true">IGDB Connected</option>
            <option [ngValue]="false">Manual Entry</option>
          </select>
        </div>
      
        <div class="filter-group flex items-center gap-sm ml-auto text-secondary text-sm mobile-hidden">
          <span>{{resultCount()}} items found</span>
        </div>
      </div>
    </div>
    `,
  styles: [`
    .mb-lg { margin-bottom: 2rem; }
    .p-md { padding: 1rem 1.5rem; }
    .ml-auto { margin-left: auto; }
    .text-sm { font-size: 0.875rem; }
    .text-secondary { color: var(--text-secondary); }
    
    .filter-wrapper {
      margin-top: -1rem;
    }

    .filter-toggle {
      width: 100%;
      padding: 0.75rem 1rem;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      color: var(--text-primary);
      font-family: var(--font-body);
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      cursor: pointer;
      backdrop-filter: blur(8px);
    }

    .filter-toggle .icon {
      font-size: 1.1rem;
      color: var(--accent-fuchsia);
    }

    .result-badge {
      margin-left: auto;
      background: var(--accent-fuchsia);
      color: white;
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
    }

    .filter-bar {
      border-radius: 12px;
      justify-content: flex-start;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      transition: all 0.3s ease;
    }

    .filter-group {
      flex: 0 1 auto;
      min-width: 0;
    }
    
    label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text-secondary);
      white-space: nowrap;
    }
    
    .glass-input {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      font-family: var(--font-body);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-size: 0.9rem;
      width: 100%;
    }

    /* Standard widths for dropdowns */
    select.glass-input {
      min-width: 120px;
    }
    
    .list-input {
      width: 100%;
      max-width: 160px;
    }
    
    .glass-input:focus {
      border-color: var(--accent-fuchsia);
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

    /* RESPONSIVE BREAKPOINTS */
    @media (max-width: 768px) {
      .filter-bar {
        padding: 1.25rem;
      }
      .filter-group {
        flex: 1 1 calc(50% - 0.5rem);
        flex-direction: column;
        align-items: flex-start !important;
        gap: 0.25rem !important;
      }
      .list-input {
        max-width: none;
      }
      .mobile-collapsed {
        display: none;
      }
    }

    @media (max-width: 480px) {
      .filter-group {
        flex: 1 1 100%;
      }
    }
  `]
})
/**
 * COLLECTION FILTERS COMPONENT
 * 
 * Provides the UI for filtering the collection by status, platform, line, or series.
 * Updated to use Angular 21 Signals for efficient property binding.
 */
export class CollectionFiltersComponent {
  // State for mobile collapse
  public showFilters = signal(false);

  // Inputs as Signals
  public currentTab = input.required<'games' | 'figures'>();
  public platformGroups = input<PlatformGroup[]>([]);
  public uniqueLines = input<string[]>([]);
  public uniqueTypes = input<string[]>([]);
  public uniqueSeries = input<string[]>([]);
  public resultCount = input<number>(0);
  public filters = input.required<FilterState>();

  // Outputs
  public filtersChange = output<FilterState>();

  onPartialChange(key: keyof FilterState, value: unknown) {
    let processedValue: unknown = value;
    if (value === 'true') processedValue = true;
    if (value === 'false') processedValue = false;

    this.filtersChange.emit({
      ...this.filters(),
      [key]: processedValue as FilterState[keyof FilterState]
    } as FilterState);
  }
}
