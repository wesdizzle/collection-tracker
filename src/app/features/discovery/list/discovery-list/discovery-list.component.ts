import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService } from '../../../../core/services/collection.service';
import { DiscoveryItem, DiscoveryOption, DiscoveryPayload } from '../../../../core/models/collection.models';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-discovery-list',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="discovery-container animate-expressive">
      <div class="discovery-header mb-lg">
        <div class="info-banner">
          <span class="icon">ℹ️</span>
          <p>Processing games and toys from the last scrape.</p>
        </div>
        @if (items().length > 0) {
          <div class="status-card bg-glass animate-slide-up">
            <span class="status-label">Pending Review</span>
            <span class="status-count">{{ items().length }}</span>
          </div>
        }
      </div>
    
      @if (collectionService.loading()) {
        <div class="flex justify-center p-xl">
          <div class="spinner"></div>
        </div>
      }
    
      @if (!collectionService.loading() && items().length === 0) {
        <div class="empty-state">
          <div class="empty-icon text-4xl">✅</div>
          <h3>No Pending Discovery Items</h3>
          <p class="text-secondary">Run <code>npm run scrape</code> to find new games or metadata updates.</p>
        </div>
      }
    
      @if (!collectionService.loading() && items().length > 0) {
        <div class="discovery-grid">
          @for (item of items(); track item.title + item.platform; let i = $index) {
            <div class="discovery-card card-glass">
              <div class="card-header">
                <div>
                  <h2 class="text-lg font-bold">{{ item.title }}</h2>
                  <div class="flex gap-2 items-center mt-1">
                    <span class="platform-badge" [class.toy-badge]="item.platform === 'amiibo'">{{ item.platform }}</span>
                    @if (item.line) {
                      <span class="metadata-badge">Line: {{ item.line }}</span>
                    }
                    @if (item.series) {
                      <span class="metadata-badge">Series: {{ item.series }}</span>
                    }
                    <span class="metadata-badge">DEBUG</span>
                  </div>
                </div>
                <div class="count-badge">{{ item.options.length }} Candidates</div>
              </div>
              <div class="options-scroll">
                @for (opt of item.options; track opt.id) {
                  <div class="option-row">
                    <div class="option-cover">
                      @if (opt.image_url) {
                        <img [src]="opt.image_url" alt="cover">
                      } @else {
                        <div class="no-image">No Cover</div>
                      }
                    </div>
                    <div class="option-info">
                      <div class="flex justify-between items-start">
                        <div>
                          <h4 class="option-name">{{ opt.name }}</h4>
                          <p class="option-platform text-xs text-secondary">{{ opt.platform }}</p>
                        </div>
                        <button (click)="applyMatch(item, opt)" class="btn-match">Match</button>
                      </div>
                      @if (opt.summary) {
                        <p class="option-summary text-xs mt-1">{{ opt.summary }}</p>
                      }
                      <div class="option-id text-xxs text-secondary mt-1">ID: {{ opt.id }}</div>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
    `,
  styles: [`
    .discovery-container { padding: 0 1rem; }
    .mb-lg { margin-bottom: 2rem; }
    .flex { display: flex; }
    .justify-center { justify-content: center; }
    .p-xl { padding: 3rem; }
    .text-lg { font-size: 1.125rem; }
    .text-xs { font-size: 0.75rem; }
    .text-xxs { font-size: 0.65rem; }
    .font-bold { font-weight: 700; }
    .mt-1 { margin-top: 0.25rem; }

    .discovery-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .status-card {
      padding: 0.75rem 1.5rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      border-color: var(--accent-light);
      box-shadow: 0 4px 20px var(--accent-glow);
      min-width: 140px;
    }

    .status-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 0.15rem;
    }

    .status-count {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--accent-light);
      line-height: 1;
    }

    .info-banner {
      flex: 1;
      min-width: 280px;
    }

    .discovery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1.25rem;
    }

    @media (max-width: 480px) {
      .discovery-grid {
        grid-template-columns: 1fr;
      }
      .discovery-card {
        height: auto;
        max-height: 550px;
      }
    }

    .discovery-card {
      display: flex;
      flex-direction: column;
      height: 500px;
      overflow: hidden;
    }

    .card-glass {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      backdrop-filter: blur(8px);
    }

    .card-header {
      padding: 1.25rem;
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      background: rgba(255, 255, 255, 0.02);
    }

    .platform-badge {
      font-size: 0.7rem;
      background: rgba(255, 255, 255, 0.1);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      color: var(--text-secondary);
      margin-top: 0.35rem;
      display: inline-block;
    }

    .toy-badge {
      background: rgba(var(--m3-primary-rgb), 0.2);
      color: var(--m3-primary);
      font-weight: 700;
      text-transform: uppercase;
    }

    .metadata-badge {
      font-size: 0.65rem;
      background: rgba(255, 255, 255, 0.05);
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      color: var(--text-secondary);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .gap-2 { gap: 0.5rem; }
    .items-center { align-items: center; }

    .count-badge {
      font-size: 0.75rem;
      color: var(--accent-color);
      font-weight: 500;
    }

    .options-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .option-row {
      display: flex;
      gap: 0.75rem;
      padding: 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      transition: background 0.2s;
    }

    .option-row:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .option-row:last-child { border-bottom: none; }

    .option-cover {
      width: 60px;
      height: 80px;
      flex-shrink: 0;
      border-radius: 4px;
      overflow: hidden;
      background: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .option-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .no-image { font-size: 0.6rem; color: var(--text-secondary); text-align: center; }

    .option-info { flex: 1; min-width: 0; }

    .option-name {
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .option-summary {
      color: var(--text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .btn-match {
      background: var(--accent-color);
      border: none;
      color: white;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 600;
      transition: all 0.2s;
    }

    .btn-match:hover {
      background: var(--accent-light);
      box-shadow: 0 0 10px var(--accent-glow);
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      background: rgba(30, 41, 59, 0.3);
      border-radius: 20px;
      border: 1px dashed var(--glass-border);
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: var(--accent-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 640px) {
      .discovery-grid { grid-template-columns: 1fr; }
    }
  `]
})
/**
 * DISCOVERY LIST COMPONENT
 * 
 * Provides a specialized interface for reconciling local game/toy data with 
 * remote metadata sources (IGDB). It acts as a staging area for newly scraped items.
 * 
 * DESIGN RATIONALE:
 * - **Reconciliation Workflow**: Allows the user to choose between multiple 
 *   potential matches discovered by the scraper, ensuring database integrity.
 * - **Glassmorphism Aesthetic**: Uses semi-transparent surfaces and blur effects 
 *   to differentiate the 'maintenance' UI from the core collection browsing.
 * - **Immediate Feedback**: Updates local signal state immediately after a 
 *   successful match to provide a responsive, 'triage' style experience.
 * - **Payload Abstraction**: Encapsulates the complex mapping between local 
 *   keys and remote metadata into a clean `DiscoveryPayload`.
 */
export class DiscoveryListComponent implements OnInit {
  public collectionService = inject(CollectionService);

  // Local signal to allow immediate local removal after matching
  public items = signal<DiscoveryItem[]>([]);

  ngOnInit() {
    this.refresh();
  }

  async refresh() {
    await this.collectionService.refreshDiscovery();
    this.items.set(this.collectionService.discoveryItems());
  }

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
      imageUrl: option.image_url || undefined
    };

    try {
      await firstValueFrom(this.collectionService.applyDiscovery(payload));
      // Remove item from local list signal for immediate UX
      this.items.update(current => current.filter(i => i !== item));
    } catch (e: unknown) {
      console.error('[DiscoveryList] Match failed:', e);
      let errorMsg = 'Unknown error';
      if (e instanceof Error) {
        errorMsg = e.message;
      }
      
      const httpError = e as { error?: { error?: string, details?: string }, message?: string };
      if (httpError?.error?.error) {
        errorMsg = `${httpError.error.error}${httpError.error.details ? `\n\nDetails: ${httpError.error.details}` : ''}`;
      } else if (httpError?.message) {
        errorMsg = httpError.message;
      }
      alert('Error matching item:\n' + errorMsg);
    }
  }
}
