import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
  let service: DialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DialogService);
  });

  it('starts hidden with default confirm state', () => {
    expect(service.dialogState()).toEqual({
      visible: false,
      type: 'confirm',
      title: '',
      message: '',
    });
  });

  it('opens confirmation dialog and closes without losing title/type', () => {
    const onConfirm = vi.fn();
    service.showConfirmation('Delete Game', 'Are you sure?', onConfirm);

    expect(service.dialogState().visible).toBe(true);
    expect(service.dialogState().type).toBe('confirm');
    expect(service.dialogState().title).toBe('Delete Game');
    expect(service.dialogState().message).toBe('Are you sure?');

    service.dialogState().onConfirm?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    service.closeDialog();
    expect(service.dialogState().visible).toBe(false);
    expect(service.dialogState().title).toBe('Delete Game');
  });

  it('opens input dialog and invokes callback only when value is defined', () => {
    const onConfirm = vi.fn();
    service.showInput('Set Count', 'Enter quantity', 2, onConfirm);

    expect(service.dialogState().visible).toBe(true);
    expect(service.dialogState().type).toBe('input');
    expect(service.dialogState().inputValue).toBe(2);

    service.dialogState().onConfirm?.(undefined);
    expect(onConfirm).not.toHaveBeenCalled();

    service.dialogState().onConfirm?.(5);
    expect(onConfirm).toHaveBeenCalledWith(5);
  });

  it('opens options dialog and passes selected value on confirm', () => {
    const onConfirm = vi.fn();
    const options = [
      { label: 'CIB', value: 'cib' },
      { label: 'Loose', value: 'loose' },
    ];
    service.showOptions(
      'Select Condition',
      'Choose condition',
      options,
      onConfirm,
    );

    expect(service.dialogState().visible).toBe(true);
    expect(service.dialogState().type).toBe('options');
    expect(service.dialogState().options).toEqual(options);

    service.dialogState().onConfirm?.(undefined);
    expect(onConfirm).not.toHaveBeenCalled();

    service.dialogState().onConfirm?.('cib');
    expect(onConfirm).toHaveBeenCalledWith('cib');
  });
});
