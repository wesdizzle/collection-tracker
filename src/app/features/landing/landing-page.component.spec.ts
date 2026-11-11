import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LandingPageComponent } from './landing-page.component';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach } from 'vitest';

describe('LandingPageComponent', () => {
  let component: LandingPageComponent;
  let fixture: ComponentFixture<LandingPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParams: { account: 'missing' },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and display missing account banner if query param account=missing', () => {
    expect(component).toBeTruthy();
    expect(component.accountMissing()).toBe(true);

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="account-missing-banner"]',
    );
    expect(banner).not.toBeNull();
  });

  it('should dismiss alert when dismissAlert is called', () => {
    component.dismissAlert();
    expect(component.accountMissing()).toBe(false);
  });
});
