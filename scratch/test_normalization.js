const normalizationRules = [
    { regex: /^(disney's|marvel's|sid meier's|lego)\b/gi, replacement: '' },
    { regex: /\b(version|the videogame|the video game|special edition|game of the year edition|goty edition)\b/gi, replacement: '' },
    { regex: /\btalltale series\b/gi, replacement: '' },
    { regex: /:/g, replacement: ' ' },
    { regex: /&/g, replacement: 'and' },
    { regex: /[\r\n\t]/g, replacement: ' ' },
    { regex: /[^a-z0-9 ]/gi, replacement: '' },
    { regex: /\s+/g, replacement: ' ' }
];

function superNormalize(title) {
    if (!title) return '';
    let t = title.toLowerCase();
    for (const rule of normalizationRules) {
        t = t.replace(rule.regex, rule.replacement);
    }
    return t.trim().replace(/ /g, '');
}

const testCases = [
    ['Pokémon Yellow: Special Pikachu Edition', 'Pokémon Yellow Version: Special Pikachu Edition'],
    ['DuckTales', 'Disney\'s DuckTales'],
    ['Super Contra', 'Super C'], // This is a tough one
    ['Assassin\'s Creed: Altaïr\'s Chronicles', 'Assassin\'s Creed: Altair\'s Chronicles'],
    ['Civ Revolution', 'Sid Meier\'s Civilization Revolution'], // Tough
    ['Plants vs. Zombies', 'Plants vs. Zombies DS'],
    ['Perfect Dark', 'Perfect Dark With Mario Characters'], // Should NOT match
    ['Batman (NES)', 'Batman: The Video Game']
];

console.log('--- Normalization Test ---');
testCases.forEach(([local, igdb]) => {
    const sl = superNormalize(local);
    const si = superNormalize(igdb);
    const match = sl === si || si.includes(sl) || sl.includes(si);
    console.log(`Local: "${local}" -> ${sl}`);
    console.log(`IGDB:  "${igdb}" -> ${si}`);
    console.log(`Match? ${match ? 'YES' : 'NO'}`);
    console.log('---');
});
