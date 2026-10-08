import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

export interface AppBrandingConfig {
  appName: string;
  shortName: string;
  tagline: string;
  authorName: string;
  logoUrl: string;
}

export const DEFAULT_BRANDING: AppBrandingConfig = {
  appName: 'Collection Tracker',
  shortName: 'Tracker',
  tagline: 'Physical Game & Toy Collection Tracker',
  authorName: 'Collection Tracker',
  logoUrl: '/favicon.svg',
};

/**
 * BRANDING SERVICE
 *
 * Provides reactive application branding, title management, and dynamic
 * white-label configuration fetched from the Cloudflare edge worker.
 */
@Injectable({
  providedIn: 'root',
})
export class BrandingService {
  private readonly http = inject(HttpClient);
  private readonly titleService = inject(Title);

  private readonly config = signal<AppBrandingConfig>(DEFAULT_BRANDING);

  public readonly appName = computed(() => this.config().appName);
  public readonly shortName = computed(() => this.config().shortName);
  public readonly tagline = computed(() => this.config().tagline);
  public readonly authorName = computed(() => this.config().authorName);
  public readonly logoUrl = computed(() => this.config().logoUrl);

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      const remoteConfig = await firstValueFrom(
        this.http.get<Partial<AppBrandingConfig>>('/api/config'),
      );
      if (remoteConfig && typeof remoteConfig === 'object') {
        const merged: AppBrandingConfig = {
          ...DEFAULT_BRANDING,
          ...remoteConfig,
        };
        this.config.set(merged);
        this.titleService.setTitle(merged.appName);
      }
    } catch {
      // Fallback cleanly to default branding if offline or unconfigured
      this.titleService.setTitle(DEFAULT_BRANDING.appName);
    }
  }

  /**
   * For testing or dynamic runtime overrides.
   */
  public setBranding(override: Partial<AppBrandingConfig>): void {
    const updated: AppBrandingConfig = {
      ...this.config(),
      ...override,
    };
    this.config.set(updated);
    this.titleService.setTitle(updated.appName);
  }
}
