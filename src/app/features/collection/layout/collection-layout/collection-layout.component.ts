import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-collection-layout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container animate-fade-in">
      <header class="flex justify-between items-center mb-10 header-responsive">
        <div>
          <h1 class="text-4xl text-gradient">My Collection</h1>
          <p class="text-secondary mt-2">Games, Figures, and Platforms</p>
        </div>
        <div class="flex gap-md bg-glass tab-container">
          <a routerLink="/collection/games" routerLinkActive="active" class="btn">Games</a>
          <a routerLink="/collection/figures" routerLinkActive="active" class="btn">Figures</a>
        </div>
      </header>

      <router-outlet></router-outlet>
    </div>
  `,
  styles: [`
    .mb-10 { margin-bottom: 2.5rem; }
    .mt-2 { margin-top: 0.5rem; }
    .text-4xl { font-size: 2.5rem; }
    .text-secondary { color: var(--text-secondary); }
    .text-gradient {
      background: linear-gradient(135deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .bg-glass {
      background: rgba(30, 41, 59, 0.4);
      padding: 0.35rem;
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(8px);
    }
    
    .btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      cursor: pointer;
      font-family: var(--font-body);
      font-weight: 500;
      text-decoration: none;
      display: inline-block;
      text-align: center;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .btn:hover:not(.active) {
      color: var(--text-primary);
      background: rgba(255,255,255,0.05);
    }
    
    .btn.active {
      background: var(--accent-color);
      color: #fff;
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    @media (max-width: 640px) {
      .header-responsive {
        flex-direction: column;
        align-items: flex-start;
        gap: 1.5rem;
      }
      .tab-container {
        width: 100%;
        display: flex;
        justify-content: space-between;
      }
      .tab-container .btn {
        flex: 1;
      }
    }
  `]
})
export class CollectionLayoutComponent {}
