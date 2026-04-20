import { describe, it, expect } from 'vitest';
import { parseDiscoveryReport } from './discovery.js';

describe('Discovery Report Parser', () => {
    it('should parse a simple report section', () => {
        const report = `
### Space Invaders (Atari 2600)
- [ ] **Link to:** Space Invaders (Atari 2600) - ID: 1234
  - ![cover](http://example.com/cover.jpg)
  - *A classic game.*
`;
        const results = parseDiscoveryReport(report);
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('Space Invaders');
        expect(results[0].platform).toBe('Atari 2600');
        expect(results[0].options).toHaveLength(1);
        expect(results[0].options[0].id).toBe('1234');
        expect(results[0].options[0].image_url).toBe('http://example.com/cover.jpg');
        expect(results[0].options[0].summary).toBe('A classic game.');
    });

    it('should handle multiple options', () => {
        const report = `
### Game A (Console X)
- [ ] **Update to:** Game A1 (Console X) - ID: 1
- [ ] **Link to:** Game A2 (Console X) - ID: 2
`;
        const results = parseDiscoveryReport(report);
        expect(results[0].options).toHaveLength(2);
        expect(results[0].options[0].name).toBe('Game A1');
        expect(results[0].options[1].name).toBe('Game A2');
    });

    it('should handle multiple game sections', () => {
        const report = `
### Game A (Platform 1)
- [ ] **Link to:** Game A (Platform 1) - ID: 1

### Game B (Platform 2)
- [ ] **Link to:** Game B (Platform 2) - ID: 2
`;
        const results = parseDiscoveryReport(report);
        expect(results).toHaveLength(2);
        expect(results[0].title).toBe('Game A');
        expect(results[1].title).toBe('Game B');
    });

    it('should return empty array for empty content', () => {
        expect(parseDiscoveryReport('')).toEqual([]);
    });
});
