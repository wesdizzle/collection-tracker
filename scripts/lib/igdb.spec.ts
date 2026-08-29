import { describe, it, expect } from 'vitest';
import { normalizeStr, superNormalize, normalizeIGDBGame } from './igdb.js';

describe('IGDB Normalization Utilities', () => {
  describe('normalizeStr', () => {
    it('should lowercase strings', () => {
      expect(normalizeStr('HALO')).toBe('halo');
    });

    it('should handle special dashes', () => {
      expect(normalizeStr('Game–Title')).toBe('game-title');
      expect(normalizeStr('Game—Title')).toBe('game-title');
    });

    it('should convert ampersands', () => {
      expect(normalizeStr('Mario & Luigi')).toBe('mario and luigi');
    });

    it('should strip non-alphanumeric except specific chars', () => {
      expect(normalizeStr('Game! @Title#')).toBe('game title');
    });
  });

  describe('superNormalize', () => {
    it('should strip common prefixes', () => {
      expect(superNormalize("Disney's Aladdin")).toBe('aladdin');
      expect(superNormalize("Marvel's Spider-Man")).toBe('spiderman');
      expect(superNormalize('Lego Star Wars')).toBe('starwars');
    });

    it('should strip subtitle fluff', () => {
      expect(superNormalize('The Legend of Zelda: The Videogame')).toBe(
        'legendzelda',
      );
      expect(superNormalize('Game: Special Edition')).toBe('game');
    });

    it('should convert & to and (and then strip "and")', () => {
      expect(superNormalize('Ratchet & Clank')).toBe('ratchetclank');
    });

    it('should remove all non-alphanumeric', () => {
      expect(superNormalize('Super Mario Bros. 3!')).toBe('supermariobros3');
    });

    it('should handle null/empty', () => {
      expect(superNormalize('')).toBe('');
    });
  });

  describe('normalizeIGDBGame release date selection', () => {
    it('should prioritize original NES release date over 3DS/Wii VC re-releases', () => {
      const mockGame = {
        id: 1024,
        name: 'Mega Man 2',
        platforms: [
          { id: 18, name: 'Nintendo Entertainment System' },
          { id: 37, name: 'Nintendo 3DS' },
        ],
        release_dates: [
          // 3DS VC re-release in 2012 (Region 2 - NA)
          { platform: 37, region: 2, date: 1328745600 },
          // Original NES release in 1989 (Region 2 - NA)
          { platform: 18, region: 2, date: 612748800 },
        ],
      };

      const normalized = normalizeIGDBGame(mockGame, 'Mega Man 2', 18);
      expect(normalized.release_date).toBe('1989-06-02');
      expect(normalized.flagged_outlier).toBe(false);
    });

    it('should flag outlier release dates outside platform active lifespan guidelines', () => {
      const mockGame = {
        id: 9999,
        name: 'Late NES Homebrew',
        platforms: [{ id: 18, name: 'Nintendo Entertainment System' }],
        release_dates: [
          // Boutique release in 2021 for NES (Region 2 - NA)
          { platform: 18, region: 2, date: 1609459200 },
        ],
      };

      const normalized = normalizeIGDBGame(mockGame, 'Late NES Homebrew', 18);
      expect(normalized.release_date).toBe('2021-01-01');
      expect(normalized.flagged_outlier).toBe(true);
    });

    it('should honor DATE_OVERRIDES for specific IGDB entries', () => {
      const mockGame = {
        id: 119390,
        name: 'Ni no Kuni: Wrath of the White Witch Remastered',
        platforms: [{ id: 130, name: 'Nintendo Switch' }],
        release_dates: [{ platform: 130, region: 2, date: 473385600 }], // Corrupt mock timestamp
      };

      const normalized = normalizeIGDBGame(
        mockGame,
        'Ni no Kuni: Wrath of the White Witch',
        130,
      );
      expect(normalized.release_date).toBe('2019-09-20');
      expect(normalized.flagged_outlier).toBe(false);
    });
  });
});
