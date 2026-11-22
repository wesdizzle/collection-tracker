import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
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
    has_media: 1,
    release_date: '2007-11-12',
    image_url: 'https://example.com/smg.jpg',
    canonical_series: 'Super Mario',
    mediaItems: [
      {
        id: 'smg-disc-1',
        label: 'Disc 1',
        hasMedia: 1,
        romName: 'SMG Disc 1.iso',
      },
      {
        id: 'smg-disc-2',
        label: 'Disc 2',
        hasMedia: 0,
        romName: 'SMG Disc 2.iso',
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
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

  it('should emit openDiscChecklist when multi-disc button is clicked', () => {
    let emittedGameId: string | undefined;
    component.openDiscChecklist.subscribe((event) => {
      emittedGameId = event.game.id;
    });

    const mediaBadges = fixture.nativeElement.querySelectorAll(
      '.backup-badge',
    ) as NodeListOf<HTMLButtonElement>;
    expect(mediaBadges.length).toBe(2);

    mediaBadges[0].click();
    expect(emittedGameId).toBe('super-mario-galaxy-wii');
  });

  it('should calculate budget labels', () => {
    const budgetGame = {
      ...mockGame,
      also_released_as: "Player's Choice",
      variants: null,
    };
    expect(component.getOptionalBudgetLabels(budgetGame)).toEqual([
      "Player's Choice",
    ]);
  });

  it('should render media badge for single-disc physical games with icon only and emit toggleMediaOwned on click', () => {
    const singleDiscGame: Game = {
      ...mockGame,
      id: 'single-disc-game',
      mediaItems: [{ id: 'single-cart-1', label: 'Disc', hasMedia: 1 }],
      has_media: 1,
      igdb_id: 12345,
    };
    fixture.componentRef.setInput('game', singleDiscGame);
    fixture.detectChanges();

    // Verify IGDB ribbon is NOT rendered
    expect(fixture.nativeElement.querySelector('.igdb-icon')).toBeNull();

    // Verify media badge is rendered
    const mediaBadge = fixture.nativeElement.querySelector(
      '.backup-badge',
    ) as HTMLButtonElement;
    expect(mediaBadge).toBeTruthy();
    // Should have no text when single disc
    expect(mediaBadge.textContent?.trim()).toBe('');
    expect(mediaBadge.querySelector('app-icon')).toBeTruthy();

    let emittedGame: Game | undefined;
    component.toggleMediaOwned.subscribe((evt) => {
      emittedGame = evt.game;
    });

    mediaBadge.click();
    expect(emittedGame?.id).toBe('single-disc-game');
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

  it('should format preorder retail_price in cents correctly even under $10', () => {
    const preorderGame: Game = {
      ...mockGame,
      id: 'preorder-test-game',
      retail_on_sale: 0,
      retail_store: 'Limited Run Games',
      retail_url: 'https://example.com/preorder',
      retail_price: 999,
    };
    fixture.componentRef.setInput('game', preorderGame);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.preorder-store-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('$9.99');
  });

  it('should omit media badges when showMediaDetails is false', () => {
    fixture.componentRef.setInput('showMediaDetails', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.backup-badge').length).toBe(
      0,
    );

    // Also verify single-disc game omits media badge when showMediaDetails is false
    fixture.componentRef.setInput('game', {
      ...mockGame,
      mediaItems: [{ id: 'single-cart-1', label: 'Disc', hasMedia: 1 }],
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.backup-badge')).toBeNull();
  });

  it('scopes view-transition-name to the active card on pointerdown/activation', () => {
    const cs = TestBed.inject(CollectionService);
    cs.setActiveTransitionItem('game', null);
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector(
      '.card-art',
    ) as HTMLImageElement;
    expect(component.activeViewTransitionName()).toBeNull();
    expect(img.style.getPropertyValue('view-transition-name')).toBe('');

    const link = fixture.nativeElement.querySelector(
      '.card-primary-link',
    ) as HTMLAnchorElement;
    link.dispatchEvent(new Event('pointerdown'));
    fixture.detectChanges();

    expect(cs.activeTransitionItem()).toEqual({
      type: 'game',
      id: '1',
    });
    expect(component.activeViewTransitionName()).toBe('catalog-media-game-1');
    expect(img.style.getPropertyValue('view-transition-name')).toBe(
      'catalog-media-game-1',
    );
  });

  it('always renders provenance badge when personal state is visible and journal details exist, and omits it otherwise', () => {
    const cs = TestBed.inject(CollectionService);
    const httpMock = TestBed.inject(HttpTestingController);

    // Unauthenticated initially -> badge omitted
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="card-provenance-badge"]',
      ),
    ).toBeNull();

    cs.setAdminForTesting(true);
    cs.loadAllJournalEntries().subscribe();
    httpMock.expectOne('/api/journal/entries').flush({
      authorized: true,
      entries: [
        {
          id: 1,
          item_type: 'game',
          item_id: 'super-mario-galaxy-wii',
          purchase_date: '2018-05-10',
          is_approximate_date: 0,
          price_paid: 45,
          merchant: 'eBay',
          gifted_by: null,
          receipt_url: null,
          notes: null,
        },
      ],
    });
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector(
      '[data-testid="card-provenance-badge"]',
    ) as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('May 2018');
    expect(badge.textContent).toContain('$45');
    expect(badge.textContent).toContain('eBay');
    expect(badge.getAttribute('title')).toContain('Paid: $45.00');
    expect(badge.getAttribute('title')).toContain('Source: eBay');

    // Public view -> strictly hidden
    cs.setPublicView(true, null);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="card-provenance-badge"]',
      ),
    ).toBeNull();

    // Back to personal view, but unrecorded game -> omitted
    cs.exitPublicView();
    fixture.componentRef.setInput('game', {
      ...mockGame,
      id: 'unrecorded-game-wii',
      mediaItems: undefined,
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="card-provenance-badge"]',
      ),
    ).toBeNull();
  });
});
