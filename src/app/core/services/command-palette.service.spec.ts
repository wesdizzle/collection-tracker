import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandPaletteService } from './command-palette.service';

describe('CommandPaletteService', () => {
  let service: CommandPaletteService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CommandPaletteService],
    });
    service = TestBed.inject(CommandPaletteService);
  });

  it('should initialize with isOpen = false', () => {
    expect(service.isOpen()).toBe(false);
  });

  it('should open the palette', () => {
    service.open();
    expect(service.isOpen()).toBe(true);
  });

  it('should close the palette', () => {
    service.open();
    service.close();
    expect(service.isOpen()).toBe(false);
  });

  it('should toggle the palette state', () => {
    expect(service.isOpen()).toBe(false);
    service.toggle();
    expect(service.isOpen()).toBe(true);
    service.toggle();
    expect(service.isOpen()).toBe(false);
  });

  describe('Recent items tracking', () => {
    beforeEach(() => {
      localStorage.clear();
      service.clearRecentItems();
    });

    it('should add a recent item and persist to localStorage', () => {
      service.addRecentItem({
        id: 'game-1',
        title: 'Super Mario 64',
        category: 'Games',
        icon: 'gamepad',
        url: '/collection/game/1',
      });

      const recents = service.recentItems();
      expect(recents.length).toBe(1);
      expect(recents[0].title).toBe('Super Mario 64');
      expect(recents[0].id).toBe('game-1');

      const stored = JSON.parse(
        localStorage.getItem('collection_tracker_palette_recents') || '[]',
      );
      expect(stored.length).toBe(1);
      expect(stored[0].title).toBe('Super Mario 64');
    });

    it('should deduplicate and bring most recently selected item to the top', () => {
      service.addRecentItem({
        id: 'game-1',
        title: 'Super Mario 64',
        category: 'Games',
        icon: 'gamepad',
      });
      service.addRecentItem({
        id: 'game-2',
        title: 'Zelda Ocarina of Time',
        category: 'Games',
        icon: 'gamepad',
      });
      // Re-add game-1
      service.addRecentItem({
        id: 'game-1',
        title: 'Super Mario 64',
        category: 'Games',
        icon: 'gamepad',
      });

      const recents = service.recentItems();
      expect(recents.length).toBe(2);
      expect(recents[0].id).toBe('game-1');
      expect(recents[1].id).toBe('game-2');
    });

    it('should limit recents to MAX_RECENT_ITEMS (6)', () => {
      for (let i = 1; i <= 8; i++) {
        service.addRecentItem({
          id: `item-${i}`,
          title: `Item ${i}`,
          category: 'Games',
          icon: 'gamepad',
        });
      }

      const recents = service.recentItems();
      expect(recents.length).toBe(6);
      expect(recents[0].id).toBe('item-8');
      expect(recents[5].id).toBe('item-3');
    });

    it('should remove a specific recent item by id', () => {
      service.addRecentItem({
        id: 'nav-games',
        title: 'Games Catalog',
        category: 'Navigation',
        icon: 'gamepad',
      });
      service.addRecentItem({
        id: 'nav-toys',
        title: 'Toys Catalog',
        category: 'Navigation',
        icon: 'figure-toy',
      });

      service.removeRecentItem('nav-games');
      const recents = service.recentItems();
      expect(recents.length).toBe(1);
      expect(recents[0].id).toBe('nav-toys');
    });

    it('should clear all recent items', () => {
      service.addRecentItem({
        id: 'game-1',
        title: 'Super Mario 64',
        category: 'Games',
        icon: 'gamepad',
      });
      service.clearRecentItems();
      expect(service.recentItems().length).toBe(0);
      expect(
        localStorage.getItem('collection_tracker_palette_recents'),
      ).toBeNull();
    });
  });
});
