import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ICON_CATALOG, IconDef, IconName } from './icon.catalog';

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    @if (iconDef(); as def) {
      <svg
        xmlns="http://www.w3.org/2000/svg"
        [attr.viewBox]="def.viewBox"
        [style.width]="pixelSize()"
        [style.height]="pixelSize()"
        [class]="className()"
        [attr.aria-hidden]="ariaLabel() ? null : 'true'"
        [attr.aria-label]="ariaLabel() || null"
        [attr.role]="ariaLabel() ? 'img' : null"
        focusable="false"
        [innerHTML]="safeSvgInner()"
      ></svg>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        line-height: 0;
      }
      svg {
        display: block;
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  public readonly name = input.required<IconName>();
  public readonly size = input<number | string>(20);
  public readonly className = input<string>('');
  public readonly ariaLabel = input<string>('');

  public readonly iconDef = computed<IconDef | null>(() => {
    return ICON_CATALOG[this.name()] ?? null;
  });

  public readonly safeSvgInner = computed<SafeHtml>(() => {
    const def = this.iconDef();
    return def ? this.sanitizer.bypassSecurityTrustHtml(def.svgInner) : '';
  });

  public readonly pixelSize = computed<string>(() => {
    const s = this.size();
    return typeof s === 'number' ? `${s}px` : s;
  });
}
