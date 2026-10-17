import { Pipe, PipeTransform } from '@angular/core';

export interface HighlightToken {
  text: string;
  match: boolean;
}

export function splitHighlightTokens(
  text: string,
  query: string,
): HighlightToken[] {
  if (!text) return [];
  const rawQuery = (query || '').trim().toLowerCase();
  if (!rawQuery) {
    return [{ text, match: false }];
  }

  const terms = rawQuery.split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [{ text, match: false }];
  }

  const lower = text.toLowerCase();
  const intervals: Array<[number, number]> = [];

  for (const term of terms) {
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(term, pos);
      if (idx === -1) break;
      intervals.push([idx, idx + term.length]);
      pos = idx + Math.max(1, term.length);
    }
  }

  if (intervals.length === 0) {
    return [{ text, match: false }];
  }

  intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);

  const merged: Array<[number, number]> = [];
  let cur = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    if (next[0] <= cur[1]) {
      cur[1] = Math.max(cur[1], next[1]);
    } else {
      merged.push(cur);
      cur = next;
    }
  }
  merged.push(cur);

  const tokens: HighlightToken[] = [];
  let lastIndex = 0;
  for (const [start, end] of merged) {
    if (start > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, start), match: false });
    }
    tokens.push({ text: text.slice(start, end), match: true });
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), match: false });
  }

  return tokens;
}

@Pipe({
  name: 'highlightTokens',
  standalone: true,
  pure: true,
})
export class HighlightTokensPipe implements PipeTransform {
  transform(text: string | null | undefined, query: string): HighlightToken[] {
    if (!text) return [];
    return splitHighlightTokens(text, query);
  }
}
