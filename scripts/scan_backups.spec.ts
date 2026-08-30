/**
 * BACKUP SCANNER & CROSS-PLATFORM RECONCILIATION TESTS
 */

import { describe, it, expect } from 'vitest';
import {
  getScannedPlatformIds,
  findDbPlatform,
  findBestReleaseMatch,
  findTolerantReleaseMatch,
  getGameFileParts,
  isIgnoredFile,
  PlatformRow,
  ReleaseRow,
} from './scan_backups.js';

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
      id: 53,
      name: 'famicom',
      display_name: 'Famicom',
      brand: 'Nintendo',
      launch_date: '1983-07-15',
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
      id: 24,
      name: 'wii-u',
      display_name: 'Wii U',
      brand: 'Nintendo',
      launch_date: '2012-11-18',
      parent_platform_id: null,
    },
  ];

  describe('getScannedPlatformIds', () => {
    it('should map NES (13) and Famicom (53) symmetrically', () => {
      expect(getScannedPlatformIds(13)).toEqual([13, 53]);
      expect(getScannedPlatformIds(53)).toEqual([13, 53]);
      expect(getScannedPlatformIds(24)).toEqual([24]);
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
  });

  describe('getGameFileParts & isIgnoredFile', () => {
    it('should strip parentheticals and normalize ", The" suffixes', () => {
      const parts = getGameFileParts('Legend of Zelda, The (USA).nes');
      expect(parts.base).toBe('The Legend of Zelda');
      expect(parts.ext).toBe('.nes');
    });

    it('should ignore sidecars, save states, and desktop files', () => {
      expect(isIgnoredFile('desktop.ini')).toBe(true);
      expect(isIgnoredFile('game.sav')).toBe(true);
      expect(isIgnoredFile('game.state.auto')).toBe(true);
      expect(isIgnoredFile('EarthBound Beginnings (USA, Europe).nes')).toBe(
        false,
      );
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
    ];

    it('should match canonical extracted ROMs exactly on target hardware', () => {
      const matched = findBestReleaseMatch(
        'EarthBound Beginnings (USA, Europe) (Virtual Console).nes',
        mockReleases,
      );
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe('rel-earthbound-beginnings');
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
  });
});
