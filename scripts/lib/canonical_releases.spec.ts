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
  findCanonicalBundle,
  CanonicalRelease,
} from './canonical_releases.js';
import {
  extractRegions,
  extractVariants,
  extractDiscLabel,
} from './dat_format.js';
import {
  getRomGroupingKey,
  enrichGameDetailWithCompanionDiscs,
  CompanionDiscCandidateRow,
} from './queries.js';

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

    it('should flag titles with digital keywords or DLC categories while preserving physical bundles (category 3)', () => {
      expect(isDigitalFluffTitle('Super Mario World (Virtual Console)')).toBe(
        true,
      );
      expect(
        isDigitalFluffTitle('Streets of Rage (Nintendo Switch Online)'),
      ).toBe(true);
      expect(isDigitalFluffTitle('Cyberpunk 2077: Phantom Liberty', 1)).toBe(
        true,
      ); // DLC
      expect(isDigitalFluffTitle('The Witcher 3: Blood and Wine', 2)).toBe(
        true,
      ); // Expansion
      expect(isDigitalFluffTitle('Community Mod Pack', 5)).toBe(true); // Mod
      expect(isDigitalFluffTitle('Life is Strange: Episode 2', 6)).toBe(true); // Episode
      expect(isDigitalFluffTitle('Hitman: Season 1', 7)).toBe(true); // Season
      expect(isDigitalFluffTitle('Costume Pack', 13)).toBe(true); // Pack/Addon
      expect(isDigitalFluffTitle('Super Mario 3D All-Stars', 3)).toBe(false); // Bundle (allowed!)
      expect(isDigitalFluffTitle('Chrono Trigger', 0)).toBe(false);
    });

    it('should match Japanese regional releases via alternativeNames on FDS (54) and 64DD (55)', () => {
      const fdsAnd64ddCanonical: CanonicalRelease[] = [
        {
          platform_id: 54,
          raw_title: 'Super Mario Bros. 2',
          normalized_title: 'supermariobros2',
          region: 'Japan',
          variants: null,
          rom_name: 'Super Mario Bros. 2 (Japan).fds',
          rom_crc: 'F04CD4CD',
          source: 'dat',
          is_verified_physical: 1,
        },
        {
          platform_id: 55,
          raw_title: 'Doubutsu no Mori',
          normalized_title: 'dobutsunomori',
          region: 'Japan',
          variants: null,
          rom_name: 'Doubutsu no Mori (Japan).ndd',
          rom_crc: '34FA2991',
          source: 'dat',
          is_verified_physical: 1,
        },
      ];

      const lostLevelsRes = detectPhysicalReleaseStatus({
        platformId: 54,
        gameTitle: 'Super Mario Bros.: The Lost Levels',
        alternativeNames: [
          { name: 'Super Mario Bros. 2', comment: 'Japanese title' },
        ],
        canonicalReleases: fdsAnd64ddCanonical,
      });
      expect(lostLevelsRes.physical_status).toBe('verified_physical');
      expect(lostLevelsRes.physical_regions).toEqual(['Japan']);

      const animalCrossingRes = detectPhysicalReleaseStatus({
        platformId: 55,
        gameTitle: 'Animal Crossing',
        alternativeNames: [
          { name: 'Dōbutsu no Mori', comment: 'Japanese title' },
        ],
        canonicalReleases: fdsAnd64ddCanonical,
      });
      expect(animalCrossingRes.physical_status).toBe('verified_physical');
      expect(animalCrossingRes.physical_regions).toEqual(['Japan']);
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

  describe('Canonical Extracted ROMs & Multi-Game Bundles', () => {
    it('should classify EarthBound Beginnings on NES as digital_extracted_rom with provenance metadata', () => {
      const result = detectPhysicalReleaseStatus({
        platformId: 13, // NES
        gameTitle: 'EarthBound Beginnings',
        canonicalReleases: [], // No physical NES cartridge in US
      });

      expect(result.physical_status).toBe('digital_extracted_rom');
      expect(result.is_physical).toBe(false);
      expect(result.verification_tier).toBe(3);
      expect(result.origin_metadata?.origin_channel).toContain(
        'Wii U Virtual Console',
      );
      expect(result.origin_metadata?.target_hardware).toBe(
        'Nintendo Entertainment System',
      );
    });

    it('should classify Star Fox 2 and Trials of Mana on SNES as digital_extracted_rom', () => {
      const starFoxResult = detectPhysicalReleaseStatus({
        platformId: 19, // SNES
        gameTitle: 'Star Fox 2',
        canonicalReleases: [],
      });
      expect(starFoxResult.physical_status).toBe('digital_extracted_rom');
      expect(starFoxResult.origin_metadata?.origin_channel).toContain(
        'Super NES Classic Edition',
      );

      const trialsResult = detectPhysicalReleaseStatus({
        platformId: 19, // SNES
        gameTitle: 'Trials of Mana',
        canonicalReleases: [],
      });
      expect(trialsResult.physical_status).toBe('digital_extracted_rom');
      expect(trialsResult.origin_metadata?.origin_channel).toContain(
        'Collection of Mana',
      );
    });

    it('should retain verified_physical for Mother on Famicom when physical DAT matches', () => {
      const mockFamicomDat: CanonicalRelease[] = [
        {
          platform_id: 53, // Famicom
          raw_title: 'Mother',
          normalized_title: 'mother',
          region: 'Japan',
          variants: null,
          rom_name: 'Mother (Japan).nes',
          rom_crc: '2A111717',
          source: 'dat',
          is_verified_physical: 1,
        },
      ];

      const result = detectPhysicalReleaseStatus({
        platformId: 53, // Famicom
        gameTitle: 'Mother',
        canonicalReleases: mockFamicomDat,
      });

      expect(result.physical_status).toBe('verified_physical');
      expect(result.is_physical).toBe(true);
      expect(result.verification_tier).toBe(1);
    });

    it('should correctly find canonical bundle definitions for Bayonetta 2 and Rodea the Sky Soldier', () => {
      const bayoBundle = findCanonicalBundle('Bayonetta 2', 24);
      expect(bayoBundle).not.toBeNull();
      expect(bayoBundle?.includedGames).toHaveLength(2);
      expect(bayoBundle?.includedGames[1].title).toBe('Bayonetta');
      expect(bayoBundle?.includedGames[1].platformId).toBe(24);

      const rodeaBundle = findCanonicalBundle('Rodea the Sky Soldier', 24);
      expect(rodeaBundle).not.toBeNull();
      expect(rodeaBundle?.includedGames).toHaveLength(2);
      expect(rodeaBundle?.includedGames[1].title).toBe('Rodea the Sky Soldier');
      expect(rodeaBundle?.includedGames[1].platformId).toBe(22); // Wii
    });
  });

  describe('Special Label Exclusives, Superseded Releases, and Multi-Disc Normalization', () => {
    it('should tag budget-label-exclusive releases with their specific label and line', () => {
      // Pikmin 2 (USA, Wii) was exclusively released as a Nintendo Selects title in NA, while EU/AU/JP released under New Play Control!
      expect(extractVariants('Pikmin 2 (USA) (En,Fr,Es).rvz', 22)).toBe(
        'Nintendo Selects',
      );
      expect(
        extractVariants('Pikmin 2 (Europe) (En,Fr,De,Es,It).rvz', 22),
      ).toBe('New Play Control!');

      // Mario Power Tennis (USA, Wii): launched under the New Play Control! line
      expect(
        extractVariants('Mario Power Tennis (USA) (En,Fr,Es).rvz', 22),
      ).toBe('New Play Control!');

      // Jet Moto 2 (USA, PS1): Rev 0 was standard black label, Rev 1 (Championship Edition) was Greatest Hits exclusive
      expect(extractVariants('Jet Moto 2 (USA).bin', 29)).toBeNull();
      expect(extractVariants('Jet Moto 2 (USA) (Rev 1).bin', 29)).toBe(
        'Rev 1, Greatest Hits',
      );

      // Silent Hill 2 (USA, PS2): Greatest Hits (v2.01) exclusive expanded Director's Cut
      expect(
        extractVariants(
          'Silent Hill 2 (USA) (En,Ja,Fr,De,Es,It) (v2.01).iso',
          30,
        ),
      ).toBe('v2.01, Greatest Hits');

      // Classic NES Series (GBA)
      expect(
        extractVariants(
          'Classic NES Series - Super Mario Bros. (USA, Europe).gba',
          21,
        ),
      ).toBe('Classic NES Series');
    });

    it('should tag original 1-disc releases reused as Disc 1 in later 2-disc GOTY releases as Superseded', () => {
      // The Elder Scrolls IV: Oblivion (Xbox 360, platform 48)
      expect(
        extractVariants('Elder Scrolls IV, The - Oblivion (USA).iso', 48),
      ).toBe('Superseded');

      // GOTY Disc 2 should NOT be tagged Superseded
      expect(
        extractVariants(
          'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
          48,
        ),
      ).toBeNull();

      // Skyrim (USA, Xbox 360) -> Superseded by Skyrim Legendary Edition
      expect(
        extractVariants('Elder Scrolls V, The - Skyrim (USA).iso', 48),
      ).toBe('Superseded');
    });

    it('should strip localized disc markers, disc-role parentheticals, per-disc subtitles, and leaked languages/regions from variants', () => {
      // Italian Oblivion GOTY Disco 2
      expect(
        extractVariants(
          "Elder Scrolls IV, The - Oblivion - Edizione Gioco dell'Anno (Italy) (Disco 2).iso",
          48,
        ),
      ).toBeNull();

      // Red Dead Redemption GOTY per-disc subtitles
      const rdr1 =
        'Red Dead Redemption - Game of the Year Edition (USA, Europe) (En,Fr,De,Es,It) (Disc 1) (Red Dead Redemption Single Player).iso';
      const rdr2 =
        'Red Dead Redemption - Game of the Year Edition (USA, Europe) (En,Fr,De,Es,It) (Disc 2) (Undead Nightmare and Multiplayer).iso';
      expect(extractVariants(rdr1, 48)).toBeNull();
      expect(extractVariants(rdr2, 48)).toBeNull();
      expect(getRomGroupingKey(rdr1)).toBe(getRomGroupingKey(rdr2));
      expect(extractDiscLabel(rdr1)).toBe(
        'Disc 1 — Red Dead Redemption Single Player',
      );
      expect(extractDiscLabel(rdr2)).toBe(
        'Disc 2 — Undead Nightmare and Multiplayer',
      );

      // Leaked language codes and multi-word regions
      expect(
        extractVariants(
          'Killzone 2 (Europe) (En,Fr,De,Es,It,Nl,Pt,Pl,Ru,Cs,Hu,Hr,El,Sv,No,Da,Fi).iso',
          32,
        ),
      ).toBeNull();
      expect(
        extractRegions(
          'FIFA 08 (United Kingdom, Ireland) (En,Fr,De,Es,It).iso',
        ),
      ).toBe('UK, Ireland');
      expect(
        extractVariants(
          'FIFA 08 (United Kingdom, Ireland) (En,Fr,De,Es,It).iso',
          48,
        ),
      ).toBeNull();

      // Build dates and timestamps on Beta/Proto/Demo ROMs should not become variant tags
      expect(extractVariants('Glover (USA) (1998-07-16) (Beta).z64', 17)).toBe(
        'Beta',
      );
      expect(
        extractVariants(
          'Turok 3 - Shadow of Oblivion (Europe) (Beta) (2000-07-16T211412).z64',
          17,
        ),
      ).toBe('Beta');
    });

    it('should enrich game details for Case 1 (GOTY prepends companion Disc 1) and Case 2 (Original links forward to GOTY) without changing ownership', () => {
      const platformReleases: CompanionDiscCandidateRow[] = [
        {
          id: 'the-elder-scrolls-iv-oblivion-48-usa',
          game_id: 3796,
          game_title: 'The Elder Scrolls IV: Oblivion',
          platform_id: 48,
          region: 'USA',
          variants: 'Superseded',
          rom_name: 'Elder Scrolls IV, The - Oblivion (USA).iso',
          rom_crc: '34DFCC77',
          backup_status: 1,
          ownership_status: 1,
          release_date: '2006-03-20',
        },
        {
          id: 'the-elder-scrolls-iv-oblivion-game-of-the-year-edition-48-usa',
          game_id: 3798,
          game_title:
            'The Elder Scrolls IV: Oblivion - Game of the Year Edition',
          platform_id: 48,
          region: 'USA',
          variants: null,
          rom_name:
            'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
          rom_crc: '779C2B27',
          backup_status: 0,
          ownership_status: 0,
          release_date: '2007-09-11',
        },
      ];

      // Case 1: Viewing unowned GOTY release when original release is backed up
      const gotyDetail: {
        id: string;
        stable_id: number;
        title: string;
        platform_id: number;
        region: string;
        variants: string | null;
        rom_name: string;
        ownership_status: number;
        releases: Array<Record<string, unknown>>;
      } = {
        id: 'the-elder-scrolls-iv-oblivion-game-of-the-year-edition-48-usa',
        stable_id: 3798,
        title: 'The Elder Scrolls IV: Oblivion - Game of the Year Edition',
        platform_id: 48,
        region: 'USA',
        variants: null,
        rom_name:
          'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
        ownership_status: 0,
        releases: [
          {
            id: 'the-elder-scrolls-iv-oblivion-game-of-the-year-edition-48-usa',
            game_id: 3798,
            region: 'USA',
            variants: null,
            rom_name:
              'Elder Scrolls IV, The - Oblivion - Game of the Year Edition (USA) (Disc 2).iso',
            rom_crc: '779C2B27',
            backup_status: 0,
            ownership_status: 0,
          },
        ],
      };

      enrichGameDetailWithCompanionDiscs(gotyDetail, platformReleases);

      // GOTY ownership is untouched (0), but companion Disc 1 is prepended as Backed Up (1) with link back to Original
      expect(gotyDetail.ownership_status).toBe(0);
      expect(gotyDetail.releases).toHaveLength(2);
      expect(gotyDetail.releases[0]['is_companion_base_disc']).toBe(true);
      expect(gotyDetail.releases[0]['backup_status']).toBe(1);
      expect(gotyDetail.releases[0]['companion_game_id']).toBe(
        'the-elder-scrolls-iv-oblivion-48-usa',
      );
      expect(gotyDetail.releases[1]['disc_label']).toBe('Disc 2');

      // Case 2: Viewing unowned Original release whose Disc 1 is backed up via GOTY
      const originalDetail: {
        id: string;
        stable_id: number;
        title: string;
        platform_id: number;
        region: string;
        variants: string;
        rom_name: string;
        ownership_status: number;
        backup_status: number;
        releases: Array<Record<string, unknown>>;
        shared_backup_releases?: Array<{
          id: string;
          title: string;
          region: string | null;
          variants: string | null;
          rom_name: string;
          ownership_status: number;
          backup_status: number;
        }>;
      } = {
        id: 'the-elder-scrolls-iv-oblivion-48-usa',
        stable_id: 3796,
        title: 'The Elder Scrolls IV: Oblivion',
        platform_id: 48,
        region: 'USA',
        variants: 'Superseded',
        rom_name: 'Elder Scrolls IV, The - Oblivion (USA).iso',
        ownership_status: 0,
        backup_status: 1,
        releases: [
          {
            id: 'the-elder-scrolls-iv-oblivion-48-usa',
            game_id: 3796,
            region: 'USA',
            variants: 'Superseded',
            rom_name: 'Elder Scrolls IV, The - Oblivion (USA).iso',
            rom_crc: '34DFCC77',
            backup_status: 1,
            ownership_status: 0,
          },
        ],
      };

      enrichGameDetailWithCompanionDiscs(originalDetail, platformReleases);

      // Original remains unowned (0), backed up (1), and includes forward link to GOTY release
      expect(originalDetail.ownership_status).toBe(0);
      expect(originalDetail.backup_status).toBe(1);
      expect(originalDetail.shared_backup_releases).toBeDefined();
      expect(originalDetail.shared_backup_releases).toHaveLength(1);
      expect(originalDetail.shared_backup_releases![0].id).toBe(
        'the-elder-scrolls-iv-oblivion-game-of-the-year-edition-48-usa',
      );
    });
  });
});
