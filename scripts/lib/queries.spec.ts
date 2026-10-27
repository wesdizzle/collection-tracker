import { describe, it, expect } from 'vitest';
import { resolveLocalizedReleaseTitle } from './queries.js';

describe('resolveLocalizedReleaseTitle', () => {
  const apeEscapeMetadata = JSON.stringify({
    game_localizations: [
      { region: 3, name: 'サルゲッチュ' },
      { region: 4, name: 'Ape Escape' },
    ],
    alternative_names: [
      { comment: 'Japanese title', name: 'サルゲッチュ' },
      {
        comment: 'Spanish title',
        name: 'Ape Escape: La Invasión de los Monos',
      },
      { comment: 'Japanese title (romanized)', name: 'Saru Get You' },
    ],
  });

  it('resolves native Japanese Katakana title for Japan releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan',
      apeEscapeMetadata,
      'Saru! Get You!',
    );
    expect(title).toBe('サルゲッチュ');
  });

  it('resolves native Japanese Katakana title for Japan, Asia releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan, Asia',
      apeEscapeMetadata,
      'Saru! Get You!',
    );
    expect(title).toBe('サルゲッチュ');
  });

  it('resolves Spanish localized title from alternative_names for Spain releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Spain',
      apeEscapeMetadata,
      'Ape Escape - La Invasion de los Monos',
    );
    expect(title).toBe('Ape Escape: La Invasión de los Monos');
  });

  it('resolves European title from game_localizations for Europe releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Europe',
      apeEscapeMetadata,
      'Ape Escape',
    );
    expect(title).toBe('Ape Escape');
  });

  it('defaults to English gameTitle for USA releases', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'USA',
      apeEscapeMetadata,
      'Ape Escape',
    );
    expect(title).toBe('Ape Escape');
  });

  it('resolves native Korean Hangul title when present', () => {
    const koreanMetadata = JSON.stringify({
      game_localizations: [{ region: 2, name: '사루겟츄' }],
      alternative_names: [{ comment: 'Korean title', name: '사루겟츄' }],
    });
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Korea',
      koreanMetadata,
      'Ape Escape',
    );
    expect(title).toBe('사루겟츄');
  });

  it('falls back to canonicalTitle when metadata_json is null or missing localized title', () => {
    const title = resolveLocalizedReleaseTitle(
      'Resident Evil 3: Nemesis',
      'Japan',
      null,
      'Biohazard 3 - Last Escape',
    );
    expect(title).toBe('Biohazard 3 - Last Escape');
  });

  it('falls back to gameTitle when canonicalTitle matches gameTitle or is empty', () => {
    const title = resolveLocalizedReleaseTitle(
      'Super Mario 64',
      'USA',
      null,
      'Super Mario 64',
    );
    expect(title).toBe('Super Mario 64');
  });

  it('handles invalid metadata_json gracefully without throwing', () => {
    const title = resolveLocalizedReleaseTitle(
      'Ape Escape',
      'Japan',
      '{ invalid json',
      'Saru! Get You!',
    );
    expect(title).toBe('Saru! Get You!');
  });
});
