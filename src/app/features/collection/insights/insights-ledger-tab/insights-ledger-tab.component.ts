import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  KitSectionCardComponent,
  KitSelectComponent,
  KitSelectGroup,
  KitSelectOption,
} from '@wesdizzle/app-kit/angular';
import { Game, Platform, Toy } from '../../../../core/models/collection.models';
import {
  ScopedJournalSummary,
  ScopedValuationSummary,
} from '../../../../core/models/insights-analytics';
import { CollectionGrowthChartComponent } from '../collection-growth-chart/collection-growth-chart.component';
import { MarketValuationPanelComponent } from '../market-valuation-panel/market-valuation-panel.component';
import {
  buildMerchantQueryParams,
  buildProvenanceCoverageQueryParams,
  formatInsightsCents,
  formatInsightsDollars,
  formatInsightsSignedCents,
} from '../insights-formatters';

@Component({
  selector: 'app-insights-ledger-tab',
  standalone: true,
  imports: [
    RouterModule,
    KitSectionCardComponent,
    KitSelectComponent,
    CollectionGrowthChartComponent,
    MarketValuationPanelComponent,
  ],
  templateUrl: './insights-ledger-tab.component.html',
  styleUrl: './insights-ledger-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsLedgerTabComponent {
  public readonly ledgerScope = input.required<string>();
  public readonly ledgerScopeOptions =
    input.required<KitSelectOption<string>[]>();
  public readonly ledgerScopeGroups =
    input.required<KitSelectGroup<string>[]>();
  public readonly selectedLedgerPlatformId = input.required<number | null>();
  public readonly ledgerDrillRoute = input.required<string[]>();
  public readonly canViewMarketPrices = input.required<boolean>();
  public readonly ownedGames = input.required<Game[]>();
  public readonly ownedToys = input.required<Toy[]>();
  public readonly platforms = input.required<Platform[]>();
  public readonly scopedJournalSummary = input.required<ScopedJournalSummary>();
  public readonly scopedValuationSummary =
    input.required<ScopedValuationSummary>();
  public readonly showAllMerchants = input.required<boolean>();
  public readonly displayedMerchants =
    input.required<ScopedJournalSummary['allMerchants']>();

  public readonly ledgerScopeChange = output<string>();
  public readonly toggleAllMerchants = output<void>();

  public readonly formatDollars = formatInsightsDollars;
  public readonly formatCents = formatInsightsCents;
  public readonly formatSignedCents = formatInsightsSignedCents;

  public getProvenanceCoverageQueryParams(
    js: ScopedJournalSummary,
  ): Record<string, string | number> {
    return buildProvenanceCoverageQueryParams(
      js,
      this.selectedLedgerPlatformId(),
    );
  }

  public getMerchantQueryParams(
    merchantName: string,
  ): Record<string, string | number> {
    return buildMerchantQueryParams(
      merchantName,
      this.selectedLedgerPlatformId(),
    );
  }
}
