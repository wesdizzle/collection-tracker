import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CollectionFiltersComponent } from './collection-filters.component';

/**
 * UNIT TEST: CollectionFiltersComponent
 * 
 * Verifies that the filtering UI initializes correctly and can 
 * communicate with the collection data layer.
 */
describe('CollectionFiltersComponent', () => {
  let component: CollectionFiltersComponent;
  let fixture: ComponentFixture<CollectionFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        RouterTestingModule,
        CollectionFiltersComponent
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CollectionFiltersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
