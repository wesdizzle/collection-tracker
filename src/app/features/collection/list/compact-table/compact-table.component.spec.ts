import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompactTableComponent } from './compact-table.component';
import {
  Game,
  Toy,
  OwnershipStatus,
  PlayStatus,
} from '../../../../core/models/collection.models';

describe('CompactTableComponent', () => {
  let component: CompactTableComponent;
  let fixture: ComponentFixture<CompactTableComponent>;

  const mockGames: Game[] = [
    {
      stable_id: 1,
      id: 'zelda-botw',
      title: 'The Legend of Zelda: Breath of the Wild',
      platform: 'Switch',
      platform_id: 1,
      region: 'USA',
      series: 'The Legend of Zelda',
      canonical_series: 'The Legend of Zelda',
      play_status: PlayStatus.Played,
      ownership_status: OwnershipStatus.Owned,
      has_case: 1,
      has_manual: 0,
      backup_status: 1,
      price_cib: 4500,
      price_loose: 3500,
      release_date: '2017-03-03',
      image_url: 'https://example.com/botw.jpg',
      discIds: ['botw-cart-1'],
      discBackups: [1],
    },
  ];

  const mockToys: Toy[] = [
    {
      stable_id: 10,
      id: 'link-archer-amiibo',
      name: 'Link (Archer) - BotW Series',
      line: 'Amiibo',
      type: 'Figure',
      series_name: 'The Legend of Zelda',
      series_line: 'Zelda',
      release_date: '2017-03-03',
      ownership_status: OwnershipStatus.Seeking,
      image_url: 'https://example.com/link-archer.png',
      region: 'USA',
      price_loose: 2200,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactTableComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CompactTableComponent);
    component = fixture.componentInstance;
  });

  describe('Games mode', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('mode', 'games');
      fixture.componentRef.setInput('games', mockGames);
      fixture.detectChanges();
    });

    it('should render table headers and game rows', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.compact-table-header')).toBeTruthy();
      expect(el.querySelector('.row-title-text')?.textContent).toContain(
        'Breath of the Wild',
      );
      expect(
        el.querySelector('.compact-table-body .col-year')?.textContent,
      ).toContain('2017');
    });

    it('should emit toggleGameStatus when game status button is clicked', () => {
      let emitted = false;
      component.toggleGameStatus.subscribe((evt) => {
        emitted = true;
        expect(evt.game.id).toBe('zelda-botw');
      });

      const btn = fixture.nativeElement.querySelector(
        '.row-status-btn',
      ) as HTMLButtonElement;
      btn.click();
      expect(emitted).toBe(true);
    });

    it('should emit toggleCase and toggleManual when completeness chips are clicked', () => {
      let caseEmitted = false;
      let manualEmitted = false;

      component.toggleCase.subscribe(() => (caseEmitted = true));
      component.toggleManual.subscribe(() => (manualEmitted = true));

      const chips = fixture.nativeElement.querySelectorAll(
        '.completeness-chip',
      ) as NodeListOf<HTMLButtonElement>;
      expect(chips.length).toBe(2);

      chips[0].click();
      expect(caseEmitted).toBe(true);

      chips[1].click();
      expect(manualEmitted).toBe(true);
    });
  });

  describe('Toys mode', () => {
    beforeEach(() => {
      fixture.componentRef.setInput('mode', 'toys');
      fixture.componentRef.setInput('toys', mockToys);
      fixture.detectChanges();
    });

    it('should render toys header and toy row', () => {
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.toys-header')).toBeTruthy();
      expect(el.querySelector('.row-title-text')?.textContent).toContain(
        'Link (Archer)',
      );
      expect(
        el.querySelector('.compact-table-body .col-toy-type')?.textContent,
      ).toContain('Figure');
      expect(el.querySelector('.valuation-badge')?.textContent).toContain(
        '$22.00',
      );
    });

    it('should emit toggleToyStatus when toy status button is clicked', () => {
      let emitted = false;
      component.toggleToyStatus.subscribe((evt) => {
        emitted = true;
        expect(evt.toy.id).toBe('link-archer-amiibo');
      });

      const btn = fixture.nativeElement.querySelector(
        '.row-status-btn',
      ) as HTMLButtonElement;
      btn.click();
      expect(emitted).toBe(true);
    });
  });
});
