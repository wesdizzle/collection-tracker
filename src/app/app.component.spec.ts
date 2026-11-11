import '../test-setup';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent } from './app.component';
import { ConfirmationDialogComponent } from './shared/components/confirmation-dialog/confirmation-dialog.component';

/**
 * UNIT TEST: AppComponent
 *
 * Verifies that the root application shell boots correctly
 * and provides the necessary router-outlet for feature navigation.
 * Updated for Angular 21 and Vitest.
 */
describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'tracker' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    expect(app.title).toEqual('tracker');
  });

  it('promotes ConfirmationDialogComponent to Top Layer via showModal() on mount', () => {
    const fixture = TestBed.createComponent(ConfirmationDialogComponent);
    const dialogEl = fixture.nativeElement.querySelector(
      'dialog.dialog-overlay',
    ) as HTMLDialogElement;
    expect(dialogEl.hasAttribute('open')).toBe(false);

    const showModalSpy = vi.fn(() => {
      dialogEl.setAttribute('open', '');
    });
    dialogEl.showModal = showModalSpy;

    fixture.detectChanges();
    expect(showModalSpy).toHaveBeenCalledTimes(1);
    expect(dialogEl.hasAttribute('open')).toBe(true);
  });
});
