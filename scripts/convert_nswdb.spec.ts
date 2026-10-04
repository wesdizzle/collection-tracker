/**
 * Unit Tests for NSWDB XML to Canonical No-Intro DAT Converter
 */

import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  normalizeNswdbTitle,
  convertNswdbXmlToLogiqxDat,
} from './convert_nswdb.js';

describe('NSWDB XML to Logiqx DAT Converter', () => {
  describe('escapeXml', () => {
    it('should correctly escape XML special characters', () => {
      expect(escapeXml('Mario & Luigi <Brothers> "Special" \'Edition\'')).toBe(
        'Mario &amp; Luigi &lt;Brothers&gt; &quot;Special&quot; &apos;Edition&apos;',
      );
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });
  });

  describe('normalizeNswdbTitle', () => {
    it('should map WLD to World, sanitize colons to hyphens, and append region parenthetical', () => {
      const result = normalizeNswdbTitle(
        'The Legend of Zelda: Breath of the Wild',
        'WLD',
      );
      expect(result.cleanTitle).toBe(
        'The Legend of Zelda - Breath of the Wild',
      );
      expect(result.region).toBe('World');
      expect(result.fullName).toBe(
        'The Legend of Zelda - Breath of the Wild (World)',
      );
      expect(result.variants).toEqual([]);
    });

    it('should sanitize forward slashes and asterisks to Windows-safe characters', () => {
      const result = normalizeNswdbTitle(
        'Fate/Extella: The Umbral Star',
        'WLD',
      );
      expect(result.cleanTitle).toBe('Fate - Extella - The Umbral Star');
      expect(result.fullName).toBe('Fate - Extella - The Umbral Star (World)');

      const galGun = normalizeNswdbTitle('Gal*Gun 2', 'USA');
      expect(galGun.cleanTitle).toBe('Gal Gun 2');
      expect(galGun.fullName).toBe('Gal Gun 2 (USA)');
    });

    it('should extract *KIOSK* as a Demo variant', () => {
      const result = normalizeNswdbTitle('Super Mario Odyssey *KIOSK*', 'WLD');
      expect(result.cleanTitle).toBe('Super Mario Odyssey');
      expect(result.variants).toEqual(['Demo']);
      expect(result.fullName).toBe('Super Mario Odyssey (World) (Demo)');
    });

    it('should normalize bracketed revisions into parentheticals', () => {
      const result = normalizeNswdbTitle(
        'Mario Kart 8 Deluxe [Rev 1.0.0]',
        'WLD',
      );
      expect(result.cleanTitle).toBe('Mario Kart 8 Deluxe');
      expect(result.region).toBe('World');
      expect(result.variants).toEqual(['Rev 1.0.0']);
      expect(result.fullName).toBe('Mario Kart 8 Deluxe (World) (Rev 1.0.0)');
    });

    it('should normalize bracketed editions and regional codes', () => {
      const result = normalizeNswdbTitle(
        'Shin Megami Tensei V [Steelbook Edition]',
        'USA',
      );
      expect(result.cleanTitle).toBe('Shin Megami Tensei V');
      expect(result.region).toBe('USA');
      expect(result.variants).toEqual(['Steelbook Edition']);
      expect(result.fullName).toBe(
        'Shin Megami Tensei V (USA) (Steelbook Edition)',
      );
    });

    it('should normalize parenthetical revisions like (rev001)', () => {
      const result = normalizeNswdbTitle('Super Mario Odyssey (rev001)', 'WLD');
      expect(result.cleanTitle).toBe('Super Mario Odyssey');
      expect(result.variants).toEqual(['rev001']);
      expect(result.fullName).toBe('Super Mario Odyssey (World) (rev001)');
    });
  });

  describe('convertNswdbXmlToLogiqxDat', () => {
    it('should filter strictly to Type 1 (physical) and emit valid Logiqx XML', () => {
      const sampleNswdbXml = `<?xml version="1.0" encoding="UTF-8"?>
<releases>
  <release>
    <id>1</id>
    <name>The Legend of Zelda: Breath of the Wild</name>
    <publisher>Nintendo</publisher>
    <region>WLD</region>
    <languages>en,ja</languages>
    <serial>LA-H-AAAAA</serial>
    <imgcrc>5DD119C1</imgcrc>
    <trimmedsize>14880118272</trimmedsize>
    <type>1</type>
  </release>
  <release>
    <id>2</id>
    <name>Yooka-Laylee (Digital)</name>
    <publisher>Team17</publisher>
    <region>WLD</region>
    <serial>LA-N-ACKBA</serial>
    <imgcrc>3CFCF6A9</imgcrc>
    <trimmedsize>5762265436</trimmedsize>
    <type>4</type>
  </release>
  <release>
    <id>3</id>
    <name>DLC Pack</name>
    <publisher>Publisher</publisher>
    <region>GER</region>
    <imgcrc>E5F2E5DA</imgcrc>
    <type>3</type>
  </release>
</releases>`;

      const result = convertNswdbXmlToLogiqxDat(sampleNswdbXml);

      expect(result.totalParsed).toBe(3);
      expect(result.physicalCount).toBe(1);
      expect(result.validCrcCount).toBe(1);

      expect(result.datContent).toContain('<datafile>');
      expect(result.datContent).toContain(
        '<name>Nintendo - Nintendo Switch</name>',
      );
      expect(result.datContent).toContain(
        '<game name="The Legend of Zelda - Breath of the Wild (World)">',
      );
      expect(result.datContent).toContain('<publisher>Nintendo</publisher>');
      expect(result.datContent).toContain('crc="5dd119c1"');
      expect(result.datContent).toContain('serial="LA-H-AAAAA"');
      expect(result.datContent).toContain('size="14880118272"');

      // Ensure Type 4 (eShop) and Type 3 (DLC) were omitted
      expect(result.datContent).not.toContain('Yooka-Laylee');
      expect(result.datContent).not.toContain('DLC Pack');
    });

    it('should throw an error on malformed or missing releases root', () => {
      expect(() =>
        convertNswdbXmlToLogiqxDat('<wrongroot></wrongroot>'),
      ).toThrow('Invalid NSWDB XML');
    });
  });
});
