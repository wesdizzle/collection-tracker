import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CollectionService, Game, Figure, Platform } from '../../../../core/services/collection.service';
import { map, switchMap } from 'rxjs/operators';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container animate-fade-in" *ngIf="item$ | async as item; else loading">
      <nav class="mb-lg">
        <a [routerLink]="['/collection', type + 's']" class="back-link flex items-center gap-sm">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Collection
        </a>
      </nav>

      <div class="detail-grid">
        <div class="art-frame glass-panel flex justify-center items-center">
          <img *ngIf="item?.image_url" [src]="item.image_url" alt="Cover Art">
          <div *ngIf="!item?.image_url" class="placeholder text-secondary">
             No Image Available
          </div>
        </div>

        <div class="details-content flex-col gap-lg">
          <div>
            <div class="badge-container mb-md">
              <span class="badge owned" *ngIf="item?.owned">Owned</span>
              <span class="badge wanted" *ngIf="!item?.owned">Wanted</span>
              <span class="badge bg-dark ml-sm" *ngIf="type === 'game'">{{item?.platform}}</span>
              <span class="badge bg-dark ml-sm" *ngIf="type === 'figure'">{{item?.line}}</span>
            </div>
            
            <h1 class="text-5xl text-gradient">{{item?.title || item?.name}}</h1>
            <p class="text-xl text-secondary mt-sm" *ngIf="item?.series || item?.series_name">{{item?.series || item?.series_name}}</p>
          </div>

          <div class="metadata" *ngIf="type === 'game'">
            <div class="meta-item">
              <span class="meta-label">Release Date</span>
              <span class="meta-value">{{item?.release_date || 'Unknown Date'}}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Status</span>
              <span class="meta-value">
                <span class="badge owned" *ngIf="item?.owned">Owned</span>
                <span class="badge wanted" *ngIf="!item?.owned">Wanted</span>
              </span>
            </div>
          </div>
          
          <ng-container *ngIf="type === 'game'">
            <h4 class="mt-lg mb-sm border-b pb-sm mb-md text-secondary">Platform Information</h4>
            <div class="metadata">
              <div class="meta-item">
                <span class="meta-label">Brand</span>
                <span class="meta-value">{{item?.brand || 'N/A'}}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Console</span>
                <span class="meta-value">{{item?.platform || 'N/A'}}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Launch Date</span>
                <span class="meta-value">{{item?.platform_launch_date || 'Unknown Date'}}</span>
              </div>
            </div>
          </ng-container>

          <div class="metadata" *ngIf="type === 'figure'">
            <div class="meta-item">
              <span class="meta-label">Release Date</span>
              <span class="meta-value">{{item?.release_date || 'Unknown'}}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <ng-template #loading>
      <div class="container flex justify-center items-center" style="min-height: 50vh">
         <p class="text-xl text-secondary">Loading details...</p>
      </div>
    </ng-template>
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
  `]
})
export class ItemDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private collectionService = inject(CollectionService);
  
  type: string = '';
  item$!: Observable<any>;

  ngOnInit() {
    this.item$ = this.route.paramMap.pipe(
      switchMap(params => {
        this.type = params.get('type') || '';
        const id = params.get('id');
        if (!id) throw new Error('No id');
        
        switch (this.type) {
          case 'game': return this.collectionService.getGameById(id);
          case 'figure': return this.collectionService.getFigureById(id);
          case 'platform': return this.collectionService.getPlatformById(id);
          default: throw new Error('Unknown type');
        }
      })
    );
  }
}
