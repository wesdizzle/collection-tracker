import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import {
  GAGGLOG_TO_GAMEYE_PLATFORM,
  GAGGLOG_TO_GAMEYE_COUNTRY,
  cleanTitleForSearch,
  scoreTitleMatch,
  searchGameyeGame,
  searchGameyeToy,
} from './gameye.js';

describe('GAMEYE Reconciliation Module', () => {
  describe('Platform & Country Mappings', () => {
    it('should map core Gagglog platform IDs to GAMEYE platform IDs', () => {
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[13]).toBe(7); // NES
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[53]).toBe(7); // Famicom
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[15]).toBe(6); // SNES
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[17]).toBe(3); // N64
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[20]).toBe(2); // GameCube
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[26]).toBe(97); // Switch
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[29]).toBe(10); // PS1
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[30]).toBe(11); // PS2
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[37]).toBe(18); // Genesis
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[47]).toBe(14); // Xbox
      expect(GAGGLOG_TO_GAMEYE_PLATFORM[48]).toBe(15); // Xbox 360
    });

    it('should map regions to GAMEYE country IDs', () => {
      expect(GAGGLOG_TO_GAMEYE_COUNTRY['USA']).toBe(1);
      expect(GAGGLOG_TO_GAMEYE_COUNTRY['US']).toBe(1);
      expect(GAGGLOG_TO_GAMEYE_COUNTRY['Europe']).toBe(15);
      expect(GAGGLOG_TO_GAMEYE_COUNTRY['Japan']).toBe(3);
      expect(GAGGLOG_TO_GAMEYE_COUNTRY['World']).toBe(34);
    });
  });

  describe('cleanTitleForSearch', () => {
    it('should strip parentheticals, brackets, and disc indicators', () => {
      expect(cleanTitleForSearch('Super Mario 64 (USA)')).toBe(
        'Super Mario 64',
      );
      expect(cleanTitleForSearch('Final Fantasy VII [Disc 1 of 3]')).toBe(
        'Final Fantasy VII',
      );
      expect(cleanTitleForSearch('Metal Gear Solid - Disc 1')).toBe(
        'Metal Gear Solid',
      );
      expect(cleanTitleForSearch('Resident Evil (Europe) (En,Fr,De)')).toBe(
        'Resident Evil',
      );
    });
  });

  describe('scoreTitleMatch', () => {
    it('should score exact matches with highest confidence', () => {
      expect(scoreTitleMatch('Super Mario 64', 'Super Mario 64')).toBe('exact');
      expect(scoreTitleMatch('Chrono Trigger', 'chrono trigger')).toBe('exact');
    });

    it('should score prefix or high-overlap matches with high confidence', () => {
      expect(
        scoreTitleMatch('Super Mario 64', "Super Mario 64 [Player's Choice]"),
      ).toBe('high');
      expect(
        scoreTitleMatch('The Legend of Zelda', 'Legend of Zelda, The'),
      ).toBe('high');
    });

    it('should score unrelated titles with low confidence', () => {
      expect(scoreTitleMatch('Mario Kart', 'Pokemon Stadium')).toBe('low');
    });
  });

  describe('searchGameyeGame', () => {
    it('should query deep_search and parse PriceCharting data in cents', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            records: [
              {
                id: 202,
                category_id: 0,
                platform_id: 3,
                country_id: 1,
                title: 'Super Mario 64',
                has_vgpc: true,
                price: {
                  Loose: 3188,
                  CIB: 15063,
                  New: 149999,
                },
              },
            ],
          },
        }),
      };

      const result = await searchGameyeGame(
        'Super Mario 64 (USA)',
        17, // N64
        'USA',
        mockClient as unknown as { get: typeof axios.get },
      );

      expect(result).not.toBeNull();
      expect(result?.gameye_id).toBe(202);
      expect(result?.gameye_platform_id).toBe(3);
      expect(result?.price_loose).toBe(3188);
      expect(result?.price_cib).toBe(15063);
      expect(result?.price_new).toBe(149999);
      expect(result?.has_vgpc).toBe(true);
      expect(result?.confidence).toBe('exact');
    });

    it('should fallback without country if first search is empty', async () => {
      const mockClient = {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            data: { records: [] },
          })
          .mockResolvedValueOnce({
            data: {
              records: [
                {
                  id: 999,
                  category_id: 0,
                  platform_id: 10,
                  country_id: 15,
                  title: 'Ridge Racer',
                  has_vgpc: true,
                  price: { Loose: 1200, CIB: 2500, New: 8000 },
                },
              ],
            },
          }),
      };

      const result = await searchGameyeGame(
        'Ridge Racer',
        29, // PS1
        'Japan',
        mockClient as unknown as { get: typeof axios.get },
      );

      expect(mockClient.get).toHaveBeenCalledTimes(2);
      expect(result?.gameye_id).toBe(999);
      expect(result?.price_loose).toBe(1200);
    });

    it('should handle API errors gracefully by returning null', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };

      const result = await searchGameyeGame(
        'Sonic',
        37,
        'USA',
        mockClient as unknown as { get: typeof axios.get },
      );
      expect(result).toBeNull();
    });
  });

  describe('searchGameyeToy', () => {
    it('should search toys-to-life category and extract pricing', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            records: [
              {
                id: 84765,
                category_id: 3,
                platform_id: 119,
                country_id: 1,
                title: 'Spyro - Giants, Series 2',
                has_vgpc: true,
                price: {
                  Loose: 1447,
                  CIB: 1447,
                  New: 2499,
                },
              },
            ],
          },
        }),
      };

      const result = await searchGameyeToy(
        'Spyro - Giants, Series 2',
        'Skylanders',
        mockClient as unknown as { get: typeof axios.get },
      );

      expect(result).not.toBeNull();
      expect(result?.gameye_id).toBe(84765);
      expect(result?.price_loose).toBe(1447);
      expect(result?.confidence).toBe('exact');
    });

    it('should handle toy search failures gracefully', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: { records: [] },
        }),
      };

      const result = await searchGameyeToy(
        'Nonexistent Figure',
        'amiibo',
        mockClient as unknown as { get: typeof axios.get },
      );
      expect(result).toBeNull();
    });
  });
});
