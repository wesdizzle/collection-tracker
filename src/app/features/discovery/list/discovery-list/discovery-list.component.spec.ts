import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoveryListComponent } from './discovery-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { of, throwError } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import {
  DiscoveryItem,
  Platform,
  IGDBSearchResult,
} from '../../../../core/models/collection.models';

/**
 * UNIT TEST: DiscoveryListComponent
 *
 * Verifies the discovery reconciliation workflow, manual search global searches,
 * target platform modal selection, and bottom toast notifications.
 */
describe('DiscoveryListComponent', () => {
  let component: DiscoveryListComponent;
  let fixture: ComponentFixture<DiscoveryListComponent>;
  let mockCollectionService: {
    loading: WritableSignal<boolean>;
    discoveryItems: WritableSignal<DiscoveryItem[]>;
    refreshDiscovery: Mock;
    applyDiscovery: Mock;
    platforms: WritableSignal<Platform[]>;
    searchGames: Mock;
    getGameMatches: Mock;
    addGame: Mock;
    refreshAll: Mock;
  };

  const mockItems: DiscoveryItem[] = [
    {
      title: 'Space Invaders',
      platform: 'Atari 2600',
      options: [
        {
          id: 'igdb-123',
          name: 'Space Invaders',
          platform: 'NES',
          image_url: null,
          summary: null,
        },
      ],
    },
  ];

  beforeEach(async () => {
    vi.useFakeTimers();
    mockCollectionService = {
      loading: signal(false),
      discoveryItems: signal(mockItems),
      refreshDiscovery: vi.fn().mockResolvedValue(undefined),
      applyDiscovery: vi.fn().mockReturnValue(of({ success: true })),
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
      addGame: vi.fn().mockReturnValue(of({ success: true })),
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

  it('should refresh discovery on init', () => {
    expect(mockCollectionService.refreshDiscovery).toHaveBeenCalled();
    expect(component.items()).toEqual(mockItems);
  });

  it('should send correct payload in applyMatch', async () => {
    const item = mockItems[0];
    const option = item.options[0];

    await component.applyMatch(item, option);

    expect(mockCollectionService.applyDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTitle: 'Space Invaders',
        currentPlatform: 'Atari 2600',
        selectedIgdbId: 'igdb-123',
        selectedName: 'Space Invaders',
      }),
    );
  });

  it('should remove item from local list after successful match', async () => {
    const item = mockItems[0];
    const option = item.options[0];

    await component.applyMatch(item, option);

    expect(component.items().length).toBe(0);
  });

  it('should alert on error during match', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCollectionService.applyDiscovery.mockReturnValue(
      throwError(() => new Error('API Error')),
    );

    await component.applyMatch(mockItems[0], mockItems[0].options[0]);

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error matching item:\nAPI Error'),
    );
    expect(component.items().length).toBe(1); // Item should remain on error
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
    await component.triggerSearch('Saros', ''); // platformIdStr is empty (All Platforms)
    expect(mockCollectionService.searchGames).toHaveBeenCalledWith('Saros', 0);
    expect(component.searchResults().length).toBe(1);
  });

  it('should defer release matches when opening ingestion modal with platform = 0', async () => {
    const game: IGDBSearchResult = {
      id: 'igdb-111',
      name: 'Saros',
      platform: 'PlayStation 5',
      image_url: null,
    };
    await component.openIngestionModal(game, ''); // platformId = 0

    expect(component.showModal()).toBe(true);
    expect(component.modalGame()).toEqual(game);
    expect(component.modalPlatformId()).toBe(0);
    expect(component.modalInitialPlatformId()).toBe(0);
    expect(mockCollectionService.getGameMatches).not.toHaveBeenCalled();
    expect(component.matchedReleases().length).toBe(0);
  });

  it('should fetch releases when selecting a platform in modal', async () => {
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
  });
});
