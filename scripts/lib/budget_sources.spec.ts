import { describe, it, expect } from 'vitest';
import {
  parseWikiDate,
  cleanWikiTitle,
  classifyCartridgeBudgetStatus,
} from './budget_sources.js';
import { classifyRedumpEdition } from './redump_metadata.js';

describe('Budget Sources Public Aggregator', () => {
  it('parses wiki date templates', () => {
    expect(parseWikiDate('{{dts|2016|08|26}}')).toBe('2016-08-26');
    expect(parseWikiDate('{{dts|2018|06|29}}')).toBe('2018-06-29');
    expect(parseWikiDate('{{Unreleased}}')).toBeNull();
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

  it('classifies Animal Crossing Welcome amiibo USA as budget_only', async () => {
    const result = await classifyCartridgeBudgetStatus({
      platformId: 23, // 3DS
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

  it('classifies Animal Crossing Welcome amiibo Europe as standard_and_budget', async () => {
    const result = await classifyCartridgeBudgetStatus({
      platformId: 23, // 3DS
      gameTitle: 'Animal Crossing: New Leaf - Welcome amiibo',
      region: 'Europe',
      physicalReleaseDate: '2016-11-25',
      isUpdatedEdition: true,
    });

    expect(result.isBudget).toBe(true);
    expect(result.isBudgetOnly).toBe(false);
    expect(result.alsoReleasedAs).toBe('Nintendo Selects');
  });

  it('classifies Redump editions correctly', () => {
    // Standard and budget
    const sb = classifyRedumpEdition("Original, Player's Choice");
    expect(sb.isBudgetOnly).toBe(false);
    expect(sb.alsoReleasedAs).toBe("Player's Choice");

    // Budget only
    const bo = classifyRedumpEdition('Nintendo Selects');
    expect(bo.isBudgetOnly).toBe(true);
    expect(bo.primaryBudgetLabel).toBe('Nintendo Selects');

    // Box set edition
    const box = classifyRedumpEdition('Greatest Hits, God of War Saga');
    expect(box.isBudgetOnly).toBe(true);
    expect(box.primaryBudgetLabel).toBe('Greatest Hits');
    expect(box.boxSetEdition).toBe('God of War Saga');
  });
});
