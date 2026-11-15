import { Pipe, PipeTransform } from '@angular/core';
import {
  KitCommandPaletteToken,
  tokenizeKitCommandQuery,
} from '@wesdizzle/app-kit/angular';

export type HighlightToken = KitCommandPaletteToken;

export function splitHighlightTokens(
  text: string,
  query: string,
): HighlightToken[] {
  return tokenizeKitCommandQuery(text, query);
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
