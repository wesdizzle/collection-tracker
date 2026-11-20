import '../../../../../test-setup';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscOwnershipModalComponent } from './disc-ownership-modal.component';
import {
  Game,
  OwnershipStatus,
  PlayStatus,
} from '../../../../core/models/collection.models';

describe('DiscOwnershipModalComponent', () => {
  let fixture: ComponentFixture<DiscOwnershipModalComponent>;
  let component: DiscOwnershipModalComponent;

  const mockMultiDiscGame: Game = {
    stable_id: 50,
    id: 'ff7-ps1',
    game_id: 'ff7-ps1',
    title: 'Final Fantasy VII',
    series: 'Final Fantasy',
    canonical_series: 'Final Fantasy',
    platform: 'PlayStation',
    display_name: 'PlayStation',
    platform_id: 29,
    ownership_status: OwnershipStatus.Owned,
    play_status: PlayStatus.Playing,
    has_media: 0,
    discIds: ['ff7-d1', 'ff7-d2', 'ff7-d3'],
    discLabels: ['Disc 1', 'Disc 2', 'Disc 3'],
    discMediaOwned: [1, 0, 0],
  };

  beforeEach(async () => {
    if (typeof HTMLDialogElement !== 'undefined') {
      if (!HTMLDialogElement.prototype.showModal) {
        HTMLDialogElement.prototype.showModal = function (
          this: HTMLDialogElement,
        ) {
          this.setAttribute('open', '');
        };
      }
      if (!HTMLDialogElement.prototype.close) {
        HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
          this.removeAttribute('open');
        };
      }
    }

    await TestBed.configureTestingModule({
      imports: [DiscOwnershipModalComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscOwnershipModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens when game input is provided and aligns discIds, discLabels, and discMediaOwned 1-to-1', () => {
    fixture.componentRef.setInput('game', mockMultiDiscGame);
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector(
      '[data-testid="disc-modal-count-pill"]',
    ) as HTMLElement;
    expect(pill.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '1 / 3 Discs Owned',
    );

    const row1 = fixture.nativeElement.querySelector(
      '[data-testid="disc-row-ff7-d1"]',
    ) as HTMLButtonElement;
    const row2 = fixture.nativeElement.querySelector(
      '[data-testid="disc-row-ff7-d2"]',
    ) as HTMLButtonElement;
    expect(row1.getAttribute('aria-checked')).toBe('true');
    expect(row1.textContent).toContain('Disc 1');
    expect(row1.textContent).toContain('Disc Owned');
    expect(row2.getAttribute('aria-checked')).toBe('false');
    expect(row2.textContent).toContain('Disc 2');
    expect(row2.textContent).toContain('Missing');
  });

  it('emits toggleDisc with targeted releaseId and nextValue on row click', () => {
    fixture.componentRef.setInput('game', mockMultiDiscGame);
    fixture.detectChanges();

    const emitSpy = vi.fn();
    component.toggleDisc.subscribe(emitSpy);

    const row2 = fixture.nativeElement.querySelector(
      '[data-testid="disc-row-ff7-d2"]',
    ) as HTMLButtonElement;
    row2.click();

    expect(emitSpy).toHaveBeenCalledWith({
      releaseId: 'ff7-d2',
      nextValue: 1,
    });
  });

  it('emits setAllDiscs only for discs needing change on Mark All Owned and Clear All', () => {
    fixture.componentRef.setInput('game', mockMultiDiscGame);
    fixture.detectChanges();

    const batchSpy = vi.fn();
    component.setAllDiscs.subscribe(batchSpy);

    const markAll = fixture.nativeElement.querySelector(
      '[data-testid="disc-modal-mark-all"]',
    ) as HTMLButtonElement;
    const clearAll = fixture.nativeElement.querySelector(
      '[data-testid="disc-modal-clear-all"]',
    ) as HTMLButtonElement;

    markAll.click();
    expect(batchSpy).toHaveBeenCalledWith({
      releaseIds: ['ff7-d2', 'ff7-d3'],
      nextValue: 1,
    });

    clearAll.click();
    expect(batchSpy).toHaveBeenCalledWith({
      releaseIds: ['ff7-d1'],
      nextValue: 0,
    });
  });

  it('emits closed when Esc cancel or close button is clicked', () => {
    fixture.componentRef.setInput('game', mockMultiDiscGame);
    fixture.detectChanges();

    const closeSpy = vi.fn();
    component.closed.subscribe(closeSpy);

    const closeBtn = fixture.nativeElement.querySelector(
      '[data-testid="disc-modal-close-btn"]',
    ) as HTMLButtonElement;
    closeBtn.click();
    expect(closeSpy).toHaveBeenCalled();
  });
});
