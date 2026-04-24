/**
 * COLLECTION FILTERS COMPONENT
 * 
 * Provides the user interface for filtering the collection by status, 
 * platform, line, type, and series.
 * 
 * DESIGN RATIONALE:
 * - **Collapsible Design**: Implements a 'showFilters' signal to toggle 
 *   visibility on mobile, keeping the interface clean for browsing.
 * - **Signal Inputs**: Uses modern Angular 21 signal inputs (`input()`) for 
 *   optimal change detection and developer ergonomics.
 * - **Normalized Data**: Receives pre-calculated unique lines, types, and 
 *   series to populate dropdowns, ensuring filter consistency.
 * - **One-Way Data Flow**: Emits a `filtersChange` output rather than mutating 
 *   inputs, following the "Data Down, Actions Up" architecture.
 */

import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FilterState, PlatformGroup } from '../../../../core/models/collection.models';

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="filter-wrapper animate-fade-in animate-stagger-1">
      <div class="mobile-filter-row desktop-hidden">
        <button class="m3-button m3-button-tonal" (click)="showFilters.set(!showFilters())">
          <span class="icon">{{ showFilters() ? '✕' : '🔍' }}</span>
          <span>{{ showFilters() ? 'Hide Filters' : 'Show Filters' }}</span>
        </button>
        @if (!showFilters()) {
          <div class="m3-badge">{{resultCount()}}</div>
        }
      </div>

      <div class="filter-bar m3-surface-container flex p-md gap-md items-center mb-lg flex-wrap" [class.mobile-collapsed]="!showFilters()">
        <div class="filter-group">
          <label class="m3-label">Status</label>
          <div class="input-wrapper">
            <select [ngModel]="filters().ownership" (ngModelChange)="onPartialChange('ownership', $event)" class="m3-input">
              <option value="all">All</option>
              <option value="owned">Owned</option>
              <option value="wanted">Wanted</option>
            </select>
          </div>
        </div>
      
        @if (currentTab() === 'games') {
          <div class="filter-group">
            <label class="m3-label">Platform</label>
            <div class="input-wrapper">
              <select [ngModel]="filters().platform_id" (ngModelChange)="onPartialChange('platform_id', $event)" class="m3-input">
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
          </div>
        }
      
        @if (currentTab() === 'toys') {
          <div class="filter-group">
            <label class="m3-label">Line</label>
            <div class="input-wrapper">
              <select [ngModel]="filters().line" (ngModelChange)="onPartialChange('line', $event)" class="m3-input">
                <option value="">All Lines</option>
                @for (l of uniqueLines(); track l) {
                  <option [value]="l">{{l}}</option>
                }
              </select>
            </div>
          </div>
        }
      
        @if (currentTab() === 'toys') {
          <div class="filter-group">
            <label class="m3-label" title="Form factor (e.g. Figure, Card, Yarn)">Type</label>
            <div class="input-wrapper">
              <select [ngModel]="filters().type" (ngModelChange)="onPartialChange('type', $event)" class="m3-input">
                <option value="">All Types</option>
                @for (t of uniqueTypes(); track t) {
                  <option [value]="t">{{t}}</option>
                }
              </select>
            </div>
          </div>
        }
      
        <div class="filter-group">
          <div class="flex justify-between items-center pr-xs">
            <label class="m3-label">Series</label>
            <label class="m3-checkbox-label" title="Exact Normalized Match">
              <input type="checkbox" [ngModel]="filters().seriesExact" (ngModelChange)="onPartialChange('seriesExact', $event)" class="m3-checkbox">
              <span>Exact</span>
            </label>
          </div>
          <div class="input-wrapper">
            <input list="series-list" [ngModel]="filters().series" (ngModelChange)="onPartialChange('series', $event)" class="m3-input list-input" placeholder="All Series">
            <datalist id="series-list">
              <option value="">All Series</option>
              @for (s of uniqueSeries(); track s) {
                <option [value]="s"></option>
              }
            </datalist>
          </div>
        </div>
  
        <div class="filter-group">
          <label class="m3-label">Region</label>
          <div class="input-wrapper">
            <select [ngModel]="filters().region" (ngModelChange)="onPartialChange('region', $event)" class="m3-input">
              <option [ngValue]="undefined">All Regions</option>
              <option value="EU">Europe</option>
              <option value="JP">Japan</option>
              <option value="NA">North America</option>
              <option value="SEA">Southeast Asia</option>
            </select>
          </div>
        </div>
  
      
        <div class="filter-info ml-auto mobile-hidden">
          <span>{{resultCount()}} items</span>
        </div>
      </div>
    </div>
    `,
  styles: [`
    .mb-lg { margin-bottom: var(--spacing-32); }
    .p-md { padding: var(--spacing-16) var(--spacing-24); }
    .pr-xs { padding-right: var(--spacing-4); }
    .ml-auto { margin-left: auto; }
    .flex { display: flex; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    
    .filter-wrapper {
      margin-top: calc(-1 * var(--spacing-8));
    }
 
    .mobile-filter-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-16);
      margin-bottom: var(--spacing-16);
    }
 
    .m3-button {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-12);
      padding: 0.75rem 1.5rem;
      border-radius: var(--radius-xl);
      font-family: var(--font-body);
      font-weight: 500;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
    }
 
    .m3-button-tonal {
      background: var(--m3-secondary-container);
      color: var(--m3-on-secondary-container);
    }
 
    .m3-badge {
      background: var(--m3-primary);
      color: var(--m3-on-primary);
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.875rem;
      font-weight: 600;
    }
 
    .m3-surface-container {
      background: var(--m3-surface-container);
      border-radius: var(--radius-xl);
      border: 1px solid var(--m3-outline-variant);
    }
 
    .filter-bar {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
 
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-8);
      min-width: 160px;
    }
    
    .m3-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--m3-primary);
      margin-left: var(--spacing-4);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    
    .m3-input {
      background: var(--m3-surface-container-high);
      border: 1px solid var(--m3-outline);
      color: var(--m3-on-surface);
      padding: 0.75rem 1rem;
      border-radius: var(--radius-sm);
      font-family: var(--font-body);
      outline: none;
      transition: all 0.2s;
      font-size: 0.9375rem;
      width: 100%;
    }
 
    .m3-input:focus {
      border-color: var(--m3-primary);
      background: var(--m3-surface-container-highest);
      box-shadow: 0 0 0 1px var(--m3-primary);
    }
    
    .m3-input option, .m3-input optgroup {
      background: var(--m3-surface-container-highest);
      color: var(--m3-on-surface);
    }
 
    .m3-checkbox-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--m3-on-surface-variant);
      cursor: pointer;
      user-select: none;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
 
    .m3-checkbox {
      width: 14px;
      height: 14px;
      accent-color: var(--m3-primary);
      cursor: pointer;
    }
    
    .filter-info {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--m3-on-surface-variant);
      padding: 0.5rem 1.25rem;
      background: var(--m3-surface-container-highest);
      border-radius: var(--radius-md);
    }
 
    /* RESPONSIVE BREAKPOINTS */
    @media (min-width: 769px) {
      .mobile-filter-row {
        display: none;
      }
      .filter-bar.mobile-collapsed {
        display: flex; /* Always show on desktop */
      }
    }
 
    @media (max-width: 768px) {
      .filter-bar {
        padding: var(--spacing-24);
      }
      .filter-group {
        min-width: 0;
        flex: 1 1 calc(50% - var(--spacing-8));
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
export class CollectionFiltersComponent {
  /** --- Internal UI State --- */
  public showFilters = signal(false);
 
  /** --- Reactive Inputs --- */
  public currentTab = input.required<'games' | 'toys'>();
  public platformGroups = input<PlatformGroup[]>([]);
  public uniqueLines = input<string[]>([]);
  public uniqueTypes = input<string[]>([]);
  public uniqueSeries = input<string[]>([]);
  public resultCount = input<number>(0);
  public filters = input.required<FilterState>();
 
  /** --- Event Emitters --- */
  public filtersChange = output<FilterState>();
 
  /**
   * Emits a change event when a filter value is updated.
   * Handles string-to-boolean conversion for specialized inputs like 'seriesExact' 
   * to maintain strict typing in the model layer.
   * 
   * @param key The FilterState property to update.
   * @param value The new value for the property.
   */
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
