/**
 * GAME DISCOVERY & INGESTION COMPONENT
 *
 * This component handles the discovery and ingestion flows for the collection tracker.
 * It provides three main workflows for catalog management:
 * 1. Triage Report (Default): Displays pending scrape items that need reconciliation with IGDB.
 * 2. Manual Search: Allows user-triggered IGDB searches on a specific platform, physical DAT file matching,
 *    and configuration of metadata (ownership status, play status, and backup status) before adding to SQLite.
 * 3. Series Scan: Triggers an automated scan of all tracked franchises/series on IGDB to suggest missing games,
 *    supporting one-click and bulk checkboxes ingestion.
 *
 * DESIGN DECISIONS:
 * - Tabbed navigation separates maintenance (triage) from exploration (manual search & series scan).
 * - Rich HSL/M3 styling & glassmorphic containers provide a premium aesthetics feel.
 * - Robust fallback logic handles the unit tests context where some service signals are mocked/undefined.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  DiscoveryItem,
  DiscoveryOption,
  DiscoveryPayload,
  Platform,
  PlatformGroup,
  IGDBSearchResult,
  ScanSuggestion,
  DiscoveryRelease,
} from '../../../../core/models/collection.models';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-discovery-list',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="discovery-container animate-expressive">
      <!-- Header Area -->
      <div class="discovery-header-panel mb-lg">
        <h1 class="text-gradient">Game Discovery Center</h1>
        <p class="text-secondary text-sm">
          Discover, match, and ingest games into your local database.
        </p>
      </div>

      <!-- Tab Buttons Navigation -->
      <div class="tabs-container mb-lg">
        <button
          class="tab-button"
          [class.active]="activeTab() === 'triage'"
          (click)="activeTab.set('triage')"
        >
          <span class="tab-icon">📋</span> Triage Report
          @if (items().length > 0) {
            <span class="tab-badge">{{ items().length }}</span>
          }
        </button>
        <button
          class="tab-button"
          [class.active]="activeTab() === 'search'"
          (click)="activeTab.set('search')"
        >
          <span class="tab-icon">🔍</span> Manual Search
        </button>
        <button
          class="tab-button"
          [class.active]="activeTab() === 'scan'"
          (click)="activeTab.set('scan')"
        >
          <span class="tab-icon">🔄</span> Series Discovery
        </button>
      </div>

      <!-- TAB 1: TRIAGE REPORT -->
      @if (activeTab() === 'triage') {
        <div class="tab-content animate-slide-up">
          <div class="info-banner mb-md">
            <span class="icon">ℹ️</span>
            <p>
              Select matches for raw scraping outputs imported from
              physical/digital files.
            </p>
          </div>

          @if (collectionService.loading()) {
            <div class="flex justify-center p-xl">
              <div class="spinner"></div>
            </div>
          }

          @if (!collectionService.loading() && items().length === 0) {
            <div class="empty-state">
              <div class="empty-icon text-4xl">✅</div>
              <h3>No Pending Triage Items</h3>
              <p class="text-secondary">
                All scraped items reconciled. Run <code>npm run scrape</code> to
                scan files again.
              </p>
            </div>
          }

          @if (!collectionService.loading() && items().length > 0) {
            <div class="discovery-grid">
              @for (
                item of items();
                track item.title + item.platform;
                let i = $index
              ) {
                <div class="discovery-card card-glass">
                  <div class="card-header">
                    <div>
                      <h2 class="text-lg font-bold">{{ item.title }}</h2>
                      <div class="flex gap-sm items-center mt-sm">
                        <span
                          class="platform-badge"
                          [class.toy-badge]="item.platform === 'amiibo'"
                          >{{ item.platform }}</span
                        >
                        @if (item.line) {
                          <span class="metadata-badge"
                            >Line: {{ item.line }}</span
                          >
                        }
                        @if (item.series) {
                          <span class="metadata-badge"
                            >Series: {{ item.series }}</span
                          >
                        }
                      </div>
                    </div>
                    <div class="count-badge">
                      {{ item.options.length }} Candidates
                    </div>
                  </div>
                  <div class="options-scroll">
                    @for (opt of item.options; track opt.id) {
                      <div class="option-row">
                        <div class="option-cover">
                          @if (opt.image_url) {
                            <img [src]="opt.image_url" alt="cover" />
                          } @else {
                            <div class="no-image">No Cover</div>
                          }
                        </div>
                        <div class="option-info">
                          <div class="flex justify-between items-start">
                            <div>
                              <h4 class="option-name">{{ opt.name }}</h4>
                              <p class="option-platform text-xs text-secondary">
                                {{ opt.platform }}
                              </p>
                            </div>
                            <button
                              (click)="applyMatch(item, opt)"
                              class="btn-match"
                            >
                              Match
                            </button>
                          </div>
                          @if (opt.summary) {
                            <p class="option-summary text-xs mt-sm">
                              {{ opt.summary }}
                            </p>
                          }
                          <div class="option-id text-xxs text-secondary mt-sm">
                            ID: {{ opt.id }}
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- TAB 2: MANUAL SEARCH -->
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
                      <img [src]="game.image_url" alt="cover" />
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

      <!-- TAB 3: SERIES SCAN -->
      @if (activeTab() === 'scan') {
        <div class="tab-content animate-slide-up">
          <!-- CTA Action panel -->
          @if (!scanLoading() && scanResults().length === 0) {
            <div class="scan-cta-card">
              <div class="text-4xl mb-md">🧭</div>
              <h2>Scan Existing Franchise Series</h2>
              <p class="text-secondary mb-lg max-w-md mx-auto">
                Scan tracked collections on IGDB. We will match against platform
                release DATs and suggest missing titles. This ignores
                unsupported platforms automatically.
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
                cross-referencing DAT catalogs. This takes a moment...
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
                  Series scans assume games are unowned and not backed up.
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
                      <img [src]="game.image_url" alt="cover" />
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

                    @if (game.releases && game.releases.length > 0) {
                      <div class="mt-md">
                        <p
                          class="text-xxs text-secondary font-bold uppercase mb-sm"
                        >
                          Matched DAT Releases ({{ game.releases.length }})
                        </p>
                        <div class="flex flex-wrap">
                          @for (r of game.releases.slice(0, 10); track r.name) {
                            <span class="release-chip"
                              >{{ r.region || 'Unknown' }} - {{ r.name }}</span
                            >
                          }
                          @if (game.releases.length > 10) {
                            <span class="release-chip font-bold"
                              >+{{ game.releases.length - 10 }} more</span
                            >
                          }
                        </div>
                      </div>
                    } @else {
                      <p class="text-xxs text-secondary italic mt-md">
                        No matching DAT releases. A virtual release will be
                        created.
                      </p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- INGESTION MODAL DIALOG -->
    @if (showModal() && modalGame()) {
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
                  @if (modalGame().image_url) {
                    <img [src]="modalGame().image_url" alt="cover" />
                  } @else {
                    <div class="no-image">No Cover</div>
                  }
                </div>
                <div>
                  <h2 class="text-lg font-bold">{{ modalGame().name }}</h2>
                  <span class="platform-badge mt-sm">{{
                    modalGame().platform || 'Unknown Platform'
                  }}</span>
                  @if (modalGame().summary) {
                    <p class="text-xs text-secondary mt-sm line-clamp-3">
                      {{ modalGame().summary }}
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

              <!-- Physical Releases checklist -->
              <div class="release-checklist-section">
                <div class="checklist-header">
                  <label class="font-bold text-xs uppercase"
                    >Physical DAT Matches (Select to track)</label
                  >
                  @if (matchedReleases().length > 0) {
                    <div class="flex gap-sm">
                      <button
                        class="m3-btn m3-btn-secondary btn-sm py-1 px-3 text-xs"
                        (click)="selectAllReleases(matchedReleases())"
                      >
                        All
                      </button>
                      <button
                        class="m3-btn m3-btn-secondary btn-sm py-1 px-3 text-xs"
                        (click)="selectNoReleases()"
                      >
                        None
                      </button>
                    </div>
                  }
                </div>

                @if (matchedReleases().length === 0) {
                  <p class="text-xs text-secondary italic">
                    No matching physical releases in DAT file. A virtual default
                    release will be generated.
                  </p>
                } @else {
                  <div class="checklist-list">
                    @for (
                      rel of matchedReleases();
                      track rel.romCrc + '-' + rel.name
                    ) {
                      <div
                        class="checklist-item"
                        [class.selected]="
                          selectedReleaseIds().has(rel.romCrc || rel.name)
                        "
                        (click)="toggleReleaseSelection(rel)"
                      >
                        <input
                          type="checkbox"
                          [checked]="
                            selectedReleaseIds().has(rel.romCrc || rel.name)
                          "
                          (click)="
                            $event.stopPropagation();
                            toggleReleaseSelection(rel)
                          "
                        />
                        <div>
                          <div class="release-name">{{ rel.name }}</div>
                          <div class="release-meta">
                            Region: {{ rel.region || 'Unknown' }}
                            @if (rel.romCrc) {
                              | CRC: {{ rel.romCrc }}
                            }
                            @if (rel.variants) {
                              | Variants: {{ rel.variants }}
                            }
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                }
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
              [disabled]="modalLoading() || !modalGame() || !modalPlatformId()"
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
      [class.visible]="selectedScanGameIds().size > 0"
    >
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
      }
      .max-w-md {
        max-width: 28rem;
      }
      .max-w-sm {
        max-w: 24rem;
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

      .tabs-container {
        display: flex;
        gap: var(--spacing-12);
        border-bottom: 1px solid var(--glass-border);
        padding-bottom: var(--spacing-12);
        flex-wrap: wrap;
      }
      .tab-button {
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        font-family: var(--font-heading);
        font-weight: 600;
        font-size: 0.95rem;
        padding: var(--spacing-8) var(--spacing-16);
        cursor: pointer;
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
        position: relative;
      }
      .tab-button:hover {
        background: rgba(255, 255, 255, 0.05);
        color: var(--m3-primary);
      }
      .tab-button.active {
        color: var(--m3-primary);
        background: rgba(255, 185, 81, 0.08);
      }
      .tab-button.active::after {
        content: '';
        position: absolute;
        bottom: -13px;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--m3-primary);
        border-radius: var(--radius-full);
      }
      .tab-badge {
        font-size: 0.7rem;
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        padding: 0.1rem 0.4rem;
        border-radius: var(--radius-full);
        font-weight: bold;
        margin-left: var(--spacing-4);
      }

      /* Triage Pending */
      .info-banner {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--glass-border);
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-xs);
        display: flex;
        gap: var(--spacing-12);
        align-items: center;
      }
      .info-banner p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--m3-on-surface-variant);
      }

      .discovery-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        gap: var(--spacing-16);
      }
      .discovery-card {
        display: flex;
        flex-direction: column;
        height: 480px;
        background: rgba(30, 41, 59, 0.3);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }
      .card-header {
        padding: var(--spacing-16);
        border-bottom: 1px solid var(--glass-border);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        background: rgba(255, 255, 255, 0.02);
      }
      .platform-badge {
        font-size: 0.75rem;
        background: rgba(255, 255, 255, 0.08);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        color: var(--m3-on-surface-variant);
        font-weight: 600;
      }
      .toy-badge {
        background: rgba(255, 185, 81, 0.15);
        color: var(--m3-primary);
      }
      .metadata-badge {
        font-size: 0.7rem;
        background: rgba(255, 255, 255, 0.04);
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        color: var(--m3-on-surface-variant);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .count-badge {
        font-size: 0.75rem;
        color: var(--m3-primary);
        font-weight: 600;
      }
      .options-scroll {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-8);
      }
      .option-row {
        display: flex;
        gap: var(--spacing-12);
        padding: var(--spacing-12);
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        transition: background 0.2s;
      }
      .option-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .option-row:last-child {
        border-bottom: none;
      }
      .option-cover {
        width: 54px;
        height: 72px;
        flex-shrink: 0;
        border-radius: var(--radius-xs);
        overflow: hidden;
        background: #101726;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--glass-border);
      }
      .option-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .no-image {
        font-size: 0.6rem;
        color: var(--m3-on-surface-variant);
        text-align: center;
      }
      .option-info {
        flex: 1;
        min-width: 0;
      }
      .option-name {
        font-weight: 700;
        color: var(--m3-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 0.95rem;
      }
      .option-summary {
        color: var(--m3-on-surface-variant);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.4;
      }
      .btn-match {
        background: var(--m3-primary);
        border: none;
        color: var(--m3-on-primary);
        padding: 0.3rem 0.75rem;
        border-radius: var(--radius-xs);
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 700;
        transition: all 0.2s;
      }
      .btn-match:hover {
        background: #ffa826;
        transform: scale(1.05);
      }

      /* Manual Search controls */
      .search-controls {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-16);
        display: flex;
        gap: var(--spacing-16);
        flex-wrap: wrap;
        align-items: center;
      }
      .m3-input-wrapper {
        flex: 1;
        min-width: 260px;
        position: relative;
      }
      .m3-input {
        width: 100%;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-xs);
        padding: var(--spacing-12) var(--spacing-16) var(--spacing-12) 40px;
        color: var(--m3-on-surface);
        font-family: var(--font-body);
        font-size: 0.95rem;
        outline: none;
        transition: all 0.3s ease;
      }
      .m3-input:focus {
        border-color: var(--m3-primary);
        box-shadow: 0 0 0 3px rgba(255, 185, 81, 0.15);
      }
      .input-prefix-icon {
        position: absolute;
        left: 14px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 1.1rem;
        color: var(--m3-on-surface-variant);
      }
      .m3-select {
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline);
        border-radius: var(--radius-sm);
        padding: var(--spacing-12) var(--spacing-16);
        color: var(--m3-on-surface);
        font-family: var(--font-body);
        font-size: 0.95rem;
        outline: none;
        cursor: pointer;
        min-width: 200px;
        transition: all 0.3s ease;
      }
      .m3-select:focus {
        border-color: var(--m3-primary);
        background: var(--m3-surface-container-highest);
        box-shadow: 0 0 0 1px var(--m3-primary);
      }
      .m3-select option,
      .m3-select optgroup {
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
      }
      .select-wrapper {
        position: relative;
      }

      .m3-btn {
        font-family: var(--font-heading);
        font-weight: 600;
        font-size: 0.95rem;
        padding: var(--spacing-12) var(--spacing-24);
        border-radius: var(--radius-full);
        border: none;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-8);
      }
      .m3-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
        box-shadow: none !important;
      }
      .m3-btn-primary {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
      }
      .m3-btn-primary:hover {
        background: #ffa826;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(255, 185, 81, 0.3);
      }
      .m3-btn-secondary {
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
        border: 1px solid var(--m3-outline-variant);
      }
      .m3-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.05);
        transform: translateY(-2px);
      }
      .btn-sm {
        padding: 0.4rem 0.8rem;
        font-size: 0.8rem;
      }

      .results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--spacing-24);
      }
      .game-result-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: rgba(30, 41, 59, 0.3);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      }
      .game-result-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
        border-color: var(--m3-primary);
      }
      .result-cover {
        height: 220px;
        background: #101726;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-bottom: 1px solid var(--glass-border);
      }
      .result-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.5s ease;
      }
      .game-result-card:hover .result-cover img {
        transform: scale(1.05);
      }
      .result-details {
        padding: var(--spacing-16);
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .result-title {
        font-size: 1rem;
        font-weight: 700;
        margin: 0 0 var(--spacing-8) 0;
        color: var(--m3-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Ingestion Modal Styles */
      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-24);
        animation: fadeIn 0.3s ease forwards;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .modal-content {
        background: var(--m3-surface-container-high);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 680px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
        animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }
      @keyframes slideUp {
        from {
          transform: translateY(30px) scale(0.95);
          opacity: 0;
        }
        to {
          transform: translateY(0) scale(1);
          opacity: 1;
        }
      }
      .modal-header {
        padding: var(--spacing-16) var(--spacing-24);
        border-bottom: 1px solid var(--glass-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .modal-header h3 {
        margin: 0;
        color: var(--m3-primary);
        font-size: 1.25rem;
      }
      .modal-body {
        padding: var(--spacing-24);
      }
      .modal-footer {
        padding: var(--spacing-16) var(--spacing-24);
        border-top: 1px solid var(--glass-border);
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-12);
        background: rgba(0, 0, 0, 0.1);
      }
      .close-btn {
        background: transparent;
        border: none;
        font-size: 1.8rem;
        cursor: pointer;
        color: var(--m3-on-surface-variant);
        transition: color 0.2s;
        line-height: 1;
      }
      .close-btn:hover {
        color: var(--m3-primary);
      }
      .modal-game-cover {
        width: 75px;
        height: 100px;
        border-radius: var(--radius-xs);
        overflow: hidden;
        background: #101726;
        border: 1px solid var(--glass-border);
        flex-shrink: 0;
      }
      .modal-game-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .modal-meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--spacing-16);
        margin-bottom: var(--spacing-24);
      }
      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-8);
      }
      .form-field label {
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--m3-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .form-field select {
        width: 100%;
      }

      .release-checklist-section {
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-16);
      }
      .checklist-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-12);
      }
      .checklist-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-8);
        max-height: 220px;
        overflow-y: auto;
        padding-right: var(--spacing-4);
      }
      .checklist-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-12);
        background: rgba(255, 255, 255, 0.02);
        padding: var(--spacing-12);
        border-radius: var(--radius-xs);
        border: 1px solid transparent;
        cursor: pointer;
        transition: all 0.2s;
      }
      .checklist-item:hover {
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--glass-border);
      }
      .checklist-item.selected {
        background: rgba(255, 185, 81, 0.05);
        border-color: rgba(255, 185, 81, 0.25);
      }
      .checklist-item input[type='checkbox'] {
        accent-color: var(--m3-primary);
        width: 18px;
        height: 18px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .release-name {
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--m3-on-surface);
      }
      .release-meta {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        margin-top: 2px;
      }

      /* Series Scan styles */
      .scan-cta-card {
        background: linear-gradient(
          135deg,
          rgba(255, 185, 81, 0.08),
          rgba(178, 240, 141, 0.05)
        );
        border: 1px solid rgba(255, 185, 81, 0.15);
        border-radius: var(--radius-lg);
        padding: 48px;
        text-align: center;
        margin-bottom: var(--spacing-24);
      }
      .scan-cta-card h2 {
        font-size: 1.8rem;
        color: var(--m3-primary);
        margin-bottom: var(--spacing-8);
      }
      .scan-loading-card {
        background: rgba(30, 41, 59, 0.25);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-lg);
        padding: 48px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-24);
        margin-bottom: var(--spacing-24);
      }
      .progress-pulse {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: var(--m3-primary);
        box-shadow: 0 0 0 0 rgba(255, 185, 81, 0.4);
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse {
        0% {
          transform: scale(0.95);
          box-shadow: 0 0 0 0 rgba(255, 185, 81, 0.6);
        }
        70% {
          transform: scale(1);
          box-shadow: 0 0 0 20px rgba(255, 185, 81, 0);
        }
        100% {
          transform: scale(0.95);
          box-shadow: 0 0 0 0 rgba(255, 185, 81, 0);
        }
      }

      .series-grid {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-16);
        margin-bottom: 96px;
      }
      .series-game-card {
        display: flex;
        gap: var(--spacing-16);
        background: rgba(30, 41, 59, 0.25);
        border: 1px solid var(--glass-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-16);
        align-items: flex-start;
        transition: border-color 0.3s;
      }
      .series-game-card:hover {
        border-color: rgba(255, 185, 81, 0.3);
      }
      .series-card-checkbox {
        margin-top: 6px;
        width: 20px;
        height: 20px;
        accent-color: var(--m3-primary);
        cursor: pointer;
        flex-shrink: 0;
      }
      .series-game-cover {
        width: 72px;
        height: 96px;
        background: #101726;
        border-radius: var(--radius-xs);
        overflow: hidden;
        flex-shrink: 0;
        border: 1px solid var(--glass-border);
      }
      .series-game-cover img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .series-game-info {
        flex: 1;
        min-width: 0;
      }
      .release-chip {
        display: inline-block;
        font-size: 0.7rem;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--glass-border);
        padding: 2px var(--spacing-8);
        border-radius: var(--radius-full);
        color: var(--m3-on-surface-variant);
        margin-right: 6px;
        margin-bottom: 6px;
        font-weight: 500;
      }

      .error-banner {
        background: rgba(255, 81, 81, 0.1);
        border: 1px solid rgba(255, 81, 81, 0.3);
        color: #ff8080;
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-xs);
        display: flex;
        gap: var(--spacing-12);
        align-items: center;
      }
      .error-banner p {
        margin: 0;
        font-size: 0.85rem;
      }

      /* Bulk action bar */
      .bulk-action-bar {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(120px);
        background: var(--m3-surface-container-highest);
        border: 1.5px solid var(--m3-primary);
        border-radius: var(--radius-full);
        padding: var(--spacing-12) var(--spacing-24);
        display: flex;
        align-items: center;
        gap: var(--spacing-24);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
        z-index: 900;
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      .bulk-action-bar.visible {
        transform: translateX(-50%) translateY(0);
      }

      .empty-state {
        text-align: center;
        padding: 48px 24px;
        background: rgba(30, 41, 59, 0.2);
        border-radius: var(--radius-lg);
        border: 1px dashed var(--glass-border);
      }
      .spinner {
        width: 36px;
        height: 36px;
        border: 3px solid rgba(255, 255, 255, 0.08);
        border-top-color: var(--m3-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .line-clamp-3 {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Toast Notification */
      .m3-toast-container {
        position: fixed;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2000;
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .m3-toast-card {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: var(--spacing-12);
        background: rgba(26, 32, 44, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 185, 81, 0.3);
        box-shadow:
          0 10px 30px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        padding: var(--spacing-12) var(--spacing-20);
        border-radius: var(--radius-full);
        color: var(--m3-on-surface);
        min-width: 280px;
        max-width: 450px;
      }
      .m3-toast-icon {
        color: var(--m3-primary);
        font-size: 1.1rem;
      }
      .m3-toast-text {
        font-family: var(--font-body);
        font-size: 0.9rem;
        font-weight: 500;
        flex: 1;
        line-height: 1.4;
      }
      .m3-toast-close {
        background: transparent;
        border: none;
        color: var(--m3-on-surface-variant);
        cursor: pointer;
        font-size: 1.2rem;
        line-height: 1;
        padding: 0 var(--spacing-4);
        transition: color 0.2s;
      }
      .m3-toast-close:hover {
        color: var(--m3-primary);
      }
      @keyframes toastSlideIn {
        from {
          transform: translateY(20px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      .animate-toast {
        animation: toastSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @media (max-width: 640px) {
        .discovery-grid,
        .results-grid {
          grid-template-columns: 1fr;
        }
        .series-game-card {
          flex-direction: column;
        }
        .series-card-checkbox {
          align-self: flex-start;
        }
        .bulk-action-bar {
          width: 90%;
          border-radius: var(--radius-md);
          justify-content: space-between;
          padding: var(--spacing-12) var(--spacing-16);
        }
      }
    `,
  ],
})
export class DiscoveryListComponent implements OnInit {
  public collectionService = inject(CollectionService);

  /** Active navigation tab state. */
  public activeTab = signal<'triage' | 'search' | 'scan'>('triage');

  /** Triage report items signals. */
  public items = signal<DiscoveryItem[]>([]);

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

  /** Tracks the initial platform ID selected when the modal is opened. Used to show the platform select inside the modal for global searches. */
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

  /**
   * Initializes component and triggers load.
   */
  ngOnInit() {
    this.refresh();
    this.loadPlatformsGracefully();
  }

  /**
   * Defensive getter for database platforms to support testing mocks.
   *
   * @returns Array of loaded platforms or empty array.
   */
  get platformsList() {
    return this.collectionService.platforms
      ? this.collectionService.platforms()
      : [];
  }

  /**
   * Loads platforms list during initialization if not populated.
   * Defensive against missing service functions in test specs.
   *
   * @returns Promise resolving when platforms are hydrated.
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
   * Refreshes the staging triage items from the scraper database.
   *
   * @returns Promise representing async completion of refresh action.
   */
  async refresh() {
    if (this.collectionService.refreshDiscovery) {
      await this.collectionService.refreshDiscovery();
    }
    if (this.collectionService.discoveryItems) {
      this.items.set(this.collectionService.discoveryItems());
    }
  }

  /**
   * Submits a triage match decision to the backend.
   *
   * @param item The source DiscoveryItem containing current metadata.
   * @param option The matched DiscoveryOption details from IGDB.
   * @returns Promise representing completion of match request.
   */
  async applyMatch(item: DiscoveryItem, option: DiscoveryOption) {
    const payload: DiscoveryPayload = {
      currentTitle: item.title,
      currentPlatform: item.platform,
      currentLine: item.line,
      currentSeries: item.series,
      selectedIgdbId: option.id,
      selectedName: option.name,
      selectedPlatform: option.platform,
      region: 'NA',
      summary: option.summary || undefined,
      imageUrl: option.image_url || undefined,
    };

    try {
      await firstValueFrom(this.collectionService.applyDiscovery(payload));
      this.items.update((current) => current.filter((i) => i !== item));
    } catch (e: unknown) {
      console.error('[DiscoveryList] Match failed:', e);
      let errorMsg = 'Unknown error';
      if (e instanceof Error) {
        errorMsg = e.message;
      }

      const httpError = e as {
        error?: { error?: string; details?: string };
        message?: string;
      };
      if (httpError?.error?.error) {
        errorMsg = `${httpError.error.error}${httpError.error.details ? `\n\nDetails: ${httpError.error.details}` : ''}`;
      } else if (httpError?.message) {
        errorMsg = httpError.message;
      }
      alert('Error matching item:\n' + errorMsg);
    }
  }

  /**
   * Invokes manual search on IGDB.
   *
   * @param query The search term.
   * @param platformIdStr The platform ID select option value.
   * @returns Promise representing search completion.
   */
  async triggerSearch(query: string, platformIdStr: string) {
    if (!query) {
      alert('Please enter a search query.');
      return;
    }
    // Convert selected option to number; 0 represents "All Platforms"
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
   * Fetches DAT releases and opens the ingestion setup modal wizard.
   *
   * @param game The search candidate game object.
   * @param platformIdStr The selected platform ID.
   * @returns Promise representing modal hydration.
   */
  async openIngestionModal(game: IGDBSearchResult, platformIdStr: string) {
    const platformId = Number(platformIdStr || 0);
    const cleanIgdbId = game.id.toString().replace('igdb-', '');

    if (!this.collectionService.getGameMatches) {
      console.warn('[DiscoveryList] getGameMatches API is not available.');
      return;
    }

    this.showModal.set(true);
    this.modalLoading.set(true);
    this.modalGame.set(game);
    this.modalPlatformId.set(platformId);
    this.modalInitialPlatformId.set(platformId);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());

    // Reset forms to defaults (Owned, Unplayed, Not Backed Up)
    this.ownershipStatus.set(1);
    this.playStatus.set(0);
    this.backupStatus.set(0);

    // If platform is undetermined (0), defer fetching releases until platform selection
    if (platformId === 0) {
      this.modalLoading.set(false);
      return;
    }

    try {
      const data = await firstValueFrom(
        this.collectionService.getGameMatches(cleanIgdbId, platformId),
      );
      if (data) {
        if (data.game) {
          this.modalGame.set(data.game);
        }
        this.matchedReleases.set(data.matchedReleases || []);
        // Pre-select all matched releases to assist user review
        this.selectAllReleases(data.matchedReleases || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Failed to load physical releases checklist: ' + msg);
      this.closeIngestionModal();
    } finally {
      this.modalLoading.set(false);
    }
  }

  /**
   * Handles platform selection changes from within the manual ingestion modal.
   * This is used when a global search ("All Platforms") was performed, and the user chooses
   * a specific target platform. It will trigger a lookup of physical releases for that platform.
   *
   * @param event The DOM change event containing the chosen platform ID value.
   * @returns Promise representing the completion of fetching matches.
   * @throws None. Any exceptions are caught and displayed via alert.
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

    if (!this.collectionService.getGameMatches) {
      console.warn('[DiscoveryList] getGameMatches API is not available.');
      return;
    }

    this.modalLoading.set(true);
    this.matchedReleases.set([]);
    this.selectedReleaseIds.set(new Set());

    try {
      const data = await firstValueFrom(
        this.collectionService.getGameMatches(cleanIgdbId, platformId),
      );
      if (data) {
        if (data.game) {
          this.modalGame.set(data.game);
        }
        this.matchedReleases.set(data.matchedReleases || []);
        // Pre-select all matched releases to assist user review
        this.selectAllReleases(data.matchedReleases || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Failed to load physical releases checklist: ' + msg);
    } finally {
      this.modalLoading.set(false);
    }
  }

  /**
   * Displays a toast notification message at the bottom of the screen.
   * Clears any existing auto-dismiss timeouts and sets a new one for 4 seconds.
   *
   * @param message The text message to display in the toast card.
   * @returns Void.
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
  }

  /**
   * Selection helpers for physical releases checklists.
   *
   * @param releases Array of matched releases.
   */
  selectAllReleases(releases: DiscoveryRelease[]) {
    const set = new Set<string>();
    releases.forEach((r) => set.add(r.romCrc || r.name));
    this.selectedReleaseIds.set(set);
  }

  /**
   * Unchecks all releases from tracking checklist.
   */
  selectNoReleases() {
    this.selectedReleaseIds.set(new Set());
  }

  /**
   * Toggles tracking checkbox for a single release.
   *
   * @param release The target release item.
   */
  toggleReleaseSelection(release: DiscoveryRelease) {
    const key = release.romCrc || release.name;
    const current = new Set(this.selectedReleaseIds());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.selectedReleaseIds.set(current);
  }

  /**
   * Handles select ownership drop-down event.
   *
   * @param event The DOM event.
   */
  onOwnershipChange(event: Event) {
    this.ownershipStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Handles select play-status drop-down event.
   *
   * @param event The DOM event.
   */
  onPlayChange(event: Event) {
    this.playStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Handles select backup status drop-down event.
   *
   * @param event The DOM event.
   */
  onBackupChange(event: Event) {
    this.backupStatus.set(Number((event.target as HTMLSelectElement).value));
  }

  /**
   * Finalizes ingestion from manual search by calling addGame.
   *
   * @returns Promise representing ingestion completion.
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

      // Remove from search results if matches title for immediate visual confirmation
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
   * Triggers background search scans for missing games on tracked franchise series.
   *
   * @returns Promise representing scan execution completion.
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

  /**
   * Toggles scan checklist selection for series bulk-add.
   *
   * @param game Suggested missing game item.
   */
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

  /**
   * Toggles select all suggested series items.
   */
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

  /**
   * Ingests a single series suggestion game directly.
   * Assumes games are unowned, unplayed, and not backed up.
   *
   * @param game The suggested game.
   * @returns Promise representing adding action.
   */
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
            rom_name: r.name || r.romName || null,
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

  /**
   * Bulks adds all currently checked series scan suggestions.
   * Iterates through selection list and triggers sequential API requests.
   *
   * @returns Promise representing completion of bulk operation.
   */
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
          ownership_status: 0, // Unowned
          play_status: 0,
          backup_status: 0,
        },
        releases: game.releases
          ? game.releases.map((r: DiscoveryRelease) => ({
              region: r.region || null,
              variants: r.variants || null,
              rom_name: r.name || r.romName || null,
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

        // Immediate UI removal
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

  /**
   * Resets/clears the checked series scan selections set.
   */
  clearScanSelection() {
    this.selectedScanGameIds.set(new Set());
  }
}
