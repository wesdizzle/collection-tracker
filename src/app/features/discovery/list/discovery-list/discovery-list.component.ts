import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CollectionService, DiscoveryItem, DiscoveryOption } from '../../../../core/services/collection.service';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-discovery-list',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="discovery-container animate-fade-in">
      <div class="info-banner mb-lg">
        <span class="icon">ℹ️</span>
        <p>This page allows you to process games found during the last <strong>Scrape</strong>. These results are parsed directly from <code>discovery_report.md</code>.</p>
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
                  <span class="platform-badge">{{ item.platform }}</span>
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

    .info-banner {
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.2);
      padding: 1rem;
      border-radius: 12px;
      display: flex;
      gap: 1rem;
      align-items: center;
      color: #bae6fd;
    }

    .discovery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 1.5rem;
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
 * DISCOVERY LIST COMPONENT (SIGNALS-FIRST)
 * 
 * Renders the results of the latest scrape and allows the user to reconcile 
 * discovered titles with established IGDB metadata.
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
    const payload = {
      currentTitle: item.title,
      currentPlatform: item.platform,
      selectedIgdbId: option.id,
      selectedName: option.name,
      region: 'NA' 
    };

    try {
      await firstValueFrom(this.collectionService.applyDiscovery(payload));
      // Remove item from local list signal for immediate UX
      this.items.update(current => current.filter(i => i !== item));
    } catch (e: any) {
      alert('Error matching: ' + (e.error?.error || e.message));
    }
  }
}
