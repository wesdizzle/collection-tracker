/**
 * ITEM DETAIL COMPONENT
 *
 * An immersive, high-contrast detail view for individual games, toys, and platforms.
 * It synthesizes multiple metadata sources into a single, cohesive narrative.
 *
 * DESIGN RATIONALE:
 * - **Immersive UI**: Uses large typography, tonal surfaces, and high-quality
 *   imagery to create a premium feel.
 * - **Signal Interop**: Leverages `toSignal` to bridge between the RxJS-based
 *   ActivatedRoute and the component's reactive computed signals.
 * - **Dynamic Metadata**: Adapts the layout and metadata boxes based on the
 *   item 'type', ensuring relevance (e.g. showing 'Line' for toys vs 'Platform' for games).
 * - **Context-Aware Navigation**: The 'filterBySeries' method doesn't just
 *   navigate; it intelligently updates the collection state to apply an exact
 *   match filter, streamlining franchise exploration.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  RouterModule,
  Router,
  RouteReuseStrategy,
} from '@angular/router';
import { CollectionRouteReuseStrategy } from '../../../../core/routing/collection-route-reuse-strategy';
import { CollectionService } from '../../../../core/services/collection.service';
import {
  Game,
  Toy,
  Platform,
  PlayStatus,
  GameRelease,
  getMediaIconName,
  JournalEntry,
  STANDARD_MERCHANTS,
  formatJournalDate,
} from '../../../../core/models/collection.models';
import { combineLatest, of, Observable, firstValueFrom } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { NavigationHistoryService } from '../../../../core/services/navigation-history.service';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { IconName } from '../../../../shared/components/icon/icon.catalog';

@Component({
  selector: 'app-item-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FormsModule, RouterModule, IconComponent],
  templateUrl: './item-detail.component.html',
  styleUrls: ['./item-detail.component.css'],
})
export class ItemDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public collectionService = inject(CollectionService);
  private routeReuseStrategy = inject(RouteReuseStrategy, { optional: true });
  public navigationHistory = inject(NavigationHistoryService);
  public readonly Math = Math;
  public readonly standardMerchants = STANDARD_MERCHANTS;

  public journalRefreshTrigger = signal<number>(0);

  /** Pending game/release deletion awaiting user confirmation. */
  public pendingDelete = signal<{
    kind: 'game' | 'release';
    id: string;
    label: string;
  } | null>(null);
  public deleting = signal<boolean>(false);
  public deleteError = signal<string | null>(null);
  public isEditingJournal = signal<boolean>(false);
  public journalSaving = signal<boolean>(false);
  public journalSaveError = signal<string | null>(null);

  public journalForm: {
    datePrecision: 'exact' | 'month' | 'year' | 'unknown';
    purchaseDate: string;
    isApproximateDate: boolean;
    pricePaid: string | number;
    merchant: string;
    giftedBy: string;
    receiptUrl: string;
    notes: string;
  } = {
    datePrecision: 'exact',
    purchaseDate: '',
    isApproximateDate: false,
    pricePaid: '',
    merchant: '',
    giftedBy: '',
    receiptUrl: '',
    notes: '',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    this.route.paramMap.subscribe(() => {
      this.isEditingJournal.set(false);
      this.journalSaveError.set(null);
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
    });
  }

  onBack(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    const tab = this.type() === 'toy' ? 'toys' : 'games';
    this.navigationHistory.back(this.collectionService.getTabRoute(tab));
  }

  /** The current item type ('game', 'toy', or 'platform') derived from the route */
  public type = toSignal(
    this.route.paramMap.pipe(switchMap((p) => [p.get('type') || ''])),
    {
      initialValue: '',
    },
  );

  /** Holds any error message encountered during metadata retrieval */
  public errorMessage = signal<string | null>(null);

  private itemOverride = signal<Game | Toy | Platform | null>(null);

  /**
   * Reactive signal containing the full metadata for the current item.
   * Dynamically fetches data from the CollectionService based on the route parameters.
   */
  private fetchedItem = toSignal(
    combineLatest([
      this.route.paramMap,
      toObservable(this.collectionService.refreshTrigger),
    ]).pipe(
      switchMap(([params, _]) => {
        this.errorMessage.set(null);
        this.itemOverride.set(null);
        const type = params.get('type') || '';
        const id = params.get('id');
        if (!id) {
          this.errorMessage.set('Item identifier was not provided.');
          return of(null);
        }

        let fetch$: Observable<Game | Toy | Platform>;
        switch (type) {
          case 'game':
            fetch$ = this.collectionService.getGameById(id);
            break;
          case 'toy':
            fetch$ = this.collectionService.getToyById(id);
            break;
          case 'platform':
            fetch$ = this.collectionService.getPlatformById(Number(id));
            break;
          default:
            this.errorMessage.set(`Unknown item type: ${type}`);
            return of(null);
        }

        return fetch$.pipe(
          catchError((err) => {
            console.error(
              '[ItemDetailComponent] Failed to load item metadata:',
              err,
            );
            this.errorMessage.set(
              'Unable to retrieve item metadata. Please try again later.',
            );
            return of(null);
          }),
        );
      }),
    ),
  );

  public item = computed(() => this.itemOverride() ?? this.fetchedItem());

  /** --- Type-Safe Accessors for Computed Metadata --- */
  public game = computed(() =>
    this.type() === 'game' ? (this.item() as Game) : null,
  );
  public toy = computed(() =>
    this.type() === 'toy' ? (this.item() as Toy) : null,
  );
  public platform = computed(() =>
    this.type() === 'platform' ? (this.item() as Platform) : null,
  );

  /** The current item identifier derived from the route */
  public routeId = toSignal(
    this.route.paramMap.pipe(switchMap((p) => [p.get('id') || ''])),
    {
      initialValue: '',
    },
  );

  /**
   * Computed signal deriving the acquisition journal entry for the current game or toy
   * directly from CollectionService's already-loaded journal state.
   */
  public journalEntry = computed<JournalEntry | null>(() => {
    this.journalRefreshTrigger();
    if (!this.collectionService.canShowPersonalState()) {
      return null;
    }
    const itemType = this.type();
    if (itemType !== 'game' && itemType !== 'toy') {
      return null;
    }
    const map = this.collectionService.journalEntriesMap();
    const idFromRoute = this.routeId();
    if (itemType === 'game') {
      const g = this.game();
      const candidates = [
        g?.game_id,
        g?.id,
        g?.stable_id !== undefined ? String(g.stable_id) : null,
        idFromRoute,
      ];
      for (const candidate of candidates) {
        if (candidate) {
          const match = map.get(`game:${candidate}`);
          if (match) return match;
        }
      }
      return null;
    }
    const t = this.toy();
    const candidates = [t?.id, idFromRoute];
    for (const candidate of candidates) {
      if (candidate) {
        const match = map.get(`toy:${candidate}`);
        if (match) return match;
      }
    }
    return null;
  });

  formatAcquisitionDate(
    dateStr?: string | null,
    isApproximate?: number | boolean | null,
  ): string {
    return formatJournalDate(dateStr, isApproximate);
  }

  isApproximateEntry(entry: JournalEntry): boolean {
    if (entry.is_approximate_date) return true;
    const d = (entry.purchase_date || '').trim();
    return /^\d{4}(-\d{2})?$/.test(d);
  }

  onToggleJournalVisibility(): void {
    this.collectionService.toggleJournalVisibility();
  }

  openJournalEditor(): void {
    const entry = this.journalEntry();
    this.journalSaveError.set(null);

    if (entry) {
      const rawDate = (entry.purchase_date || '').trim();
      let precision: 'exact' | 'month' | 'year' | 'unknown';
      if (!rawDate) {
        precision = 'unknown';
      } else if (/^\d{4}$/.test(rawDate)) {
        precision = 'year';
      } else if (/^\d{4}-\d{2}$/.test(rawDate)) {
        precision = 'month';
      } else {
        precision = 'exact';
      }

      this.journalForm = {
        datePrecision: precision,
        purchaseDate: rawDate,
        isApproximateDate: Boolean(entry.is_approximate_date),
        pricePaid:
          entry.price_paid !== null && entry.price_paid !== undefined
            ? entry.price_paid
            : '',
        merchant: entry.merchant || '',
        giftedBy: entry.gifted_by || '',
        receiptUrl: entry.receipt_url || '',
        notes: entry.notes || '',
      };
    } else {
      this.journalForm = {
        datePrecision: 'exact',
        purchaseDate: '',
        isApproximateDate: false,
        pricePaid: '',
        merchant: '',
        giftedBy: '',
        receiptUrl: '',
        notes: '',
      };
    }

    this.isEditingJournal.set(true);
  }

  onDatePrecisionChange(
    precision: 'exact' | 'month' | 'year' | 'unknown',
  ): void {
    if (precision === 'unknown') {
      this.journalForm.purchaseDate = '';
      this.journalForm.isApproximateDate = false;
    } else if (precision === 'year') {
      const match = String(this.journalForm.purchaseDate || '').match(/^\d{4}/);
      this.journalForm.purchaseDate = match ? match[0] : '';
      this.journalForm.isApproximateDate = true;
    } else if (precision === 'month') {
      const match = String(this.journalForm.purchaseDate || '').match(
        /^\d{4}-\d{2}/,
      );
      this.journalForm.purchaseDate = match ? match[0] : '';
      this.journalForm.isApproximateDate = true;
    }
  }

  cancelJournalEdit(): void {
    this.isEditingJournal.set(false);
    this.journalSaveError.set(null);
  }

  onSaveJournalEntry(): void {
    const itemType = this.type();
    const currentItem = this.item();
    if ((itemType !== 'game' && itemType !== 'toy') || !currentItem) {
      return;
    }

    const canonicalItemId =
      itemType === 'game'
        ? this.game()?.game_id || currentItem.id
        : currentItem.id;

    let purchaseDate: string | null = String(
      this.journalForm.purchaseDate || '',
    ).trim();
    let isApprox = this.journalForm.isApproximateDate;

    if (this.journalForm.datePrecision === 'unknown' || !purchaseDate) {
      purchaseDate = null;
      isApprox = false;
    } else if (
      this.journalForm.datePrecision === 'year' ||
      this.journalForm.datePrecision === 'month'
    ) {
      isApprox = true;
    }

    const rawPrice = this.journalForm.pricePaid;
    let pricePaid: number | null = null;
    if (
      rawPrice !== null &&
      rawPrice !== undefined &&
      String(rawPrice).trim() !== ''
    ) {
      const parsed = Number(rawPrice);
      if (Number.isNaN(parsed) || parsed < 0) {
        this.journalSaveError.set('Price paid must be a non-negative number.');
        return;
      }
      pricePaid = Math.round(parsed * 100) / 100;
    }

    this.journalSaving.set(true);
    this.journalSaveError.set(null);

    this.collectionService
      .saveJournalEntry({
        item_type: itemType,
        item_id: String(canonicalItemId),
        purchase_date: purchaseDate,
        is_approximate_date: isApprox ? 1 : 0,
        price_paid: pricePaid,
        merchant: this.journalForm.merchant.trim() || null,
        gifted_by: this.journalForm.giftedBy.trim() || null,
        receipt_url: this.journalForm.receiptUrl.trim() || null,
        notes: this.journalForm.notes.trim() || null,
      })
      .subscribe({
        next: () => {
          this.journalSaving.set(false);
          this.isEditingJournal.set(false);
          this.journalRefreshTrigger.update((v) => v + 1);
        },
        error: (err) => {
          this.journalSaving.set(false);
          this.journalSaveError.set(
            err?.error?.error || 'Failed to save provenance record.',
          );
        },
      });
  }

  onDeleteJournalEntry(): void {
    const itemType = this.type();
    const currentItem = this.item();
    if ((itemType !== 'game' && itemType !== 'toy') || !currentItem) {
      return;
    }

    const canonicalItemId =
      itemType === 'game'
        ? this.game()?.game_id || currentItem.id
        : currentItem.id;

    this.journalSaving.set(true);
    this.journalSaveError.set(null);

    this.collectionService
      .deleteJournalEntry(itemType, String(canonicalItemId))
      .subscribe({
        next: () => {
          this.journalSaving.set(false);
          this.isEditingJournal.set(false);
          this.journalRefreshTrigger.update((v) => v + 1);
        },
        error: () => {
          this.journalSaving.set(false);
          this.journalSaveError.set('Failed to delete provenance record.');
        },
      });
  }

  /**
   * Computes parsed archival origin provenance metadata for digital extracted ROMs.
   */
  public parsedOriginMetadata = computed(() => {
    const g = this.game();
    if (!g || !g.origin_metadata) return null;
    try {
      return typeof g.origin_metadata === 'string'
        ? JSON.parse(g.origin_metadata)
        : g.origin_metadata;
    } catch {
      return { origin_channel: g.origin_metadata };
    }
  });

  /**
   * Computes a human-readable, long-form release date.
   * Handles string splitting to avoid browser-specific UTC offset bugs with Date objects.
   */
  public formattedDate = computed(() => {
    const releaseDate = this.game()?.release_date || this.toy()?.release_date;
    if (!releaseDate) return null;

    try {
      // Split YYYY-MM-DD to avoid UTC offset issues by creating the date in local time
      const parts = releaseDate.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
        const day = parseInt(parts[2]);
        const date = new Date(year, month, day);

        return new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date);
      }
      return releaseDate;
    } catch {
      return releaseDate;
    }
  });

  /**
   * Computes upcoming status, launch countdown, and boutique pre-order storefront link.
   */
  public upcomingReleaseInfo = computed(() => {
    const g = this.game();
    if (!g) return null;
    const isUpcomingDate = Boolean(
      g.release_date && new Date(g.release_date) > new Date(),
    );
    const isNotYetPhysical =
      (g.physical_status === 'not_yet_physical' ||
        g.physical_status === 'physical_pending') &&
      !this.hasPhysicalRelease(g);
    if (!isUpcomingDate && !isNotYetPhysical) return null;
    if (isNotYetPhysical && this.hasOwnedPhysical(g)) return null;

    let countdownText: string | null = null;
    let isReleased = false;

    if (g.release_date) {
      const parts = g.release_date.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const target = new Date(year, month, day);
        const now = new Date();
        const nowMidnight = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const diffMs = target.getTime() - nowMidnight.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > 1) {
          countdownText = `Releases in ${diffDays} days (${g.release_date})`;
        } else if (diffDays === 1) {
          countdownText = `Releases tomorrow (${g.release_date})`;
        } else if (diffDays === 0) {
          countdownText = 'Releases today!';
          isReleased = true;
        } else {
          countdownText = `Released on ${g.release_date}`;
          isReleased = true;
        }
      } else if (g.release_date) {
        countdownText = `Target: ${g.release_date}`;
      }
    }

    return {
      isAnnounced: isUpcomingDate,
      isPending: isNotYetPhysical,
      countdownText,
      isReleased,
      hasStoreLink: !!g.retail_url,
      storeName: g.retail_store || 'Publisher Store',
      retailUrl: g.retail_url,
      price: g.retail_price ? `$${(g.retail_price / 100).toFixed(2)}` : null,
    };
  });

  /**
   * Retrieves the launch date of the parent platform for game items.
   */
  public platformLaunchDate = computed(() => {
    const g = this.game();
    if (!g?.platform_launch_date) return 'Unknown';
    return g.platform_launch_date;
  });

  /**
   * Identifies the regional physical release edition represented by a retailer or boutique publisher.
   */
  public storeRegionLabel(store: string | null | undefined): string {
    if (!store) return 'Physical Edition';
    const s = store.toLowerCase();
    if (
      s.includes('super rare') ||
      s.includes('strictly limited') ||
      s.includes('clear river')
    ) {
      return 'European Physical Edition';
    }
    if (
      s.includes('fangamer') ||
      s.includes('limited run') ||
      s.includes('iam8bit') ||
      s.includes('nis america') ||
      s.includes('aksys') ||
      s.includes('serenity forge') ||
      s.includes('premium edition') ||
      s.includes('castlemania') ||
      s.includes('vgp') ||
      s.includes('pnp')
    ) {
      return 'USA / NA Physical Edition';
    }
    if (s.includes('best buy')) {
      return 'USA Retail Edition';
    }
    return 'Physical Edition';
  }

  /**
   * Returns true if the game is upcoming and not yet owned.
   */
  public isUpcomingRelease(game?: Game | null): boolean {
    if (!game?.release_date) return false;
    if (this.hasOwnedPhysical(game)) return false;
    return new Date(game.release_date) > new Date();
  }

  /**
   * Returns true if the game has at least one owned physical release copy.
   */
  public hasOwnedPhysical(game?: Game | null): boolean {
    if (!game) return false;
    if (game.releases && game.releases.length > 0) {
      return game.releases.some((r) => r.ownership_status === 1);
    }
    return (
      game.ownership_status === 1 &&
      game.physical_status !== 'not_yet_physical' &&
      game.physical_status !== 'digital_only'
    );
  }

  /**
   * Returns true if the game represents a known physical release (e.g. verified physical,
   * matched ROM/catalog signature, physical retail medium, or physical releases list).
   */
  public hasPhysicalRelease(game?: Game | null): boolean {
    if (!game || game.platform_id === 0) return false;
    if (
      !game.rom_name &&
      (game.physical_status === 'not_yet_physical' ||
        game.physical_status === 'physical_pending' ||
        game.physical_status === 'digital_only')
    ) {
      return false;
    }
    if (
      game.physical_status === 'verified_physical' ||
      game.physical_status === 'likely_physical'
    ) {
      return true;
    }
    if (game.release_medium === 'physical_retail') {
      return true;
    }
    if (game.rom_name) {
      return true;
    }
    if (game.releases && game.releases.length > 0) {
      return true;
    }
    return false;
  }

  /**
   * Determines if a game can be tracked for future physical release announcements.
   * Disallowed for games that already have verified physical releases or are owned.
   */
  public canWatchPhysical(game?: Game | null): boolean {
    if (!game) return false;
    if (this.hasOwnedPhysical(game)) return false;
    if (this.hasPhysicalRelease(game)) return false;
    if (
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending'
    ) {
      return false;
    }
    return (
      game.physical_status === 'digital_only' ||
      (game.platform_id === 0 && !game.rom_name)
    );
  }

  /**
   * Toggles the physical watch status ('not_yet_physical' vs 'digital_only') for games.
   */
  public toggleWatchPhysical(game: Game): void {
    if (
      !this.collectionService.canShowPersonalState() ||
      this.hasPhysicalRelease(game)
    )
      return;
    const nextStatus =
      game.physical_status === 'not_yet_physical' ||
      game.physical_status === 'physical_pending'
        ? 'digital_only'
        : 'not_yet_physical';

    this.collectionService.updatePhysicalStatus(game.id, nextStatus).subscribe({
      next: () => {
        game.physical_status = nextStatus;
        this.itemOverride.set({ ...game, physical_status: nextStatus });
        this.collectionService.patchGameOptimistic(game.id, {
          physical_status: nextStatus,
        });
      },
      error: (err) => {
        console.error('Failed to toggle physical watch status:', err);
      },
    });
  }

  /**
   * Opens the delete confirmation for an entire game.
   */
  public requestDeleteGame(game: Game): void {
    this.deleteError.set(null);
    this.pendingDelete.set({
      kind: 'game',
      id: game.game_id || game.id,
      label: game.title,
    });
  }

  /**
   * Opens the delete confirmation for a single release.
   */
  public requestDeleteRelease(release: GameRelease): void {
    this.deleteError.set(null);
    this.pendingDelete.set({
      kind: 'release',
      id: release.id,
      label: release.rom_name || release.region || release.id,
    });
  }

  public cancelDelete(): void {
    if (this.deleting()) return;
    this.pendingDelete.set(null);
    this.deleteError.set(null);
  }

  /**
   * Executes the confirmed deletion. Deleting a game returns to the list;
   * deleting a release reloads the collection so the detail view refreshes.
   */
  public async confirmDelete(): Promise<void> {
    const pd = this.pendingDelete();
    if (!pd || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      if (pd.kind === 'game') {
        await firstValueFrom(this.collectionService.deleteGame(pd.id));
        this.pendingDelete.set(null);
        this.router.navigate(['/collection', 'games']);
      } else {
        await firstValueFrom(this.collectionService.deleteRelease(pd.id));
        this.pendingDelete.set(null);
        const g = this.game();
        if (g) {
          const nextReleases = (g.releases || []).filter((r) => r.id !== pd.id);
          g.releases = nextReleases;
          this.itemOverride.set({ ...g, releases: nextReleases });
        }
      }
    } catch (err) {
      this.deleteError.set(
        err instanceof Error ? err.message : 'Deletion failed.',
      );
    } finally {
      this.deleting.set(false);
    }
  }

  /**
   * Applies an exact series filter and navigates back to the collection list.
   * This is used for franchise exploration links in the UI.
   *
   * @param series The normalized series name to filter by.
   */
  filterBySeries(series: string) {
    const tab = this.type() === 'toy' ? 'toys' : 'games';
    if (this.routeReuseStrategy instanceof CollectionRouteReuseStrategy) {
      this.routeReuseStrategy.clearRoute(tab);
    }
    const currentState = this.collectionService.getListState(tab);
    if (currentState) {
      this.collectionService.updateListState({
        ...currentState,
        filters: {
          ...currentState.filters,
          seriesOrName: series,
          seriesExact: true,
        },
        scrollX: 0,
        scrollY: 0,
      });
    } else {
      this.collectionService.updateListState({
        tab,
        filters: {
          ownership: 1,
          seriesOrName: series,
          seriesExact: true,
          line: '',
          type: '',
        },
        displayLimit: 100,
        scrollX: 0,
        scrollY: 0,
      });
    }
    this.router.navigate(this.collectionService.getTabRoute(tab));
  }

  getOwnershipStatusIconName(status: number): IconName {
    switch (status) {
      case 1:
        return 'owned';
      case 4:
        return 'seeking';
      case 2:
        return 'wishlist';
      case 3:
        return 'ordered';
      default:
        return 'unowned';
    }
  }

  getPlayStatusIconName(status: PlayStatus): IconName {
    switch (status) {
      case PlayStatus.Unplayed:
        return 'hourglass';
      case PlayStatus.Played:
        return 'gamepad';
      case PlayStatus.Playing:
        return 'play';
      case PlayStatus.Queued:
        return 'list-queued';
      case PlayStatus.Paused:
        return 'pause';
      case PlayStatus.Dropped:
        return 'stop-circle';
      default:
        return 'hourglass';
    }
  }

  getPlayStatusText(status: PlayStatus): string {
    switch (status) {
      case PlayStatus.Unplayed:
        return 'Unplayed';
      case PlayStatus.Played:
        return 'Played';
      case PlayStatus.Playing:
        return 'Playing';
      case PlayStatus.Queued:
        return 'Queued';
      case PlayStatus.Paused:
        return 'Paused';
      case PlayStatus.Dropped:
        return 'Dropped';
      default:
        return 'Unplayed';
    }
  }

  onEditOwnership(item: Game | Toy, type: 'game' | 'toy') {
    if (!this.collectionService.canShowPersonalState()) return;
    this.collectionService.showOptions(
      'Ownership Status',
      'Select the ownership status for this item:',
      [
        { value: 1, label: 'Owned' },
        { value: 4, label: 'Priority Seeking' },
        { value: 2, label: 'Seeking' },
        { value: 3, label: 'Ordered' },
        { value: 0, label: 'Unowned' },
      ],
      (value: string | number) => {
        const numVal = Number(value);
        this.collectionService
          .toggleOwnership(item.id, type, numVal)
          .subscribe(() => {
            item.ownership_status = numVal;
            this.itemOverride.set({ ...item, ownership_status: numVal });
            if (type === 'game') {
              this.collectionService.patchGameOptimistic(item.id, {
                ownership_status: numVal,
              });
            } else {
              this.collectionService.patchToyOptimistic(item.id, {
                ownership_status: numVal,
              });
            }
          });
      },
    );
  }

  onIgnoreSeries(game: Game) {
    if (
      !this.collectionService.canShowPersonalState() ||
      !game.canonical_series
    )
      return;
    const seriesName = game.canonical_series;
    this.collectionService.showOptions(
      'Ignore / Unfollow Series',
      `Stop auto-tracking future games in "${seriesName}"?`,
      [
        {
          value: 'clear',
          label: 'Ignore series & set existing Seeking games to Unowned',
        },
        {
          value: 'keep',
          label: 'Ignore series (keep existing Seeking games)',
        },
      ],
      (value: string | number) => {
        const clearExisting = String(value) === 'clear';
        this.collectionService
          .saveTrackingRule({
            rule_type: 'series',
            target_value: seriesName,
            is_ignored: true,
            clear_existing_seeking: clearExisting,
          })
          .subscribe(() => {
            if (clearExisting && game.ownership_status === 2) {
              game.ownership_status = 0;
              this.itemOverride.set({ ...game, ownership_status: 0 });
              this.collectionService.patchGameOptimistic(game.id, {
                ownership_status: 0,
              });
            }
            void this.collectionService.refreshAll();
          });
      },
    );
  }

  onEditPlayed(game: Game) {
    if (!this.collectionService.canShowPersonalState()) return;
    this.collectionService.showOptions(
      'Play Status',
      'Select the play status for this game:',
      [
        { value: PlayStatus.Played, label: 'Played' },
        { value: PlayStatus.Playing, label: 'Playing' },
        { value: PlayStatus.Queued, label: 'Queued' },
        { value: PlayStatus.Paused, label: 'Paused' },
        { value: PlayStatus.Dropped, label: 'Dropped' },
        { value: PlayStatus.Unplayed, label: 'Unplayed' },
      ],
      (value: string | number) => {
        const playVal = Number(value) as PlayStatus;
        this.collectionService
          .updatePlayStatus(game.id, playVal)
          .subscribe(() => {
            game.play_status = playVal;
            this.itemOverride.set({ ...game, play_status: playVal });
            this.collectionService.patchGameOptimistic(game.id, {
              play_status: playVal,
            });
          });
      },
    );
  }

  onEditBackedUp(game: Game) {
    if (!this.collectionService.canShowPersonalState()) return;
    this.collectionService.showOptions(
      'Backup Status',
      'Select the backup status for this game:',
      [
        { value: 1, label: 'Backed Up' },
        { value: 0, label: 'No Backup' },
      ],
      (value: string | number) => {
        const backupVal = Number(value);
        this.collectionService
          .updateBackupStatus(game.id, backupVal)
          .subscribe(() => {
            game.backup_status = backupVal;
            this.itemOverride.set({ ...game, backup_status: backupVal });
            this.collectionService.patchGameOptimistic(game.id, {
              backup_status: backupVal,
            });
          });
      },
    );
  }

  getMediaIcon(
    platform: string | null | undefined,
    backedUp: boolean | number,
  ): IconName {
    return getMediaIconName(platform, backedUp);
  }

  getReleasesSectionLabel(game: Game): string {
    const isDisc =
      this.getMediaIcon(game.display_name || game.platform, 1) === 'disc';
    if (game.releases && game.releases.length > 1) {
      return isDisc
        ? 'Physical Discs (Multi-Disc Set)'
        : 'Physical Releases & Revisions';
    }
    return isDisc ? 'Physical Disc Release' : 'Physical Cartridge Release';
  }

  onToggleDiscBackup(release: GameRelease) {
    if (!this.collectionService.canShowPersonalState()) return;
    this.collectionService.showOptions(
      'Backup Status',
      'Select the backup status for this disc:',
      [
        { value: 1, label: 'Backed Up' },
        { value: 0, label: 'No Backup' },
      ],
      (value: string | number) => {
        const backupVal = Number(value);
        this.collectionService
          .updateBackupStatus(release.id, backupVal)
          .subscribe(() => {
            release.backup_status = backupVal;
            const g = this.game();
            if (g && g.releases) {
              const targetRel = g.releases.find((r) => r.id === release.id);
              if (targetRel) targetRel.backup_status = backupVal;
              const nextReleases = g.releases.map((r) =>
                r.id === release.id ? { ...r, backup_status: backupVal } : r,
              );
              const nextBackupStatus = nextReleases.every(
                (r) => r.backup_status === 1,
              )
                ? 1
                : 0;
              g.backup_status = nextBackupStatus;
              this.itemOverride.set({
                ...g,
                releases: nextReleases,
                backup_status: nextBackupStatus,
              });
            }
            this.collectionService.patchDiscBackupOptimistic(
              release.id,
              backupVal,
            );
          });
      },
    );
  }

  /**
   * Generates a URL to the game's page on IGDB based on its title.
   * Since IGDB doesn't allow direct routing via numeric ID, we construct a slug
   * from the game's title (e.g., "The Legend of Zelda" -> "the-legend-of-zelda").
   *
   * @param game The game object.
   * @returns The fully qualified IGDB URL string.
   */
  getIgdbUrl(game: Game): string {
    // Standard IGDB slug generation pattern:
    // 1. Lowercase the title.
    // 2. Replace accented characters with standard equivalents.
    // 3. Remove non-alphanumeric/non-space characters.
    // 4. Replace spaces/consecutive spaces with a single hyphen.
    // 5. Trim leading/trailing hyphens.
    const slug = game.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .replace(/[^a-z0-9\s-]/g, '') // remove special characters
      .replace(/\s+/g, '-') // replace spaces with hyphens
      .replace(/-+/g, '-') // collapse multiple hyphens
      .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens

    return `https://www.igdb.com/games/${slug}`;
  }

  /**
   * Computes the primary external source reference URL and human-friendly label for a toy.
   *
   * @param toy The toy object.
   * @returns An object with the URL and label, or null if no source is available.
   */
  getToySource(toy: Toy): { url: string; label: string } | null {
    if (toy.line === 'Skylanders' && toy.scl_url) {
      return { url: toy.scl_url, label: 'SCL Character Page' };
    }
    if (toy.line === 'amiibo' && toy.amiibo_id) {
      return {
        url: `https://amiiboapi.org/api/amiibo/?id=${toy.amiibo_id}`,
        label: 'AmiiboAPI',
      };
    }
    if (toy.line === 'Starlink') {
      return {
        url: this.getStarlinkWikiUrl(toy.name),
        label: 'Starlink Wiki',
      };
    }
    if (toy.scl_url) {
      return { url: toy.scl_url, label: 'SCL Character Page' };
    }
    return null;
  }

  /**
   * Generates a canonical Fandom Wiki URL for a Starlink toy.
   *
   * @param toyName The name of the Starlink toy.
   * @returns The fully-qualified Fandom Wiki page URL.
   */
  getStarlinkWikiUrl(toyName: string): string {
    const name = toyName.trim().replace(/\//g, ' ');
    const words = name.split(/\s+/).map((w) => {
      const lw = w.toLowerCase();
      if (lw === 'da' || lw === 'de') return lw;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
    let formatted = words.join('_');
    if (
      formatted.toLowerCase().includes('karl_zeon') ||
      formatted.toLowerCase().includes('kharl_zeon')
    ) {
      formatted = 'Kharl_Zeon';
    } else if (formatted.toLowerCase().includes('chase_da_silva')) {
      formatted = 'Calisto_Chase_Da_Silva';
    } else if (name.match(/\bMk\.?\s*2\b/i)) {
      const cleanBase = formatted.replace(/_Mk\.?\s*2\b/i, '');
      formatted = cleanBase + '_Mk._2';
    }
    return `https://starlink.fandom.com/wiki/${encodeURIComponent(formatted)}`;
  }

  /**
   * Constructs a pre-filtered clean eBay search URL.
   * Focuses on physical video games category (_sacat=139973) and collector conditions.
   */
  getSmartEbayUrl(
    game: Game,
    condition: 'cib' | 'loose' | 'all' = 'cib',
  ): string {
    const platformName = game.display_name || game.platform || '';
    let query = `${game.title} ${platformName}`;
    if (condition === 'cib') {
      query += ' cib complete';
    } else if (condition === 'loose') {
      query += ' authentic';
    }
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=139973`;
  }

  /**
   * Constructs a direct search link to Deku Deals.
   */
  getDekuDealsUrl(game: Game): string {
    return `https://www.dekudeals.com/search?q=${encodeURIComponent(game.title)}`;
  }

  /**
   * Returns the direct Best Buy product link if known, otherwise generates a targeted search query.
   */
  getBestBuyUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'Best Buy') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(game.title + ' ' + platformName)}`;
  }

  /**
   * Returns the direct VGP product link if matched, otherwise generates a targeted search query.
   */
  getVgpUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'VGP') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://videogamesplus.ca/search?q=${encodeURIComponent(game.title + ' ' + platformName)}`;
  }

  /**
   * Returns the direct PNP Games product link if matched, otherwise generates a targeted search query.
   */
  getPnpUrl(game: Game): string {
    if (game.retail_url && game.retail_store === 'PNP Games') {
      return game.retail_url;
    }
    const platformName = game.display_name || game.platform || '';
    return `https://pnpgamesonline.com/?s=${encodeURIComponent(game.title + ' ' + platformName)}&post_type=product`;
  }

  /**
   * Constructs a pre-filtered clean eBay search URL for a toy/figure.
   */
  getSmartEbayToyUrl(
    toy: Toy,
    condition: 'all' | 'loose' | 'new' = 'all',
  ): string {
    let query = `${toy.name} ${toy.line || ''}`;
    if (condition === 'new') {
      query += ' nib sealed';
    } else if (condition === 'loose') {
      query += ' loose';
    }
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query.trim())}`;
  }

  getBestBuyToyUrl(toy: Toy): string {
    if (toy.retail_url && toy.retail_store === 'Best Buy') {
      return toy.retail_url;
    }
    const query = `${toy.name} ${toy.line || ''}`.trim();
    return `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`;
  }

  getVgpToyUrl(toy: Toy): string {
    if (toy.retail_url && toy.retail_store === 'VGP') {
      return toy.retail_url;
    }
    const query = `${toy.name} ${toy.line || ''}`.trim();
    return `https://videogamesplus.ca/search?q=${encodeURIComponent(query)}`;
  }

  getPnpToyUrl(toy: Toy): string {
    if (toy.retail_url && toy.retail_store === 'PNP Games') {
      return toy.retail_url;
    }
    const query = `${toy.name} ${toy.line || ''}`.trim();
    return `https://pnpgamesonline.com/?s=${encodeURIComponent(query)}&post_type=product`;
  }
}
