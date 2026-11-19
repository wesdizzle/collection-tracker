import '../../../../../test-setup';
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivePlayShelfComponent } from './active-play-shelf.component';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
} from '../../../../core/models/collection.models';

describe('ActivePlayShelfComponent', () => {
  let fixture: ComponentFixture<ActivePlayShelfComponent>;
  let component: ActivePlayShelfComponent;

  const playingGames: Game[] = [
    {
      stable_id: 1,
      id: 'chrono-trigger-snes',
      title: 'Chrono Trigger',
      series: 'Chrono',
      canonical_series: 'Chrono',
      platform: 'SNES',
      platform_id: 1,
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Playing,
      backup_status: 1,
    },
  ];

  const queuedGames: Game[] = [
    {
      stable_id: 2,
      id: 'earthbound-snes',
      title: 'EarthBound',
      series: 'Mother',
      canonical_series: 'Mother',
      platform: 'SNES',
      platform_id: 1,
      ownership_status: OwnershipStatus.Owned,
      play_status: PlayStatus.Queued,
      backup_status: 1,
    },
  ];

  beforeEach(async () => {
    localStorage.removeItem('collection_active_play_shelf_collapsed');

    await TestBed.configureTestingModule({
      imports: [ActivePlayShelfComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ActivePlayShelfComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('playingGames', playingGames);
    fixture.componentRef.setInput('queuedGames', queuedGames);
    fixture.detectChanges();
  });

  it('renders Playing and Queued cards, emits advanceStatus/filterByStatus, and persists collapsed toggle', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="active-play-shelf-body"]'),
    ).toBeTruthy();
    expect(el.querySelectorAll('[data-testid="active-play-card"]').length).toBe(
      1,
    );
    expect(el.querySelectorAll('[data-testid="queued-play-card"]').length).toBe(
      1,
    );

    let advanced: { game: Game; nextStatus: PlayStatus } | undefined;
    component.advanceStatus.subscribe((val) => {
      advanced = val;
    });

    (
      el.querySelector(
        '[data-testid="advance-played-btn"]',
      ) as HTMLButtonElement
    ).click();
    expect(advanced).toEqual({
      game: playingGames[0],
      nextStatus: PlayStatus.Played,
    });

    (
      el.querySelector(
        '[data-testid="advance-playing-btn"]',
      ) as HTMLButtonElement
    ).click();
    expect(advanced).toEqual({
      game: queuedGames[0],
      nextStatus: PlayStatus.Playing,
    });

    let filteredStatus: PlayStatus | undefined;
    component.filterByStatus.subscribe((st) => {
      filteredStatus = st;
    });
    (
      el.querySelector(
        '[data-testid="shelf-filter-queued-btn"]',
      ) as HTMLButtonElement
    ).click();
    expect(filteredStatus).toBe(PlayStatus.Queued);

    // Collapse persists to localStorage
    (
      el.querySelector(
        '[data-testid="active-play-shelf-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.collapsed()).toBe(true);
    expect(localStorage.getItem('collection_active_play_shelf_collapsed')).toBe(
      '1',
    );
    expect(
      el.querySelector('[data-testid="active-play-shelf-body"]'),
    ).toBeNull();
  });

  it('prevents duplicate advance emissions while game ID is busy', () => {
    fixture.componentRef.setInput(
      'busyGameIds',
      new Set(['chrono-trigger-snes']),
    );
    fixture.detectChanges();

    let calls = 0;
    component.advanceStatus.subscribe(() => {
      calls++;
    });

    const btn = fixture.nativeElement.querySelector(
      '[data-testid="advance-played-btn"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(calls).toBe(0);
  });
});
