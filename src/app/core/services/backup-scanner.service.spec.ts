import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BackupScannerService,
  FileSystemDirectoryHandleLike,
  FileSystemHandleLike,
} from './backup-scanner.service';
import { CollectionService } from './collection.service';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
  Platform,
} from '../models/collection.models';

function createMockDirHandle(
  name: string,
  children: Array<FileSystemHandleLike | FileSystemDirectoryHandleLike>,
): FileSystemDirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const child of children) {
        yield child;
      }
    },
  };
}

function createMockFileHandle(name: string): FileSystemHandleLike {
  return {
    kind: 'file',
    name,
  };
}

describe('BackupScannerService', () => {
  let service: BackupScannerService;
  const gamesSignal = signal<Game[]>([
    {
      stable_id: 101,
      id: 'smw-snes-rev0',
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
      id: 'smw-snes-rev1',
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
  ]);

  const platformsSignal = signal<Platform[]>([
    {
      id: 15,
      name: 'super-nintendo-entertainment-system',
      display_name: 'Super Nintendo Entertainment System',
      brand: 'Nintendo',
      launch_date: '1991-08-23',
      image_url: '',
    },
    {
      id: 33,
      name: 'playstation-vita',
      display_name: 'PlayStation Vita',
      brand: 'PlayStation',
      launch_date: '2011-12-17',
      image_url: '',
    },
  ]);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BackupScannerService,
        {
          provide: CollectionService,
          useValue: {
            games: gamesSignal.asReadonly(),
            platforms: platformsSignal.asReadonly(),
          },
        },
      ],
    });
    service = TestBed.inject(BackupScannerService);
  });

  it('crawls FileSystemDirectoryHandle recursively by name only and collapses Vita sce_sys/param.sfo container folders early', async () => {
    const rootHandle = createMockDirHandle('Backups', [
      createMockDirHandle('SNES', [
        createMockFileHandle('Super Mario World (USA) (Rev 1).sfc'),
      ]),
      createMockDirHandle('Vita', [
        createMockDirHandle('PCSE00120', [
          createMockDirHandle('sce_sys', [createMockFileHandle('param.sfo')]),
          createMockDirHandle('data', [createMockFileHandle('huge.bin')]),
        ]),
      ]),
    ]);

    const result = await service.crawlDirectoryHandle(rootHandle);
    expect(result.rootFolderName).toBe('Backups');
    expect(result.entries).toEqual([
      {
        relativePath: 'Backups/SNES/Super Mario World (USA) (Rev 1).sfc',
        fileName: 'Super Mario World (USA) (Rev 1).sfc',
      },
      {
        relativePath: 'Backups/Vita/PCSE00120.zip',
        fileName: 'PCSE00120.zip',
      },
    ]);
  });

  it('crawls FileList fallback via webkitRelativePath and builds scan report with ownership switches', () => {
    const crawl = service.crawlFromFileList([
      {
        name: 'Super Mario World (USA) (Rev 1).sfc',
        webkitRelativePath: 'Backups/SNES/Super Mario World (USA) (Rev 1).sfc',
      },
    ]);

    expect(crawl.rootFolderName).toBe('Backups');
    const report = service.buildScanReport({
      rootFolderName: crawl.rootFolderName,
      entries: crawl.entries,
    });

    expect(report.diff.releases.newlyBackedUp.map((r) => r.id)).toEqual([
      'smw-snes-rev1',
    ]);
    expect(report.ownershipSwitches).toHaveLength(1);
    expect(report.ownershipSwitches[0]).toMatchObject({
      fromReleaseIds: ['smw-snes-rev0'],
      toReleaseIds: ['smw-snes-rev1'],
      hasCase: 1,
      hasManual: 1,
      defaultSelected: true,
    });
  });
});
