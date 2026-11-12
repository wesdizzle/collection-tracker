import { Injectable, inject, signal } from '@angular/core';
import { CollectionService } from './collection.service';
import {
  BackupScanReport,
  CatalogReleaseCandidate,
  CrawledFileEntry,
  PlatformRow,
  scanBackupEntries,
} from '../../../../shared/backup_scanner';

export interface FileSystemHandleLike {
  readonly kind: 'file' | 'directory';
  readonly name: string;
}

export interface FileSystemDirectoryHandleLike extends FileSystemHandleLike {
  readonly kind: 'directory';
  values(): AsyncIterableIterator<
    FileSystemHandleLike | FileSystemDirectoryHandleLike
  >;
}

export interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandleLike>;
}

export interface DirectoryCrawlResult {
  rootFolderName: string;
  entries: CrawledFileEntry[];
}

@Injectable({
  providedIn: 'root',
})
export class BackupScannerService {
  private collectionService = inject(CollectionService);

  private _isCrawling = signal<boolean>(false);
  public readonly isCrawling = this._isCrawling.asReadonly();

  private _crawlProgress = signal<{
    filesFound: number;
    currentFolder: string;
  }>({
    filesFound: 0,
    currentFolder: '',
  });
  public readonly crawlProgress = this._crawlProgress.asReadonly();

  /**
   * Returns true if the current browser supports the File System Access API
   * (`window.showDirectoryPicker`).
   */
  public supportsDirectoryPicker(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      typeof (window as unknown as DirectoryPickerWindow)
        .showDirectoryPicker === 'function'
    );
  }

  /**
   * Prompts the user to pick a local directory using `window.showDirectoryPicker({ mode: 'read' })`
   * and crawls directory and file names recursively without reading any file contents.
   * Returns `null` if the user cancels the picker (`AbortError`).
   */
  public async pickAndCrawlDirectory(): Promise<DirectoryCrawlResult | null> {
    if (!this.supportsDirectoryPicker()) {
      return null;
    }

    const pickerWindow = window as unknown as DirectoryPickerWindow;
    let rootHandle: FileSystemDirectoryHandleLike;
    try {
      rootHandle = await pickerWindow.showDirectoryPicker!({ mode: 'read' });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err) {
        if ((err as { name: string }).name === 'AbortError') {
          return null;
        }
      }
      throw err;
    }

    return this.crawlDirectoryHandle(rootHandle);
  }

  /**
   * Recursively crawls a `FileSystemDirectoryHandle` by entry name only.
   * Detects container directories (`eboot.bin`, `default.xex`, `sce_sys/param.sfo`)
   * early to avoid traversing thousands of extracted asset files.
   */
  public async crawlDirectoryHandle(
    rootHandle: FileSystemDirectoryHandleLike,
  ): Promise<DirectoryCrawlResult> {
    this._isCrawling.set(true);
    this._crawlProgress.set({
      filesFound: 0,
      currentFolder: rootHandle.name,
    });

    const entries: CrawledFileEntry[] = [];

    try {
      const walk = async (
        dirHandle: FileSystemDirectoryHandleLike,
        prefix: string,
      ): Promise<void> => {
        this._crawlProgress.update((p) => ({
          ...p,
          currentFolder: dirHandle.name,
        }));

        const children: Array<
          FileSystemHandleLike | FileSystemDirectoryHandleLike
        > = [];
        for await (const child of dirHandle.values()) {
          children.push(child);
        }

        // Check if this directory itself is an extracted game container (eboot.bin / default.xex / sce_sys/param.sfo)
        if (prefix !== rootHandle.name) {
          const hasDirectContainerMarker = children.some(
            (c) =>
              c.kind === 'file' &&
              (c.name.toLowerCase() === 'eboot.bin' ||
                c.name.toLowerCase() === 'default.xex'),
          );
          let hasSceSysParam = false;
          if (!hasDirectContainerMarker) {
            const sceSysDir = children.find(
              (c): c is FileSystemDirectoryHandleLike =>
                c.kind === 'directory' && c.name.toLowerCase() === 'sce_sys',
            );
            if (sceSysDir) {
              for await (const sceChild of sceSysDir.values()) {
                if (
                  sceChild.kind === 'file' &&
                  sceChild.name.toLowerCase() === 'param.sfo'
                ) {
                  hasSceSysParam = true;
                  break;
                }
              }
            }
          }

          if (hasDirectContainerMarker || hasSceSysParam) {
            entries.push({
              relativePath: `${prefix}.zip`,
              fileName: `${dirHandle.name}.zip`,
            });
            this._crawlProgress.update((p) => ({
              ...p,
              filesFound: entries.length,
            }));
            return;
          }
        }

        for (const child of children) {
          const childRelPath = `${prefix}/${child.name}`;
          if (child.kind === 'file') {
            entries.push({
              relativePath: childRelPath,
              fileName: child.name,
            });
            if (entries.length % 25 === 0) {
              this._crawlProgress.update((p) => ({
                ...p,
                filesFound: entries.length,
              }));
            }
          } else if (child.kind === 'directory') {
            await walk(child as FileSystemDirectoryHandleLike, childRelPath);
          }
        }
      };

      await walk(rootHandle, rootHandle.name);
      this._crawlProgress.update((p) => ({
        ...p,
        filesFound: entries.length,
      }));

      return {
        rootFolderName: rootHandle.name,
        entries,
      };
    } finally {
      this._isCrawling.set(false);
    }
  }

  /**
   * Fallback crawler for `<input type="file" webkitdirectory multiple>`.
   * Reads only `webkitRelativePath` and `name` metadata from the FileList;
   * never reads file bytes.
   */
  public crawlFromFileList(
    files:
      | FileList
      | ReadonlyArray<{ name: string; webkitRelativePath?: string }>,
  ): DirectoryCrawlResult {
    const entries: CrawledFileEntry[] = [];
    let rootFolderName = 'Backups';

    const length = files.length;
    for (let i = 0; i < length; i++) {
      const f = files[i];
      const relPath = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      if (i === 0) {
        const firstSlash = relPath.indexOf('/');
        if (firstSlash > 0) {
          rootFolderName = relPath.slice(0, firstSlash);
        }
      }
      entries.push({
        relativePath: relPath,
        fileName: f.name,
      });
    }

    return {
      rootFolderName,
      entries,
    };
  }

  /**
   * Computes a complete `BackupScanReport` against the user's loaded catalog releases
   * and platform definitions.
   */
  public buildScanReport(options: {
    rootFolderName: string;
    entries: CrawledFileEntry[];
    platformOverrideId?: number | null;
  }): BackupScanReport {
    const rawPlatforms = this.collectionService.platforms();
    const rawGames = this.collectionService.games();

    const platforms: PlatformRow[] = rawPlatforms.map((p) => ({
      id: p.id,
      name: p.name,
      display_name: p.display_name || p.name,
      brand: p.brand || null,
      launch_date: p.launch_date || null,
      parent_platform_id: p.parent_platform_id ?? null,
    }));

    // Ensure child platforms (like PSVR, PSVR2, New 3DS, Famicom) are represented even if PLATFORMS_LIST_QUERY only returned top-level platforms
    const knownChildPlatforms: PlatformRow[] = [
      {
        id: 25,
        name: 'new-nintendo-3ds',
        display_name: 'New Nintendo 3DS',
        brand: 'Nintendo',
        launch_date: '2015-02-13',
        parent_platform_id: 23,
      },
      {
        id: 51,
        name: 'playstation-vr',
        display_name: 'PlayStation VR',
        brand: 'PlayStation',
        launch_date: '2016-10-13',
        parent_platform_id: 34,
      },
      {
        id: 52,
        name: 'playstation-vr2',
        display_name: 'PlayStation VR2',
        brand: 'PlayStation',
        launch_date: '2023-02-22',
        parent_platform_id: 35,
      },
      {
        id: 53,
        name: 'famicom',
        display_name: 'Famicom',
        brand: 'Nintendo',
        launch_date: '1983-07-15',
        parent_platform_id: null,
      },
    ];
    for (const child of knownChildPlatforms) {
      if (!platforms.some((p) => p.id === child.id)) {
        platforms.push(child);
      }
    }

    const catalogReleases: CatalogReleaseCandidate[] = rawGames
      .filter((g) => g.platform_id > 0)
      .map((g) => ({
        id: g.id,
        game_id: g.stable_id,
        game_slug: g.game_id || g.id,
        title: g.title,
        base_title: g.base_title || g.title,
        platform_id: g.platform_id,
        platform_name: g.display_name || g.platform || 'Unknown',
        rom_name: g.rom_name ?? null,
        rom_crc: g.rom_crc ?? null,
        serial_code: g.serial_code ?? null,
        region: g.region ?? null,
        variants: g.variants ?? null,
        canonical_release_id: g.canonical_release_id ?? null,
        ownership_status: Number(g.ownership_status ?? 0),
        backup_status: g.backup_status ? 1 : 0,
        has_case: g.has_case ? 1 : 0,
        has_manual: g.has_manual ? 1 : 0,
      }));

    return scanBackupEntries({
      rootFolderName: options.rootFolderName,
      entries: options.entries,
      platforms,
      catalogReleases,
      platformOverrideId: options.platformOverrideId ?? null,
    });
  }
}
