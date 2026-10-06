/**
 * Unit Tests for NoPayStation TSV to Canonical No-Intro DAT Converter
 */

import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  formatSonySerial,
  normalizeNpsTitle,
  convertNpsTsvToLogiqxDat,
} from './convert_nps.js';

describe('NoPayStation TSV to Logiqx DAT Converter', () => {
  describe('escapeXml', () => {
    it('should correctly escape XML special characters', () => {
      expect(escapeXml('Axiom & Verge <Game> "Special" \'Edition\'')).toBe(
        'Axiom &amp; Verge &lt;Game&gt; &quot;Special&quot; &apos;Edition&apos;',
      );
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });
  });

  describe('formatSonySerial', () => {
    it('should format 9-character unhyphenated Title ID to hyphenated serial code', () => {
      expect(formatSonySerial('PCSE00651')).toBe('PCSE-00651');
      expect(formatSonySerial('PCSB00779')).toBe('PCSB-00779');
      expect(formatSonySerial('PCSG00312')).toBe('PCSG-00312');
    });

    it('should preserve already formatted or non-standard serials', () => {
      expect(formatSonySerial('PCSE-00651')).toBe('PCSE-00651');
      expect(formatSonySerial('NPXS10007')).toBe('NPXS-10007');
      expect(formatSonySerial('CUSTOM_CODE')).toBe('CUSTOM_CODE');
    });
  });

  describe('normalizeNpsTitle', () => {
    it('should clean firmware requirement tags and append mapped region', () => {
      const result = normalizeNpsTitle(
        'Undertale (3.61+!) [3.65]',
        'US',
        'PCSE01116',
      );
      expect(result.cleanTitle).toBe('Undertale');
      expect(result.region).toBe('USA');
      expect(result.serial).toBe('PCSE-01116');
      expect(result.fullName).toBe('Undertale (USA)');
    });

    it('should sanitize colons and slashes to standard No-Intro hyphens', () => {
      const result = normalizeNpsTitle(
        'Bloodstained: Curse of the Moon (3.61+!) [3.67]',
        'EU',
        'PCSB01250',
      );
      expect(result.cleanTitle).toBe('Bloodstained - Curse of the Moon');
      expect(result.region).toBe('Europe');
      expect(result.serial).toBe('PCSB-01250');
      expect(result.fullName).toBe('Bloodstained - Curse of the Moon (Europe)');
    });

    it('should extract parenthetical editions as variants', () => {
      const result = normalizeNpsTitle(
        'BIT.TRIP Presents... Runner2: Future Legend of Rhythm Alien (Limited Edition)',
        'US',
        'PCSE00953',
      );
      expect(result.cleanTitle).toBe(
        'BIT.TRIP Presents... Runner2 - Future Legend of Rhythm Alien',
      );
      expect(result.variants).toEqual(['Limited Edition']);
      expect(result.fullName).toBe(
        'BIT.TRIP Presents... Runner2 - Future Legend of Rhythm Alien (USA) (Limited Edition)',
      );
    });

    it('should restore known missing apostrophes from dumper omissions', () => {
      const result = normalizeNpsTitle(
        'Oddworld - New n Tasty',
        'US',
        'PCSE00394',
      );
      expect(result.cleanTitle).toBe("Oddworld - New 'n' Tasty");
      expect(result.fullName).toBe("Oddworld - New 'n' Tasty (USA)");
    });
  });

  describe('convertNpsTsvToLogiqxDat', () => {
    it('should convert TSV string into valid Logiqx XML with .zip ROM entries and serial attributes', () => {
      const sampleTsv = [
        'Title ID\tRegion\tName\tPKG direct link\tzRIF\tContent ID\tLast Modification Date\tOriginal Name\tFile Size\tSHA256\tRequired FW\tApp Version',
        'PCSE00651\tUS\tAxiom Verge\thttp://pkg.link\tKO5ifR1dg...\tUP2188-PCSE00651_00-AXIOMVERGE000001\t2018-01-01\tAxiom Verge\t150000000\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\t3.60\t1.00',
        'PCSB00779\tEU\tAxiom Verge\thttp://pkg.link\tKO5ifR1dg...\tEP2188-PCSB00779_00-AXIOMVERGE000001\t2018-01-01\tAxiom Verge\t150000000\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\t3.60\t1.00',
      ].join('\n');

      const { datContent, totalParsed, uniqueCount } =
        convertNpsTsvToLogiqxDat(sampleTsv);

      expect(totalParsed).toBe(2);
      expect(uniqueCount).toBe(2);
      expect(datContent).toContain('<name>Sony - PlayStation Vita</name>');
      expect(datContent).toContain(
        '<game name="Axiom Verge (USA)" serial="PCSE-00651">',
      );
      expect(datContent).toContain('rom name="Axiom Verge (USA).zip"');
      expect(datContent).toContain('serial="PCSE-00651"');
      expect(datContent).toContain(
        '<game name="Axiom Verge (Europe)" serial="PCSB-00779">',
      );
      expect(datContent).toContain('rom name="Axiom Verge (Europe).zip"');
      expect(datContent).toContain('serial="PCSB-00779"');
    });

    it('should disambiguate duplicate titles with (Alt) suffix', () => {
      const sampleTsv = [
        'Title ID\tRegion\tName\tPKG direct link\tzRIF\tContent ID\tLast Modification Date\tOriginal Name\tFile Size\tSHA256\tRequired FW\tApp Version',
        'PCSE00760\tUS\tVolume\thttp://pkg.link\tKO5if...\tUP0001-PCSE00760_00-VOLUME0000000001\t2018-01-01\tVolume\t50000000\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\t3.60\t1.00',
        'PCSE00910\tUS\tVolume\thttp://pkg.link\tKO5if...\tUP0001-PCSE00910_00-VOLUME0000000002\t2018-01-01\tVolume\t50000000\te3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\t3.60\t1.00',
      ].join('\n');

      const { datContent, uniqueCount } = convertNpsTsvToLogiqxDat(sampleTsv);
      expect(uniqueCount).toBe(2);
      expect(datContent).toContain(
        '<game name="Volume (USA)" serial="PCSE-00760">',
      );
      expect(datContent).toContain(
        '<game name="Volume (Alt) (USA)" serial="PCSE-00910">',
      );
    });
  });
});
