import { Injectable, signal } from '@angular/core';

export interface DialogState {
  visible: boolean;
  type: 'confirm' | 'input' | 'options';
  title: string;
  message: string;
  inputValue?: string | number;
  options?: { label: string; value: string | number }[];
  onConfirm?: (value?: string | number) => void;
}

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private readonly _dialogState = signal<DialogState>({
    visible: false,
    type: 'confirm',
    title: '',
    message: '',
  });

  public readonly dialogState = this._dialogState.asReadonly();

  public showConfirmation(
    title: string,
    message: string,
    onConfirm: () => void,
  ): void {
    this._dialogState.set({
      visible: true,
      type: 'confirm',
      title,
      message,
      onConfirm,
    });
  }

  public showInput(
    title: string,
    message: string,
    initialValue: string | number,
    onConfirm: (value: string | number) => void,
  ): void {
    this._dialogState.set({
      visible: true,
      type: 'input',
      title,
      message,
      inputValue: initialValue,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  public showOptions(
    title: string,
    message: string,
    options: { label: string; value: string | number }[],
    onConfirm: (value: string | number) => void,
  ): void {
    this._dialogState.set({
      visible: true,
      type: 'options',
      title,
      message,
      options,
      onConfirm: (val) => {
        if (val !== undefined) onConfirm(val);
      },
    });
  }

  public closeDialog(): void {
    this._dialogState.set({ ...this._dialogState(), visible: false });
  }
}
