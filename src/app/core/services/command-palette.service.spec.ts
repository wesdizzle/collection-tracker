import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandPaletteService } from './command-palette.service';

describe('CommandPaletteService', () => {
  let service: CommandPaletteService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CommandPaletteService],
    });
    service = TestBed.inject(CommandPaletteService);
  });

  it('should initialize with isOpen = false', () => {
    expect(service.isOpen()).toBe(false);
  });

  it('should open the palette', () => {
    service.open();
    expect(service.isOpen()).toBe(true);
  });

  it('should close the palette', () => {
    service.open();
    service.close();
    expect(service.isOpen()).toBe(false);
  });

  it('should toggle the palette state', () => {
    expect(service.isOpen()).toBe(false);
    service.toggle();
    expect(service.isOpen()).toBe(true);
    service.toggle();
    expect(service.isOpen()).toBe(false);
  });
});
