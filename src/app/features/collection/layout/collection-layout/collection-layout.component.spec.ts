import '../../../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CommandPaletteService } from '../../../../core/services/command-palette.service';
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

  it('should reset route reuse scroll when onNavClick is invoked with CollectionRouteReuseStrategy', () => {
    const reuseStrategy = new CollectionRouteReuseStrategy();
    const resetScrollSpy = vi.spyOn(reuseStrategy, 'resetScroll');
    (
      component as unknown as {
        routeReuseStrategy: CollectionRouteReuseStrategy;
      }
    ).routeReuseStrategy = reuseStrategy;

    component.onNavClick('games');

    expect(resetScrollSpy).toHaveBeenCalledWith('games');
  });

  describe('Top Bar and Navigation Hierarchy', () => {
    it('should place main-header outside layout-container for full-bleed width', () => {
      const header = fixture.nativeElement.querySelector('.main-header');
      const layoutContainer =
        fixture.nativeElement.querySelector('.layout-container');

      expect(header).toBeTruthy();
      expect(layoutContainer).toBeTruthy();
      expect(layoutContainer.contains(header)).toBe(false);
    });

    it('should house navigation tabs inside header-inner within main-header to persist during scroll', () => {
      const header = fixture.nativeElement.querySelector('.main-header');
      const headerInner = header.querySelector('.header-inner');
      const mainNav = headerInner.querySelector('.main-nav');
      const navLinks = Array.from(
        mainNav.querySelectorAll('.nav-item'),
      ) as HTMLElement[];

      expect(headerInner).toBeTruthy();
      expect(mainNav).toBeTruthy();
      expect(navLinks.length).toBe(4);

      const labels = navLinks.map((el) =>
        el.querySelector('.label')?.textContent?.trim(),
      );
      expect(labels).toEqual(['Games', 'Toys', 'Insights', 'Discovery']);
    });

    it('should house content-area and main-footer inside layout-container', () => {
      const layoutContainer =
        fixture.nativeElement.querySelector('.layout-container');
      const contentArea = layoutContainer.querySelector('.content-area');
      const mainFooter = layoutContainer.querySelector('.main-footer');

      expect(contentArea).toBeTruthy();
      expect(mainFooter).toBeTruthy();
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

    it('should open command palette when command palette button is clicked', () => {
      const paletteService = TestBed.inject(CommandPaletteService);
      const openSpy = vi.spyOn(paletteService, 'open');
      const button = fixture.nativeElement.querySelector(
        'button[aria-label="Open command palette"]',
      );
      expect(button).toBeTruthy();
      button.click();
      expect(openSpy).toHaveBeenCalled();
    });

    it('should open command palette on upward swipe on bottom nav and ignore horizontal/downward swipes', () => {
      const paletteService = TestBed.inject(CommandPaletteService);
      const startSpy = vi.spyOn(paletteService, 'startDragOpen');
      const commitSpy = vi.spyOn(paletteService, 'commitDragOpen');
      const cancelSpy = vi.spyOn(paletteService, 'cancelDragOpen');

      // 1. Horizontal swipe -> should not start drag
      component.onNavTouchStart({
        touches: [{ clientX: 100, clientY: 700 }],
      } as unknown as TouchEvent);
      component.onNavTouchMove({
        touches: [{ clientX: 200, clientY: 695 }],
      } as unknown as TouchEvent);
      component.onNavTouchEnd({
        changedTouches: [{ clientX: 200, clientY: 695 }],
      } as unknown as TouchEvent);
      expect(startSpy).not.toHaveBeenCalled();

      // 2. Downward swipe -> should not start drag
      component.onNavTouchStart({
        touches: [{ clientX: 100, clientY: 700 }],
      } as unknown as TouchEvent);
      component.onNavTouchMove({
        touches: [{ clientX: 100, clientY: 750 }],
      } as unknown as TouchEvent);
      component.onNavTouchEnd({
        changedTouches: [{ clientX: 100, clientY: 750 }],
      } as unknown as TouchEvent);
      expect(startSpy).not.toHaveBeenCalled();

      // 3. Small upward swipe (< 60px) -> cancels drag
      component.onNavTouchStart({
        touches: [{ clientX: 100, clientY: 700 }],
      } as unknown as TouchEvent);
      component.onNavTouchMove({
        touches: [{ clientX: 102, clientY: 670 }],
      } as unknown as TouchEvent);
      expect(startSpy).toHaveBeenCalledTimes(1);
      component.onNavTouchEnd({
        changedTouches: [{ clientX: 102, clientY: 670 }],
      } as unknown as TouchEvent);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(commitSpy).not.toHaveBeenCalled();

      // 4. Sufficient upward swipe (deltaY >= 60) -> commits drag open
      component.onNavTouchStart({
        touches: [{ clientX: 100, clientY: 700 }],
      } as unknown as TouchEvent);
      component.onNavTouchMove({
        touches: [{ clientX: 102, clientY: 620 }],
      } as unknown as TouchEvent);
      expect(startSpy).toHaveBeenCalledTimes(2);
      component.onNavTouchEnd({
        changedTouches: [{ clientX: 102, clientY: 620 }],
      } as unknown as TouchEvent);
      expect(commitSpy).toHaveBeenCalledTimes(1);
    });
  });
});
