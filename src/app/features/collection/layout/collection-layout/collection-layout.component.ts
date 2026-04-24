import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';

@Component({
  selector: 'app-collection-layout',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="layout-container">
      <header class="main-header">
        <div class="header-left">
          <a routerLink="/collection/games" class="brand-link state-layer">
            <img src="/favicon.svg" alt="Gagglog Icon" class="brand-icon">
            <h1 class="brand-title">Gagglog</h1>
          </a>
        </div>
        
        <div class="header-nav-placeholder desktop-only">
          <!-- The nav will be positioned here on desktop via CSS -->
        </div>
 
        <div class="header-right">
          <button (click)="toggleTheme()" class="theme-toggle m3-button-icon state-layer" [title]="'Theme: ' + theme()">
            @if (theme() === 'light') { ☀️ }
            @else if (theme() === 'dark') { 🌙 }
            @else { 🌗 }
          </button>
          
          <a href="https://github.com/wesdizzle/collection-tracker" target="_blank" class="github-btn m3-button-icon state-layer" title="GitHub">
            <svg viewBox="0 0 24 24" class="github-icon">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
          </a>
        </div>
      </header>

      <nav class="main-nav">
        <a routerLink="/collection/games" routerLinkActive="active" class="nav-item">
          <span class="label">Games</span>
          <div class="indicator"></div>
        </a>
        <a routerLink="/collection/toys" routerLinkActive="active" class="nav-item">
          <span class="label">Toys</span>
          <div class="indicator"></div>
        </a>
        @if (isDev) {
          <a routerLink="/collection/discovery" routerLinkActive="active" class="nav-item dev-item">
            <span class="label">Discovery</span>
            <div class="indicator"></div>
          </a>
        }
      </nav>
    
      <main class="content-area animate-fade-in">
        <router-outlet></router-outlet>
      </main>
 
      <footer class="main-footer">
        <div class="footer-divider"></div>
        <p class="footer-copy">Gagglog &copy; 2026</p>
      </footer>
    </div>
    `,
  styles: [`
    .layout-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 var(--container-padding);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative; /* For absolute centering of nav */
    }
 
    .main-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: var(--header-height);
      margin-top: var(--spacing-8);
      margin-bottom: var(--spacing-32);
      border-bottom: 1px solid var(--m3-outline-variant);
      position: sticky;
      top: 0;
      background: var(--m3-surface);
      z-index: 100;
    }
 
    .header-left, .header-right {
      display: flex;
      align-items: center;
      gap: var(--spacing-16);
      flex: 1;
    }
 
    .header-right { justify-content: flex-end; }
    .desktop-only { display: block; }
 
    .brand-link {
      display: flex;
      align-items: center;
      gap: var(--spacing-12);
      padding: var(--spacing-8) var(--spacing-12);
      border-radius: var(--radius-md);
      transition: background-color 0.2s;
    }
 
    .brand-icon { width: 32px; height: 32px; }
    .brand-title { font-size: 1.5rem; font-weight: 700; color: var(--m3-on-surface); margin: 0; }
 
    .main-nav {
      display: flex;
      justify-content: center;
      gap: var(--spacing-8);
      z-index: 1000;
    }
 
    /* Desktop Nav Positioning */
    @media (min-width: 769px) {
      .main-nav {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        top: var(--spacing-8);
        height: var(--header-height);
      }
    }
    
    .nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0 var(--spacing-24);
      height: 100%;
      position: relative;
      color: var(--m3-on-surface-variant);
      transition: color 0.2s;
      cursor: pointer;
      text-decoration: none;
    }
 
    .nav-item .label {
      font-size: 0.875rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      z-index: 1;
    }
 
    .nav-item .indicator {
      position: absolute;
      bottom: 0;
      left: var(--spacing-24);
      right: var(--spacing-24);
      height: 3px;
      background: var(--m3-primary);
      border-radius: 3px 3px 0 0;
      opacity: 0;
      transform: scaleX(0.5);
      transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
    }
 
    .nav-item.active { color: var(--m3-primary); }
    .nav-item.active .indicator { opacity: 1; transform: scaleX(1); }
    .nav-item:hover { color: var(--m3-on-surface); }
 
    .m3-button-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--m3-on-surface-variant);
      cursor: pointer;
      font-size: 1.25rem;
    }
 
    .github-icon { width: 24px; height: 24px; fill: currentColor; }
 
    .content-area { flex: 1; width: 100%; }
 
    .main-footer {
      margin-top: var(--spacing-64);
      padding: var(--spacing-32) 0;
      text-align: center;
    }
 
    .footer-divider { height: 1px; background: var(--m3-outline-variant); margin-bottom: var(--spacing-24); }
    .footer-copy { color: var(--m3-on-surface-variant); font-size: 0.875rem; }
 
    @media (max-width: 768px) {
      .main-header {
        margin-bottom: var(--spacing-24);
        padding: 0 var(--spacing-16);
      }
      
      .brand-title, .desktop-only { display: none; }
 
      .main-nav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 80px;
        background: var(--m3-surface-container-high);
        border-top: 1px solid var(--m3-outline-variant);
        padding-bottom: env(safe-area-inset-bottom);
        box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
        transform: none; /* Reset desktop transform */
      }
 
      .nav-item {
        flex: 1;
        padding: 0;
        gap: var(--spacing-4);
      }
 
      .nav-item .indicator {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 64px;
        height: 32px;
        transform: translate(-50%, -50%) scaleX(0.5);
        border-radius: 16px;
        background: var(--m3-secondary-container);
        z-index: 0;
        transition: all 0.3s cubic-bezier(0.2, 0, 0, 1);
        opacity: 0;
      }
 
      .nav-item.active .label { color: var(--m3-on-secondary-container); }
      .nav-item.active .indicator { transform: translate(-50%, -50%) scaleX(1); opacity: 1; }
    }
  `]
})
export class CollectionLayoutComponent {
  private collectionService = inject(CollectionService);
  public theme = signal<'light' | 'dark' | 'auto'>('auto');

  constructor() {
    const saved = localStorage.getItem('gagglog-theme') as 'light' | 'dark' | 'auto' | null;
    if (saved) {
      this.theme.set(saved);
      this.applyTheme(saved);
    }
  }

  get isDev(): boolean {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  toggleTheme() {
    const modes: ('light' | 'dark' | 'auto')[] = ['light', 'dark', 'auto'];
    const next = modes[(modes.indexOf(this.theme()) + 1) % modes.length];
    this.theme.set(next);
    localStorage.setItem('gagglog-theme', next);
    this.applyTheme(next);
  }

  private applyTheme(mode: 'light' | 'dark' | 'auto') {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');
    if (mode === 'auto') {
      // Respect browser preference
    } else {
      body.classList.add(`theme-${mode}`);
    }
  }
}
