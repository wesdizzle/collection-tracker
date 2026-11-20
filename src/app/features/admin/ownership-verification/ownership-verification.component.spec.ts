import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OwnershipVerificationComponent } from './ownership-verification.component';
import { CollectionService } from '../../../core/services/collection.service';
import { OwnershipVerificationService } from '../../../core/services/ownership-verification.service';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
  Platform,
} from '../../../core/models/collection.models';

describe('OwnershipVerificationComponent', () => {
  let component: OwnershipVerificationComponent;
  let fixture: ComponentFixture<OwnershipVerificationComponent>;
  let applyDiffSpy: ReturnType<typeof vi.fn>;
  let updateProfileSpy: ReturnType<typeof vi.fn>;
  let mockTrackIndividualMedia: ReturnType<typeof signal<boolean>>;

  const mockGames = signal<Game[]>([
    {
      stable_id: 101,
      id: 'smw-usa-rev0',
      game_id: 'super-mario-world',
      title: 'Super Mario World',
      base_title: 'Super Mario World',
      series: 'Super Mario',
      canonical_series: 'Super Mario',
      platform: 'Super Nintendo Entertainment System',
      display_name: 'Super Nintendo Entertainment System',
      platform_id: 15,
      region: 'USA',
      rom_name: 'Super Mario World (USA).sfc',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      has_media: 0,
      has_case: 1,
      has_manual: 1,
    },
    {
      stable_id: 101,
      id: 'smw-usa-rev1',
      game_id: 'super-mario-world',
      title: 'Super Mario World',
      base_title: 'Super Mario World',
      series: 'Super Mario',
      canonical_series: 'Super Mario',
      platform: 'Super Nintendo Entertainment System',
      display_name: 'Super Nintendo Entertainment System',
      platform_id: 15,
      region: 'USA',
      variants: 'Rev 1',
      rom_name: 'Super Mario World (USA) (Rev 1).sfc',
      ownership_status: OwnershipStatus.Unowned,
      play_status: PlayStatus.Played,
      has_media: 0,
      has_case: 0,
      has_manual: 0,
    },
    {
      stable_id: 102,
      id: 'ct-usa',
      game_id: 'chrono-trigger',
      title: 'Chrono Trigger',
      base_title: 'Chrono Trigger',
      series: 'Chrono',
      canonical_series: 'Chrono',
      platform: 'Super Nintendo Entertainment System',
      display_name: 'Super Nintendo Entertainment System',
      platform_id: 15,
      region: 'USA',
      rom_name: 'Chrono Trigger (USA).sfc',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      has_media: 1,
    },
    {
      stable_id: 102,
      id: 'ct-jpn',
      game_id: 'chrono-trigger',
      title: 'Chrono Trigger',
      base_title: 'Chrono Trigger',
      series: 'Chrono',
      canonical_series: 'Chrono',
      platform: 'Super Nintendo Entertainment System',
      display_name: 'Super Nintendo Entertainment System',
      platform_id: 15,
      region: 'Japan',
      rom_name: 'Chrono Trigger (Japan).sfc',
      ownership_status: OwnershipStatus.Unowned,
      play_status: PlayStatus.Played,
      has_media: 0,
    },
  ]);

  const mockPlatforms = signal<Platform[]>([
    {
      id: 15,
      name: 'super-nintendo-entertainment-system',
      display_name: 'Super Nintendo Entertainment System',
      brand: 'Nintendo',
      launch_date: '1991-08-23',
      image_url: '',
    },
  ]);

  beforeEach(async () => {
    mockTrackIndividualMedia = signal<boolean>(false);
    applyDiffSpy = vi.fn().mockReturnValue(
      of({
        success: true,
        setCount: 2,
        clearCount: 1,
        transferredCount: 1,
      }),
    );
    updateProfileSpy = vi.fn().mockImplementation((patch) => {
      if (typeof patch?.trackIndividualMedia === 'boolean') {
        mockTrackIndividualMedia.set(patch.trackIndividualMedia);
      }
      return of({ trackIndividualMedia: true });
    });

    await TestBed.configureTestingModule({
      imports: [OwnershipVerificationComponent],
      providers: [
        provideRouter([]),
        OwnershipVerificationService,
        {
          provide: CollectionService,
          useValue: {
            games: mockGames.asReadonly(),
            platforms: mockPlatforms.asReadonly(),
            canShowPersonalState: signal(true).asReadonly(),
            trackIndividualMedia: mockTrackIndividualMedia.asReadonly(),
            loadPlatforms: () => of([]),
            loadGames: () => of([]),
            updateProfile: updateProfileSpy,
            applyOwnershipVerificationDiff: applyDiffSpy,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OwnershipVerificationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('defaults pruneMissingMedia to false, pre-checks same-region switches, fixes /game/:slug links, and honors Prune toggle on Apply', () => {
    expect(component.pruneMissingMedia()).toBe(false);

    const mockFileList = [
      {
        name: 'Super Mario World (USA) (Rev 1).sfc',
        webkitRelativePath: 'SNES/Super Mario World (USA) (Rev 1).sfc',
      },
      {
        name: 'Chrono Trigger (Japan).sfc',
        webkitRelativePath: 'SNES/Chrono Trigger (Japan).sfc',
      },
    ];

    const crawl =
      component.ownershipVerificationService.crawlFromFileList(mockFileList);
    component['applyCrawlResult'](crawl);
    fixture.detectChanges();

    const report = component.scanReport()!;
    expect(report.ownershipSwitches).toHaveLength(2);

    // Same-region switch (Super Mario World: stable_id 101) is pre-selected
    expect(component.isSwitchSelected(101)).toBe(true);
    // Cross-region switch (Chrono Trigger USA -> Japan: stable_id 102) is unchecked by default
    expect(component.isSwitchSelected(102)).toBe(false);

    // Verify ownership switch game title links directly to /game/:slug
    const switchLink = fixture.nativeElement.querySelector(
      '[data-testid="switch-game-link-101"]',
    ) as HTMLAnchorElement;
    expect(switchLink?.getAttribute('href')).toBe('/game/super-mario-world');

    // Default pruneMissingMedia is false -> effectiveSelectedClearCount is 0 and clearMediaOwned is []
    expect(component.effectiveSelectedClearCount()).toBe(0);

    component.onApplySelectedDiff();
    expect(applyDiffSpy).toHaveBeenCalledWith({
      setMediaOwned: ['smw-usa-rev1', 'ct-jpn'],
      clearMediaOwned: [],
      ownershipTransfers: [
        {
          fromReleaseIds: ['smw-usa-rev0'],
          toReleaseIds: ['smw-usa-rev1'],
          hasCase: 1,
          hasManual: 1,
        },
      ],
    });

    // Enabling pruneMissingMedia passes selected switch fromReleaseIds in clearMediaOwned
    applyDiffSpy.mockClear();
    component.pruneMissingMedia.set(true);
    fixture.detectChanges();

    component.onApplySelectedDiff();
    expect(applyDiffSpy).toHaveBeenCalledWith({
      setMediaOwned: ['smw-usa-rev1', 'ct-jpn'],
      clearMediaOwned: ['smw-usa-rev0'],
      ownershipTransfers: [
        {
          fromReleaseIds: ['smw-usa-rev0'],
          toReleaseIds: ['smw-usa-rev1'],
          hasCase: 1,
          hasManual: 1,
        },
      ],
    });
  });

  it('tracks missingFromScan releases and includes them in clearMediaOwned only when pruneMissingMedia is true', () => {
    const mockFileList = [
      {
        name: 'Super Mario World (USA).sfc',
        webkitRelativePath: 'SNES/Super Mario World (USA).sfc',
      },
    ];

    const crawl =
      component.ownershipVerificationService.crawlFromFileList(mockFileList);
    component['applyCrawlResult'](crawl);
    fixture.detectChanges();

    const report = component.scanReport()!;
    expect(report.diff.releases.missingFromScan.map((r) => r.id)).toEqual([
      'ct-usa',
    ]);
    expect(component.effectiveSelectedClearCount()).toBe(0);

    component.pruneMissingMedia.set(true);
    fixture.detectChanges();
    expect(component.effectiveSelectedClearCount()).toBe(1);

    component.onApplySelectedDiff();
    expect(applyDiffSpy).toHaveBeenCalledWith({
      setMediaOwned: ['smw-usa-rev0'],
      clearMediaOwned: ['ct-usa'],
      ownershipTransfers: [],
    });
  });

  it('shows opt-in banner when trackIndividualMedia is false and enables it on click', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="media-tracking-opt-in-banner"]'),
    ).toBeTruthy();

    const enableBtn = el.querySelector(
      '[data-testid="enable-media-tracking-btn"]',
    ) as HTMLButtonElement;
    enableBtn.click();
    fixture.detectChanges();

    expect(updateProfileSpy).toHaveBeenCalledWith({
      trackIndividualMedia: true,
    });
    expect(
      el.querySelector('[data-testid="media-tracking-opt-in-banner"]'),
    ).toBeNull();
  });

  it('opens custom Platform Scope dropdown, selects a platform override, and closes on Escape', () => {
    expect(component.isPlatformDropdownOpen()).toBe(false);
    expect(component.selectedPlatformLabel()).toBe(
      'Auto-detect from folder names',
    );

    const triggerBtn = fixture.nativeElement.querySelector(
      '[data-testid="platform-override-trigger"]',
    ) as HTMLButtonElement;
    expect(triggerBtn).toBeTruthy();

    triggerBtn.click();
    fixture.detectChanges();

    expect(component.isPlatformDropdownOpen()).toBe(true);
    const listbox = fixture.nativeElement.querySelector(
      '[data-testid="platform-override-listbox"]',
    );
    expect(listbox).toBeTruthy();

    const snesOpt = fixture.nativeElement.querySelector(
      '[data-testid="platform-option-15"]',
    ) as HTMLButtonElement;
    expect(snesOpt).toBeTruthy();
    snesOpt.click();
    fixture.detectChanges();

    expect(component.isPlatformDropdownOpen()).toBe(false);
    expect(component.platformOverrideId()).toBe(15);
    expect(component.selectedPlatformLabel()).toBe(
      'Super Nintendo Entertainment System',
    );

    // Re-open and close via Escape key
    triggerBtn.click();
    fixture.detectChanges();
    expect(component.isPlatformDropdownOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(component.isPlatformDropdownOpen()).toBe(false);
  });

  it('supports declaring unowned newly verified releases as owned with case and manual checkboxes', () => {
    const mockFileList = [
      {
        name: 'Chrono Trigger (USA).sfc',
        webkitRelativePath: 'SNES/Chrono Trigger (USA).sfc',
      },
      {
        name: 'Chrono Trigger (Japan).sfc',
        webkitRelativePath: 'SNES/Chrono Trigger (Japan).sfc',
      },
    ];

    const crawl =
      component.ownershipVerificationService.crawlFromFileList(mockFileList);
    component['applyCrawlResult'](crawl);
    fixture.detectChanges();

    // ct-jpn is unowned (ownership_status: 0) and newly verified
    expect(component.isSetSelected('ct-jpn')).toBe(true);
    expect(component.isDeclaredOwned('ct-jpn')).toBe(false);
    expect(component.isDeclaredCase('ct-jpn')).toBe(false);
    expect(component.isDeclaredManual('ct-jpn')).toBe(false);

    // Checking Case auto-checks Owned and ensures Apply is checked
    component.toggleDeclareCase('ct-jpn', true);
    expect(component.isDeclaredOwned('ct-jpn')).toBe(true);
    expect(component.isDeclaredCase('ct-jpn')).toBe(true);
    expect(component.isDeclaredManual('ct-jpn')).toBe(false);

    // Checking Manual keeps Owned checked
    component.toggleDeclareManual('ct-jpn', true);
    expect(component.isDeclaredManual('ct-jpn')).toBe(true);

    component.onApplySelectedDiff();
    expect(applyDiffSpy).toHaveBeenCalledWith({
      setMediaOwned: ['ct-jpn'],
      clearMediaOwned: [],
      ownershipTransfers: [],
      ownershipDeclarations: [
        { releaseId: 'ct-jpn', hasCase: 1, hasManual: 1 },
      ],
    });

    // Unchecking Owned clears Case and Manual
    component.toggleDeclareOwned('ct-jpn', false);
    expect(component.isDeclaredOwned('ct-jpn')).toBe(false);
    expect(component.isDeclaredCase('ct-jpn')).toBe(false);
    expect(component.isDeclaredManual('ct-jpn')).toBe(false);
  });

  it('displays Media Ownership Health totals, clickable missing-media links, and scopes scanner from platform breakdown', () => {
    const el = fixture.nativeElement as HTMLElement;
    const healthCard = el.querySelector('[data-testid="media-health-card"]');
    expect(healthCard).toBeTruthy();

    // From mockGames: 2 owned physical releases (smw-usa-rev0 missing, ct-usa verified) -> 50%
    expect(component.mediaHealthStats().physicalCount).toBe(2);
    expect(component.mediaHealthStats().ownedMediaCount).toBe(1);
    expect(component.mediaHealthStats().missingCount).toBe(1);
    expect(component.mediaHealthStats().mediaOwnedRatePct).toBe(50);

    expect(
      el.querySelector('[data-testid="media-rate-pill"]')?.textContent,
    ).toContain('50% Verified');

    const missingLink = el.querySelector(
      '[data-testid="media-stat-missing"]',
    ) as HTMLAnchorElement;
    expect(missingLink).toBeTruthy();
    expect(missingLink.getAttribute('href')).toContain('/collection/games');
    expect(missingLink.getAttribute('href')).toContain('has_media=0');
    expect(missingLink.getAttribute('href')).toContain('reset=1');

    const platMissingLink = el.querySelector(
      '[data-testid="platform-missing-link-15"]',
    ) as HTMLAnchorElement;
    expect(platMissingLink).toBeTruthy();
    expect(platMissingLink.getAttribute('href')).toContain('platform_id=15');
    expect(platMissingLink.getAttribute('href')).toContain('has_media=0');

    // Clicking Scope Scanner sets platformOverrideId
    const scopeBtn = el.querySelector(
      '[data-testid="scope-scanner-btn-15"]',
    ) as HTMLButtonElement;
    expect(scopeBtn).toBeTruthy();
    scopeBtn.click();
    fixture.detectChanges();
    expect(component.platformOverrideId()).toBe(15);

    // Toggle collapse/expand
    const toggleBtn = el.querySelector(
      '[data-testid="toggle-media-health-btn"]',
    ) as HTMLButtonElement;
    toggleBtn.click();
    fixture.detectChanges();
    expect(component.mediaHealthExpanded()).toBe(false);
    expect(el.querySelector('[data-testid="media-stat-missing"]')).toBeNull();
  });
});
