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
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Game,
  Toy,
  Platform,
  PlayStatus,
  GameRelease,
} from '../../../../core/models/collection.models';
import { combineLatest, of, Observable } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (item(); as i) {
      <div class="container animate-expressive pb-xl" data-version="final-v12">
        <nav class="details-nav mb-lg flex justify-between items-center">
          <a
            [routerLink]="['/collection', type() + 's']"
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
                <span class="icon">{{ getPlayStatusIcon(g.play_status) }}</span>
                <span>{{ getPlayStatusText(g.play_status) }}</span>
              </div>
              <div
                class="stat-pill interactive"
                [class.active]="g.ownership_status !== 0"
                (click)="onEditOwnership(g, 'game')"
              >
                <span class="icon">{{
                  g.ownership_status === 1
                    ? '✅'
                    : g.ownership_status === 2
                      ? '🔍'
                      : g.ownership_status === 3
                        ? '📦'
                        : '⭕'
                }}</span>
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
                  <span class="icon">🆔</span>
                  <span>IGDB Verified</span>
                </a>
              }
              @if (
                g.physical_status === 'digital_extracted_rom' ||
                g.release_medium === 'digital_extracted_rom'
              ) {
                <div class="stat-pill active extracted-rom">
                  <span class="icon">💾</span>
                  <span>Extracted Archival ROM</span>
                </div>
              } @else if (g.rom_name) {
                <div class="stat-pill active physical-release">
                  <span class="icon">📦</span>
                  <span>Physical Release Verified</span>
                </div>
              }
            </div>
          } @else if (toy(); as t) {
            <div class="quick-stats flex gap-sm items-center">
              <div
                class="stat-pill interactive"
                [class.active]="t.ownership_status !== 0"
                (click)="onEditOwnership(t, 'toy')"
              >
                <span class="icon">{{
                  t.ownership_status === 1
                    ? '✅'
                    : t.ownership_status === 2
                      ? '🔍'
                      : t.ownership_status === 3
                        ? '📦'
                        : '⭕'
                }}</span>
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
                  <span class="icon">🔗</span>
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
                <div class="flex flex-wrap gap-2xs mb-md">
                  @for (variant of variants.split(','); track variant) {
                    @if (variant.trim()) {
                      <span class="variant-badge big">{{
                        variant.trim()
                      }}</span>
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
                  <div class="meta-box">
                    <span class="label">Release Date</span>
                    <span class="value">{{ g.release_date || 'Unknown' }}</span>
                  </div>
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
                  @if (g.variants) {
                    <div class="meta-box">
                      <span class="label">Release Variants</span>
                      <span class="value flex flex-wrap gap-2xs mt-2xs">
                        @for (variant of g.variants.split(','); track variant) {
                          @if (variant.trim()) {
                            <span class="variant-badge">{{
                              variant.trim()
                            }}</span>
                          }
                        }
                      </span>
                    </div>
                  }
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
                            <span class="text-secondary text-sm"
                              >({{ origin.origin_year }})</span
                            >
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
                              @if (b.rom_name) {
                                <div class="rom-text font-mono text-2xs">
                                  {{ b.rom_name }}
                                </div>
                              }
                            </div>
                            <div class="disc-actions flex items-center gap-sm">
                              <div
                                class="stat-pill"
                                [class.active]="!!b.backup_status"
                              >
                                <span class="icon">{{
                                  b.backup_status ? '💾' : '❌'
                                }}</span>
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
                      <span class="label">Physical Discs / ROMs</span>
                      <div class="discs-list flex flex-col gap-md">
                        @for (release of g.releases; track release.id) {
                          <div
                            class="disc-row flex flex-col md:flex-row md:items-center justify-between gap-md p-sm rounded-md border border-outline-variant bg-surface-container-high"
                          >
                            <div class="disc-info flex-1">
                              @if (release.rom_name) {
                                <div class="rom-text font-mono mb-2xs">
                                  {{ release.rom_name }}
                                </div>
                              } @else {
                                <div
                                  class="rom-text warning-text font-mono mb-2xs"
                                >
                                  ⚠️ No dump exists in community DAT files
                                </div>
                              }
                              @if (release.rom_crc) {
                                <div
                                  class="crc-text font-mono text-2xs text-secondary"
                                >
                                  CRC32: {{ release.rom_crc }}
                                </div>
                              }
                            </div>
                            <div class="disc-actions flex items-center gap-sm">
                              <button
                                class="stat-pill interactive"
                                [class.active]="!!release.backup_status"
                                (click)="onToggleDiscBackup(release)"
                                title="Toggle Backup Status"
                              >
                                <span class="icon">{{
                                  release.backup_status ? '💾' : '❌'
                                }}</span>
                                <span>{{
                                  release.backup_status
                                    ? 'Backed Up'
                                    : 'No Backup'
                                }}</span>
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  } @else if (g.id && g.id.endsWith('-default')) {
                    <div class="meta-box full-width">
                      <span class="label">ROM Filename</span>
                      <span class="value rom-text warning-text"
                        >⚠️ No dump exists in community DAT files</span
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
          <section class="market-section animate-slide-up mb-xl">
            <div class="market-header flex justify-between items-center mb-md">
              <h2 class="text-xl font-bold flex items-center gap-xs m-0">
                <span>💰</span> Market Valuation & Retail Deals
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
                      🔥
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
                      ⚡ Arbitrage Opportunity: Brand new retail copy is
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
            }

            @if (
              g.retail_price || g.price_cib || g.price_loose || g.price_new
            ) {
              <div class="pricing-grid">
                <div
                  class="price-tier-card"
                  [class.has-price]="!!g.retail_price"
                >
                  <span class="tier-label">Retail (New)</span>
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
                        ? g.retail_store
                        : g.price_new
                          ? 'PriceCharting New'
                          : 'Not tracked'
                    }}
                  </span>
                </div>

                <div class="price-tier-card" [class.has-price]="!!g.price_cib">
                  <span class="tier-label">Complete in Box (CIB)</span>
                  <span class="tier-price">
                    {{
                      g.price_cib ? '$' + (g.price_cib / 100).toFixed(2) : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Used</span>
                </div>

                <div
                  class="price-tier-card"
                  [class.has-price]="!!g.price_loose"
                >
                  <span class="tier-label">Loose Cartridge/Disc</span>
                  <span class="tier-price">
                    {{
                      g.price_loose
                        ? '$' + (g.price_loose / 100).toFixed(2)
                        : '—'
                    }}
                  </span>
                  <span class="tier-sub">PriceCharting Loose</span>
                </div>
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
                [href]="getSmartEbayUrl(g, 'cib')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for Complete in Box (CIB) copies in Video Games"
              >
                🔍 eBay (CIB / Complete)
              </a>
              <a
                [href]="getSmartEbayUrl(g, 'loose')"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill ebay"
                title="Search eBay for Authentic Loose copies"
              >
                🔍 eBay (Loose)
              </a>
              <a
                [href]="getDekuDealsUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill deku"
                title="Check Deku Deals for price history & alerts"
              >
                🏷️ Deku Deals
              </a>
              <a
                [href]="getBestBuyUrl(g)"
                target="_blank"
                rel="noopener noreferrer"
                class="jump-link-pill bestbuy"
                title="Check Best Buy"
              >
                🛒 Best Buy
              </a>
            </div>
          </section>

          @if (g.summary) {
            <section class="narrative-section animate-slide-up">
              <div class="summary-text-airy">
                {{ g.summary }}
              </div>
            </section>
          }
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
            [routerLink]="['/collection', type() ? type() + 's' : 'games']"
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
          <div class="error-icon">⚠️</div>
          <p class="error-message">{{ error }}</p>
          <a
            [routerLink]="['/collection', type() ? type() + 's' : 'games']"
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
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        padding: var(--spacing-8) var(--spacing-12);
        border-radius: var(--radius-md);
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
        border-radius: var(--radius-xl);
        background: var(--m3-surface-container-high);
        border: 1px solid var(--m3-outline-variant);
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--m3-on-surface-variant);
        transition: all 0.2s;
      }

      .stat-pill.active {
        background: var(--m3-tertiary-container);
        color: var(--m3-on-tertiary-container);
        border-color: transparent;
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

      .stat-pill.active.physical-release {
        background: var(--m3-tertiary-container);
        color: var(--m3-on-tertiary-container);
        border-color: transparent;
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
        background: rgba(0, 0, 0, 0.7);
        border-radius: var(--radius-xs);
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
        padding: 0.5rem 1rem;
        background: var(--m3-surface-container);
        border: 1px solid var(--m3-outline-variant);
        border-radius: var(--radius-md);
        font-size: 0.875rem;
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
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--m3-on-surface-variant);
        margin-bottom: var(--spacing-8);
        font-weight: 700;
      }

      .meta-box .value {
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
        border-radius: var(--radius-md);
        background: var(--m3-surface-container-high);
        color: var(--m3-on-surface);
        text-decoration: none;
        font-weight: 600;
        border: 1px solid var(--m3-outline-variant);
        transition: background 0.2s;
      }
      .retry-btn:hover {
        background: var(--m3-surface-container-highest);
      }

      .variant-badge {
        font-size: 0.75rem;
        font-weight: 700;
        color: var(--m3-on-secondary-container);
        background: var(--m3-secondary-container);
        padding: 0.15rem 0.5rem;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        display: inline-block;
      }
      .variant-badge.big {
        font-size: 0.875rem;
        padding: 0.25rem 0.75rem;
        border-radius: 8px;
      }
      .rom-text {
        font-family: monospace;
        font-size: 0.95rem;
        word-break: break-all;
        background: var(--m3-surface-container-high);
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--m3-outline-variant);
      }
      .rom-text.warning-text {
        color: var(--m3-primary);
        border: 1px dashed var(--m3-outline);
        background: var(--m3-surface-container-highest);
        opacity: 0.85;
      }
      .crc-text {
        font-family: monospace;
        font-size: 1rem;
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
        border-radius: var(--radius-md);
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
        background: #dc2626;
        color: #ffffff;
        padding: 0.2rem 0.6rem;
        border-radius: var(--radius-sm);
        font-size: 0.8125rem;
        letter-spacing: 0.02em;
      }
      .deal-arb-note {
        color: #f59e0b;
      }
      .btn-retail-buy {
        display: inline-flex;
        align-items: center;
        padding: 0.5rem 1.125rem;
        background: var(--m3-primary);
        color: var(--m3-on-primary);
        font-weight: 700;
        font-size: 0.875rem;
        border-radius: var(--radius-md);
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
      }
      .price-tier-card.has-price {
        border-color: var(--m3-outline);
      }
      .tier-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--m3-on-surface-variant);
        letter-spacing: 0.05em;
      }
      .tier-price {
        font-size: 1.5rem;
        font-weight: 800;
        color: var(--m3-on-surface);
      }
      .tier-sub {
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
        border-radius: var(--radius-xl);
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
    `,
  ],
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private collectionService = inject(CollectionService);

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
   * Retrieves the launch date of the parent platform for game items.
   */
  public platformLaunchDate = computed(() => {
    const g = this.game();
    if (!g?.platform_launch_date) return 'Unknown';
    return g.platform_launch_date;
  });

  /**
   * Applies an exact series filter and navigates back to the collection list.
   * This is used for franchise exploration links in the UI.
   *
   * @param series The normalized series name to filter by.
   */
  filterBySeries(series: string) {
    const tab = this.type() === 'toy' ? 'toys' : 'games';
    const currentState = this.collectionService.getListState(tab);
    if (currentState) {
      this.collectionService.updateListState({
        ...currentState,
        filters: {
          ...currentState.filters,
          seriesOrName: series,
          seriesExact: true,
        },
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

  getPlayStatusIcon(status: PlayStatus): string {
    switch (status) {
      case PlayStatus.Unplayed:
        return '⏳';
      case PlayStatus.Played:
        return '🎮';
      case PlayStatus.Playing:
        return '▶️';
      case PlayStatus.Queued:
        return '📋';
      case PlayStatus.Paused:
        return '⏸️';
      case PlayStatus.Dropped:
        return '🛑';
      default:
        return '⏳';
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
        this.collectionService
          .toggleOwnership(item.id, type, Number(value))
          .subscribe(() => {
            this.collectionService.refreshAll();
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
        this.collectionService
          .updatePlayStatus(game.id, Number(value) as PlayStatus)
          .subscribe(() => {
            this.collectionService.refreshAll();
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
        this.collectionService
          .updateBackupStatus(game.id, Number(value))
          .subscribe(() => {
            this.collectionService.refreshAll();
          });
      },
    );
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
        this.collectionService
          .updateBackupStatus(release.id, Number(value))
          .subscribe(() => {
            this.collectionService.refreshAll();
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
    if (game.retail_url) {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(game.title + ' ' + platformName)}`;
  }
}
