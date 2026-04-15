import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CollectionLayoutComponent } from './collection-layout.component';

/**
 * UNIT TEST: CollectionLayoutComponent
 * 
 * Verifies that the primary collection layout (Discovery/Games/Figures)
 * initializes correctly with its data dependencies.
 */
describe('CollectionLayoutComponent', () => {
  let component: CollectionLayoutComponent;
  let fixture: ComponentFixture<CollectionLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        RouterTestingModule,
        CollectionLayoutComponent
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CollectionLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
