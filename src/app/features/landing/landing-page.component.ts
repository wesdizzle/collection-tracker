import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { KitLandingCardComponent } from '@wesdizzle/app-kit/angular';
import { CollectionService } from '../../core/services/collection.service';
import { BrandingService } from '../../core/services/branding.service';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [KitLandingCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kit-landing-card
      [appName]="branding.appName()"
      subtitle="Catalog, verify, and track your physical video game and amiibo library."
      [logoUrl]="branding.logoUrl()"
      [accountMissing]="accountMissing()"
      accountMissingMessage="Your identity was verified, but your collector account has not been provisioned for this instance yet."
      [loading]="collectionService.isAutoSigningIn()"
      loginUrl="/api/auth/login"
    />
  `,
})
export class LandingPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  public readonly collectionService = inject(CollectionService);
  public readonly branding = inject(BrandingService);

  public readonly accountMissing = signal<boolean>(false);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    if (qp['account'] === 'missing') {
      this.accountMissing.set(true);
    }
    if (this.collectionService.currentUser()) {
      this.router.navigate(['/collection/games'], { replaceUrl: true });
    }
  }

  public dismissAlert(): void {
    this.accountMissing.set(false);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { account: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
