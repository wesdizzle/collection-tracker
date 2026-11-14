import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  Toy,
  formatToyRegionBadge,
} from '../../../../core/models/collection.models';
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
  toy = input.required<Toy>();

  toggleStatus = output<{ event: MouseEvent; toy: Toy }>();

  formatRegion(region: string | null | undefined): string {
    return formatToyRegionBadge(region);
  }

  onToggleStatusClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleStatus.emit({ event, toy: this.toy() });
  }
}
