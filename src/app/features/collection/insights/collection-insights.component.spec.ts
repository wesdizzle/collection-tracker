import '../../../../test-setup';
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { CollectionInsightsComponent } from './collection-insights.component';
import { CollectionService } from '../../../core/services/collection.service';
import { Game, Toy, Platform } from '../../../core/models/collection.models';

describe('CollectionInsightsComponent', () => {
  let component: CollectionInsightsComponent;
  let fixture: ComponentFixture<CollectionInsightsComponent>;

  const mockGames = signal<Game[]>([]);
  const mockToys = signal<Toy[]>([]);
  const mockPlatforms = signal<Platform[]>([]);

  const mockCollectionService = {
    games: mockGames.asReadonly(),
    toys: mockToys.asReadonly(),
    platforms: mockPlatforms.asReadonly(),
    refreshAll: async () => {},
  };

  beforeEach(async () => {
    mockGames.set([]);
    mockToys.set([]);
    mockPlatforms.set([]);

    await TestBed.configureTestingModule({
      imports: [CollectionInsightsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionInsightsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should handle empty collection with zero fallbacks', () => {
    fixture.detectChanges();

    expect(component.totalCollectionValue()).toBe(0);
    expect(component.ownedGames().length).toBe(0);
    expect(component.ownedToys().length).toBe(0);
    expect(component.backupRatePct()).toBe(0);
    expect(component.cibPct()).toBe(0);
    expect(component.platformStats().length).toBe(0);
    expect(component.topSeries().length).toBe(0);
  });

  it('should correctly calculate financial valuation and condition breakdowns', () => {
    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'super-mario-world-snes',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 1, // Played
        backup_status: 1,
        has_case: 1,
        has_manual: 1,
        price_cib: 5000, // $50.00
        price_loose: 2000,
        price_new: 15000,
      },
      {
        stable_id: 2,
        id: 'chrono-trigger-snes',
        title: 'Chrono Trigger',
        series: 'Chrono',
        canonical_series: 'Chrono',
        release_date: '1995-03-11',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1,
        play_status: 2, // Playing
        backup_status: 0,
        has_case: 1,
        has_manual: 0, // Boxed only
        price_cib: 60000,
        price_loose: 25000, // Loose used
        price_new: 120000,
      },
      {
        stable_id: 3,
        id: 'halo-ce-xbox',
        title: 'Halo: Combat Evolved',
        series: 'Halo',
        canonical_series: 'Halo',
        release_date: '2001-11-15',
        platform: 'Xbox',
        platform_id: 2,
        ownership_status: 1,
        play_status: 3, // Queued
        backup_status: 1,
        has_case: 0,
        has_manual: 0, // Loose
        price_cib: 1500,
        price_loose: 800,
        price_new: 5000,
      },
    ];

    const testToys: Toy[] = [
      {
        stable_id: 101,
        id: 'mario-amiibo',
        name: 'Mario',
        line: 'Super Smash Bros.',
        type: 'Figure',
        series_name: 'Smash',
        series_line: 'Smash',
        release_date: '2014-11-21',
        ownership_status: 1,
        image_url: '',
        price_loose: 1500, // $15.00
      },
    ];

    mockGames.set(testGames);
    mockToys.set(testToys);
    fixture.detectChanges();

    // SMW is CIB -> 5000 cents ($50.00)
    // Chrono Trigger is boxed only -> 25000 cents ($250.00)
    // Halo is loose -> 800 cents ($8.00)
    // Total games value: 5000 + 25000 + 800 = 30800 cents ($308.00)
    expect(component.totalGamesValue()).toBe(30800);
    expect(component.totalToysValue()).toBe(1500);
    expect(component.totalCollectionValue()).toBe(32300);

    // Condition counts
    expect(component.cibCount()).toBe(1);
    expect(component.boxedOnlyCount()).toBe(1);
    expect(component.looseCount()).toBe(1);
    expect(component.cibPct()).toBe(33); // 1/3 ~ 33%

    // Most valuable games: Chrono Trigger ($250.00) should be #1
    const topGames = component.topValuableGames();
    expect(topGames.length).toBe(3);
    expect(topGames[0].title).toBe('Chrono Trigger');
    expect(topGames[1].title).toBe('Super Mario World');
  });

  it('should correctly calculate preservation backup rate and missing backups', () => {
    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'g1',
        title: 'Game 1',
        series: 'S1',
        canonical_series: 'S1',
        release_date: '2000-01-01',
        platform: 'PS2',
        platform_id: 1,
        ownership_status: 1,
        play_status: 0,
        backup_status: 1, // backed up
      },
      {
        stable_id: 2,
        id: 'g2',
        title: 'Game 2',
        series: 'S1',
        canonical_series: 'S1',
        release_date: '2001-01-01',
        platform: 'PS2',
        platform_id: 1,
        ownership_status: 1,
        play_status: 0,
        backup_status: 0, // missing
      },
    ];

    mockGames.set(testGames);
    fixture.detectChanges();

    expect(component.physicalOwnedGames().length).toBe(2);
    expect(component.backedUpOwnedGames().length).toBe(1);
    expect(component.backupRatePct()).toBe(50);
    expect(component.missingBackupsCount()).toBe(1);
  });

  it('should calculate platform completion percentage and catalog counts', () => {
    const testPlatforms: Platform[] = [
      {
        id: 1,
        name: 'SNES',
        display_name: 'Super Nintendo',
        brand: 'Nintendo',
        launch_date: '1990-11-21',
        image_url: '',
      },
    ];

    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'smw',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 1, // owned
        play_status: 0,
        backup_status: 1,
        price_loose: 2000,
      },
      {
        stable_id: 2,
        id: 'fzero',
        title: 'F-Zero',
        series: 'F-Zero',
        canonical_series: 'F-Zero',
        release_date: '1990-11-21',
        platform: 'SNES',
        platform_id: 1,
        ownership_status: 0, // unowned catalog release
        play_status: 0,
        backup_status: 0,
      },
    ];

    mockPlatforms.set(testPlatforms);
    mockGames.set(testGames);
    fixture.detectChanges();

    const stats = component.platformStats();
    expect(stats.length).toBe(1);
    expect(stats[0].name).toBe('Super Nintendo');
    expect(stats[0].ownedCount).toBe(1);
    expect(stats[0].catalogCount).toBe(2);
    expect(stats[0].completionPct).toBe(50);
    expect(stats[0].backupPct).toBe(100);
  });

  it('should calculate decadeDistribution across historical eras', () => {
    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'g-nes',
        title: 'Super Mario Bros.',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'NES',
        platform_id: 1,
        play_status: 1,
        release_date: '1985-09-13',
        ownership_status: 1,
        backup_status: 1,
        price_loose: 1500,
      },
      {
        stable_id: 2,
        id: 'g-snes',
        title: 'Super Mario World',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'SNES',
        platform_id: 2,
        play_status: 1,
        release_date: '1990-11-21',
        ownership_status: 1,
        backup_status: 1,
        price_loose: 2000,
      },
      {
        stable_id: 3,
        id: 'g-gc',
        title: 'Super Mario Sunshine',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'GameCube',
        platform_id: 3,
        play_status: 1,
        release_date: '2002-08-26',
        ownership_status: 1,
        backup_status: 1,
        price_loose: 4000,
      },
      {
        stable_id: 4,
        id: 'g-wiiu',
        title: 'Super Mario 3D World',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'Wii U',
        platform_id: 4,
        play_status: 1,
        release_date: '2013-11-22',
        ownership_status: 1,
        backup_status: 1,
        price_loose: 1500,
      },
      {
        stable_id: 5,
        id: 'g-switch',
        title: 'Super Mario Bros. Wonder',
        series: 'Mario',
        canonical_series: 'Mario',
        platform: 'Nintendo Switch',
        platform_id: 5,
        play_status: 1,
        release_date: '2023-10-20',
        ownership_status: 1,
        backup_status: 1,
        price_loose: 4500,
      },
    ];

    mockGames.set(testGames);
    fixture.detectChanges();

    const decades = component.decadeDistribution();
    expect(decades.length).toBe(5);

    const era70s80s = decades.find((d) => d.decade === '70s_80s');
    const era90s = decades.find((d) => d.decade === '90s');
    const era00s = decades.find((d) => d.decade === '00s');
    const era10s = decades.find((d) => d.decade === '10s');
    const era20s = decades.find((d) => d.decade === '20s');

    expect(era70s80s?.count).toBe(1);
    expect(era90s?.count).toBe(1);
    expect(era00s?.count).toBe(1);
    expect(era10s?.count).toBe(1);
    expect(era20s?.count).toBe(1);

    expect(era70s80s?.pct).toBe(20);
    expect(era20s?.pct).toBe(20);
  });

  it('should identify playing and queued games and render interactive drill-down links', () => {
    const testGames: Game[] = [
      {
        stable_id: 1,
        id: 'playing-1',
        title: 'Currently Playing Game',
        series: 'Series 1',
        canonical_series: 'Series 1',
        platform: 'Switch',
        platform_id: 1,
        ownership_status: 1,
        play_status: 2, // Playing
        backup_status: 1,
        release_date: '2023-01-01',
      },
      {
        stable_id: 2,
        id: 'queued-1',
        title: 'Up Next Game',
        series: 'Series 1',
        canonical_series: 'Series 1',
        platform: 'Switch',
        platform_id: 1,
        ownership_status: 1,
        play_status: 3, // Queued
        backup_status: 0,
        release_date: '2023-01-01',
      },
    ];

    mockGames.set(testGames);
    fixture.detectChanges();

    expect(component.playingGames().length).toBe(1);
    expect(component.playingGames()[0].title).toBe('Currently Playing Game');

    expect(component.queuedGames().length).toBe(1);
    expect(component.queuedGames()[0].title).toBe('Up Next Game');

    const backupLinks = fixture.nativeElement.querySelectorAll(
      '.backup-stat-item.clickable',
    );
    expect(backupLinks.length).toBe(3);

    const playChips = fixture.nativeElement.querySelectorAll(
      '.play-status-chip.clickable',
    );
    expect(playChips.length).toBe(4);
  });
});
