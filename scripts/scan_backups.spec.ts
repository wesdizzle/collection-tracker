/**
 * BACKUP SCANNER & CROSS-PLATFORM RECONCILIATION TESTS
 */

import { describe, it, expect } from 'vitest';
import {
  getScannedPlatformIds,
  findDbPlatform,
  findBestReleaseMatch,
  findTolerantReleaseMatch,
  normalizeRomBaseForMatching,
  getGameFileParts,
  isIgnoredFile,
  GAME_EXTENSIONS,
  PlatformRow,
  ReleaseRow,
} from './scan_backups.js';
import { stripDiscIndicator } from './lib/queries.js';

describe('Backup Scanner & Cross-Platform Reconciler', () => {
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
      // PSVR (51) is child of PS4 (34)
      const ps4Scanned = getScannedPlatformIds(34, mockPlatforms);
      expect(ps4Scanned).toContain(34);
      expect(ps4Scanned).toContain(51);

      // New 3DS (25) is child of 3DS (23)
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

  describe('getGameFileParts & isIgnoredFile', () => {
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

    it('should NOT ignore .xiso.iso files', () => {
      expect(isIgnoredFile('Halo.xiso.iso')).toBe(false);
      expect(GAME_EXTENSIONS.has('.xiso.iso')).toBe(true);
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
      // Secondary disc
      const disc2Match = findBestReleaseMatch(
        'Final Fantasy VII (USA) (Disc 2).chd',
        mockReleases,
      );
      expect(disc2Match).not.toBeNull();
      expect(disc2Match?.id).toBe('rel-ff7');

      // Merged multi-disc package
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

    it('should find tolerant release matches when regional naming discrepancies exist', () => {
      const tolerantMatch = findTolerantReleaseMatch(
        'EarthBound Beginnings (Virtual Console) (USA).nes',
        mockReleases,
      );
      expect(tolerantMatch).not.toBeNull();
      expect(tolerantMatch?.id).toBe('rel-earthbound-beginnings');
    });

    it('should find tolerant release matches even when backup file has no region tag', () => {
      const cleanNameMatch = findTolerantReleaseMatch(
        'Super Mario World.sfc',
        mockReleases,
      );
      expect(cleanNameMatch).not.toBeNull();
      expect(cleanNameMatch?.id).toBe('rel-smw');
    });
  });
});
