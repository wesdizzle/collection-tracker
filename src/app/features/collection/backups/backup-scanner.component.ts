import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CollectionService } from '../../../core/services/collection.service';
import {
  BackupScannerService,
  DirectoryCrawlResult,
} from '../../../core/services/backup-scanner.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  BackupScanReport,
  IgnoredBackupFile,
  OwnershipSwitchProposal,
  ReleaseDiffRow,
} from '../../../../../shared/backup_scanner';
import { Platform } from '../../../core/models/collection.models';

@Component({
  selector: 'app-backup-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  templateUrl: './backup-scanner.component.html',
  styleUrl: './backup-scanner.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupScannerComponent implements OnInit {
  public collectionService = inject(CollectionService);
  public backupScannerService = inject(BackupScannerService);

  @ViewChild('fallbackDirInput')
  public fallbackDirInput?: ElementRef<HTMLInputElement>;

  /** Raw crawl result from the most recent directory selection */
  public lastCrawl = signal<DirectoryCrawlResult | null>(null);

  /** Optional platform ID override (`null` = auto-detect from folder names) */
  public platformOverrideId = signal<number | null>(null);

  /** Whether the custom Platform Scope dropdown menu is open */
  public isPlatformDropdownOpen = signal<boolean>(false);

  /** Current computed scan report */
  public scanReport = signal<BackupScanReport | null>(null);

  /** Whether missing backups (`1 -> 0`) on scanned platforms should be pruned */
  public pruneMissingBackups = signal<boolean>(true);

  /** Search query for filtering diff tables */
  public searchQuery = signal<string>('');

  /** Selected release IDs for `+ Newly Backed Up (0 -> 1)` */
  public selectedSetIds = signal<Set<string>>(new Set());

  /** Selected release IDs for `- Missing on Scanned Platforms (1 -> 0)` */
  public selectedClearIds = signal<Set<string>>(new Set());

  /** Selected game IDs (`stable_id`) for `Ownership Switches` */
  public selectedSwitchGameIds = signal<Set<number>>(new Set());

  /** Error and status banners */
  public scanError = signal<string | null>(null);
  public isApplying = signal<boolean>(false);
  public applySuccessBanner = signal<{
    setCount: number;
    clearCount: number;
    transferredCount: number;
  } | null>(null);

  /** Sorted hardware platforms for the optional Platform Scope override dropdown */
  public availablePlatforms = computed<Platform[]>(() => {
    return [...this.collectionService.platforms()]
      .filter(
        (p) =>
          p.id !== 0 &&
          p.name !== 'No Platform' &&
          p.name !== 'Physical Watch' &&
          p.display_name !== 'No Platform' &&
          p.display_name !== 'Physical Watch',
      )
      .sort((a, b) =>
        (a.display_name || a.name).localeCompare(b.display_name || b.name),
      );
  });

  /** Human-readable label for the currently selected Platform Scope */
  public selectedPlatformLabel = computed<string>(() => {
    const id = this.platformOverrideId();
    if (id === null) {
      return 'Auto-detect from folder names';
    }
    const found = this.availablePlatforms().find((p) => p.id === id);
    return found
      ? found.display_name || found.name
      : 'Auto-detect from folder names';
  });

  public filteredOwnershipSwitches = computed<OwnershipSwitchProposal[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.ownershipSwitches;
    return report.ownershipSwitches.filter(
      (s) =>
        s.gameTitle.toLowerCase().includes(q) ||
        s.platformName.toLowerCase().includes(q) ||
        s.fromSkuLabel.toLowerCase().includes(q) ||
        s.toSkuLabel.toLowerCase().includes(q) ||
        s.matchedFilenames.some((f) => f.toLowerCase().includes(q)),
    );
  });

  public filteredNewlyBackedUp = computed<ReleaseDiffRow[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.diff.releases.newlyBackedUp;
    return report.diff.releases.newlyBackedUp.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform_name.toLowerCase().includes(q) ||
        r.rom_name.toLowerCase().includes(q) ||
        (r.matched_filename && r.matched_filename.toLowerCase().includes(q)),
    );
  });

  public filteredLostBackups = computed<ReleaseDiffRow[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.diff.releases.lostBackup;
    return report.diff.releases.lostBackup.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform_name.toLowerCase().includes(q) ||
        r.rom_name.toLowerCase().includes(q),
    );
  });

  public filteredIgnoredFiles = computed<IgnoredBackupFile[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.ignoredUnmatchedFiles;
    return report.ignoredUnmatchedFiles.filter(
      (f) =>
        f.fileName.toLowerCase().includes(q) ||
        f.relativePath.toLowerCase().includes(q) ||
        (f.platformName && f.platformName.toLowerCase().includes(q)),
    );
  });

  public selectedSetCount = computed(() => this.selectedSetIds().size);

  public effectiveSelectedClearCount = computed(() =>
    this.pruneMissingBackups() ? this.selectedClearIds().size : 0,
  );

  public selectedSwitchCount = computed(
    () => this.selectedSwitchGameIds().size,
  );

  public totalSelectedMutations = computed(
    () =>
      this.selectedSetCount() +
      this.effectiveSelectedClearCount() +
      this.selectedSwitchCount(),
  );

  public canApply = computed(
    () =>
      !this.isApplying() &&
      this.collectionService.canShowPersonalState() &&
      this.totalSelectedMutations() > 0,
  );

  ngOnInit(): void {
    if (
      this.collectionService.platforms().length === 0 ||
      this.collectionService.games().length === 0
    ) {
      void this.collectionService.refreshAll();
    }
  }

  public async onChooseDirectory(): Promise<void> {
    this.scanError.set(null);
    this.applySuccessBanner.set(null);

    if (this.backupScannerService.supportsDirectoryPicker()) {
      try {
        const crawl = await this.backupScannerService.pickAndCrawlDirectory();
        if (!crawl) {
          return;
        }
        this.applyCrawlResult(crawl);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to read the selected local directory.';
        this.scanError.set(msg);
      }
    } else {
      this.triggerFallbackFileInput();
    }
  }

  public triggerFallbackFileInput(): void {
    this.scanError.set(null);
    this.applySuccessBanner.set(null);
    const input = this.fallbackDirInput?.nativeElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  public onFallbackFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input?.files || input.files.length === 0) {
      return;
    }
    const crawl = this.backupScannerService.crawlFromFileList(input.files);
    this.applyCrawlResult(crawl);
  }

  public togglePlatformDropdown(event?: Event): void {
    event?.stopPropagation();
    this.isPlatformDropdownOpen.update((open) => !open);
  }

  public selectPlatformOverride(rawVal: 'auto' | number): void {
    this.isPlatformDropdownOpen.set(false);
    this.onPlatformOverrideChange(rawVal);
  }

  @HostListener('document:click')
  public onDocumentClick(): void {
    if (this.isPlatformDropdownOpen()) {
      this.isPlatformDropdownOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  public onEscapeKey(): void {
    if (this.isPlatformDropdownOpen()) {
      this.isPlatformDropdownOpen.set(false);
    }
  }

  public onPlatformOverrideChange(rawVal: string | number | null): void {
    const parsed =
      rawVal === null || rawVal === '' || rawVal === 'auto'
        ? null
        : Number(rawVal);
    this.platformOverrideId.set(
      parsed !== null && !Number.isNaN(parsed) ? parsed : null,
    );

    const crawl = this.lastCrawl();
    if (crawl) {
      this.recomputeReport(crawl);
    }
  }

  private applyCrawlResult(crawl: DirectoryCrawlResult): void {
    this.lastCrawl.set(crawl);
    this.recomputeReport(crawl);
  }

  private recomputeReport(crawl: DirectoryCrawlResult): void {
    const report = this.backupScannerService.buildScanReport({
      rootFolderName: crawl.rootFolderName,
      entries: crawl.entries,
      platformOverrideId: this.platformOverrideId(),
    });
    this.scanReport.set(report);

    // Pre-select all newly backed up releases (0 -> 1)
    this.selectedSetIds.set(
      new Set(report.diff.releases.newlyBackedUp.map((r) => r.id)),
    );

    // Pre-select all lost backup releases (1 -> 0) (governed by pruneMissingBackups toggle)
    this.selectedClearIds.set(
      new Set(report.diff.releases.lostBackup.map((r) => r.id)),
    );

    // Pre-select only ownership switches where defaultSelected === true (same-region switches)
    this.selectedSwitchGameIds.set(
      new Set(
        report.ownershipSwitches
          .filter((s) => s.defaultSelected)
          .map((s) => s.gameId),
      ),
    );
  }

  public isSetSelected(releaseId: string): boolean {
    return this.selectedSetIds().has(releaseId);
  }

  public toggleSetSelection(releaseId: string, checked: boolean): void {
    this.selectedSetIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(releaseId);
      else next.delete(releaseId);
      return next;
    });
  }

  public setAllNewlyBackedUp(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    if (checked) {
      this.selectedSetIds.set(
        new Set(report.diff.releases.newlyBackedUp.map((r) => r.id)),
      );
    } else {
      this.selectedSetIds.set(new Set());
    }
  }

  public isClearSelected(releaseId: string): boolean {
    return this.selectedClearIds().has(releaseId);
  }

  public toggleClearSelection(releaseId: string, checked: boolean): void {
    this.selectedClearIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(releaseId);
      else next.delete(releaseId);
      return next;
    });
  }

  public setAllLostBackups(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    if (checked) {
      this.selectedClearIds.set(
        new Set(report.diff.releases.lostBackup.map((r) => r.id)),
      );
    } else {
      this.selectedClearIds.set(new Set());
    }
  }

  public isSwitchSelected(gameId: number): boolean {
    return this.selectedSwitchGameIds().has(gameId);
  }

  public toggleSwitchSelection(gameId: number, checked: boolean): void {
    this.selectedSwitchGameIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(gameId);
      else next.delete(gameId);
      return next;
    });
  }

  public setAllOwnershipSwitches(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    if (checked) {
      this.selectedSwitchGameIds.set(
        new Set(report.ownershipSwitches.map((s) => s.gameId)),
      );
    } else {
      this.selectedSwitchGameIds.set(new Set());
    }
  }

  public onApplySelectedDiff(): void {
    const report = this.scanReport();
    if (!report || !this.canApply()) {
      return;
    }

    const setBackedUp = Array.from(this.selectedSetIds());
    const clearBackedUp = this.pruneMissingBackups()
      ? Array.from(this.selectedClearIds())
      : [];
    const selectedSwitchSet = this.selectedSwitchGameIds();
    const ownershipTransfers = report.ownershipSwitches
      .filter((s) => selectedSwitchSet.has(s.gameId))
      .map((s) => ({
        fromReleaseIds: s.fromReleaseIds,
        toReleaseIds: s.toReleaseIds,
        hasCase: s.hasCase,
        hasManual: s.hasManual,
      }));

    this.isApplying.set(true);
    this.scanError.set(null);
    this.applySuccessBanner.set(null);

    this.collectionService
      .applyBackupScanDiff({
        setBackedUp,
        clearBackedUp,
        ownershipTransfers,
      })
      .subscribe({
        next: (res) => {
          this.isApplying.set(false);
          this.applySuccessBanner.set({
            setCount: res.setCount,
            clearCount: res.clearCount,
            transferredCount: res.transferredCount,
          });
          const crawl = this.lastCrawl();
          if (crawl) {
            this.recomputeReport(crawl);
          }
        },
        error: (err) => {
          this.isApplying.set(false);
          const msg =
            err?.error?.error ||
            err?.message ||
            'Failed to apply backup updates.';
          this.scanError.set(msg);
        },
      });
  }
}
