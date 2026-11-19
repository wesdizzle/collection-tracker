import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  EbaySampleListing,
  EphemeralMarketPrice,
  Game,
  JournalEntry,
  Toy,
  computeItemEstimatedValueCents,
  formatPriceAge,
} from '../../../../core/models/collection.models';
import { CollectionService } from '../../../../core/services/collection.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-item-market-price',
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: './item-market-price.component.html',
  styleUrls: ['./item-market-price.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemMarketPriceComponent {
  public readonly collectionService = inject(CollectionService);

  public readonly itemType = input.required<'game' | 'toy'>();
  public readonly item = input.required<Game | Toy>();
  public readonly journalEntry = input<JournalEntry | null>(null);

  public readonly loading = signal<boolean>(false);
  public readonly notConfigured = signal<boolean>(false);
  public readonly errorMessage = signal<string | null>(null);
  public readonly showOverrideEditor = signal<boolean>(false);
  public readonly overrideDraft = signal<string>('');
  public readonly overrideSaving = signal<boolean>(false);
  public readonly overrideFeedback = signal<string | null>(null);

  public readonly canonicalItemId = computed<string>(() => {
    const cur = this.item();
    if (this.itemType() === 'game') {
      return (cur as Game).game_id || cur.id;
    }
    return cur.id;
  });

  public readonly marketPrice = computed<EphemeralMarketPrice | null>(() => {
    if (!this.collectionService.canViewMarketPrices()) return null;
    this.collectionService.marketPriceNowMs();
    const cur = this.item();
    return this.collectionService.getMarketPrice(
      this.itemType(),
      cur.id,
      this.canonicalItemId(),
    );
  });

  public readonly savedOverride = computed<string>(() => {
    const cur = this.item();
    return this.collectionService.getPriceQueryOverride(
      this.itemType(),
      cur.id,
      this.canonicalItemId(),
    );
  });

  public readonly isUnconfigured = computed<boolean>(
    () =>
      this.notConfigured() ||
      this.collectionService.marketPricingConfigured() === false,
  );

  public readonly estimatedValue = computed(() =>
    computeItemEstimatedValueCents(this.item(), this.marketPrice()),
  );

  public readonly gameCompletenessMode = computed<
    'cib' | 'boxed' | 'loose' | null
  >(() => {
    if (this.itemType() !== 'game') return null;
    const g = this.item() as Game;
    if (Number(g.ownership_status ?? 0) !== 1) return null;
    if (Boolean(g.has_case) && Boolean(g.has_manual)) return 'cib';
    if (Boolean(g.has_case) && !g.has_manual) return 'boxed';
    return 'loose';
  });

  public readonly toyIsOwned = computed<boolean>(() => {
    if (this.itemType() !== 'toy') return false;
    return Number(this.item().ownership_status ?? 0) === 1;
  });

  public readonly freshnessText = computed<string>(() => {
    const price = this.marketPrice();
    if (!price) return '';
    return formatPriceAge(
      price.fetched_at,
      price.expires_at,
      this.collectionService.marketPriceNowMs(),
    );
  });

  public readonly sampleListings = computed<EbaySampleListing[]>(() => {
    const price = this.marketPrice();
    if (!price?.sample_listings) return [];
    const combined: EbaySampleListing[] = [];
    const order =
      this.gameCompletenessMode() === 'cib'
        ? [
            ...(price.sample_listings.cib || []),
            ...(price.sample_listings.loose || []),
            ...(price.sample_listings.new || []),
          ]
        : [
            ...(price.sample_listings.loose || []),
            ...(price.sample_listings.cib || []),
            ...(price.sample_listings.new || []),
          ];
    for (const listing of order) {
      if (listing?.url && combined.length < 4) {
        combined.push(listing);
      }
    }
    return combined;
  });

  public readonly gainLossSummary = computed<{
    costBasisCents: number;
    estimatedCents: number;
    deltaCents: number;
    pct: number | null;
    tierLabel: string;
  } | null>(() => {
    const entry = this.journalEntry();
    const est = this.estimatedValue();
    if (
      !entry ||
      entry.price_paid === null ||
      entry.price_paid === undefined ||
      est.cents === null
    ) {
      return null;
    }
    const paidDollars = Number(entry.price_paid);
    if (!Number.isFinite(paidDollars)) return null;
    const costBasisCents = Math.round(paidDollars * 100);
    const deltaCents = est.cents - costBasisCents;
    const pct =
      costBasisCents > 0
        ? Math.round((deltaCents / costBasisCents) * 100)
        : null;
    return {
      costBasisCents,
      estimatedCents: est.cents,
      deltaCents,
      pct,
      tierLabel: est.tierLabel,
    };
  });

  constructor() {
    effect(() => {
      const existing = this.savedOverride();
      this.overrideDraft.set(existing);
    });
  }

  public formatCents(cents: number | null | undefined): string {
    if (cents === null || cents === undefined || !Number.isFinite(cents)) {
      return '—';
    }
    return `$${(cents / 100).toFixed(2)}`;
  }

  public formatSignedCents(cents: number): string {
    const absDollars = (Math.abs(cents) / 100).toFixed(2);
    return cents >= 0 ? `+$${absDollars}` : `-$${absDollars}`;
  }

  public async checkLivePrice(force = false): Promise<void> {
    if (this.loading() || !this.collectionService.canViewMarketPrices()) {
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);
    this.notConfigured.set(false);
    try {
      const res = await this.collectionService.checkLiveItemPrice(
        this.itemType(),
        this.canonicalItemId(),
        force,
      );
      if (res.notConfigured) {
        this.notConfigured.set(true);
      } else if (res.error) {
        this.errorMessage.set(res.error);
      }
    } finally {
      this.loading.set(false);
    }
  }

  public toggleOverrideEditor(): void {
    const next = !this.showOverrideEditor();
    this.showOverrideEditor.set(next);
    this.overrideFeedback.set(null);
    if (next) {
      this.overrideDraft.set(this.savedOverride());
    }
  }

  public async saveCustomOverride(clear = false): Promise<void> {
    if (
      this.overrideSaving() ||
      !this.collectionService.canViewMarketPrices()
    ) {
      return;
    }
    const payloadQuery = clear ? null : this.overrideDraft().trim() || null;
    if (payloadQuery && payloadQuery.length > 160) {
      this.overrideFeedback.set(
        'Custom query must be 160 characters or fewer.',
      );
      return;
    }
    this.overrideSaving.set(true);
    this.overrideFeedback.set(null);
    try {
      const res = await this.collectionService.savePriceQueryOverride(
        this.itemType(),
        this.canonicalItemId(),
        payloadQuery,
        !this.isUnconfigured(),
      );
      if (!res.success) {
        this.overrideFeedback.set(res.error || 'Failed to save custom query.');
        return;
      }
      this.overrideDraft.set(res.customQuery || '');
      if (res.priceError) {
        this.overrideFeedback.set(res.priceError);
      } else {
        this.overrideFeedback.set(
          res.customQuery
            ? 'Custom eBay query saved and refreshed.'
            : 'Custom eBay query cleared.',
        );
      }
    } finally {
      this.overrideSaving.set(false);
    }
  }
}
