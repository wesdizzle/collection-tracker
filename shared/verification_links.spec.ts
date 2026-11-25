import { describe, expect, it } from 'vitest';
import { getVerificationSourceLink } from './verification_links.js';

describe('getVerificationSourceLink', () => {
  it('routes optical DAT/Redump sources to Redump quicksearch preferring serial code', () => {
    const withSerial = getVerificationSourceLink({
      source: 'dat',
      platformId: 34, // PS4 optical
      title: 'Bloodborne',
      serialCode: 'CUSA-00900',
    });
    expect(withSerial).toEqual({
      source: 'redump',
      label: 'Redump',
      url: 'https://redump.org/discs/quicksearch/CUSA-00900',
      tooltip: 'Verify disc serial CUSA-00900 on Redump.org',
    });

    const titleFallback = getVerificationSourceLink({
      source: 'dat',
      platformId: 49, // Xbox One optical
      title: 'Halo Infinite (USA)',
    });
    expect(titleFallback?.url).toBe(
      'https://redump.org/discs/quicksearch/Halo%20Infinite',
    );
  });

  it('routes cartridge DAT/No-Intro sources to No-Intro Dat-o-MATIC', () => {
    const link = getVerificationSourceLink({
      source: 'dat',
      platformId: 15, // SNES cartridge
      title: 'Super Metroid (USA)',
    });
    expect(link?.source).toBe('no_intro');
    expect(link?.label).toBe('No-Intro DAT');
    expect(link?.url).toContain('datomatic.no-intro.org');
    expect(link?.url).toContain('Super%20Metroid');
  });

  it('maps community spreadsheets, MAME, SerialStation, retail, LGN, and boutique sources accurately', () => {
    expect(
      getVerificationSourceLink({
        source: 'ps5db',
        platformId: 35,
        title: 'Astro Bot',
      })?.url,
    ).toContain('1LNoL9HTVyLutj9T_bWNM54qkyrPGV1tSkiTBJAus-cE');

    expect(
      getVerificationSourceLink({
        source: 'serialstation',
        platformId: 33,
        serialCode: 'PCSE-00019',
      })?.url,
    ).toBe('https://www.serialstation.com/titles/?search=PCSE-00019');

    expect(
      getVerificationSourceLink({
        source: 'nscollectors',
        platformId: 27,
        title: 'Mario Kart World',
      })?.url,
    ).toContain('1LEIJUOanvkKq9kv1fSOnD40GdE1Jt5LzSYsg8yAPmb8');

    expect(
      getVerificationSourceLink({
        source: 'nscollectors_upcoming',
        platformId: 26,
        title: 'Upcoming Game',
      })?.url,
    ).toContain('1FNyvbbU64Pb9lheg28gC_5fMalIYJ0aD763T7M1QqF0');

    expect(
      getVerificationSourceLink({
        source: 'nintendo_revised',
        platformId: 26,
      })?.url,
    ).toContain('1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs');

    expect(
      getVerificationSourceLink({
        source: 'mame',
        platformId: 9,
        title: 'Metal Slug',
      })?.url,
    ).toContain('adb.arcadeitalia.net');

    expect(
      getVerificationSourceLink({
        source: 'retail_catalog',
        platformId: 35,
        title: 'Elden Ring',
        retailUrl: 'https://pnpgamesonline.com/product/elden-ring',
      }),
    ).toMatchObject({
      label: 'Retail Storefront',
      url: 'https://pnpgamesonline.com/product/elden-ring',
    });

    expect(
      getVerificationSourceLink({
        source: 'retail_catalog',
        platformId: 35,
        title: 'Elden Ring',
      })?.url,
    ).toBe('https://videogamesplus.ca/search?q=Elden%20Ring');

    expect(
      getVerificationSourceLink({
        source: 'lgn',
        platformId: 26,
        title: 'Shantae',
      })?.url,
    ).toBe('https://limitedgamenews.com/?s=Shantae');
  });

  it('returns null for retired manual sources and unknown/unverified rows', () => {
    expect(getVerificationSourceLink({ source: 'manual' })).toBeNull();
    expect(
      getVerificationSourceLink({ source: 'manually_verified' }),
    ).toBeNull();
    expect(getVerificationSourceLink({ source: null })).toBeNull();
    expect(getVerificationSourceLink({ source: 'unknown_source' })).toBeNull();
  });
});
