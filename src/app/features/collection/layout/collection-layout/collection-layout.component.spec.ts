import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CollectionLayoutComponent } from './collection-layout.component';

describe('CollectionLayoutComponent', () => {
  let component: CollectionLayoutComponent;
  let fixture: ComponentFixture<CollectionLayoutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CollectionLayoutComponent]
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
