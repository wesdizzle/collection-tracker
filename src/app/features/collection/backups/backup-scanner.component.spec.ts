import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupScannerComponent } from './backup-scanner.component';
import { CollectionService } from '../../../core/services/collection.service';
import { BackupScannerService } from '../../../core/services/backup-scanner.service';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
  Platform,
} from '../../../core/models/collection.models';

describe('BackupScannerComponent', () => {
  let component: BackupScannerComponent;
  let fixture: ComponentFixture<BackupScannerComponent>;
  let applyDiffSpy: ReturnType<typeof vi.fn>;

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
      backup_status: 0,
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
      backup_status: 0,
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
      backup_status: 1,
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
      backup_status: 0,
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
    applyDiffSpy = vi.fn().mockReturnValue(
      of({
        success: true,
        setCount: 2,
        clearCount: 1,
        transferredCount: 1,
      }),
    );

    await TestBed.configureTestingModule({
      imports: [BackupScannerComponent],
      providers: [
        provideRouter([]),
        BackupScannerService,
        {
          provide: CollectionService,
          useValue: {
            games: mockGames.asReadonly(),
            platforms: mockPlatforms.asReadonly(),
            canShowPersonalState: signal(true).asReadonly(),
            loadPlatforms: () => of([]),
            loadGames: () => of([]),
            applyBackupScanDiff: applyDiffSpy,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupScannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-checks same-region ownership switches, leaves cross-region switches unchecked, and respects Prune toggle on Apply', () => {
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
      component.backupScannerService.crawlFromFileList(mockFileList);
    component['applyCrawlResult'](crawl);
    fixture.detectChanges();

    const report = component.scanReport()!;
    expect(report.ownershipSwitches).toHaveLength(2);

    // Same-region switch (Super Mario World: stable_id 101) is pre-selected
    expect(component.isSwitchSelected(101)).toBe(true);
    // Cross-region switch (Chrono Trigger USA -> Japan: stable_id 102) is unchecked by default
    expect(component.isSwitchSelected(102)).toBe(false);

    // Disable pruning (simulating a partial SD card scan)
    component.pruneMissingBackups.set(false);
    expect(component.effectiveSelectedClearCount()).toBe(0);

    component.onApplySelectedDiff();
    expect(applyDiffSpy).toHaveBeenCalledWith({
      setBackedUp: ['smw-usa-rev1', 'ct-jpn'],
      clearBackedUp: [],
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

  it('supports declaring unowned newly backed up releases as owned with case and manual checkboxes', () => {
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
      component.backupScannerService.crawlFromFileList(mockFileList);
    component['applyCrawlResult'](crawl);
    fixture.detectChanges();

    // ct-jpn is unowned (ownership_status: 0) and newly backed up
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
      setBackedUp: ['ct-jpn'],
      clearBackedUp: [],
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
});
