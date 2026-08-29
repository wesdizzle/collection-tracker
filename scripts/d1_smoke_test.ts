/**
 * CLOUDFLARE D1 CANONICAL SERIES SMOKE TEST
 *
 * Verifies that key sentinel games in the Cloudflare D1 database have the correct
 * canonical series assigned across all taxonomies (Superheroes, LEGO, Crossovers,
 * Game & Watch precedence, Musou hosts, numbered IPs, and casing normalization).
 *
 * USAGE:
 *   npx tsx scripts/d1_smoke_test.ts [--remote | --local]
 */

import { execSync } from 'child_process';

interface ExpectedSentinel {
  title: string;
  expectedSeries: string;
  category: string;
}

export const SENTINELS: ExpectedSentinel[] = [
  // 1. Game & Watch & Donkey Kong Precedence
  {
    title: 'Game & Watch Gallery',
    expectedSeries: 'Game & Watch',
    category: 'Game & Watch Precedence',
  },
  {
    title: 'Game & Watch Gallery 2',
    expectedSeries: 'Game & Watch',
    category: 'Game & Watch Precedence',
  },
  {
    title: 'Game & Watch Collection',
    expectedSeries: 'Game & Watch',
    category: 'Game & Watch Precedence',
  },
  {
    title: 'Donkey Kong Country',
    expectedSeries: 'Donkey Kong',
    category: 'Donkey Kong',
  },
  {
    title: 'DK: Jungle Climber',
    expectedSeries: 'Donkey Kong',
    category: 'Short Substring Safeguard',
  },

  // 2. Numbered IP Protection & Roman Numerals
  {
    title: 'Mighty No. 9',
    expectedSeries: 'Mighty No. 9',
    category: 'Numbered IP Protection',
  },
  {
    title: 'Final Fantasy XII: The Zodiac Age',
    expectedSeries: 'Final Fantasy',
    category: 'Extended Roman Numerals',
  },
  {
    title: 'Dragon Quest XI: Echoes of an Elusive Age',
    expectedSeries: 'Dragon Quest',
    category: 'Extended Roman Numerals',
  },

  // 3. Superhero Granular Taxonomies (Marvel & DC)
  {
    title: 'Spider-Man',
    expectedSeries: 'Spider-Man',
    category: 'Marvel Hero Split',
  },
  {
    title: 'Spider-Man: Shattered Dimensions',
    expectedSeries: 'Spider-Man',
    category: 'Marvel Hero Split',
  },
  {
    title: 'Batman: Return of the Joker',
    expectedSeries: 'Batman',
    category: 'DC Hero Split',
  },
  {
    title: 'Batman: Arkham City',
    expectedSeries: 'Batman',
    category: 'DC Hero Split',
  },
  {
    title: 'Superman: Shadow of Apokolips',
    expectedSeries: 'Superman',
    category: 'DC Hero Split',
  },
  {
    title: 'Injustice 2',
    expectedSeries: 'Injustice',
    category: 'DC Franchise Split',
  },
  {
    title: 'X-Men Origins: Wolverine',
    expectedSeries: 'X-Men',
    category: 'Marvel Team Split',
  },
  {
    title: 'Iron Man',
    expectedSeries: 'Iron Man',
    category: 'Marvel Hero Split',
  },
  {
    title: 'Marvel: Ultimate Alliance',
    expectedSeries: 'Marvel',
    category: 'Marvel Ensemble Umbrella',
  },
  {
    title: 'DC Universe Online',
    expectedSeries: 'DC',
    category: 'DC Ensemble Umbrella',
  },

  // 4. LEGO Sub-Themes
  {
    title: 'LEGO Star Wars II: The Original Trilogy',
    expectedSeries: 'LEGO Star Wars',
    category: 'LEGO Sub-Themes',
  },
  {
    title: 'LEGO Batman: The Videogame',
    expectedSeries: 'LEGO Batman',
    category: 'LEGO Sub-Themes',
  },
  {
    title: 'LEGO Harry Potter: Years 1-4',
    expectedSeries: 'LEGO Harry Potter',
    category: 'LEGO Sub-Themes',
  },
  {
    title: 'LEGO Marvel Super Heroes',
    expectedSeries: 'LEGO Marvel',
    category: 'LEGO Sub-Themes',
  },
  {
    title: 'Bionicle Heroes',
    expectedSeries: 'Bionicle',
    category: 'LEGO Sub-Themes',
  },
  {
    title: 'LEGO Racers',
    expectedSeries: 'LEGO Racers',
    category: 'LEGO Sub-Themes',
  },

  // 5. Dedicated Multi-Franchise Crossovers
  {
    title: 'Marvel vs. Capcom 2: New Age of Heroes',
    expectedSeries: 'Marvel vs. Capcom',
    category: 'Crossover Dedicated Series',
  },
  {
    title: 'Mario & Sonic at the Rio 2016 Olympic Games',
    expectedSeries: 'Mario & Sonic at the Olympic Games',
    category: 'Crossover Dedicated Series',
  },
  {
    title: 'Mortal Kombat vs. DC Universe',
    expectedSeries: 'Mortal Kombat vs. DC Universe',
    category: 'Crossover Dedicated Series',
  },
  {
    title: 'Puyo Puyo Tetris 2',
    expectedSeries: 'Puyo Puyo Tetris',
    category: 'Crossover Dedicated Series',
  },

  // 6. Musou Host Universes
  {
    title: 'Hyrule Warriors: Definitive Edition',
    expectedSeries: 'The Legend of Zelda',
    category: 'Musou Host Universe',
  },
  {
    title: 'Dragon Quest Heroes II',
    expectedSeries: 'Dragon Quest',
    category: 'Musou Host Universe',
  },
  {
    title: 'Fire Emblem Warriors: Three Hopes',
    expectedSeries: 'Fire Emblem',
    category: 'Musou Host Universe',
  },
  {
    title: 'Persona 5 Strikers',
    expectedSeries: 'Persona',
    category: 'Musou Host Universe',
  },

  // 7. Yakuza & Like a Dragon
  {
    title: 'Yakuza 0',
    expectedSeries: 'Like a Dragon',
    category: 'Like a Dragon Consolidation',
  },
  {
    title: 'Lost Judgment',
    expectedSeries: 'Like a Dragon',
    category: 'Like a Dragon Consolidation',
  },
  {
    title: 'Castlevania Judgment',
    expectedSeries: 'Castlevania',
    category: 'Subtitle Word Isolation',
  },
  {
    title: 'Gears of War: Judgment',
    expectedSeries: 'Gears of War',
    category: 'Subtitle Word Isolation',
  },

  // 8. Mario Sub-Series & Spin-Offs
  {
    title: 'WarioWare: Smooth Moves',
    expectedSeries: 'WarioWare',
    category: 'Mario Sub-Series',
  },
  {
    title: 'Wario Land 4',
    expectedSeries: 'Wario',
    category: 'Mario Sub-Series',
  },
  {
    title: 'Mario Strikers Charged',
    expectedSeries: 'Mario Strikers',
    category: 'Mario Sub-Series',
  },
  {
    title: 'Mario Super Sluggers',
    expectedSeries: 'Mario Baseball',
    category: 'Mario Sub-Series',
  },
  {
    title: 'Mario vs. Donkey Kong 2: March of the Minis',
    expectedSeries: 'Mario vs. Donkey Kong',
    category: 'Mario Sub-Series',
  },

  // 9. Explicit Redirects, Guest Filtering, & Normalization
  {
    title: 'Crash Nitro Kart',
    expectedSeries: 'Crash Bandicoot',
    category: 'Guest Character Filter',
  },
  {
    title: 'Kid Dracula',
    expectedSeries: 'Castlevania',
    category: 'Explicit Redirect',
  },
  {
    title: 'Llamasoft: The Jeff Minter Story',
    expectedSeries: 'Gold Master Series',
    category: 'Compilation Redirect',
  },
  {
    title: 'Tails and the Music Maker',
    expectedSeries: 'Sonic the Hedgehog',
    category: 'Casing Normalization',
  },
  {
    title: 'Watch Dogs 2',
    expectedSeries: 'Watch Dogs',
    category: 'Casing Normalization',
  },
  {
    title: 'EarthBound',
    expectedSeries: 'EarthBound',
    category: 'Casing Normalization',
  },
];

interface QueryRow {
  title: string;
  canonical_series: string;
}

export async function runD1SmokeTest(isRemote = true) {
  const targetLabel = isRemote ? 'REMOTE Cloudflare D1' : 'LOCAL SQLite/D1';
  console.log(`\n=== Cloudflare D1 Smoke Test (${targetLabel}) ===\n`);

  const titlesIn = SENTINELS.map(
    (s) => `'${s.title.replace(/'/g, "''")}'`,
  ).join(', ');
  const sql = `SELECT title, canonical_series FROM games WHERE title IN (${titlesIn});`;

  const flag = isRemote ? '--remote' : '--local';
  const cmd = `wrangler d1 execute collection-db ${flag} --command="${sql}" --json`;

  console.log(
    `[SmokeTest] Querying ${SENTINELS.length} sentinel titles from ${targetLabel}...`,
  );
  let rows: QueryRow[] = [];

  try {
    const rawOutput = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(rawOutput);
    if (Array.isArray(parsed) && parsed[0]?.results) {
      rows = parsed[0].results as QueryRow[];
    } else if (parsed.results) {
      rows = parsed.results as QueryRow[];
    }
  } catch (err) {
    console.error(`❌ [SmokeTest] Failed to query database via wrangler:`, err);
    process.exit(1);
  }

  const resultsByTitle = new Map<string, string>();
  for (const r of rows) {
    resultsByTitle.set(r.title, r.canonical_series);
  }

  let passedCount = 0;
  let failedCount = 0;

  console.log(
    `%-40s | %-25s | %-25s | %s`,
    'Game Title',
    'Expected Series',
    'Actual Series',
    'Status',
  );
  console.log('-'.repeat(105));

  for (const s of SENTINELS) {
    const actual = resultsByTitle.get(s.title);
    if (actual === s.expectedSeries) {
      passedCount++;
      console.log(
        `\x1b[32mPASS\x1b[0m %-40s | %-25s | %-25s | [%s]`,
        s.title,
        s.expectedSeries,
        actual,
        s.category,
      );
    } else {
      failedCount++;
      console.log(
        `\x1b[31mFAIL\x1b[0m %-40s | %-25s | %-25s | [%s]`,
        s.title,
        s.expectedSeries,
        actual ?? 'NOT_FOUND',
        s.category,
      );
    }
  }

  console.log('-'.repeat(105));
  console.log(
    `\nResults: ${passedCount}/${SENTINELS.length} passed (${failedCount} failed).`,
  );

  if (failedCount > 0) {
    console.error(`\n❌ Smoke test failed on ${failedCount} sentinel records.`);
    process.exit(1);
  } else {
    console.log(
      `\n✅ All ${passedCount} sentinel canonical series passed verification!`,
    );
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const isRemote = !process.argv.includes('--local');
  runD1SmokeTest(isRemote).catch((err) => {
    console.error('Fatal error in smoke test:', err);
    process.exit(1);
  });
}
