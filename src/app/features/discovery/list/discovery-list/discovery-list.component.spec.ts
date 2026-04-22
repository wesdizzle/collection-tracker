import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoveryListComponent } from './discovery-list.component';
import { CollectionService } from '../../../../core/services/collection.service';
import { of } from 'rxjs';
import { signal, WritableSignal } from '@angular/core';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { DiscoveryItem, DiscoveryOption, DiscoveryPayload } from '../../../../core/models/collection.models';

describe('DiscoveryListComponent', () => {
  let component: DiscoveryListComponent;
  let fixture: ComponentFixture<DiscoveryListComponent>;
  let mockCollectionService: {
    loading: WritableSignal<boolean>;
    discoveryItems: WritableSignal<DiscoveryItem[]>;
    refreshDiscovery: Mock;
    applyDiscovery: Mock;
  };

  beforeEach(async () => {
    mockCollectionService = {
      loading: signal(false),
      discoveryItems: signal([]),
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should send selectedPlatform in applyMatch payload', async () => {
    const item = {
      title: 'Space Invaders',
      platform: 'Atari 2600',
      options: [
        { id: 'igdb-123', name: 'Space Invaders', platform: 'Nintendo Entertainment System', image_url: null, summary: null }
      ]
    };
    const option = item.options[0];

    await component.applyMatch(item as DiscoveryItem, option as DiscoveryOption);

    expect(mockCollectionService.applyDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      currentTitle: 'Space Invaders',
      currentPlatform: 'Atari 2600',
      selectedPlatform: 'Nintendo Entertainment System'
    } as DiscoveryPayload));
  });
});
