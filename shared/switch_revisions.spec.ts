import { describe, it, expect } from 'vitest';
import {
  parseCsvRows,
  normalizeSpreadsheetRegion,
  formatSwitchRevisionVariant,
  parseSwitchRevisionsCsv,
  parseNxdumptoolFilename,
  resolveBestSwitchRevisionMatch,
  extractVersionFromVariant,
  splitVariantVersions,
  extractRevisionFromVariant,
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
    it('should parse main tabs and assign World to undocumented past revisions without regional expansion', () => {
      const mainTab: SwitchSheetTabConfig = {
        gid: '0',
        name: 'S1: 1st Party Nintendo',
        platformId: 26,
      };
      const mainCsv = `Game Name,Revision #,Version on Cart,Download Available?,Download Size,Regions,Front Cart Code,Additional Comments,Last Checked\n1-2-Switch,001,1.1.0,No,N/A,USA,LA-H-AACCA-USA,Complete on cart,30/05/2024\n1-2-Switch,001,1.1.0,No,N/A,EUR,LA-H-AACCA-EUR,Complete on cart,30/05/2024\nAnimal Crossing: New Horizons,009,1.8.0,No,N/A,USA,LA-H-ALACA-USA,Complete,30/05/2024`;

      const pastTab: SwitchSheetTabConfig = {
        gid: '609274111',
        name: 'Past Revisions SW1',
        platformId: 26,
        isPastRevisions: true,
      };
      const pastCsv = `Game Name,Past Revision #,Version on Cart,Additional Comments\n1-2-Switch,000,1.0.0,Base print\nAnimal Crossing: New Horizons,000,1.0.0,Base\n,001,1.1.0,Patch 1\n,004,1.2.0,EUR COPIES ONLY`;

      const releases = parseSwitchRevisionsCsv([
        { tab: mainTab, csv: mainCsv },
        { tab: pastTab, csv: pastCsv },
      ]);

      // 1-2-Switch: Rev 001 for USA and Europe, Rev 000 tagged 'World' without fabricated regional expansion
      const oneTwoSwitchRevs = releases.filter(
        (r) => r.raw_title === '1-2-Switch',
      );
      expect(oneTwoSwitchRevs).toHaveLength(3);
      const rev000World = oneTwoSwitchRevs.find(
        (r) => r.variants === 'Rev 000 (v1.0.0)',
      );
      expect(rev000World).toBeTruthy();
      expect(rev000World?.region).toBe('World');
      expect(rev000World?.publisher).toBe('Base print');

      // Animal Crossing:
      // Rev 009 (USA, LA-H-ALACA-USA)
      // Rev 000 (World - no explicit region)
      // Rev 001 (World - undocumented reprint)
      // Rev 004 (Europe - explicit "EUR COPIES ONLY")
      const acRevs = releases.filter(
        (r) => r.raw_title === 'Animal Crossing: New Horizons',
      );
      expect(acRevs).toHaveLength(4);

      const acRev0 = acRevs.find((r) => r.variants === 'Rev 000 (v1.0.0)');
      expect(acRev0?.region).toBe('World');
      expect(acRev0?.publisher).toBe('Base');

      const acRev1 = acRevs.find((r) => r.variants === 'Rev 001 (v1.1.0)');
      expect(acRev1?.region).toBe('World');
      expect(acRev1?.publisher).toBe('Patch 1');

      const acRev4 = acRevs.find((r) => r.variants === 'Rev 004 (v1.2.0)');
      expect(acRev4?.region).toBe('Europe');
      expect(acRev4?.publisher).toBe('EUR COPIES ONLY');
    });

    it('propagates base revisions across shared 5-char product codes, parses multi-revision comments, resolves Past Revisions aliases, and applies implied base revisions while respecting distinct regional builds and launch-print comments', () => {
      const mainTab: SwitchSheetTabConfig = {
        gid: '1882179329',
        name: 'S1: Third Party/Indies',
        platformId: 26,
      };
      const mainCsv = [
        'Game Name,Revision #,Version on Cart,Download Available?,Download Size,Regions,Front Cart Code,Additional Comments,Last Checked',
        'Bloodstained: Ritual of the Night,000,0.10,Yes,1GB,EUR,LA-H-AB4PA-EUR,This includes 000 and 001 cartridges.,30/05/2024',
        ',001,1.03,Yes,1GB,USA,LA-H-AB4PA-USA,Download updates to 1.4,30/05/2024',
        'A Space for the Unbound,000,1.0.0.0,Yes,100MB,JPN,LA-H-A7XPB-JPN,Updates to 1.0.33.0,30/05/2024',
        ',001,1.0.33.1,No,N/A,USA,LA-H-A7XPA-USA,Complete on cart,30/05/2024',
        'Animal Well,002,1.0.2,No,N/A,USA,LA-H-BG22A-USA,Revision 002 is probably the only one available,30/05/2024',
        'Dungeon Encounters,001,1.02,No,N/A,ASIA,LA-H-A3D6A-ASI,"Revisions 000 and 001 are identical, no patch and complete on cart.",30/05/2024',
        "Luigi's Mansion 3,001,1.2.1,Yes,500MB,USA,LA-H-AG3JA-USA,Updates to 1.4.0,30/05/2024",
        'Monster Boy and the Cursed Kingdom,002,1.0.5,No,N/A,USA,LA-H-AEUCB-USA,Complete on cart,30/05/2024',
        'Donkey Kong Country: Tropical Freeze,001,1.0.1,Yes,100MB,USA,LA-H-AFWTA-USA,Updates to 1.0.2,30/05/2024',
      ].join('\n');

      const pastTab: SwitchSheetTabConfig = {
        gid: '609274111',
        name: 'Past Revisions SW1',
        platformId: 26,
        isPastRevisions: true,
      };
      const pastCsv = [
        'Game Name,Past Revision #,Version on Cart,Additional Comments',
        "Luigi's Mansion,000,1.0.0,Base print",
        'Monster Boy and the Cursed Kingdom (USA),001,1.0.1,USA intermediate print',
      ].join('\n');

      const releases = parseSwitchRevisionsCsv([
        { tab: mainTab, csv: mainCsv },
        { tab: pastTab, csv: pastCsv },
      ]);

      // 1. Bloodstained (shared AB4PA code + "This includes 000 and 001 cartridges" comment):
      // Both EUR and USA receive Rev 000 (v0.10) and Rev 001 (v1.03)
      const bloodstained = releases.filter(
        (r) => r.raw_title === 'Bloodstained: Ritual of the Night',
      );
      expect(
        bloodstained.map((r) => `${r.region}:${r.variants}`).sort(),
      ).toEqual([
        'Europe:Rev 000 (v0.10)',
        'Europe:Rev 001 (v1.03)',
        'USA:Rev 000 (v0.10)',
        'USA:Rev 001 (v1.03)',
      ]);

      // 2. A Space for the Unbound (distinct 5-char codes A7XPB vs A7XPA):
      // JPN Rev 000 is NOT falsely propagated to USA
      const spaceUnbound = releases.filter(
        (r) => r.raw_title === 'A Space for the Unbound',
      );
      expect(
        spaceUnbound.map((r) => `${r.region}:${r.variants}`).sort(),
      ).toEqual(['Japan:Rev 000 (v1.0.0.0)', 'USA:Rev 001 (v1.0.33.1)']);

      // 3. Animal Well ("Revision 002 is probably the only one available"):
      // Does NOT synthesize a false Rev 000
      const animalWell = releases.filter((r) => r.raw_title === 'Animal Well');
      expect(animalWell.map((r) => `${r.region}:${r.variants}`)).toEqual([
        'USA:Rev 002 (v1.0.2)',
      ]);

      // 4. Dungeon Encounters ("Revisions 000 and 001 are identical"):
      const dungeonEnc = releases.filter(
        (r) => r.raw_title === 'Dungeon Encounters',
      );
      expect(dungeonEnc.map((r) => `${r.region}:${r.variants}`).sort()).toEqual(
        ['Asia:Rev 000 (v1.02)', 'Asia:Rev 001 (v1.02)'],
      );

      // 5. Luigi's Mansion 3 (alias from "Luigi's Mansion" in Past Revisions SW1):
      const luigi = releases.filter((r) => r.raw_title === "Luigi's Mansion 3");
      expect(
        luigi.some(
          (r) => r.region === 'USA' && r.variants === 'Rev 000 (v1.0.0)',
        ),
      ).toBe(true);

      // 6. Monster Boy and the Cursed Kingdom (USA) suffix in Past Revisions:
      const monsterBoy = releases.filter(
        (r) => r.raw_title === 'Monster Boy and the Cursed Kingdom',
      );
      expect(monsterBoy.map((r) => `${r.region}:${r.variants}`).sort()).toEqual(
        ['USA:Rev 001 (v1.0.1)', 'USA:Rev 002 (v1.0.5)'],
      );

      // 7. Donkey Kong Country: Tropical Freeze (SWITCH_IMPLIED_PAST_REVISIONS):
      const dkctf = releases.filter(
        (r) => r.raw_title === 'Donkey Kong Country: Tropical Freeze',
      );
      expect(dkctf.map((r) => `${r.region}:${r.variants}`).sort()).toEqual([
        'USA:Rev 000 (v1.0.0)',
        'USA:Rev 001 (v1.0.1)',
      ]);
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

    it('should strip v-prefixed and letter-suffixed display versions from titles', () => {
      const dave = parseNxdumptoolFilename(
        'DAVE THE DIVER v1.0.2.651 [010097F018538000][v720896] + The Art of DAVE THE DIVER [01005EC01E6A4000][v0] [NKA][NC][NT].xci',
      );
      expect(dave.segments[0].cleanTitle).toBe('DAVE THE DIVER');
      expect(dave.segments[0].displayVersion).toBe('1.0.2.651');
      expect(dave.compositeTitle).toBe(
        'DAVE THE DIVER + The Art of DAVE THE DIVER',
      );

      const ender = parseNxdumptoolFilename(
        'ENDER LILIES_ Quietus of the Knights 1.1.5c [0100CCF012E9A000][v458752] [NKA][NC][NT].xci',
      );
      expect(ender.segments[0].cleanTitle).toBe(
        'ENDER LILIES: Quietus of the Knights',
      );
      expect(ender.segments[0].displayVersion).toBe('1.1.5c');

      const etherborn = parseNxdumptoolFilename(
        'Etherborn 1.0.3s [01000E200BE10000][v196608] [NKA][NC][NT].xci',
      );
      expect(etherborn.segments[0].cleanTitle).toBe('Etherborn');
      expect(etherborn.segments[0].displayVersion).toBe('1.0.3s');

      const fp2 = parseNxdumptoolFilename(
        'Freedom Planet 2 1.2.8r [01009A301B6D8000][v196608] [NKA][NC][NT].xci',
      );
      expect(fp2.segments[0].cleanTitle).toBe('Freedom Planet 2');
      expect(fp2.segments[0].displayVersion).toBe('1.2.8r');
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

    it('should parse multi-game comma/slash variants and bare dotted Rev versions accurately', () => {
      expect(extractVersionFromVariant('Rev 000 (v1.0.0, 1.0.0)')).toBe(
        '1.0.0, 1.0.0',
      );
      expect(
        splitVariantVersions(
          extractVersionFromVariant('Rev 000 (v1.0.0, 1.0.0)'),
        ),
      ).toEqual(['1', '1']);
      expect(
        splitVariantVersions(
          extractVersionFromVariant('Rev 000 (v1.1.1, 1.3.6)'),
        ),
      ).toEqual(['1.1.1', '1.3.6']);
      expect(
        splitVariantVersions(
          extractVersionFromVariant(
            'Rev 00 59L (v1: 1.0.6432, 2: 1.0.48921, 3: 1.0.35118)',
          ),
        ),
      ).toEqual(['1.0.6432', '1.0.48921', '1.0.35118']);
      expect(extractVersionFromVariant('Rev 001 (v1.1_65791)')).toBe(
        '1.1_65791',
      );
      expect(extractVersionFromVariant('Rev 001 (v1.4.4-sw2p)')).toBe(
        '1.4.4-sw2p',
      );
      expect(extractVersionFromVariant('Rev 1.0.2795')).toBe('1.0.2795');

      expect(extractRevisionFromVariant('Rev 000 (v1.0.0, 1.0.0)')).toBe(0);
      expect(extractRevisionFromVariant('Rev 1.0.2795')).toBeNull();
      expect(extractRevisionFromVariant('Rev 1.4.0, rev002')).toBe(2);
    });

    it('should not let Step 4 patchLevel override an exact Step 3 displayVersion match', () => {
      const candidates: CanonicalRelease[] = [
        {
          platform_id: 26,
          raw_title: 'Test Game',
          normalized_title: 'test game',
          region: 'USA',
          variants: 'Rev 001 (v1.2.0)',
          rom_name: null,
          rom_crc: null,
          serial_code: null,
          source: 'nintendo_revised',
          is_verified_physical: 1,
        },
        {
          platform_id: 26,
          raw_title: 'Test Game',
          normalized_title: 'test game',
          region: 'USA',
          variants: 'Rev 002 (v1.3.0)',
          rom_name: null,
          rom_crc: null,
          serial_code: null,
          source: 'nintendo_revised',
          is_verified_physical: 1,
        },
      ];

      // Patch level is 2 (v131072), but displayVersion is explicitly 1.2.0 (which is on Rev 001)
      const parsed = parseNxdumptoolFilename(
        'Test Game 1.2.0 [0100ABCDEF000000][v131072] [NKA][NC][NT].xci',
      );
      const match = resolveBestSwitchRevisionMatch(parsed, candidates, 'USA');
      expect(match?.variants).toBe('Rev 001 (v1.2.0)');
    });
  });
});
