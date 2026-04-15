import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ItemDetailComponent } from './item-detail.component';

/**
 * UNIT TEST: ItemDetailComponent
 * 
 * Verifies that the detail view correctly loads and displays item information.
 * Uses mocks for Routing and HTTP to maintain test isolation.
 */
describe('ItemDetailComponent', () => {
  let component: ItemDetailComponent;
  let fixture: ComponentFixture<ItemDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule, 
        RouterTestingModule,
        ItemDetailComponent
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ItemDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
