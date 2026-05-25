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

  it('should not render physical verified filter on toys tab', () => {
    fixture.componentRef.setInput('currentTab', 'toys');
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      '#filter-physical-verified',
    );
    expect(select).toBeNull();
  });
});
