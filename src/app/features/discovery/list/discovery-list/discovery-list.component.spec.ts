import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoveryListComponent } from './discovery-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { of, throwError } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { DiscoveryItem } from '../../../../core/models/collection.models';

/**
 * UNIT TEST: DiscoveryListComponent
 * 
 * Verifies the discovery reconciliation workflow, ensuring that matches are 
 * applied correctly and that the local UI state stays in sync with successful matches.
 */
describe('DiscoveryListComponent', () => {
  let component: DiscoveryListComponent;
  let fixture: ComponentFixture<DiscoveryListComponent>;
  let mockCollectionService: {
    loading: WritableSignal<boolean>;
    discoveryItems: WritableSignal<DiscoveryItem[]>;
    refreshDiscovery: Mock;
    applyDiscovery: Mock;
  };

  const mockItems: DiscoveryItem[] = [
    {
      title: 'Space Invaders',
      platform: 'Atari 2600',
      options: [
        { id: 'igdb-123', name: 'Space Invaders', platform: 'NES', image_url: null, summary: null }
      ]
    }
  ];

  beforeEach(async () => {
    mockCollectionService = {
      loading: signal(false),
      discoveryItems: signal(mockItems),
      refreshDiscovery: vi.fn().mockResolvedValue(undefined),
      applyDiscovery: vi.fn().mockReturnValue(of({ success: true }))
    };

    await TestBed.configureTestingModule({
      imports: [DiscoveryListComponent],
      providers: [
        { provide: CollectionService, useValue: mockCollectionService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DiscoveryListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should refresh discovery on init', () => {
    expect(mockCollectionService.refreshDiscovery).toHaveBeenCalled();
    expect(component.items()).toEqual(mockItems);
  });

  it('should send correct payload in applyMatch', async () => {
    const item = mockItems[0];
    const option = item.options[0];

    await component.applyMatch(item, option);

    expect(mockCollectionService.applyDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      currentTitle: 'Space Invaders',
      currentPlatform: 'Atari 2600',
      selectedIgdbId: 'igdb-123',
      selectedName: 'Space Invaders'
    }));
  });

  it('should remove item from local list after successful match', async () => {
    const item = mockItems[0];
    const option = item.options[0];

    await component.applyMatch(item, option);

    expect(component.items().length).toBe(0);
  });

  it('should alert on error during match', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockCollectionService.applyDiscovery.mockReturnValue(throwError(() => new Error('API Error')));
    
    await component.applyMatch(mockItems[0], mockItems[0].options[0]);

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Error matching: API Error'));
    expect(component.items().length).toBe(1); // Item should remain on error
  });
});
