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
 * - **Unified Modal Dropdown Design System**: Replaces OS-native select and datalist
 *   popups with custom Material 3 glassmorphic floating modal dropdown menus.
 * - **One-Way Data Flow**: Emits a `filtersChange` output rather than mutating
 *   inputs, following the "Data Down, Actions Up" architecture.
 */

import {
  Component,
  input,
  output,
  signal,
  computed,
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
          <div class="m3-badge">
            {{ resultCount() }}
            @if (totalValue() > 0) {
              • {{ formatCurrency(totalValue()) }}
            }
          </div>
        }
      </div>

      <div
        class="filter-bar m3-surface-container flex p-md gap-md items-center mb-lg flex-wrap"
        [class.mobile-collapsed]="!showFilters()"
      >
        <!-- Ownership Status -->
        <div class="filter-group">
          <div class="filter-group-header">
            <label class="m3-label">Ownership Status</label>
          </div>
          <div
            class="input-wrapper dropdown-wrapper"
            [class.active-wrapper]="activeDropdown() === 'ownership'"
          >
            <button
              type="button"
              class="m3-input dropdown-trigger"
              [class.open]="activeDropdown() === 'ownership'"
              (click)="toggleDropdown('ownership', $event)"
              id="filter-ownership"
              aria-haspopup="listbox"
              [attr.aria-expanded]="activeDropdown() === 'ownership'"
            >
              <span class="trigger-text">{{ getOwnershipLabel() }}</span>
              <span class="dropdown-icon-wrapper" aria-hidden="true">
                <svg
                  class="dropdown-chevron"
                  [class.open]="activeDropdown() === 'ownership'"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path
                    d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                  />
                </svg>
              </span>
            </button>
            @if (activeDropdown() === 'ownership') {
              <div class="dropdown-list animate-expressive" role="listbox">
                @for (opt of ownershipOptions; track opt.value) {
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="filters().ownership === opt.value"
                    (click)="selectOption('ownership', opt.value)"
                    role="option"
                    [attr.aria-selected]="filters().ownership === opt.value"
                  >
                    <span class="item-label">{{ opt.label }}</span>
                    @if (filters().ownership === opt.value) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>

        @if (currentTab() === 'games') {
          <!-- Play Status -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Play Status</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'play_status'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'play_status'"
                (click)="toggleDropdown('play_status', $event)"
                id="filter-play-status"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'play_status'"
              >
                <span class="trigger-text">{{ getPlayStatusLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'play_status'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'play_status') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  @for (opt of playStatusOptions; track opt.value) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="
                        (filters().play_status || 'all') === opt.value
                      "
                      (click)="selectOption('play_status', opt.value)"
                      role="option"
                      [attr.aria-selected]="
                        (filters().play_status || 'all') === opt.value
                      "
                    >
                      <span class="item-label">{{ opt.label }}</span>
                      @if ((filters().play_status || 'all') === opt.value) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Media Type -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Media Type</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'media_type'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'media_type'"
                (click)="toggleDropdown('media_type', $event)"
                id="filter-media-type"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'media_type'"
              >
                <span class="trigger-text">{{ getMediaTypeLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'media_type'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'media_type') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  @for (opt of mediaTypeOptions; track opt.value) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="
                        (filters().media_type || 'physical_only') === opt.value
                      "
                      (click)="selectOption('media_type', opt.value)"
                      role="option"
                      [attr.aria-selected]="
                        (filters().media_type || 'physical_only') === opt.value
                      "
                    >
                      <span class="item-label">{{ opt.label }}</span>
                      @if (
                        (filters().media_type || 'physical_only') === opt.value
                      ) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Backup -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Backup</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'backup_status'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'backup_status'"
                (click)="toggleDropdown('backup_status', $event)"
                id="filter-backup-status"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'backup_status'"
              >
                <span class="trigger-text">{{ getBackupLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'backup_status'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'backup_status') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  @for (opt of backupOptions; track opt.value) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="
                        (filters().backup_status ?? 'all') === opt.value
                      "
                      (click)="selectOption('backup_status', opt.value)"
                      role="option"
                      [attr.aria-selected]="
                        (filters().backup_status ?? 'all') === opt.value
                      "
                    >
                      <span class="item-label">{{ opt.label }}</span>
                      @if ((filters().backup_status ?? 'all') === opt.value) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Physical Verified -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Physical Verified</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'physical_verified'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'physical_verified'"
                (click)="toggleDropdown('physical_verified', $event)"
                id="filter-physical-verified"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'physical_verified'"
              >
                <span class="trigger-text">{{
                  getPhysicalVerifiedLabel()
                }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'physical_verified'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'physical_verified') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  @for (opt of physicalVerifiedOptions; track opt.value) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="
                        (filters().physical_verified ?? 'all') === opt.value
                      "
                      (click)="selectOption('physical_verified', opt.value)"
                      role="option"
                      [attr.aria-selected]="
                        (filters().physical_verified ?? 'all') === opt.value
                      "
                    >
                      <span class="item-label">{{ opt.label }}</span>
                      @if (
                        (filters().physical_verified ?? 'all') === opt.value
                      ) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Platform -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Platform</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'platform'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'platform'"
                (click)="toggleDropdown('platform', $event)"
                id="filter-platform"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'platform'"
              >
                <span class="trigger-text">{{ getPlatformLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'platform'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'platform') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="filters().platform_id === undefined"
                    (click)="selectPlatform(undefined)"
                    role="option"
                    [attr.aria-selected]="filters().platform_id === undefined"
                  >
                    <span class="item-label">All Platforms</span>
                    @if (filters().platform_id === undefined) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                  @for (group of platformGroups(); track group.brand) {
                    <div class="dropdown-group-header">{{ group.brand }}</div>
                    @for (p of group.platforms; track p.id) {
                      <button
                        type="button"
                        class="dropdown-item state-layer"
                        [class.child-platform]="!!p.parent_platform_id"
                        [class.selected]="filters().platform_id === p.id"
                        (click)="selectPlatform(p.id)"
                        role="option"
                        [attr.aria-selected]="filters().platform_id === p.id"
                      >
                        <span class="item-label">
                          @if (p.parent_platform_id) {
                            <span class="sub-platform-arrow">↳</span>
                          }
                          {{ p.display_name || p.name }}
                        </span>
                        @if (filters().platform_id === p.id) {
                          <svg
                            class="selected-check"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="currentColor"
                          >
                            <path
                              d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                            />
                          </svg>
                        }
                      </button>
                    }
                  }
                </div>
              }
            </div>
          </div>
        }

        @if (currentTab() === 'toys') {
          <!-- Line -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label class="m3-label">Line</label>
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'line'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'line'"
                (click)="toggleDropdown('line', $event)"
                id="filter-line"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'line'"
              >
                <span class="trigger-text">{{ getLineLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'line'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'line') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="!filters().line"
                    (click)="selectOption('line', '')"
                    role="option"
                    [attr.aria-selected]="!filters().line"
                  >
                    <span class="item-label">All Lines</span>
                    @if (!filters().line) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                  @for (l of uniqueLines(); track l) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="filters().line === l"
                      (click)="selectOption('line', l)"
                      role="option"
                      [attr.aria-selected]="filters().line === l"
                    >
                      <span class="item-label">{{ l }}</span>
                      @if (filters().line === l) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Type -->
          <div class="filter-group">
            <div class="filter-group-header">
              <label
                class="m3-label"
                title="Form factor (e.g. Figure, Card, Yarn)"
                >Type</label
              >
            </div>
            <div
              class="input-wrapper dropdown-wrapper"
              [class.active-wrapper]="activeDropdown() === 'type'"
            >
              <button
                type="button"
                class="m3-input dropdown-trigger"
                [class.open]="activeDropdown() === 'type'"
                (click)="toggleDropdown('type', $event)"
                id="filter-type"
                aria-haspopup="listbox"
                [attr.aria-expanded]="activeDropdown() === 'type'"
              >
                <span class="trigger-text">{{ getTypeLabel() }}</span>
                <span class="dropdown-icon-wrapper" aria-hidden="true">
                  <svg
                    class="dropdown-chevron"
                    [class.open]="activeDropdown() === 'type'"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path
                      d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                    />
                  </svg>
                </span>
              </button>
              @if (activeDropdown() === 'type') {
                <div class="dropdown-list animate-expressive" role="listbox">
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="!filters().type"
                    (click)="selectOption('type', '')"
                    role="option"
                    [attr.aria-selected]="!filters().type"
                  >
                    <span class="item-label">All Types</span>
                    @if (!filters().type) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                  @for (t of uniqueTypes(); track t) {
                    <button
                      type="button"
                      class="dropdown-item state-layer"
                      [class.selected]="filters().type === t"
                      (click)="selectOption('type', t)"
                      role="option"
                      [attr.aria-selected]="filters().type === t"
                    >
                      <span class="item-label">{{ t }}</span>
                      @if (filters().type === t) {
                        <svg
                          class="selected-check"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path
                            d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                          />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Name/Series Combobox Text Input Dropdown -->
        <div class="filter-group">
          <div
            class="filter-group-header flex justify-between items-center pr-xs"
          >
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
          <div
            class="input-wrapper combobox-wrapper"
            [class.active-wrapper]="activeDropdown() === 'series'"
          >
            <input
              type="text"
              [ngModel]="filters().seriesOrName"
              (ngModelChange)="onSeriesInputChange($event)"
              (focus)="activeDropdown.set('series')"
              class="m3-input list-input"
              [class.open]="activeDropdown() === 'series'"
              placeholder="All"
              id="filter-series-or-name"
              autocomplete="off"
            />
            <button
              type="button"
              class="combobox-chevron-btn"
              (click)="toggleDropdown('series', $event)"
              tabindex="-1"
              aria-label="Toggle series suggestions"
            >
              <span class="dropdown-icon-wrapper" aria-hidden="true">
                <svg
                  class="dropdown-chevron"
                  [class.open]="activeDropdown() === 'series'"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path
                    d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                  />
                </svg>
              </span>
            </button>

            @if (activeDropdown() === 'series') {
              <div class="dropdown-list animate-expressive" role="listbox">
                <button
                  type="button"
                  class="dropdown-item state-layer"
                  [class.selected]="!filters().seriesOrName"
                  (click)="selectSeries('')"
                  role="option"
                  [attr.aria-selected]="!filters().seriesOrName"
                >
                  <span class="item-label">All Series</span>
                  @if (!filters().seriesOrName) {
                    <svg
                      class="selected-check"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="currentColor"
                    >
                      <path
                        d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                      />
                    </svg>
                  }
                </button>
                @for (s of filteredSeriesList(); track s) {
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="filters().seriesOrName === s"
                    (click)="selectSeries(s)"
                    role="option"
                    [attr.aria-selected]="filters().seriesOrName === s"
                  >
                    <span class="item-label">{{ s }}</span>
                    @if (filters().seriesOrName === s) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                }
                @if (
                  filteredSeriesList().length === 0 && filters().seriesOrName
                ) {
                  <div class="dropdown-empty">
                    No series matching "{{ filters().seriesOrName }}"
                  </div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Region Multi-Select Dropdown -->
        <div class="filter-group region-dropdown-container">
          <div class="filter-group-header">
            <label class="m3-label">Region</label>
          </div>
          <div
            class="input-wrapper dropdown-wrapper"
            [class.active-wrapper]="activeDropdown() === 'region'"
          >
            <button
              type="button"
              class="m3-input dropdown-trigger"
              [class.open]="activeDropdown() === 'region'"
              (click)="toggleDropdown('region', $event)"
              id="filter-region"
              aria-haspopup="listbox"
              [attr.aria-expanded]="activeDropdown() === 'region'"
            >
              <span class="trigger-text">{{ getRegionLabel() }}</span>
              <span class="dropdown-icon-wrapper" aria-hidden="true">
                <svg
                  class="dropdown-chevron"
                  [class.open]="activeDropdown() === 'region'"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path
                    d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                  />
                </svg>
              </span>
            </button>
            @if (activeDropdown() === 'region') {
              <div class="dropdown-list animate-expressive" role="listbox">
                <button
                  type="button"
                  class="dropdown-clear-btn state-layer"
                  (click)="clearRegions()"
                  [disabled]="(filters().regions || []).length === 0"
                >
                  Clear Selection
                </button>
                @for (region of uniqueRegions(); track region) {
                  <label class="dropdown-item state-layer checkbox-item">
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

        <!-- Sort By -->
        <div class="filter-group">
          <div class="filter-group-header">
            <label class="m3-label">Sort By</label>
          </div>
          <div
            class="input-wrapper dropdown-wrapper"
            [class.active-wrapper]="activeDropdown() === 'sortBy'"
          >
            <button
              type="button"
              class="m3-input dropdown-trigger"
              [class.open]="activeDropdown() === 'sortBy'"
              (click)="toggleDropdown('sortBy', $event)"
              id="filter-sort-by"
              aria-haspopup="listbox"
              [attr.aria-expanded]="activeDropdown() === 'sortBy'"
            >
              <span class="trigger-text">{{ getSortByLabel() }}</span>
              <span class="dropdown-icon-wrapper" aria-hidden="true">
                <svg
                  class="dropdown-chevron"
                  [class.open]="activeDropdown() === 'sortBy'"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path
                    d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"
                  />
                </svg>
              </span>
            </button>
            @if (activeDropdown() === 'sortBy') {
              <div class="dropdown-list animate-expressive" role="listbox">
                @for (opt of sortByOptions; track opt.value) {
                  <button
                    type="button"
                    class="dropdown-item state-layer"
                    [class.selected]="
                      (filters().sortBy || 'default') === opt.value
                    "
                    (click)="selectOption('sortBy', opt.value)"
                    role="option"
                    [attr.aria-selected]="
                      (filters().sortBy || 'default') === opt.value
                    "
                  >
                    <span class="item-label">{{ opt.label }}</span>
                    @if ((filters().sortBy || 'default') === opt.value) {
                      <svg
                        class="selected-check"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="currentColor"
                      >
                        <path
                          d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                        />
                      </svg>
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>

        <!-- Deals Only Toggle (Games Tab Only) -->
        @if (currentTab() === 'games') {
          <div class="filter-group flex items-end">
            <button
              type="button"
              class="m3-input deals-toggle-btn state-layer"
              [class.active]="filters().deals_only"
              (click)="toggleDealsOnly()"
              id="filter-deals-only"
              title="Show only games currently on sale or clearance"
            >
              <span class="deals-icon">🔥</span>
              <span>Deals Only</span>
            </button>
          </div>
        }

        <div
          class="filter-info ml-auto mobile-hidden flex flex-col items-end gap-2xs"
        >
          <span class="count-badge">
            {{ resultCount() }} items
            @if (totalValue() > 0) {
              • {{ formatCurrency(totalValue()) }}
            }
          </span>
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
        position: relative;
        z-index: 20;
      }

      .filter-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-8);
        min-width: 160px;
      }

      .filter-group-header {
        display: flex;
        align-items: center;
        min-height: 20px;
      }

      .m3-label {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--m3-primary);
        margin-left: var(--spacing-4);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        line-height: 1;
      }

      .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        width: 100%;
      }

      .dropdown-wrapper.active-wrapper,
      .combobox-wrapper.active-wrapper {
        z-index: 60;
      }

      .m3-input {
        box-sizing: border-box;
        height: 46px;
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline);
        color: var(--m3-on-surface);
        padding: 0 2.75rem 0 1rem;
        border-radius: var(--radius-sm);
        font-family: var(--font-body);
        font-size: 0.9375rem;
        line-height: normal;
        outline: none;
        transition:
          border-color 0.2s ease,
          background-color 0.2s ease,
          box-shadow 0.2s ease;
        width: 100%;
      }

      .m3-input:hover:not(:disabled) {
        background: var(--m3-surface-container-highest);
        border-color: var(--m3-outline);
      }

      .m3-input:focus,
      .dropdown-trigger.open,
      .list-input.open {
        border-color: var(--m3-primary);
        background: var(--m3-surface-container-highest);
        box-shadow: 0 0 0 1px var(--m3-primary);
      }

      /* Unified dropdown icon / chevron */
      .dropdown-icon-wrapper {
        position: absolute;
        right: 1rem;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        color: var(--m3-on-surface-variant);
        transition: color 0.2s ease;
        z-index: 1;
      }

      .dropdown-chevron {
        width: 18px;
        height: 18px;
        transition:
          transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
          color 0.2s ease;
        flex-shrink: 0;
      }

      .dropdown-chevron.open {
        transform: rotate(180deg);
      }

      .input-wrapper:hover .dropdown-icon-wrapper,
      .input-wrapper:focus-within .dropdown-icon-wrapper,
      .dropdown-trigger.open .dropdown-icon-wrapper,
      .combobox-chevron-btn:hover .dropdown-icon-wrapper {
        color: var(--m3-primary);
      }

      /* Combobox specifics */
      .combobox-wrapper {
        position: relative;
      }

      .list-input {
        cursor: text;
      }

      .combobox-chevron-btn {
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        width: 2.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        cursor: pointer;
        color: var(--m3-on-surface-variant);
        z-index: 2;
        padding: 0;
      }

      /* Dropdown trigger button */
      .dropdown-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        text-align: left;
        padding-left: 1rem;
        padding-right: 2.75rem;
        position: relative;
        user-select: none;
      }

      .trigger-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* UNIFIED MODAL DROPDOWN POPUP MENU */
      .dropdown-list {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 100%;
        width: max-content;
        max-width: min(340px, calc(100vw - 48px));
        z-index: 100;
        background: var(--m3-surface-container-high);
        backdrop-filter: blur(20px) contrast(95%);
        -webkit-backdrop-filter: blur(20px) contrast(95%);
        border: 1px solid var(--m3-outline);
        border-radius: var(--radius-sm);
        padding: 0.375rem 0;
        max-height: 280px;
        overflow-y: auto;
        box-shadow: 0 12px 36px 0 rgba(0, 0, 0, 0.45);
        scrollbar-width: thin;
        scrollbar-color: var(--m3-outline-variant) transparent;
      }

      .dropdown-list::-webkit-scrollbar {
        width: 6px;
      }
      .dropdown-list::-webkit-scrollbar-track {
        background: transparent;
      }
      .dropdown-list::-webkit-scrollbar-thumb {
        background-color: var(--m3-outline-variant);
        border-radius: 999px;
      }

      @keyframes expressiveDropdown {
        0% {
          opacity: 0;
          transform: translateY(-6px) scale(0.98);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .dropdown-list.animate-expressive {
        animation: expressiveDropdown 0.2s cubic-bezier(0.2, 0, 0, 1) both;
      }

      .dropdown-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0.625rem 1rem;
        cursor: pointer;
        user-select: none;
        background: transparent;
        border: none;
        font-family: var(--font-body);
        font-size: 0.875rem;
        color: var(--m3-on-surface);
        text-align: left;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
        gap: 0.75rem;
      }

      .dropdown-item:hover {
        background: var(--m3-surface-container-highest);
      }

      .dropdown-item.selected {
        background: var(--m3-secondary-container);
        color: var(--m3-on-secondary-container);
        font-weight: 600;
      }

      .dropdown-item.selected .selected-check {
        color: var(--m3-on-secondary-container);
      }

      .selected-check {
        color: var(--m3-primary);
        flex-shrink: 0;
      }

      .checkbox-item {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: var(--spacing-12);
      }

      .item-label {
        font-size: 0.875rem;
        color: inherit;
        text-transform: none;
        letter-spacing: normal;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dropdown-group-header {
        padding: 0.6rem 1rem 0.25rem 1rem;
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--m3-primary);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        pointer-events: none;
      }

      .child-platform {
        padding-left: 1.75rem;
      }

      .sub-platform-arrow {
        color: var(--m3-on-surface-variant);
        margin-right: 0.35rem;
        font-size: 0.85rem;
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

      .deals-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-4);
        padding: 0 1.1rem;
        height: 48px;
        border-radius: var(--radius-full);
        border: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container-high);
        color: var(--m3-on-surface);
        font-family: inherit;
        font-size: var(--font-size-body-medium);
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
        white-space: nowrap;
      }
      .deals-toggle-btn:hover {
        background: var(--m3-surface-container-highest);
      }
      .deals-toggle-btn.active {
        background: #ef4444;
        color: #ffffff;
        border-color: #dc2626;
        box-shadow: 0 2px 10px rgba(239, 68, 68, 0.4);
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
          display: flex;
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
    `,
  ],
})
export class CollectionFiltersComponent {
  /** --- Internal UI State --- */
  public showFilters = signal(false);
  public activeDropdown = signal<string | null>(null);

  /** Backward-compatible computed for region dropdown open state */
  public isRegionDropdownOpen = computed(
    () => this.activeDropdown() === 'region',
  );

  /** --- Reactive Inputs --- */
  public currentTab = input.required<'games' | 'toys'>();
  public platformGroups = input<PlatformGroup[]>([]);
  public uniqueLines = input<string[]>([]);
  public uniqueTypes = input<string[]>([]);
  public uniqueSeries = input<string[]>([]);
  public uniqueRegions = input<string[]>([]);
  public resultCount = input<number>(0);
  public totalValue = input<number>(0);
  public filters = input.required<FilterState>();
  public lastUpdated = input<Date | null>(null);

  /** --- Options Catalogues --- */
  readonly ownershipOptions: {
    value: 'all' | 'seeking_or_unowned' | 1 | 2 | 3 | 0;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 'seeking_or_unowned', label: 'Seeking or Unowned' },
    { value: 1, label: 'Owned' },
    { value: 2, label: 'Seeking' },
    { value: 3, label: 'Ordered' },
    { value: 0, label: 'Unowned' },
  ];

  readonly playStatusOptions: {
    value: 'all' | 1 | 2 | 3 | 4 | 5 | 0;
    label: string;
  }[] = [
    { value: 'all', label: 'All' },
    { value: 1, label: 'Played' },
    { value: 2, label: 'Playing' },
    { value: 3, label: 'Queued' },
    { value: 4, label: 'Paused' },
    { value: 5, label: 'Dropped' },
    { value: 0, label: 'Unplayed' },
  ];

  readonly mediaTypeOptions = [
    { value: 'physical_only', label: 'Physical Media Only' },
    { value: 'all', label: 'All Items (Physical + Digital)' },
    { value: 'digital_extracted', label: 'Extracted Backups & Digital' },
  ];

  readonly backupOptions: { value: 'all' | 1 | 0; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 1, label: 'Backed Up' },
    { value: 0, label: 'No Backup' },
  ];

  readonly physicalVerifiedOptions: { value: 'all' | 1 | 0; label: string }[] =
    [
      { value: 'all', label: 'All' },
      { value: 1, label: 'Verified' },
      { value: 0, label: 'Unverified' },
    ];

  readonly sortByOptions = [
    { value: 'default', label: 'Default' },
    { value: 'retail_asc', label: 'Lowest Retail Price' },
    { value: 'discount_desc', label: 'Deepest Sale Discount' },
    { value: 'value_desc', label: 'Value: High to Low' },
    { value: 'value_asc', label: 'Value: Low to High' },
  ];

  /** --- Formatted Currency Helper --- */
  public formatCurrency(cents: number | null | undefined): string {
    if (!cents || cents <= 0) return '$0.00';
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }

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

  /** --- Dropdown Interaction Methods --- */
  toggleDropdown(name: string, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.activeDropdown.update((current) => (current === name ? null : name));
  }

  closeDropdown() {
    this.activeDropdown.set(null);
  }

  selectOption(key: keyof FilterState, value: unknown) {
    this.onPartialChange(key, value);
    this.closeDropdown();
  }

  selectPlatform(platformId: number | undefined) {
    this.onPartialChange('platform_id', platformId);
    this.closeDropdown();
  }

  toggleDealsOnly() {
    const current = Boolean(this.filters().deals_only);
    this.onPartialChange('deals_only', !current);
  }

  public filteredSeriesList = computed(() => {
    const query = (this.filters().seriesOrName || '').trim().toLowerCase();
    const series = this.uniqueSeries() || [];
    if (!query) {
      return series.slice(0, 100);
    }
    return series.filter((s) => s.toLowerCase().includes(query)).slice(0, 100);
  });

  onSeriesInputChange(value: string) {
    this.onPartialChange('seriesOrName', value);
    this.activeDropdown.set('series');
  }

  selectSeries(series: string) {
    this.onPartialChange('seriesOrName', series);
    this.closeDropdown();
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

  /** --- Label Helpers --- */
  getOwnershipLabel(): string {
    const val = this.filters().ownership ?? 'all';
    const opt = this.ownershipOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPlayStatusLabel(): string {
    const val = this.filters().play_status ?? 'all';
    const opt = this.playStatusOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getMediaTypeLabel(): string {
    const val = this.filters().media_type || 'physical_only';
    const opt = this.mediaTypeOptions.find((o) => o.value === val);
    return opt ? opt.label : 'Physical Media Only';
  }

  getBackupLabel(): string {
    const val = this.filters().backup_status ?? 'all';
    const opt = this.backupOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPhysicalVerifiedLabel(): string {
    const val = this.filters().physical_verified ?? 'all';
    const opt = this.physicalVerifiedOptions.find((o) => o.value === val);
    return opt ? opt.label : 'All';
  }

  getPlatformLabel(): string {
    const pId = this.filters().platform_id;
    if (pId === undefined || pId === null) return 'All Platforms';
    for (const group of this.platformGroups()) {
      const found = group.platforms.find((p) => p.id === pId);
      if (found) return found.display_name || found.name;
    }
    return 'All Platforms';
  }

  getLineLabel(): string {
    return this.filters().line || 'All Lines';
  }

  getTypeLabel(): string {
    return this.filters().type || 'All Types';
  }

  getSortByLabel(): string {
    const val = this.filters().sortBy || 'default';
    const opt = this.sortByOptions.find((o) => o.value === val);
    return opt ? opt.label : 'Default';
  }

  getRegionLabel(): string {
    const selected = this.filters().regions || [];
    if (selected.length === 0) return 'All Regions';
    if (selected.length <= 2) return selected.join(', ');
    return `${selected.length} Selected`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      !target.closest('.dropdown-wrapper') &&
      !target.closest('.combobox-wrapper')
    ) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeDropdown();
  }
}
