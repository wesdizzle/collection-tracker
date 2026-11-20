import '../test-setup';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  GAME_CARD_MEDIA_RADIUS,
  GAME_DETAIL_MEDIA_RADIUS,
  resolveCollectionMediaRadius,
} from './app.config';

describe('appConfig View Transition media radius resolution', () => {
  it('morphs from card top corners to detail radius when navigating from games list to game detail', () => {
    expect(
      resolveCollectionMediaRadius(
        { routeConfig: { path: 'games' }, params: {} },
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '1' },
        },
      ),
    ).toEqual({
      from: GAME_CARD_MEDIA_RADIUS,
      to: GAME_DETAIL_MEDIA_RADIUS,
    });

    // Public profile /u/:username/games uses the same leaf path
    expect(
      resolveCollectionMediaRadius(
        { routeConfig: { path: 'games' }, params: { username: 'alice' } },
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '2' },
        },
      ),
    ).toEqual({
      from: GAME_CARD_MEDIA_RADIUS,
      to: GAME_DETAIL_MEDIA_RADIUS,
    });
  });

  it('morphs from detail radius back to card top corners when returning to games list', () => {
    expect(
      resolveCollectionMediaRadius(
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '1' },
        },
        { routeConfig: { path: 'games' }, params: {} },
      ),
    ).toEqual({
      from: GAME_DETAIL_MEDIA_RADIUS,
      to: GAME_CARD_MEDIA_RADIUS,
    });
  });

  it('returns null for toy routes, game-to-game navigation, and non-list sources', () => {
    expect(
      resolveCollectionMediaRadius(
        { routeConfig: { path: 'toys' }, params: {} },
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'toy', id: '1' },
        },
      ),
    ).toBeNull();
    expect(
      resolveCollectionMediaRadius(
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'toy', id: '1' },
        },
        { routeConfig: { path: 'toys' }, params: {} },
      ),
    ).toBeNull();
    expect(
      resolveCollectionMediaRadius(
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '1' },
        },
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '2' },
        },
      ),
    ).toBeNull();
    expect(
      resolveCollectionMediaRadius(
        { routeConfig: { path: 'insights' }, params: {} },
        {
          routeConfig: { path: ':type/:id' },
          params: { type: 'game', id: '1' },
        },
      ),
    ).toBeNull();
  });

  it('applies direct border-radius and kit-vt-media class to game cover images while keeping toy frames padded/unclipped', () => {
    const appDir = dirname(fileURLToPath(import.meta.url));
    const itemDetailCss = readFileSync(
      join(
        appDir,
        'features/collection/detail/item-detail/item-detail.component.css',
      ),
      'utf8',
    );
    expect(itemDetailCss).toMatch(
      /\.art-frame:not\(\.toy-frame\)\s+img\s*\{[^}]*border-radius:\s*inherit;[^}]*view-transition-class:\s*kit-vt-media;/s,
    );

    const gameCardCss = readFileSync(
      join(
        appDir,
        'features/collection/list/game-card/game-card.component.css',
      ),
      'utf8',
    );
    expect(gameCardCss).toMatch(
      /\.card-art\s*\{[^}]*border-radius:\s*calc\(var\(--radius-card,\s*16px\)\s*-\s*1px\)[^}]*view-transition-class:\s*kit-vt-media;/s,
    );
  });
});
