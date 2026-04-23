import { describe, it, expect } from 'vitest';
import { normalizeStr, superNormalize } from './igdb.js';

describe('IGDB Normalization Utilities', () => {
    describe('normalizeStr', () => {
        it('should lowercase strings', () => {
            expect(normalizeStr('HALO')).toBe('halo');
        });

        it('should handle special dashes', () => {
            expect(normalizeStr('Game–Title')).toBe('game-title');
            expect(normalizeStr('Game—Title')).toBe('game-title');
        });

        it('should convert ampersands', () => {
            expect(normalizeStr('Mario & Luigi')).toBe('mario and luigi');
        });

        it('should strip non-alphanumeric except specific chars', () => {
            expect(normalizeStr('Game! @Title#')).toBe('game title');
        });
    });

    describe('superNormalize', () => {
        it('should strip common prefixes', () => {
            expect(superNormalize("Disney's Aladdin")).toBe('aladdin');
            expect(superNormalize("Marvel's Spider-Man")).toBe('spiderman');
            expect(superNormalize("Lego Star Wars")).toBe('starwars');
        });

        it('should strip subtitle fluff', () => {
            expect(superNormalize("The Legend of Zelda: The Videogame")).toBe('legendzelda');
            expect(superNormalize("Game: Special Edition")).toBe('game');
        });

        it('should convert & to and (and then strip "and")', () => {
            expect(superNormalize("Ratchet & Clank")).toBe('ratchetclank');
        });

        it('should remove all non-alphanumeric', () => {
            expect(superNormalize("Super Mario Bros. 3!")).toBe('supermariobros3');
        });

        it('should handle null/empty', () => {
            expect(superNormalize('')).toBe('');
        });
    });
});
