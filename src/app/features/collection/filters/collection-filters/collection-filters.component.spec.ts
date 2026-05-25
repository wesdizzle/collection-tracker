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
});
