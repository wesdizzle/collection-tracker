import { Component, inject } from '@angular/core';
import { RouterModule, Router, NavigationStart } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-collection-layout',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="layout-container animate-fade-in">
      <header class="main-header">
        <div class="header-content">
          <h1 class="brand-title text-gradient">Gagglog Collection Tracker</h1>
          <p class="brand-subtitle">Games and Figures</p>
        </div>
        <nav class="main-nav bg-glass">
          <a routerLink="/collection/games" routerLinkActive="active" class="nav-btn">Games</a>
          <a routerLink="/collection/figures" routerLinkActive="active" class="nav-btn">Figures</a>
          @if (isDev) {
            <a routerLink="/collection/discovery" routerLinkActive="active" class="nav-btn dev-btn">
              <span class="icon">✨</span> Discovery
            </a>
          }
        </nav>
        <a href="https://github.com/wesdizzle/collection-tracker" target="_blank" class="github-link header-git">
          <svg viewBox="0 0 24 24" class="github-icon">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
          <span class="git-text">GitHub</span>
        </a>
      </header>
    
      <main class="content-area">
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
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .main-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 2.5rem;
    }

    .brand-title {
      font-size: 2.5rem;
      margin: 0;
    }

    .brand-subtitle {
      color: var(--text-secondary);
      margin-top: 0.5rem;
    }

    .text-gradient {
      background: linear-gradient(135deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .main-nav {
      display: flex;
      gap: 1rem;
      padding: 0.35rem;
    }

    .bg-glass {
      background: rgba(30, 41, 59, 0.4);
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(8px);
    }

    .nav-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      cursor: pointer;
      font-family: var(--font-body);
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .nav-btn:hover:not(.active) {
      color: var(--text-primary);
      background: rgba(255,255,255,0.05);
    }

    .nav-btn.active {
      background: var(--accent-color);
      color: #fff;
      box-shadow: 0 4px 12px var(--accent-glow);
    }

    .content-area {
      flex: 1;
      width: 100%;
    }

    .main-footer {
      margin-top: 5rem;
      padding: 2.5rem 0;
      text-align: center;
    }

    .footer-divider {
      height: 1px;
      background: var(--glass-border);
      margin-bottom: 2rem;
      width: 100%;
    }

    .footer-copy {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .github-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.875rem;
      transition: all 0.2s;
      padding: 0.5rem 1rem;
      border-radius: 8px;
    }

    .header-git {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--glass-border);
    }

    .github-link:hover {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .github-icon {
      width: 1.1rem;
      height: 1.1rem;
      fill: currentColor;
    }

    @media (max-width: 900px) {
      .main-header {
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 1.25rem;
      }
      .brand-title {
        font-size: 2rem;
      }
      .main-nav {
        width: 100%;
        max-width: 400px;
        justify-content: center;
        order: 2;
      }
      .header-git {
        order: 3;
        margin-top: 0.5rem;
      }
    }

    @media (max-width: 480px) {
      .brand-title {
        font-size: 1.5rem;
      }
      .main-nav {
        flex-direction: column;
        gap: 0.5rem;
        background: transparent;
        border: none;
        backdrop-filter: none;
      }
      .nav-btn {
        width: 100%;
        background: rgba(255,255,255,0.03);
      }
    }
  `]
})
export class CollectionLayoutComponent {
  get isDev(): boolean {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }
}
