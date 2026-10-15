import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { Toy } from '../../../../core/models/collection.models';

@Component({
  selector: 'app-toy-card',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './toy-card.component.html',
  styleUrls: ['./toy-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToyCardComponent {
  toy = input.required<Toy>();

  toggleStatus = output<{ event: MouseEvent; toy: Toy }>();

  onToggleStatusClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggleStatus.emit({ event, toy: this.toy() });
  }
}
