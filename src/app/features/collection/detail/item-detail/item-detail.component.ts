import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Figure, Platform } from '../../../../core/models/collection.models';
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
            </div>
          }
        </nav>

        <div class="hero-section mb-xl">
          <div class="hero-grid">
            <div class="art-container">
              <div class="art-frame">
                @if (i.image_url) {
                  <img [src]="i.image_url" alt="Cover Art" class="glitch-load">
                } @else {
                  <div class="placeholder">No Image</div>
                }
                @if (game(); as g) {
                   <div class="region-overlay" [title]="'Region: ' + g.region">{{ g.region }}</div>
                }
              </div>
            </div>
            
            <div class="hero-content">
              <h1 class="item-title text-gradient">{{ (game()?.title) || (figure()?.name) || (platform()?.name) }}</h1>
              @if (game()?.series || figure()?.series_name) {
                <p class="item-series">{{ game()?.series || figure()?.series_name }}</p>
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
                  <span class="label">Platform</span>
                  <div class="value flex items-center gap-sm">
                   @if (game()?.platform_logo) {
                      <img [src]="game()?.platform_logo" class="mini-logo" alt="">
                    }
                    <span>{{ game()?.display_name || game()?.platform || figure()?.line || 'N/A' }}</span>
                  </div>
                </div>
                <div class="meta-box">
                  <span class="label">Release Date</span>
                  <span class="value">{{ game()?.release_date || figure()?.release_date || 'Unknown' }}</span>
                </div>
                @if (game(); as g) {
                   <div class="meta-box">
                    <span class="label">Family</span>
                    <span class="value">{{ g.brand || 'Original' }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        @if (game(); as g) {
          @if (g.summary) {
            <section class="narrative-section animate-slide-up mt-xl">
              <h2 class="section-title mb-md">Summary</h2>
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
    .pb-xl { padding-bottom: 5rem; }
    .details-nav {
      margin-top: 1rem;
    }

    .stat-pill {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 1rem;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-secondary);
      transition: all 0.3s;
    }

    .stat-pill.active {
      background: rgba(34, 197, 94, 0.1);
      border-color: rgba(34, 197, 94, 0.3);
      color: #4ade80;
      box-shadow: 0 0 15px rgba(34, 197, 94, 0.1);
    }

    .stat-pill.active.igdb {
      background: rgba(147, 51, 234, 0.1);
      border-color: rgba(147, 51, 234, 0.3);
      color: #d8b4fe;
      box-shadow: 0 0 15px rgba(147, 51, 234, 0.1);
    }

    .hero-section {
      position: relative;
      overflow: hidden;
      border-radius: 24px;
    }

    .hero-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 3rem;
      align-items: center;
    }

    @media (min-width: 1024px) {
      .hero-grid {
        grid-template-columns: 320px 1fr;
      }
    }

    .art-frame {
      aspect-ratio: 3/4;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 50px rgba(0,0,0,0.7), 0 0 30px rgba(96, 165, 250, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.15);
      position: relative;
    }

    .region-overlay {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      padding: 0.2rem 0.5rem;
      background: rgba(0,0,0,0.8);
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 800;
      color: #fff;
      border: 1px solid rgba(255,255,255,0.15);
      z-index: 10;
      backdrop-filter: blur(4px);
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
    }

    .item-series {
      font-size: 1.5rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
    }

    .genre-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .genre-chip {
      padding: 0.25rem 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--glass-border);
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 2rem;
      padding-top: 2rem;
      border-top: none !important; /* Explicitly remove any divider */
    }

    .meta-box .label {
      display: block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
      font-weight: 700;
    }

    .meta-box .value {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
    }

    .mini-logo {
      height: 1.25rem;
      width: auto;
      object-fit: contain;
    }

    .section-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #fff;
    }

    .summary-text-airy {
      font-size: 1.125rem;
      line-height: 1.7;
      color: #cbd5e1;
      max-width: 800px;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      padding: 0 !important;
    }

    .loading-state {
      min-height: 60vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      color: var(--text-secondary);
    }
  `]
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private collectionService = inject(CollectionService);
  
  public type = toSignal(this.route.paramMap.pipe(switchMap(p => [p.get('type') || ''])), { initialValue: '' });
  
  public item = toSignal(
    this.route.paramMap.pipe(
      switchMap(params => {
        const type = params.get('type') || '';
        const id = params.get('id');
        if (!id) throw new Error('No id');
        
        switch (type) {
          case 'game': return this.collectionService.getGameById(id);
          case 'figure': return this.collectionService.getFigureById(id);
          case 'platform': return this.collectionService.getPlatformById(Number(id));
          default: throw new Error('Unknown type');
        }
      })
    )
  );

  public game = computed(() => this.type() === 'game' ? this.item() as Game : null);
  public figure = computed(() => this.type() === 'figure' ? this.item() as Figure : null);
  public platform = computed(() => this.type() === 'platform' ? this.item() as Platform : null);
}
