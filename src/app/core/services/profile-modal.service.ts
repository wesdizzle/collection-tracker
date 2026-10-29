import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ProfileModalService {
  private _isOpen = signal(false);
  public readonly isOpen = this._isOpen.asReadonly();

  public open(): void {
    this._isOpen.set(true);
  }

  public close(): void {
    this._isOpen.set(false);
  }
}
