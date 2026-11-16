import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  CatalogSeedStatus,
  CronExecutionLogEntry,
} from '../../../../core/models/collection.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Displays broad catalog seeding progress, daily D1 write quota usage,
 * continuous IGDB backfill & rolling self-healing telemetry, and recent
 * cron execution logs for administrators.
 */
@Component({
  selector: 'app-pipeline-health',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './pipeline-health.component.html',
  styleUrls: ['./pipeline-health.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelineHealthComponent {
  readonly status = input<CatalogSeedStatus | null>(null);
  readonly cronLogs = input<CronExecutionLogEntry[]>([]);
  readonly cronJobFilter = input<string>('all');
  readonly loading = input<boolean>(false);
  readonly actionBusy = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly seedProgressPct = input<number>(0);
  readonly dailyBudgetPct = input<number>(0);
  readonly backfillProgressPct = input<number>(0);
  readonly rollingProgressPct = input<number>(0);

  readonly refresh = output<void>();
  readonly togglePause = output<void>();
  readonly runSeedBatch = output<void>();
  readonly runBackfillBatch = output<void>();
  readonly runRollingRefresh = output<void>();
  readonly filterChange = output<Event>();
}
