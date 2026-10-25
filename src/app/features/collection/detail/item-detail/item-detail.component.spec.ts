import '../../../../../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
  ParamMap,
} from '@angular/router';
import { of, BehaviorSubject, throwError } from 'rxjs';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { ItemDetailComponent } from './item-detail.component';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Game,
  Toy,
  PlayStatus,
} from '../../../../core/models/collection.models';

/**
 * UNIT TEST: ItemDetailComponent
 *
 * Verifies that the detail view correctly loads and displays item information.
 * Uses modern Angular 21+ provider-based mocking for HTTP and Routing.
 */
describe('ItemDetailComponent', () => {
  let component: ItemDetailComponent;
  let fixture: ComponentFixture<ItemDetailComponent>;
  let collectionService: CollectionService;
  let router: Router;
  let paramMapSubject: BehaviorSubject<ParamMap>;

  const mockGame: Game = {
    stable_id: 1,
    id: 'super-mario-world-snes',
    title: 'Super Mario World',
    series: 'Mario',
    canonical_series: 'Mario',
    platform: 'SNES',
    platform_id: 19,
    release_date: '1990-11-21',
    image_url: 'mario.jpg',
    genres: 'Platformer',
    summary: 'A classic game.',
    ownership_status: 1,
    play_status: PlayStatus.Played,
    backup_status: 1,
  };

  const mockToy: Toy = {
    stable_id: 1,
    id: 'amiibo-1',
    name: 'Mario',
    line: 'amiibo',
    type: 'Figure',
    series_name: 'Super Mario',
    series_line: 'Super Mario',
    release_date: '2014-11-21',
    image_url: 'mario-amiibo.jpg',
    ownership_status: 1,
    verified: 1,
  };

  beforeEach(async () => {
    paramMapSubject = new BehaviorSubject(
      convertToParamMap({ id: '1', type: 'game' }),
    );

    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    await TestBed.configureTestingModule({
      imports: [ItemDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', component: class {} }]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMapSubject.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemDetailComponent);
    component = fixture.componentInstance;
    collectionService = TestBed.inject(CollectionService);
    router = TestBed.inject(Router);

    vi.spyOn(collectionService, 'getGameById').mockReturnValue(of(mockGame));
    vi.spyOn(collectionService, 'getToyById').mockReturnValue(of(mockToy));

    fixture.detectChanges();
  });

  it('should load and display game details', async () => {
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.game()).toEqual(mockGame);
    expect(component.formattedDate()).toContain('Wednesday, November 21, 1990');

    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('.item-title').textContent).toContain(
      'Super Mario World',
    );
  });

  it('should load and display toy details', async () => {
    paramMapSubject.next(convertToParamMap({ id: 'amiibo-1', type: 'toy' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.toy()).toEqual(mockToy);
    expect(component.type()).toBe('toy');

    const compiled = fixture.nativeElement;
    expect(compiled.querySelector('.item-title').textContent).toContain(
      'Mario',
    );
    expect(compiled.querySelector('.item-series').textContent).toContain(
      'Super Mario',
    );
  });

  it('should navigate to collection with exact series filter and reset scroll', () => {
    const reuseStrategy = new CollectionRouteReuseStrategy();
    const clearRouteSpy = vi.spyOn(reuseStrategy, 'clearRoute');
    (
      component as unknown as {
        routeReuseStrategy: CollectionRouteReuseStrategy;
      }
    ).routeReuseStrategy = reuseStrategy;

    const navigateSpy = vi.spyOn(router, 'navigate');
    const updateStateSpy = vi.spyOn(collectionService, 'updateListState');

    component.filterBySeries('Mario');

    expect(clearRouteSpy).toHaveBeenCalledWith('games');
    expect(updateStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          seriesOrName: 'Mario',
          seriesExact: true,
        }),
        scrollX: 0,
        scrollY: 0,
      }),
    );
    expect(navigateSpy).toHaveBeenCalledWith(['/collection', 'games']);
  });

  it('should reset window scroll to (0, 0) on initialization and param change', () => {
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});

    paramMapSubject.next(convertToParamMap({ id: '2', type: 'game' }));
    fixture.detectChanges();

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  });

  it('should delegate to navigationHistory.back on onBack', () => {
    const backSpy = vi
      .spyOn(component.navigationHistory, 'back')
      .mockImplementation(() => {});
    const preventDefault = vi.fn();
    const mockEvent = { preventDefault } as unknown as Event;

    component.onBack(mockEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(backSpy).toHaveBeenCalledWith(['/collection', 'games']);
  });

  it('should handle missing release dates gracefully', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({ ...mockGame, release_date: '' }),
    );

    // Force reload
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.formattedDate()).toBeNull();
  });

  it('should display physical release verified badge and metadata when releases are present', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        rom_name: 'Super Mario World (USA).sfc',
        rom_crc: 'B19DF4F3',
        is_source_verified: 1,
        releases: [
          {
            id: 'super-mario-world-snes-usa',
            game_id: 1,
            region: 'USA',
            rom_name: 'Super Mario World (USA).sfc',
            rom_crc: 'B19DF4F3',
            backup_status: 1,
            ownership_status: 1,
            is_source_verified: 1,
          },
        ],
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    // Check for Physical Release Verified pill
    const romPill = compiled.querySelector('.stat-pill.physical-release');
    expect(romPill).toBeTruthy();
    expect(romPill.textContent).toContain('Verified Source Match');

    // Check for physical discs / releases section
    const discsSection = compiled.querySelector('.discs-section');
    expect(discsSection).toBeTruthy();
    expect(discsSection.textContent).toContain('Physical Discs / Releases');

    // Filenames and raw CRC32 must NOT be rendered in the UI
    expect(discsSection.textContent).not.toContain(
      'Super Mario World (USA).sfc',
    );
    expect(discsSection.textContent).not.toContain('B19DF4F3');
  });

  it('should render the IGDB verified pill as an anchor tag with correct URL', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        igdb_id: 12345,
        igdb_url:
          'https://www.igdb.com/games/the-legend-of-zelda-ocarina-of-time',
        title: 'The Legend of Zelda: Ocarina of Time',
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const igdbLink = compiled.querySelector('a.stat-pill.igdb');
    expect(igdbLink).toBeTruthy();
    expect(igdbLink.getAttribute('href')).toBe(
      'https://www.igdb.com/games/the-legend-of-zelda-ocarina-of-time',
    );
    expect(igdbLink.getAttribute('target')).toBe('_blank');
  });

  it('should display Nintendo Revised attribution pill for Switch 1 & Switch 2 games', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        platform_id: 26,
        platform: 'Nintendo Switch',
        title: 'Super Mario Odyssey',
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const sheetLink = compiled.querySelector('a.stat-pill.physical');
    expect(sheetLink).toBeTruthy();
    expect(sheetLink.getAttribute('href')).toContain(
      'docs.google.com/spreadsheets/d/1CEABCBrPv1tWf89hSZqUunK0JW-sQo8XpxuvZhdtHQs',
    );
    expect(sheetLink.textContent).toContain('Nintendo Revised Sheet');
  });

  it('should display Switch revision variant, serial code, and sheet comments without raw filename or CRC32', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        platform_id: 26,
        platform: 'Nintendo Switch',
        title: '1-2-Switch',
        releases: [
          {
            id: 'rel-switch-1',
            game_id: 1,
            region: 'USA',
            variants: 'Rev 001 (v1.1.0)',
            serial_code: 'LA-H-AACCA-USA',
            comments: 'Complete on cart',
            rom_name: '1-2-Switch [0100000000010000][v65536].xci',
            rom_crc: null,
            backup_status: 1,
            ownership_status: 1,
          },
        ],
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const discsSection = compiled.querySelector('.discs-section');
    expect(discsSection).toBeTruthy();
    expect(discsSection.textContent).toContain('Rev 001 (v1.1.0)');
    expect(discsSection.textContent).toContain('LA-H-AACCA-USA');
    expect(discsSection.textContent).toContain('Complete on cart');
    expect(discsSection.textContent).not.toContain(
      '1-2-Switch [0100000000010000][v65536].xci',
    );
    expect(discsSection.textContent).not.toContain('CRC32');
  });

  it('should display extracted archival ROM provenance and badge', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        title: 'EarthBound Beginnings',
        platform: 'NES',
        physical_status: 'digital_extracted_rom',
        release_medium: 'digital_extracted_rom',
        origin_metadata: JSON.stringify({
          origin_type: 'extracted_virtual_console',
          origin_platform: 'Wii U Virtual Console',
          origin_channel: 'Wii U Virtual Console',
          origin_year: 2015,
          target_hardware: 'Nintendo Entertainment System / Famicom',
          notes: 'First official English localization release.',
        }),
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    // Check extracted ROM pill
    const extractedPill = compiled.querySelector('.stat-pill.extracted-rom');
    expect(extractedPill).toBeTruthy();
    expect(extractedPill.textContent).toContain('Extracted Archival ROM');

    // Check provenance card
    const provenanceCard = compiled.querySelector('.provenance-section');
    expect(provenanceCard).toBeTruthy();
    expect(provenanceCard.textContent).toContain('Wii U Virtual Console');
    expect(provenanceCard.textContent).toContain('2015');
    expect(provenanceCard.textContent).toContain(
      'First official English localization release.',
    );
  });

  it('should display included bundled games and bonus discs', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        title: 'Bayonetta 2',
        platform: 'Wii U',
        bundled_games: [
          {
            stable_id: 201,
            id: 'bayonetta-wiiu-disc2',
            title: 'Bayonetta',
            platform_id: 24,
            platform_name: 'Wii U',
            bundle_disc_number: 2,
            rom_name: 'Bayonetta (USA) (Disc 2).wux',
            backup_status: 1,
          },
        ],
      }),
    );
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const bundlesSection = compiled.querySelector('.bundles-section');
    expect(bundlesSection).toBeTruthy();
    expect(bundlesSection.textContent).toContain(
      'Included Games & Bonus Discs (In-Box)',
    );
    expect(bundlesSection.textContent).toContain('Bayonetta');
    expect(bundlesSection.textContent).toContain('Disc 2');
    expect(bundlesSection.textContent).toContain('Backed Up');
  });

  it('should render external source link for Amiibo, Skylanders, and Starlink toys', async () => {
    // 1. Amiibo with amiibo_id
    const amiiboToy: Toy = {
      ...mockToy,
      amiibo_id: '00030000000c0002',
    };
    vi.spyOn(collectionService, 'getToyById').mockReturnValue(of(amiiboToy));
    paramMapSubject.next(convertToParamMap({ id: 'amiibo-1', type: 'toy' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement;
    const amiiboLink = compiled.querySelector('.stat-pill.physical');
    expect(amiiboLink).toBeTruthy();
    expect(amiiboLink.textContent).toContain('AmiiboAPI');
    expect(amiiboLink.getAttribute('href')).toContain('00030000000c0002');

    // 2. Skylanders with scl_url
    const skylandersToy: Toy = {
      ...mockToy,
      line: 'Skylanders',
      scl_url: 'https://skylanderscharacterlist.com/spyro/',
    };
    vi.spyOn(collectionService, 'getToyById').mockReturnValue(
      of(skylandersToy),
    );
    paramMapSubject.next(convertToParamMap({ id: 'spyro', type: 'toy' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sclLink = compiled.querySelector('.stat-pill.physical');
    expect(sclLink).toBeTruthy();
    expect(sclLink.textContent).toContain('SCL Character Page');
    expect(sclLink.getAttribute('href')).toBe(
      'https://skylanderscharacterlist.com/spyro/',
    );

    // 3. Starlink toy
    const starlinkToy: Toy = {
      ...mockToy,
      name: 'Fox McCloud',
      line: 'Starlink',
    };
    vi.spyOn(collectionService, 'getToyById').mockReturnValue(of(starlinkToy));
    paramMapSubject.next(convertToParamMap({ id: 'fox', type: 'toy' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const starlinkLink = compiled.querySelector('.stat-pill.physical');
    expect(starlinkLink).toBeTruthy();
    expect(starlinkLink.textContent).toContain('Starlink Wiki');
    expect(starlinkLink.getAttribute('href')).toContain('Fox_McCloud');
  });

  it('should display error state when item fails to load', async () => {
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      throwError(() => new Error('Failed to fetch metadata')),
    );
    paramMapSubject.next(convertToParamMap({ id: '999', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const errorState = compiled.querySelector('.error-state');
    expect(errorState).toBeTruthy();
    expect(compiled.querySelector('.error-message')?.textContent).toContain(
      'Unable to retrieve item metadata. Please try again later.',
    );
    expect(compiled.querySelector('.retry-btn')).toBeTruthy();
  });

  it('should display retail pricing, deal banner, arbitrage savings, and outbound research links', async () => {
    const dealGame: Game = {
      ...mockGame,
      title: 'Hollow Knight',
      platform: 'Nintendo Switch',
      display_name: 'Nintendo Switch',
      price_loose: 2500,
      price_cib: 3500,
      price_new: 4000,
      retail_price: 1499,
      retail_regular_price: 3499,
      retail_discount_pct: 57,
      retail_on_sale: 1,
      retail_store: 'Best Buy',
      retail_url:
        'https://www.bestbuy.com/site/hollow-knight-nintendo-switch/6352097.p?skuId=6352097',
    };
    vi.spyOn(collectionService, 'getGameById').mockReturnValue(of(dealGame));
    paramMapSubject.next(convertToParamMap({ id: '1', type: 'game' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const marketSection = compiled.querySelector('.market-section');
    expect(marketSection).toBeTruthy();

    // Check deal banner and arbitrage note
    const dealBanner = compiled.querySelector('.deal-banner');
    expect(dealBanner).toBeTruthy();
    expect(dealBanner?.textContent).toContain('57% OFF');
    expect(dealBanner?.textContent).toContain('$14.99');
    expect(dealBanner?.textContent).toContain('Reg: $34.99');
    expect(dealBanner?.textContent).toContain('Arbitrage Opportunity');
    expect(dealBanner?.textContent).toContain(
      '$20.01 cheaper than PriceCharting CIB',
    );

    // Check direct Best Buy buy button
    const buyBtn = compiled.querySelector('.btn-retail-buy');
    expect(buyBtn).toBeTruthy();
    expect(buyBtn?.getAttribute('href')).toBe(dealGame.retail_url);

    // Check outbound research links
    const ebayLink = compiled.querySelector('a.jump-link-pill.ebay');
    expect(ebayLink).toBeTruthy();
    expect(ebayLink?.getAttribute('href')).toContain('ebay.com');
    expect(ebayLink?.getAttribute('href')).toContain('_sacat=139973');

    const dekuLink = compiled.querySelector('a.jump-link-pill.deku');
    expect(dekuLink).toBeTruthy();
    expect(dekuLink?.getAttribute('href')).toBe(
      'https://www.dekudeals.com/search?q=Hollow%20Knight',
    );
  });

  it('renders Acquisition Journal masked by default and reveals approximate "Around" dates, receipt URL, and ROI when toggled by admin', async () => {
    const internalService = collectionService as unknown as {
      _isAdmin: { set: (val: boolean) => void };
      _journalRevealed: { set: (val: boolean) => void };
    };
    internalService._isAdmin.set(true);
    internalService._journalRevealed.set(false);

    vi.spyOn(collectionService, 'getGameById').mockReturnValue(
      of({
        ...mockGame,
        id: 'wii-sports-nintendo-wii',
        title: 'Wii Sports',
        price_cib: 3500,
      }),
    );

    vi.spyOn(collectionService, 'getJournalEntry').mockReturnValue(
      of({
        authorized: true,
        entry: {
          id: 42,
          item_type: 'game',
          item_id: 'wii-sports-nintendo-wii',
          purchase_date: '2009-06',
          is_approximate_date: 1,
          price_paid: 0,
          merchant: 'Best Buy',
          gifted_by: null,
          receipt_url: 'https://mail.google.com/mail/u/0/#all/16867f8a6f04196d',
          notes:
            'Free pack-in with Nintendo Wii console, purchased around June 2009 as part of a Best Buy promotion bundling it with an HP Pavilion dv6-1245dx laptop',
        },
      }),
    );

    paramMapSubject.next(
      convertToParamMap({ id: 'wii-sports-nintendo-wii', type: 'game' }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // 1. Default state is masked
    const maskedGrid = compiled.querySelector(
      '[data-testid="journal-masked-state"]',
    );
    expect(maskedGrid).toBeTruthy();
    expect(maskedGrid?.textContent).toContain('••••••');
    expect(
      compiled.querySelector('[data-testid="journal-revealed-state"]'),
    ).toBeNull();

    // 2. Click eye icon button to reveal
    const eyeBtn = compiled.querySelector(
      '[data-testid="btn-toggle-journal-eye"]',
    ) as HTMLButtonElement;
    expect(eyeBtn).toBeTruthy();
    eyeBtn.click();
    fixture.detectChanges();

    const revealedGrid = compiled.querySelector(
      '[data-testid="journal-revealed-state"]',
    );
    expect(revealedGrid).toBeTruthy();
    expect(
      compiled.querySelector('[data-testid="journal-date-display"]')
        ?.textContent,
    ).toContain('Around June 2009');
    expect(
      compiled.querySelector('[data-testid="journal-price-display"]')
        ?.textContent,
    ).toContain('$0.00');
    expect(
      compiled.querySelector('[data-testid="journal-merchant-display"]')
        ?.textContent,
    ).toContain('Best Buy');
    expect(
      compiled.querySelector('[data-testid="journal-roi-display"]')
        ?.textContent,
    ).toContain('+$35.00');

    const receiptLink = compiled.querySelector(
      '[data-testid="journal-receipt-link"]',
    ) as HTMLAnchorElement;
    expect(receiptLink).toBeTruthy();
    expect(receiptLink.getAttribute('href')).toBe(
      'https://mail.google.com/mail/u/0/#all/16867f8a6f04196d',
    );

    const notesCallout = compiled.querySelector(
      '[data-testid="journal-notes-display"]',
    );
    expect(notesCallout?.textContent).toContain('HP Pavilion dv6-1245dx');
  });

  describe('PriceCharting & Market Pricing Integration', () => {
    it('should generate valid PriceCharting search URLs for games and toys', () => {
      const gameUrl = component.getGamePriceChartingUrl(mockGame);
      expect(gameUrl).toBe(
        'https://www.pricecharting.com/search-products?q=Super%20Mario%20World%20SNES&type=prices',
      );

      const skylanderToy: Toy = {
        ...mockToy,
        name: 'Camo',
        line: 'Skylanders',
        series_name: "Spyro's Adventure",
      };
      const toyUrl = component.getToyPriceChartingUrl(skylanderToy);
      expect(toyUrl).toBe(
        "https://www.pricecharting.com/search-products?q=Camo%20Spyro's%20Adventure&type=prices",
      );

      const amiiboToy: Toy = {
        ...mockToy,
        name: 'K.K.',
        line: 'amiibo',
      };
      const amiiboUrl = component.getToyPriceChartingUrl(amiiboToy);
      expect(amiiboUrl).toBe(
        'https://www.pricecharting.com/search-products?q=K.K.%20amiibo&type=prices',
      );
    });

    it('should generate targeted eBay search URLs for toys', () => {
      const skylanderToy: Toy = {
        ...mockToy,
        name: 'Camo',
        line: 'Skylanders',
      };
      expect(component.getSmartEbayToyUrl(skylanderToy, 'all')).toBe(
        'https://www.ebay.com/sch/i.html?_nkw=Camo%20Skylanders',
      );
      expect(component.getSmartEbayToyUrl(skylanderToy, 'loose')).toBe(
        'https://www.ebay.com/sch/i.html?_nkw=Camo%20Skylanders%20loose',
      );
      expect(component.getSmartEbayToyUrl(skylanderToy, 'new')).toBe(
        'https://www.ebay.com/sch/i.html?_nkw=Camo%20Skylanders%20nib%20sealed',
      );
    });

    it('should render toy market pricing cards and research links when toy prices are present', async () => {
      const pricedToy: Toy = {
        ...mockToy,
        name: 'Camo',
        line: 'Skylanders',
        series_name: "Spyro's Adventure",
        price_loose: 916,
        price_cib: 916,
        price_new: 1499,
        price_updated_at: '2026-10-18',
      };

      vi.spyOn(collectionService, 'getToyById').mockReturnValue(of(pricedToy));
      paramMapSubject.next(convertToParamMap({ id: 'toy-camo', type: 'toy' }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const marketSection = compiled.querySelector('.market-section');
      expect(marketSection).toBeTruthy();
      expect(marketSection?.textContent).toContain(
        'Market Valuation & Pricing',
      );
      expect(marketSection?.textContent).toContain('$9.16');
      expect(marketSection?.textContent).toContain('$14.99');

      const pricechartingLinks = compiled.querySelectorAll(
        'a[href*="pricecharting.com"]',
      );
      expect(pricechartingLinks.length).toBeGreaterThan(0);
      expect(pricechartingLinks[0].getAttribute('href')).toContain(
        'pricecharting.com/search-products',
      );
    });

    it('should not mark past released unowned games as upcoming pre-release', async () => {
      const pastUnownedGame: Game = {
        ...mockGame,
        ownership_status: 0,
        release_date: '1990-11-21',
        releases: [
          {
            id: 'super-mario-world-snes-1',
            game_id: 1,
            region: 'USA',
            ownership_status: 0,
            backup_status: 0,
            release_date: '1990-11-21',
          },
        ],
      };

      vi.spyOn(collectionService, 'getGameById').mockReturnValue(
        of(pastUnownedGame),
      );
      paramMapSubject.next(
        convertToParamMap({ id: 'super-mario-world-snes', type: 'game' }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      const upcomingPill = compiled.querySelector('.stat-pill.upcoming');
      expect(upcomingPill).toBeNull();
      expect(component.isUpcomingRelease(pastUnownedGame)).toBe(false);
    });

    it('should correctly mark future unowned games as upcoming pre-release', () => {
      const futureGame: Game = {
        ...mockGame,
        ownership_status: 0,
        release_date: '2099-01-01',
        releases: [],
      };
      expect(component.isUpcomingRelease(futureGame)).toBe(true);
    });

    it('should never show watch for physical button on verified physical or signature matched games even when unowned', async () => {
      const asteroidsUnowned: Game = {
        ...mockGame,
        id: 'asteroids-atari-2600',
        title: 'Asteroids',
        platform: 'Atari 2600',
        platform_id: 10,
        ownership_status: 0,
        physical_status: 'verified_physical',
        rom_name: 'Asteroids (Japan, USA).a26',
        releases: [
          {
            id: 'asteroids-atari-2600-rel-1',
            game_id: 10,
            region: 'USA',
            rom_name: 'Asteroids (Japan, USA).a26',
            ownership_status: 0,
            backup_status: 0,
            is_physical: 1,
          },
        ],
      };

      vi.spyOn(collectionService, 'getGameById').mockReturnValue(
        of(asteroidsUnowned),
      );
      paramMapSubject.next(
        convertToParamMap({ id: 'asteroids-atari-2600', type: 'game' }),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).not.toContain('+ Watch for Physical');
      expect(component.canWatchPhysical(asteroidsUnowned)).toBe(false);
      expect(component.hasPhysicalRelease(asteroidsUnowned)).toBe(true);
    });
  });
});
