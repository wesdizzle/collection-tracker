import '../../../../../test-setup';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CollectionService } from '../../../../core/services/collection.service';
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
    expect(brandLink.getAttribute('href')).toBe('/collection/games');
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
      const collectionService = TestBed.inject(CollectionService);
      collectionService.setAdminForTesting(true);
      fixture.detectChanges();

      const header = fixture.nativeElement.querySelector('.main-header');
      const headerInner = header.querySelector('.header-inner');
      const mainNav = headerInner.querySelector('.main-nav');
      const navLinks = Array.from(
        mainNav.querySelectorAll('.nav-item'),
      ) as HTMLElement[];

      expect(headerInner).toBeTruthy();
      expect(mainNav).toBeTruthy();
      expect(navLinks.length).toBe(3);

      const labels = navLinks.map((el) =>
        el.querySelector('.label')?.textContent?.trim(),
      );
      expect(labels).toEqual(['Games', 'Toys', 'Insights']);

      // When non-admin, top navigation still has Games, Toys, Insights (Discovery lives in Profile Modal Admin Panel)
      collectionService.setAdminForTesting(false);
      fixture.detectChanges();
      const nonAdminNavLinks = headerInner.querySelectorAll('.nav-item');
      expect(nonAdminNavLinks.length).toBe(3);

      // When in public view (/u/:username), Insights and Discovery tabs are hidden and Games/Toys link to /u/:username
      collectionService.setPublicView(true, {
        username: 'alice',
        displayName: 'Alice',
        bio: null,
        homeRegion: 'USA',
      });
      fixture.detectChanges();
      const publicNavLinks = Array.from(
        headerInner.querySelectorAll('.nav-item'),
      ) as HTMLElement[];
      expect(publicNavLinks.length).toBe(2);
      expect(
        publicNavLinks.map((el) =>
          el.querySelector('.label')?.textContent?.trim(),
        ),
      ).toEqual(['Games', 'Toys']);
      const brandLink = fixture.nativeElement.querySelector('.brand-link');
      expect(brandLink.getAttribute('href')).toBe('/u/alice/games');
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

  describe('Profile Modal & User Icon Routing', () => {
    it('should not render profile modal by default', () => {
      const modal = fixture.nativeElement.querySelector('app-profile-modal');
      expect(modal).toBeNull();
    });

    it('should open profile modal when clicking header user button while signed out', () => {
      const cs = TestBed.inject(CollectionService);
      cs.setAdminForTesting(false);
      fixture.detectChanges();

      const userBtn = fixture.nativeElement.querySelector(
        '[data-testid="header-user-btn"]',
      ) as HTMLButtonElement;
      userBtn.click();
      fixture.detectChanges();

      expect(component.profileModalService.isOpen()).toBe(true);
      expect(
        fixture.nativeElement.querySelector('app-profile-modal'),
      ).toBeTruthy();
      component.profileModalService.close();
    });

    it('should render profile modal when open and trigger via header user button when authenticated', () => {
      const cs = TestBed.inject(CollectionService);
      cs.setAdminForTesting(true);
      fixture.detectChanges();

      const userBtn = fixture.nativeElement.querySelector(
        '[data-testid="header-user-btn"]',
      ) as HTMLButtonElement;
      expect(userBtn).toBeTruthy();

      userBtn.click();
      fixture.detectChanges();

      expect(component.profileModalService.isOpen()).toBe(true);
      const modal = fixture.nativeElement.querySelector('app-profile-modal');
      expect(modal).toBeTruthy();

      component.profileModalService.close();
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector('app-profile-modal'),
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
  });
});
