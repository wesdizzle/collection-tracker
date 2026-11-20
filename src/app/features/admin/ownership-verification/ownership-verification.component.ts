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
import {
  KitMeterSegment,
  KitSectionCardComponent,
  KitSegmentedMeterComponent,
} from '@wesdizzle/app-kit/angular';
import {
  PhysicalMediaSummary,
  computePhysicalMediaStats,
} from '../../../core/models/insights-analytics';
import { CollectionService } from '../../../core/services/collection.service';
import {
  DirectoryCrawlResult,
  OwnershipVerificationService,
} from '../../../core/services/ownership-verification.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  DuplicateMatchedFile,
  IgnoredScanFile,
  OwnershipSwitchProposal,
  OwnershipVerificationReport,
  ReleaseDiffRow,
} from '../../../../../shared/ownership_verifier';
import { Platform } from '../../../core/models/collection.models';

@Component({
  selector: 'app-ownership-verification',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    KitSectionCardComponent,
    KitSegmentedMeterComponent,
  ],
  templateUrl: './ownership-verification.component.html',
  styleUrl: './ownership-verification.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OwnershipVerificationComponent implements OnInit {
  public collectionService = inject(CollectionService);
  public ownershipVerificationService = inject(OwnershipVerificationService);

  @ViewChild('fallbackDirInput')
  public fallbackDirInput?: ElementRef<HTMLInputElement>;

  /** Raw crawl result from the most recent directory selection */
  public lastCrawl = signal<DirectoryCrawlResult | null>(null);

  /** Optional platform ID override (`null` = auto-detect from folder names) */
  public platformOverrideId = signal<number | null>(null);

  /** Whether the custom Platform Scope dropdown menu is open */
  public isPlatformDropdownOpen = signal<boolean>(false);

  /** Whether the Media Ownership Health summary card is expanded */
  public mediaHealthExpanded = signal<boolean>(true);

  /** Current computed ownership verification report */
  public scanReport = signal<OwnershipVerificationReport | null>(null);

  /** Whether missing media (`1 -> 0`) on scanned platforms should be pruned (default off for additive verification) */
  public pruneMissingMedia = signal<boolean>(false);

  /** Search query for filtering diff tables */
  public searchQuery = signal<string>('');

  /** Selected release IDs for `+ Newly Verified Media (0 -> 1)` */
  public selectedSetIds = signal<Set<string>>(new Set());

  /** Selected release IDs for `- Missing on Scanned Platforms (1 -> 0)` */
  public selectedClearIds = signal<Set<string>>(new Set());

  /** Selected game IDs (`stable_id`) for `Ownership Switches` */
  public selectedSwitchGameIds = signal<Set<number>>(new Set());

  /** Release IDs declared as Owned (`ownership_status = 1`) in `+ Newly Verified Media` */
  public declaredOwnedIds = signal<Set<string>>(new Set());

  /** Release IDs declared with Case (`has_case = 1`) in `+ Newly Verified Media` */
  public declaredCaseIds = signal<Set<string>>(new Set());

  /** Release IDs declared with Manual (`has_manual = 1`) in `+ Newly Verified Media` */
  public declaredManualIds = signal<Set<string>>(new Set());

  /** Error, profile opt-in, and apply status banners */
  public scanError = signal<string | null>(null);
  public isApplying = signal<boolean>(false);
  public isEnablingMediaTracking = signal<boolean>(false);
  public profileOptInError = signal<string | null>(null);
  public applySuccessBanner = signal<{
    setCount: number;
    clearCount: number;
    transferredCount: number;
    declaredOwnedCount: number;
  } | null>(null);

  /** Overall and per-platform physical media ownership stats */
  public mediaHealthStats = computed<PhysicalMediaSummary>(() =>
    computePhysicalMediaStats(
      this.collectionService.games(),
      this.collectionService.platforms(),
    ),
  );

  public mediaMeterSegments = computed<KitMeterSegment[]>(() => {
    const stats = this.mediaHealthStats();
    return [
      {
        id: 'media-ownership-rate',
        label: 'Verified physical media',
        pct: stats.mediaOwnedRatePct,
        color:
          stats.mediaOwnedRatePct >= 80
            ? 'var(--badge-success-fg)'
            : 'var(--m3-primary)',
        title: `${stats.ownedMediaCount} / ${stats.physicalCount} verified (${stats.mediaOwnedRatePct}%)`,
      },
    ];
  });

  /** Sorted hardware platforms for the optional Platform Scope override dropdown */
  public availablePlatforms = computed<Platform[]>(() => {
    return [...this.collectionService.platforms()].sort((a, b) =>
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

  public filteredNewlyVerified = computed<ReleaseDiffRow[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.diff.releases.newlyVerified;
    return report.diff.releases.newlyVerified.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform_name.toLowerCase().includes(q) ||
        r.rom_name.toLowerCase().includes(q) ||
        (r.matched_filename && r.matched_filename.toLowerCase().includes(q)),
    );
  });

  public filteredMissingFromScan = computed<ReleaseDiffRow[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return report.diff.releases.missingFromScan;
    return report.diff.releases.missingFromScan.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform_name.toLowerCase().includes(q) ||
        r.rom_name.toLowerCase().includes(q),
    );
  });

  public filteredIgnoredFiles = computed<IgnoredScanFile[]>(() => {
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

  public filteredUnchangedReleases = computed<ReleaseDiffRow[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const rows = report.unchangedVerifiedReleases ?? [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.platform_name.toLowerCase().includes(q) ||
        (r.matched_filename ?? '').toLowerCase().includes(q),
    );
  });

  public filteredDuplicateFiles = computed<DuplicateMatchedFile[]>(() => {
    const report = this.scanReport();
    if (!report) return [];
    const rows = report.duplicateMatchedFiles ?? [];
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (f) =>
        f.fileName.toLowerCase().includes(q) ||
        f.releaseId.toLowerCase().includes(q) ||
        f.platformName.toLowerCase().includes(q),
    );
  });

  public selectedSetCount = computed(() => this.selectedSetIds().size);

  public effectiveSelectedClearCount = computed(() =>
    this.pruneMissingMedia() ? this.selectedClearIds().size : 0,
  );

  public selectedSwitchCount = computed(
    () => this.selectedSwitchGameIds().size,
  );

  public unownedNewlyVerifiedCount = computed(() => {
    const report = this.scanReport();
    if (!report) return 0;
    return report.diff.releases.newlyVerified.filter(
      (r) => r.ownership_status !== 1,
    ).length;
  });

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
      (this.collectionService.platforms().length === 0 ||
        this.collectionService.games().length === 0) &&
      typeof this.collectionService.refreshAll === 'function'
    ) {
      void this.collectionService.refreshAll().then(() => {
        if (
          typeof this.collectionService.ensureFullCatalogLoaded === 'function'
        ) {
          void this.collectionService.ensureFullCatalogLoaded();
        }
      });
    } else if (
      typeof this.collectionService.ensureFullCatalogLoaded === 'function'
    ) {
      void this.collectionService.ensureFullCatalogLoaded();
    }
  }

  public toggleMediaHealth(): void {
    this.mediaHealthExpanded.update((open) => !open);
  }

  public onEnableIndividualMediaTracking(): void {
    if (this.isEnablingMediaTracking()) {
      return;
    }
    this.isEnablingMediaTracking.set(true);
    this.profileOptInError.set(null);

    this.collectionService
      .updateProfile({ trackIndividualMedia: true })
      .subscribe({
        next: () => {
          this.isEnablingMediaTracking.set(false);
        },
        error: (err: unknown) => {
          this.isEnablingMediaTracking.set(false);
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : 'Failed to enable individual disc and cart tracking.';
          this.profileOptInError.set(msg);
        },
      });
  }

  public onScopePlatformFromBreakdown(platformId: number): void {
    this.selectPlatformOverride(platformId);
  }

  public async onChooseDirectory(): Promise<void> {
    this.scanError.set(null);
    this.applySuccessBanner.set(null);

    if (this.ownershipVerificationService.supportsDirectoryPicker()) {
      try {
        const crawl =
          await this.ownershipVerificationService.pickAndCrawlDirectory();
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
    const crawl = this.ownershipVerificationService.crawlFromFileList(
      input.files,
    );
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
    this.mediaHealthExpanded.set(false);
    this.recomputeReport(crawl);
  }

  private recomputeReport(crawl: DirectoryCrawlResult): void {
    const report = this.ownershipVerificationService.buildVerificationReport({
      rootFolderName: crawl.rootFolderName,
      entries: crawl.entries,
      platformOverrideId: this.platformOverrideId(),
    });
    this.scanReport.set(report);

    // Pre-select all newly verified releases (0 -> 1)
    this.selectedSetIds.set(
      new Set(report.diff.releases.newlyVerified.map((r) => r.id)),
    );

    // Pre-select missing releases (1 -> 0) (applied only if pruneMissingMedia is enabled)
    this.selectedClearIds.set(
      new Set(report.diff.releases.missingFromScan.map((r) => r.id)),
    );

    // Pre-select only ownership switches where defaultSelected === true (same-region switches)
    this.selectedSwitchGameIds.set(
      new Set(
        report.ownershipSwitches
          .filter((s) => s.defaultSelected)
          .map((s) => s.gameId),
      ),
    );

    // Reset per-item ownership/CIB declarations for newly verified items
    this.declaredOwnedIds.set(new Set());
    this.declaredCaseIds.set(new Set());
    this.declaredManualIds.set(new Set());
  }

  public isDeclaredOwned(releaseId: string): boolean {
    return this.declaredOwnedIds().has(releaseId);
  }

  public isDeclaredCase(releaseId: string): boolean {
    return this.declaredCaseIds().has(releaseId);
  }

  public isDeclaredManual(releaseId: string): boolean {
    return this.declaredManualIds().has(releaseId);
  }

  public toggleDeclareOwned(releaseId: string, checked: boolean): void {
    this.declaredOwnedIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(releaseId);
      else next.delete(releaseId);
      return next;
    });
    if (checked) {
      this.toggleSetSelection(releaseId, true);
    } else {
      this.declaredCaseIds.update((prev) => {
        if (!prev.has(releaseId)) return prev;
        const next = new Set(prev);
        next.delete(releaseId);
        return next;
      });
      this.declaredManualIds.update((prev) => {
        if (!prev.has(releaseId)) return prev;
        const next = new Set(prev);
        next.delete(releaseId);
        return next;
      });
    }
  }

  public toggleDeclareCase(releaseId: string, checked: boolean): void {
    this.declaredCaseIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(releaseId);
      else next.delete(releaseId);
      return next;
    });
    if (checked) {
      this.toggleDeclareOwned(releaseId, true);
    }
  }

  public toggleDeclareManual(releaseId: string, checked: boolean): void {
    this.declaredManualIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(releaseId);
      else next.delete(releaseId);
      return next;
    });
    if (checked) {
      this.toggleDeclareOwned(releaseId, true);
    }
  }

  public setAllUnownedAsOwned(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    const unownedIds = report.diff.releases.newlyVerified
      .filter((r) => r.ownership_status !== 1)
      .map((r) => r.id);
    if (checked) {
      this.declaredOwnedIds.set(new Set(unownedIds));
      this.selectedSetIds.update((prev) => {
        const next = new Set(prev);
        for (const id of unownedIds) next.add(id);
        return next;
      });
    } else {
      this.declaredOwnedIds.set(new Set());
      this.declaredCaseIds.set(new Set());
      this.declaredManualIds.set(new Set());
    }
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

  public setAllNewlyVerified(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    if (checked) {
      this.selectedSetIds.set(
        new Set(report.diff.releases.newlyVerified.map((r) => r.id)),
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

  public setAllMissingFromScan(checked: boolean): void {
    const report = this.scanReport();
    if (!report) return;
    if (checked) {
      this.selectedClearIds.set(
        new Set(report.diff.releases.missingFromScan.map((r) => r.id)),
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

    const selectedSwitchSet = this.selectedSwitchGameIds();
    const selectedSwitches = report.ownershipSwitches.filter((s) =>
      selectedSwitchSet.has(s.gameId),
    );
    const setIdSet = new Set<string>(this.selectedSetIds());
    for (const s of selectedSwitches) {
      for (const tid of s.toReleaseIds) {
        setIdSet.add(tid);
      }
    }
    const clearIdSet = new Set<string>(
      this.pruneMissingMedia() ? this.selectedClearIds() : [],
    );
    if (this.pruneMissingMedia()) {
      for (const s of selectedSwitches) {
        for (const fid of s.fromReleaseIds) {
          clearIdSet.add(fid);
        }
      }
    }
    const setMediaOwned = Array.from(setIdSet);
    const clearMediaOwned = Array.from(clearIdSet);
    const ownershipTransfers = selectedSwitches.map((s) => ({
      fromReleaseIds: s.fromReleaseIds,
      toReleaseIds: s.toReleaseIds,
      hasCase: s.hasCase,
      hasManual: s.hasManual,
    }));

    const ownershipDeclarations = setMediaOwned
      .filter((id) => this.declaredOwnedIds().has(id))
      .map((id) => ({
        releaseId: id,
        hasCase: this.declaredCaseIds().has(id) ? 1 : 0,
        hasManual: this.declaredManualIds().has(id) ? 1 : 0,
      }));

    this.isApplying.set(true);
    this.scanError.set(null);
    this.applySuccessBanner.set(null);

    this.collectionService
      .applyOwnershipVerificationDiff({
        setMediaOwned,
        clearMediaOwned,
        ownershipTransfers,
        ...(ownershipDeclarations.length > 0 ? { ownershipDeclarations } : {}),
      })
      .subscribe({
        next: (res) => {
          this.isApplying.set(false);
          this.applySuccessBanner.set({
            setCount: res.setCount,
            clearCount: res.clearCount,
            transferredCount: res.transferredCount,
            declaredOwnedCount:
              res.declaredOwnedCount ?? ownershipDeclarations.length,
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
            'Failed to apply media ownership updates.';
          this.scanError.set(msg);
        },
      });
  }
}
