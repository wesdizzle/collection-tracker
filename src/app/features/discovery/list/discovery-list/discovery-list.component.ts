/**
 * GAME & TOY DISCOVERY CENTER COMPONENT
 *
 * This component provides three comprehensive discovery and ingestion workflows:
 * 1. Manual Search: Allows user-triggered IGDB searches on a specific platform, physical DAT file matching,
 *    and configuration of metadata (ownership status, play status, backup status) before adding to SQLite / D1.
 * 2. Series Discovery: Triggers an automated scan of all tracked franchises/series on IGDB to suggest missing games,
 *    supporting one-click and bulk checkbox ingestion.
 * 3. Amiibo Discovery: Scans the canonical AmiiboAPI to discover unowned/newly released figures & cards missing
 *    from the user's collection, supporting one-click and bulk ingestion.
 *
 * DESIGN DECISIONS:
 * - Direct, tabbed navigation between Game Search, Franchise Discovery, and Amiibo Discovery.
 * - M3 styling and glassmorphic aesthetics for a responsive, clean collection experience.
 * - Robust fallback logic to handle unit tests context where some service signals are mocked.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Platform,
  PlatformGroup,
  IGDBSearchResult,
  ScanSuggestion,
  DiscoveryRelease,
  AmiiboDiscoveryItem,
  Toy,
} from '../../../../core/models/collection.models';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-discovery-list',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="discovery-container">
      <!-- Header Area -->
      <div class="discovery-header-panel mb-lg">
        <h1 class="text-gradient">Discovery Center</h1>
        <p class="text-secondary text-sm">
          Discover, match, and ingest new games and amiibo into your collection.
        </p>
      </div>

      <!-- Tab Buttons Navigation -->
      <div class="tabs-container mb-lg">
        <button
          class="tab-button"
          [class.active]="activeTab() === 'search'"
          (click)="activeTab.set('search')"
        >
          <span class="tab-icon">🔍</span> Game Search
        </button>
        <button
          class="tab-button"
          [class.active]="activeTab() === 'scan'"
          (click)="activeTab.set('scan')"
        >
          <span class="tab-icon">🔄</span> Franchise Discovery
        </button>
        <button
          class="tab-button"
          [class.active]="activeTab() === 'amiibo'"
          (click)="activeTab.set('amiibo')"
        >
          <span class="tab-icon">👾</span> Amiibo Discovery
          @if (amiiboResults().length > 0) {
            <span class="tab-badge">{{ amiiboResults().length }}</span>
          }
        </button>
      </div>

      <!-- TAB 1: MANUAL GAME SEARCH -->
      @if (activeTab() === 'search') {
        <div class="tab-content animate-slide-up">
          <!-- Control Panel -->
          <div class="search-controls mb-lg">
            <div class="m3-input-wrapper">
              <span class="input-prefix-icon">🔍</span>
              <input
                #queryInput
                type="text"
                placeholder="Type game title..."
                class="m3-input"
                (keyup.enter)="
                  triggerSearch(queryInput.value, platformSelect.value)
                "
              />
            </div>

            <div class="select-wrapper">
              <select #platformSelect class="m3-select">
                <option value="">All Platforms</option>
                @for (group of platformGroups(); track group.brand) {
                  <optgroup [label]="group.brand">
                    @for (p of group.platforms; track p.id) {
                      @if (!p.parent_platform_id) {
                        <option [value]="p.id">
                          {{ p.display_name || p.name }}
                        </option>
                      } @else {
                        <option [value]="p.id">
                          &nbsp;&nbsp;↳ {{ p.display_name || p.name }}
                        </option>
                      }
                    }
                  </optgroup>
                }
              </select>
            </div>

            <button
              class="m3-btn m3-btn-primary"
              (click)="triggerSearch(queryInput.value, platformSelect.value)"
            >
              Search IGDB
            </button>
          </div>

          <!-- Search States -->
          @if (searchLoading()) {
            <div class="flex justify-center p-xl">
              <div class="spinner"></div>
            </div>
          }

          @if (searchError()) {
            <div class="error-banner mb-md">
              <span class="icon">⚠️</span>
              <p>{{ searchError() }}</p>
            </div>
          }

          @if (
            !searchLoading() &&
            searchResults().length === 0 &&
            !searchError() &&
            !searchPerformed()
          ) {
            <div class="empty-state">
              <div class="empty-icon text-4xl">🔍</div>
              <h3>Begin Manual Search</h3>
              <p class="text-secondary">
                Select a platform and type a title above to discover matches
                from IGDB.
              </p>
            </div>
          }

          @if (
            !searchLoading() &&
            searchResults().length === 0 &&
            !searchError() &&
            searchPerformed()
          ) {
            <div class="empty-state animate-slide-up">
              <div class="empty-icon text-4xl">📭</div>
              <h3>No Games Found on IGDB</h3>
              <p class="text-secondary mb-md">
                We couldn't find any games matching "{{ lastQuery() }}" on the
                selected platform.
              </p>
              <button
                class="m3-btn m3-btn-secondary btn-sm"
                (click)="clearSearchState()"
              >
                Clear Search
              </button>
            </div>
          }

          <!-- Search Results Grid -->
          @if (!searchLoading() && searchResults().length > 0) {
            <div class="results-grid">
              @for (game of searchResults(); track game.id) {
                <div class="game-result-card">
                  <div class="result-cover">
                    @if (game.image_url) {
                      <img
                        [src]="game.image_url"
                        alt="cover"
                        referrerpolicy="no-referrer"
                      />
                    } @else {
                      <div class="no-image">No Cover Available</div>
                    }
                  </div>
                  <div class="result-details">
                    <div>
                      <h4 class="result-title" [title]="game.name">
                        {{ game.name }}
                      </h4>
                      <span class="platform-badge">{{ game.platform }}</span>
                    </div>
                    <button
                      class="m3-btn m3-btn-secondary mt-md w-full"
                      (click)="openIngestionModal(game, platformSelect.value)"
                    >
                      Ingest Game
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- TAB 2: SERIES DISCOVERY -->
      @if (activeTab() === 'scan') {
        <div class="tab-content animate-slide-up">
          <!-- CTA Action panel -->
          @if (!scanLoading() && scanResults().length === 0) {
            <div class="scan-cta-card">
              <div class="text-4xl mb-md">🧭</div>
              <h2>Scan Tracked Franchises</h2>
              <p class="text-secondary mb-lg max-w-md mx-auto">
                Scan tracked collections against IGDB to surface missing
                canonical entries on supported platforms.
              </p>
              <button
                class="m3-btn m3-btn-primary"
                (click)="triggerSeriesScan()"
              >
                🔄 Start Franchise Scan
              </button>
            </div>
          }

          <!-- Scan Loading state -->
          @if (scanLoading()) {
            <div class="scan-loading-card">
              <div class="progress-pulse"></div>
              <h3>Franchise Scan in Progress</h3>
              <p class="text-secondary text-sm max-w-sm">
                Fetching series metadata, compiling missing matches, and
                cross-referencing catalogs. This takes a moment...
              </p>
            </div>
          }

          <!-- Scan Error State -->
          @if (scanError()) {
            <div class="error-banner mb-md">
              <span class="icon">⚠️</span>
              <p>{{ scanError() }}</p>
            </div>
          }

          <!-- Scan Results Grid -->
          @if (!scanLoading() && scanResults().length > 0) {
            <div
              class="scan-results-header mb-md flex justify-between items-center"
            >
              <div>
                <h3>{{ scanResults().length }} Suggestions Found</h3>
                <p class="text-secondary text-xs">
                  Series scans assume games are unowned and unplayed by default.
                </p>
              </div>
              <div class="flex gap-sm">
                <button
                  class="m3-btn m3-btn-secondary"
                  (click)="toggleSelectAllScan()"
                >
                  {{
                    selectedScanGameIds().size === scanResults().length
                      ? 'Deselect All'
                      : 'Select All'
                  }}
                </button>
                <button
                  class="m3-btn m3-btn-primary"
                  [disabled]="selectedScanGameIds().size === 0"
                  (click)="bulkAddSeriesGames()"
                >
                  Bulk Ingest ({{ selectedScanGameIds().size }})
                </button>
              </div>
            </div>

            <div class="series-grid">
              @for (
                game of scanResults();
                track game.id + '-' + game.platform_id
              ) {
                <div class="series-game-card">
                  <input
                    type="checkbox"
                    class="series-card-checkbox"
                    [checked]="
                      selectedScanGameIds().has(
                        game.id + '-' + game.platform_id
                      )
                    "
                    (change)="toggleScanSelection(game)"
                  />

                  <div class="series-game-cover">
                    @if (game.image_url) {
                      <img
                        [src]="game.image_url"
                        alt="cover"
                        referrerpolicy="no-referrer"
                      />
                    } @else {
                      <div class="no-image">No Cover</div>
                    }
                  </div>

                  <div class="series-game-info">
                    <div
                      class="flex justify-between items-start flex-wrap gap-sm"
                    >
                      <div>
                        <h4 class="text-base font-bold">{{ game.title }}</h4>
                        <div class="flex gap-sm items-center mt-sm">
                          <span class="platform-badge">{{
                            game.platform
                          }}</span>
                          @if (game.collections) {
                            <span class="metadata-badge"
                              >Series: {{ game.collections }}</span
                            >
                          }
                          @if (game.franchises) {
                            <span class="metadata-badge"
                              >Franchise: {{ game.franchises }}</span
                            >
                          }
                        </div>
                      </div>
                      <button
                        class="m3-btn m3-btn-secondary btn-sm"
                        (click)="addGameFromSeries(game)"
                      >
                        One-click Add
                      </button>
                    </div>

                    @if (game.summary) {
                      <p class="option-summary text-xs mt-sm text-secondary">
                        {{ game.summary }}
                      </p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- TAB 3: AMIIBO DISCOVERY -->
      @if (activeTab() === 'amiibo') {
        <div class="tab-content animate-slide-up">
          <!-- CTA Action panel if not scanned yet -->
          @if (
            !amiiboLoading() &&
            amiiboResults().length === 0 &&
            !amiiboPerformed()
          ) {
            <div class="scan-cta-card">
              <div class="text-4xl mb-md">👾</div>
              <h2>Scan Amiibo Catalog</h2>
              <p class="text-secondary mb-lg max-w-md mx-auto">
                Query the canonical AmiiboAPI database to discover newly
                released figures and cards that are missing from your
                collection.
              </p>
              <button
                class="m3-btn m3-btn-primary"
                (click)="triggerAmiiboScan()"
              >
                👾 Scan Missing Amiibo
              </button>
            </div>
          }

          <!-- Scan Loading state -->
          @if (amiiboLoading()) {
            <div class="scan-loading-card">
              <div class="progress-pulse"></div>
              <h3>Amiibo Scan in Progress</h3>
              <p class="text-secondary text-sm max-w-sm">
                Fetching amiibo catalog from AmiiboAPI and cross-referencing
                with your collection...
              </p>
            </div>
          }

          <!-- Scan Error State -->
          @if (amiiboError()) {
            <div class="error-banner mb-md">
              <span class="icon">⚠️</span>
              <p>{{ amiiboError() }}</p>
            </div>
          }

          <!-- Empty Result State -->
          @if (
            !amiiboLoading() &&
            amiiboResults().length === 0 &&
            !amiiboError() &&
            amiiboPerformed()
          ) {
            <div class="empty-state animate-slide-up">
              <div class="empty-icon text-4xl">🎉</div>
              <h3>All Amiibo Reconciled!</h3>
              <p class="text-secondary mb-md">
                Your collection includes every amiibo currently registered in
                the database.
              </p>
              <button
                class="m3-btn m3-btn-secondary btn-sm"
                (click)="triggerAmiiboScan()"
              >
                🔄 Scan Again
              </button>
            </div>
          }

          <!-- Amiibo Results List -->
          @if (!amiiboLoading() && amiiboResults().length > 0) {
            <!-- Controls & Filters -->
            <div class="amiibo-filters-bar mb-md">
              <div class="flex flex-wrap gap-sm items-center flex-1">
                <input
                  type="text"
                  placeholder="Filter by name..."
                  class="m3-input amiibo-search-input"
                  [value]="amiiboSearchQuery()"
                  (input)="onAmiiboSearchInput($event)"
                />

                <select
                  class="m3-select amiibo-select"
                  [value]="amiiboSeriesFilter()"
                  (change)="onAmiiboSeriesChange($event)"
                >
                  <option value="all">All Series</option>
                  @for (s of amiiboSeriesList(); track s) {
                    <option [value]="s">{{ s }}</option>
                  }
                </select>

                <select
                  class="m3-select amiibo-select"
                  [value]="amiiboTypeFilter()"
                  (change)="onAmiiboTypeChange($event)"
                >
                  <option value="all">All Types</option>
                  @for (t of amiiboTypesList(); track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
              </div>

              <div class="flex gap-sm items-center">
                <button
                  class="m3-btn m3-btn-secondary btn-sm"
                  (click)="toggleSelectAllAmiibo()"
                >
                  {{
                    selectedAmiiboIds().size === filteredAmiiboResults().length
                      ? 'Deselect All'
                      : 'Select All'
                  }}
                </button>
                <button
                  class="m3-btn m3-btn-primary btn-sm"
                  [disabled]="selectedAmiiboIds().size === 0"
                  (click)="bulkAddAmiibo()"
                >
                  Bulk Ingest ({{ selectedAmiiboIds().size }})
                </button>
              </div>
            </div>

            <!-- Discovered Amiibo Cards Grid -->
            <div class="series-grid">
              @for (
                item of filteredAmiiboResults();
                track item.amiibo_id || item.id
              ) {
                <div class="series-game-card">
                  <input
                    type="checkbox"
                    class="series-card-checkbox"
                    [checked]="
                      selectedAmiiboIds().has(item.amiibo_id || item.id)
                    "
                    (change)="toggleAmiiboSelection(item)"
                  />

                  <div class="amiibo-card-cover">
                    @if (item.image_url) {
                      <img
                        [src]="item.image_url"
                        alt="amiibo"
                        referrerpolicy="no-referrer"
                      />
                    } @else {
                      <div class="no-image">No Image</div>
                    }
                  </div>

                  <div class="series-game-info">
                    <div
                      class="flex justify-between items-start flex-wrap gap-sm"
                    >
                      <div>
                        <h4 class="text-base font-bold">{{ item.name }}</h4>
                        <div class="flex gap-sm items-center mt-sm flex-wrap">
                          <span class="platform-badge toy-badge">amiibo</span>
                          <span class="metadata-badge"
                            >Series: {{ item.series_name }}</span
                          >
                          <span class="metadata-badge"
                            >Type: {{ item.type }}</span
                          >
                          @if (item.release_date) {
                            <span class="metadata-badge"
                              >Released: {{ item.release_date }}</span
                            >
                          }
                        </div>
                      </div>
                      <button
                        class="m3-btn m3-btn-secondary btn-sm"
                        (click)="addSingleAmiibo(item)"
                      >
                        One-click Ingest
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- INGESTION MODAL DIALOG -->
    @if (showModal() && modalGame(); as game) {
      <div class="modal-backdrop" (click)="closeIngestionModal()">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Ingest Game Metadata</h3>
            <button class="close-btn" (click)="closeIngestionModal()">
              &times;
            </button>
          </div>

          <div class="modal-body">
            @if (modalLoading()) {
              <div class="flex justify-center p-xl">
                <div class="spinner"></div>
              </div>
            } @else {
              <!-- Target Platform Selection for Global Searches -->
              @if (modalInitialPlatformId() === 0) {
                <div class="form-field mb-lg">
                  <label for="modal-platform-select">Target Platform</label>
                  <select
                    id="modal-platform-select"
                    class="m3-select"
                    [value]="modalPlatformId()"
                    (change)="onModalPlatformChange($event)"
                  >
                    <option value="0">Select Target Platform...</option>
                    @for (group of platformGroups(); track group.brand) {
                      <optgroup [label]="group.brand">
                        @for (p of group.platforms; track p.id) {
                          @if (!p.parent_platform_id) {
                            <option [value]="p.id">
                              {{ p.display_name || p.name }}
                            </option>
                          } @else {
                            <option [value]="p.id">
                              &nbsp;&nbsp;↳ {{ p.display_name || p.name }}
                            </option>
                          }
                        }
                      </optgroup>
                    }
                  </select>
                </div>
              }

              <!-- Game Header Summary -->
              <div class="flex gap-md mb-lg items-start">
                <div class="modal-game-cover">
                  @if (game.image_url) {
                    <img
                      [src]="game.image_url"
                      alt="cover"
                      referrerpolicy="no-referrer"
                    />
                  } @else {
                    <div class="no-image">No Cover</div>
                  }
                </div>
                <div>
                  <h2 class="text-lg font-bold">{{ game.name }}</h2>
                  <span class="platform-badge mt-sm">{{
                    game.platform || 'Unknown Platform'
                  }}</span>
                  @if (game.summary) {
                    <p class="text-xs text-secondary mt-sm line-clamp-3">
                      {{ game.summary }}
                    </p>
                  }
                </div>
              </div>

              <!-- Ingestion status parameters -->
              <div class="modal-meta-grid">
                <div class="form-field">
                  <label for="ownership-select">Ownership Status</label>
                  <select
                    id="ownership-select"
                    class="m3-select"
                    (change)="onOwnershipChange($event)"
                  >
                    <option value="1" selected>Owned</option>
                    <option value="2">Seeking</option>
                    <option value="3">Ordered</option>
                    <option value="0">Unowned</option>
                  </select>
                </div>

                <div class="form-field">
                  <label for="play-select">Play Status</label>
                  <select
                    id="play-select"
                    class="m3-select"
                    (change)="onPlayChange($event)"
                  >
                    <option value="0" selected>Unplayed</option>
                    <option value="1">Played</option>
                    <option value="2">Playing</option>
                    <option value="3">Queued</option>
                    <option value="4">Paused</option>
                    <option value="5">Dropped</option>
                  </select>
                </div>

                <div class="form-field">
                  <label for="backup-select">Backup Status</label>
                  <select
                    id="backup-select"
                    class="m3-select"
                    (change)="onBackupChange($event)"
                  >
                    <option value="0" selected>Not Backed Up</option>
                    <option value="1">Backed Up</option>
                  </select>
                </div>
              </div>
            }
          </div>

          <div class="modal-footer">
            <button
              class="m3-btn m3-btn-secondary"
              [disabled]="modalLoading()"
              (click)="closeIngestionModal()"
            >
              Cancel
            </button>
            <button
              class="m3-btn m3-btn-primary"
              [disabled]="modalLoading() || !game || !modalPlatformId()"
              (click)="submitIngestion()"
            >
              Ingest & Sync
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Sticky Floating Action Bar for Bulk operations -->
    <div
      class="bulk-action-bar"
      [class.visible]="
        selectedScanGameIds().size > 0 ||
        (activeTab() === 'amiibo' && selectedAmiiboIds().size > 0)
      "
    >
      @if (activeTab() === 'scan') {
        <span class="text-sm font-bold"
          >{{ selectedScanGameIds().size }} Games Selected</span
        >
        <div class="flex gap-sm">
          <button
            class="m3-btn m3-btn-secondary btn-sm py-2"
            (click)="clearScanSelection()"
          >
            Cancel
          </button>
          <button
            class="m3-btn m3-btn-primary btn-sm py-2"
            (click)="bulkAddSeriesGames()"
          >
            Ingest Bulk
          </button>
        </div>
      } @else if (activeTab() === 'amiibo') {
        <span class="text-sm font-bold"
          >{{ selectedAmiiboIds().size }} Amiibo Selected</span
        >
        <div class="flex gap-sm">
          <button
            class="m3-btn m3-btn-secondary btn-sm py-2"
            (click)="clearAmiiboSelection()"
          >
            Cancel
          </button>
          <button
            class="m3-btn m3-btn-primary btn-sm py-2"
            (click)="bulkAddAmiibo()"
          >
            Ingest Bulk
          </button>
        </div>
      }
    </div>

    <!-- Toast Notification -->
    @if (toastMessage()) {
      <div class="m3-toast-container animate-toast">
        <div class="m3-toast-card">
          <span class="m3-toast-icon">✨</span>
          <span class="m3-toast-text">{{ toastMessage() }}</span>
          <button class="m3-toast-close" (click)="toastMessage.set(null)">
            &times;
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .discovery-container {
        padding: var(--spacing-16) var(--container-padding);
        max-width: 1280px;
        margin: 0 auto;
      }
      .discovery-header-panel {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4);
      }
      .text-gradient {
        font-size: 2.5rem;
        margin: 0;
        background: linear-gradient(135deg, #fff, var(--m3-primary-light));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .max-w-md {
        max-width: 28rem;
      }
      .max-w-sm {
        max-width: 24rem;
      }
      .mx-auto {
        margin-left: auto;
        margin-right: auto;
      }
      .w-full {
        width: 100%;
      }
      .text-base {
        font-size: 1rem;
      }
      .py-1 {
        padding-top: 0.25rem;
        padding-bottom: 0.25rem;
      }
      .px-3 {
        padding-left: 0.75rem;
        padding-right: 0.75rem;
      }
      .py-2 {
        padding-top: 0.5rem;
        padding-bottom: 0.5rem;
      }
      .text-xxs {
        font-size: 0.65rem;
      }
      .tabs-container {
        display: flex;
        gap: var(--spacing-8);
        border-bottom: 1px solid var(--border-color);
        padding-bottom: var(--spacing-8);
      }
      .tab-button {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        font-size: 1rem;
        font-weight: 600;
        padding: var(--spacing-8) var(--spacing-16);
        border-radius: var(--radius-md);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
        transition: all 0.2s ease;
      }
      .tab-button:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }
      .tab-button.active {
        background: var(--m3-primary-container);
        color: var(--m3-primary);
      }
      .search-controls {
        display: flex;
        gap: var(--spacing-12);
        align-items: center;
        flex-wrap: wrap;
      }
      .m3-input-wrapper {
        position: relative;
        flex: 1;
        min-width: 260px;
      }
      .input-prefix-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        pointer-events: none;
        opacity: 0.6;
      }
      .m3-input {
        width: 100%;
        padding: var(--spacing-12) var(--spacing-16) var(--spacing-12) 36px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background: var(--surface-card);
        color: var(--text-primary);
        font-size: 0.95rem;
        box-sizing: border-box;
      }
      .m3-input:focus {
        outline: none;
        border-color: var(--m3-primary);
      }
      .amiibo-search-input {
        min-width: 200px;
        max-width: 280px;
        padding: var(--spacing-8) var(--spacing-12);
      }
      .select-wrapper {
        min-width: 220px;
      }
      .m3-select {
        width: 100%;
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-color);
        background: var(--surface-card);
        color: var(--text-primary);
        font-size: 0.95rem;
        cursor: pointer;
        box-sizing: border-box;
      }
      .amiibo-select {
        width: auto;
        min-width: 150px;
        padding: var(--spacing-8) var(--spacing-12);
      }
      .amiibo-filters-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-12);
        flex-wrap: wrap;
        background: var(--surface-card);
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
      }
      .m3-btn {
        padding: 12px 24px;
        min-height: 44px;
        border-radius: var(--radius-md);
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 700;
        cursor: pointer;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-8);
        transition: all 0.2s ease;
        text-decoration: none;
        box-sizing: border-box;
        line-height: 1.2;
      }
      .m3-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .m3-btn-primary {
        background: var(--m3-primary);
        color: var(--m3-on-primary, #452b00);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .m3-btn-primary:hover:not(:disabled) {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container, #ffddb3);
        box-shadow: 0 4px 14px rgba(255, 185, 81, 0.25);
      }
      .m3-btn-secondary {
        background: var(--m3-surface-container-high, rgba(255, 255, 255, 0.08));
        color: var(--m3-on-surface, #e9e1d9);
        border: 1px solid var(--border-color);
      }
      .m3-btn-secondary:hover:not(:disabled) {
        background: var(
          --m3-surface-container-highest,
          rgba(255, 255, 255, 0.16)
        );
        color: #ffffff;
      }
      .tab-badge {
        background: var(--m3-primary);
        color: var(--m3-on-primary, #452b00);
        font-weight: 700;
        font-size: 0.75rem;
        padding: 2px 6px;
        border-radius: var(--radius-full);
      }
      .btn-sm {
        padding: 8px 16px;
        min-height: 36px;
        font-size: 0.85rem;
      }
      .empty-state {
        text-align: center;
        padding: var(--spacing-48) var(--spacing-16);
        background: var(--surface-card);
        border-radius: var(--radius-xl);
        border: 1px dashed var(--border-color);
      }
      .scan-cta-card {
        text-align: center;
        padding: var(--spacing-48) var(--spacing-24);
        background: var(--surface-card);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-color);
      }
      .scan-loading-card {
        text-align: center;
        padding: var(--spacing-48) var(--spacing-24);
        background: var(--surface-card);
        border-radius: var(--radius-xl);
        border: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-12);
      }
      .results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--spacing-16);
      }
      .game-result-card {
        background: var(--surface-card);
        border-radius: var(--radius-lg);
        border: 1px solid var(--border-color);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .result-cover {
        aspect-ratio: 3/4;
        background: #110e19;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .result-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .result-details {
        padding: var(--spacing-12);
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .result-title {
        font-size: 0.95rem;
        margin: 0 0 var(--spacing-6) 0;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .platform-badge {
        font-size: 0.75rem;
        background: var(--surface-hover);
        color: var(--text-secondary);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        display: inline-block;
      }
      .toy-badge {
        background: rgba(234, 88, 12, 0.2);
        color: #fb923c;
      }
      .metadata-badge {
        font-size: 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        color: var(--text-secondary);
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        display: inline-block;
      }
      .series-grid {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-12);
      }
      .series-game-card {
        background: var(--surface-card);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg);
        padding: var(--spacing-12);
        display: flex;
        align-items: center;
        gap: var(--spacing-16);
      }
      .series-card-checkbox {
        width: 20px;
        height: 20px;
        cursor: pointer;
        accent-color: var(--m3-primary);
      }
      .series-game-cover {
        width: 64px;
        height: 80px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: #110e19;
        flex-shrink: 0;
      }
      .series-game-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .amiibo-card-cover {
        width: 64px;
        height: 80px;
        border-radius: var(--radius-sm);
        overflow: hidden;
        background: #110e19;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .amiibo-card-cover img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .series-game-info {
        flex: 1;
      }
      .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        padding: var(--spacing-16);
        box-sizing: border-box;
      }
      .modal-content {
        background: var(--m3-surface-container, #241d15);
        color: var(--m3-on-surface, #e9e1d9);
        border: 1px solid var(--m3-outline-variant, rgba(255, 255, 255, 0.15));
        border-radius: var(--radius-xl);
        width: 100%;
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
        padding: var(--spacing-24);
        box-sizing: border-box;
        box-shadow:
          0 20px 60px rgba(0, 0, 0, 0.8),
          0 0 0 1px rgba(255, 255, 255, 0.1);
        animation: modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes modalFadeIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(8px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: var(--spacing-12);
        margin-bottom: var(--spacing-16);
      }
      .modal-header h3 {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0;
        color: #ffffff;
      }
      .close-btn {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        font-size: 1.75rem;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
      }
      .close-btn:hover {
        color: #ffffff;
      }
      .modal-game-cover {
        width: 80px;
        height: 100px;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: #110e19;
        flex-shrink: 0;
      }
      .modal-game-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .modal-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: var(--spacing-12);
        margin-top: var(--spacing-16);
      }
      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4);
      }
      .form-field label {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-secondary);
      }
      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-12);
        margin-top: var(--spacing-24);
        border-top: 1px solid var(--border-color);
        padding-top: var(--spacing-16);
      }
      .bulk-action-bar {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: #25193e;
        border: 1px solid var(--m3-primary);
        padding: var(--spacing-12) var(--spacing-24);
        border-radius: var(--radius-full);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        gap: var(--spacing-24);
        z-index: 900;
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .bulk-action-bar.visible {
        transform: translateX(-50%) translateY(0);
      }
      .m3-toast-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 1100;
      }
      .m3-toast-card {
        background: var(--surface-card);
        border: 1px solid var(--m3-primary);
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-lg);
        display: flex;
        align-items: center;
        gap: var(--spacing-12);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }
      .m3-toast-close {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: 1.2rem;
      }
      .error-banner {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid #ef4444;
        color: #fca5a5;
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
      }
      .progress-pulse {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--m3-primary);
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse {
        0% {
          transform: scale(0.8);
          opacity: 0.5;
        }
        50% {
          transform: scale(1.1);
          opacity: 1;
        }
        100% {
          transform: scale(0.8);
          opacity: 0.5;
        }
      }
      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--border-color);
        border-top-color: var(--m3-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .no-image {
        color: var(--text-secondary);
        font-size: 0.75rem;
        text-align: center;
      }
      .line-clamp-3 {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    `,
  ],
})
export class DiscoveryListComponent implements OnInit {
  public collectionService = inject(CollectionService);

  /** Active navigation tab. Defaults to Game Search ('search'). */
  public activeTab = signal<'search' | 'scan' | 'amiibo'>('search');

  /** Manual search logic signals. */
  public searchResults = signal<IGDBSearchResult[]>([]);
  public searchLoading = signal<boolean>(false);
  public searchError = signal<string | null>(null);
  public searchPerformed = signal<boolean>(false);
  public lastQuery = signal<string>('');

  /** Series scan logic signals. */
  public scanResults = signal<ScanSuggestion[]>([]);
  public scanLoading = signal<boolean>(false);
  public scanError = signal<string | null>(null);
  public selectedScanGameIds = signal<Set<string>>(new Set());

  /** Amiibo discovery logic signals. */
  public amiiboResults = signal<AmiiboDiscoveryItem[]>([]);
  public amiiboLoading = signal<boolean>(false);
  public amiiboError = signal<string | null>(null);
  public amiiboPerformed = signal<boolean>(false);
  public selectedAmiiboIds = signal<Set<string>>(new Set());
  public amiiboSeriesFilter = signal<string>('all');
  public amiiboTypeFilter = signal<string>('all');
  public amiiboSearchQuery = signal<string>('');

  /** Ingestion modal status signals. */
  public showModal = signal<boolean>(false);
  public modalLoading = signal<boolean>(false);
  public modalGame = signal<IGDBSearchResult | null>(null);
  public modalPlatformId = signal<number>(0);
  public matchedReleases = signal<DiscoveryRelease[]>([]);
  public selectedReleaseIds = signal<Set<string>>(new Set());

  /** Ingestion form data signals. */
  public ownershipStatus = signal<number>(1);
  public playStatus = signal<number>(0);
  public backupStatus = signal<number>(0);

  /** Tracks the initial platform ID selected when the modal is opened. */
  public modalInitialPlatformId = signal<number>(0);

  /** Active toast message displayed at the bottom of the screen. */
  public toastMessage = signal<string | null>(null);

  /** Reference to the active toast auto-dismiss timer. */
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Computes the platform list grouped by brand for platform selector optgroups. */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms
      ? this.collectionService.platforms()
      : [];
    const grouped = new Map<string, Platform[]>();

    [...data].forEach((p) => {
      const b = p.brand || 'Other';
      if (!grouped.has(b)) grouped.set(b, []);
      grouped.get(b)!.push(p);
    });

    return Array.from(grouped.entries())
      .map(([brand, platforms]) => ({ brand, platforms }))
      .sort((a, b) => a.brand.localeCompare(b.brand));
  });

  /** Computes unique Amiibo series options for filtering. */
  public amiiboSeriesList = computed<string[]>(() => {
    const seriesSet = new Set<string>();
    this.amiiboResults().forEach((a) => {
      if (a.series_name) seriesSet.add(a.series_name);
    });
    return Array.from(seriesSet).sort();
  });

  /** Computes unique Amiibo types for filtering. */
  public amiiboTypesList = computed<string[]>(() => {
    const typeSet = new Set<string>();
    this.amiiboResults().forEach((a) => {
      if (a.type) typeSet.add(a.type);
    });
    return Array.from(typeSet).sort();
  });

  /** Filtered Amiibo view. */
  public filteredAmiiboResults = computed<AmiiboDiscoveryItem[]>(() => {
    const sFilter = this.amiiboSeriesFilter();
    const tFilter = this.amiiboTypeFilter();
    const query = this.amiiboSearchQuery().toLowerCase().trim();

    return this.amiiboResults().filter((item) => {
      if (sFilter !== 'all' && item.series_name !== sFilter) return false;
      if (tFilter !== 'all' && item.type !== tFilter) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  /**
   * Initializes component and triggers load.
   */
  ngOnInit() {
    this.loadPlatformsGracefully();
  }

  /**
   * Defensive getter for database platforms to support testing mocks.
   */
  get platformsList() {
    return this.collectionService.platforms
      ? this.collectionService.platforms()
      : [];
  }

  /**
   * Loads platforms list during initialization if not populated.
   */
  async loadPlatformsGracefully() {
    if (
      this.collectionService.platforms &&
      this.collectionService.platforms().length === 0
    ) {
      if (this.collectionService.refreshAll) {
        try {
          await this.collectionService.refreshAll();
        } catch (e) {
          console.error('[DiscoveryList] Platform preload failed:', e);
        }
      }
    }
  }

  /**
   * Invokes manual search on IGDB.
   *
   * @param query The search term.
   * @param platformIdStr The platform ID select option value.
   */
  async triggerSearch(query: string, platformIdStr: string) {
    if (!query) {
      alert('Please enter a search query.');
      return;
    }
    const platformId = Number(platformIdStr || 0);

    if (!this.collectionService.searchGames) {
      console.warn('[DiscoveryList] searchGames API is not available.');
      return;
    }

    this.searchLoading.set(true);
    this.searchError.set(null);
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lastQuery.set(query);

    try {
      const results = await firstValueFrom(
        this.collectionService.searchGames(query, platformId),
      );
      this.searchResults.set(results || []);
      this.searchPerformed.set(true);

      if (!results || results.length === 0) {
        if (this.collectionService.showConfirmation) {
          this.collectionService.showConfirmation(
            'No Results Found',
            `No games matching "${query}" were found on IGDB.`,
            () => {},
          );
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Error occurred during IGDB search.';
      this.searchError.set(msg);
    } finally {
      this.searchLoading.set(false);
    }
  }

  /**
   * Resets the search state to initial view.
   */
  clearSearchState() {
    this.searchResults.set([]);
    this.searchPerformed.set(false);
    this.lastQuery.set('');
    this.searchError.set(null);
  }

  /**
   * Fetches releases and opens the ingestion setup modal wizard.
   *
   * @param game The search candidate game object.
   * @param platformIdStr The selected platform ID.
   */
  async openIngestionModal(game: IGDBSearchResult, platformIdStr: string) {
    let platformId = Number(platformIdStr || 0);
    if (!platformId && game.platform) {
      const match = this.platformsList.find(
        (p) =>
          (p.display_name &&
            p.display_name.toLowerCase() === game.platform.toLowerCase()) ||
          (p.name && p.name.toLowerCase() === game.platform.toLowerCase()),
      );
      if (match) {
        platformId = match.id;
      }
    }
    const cleanIgdbId = game.id.toString().replace('igdb-', '');

    this.showModal.set(true);
    this.modalLoading.set(false);
    this.modalGame.set(game);
    this.modalPlatformId.set(platformId);
    this.modalInitialPlatformId.set(platformId);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());

    // Reset forms to defaults (Owned, Unplayed, Not Backed Up)
    this.ownershipStatus.set(1);
    this.playStatus.set(0);
    this.backupStatus.set(0);

    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }

    if (platformId && this.collectionService.getGameMatches) {
      this.modalLoading.set(true);
      try {
        const data = await firstValueFrom(
          this.collectionService.getGameMatches(cleanIgdbId, platformId),
        );
        if (data) {
          if (data.game) {
            this.modalGame.set(data.game);
          }
          this.matchedReleases.set(data.matchedReleases || []);
        }
      } catch (err: unknown) {
        console.warn('[DiscoveryList] Matches lookup fallback:', err);
      } finally {
        this.modalLoading.set(false);
      }
    }
  }

  /**
   * Handles platform selection changes from within the manual ingestion modal.
   */
  async onModalPlatformChange(event: Event) {
    const platformId = Number((event.target as HTMLSelectElement).value || 0);
    this.modalPlatformId.set(platformId);

    if (!platformId) {
      this.matchedReleases.set([]);
      this.selectedReleaseIds.set(new Set());
      return;
    }

    const game = this.modalGame();
    if (!game) return;

    const cleanIgdbId = game.id.toString().replace('igdb-', '');

    if (!this.collectionService.getGameMatches) return;

    this.modalLoading.set(true);
    try {
      const data = await firstValueFrom(
        this.collectionService.getGameMatches(cleanIgdbId, platformId),
      );
      if (data) {
        if (data.game) {
          this.modalGame.set(data.game);
        }
        this.matchedReleases.set(data.matchedReleases || []);
      }
    } catch (err: unknown) {
      console.warn('[DiscoveryList] Modal matches lookup error:', err);
    } finally {
      this.modalLoading.set(false);
    }
  }

  /**
   * Displays a toast notification message at the bottom of the screen.
   */
  public showToast(message: string) {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastMessage.set(message);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 4000);
  }

  /**
   * Closes ingestion modal and cleans up active states.
   */
  closeIngestionModal() {
    this.showModal.set(false);
    this.modalGame.set(null);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }

  onOwnershipChange(event: Event) {
    this.ownershipStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  onPlayChange(event: Event) {
    this.playStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  onBackupChange(event: Event) {
    this.backupStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Finalizes ingestion from manual search by calling addGame.
   */
  async submitIngestion() {
    const game = this.modalGame();
    if (!game) return;

    if (!this.collectionService.addGame) {
      console.warn('[DiscoveryList] addGame API is not available.');
      return;
    }

    const platformId = this.modalPlatformId();
    const allReleases = this.matchedReleases();
    const selectedKeys = this.selectedReleaseIds();
    const selectedReleases = allReleases.filter((r) =>
      selectedKeys.has(r.romCrc || r.name),
    );

    const payload = {
      game: {
        title: game.name,
        platform_id: platformId,
        igdb_id: Number(game.id.toString().replace('igdb-', '')),
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region: game.region || 'NA',
        image_url: game.image_url || null,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: this.ownershipStatus(),
        play_status: this.playStatus(),
        backup_status: this.backupStatus(),
      },
      releases: selectedReleases.map((r) => ({
        region: r.region || null,
        variants: r.variants || null,
        rom_name: r.name || null,
        rom_crc: r.romCrc || null,
        ownership_status: this.ownershipStatus(),
        backup_status: this.backupStatus(),
        release_date: r.releaseDate || null,
      })),
    };

    this.modalLoading.set(true);

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.closeIngestionModal();

      // Remove from search results for immediate visual feedback
      this.searchResults.update((current) =>
        current.filter((g) => g.id.toString() !== game.id.toString()),
      );

      if (this.collectionService.refreshAll) {
        await this.collectionService.refreshAll();
      }
      this.showToast(`Successfully ingested "${game.name}"!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert('Ingestion failed: ' + msg);
    } finally {
      this.modalLoading.set(false);
    }
  }

  /**
   * Series Discovery functions.
   */
  async triggerSeriesScan() {
    if (!this.collectionService.scanSeries) {
      console.warn('[DiscoveryList] scanSeries API is not available.');
      return;
    }

    this.scanLoading.set(true);
    this.scanError.set(null);
    this.scanResults.set([]);
    this.selectedScanGameIds.set(new Set());

    try {
      const results = await firstValueFrom(this.collectionService.scanSeries());
      this.scanResults.set(results || []);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Franchise series scan failed.';
      this.scanError.set(msg);
    } finally {
      this.scanLoading.set(false);
    }
  }

  toggleScanSelection(game: ScanSuggestion) {
    const key = game.id + '-' + game.platform_id;
    const current = new Set(this.selectedScanGameIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedScanGameIds.set(current);
  }

  toggleSelectAllScan() {
    const current = this.selectedScanGameIds();
    const results = this.scanResults();
    if (current.size === results.length) {
      this.selectedScanGameIds.set(new Set());
    } else {
      const set = new Set<string>();
      results.forEach((g) => set.add(g.id + '-' + g.platform_id));
      this.selectedScanGameIds.set(set);
    }
  }

  async addGameFromSeries(game: ScanSuggestion) {
    if (!this.collectionService.addGame) return;

    const payload = {
      game: {
        title: game.title,
        platform_id: game.platform_id,
        igdb_id: Number(game.id.toString().replace('igdb-', '')),
        igdb_url: game.igdb_url || null,
        summary: game.summary || null,
        genres: game.genres || null,
        region: game.region || 'NA',
        image_url: game.image_url,
        collections: game.collections || null,
        franchises: game.franchises || null,
        ownership_status: 0, // Unowned
        play_status: 0, // Unplayed
        backup_status: 0, // Not Backed Up
      },
      releases: game.releases
        ? game.releases.map((r: DiscoveryRelease) => ({
            region: r.region || null,
            variants: r.variants || null,
            rom_name: r.name || null,
            rom_crc: r.romCrc || null,
            ownership_status: 0,
            backup_status: 0,
            release_date: r.releaseDate || null,
          }))
        : [],
    };

    try {
      await firstValueFrom(this.collectionService.addGame(payload));
      this.scanResults.update((current) =>
        current.filter(
          (g) => !(g.id === game.id && g.platform_id === game.platform_id),
        ),
      );

      const key = game.id + '-' + game.platform_id;
      this.selectedScanGameIds.update((current) => {
        current.delete(key);
        return current;
      });

      if (this.collectionService.refreshAll) {
        await this.collectionService.refreshAll();
      }
      this.showToast(`Successfully ingested "${game.title}"!`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to add game "${game.title}": ` + msg);
    }
  }

  async bulkAddSeriesGames() {
    const selected = this.scanResults().filter((g) =>
      this.selectedScanGameIds().has(g.id + '-' + g.platform_id),
    );
    if (selected.length === 0) return;

    if (!this.collectionService.addGame) return;

    this.scanLoading.set(true);
    let count = 0;

    for (const game of selected) {
      const payload = {
        game: {
          title: game.title,
          platform_id: game.platform_id,
          igdb_id: Number(game.id.toString().replace('igdb-', '')),
          igdb_url: game.igdb_url || null,
          summary: game.summary,
          genres: game.genres,
          region: game.region || 'NA',
          image_url: game.image_url,
          collections: game.collections,
          franchises: game.franchises,
          ownership_status: 0,
          play_status: 0,
          backup_status: 0,
        },
        releases: game.releases
          ? game.releases.map((r: DiscoveryRelease) => ({
              region: r.region || null,
              variants: r.variants || null,
              rom_name: r.name || null,
              rom_crc: r.romCrc || null,
              ownership_status: 0,
              backup_status: 0,
              release_date: r.releaseDate || null,
            }))
          : [],
      };

      try {
        await firstValueFrom(this.collectionService.addGame(payload));
        count++;

        this.scanResults.update((current) =>
          current.filter(
            (g) => !(g.id === game.id && g.platform_id === game.platform_id),
          ),
        );

        const key = game.id + '-' + game.platform_id;
        this.selectedScanGameIds.update((current) => {
          current.delete(key);
          return current;
        });
      } catch (err: unknown) {
        console.error(`Failed to bulk add "${game.title}":`, err);
      }
    }

    this.scanLoading.set(false);
    if (this.collectionService.refreshAll) {
      await this.collectionService.refreshAll();
    }
    this.showToast(
      `Successfully bulk ingested ${count} franchise series games.`,
    );
  }

  clearScanSelection() {
    this.selectedScanGameIds.set(new Set());
  }

  /**
   * Amiibo Discovery Functions.
   */
  async triggerAmiiboScan() {
    if (!this.collectionService.scanAmiibo) return;

    this.amiiboLoading.set(true);
    this.amiiboError.set(null);
    this.amiiboResults.set([]);
    this.selectedAmiiboIds.set(new Set());
    this.amiiboPerformed.set(false);

    try {
      const results = await firstValueFrom(this.collectionService.scanAmiibo());
      this.amiiboResults.set(results || []);
      this.amiiboPerformed.set(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Amiibo scan failed.';
      this.amiiboError.set(msg);
    } finally {
      this.amiiboLoading.set(false);
    }
  }

  onAmiiboSearchInput(event: Event) {
    this.amiiboSearchQuery.set((event.target as HTMLInputElement).value || '');
  }

  onAmiiboSeriesChange(event: Event) {
    this.amiiboSeriesFilter.set(
      (event.target as HTMLSelectElement).value || 'all',
    );
  }

  onAmiiboTypeChange(event: Event) {
    this.amiiboTypeFilter.set(
      (event.target as HTMLSelectElement).value || 'all',
    );
  }

  toggleAmiiboSelection(item: AmiiboDiscoveryItem) {
    const key = item.amiibo_id || item.id;
    const current = new Set(this.selectedAmiiboIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedAmiiboIds.set(current);
  }

  toggleSelectAllAmiibo() {
    const visible = this.filteredAmiiboResults();
    const current = this.selectedAmiiboIds();
    if (current.size === visible.length) {
      this.selectedAmiiboIds.set(new Set());
    } else {
      const set = new Set<string>();
      visible.forEach((a) => set.add(a.amiibo_id || a.id));
      this.selectedAmiiboIds.set(set);
    }
  }

  clearAmiiboSelection() {
    this.selectedAmiiboIds.set(new Set());
  }

  async addSingleAmiibo(item: AmiiboDiscoveryItem) {
    if (!this.collectionService.addToy) return;
    try {
      const slugify = (s: string) =>
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      const toyPayload: Partial<Toy> = {
        id: `amiibo-${slugify(item.name)}-${slugify(item.series_name || 'amiibo')}`,
        name: item.name,
        line: 'amiibo',
        series: item.series_name,
        series_name: item.series_name,
        type: item.type || 'Figure',
        image_url: item.image_url,
        release_date: item.release_date || undefined,
        region: item.region || 'NA',
        amiibo_id: item.amiibo_id,
        ownership_status: 1, // Owned
        verified: 1,
        metadata_json: JSON.stringify(item),
      };

      await firstValueFrom(this.collectionService.addToy(toyPayload));
      this.amiiboResults.update((list) =>
        list.filter(
          (a) => (a.amiibo_id || a.id) !== (item.amiibo_id || item.id),
        ),
      );
      this.selectedAmiiboIds.update((s) => {
        s.delete(item.amiibo_id || item.id);
        return s;
      });

      if (this.collectionService.refreshAll) {
        await this.collectionService.refreshAll();
      }
      this.showToast(`Successfully added amiibo "${item.name}"!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to add amiibo "${item.name}": ` + msg);
    }
  }

  async bulkAddAmiibo() {
    if (!this.collectionService.addToy) return;
    const selectedIds = this.selectedAmiiboIds();
    const itemsToAdd = this.amiiboResults().filter((a) =>
      selectedIds.has(a.amiibo_id || a.id),
    );
    if (itemsToAdd.length === 0) return;

    this.amiiboLoading.set(true);
    let count = 0;
    const slugify = (s: string) =>
      (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    for (const item of itemsToAdd) {
      try {
        const toyPayload: Partial<Toy> = {
          id: `amiibo-${slugify(item.name)}-${slugify(item.series_name || 'amiibo')}`,
          name: item.name,
          line: 'amiibo',
          series: item.series_name,
          series_name: item.series_name,
          type: item.type || 'Figure',
          image_url: item.image_url,
          release_date: item.release_date || undefined,
          region: item.region || 'NA',
          amiibo_id: item.amiibo_id,
          ownership_status: 1,
          verified: 1,
          metadata_json: JSON.stringify(item),
        };
        await firstValueFrom(this.collectionService.addToy(toyPayload));
        count++;

        this.amiiboResults.update((list) =>
          list.filter(
            (a) => (a.amiibo_id || a.id) !== (item.amiibo_id || item.id),
          ),
        );
        this.selectedAmiiboIds.update((s) => {
          s.delete(item.amiibo_id || item.id);
          return s;
        });
      } catch (e) {
        console.error(`Failed to ingest amiibo ${item.name}:`, e);
      }
    }

    this.amiiboLoading.set(false);
    if (this.collectionService.refreshAll) {
      await this.collectionService.refreshAll();
    }
    this.showToast(`Successfully ingested ${count} amiibo items.`);
  }
}
