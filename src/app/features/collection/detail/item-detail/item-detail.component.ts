/**
 * ITEM DETAIL COMPONENT
 *
 * An immersive, high-contrast detail view for individual games, toys, and platforms.
 * It synthesizes multiple metadata sources into a single, cohesive narrative.
 *
 * DESIGN RATIONALE:
 * - **Immersive UI**: Uses large typography, tonal surfaces, and high-quality
 *   imagery to create a premium feel.
 * - **Signal Interop**: Leverages `toSignal` to bridge between the RxJS-based
 *   ActivatedRoute and the component's reactive computed signals.
 * - **Dynamic Metadata**: Adapts the layout and metadata boxes based on the
 *   item 'type', ensuring relevance (e.g. showing 'Line' for toys vs 'Platform' for games).
 * - **Context-Aware Navigation**: The 'filterBySeries' method doesn't just
 *   navigate; it intelligently updates the collection state to apply an exact
 *   match filter, streamlining franchise exploration.
 */

import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  RouterModule,
  Router,
  RouteReuseStrategy,
} from '@angular/router';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Game,
  Toy,
  Platform,
  PlayStatus,
  GameRelease,
  getMediaIconName,
  JournalEntry,
  STANDARD_MERCHANTS,
  formatJournalDate,
} from '../../../../core/models/collection.models';
import { combineLatest, of, Observable, firstValueFrom } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { NavigationHistoryService } from '../../../../core/services/navigation-history.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { IconName } from '../../../../shared/components/icon/icon.catalog';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    @if (item(); as i) {
      <div class="container animate-expressive pb-xl" data-version="final-v12">
        <nav class="details-nav mb-lg flex justify-between items-center">
          <a
            [href]="'/collection/' + (type() ? type() + 's' : 'games')"
            (click)="onBack($event)"
            class="back-link flex items-center gap-sm"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Collection
          </a>
          @if (game(); as g) {
            <div class="quick-stats flex gap-sm items-center">
              <div
                class="stat-pill interactive"
                [class.active]="g.play_status !== 0"
                (click)="onEditPlayed(g)"
              >
                <span class="icon"
                  ><app-icon
                    [name]="getPlayStatusIconName(g.play_status)"
                    [size]="14"
                /></span>
                <span>{{ getPlayStatusText(g.play_status) }}</span>
              </div>
              <div
                class="stat-pill interactive"
                [class.active]="g.ownership_status !== 0"
                [class.owned]="g.ownership_status === 1"
                [class.seeking]="g.ownership_status === 2"
                [class.ordered]="g.ownership_status === 3"
                (click)="onEditOwnership(g, 'game')"
              >
                <span class="icon">
                  <app-icon
                    [name]="getOwnershipStatusIconName(g.ownership_status)"
                    [size]="14"
                  />
                </span>
                <span>{{
                  g.ownership_status === 1
                    ? 'Owned'
                    : g.ownership_status === 2
                      ? 'Seeking'
                      : g.ownership_status === 3
                        ? 'Ordered'
                        : 'Unowned'
                }}</span>
              </div>
              @if (g.igdb_id && g.igdb_url) {
                <a
                  [href]="g.igdb_url"
                  target="_blank"
                  class="stat-pill active igdb interactive"
                >
                  <span class="icon"
                    ><app-icon name="verified-badge" [size]="14"
                  /></span>
                  <span>IGDB Verified</span>
                </a>
              }
              @if (g.platform_id === 26 || g.platform_id === 27) {
                <a
                  href="https://docs.google.com/spreadsheets/d/1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs/edit?gid=0#gid=0"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="stat-pill active physical interactive"
                  title="Physical release data verified via Nintendo Revised Cartridge Revisions spreadsheet"
                >
                  <span class="icon"><app-icon name="link" [size]="14" /></span>
                  <span>Nintendo Revised Sheet ↗</span>
                </a>
              }
              @if (isUpcomingRelease(g)) {
                <div class="stat-pill active upcoming">
                  <span class="icon"
                    ><app-icon name="calendar" [size]="14"
                  /></span>
                  <span>Upcoming Launch (Pre-Release)</span>
                </div>
              } @else if (
                !hasPhysicalRelease(g) &&
                (g.physical_status === 'not_yet_physical' ||
                  g.physical_status === 'physical_pending') &&
                !hasOwnedPhysical(g)
              ) {
                <div
                  class="stat-pill active pending interactive"
                  (click)="toggleWatchPhysical(g)"
                  title="Click to remove from Physical Watch list"
                >
                  <span class="icon"
                    ><app-icon name="clock" [size]="14"
                  /></span>
                  <span>Awaiting Physical Edition (Watching)</span>
                </div>
              } @else if (canWatchPhysical(g)) {
                <div
                  class="stat-pill interactive"
                  (click)="toggleWatchPhysical(g)"
                  title="Click to watch for physical release announcements and boutique pre-orders"
                >
                  <span class="icon"
                    ><app-icon name="clock" [size]="14"
                  /></span>
                  <span>+ Watch for Physical</span>
                </div>
              } @else if (
                g.physical_status === 'digital_extracted_rom' ||
                g.release_medium === 'digital_extracted_rom'
              ) {
                <div class="stat-pill active extracted-rom">
                  <span class="icon"
                    ><app-icon name="rom-archive" [size]="14"
                  /></span>
                  <span>Extracted Archival ROM</span>
                </div>
              } @else if (hasPhysicalRelease(g)) {
                <div class="stat-pill active physical-release">
                  <span class="icon"
                    ><app-icon name="physical-box" [size]="14"
                  /></span>
                  <span>{{
                    g.is_source_verified ||
                    (g.releases && g.releases.some((r) => r.is_source_verified))
                      ? 'Verified Source Match'
                      : 'Physical Retail Release'
                  }}</span>
                </div>
              } @else if (
                g.release_medium !== 'digital_native' &&
                g.release_medium !== 'unreleased_prototype'
              ) {
                <div class="stat-pill physical-release">
                  <span class="icon"
                    ><app-icon name="physical-box" [size]="14"
                  /></span>
                  <span>Physical Retail Release (Modern Platform)</span>
                </div>
              }
            </div>
          } @else if (toy(); as t) {
            <div class="quick-stats flex gap-sm items-center">
              <div
                class="stat-pill interactive"
                [class.active]="t.ownership_status !== 0"
                [class.owned]="t.ownership_status === 1"
                [class.seeking]="t.ownership_status === 2"
                [class.ordered]="t.ownership_status === 3"
                (click)="onEditOwnership(t, 'toy')"
              >
                <span class="icon">
                  <app-icon
                    [name]="getOwnershipStatusIconName(t.ownership_status)"
                    [size]="14"
                  />
                </span>
                <span>{{
                  t.ownership_status === 1
                    ? 'Owned'
                    : t.ownership_status === 2
                      ? 'Seeking'
                      : t.ownership_status === 3
                        ? 'Ordered'
                        : 'Unowned'
                }}</span>
              </div>
              @if (getToySource(t); as source) {
                <a
                  [href]="source.url"
                  target="_blank"
                  class="stat-pill active physical interactive"
                  style="text-decoration: none;"
                >
                  <span class="icon"><app-icon name="link" [size]="14" /></span>
                  <span>{{ source.label }}</span>
                </a>
              }
            </div>
          }
        </nav>

        <div class="hero-section mb-xl">
          <div class="hero-grid">
            <div class="art-container">
              <div class="art-frame" [class.toy-frame]="type() === 'toy'">
                @if (i.image_url) {
                  <img
                    [src]="i.image_url"
                    alt="Cover Art"
                    [class.glitch-load]="type() !== 'toy'"
                    [class.toy-detail-art]="type() === 'toy'"
                    referrerpolicy="no-referrer"
                  />
                } @else {
                  <div class="placeholder">No Image</div>
                }
                @if (game(); as g) {
                  <div class="region-overlay" [title]="'Region: ' + g.region">
                    {{ g.region }}
                  </div>
                }
              </div>
            </div>

            <div class="hero-content">
              <h1 class="item-title text-gradient">
                {{ game()?.title || toy()?.name || platform()?.name }}
              </h1>
              @if (game()?.variants; as variants) {
                <div class="flex flex-wrap gap-sm mb-md">
                  @for (variant of variants.split(','); track variant) {
                    @if (variant.trim()) {
                      <span class="variant-badge big">{{
                        variant.trim()
                      }}</span>
                    }
                  }
                </div>
              }
              @if (game()?.also_released_as; as alsoReleased) {
                <div
                  class="also-released-row flex flex-wrap items-center gap-xs mb-md"
                >
                  <span class="also-released-label">Also released as:</span>
                  @for (label of alsoReleased.split(','); track label) {
                    @if (label.trim()) {
                      <span class="also-released-pill">{{ label.trim() }}</span>
                    }
                  }
                </div>
              }
              @if (type() === 'toy' && toy()?.series_name) {
                <p class="item-series">{{ toy()?.series_name }}</p>
              }

              @if (formattedDate(); as date) {
                <p class="item-release-banner animate-slide-up">{{ date }}</p>
              }

              @if (game(); as g) {
                <div class="genre-cloud mt-lg">
                  @for (genre of (g.genres || '').split(', '); track genre) {
                    @if (genre) {
                      <span class="genre-chip">{{ genre }}</span>
                    }
                  }
                </div>
              }

              <div class="metadata-grid mt-xl">
                <div class="meta-box">
                  <span class="label">{{
                    type() === 'toy' ? 'Line' : 'Platform'
                  }}</span>
                  <div class="value flex items-center gap-sm">
                    @if (game()?.platform_logo) {
                      <img
                        [src]="game()?.platform_logo"
                        class="mini-logo"
                        alt=""
                      />
                    }
                    <span>{{
                      game()?.display_name ||
                        game()?.platform ||
                        toy()?.line ||
                        'N/A'
                    }}</span>
                  </div>
                </div>
                @if (game(); as g) {
                  @if (!formattedDate()) {
                    <div class="meta-box">
                      <span class="label">Release Date</span>
                      <span class="value">{{
                        g.release_date || 'Unknown'
                      }}</span>
                    </div>
                  }
                } @else if (toy(); as t) {
                  @if (!formattedDate()) {
                    <div class="meta-box">
                      <span class="label">Release Date</span>
                      <span class="value">{{
                        t.release_date || 'Unknown'
                      }}</span>
                    </div>
                  }
                }
                @if (game(); as g) {
                  @if (parsedOriginMetadata(); as origin) {
                    <div class="meta-box full-width provenance-section mt-md">
                      <span class="label">Archival Origin Provenance</span>
                      <div
                        class="provenance-card p-sm rounded-md bg-surface-container-high border border-outline-variant mt-2xs"
                      >
                        <div class="flex items-center gap-sm mb-2xs">
                          <span class="font-bold text-sm"
                            >Release Channel:</span
                          >
                          <span>{{
                            origin.origin_channel || origin.origin_platform
                          }}</span>
                          @if (origin.origin_year) {
                            <span class="text-secondary text-sm">{{
                              origin.origin_year
                            }}</span>
                          }
                        </div>
                        @if (origin.target_hardware) {
                          <div class="text-xs text-secondary mb-2xs">
                            Target Playback Hardware:
                            <strong>{{ origin.target_hardware }}</strong>
                          </div>
                        }
                        @if (origin.notes) {
                          <p class="text-sm text-secondary m-0">
                            {{ origin.notes }}
                          </p>
                        }
                      </div>
                    </div>
                  }
                  @if (g.bundled_games && g.bundled_games.length > 0) {
                    <div class="meta-box full-width bundles-section mt-lg">
                      <span class="label"
                        >Included Games & Bonus Discs (In-Box)</span
                      >
                      <div class="discs-list flex flex-col gap-md mt-2xs">
                        @for (b of g.bundled_games; track b.id || b.stable_id) {
                          <div
                            class="disc-row flex flex-col md:flex-row md:items-center justify-between gap-md p-sm rounded-md border border-outline-variant bg-surface-container-high"
                          >
                            <div class="disc-info flex-1">
                              <div class="flex items-center gap-sm mb-2xs">
                                <span class="variant-badge"
                                  >Disc {{ b.bundle_disc_number || 2 }}</span
                                >
                                <strong class="text-sm">{{ b.title }}</strong>
                                @if (b.platform_name) {
                                  <span class="crc-text"
                                    >[{{ b.platform_name }}]</span
                                  >
                                }
                              </div>
                            </div>
                            <div class="disc-actions flex items-center gap-sm">
                              <div
                                class="stat-pill"
                                [class.active]="!!b.backup_status"
                              >
                                <span class="icon">
                                  <app-icon
                                    [name]="
                                      b.backup_status
                                        ? 'rom-archive'
                                        : 'missing-dump'
                                    "
                                    [size]="14"
                                  />
                                </span>
                                <span>{{
                                  b.backup_status ? 'Backed Up' : 'No Backup'
                                }}</span>
                              </div>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }
                  @if (g.releases && g.releases.length > 0) {
                    <div class="meta-box full-width discs-section mt-lg">
                      <span class="label">Physical Discs / Releases</span>
                      <div class="discs-list flex flex-col gap-md">
                        @for (release of g.releases; track release.id) {
                          <div
                            class="disc-row flex flex-col md:flex-row md:items-center justify-between gap-md p-sm rounded-md border border-outline-variant bg-surface-container-high"
                          >
                            <div class="disc-info flex-1">
                              <div
                                class="flex flex-wrap items-center gap-xs mb-2xs"
                              >
                                @if (release.disc_label) {
                                  <span class="variant-badge">{{
                                    release.disc_label
                                  }}</span>
                                }
                                @if (
                                  release.variants &&
                                  release.variants !== release.disc_label
                                ) {
                                  <span class="variant-badge">{{
                                    release.variants
                                  }}</span>
                                }
                                @if (release.serial_code) {
                                  <span
                                    class="variant-badge serial-badge font-mono"
                                    >{{ release.serial_code }}</span
                                  >
                                }
                                @if (
                                  release.region && release.region !== g.region
                                ) {
                                  <span class="variant-badge region-badge">{{
                                    release.region
                                  }}</span>
                                }
                                @if (
                                  release.is_companion_base_disc &&
                                  release.companion_game_id
                                ) {
                                  <span
                                    class="companion-disc-note text-xs flex items-center gap-xs"
                                  >
                                    <app-icon name="link" [size]="12" />
                                    Identical disc master to original release:
                                    <a
                                      [routerLink]="[
                                        '/collection',
                                        'game',
                                        release.companion_game_id,
                                      ]"
                                      class="meta-link font-semibold"
                                    >
                                      {{
                                        release.companion_game_title ||
                                          'View Original Release'
                                      }}
                                    </a>
                                  </span>
                                } @else if (release.companion_game_id) {
                                  <span
                                    class="companion-disc-note text-xs flex items-center gap-xs"
                                  >
                                    <app-icon name="link" [size]="12" />
                                    Standalone game:
                                    <a
                                      [routerLink]="[
                                        '/collection',
                                        'game',
                                        release.companion_game_id,
                                      ]"
                                      class="meta-link font-semibold"
                                    >
                                      {{
                                        release.companion_game_title ||
                                          'View Standalone Game'
                                      }}
                                    </a>
                                  </span>
                                }
                                @if (
                                  g.releases.length > 1 &&
                                  release.also_released_as
                                ) {
                                  <span class="also-released-pill">{{
                                    'Also released as: ' +
                                      release.also_released_as
                                  }}</span>
                                }
                              </div>
                              @if (release.comments) {
                                <div
                                  class="release-comments-note text-xs text-secondary flex items-center gap-xs mt-2xs"
                                >
                                  <span>{{ release.comments }}</span>
                                </div>
                              }
                              @if (
                                !release.rom_name &&
                                !release.canonical_release_id
                              ) {
                                <div
                                  class="rom-text warning-text font-mono mb-2xs"
                                >
                                  <app-icon name="alert-triangle" [size]="14" />
                                  {{
                                    g.platform_id === 26 || g.platform_id === 27
                                      ? 'No cartridge revision exists in community catalog'
                                      : 'No dump exists in community DAT files'
                                  }}
                                </div>
                              }
                            </div>
                            <div class="disc-actions flex items-center gap-sm">
                              <button
                                class="stat-pill interactive"
                                [class.active]="!!release.backup_status"
                                [class.missing]="!release.backup_status"
                                (click)="onToggleDiscBackup(release)"
                                title="Toggle Backup Status"
                              >
                                <span class="icon"
                                  ><app-icon
                                    [name]="
                                      getMediaIcon(
                                        g.platform,
                                        release.backup_status
                                      )
                                    "
                                    [size]="14"
                                /></span>
                                <span>{{
                                  release.backup_status
                                    ? 'Backed Up'
                                    : 'No Backup'
                                }}</span>
                              </button>
                              @if (collectionService.isAdmin()) {
                                <button
                                  type="button"
                                  class="btn-danger"
                                  title="Remove this release"
                                  (click)="requestDeleteRelease(release)"
                                >
                                  <app-icon name="close" [size]="14" />
                                  <span>Remove</span>
                                </button>
                              }
                            </div>
                          </div>
                        }
                      </div>

                      @if (
                        g.shared_backup_releases &&
                        g.shared_backup_releases.length > 0
                      ) {
                        <div class="shared-backup-banner mt-md p-sm rounded-md">
                          <div class="text-xs font-semibold mb-2xs">
                            <app-icon name="link" [size]="14" /> Included in
                            Compilation / Expanded Release — Also part of:
                          </div>
                          <div class="flex flex-wrap gap-xs mt-2xs">
                            @for (
                              shared of g.shared_backup_releases;
                              track shared.id
                            ) {
                              <a
                                [routerLink]="[
                                  '/collection',
                                  'game',
                                  shared.id,
                                ]"
                                class="jump-link-pill"
                              >
                                <span class="flex items-center gap-xs"
                                  ><app-icon name="disc" [size]="12" />
                                  {{ shared.title }}</span
                                >
                                @if (shared.region) {
                                  <span class="text-2xs text-secondary"
                                    >({{ shared.region }})</span
                                  >
                                }
                                @if (shared.ownership_status === 1) {
                                  <span
                                    class="text-2xs"
                                    title="Owned in collection"
                                    class="flex items-center gap-2xs"
                                    ><app-icon name="check" [size]="12" />
                                    Owned</span
                                  >
                                }
                              </a>
                            }
                          </div>
                        </div>
                      }

                      @if (g.voucher_notes && g.voucher_notes.length > 0) {
                        <div
                          class="voucher-notice-banner mt-md flex flex-col gap-2xs"
                        >
                          <div
                            class="text-xs font-semibold flex items-center gap-xs"
                          >
                            <app-icon name="ticket" [size]="14" />
                            <span>Bundled Digital Content</span>
                          </div>
                          @for (note of g.voucher_notes; track note) {
                            <div class="text-xs text-secondary leading-normal">
                              {{ note }}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  } @else if (!g.rom_name) {
                    <div class="meta-box full-width">
                      <span class="label">Release Catalog</span>
                      <span
                        class="value rom-text warning-text flex items-center gap-xs"
                        ><app-icon name="alert-triangle" [size]="14" />
                        {{
                          g.platform_id === 26 || g.platform_id === 27
                            ? 'No cartridge revision exists in community catalog'
                            : 'No dump exists in community DAT files'
                        }}</span
                      >
                    </div>
                  }
                }
                @if (toy(); as t) {
                  <div class="meta-box">
                    <span class="label">Type</span>
                    <span class="value">{{ t.type }}</span>
                  </div>
                  @if (
                    t.line === 'Skylanders'
                      ? t.series_name
                      : t.series || t.series_name
                  ) {
                    <div class="meta-box">
                      <span class="label">Series</span>
                      <span class="value">{{
                        t.line === 'Skylanders'
                          ? t.series_name
                          : t.series || t.series_name
                      }}</span>
                    </div>
                  }
                  @if (getToySource(t); as source) {
                    <div class="meta-box full-width">
                      <span class="label">Source</span>
                      <span class="value">
                        <a
                          [href]="source.url"
                          target="_blank"
                          class="meta-link"
                          >{{ source.label }}</a
                        >
                      </span>
                    </div>
                  }
                }
              </div>
            </div>
          </div>
        </div>

        @if (game(); as g) {
          @if (upcomingReleaseInfo(); as info) {
            <section class="upcoming-watch-section animate-slide-up mb-xl">
              <div
                class="upcoming-card p-md rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-md"
              >
                <div class="upcoming-info">
                  <div class="flex items-center gap-sm flex-wrap">
                    <span
                      class="upcoming-badge-pill font-bold"
                      [class.pending-pill]="info.isPending"
                    >
                      <app-icon
                        [name]="info.isPending ? 'clock' : 'calendar'"
                        [size]="14"
                      />
                      {{
                        info.isPending ? 'PHYSICAL WATCH' : 'UPCOMING RELEASE'
                      }}
                    </span>
                    @if (info.countdownText) {
                      <span class="text-base font-bold text-on-surface">
                        {{ info.countdownText }}
                      </span>
                    }
                    @if (info.price) {
                      <span class="text-base font-semibold text-secondary">
                        {{ info.price }}
                      </span>
                    }
                    @if (info.hasStoreLink) {
                      <span class="text-sm font-semibold text-secondary">
                        available at {{ info.storeName }} ({{
                          storeRegionLabel(info.storeName)
                        }})
                      </span>
                    }
                  </div>
                  <p class="text-sm text-secondary m-0 mt-xs">
                    @if (info.isPending) {
                      Tracking boutique physical feeds (Limited Run Games, Super
                      Rare, iam8bit, etc.) for physical announcements.
                    } @else {
                      Tracked for release day updates and physical pre-order
                      availability.
                    }
                  </p>
                </div>
                @if (info.hasStoreLink) {
                  <a
                    [href]="info.retailUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn-preorder-link"
                  >
                    Pre-Order at {{ info.storeName }} ({{
                      storeRegionLabel(info.storeName)
                    }}) ↗
                  </a>
                }
              </div>
            </section>
          }

          <section class="market-section animate-slide-up mb-xl">
            <div class="market-header flex justify-between items-center mb-md">
              <h2 class="text-xl font-bold flex items-center gap-xs m-0">
                <span class="flex items-center gap-xs"
                  ><app-icon name="coins" [size]="20" /> Market Valuation &
                  Retail Deals</span
                >
              </h2>
              @if (g.retail_updated_at || g.price_updated_at) {
                <span class="text-xs text-secondary">
                  Updated: {{ g.retail_updated_at || g.price_updated_at }}
                </span>
              }
            </div>

            @if (g.retail_on_sale && g.retail_price) {
              <div
                class="deal-banner p-md rounded-lg mb-md flex flex-col md:flex-row items-start md:items-center justify-between gap-md"
              >
                <div class="deal-info">
                  <div class="flex items-center gap-sm flex-wrap">
                    <span class="deal-badge-pill font-bold">
                      <app-icon name="flame" [size]="14" />
                      {{
                        g.retail_discount_pct
                          ? g.retail_discount_pct + '% OFF'
                          : 'ON SALE'
                      }}
                    </span>
                    <span class="text-xl font-extrabold text-on-surface">
                      {{ '$' + (g.retail_price / 100).toFixed(2) }}
                    </span>
                    @if (
                      g.retail_regular_price &&
                      g.retail_regular_price > g.retail_price
                    ) {
                      <span class="text-sm line-through text-secondary">
                        Reg:
                        {{ '$' + (g.retail_regular_price / 100).toFixed(2) }}
                      </span>
                    }
                    <span class="text-sm font-semibold text-secondary">
                      at {{ g.retail_store || 'Best Buy' }}
                    </span>
                  </div>
                  @if (getDealArbitrageSavings(g); as savings) {
                    <div class="deal-arb-note text-sm font-semibold mt-xs">
                      <app-icon name="zap" [size]="16" /> Arbitrage Opportunity:
                      Brand new retail copy is
                      {{ '$' + (savings / 100).toFixed(2) }} cheaper than
                      PriceCharting CIB used value!
                    </div>
                  }
                </div>
                @if (g.retail_url) {
                  <a
                    [href]="g.retail_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="btn-retail-buy"
                  >
                    View on {{ g.retail_store || 'Best Buy' }} ↗
                  </a>
                }
              </div>
            } @else if (
              !g.retail_on_sale && g.retail_url && !upcomingReleaseInfo()
            ) {
              <div
                class="deal-banner p-md rounded-lg mb-md flex flex-col md:flex-row items-start md:items-center justify-between gap-md"
                style="background: var(--m3-surface-container-high); border-color: var(--m3-outline-variant);"
              >
                <div class="deal-info">
                  <div class="flex items-center gap-sm flex-wrap">
                    @if (g.retail_price) {
                      <span class="text-xl font-extrabold text-on-surface">
                        {{ '$' + (g.retail_price / 100).toFixed(2) }}
                      </span>
                    }
                    <span class="text-sm font-semibold text-secondary">
                      Available at {{ g.retail_store || 'Retailer' }} ({{
                        storeRegionLabel(g.retail_store)
                      }})
                    </span>
                  </div>
                </div>
                <a
                  [href]="g.retail_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-retail-buy"
                >
                  View on {{ g.retail_store || 'Store' }} ({{
                    storeRegionLabel(g.retail_store)
                  }}) ↗
                </a>
              </div>
            }

            @if (
              g.retail_price || g.price_cib || g.price_loose || g.price_new
            ) {
              <div class="pricing-grid">
                <a
                  [href]="g.retail_url || getGamePriceChartingUrl(g)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!g.retail_price || !!g.price_new"
                  [title]="
                    g.retail_url
                      ? 'View on ' + (g.retail_store || 'Retailer')
                      : 'View on PriceCharting'
                  "
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">Retail (New)</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      g.retail_price
                        ? '$' + (g.retail_price / 100).toFixed(2)
                        : g.price_new
                          ? '$' + (g.price_new / 100).toFixed(2)
                          : '—'
                    }}
                  </span>
                  <span class="tier-sub">
                    {{
                      g.retail_store
                        ? g.retail_store + ' ↗'
                        : g.price_new
                          ? 'PriceCharting New ↗'
                          : 'Not tracked'
                    }}
                  </span>
                </a>

                <a
                  [href]="getGamePriceChartingUrl(g)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!g.price_cib"
                  title="View Complete in Box (CIB) on PriceCharting"
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">Complete in Box (CIB)</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      g.price_cib ? '$' + (g.price_cib / 100).toFixed(2) : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Used ↗</span>
                </a>

                <a
                  [href]="getGamePriceChartingUrl(g)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!g.price_loose"
                  title="View Loose Price on PriceCharting"
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">Loose Cartridge/Disc</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      g.price_loose
                        ? '$' + (g.price_loose / 100).toFixed(2)
                        : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Loose ↗</span>
                </a>
              </div>
            }

            <div
              class="retail-links-bar mt-md flex flex-wrap items-center gap-sm"
            >
              <span
                class="text-xs font-bold text-secondary uppercase tracking-wider"
                >Research & Buy:</span
              >
              <a
                [href]="getGamePriceChartingUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill pricecharting"
                title="View market valuations and sales history on PriceCharting"
              >
                <app-icon name="chart" [size]="14" /> PriceCharting
              </a>
              <a
                [href]="getSmartEbayUrl(g, 'cib')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for Complete in Box (CIB) copies in Video Games"
              >
                <app-icon name="seeking" [size]="14" /> eBay (CIB / Complete)
              </a>
              <a
                [href]="getSmartEbayUrl(g, 'loose')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for Authentic Loose copies"
              >
                <app-icon name="seeking" [size]="14" /> eBay (Loose)
              </a>
              <a
                [href]="getDekuDealsUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill deku"
                title="Check Deku Deals for price history & alerts"
              >
                <app-icon name="tag" [size]="14" /> Deku Deals
              </a>
              <a
                [href]="getBestBuyUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill bestbuy"
                title="Check Best Buy"
              >
                <app-icon name="shopping-cart" [size]="14" /> Best Buy
              </a>
              <a
                [href]="getVgpUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill"
                title="Search VideoGamesPlus (VGP)"
              >
                <app-icon name="storefront" [size]="14" /> VGP
              </a>
              <a
                [href]="getPnpUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill"
                title="Search PNP Games"
              >
                <app-icon name="storefront" [size]="14" /> PNP Games
              </a>
            </div>
          </section>
        }

        @if (toy(); as t) {
          <section class="market-section animate-slide-up mb-xl">
            <div class="market-header flex justify-between items-center mb-md">
              <h2 class="text-xl font-bold flex items-center gap-xs m-0">
                <span class="flex items-center gap-xs"
                  ><app-icon name="coins" [size]="20" /> Market Valuation &
                  Pricing</span
                >
              </h2>
              @if (t.price_updated_at) {
                <span class="text-xs text-secondary">
                  Updated: {{ t.price_updated_at }}
                </span>
              }
            </div>

            @if (t.price_loose || t.price_cib || t.price_new) {
              <div class="pricing-grid">
                <a
                  [href]="getToyPriceChartingUrl(t)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!t.price_loose"
                  title="View Loose Price on PriceCharting"
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">Loose Figure</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      t.price_loose
                        ? '$' + (t.price_loose / 100).toFixed(2)
                        : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Loose ↗</span>
                </a>

                <a
                  [href]="getToyPriceChartingUrl(t)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!t.price_cib"
                  title="View Boxed Price on PriceCharting"
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">In Box (CIB)</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      t.price_cib ? '$' + (t.price_cib / 100).toFixed(2) : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Boxed ↗</span>
                </a>

                <a
                  [href]="getToyPriceChartingUrl(t)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="price-tier-card interactive"
                  [class.has-price]="!!t.price_new"
                  title="View New / Sealed Price on PriceCharting"
                >
                  <div class="flex items-center justify-between">
                    <span class="tier-label">New / Sealed</span>
                    <app-icon name="chart" [size]="12" class="opacity-70" />
                  </div>
                  <span class="tier-price">
                    {{
                      t.price_new ? '$' + (t.price_new / 100).toFixed(2) : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting New ↗</span>
                </a>
              </div>
            }

            <div
              class="retail-links-bar mt-md flex flex-wrap items-center gap-sm"
            >
              <span
                class="text-xs font-bold text-secondary uppercase tracking-wider"
                >Research & Buy:</span
              >
              <a
                [href]="getToyPriceChartingUrl(t)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill pricecharting"
                title="View on PriceCharting"
              >
                <app-icon name="chart" [size]="14" /> PriceCharting
              </a>
              <a
                [href]="getSmartEbayToyUrl(t, 'all')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for this figure"
              >
                <app-icon name="seeking" [size]="14" /> eBay (All)
              </a>
              <a
                [href]="getSmartEbayToyUrl(t, 'loose')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for authentic loose figure"
              >
                <app-icon name="seeking" [size]="14" /> eBay (Loose)
              </a>
              <a
                [href]="getSmartEbayToyUrl(t, 'new')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for sealed in box figure"
              >
                <app-icon name="seeking" [size]="14" /> eBay (Sealed/NIB)
              </a>
            </div>
          </section>
        }

        @if (type() === 'game' || type() === 'toy') {
          <section
            class="journal-section animate-slide-up mb-xl"
            data-testid="journal-section"
          >
            <div class="market-header flex justify-between items-center mb-md">
              <h2 class="text-xl font-bold flex items-center gap-xs m-0">
                <span class="flex items-center gap-xs">
                  <app-icon name="book-open" [size]="20" /> Acquisition Journal
                  & Provenance
                </span>
              </h2>
              <div class="flex items-center gap-sm">
                @if (
                  collectionService.isAdmin() &&
                  collectionService.journalRevealed() &&
                  !isEditingJournal()
                ) {
                  <button
                    type="button"
                    class="btn-journal-action"
                    (click)="openJournalEditor()"
                    data-testid="btn-edit-journal"
                  >
                    <app-icon name="edit" [size]="14" />
                    <span>{{
                      journalEntry() ? 'Edit Provenance' : 'Record Provenance'
                    }}</span>
                  </button>
                }
                <button
                  type="button"
                  class="btn-eye-toggle"
                  [class.revealed]="collectionService.journalRevealed()"
                  (click)="onToggleJournalVisibility()"
                  [attr.aria-label]="
                    collectionService.journalRevealed()
                      ? 'Mask private acquisition provenance'
                      : 'Reveal private acquisition provenance'
                  "
                  data-testid="btn-toggle-journal-eye"
                >
                  <app-icon
                    [name]="
                      collectionService.journalRevealed() ? 'eye-off' : 'eye'
                    "
                    [size]="16"
                  />
                  <span>{{
                    collectionService.journalRevealed()
                      ? 'Hide Provenance'
                      : 'Reveal Provenance'
                  }}</span>
                </button>
              </div>
            </div>

            @if (!collectionService.journalRevealed()) {
              <div
                class="pricing-grid journal-masked-grid"
                data-testid="journal-masked-state"
              >
                <div class="price-tier-card masked-card">
                  <span class="tier-label">Acquired Date</span>
                  <span class="tier-price masked-dots">••••••</span>
                  <span class="tier-sub">Private Ledger</span>
                </div>
                <div class="price-tier-card masked-card">
                  <span class="tier-label">Price Paid</span>
                  <span class="tier-price masked-dots">$••.••</span>
                  <span class="tier-sub">Cost Basis Hidden</span>
                </div>
                <div class="price-tier-card masked-card">
                  <span class="tier-label">Merchant / Source</span>
                  <span class="tier-price masked-dots">••••••••</span>
                  <span class="tier-sub">Provenance Hidden</span>
                </div>
                <div class="price-tier-card masked-card">
                  <span class="tier-label">Cost vs. Market ROI</span>
                  <span class="tier-price masked-dots">••••••</span>
                  <span class="tier-sub">Appreciation Hidden</span>
                </div>
              </div>
              <div class="journal-privacy-caption mt-xs text-xs text-secondary">
                <app-icon name="lock" [size]="12" />
                <span>
                  {{
                    collectionService.isAdmin()
                      ? 'Acquisition cost basis and provenance are masked for privacy. Click the eye icon to reveal.'
                      : 'Protected provenance record — sign in via the eye icon to view acquisition details.'
                  }}
                </span>
              </div>
            } @else if (isEditingJournal()) {
              <div
                class="journal-editor-card p-md rounded-lg border border-outline-variant bg-surface-container-high"
                data-testid="journal-editor-form"
              >
                <div class="journal-form-grid">
                  <div class="form-field">
                    <label class="field-label" for="journal-date-precision"
                      >Date Precision</label
                    >
                    <select
                      id="journal-date-precision"
                      class="field-input"
                      [(ngModel)]="journalForm.datePrecision"
                      (ngModelChange)="onDatePrecisionChange($event)"
                    >
                      <option value="exact">Exact Date (YYYY-MM-DD)</option>
                      <option value="month">
                        Month & Year (Around Month YYYY)
                      </option>
                      <option value="year">Year Only (Around YYYY)</option>
                      <option value="unknown">Unrecorded / Unknown</option>
                    </select>
                  </div>

                  @if (journalForm.datePrecision === 'exact') {
                    <div class="form-field">
                      <label class="field-label" for="journal-exact-date"
                        >Purchase Date</label
                      >
                      <input
                        id="journal-exact-date"
                        type="date"
                        class="field-input"
                        [(ngModel)]="journalForm.purchaseDate"
                      />
                      <label class="approx-checkbox-label mt-2xs">
                        <input
                          type="checkbox"
                          [(ngModel)]="journalForm.isApproximateDate"
                        />
                        <span>Approximate date (display as "Around ...")</span>
                      </label>
                    </div>
                  } @else if (journalForm.datePrecision === 'month') {
                    <div class="form-field">
                      <label class="field-label" for="journal-month-date"
                        >Approximate Month & Year</label
                      >
                      <input
                        id="journal-month-date"
                        type="month"
                        class="field-input"
                        [(ngModel)]="journalForm.purchaseDate"
                      />
                      <span class="field-hint"
                        >Displays as "Around Month YYYY"</span
                      >
                    </div>
                  } @else if (journalForm.datePrecision === 'year') {
                    <div class="form-field">
                      <label class="field-label" for="journal-year-date"
                        >Approximate Year</label
                      >
                      <input
                        id="journal-year-date"
                        type="number"
                        min="1970"
                        max="2035"
                        placeholder="e.g. 2013"
                        class="field-input"
                        [(ngModel)]="journalForm.purchaseDate"
                      />
                      <span class="field-hint">Displays as "Around YYYY"</span>
                    </div>
                  }

                  <div class="form-field">
                    <label class="field-label" for="journal-price-paid"
                      >Price Paid (USD)</label
                    >
                    <input
                      id="journal-price-paid"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 29.99 or 0.00"
                      class="field-input"
                      [(ngModel)]="journalForm.pricePaid"
                    />
                    <span class="field-hint"
                      >Use 0.00 for gifts, free pack-ins, or point
                      redemptions</span
                    >
                  </div>

                  <div class="form-field">
                    <label class="field-label" for="journal-merchant"
                      >Merchant / Store</label
                    >
                    <input
                      id="journal-merchant"
                      type="text"
                      list="standard-merchants-datalist"
                      placeholder="e.g. eBay, Best Buy, Amazon..."
                      class="field-input"
                      [(ngModel)]="journalForm.merchant"
                    />
                    <datalist id="standard-merchants-datalist">
                      @for (m of standardMerchants; track m) {
                        <option [value]="m"></option>
                      }
                    </datalist>
                  </div>

                  <div class="form-field">
                    <label class="field-label" for="journal-gifted-by"
                      >Gifted By (Optional)</label
                    >
                    <input
                      id="journal-gifted-by"
                      type="text"
                      placeholder="e.g. Parents, Friend..."
                      class="field-input"
                      [(ngModel)]="journalForm.giftedBy"
                    />
                  </div>

                  <div class="form-field">
                    <label class="field-label" for="journal-receipt-url"
                      >Source Receipt Link (Optional)</label
                    >
                    <input
                      id="journal-receipt-url"
                      type="url"
                      placeholder="https://mail.google.com/mail/u/0/#all/... or order URL"
                      class="field-input"
                      [(ngModel)]="journalForm.receiptUrl"
                    />
                  </div>

                  <div class="form-field full-width-field">
                    <label class="field-label" for="journal-notes"
                      >Provenance & Currency Notes (Optional)</label
                    >
                    <textarea
                      id="journal-notes"
                      rows="2"
                      placeholder="e.g. Purchased in CAD ($44.99 CAD), pack-in bundle details, or multi-item lot split..."
                      class="field-input"
                      [(ngModel)]="journalForm.notes"
                    ></textarea>
                  </div>
                </div>

                @if (journalSaveError()) {
                  <div class="journal-error-banner mt-sm text-xs">
                    {{ journalSaveError() }}
                  </div>
                }

                <div
                  class="journal-editor-actions flex justify-between items-center mt-md"
                >
                  <div>
                    @if (journalEntry()) {
                      <button
                        type="button"
                        class="btn-journal-delete"
                        [disabled]="journalSaving()"
                        (click)="onDeleteJournalEntry()"
                      >
                        Delete Record
                      </button>
                    }
                  </div>
                  <div class="flex gap-sm">
                    <button
                      type="button"
                      class="btn-journal-cancel"
                      [disabled]="journalSaving()"
                      (click)="cancelJournalEdit()"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="btn-journal-save"
                      [disabled]="journalSaving()"
                      (click)="onSaveJournalEntry()"
                      data-testid="btn-save-journal"
                    >
                      {{ journalSaving() ? 'Saving...' : 'Save Provenance' }}
                    </button>
                  </div>
                </div>
              </div>
            } @else if (journalEntry(); as entry) {
              <div
                class="pricing-grid journal-revealed-grid"
                data-testid="journal-revealed-state"
              >
                <div class="price-tier-card has-price">
                  <span class="tier-label">Acquired Date</span>
                  <span
                    class="tier-price text-lg"
                    data-testid="journal-date-display"
                  >
                    {{
                      formatAcquisitionDate(
                        entry.purchase_date,
                        entry.is_approximate_date
                      )
                    }}
                  </span>
                  <span class="tier-sub">
                    {{
                      isApproximateEntry(entry)
                        ? 'Approximate Date'
                        : entry.purchase_date
                          ? 'Verified Purchase Date'
                          : 'Date Unrecorded'
                    }}
                  </span>
                </div>

                <div class="price-tier-card has-price">
                  <span class="tier-label">Price Paid</span>
                  <span class="tier-price" data-testid="journal-price-display">
                    {{
                      entry.price_paid !== null &&
                      entry.price_paid !== undefined
                        ? '$' + entry.price_paid.toFixed(2)
                        : 'Unrecorded'
                    }}
                  </span>
                  <span class="tier-sub flex items-center gap-2xs">
                    @if (entry.gifted_by) {
                      <app-icon name="gift" [size]="12" />
                      <span>Gifted by {{ entry.gifted_by }}</span>
                    } @else if (entry.price_paid === 0) {
                      <span>Free / Pack-in / Redeemed</span>
                    } @else {
                      <span>Actual Cost Basis (USD)</span>
                    }
                  </span>
                </div>

                <div class="price-tier-card has-price">
                  <span class="tier-label">Merchant / Source</span>
                  <span
                    class="tier-price text-lg"
                    data-testid="journal-merchant-display"
                  >
                    {{
                      entry.merchant ||
                        (entry.gifted_by
                          ? 'Gift (' + entry.gifted_by + ')'
                          : 'Unrecorded')
                    }}
                  </span>
                  <span class="tier-sub">
                    @if (entry.receipt_url) {
                      <a
                        [href]="entry.receipt_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="receipt-deeplink"
                        data-testid="journal-receipt-link"
                      >
                        <app-icon name="mail" [size]="12" />
                        <span>View Source Receipt ↗</span>
                      </a>
                    } @else {
                      <span>Acquisition Channel</span>
                    }
                  </span>
                </div>

                <div class="price-tier-card has-price">
                  <span class="tier-label">Cost vs. Market ROI</span>
                  @if (journalRoi(); as roi) {
                    <span
                      class="tier-price"
                      [class.roi-positive]="roi.deltaDollars >= 0"
                      [class.roi-negative]="roi.deltaDollars < 0"
                      data-testid="journal-roi-display"
                    >
                      {{
                        (roi.deltaDollars >= 0 ? '+$' : '-$') +
                          Math.abs(roi.deltaDollars).toFixed(2)
                      }}
                    </span>
                    <span class="tier-sub">
                      {{ roi.label }}
                    </span>
                  } @else {
                    <span class="tier-price">—</span>
                    <span class="tier-sub">Market comparison unavailable</span>
                  }
                </div>
              </div>

              @if (entry.notes) {
                <div
                  class="journal-notes-callout mt-md p-sm rounded-md"
                  data-testid="journal-notes-display"
                >
                  <div
                    class="text-xs font-bold uppercase tracking-wider text-secondary mb-2xs"
                  >
                    Provenance & Acquisition Notes
                  </div>
                  <div class="text-sm text-on-surface leading-normal">
                    {{ entry.notes }}
                  </div>
                </div>
              }
            } @else {
              <div
                class="journal-empty-card p-md rounded-lg border border-outline-variant bg-surface-container-low flex flex-col md:flex-row items-start md:items-center justify-between gap-md"
                data-testid="journal-empty-state"
              >
                <div>
                  <div class="font-semibold text-sm">
                    No acquisition provenance recorded for this item yet.
                  </div>
                  <div class="text-xs text-secondary mt-2xs">
                    Record the purchase date, price paid, merchant, and source
                    receipt link to track cost basis and appreciation.
                  </div>
                </div>
                @if (collectionService.isAdmin()) {
                  <button
                    type="button"
                    class="btn-journal-action"
                    (click)="openJournalEditor()"
                  >
                    <app-icon name="edit" [size]="14" />
                    <span>Record Provenance</span>
                  </button>
                }
              </div>
            }
          </section>
        }

        @if (game(); as g) {
          @if (g.summary) {
            <section class="narrative-section animate-slide-up">
              <div class="summary-text-airy">
                {{ g.summary }}
              </div>
            </section>
          }
          @if (collectionService.isAdmin()) {
            <section class="mt-lg flex justify-end">
              <button
                type="button"
                class="btn-danger"
                data-testid="delete-game-btn"
                (click)="requestDeleteGame(g)"
              >
                <app-icon name="close" [size]="14" />
                <span>Delete Game</span>
              </button>
            </section>
          }
        }

        @if (pendingDelete(); as pd) {
          <div
            class="delete-modal-backdrop"
            data-testid="delete-modal"
            (click)="cancelDelete()"
          >
            <div class="delete-modal" (click)="$event.stopPropagation()">
              <h3 class="font-bold mb-sm">
                {{ pd.kind === 'game' ? 'Delete game?' : 'Remove release?' }}
              </h3>
              <p class="text-sm text-secondary mb-md">
                @if (pd.kind === 'game') {
                  Remove "{{ pd.label }}" and all of its releases and
                  acquisition records from your collection? This cannot be
                  undone.
                } @else {
                  Remove release "{{ pd.label }}"? The game itself will remain.
                  This cannot be undone.
                }
              </p>
              @if (deleteError(); as de) {
                <p class="text-sm mb-sm" style="color: var(--m3-error)">
                  {{ de }}
                </p>
              }
              <div class="flex justify-end gap-sm">
                <button
                  type="button"
                  class="btn-journal-action"
                  [disabled]="deleting()"
                  (click)="cancelDelete()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-danger"
                  data-testid="confirm-delete-btn"
                  [disabled]="deleting()"
                  (click)="confirmDelete()"
                >
                  {{ deleting() ? 'Deleting…' : 'Delete' }}
                </button>
              </div>
            </div>
          </div>
        }

        @if (toy(); as t) {
          @if (t.details) {
            <section class="narrative-section animate-slide-up">
              <div class="summary-text-airy" style="white-space: pre-line;">
                {{ t.details }}
              </div>
            </section>
          }
        }
      </div>
    } @else if (errorMessage(); as error) {
      <div class="container pb-xl animate-expressive">
        <nav class="details-nav mb-lg flex justify-between items-center">
          <a
            [href]="'/collection/' + (type() ? type() + 's' : 'games')"
            (click)="onBack($event)"
            class="back-link flex items-center gap-sm"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Collection
          </a>
        </nav>
        <div class="loading-state error-state">
          <div class="error-icon">
            <app-icon name="alert-triangle" [size]="40" />
          </div>
          <p class="error-message">{{ error }}</p>
          <a
            [href]="'/collection/' + (type() ? type() + 's' : 'games')"
            (click)="onBack($event)"
            class="retry-btn"
          >
            Return to Collection
          </a>
        </div>
      </div>
    } @else {
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Retrieving metadata...</p>
      </div>
    }
  `,
  styles: [
    `
      .pb-xl {
        padding-bottom: var(--spacing-64);
      }
      .details-nav {
        margin-top: var(--spacing-16);
        margin-bottom: var(--spacing-32);
        flex-wrap: wrap;
        gap: var(--spacing-24);
      }

      .back-link {
        font-family: var(--font-body);
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        padding: var(--spacing-8) var(--spacing-16);
        border-radius: var(--radius-full);
      }

      .back-link:hover {
        color: var(--m3-primary);
        background: var(--m3-surface-container-high);
      }

      .quick-stats {
        flex-wrap: wrap;
        gap: var(--spacing-12);
      }

      .stat-pill {
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
        padding: 0.5rem 1rem;
        border-radius: var(--radius-full);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        font-family: var(--font-body);
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        transition: all 0.2s;
      }

      .stat-pill.active {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        border-color: transparent;
      }

      .stat-pill.missing {
        color: #fbbf24;
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.08);
      }

      .stat-pill.active.seeking {
        background: var(--m3-tertiary-container);
        color: var(--m3-on-tertiary-container);
      }

      .stat-pill.active.ordered {
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
      }

      .stat-pill.active.igdb {
        background: var(--m3-secondary-container);
        color: var(--m3-on-secondary-container);
        border-color: transparent;
        text-decoration: none;
      }

      .stat-pill.active.physical {
        background: var(--m3-primary-container);
        color: var(--m3-on-primary-container);
        border-color: transparent;
        text-decoration: none;
      }

      .stat-pill.active.physical-release,
      .stat-pill.active.extracted-rom,
      .disc-actions .stat-pill:not(.interactive) {
        border-radius: var(--radius-tag, 6px);
        padding: 0.35rem 0.75rem;
        font-size: 0.8125rem;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface-variant);
        border: 1px solid var(--m3-outline-variant);
      }

      .stat-pill.active.upcoming {
        background: rgba(59, 130, 246, 0.15);
        color: #60a5fa;
        border: 1px solid rgba(59, 130, 246, 0.4);
      }

      .stat-pill.active.pending {
        background: rgba(168, 85, 247, 0.15);
        color: #c084fc;
        border: 1px solid rgba(168, 85, 247, 0.4);
      }

      .stat-pill.interactive {
        cursor: pointer;
      }

      .stat-pill.interactive:hover {
        transform: scale(1.05);
        filter: brightness(1.1);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        border-color: var(--m3-primary);
      }

      .hero-section {
        margin-bottom: var(--spacing-48);
      }

      .hero-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--spacing-32);
        align-items: flex-start;
      }

      @media (min-width: 1024px) {
        .hero-grid {
          grid-template-columns: 320px 1fr;
          gap: var(--spacing-64);
          align-items: flex-start;
        }
      }

      .art-frame {
        aspect-ratio: 3/4;
        border-radius: var(--radius-lg);
        overflow: hidden;
        max-width: 320px;
        margin: 0 auto;
        background: radial-gradient(
          circle at center,
          var(--m3-surface-container-highest),
          var(--m3-surface-container-low)
        );
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        position: relative;
      }

      .art-frame.toy-frame {
        padding: 2rem;
      }

      .toy-detail-art {
        width: 100%;
        height: 100%;
        object-fit: contain !important;
        filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.3));
      }

      @media (min-width: 1024px) {
        .art-frame {
          margin: 0;
        }
      }

      .region-overlay {
        position: absolute;
        top: var(--spacing-12);
        right: var(--spacing-12);
        padding: 0.25rem 0.5rem;
        background: rgba(0, 0, 0, 0.75);
        border-radius: var(--radius-tag, 6px);
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 700;
        color: #fff;
        z-index: 10;
      }

      .art-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .item-title {
        font-size: 3.5rem;
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: -0.02em;
        margin-bottom: var(--spacing-12);
      }

      @media (max-width: 768px) {
        .item-title {
          font-size: 2.25rem;
        }
        .item-series {
          font-size: 1.125rem;
        }
      }

      .item-series {
        font-size: 1.5rem;
        color: var(--m3-on-surface-variant);
        margin-bottom: var(--spacing-8);
      }

      .item-release-banner {
        font-family: var(--font-body);
        font-size: 1.125rem;
        font-weight: 500;
        color: var(--m3-primary);
        margin-bottom: var(--spacing-24);
        letter-spacing: 0.01em;
      }

      .genre-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-8);
        margin-bottom: var(--spacing-32);
      }

      .genre-chip {
        padding: 0.35rem 0.75rem;
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-tag, 6px);
        font-family: var(--font-body);
        font-size: 0.8125rem;
        font-weight: 500;
        color: var(--m3-on-surface-variant);
      }

      .metadata-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: var(--spacing-24);
        padding-top: var(--spacing-32);
        border-top: 1px solid var(--m3-outline-variant);
      }

      .meta-box .label {
        display: block;
        font-family: var(--font-body);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--m3-on-surface-variant);
        margin-bottom: var(--spacing-8);
        font-weight: 700;
      }

      .meta-box .value {
        font-family: var(--font-body);
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--m3-on-surface);
      }

      .meta-box.full-width {
        grid-column: 1 / -1;
      }

      .meta-link {
        cursor: pointer;
        color: var(--m3-primary);
        transition: opacity 0.2s;
      }
      .meta-link:hover {
        opacity: 0.8;
        text-decoration: underline;
      }

      .mini-logo {
        height: 1.25rem;
        width: auto;
        object-fit: contain;
      }

      .narrative-section {
        margin-top: var(--spacing-32);
        border-top: 1px solid var(--m3-outline-variant);
        padding-top: var(--spacing-32);
      }

      .summary-text-airy {
        font-size: 1.125rem;
        line-height: 1.8;
        color: var(--m3-on-surface-variant);
        max-width: 800px;
        white-space: pre-wrap;
      }

      .loading-state {
        min-height: 60vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-16);
        color: var(--m3-on-surface-variant);
      }

      .error-state {
        text-align: center;
      }
      .error-icon {
        font-size: 2.5rem;
      }
      .error-message {
        font-size: 1.125rem;
        font-weight: 500;
        color: var(--m3-error, #cf6679);
        margin-bottom: var(--spacing-8);
      }
      .retry-btn {
        display: inline-flex;
        align-items: center;
        padding: 0.5rem 1.25rem;
        border-radius: var(--radius-full);
        background: var(--m3-surface-container-high);
        color: var(--m3-on-surface);
        text-decoration: none;
        font-family: var(--font-body);
        font-weight: 600;
        border: 1px solid var(--m3-outline-variant);
        transition: background 0.2s;
      }
      .retry-btn:hover {
        background: var(--m3-surface-container-highest);
      }

      .variant-badge {
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--m3-on-secondary-container);
        background: var(--m3-secondary-container);
        padding: 0.15rem 0.5rem;
        border-radius: var(--radius-tag, 6px);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        display: inline-block;
      }
      .variant-badge.big {
        font-size: 0.8125rem;
        padding: 0.2rem 0.65rem;
        border-radius: var(--radius-tag, 6px);
      }
      .variant-badge.serial-badge {
        font-family: var(--font-mono, monospace);
        font-size: 0.72rem;
        background: var(--m3-surface-container-highest);
        color: var(--m3-on-surface);
        border: 1px solid var(--m3-outline-variant);
        text-transform: none;
      }
      .variant-badge.region-badge {
        font-size: 0.72rem;
        background: var(--m3-surface-variant, #2a2e39);
        color: var(--m3-on-surface-variant, #c4c7c5);
        border: 1px solid var(--m3-outline-variant, #444746);
      }
      .release-comments-note {
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
      }
      .also-released-label {
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        letter-spacing: 0.02em;
      }
      .also-released-pill {
        font-family: var(--font-body);
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        background: var(--m3-surface-container-highest);
        border: 1px dashed var(--m3-outline-variant);
        padding: 0.12rem 0.48rem;
        border-radius: var(--radius-tag, 6px);
        letter-spacing: 0.02em;
        display: inline-block;
      }
      .rom-text {
        font-family: var(--font-mono);
        font-size: 0.95rem;
        word-break: break-all;
        background: var(--m3-surface-container-high);
        padding: 0.5rem;
        border-radius: var(--radius-tag, 6px);
        border: 1px solid var(--m3-outline-variant);
      }
      .rom-text.warning-text {
        color: var(--m3-primary);
        border: 1px dashed var(--m3-outline);
        background: var(--m3-surface-container-highest);
        opacity: 0.85;
      }
      .crc-text {
        font-family: var(--font-mono);
        font-size: 0.95rem;
        color: var(--m3-primary);
      }
      .discs-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-16);
        margin-top: var(--spacing-8);
      }
      .disc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-16);
        padding: var(--spacing-12) var(--spacing-16);
        border-radius: var(--radius-sm);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
      }
      .disc-info {
        flex: 1;
        min-width: 0;
      }
      .disc-info .rom-text {
        margin: 0;
        border: none;
        background: transparent;
        padding: 0;
      }
      .disc-actions {
        display: flex;
        align-items: center;
        gap: var(--spacing-12);
      }
      .companion-disc-note {
        font-family: var(--font-body);
        color: var(--m3-on-surface-variant);
      }
      .shared-backup-banner {
        background: var(--m3-surface-container-highest);
        border: 1px dashed var(--m3-outline);
        border-radius: var(--radius-sm);
        padding: var(--spacing-12) var(--spacing-16);
      }
      .voucher-notice-banner {
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-sm);
        padding: var(--spacing-12) var(--spacing-16);
      }
      .upcoming-watch-section {
        margin-top: var(--spacing-32);
      }
      .upcoming-card {
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.12) 0%,
          rgba(168, 85, 247, 0.08) 100%
        );
        border: 1px solid rgba(59, 130, 246, 0.35);
        border-radius: var(--radius-md);
        padding: var(--spacing-16);
      }
      .upcoming-badge-pill {
        font-family: var(--font-body);
        background: #2563eb;
        color: #ffffff;
        padding: 0.2rem 0.6rem;
        border-radius: var(--radius-tag, 6px);
        font-size: 0.8125rem;
        letter-spacing: 0.02em;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
      }
      .upcoming-badge-pill.pending-pill {
        background: #9333ea;
      }
      .btn-preorder-link {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.5rem 1.25rem;
        background: #2563eb;
        color: #ffffff;
        font-family: var(--font-body);
        font-weight: 700;
        font-size: 0.875rem;
        border-radius: var(--radius-full);
        text-decoration: none;
        white-space: nowrap;
        transition:
          opacity 0.2s,
          transform 0.2s;
      }
      .btn-preorder-link:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .market-section {
        margin-top: var(--spacing-32);
        border-top: 1px solid var(--m3-outline-variant);
        padding-top: var(--spacing-32);
      }
      .deal-banner {
        background: linear-gradient(
          135deg,
          rgba(239, 68, 68, 0.12) 0%,
          rgba(249, 115, 22, 0.08) 100%
        );
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: var(--radius-md);
        padding: var(--spacing-16);
      }
      .deal-badge-pill {
        font-family: var(--font-body);
        background: #dc2626;
        color: #ffffff;
        padding: 0.2rem 0.6rem;
        border-radius: var(--radius-tag, 6px);
        font-size: 0.8125rem;
        letter-spacing: 0.02em;
      }
      .deal-arb-note {
        color: #f59e0b;
      }
      .btn-retail-buy {
        display: inline-flex;
        align-items: center;
        padding: 0.5rem 1.25rem;
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        font-family: var(--font-body);
        font-weight: 700;
        font-size: 0.875rem;
        border-radius: var(--radius-full);
        text-decoration: none;
        white-space: nowrap;
        transition:
          opacity 0.2s,
          transform 0.2s;
      }
      .btn-retail-buy:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }
      .pricing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: var(--spacing-16);
      }
      .price-tier-card {
        padding: var(--spacing-16);
        border-radius: var(--radius-md);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4);
        text-decoration: none;
        color: inherit;
        transition:
          transform 0.2s,
          border-color 0.2s,
          background 0.2s;
      }
      .price-tier-card.interactive {
        cursor: pointer;
      }
      .price-tier-card.interactive:hover {
        background: var(--m3-surface-container-highest);
        border-color: var(--m3-primary);
        transform: translateY(-2px);
      }
      .price-tier-card.has-price {
        border-color: var(--m3-outline);
      }
      .tier-label {
        font-family: var(--font-body);
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--m3-on-surface-variant);
        letter-spacing: 0.05em;
      }
      .tier-price {
        font-family: var(--font-body);
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--m3-on-surface);
      }
      .tier-sub {
        font-family: var(--font-body);
        font-size: 0.75rem;
        color: var(--m3-secondary);
      }
      .retail-links-bar {
        display: flex;
        align-items: center;
        gap: var(--spacing-8);
        flex-wrap: wrap;
      }
      .jump-link-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.4rem 0.85rem;
        border-radius: var(--radius-full);
        font-family: var(--font-body);
        font-size: 0.8125rem;
        font-weight: 600;
        text-decoration: none;
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        color: var(--m3-on-surface);
        transition: all 0.2s;
      }
      .jump-link-pill:hover {
        background: var(--m3-surface-container-highest);
        border-color: var(--m3-primary);
        transform: translateY(-1px);
      }
      .jump-link-pill.pricecharting:hover {
        border-color: #3b82f6;
        color: #60a5fa;
      }
      .jump-link-pill.ebay:hover {
        border-color: #0064d2;
        color: #38bdf8;
      }
      .jump-link-pill.deku:hover {
        border-color: #10b981;
        color: #34d399;
      }
      .jump-link-pill.bestbuy:hover {
        border-color: #facc15;
        color: #fde047;
      }

      /* Acquisition Journal & Provenance Styles */
      .journal-masked-grid,
      .journal-revealed-grid {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }
      .masked-card {
        opacity: 0.85;
      }
      .masked-dots {
        letter-spacing: 0.14em;
        color: var(--m3-on-surface-variant);
        user-select: none;
      }
      .btn-eye-toggle,
      .btn-journal-action {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.85rem;
        border-radius: var(--radius-full);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        color: var(--m3-on-surface);
        font-family: var(--font-body);
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-eye-toggle:hover,
      .btn-journal-action:hover {
        border-color: var(--m3-primary);
        background: var(--m3-surface-container-highest);
      }
      .btn-eye-toggle.revealed {
        background: var(--m3-secondary-container);
        color: var(--m3-on-secondary-container);
        border-color: transparent;
      }
      .btn-danger {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.85rem;
        border-radius: var(--radius-full);
        background: transparent;
        border: 1px solid var(--m3-error);
        color: var(--m3-error);
        font-family: var(--font-body);
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-danger:hover:not(:disabled) {
        background: var(--m3-error);
        color: var(--m3-on-error);
      }
      .btn-danger:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .delete-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.55);
      }
      .delete-modal {
        max-width: 26rem;
        width: calc(100% - 2rem);
        padding: 1.25rem;
        border-radius: var(--radius-lg, 1rem);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        color: var(--m3-on-surface);
      }
      .journal-privacy-caption {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-top: 0.5rem;
      }
      .roi-positive {
        color: #34d399 !important;
      }
      .roi-negative {
        color: #f87171 !important;
      }
      .receipt-deeplink {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        color: var(--m3-primary);
        font-weight: 600;
        text-decoration: none;
      }
      .receipt-deeplink:hover {
        text-decoration: underline;
      }
      .journal-notes-callout {
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        border-left: 3px solid var(--m3-primary);
      }
      .journal-form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: var(--spacing-16);
      }
      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .form-field.full-width-field {
        grid-column: 1 / -1;
      }
      .field-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--m3-on-surface-variant);
      }
      .field-input {
        padding: 0.55rem 0.75rem;
        border-radius: var(--radius-md);
        border: 1px solid var(--m3-outline-variant);
        background: var(--m3-surface-container-lowest, #0e0e11);
        color: var(--m3-on-surface);
        font-family: var(--font-body);
        font-size: 0.875rem;
      }
      .field-input:focus {
        outline: none;
        border-color: var(--m3-primary);
      }
      .field-hint {
        font-size: 0.7rem;
        color: var(--m3-on-surface-variant);
      }
      .approx-checkbox-label {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.75rem;
        color: var(--m3-on-surface-variant);
        cursor: pointer;
      }
      .journal-error-banner {
        padding: 0.5rem 0.75rem;
        border-radius: var(--radius-sm);
        background: rgba(239, 68, 68, 0.15);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.35);
      }
      .btn-journal-save {
        padding: 0.5rem 1rem;
        border-radius: var(--radius-full);
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        border: none;
        font-weight: 700;
        font-size: 0.8125rem;
        cursor: pointer;
      }
      .btn-journal-cancel {
        padding: 0.5rem 1rem;
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--m3-on-surface-variant);
        border: 1px solid var(--m3-outline-variant);
        font-weight: 600;
        font-size: 0.8125rem;
        cursor: pointer;
      }
      .btn-journal-delete {
        padding: 0.5rem 0.85rem;
        border-radius: var(--radius-full);
        background: rgba(239, 68, 68, 0.12);
        color: #f87171;
        border: 1px solid rgba(239, 68, 68, 0.3);
        font-weight: 600;
        font-size: 0.8125rem;
        cursor: pointer;
      }
    `,
  ],
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public collectionService = inject(CollectionService);
  private routeReuseStrategy = inject(RouteReuseStrategy, { optional: true });
  public navigationHistory = inject(NavigationHistoryService);
  public readonly Math = Math;
  public readonly standardMerchants = STANDARD_MERCHANTS;

  public journalRefreshTrigger = signal<number>(0);

  /** Pending game/release deletion awaiting user confirmation. */
  public pendingDelete = signal<{
    kind: 'game' | 'release';
    id: string;
    label: string;
  } | null>(null);
  public deleting = signal<boolean>(false);
  public deleteError = signal<string | null>(null);
  public isEditingJournal = signal<boolean>(false);
  public journalSaving = signal<boolean>(false);
  public journalSaveError = signal<string | null>(null);

  public journalForm: {
    datePrecision: 'exact' | 'month' | 'year' | 'unknown';
    purchaseDate: string;
    isApproximateDate: boolean;
    pricePaid: string | number;
    merchant: string;
    giftedBy: string;
    receiptUrl: string;
    notes: string;
  } = {
    datePrecision: 'exact',
    purchaseDate: '',
    isApproximateDate: false,
    pricePaid: '',
    merchant: '',
    giftedBy: '',
    receiptUrl: '',
    notes: '',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    this.route.paramMap.subscribe(() => {
      this.isEditingJournal.set(false);
      this.journalSaveError.set(null);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
    });
  }

  onBack(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    const tab = this.type() === 'toy' ? 'toys' : 'games';
    this.navigationHistory.back(['/collection', tab]);
  }

  /** The current item type ('game', 'toy', or 'platform') derived from the route */
  public type = toSignal(
    this.route.paramMap.pipe(switchMap((p) => [p.get('type') || ''])),
    {
      initialValue: '',
    },
  );

  /** Holds any error message encountered during metadata retrieval */
  public errorMessage = signal<string | null>(null);

  /**
   * Reactive signal containing the full metadata for the current item.
   * Dynamically fetches data from the CollectionService based on the route parameters.
   */
  public item = toSignal(
    combineLatest([
      this.route.paramMap,
      toObservable(this.collectionService.refreshTrigger),
    ]).pipe(
      switchMap(([params, _]) => {
        this.errorMessage.set(null);
        const type = params.get('type') || '';
        const id = params.get('id');
        if (!id) {
          this.errorMessage.set('Item identifier was not provided.');
          return of(null);
        }

        let fetch$: Observable<Game | Toy | Platform>;
        switch (type) {
          case 'game':
            fetch$ = this.collectionService.getGameById(id);
            break;
          case 'toy':
            fetch$ = this.collectionService.getToyById(id);
            break;
          case 'platform':
            fetch$ = this.collectionService.getPlatformById(Number(id));
            break;
          default:
            this.errorMessage.set(`Unknown item type: ${type}`);
            return of(null);
        }

        return fetch$.pipe(
          catchError((err) => {
            console.error(
              '[ItemDetailComponent] Failed to load item metadata:',
              err,
            );
            this.errorMessage.set(
              'Unable to retrieve item metadata. Please try again later.',
            );
            return of(null);
          }),
        );
      }),
    ),
  );

  /** --- Type-Safe Accessors for Computed Metadata --- */
  public game = computed(() =>
    this.type() === 'game' ? (this.item() as Game) : null,
  );
  public toy = computed(() =>
    this.type() === 'toy' ? (this.item() as Toy) : null,
  );
  public platform = computed(() =>
    this.type() === 'platform' ? (this.item() as Platform) : null,
  );

  /**
   * Reactive signal fetching the acquisition journal entry for the current game or toy.
   */
  public journalEntry = toSignal(
    combineLatest([
      this.route.paramMap,
      toObservable(this.collectionService.isAdmin),
      toObservable(this.journalRefreshTrigger),
    ]).pipe(
      switchMap(([params, isAdmin]) => {
        const type = params.get('type') || '';
        const id = params.get('id');
        if (!isAdmin || !id || (type !== 'game' && type !== 'toy')) {
          return of(null);
        }
        return this.collectionService
          .getJournalEntry(type as 'game' | 'toy', id)
          .pipe(
            switchMap((res) => of(res.entry)),
            catchError(() => of(null)),
          );
      }),
    ),
    { initialValue: null },
  );

  /**
   * Computes Cost vs. Market ROI when an item has both a recorded price_paid and market valuation.
   */
  public journalRoi = computed(() => {
    const entry = this.journalEntry();
    if (!entry || entry.price_paid === null || entry.price_paid === undefined) {
      return null;
    }

    const g = this.game();
    const t = this.toy();
    const marketCents =
      g?.price_cib ||
      g?.price_loose ||
      g?.price_new ||
      t?.price_cib ||
      t?.price_loose ||
      t?.price_new ||
      null;

    if (!marketCents || marketCents <= 0) {
      return null;
    }

    const marketDollars = marketCents / 100;
    const paidDollars = Number(entry.price_paid);
    const deltaDollars = Math.round((marketDollars - paidDollars) * 100) / 100;

    let label: string;
    if (paidDollars === 0) {
      label = `vs. $${marketDollars.toFixed(2)} market value (Free acquisition)`;
    } else {
      const pct = Math.round(
        ((marketDollars - paidDollars) / paidDollars) * 100,
      );
      const sign = pct >= 0 ? '+' : '';
      label = `${sign}${pct}% vs. $${marketDollars.toFixed(2)} market value`;
    }

    return {
      deltaDollars,
      marketDollars,
      paidDollars,
      label,
    };
  });

  formatAcquisitionDate(
    dateStr?: string | null,
    isApproximate?: number | boolean | null,
  ): string {
    return formatJournalDate(dateStr, isApproximate);
  }

  isApproximateEntry(entry: JournalEntry): boolean {
    if (entry.is_approximate_date) return true;
    const d = (entry.purchase_date || '').trim();
    return /^\d{4}(-\d{2})?$/.test(d);
  }

  onToggleJournalVisibility(): void {
    this.collectionService.toggleJournalVisibility();
  }

  openJournalEditor(): void {
    const entry = this.journalEntry();
    this.journalSaveError.set(null);

    if (entry) {
      const rawDate = (entry.purchase_date || '').trim();
      let precision: 'exact' | 'month' | 'year' | 'unknown';
      if (!rawDate) {
        precision = 'unknown';
      } else if (/^\d{4}$/.test(rawDate)) {
        precision = 'year';
      } else if (/^\d{4}-\d{2}$/.test(rawDate)) {
        precision = 'month';
      } else {
        precision = 'exact';
      }

      this.journalForm = {
        datePrecision: precision,
        purchaseDate: rawDate,
        isApproximateDate: Boolean(entry.is_approximate_date),
        pricePaid:
          entry.price_paid !== null && entry.price_paid !== undefined
            ? entry.price_paid
            : '',
        merchant: entry.merchant || '',
        giftedBy: entry.gifted_by || '',
        receiptUrl: entry.receipt_url || '',
        notes: entry.notes || '',
      };
    } else {
      this.journalForm = {
        datePrecision: 'exact',
        purchaseDate: '',
        isApproximateDate: false,
        pricePaid: '',
        merchant: '',
        giftedBy: '',
        receiptUrl: '',
        notes: '',
      };
    }

    this.isEditingJournal.set(true);
  }

  onDatePrecisionChange(
    precision: 'exact' | 'month' | 'year' | 'unknown',
  ): void {
    if (precision === 'unknown') {
      this.journalForm.purchaseDate = '';
      this.journalForm.isApproximateDate = false;
    } else if (precision === 'year') {
      const match = String(this.journalForm.purchaseDate || '').match(/^\d{4}/);
      this.journalForm.purchaseDate = match ? match[0] : '';
      this.journalForm.isApproximateDate = true;
    } else if (precision === 'month') {
      const match = String(this.journalForm.purchaseDate || '').match(
        /^\d{4}-\d{2}/,
      );
      this.journalForm.purchaseDate = match ? match[0] : '';
      this.journalForm.isApproximateDate = true;
    }
  }

  cancelJournalEdit(): void {
    this.isEditingJournal.set(false);
    this.journalSaveError.set(null);
  }

  onSaveJournalEntry(): void {
    const itemType = this.type();
    const currentItem = this.item();
    if ((itemType !== 'game' && itemType !== 'toy') || !currentItem) {
      return;
    }

    const canonicalItemId =
      itemType === 'game'
        ? this.game()?.game_id || currentItem.id
        : currentItem.id;

    let purchaseDate: string | null = String(
      this.journalForm.purchaseDate || '',
    ).trim();
    let isApprox = this.journalForm.isApproximateDate;

    if (this.journalForm.datePrecision === 'unknown' || !purchaseDate) {
      purchaseDate = null;
      isApprox = false;
    } else if (
      this.journalForm.datePrecision === 'year' ||
      this.journalForm.datePrecision === 'month'
    ) {
      isApprox = true;
    }

    const rawPrice = this.journalForm.pricePaid;
    let pricePaid: number | null = null;
    if (
      rawPrice !== null &&
      rawPrice !== undefined &&
      String(rawPrice).trim() !== ''
    ) {
      const parsed = Number(rawPrice);
      if (Number.isNaN(parsed) || parsed < 0) {
        this.journalSaveError.set('Price paid must be a non-negative number.');
        return;
      }
      pricePaid = Math.round(parsed * 100) / 100;
    }

    this.journalSaving.set(true);
    this.journalSaveError.set(null);

    this.collectionService
      .saveJournalEntry({
        item_type: itemType,
        item_id: String(canonicalItemId),
        purchase_date: purchaseDate,
        is_approximate_date: isApprox ? 1 : 0,
        price_paid: pricePaid,
        merchant: this.journalForm.merchant.trim() || null,
        gifted_by: this.journalForm.giftedBy.trim() || null,
        receipt_url: this.journalForm.receiptUrl.trim() || null,
        notes: this.journalForm.notes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.journalSaving.set(false);
          this.isEditingJournal.set(false);
          this.journalRefreshTrigger.update((v) => v + 1);
        },
        error: (err) => {
          this.journalSaving.set(false);
          this.journalSaveError.set(
            err?.error?.error || 'Failed to save provenance record.',
          );
        },
      });
  }

  onDeleteJournalEntry(): void {
    const itemType = this.type();
    const currentItem = this.item();
    if ((itemType !== 'game' && itemType !== 'toy') || !currentItem) {
      return;
    }

    const canonicalItemId =
      itemType === 'game'
        ? this.game()?.game_id || currentItem.id
        : currentItem.id;

    this.journalSaving.set(true);
    this.journalSaveError.set(null);

    this.collectionService
      .deleteJournalEntry(itemType, String(canonicalItemId))
      .subscribe({
        next: () => {
          this.journalSaving.set(false);
          this.isEditingJournal.set(false);
          this.journalRefreshTrigger.update((v) => v + 1);
        },
        error: () => {
          this.journalSaving.set(false);
          this.journalSaveError.set('Failed to delete provenance record.');
        },
      });
  }

  /**
   * Computes parsed archival origin provenance metadata for digital extracted ROMs.
   */
  public parsedOriginMetadata = computed(() => {
    const g = this.game();
    if (!g || !g.origin_metadata) return null;
    try {
      return typeof g.origin_metadata === 'string'
        ? JSON.parse(g.origin_metadata)
        : g.origin_metadata;
    } catch {
      return { origin_channel: g.origin_metadata };
    }
  });

  /**
   * Computes a human-readable, long-form release date.
   * Handles string splitting to avoid browser-specific UTC offset bugs with Date objects.
   */
  public formattedDate = computed(() => {
    const releaseDate = this.game()?.release_date || this.toy()?.release_date;
    if (!releaseDate) return null;

    try {
      // Split YYYY-MM-DD to avoid UTC offset issues by creating the date in local time
      const parts = releaseDate.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
        const day = parseInt(parts[2]);
        const date = new Date(year, month, day);

        return new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date);
      }
      return releaseDate;
    } catch {
      return releaseDate;
    }
  });

  /**
   * Computes upcoming status, launch countdown, and boutique pre-order storefront link.
   */
  public upcomingReleaseInfo = computed(() => {
    const g = this.game();
    if (!g) return null;
    const isUpcomingDate = Boolean(
      g.release_date && new Date(g.release_date) > new Date(),
    );
    const isNotYetPhysical =
      (g.physical_status === 'not_yet_physical' ||
        g.physical_status === 'physical_pending') &&
      !this.hasPhysicalRelease(g);
    if (!isUpcomingDate && !isNotYetPhysical) return null;
    if (isNotYetPhysical && this.hasOwnedPhysical(g)) return null;

    let countdownText: string | null = null;
    let isReleased = false;

    if (g.release_date) {
      const parts = g.release_date.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const target = new Date(year, month, day);
        const now = new Date();
        const nowMidnight = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const diffMs = target.getTime() - nowMidnight.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > 1) {
          countdownText = `Releases in ${diffDays} days (${g.release_date})`;
        } else if (diffDays === 1) {
          countdownText = `Releases tomorrow (${g.release_date})`;
        } else if (diffDays === 0) {
          countdownText = 'Releases today!';
          isReleased = true;
        } else {
          countdownText = `Released on ${g.release_date}`;
          isReleased = true;
        }
      } else if (g.release_date) {
        countdownText = `Target: ${g.release_date}`;
      }
    }

    return {
      isAnnounced: isUpcomingDate,
      isPending: isNotYetPhysical,
      countdownText,
      isReleased,
      hasStoreLink: !!g.retail_url,
      storeName: g.retail_store || 'Publisher Store',
      retailUrl: g.retail_url,
      price: g.retail_price ? `$${(g.retail_price / 100).toFixed(2)}` : null,
    };
  });

  /**
   * Retrieves the launch date of the parent platform for game items.
   */
  public platformLaunchDate = computed(() => {
    const g = this.game();
    if (!g?.platform_launch_date) return 'Unknown';
    return g.platform_launch_date;
  });

  /**
   * Identifies the regional physical release edition represented by a retailer or boutique publisher.
   */
  public storeRegionLabel(store: string | null | undefined): string {
    if (!store) return 'Physical Edition';
    const s = store.toLowerCase();
    if (s.includes('super rare') || s.includes('strictly limited')) {
      return 'European Physical Edition';
    }
    if (
      s.includes('fangamer') ||
      s.includes('limited run') ||
      s.includes('iam8bit') ||
      s.includes('vgp') ||
      s.includes('pnp')
    ) {
      return 'USA / NA Physical Edition';
    }
    if (s.includes('best buy')) {
      return 'USA Retail Edition';
    }
    return 'Physical Edition';
  }

  /**
   * Returns true if the game is upcoming and not yet owned.
   */
  public isUpcomingRelease(game?: Game | null): boolean {
    if (!game?.release_date) return false;
    if (this.hasOwnedPhysical(game)) return false;
    return new Date(game.release_date) > new Date();
  }

  /**
   * Returns true if the game has at least one owned physical release copy.
   */
  public hasOwnedPhysical(game?: Game | null): boolean {
    if (!game) return false;
    if (game.releases && game.releases.length > 0) {
      return game.releases.some((r) => r.ownership_status === 1);
    }
    return (
      game.ownership_status === 1 &&
      game.physical_status !== 'not_yet_physical' &&
      game.physical_status !== 'digital_only'
    );
  }

  /**
   * Returns true if the game represents a known physical release (e.g. verified physical,
   * matched ROM/catalog signature, physical retail medium, or physical releases list).
   */
  public hasPhysicalRelease(game?: Game | null): boolean {
    if (!game) return false;
    if (
      game.physical_status === 'verified_physical' ||
      game.physical_status === 'likely_physical'
    ) {
      return true;
    }
    if (game.release_medium === 'physical_retail') {
      return true;
    }
    if (game.rom_name) {
      return true;
    }
    if (game.releases && game.releases.length > 0) {
      return game.releases.some((r) => r.is_physical !== false || !!r.rom_name);
    }
    return false;
  }

  /**
   * Determines if a game can be tracked for future physical release announcements.
   * Disallowed for games that already have verified physical releases or are owned.
   */
  public canWatchPhysical(game?: Game | null): boolean {
    if (!game) return false;
    if (this.hasOwnedPhysical(game)) return false;
    if (this.hasPhysicalRelease(game)) return false;
    if (
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending'
    ) {
      return false;
    }
    return (
      game.physical_status === 'digital_only' ||
      (game.platform_id === 0 && !game.rom_name)
    );
  }

  /**
   * Toggles the physical watch status ('not_yet_physical' vs 'digital_only') for games.
   */
  public toggleWatchPhysical(game: Game): void {
    if (this.hasPhysicalRelease(game)) return;
    const nextStatus =
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending'
        ? 'digital_only'
        : 'not_yet_physical';

    this.collectionService.updatePhysicalStatus(game.id, nextStatus).subscribe({
      next: () => {
        game.physical_status = nextStatus;
      },
      error: (err) => {
        console.error('Failed to toggle physical watch status:', err);
      },
    });
  }

  /**
   * Opens the delete confirmation for an entire game.
   */
  public requestDeleteGame(game: Game): void {
    this.deleteError.set(null);
    this.pendingDelete.set({
      kind: 'game',
      id: game.game_id || game.id,
      label: game.title,
    });
  }

  /**
   * Opens the delete confirmation for a single release.
   */
  public requestDeleteRelease(release: GameRelease): void {
    this.deleteError.set(null);
    this.pendingDelete.set({
      kind: 'release',
      id: release.id,
      label: release.rom_name || release.region || release.id,
    });
  }

  public cancelDelete(): void {
    if (this.deleting()) return;
    this.pendingDelete.set(null);
    this.deleteError.set(null);
  }

  /**
   * Executes the confirmed deletion. Deleting a game returns to the list;
   * deleting a release reloads the collection so the detail view refreshes.
   */
  public async confirmDelete(): Promise<void> {
    const pd = this.pendingDelete();
    if (!pd || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      if (pd.kind === 'game') {
        await firstValueFrom(this.collectionService.deleteGame(pd.id));
        this.pendingDelete.set(null);
        this.router.navigate(['/collection', 'games']);
      } else {
        await firstValueFrom(this.collectionService.deleteRelease(pd.id));
        this.pendingDelete.set(null);
        await this.collectionService.refreshAll();
        const g = this.game();
        if (g) {
          g.releases = (g.releases || []).filter((r) => r.id !== pd.id);
        }
      }
    } catch (err) {
      this.deleteError.set(
        err instanceof Error ? err.message : 'Deletion failed.',
      );
    } finally {
      this.deleting.set(false);
    }
  }

  /**
   * Applies an exact series filter and navigates back to the collection list.
   * This is used for franchise exploration links in the UI.
   *
   * @param series The normalized series name to filter by.
   */
  filterBySeries(series: string) {
    const tab = this.type() === 'toy' ? 'toys' : 'games';
    if (this.routeReuseStrategy instanceof CollectionRouteReuseStrategy) {
      this.routeReuseStrategy.clearRoute(tab);
    }
    const currentState = this.collectionService.getListState(tab);
    if (currentState) {
      this.collectionService.updateListState({
        ...currentState,
        filters: {
          ...currentState.filters,
          seriesOrName: series,
          seriesExact: true,
        },
        scrollX: 0,
        scrollY: 0,
      });
    } else {
      this.collectionService.updateListState({
        tab,
        filters: {
          ownership: 1,
          seriesOrName: series,
          seriesExact: true,
          line: '',
          type: '',
        },
        displayLimit: 100,
        scrollX: 0,
        scrollY: 0,
      });
    }
    this.router.navigate(['/collection', tab]);
  }

  getOwnershipStatusIconName(status: number): IconName {
    switch (status) {
      case 1:
        return 'owned';
      case 2:
        return 'seeking';
      case 3:
        return 'ordered';
      default:
        return 'unowned';
    }
  }

  getPlayStatusIconName(status: PlayStatus): IconName {
    switch (status) {
      case PlayStatus.Unplayed:
        return 'hourglass';
      case PlayStatus.Played:
        return 'gamepad';
      case PlayStatus.Playing:
        return 'play';
      case PlayStatus.Queued:
        return 'list-queued';
      case PlayStatus.Paused:
        return 'pause';
      case PlayStatus.Dropped:
        return 'stop-circle';
      default:
        return 'hourglass';
    }
  }

  getPlayStatusText(status: PlayStatus): string {
    switch (status) {
      case PlayStatus.Unplayed:
        return 'Unplayed';
      case PlayStatus.Played:
        return 'Played';
      case PlayStatus.Playing:
        return 'Playing';
      case PlayStatus.Queued:
        return 'Queued';
      case PlayStatus.Paused:
        return 'Paused';
      case PlayStatus.Dropped:
        return 'Dropped';
      default:
        return 'Unplayed';
    }
  }

  onEditOwnership(item: Game | Toy, type: 'game' | 'toy') {
    this.collectionService.showOptions(
      'Ownership Status',
      'Select the ownership status for this item:',
      [
        { value: 1, label: 'Owned' },
        { value: 2, label: 'Seeking' },
        { value: 3, label: 'Ordered' },
        { value: 0, label: 'Unowned' },
      ],
      (value: string | number) => {
        const numVal = Number(value);
        this.collectionService
          .toggleOwnership(item.id, type, numVal)
          .subscribe(() => {
            item.ownership_status = numVal;
          });
      },
    );
  }

  onEditPlayed(game: Game) {
    this.collectionService.showOptions(
      'Play Status',
      'Select the play status for this game:',
      [
        { value: PlayStatus.Played, label: 'Played' },
        { value: PlayStatus.Playing, label: 'Playing' },
        { value: PlayStatus.Queued, label: 'Queued' },
        { value: PlayStatus.Paused, label: 'Paused' },
        { value: PlayStatus.Dropped, label: 'Dropped' },
        { value: PlayStatus.Unplayed, label: 'Unplayed' },
      ],
      (value: string | number) => {
        const playVal = Number(value) as PlayStatus;
        this.collectionService
          .updatePlayStatus(game.id, playVal)
          .subscribe(() => {
            game.play_status = playVal;
          });
      },
    );
  }

  onEditBackedUp(game: Game) {
    this.collectionService.showOptions(
      'Backup Status',
      'Select the backup status for this game:',
      [
        { value: 1, label: 'Backed Up' },
        { value: 0, label: 'No Backup' },
      ],
      (value: string | number) => {
        const backupVal = Number(value);
        this.collectionService
          .updateBackupStatus(game.id, backupVal)
          .subscribe(() => {
            game.backup_status = backupVal;
          });
      },
    );
  }

  getMediaIcon(
    platform: string | null | undefined,
    backedUp: boolean | number,
  ): IconName {
    return getMediaIconName(platform, backedUp);
  }

  onToggleDiscBackup(release: GameRelease) {
    this.collectionService.showOptions(
      'Backup Status',
      'Select the backup status for this disc:',
      [
        { value: 1, label: 'Backed Up' },
        { value: 0, label: 'No Backup' },
      ],
      (value: string | number) => {
        const backupVal = Number(value);
        this.collectionService
          .updateBackupStatus(release.id, backupVal)
          .subscribe(() => {
            release.backup_status = backupVal;
            const g = this.game();
            if (g && g.releases) {
              const targetRel = g.releases.find((r) => r.id === release.id);
              if (targetRel) targetRel.backup_status = backupVal;
              g.backup_status = g.releases.every((r) => r.backup_status === 1)
                ? 1
                : 0;
            }
          });
      },
    );
  }

  /**
   * Generates a URL to the game's page on IGDB based on its title.
   * Since IGDB doesn't allow direct routing via numeric ID, we construct a slug
   * from the game's title (e.g., "The Legend of Zelda" -> "the-legend-of-zelda").
   *
   * @param game The game object.
   * @returns The fully qualified IGDB URL string.
   */
  getIgdbUrl(game: Game): string {
    // Standard IGDB slug generation pattern:
    // 1. Lowercase the title.
    // 2. Replace accented characters with standard equivalents.
    // 3. Remove non-alphanumeric/non-space characters.
    // 4. Replace spaces/consecutive spaces with a single hyphen.
    // 5. Trim leading/trailing hyphens.
    const slug = game.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .replace(/\s+/g, '-') // replace spaces with hyphens
      .replace(/-+/g, '-') // collapse multiple hyphens
      .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens

    return `https://www.igdb.com/games/${slug}`;
  }

  /**
   * Computes the primary external source reference URL and human-friendly label for a toy.
   *
   * @param toy The toy object.
   * @returns An object with the URL and label, or null if no source is available.
   */
  getToySource(toy: Toy): { url: string; label: string } | null {
    if (toy.line === 'Skylanders' && toy.scl_url) {
      return { url: toy.scl_url, label: 'SCL Character Page' };
    }
    if (toy.line === 'amiibo' && toy.amiibo_id) {
      return {
        url: `https://amiiboapi.org/api/amiibo/?id=${toy.amiibo_id}`,
        label: 'AmiiboAPI',
      };
    }
    if (toy.line === 'Starlink') {
      return {
        url: this.getStarlinkWikiUrl(toy.name),
        label: 'Starlink Wiki',
      };
    }
    if (toy.scl_url) {
      return { url: toy.scl_url, label: 'SCL Character Page' };
    }
    return null;
  }

  /**
   * Generates a canonical Fandom Wiki URL for a Starlink toy.
   *
   * @param toyName The name of the Starlink toy.
   * @returns The fully-qualified Fandom Wiki page URL.
   */
  getStarlinkWikiUrl(toyName: string): string {
    const name = toyName.trim().replace(/\//g, ' ');
    const words = name.split(/\s+/).map((w) => {
      const lw = w.toLowerCase();
      if (lw === 'da' || lw === 'de') return lw;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
    let formatted = words.join('_');
    if (
      formatted.toLowerCase().includes('karl_zeon') ||
      formatted.toLowerCase().includes('kharl_zeon')
    ) {
      formatted = 'Kharl_Zeon';
    } else if (formatted.toLowerCase().includes('chase_da_silva')) {
      formatted = 'Calisto_Chase_Da_Silva';
    } else if (name.match(/\bMk\.?\s*2\b/i)) {
      const cleanBase = formatted.replace(/_Mk\.?\s*2\b/i, '');
      formatted = cleanBase + '_Mk._2';
    }
    return `https://starlink.fandom.com/wiki/${encodeURIComponent(formatted)}`;
  }

  /**
   * Computes arbitrage savings when brand new retail clearance is cheaper than CIB used market value.
   */
  getDealArbitrageSavings(game: Game): number | null {
    if (!game.retail_price || !game.price_cib) return null;
    if (game.price_cib > game.retail_price) {
      return game.price_cib - game.retail_price;
    }
    return null;
  }

  /**
   * Constructs a pre-filtered clean eBay search URL.
   * Focuses on physical video games category (_sacat=139973) and collector conditions.
   */
  getSmartEbayUrl(
    game: Game,
    condition: 'cib' | 'loose' | 'all' = 'cib',
  ): string {
    const platformName = game.display_name || game.platform || '';
    let query = `${game.title} ${platformName}`;
    if (condition === 'cib') {
      query += ' cib complete';
    } else if (condition === 'loose') {
      query += ' authentic';
    }
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=139973`;
  }

  /**
   * Constructs a direct search link to Deku Deals.
   */
  getDekuDealsUrl(game: Game): string {
    return `https://www.dekudeals.com/search?q=${encodeURIComponent(game.title)}`;
  }

  /**
   * Returns the direct Best Buy product link if known, otherwise generates a targeted search query.
   */
  getBestBuyUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'Best Buy') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(game.title + ' ' + platformName)}`;
  }

  /**
   * Returns the direct VGP product link if matched, otherwise generates a targeted search query.
   */
  getVgpUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'VGP') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://videogamesplus.ca/search?q=${encodeURIComponent(game.title + ' ' + platformName)}`;
  }

  /**
   * Returns the direct PNP Games product link if matched, otherwise generates a targeted search query.
   */
  getPnpUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'PNP Games') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://pnpgamesonline.com/?s=${encodeURIComponent(game.title + ' ' + platformName)}&post_type=product`;
  }

  /**
   * Generates a direct search link to PriceCharting for the specified game.
   */
  getGamePriceChartingUrl(game: Game): string {
    const platformName = game.display_name || game.platform || '';
    const query = `${game.title} ${platformName}`.trim();
    return `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;
  }

  /**
   * Generates a direct search link to PriceCharting for the specified toy figure.
   */
  getToyPriceChartingUrl(toy: Toy): string {
    let query = toy.name;
    if (toy.line === 'Skylanders') {
      const series = toy.series_name || toy.series;
      if (series) {
        query += ` ${series}`;
      } else {
        query += ` Skylanders`;
      }
    } else if (toy.line) {
      query += ` ${toy.line}`;
    }
    return `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query.trim())}&type=prices`;
  }

  /**
   * Constructs a pre-filtered clean eBay search URL for a toy/figure.
   */
  getSmartEbayToyUrl(
    toy: Toy,
    condition: 'all' | 'loose' | 'new' = 'all',
  ): string {
    let query = `${toy.name} ${toy.line || ''}`;
    if (condition === 'new') {
      query += ' nib sealed';
    } else if (condition === 'loose') {
      query += ' loose';
    }
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query.trim())}`;
  }
}
