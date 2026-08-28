import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoveryListComponent } from './discovery-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { of } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import {
  Platform,
  IGDBSearchResult,
  ScanSuggestion,
  AmiiboDiscoveryItem,
} from '../../../../core/models/collection.models';

/**
 * UNIT TEST: DiscoveryListComponent
 *
 * Verifies the Manual Game Search, Franchise Discovery, and Amiibo Discovery workflows,
 * modal platform selection, and toast notifications.
 */
describe('DiscoveryListComponent', () => {
  let component: DiscoveryListComponent;
  let fixture: ComponentFixture<DiscoveryListComponent>;
  let mockCollectionService: {
    loading: WritableSignal<boolean>;
    platforms: WritableSignal<Platform[]>;
    searchGames: Mock;
    getGameMatches: Mock;
    addGame: Mock;
    scanSeries: Mock;
    scanAmiibo: Mock;
    addToy: Mock;
    refreshAll: Mock;
  };

  const mockAmiiboItems: AmiiboDiscoveryItem[] = [
    {
      id: '0000000000000002',
      amiibo_id: '0000000000000002',
      name: 'Mario',
      line: 'amiibo',
      series_name: 'Super Mario',
      type: 'Figure',
      image_url: 'https://raw.githubusercontent.com/mario.png',
      release_date: '2014-11-21',
      region: 'NA',
    },
    {
      id: '0001000000000002',
      amiibo_id: '0001000000000002',
      name: 'Isabelle',
      line: 'amiibo',
      series_name: 'Animal Crossing',
      type: 'Card',
      image_url: 'https://raw.githubusercontent.com/isabelle.png',
      release_date: '2015-11-13',
      region: 'NA',
    },
  ];

  beforeEach(async () => {
    vi.useFakeTimers();
    mockCollectionService = {
      loading: signal(false),
      platforms: signal<Platform[]>([
        {
          id: 1,
          name: 'NES',
          display_name: 'Nintendo Entertainment System',
          brand: 'Nintendo',
          launch_date: '1983-07-15',
          image_url: '',
        },
        {
          id: 2,
          name: 'SNES',
          display_name: 'Super Nintendo',
          brand: 'Nintendo',
          launch_date: '1990-11-21',
          image_url: '',
        },
        {
          id: 3,
          name: 'Genesis',
          display_name: 'Sega Genesis',
          brand: 'Sega',
          launch_date: '1988-10-29',
          image_url: '',
        },
      ]),
      searchGames: vi
        .fn()
        .mockReturnValue(
          of([{ id: 'igdb-111', name: 'Saros', platform: 'PlayStation 5' }]),
        ),
      getGameMatches: vi.fn().mockReturnValue(
        of({
          game: { id: 'igdb-111', name: 'Saros', platform: 'PlayStation 5' },
          matchedReleases: [
            { romCrc: 'crc123', name: 'Saros (USA)', region: 'USA' },
          ],
        }),
      ),
      addGame: vi
        .fn()
        .mockReturnValue(of({ success: true, gameId: 'saros-ps5' })),
      scanSeries: vi.fn().mockReturnValue(
        of([
          {
            id: 222,
            title: 'Metroid Fusion',
            platform: 'Game Boy Advance',
            platform_id: 24,
            image_url: null,
            releases: [],
          },
        ] as ScanSuggestion[]),
      ),
      scanAmiibo: vi.fn().mockReturnValue(of(mockAmiiboItems)),
      addToy: vi
        .fn()
        .mockReturnValue(of({ success: true, id: 'amiibo-mario' })),
      refreshAll: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [DiscoveryListComponent],
      providers: [
        { provide: CollectionService, useValue: mockCollectionService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscoveryListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should default to search tab on init', () => {
    expect(component.activeTab()).toBe('search');
  });

  it('should compute platformGroups correctly', () => {
    const groups = component.platformGroups();
    expect(groups.length).toBe(2); // Nintendo, Sega
    expect(groups[0].brand).toBe('Nintendo');
    expect(groups[0].platforms.length).toBe(2);
    expect(groups[1].brand).toBe('Sega');
  });

  it('should manage toast notification life cycle', () => {
    expect(component.toastMessage()).toBeNull();
    component.showToast('Test Ingested Successfully!');
    expect(component.toastMessage()).toBe('Test Ingested Successfully!');

    // Fast forward time
    vi.advanceTimersByTime(4000);
    expect(component.toastMessage()).toBeNull();
  });

  it('should trigger search for all platforms', async () => {
    await component.triggerSearch('Saros', '');
    expect(mockCollectionService.searchGames).toHaveBeenCalledWith('Saros', 0);
    expect(component.searchResults().length).toBe(1);
    expect(component.filteredSearchResults().length).toBe(1);
  });

  it('should reactively filter search results when filterDigital is toggled', () => {
    const physicalGame: IGDBSearchResult = {
      id: 'igdb-1',
      name: 'Super Mario 64',
      platform: 'N64',
      image_url: null,
      physical_status: 'verified_physical',
    };
    const digitalGame: IGDBSearchResult = {
      id: 'igdb-2',
      name: 'Super Mario 64 (Virtual Console)',
      platform: 'Wii U',
      image_url: null,
      physical_status: 'digital_only',
    };

    component.searchResults.set([physicalGame, digitalGame]);
    component.filterDigital.set(true);
    expect(component.filteredSearchResults().length).toBe(1);
    expect(component.filteredSearchResults()[0].id).toBe('igdb-1');

    component.filterDigital.set(false);
    expect(component.filteredSearchResults().length).toBe(2);
  });

  it('should defer release matches when opening ingestion modal with platform = 0', async () => {
    const game: IGDBSearchResult = {
      id: 'igdb-111',
      name: 'Saros',
      platform: 'PlayStation 5',
      image_url: null,
      physical_status: 'verified_physical',
      verification_tier: 1,
    };
    await component.openIngestionModal(game, '');

    expect(component.showModal()).toBe(true);
    expect(component.modalGame()).toEqual(game);
    expect(component.modalPlatformId()).toBe(0);
    expect(component.modalInitialPlatformId()).toBe(0);
    expect(mockCollectionService.getGameMatches).not.toHaveBeenCalled();
    expect(component.matchedReleases().length).toBe(0);
  });

  it('should fetch releases and auto-select variants when selecting a platform in modal', async () => {
    const game: IGDBSearchResult = {
      id: 'igdb-111',
      name: 'Saros',
      platform: 'PlayStation 5',
      image_url: null,
    };
    component.modalGame.set(game);
    component.modalInitialPlatformId.set(0);
    component.modalPlatformId.set(0);

    const selectEvent = { target: { value: '5' } } as unknown as Event;
    await component.onModalPlatformChange(selectEvent);

    expect(component.modalPlatformId()).toBe(5);
    expect(mockCollectionService.getGameMatches).toHaveBeenCalledWith('111', 5);
    expect(component.matchedReleases().length).toBe(1);
    expect(component.matchedReleases()[0].romCrc).toBe('crc123');
    expect(component.selectedReleaseIds().has('crc123')).toBe(true);

    // Toggle selection off
    component.toggleReleaseSelection(component.matchedReleases()[0]);
    expect(component.selectedReleaseIds().has('crc123')).toBe(false);
  });

  it('should submit game ingestion and refresh with physical status', async () => {
    const game: IGDBSearchResult = {
      id: 'igdb-111',
      name: 'Saros',
      platform: 'PlayStation 5',
      image_url: null,
      physical_status: 'verified_physical',
      verification_tier: 1,
    };
    component.modalGame.set(game);
    component.modalPlatformId.set(1);
    component.searchResults.set([game]);

    await component.submitIngestion();

    expect(mockCollectionService.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        game: expect.objectContaining({
          title: 'Saros',
          platform_id: 1,
          physical_status: 'verified_physical',
          verification_tier: 1,
        }),
      }),
    );
    expect(component.showModal()).toBe(false);
    expect(component.searchResults().length).toBe(0);
    expect(mockCollectionService.refreshAll).toHaveBeenCalled();
  });

  it('should trigger franchise series scan and add suggested game', async () => {
    component.activeTab.set('scan');
    await component.triggerSeriesScan();

    expect(mockCollectionService.scanSeries).toHaveBeenCalled();
    expect(component.scanResults().length).toBe(1);

    const suggestion = component.scanResults()[0];
    await component.addGameFromSeries(suggestion);

    expect(mockCollectionService.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        game: expect.objectContaining({
          title: 'Metroid Fusion',
          platform_id: 24,
        }),
      }),
    );
    expect(component.scanResults().length).toBe(0);
  });

  it('should trigger amiibo scan, filter results, and ingest single amiibo', async () => {
    component.activeTab.set('amiibo');
    await component.triggerAmiiboScan();

    expect(mockCollectionService.scanAmiibo).toHaveBeenCalled();
    expect(component.amiiboResults().length).toBe(2);
    expect(component.amiiboSeriesList()).toEqual([
      'Animal Crossing',
      'Super Mario',
    ]);
    expect(component.amiiboTypesList()).toEqual(['Card', 'Figure']);

    // Filter by type 'Figure'
    component.amiiboTypeFilter.set('Figure');
    expect(component.filteredAmiiboResults().length).toBe(1);
    expect(component.filteredAmiiboResults()[0].name).toBe('Mario');

    // Add single amiibo
    await component.addSingleAmiibo(mockAmiiboItems[0]);

    expect(mockCollectionService.addToy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mario',
        line: 'amiibo',
        amiibo_id: '0000000000000002',
      }),
    );
    expect(component.amiiboResults().length).toBe(1);
  });
});
