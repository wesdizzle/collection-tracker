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
  KitSelectComponent,
  KitSelectOption,
} from '@wesdizzle/app-kit/angular';
import { ToyLineCompletionStat } from '../../../../core/models/insights-analytics';
import {
  DecadeStat,
  PlatformCompletionStat,
  PlatformSortMode,
  PlayStatusStats,
  SeriesStat,
  formatInsightsWholeDollars,
} from '../insights-formatters';

@Component({
  selector: 'app-insights-catalog-tab',
  standalone: true,
  imports: [
    RouterModule,
    KitSectionCardComponent,
    KitSegmentedMeterComponent,
    KitSelectComponent,
  ],
  templateUrl: './insights-catalog-tab.component.html',
  styleUrl: './insights-catalog-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InsightsCatalogTabComponent {
  public readonly isPublicView = input.required<boolean>();
  public readonly gamesTabRoute = input.required<string[]>();
  public readonly toysTabRoute = input.required<string[]>();
  public readonly conditionMeterSegments =
    input.required<readonly KitMeterSegment[]>();
  public readonly cibCount = input.required<number>();
  public readonly cibPct = input.required<number>();
  public readonly boxedOnlyCount = input.required<number>();
  public readonly boxedPct = input.required<number>();
  public readonly looseCount = input.required<number>();
  public readonly loosePct = input.required<number>();
  public readonly playStatusStats = input.required<PlayStatusStats>();
  public readonly decadeDistribution = input.required<DecadeStat[]>();
  public readonly allSeriesCount = input.required<number>();
  public readonly showAllSeries = input.required<boolean>();
  public readonly topSeries = input.required<SeriesStat[]>();
  public readonly platformBrands = input.required<string[]>();
  public readonly selectedBrand = input.required<string>();
  public readonly effectivePlatformSort = input.required<PlatformSortMode>();
  public readonly platformSortOptions =
    input.required<KitSelectOption<PlatformSortMode>[]>();
  public readonly showAllCatalogPlatforms = input.required<boolean>();
  public readonly filteredPlatformStats =
    input.required<PlatformCompletionStat[]>();
  public readonly canViewMarketPrices = input.required<boolean>();
  public readonly toyLineStats = input.required<ToyLineCompletionStat[]>();
  public readonly expandedToyLines = input.required<Set<string>>();

  public readonly toggleShowAllSeries = output<void>();
  public readonly brandChange = output<string>();
  public readonly platformSortChange = output<PlatformSortMode>();
  public readonly toggleShowAllCatalogPlatforms = output<Event>();
  public readonly toggleToyLine = output<string>();

  public readonly formatWholeDollars = formatInsightsWholeDollars;

  public isToyLineExpanded(lineName: string): boolean {
    return this.expandedToyLines().has(lineName);
  }
}
