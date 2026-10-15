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
    price_loose: 1500,
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
    expect(el.querySelector('.valuation-badge')?.textContent).toContain(
      '$15.00',
    );
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
});
