import { describe, it, expect } from 'vitest';
import {
  isOpticalPlatform,
  getMediaIconName,
  isRegionMatchingHome,
  DEFAULT_USER_HOME_REGION,
} from './collection.models';

describe('Collection Models Platform and Media Detection', () => {
  describe('isOpticalPlatform', () => {
    it('identifies optical disc platforms correctly', () => {
      // Sony PlayStation (excluding Vita/PSV)
      expect(isOpticalPlatform('PlayStation')).toBe(true);
      expect(isOpticalPlatform('PlayStation 2')).toBe(true);
      expect(isOpticalPlatform('PlayStation 3')).toBe(true);
      expect(isOpticalPlatform('PlayStation 4')).toBe(true);
      expect(isOpticalPlatform('PlayStation 5')).toBe(true);
      expect(isOpticalPlatform('PlayStation Portable')).toBe(true);
      expect(isOpticalPlatform('PS1')).toBe(true);
      expect(isOpticalPlatform('PS2')).toBe(true);
      expect(isOpticalPlatform('PS3')).toBe(true);
      expect(isOpticalPlatform('PS4')).toBe(true);
      expect(isOpticalPlatform('PS5')).toBe(true);
      expect(isOpticalPlatform('PSX')).toBe(true);
      expect(isOpticalPlatform('PSP')).toBe(true);

      // Nintendo Optical
      expect(isOpticalPlatform('Nintendo GameCube')).toBe(true);
      expect(isOpticalPlatform('GameCube')).toBe(true);
      expect(isOpticalPlatform('Wii')).toBe(true);
      expect(isOpticalPlatform('Wii U')).toBe(true);

      // Microsoft Xbox
      expect(isOpticalPlatform('Xbox')).toBe(true);
      expect(isOpticalPlatform('Xbox 360')).toBe(true);
      expect(isOpticalPlatform('Xbox One')).toBe(true);
      expect(isOpticalPlatform('Xbox Series X')).toBe(true);

      // Sega Optical
      expect(isOpticalPlatform('Sega CD')).toBe(true);
      expect(isOpticalPlatform('Sega Saturn')).toBe(true);
      expect(isOpticalPlatform('Dreamcast')).toBe(true);

      // Other Optical
      expect(isOpticalPlatform('3DO Interactive Multiplayer')).toBe(true);
      expect(isOpticalPlatform('Philips CD-i')).toBe(true);
      expect(isOpticalPlatform('TurboGrafx CD')).toBe(true);
      expect(isOpticalPlatform('PC Engine CD')).toBe(true);
      expect(isOpticalPlatform('Neo Geo CD')).toBe(true);
    });

    it('identifies cartridge, card, and handheld chip platforms as non-optical', () => {
      // PS Vita is explicitly a card/cartridge platform
      expect(isOpticalPlatform('PlayStation Vita')).toBe(false);
      expect(isOpticalPlatform('PS Vita')).toBe(false);
      expect(isOpticalPlatform('PSV')).toBe(false);

      // Nintendo Cartridges & Cards
      expect(isOpticalPlatform('Nintendo Entertainment System')).toBe(false);
      expect(isOpticalPlatform('Nintendo Entertainment System / Famicom')).toBe(
        false,
      );
      expect(isOpticalPlatform('NES')).toBe(false);
      expect(isOpticalPlatform('Super Nintendo Entertainment System')).toBe(
        false,
      );
      expect(
        isOpticalPlatform(
          'Super Nintendo Entertainment System / Super Famicom',
        ),
      ).toBe(false);
      expect(isOpticalPlatform('SNES')).toBe(false);
      expect(isOpticalPlatform('Nintendo 64')).toBe(false);
      expect(isOpticalPlatform('Game Boy')).toBe(false);
      expect(isOpticalPlatform('Game Boy Color')).toBe(false);
      expect(isOpticalPlatform('Game Boy Advance')).toBe(false);
      expect(isOpticalPlatform('Nintendo DS')).toBe(false);
      expect(isOpticalPlatform('Nintendo 3DS')).toBe(false);
      expect(isOpticalPlatform('Nintendo Switch')).toBe(false);
      expect(isOpticalPlatform('Switch')).toBe(false);
      expect(isOpticalPlatform('Nintendo Switch 2')).toBe(false);
      expect(isOpticalPlatform('Virtual Boy')).toBe(false);

      // Sega Cartridges
      expect(isOpticalPlatform('Sega Master System')).toBe(false);
      expect(isOpticalPlatform('Sega Genesis')).toBe(false);
      expect(isOpticalPlatform('Sega Game Gear')).toBe(false);
      expect(isOpticalPlatform('Sega 32X')).toBe(false);

      // Atari, Coleco, Intellivision, Neo Geo AES
      expect(isOpticalPlatform('Atari 2600')).toBe(false);
      expect(isOpticalPlatform('Atari 7800')).toBe(false);
      expect(isOpticalPlatform('ColecoVision')).toBe(false);
      expect(isOpticalPlatform('Intellivision')).toBe(false);
      expect(isOpticalPlatform('Neo Geo AES')).toBe(false);
      expect(isOpticalPlatform('TurboGrafx-16')).toBe(false);

      // Null, undefined, empty
      expect(isOpticalPlatform(null)).toBe(false);
      expect(isOpticalPlatform(undefined)).toBe(false);
      expect(isOpticalPlatform('')).toBe(false);
    });
  });

  describe('getMediaIconName', () => {
    it('returns missing-dump when backup_status is 0 or false', () => {
      expect(getMediaIconName('PlayStation 4', 0)).toBe('missing-dump');
      expect(getMediaIconName('Nintendo Switch', 0)).toBe('missing-dump');
      expect(getMediaIconName('Nintendo GameCube', false)).toBe('missing-dump');
      expect(getMediaIconName(null, 0)).toBe('missing-dump');
    });

    it('returns disc for backed-up optical platforms', () => {
      expect(getMediaIconName('PlayStation 4', 1)).toBe('disc');
      expect(getMediaIconName('PlayStation 5', true)).toBe('disc');
      expect(getMediaIconName('Nintendo GameCube', 1)).toBe('disc');
      expect(getMediaIconName('Wii', 1)).toBe('disc');
      expect(getMediaIconName('Xbox 360', 1)).toBe('disc');
      expect(getMediaIconName('Dreamcast', 1)).toBe('disc');
      expect(getMediaIconName('Sega CD', 1)).toBe('disc');
    });

    it('returns rom-archive for backed-up cartridge and card platforms', () => {
      expect(getMediaIconName('Nintendo Switch', 1)).toBe('rom-archive');
      expect(getMediaIconName('PlayStation Vita', 1)).toBe('rom-archive');
      expect(getMediaIconName('Nintendo 64', 1)).toBe('rom-archive');
      expect(getMediaIconName('Game Boy Advance', 1)).toBe('rom-archive');
      expect(getMediaIconName('Nintendo DS', 1)).toBe('rom-archive');
      expect(getMediaIconName('Sega Genesis', 1)).toBe('rom-archive');
      expect(getMediaIconName('Super Nintendo Entertainment System', 1)).toBe(
        'rom-archive',
      );
      expect(getMediaIconName('Atari 2600', 1)).toBe('rom-archive');
    });
  });

  describe('isRegionMatchingHome', () => {
    it('defaults home region to USA', () => {
      expect(DEFAULT_USER_HOME_REGION).toBe('USA');
      expect(isRegionMatchingHome('USA')).toBe(true);
      expect(isRegionMatchingHome('Japan')).toBe(false);
    });

    it('matches exact region case-insensitively', () => {
      expect(isRegionMatchingHome('usa', 'USA')).toBe(true);
      expect(isRegionMatchingHome('USA', 'usa')).toBe(true);
      expect(isRegionMatchingHome('Japan', 'Japan')).toBe(true);
    });

    it('handles World as matching all home regions', () => {
      expect(isRegionMatchingHome('World', 'USA')).toBe(true);
      expect(isRegionMatchingHome('World', 'UK')).toBe(true);
      expect(isRegionMatchingHome('World', 'Japan')).toBe(true);
    });

    it('handles regional supersets/ancestors for USA', () => {
      expect(isRegionMatchingHome('North America', 'USA')).toBe(true);
      expect(isRegionMatchingHome('Americas', 'USA')).toBe(true);
      expect(isRegionMatchingHome('Europe', 'USA')).toBe(false);
      expect(isRegionMatchingHome('Asia', 'USA')).toBe(false);
    });

    it('handles regional supersets/ancestors for European countries and UK', () => {
      expect(isRegionMatchingHome('Europe', 'UK')).toBe(true);
      expect(isRegionMatchingHome('Europe', 'France')).toBe(true);
      expect(isRegionMatchingHome('Europe', 'Germany')).toBe(true);
      expect(isRegionMatchingHome('Europe', 'Sweden')).toBe(true);
      expect(isRegionMatchingHome('Scandinavia', 'Sweden')).toBe(true);
      expect(isRegionMatchingHome('Scandinavia', 'Germany')).toBe(false);
      expect(isRegionMatchingHome('USA', 'UK')).toBe(false);
    });

    it('handles regional supersets/ancestors for Asian countries', () => {
      expect(isRegionMatchingHome('Asia', 'Japan')).toBe(true);
      expect(isRegionMatchingHome('Asia', 'Korea')).toBe(true);
      expect(isRegionMatchingHome('Asia', 'China')).toBe(true);
      expect(isRegionMatchingHome('USA', 'Japan')).toBe(false);
    });

    it('handles comma-separated multi-region tags', () => {
      expect(isRegionMatchingHome('USA, Europe', 'USA')).toBe(true);
      expect(isRegionMatchingHome('Japan, Asia', 'USA')).toBe(false);
      expect(isRegionMatchingHome('Europe, Australia', 'UK')).toBe(true);
      expect(isRegionMatchingHome('Japan, USA', 'USA')).toBe(true);
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(isRegionMatchingHome(null, 'USA')).toBe(false);
      expect(isRegionMatchingHome(undefined, 'USA')).toBe(false);
      expect(isRegionMatchingHome('', 'USA')).toBe(false);
    });
  });
});
