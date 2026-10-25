import { describe, it, expect } from 'vitest';
import {
  parseCsvRows,
  normalizeSpreadsheetRegion,
  formatSwitchRevisionVariant,
  parseSwitchRevisionsCsv,
  parseNxdumptoolFilename,
  resolveBestSwitchRevisionMatch,
  SwitchSheetTabConfig,
} from './switch_revisions.js';
import { CanonicalRelease } from './canonical_releases.js';

describe('Switch Revisions & nxdumptool Matching Engine', () => {
  describe('parseCsvRows', () => {
    it('should correctly parse standard, quoted, and multiline CSV lines', () => {
      const csv = `Game Name,Revision #,Version on Cart,Download Available?\n1-2-Switch,001,1.1.0,No\n"Bayonetta 2",000,1.0,Yes*\n"Line 1\nLine 2",000,1.0,No`;
      const rows = parseCsvRows(csv);
      expect(rows).toHaveLength(4);
      expect(rows[1][0]).toBe('1-2-Switch');
      expect(rows[1][1]).toBe('001');
      expect(rows[2][0]).toBe('Bayonetta 2');
      expect(rows[3][0]).toBe('Line 1\nLine 2');
    });
  });

  describe('normalizeSpreadsheetRegion', () => {
    it('should map regional tokens to standard names', () => {
      expect(normalizeSpreadsheetRegion('USA')).toBe('USA');
      expect(normalizeSpreadsheetRegion('EUR')).toBe('Europe');
      expect(normalizeSpreadsheetRegion('JPN')).toBe('Japan');
      expect(normalizeSpreadsheetRegion('AUS')).toBe('Australia');
      expect(normalizeSpreadsheetRegion('USA, EUR')).toBe('USA, Europe');
      expect(normalizeSpreadsheetRegion('MSE')).toBe('Asia');
      expect(normalizeSpreadsheetRegion('N/A')).toBeNull();
    });
  });

  describe('formatSwitchRevisionVariant', () => {
    it('should format standard cartridge revision strings', () => {
      expect(
        formatSwitchRevisionVariant('001', '1.1.0', 'No', 'LA-H-AACCA-USA'),
      ).toBe('Rev 001 (v1.1.0)');
      expect(
        formatSwitchRevisionVariant('000', '1.0', 'Yes*', 'LA-H-AE98A-USA'),
      ).toBe('Rev 000 (v1.0)');
    });

    it('should detect Game Key Cards on Switch 2', () => {
      expect(formatSwitchRevisionVariant('-', '-', 'Key', 'LP-AAACA-USA')).toBe(
        'Game Key Card',
      );
    });
  });

  describe('parseSwitchRevisionsCsv with Past Revisions Inheritance', () => {
    it('should parse main tabs and inherit metadata on past revision continuation rows', () => {
      const mainTab: SwitchSheetTabConfig = {
        gid: '0',
        name: 'S1: 1st Party Nintendo',
        platformId: 26,
      };
      const mainCsv = `Game Name,Revision #,Version on Cart,Download Available?,Download Size,Regions,Front Cart Code,Additional Comments,Last Checked\n1-2-Switch,001,1.1.0,No,N/A,USA,LA-H-AACCA-USA,Complete on cart,30/05/2024\nAnimal Crossing: New Horizons,009,1.8.0,No,N/A,USA,LA-H-ALACA-USA,Complete,30/05/2024`;

      const pastTab: SwitchSheetTabConfig = {
        gid: '609274111',
        name: 'Past Revisions SW1',
        platformId: 26,
        isPastRevisions: true,
      };
      const pastCsv = `Game Name,Past Revision #,Version on Cart,Additional Comments\n1-2-Switch,000,1.0.0,Base print\nAnimal Crossing: New Horizons,000,1.0.0,Base\n,001,1.1.0,Patch 1\n,004,1.2.0,Patch 2`;

      const releases = parseSwitchRevisionsCsv([
        { tab: mainTab, csv: mainCsv },
        { tab: pastTab, csv: pastCsv },
      ]);

      // Should have 1-2-Switch Rev 001 (main) and Rev 000 (past)
      const oneTwoSwitchRevs = releases.filter(
        (r) => r.raw_title === '1-2-Switch',
      );
      expect(oneTwoSwitchRevs).toHaveLength(2);
      expect(
        oneTwoSwitchRevs.some((r) => r.variants === 'Rev 001 (v1.1.0)'),
      ).toBe(true);
      expect(
        oneTwoSwitchRevs.some((r) => r.variants === 'Rev 000 (v1.0.0)'),
      ).toBe(true);

      // Animal Crossing continuation rows should inherit title and region
      const acRevs = releases.filter(
        (r) => r.raw_title === 'Animal Crossing: New Horizons',
      );
      expect(acRevs.length).toBeGreaterThanOrEqual(4);
      expect(acRevs.every((r) => r.region === 'USA')).toBe(true);
      expect(acRevs.some((r) => r.variants === 'Rev 004 (v1.2.0)')).toBe(true);
    });
  });

  describe('parseNxdumptoolFilename', () => {
    it('should parse base v0 dumps and strip dump flags', () => {
      const parsed = parseNxdumptoolFilename(
        '1-2-Switch [01000320000CC000][v0] [NKA][NC][NT].xci',
      );
      expect(parsed.isNxdumptool).toBe(true);
      expect(parsed.segments).toHaveLength(1);
      expect(parsed.segments[0].cleanTitle).toBe('1-2-Switch');
      expect(parsed.segments[0].titleId).toBe('01000320000CC000');
      expect(parsed.segments[0].versionInt).toBe(0);
      expect(parsed.segments[0].patchLevel).toBe(0);
      expect(parsed.segments[0].displayVersion).toBeNull();
      expect(parsed.dumpFlags).toEqual(['[NKA]', '[NC]', '[NT]']);
    });

    it('should replace underscores with colons for normalized matching', () => {
      const parsed = parseNxdumptoolFilename(
        'Animal Crossing_ New Horizons [01006F8002326000][v0] [NKA][NC][NT].xci',
      );
      expect(parsed.segments[0].cleanTitle).toBe(
        'Animal Crossing: New Horizons',
      );
    });

    it('should extract display versions and patch levels for updated cartridges', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
      );
      expect(parsed.segments[0].cleanTitle).toBe('Bayonetta');
      expect(parsed.segments[0].displayVersion).toBe('1.1');
      expect(parsed.segments[0].versionInt).toBe(65536);
      expect(parsed.segments[0].patchLevel).toBe(1);
    });

    it('should parse multi-game cartridge dumps', () => {
      const parsed = parseNxdumptoolFilename(
        '20XX 1.1.1 [0100749009844000][v327680] + 30XX 1.3.6 [010059B017F9E000][v851968] [NKA][NC][NT].xci',
      );
      expect(parsed.isNxdumptool).toBe(true);
      expect(parsed.isMultiGame).toBe(true);
      expect(parsed.segments).toHaveLength(2);
      expect(parsed.segments[0].cleanTitle).toBe('20XX');
      expect(parsed.segments[0].displayVersion).toBe('1.1.1');
      expect(parsed.segments[1].cleanTitle).toBe('30XX');
      expect(parsed.segments[1].displayVersion).toBe('1.3.6');
      expect(parsed.compositeTitle).toBe('20XX + 30XX');
    });
  });

  describe('resolveBestSwitchRevisionMatch', () => {
    const mockReleases: CanonicalRelease[] = [
      {
        platform_id: 26,
        raw_title: 'Bayonetta',
        normalized_title: 'bayonetta',
        region: 'USA',
        variants: 'Rev 000 (v1.0)',
        rom_name: null,
        rom_crc: null,
        serial_code: 'LA-H-AE98A-USA',
        source: 'nintendo_revised',
        is_verified_physical: 1,
      },
      {
        platform_id: 26,
        raw_title: 'Bayonetta',
        normalized_title: 'bayonetta',
        region: 'USA',
        variants: 'Rev 001 (v1.1)',
        rom_name: null,
        rom_crc: null,
        serial_code: 'LA-H-AE98A-USA',
        source: 'nintendo_revised',
        is_verified_physical: 1,
      },
    ];

    it('should match Rev 001 when backup filename has display version 1.1 / v65536', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta 1.1 [010076F0049A2000][v65536] [NKA][NC][NT].xci',
      );
      const match = resolveBestSwitchRevisionMatch(parsed, mockReleases);
      expect(match?.variants).toBe('Rev 001 (v1.1)');
    });

    it('should match Rev 000 when backup filename is v0', () => {
      const parsed = parseNxdumptoolFilename(
        'Bayonetta [010076F0049A2000][v0] [NKA][NC][NT].xci',
      );
      const match = resolveBestSwitchRevisionMatch(parsed, mockReleases);
      expect(match?.variants).toBe('Rev 000 (v1.0)');
    });
  });
});
