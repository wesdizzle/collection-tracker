import '../../../test-setup';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { BrandingService, DEFAULT_BRANDING } from './branding.service';

describe('BrandingService', () => {
  let service: BrandingService;
  let httpTesting: HttpTestingController;
  let titleService: Title;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        Title,
        BrandingService,
      ],
    });

    httpTesting = TestBed.inject(HttpTestingController);
    titleService = TestBed.inject(Title);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
  });

  it('should initialize with default branding and fallback if /api/config fails', async () => {
    service = TestBed.inject(BrandingService);
    const req = httpTesting.expectOne('/api/config');
    req.error(new ProgressEvent('Network error'));

    // Wait for microtasks
    await Promise.resolve();

    expect(service.appName()).toBe(DEFAULT_BRANDING.appName);
    expect(service.shortName()).toBe(DEFAULT_BRANDING.shortName);
    expect(titleService.getTitle()).toBe(DEFAULT_BRANDING.appName);
  });

  it('should load remote branding from /api/config', async () => {
    service = TestBed.inject(BrandingService);
    const req = httpTesting.expectOne('/api/config');
    req.flush({
      appName: 'Gagglelog',
      shortName: 'Gaggle',
      tagline: 'Cataloging an Eclectic Gaggle of Games',
      authorName: 'Gaggle Collector',
    });

    // Wait for microtasks
    await Promise.resolve();

    expect(service.appName()).toBe('Gagglelog');
    expect(service.shortName()).toBe('Gaggle');
    expect(service.tagline()).toBe('Cataloging an Eclectic Gaggle of Games');
    expect(service.authorName()).toBe('Gaggle Collector');
    expect(titleService.getTitle()).toBe('Gagglelog');
  });

  it('should allow manual runtime overrides via setBranding', () => {
    service = TestBed.inject(BrandingService);
    const req = httpTesting.expectOne('/api/config');
    req.flush({});

    service.setBranding({ appName: 'Custom Tracker', shortName: 'Custom' });
    expect(service.appName()).toBe('Custom Tracker');
    expect(service.shortName()).toBe('Custom');
    expect(titleService.getTitle()).toBe('Custom Tracker');
  });
});
