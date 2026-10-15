import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { CommandPaletteComponent } from './command-palette.component';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { CollectionService } from '../../../core/services/collection.service';
import {
  Game,
  Platform,
  Toy,
  OwnershipStatus,
  PlayStatus,
} from '../../../core/models/collection.models';

describe('CommandPaletteComponent', () => {
  let component: CommandPaletteComponent;
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let paletteService: CommandPaletteService;
  let router: { navigate: ReturnType<typeof vi.fn> };

  const mockGames: Game[] = [
    {
      stable_id: 1,
      id: 'super-mario-64-n64',
      title: 'Super Mario 64',
      series: 'Super Mario',
      canonical_series: 'Super Mario',
      release_date: '1996-06-23',
      platform: 'Nintendo 64',
      platform_id: 1,
      region: 'USA',
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Played,
      backup_status: true,
    },
    {
      stable_id: 2,
      id: 'zelda-oot-n64',
      title: 'The Legend of Zelda: Ocarina of Time',
      series: 'The Legend of Zelda',
      canonical_series: 'The Legend of Zelda',
      release_date: '1998-11-21',
      platform: 'Nintendo 64',
      platform_id: 1,
      region: 'EUR',
      ownership_status: OwnershipStatus.Seeking,
      play_status: PlayStatus.Unplayed,
      backup_status: false,
    },
  ];

  const mockToys: Toy[] = [
    {
      stable_id: 101,
      id: 'mario-amiibo',
      name: 'Mario (Super Smash Bros.)',
      line: 'Amiibo',
      type: 'figure',
      series_name: 'Super Smash Bros.',
      series_line: 'Amiibo',
      release_date: '2014-11-21',
      ownership_status: OwnershipStatus.Owned,
      image_url: 'https://example.com/mario.png',
    },
  ];

  const mockPlatforms: Platform[] = [
    {
      id: 1,
      name: 'Nintendo 64',
      display_name: 'N64',
      brand: 'Nintendo',
      launch_date: '1996-06-23',
      image_url: '',
    },
  ];

  const mockGamesSignal = signal<Game[]>(mockGames);
  const mockToysSignal = signal<Toy[]>(mockToys);
  const mockPlatformsSignal = signal<Platform[]>(mockPlatforms);

  const mockCollectionService = {
    games: mockGamesSignal.asReadonly(),
    toys: mockToysSignal.asReadonly(),
    platforms: mockPlatformsSignal.asReadonly(),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    resetListState: vi.fn(),
  };

  beforeEach(async () => {
    router = {
      navigate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        CommandPaletteService,
        { provide: CollectionService, useValue: mockCollectionService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommandPaletteComponent);
    component = fixture.componentInstance;
    paletteService = TestBed.inject(CommandPaletteService);
    fixture.detectChanges();
  });

  it('should create and initially be closed', () => {
    expect(component).toBeTruthy();
    expect(paletteService.isOpen()).toBe(false);
    const overlay = fixture.nativeElement.querySelector('.palette-overlay');
    expect(overlay).toBeNull();
  });

  it('should display overlay when paletteService is open', () => {
    paletteService.open();
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.palette-overlay');
    expect(overlay).not.toBeNull();
  });

  it('should list default actions and top platforms when query is empty', () => {
    paletteService.open();
    fixture.detectChanges();

    const results = component.flatResults();
    expect(results.length).toBeGreaterThan(0);

    const categories = component.groupedResults().map((g) => g.category);
    expect(categories).toContain('Navigation');
    expect(categories).toContain('Quick Filters');
    expect(categories).toContain('Platforms');

    // Reset filters action exists
    const resetAction = results.find((r) => r.id === 'filter-reset');
    expect(resetAction).toBeTruthy();
    expect(resetAction?.title).toBe('Reset All Filters');
  });

  it('should reset list state and navigate with reset param when Reset All Filters is selected', () => {
    paletteService.open();
    fixture.detectChanges();

    const resetAction = component
      .flatResults()
      .find((r) => r.id === 'filter-reset');
    expect(resetAction).toBeTruthy();

    resetAction?.action();

    expect(mockCollectionService.resetListState).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/collection/games'], {
      queryParams: { reset: '1' },
    });
    expect(paletteService.isOpen()).toBe(false);
  });

  it('should sort platform suggestions by owned games count', () => {
    mockPlatformsSignal.set([
      {
        id: 10,
        name: 'Empty Console',
        display_name: 'Empty Console',
        brand: 'BrandX',
        launch_date: '2000-01-01',
        image_url: '',
      },
      {
        id: 1,
        name: 'Nintendo 64',
        display_name: 'N64',
        brand: 'Nintendo',
        launch_date: '1996-06-23',
        image_url: '',
      },
    ]);
    paletteService.open();
    fixture.detectChanges();

    const platformItems = component
      .flatResults()
      .filter((r) => r.category === 'Platforms');
    expect(platformItems.length).toBe(2);
    // Nintendo 64 has 1 owned game in mockGames, Empty Console has 0
    expect(platformItems[0].title).toBe('N64');
    expect(platformItems[0].subtitle).toContain('1 owned');
    expect(platformItems[1].title).toBe('Empty Console');
  });

  it('should filter games and toys when a search query is entered', () => {
    paletteService.open();
    fixture.detectChanges();
    component.query.set('zelda');
    fixture.detectChanges();

    const results = component.flatResults();
    expect(results.some((r) => r.title.includes('Ocarina of Time'))).toBe(true);
    expect(results.some((r) => r.title === 'Super Mario 64')).toBe(false);
  });

  it('should render modal header with title and shortcut badge', () => {
    paletteService.open();
    fixture.detectChanges();

    const titleEl = fixture.nativeElement.querySelector('.palette-title');
    expect(titleEl?.textContent?.trim()).toBe('Command Palette');

    const badgeEl = fixture.nativeElement.querySelector(
      '.palette-shortcut-badge',
    );
    expect(badgeEl?.textContent?.trim()).toBe('Ctrl + K');
  });

  it('should render region badge for games in the results list', () => {
    paletteService.open();
    fixture.detectChanges();
    component.query.set('mario');
    fixture.detectChanges();

    const regionBadge = fixture.nativeElement.querySelector(
      '.palette-region-badge',
    );
    expect(regionBadge).not.toBeNull();
    expect(regionBadge?.textContent?.trim()).toBe('USA');
  });

  it('should match platforms and games using short platform aliases', () => {
    paletteService.open();
    fixture.detectChanges();
    // 'n64' is an alias for 'Nintendo 64'
    component.query.set('n64');
    fixture.detectChanges();

    const results = component.flatResults();
    // Platform should match via alias
    const platformMatch = results.find(
      (r) => r.category === 'Platforms' && r.title === 'N64',
    );
    expect(platformMatch).toBeTruthy();

    // Games on N64 should match via alias
    const gameMatch = results.find(
      (r) => r.category === 'Games' && r.title === 'Super Mario 64',
    );
    expect(gameMatch).toBeTruthy();
  });

  it('should navigate and close when an item is selected', () => {
    paletteService.open();
    fixture.detectChanges();

    const firstItem = component.flatResults()[0];
    component.onSelect(firstItem);

    expect(paletteService.isOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalled();
  });

  it('should handle keyboard navigation (ArrowDown, ArrowUp, Enter)', () => {
    paletteService.open();
    fixture.detectChanges();

    expect(component.selectedIndex()).toBe(0);

    component.moveSelection(1);
    expect(component.selectedIndex()).toBe(1);

    component.moveSelection(-1);
    expect(component.selectedIndex()).toBe(0);

    component.executeSelected();

    expect(paletteService.isOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalled();
  });

  it('should respond to global keydown shortcuts', () => {
    // Ctrl+K toggles open
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
    );
    fixture.detectChanges();
    expect(paletteService.isOpen()).toBe(true);

    // Escape closes
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(paletteService.isOpen()).toBe(false);
  });
});
