import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
      providers: [provideRouter([])],
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
});
