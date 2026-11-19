import {
  Component,
  ElementRef,
  ViewChild,
  computed,
  inject,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Toy,
  formatPriceAge,
  formatToyRegionBadge,
} from '../../../../core/models/collection.models';
import {
  CompactProvenanceBadge,
  findToyJournalEntry,
  formatCompactProvenanceBadge,
} from '../../../../core/models/provenance-analytics';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-toy-card',
  standalone: true,
  imports: [RouterModule, IconComponent],
  templateUrl: './toy-card.component.html',
  styleUrls: ['./toy-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToyCardComponent {
  private readonly collectionService = inject(CollectionService);

  @ViewChild('coverImg') coverImg?: ElementRef<HTMLImageElement>;

  toy = input.required<Toy>();

  toggleStatus = output<{ event: MouseEvent; toy: Toy }>();

  public readonly activeViewTransitionName = computed<string | null>(() => {
    const active = this.collectionService.activeTransitionItem();
    if (!active || active.type !== 'toy') return null;
    const t = this.toy();
    const matches =
      active.id === String(t.id) ||
      (t.stable_id !== undefined && active.id === String(t.stable_id));
    return matches ? this.getCoverViewTransitionName(t) : null;
  });

  public readonly marketValueBadge = computed<{
    text: string;
    title: string;
  } | null>(() => {
    if (!this.collectionService.canViewMarketPrices?.()) return null;
    const nowMs = this.collectionService.marketPriceNowMs?.() ?? Date.now();
    const est = this.collectionService.getEstimatedValue?.(this.toy(), 'toy');
    if (!est || est.cents === null || !est.price) return null;
    const formatted =
      est.cents >= 100
        ? `Est. $${Math.round(est.cents / 100)}`
        : `Est. $${(est.cents / 100).toFixed(2)}`;
    const age = formatPriceAge(
      est.price.fetched_at,
      est.price.expires_at,
      nowMs,
    );
    return {
      text: formatted,
      title: `eBay ${est.tierLabel} · ${age}`,
    };
  });

  public readonly provenanceBadge = computed<CompactProvenanceBadge | null>(
    () => {
      if (!this.collectionService?.canShowPersonalState?.()) return null;
      const map = this.collectionService.journalEntriesMap?.();
      if (!map || map.size === 0) return null;
      const entry = findToyJournalEntry(this.toy(), map);
      return formatCompactProvenanceBadge(entry);
    },
  );

  onCardActivate(): void {
    const t = this.toy();
    const rawId = t.id || t.stable_id;
    this.collectionService.setActiveTransitionItem('toy', rawId);
    const name = this.getCoverViewTransitionName(t);
    const imgEl = this.coverImg?.nativeElement;
    if (name && imgEl) {
      imgEl.style.setProperty('view-transition-name', name);
    }
  }

  formatRegion(region: string | null | undefined): string {
    return formatToyRegionBadge(region);
  }

  getCoverViewTransitionName(toy: Toy): string | null {
    const rawId = toy.id || toy.stable_id;
    if (!rawId) return null;
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-');
    return `catalog-media-toy-${safeId}`;
  }

  onToggleStatusClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleStatus.emit({ event, toy: this.toy() });
  }
}
