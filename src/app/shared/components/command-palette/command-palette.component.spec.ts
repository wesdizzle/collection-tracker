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
