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

import {
  Component,
  input,
  output,
  signal,
  HostListener,
  ElementRef,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  FilterState,
  PlatformGroup,
} from '../../../../core/models/collection.models';

@Component({
  selector: 'app-collection-filters',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="filter-wrapper animate-expressive animate-stagger-1">
      <div class="mobile-filter-row desktop-hidden">
        <button
          class="m3-button m3-button-tonal"
          (click)="showFilters.set(!showFilters())"
        >
          <span class="icon">{{ showFilters() ? '✕' : '🔍' }}</span>
          <span>{{ showFilters() ? 'Hide Filters' : 'Show Filters' }}</span>
        </button>
        @if (!showFilters()) {
          <div class="m3-badge">{{ resultCount() }}</div>
        }
      </div>

      <div
        class="filter-bar m3-surface-container flex p-md gap-md items-center mb-lg flex-wrap"
        [class.mobile-collapsed]="!showFilters()"
      >
        <div class="filter-group">
          <label class="m3-label">Status</label>
          <div class="input-wrapper">
            <select
              [ngModel]="filters().ownership"
              (ngModelChange)="onPartialChange('ownership', $event)"
              class="m3-input"
            >
              <option value="all">All</option>
              <option [ngValue]="1">Owned</option>
              <option [ngValue]="2">Seeking</option>
              <option [ngValue]="3">Ordered</option>
              <option [ngValue]="0">Unowned</option>
            </select>
          </div>
        </div>

        @if (currentTab() === 'games') {
          <div class="filter-group">
            <label class="m3-label">Play Status</label>
            <div class="input-wrapper">
              <select
                [ngModel]="filters().play_status || 'all'"
                (ngModelChange)="
                  onPartialChange(
                    'play_status',
                    $event === 'all' ? 'all' : $event
                  )
                "
                class="m3-input"
              >
                <option value="all">All</option>
                <option [ngValue]="1">Played</option>
                <option [ngValue]="2">Playing</option>
                <option [ngValue]="3">Queued</option>
                <option [ngValue]="4">Paused</option>
                <option [ngValue]="5">Dropped</option>
                <option [ngValue]="0">Unplayed</option>
              </select>
            </div>
          </div>

          <div class="filter-group">
            <label class="m3-label">Backup</label>
            <div class="input-wrapper">
              <select
                [ngModel]="filters().backup_status ?? 'all'"
                (ngModelChange)="
                  onPartialChange(
                    'backup_status',
                    $event === 'all' ? 'all' : $event
                  )
                "
                class="m3-input"
              >
                <option value="all">All</option>
                <option [ngValue]="1">Backed Up</option>
                <option [ngValue]="0">No Backup</option>
              </select>
            </div>
          </div>

          <div class="filter-group">
            <label class="m3-label">Physical Verified</label>
            <div class="input-wrapper">
              <select
                [ngModel]="filters().physical_verified ?? 'all'"
                (ngModelChange)="
                  onPartialChange(
                    'physical_verified',
                    $event === 'all' ? 'all' : $event
                  )
                "
                class="m3-input"
                id="filter-physical-verified"
              >
                <option value="all">All</option>
                <option [ngValue]="1">Verified</option>
                <option [ngValue]="0">Unverified</option>
              </select>
            </div>
          </div>

          <div class="filter-group">
            <label class="m3-label">Platform</label>
            <div class="input-wrapper">
              <select
                [ngModel]="filters().platform_id"
                (ngModelChange)="onPartialChange('platform_id', $event)"
                class="m3-input"
              >
                <option [ngValue]="undefined">All Platforms</option>
                @for (group of platformGroups(); track group.brand) {
                  <optgroup [label]="group.brand">
                    @for (p of group.platforms; track p.id) {
                      @if (!p.parent_platform_id) {
                        <option [ngValue]="p.id">
                          {{ p.display_name || p.name }}
                        </option>
                      } @else {
                        <option [ngValue]="p.id">
                          &nbsp;&nbsp;↳ {{ p.display_name || p.name }}
                        </option>
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
              <select
                [ngModel]="filters().line"
                (ngModelChange)="onPartialChange('line', $event)"
                class="m3-input"
              >
                <option value="">All Lines</option>
                @for (l of uniqueLines(); track l) {
                  <option [value]="l">{{ l }}</option>
                }
              </select>
            </div>
          </div>
        }

        @if (currentTab() === 'toys') {
          <div class="filter-group">
            <label
              class="m3-label"
              title="Form factor (e.g. Figure, Card, Yarn)"
              >Type</label
            >
            <div class="input-wrapper">
              <select
                [ngModel]="filters().type"
                (ngModelChange)="onPartialChange('type', $event)"
                class="m3-input"
              >
                <option value="">All Types</option>
                @for (t of uniqueTypes(); track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
            </div>
          </div>
        }

        <div class="filter-group">
          <div class="flex justify-between items-center pr-xs">
            <label class="m3-label">Name/Series</label>
            <label class="m3-checkbox-label" title="Exact Normalized Match">
              <input
                type="checkbox"
                [ngModel]="filters().seriesExact"
                (ngModelChange)="onPartialChange('seriesExact', $event)"
                class="m3-checkbox"
              />
              <span>Exact</span>
            </label>
          </div>
          <div class="input-wrapper">
            <input
              list="series-list"
              [ngModel]="filters().seriesOrName"
              (ngModelChange)="onPartialChange('seriesOrName', $event)"
              class="m3-input list-input"
              placeholder="All"
            />
            <datalist id="series-list">
              <option value="">All</option>
              @for (s of uniqueSeries(); track s) {
                <option [value]="s"></option>
              }
            </datalist>
          </div>
        </div>

        <div class="filter-group region-dropdown-container">
          <label class="m3-label">Region</label>
          <div class="input-wrapper dropdown-wrapper">
            <button
              type="button"
              class="m3-input dropdown-trigger"
              (click)="isRegionDropdownOpen.set(!isRegionDropdownOpen())"
            >
              <span class="trigger-text">{{ getRegionLabel() }}</span>
              <span class="arrow-icon" [class.open]="isRegionDropdownOpen()"
                >▼</span
              >
            </button>
            @if (isRegionDropdownOpen()) {
              <div class="dropdown-list animate-expressive">
                <button
                  type="button"
                  class="dropdown-clear-btn state-layer"
                  (click)="clearRegions()"
                  [disabled]="(filters().regions || []).length === 0"
                >
                  Clear Selection
                </button>
                @for (region of uniqueRegions(); track region) {
                  <label class="dropdown-item state-layer">
                    <input
                      type="checkbox"
                      [checked]="isRegionSelected(region)"
                      (change)="onRegionToggle(region)"
                      class="m3-checkbox"
                    />
                    <span class="item-label">{{ region }}</span>
                  </label>
                }
                @if (uniqueRegions().length === 0) {
                  <div class="dropdown-empty">No regions found</div>
                }
              </div>
            }
          </div>
        </div>

        <div
          class="filter-info ml-auto mobile-hidden flex flex-col items-end gap-2xs"
        >
          <span class="count-badge">{{ resultCount() }} items</span>
          @if (lastUpdated()) {
            <span
              class="sync-timestamp"
              [title]="
                'Last synced with server: ' + (lastUpdated() | date: 'medium')
              "
            >
              Updated {{ lastUpdated() | date: 'shortTime' }}
            </span>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        z-index: 20;
      }

      .mb-lg {
        margin-bottom: var(--spacing-32);
      }
      .p-md {
        padding: var(--spacing-16) var(--spacing-24);
      }
      .pr-xs {
        padding-right: var(--spacing-4);
      }
      .ml-auto {
        margin-left: auto;
      }
      .flex {
        display: flex;
      }
      .items-center {
        align-items: center;
      }
      .justify-between {
        justify-content: space-between;
      }

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

      .m3-input option,
      .m3-input optgroup {
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
        padding: 0.5rem 1.25rem;
        background: var(--m3-surface-container-highest);
        border-radius: var(--radius-md);
        border: 1px solid var(--m3-outline-variant);
      }

      .count-badge {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--m3-on-surface);
      }

      .sync-timestamp {
        font-size: 0.65rem;
        font-weight: 600;
        color: var(--m3-primary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.8;
      }

      .gap-2xs {
        gap: 0.25rem;
      }
      .flex-col {
        flex-direction: column;
      }
      .items-end {
        align-items: flex-end;
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

      .region-dropdown-container {
        position: relative;
      }
      .dropdown-wrapper {
        position: relative;
      }
      .dropdown-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        text-align: left;
      }
      .arrow-icon {
        font-size: 0.65rem;
        transition: transform 0.2s ease;
        color: var(--m3-on-surface-variant);
        margin-left: 0.5rem;
      }
      .arrow-icon.open {
        transform: rotate(180deg);
      }
      .dropdown-list {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        z-index: 50;
        background: var(--m3-surface-container-high);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--m3-outline);
        border-radius: var(--radius-sm);
        padding: 0.5rem 0;
        max-height: 250px;
        overflow-y: auto;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
      }
      .dropdown-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-12);
        padding: 0.6rem 1rem;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s ease;
      }
      .dropdown-item:hover {
        background: var(--m3-surface-container-highest);
      }
      .item-label {
        font-size: 0.9rem;
        color: var(--m3-on-surface);
        text-transform: none;
        letter-spacing: normal;
      }
      .dropdown-empty {
        padding: 0.75rem 1rem;
        font-size: 0.85rem;
        color: var(--m3-on-surface-variant);
        text-align: center;
      }
      .dropdown-clear-btn {
        display: block;
        width: calc(100% - 1.5rem);
        margin: 0.25rem 0.75rem 0.5rem 0.75rem;
        padding: 0.55rem;
        text-align: center;
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        border: none;
        border-radius: var(--radius-sm);
        font-family: var(--font-body);
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        transition: all 0.2s ease;
      }
      .dropdown-clear-btn:hover:not(:disabled) {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .dropdown-clear-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface-variant);
      }
    `,
  ],
})
export class CollectionFiltersComponent {
  /** --- Internal UI State --- */
  public showFilters = signal(false);
  public isRegionDropdownOpen = signal(false);

  /** --- Reactive Inputs --- */
  public currentTab = input.required<'games' | 'toys'>();
  public platformGroups = input<PlatformGroup[]>([]);
  public uniqueLines = input<string[]>([]);
  public uniqueTypes = input<string[]>([]);
  public uniqueSeries = input<string[]>([]);
  public uniqueRegions = input<string[]>([]);
  public resultCount = input<number>(0);
  public filters = input.required<FilterState>();
  public lastUpdated = input<Date | null>(null);

  private elementRef = inject(ElementRef);

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
      [key]: processedValue as FilterState[keyof FilterState],
    } as FilterState);
  }

  clearRegions() {
    this.onPartialChange('regions', []);
  }

  onRegionToggle(region: string) {
    const currentRegions = this.filters().regions || [];
    let newRegions: string[];
    if (currentRegions.includes(region)) {
      newRegions = currentRegions.filter((r) => r !== region);
    } else {
      newRegions = [...currentRegions, region];
    }
    this.onPartialChange('regions', newRegions);
  }

  isRegionSelected(region: string): boolean {
    return (this.filters().regions || []).includes(region);
  }

  getRegionLabel(): string {
    const selected = this.filters().regions || [];
    if (selected.length === 0) return 'All Regions';
    if (selected.length <= 2) return selected.join(', ');
    return `${selected.length} Selected`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const dropdownEl = this.elementRef.nativeElement.querySelector(
      '.region-dropdown-container',
    );
    if (dropdownEl && !dropdownEl.contains(event.target as Node)) {
      this.isRegionDropdownOpen.set(false);
    }
  }
}
