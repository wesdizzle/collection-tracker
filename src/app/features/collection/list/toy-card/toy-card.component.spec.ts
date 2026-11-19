import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionService } from '../../../../core/services/collection.service';
import { ToyCardComponent } from './toy-card.component';
import {
  Toy,
  OwnershipStatus,
} from '../../../../core/models/collection.models';

describe('ToyCardComponent', () => {
  let component: ToyCardComponent;
  let fixture: ComponentFixture<ToyCardComponent>;

  const mockToy: Toy = {
    stable_id: 101,
    id: 'mario-smash-amiibo',
    name: 'Mario - Smash Series',
    line: 'Amiibo',
    type: 'Figure',
    series_name: 'Super Smash Bros.',
    series_line: 'Smash Bros.',
    release_date: '2014-11-21',
    ownership_status: OwnershipStatus.Owned,
    image_url: 'https://example.com/mario.png',
    region: 'USA',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToyCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ToyCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('toy', mockToy);
    fixture.detectChanges();
  });

  it('should create and render toy card details', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.card-title')?.textContent).toContain(
      'Mario - Smash Series',
    );
    expect(el.querySelector('.release-year')?.textContent).toContain('Figure');
    expect(el.querySelector('.region-flag')?.textContent).toContain('USA');
  });

  it('should emit toggleStatus when status button is clicked', () => {
    let emitted = false;
    component.toggleStatus.subscribe((evt) => {
      emitted = true;
      expect(evt.toy.id).toBe('mario-smash-amiibo');
    });

    const statusBtn = fixture.nativeElement.querySelector(
      '.status-badge',
    ) as HTMLButtonElement;
    statusBtn.click();
    expect(emitted).toBe(true);
  });

  it('should render deal-sale-badge when toy is on sale and preorder-store-badge when available at regular price', () => {
    fixture.componentRef.setInput('toy', {
      ...mockToy,
      retail_on_sale: 1,
      retail_price: 1299,
      retail_regular_price: 1999,
      retail_discount_pct: 35,
      retail_store: 'VGP',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.deal-sale-badge')?.textContent).toContain(
      '35% OFF · $12.99',
    );
    expect(
      el.querySelector('.deal-strikethrough-price')?.textContent,
    ).toContain('$19.99');

    fixture.componentRef.setInput('toy', {
      ...mockToy,
      retail_on_sale: 0,
      retail_price: 2199,
      retail_store: 'PNP Games',
      retail_url: 'https://pnpgamesonline.com/mario-amiibo',
    });
    fixture.detectChanges();

    expect(el.querySelector('.deal-sale-badge')).toBeNull();
    expect(el.querySelector('.preorder-store-badge')?.textContent).toContain(
      'PNP Games',
    );
    expect(el.querySelector('.preorder-store-badge')?.textContent).toContain(
      '$21.99',
    );
  });

  it('scopes view-transition-name to the active toy card on pointerdown/activation', () => {
    const cs = TestBed.inject(CollectionService);
    cs.setActiveTransitionItem('toy', null);
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
      type: 'toy',
      id: 'mario-smash-amiibo',
    });
    expect(component.activeViewTransitionName()).toBe(
      'catalog-media-toy-mario-smash-amiibo',
    );
    expect(img.style.getPropertyValue('view-transition-name')).toBe(
      'catalog-media-toy-mario-smash-amiibo',
    );
  });

  it('always renders provenance badge when personal state is visible and journal details exist, and hides in public/unauth views', () => {
    const cs = TestBed.inject(CollectionService);
    const httpMock = TestBed.inject(HttpTestingController);

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
          id: 2,
          item_type: 'toy',
          item_id: 'mario-smash-amiibo',
          purchase_date: '2014-12-25',
          is_approximate_date: 0,
          price_paid: 0,
          merchant: null,
          gifted_by: 'Mom',
          receipt_url: null,
          notes: 'Christmas present',
        },
      ],
    });
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector(
      '[data-testid="card-provenance-badge"]',
    ) as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Dec 2014');
    expect(badge.textContent).toContain('Gift (Mom)');
    expect(badge.getAttribute('title')).toContain('Source: Gift (Mom)');

    // Public view -> strictly hidden
    cs.setPublicView(true, null);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="card-provenance-badge"]',
      ),
    ).toBeNull();

    // Unauthenticated -> strictly hidden
    cs.exitPublicView();
    cs.setAdminForTesting(false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="card-provenance-badge"]',
      ),
    ).toBeNull();
  });
});
