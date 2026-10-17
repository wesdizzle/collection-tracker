import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GameCardComponent } from './game-card.component';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
} from '../../../../core/models/collection.models';

describe('GameCardComponent', () => {
  let component: GameCardComponent;
  let fixture: ComponentFixture<GameCardComponent>;

  const mockGame: Game = {
    stable_id: 1,
    id: 'super-mario-galaxy-wii',
    title: 'Super Mario Galaxy',
    platform: 'Wii',
    platform_id: 15,
    region: 'USA',
    series: 'Super Mario',
    play_status: PlayStatus.Queued,
    ownership_status: OwnershipStatus.Owned,
    has_case: 1,
    has_manual: 1,
    backup_status: 1,
    price_cib: 1550,
    price_loose: 1200,
    release_date: '2007-11-12',
    image_url: 'https://example.com/smg.jpg',
    canonical_series: 'Super Mario',
    discIds: ['smg-disc-1', 'smg-disc-2'],
    discBackups: [1, 0],
    discRomNames: ['SMG Disc 1.iso', 'SMG Disc 2.iso'],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(GameCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('game', mockGame);
    fixture.detectChanges();
  });

  it('should create and render game details', () => {
    expect(component).toBeTruthy();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.card-title')?.textContent).toContain(
      'Super Mario Galaxy',
    );
    expect(compiled.querySelector('.region-flag')?.textContent).toContain(
      'USA',
    );
    expect(compiled.querySelector('.release-year')?.textContent).toContain(
      '2007',
    );
  });

  it('should emit toggleStatus when status button is clicked', () => {
    let emitted = false;
    component.toggleStatus.subscribe((event) => {
      emitted = true;
      expect(event.game.id).toBe('super-mario-galaxy-wii');
    });

    const statusBtn = fixture.nativeElement.querySelector(
      '.status-badge',
    ) as HTMLButtonElement;
    statusBtn.click();
    expect(emitted).toBe(true);
  });

  it('should emit toggleCase and toggleManual when completeness chips are clicked', () => {
    let caseToggled = false;
    let manualToggled = false;

    component.toggleCase.subscribe(() => {
      caseToggled = true;
    });
    component.toggleManual.subscribe(() => {
      manualToggled = true;
    });

    const chips = fixture.nativeElement.querySelectorAll(
      '.completeness-chip',
    ) as NodeListOf<HTMLButtonElement>;
    expect(chips.length).toBe(2);

    chips[0].click();
    expect(caseToggled).toBe(true);

    chips[1].click();
    expect(manualToggled).toBe(true);
  });

  it('should emit toggleDiscBackup when multi-disc button is clicked', () => {
    let discIndexEmitted = -1;
    component.toggleDiscBackup.subscribe((event) => {
      discIndexEmitted = event.discIndex;
    });

    const backupBadges = fixture.nativeElement.querySelectorAll(
      '.backup-badge',
    ) as NodeListOf<HTMLButtonElement>;
    expect(backupBadges.length).toBe(2);

    backupBadges[0].click();
    expect(discIndexEmitted).toBe(0);
  });

  it('should calculate budget labels and arbitrage savings', () => {
    const budgetGame = {
      ...mockGame,
      also_released_as: "Player's Choice",
      variants: null,
    };
    expect(component.getOptionalBudgetLabels(budgetGame)).toEqual([
      "Player's Choice",
    ]);

    const dealGame = {
      ...mockGame,
      retail_price: 1000,
      price_cib: 2500,
    };
    expect(component.getDealArbitrageSavings(dealGame)).toBe(1500);
  });

  it('should render backup-badge for single-disc physical games with icon only and emit toggleDiscBackup on click', () => {
    const singleDiscGame: Game = {
      ...mockGame,
      id: 'single-disc-game',
      discIds: ['single-cart-1'],
      backup_status: 1,
      igdb_id: 12345,
    };
    fixture.componentRef.setInput('game', singleDiscGame);
    fixture.detectChanges();

    // Verify IGDB ribbon is NOT rendered
    expect(fixture.nativeElement.querySelector('.igdb-icon')).toBeNull();

    // Verify backup badge is rendered
    const backupBadge = fixture.nativeElement.querySelector(
      '.backup-badge',
    ) as HTMLButtonElement;
    expect(backupBadge).toBeTruthy();
    // Should have no text when single disc
    expect(backupBadge.textContent?.trim()).toBe('');
    expect(backupBadge.querySelector('app-icon')).toBeTruthy();

    let emittedIndex = -1;
    component.toggleDiscBackup.subscribe((evt) => {
      emittedIndex = evt.discIndex;
    });

    backupBadge.click();
    expect(emittedIndex).toBe(0);
  });

  it('should determine media icon based on platform (disc for optical, rom-archive for carts)', () => {
    const opticalGame: Game = {
      ...mockGame,
      platform: 'PlayStation 5',
    };
    const cartGame: Game = {
      ...mockGame,
      platform: 'Game Boy Advance',
    };
    expect(component.getMediaIcon(opticalGame, 1)).toBe('disc');
    expect(component.getMediaIcon(cartGame, 1)).toBe('rom-archive');
    expect(component.getMediaIcon(opticalGame, 0)).toBe('missing-dump');
  });
});
