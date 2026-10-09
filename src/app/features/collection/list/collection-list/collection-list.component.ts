/**
 * COLLECTION LIST COMPONENT
 *
 * The primary view for browsing the user's game and toy collection.
 * It provides a high-performance, infinite-scrolling grid with sophisticated
 * grouping and filtering capabilities.
 *
 * DESIGN RATIONALE:
 * - **State Persistence**: Uses an effect and HostListener to synchronize the UI
 *   state (filters, scroll position) with the CollectionService. This enables a
 *   "browser-like" navigation experience where the user never loses their place.
 * - **Infinite Scrolling**: Implements an IntersectionObserver pattern to lazily
 *   increase the 'displayLimit' signal, ensuring the DOM remains lean and the
 *   initial paint is fast even for thousands of items.
 * - **Normalization**: Series filtering uses a diacritic-insensitive normalization
 *   heuristic to handle international titles and variations (e.g. Pokémon vs Pokemon).
 * - **Retry-based Scroll Restoration**: Accounts for the asynchronous nature of
 *   Angular rendering by attempting to restore scroll position over several frames.
 */

import {
  Component,
  inject,
  OnInit,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  signal,
  computed,
  effect,
  NgZone,
} from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { ViewportScroller } from '@angular/common';
import { CollectionService } from '../../../../core/services/collection.service';
import { ExportService } from '../../../../core/services/export.service';
import { BrandingService } from '../../../../core/services/branding.service';
import {
  Game,
  Toy,
  Platform,
  FilterState,
  PlatformGroup,
  ToyGroup,
  ListState,
  OwnershipStatus,
} from '../../../../core/models/collection.models';
import { CollectionFiltersComponent } from '../../filters/collection-filters/collection-filters.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

interface GameGroup {
  platformName: string;
  platformLogo?: string | null;
  launchYear?: string;
  games: Game[];
  totalCount: number;
  totalValue: number;
}

@Component({
  selector: 'app-collection-list',
  standalone: true,
  imports: [RouterModule, CollectionFiltersComponent, IconComponent],
  template: `
    <div class="animate-expressive" data-version="final-v12">
      <app-collection-filters
        [currentTab]="currentTab()"
        [platformGroups]="platformGroups()"
        [filters]="filters()"
        [uniqueLines]="uniqueLines()"
        [uniqueTypes]="uniqueTypes()"
        [uniqueNames]="uniqueNames()"
        [uniqueSeries]="uniqueSeries()"
        [uniqueTags]="uniqueTags()"
        [uniqueRegions]="uniqueRegions()"
        [resultCount]="
          currentTab() === 'games'
            ? filteredGames().length
            : filteredToys().length
        "
        [totalValue]="totalFilteredValue()"
        [lastUpdated]="lastUpdated()"
        (filtersChange)="onFiltersChange($event)"
        (exportRequested)="onExportRequested($event)"
      >
      </app-collection-filters>

      @if (currentTab() === 'games') {
        <div class="groups-container animate-expressive animate-stagger-2">
          @for (group of groupedGames(); track group.platformName) {
            <div class="platform-section mb-xl">
              <header class="platform-header">
                <div class="header-content">
                  <div class="platform-logo-frame">
                    @if (group.platformLogo) {
                      <img
                        [src]="group.platformLogo"
                        [alt]="group.platformName"
                        class="platform-logo"
                      />
                    } @else {
                      <div class="platform-logo-placeholder">
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          fill="currentColor"
                        >
                          <path
                            d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3-3c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
                          />
                        </svg>
                      </div>
                    }
                  </div>
                  <h2 class="platform-title">
                    <span>{{ group.platformName }}</span>
                    @if (group.launchYear) {
                      <span class="platform-year">{{ group.launchYear }}</span>
                    }
                  </h2>
                  <div class="platform-badge">
                    {{ group.totalCount }} Items
                    @if (group.totalValue > 0) {
                      • {{ formatCurrency(group.totalValue) }}
                    }
                  </div>
                </div>
              </header>

              <div class="grid">
                @for (game of group.games; track game.id) {
                  <a
                    [routerLink]="['/collection', 'game', game.id]"
                    class="m3-card m3-card-elevated state-layer flex flex-col overflow-hidden"
                  >
                    <div class="card-art-frame">
                      @if (game.image_url) {
                        <img
                          [src]="game.image_url"
                          alt="Cover"
                          class="card-art"
                          loading="lazy"
                          decoding="async"
                          referrerpolicy="no-referrer"
                        />
                      } @else {
                        <div
                          class="card-art-placeholder text-secondary text-2xs uppercase letter-spacing-wide"
                        >
                          No Image
                        </div>
                      }
                      <div
                        class="region-flag"
                        [title]="'Region: ' + game.region"
                      >
                        {{ game.region }}
                      </div>

                      <!-- Status Badge -->
                      <button
                        class="status-badge state-layer interactive"
                        [class]="'status-' + game.ownership_status"
                        [title]="
                          game.ownership_status === 1
                            ? 'Owned'
                            : game.ownership_status === 2
                              ? 'Seeking'
                              : game.ownership_status === 3
                                ? 'Ordered'
                                : 'Unowned'
                        "
                        (click)="onToggleStatus($event, game, 'game')"
                      >
                        @if (game.ownership_status === 1) {
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="currentColor"
                          >
                            <path
                              d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                            />
                          </svg>
                        } @else if (game.ownership_status === 2) {
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="currentColor"
                          >
                            <path
                              d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                            />
                          </svg>
                        } @else if (game.ownership_status === 3) {
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="currentColor"
                          >
                            <path
                              d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
                            />
                          </svg>
                        } @else {
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="currentColor"
                          >
                            <path
                              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                            />
                          </svg>
                        }
                      </button>
                    </div>

                    <div class="card-content">
                      <div class="content-header">
                        <div class="flex gap-2xs items-center">
                          @if (game.igdb_id) {
                            <span class="igdb-icon" title="Verified by IGDB"
                              >🆔</span
                            >
                          }
                          @if (
                            game.rom_name &&
                            (game.physical_status === 'verified_physical' ||
                              !game.physical_status)
                          ) {
                            <span
                              class="physical-release-badge"
                              title="Catalog Signature Matched (No-Intro/Redump)"
                            >
                              <app-icon name="physical-box" [size]="14" />
                            </span>
                          } @else if (
                            game.physical_status === 'digital_extracted_rom' ||
                            game.release_medium === 'digital_extracted_rom'
                          ) {
                            <span
                              class="digital-extracted-badge"
                              title="Archival Extracted ROM (Official VC/NSO/Compilation)"
                            >
                              <app-icon name="rom-archive" [size]="14" />
                            </span>
                          }
                          @if (
                            (game.bundle_count && game.bundle_count > 0) ||
                            (game.bundled_games &&
                              game.bundled_games.length > 0)
                          ) {
                            <span
                              class="bundle-badge"
                              [title]="
                                '+' +
                                (game.bundle_count ||
                                  game.bundled_games?.length) +
                                ' Included Game/Disc in Box'
                              "
                            >
                              <app-icon name="disc" [size]="12" /> +{{
                                game.bundle_count || game.bundled_games?.length
                              }}
                            </span>
                          }
                        </div>
                        @if (game.release_date) {
                          <span class="release-year">{{
                            game.release_date.substring(0, 4)
                          }}</span>
                        }
                      </div>
                      <h3 class="card-title">{{ game.title }}</h3>
                      @if (
                        filters().sortBy &&
                        filters().sortBy !== 'default' &&
                        !filters().platform_id
                      ) {
                        <div class="card-subtitle" title="Platform & Series">
                          {{ game.display_name || game.platform
                          }}{{
                            game.canonical_series
                              ? ' • ' + game.canonical_series
                              : ''
                          }}
                        </div>
                      } @else if (game.canonical_series) {
                        <div class="card-subtitle" title="Series">
                          {{ game.canonical_series }}
                        </div>
                      }
                      @if (
                        game.variants ||
                        getOptionalBudgetLabels(game).length > 0
                      ) {
                        <div class="flex flex-wrap gap-2xs mt-2xs">
                          @if (game.variants) {
                            @for (
                              variant of game.variants.split(',');
                              track variant
                            ) {
                              @if (variant.trim()) {
                                <span
                                  class="variant-badge"
                                  [class.badge-budget-exclusive]="
                                    isBudgetLabel(variant.trim())
                                  "
                                  >{{ variant.trim() }}</span
                                >
                              }
                            }
                          }
                          @for (
                            label of getOptionalBudgetLabels(game);
                            track label
                          ) {
                            <span
                              class="variant-badge badge-budget-optional"
                              [title]="
                                'Identical disc/cartridge image was also sold in ' +
                                label +
                                ' packaging'
                              "
                              >± {{ label }}</span
                            >
                          }
                        </div>
                      }

                      @if (game.retail_on_sale && game.retail_price) {
                        <div class="mt-2xs flex items-center gap-2xs flex-wrap">
                          <span
                            class="deal-sale-badge"
                            [title]="
                              'On Sale at ' +
                              (game.retail_store || 'Best Buy') +
                              (game.retail_regular_price
                                ? ' (Reg: $' +
                                  (game.retail_regular_price / 100).toFixed(2) +
                                  ')'
                                : '')
                            "
                          >
                            <app-icon name="flame" [size]="14" />
                            {{
                              game.retail_discount_pct
                                ? game.retail_discount_pct + '% OFF · '
                                : ''
                            }}{{ '$' + (game.retail_price / 100).toFixed(2) }}
                          </span>
                          @if (
                            game.retail_regular_price &&
                            game.retail_regular_price > game.retail_price
                          ) {
                            <span class="deal-strikethrough-price">
                              {{
                                '$' +
                                  (game.retail_regular_price / 100).toFixed(2)
                              }}
                            </span>
                          }
                          @if (getDealArbitrageSavings(game); as savings) {
                            <span
                              class="deal-arb-badge"
                              [title]="
                                '$' +
                                (savings / 100).toFixed(2) +
                                ' cheaper than PriceCharting CIB used value'
                              "
                            >
                              <app-icon name="zap" [size]="14" /> Save
                              {{ '$' + (savings / 100).toFixed(2) }} vs Used
                            </span>
                          }
                        </div>
                      } @else if (getGamePriceBadge(game); as badge) {
                        <div class="mt-2xs">
                          <span
                            class="valuation-badge"
                            [title]="
                              'Estimated Market Value: $' +
                              (badge.cents / 100).toFixed(2)
                            "
                          >
                            {{ '$' + (badge.cents / 100).toFixed(2) }}
                            {{ badge.label }}
                          </span>
                        </div>
                      }

                      @if (game.ownership_status === 1) {
                        <div class="completeness-chips mt-2xs">
                          <button
                            type="button"
                            class="completeness-chip state-layer"
                            [class.active]="game.has_case"
                            (click)="onToggleCase($event, game)"
                            title="Toggle Case / Box Ownership"
                          >
                            <app-icon name="physical-box" [size]="14" /> Case
                          </button>
                          <button
                            type="button"
                            class="completeness-chip state-layer"
                            [class.active]="game.has_manual"
                            (click)="onToggleManual($event, game)"
                            title="Toggle Manual Ownership"
                          >
                            <app-icon name="book-open" [size]="14" /> Manual
                          </button>
                        </div>
                      }

                      @if (game.discIds && game.discIds.length > 1) {
                        <div
                          class="multi-disc-tray mt-2xs"
                          (click)="
                            $event.stopPropagation(); $event.preventDefault()
                          "
                        >
                          <div
                            class="multi-disc-header flex items-center justify-between"
                          >
                            <span
                              class="multi-disc-label text-2xs uppercase letter-spacing-wide flex items-center gap-1"
                            >
                              <app-icon name="disc" [size]="12" />
                              {{ game.discIds.length }} Discs
                            </span>
                            <span
                              class="multi-disc-status text-2xs"
                              [class.all-backed]="game.backup_status"
                            >
                              {{
                                game.backup_status
                                  ? 'All Backed Up'
                                  : getBackedUpDiscCount(game) +
                                    '/' +
                                    game.discIds.length +
                                    ' Backed Up'
                              }}
                            </span>
                          </div>
                          <div
                            class="multi-disc-pills flex flex-wrap gap-2xs mt-3xs"
                          >
                            @for (
                              discId of game.discIds;
                              track discId;
                              let idx = $index
                            ) {
                              <button
                                type="button"
                                class="disc-chip state-layer"
                                [class.backed-up]="
                                  game.discBackups?.[idx] === 1
                                "
                                [title]="
                                  (game.discRomNames?.[idx] ||
                                    'Disc ' + (idx + 1)) +
                                  ' (' +
                                  (game.discBackups?.[idx] === 1
                                    ? 'Backed Up'
                                    : 'Missing') +
                                  ') - Click to toggle backup'
                                "
                                (click)="onToggleDiscBackup($event, game, idx)"
                              >
                                {{ 'Disc ' + (idx + 1) }}
                                <span
                                  class="disc-dot"
                                  [class.dot-backed]="
                                    game.discBackups?.[idx] === 1
                                  "
                                ></span>
                              </button>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  </a>
                }
              </div>
            </div>
          }
        </div>
      }

      @if (currentTab() === 'toys') {
        <div class="groups-container animate-expressive animate-stagger-2">
          @for (group of groupedToys(); track group.lineName) {
            <div class="platform-section mb-xl">
              <header class="platform-header">
                <div class="header-content">
                  <div class="platform-logo-frame">
                    <div class="platform-logo-placeholder">
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                      >
                        <path
                          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"
                        />
                      </svg>
                    </div>
                  </div>
                  <h2 class="platform-title uppercase letter-spacing-wide">
                    {{ group.lineName }}
                  </h2>
                  <div class="platform-badge">
                    {{ group.totalCount }} Items
                    @if (group.totalValue && group.totalValue > 0) {
                      • {{ formatCurrency(group.totalValue) }}
                    }
                  </div>
                </div>
              </header>

              @for (series of group.seriesGroups; track series.seriesName) {
                <div class="series-section mb-lg">
                  <header class="series-header">
                    <h3 class="series-title">{{ series.seriesName }}</h3>
                    <div class="series-badge">
                      {{ series.totalCount }} Items
                      @if (series.totalValue && series.totalValue > 0) {
                        • {{ formatCurrency(series.totalValue) }}
                      }
                    </div>
                  </header>
                  <div class="grid">
                    @for (toy of series.toys; track toy.id) {
                      <a
                        [routerLink]="['/collection', 'toy', toy.id]"
                        class="m3-card m3-card-elevated state-layer flex flex-col overflow-hidden"
                      >
                        <div class="card-art-frame toy-frame">
                          @if (toy.image_url) {
                            <img
                              [src]="toy.image_url"
                              alt="Toy"
                              class="card-art toy-art"
                              loading="lazy"
                              decoding="async"
                              referrerpolicy="no-referrer"
                            />
                          } @else {
                            <div
                              class="card-art-placeholder text-secondary text-2xs uppercase letter-spacing-wide"
                            >
                              No Image
                            </div>
                          }
                          <div
                            class="region-flag"
                            [title]="'Region: ' + toy.region"
                          >
                            {{ toy.region }}
                          </div>

                          <!-- Status Badge -->
                          <button
                            class="status-badge state-layer interactive"
                            [class]="'status-' + toy.ownership_status"
                            [title]="
                              toy.ownership_status === 1
                                ? 'Owned'
                                : toy.ownership_status === 2
                                  ? 'Seeking'
                                  : toy.ownership_status === 3
                                    ? 'Ordered'
                                    : 'Unowned'
                            "
                            (click)="onToggleStatus($event, toy, 'toy')"
                          >
                            @if (toy.ownership_status === 1) {
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                              >
                                <path
                                  d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"
                                />
                              </svg>
                            } @else if (toy.ownership_status === 2) {
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                              >
                                <path
                                  d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                                />
                              </svg>
                            } @else if (toy.ownership_status === 3) {
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                              >
                                <path
                                  d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
                                />
                              </svg>
                            } @else {
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                              >
                                <path
                                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                                />
                              </svg>
                            }
                          </button>
                        </div>

                        <div class="card-content">
                          <div class="content-header">
                            <div class="flex gap-2xs items-center">
                              <span class="release-year">{{ toy.type }}</span>
                            </div>
                            @if (toy.release_date) {
                              <span class="release-year">{{
                                toy.release_date.substring(0, 4)
                              }}</span>
                            }
                          </div>
                          <h3 class="card-title">{{ toy.name }}</h3>
                          @if (toy.price_loose) {
                            <div class="mt-2xs">
                              <span
                                class="valuation-badge"
                                [title]="
                                  'Estimated Loose Market Value: $' +
                                  (toy.price_loose / 100).toFixed(2)
                                "
                              >
                                {{ '$' + (toy.price_loose / 100).toFixed(2) }}
                                Loose
                              </span>
                            </div>
                          }
                        </div>
                      </a>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <div
        #scrollTrigger
        class="scroll-trigger"
        style="height: 50px; width: 100%;"
      ></div>
    </div>
  `,
  styles: [
    `
      .mb-xl {
        margin-bottom: 4rem;
      }
      .mb-md {
        margin-bottom: 1.25rem;
      }
      .p-md {
        padding: 1rem;
      }
      .gap-xs {
        gap: 0.5rem;
      }
      .gap-2xs {
        gap: 0.25rem;
      }

      .platform-header {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--m3-surface);
        padding: 1rem 0;
        margin-bottom: 1.5rem;
      }

      .header-content {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.625rem 1.25rem;
        background: var(--m3-surface-container-high);
        border-radius: var(--radius-md);
        border: 1px solid var(--m3-outline-variant);
      }

      .platform-logo-frame {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--m3-surface-container-highest);
        border-radius: 8px;
        padding: 0.25rem;
        flex-shrink: 0;
      }

      .platform-logo {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
      }
      .platform-logo-placeholder {
        font-weight: 700;
        color: var(--m3-primary);
        font-family: var(--font-heading);
      }
      .platform-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--m3-on-surface);
        flex: 1;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: var(--spacing-12);
        row-gap: 0.25rem;
      }
      .platform-year {
        font-family: var(--font-body);
        font-variation-settings: normal;
        font-size: 0.875rem;
        font-weight: 500;
        letter-spacing: normal;
        color: var(--m3-on-surface-variant);
        opacity: 0.85;
      }

      .platform-badge {
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--m3-on-secondary-container);
        background: var(--m3-secondary-container);
        padding: 0.25rem 0.75rem;
        border-radius: var(--radius-full);
        white-space: nowrap;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 1.25rem;
      }

      @media (max-width: 480px) {
        .grid {
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem;
        }
      }

      .m3-card {
        height: 100%;
        display: flex;
        flex-direction: column;
      }

      .card-art-frame {
        width: 100%;
        aspect-ratio: 3/4;
        background: var(--m3-surface-container-highest);
        overflow: hidden;
        position: relative;
      }

      .card-art {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .region-flag {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        padding: 0.2rem 0.45rem;
        background: rgba(0, 0, 0, 0.8);
        border-radius: var(--radius-tag, 6px);
        font-family: var(--font-body);
        font-size: 0.65rem;
        font-weight: 700;
        color: #fff;
        z-index: 2;
      }

      .toy-frame {
        background: radial-gradient(
          circle at center,
          var(--m3-surface-container-highest),
          var(--m3-surface-container-high)
        );
        padding: 1rem;
      }

      .toy-art {
        object-fit: contain !important;
        filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
      }

      .card-content {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        flex: 1;
      }

      .content-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.15rem;
      }

      .card-title {
        font-size: 0.9375rem;
        font-weight: 600;
        line-height: 1.3;
        color: var(--m3-on-surface);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .card-subtitle {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .release-year {
        font-family: var(--font-body);
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        background: var(--m3-surface-container-highest);
        border: 1px solid var(--m3-outline-variant);
        padding: 0.12rem 0.45rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.02em;
      }

      .igdb-icon {
        font-size: 0.8rem;
      }
      .physical-release-badge {
        font-size: 0.8rem;
      }
      .digital-extracted-badge {
        font-size: 0.8rem;
      }
      .bundle-badge {
        font-family: var(--font-body);
        font-size: 0.7rem;
        font-weight: 600;
        color: var(--m3-on-secondary-container);
        background: var(--m3-secondary-container);
        padding: 0.12rem 0.45rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.02em;
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
      }

      .series-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
        padding-left: 0.5rem;
        border-left: 3px solid var(--m3-primary);
      }

      .series-title {
        font-size: 1rem;
        font-weight: 700;
        color: var(--m3-on-surface);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .series-badge {
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--m3-on-tertiary-container);
        background: var(--m3-tertiary-container);
        padding: 0.2rem 0.65rem;
        border-radius: var(--radius-full);
      }

      .status-badge {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        border-radius: 50%;
        color: var(--m3-outline);
        z-index: 3;
        border: 1px solid rgba(255, 255, 255, 0.1);
        cursor: default;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .status-badge.interactive {
        cursor: pointer;
      }

      .status-badge.status-1 {
        color: var(--m3-primary);
        background: var(--m3-primary-container);
        border-color: var(--m3-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      .status-badge.status-2 {
        color: var(--m3-tertiary);
        background: var(--m3-tertiary-container);
        border-color: var(--m3-tertiary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      .status-badge.status-3 {
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.2);
        border-color: #3b82f6;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      }

      .status-badge.interactive:hover {
        transform: scale(1.2);
        filter: brightness(1.2);
      }

      .sort-badge {
        position: absolute;
        top: 0.75rem;
        left: 3.25rem;
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
        font-weight: 700;
        font-family: var(--font-body);
        background: var(--m3-surface-container-highest);
        color: var(--m3-primary);
        border-radius: var(--radius-full);
        border: 1px solid var(--m3-outline-variant);
        backdrop-filter: blur(8px);
        z-index: 3;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .sort-badge:hover {
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .variant-badge {
        font-family: var(--font-body);
        font-size: 0.65rem;
        font-weight: 600;
        color: var(--m3-on-secondary-container);
        background: var(--m3-secondary-container);
        padding: 0.12rem 0.45rem;
        border-radius: var(--radius-tag, 6px);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .badge-budget-exclusive {
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.18);
        border: 1px solid rgba(245, 158, 11, 0.45);
      }

      .badge-budget-optional {
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.08);
        border: 1px dashed rgba(245, 158, 11, 0.45);
      }

      .valuation-badge {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-body);
        font-size: 0.7rem;
        font-weight: 700;
        color: #10b981;
        background: rgba(16, 185, 129, 0.12);
        border: 1px solid rgba(16, 185, 129, 0.25);
        padding: 0.15rem 0.45rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.01em;
      }

      .deal-sale-badge {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-body);
        font-size: 0.7rem;
        font-weight: 700;
        color: #ffffff;
        background: #ef4444;
        border: 1px solid #dc2626;
        padding: 0.15rem 0.5rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.01em;
        box-shadow: 0 2px 6px rgba(239, 68, 68, 0.35);
      }

      .deal-strikethrough-price {
        font-family: var(--font-body);
        font-size: 0.7rem;
        color: var(--m3-on-surface-variant);
        text-decoration: line-through;
        opacity: 0.7;
        font-weight: 600;
      }

      .deal-arb-badge {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-body);
        font-size: 0.65rem;
        font-weight: 700;
        color: #3b82f6;
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(59, 130, 246, 0.3);
        padding: 0.12rem 0.45rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.01em;
      }

      .completeness-chips {
        display: flex;
        gap: 0.35rem;
        margin-top: auto;
        padding-top: 0.35rem;
      }

      .completeness-chip {
        font-family: var(--font-body);
        font-size: 0.65rem;
        font-weight: 600;
        padding: 0.2rem 0.6rem;
        border-radius: var(--radius-full);
        border: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container-high);
        color: var(--m3-on-surface-variant);
        opacity: 0.75;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .completeness-chip.active {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        border-color: var(--m3-primary);
        opacity: 1;
        font-weight: 700;
      }

      .completeness-chip:hover {
        opacity: 1;
        transform: scale(1.05);
      }

      .multi-disc-tray {
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-sm);
        padding: 0.35rem 0.5rem;
      }
      .multi-disc-header {
        margin-bottom: 0.25rem;
      }
      .multi-disc-label {
        font-weight: 700;
        color: var(--m3-on-surface-variant);
      }
      .multi-disc-status {
        font-weight: 600;
        color: var(--m3-outline);
      }
      .multi-disc-status.all-backed {
        color: #10b981;
      }
      .disc-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.15rem 0.45rem;
        font-size: 0.65rem;
        font-weight: 600;
        border-radius: var(--radius-full);
        border: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container-high);
        color: var(--m3-on-surface);
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .disc-chip:hover {
        background: var(--m3-surface-container-highest);
      }
      .disc-chip.backed-up {
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.12);
        color: #047857;
      }
      .disc-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--m3-outline-variant);
      }
      .disc-dot.dot-backed {
        background: #10b981;
      }
    `,
  ],
})
export class CollectionListComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  private collectionService = inject(CollectionService);
  private exportService = inject(ExportService);
  private branding = inject(BrandingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private viewportScroller = inject(ViewportScroller);
  private observer?: IntersectionObserver;
  @ViewChild('scrollTrigger') scrollTrigger?: ElementRef;
  private ngZone = inject(NgZone);

  private restorationPending = true;
  private stateInitialized = signal(false);

  /** --- Reactive Application State --- */
  public currentTab = signal<'games' | 'toys'>('games');
  public filters = signal<FilterState>({
    ownership: 1,
    play_status: 'all',
    backup_status: 'all',
    physical_verified: 'all',
    platform_id: undefined,
    regions: [],
    line: '',
    type: '',
    name: '',
    nameExact: false,
    series: '',
    seriesExact: false,
    tag: '',
    tagExact: false,
    sortBy: 'default',
  });
  public displayLimit = signal<number>(100);
  public lastUpdated = this.collectionService.lastUpdated;

  /**
   * Computes a grouped list of platforms for use in the filter dropdown.
   * Groups by 'brand' (e.g. Nintendo, Sony) to improve selection ergonomics.
   */
  public platformGroups = computed<PlatformGroup[]>(() => {
    const data = this.collectionService.platforms();
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
   * Pairs where a 2-disc GOTY/expanded release reuses the original 1-disc release
   * verbatim as Disc 1. Used so the GOTY release card requires BOTH Disc 1 (base game)
   * and Disc 2 (add-on/DLC) to be backed up before reporting backup_status = 1,
   * without altering ownership_status.
   */
  private readonly COMPANION_DISC1_PAIRS: ReadonlyArray<{
    platformId: number;
    supersetStableId?: number;
    originalStableId?: number;
    supersetNormalizedTitle: string;
    originalNormalizedTitle: string;
    supersetRomMarker?: string;
    originalExcludeMarker?: string;
    excludedRegions?: string[];
  }> = [
    {
      platformId: 48,
      supersetStableId: 3798,
      originalStableId: 3796,
      supersetNormalizedTitle: 'theelderscrollsivobliviongameoftheyearedition',
      originalNormalizedTitle: 'theelderscrollsivoblivion',
      originalExcludeMarker: 'collector',
      excludedRegions: ['japan', 'asia'],
    },
    {
      platformId: 48,
      supersetStableId: 3800,
      originalStableId: 3799,
      supersetNormalizedTitle: 'theelderscrollsvskyrimlegendaryedition',
      originalNormalizedTitle: 'theelderscrollsvskyrim',
      originalExcludeMarker: 'kinect sensor',
    },
    {
      platformId: 48,
      supersetStableId: 3808,
      originalStableId: 3808,
      supersetNormalizedTitle: 'fallout3gameoftheyearedition',
      originalNormalizedTitle: 'fallout3',
      supersetRomMarker: 'game of the year edition',
      originalExcludeMarker: 'add-on',
    },
    {
      platformId: 48,
      supersetStableId: 3785,
      originalStableId: 3784,
      supersetNormalizedTitle: 'dishonoredgameoftheyearedition',
      originalNormalizedTitle: 'dishonored',
    },
    {
      platformId: 48,
      supersetStableId: 3791,
      originalStableId: 3790,
      supersetNormalizedTitle: 'dragonageoriginsultimateedition',
      originalNormalizedTitle: 'dragonageorigins',
      originalExcludeMarker: 'tsuika contents',
      excludedRegions: ['japan'],
    },
    {
      platformId: 48,
      supersetStableId: 3732,
      originalStableId: 3731,
      supersetNormalizedTitle: 'borderlandsgameoftheyearedition',
      originalNormalizedTitle: 'borderlands',
      originalExcludeMarker: 'add-on',
      excludedRegions: ['japan'],
    },
    {
      platformId: 48,
      supersetStableId: 3734,
      originalStableId: 3733,
      supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
      originalNormalizedTitle: 'borderlands2',
      originalExcludeMarker: 'add-on',
    },
    {
      platformId: 32,
      supersetStableId: 2373,
      originalStableId: 2372,
      supersetNormalizedTitle: 'borderlands2gameoftheyearedition',
      originalNormalizedTitle: 'borderlands2',
      originalExcludeMarker: 'add-on',
    },
    {
      platformId: 32,
      supersetStableId: 2463,
      originalStableId: 2462,
      supersetNormalizedTitle: 'killzonetrilogy',
      originalNormalizedTitle: 'killzone3',
    },
    {
      platformId: 48,
      originalStableId: 3809,
      supersetNormalizedTitle: 'falloutnewvegasultimateedition',
      originalNormalizedTitle: 'falloutnewvegas',
    },
    {
      platformId: 48,
      originalStableId: 3951,
      supersetNormalizedTitle: 'saintsrowthethirdthefullpackage',
      originalNormalizedTitle: 'saintsrowthethird',
    },
    {
      platformId: 48,
      originalStableId: 3866,
      supersetNormalizedTitle: 'mafiaii',
      originalNormalizedTitle: 'mafiaii',
      supersetRomMarker: 'add-on content disc',
      originalExcludeMarker: 'add-on content disc',
    },
    {
      platformId: 34,
      supersetNormalizedTitle: 'outlasttrinity',
      originalNormalizedTitle: 'outlastoutlastwhistleblower',
    },
    {
      platformId: 48,
      originalStableId: 3742,
      supersetNormalizedTitle: 'callofdutymodernwarfare2',
      originalNormalizedTitle: 'callofdutymodernwarfare2',
      supersetRomMarker: 'stimulus package',
      originalExcludeMarker: 'stimulus package',
    },
  ];

  private normalizeForLabelMatch(name: string): string {
    let clean = name
      .replace(/\.(?:xiso\.iso|[a-z0-9]{2,4})$/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s*\[[^\]]*\]/g, '')
      .trim();
    clean = clean.replace(
      /(^|\s-\s)([^,-]+),\s*(the|a|an)(?=\s*(?:-|:|$))/gi,
      '$1$3 $2',
    );
    return clean
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&amp;/g, 'and')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizeBudgetToken(token: string): string | null {
    const t = token.trim();
    if (!t) return null;
    if (
      /^Greatest Hits$/i.test(t) ||
      /^Double Pack Greatest Hits$/i.test(t) ||
      /:\s*Greatest Hits$/i.test(t) ||
      /\(Greatest Hits\)$/i.test(t)
    ) {
      return 'Greatest Hits';
    }
    if (
      /^Platinum Hits$/i.test(t) ||
      /^Best of Platinum Hits$/i.test(t) ||
      /^Platinum Family Hits$/i.test(t) ||
      /\(Platinum Hits\)$/i.test(t) ||
      /:\s*Platinum Hits$/i.test(t)
    ) {
      return 'Platinum Hits';
    }
    if (
      /^Platinum$/i.test(t) ||
      /^Platinum - Twin Pack$/i.test(t) ||
      /^Platinum:\s*(?:The Best of|EA Most Wanted)/i.test(t)
    ) {
      return 'Platinum';
    }
    if (
      /^Platinum Collection$/i.test(t) ||
      /\(Platinum Collection\)$/i.test(t)
    ) {
      return 'Platinum Collection';
    }
    if (/^Player's Choice/i.test(t)) {
      return "Player's Choice";
    }
    if (/^Nintendo Selects$/i.test(t)) {
      return 'Nintendo Selects';
    }
    if (
      /^Xbox Classics$/i.test(t) ||
      /^Classics$/i.test(t) ||
      /^Classic$/i.test(t) ||
      /\(Classics\)$/i.test(t)
    ) {
      return 'Xbox Classics';
    }
    if (
      /^(?:PSP\s+|PS3\s+|PlayStation\s+)?Essentials$/i.test(t) ||
      /Classics HD:\s*Essentials/i.test(t)
    ) {
      return 'Essentials';
    }
    if (/^Favorites$/i.test(t)) return 'Favorites';
    if (/^Sega All Stars$/i.test(t)) return 'Sega All Stars';
    if (/^PS\s*one Books$/i.test(t)) return 'PSone Books';
    if (
      /\bthe Best(?:\s+for\s+Family)?$/i.test(t) ||
      /^EA Best Hits$/i.test(t) ||
      /^Satakore$/i.test(t) ||
      /^DreKore$/i.test(t)
    ) {
      return t;
    }
    return null;
  }

  public isBudgetLabel(label: string): boolean {
    return this.normalizeBudgetToken(label) !== null;
  }

  public getOptionalBudgetLabels(game: Game): string[] {
    if (!game.also_released_as) return [];
    const existingVariants = new Set(
      (game.variants || '')
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean),
    );
    const result: string[] = [];
    for (const rawToken of game.also_released_as.split(',')) {
      const canonical = this.normalizeBudgetToken(rawToken);
      if (!canonical) continue;
      const lower = canonical.toLowerCase();
      if (existingVariants.has(lower)) continue;
      if (!result.some((r) => r.toLowerCase() === lower)) {
        result.push(canonical);
      }
    }
    return result;
  }

  /**
   * Reactive pipeline that applies active filters to the full games collection.
   * Handles ownership, platform, region, name, series, and tag matching.
   */
  public filteredGames = computed(() => {
    const allGames = this.collectionService.games();
    const f = this.filters();

    // Group multiple discs of the same release version (game_id, region, variants, and base rom name)
    const groupedMap = new Map<
      string,
      Game & {
        discIds: string[];
        discBackups: number[];
        discRomNames: string[];
      }
    >();
    for (const g of allGames) {
      const romKey = this.getRomGroupingKey(g.rom_name);
      const baseKey = `${g.game_id || g.id}_${g.region || ''}_${g.variants || ''}_${romKey}`;
      if (!groupedMap.has(baseKey)) {
        groupedMap.set(baseKey, {
          ...g,
          discIds: [g.id],
          discBackups: [g.backup_status ? 1 : 0],
          discRomNames: [g.rom_name || ''],
        });
      } else {
        const existing = groupedMap.get(baseKey)!;
        existing.discIds.push(g.id);
        existing.discBackups.push(g.backup_status ? 1 : 0);
        existing.discRomNames.push(g.rom_name || '');
        existing.ownership_status = Math.max(
          existing.ownership_status,
          g.ownership_status,
        );
        existing.play_status = Math.max(existing.play_status, g.play_status);
        if (g.also_released_as) {
          const merged = new Set(
            [
              ...(existing.also_released_as || '').split(','),
              ...g.also_released_as.split(','),
            ]
              .map((s) => s.trim())
              .filter(Boolean),
          );
          existing.also_released_as = Array.from(merged).join(', ');
        }
      }
    }

    // Pre-index candidate games by platform_id to accelerate companion disc matching
    const allGamesByPlatform = new Map<number, typeof allGames>();
    for (const g of allGames) {
      if (g.platform_id != null) {
        let pList = allGamesByPlatform.get(g.platform_id);
        if (!pList) {
          pList = [];
          allGamesByPlatform.set(g.platform_id, pList);
        }
        pList.push(g);
      }
    }

    const groupedGames = Array.from(groupedMap.values()).map((g) => {
      const discBackups = [...g.discBackups];

      // If this is a 2-disc GOTY/expanded release that only catalogs Disc 2 under its own game_id
      // (reusing the original release as Disc 1), include the regional companion Disc 1's backup_status
      // so the GOTY release is only marked backed up when BOTH Disc 1 and Disc 2 are backed up.
      const hasDisc1InGroup = g.discRomNames.some((rn) =>
        /\((?:disc|disco|disque|disk)\s+1\b/i.test(rn),
      );
      if (!hasDisc1InGroup) {
        const romLower = (g.rom_name || '').toLowerCase();
        const normRom = this.normalizeForLabelMatch(
          g.rom_name || g.title || '',
        );
        const normTitle = this.normalizeForLabelMatch(g.title || '');
        const regTokens = (g.region || '')
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const pair of this.COMPANION_DISC1_PAIRS) {
          const isSupersetMatch =
            pair.platformId === g.platform_id &&
            ((pair.supersetStableId !== undefined &&
              pair.supersetStableId === g.stable_id &&
              (!pair.supersetRomMarker ||
                romLower.includes(pair.supersetRomMarker))) ||
              normRom === pair.supersetNormalizedTitle ||
              normTitle === pair.supersetNormalizedTitle) &&
            !pair.excludedRegions?.some((ex) => regTokens.includes(ex));
          if (isSupersetMatch) {
            const platformCandidates =
              allGamesByPlatform.get(pair.platformId) || [];
            const companionCandidates = platformCandidates.filter((cand) => {
              if (cand.id === g.id) {
                return false;
              }
              const candRomLower = (cand.rom_name || '').toLowerCase();
              if (
                pair.supersetRomMarker &&
                candRomLower.includes(pair.supersetRomMarker)
              ) {
                return false;
              }
              if (
                pair.originalExcludeMarker &&
                candRomLower.includes(pair.originalExcludeMarker)
              ) {
                return false;
              }
              const candNorm = this.normalizeForLabelMatch(
                cand.rom_name || cand.title || '',
              );
              if (
                cand.stable_id !== pair.originalStableId &&
                candNorm !== pair.originalNormalizedTitle
              ) {
                return false;
              }
              const candRegs = (cand.region || '')
                .toLowerCase()
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              return regTokens.some((r) => candRegs.includes(r));
            });
            if (companionCandidates.length > 0) {
              const companionBackedUp = companionCandidates.some((c) =>
                Boolean(c.backup_status),
              )
                ? 1
                : 0;
              discBackups.unshift(companionBackedUp);
            }
            break;
          }
        }
      }

      // Release is considered backed up if all its discs are backed up
      const allBackedUp = discBackups.every((b) => b === 1) ? 1 : 0;
      return {
        ...g,
        backup_status: allBackedUp,
      };
    });

    const filteredGamesList = groupedGames.filter((g) => {
      // Option A: Hide bundled child discs/games from top-level collection list
      if (g.bundle_parent_id) {
        return false;
      }

      // Media Type Filter (Defaults to Physical Only)
      const mediaType = f.media_type || 'physical_only';
      if (mediaType === 'physical_only') {
        if (
          g.physical_status === 'digital_extracted_rom' ||
          g.physical_status === 'digital_only' ||
          g.release_medium === 'digital_extracted_rom' ||
          g.release_medium === 'digital_native' ||
          g.release_medium === 'unreleased_prototype'
        ) {
          return false;
        }
      } else if (mediaType === 'digital_extracted') {
        const isDigitalOrExtracted =
          g.physical_status === 'digital_extracted_rom' ||
          g.physical_status === 'digital_only' ||
          g.release_medium === 'digital_extracted_rom' ||
          g.release_medium === 'digital_native' ||
          g.release_medium === 'unreleased_prototype';
        if (!isDigitalOrExtracted) {
          return false;
        }
      }

      // Basic Ownership Filter
      const status = g.ownership_status ?? 0;
      if (f.ownership === 'seeking_or_unowned') {
        const isSeekingOrUnowned =
          status === OwnershipStatus.Seeking ||
          status === OwnershipStatus.Unowned;
        if (!isSeekingOrUnowned) return false;
      } else if (f.ownership !== 'all' && f.ownership !== status) {
        return false;
      }

      // Deals Only Filter
      if (f.deals_only) {
        const isOnSale = Boolean(g.retail_on_sale);
        if (!isOnSale) return false;
      }

      // Play Status Filter
      if (f.play_status !== undefined && f.play_status !== 'all') {
        const pStatus = g.play_status ?? 0;
        if (f.play_status !== pStatus) return false;
      }

      // Backup Status Filter
      if (f.backup_status !== undefined && f.backup_status !== 'all') {
        const bStatus = g.backup_status ? 1 : 0;
        if (f.backup_status !== bStatus) return false;
      }

      // Physical Release Verified Filter
      if (f.physical_verified !== undefined && f.physical_verified !== 'all') {
        const isVerified = g.rom_name ? 1 : 0;
        if (f.physical_verified !== isVerified) return false;
      }

      // Pre-release Guard: hide betas, protos, demos, and kiosk samplers unless it is an owned pack-in companion bonus disc
      const isPreRelease =
        /\b(beta|proto|prototype|demo|kiosk|sample|taikenban|trial version|promo)\b/i.test(
          g.rom_name || '',
        ) ||
        /\b(beta|proto|prototype|demo|kiosk|sample|taikenban|trial version|promo)\b/i.test(
          g.variants || '',
        );
      if (
        isPreRelease &&
        !g.companion_game_id &&
        !g.is_companion_base_disc &&
        !g.ownership_status
      ) {
        return false;
      }

      // Budget Label Status Filter (Strict Release-Level Semantics)
      if (f.budget_label && f.budget_label !== 'all') {
        const hasOptionalBudget = this.getOptionalBudgetLabels(g).length > 0;
        const hasExclusiveBudget = (g.variants || '')
          .split(',')
          .some((v) => this.isBudgetLabel(v.trim()));

        if (f.budget_label === 'standard_and_budget') {
          if (!hasOptionalBudget) return false;
        } else if (f.budget_label === 'budget_only') {
          if (!hasExclusiveBudget || hasOptionalBudget) return false;
        } else if (f.budget_label === 'standard_only') {
          if (hasExclusiveBudget || hasOptionalBudget) return false;
        }
      }

      // Platform Filter (Checks both direct platform and parent platform for cross-compatible hardware)
      if (f.platform_id) {
        if (
          g.platform_id !== f.platform_id &&
          g.parent_platform_id !== f.platform_id
        )
          return false;
      }

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (g.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some((r) => f.regions!.includes(r));
        if (!match) return false;
      }

      // Linked Status Filter (IGDB connectivity)
      if (f.is_linked !== undefined) {
        const hasIgdb = !!g.igdb_id;
        if (f.is_linked !== hasIgdb) return false;
      }

      // Name Filter (Case & Accent Insensitive)
      const activeNameFilter = f.name || f.seriesOrName;
      if (activeNameFilter) {
        const normalizedFilter = this.normalizeString(activeNameFilter);
        const normalizedTitle = this.normalizeString(g.title || '');
        if (f.nameExact) {
          if (normalizedTitle !== normalizedFilter) return false;
        } else {
          if (!normalizedTitle.includes(normalizedFilter)) return false;
        }
      }

      // Series Filter (Case & Accent Insensitive)
      if (f.series) {
        const normalizedFilter = this.normalizeString(f.series);
        const normalizedSeries = this.normalizeString(g.canonical_series || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedFilter)) return false;
        }
      }

      // Tag / Variant Filter (Case & Accent Insensitive)
      if (f.tag) {
        const normalizedFilter = this.normalizeString(f.tag);
        const itemTags = (g.variants || '')
          .split(',')
          .map((v) => this.normalizeString(v.trim()))
          .filter(Boolean);
        if (g.also_released_as) {
          for (const raw of g.also_released_as.split(',')) {
            const normRaw = this.normalizeString(raw.trim());
            if (normRaw) {
              itemTags.push(normRaw);
              itemTags.push(`± ${normRaw}`);
            }
          }
          for (const optLbl of this.getOptionalBudgetLabels(g)) {
            const normOpt = this.normalizeString(optLbl);
            if (normOpt) {
              itemTags.push(normOpt);
              itemTags.push(`± ${normOpt}`);
            }
          }
        }
        if (itemTags.length === 0) return false;
        if (f.tagExact) {
          if (!itemTags.some((t) => t === normalizedFilter)) return false;
        } else {
          if (!itemTags.some((t) => t.includes(normalizedFilter))) return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform (Decorate-Sort-Undecorate)
     * Sorting 2,000+ games previously invoked normalizeForSort() (NFD diacritics stripping,
     * regex, and lowercase) over 35,000 times per sort trigger.
     * Precomputing sort keys once per filtered item reduces normalizations and price calculations
     * from O(N log N) to O(N).
     */
    const decoratedGames = filteredGamesList.map((g) => ({
      item: g,
      retailPrice: g.retail_price ?? g.price_new ?? null,
      discountPct: g.retail_discount_pct ?? 0,
      effectivePrice: this.getEffectiveGamePrice(g),
      platformLaunchDate: g.platform_launch_date || '9999-99-99',
      normBrand: this.normalizeForSort(g.brand || ''),
      normSeries: this.normalizeForSort(g.canonical_series || g.title),
      releaseDate: g.release_date || '9999-99-99',
      sortIndex: g.sort_index ?? 9999,
      variantPriority: this.getVariantPriority(g.variants),
      region: g.region || '',
      id: g.id || '',
    }));

    decoratedGames.sort((a, b) => {
      // Retail Price Sorting (Low to High)
      if (f.sortBy === 'retail_asc') {
        if (a.retailPrice !== null || b.retailPrice !== null) {
          if (a.retailPrice === null) return 1;
          if (b.retailPrice === null) return -1;
          if (a.retailPrice !== b.retailPrice)
            return a.retailPrice - b.retailPrice;
        }
      }

      // Deepest Sale Discount Sorting (High to Low)
      if (f.sortBy === 'discount_desc') {
        if (a.discountPct !== b.discountPct)
          return b.discountPct - a.discountPct;
        const priceA = a.retailPrice ?? 999999;
        const priceB = b.retailPrice ?? 999999;
        if (priceA !== priceB) return priceA - priceB;
      }

      // Value-Based Sorting (High to Low or Low to High)
      if (f.sortBy === 'value_desc' || f.sortBy === 'value_asc') {
        if (a.effectivePrice !== null || b.effectivePrice !== null) {
          if (a.effectivePrice === null) return 1;
          if (b.effectivePrice === null) return -1;
          if (a.effectivePrice !== b.effectivePrice) {
            return f.sortBy === 'value_desc'
              ? b.effectivePrice - a.effectivePrice
              : a.effectivePrice - b.effectivePrice;
          }
        }
      }

      const isPriceSort =
        f.sortBy === 'value_desc' ||
        f.sortBy === 'value_asc' ||
        f.sortBy === 'retail_asc' ||
        f.sortBy === 'discount_desc';

      if (!isPriceSort) {
        // 1. Platform Launch Date (ASC)
        if (a.platformLaunchDate !== b.platformLaunchDate) {
          return a.platformLaunchDate.localeCompare(b.platformLaunchDate);
        }

        // 2. Platform Brand (ASC)
        if (a.normBrand !== b.normBrand) {
          return a.normBrand.localeCompare(b.normBrand);
        }
      }

      // 3. Game Canonical Series (ASC, fallback to title)
      if (a.normSeries !== b.normSeries) {
        return a.normSeries.localeCompare(b.normSeries);
      }

      // 4. Game Release Date (ASC, nulls last)
      if (a.releaseDate !== b.releaseDate) {
        return a.releaseDate.localeCompare(b.releaseDate);
      }

      // 5. Sort Index (ASC, nulls last)
      if (a.sortIndex !== b.sortIndex) {
        return a.sortIndex - b.sortIndex;
      }

      // 5.5. Variant Priority (ASC)
      if (a.variantPriority !== b.variantPriority) {
        return a.variantPriority - b.variantPriority;
      }

      // 6. Region (ASC)
      if (a.region !== b.region) {
        return a.region.localeCompare(b.region);
      }

      // 7. Release ID (ASC)
      return a.id.localeCompare(b.id);
    });

    return decoratedGames.map((entry) => entry.item);
  });

  /**
   * Normalizes a string by removing diacritics and converting to lowercase.
   * Crucial for supporting international titles (e.g. Pokémon) in search.
   *
   * @param str The string to normalize.
   * @returns The normalized string.
   */
  private normalizeString(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Normalizes a string for strict alphabetical sorting.
   * In addition to diacritic removal and lowercasing, it strips leading
   * articles (a, an, the) to ensure more natural "book-style" sorting.
   *
   * @param str The string to normalize.
   * @returns The normalized string for sorting.
   */
  private normalizeForSort(str: string): string {
    let s = this.normalizeString(str).trim();

    if (s.startsWith('the ')) s = s.substring(4);
    else if (s.startsWith('a ')) s = s.substring(2);
    else if (s.startsWith('an ')) s = s.substring(3);

    return s.trim();
  }

  private getVariantPriority(variants: string | null | undefined): number {
    if (!variants) return 0;
    const lower = variants.toLowerCase();
    if (/\b(beta|proto|prototype|demo|kiosk|sample|promo)\b/i.test(lower)) {
      return 2;
    }
    return 1;
  }

  private getToyTypeOrder(type: string | null | undefined): number {
    switch (type) {
      case 'Figure':
        return 1;
      case 'Yarn':
        return 2;
      case 'Block':
        return 3;
      case 'Band':
        return 4;
      case 'Card':
        return 5;
      default:
        return 99;
    }
  }

  /**
   * Checks whether a ROM filename contains a multi-disc or disc-role indicator
   * (including localized Disco/Disque/Disk and Play/Data/Install disc roles).
   */
  private hasDiscIndicator(filename: string | null | undefined): boolean {
    if (!filename) {
      return false;
    }
    const numberedDiscRegex =
      /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/i;
    if (numberedDiscRegex.test(filename)) return true;

    const bareDiscRegex =
      /[-_\s]+(?:disc|disco|disque|disk)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+)?\b/i;
    if (bareDiscRegex.test(filename)) return true;

    const roleDiscRegex =
      /\((?:play\s+disc|data\s+disc|data\s+installation\s+disc|installation\s+disc|install\s+disc|game\s+disc|key\s+disc|install|play|single\s+player|single-player|single\s+player\s+disc|multiplayer|multiplayer\s+disc|campaign|campaign\s+disc|campanha|cinematics\s+disc|movie\s+disc|bonus\s+disc| soundtrack\s+disc|add-on\s+disc|add-on\s+content\s+disc|additional\s+content\s+packs\s+install\s+disc|expansion\s+disk)\)/i;
    return roleDiscRegex.test(filename);
  }

  private stripDiscIndicator(filename: string | null | undefined): string {
    if (!filename) {
      return '';
    }

    const lastDot = filename.lastIndexOf('.');
    let base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;

    const hasNumberedDisc =
      /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/i.test(
        base,
      );

    base = base.replace(
      /[-_\s]*\((?:disc|disco|disque|disk|side)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+|\s*[/\\]\s*[0-9]+)?(?:\s*[-:]\s*[^)]+)?\)/gi,
      '',
    );
    base = base.replace(
      /[-_\s]+(?:disc|disco|disque|disk)\s+[a-zA-Z0-9]+(?:\s+of\s+[0-9]+)?\b/gi,
      '',
    );

    // Strip role-based disc parentheticals
    base = base.replace(
      /[-_\s]*\((?:play\s+disc|data\s+disc|data\s+installation\s+disc|installation\s+disc|install\s+disc|game\s+disc|key\s+disc|install|play|single\s+player|single-player|single\s+player\s+disc|multiplayer|multiplayer\s+disc|campaign|campaign\s+disc|campanha|cinematics\s+disc|movie\s+disc|bonus\s+disc|soundtrack\s+disc|add-on\s+disc|add-on\s+content\s+disc|additional\s+content\s+packs\s+install\s+disc|expansion\s+disk)\)/gi,
      '',
    );

    // Strip Japanese parenthetical counting indicators (e.g. "Ichi", "Ni" etc.) when used alongside or as disc indicators
    base = base.replace(/[-_\s]*\((?:ichi|ni|san|yon|shi|go)\)/gi, '');

    // If the ROM had a numbered (Disc N) marker, also strip per-disc content subtitles
    // (e.g. "(Snake Eater)", "(Persistence)", "(Dante Disc)", "(Lucia Disc)", "(Red Dead Redemption Single Player)")
    // while keeping region/language/revision parentheticals intact so discs of the same release group together.
    if (hasNumberedDisc) {
      base = base.replace(/\(([^)]+)\)/g, (full, inner: string) => {
        const t = inner.trim().toLowerCase();
        if (
          /^(?:usa|japan|europe|world|asia|korea|china|taiwan|australia|brazil|canada|france|germany|italy|spain|netherlands|sweden|norway|denmark|finland|russia|poland|portugal|greece|turkey|india|south africa|latin america|united kingdom|scandinavia|united arab emirates|austria|switzerland|ireland|hong kong|mexico|new zealand|unknown)(?:\s*,\s*[a-z\s]+)*$/i.test(
            t,
          )
        ) {
          return full;
        }
        if (
          /^[a-z]{2,3}(?:-[a-z]{2,4})?(?:,[a-z]{2,3}(?:-[a-z]{2,4})?)*$/i.test(
            t,
          )
        ) {
          return full;
        }
        if (
          /^(?:rev\s*[a-z0-9.]+|v[0-9]+(?:\.[0-9a-z]+)*|alt(?:\s+[0-9]+)?|edc|no\s+edc|limited\s+edition|collector's\s+edition|special\s+edition|game\s+of\s+the\s+year\s+edition|complete\s+edition|gold\s+edition|platinum\s+hits|greatest\s+hits|black\s+label|nintendo\s+selects|player's\s+choice)$/i.test(
            t,
          )
        ) {
          return full;
        }
        return '';
      });
    }

    base = base.replace(/\s+/g, ' ').trim();
    base = base.replace(/[-_]$/, '').trim();

    return base.toLowerCase();
  }

  private readonly BOX_SET_ROM_GROUPING_MAP: Record<string, string> = {
    'god of war collection (usa) (v02.00)': 'multi:god of war saga (usa)',
    'god of war iii (usa) (v02.00)': 'multi:god of war saga (usa)',
    'infamous (usa) (en,fr,es) (v02.00)': 'multi:infamous collection (usa)',
    'infamous 2 (usa) (en,fr,es,pt) (v02.00)':
      'multi:infamous collection (usa)',
    'metal gear solid - the legacy collection 1987-2012 (usa) (en,fr,es) (disc 2)':
      'multi:metal gear solid - the legacy collection 1987-2012 (usa)',
    'metal gear solid 4 - guns of the patriots (usa) (en,fr,de,es,it) (v02.00)':
      'multi:metal gear solid - the legacy collection 1987-2012 (usa)',
    'metal gear solid - the legacy collection 1987-2012 (europe) (en,fr,de,es,it) (disc 2)':
      'multi:metal gear solid - the legacy collection 1987-2012 (europe)',
    'metal gear solid 4 - guns of the patriots (europe) (en,fr,de,es,it) (v02.00)':
      'multi:metal gear solid - the legacy collection 1987-2012 (europe)',
    'metal gear solid - the legacy collection 1987-2012 (japan) (disc 1)':
      'multi:metal gear solid - the legacy collection 1987-2012 (japan)',
    'metal gear solid 4 - guns of the patriots (japan) (v02.01)':
      'multi:metal gear solid - the legacy collection 1987-2012 (japan)',
    'mass effect (italy) (rev 1)': 'multi:mass effect trilogy (italy)',
    'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 1) (rev 1)':
      'multi:mass effect trilogy (italy)',
    'mass effect 3 (italy) (en,ja,fr,de,es,it,pl,ru) (disc 2) (rev 1)':
      'multi:mass effect trilogy (italy)',
    "assassin's creed ii - game of the year edition (europe) (en,fr,de,es,it,nl,sv,no,da)":
      "multi:assassin's creed - heritage collection (europe)",
    "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 1) (rev 1)":
      "multi:assassin's creed - heritage collection (europe)",
    "assassin's creed iii (europe) (en,fr,de,es,it,nl,pt,sv,no,da,fi) (disc 2) (rev 1)":
      "multi:assassin's creed - heritage collection (europe)",
    "assassin's creed ii - game of the year edition (europe) (it,pl,ru)":
      "multi:assassin's creed - heritage collection (europe) (pl,ru)",
    "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 1) (rev 1)":
      "multi:assassin's creed - heritage collection (europe) (pl,ru)",
    "assassin's creed iii (europe) (pl,ru,cs,hu) (disc 2) (rev 1)":
      "multi:assassin's creed - heritage collection (europe) (pl,ru)",
    'grand theft auto - vice city (usa) (v4.00)':
      'multi:grand theft auto - the trilogy (usa)',
    'grand theft auto - san andreas (usa) (v3.00) (rev 1)':
      'multi:grand theft auto - the trilogy (usa)',
    'grand theft auto - vice city (usa) (rev 1)':
      'multi:grand theft auto - the trilogy (usa)',
    'grand theft auto - san andreas (usa) (en,es) (rev 1)':
      'multi:grand theft auto - the trilogy (usa)',
    'grand theft auto - vice city (europe) (en,fr,es,it) (rev 1)':
      'multi:grand theft auto - the trilogy (europe)',
    'grand theft auto - san andreas (europe) (en,fr,de,es,it) (rev 1)':
      'multi:grand theft auto - the trilogy (europe)',
  };

  private getRomGroupingKey(filename: string | null | undefined): string {
    if (!filename) {
      return '';
    }
    const lastDot = filename.lastIndexOf('.');
    const base = (
      lastDot !== -1 ? filename.slice(0, lastDot) : filename
    ).toLowerCase();
    if (this.BOX_SET_ROM_GROUPING_MAP[base]) {
      return this.BOX_SET_ROM_GROUPING_MAP[base];
    }
    if (this.hasDiscIndicator(filename)) {
      return `multi:${this.stripDiscIndicator(filename)}`;
    }
    return `single:${base}`;
  }

  /** Total value of all filtered games in cents */
  public totalGamesValue = computed(() => {
    return this.filteredGames().reduce(
      (sum, g) => sum + (this.getEffectiveGamePrice(g) || 0),
      0,
    );
  });

  /** Total value of all filtered toys in cents */
  public totalToysValue = computed(() => {
    return this.filteredToys().reduce(
      (sum, t) => sum + (t.price_loose || 0),
      0,
    );
  });

  /** Active total valuation for the current tab */
  public totalFilteredValue = computed(() =>
    this.currentTab() === 'games'
      ? this.totalGamesValue()
      : this.totalToysValue(),
  );

  /** Formats cents into USD currency string */
  public formatCurrency(cents: number | null | undefined): string {
    if (!cents || cents <= 0) return '$0.00';
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }

  /** Virtual list window based on displayLimit for infinite scroll performance */
  public displayGames = computed(() =>
    this.filteredGames().slice(0, this.displayLimit()),
  );

  /**
   * Computes the final UI grouping for games, organized by Platform.
   * When any price sort mode is active, bypasses platform grouping and presents
   * a single unified list ranked across platforms.
   */
  public groupedGames = computed(() => {
    const allFiltered = this.filteredGames();
    const displayed = this.displayGames();
    const f = this.filters();

    const isPriceSort =
      f.sortBy === 'value_desc' ||
      f.sortBy === 'value_asc' ||
      f.sortBy === 'retail_asc' ||
      f.sortBy === 'discount_desc';

    if (isPriceSort) {
      const sortLabel =
        f.sortBy === 'retail_asc'
          ? 'Ranked by Lowest Retail Price'
          : f.sortBy === 'discount_desc'
            ? 'Ranked by Biggest Sale %'
            : 'Ranked by Value';
      const headerTitle = f.platform_id
        ? `${displayed[0]?.display_name || displayed[0]?.platform || 'Platform'} (${sortLabel})`
        : `All Platforms (${sortLabel})`;
      return [
        {
          platformName: headerTitle,
          platformLogo: f.platform_id ? displayed[0]?.platform_logo : null,
          games: displayed,
          totalCount: allFiltered.length,
          totalValue: allFiltered.reduce(
            (sum, g) => sum + (this.getEffectiveGamePrice(g) || 0),
            0,
          ),
        },
      ];
    }

    // 1. Calculate total counts and total values per platform from ALL filtered games
    const counts = new Map<string, number>();
    const values = new Map<string, number>();
    for (const g of allFiltered) {
      const p = g.display_name || g.platform;
      counts.set(p, (counts.get(p) || 0) + 1);
      const val = this.getEffectiveGamePrice(g) || 0;
      values.set(p, (values.get(p) || 0) + val);
    }

    // 2. Build groups from DISPLAYED games
    const groups: GameGroup[] = [];
    const groupMap = new Map<string, GameGroup>();

    for (const game of displayed) {
      const p = game.display_name || game.platform;
      let group = groupMap.get(p);
      if (!group) {
        group = {
          platformName: p,
          platformLogo: game.platform_logo,
          launchYear: game.platform_launch_date
            ? (() => {
                const parts = game.platform_launch_date.split('-');
                if (parts.length === 3) {
                  const y = parseInt(parts[0], 10);
                  const m = parseInt(parts[1], 10) - 1;
                  const d = parseInt(parts[2], 10);
                  const dt = new Date(y, m, d);
                  return new Intl.DateTimeFormat('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }).format(dt);
                }
                return game.platform_launch_date;
              })()
            : undefined,
          games: [],
          totalCount: counts.get(p) || 0,
          totalValue: values.get(p) || 0,
        };
        groups.push(group);
        groupMap.set(p, group);
      }
      group.games.push(game);
    }
    return groups;
  });

  /**
   * Reactive pipeline for filtering the toy collection.
   */
  public filteredToys = computed(() => {
    const allToys = this.collectionService.toys();
    const f = this.filters();
    const filteredToysList = allToys.filter((toy) => {
      // Ownership Filter
      const status = toy.ownership_status ?? 0;
      if (f.ownership !== 'all' && f.ownership !== status) return false;

      // Line Filter (e.g. Amiibo, Skylanders)
      if (f.line && toy.line !== f.line) return false;

      // Type Filter (e.g. Figure, Card)
      if (f.type && toy.type !== f.type) return false;

      // Region Filter
      if (f.regions && f.regions.length > 0) {
        const itemRegions = (toy.region || '')
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean);
        const match = itemRegions.some((r) => f.regions!.includes(r));
        if (!match) return false;
      }

      // Name Filter (Case & Accent Insensitive)
      const activeNameFilter = f.name || f.seriesOrName;
      if (activeNameFilter) {
        const normalizedFilter = this.normalizeString(activeNameFilter);
        const normalizedName = this.normalizeString(toy.name || '');
        if (f.nameExact) {
          if (normalizedName !== normalizedFilter) return false;
        } else {
          if (!normalizedName.includes(normalizedFilter)) return false;
        }
      }

      // Series Filter (Case & Accent Insensitive)
      if (f.series) {
        const normalizedFilter = this.normalizeString(f.series);
        const normalizedSeries = this.normalizeString(toy.series_name || '');
        if (f.seriesExact) {
          if (normalizedSeries !== normalizedFilter) return false;
        } else {
          if (!normalizedSeries.includes(normalizedFilter)) return false;
        }
      }

      return true;
    });

    /**
     * DESIGN RATIONALE: Schwartzian Transform for Toys
     * Precomputing line, series name, toy name, and type orders reduces string normalization
     * overhead during sorting across hundreds of toys.
     */
    const decoratedToys = filteredToysList.map((toy) => ({
      item: toy,
      priceLoose: toy.price_loose ?? null,
      normLine: this.normalizeForSort(toy.line),
      seriesIndex: toy.series_index ?? 9999,
      normSeries: this.normalizeForSort(toy.series_name || ''),
      isAmiibo: toy.line === 'amiibo',
      toyTypeOrder: this.getToyTypeOrder(toy.type),
      releaseDate: toy.release_date || '9999-99-99',
      sortIndex: toy.sort_index ?? 9999,
      normName: this.normalizeForSort(toy.name || ''),
    }));

    decoratedToys.sort((a, b) => {
      // Value-Based Sorting (High to Low or Low to High)
      const isPriceSort = f.sortBy === 'value_desc' || f.sortBy === 'value_asc';
      if (isPriceSort) {
        if (a.priceLoose !== null || b.priceLoose !== null) {
          if (a.priceLoose === null) return 1;
          if (b.priceLoose === null) return -1;
          if (a.priceLoose !== b.priceLoose) {
            return f.sortBy === 'value_desc'
              ? b.priceLoose - a.priceLoose
              : a.priceLoose - b.priceLoose;
          }
        }
      }

      if (!isPriceSort) {
        // 1. Line (ASC)
        if (a.normLine !== b.normLine) {
          return a.normLine.localeCompare(b.normLine);
        }

        // 2. Series Sort Index or Name (ASC)
        if (a.seriesIndex !== b.seriesIndex) {
          return a.seriesIndex - b.seriesIndex;
        }
        if (a.normSeries !== b.normSeries) {
          return a.normSeries.localeCompare(b.normSeries);
        }
      }

      // 3. Toy-level sorting
      if (a.isAmiibo) {
        // Priority 1: Type (Figure -> Yarn -> Block -> Band -> Card)
        if (a.toyTypeOrder !== b.toyTypeOrder) {
          return a.toyTypeOrder - b.toyTypeOrder;
        }

        // Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }

        // Priority 3: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }
      } else {
        // Non-amiibo Priority 1: Sort Index (ASC, nulls last)
        if (a.sortIndex !== b.sortIndex) {
          return a.sortIndex - b.sortIndex;
        }

        // Non-amiibo Priority 2: Release Date (ASC, nulls last)
        if (a.releaseDate !== b.releaseDate) {
          return a.releaseDate.localeCompare(b.releaseDate);
        }
      }

      // 4. Name (ASC) fallback
      return a.normName.localeCompare(b.normName);
    });

    return decoratedToys.map((entry) => entry.item);
  });

  /** Virtual list window for toys */
  public displayToys = computed(() =>
    this.filteredToys().slice(0, this.displayLimit()),
  );

  /**
   * Computes the UI grouping for toys, organized by 'Line'.
   */
  public groupedToys = computed(() => {
    const displayed = this.displayToys();
    const allFiltered = this.filteredToys();
    const f = this.filters();

    // When sorted by value, present a unified list ranked across lines/series
    if (f.sortBy === 'value_desc' || f.sortBy === 'value_asc') {
      const lineTitle = f.line
        ? `${f.line} (Ranked by Value)`
        : 'All Toys (Ranked by Value)';
      const totalVal = allFiltered.reduce(
        (sum, t) => sum + (t.price_loose || 0),
        0,
      );
      return [
        {
          lineName: lineTitle,
          totalCount: allFiltered.length,
          totalValue: totalVal,
          seriesGroups: [
            {
              seriesName: 'Market Value Ranking',
              toys: displayed,
              totalCount: allFiltered.length,
              totalValue: totalVal,
            },
          ],
        },
      ];
    }

    // 1. Get total counts and total values per line and per series from ALL filtered toys
    const lineCounts = new Map<string, number>();
    const lineValues = new Map<string, number>();
    const seriesCounts = new Map<string, Map<string, number>>();
    const seriesValues = new Map<string, Map<string, number>>();

    for (const toy of allFiltered) {
      const line = toy.line || 'Unknown';
      const series = toy.series_name || 'No Series';
      const price = toy.price_loose || 0;

      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
      lineValues.set(line, (lineValues.get(line) || 0) + price);

      if (!seriesCounts.has(line)) seriesCounts.set(line, new Map());
      const sMap = seriesCounts.get(line)!;
      sMap.set(series, (sMap.get(series) || 0) + 1);

      if (!seriesValues.has(line)) seriesValues.set(line, new Map());
      const vMap = seriesValues.get(line)!;
      vMap.set(series, (vMap.get(series) || 0) + price);
    }

    // 2. Build nested groups from DISPLAYED toys
    const groups: ToyGroup[] = [];
    const lineMap = new Map<string, ToyGroup>();

    for (const toy of displayed) {
      const lineName = toy.line || 'Unknown';
      const seriesName = toy.series_name || 'No Series';

      let lineGroup = lineMap.get(lineName);
      if (!lineGroup) {
        lineGroup = {
          lineName,
          seriesGroups: [],
          totalCount: lineCounts.get(lineName) || 0,
          totalValue: lineValues.get(lineName) || 0,
        };
        groups.push(lineGroup);
        lineMap.set(lineName, lineGroup);
      }

      let seriesGroup = lineGroup.seriesGroups.find(
        (sg) => sg.seriesName === seriesName,
      );
      if (!seriesGroup) {
        seriesGroup = {
          seriesName,
          toys: [],
          totalCount: seriesCounts.get(lineName)?.get(seriesName) || 0,
          totalValue: seriesValues.get(lineName)?.get(seriesName) || 0,
        };
        lineGroup.seriesGroups.push(seriesGroup);
      }
      seriesGroup.toys.push(toy);
    }
    return groups;
  });

  /** --- Utility Selectors for Filter Dropdowns --- */
  public uniqueLines = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.line)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  public uniqueTypes = computed(() =>
    Array.from(new Set(this.collectionService.toys().map((f) => f.type)))
      .filter(Boolean)
      .sort((a, b) =>
        this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
      ),
  );

  public uniqueNames = computed<string[]>(() => {
    if (this.currentTab() === 'games') {
      const list = this.collectionService.games().map((g) => g.title);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    } else {
      const list = this.collectionService.toys().map((t) => t.name);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    }
  });

  public uniqueSeries = computed(() => {
    if (this.currentTab() === 'games') {
      const list = this.collectionService
        .games()
        .map((g) => g.canonical_series);
      return Array.from(new Set(list))
        .filter(Boolean)
        .sort((a, b) =>
          this.normalizeForSort(a || '').localeCompare(
            this.normalizeForSort(b || ''),
          ),
        );
    } else {
      const seriesMap = new Map<string, number | undefined>();
      for (const toy of this.collectionService.toys()) {
        if (toy.series_name) {
          if (
            !seriesMap.has(toy.series_name) ||
            (seriesMap.get(toy.series_name) === undefined &&
              toy.series_index !== undefined)
          ) {
            seriesMap.set(toy.series_name, toy.series_index);
          }
        }
      }
      return Array.from(seriesMap.keys())
        .filter(Boolean)
        .sort((a, b) => {
          const indexA = seriesMap.get(a) ?? 9999;
          const indexB = seriesMap.get(b) ?? 9999;
          if (indexA !== indexB) {
            return indexA - indexB;
          }
          return this.normalizeForSort(a).localeCompare(
            this.normalizeForSort(b),
          );
        });
    }
  });

  public uniqueTags = computed<string[]>(() => {
    const tagsSet = new Set<string>();
    for (const g of this.collectionService.games()) {
      if (g.variants) {
        g.variants.split(',').forEach((v) => {
          const trimmed = v.trim();
          if (trimmed) tagsSet.add(trimmed);
        });
      }
    }
    return Array.from(tagsSet).sort((a, b) =>
      this.normalizeForSort(a).localeCompare(this.normalizeForSort(b)),
    );
  });

  public uniqueRegions = computed<string[]>(() => {
    const regionsSet = new Set<string>();

    for (const g of this.collectionService.games()) {
      if (g.region) {
        g.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    for (const t of this.collectionService.toys()) {
      if (t.region) {
        t.region.split(',').forEach((r) => {
          const trimmed = r.trim();
          if (trimmed) regionsSet.add(trimmed);
        });
      }
    }

    return Array.from(regionsSet).sort();
  });

  /**
   * Initializes the component and sets up the state persistence effect.
   * This effect ensures that any change to filters or display limits is
   * automatically mirrored in the CollectionService and sessionStorage.
   */
  constructor() {
    effect(() => {
      const state: ListState = {
        tab: this.currentTab(),
        filters: this.filters(),
        displayLimit: this.displayLimit(),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
      if (this.stateInitialized()) {
        this.collectionService.updateListState(state);
      }
    });
  }

  /**
   * Listens for scroll events outside of Angular's zone to prevent change detection
   * from firing on every frame, which causes severe scroll jank. Throttled.
   */
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private onScrollHandler = () => {
    if (this.scrollTimeout) return;
    this.scrollTimeout = setTimeout(() => {
      this.scrollTimeout = null;
      if (this.stateInitialized() && window.scrollY > 0) {
        const currentState = this.collectionService.getListState(
          this.currentTab(),
        );
        const state: ListState = currentState || {
          tab: this.currentTab(),
          filters: this.filters(),
          displayLimit: this.displayLimit(),
          scrollX: 0,
          scrollY: 0,
        };

        this.collectionService.updateListState({
          ...state,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }
    }, 100);
  };

  /**
   * Restores the previously saved scroll position after rendering.
   * Since displayLimit is hydrated before initial render, all items are present
   * in the DOM tree upfront.
   */
  private restoreScroll() {
    const savedState = this.collectionService.getListState(this.currentTab());
    if (!savedState || savedState.scrollY === undefined) {
      this.stateInitialized.set(true);
      return;
    }

    const targetY = savedState.scrollY || 0;
    const targetX = savedState.scrollX || 0;

    window.scrollTo({
      left: targetX,
      top: targetY,
      behavior: 'instant' as ScrollBehavior,
    });
    this.stateInitialized.set(true);
  }

  /**
   * Component Lifecycle: Restores previous tab state and initiates data refresh.
   */
  async ngOnInit() {
    this.stateInitialized.set(false);
    this.currentTab.set(
      (this.route.snapshot.url[0]?.path as 'games' | 'toys') || 'games',
    );

    const savedState = this.collectionService.getListState(this.currentTab());
    if (savedState) {
      this.filters.set({ ...savedState.filters });
      this.displayLimit.set(savedState.displayLimit);
    }

    await this.collectionService.refreshAll();
    this.restoreScroll();

    if (typeof window !== 'undefined') {
      this.ngZone.runOutsideAngular(() => {
        window.addEventListener('scroll', this.onScrollHandler, {
          passive: true,
        });
      });
    }
  }

  /**
   * Sets up the IntersectionObserver for infinite scrolling after the view is ready.
   */
  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  /**
   * Cleanup: disconnects observer to prevent memory leaks and persists final state.
   */
  ngOnDestroy() {
    if (this.observer) this.observer.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScrollHandler);
    }
    this.collectionService.persistState(this.currentTab());
  }

  /**
   * Initializes the IntersectionObserver that triggers 'loadMore' when the
   * user reaches the bottom of the list.
   */
  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.loadMore();
      },
      { root: null, rootMargin: '200px', threshold: 0.1 },
    );
    if (this.scrollTrigger?.nativeElement)
      this.observer.observe(this.scrollTrigger.nativeElement);
  }

  /**
   * Increases the virtual display limit, triggering the computed reactive
   * pipelines to slice a larger portion of the collection into the DOM.
   */
  loadMore() {
    this.displayLimit.update((limit) => limit + 100);
  }

  /**
   * Event handler for filter updates from the child component.
   * Resets the display limit to ensure performance.
   */
  onFiltersChange(newFilters: FilterState) {
    this.filters.set({ ...newFilters });
    this.displayLimit.set(100);
  }

  /** --- Toggle Ownership Handlers --- */
  onToggleStatus(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    const name = (item as Game).title || (item as Toy).name;

    this.collectionService.showOptions(
      `Change Status`,
      `Set status for "${name}":`,
      [
        { label: 'Unowned', value: 0 },
        { label: 'Owned', value: 1 },
        { label: 'Seeking', value: 2 },
        { label: 'Ordered', value: 3 },
      ],
      (newValue) => {
        const numValue =
          typeof newValue === 'string' ? parseInt(newValue, 10) : newValue;
        if (isNaN(numValue) || numValue < 0 || numValue > 3) return;

        this.collectionService
          .toggleOwnership(item.id, type, numValue)
          .subscribe({
            next: () => this.collectionService.refreshAll(),
            error: (err) => console.error('Failed to set status:', err),
          });
      },
    );
  }

  onEditSortIndex(event: MouseEvent, item: Game | Toy, type: 'game' | 'toy') {
    event.preventDefault();
    event.stopPropagation();

    const name = (item as Game).title || (item as Toy).name;
    const currentSort = item.sort_index ?? 0;

    this.collectionService.showInput(
      `Edit Sort Index`,
      `Set sort index for "${name}":`,
      currentSort,
      (newValue) => {
        const numValue =
          newValue === '' || newValue === null
            ? 0
            : typeof newValue === 'string'
              ? parseInt(newValue, 10)
              : newValue;
        if (isNaN(numValue)) return;

        this.collectionService
          .updateSortIndex(item.id, type, numValue)
          .subscribe({
            next: () => this.collectionService.refreshAll(),
            error: (err) => console.error('Failed to update sort index:', err),
          });
      },
    );
  }

  public getDealArbitrageSavings(game: Game): number | null {
    if (!game.retail_price || !game.price_cib) return null;
    if (game.price_cib > game.retail_price) {
      return game.price_cib - game.retail_price;
    }
    return null;
  }

  public getGamePriceBadge(
    game: Game,
  ): { cents: number; label: string } | null {
    const isCib = Boolean(game.has_case) && Boolean(game.has_manual);
    if (isCib && game.price_cib) {
      return { cents: game.price_cib, label: 'CIB' };
    }
    if (game.price_loose) {
      return { cents: game.price_loose, label: 'Loose' };
    }
    if (game.retail_price) {
      return { cents: game.retail_price, label: game.retail_store || 'Retail' };
    }
    if (game.price_new) {
      return { cents: game.price_new, label: 'New' };
    }
    return null;
  }

  private getEffectiveGamePrice(game: Game): number | null {
    const isCib = Boolean(game.has_case) && Boolean(game.has_manual);
    if (isCib) {
      return game.price_cib ?? game.price_loose ?? null;
    }
    return game.price_loose ?? null;
  }

  onToggleCase(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    const current = Boolean(game.has_case);
    const newStatus = current ? 0 : 1;
    game.has_case = newStatus;
    this.collectionService.updateHasCase(game.id, newStatus).subscribe({
      next: () => this.collectionService.refreshAll(),
      error: (err) => console.error('Failed to toggle case:', err),
    });
  }

  onToggleManual(event: MouseEvent, game: Game) {
    event.preventDefault();
    event.stopPropagation();
    const current = Boolean(game.has_manual);
    const newStatus = current ? 0 : 1;
    game.has_manual = newStatus;
    this.collectionService.updateHasManual(game.id, newStatus).subscribe({
      next: () => this.collectionService.refreshAll(),
      error: (err) => console.error('Failed to toggle manual:', err),
    });
  }

  public onExportRequested(format: 'csv' | 'dat'): void {
    if (this.currentTab() === 'games') {
      const games = this.filteredGames();
      if (format === 'csv') {
        this.exportService.exportCsv(games, 'games');
      } else if (format === 'dat') {
        const platformName = this.filters().platform_id
          ? this.platformGroups()
              .flatMap((g) => g.platforms)
              .find((p) => p.id === this.filters().platform_id)?.display_name
          : undefined;
        this.exportService.exportLogiqxXmlDat(
          games,
          platformName
            ? `${platformName} Collection Wishlist`
            : `${this.branding.appName()} Games Collection Wishlist`,
        );
      }
    } else {
      const toys = this.filteredToys();
      this.exportService.exportCsv(toys, 'toys');
    }
  }

  public getBackedUpDiscCount(game: Game): number {
    return (game.discBackups || []).filter((b) => b === 1).length;
  }

  public onToggleDiscBackup(
    event: MouseEvent,
    game: Game,
    discIndex: number,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const discId = game.discIds?.[discIndex];
    if (!discId) return;
    const current = game.discBackups?.[discIndex] === 1;
    const newStatus = current ? 0 : 1;
    if (game.discBackups) {
      game.discBackups[discIndex] = newStatus;
      game.backup_status = game.discBackups.every((b) => b === 1) ? 1 : 0;
    }
    this.collectionService.updateBackupStatus(discId, newStatus).subscribe({
      next: () => this.collectionService.refreshAll(),
      error: (err) => console.error('Failed to toggle disc backup:', err),
    });
  }
}
