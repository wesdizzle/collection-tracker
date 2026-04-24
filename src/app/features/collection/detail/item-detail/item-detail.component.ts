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

import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Toy, Platform } from '../../../../core/models/collection.models';
import { switchMap } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (item(); as i) {
      <div class="container animate-fade-in pb-xl" data-version="final-v12">
        <nav class="details-nav mb-lg flex justify-between items-center">
          <a [routerLink]="['/collection', type() + 's']" class="back-link flex items-center gap-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back to Collection
          </a>
          @if (game(); as g) {
            <div class="quick-stats flex gap-sm items-center">
              <div class="stat-pill" [class.active]="!!g.played">
                <span class="icon">{{ g.played ? '🎮' : '⏳' }}</span>
                <span>{{ g.played ? 'Played' : 'Unplayed' }}</span>
              </div>
              <div class="stat-pill" [class.active]="!!g.backed_up">
                <span class="icon">{{ g.backed_up ? '💾' : '❌' }}</span>
                <span>{{ g.backed_up ? 'Backed Up' : 'No Backup' }}</span>
              </div>
              <div class="stat-pill" [class.active]="g.owned">
                <span class="icon">{{ g.owned ? '✅' : '🎯' }}</span>
                <span>{{ g.owned ? 'Owned' : 'Wanted' }}</span>
              </div>
              @if (g.igdb_id) {
                <div class="stat-pill active igdb">
                  <span class="icon">🆔</span>
                  <span>IGDB Verified</span>
                </div>
              }
              @if (g.pricecharting_url) {
                <a [href]="g.pricecharting_url" target="_blank" class="stat-pill active physical">
                  <span class="icon">📦</span>
                  <span>Physical Verified</span>
                </a>
              }
            </div>
          } @else if (toy(); as t) {
            <div class="quick-stats flex gap-sm items-center">
              <div class="stat-pill" [class.active]="t.owned">
                <span class="icon">{{ t.owned ? '✅' : '🎯' }}</span>
                <span>{{ t.owned ? 'Owned' : 'Wanted' }}</span>
              </div>
              @if (t.verified) {
                <div class="stat-pill active physical">
                  <span class="icon">✨</span>
                  <span>Verified</span>
                </div>
              }
            </div>
          }
        </nav>

        <div class="hero-section mb-xl">
          <div class="hero-grid">
            <div class="art-container">
              <div class="art-frame">
                @if (i.image_url) {
                  <img [src]="i.image_url" alt="Cover Art" [class.glitch-load]="type() !== 'toy'" [class.toy-detail-art]="type() === 'toy'">
                } @else {
                  <div class="placeholder">No Image</div>
                }
                @if (game(); as g) {
                   <div class="region-overlay" [title]="'Region: ' + g.region">{{ g.region }}</div>
                }
              </div>
            </div>
            
            <div class="hero-content">
              <h1 class="item-title text-gradient">{{ (game()?.title) || (toy()?.name) || (platform()?.name) }}</h1>
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
                      <span class="genre-chip">{{genre}}</span>
                    }
                  }
                </div>
              }

              <div class="metadata-grid mt-xl">
                <div class="meta-box">
                  <span class="label">{{ type() === 'toy' ? 'Line' : 'Platform' }}</span>
                  <div class="value flex items-center gap-sm">
                   @if (game()?.platform_logo) {
                      <img [src]="game()?.platform_logo" class="mini-logo" alt="">
                    }
                    <span>{{ game()?.display_name || game()?.platform || toy()?.line || 'N/A' }}</span>
                  </div>
                </div>
                @if (game(); as g) {
                  <div class="meta-box">
                    <span class="label">Launch Date</span>
                    <span class="value">{{ platformLaunchDate() }}</span>
                  </div>
                } @else if (toy(); as t) {
                  @if (!formattedDate()) {
                    <div class="meta-box">
                      <span class="label">Release Date</span>
                      <span class="value">{{ t.release_date || 'Unknown' }}</span>
                    </div>
                  }
                }
                @if (game(); as g) {
                }
                @if (toy(); as t) {
                  <div class="meta-box">
                    <span class="label">Type</span>
                    <span class="value">{{ t.type }}</span>
                  </div>
                  @if (t.toy_series || t.series_name) {
                    <div class="meta-box">
                      <span class="label">Toy Series</span>
                      <span class="value">{{ t.toy_series || t.series_name }}</span>
                    </div>
                  }
                  @if (t.game_series) {
                    <div class="meta-box">
                      <span class="label">Game Series</span>
                      <span class="value">{{ t.game_series }}</span>
                    </div>
                  }
                  @if (t.amiibo_id || t.scl_url) {
                    <div class="meta-box full-width">
                      <span class="label">Verified Source</span>
                      <span class="value">
                        @if (t.amiibo_id) {
                          <a [href]="'https://amiiboapi.org/api/amiibo/?id=' + t.amiibo_id" target="_blank" class="meta-link">AmiiboAPI</a>
                        }
                        @if (t.scl_url) {
                          <a [href]="t.scl_url" target="_blank" class="meta-link">SCL Character Page</a>
                        }
                      </span>
                    </div>
                  }
                }
              </div>
            </div>
          </div>
        </div>

        @if (game(); as g) {
          @if (g.summary) {
            <section class="narrative-section animate-slide-up">
              <div class="summary-text-airy">
                {{ g.summary }}
              </div>
            </section>
          }
        }
      </div>
    } @else {
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Retrieving metadata...</p>
      </div>
    }
    `,
  styles: [`
    .pb-xl { padding-bottom: var(--spacing-64); }
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
    }
 
    .stat-pill.active.physical {
      background: var(--m3-primary-container);
      color: var(--m3-on-primary-container);
      border-color: transparent;
      text-decoration: none;
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
      background: radial-gradient(circle at center, var(--m3-surface-container-highest), var(--m3-surface-container-low));
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
 
    .toy-detail-art {
       width: 100%;
       height: 100%;
       object-fit: contain !important;
       filter: drop-shadow(0 12px 24px rgba(0,0,0,0.3));
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
      background: rgba(0,0,0,0.7);
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
      .item-title { font-size: 2.25rem; }
      .item-series { font-size: 1.125rem; }
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
 
    .meta-link { cursor: pointer; color: var(--m3-primary); transition: opacity 0.2s; }
    .meta-link:hover { opacity: 0.8; text-decoration: underline; }
    
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
  `]
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private collectionService = inject(CollectionService);
  
  /** The current item type ('game', 'toy', or 'platform') derived from the route */
  public type = toSignal(this.route.paramMap.pipe(switchMap(p => [p.get('type') || ''])), { initialValue: '' });
  
  /** 
   * Reactive signal containing the full metadata for the current item.
   * Dynamically fetches data from the CollectionService based on the route parameters.
   */
  public item = toSignal(
    this.route.paramMap.pipe(
      switchMap(params => {
        const type = params.get('type') || '';
        const id = params.get('id');
        if (!id) throw new Error('No id');
        
        switch (type) {
          case 'game': return this.collectionService.getGameById(id);
          case 'toy': return this.collectionService.getToyById(id);
          case 'platform': return this.collectionService.getPlatformById(Number(id));
          default: throw new Error('Unknown type');
        }
      })
    )
  );

  /** --- Type-Safe Accessors for Computed Metadata --- */
  public game = computed(() => this.type() === 'game' ? this.item() as Game : null);
  public toy = computed(() => this.type() === 'toy' ? this.item() as Toy : null);
  public platform = computed(() => this.type() === 'platform' ? this.item() as Platform : null);

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
          day: 'numeric'
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
        filters: { ...currentState.filters, series, seriesExact: true }
      });
    } else {
      this.collectionService.updateListState({
        tab,
        filters: { ownership: 'owned', series, seriesExact: true, line: '', type: '' },
        displayLimit: 100,
        scrollX: 0,
        scrollY: 0
      });
    }
    this.router.navigate(['/collection', tab]);
  }
}
