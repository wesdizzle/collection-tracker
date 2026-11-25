import { describe, it, expect } from 'vitest';
import {
  parseWikiDate,
  cleanWikiTitle,
  classifyCartridgeBudgetWithRecords,
  parseNintendoSelectsWikitext,
  parsePlayStationGreatestHitsWikitext,
  parsePlayStationEssentialsWikitext,
  parseXboxBudgetWikitext,
  BudgetInductionRecord,
} from './budget_sources.js';
import { getCuratedReleaseTags } from '../../shared/special_labels.js';
import { normalizeTitleForMatching } from '../../shared/title_matching.js';

describe('Budget Sources Public Aggregator', () => {
  const mockBudgetRecords: BudgetInductionRecord[] = [
    {
      title: 'Animal Crossing: New Leaf',
      normalizedTitle: 'animalcrossingnewleaf',
      platformId: 23,
      budgetLabel: 'Nintendo Selects',
      regionalInductionDates: {
        USA: '2016-08-26',
        Europe: '2018-06-29',
      },
    },
  ];

  it('parses wiki date templates and prose dates without coercing year-only to YYYY-01-01', () => {
    expect(parseWikiDate('{{dts|2016|08|26}}')).toBe('2016-08-26');
    expect(parseWikiDate('{{dts|2018|06|29}}')).toBe('2018-06-29');
    expect(
      parseWikiDate('August 15, 1999{{citation needed|date=September 2016}}'),
    ).toBe('1999-08-15');
    expect(parseWikiDate('October 1997')).toBe('1997-10');
    expect(parseWikiDate('1998')).toBe('1998');
    expect(parseWikiDate('{{Unreleased}}')).toBeNull();
    expect(parseWikiDate('{{n/a|Unknown if released}}')).toBeNull();
  });

  it('cleans wiki game titles', () => {
    expect(cleanWikiTitle("''[[Animal Crossing: New Leaf]]''")).toBe(
      'Animal Crossing: New Leaf',
    );
    expect(
      cleanWikiTitle(
        "''[[Super Mario Maker|Super Mario Maker for Nintendo 3DS]]''",
      ),
    ).toBe('Super Mario Maker for Nintendo 3DS');
  });

  it('parses Nintendo_Selects tables with exact regional column order and GameCube bullets', () => {
    const sampleWiki = `
=== Nintendo 64 ===
{| class="wikitable sortable"
|-
! width=40% rowspan=2 | Game
! width=30% colspan=2 | Release date
|-
! width=15% | PAL
! width=15% | North America
|-
| ''[[Banjo-Kazooie (video game)|Banjo-Kazooie]]''
| 1998
| August 15, 1999{{citation needed}}
|-
| ''[[Diddy Kong Racing]]''
| {{n/a|Unknown if released}}
| July 1999
|}

=== GameCube ===
* ''[[Luigi's Mansion]]''
* ''[[Pac-Man World 2]]'' / ''[[Pac-Man Vs.]]''

=== Nintendo 3DS ===
{| class="wikitable sortable"
! Game !! Europe !! North America !! Australia !! Japan
|-
| ''[[Luigi's Mansion: Dark Moon]]''
| {{dts|2017|10|13}}
| {{dts|2016|08|26}}
| {{dts|2016|09|01}}
| {{n/a|Unreleased}}
|}
`;
    const records = parseNintendoSelectsWikitext(sampleWiki);
    const banjo = records.find(
      (r) => r.normalizedTitle === normalizeTitleForMatching('Banjo-Kazooie'),
    );
    expect(banjo).toBeTruthy();
    expect(banjo?.platformId).toBe(17);
    expect(banjo?.budgetLabel).toBe("Player's Choice");
    expect(banjo?.regionalInductionDates).toEqual({
      Europe: '1998',
      USA: '1999-08-15',
    });

    // Banjo-Kazooie launched 1998-06-29 in USA and 1998 in Europe -> NEVER budget_only
    expect(
      classifyCartridgeBudgetWithRecords(records, {
        platformId: 17,
        gameTitle: 'Banjo-Kazooie',
        region: 'USA',
        physicalReleaseDate: '1998-06-29',
      }),
    ).toMatchObject({
      isBudget: true,
      isBudgetOnly: false,
      budgetLabel: null,
      alsoReleasedAs: "Player's Choice",
    });

    expect(
      classifyCartridgeBudgetWithRecords(records, {
        platformId: 17,
        gameTitle: 'Banjo-Kazooie',
        region: 'Europe',
        physicalReleaseDate: '1998-06-29',
      }),
    ).toMatchObject({
      isBudget: true,
      isBudgetOnly: false,
      alsoReleasedAs: "Player's Choice",
    });

    // Japan never got N64 Player's Choice
    expect(
      classifyCartridgeBudgetWithRecords(records, {
        platformId: 17,
        gameTitle: 'Banjo-Kazooie',
        region: 'Japan',
        physicalReleaseDate: '1998-12-06',
      }),
    ).toMatchObject({
      isBudget: false,
      isBudgetOnly: false,
      alsoReleasedAs: null,
    });

    // 3DS Luigi's Mansion (2018 remake) must NOT substring-match Luigi's Mansion: Dark Moon
    expect(
      classifyCartridgeBudgetWithRecords(records, {
        platformId: 23,
        gameTitle: "Luigi's Mansion",
        region: 'USA',
        physicalReleaseDate: '2018-10-12',
      }),
    ).toMatchObject({
      isBudget: false,
      isBudgetOnly: false,
    });

    // GameCube bullet list & slash bundle split
    expect(
      records.some(
        (r) =>
          r.platformId === 20 &&
          r.normalizedTitle === normalizeTitleForMatching("Luigi's Mansion"),
      ),
    ).toBe(true);
    expect(
      records.some(
        (r) =>
          r.platformId === 20 &&
          r.normalizedTitle === normalizeTitleForMatching('Pac-Man Vs.'),
      ),
    ).toBe(true);
  });

  it('parses PlayStation and Xbox Wikipedia budget line pages with regional labels', () => {
    const ghRecords = parsePlayStationGreatestHitsWikitext(`
===PlayStation===
* ''[[Crash Bandicoot (video game)|Crash Bandicoot]]''
===PlayStation 4===
* ''[[Bloodborne]]''
* ''[[Dragon Ball Xenoverse 2]] (Europe Only)''
`);
    expect(
      ghRecords.find(
        (r) =>
          r.platformId === 29 &&
          r.normalizedTitle === normalizeTitleForMatching('Crash Bandicoot'),
      ),
    ).toMatchObject({
      budgetLabel: 'Greatest Hits',
      regionalInductionDates: { USA: '' },
    });
    expect(
      ghRecords.find(
        (r) =>
          r.platformId === 34 &&
          r.normalizedTitle ===
            normalizeTitleForMatching('Dragon Ball Xenoverse 2'),
      )?.regionalInductionDates,
    ).toEqual({ Europe: '' });

    const essRecords = parsePlayStationEssentialsWikitext(`
==List of Platinum range games==
===PlayStation 2 titles===
* ''[[Shadow the Hedgehog (video game)|Shadow the Hedgehog]]''
==List of Essentials range games==
===PlayStation 3 titles===
* ''[[Dishonored|Dishonored: Game of the Year Edition]]''
`);
    expect(
      essRecords.find(
        (r) =>
          r.platformId === 30 &&
          r.normalizedTitle ===
            normalizeTitleForMatching('Shadow the Hedgehog'),
      ),
    ).toMatchObject({
      budgetLabel: 'Platinum',
      regionalInductionDates: { Europe: '', Australia: '' },
    });
    expect(
      essRecords.find(
        (r) =>
          r.platformId === 32 &&
          r.normalizedTitle ===
            normalizeTitleForMatching('Dishonored: Game of the Year Edition'),
      ),
    ).toMatchObject({
      budgetLabel: 'Essentials',
    });

    const xboxRecords = parseXboxBudgetWikitext(`
==Original Xbox==
===Games in ''Platinum Hits'' series===
* ''[[Blinx: The Time Sweeper]]''
===Games in ''Classics'' series (132)===
* ''[[Blinx: The Time Sweeper]]''
==Xbox 360==
===Games in Xbox 360 Platinum Collection (NTSC[J])===
* ''[[Alan Wake]]''
`);
    expect(
      xboxRecords.filter(
        (r) =>
          r.platformId === 47 &&
          r.normalizedTitle ===
            normalizeTitleForMatching('Blinx: The Time Sweeper'),
      ),
    ).toHaveLength(2);
    expect(
      xboxRecords.find(
        (r) =>
          r.platformId === 48 &&
          r.normalizedTitle === normalizeTitleForMatching('Alan Wake'),
      ),
    ).toMatchObject({
      budgetLabel: 'Platinum Collection',
      regionalInductionDates: { Japan: '' },
    });
  });

  it('scopes SUBSEQUENT_VERSION_BUDGET_EXCLUSIVES Spider-Man Rev 1 strictly to Xbox (platform 47)', () => {
    expect(
      getCuratedReleaseTags('Spider-Man (USA) (Rev 1).iso', 'USA', 47),
    ).toContain('Platinum Hits');
    expect(
      getCuratedReleaseTags('Spider-Man (USA) (Rev 1).iso', 'USA', 20),
    ).not.toContain('Platinum Hits');
    expect(
      getCuratedReleaseTags('Spider-Man (Europe) (Rev 1).iso', 'Europe', 20),
    ).not.toContain('Xbox Classics');
  });

  it('classifies Animal Crossing Welcome amiibo USA as budget_only', () => {
    const result = classifyCartridgeBudgetWithRecords(mockBudgetRecords, {
      platformId: 23,
      gameTitle: 'Animal Crossing: New Leaf - Welcome amiibo',
      region: 'USA',
      physicalReleaseDate: '2016-12-02',
      isUpdatedEdition: true,
    });

    expect(result.isBudget).toBe(true);
    expect(result.isBudgetOnly).toBe(true);
    expect(result.budgetLabel).toBe('Nintendo Selects');
    expect(result.alsoReleasedAs).toBeNull();
  });

  it('classifies Animal Crossing Welcome amiibo Europe as standard_and_budget', () => {
    const result = classifyCartridgeBudgetWithRecords(mockBudgetRecords, {
      platformId: 23,
      gameTitle: 'Animal Crossing: New Leaf - Welcome amiibo',
      region: 'Europe',
      physicalReleaseDate: '2016-11-25',
      isUpdatedEdition: true,
    });

    expect(result.isBudget).toBe(true);
    expect(result.isBudgetOnly).toBe(false);
    expect(result.alsoReleasedAs).toBe('Nintendo Selects');
  });
});
