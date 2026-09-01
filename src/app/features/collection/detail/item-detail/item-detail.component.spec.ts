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
import { of, BehaviorSubject } from 'rxjs';
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

    await TestBed.configureTestingModule({
      imports: [ItemDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
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

  it('should navigate to collection with exact series filter', () => {
    const navigateSpy = vi.spyOn(router, 'navigate');
    const updateStateSpy = vi.spyOn(collectionService, 'updateListState');

    component.filterBySeries('Mario');

    expect(updateStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          seriesOrName: 'Mario',
          seriesExact: true,
        }),
      }),
    );
    expect(navigateSpy).toHaveBeenCalledWith(['/collection', 'games']);
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
        releases: [
          {
            id: 'super-mario-world-snes-usa',
            game_id: 1,
            region: 'USA',
            rom_name: 'Super Mario World (USA).sfc',
            rom_crc: 'B19DF4F3',
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
    // Check for Physical Release Verified pill
    const romPill = compiled.querySelector('.stat-pill.physical-release');
    expect(romPill).toBeTruthy();
    expect(romPill.textContent).toContain('Physical Release Verified');

    // Check for ROM filename in the discs list
    const discsSection = compiled.querySelector('.discs-section');
    expect(discsSection).toBeTruthy();
    expect(discsSection.textContent).toContain('Physical Discs / ROMs');
    expect(discsSection.textContent).toContain('Super Mario World (USA).sfc');

    // Check for CRC metadata in the discs list
    const crcText = compiled.querySelector('.crc-text');
    expect(crcText).toBeTruthy();
    expect(crcText.textContent).toContain('B19DF4F3');
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
});
