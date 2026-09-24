import '../../../../../test-setup';
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CollectionFiltersComponent } from './collection-filters.component';
import { FilterState } from '../../../../core/models/collection.models';

/**
 * UNIT TEST: CollectionFiltersComponent
 *
 * Verifies that the filtering UI initializes correctly and can
 * communicate with the collection data layer.
 * Updated for Angular 21 and Vitest.
 */
describe('CollectionFiltersComponent', () => {
  let component: CollectionFiltersComponent;
  let fixture: ComponentFixture<CollectionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionFiltersComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionFiltersComponent);
    component = fixture.componentInstance;

    // Satisfy required high-performance signal inputs before initialization
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.componentRef.setInput('filters', { ownership: 'all' });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display "Type" label for toys tab', () => {
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector(
      'label[title*="Form factor"]',
    );
    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Type');
  });

  it('should clear regions when clearRegions is called', () => {
    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      regions: ['US', 'JP'],
    });
    fixture.detectChanges();

    let emittedFilters: FilterState | null = null;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.clearRegions();
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.regions).toEqual([]);
  });

  it('should render physical verified filter on games tab and emit correct values on change', () => {
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-physical-verified',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();

    let emittedFilters: FilterState | null = null;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.onPartialChange('physical_verified', 1);
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.physical_verified).toBe(1);

    component.onPartialChange('physical_verified', 0);
    expect(emittedFilters!.physical_verified).toBe(0);

    component.onPartialChange('physical_verified', 'all');
    expect(emittedFilters!.physical_verified).toBe('all');
  });

  it('should render media type filter on games tab and emit correct values on change', () => {
    fixture.componentRef.setInput('currentTab', 'games');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-media-type',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();

    let emittedFilters: FilterState | null = null;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.onPartialChange('media_type', 'all');
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.media_type).toBe('all');

    component.onPartialChange('media_type', 'digital_extracted');
    expect(emittedFilters!.media_type).toBe('digital_extracted');
  });

  it('should not render physical verified filter on toys tab', () => {
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-physical-verified',
    );
    expect(select).toBeNull();
  });

  it('should render total value in count badge when totalValue > 0', () => {
    fixture.componentRef.setInput('resultCount', 42);
    fixture.componentRef.setInput('totalValue', 123450); // $1,234.50
    fixture.detectChanges();

    const countBadge = fixture.nativeElement.querySelector('.count-badge');
    expect(countBadge).toBeTruthy();
    expect(countBadge.textContent).toContain('42 items');
    expect(countBadge.textContent).toContain('$1,234.50');
  });

  it('should only show item count when totalValue is 0', () => {
    fixture.componentRef.setInput('resultCount', 10);
    fixture.componentRef.setInput('totalValue', 0);
    fixture.detectChanges();

    const countBadge = fixture.nativeElement.querySelector('.count-badge');
    expect(countBadge).toBeTruthy();
    expect(countBadge.textContent.trim()).toBe('10 items');
  });

  it('should toggle deals_only and emit filter change when toggleDealsOnly is called', () => {
    let emittedFilters: FilterState | undefined;
    component.filtersChange.subscribe((f) => {
      emittedFilters = f;
    });

    component.toggleDealsOnly();
    expect(emittedFilters).toBeTruthy();
    expect(emittedFilters!.deals_only).toBe(true);

    fixture.componentRef.setInput('filters', {
      ownership: 'all',
      deals_only: true,
    });
    component.toggleDealsOnly();
    expect(emittedFilters!.deals_only).toBe(false);
  });
});
