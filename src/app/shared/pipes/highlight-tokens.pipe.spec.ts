import { describe, it, expect } from 'vitest';
import {
  HighlightTokensPipe,
  splitHighlightTokens,
} from './highlight-tokens.pipe';

describe('HighlightTokensPipe and splitHighlightTokens', () => {
  const pipe = new HighlightTokensPipe();

  it('should return empty array when text is null or empty', () => {
    expect(pipe.transform('', 'test')).toEqual([]);
    expect(pipe.transform(null, 'test')).toEqual([]);
    expect(pipe.transform(undefined, 'test')).toEqual([]);
  });

  it('should return single non-matching token when query is empty or whitespace', () => {
    const res = pipe.transform('Super Mario 64', '');
    expect(res).toEqual([{ text: 'Super Mario 64', match: false }]);

    const resSpaces = pipe.transform('Super Mario 64', '   ');
    expect(resSpaces).toEqual([{ text: 'Super Mario 64', match: false }]);
  });

  it('should return single non-matching token when no terms match', () => {
    const res = pipe.transform('Super Mario 64', 'zelda');
    expect(res).toEqual([{ text: 'Super Mario 64', match: false }]);
  });

  it('should highlight a single matching substring preserving original casing', () => {
    const res = pipe.transform('Super Mario 64', 'mario');
    expect(res).toEqual([
      { text: 'Super ', match: false },
      { text: 'Mario', match: true },
      { text: ' 64', match: false },
    ]);
  });

  it('should highlight multiple distinct tokens', () => {
    const res = pipe.transform('Super Mario 64', 'super 64');
    expect(res).toEqual([
      { text: 'Super', match: true },
      { text: ' Mario ', match: false },
      { text: '64', match: true },
    ]);
  });

  it('should merge overlapping or contiguous matching tokens', () => {
    const res = splitHighlightTokens('Super Mario 64', 'mar mario');
    expect(res).toEqual([
      { text: 'Super ', match: false },
      { text: 'Mario', match: true },
      { text: ' 64', match: false },
    ]);
  });

  it('should handle match at the very beginning and very end', () => {
    const res = splitHighlightTokens('Zelda', 'zel da');
    expect(res).toEqual([{ text: 'Zelda', match: true }]);
  });
});
