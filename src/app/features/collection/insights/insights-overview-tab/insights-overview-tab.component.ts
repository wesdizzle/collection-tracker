import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  KitMeterSegment,
  KitSectionCardComponent,
  KitSegmentedMeterComponent,
} from '@wesdizzle/app-kit/angular';
import {
  ScopedJournalSummary,
  ScopedValuationSummary,
} from '../../../../core/models/insights-analytics';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import {
  InsightsSubTab,
  PlatformCompletionStat,
  PlayStatusStats,
  formatInsightsCents,
  formatInsightsDollars,
  formatInsightsSignedCents,
} from '../insights-formatters';

@Component({
  selector: 'app-insights-overview-tab',
  standalone: true,
  imports: [
    RouterModule,
    IconComponent,
    KitSectionCardComponent,
    KitSegmentedMeterComponent,
  ],
  templateUrl: './insights-overview-tab.component.html',
  styleUrl: './insights-overview-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsOverviewTabComponent {
  public readonly ownedGamesCount = input.required<number>();
  public readonly ownedToysCount = input.required<number>();
  public readonly totalSeekingCount = input.required<number>();
  public readonly canShowProvenance = input.required<boolean>();
  public readonly canViewMarketPrices = input.required<boolean>();
  public readonly allOwnedValuationSummary =
    input.required<ScopedValuationSummary>();
  public readonly allOwnedJournalSummary =
    input.required<ScopedJournalSummary>();
  public readonly playStatusStats = input.required<PlayStatusStats>();
  public readonly animatedTotalOwnedCount = input.required<number>();
  public readonly animatedPlayedPct = input.required<number>();
  public readonly animatedBackupRatePct = input.required<number>();
  public readonly animatedCibPct = input.required<number>();
  public readonly backedUpCount = input.required<number>();
  public readonly physicalOwnedCount = input.required<number>();
  public readonly backupRatePct = input.required<number>();
  public readonly cibCount = input.required<number>();
  public readonly boxedOnlyCount = input.required<number>();
  public readonly looseCount = input.required<number>();
  public readonly cibPct = input.required<number>();
  public readonly boxedPct = input.required<number>();
  public readonly loosePct = input.required<number>();
  public readonly hasAuditActions = input.required<boolean>();
  public readonly missingBackupsCount = input.required<number>();
  public readonly unpricedOwnedCount = input.required<number>();
  public readonly topOwnedPlatformsPreview =
    input.required<PlatformCompletionStat[]>();
  public readonly conditionMeterSegments =
    input.required<readonly KitMeterSegment[]>();

  public readonly selectTab = output<InsightsSubTab>();

  public readonly formatDollars = formatInsightsDollars;
  public readonly formatCents = formatInsightsCents;
  public readonly formatSignedCents = formatInsightsSignedCents;
}
