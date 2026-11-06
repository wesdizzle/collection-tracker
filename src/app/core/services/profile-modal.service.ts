import { Injectable, signal } from '@angular/core';

export type ProfileModalView = 'profile' | 'notifications';

@Injectable({
  providedIn: 'root',
})
export class ProfileModalService {
  private _isOpen = signal(false);
  private _activeView = signal<ProfileModalView>('profile');

  public readonly isOpen = this._isOpen.asReadonly();
  public readonly activeView = this._activeView.asReadonly();

  public open(view: ProfileModalView = 'profile'): void {
    this._activeView.set(view);
    this._isOpen.set(true);
  }

  public setView(view: ProfileModalView): void {
    this._activeView.set(view);
  }

  public close(): void {
    this._isOpen.set(false);
    this._activeView.set('profile');
  }
}
