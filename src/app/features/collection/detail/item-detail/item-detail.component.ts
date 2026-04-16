import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { Game, Figure, Platform } from '../../../../core/models/collection.models';
import { switchMap } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

/**
 * Item Detail Component (SIGNALS-FIRST)
 * 
 * Displays comprehensive details for games, figures, or platforms.
 * Utilizes Angular Signals to bridge route parameters to data retrieval, 
 * ensuring a high-performance, zoneless experience.
 */

@Component({
  selector: 'app-item-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    @if (item(); as item) {
      <div class="container animate-fade-in">
        <nav class="mb-lg">
          <a [routerLink]="['/collection', type() + 's']" class="back-link flex items-center gap-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back to Collection
          </a>
        </nav>
        <div class="detail-grid">
          <div class="art-frame glass-panel flex justify-center items-center">
            @if (item.image_url) {
              <img [src]="item.image_url" alt="Cover Art">
            } @else {
              <div class="placeholder text-secondary">
                No Image Available
              </div>
            }
          </div>
          <div class="details-content flex-col gap-lg">
            <div>
              <div class="badge-container mb-md">
                @if (game()?.owned || figure()?.owned) {
                  <span class="badge owned">Owned</span>
                } @else if (game() || figure()) {
                  <span class="badge wanted">Wanted</span>
                }
                @if (game(); as g) {
                  <span class="badge bg-dark ml-sm">{{g.display_name || g.platform}}</span>
                  @if (g.igdb_id) {
                    <span class="igdb-badge ml-sm" title="Verified by IGDB">🆔 Verified by IGDB</span>
                  }
                }
                @if (figure(); as f) {
                  <span class="badge bg-dark ml-sm">{{f.line}}</span>
                }
              </div>
              <h1 class="text-5xl text-gradient">{{ (game()?.title) || (figure()?.name) || (platform()?.name) }}</h1>
              @if (game()?.series || figure()?.series_name) {
                <p class="text-xl text-secondary mt-sm">{{ game()?.series || figure()?.series_name }}</p>
              }
            </div>
            @if (game(); as g) {
              <div class="metadata">
                <div class="meta-item">
                  <span class="meta-label">Release Date</span>
                  <span class="meta-value">{{g.release_date || 'Unknown Date'}}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Status</span>
                  <span class="meta-value">
                    @if (g.owned) {
                      <span class="badge owned">Owned</span>
                    } @else {
                      <span class="badge wanted">Wanted</span>
                    }
                  </span>
                </div>
              </div>
              <h4 class="mt-lg mb-sm border-b pb-sm mb-md text-secondary">Platform Information</h4>
              <div class="metadata">
                <div class="meta-item">
                  <span class="meta-label">Brand</span>
                  <span class="meta-value">{{g.brand || 'N/A'}}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Console</span>
                  <span class="meta-value">{{g.display_name || g.platform || 'N/A'}}</span>
                </div>
                <div class="meta-item">
                  <span class="meta-label">Launch Date</span>
                  <span class="meta-value">{{g.platform_launch_date || 'Unknown Date'}}</span>
                </div>
              </div>
            }
            @if (figure(); as f) {
              <div class="metadata">
                <div class="meta-item">
                  <span class="meta-label">Release Date</span>
                  <span class="meta-value">{{f.release_date || 'Unknown'}}</span>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div class="container flex justify-center items-center" style="min-height: 50vh">
        <p class="text-xl text-secondary">Loading details...</p>
      </div>
    }
    `,
  styles: [`
    .mb-lg { margin-bottom: 2rem; }
    .mb-md { margin-bottom: 1rem; }
    .mt-sm { margin-top: 0.5rem; }
    .ml-sm { margin-left: 0.5rem; }
    .gap-lg { gap: 2rem; }
    
    .back-link {
      display: inline-flex;
      font-weight: 500;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--glass-border);
    }
    .back-link:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 3rem;
    }
    
    @media (min-width: 900px) {
      .detail-grid {
        grid-template-columns: 400px 1fr;
      }
    }

    .art-frame {
      aspect-ratio: 3/4;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 30px var(--accent-glow);
    }
    
    .art-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    .placeholder {
      font-family: var(--font-heading);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .text-5xl {
      font-size: 3.5rem;
      line-height: 1.1;
    }
    .text-xl {
      font-size: 1.25rem;
    }

    .grid-meta {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1.5rem;
      padding-top: 2rem;
      border-top: 1px solid var(--glass-border);
    }
    
    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    
    .meta-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      font-weight: 600;
    }
    
    .meta-value {
      font-size: 1.125rem;
      font-weight: 500;
      color: var(--text-primary);
    }

    .text-gradient {
      background: linear-gradient(135deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .bg-dark {
      background: rgba(15, 23, 42, 0.6);
      color: var(--text-primary);
      border-color: var(--glass-border);
    }

    .igdb-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(147, 51, 234, 0.1);
      color: #e9d5ff;
      border: 1px solid rgba(147, 51, 234, 0.3);
      padding: 0.15rem 0.6rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  `]
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private collectionService = inject(CollectionService);
  
  public type = computed(() => this.route.snapshot.paramMap.get('type') || '');
  
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

  // Type-safe narrowed signals for the template
  public game = computed(() => this.type() === 'game' ? this.item() as Game : null);
  public figure = computed(() => this.type() === 'figure' ? this.item() as Figure : null);
  public platform = computed(() => this.type() === 'platform' ? this.item() as Platform : null);
}
