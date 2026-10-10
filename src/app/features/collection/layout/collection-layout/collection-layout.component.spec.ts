import '../../../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionLayoutComponent } from './collection-layout.component';

/**
 * UNIT TEST: CollectionLayoutComponent
 *
 * Verifies that the primary collection layout (Discovery/Games/Toys)
 * initializes correctly with its data dependencies.
 * Updated for Angular 21 and Vitest.
 */
describe('CollectionLayoutComponent', () => {
  let component: CollectionLayoutComponent;
  let fixture: ComponentFixture<CollectionLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionLayoutComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have a brand link pointing to the collection', () => {
    const brandLink = fixture.nativeElement.querySelector('.brand-link');
    expect(brandLink.getAttribute('routerlink')).toBe('/collection/games');
  });

  it('should render brand title from BrandingService', () => {
    const brandTitle = fixture.nativeElement.querySelector('.brand-title');
    expect(brandTitle.textContent.trim()).toBe('Collection Tracker');
  });

  it('should reset tab scroll and scroll to top when onNavClick is invoked', () => {
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});
    component.onNavClick('games');
    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  });

  describe('Notification Settings Modal Rendering', () => {
    it('should not render notification modal by default', () => {
      const modal = fixture.nativeElement.querySelector(
        'app-notification-settings-modal',
      );
      expect(modal).toBeNull();
    });

    it('should render notification modal outside layout-container when open', () => {
      component.notificationService.openSettingsModal();
      fixture.detectChanges();

      const modal = fixture.nativeElement.querySelector(
        'app-notification-settings-modal',
      );
      expect(modal).toBeTruthy();

      const layoutContainer =
        fixture.nativeElement.querySelector('.layout-container');
      expect(layoutContainer.contains(modal)).toBe(false);

      component.notificationService.closeSettingsModal();
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('app-notification-settings-modal'),
      ).toBeNull();
    });
  });

  describe('Theme and PWA Meta Tag Synchronization', () => {
    let metaDark: HTMLMetaElement;
    let metaLight: HTMLMetaElement;
    let metaFallback: HTMLMetaElement;

    beforeEach(() => {
      document.body.classList.remove('theme-light', 'theme-dark');
      metaDark = document.createElement('meta');
      metaDark.setAttribute('name', 'theme-color');
      metaDark.setAttribute('media', '(prefers-color-scheme: dark)');
      metaDark.setAttribute('content', '#121214');

      metaLight = document.createElement('meta');
      metaLight.setAttribute('name', 'theme-color');
      metaLight.setAttribute('media', '(prefers-color-scheme: light)');
      metaLight.setAttribute('content', '#f8fafc');

      metaFallback = document.createElement('meta');
      metaFallback.setAttribute('name', 'theme-color');
      document.head.appendChild(metaDark);
      document.head.appendChild(metaLight);
      document.head.appendChild(metaFallback);
    });

    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      metaDark.remove();
      metaLight.remove();
      metaFallback.remove();
      document.body.classList.remove('theme-light', 'theme-dark');
      window.matchMedia = originalMatchMedia;
    });

    it('should correctly apply explicit dark mode to body and all meta tags', () => {
      component['applyTheme']('dark');
      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
      expect(metaDark.getAttribute('content')).toBe('#121214');
      expect(metaLight.getAttribute('content')).toBe('#121214');
      expect(metaFallback.getAttribute('content')).toBe('#121214');
    });

    it('should correctly apply explicit light mode to body and all meta tags', () => {
      component['applyTheme']('light');
      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
      expect(metaDark.getAttribute('content')).toBe('#f8fafc');
      expect(metaLight.getAttribute('content')).toBe('#f8fafc');
      expect(metaFallback.getAttribute('content')).toBe('#f8fafc');
    });

    it('should correctly apply auto mode when OS prefers dark', () => {
      window.matchMedia = vi.fn().mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('dark'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );

      component['applyTheme']('auto');
      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
      expect(metaDark.getAttribute('content')).toBe('#121214');
      expect(metaLight.getAttribute('content')).toBe('#f8fafc');
      expect(metaFallback.getAttribute('content')).toBe('#121214');
    });

    it('should correctly apply auto mode when OS prefers light', () => {
      window.matchMedia = vi.fn().mockImplementation(
        (query: string) =>
          ({
            matches: query.includes('light'),
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );

      component['applyTheme']('auto');
      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
      expect(metaDark.getAttribute('content')).toBe('#121214');
      expect(metaLight.getAttribute('content')).toBe('#f8fafc');
      expect(metaFallback.getAttribute('content')).toBe('#f8fafc');
    });
  });
});
