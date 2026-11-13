/**
 * ISOMORPHIC BACKUP SCANNER & OWNERSHIP RECONCILIATION TESTS
 */

import { describe, it, expect } from 'vitest';
import {
  getScannedPlatformIds,
  findDbPlatform,
  findBestReleaseMatch,
  findBestReleaseMatchWithConfidence,
  findTolerantReleaseMatch,
  extractDiscNumber,
  normalizeRomBaseForMatching,
  getGameFileParts,
  isIgnoredFile,
  isUpdateOrDlcDump,
  collapseContainerDirectories,
  scanBackupEntries,
  computeOwnershipSwitches,
  GAME_EXTENSIONS,
  PlatformRow,
  ReleaseRow,
  CatalogReleaseCandidate,
  computeBackupNetDiffs,
  generateBackupDiffMarkdown,
  ReleaseDiffRow,
  GameDiffRow,
} from './backup_scanner.js';
import { stripDiscIndicator } from './queries.js';

describe('Isomorphic Backup Scanner & Ownership Reconciler', () => {
  const mockPlatforms: PlatformRow[] = [
    {
      id: 13,
      name: 'nintendo-entertainment-system',
      display_name: 'Nintendo Entertainment System',
      brand: 'Nintendo',
      launch_date: '1985-10-18',
      parent_platform_id: null,
    },
    {
      id: 15,
      name: 'super-nintendo-entertainment-system',
      display_name: 'Super Nintendo Entertainment System',
      brand: 'Nintendo',
      launch_date: '1991-08-23',
      parent_platform_id: null,
    },
    {
      id: 17,
      name: 'nintendo-64',
      display_name: 'Nintendo 64',
      brand: 'Nintendo',
      launch_date: '1996-09-29',
      parent_platform_id: null,
    },
    {
      id: 19,
      name: 'game-boy-advance',
      display_name: 'Game Boy Advance',
      brand: 'Nintendo',
      launch_date: '2001-06-11',
      parent_platform_id: null,
    },
    {
      id: 20,
      name: 'nintendo-gamecube',
      display_name: 'Nintendo GameCube',
      brand: 'Nintendo',
      launch_date: '2001-11-18',
      parent_platform_id: null,
    },
    {
      id: 22,
      name: 'wii',
      display_name: 'Wii',
      brand: 'Nintendo',
      launch_date: '2006-11-19',
      parent_platform_id: null,
    },
    {
      id: 23,
      name: 'nintendo-3ds',
      display_name: 'Nintendo 3DS',
      brand: 'Nintendo',
      launch_date: '2011-03-27',
      parent_platform_id: null,
    },
    {
      id: 24,
      name: 'wii-u',
      display_name: 'Wii U',
      brand: 'Nintendo',
      launch_date: '2012-11-18',
      parent_platform_id: null,
    },
    {
      id: 25,
      name: 'new-nintendo-3ds',
      display_name: 'New Nintendo 3DS',
      brand: 'Nintendo',
      launch_date: '2015-02-13',
      parent_platform_id: 23,
    },
    {
      id: 26,
      name: 'nintendo-switch',
      display_name: 'Nintendo Switch',
      brand: 'Nintendo',
      launch_date: '2017-03-03',
      parent_platform_id: null,
    },
    {
      id: 27,
      name: 'nintendo-switch-2',
      display_name: 'Nintendo Switch 2',
      brand: 'Nintendo',
      launch_date: '2025-06-05',
      parent_platform_id: null,
    },
    {
      id: 29,
      name: 'playstation',
      display_name: 'PlayStation',
      brand: 'PlayStation',
      launch_date: '1995-09-09',
      parent_platform_id: null,
    },
    {
      id: 33,
      name: 'playstation-vita',
      display_name: 'PlayStation Vita',
      brand: 'PlayStation',
      launch_date: '2011-12-17',
      parent_platform_id: null,
    },
    {
      id: 34,
      name: 'playstation-4',
      display_name: 'PlayStation 4',
      brand: 'PlayStation',
      launch_date: '2013-11-15',
      parent_platform_id: null,
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
      id: 53,
      name: 'famicom',
      display_name: 'Famicom',
      brand: 'Nintendo',
      launch_date: '1983-07-15',
      parent_platform_id: null,
    },
  ];

  describe('getScannedPlatformIds', () => {
    it('should map NES (13) and Famicom (53) symmetrically', () => {
      expect(getScannedPlatformIds(13)).toEqual([13, 53]);
      expect(getScannedPlatformIds(53)).toEqual([13, 53]);
      expect(getScannedPlatformIds(24)).toEqual([24]);
    });

    it('should dynamically resolve child platforms from platform hierarchy', () => {
      const ps4Scanned = getScannedPlatformIds(34, mockPlatforms);
      expect(ps4Scanned).toContain(34);
      expect(ps4Scanned).toContain(51);

      const ds3Scanned = getScannedPlatformIds(23, mockPlatforms);
      expect(ds3Scanned).toContain(23);
      expect(ds3Scanned).toContain(25);
    });
  });

  describe('findDbPlatform', () => {
    it('should map folder names to correct platform records', () => {
      const nesMatch = findDbPlatform(
        'Nintendo - Nintendo Entertainment System',
        mockPlatforms,
      );
      expect(nesMatch?.id).toBe(13);

      const wiiMatch = findDbPlatform('Wii', mockPlatforms);
      expect(wiiMatch?.id).toBe(22);

      const wiiuMatch = findDbPlatform('Wii U', mockPlatforms);
      expect(wiiuMatch?.id).toBe(24);
    });

    it('should strictly map Switch to Nintendo Switch and NOT Nintendo Switch 2', () => {
      const switchMatch = findDbPlatform('Switch', mockPlatforms);
      expect(switchMatch?.id).toBe(26);

      const switch2Match = findDbPlatform('Switch 2', mockPlatforms);
      expect(switch2Match?.id).toBe(27);
    });

    it('should map common emulator abbreviations', () => {
      expect(findDbPlatform('snes', mockPlatforms)?.id).toBe(15);
      expect(findDbPlatform('nes', mockPlatforms)?.id).toBe(13);
      expect(findDbPlatform('n64', mockPlatforms)?.id).toBe(17);
      expect(findDbPlatform('gba', mockPlatforms)?.id).toBe(19);
      expect(findDbPlatform('gc', mockPlatforms)?.id).toBe(20);
      expect(findDbPlatform('ps1', mockPlatforms)?.id).toBe(29);
      expect(findDbPlatform('3ds', mockPlatforms)?.id).toBe(23);
    });
  });

  describe('getGameFileParts, isIgnoredFile & isUpdateOrDlcDump', () => {
    it('should strip parentheticals and normalize ", The" and ", A" suffixes', () => {
      const partsThe = getGameFileParts('Legend of Zelda, The (USA).nes');
      expect(partsThe.base).toBe('The Legend of Zelda');
      expect(partsThe.ext).toBe('.nes');

      const partsA = getGameFileParts('Boy and His Blob, A (USA).nes');
      expect(partsA.base).toBe('A Boy and His Blob');
      expect(partsA.ext).toBe('.nes');
    });

    it('should correctly handle .xiso.iso dual extensions', () => {
      const parts = getGameFileParts('Halo - Combat Evolved (USA).xiso.iso');
      expect(parts.base).toBe('Halo - Combat Evolved');
      expect(parts.ext).toBe('.xiso.iso');
    });

    it('should NOT ignore .xiso.iso or .psv files', () => {
      expect(isIgnoredFile('Halo.xiso.iso')).toBe(false);
      expect(GAME_EXTENSIONS.has('.xiso.iso')).toBe(true);
      expect(isIgnoredFile('Persona 4 Golden (USA).psv')).toBe(false);
      expect(GAME_EXTENSIONS.has('.psv')).toBe(true);
    });

    it('should ignore sidecars, save states, desktop files, and macOS junk', () => {
      expect(isIgnoredFile('desktop.ini')).toBe(true);
      expect(isIgnoredFile('.DS_Store')).toBe(true);
      expect(isIgnoredFile('._game.nes')).toBe(true);
      expect(isIgnoredFile('game.sav')).toBe(true);
      expect(isIgnoredFile('game.state.auto')).toBe(true);
      expect(isIgnoredFile('playlist.m3u')).toBe(true);
      expect(isIgnoredFile('cover.png')).toBe(true);
      expect(isIgnoredFile('info.nfo')).toBe(true);
      expect(isIgnoredFile('EarthBound Beginnings (USA, Europe).nes')).toBe(
        false,
      );
    });

    it('should ignore secondary multi-track .bin files but keep Track 1', () => {
      expect(isIgnoredFile('Crash Bandicoot (USA) (Track 1).bin')).toBe(false);
      expect(isIgnoredFile('Crash Bandicoot (USA) (Track 2).bin')).toBe(true);
      expect(isIgnoredFile('Crash Bandicoot (USA) (Track 03).bin')).toBe(true);
      expect(isIgnoredFile('Crash Bandicoot (USA) (Track 12).bin')).toBe(true);
    });

    it('should ignore standalone [UPD], [DLC], and non-000 Switch patch/DLC TitleIDs while keeping revised base cartridges', () => {
      expect(
        isUpdateOrDlcDump('Bayonetta [010076F0049A2800][v65536][UPD].nsp'),
      ).toBe(true);
      expect(isIgnoredFile('Bayonetta [010076F0049A2800][v65536].nsp')).toBe(
        true,
      );
      expect(
        isIgnoredFile('Breath of the Wild DLC [01007EF00011F001][v0].nsp'),
      ).toBe(true);
      // Revised base cartridge TitleID still ends in 000
      expect(
        isIgnoredFile(
          'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
        ),
      ).toBe(false);
    });
  });

  describe('collapseContainerDirectories', () => {
    it('collapses Vita sce_sys/param.sfo, eboot.bin, and Xbox default.xex folders into single virtual .zip entries', () => {
      const rawEntries = [
        {
          relativePath: 'Backups/Vita/PCSE00120/sce_sys/param.sfo',
          fileName: 'param.sfo',
        },
        {
          relativePath: 'Backups/Vita/PCSE00120/eboot.bin',
          fileName: 'eboot.bin',
        },
        {
          relativePath: 'Backups/Vita/PCSE00120/data/bgm.at9',
          fileName: 'bgm.at9',
        },
        {
          relativePath: 'Backups/SNES/Chrono Trigger (USA).sfc',
          fileName: 'Chrono Trigger (USA).sfc',
        },
      ];

      const collapsed = collapseContainerDirectories(rawEntries);
      expect(collapsed).toEqual([
        {
          relativePath: 'Backups/Vita/PCSE00120.zip',
          fileName: 'PCSE00120.zip',
        },
        {
          relativePath: 'Backups/SNES/Chrono Trigger (USA).sfc',
          fileName: 'Chrono Trigger (USA).sfc',
        },
      ]);
    });
  });

  describe('findBestReleaseMatch for Extracted ROMs & Bundles', () => {
    const mockReleases: ReleaseRow[] = [
      {
        id: 'rel-earthbound-beginnings',
        game_id: 101,
        title: 'EarthBound Beginnings',
        rom_name: 'EarthBound Beginnings (USA, Europe) (Virtual Console).nes',
        stable_id: 101,
        region: 'USA, Europe',
      },
      {
        id: 'rel-bayo1',
        game_id: 201,
        title: 'Bayonetta',
        rom_name: 'Bayonetta (USA) (Disc 2).wux',
        stable_id: 201,
        region: 'USA',
      },
      {
        id: 'rel-bayo2',
        game_id: 202,
        title: 'Bayonetta 2',
        rom_name: 'Bayonetta 2 (USA) (Disc 1).wux',
        stable_id: 202,
        region: 'USA',
      },
      {
        id: 'rel-rodea-wii',
        game_id: 301,
        title: 'Rodea the Sky Soldier',
        rom_name: 'Rodea the Sky Soldier (USA) (Bonus Disc).rvz',
        stable_id: 301,
        region: 'USA',
      },
      {
        id: 'rel-smw',
        game_id: 401,
        title: 'Super Mario World',
        rom_name: 'Super Mario World (USA).sfc',
        stable_id: 401,
        region: 'USA',
      },
      {
        id: 'rel-ff7',
        game_id: 501,
        title: 'Final Fantasy VII',
        rom_name: 'Final Fantasy VII (USA) (Disc 1).cue',
        stable_id: 501,
        region: 'USA',
      },
      {
        id: 'rel-mmbn',
        game_id: 601,
        title: 'Mega Man Battle Network',
        rom_name: 'Mega Man - Battle Network (USA).gba',
        stable_id: 601,
        region: 'USA',
      },
      {
        id: 'rel-ww',
        game_id: 701,
        title: 'The Legend of Zelda: The Wind Waker',
        rom_name: 'Legend of Zelda, The - The Wind Waker (USA, Canada).iso',
        stable_id: 701,
        region: 'USA, Canada',
      },
      {
        id: 'rel-jgr',
        game_id: 801,
        title: 'Jet Grind Radio',
        rom_name: 'Jet Grind Radio (USA).cue',
        stable_id: 801,
        region: 'USA',
      },
      {
        id: 'rel-cc-d1',
        game_id: 901,
        title: 'Chrono Cross',
        rom_name: 'Chrono Cross (USA, Canada) (Disc 1).cue',
        stable_id: 901,
        region: 'USA, Canada',
      },
      {
        id: 'rel-cc-d2',
        game_id: 901,
        title: 'Chrono Cross',
        rom_name: 'Chrono Cross (USA, Canada) (Disc 2).cue',
        stable_id: 901,
        region: 'USA, Canada',
      },
      {
        id: 'rel-sa',
        game_id: 1001,
        title: 'Sonic Adventure',
        rom_name: 'Sonic Adventure (USA) (En,Ja,Fr,De,Es).cue',
        stable_id: 1001,
        region: 'USA',
      },
      {
        id: 'rel-wily-wars',
        game_id: 1101,
        title: 'Mega Man: The Wily Wars',
        rom_name: 'Mega Man - The Wily Wars (World) (Retro-Bit).md',
        stable_id: 1101,
        region: 'World',
      },
    ];

    it('should match canonical extracted ROMs exactly on target hardware', () => {
      const matched = findBestReleaseMatch(
        'EarthBound Beginnings (USA, Europe) (Virtual Console).nes',
        mockReleases,
      );
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('rel-earthbound-beginnings');
    });

    it('should match case-insensitively', () => {
      const matched = findBestReleaseMatch(
        'super mario world (usa).sfc',
        mockReleases,
      );
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('rel-smw');
    });

    it('should recognize .wua in GAME_EXTENSIONS', () => {
      expect(GAME_EXTENSIONS.has('.wua')).toBe(true);
    });

    it('should not truncate titles containing dots when stripping disc indicators', () => {
      expect(stripDiscIndicator('Super Mario Bros. 3 (USA).nes')).toBe(
        'super mario bros. 3 (usa)',
      );
      expect(stripDiscIndicator('Super Mario Bros. 3 (USA)')).toBe(
        'super mario bros. 3 (usa)',
      );
    });

    it('should normalize Megaman spacing in normalizeRomBaseForMatching', () => {
      expect(
        normalizeRomBaseForMatching('Megaman - Battle Network (USA)'),
      ).toBe('mega man - battle network (usa)');
    });

    it('should match Megaman backup without spaces to Mega Man release in findBestReleaseMatch', () => {
      const match = findBestReleaseMatch(
        'Megaman - Battle Network (USA).gba',
        mockReleases,
      );
      expect(match).not.toBeNull();
      expect(match?.id).toBe('rel-mmbn');
    });

    it('should match (USA) backup to (USA, Canada) release in findBestReleaseMatch', () => {
      const match = findBestReleaseMatch(
        'Legend of Zelda, The - The Wind Waker (USA).rvz',
        mockReleases,
      );
      expect(match).not.toBeNull();
      expect(match?.id).toBe('rel-ww');
    });

    it('should match Dreamcast (Track 1).bin backup to .cue release in findBestReleaseMatch', () => {
      const match = findBestReleaseMatch(
        'Jet Grind Radio (USA) (Track 1).bin',
        mockReleases,
      );
      expect(match).not.toBeNull();
      expect(match?.id).toBe('rel-jgr');
    });

    it('should match multi-disc secondary discs and merged chd packages to base release', () => {
      const disc2Match = findBestReleaseMatch(
        'Final Fantasy VII (USA) (Disc 2).chd',
        mockReleases,
      );
      expect(disc2Match).not.toBeNull();
      expect(disc2Match?.id).toBe('rel-ff7');

      const mergedMatch = findBestReleaseMatch(
        'Final Fantasy VII (USA).chd',
        mockReleases,
      );
      expect(mergedMatch).not.toBeNull();
      expect(mergedMatch?.id).toBe('rel-ff7');
    });

    it('should match individual bundle disc files for multi-game boxes', () => {
      const bayo1Match = findBestReleaseMatch(
        'Bayonetta (USA) (Disc 2).wux',
        mockReleases,
      );
      expect(bayo1Match).not.toBeNull();
      expect(bayo1Match?.title).toBe('Bayonetta');

      const rodeaWiiMatch = findBestReleaseMatch(
        'Rodea the Sky Soldier (USA) (Bonus Disc).rvz',
        mockReleases,
      );
      expect(rodeaWiiMatch).not.toBeNull();
      expect(rodeaWiiMatch?.id).toBe('rel-rodea-wii');
    });

    it('should match multi-disc backups strictly to matching disc releases when both are present', () => {
      const disc1Match = findBestReleaseMatch(
        'Chrono Cross (USA) (Disc 1).chd',
        mockReleases,
      );
      expect(disc1Match).not.toBeNull();
      expect(disc1Match?.id).toBe('rel-cc-d1');

      const disc2Match = findBestReleaseMatch(
        'Chrono Cross (USA) (Disc 2).chd',
        mockReleases,
      );
      expect(disc2Match).not.toBeNull();
      expect(disc2Match?.id).toBe('rel-cc-d2');
    });

    it('should match backups without Redump language codes to releases containing Redump language tags', () => {
      const sonicMatch = findBestReleaseMatch(
        'Sonic Adventure (USA).cue',
        mockReleases,
      );
      expect(sonicMatch).not.toBeNull();
      expect(sonicMatch?.id).toBe('rel-sa');
    });

    it('should match USA backup to World Retro-Bit reprint release', () => {
      const mmMatch = findBestReleaseMatch(
        'Mega Man - The Wily Wars (USA).md',
        mockReleases,
      );
      expect(mmMatch).not.toBeNull();
      expect(mmMatch?.id).toBe('rel-wily-wars');
    });

    it('should extract disc numbers accurately', () => {
      expect(extractDiscNumber('Chrono Cross (USA) (Disc 2).chd')).toBe('2');
      expect(extractDiscNumber('Final Fantasy IX (USA) (Disc 4).chd')).toBe(
        '4',
      );
      expect(extractDiscNumber('Super Mario 64 (USA).z64')).toBeNull();
    });

    it('should find tolerant release matches when regional naming discrepancies exist', () => {
      const tolerantMatch = findTolerantReleaseMatch(
        'EarthBound Beginnings (Virtual Console) (USA).nes',
        mockReleases,
      );
      expect(tolerantMatch).not.toBeNull();
      expect(tolerantMatch?.id).toBe('rel-earthbound-beginnings');
    });

    it('should match Vita cartridge .zip backups and Title IDs with exact confidence', () => {
      const vitaReleases: ReleaseRow[] = [
        {
          id: 'p4g-vita-usa',
          game_id: 100,
          title: 'Persona 4 Golden',
          rom_name: 'Persona 4 Golden (USA).zip',
          stable_id: 100,
          region: 'USA',
          serial_code: 'PCSE-00120',
        },
      ];

      const matchSerial = findBestReleaseMatchWithConfidence(
        'PCSE00120.zip',
        vitaReleases,
      );
      expect(matchSerial?.release.id).toBe('p4g-vita-usa');
      expect(matchSerial?.confidence).toBe('exact');
    });
  });

  describe('computeOwnershipSwitches (5 Safety Guards)', () => {
    it('Guard 1 & 5: proposes pre-selected same-region revision switch and preserves has_case / has_manual', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'smw-usa-rev0',
          game_id: 101,
          game_slug: 'super-mario-world',
          title: 'Super Mario World',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: 'Super Mario World (USA).sfc',
          region: 'USA',
          variants: null,
          ownership_status: 1,
          backup_status: 0,
          has_case: 1,
          has_manual: 1,
        },
        {
          id: 'smw-usa-rev1',
          game_id: 101,
          game_slug: 'super-mario-world',
          title: 'Super Mario World',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: 'Super Mario World (USA) (Rev 1).sfc',
          region: 'USA',
          variants: 'Rev 1',
          ownership_status: 0,
          backup_status: 0,
          has_case: 0,
          has_manual: 0,
        },
      ];

      const matchedIds = new Set(['smw-usa-rev1']);
      const confidenceMap = new Map([['smw-usa-rev1', 'exact' as const]]);
      const fileMap = new Map([
        ['smw-usa-rev1', 'Super Mario World (USA) (Rev 1).sfc'],
      ]);

      const switches = computeOwnershipSwitches(
        catalog,
        matchedIds,
        confidenceMap,
        fileMap,
      );

      expect(switches).toHaveLength(1);
      expect(switches[0]).toMatchObject({
        gameId: 101,
        gameTitle: 'Super Mario World',
        fromReleaseIds: ['smw-usa-rev0'],
        toReleaseIds: ['smw-usa-rev1'],
        hasCase: 1,
        hasManual: 1,
        isRegionChange: false,
        defaultSelected: true,
      });
    });

    it('Guard 5: proposes cross-region ownership switch as unchecked by default (defaultSelected: false)', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'ct-usa',
          game_id: 102,
          title: 'Chrono Trigger',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: 'Chrono Trigger (USA).sfc',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'ct-jpn',
          game_id: 102,
          title: 'Chrono Trigger',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: 'Chrono Trigger (Japan).sfc',
          region: 'Japan',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['ct-jpn']),
        new Map([['ct-jpn', 'exact']]),
        new Map([['ct-jpn', 'Chrono Trigger (Japan).sfc']]),
      );

      expect(switches).toHaveLength(1);
      expect(switches[0].isRegionChange).toBe(true);
      expect(switches[0].defaultSelected).toBe(false);
    });

    it('Guard 1: partial dump of an already-owned multi-disc SKU confirms the owned SKU and does NOT propose a switch', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'ff7-d1',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 1).cue',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'ff7-d2',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 2).cue',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
      ];

      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['ff7-d1']),
        new Map([['ff7-d1', 'exact']]),
        new Map([['ff7-d1', 'Final Fantasy VII (USA) (Disc 1).chd']]),
      );

      expect(switches).toHaveLength(0);
    });

    it('Guard 1: switching to a multi-disc target SKU includes all target SKU discs in toReleaseIds', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'ff7-rev0-d1',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 1).cue',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
          has_case: 1,
        },
        {
          id: 'ff7-rev0-d2',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 2).cue',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
          has_case: 1,
        },
        {
          id: 'ff7-rev1-d1',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 1) (Rev 1).cue',
          region: 'USA',
          variants: 'Rev 1',
          ownership_status: 0,
          backup_status: 0,
        },
        {
          id: 'ff7-rev1-d2',
          game_id: 501,
          title: 'Final Fantasy VII',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Final Fantasy VII (USA) (Disc 2) (Rev 1).cue',
          region: 'USA',
          variants: 'Rev 1',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      // Only Disc 1 of Rev 1 was dumped so far
      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['ff7-rev1-d1']),
        new Map([['ff7-rev1-d1', 'exact']]),
        new Map([
          ['ff7-rev1-d1', 'Final Fantasy VII (USA) (Disc 1) (Rev 1).chd'],
        ]),
      );

      expect(switches).toHaveLength(1);
      expect(switches[0].fromReleaseIds).toEqual([
        'ff7-rev0-d1',
        'ff7-rev0-d2',
      ]);
      expect(switches[0].toReleaseIds).toEqual(['ff7-rev1-d1', 'ff7-rev1-d2']);
      expect(switches[0].hasCase).toBe(1);
    });

    it('Guard 2: does not propose switch when an owned SKU is also matched or when multiple owned SKUs exist', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'rel-owned-1',
          game_id: 300,
          title: 'Zelda',
          platform_id: 15,
          platform_name: 'SNES',
          rom_name: 'Zelda (USA).sfc',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'rel-owned-2',
          game_id: 300,
          title: 'Zelda',
          platform_id: 15,
          platform_name: 'SNES',
          rom_name: 'Zelda (Japan).sfc',
          region: 'Japan',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'rel-unowned-3',
          game_id: 300,
          title: 'Zelda',
          platform_id: 15,
          platform_name: 'SNES',
          rom_name: 'Zelda (Europe).sfc',
          region: 'Europe',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['rel-unowned-3']),
        new Map([['rel-unowned-3', 'exact']]),
        new Map([['rel-unowned-3', 'Zelda (Europe).sfc']]),
      );

      expect(switches).toHaveLength(0);
    });

    it('Guard 3: excludes pack-in demo bonus discs from triggering or blocking ownership switches', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'tron-bonne-usa',
          game_id: 600,
          title: 'The Misadventures of Tron Bonne',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Misadventures of Tron Bonne, The (USA).cue',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'mml2-demo',
          game_id: 600,
          title: 'The Misadventures of Tron Bonne',
          platform_id: 29,
          platform_name: 'PlayStation',
          rom_name: 'Mega Man Legends 2 (USA) (Demo).cue',
          region: 'USA',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['mml2-demo']),
        new Map([['mml2-demo', 'exact']]),
        new Map([['mml2-demo', 'Mega Man Legends 2 (USA) (Demo).cue']]),
      );

      expect(switches).toHaveLength(0);
    });

    it('Guard 4: does not propose ownership switch on clean_fallback match confidence', () => {
      const catalog: CatalogReleaseCandidate[] = [
        {
          id: 'smw-usa',
          game_id: 101,
          title: 'Super Mario World',
          platform_id: 15,
          platform_name: 'SNES',
          rom_name: 'Super Mario World (USA).sfc',
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'smw-eur',
          game_id: 101,
          title: 'Super Mario World',
          platform_id: 15,
          platform_name: 'SNES',
          rom_name: 'Super Mario World (Europe).sfc',
          region: 'Europe',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const switches = computeOwnershipSwitches(
        catalog,
        new Set(['smw-eur']),
        new Map([['smw-eur', 'clean_fallback']]),
        new Map([['smw-eur', 'Super Mario World.sfc']]),
      );

      expect(switches).toHaveLength(0);
    });
  });

  describe('scanBackupEntries end-to-end client pipeline', () => {
    const catalogReleases: CatalogReleaseCandidate[] = [
      {
        id: 'bayo-sw-rev0',
        game_id: 500,
        game_slug: 'bayonetta-switch',
        title: 'Bayonetta',
        base_title: 'Bayonetta',
        platform_id: 26,
        platform_name: 'Nintendo Switch',
        rom_name: null,
        serial_code: 'LA-H-AE98A-USA',
        region: 'USA',
        variants: 'Rev 000 (v1.0)',
        canonical_release_id: 10,
        ownership_status: 1,
        backup_status: 0,
        has_case: 1,
        has_manual: 0,
      },
      {
        id: 'bayo-sw-rev1',
        game_id: 500,
        game_slug: 'bayonetta-switch',
        title: 'Bayonetta',
        base_title: 'Bayonetta',
        platform_id: 26,
        platform_name: 'Nintendo Switch',
        rom_name: null,
        serial_code: 'LA-H-AE98A-USA',
        region: 'USA',
        variants: 'Rev 001 (v1.1)',
        canonical_release_id: 11,
        ownership_status: 0,
        backup_status: 0,
        has_case: 0,
        has_manual: 0,
      },
      {
        id: 'smw-snes-usa',
        game_id: 101,
        game_slug: 'super-mario-world',
        title: 'Super Mario World',
        base_title: 'Super Mario World',
        platform_id: 15,
        platform_name: 'Super Nintendo Entertainment System',
        rom_name: 'Super Mario World (USA).sfc',
        region: 'USA',
        ownership_status: 1,
        backup_status: 1,
      },
    ];

    it('auto-detects multi-platform root, matches Switch nxdumptool revision, proposes ownership switch, and collects ignored digital-only files', () => {
      const report = scanBackupEntries({
        rootFolderName: 'Backups',
        platforms: mockPlatforms,
        catalogReleases,
        entries: [
          {
            relativePath:
              'Backups/Switch/Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
            fileName:
              'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Backups/Switch/Bayonetta [010076F0049A2800][v65536].nsp',
            fileName: 'Bayonetta [010076F0049A2800][v65536].nsp',
          },
          {
            relativePath:
              'Backups/Switch/Digital Indie Only [0100ABCDEF000000][v0].nsp',
            fileName: 'Digital Indie Only [0100ABCDEF000000][v0].nsp',
          },
          {
            relativePath: 'Backups/SNES/desktop.ini',
            fileName: 'desktop.ini',
          },
        ],
      });

      expect(report.detectedMode).toBe('multi_platform_root');
      expect(report.matchedReleaseIds.has('bayo-sw-rev1')).toBe(true);
      expect(report.diff.releases.newlyBackedUp.map((r) => r.id)).toEqual([
        'bayo-sw-rev1',
      ]);
      expect(report.ownershipSwitches).toHaveLength(1);
      expect(report.ownershipSwitches[0]).toMatchObject({
        gameId: 500,
        fromReleaseIds: ['bayo-sw-rev0'],
        toReleaseIds: ['bayo-sw-rev1'],
        hasCase: 1,
        defaultSelected: true,
      });
      // Digital Indie Only is quietly recorded in ignoredUnmatchedFiles; update NSP and desktop.ini are filtered by isIgnoredFile
      expect(report.ignoredUnmatchedFiles).toHaveLength(1);
      expect(report.ignoredUnmatchedFiles[0].fileName).toBe(
        'Digital Indie Only [0100ABCDEF000000][v0].nsp',
      );
    });

    it('auto-detects single-platform folder when selecting a platform directory directly', () => {
      const report = scanBackupEntries({
        rootFolderName: 'SNES',
        platforms: mockPlatforms,
        catalogReleases,
        entries: [
          {
            relativePath: 'SNES/Super Mario World (USA).sfc',
            fileName: 'Super Mario World (USA).sfc',
          },
        ],
      });

      expect(report.detectedMode).toBe('single_platform');
      expect(report.matchedReleaseIds.has('smw-snes-usa')).toBe(true);
      expect(report.diff.releases.unchangedBackedUpCount).toBe(1);
    });

    it('preserves owned USA release for 1-2-Switch when Europe, Japan, and USA share canonical_release_id and Europe is sorted first', () => {
      const switchReleases: CatalogReleaseCandidate[] = [
        {
          id: '1-2-switch-nintendo-switch-eur',
          game_id: 1471,
          game_slug: '1-2-switch',
          title: '1-2-Switch',
          base_title: '1-2-Switch',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'Europe',
          variants: 'Rev 000 (v1.0.0)',
          canonical_release_id: 1192153,
          ownership_status: 0,
          backup_status: 0,
        },
        {
          id: '1-2-switch-nintendo-switch-jpn',
          game_id: 1471,
          game_slug: '1-2-switch',
          title: '1-2-Switch',
          base_title: '1-2-Switch',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'Japan',
          variants: 'Rev 000 (v1.0.0)',
          canonical_release_id: 1192153,
          ownership_status: 0,
          backup_status: 0,
        },
        {
          id: '1-2-switch-nintendo-switch-usa',
          game_id: 1471,
          game_slug: '1-2-switch',
          title: '1-2-Switch',
          base_title: '1-2-Switch',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.0)',
          canonical_release_id: 1192153,
          ownership_status: 1,
          backup_status: 1,
          has_case: 1,
          has_manual: 0,
        },
        {
          id: '1-2-switch-nintendo-switch-usa-rev1',
          game_id: 1471,
          game_slug: '1-2-switch',
          title: '1-2-Switch',
          base_title: '1-2-Switch',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 001 (v1.1.0)',
          canonical_release_id: 1192151,
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const report = scanBackupEntries({
        rootFolderName: 'Switch',
        platforms: mockPlatforms,
        catalogReleases: switchReleases,
        entries: [
          {
            relativePath:
              'Switch/1-2-Switch [01000320000CC000][v0] [NKA][NC][NT].xci',
            fileName: '1-2-Switch [01000320000CC000][v0] [NKA][NC][NT].xci',
          },
        ],
      });

      expect(
        report.matchedReleaseIds.has('1-2-switch-nintendo-switch-usa'),
      ).toBe(true);
      expect(
        report.matchedReleaseIds.has('1-2-switch-nintendo-switch-eur'),
      ).toBe(false);
      expect(report.ownershipSwitches).toHaveLength(0);
    });

    it('matches multi-game Switch cartridges including Child of Light + Valiant Hearts, Pikmin 1+2 Bundle, and Ori: The Collection', () => {
      const multiGameCatalog: CatalogReleaseCandidate[] = [
        {
          id: 'col-vh-usa',
          game_id: 1512,
          game_slug: 'child-of-light-valiant-hearts',
          title:
            'Child of Light: Ultimate Edition + Valiant Hearts: The Great War',
          base_title:
            'Child of Light: Ultimate Edition + Valiant Hearts: The Great War',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.0, 1.0.0)',
          canonical_release_id: 1192227,
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'ori-standalone-1',
          game_id: 1581,
          title: 'Ori and the Blind Forest: Definitive Edition',
          base_title: 'Ori and the Blind Forest: Definitive Edition',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.0)',
          ownership_status: 0,
          backup_status: 0,
        },
        {
          id: 'ori-collection-usa',
          game_id: 1583,
          title: 'Ori: The Collection',
          base_title: 'Ori: The Collection',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.1, 1.2.0)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'pikmin-12-usa',
          game_id: 1621,
          title: 'Pikmin 1+2 Bundle',
          base_title: 'Pikmin 1+2 Bundle',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.1, 1.0.1)',
          ownership_status: 1,
          backup_status: 0,
        },
      ];

      const report = scanBackupEntries({
        rootFolderName: 'Switch',
        platforms: mockPlatforms,
        catalogReleases: multiGameCatalog,
        entries: [
          {
            relativePath:
              'Switch/Child of Light [01007D000AD8A000][v0] + Valiant Hearts_ The Great War [010099700B01A000][v0] [NKA][NC][NT].xci',
            fileName:
              'Child of Light [01007D000AD8A000][v0] + Valiant Hearts_ The Great War [010099700B01A000][v0] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Switch/Ori and the Blind Forest_ Definitive Edition 1.0.1 [010061B00DA7E000][v65536] + Ori and the Will of the Wisps 1.2.0 [01001A900E240000][v131072] [NKA][NC][NT].xci',
            fileName:
              'Ori and the Blind Forest_ Definitive Edition 1.0.1 [010061B00DA7E000][v65536] + Ori and the Will of the Wisps 1.2.0 [01001A900E240000][v131072] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Switch/Pikmin 1.0.1 [010035301AA46000][v65536] + Pikmin 2 1.0.1 [0100DC001AA48000][v65536] [NKA][NC][NT].xci',
            fileName:
              'Pikmin 1.0.1 [010035301AA46000][v65536] + Pikmin 2 1.0.1 [0100DC001AA48000][v65536] [NKA][NC][NT].xci',
          },
        ],
      });

      expect(report.matchedReleaseIds.has('col-vh-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('ori-collection-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('ori-standalone-1')).toBe(false);
      expect(report.matchedReleaseIds.has('pikmin-12-usa')).toBe(true);
      expect(report.ignoredUnmatchedFiles).toHaveLength(0);
      expect(report.ownershipSwitches).toHaveLength(0);
    });

    it('matches unlinked catalog releases (rom_name === null) via clean_fallback without proposing false ownership switches', () => {
      const unlinkedCatalog: CatalogReleaseCandidate[] = [
        {
          id: 'zelda-tp-hd-eur-default',
          game_id: 2001,
          title: 'The Legend of Zelda: Twilight Princess HD',
          base_title: 'The Legend of Zelda: Twilight Princess HD',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: null,
          region: 'Europe',
          ownership_status: 0,
          backup_status: 0,
        },
        {
          id: 'zelda-tp-hd-usa-default',
          game_id: 2001,
          title: 'The Legend of Zelda: Twilight Princess HD',
          base_title: 'The Legend of Zelda: Twilight Princess HD',
          platform_id: 15,
          platform_name: 'Super Nintendo Entertainment System',
          rom_name: null,
          region: 'USA',
          ownership_status: 1,
          backup_status: 0,
        },
      ];

      const report = scanBackupEntries({
        rootFolderName: 'SNES',
        platforms: mockPlatforms,
        catalogReleases: unlinkedCatalog,
        entries: [
          {
            relativePath:
              'SNES/The Legend of Zelda - Twilight Princess HD (USA).sfc',
            fileName: 'The Legend of Zelda - Twilight Princess HD (USA).sfc',
          },
        ],
      });

      expect(report.matchedReleaseIds.has('zelda-tp-hd-usa-default')).toBe(
        true,
      );
      expect(
        report.matchConfidenceByReleaseId.get('zelda-tp-hd-usa-default'),
      ).toBe('clean_fallback');
      expect(report.ownershipSwitches).toBeDefined();
      expect(report.ownershipSwitches).toHaveLength(0);
    });

    it('matches Darkest Dungeon Ancestral Edition, Dave the Diver Anniversary Edition, truncated Final Fantasy I-VI, and letter-suffixed Switch versions while deduplicating ownership switches from lostBackup and preserving SKU labels', () => {
      const switchCatalog: CatalogReleaseCandidate[] = [
        {
          id: 'dd-ancestral-usa',
          game_id: 3001,
          title: 'Darkest Dungeon: Ancestral Edition',
          base_title: 'Darkest Dungeon: Ancestral Edition',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.0)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'dave-diver-usa',
          game_id: 3002,
          title: 'Dave the Diver: Anniversary Edition',
          base_title: 'Dave the Diver: Anniversary Edition',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.2.651)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'ff-pixel-usa',
          game_id: 3003,
          title: 'Final Fantasy: Pixel Remaster Collection',
          base_title: 'Final Fantasy: Pixel Remaster Collection',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.0)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'ender-lilies-usa',
          game_id: 3004,
          title: 'Ender Lilies: Quietus of the Knights',
          base_title: 'Ender Lilies: Quietus of the Knights',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 002 (v1.1.5c)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'etherborn-usa',
          game_id: 3005,
          title: 'Etherborn',
          base_title: 'Etherborn',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.0.3s)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'fp2-usa',
          game_id: 3006,
          title: 'Freedom Planet 2',
          base_title: 'Freedom Planet 2',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v1.2.8r)',
          ownership_status: 1,
          backup_status: 0,
        },
        {
          id: 'bloodstained-usa-rev1',
          game_id: 3007,
          title: 'Bloodstained: Ritual of the Night',
          base_title: 'Bloodstained: Ritual of the Night',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 001 (v1.03)',
          ownership_status: 1,
          backup_status: 1,
          has_case: 1,
        },
        {
          id: 'bloodstained-usa-rev0',
          game_id: 3007,
          title: 'Bloodstained: Ritual of the Night',
          base_title: 'Bloodstained: Ritual of the Night',
          platform_id: 26,
          platform_name: 'Nintendo Switch',
          rom_name: null,
          region: 'USA',
          variants: 'Rev 000 (v0.10)',
          ownership_status: 0,
          backup_status: 0,
        },
      ];

      const report = scanBackupEntries({
        rootFolderName: 'Nintendo Switch',
        platforms: mockPlatforms,
        catalogReleases: switchCatalog,
        entries: [
          {
            relativePath:
              'Nintendo Switch/Darkest Dungeon [01008A700989A000][v0] [NKA][NC][NT].xci',
            fileName:
              'Darkest Dungeon [01008A700989A000][v0] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/DAVE THE DIVER v1.0.2.651 [010097F018538000][v720896] + The Art of DAVE THE DIVER [01005EC01E6A4000][v0] [NKA][NC][NT].xci',
            fileName:
              'DAVE THE DIVER v1.0.2.651 [010097F018538000][v720896] + The Art of DAVE THE DIVER [01005EC01E6A4000][v0] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/FINAL FANTASY [01000EA014150000][v0] + FINAL FANTASY II [01006B7014156000][v0] + FINAL FANTASY III [01002E2014158000][v0] + FINAL FANTASY IV [01004B301415A000][v65536] + FINAL FANTASY V [0100AA201415C000][v65536] + FINAL FANTASY VI [0100 [NKA][NC][NT].xci',
            fileName:
              'FINAL FANTASY [01000EA014150000][v0] + FINAL FANTASY II [01006B7014156000][v0] + FINAL FANTASY III [01002E2014158000][v0] + FINAL FANTASY IV [01004B301415A000][v65536] + FINAL FANTASY V [0100AA201415C000][v65536] + FINAL FANTASY VI [0100 [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/ENDER LILIES_ Quietus of the Knights 1.1.5c [0100CCF012E9A000][v458752] [NKA][NC][NT].xci',
            fileName:
              'ENDER LILIES_ Quietus of the Knights 1.1.5c [0100CCF012E9A000][v458752] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/Etherborn 1.0.3s [01000E200BE10000][v196608] [NKA][NC][NT].xci',
            fileName:
              'Etherborn 1.0.3s [01000E200BE10000][v196608] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/Freedom Planet 2 1.2.8r [01009A301B6D8000][v196608] [NKA][NC][NT].xci',
            fileName:
              'Freedom Planet 2 1.2.8r [01009A301B6D8000][v196608] [NKA][NC][NT].xci',
          },
          {
            relativePath:
              'Nintendo Switch/Bloodstained_ Ritual of the Night [0100BF500207C000][v0] [NKA][NC][NT].xci',
            fileName:
              'Bloodstained_ Ritual of the Night [0100BF500207C000][v0] [NKA][NC][NT].xci',
          },
        ],
      });

      expect(report.ignoredUnmatchedFiles).toHaveLength(0);
      expect(report.matchedReleaseIds.has('dd-ancestral-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('dave-diver-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('ff-pixel-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('ender-lilies-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('etherborn-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('fp2-usa')).toBe(true);
      expect(report.matchedReleaseIds.has('bloodstained-usa-rev0')).toBe(true);

      // Bloodstained proposes same-region switch USA Rev 001 -> USA Rev 000 (pre-selected)
      expect(report.ownershipSwitches).toHaveLength(1);
      expect(report.ownershipSwitches[0]).toMatchObject({
        gameId: 3007,
        fromReleaseIds: ['bloodstained-usa-rev1'],
        toReleaseIds: ['bloodstained-usa-rev0'],
        isRegionChange: false,
        defaultSelected: true,
      });

      // Bloodstained's old release ('bloodstained-usa-rev1') is NOT duplicated in lostBackup
      expect(report.diff.releases.lostBackup).toHaveLength(0);

      // Newly backed up rows without a database rom_name display their SKU label (region • version)
      const ddRow = report.diff.releases.newlyBackedUp.find(
        (r) => r.id === 'dd-ancestral-usa',
      );
      expect(ddRow?.rom_name).toBe('USA • Rev 000 (v1.0.0)');
    });
  });

  describe('computeBackupNetDiffs & Markdown Diff Generation', () => {
    const priorReleases: ReleaseDiffRow[] = [
      {
        id: 'rel-1',
        game_id: 101,
        title: 'Super Mario World',
        platform_name: 'Super Nintendo Entertainment System',
        rom_name: 'Super Mario World (USA).sfc',
        backup_status: 1,
      },
      {
        id: 'rel-2',
        game_id: 102,
        title: 'Chrono Trigger',
        platform_name: 'Super Nintendo Entertainment System',
        rom_name: 'Chrono Trigger (USA).sfc',
        backup_status: 0,
      },
      {
        id: 'rel-3',
        game_id: 103,
        title: 'Secret of Mana',
        platform_name: 'Super Nintendo Entertainment System',
        rom_name: 'Secret of Mana (USA).sfc',
        backup_status: 1,
      },
      {
        id: 'rel-4',
        game_id: 104,
        title: 'EarthBound',
        platform_name: 'Super Nintendo Entertainment System',
        rom_name: 'EarthBound (USA).sfc',
        backup_status: 0,
      },
    ];

    const priorGames: GameDiffRow[] = [
      {
        stable_id: 101,
        title: 'Super Mario World',
        platform_id: 15,
        platform_name: 'Super Nintendo Entertainment System',
        backup_status: 1,
      },
      {
        stable_id: 102,
        title: 'Chrono Trigger',
        platform_id: 15,
        platform_name: 'Super Nintendo Entertainment System',
        backup_status: 0,
      },
      {
        stable_id: 103,
        title: 'Secret of Mana',
        platform_id: 15,
        platform_name: 'Super Nintendo Entertainment System',
        backup_status: 1,
      },
      {
        stable_id: 104,
        title: 'EarthBound',
        platform_id: 15,
        platform_name: 'Super Nintendo Entertainment System',
        backup_status: 0,
      },
    ];

    it('correctly calculates releases and games diff transitions', () => {
      const matched = new Set(['rel-1', 'rel-2']);
      const diff = computeBackupNetDiffs(priorReleases, priorGames, matched);

      expect(diff.releases.newlyBackedUp.map((r) => r.id)).toEqual(['rel-2']);
      expect(diff.releases.lostBackup.map((r) => r.id)).toEqual(['rel-3']);
      expect(diff.releases.unchangedBackedUpCount).toBe(1);
      expect(diff.releases.unchangedUnbackedCount).toBe(1);
      expect(diff.releases.totalTargetBackedUp).toBe(2);

      expect(diff.games.newlyBackedUp.map((g) => g.stable_id)).toEqual([102]);
      expect(diff.games.lostBackup.map((g) => g.stable_id)).toEqual([103]);
      expect(diff.games.unchangedBackedUpCount).toBe(1);
      expect(diff.games.unchangedUnbackedCount).toBe(1);
      expect(diff.games.totalTargetBackedUp).toBe(2);
    });

    it('generates structured markdown with summary and diff tables', () => {
      const matched = new Set(['rel-1', 'rel-2']);
      const diff = computeBackupNetDiffs(priorReleases, priorGames, matched);
      const stats = {
        'Super Nintendo Entertainment System': { scanned: 10, matched: 2 },
      };

      const md = generateBackupDiffMarkdown(
        diff,
        stats,
        '/test/backups',
        'DRY RUN',
      );

      expect(md).toContain('# Backup Scan Net Diff Report');
      expect(md).toContain('`DRY RUN`');
      expect(md).toContain('Super Nintendo Entertainment System');
      expect(md).toContain('Chrono Trigger');
      expect(md).toContain('Secret of Mana');
    });
  });
});
