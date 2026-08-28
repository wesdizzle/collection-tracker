/**
 * CANONICAL RELEASES & PHYSICAL VERIFICATION TESTS
 */

import { describe, it, expect } from 'vitest';
import {
  detectPhysicalReleaseStatus,
  deduplicateDatReleases,
  cleanTitleWithoutParentheticals,
  extractSerialCode,
  isDigitalFluffTitle,
  hasEraDiscrepancy,
  CanonicalRelease,
} from './canonical_releases.js';

describe('Canonical Releases & Physical Verification Engine', () => {
  describe('cleanTitleWithoutParentheticals & extractSerialCode', () => {
    it('should clean parentheticals and reorganize ", The" and ", A" prefixes', () => {
      expect(
        cleanTitleWithoutParentheticals(
          'Legend of Zelda, The - Ocarina of Time (USA) (Rev 1)',
        ),
      ).toBe('The Legend of Zelda - Ocarina of Time');
      expect(cleanTitleWithoutParentheticals('Super Mario World (USA)')).toBe(
        'Super Mario World',
      );
      expect(cleanTitleWithoutParentheticals('Boy and His Blob, A (USA)')).toBe(
        'A Boy and His Blob',
      );
    });

    it('should extract console serial codes from titles and rom names', () => {
      expect(extractSerialCode('Final Fantasy VII (USA) (SLUS-00892)')).toBe(
        'SLUS-00892',
      );
      expect(extractSerialCode('Zelda (HAC-P-AAAAA)')).toBe('HAC-P-AAAAA');
      expect(extractSerialCode('Spider-Man (CUSA-02299)')).toBe('CUSA-02299');
      expect(extractSerialCode('Standard Title Without Serial')).toBeNull();
    });
  });

  describe('Tier 1: Canonical DAT Matching', () => {
    it('should confirm physical release with 100% confidence when matched in canonical dataset', () => {
      const mockReleases: CanonicalRelease[] = [
        {
          platform_id: 15, // SNES
          raw_title: 'Super Mario World',
          normalized_title: 'supermarioworld',
          region: 'USA, Europe',
          variants: 'Rev 1',
          rom_name: 'Super Mario World (USA).sfc',
          rom_crc: 'B19ED489',
          source: 'dat',
          is_verified_physical: 1,
        },
      ];

      const result = detectPhysicalReleaseStatus({
        platformId: 15,
        gameTitle: 'Super Mario World',
        canonicalReleases: mockReleases,
      });

      expect(result.physical_status).toBe('verified_physical');
      expect(result.verification_tier).toBe(1);
      expect(result.is_physical).toBe(true);
      expect(result.matched_releases).toHaveLength(1);
      expect(result.physical_regions).toContain('USA');
      expect(result.physical_regions).toContain('Europe');
    });
  });

  describe('Tier 2: External Metadata & Physical Publisher Whitelist', () => {
    it('should confirm likely physical for physical-only publishers', () => {
      const result = detectPhysicalReleaseStatus({
        platformId: 26, // Switch
        gameTitle: 'Celeste',
        publisher: 'Limited Run Games',
      });

      expect(result.physical_status).toBe('likely_physical');
      expect(result.verification_tier).toBe(2);
      expect(result.is_physical).toBe(true);
      expect(result.reasons[0]).toContain('Limited Run Games');
    });

    it('should confirm likely physical when physical packaging or format is present', () => {
      const result = detectPhysicalReleaseStatus({
        platformId: 34, // PS4
        gameTitle: 'Horizon Zero Dawn',
        igdbGameFormat: 'physical',
      });

      expect(result.physical_status).toBe('likely_physical');
      expect(result.verification_tier).toBe(2);
      expect(result.is_physical).toBe(true);
    });

    it('should confirm likely physical when retail barcode is provided', () => {
      const result = detectPhysicalReleaseStatus({
        platformId: 26, // Switch
        gameTitle: 'Custom Physical Game',
        barcode: '045496590420',
      });

      expect(result.physical_status).toBe('likely_physical');
      expect(result.verification_tier).toBe(2);
      expect(result.is_physical).toBe(true);
    });
  });

  describe('Tier 3: Platform Lifespan & Digital Fluff Elimination', () => {
    it('should flag retro games re-released on modern consoles as digital only', () => {
      const result = detectPhysicalReleaseStatus({
        platformId: 22, // Wii (Launch 2006)
        gameTitle: 'Super Mario Bros. 3',
        firstReleaseDate: '1988-10-23', // NES era (18 years before Wii)
        platformLaunchDate: '2006-11-19',
        canonicalReleases: [], // No physical Wii disc compilation match
      });

      expect(result.physical_status).toBe('digital_only');
      expect(result.verification_tier).toBe(3);
      expect(result.is_physical).toBe(false);
      expect(result.reasons[0]).toContain(
        'Original release date (1988) precedes platform launch (2006)',
      );
    });

    it('should flag titles with digital keywords or DLC categories', () => {
      expect(isDigitalFluffTitle('Super Mario World (Virtual Console)')).toBe(
        true,
      );
      expect(
        isDigitalFluffTitle('Streets of Rage (Nintendo Switch Online)'),
      ).toBe(true);
      expect(isDigitalFluffTitle('Cyberpunk 2077: Phantom Liberty', 1)).toBe(
        true,
      ); // DLC
      expect(isDigitalFluffTitle('Chrono Trigger')).toBe(false);
    });

    it('should correctly identify era discrepancies', () => {
      expect(hasEraDiscrepancy(1990, 2006)).toBe(true); // SNES game on Wii
      expect(hasEraDiscrepancy(2017, 2017)).toBe(false); // Switch launch game
      expect(hasEraDiscrepancy(2005, 2006)).toBe(false); // Cross-gen game
    });
  });

  describe('deduplicateDatReleases', () => {
    it('should consolidate multi-disc sets and remove non-physical dumps', () => {
      const rawReleases = [
        {
          name: 'Final Fantasy VII (USA) (Disc 1)',
          roms: [
            { name: 'Final Fantasy VII (USA) (Disc 1).bin', crc: '11111111' },
          ],
        },
        {
          name: 'Final Fantasy VII (USA) (Disc 2)',
          roms: [
            { name: 'Final Fantasy VII (USA) (Disc 2).bin', crc: '22222222' },
          ],
        },
        {
          name: 'Bad Dump Title (USA)',
          roms: [{ name: 'baddump.tik', crc: '00000000' }], // Ignored format
        },
      ];

      const deduplicated = deduplicateDatReleases(29, rawReleases); // PS1
      expect(deduplicated).toHaveLength(1);
      expect(deduplicated[0].raw_title).toBe('Final Fantasy VII');
      expect(deduplicated[0].normalized_title).toBe('finalfantasyvii');
      expect(deduplicated[0].region).toBe('USA');
    });
  });
});
