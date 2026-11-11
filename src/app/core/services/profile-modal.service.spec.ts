import '../../../test-setup';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ProfileModalService } from './profile-modal.service';

describe('ProfileModalService', () => {
  let service: ProfileModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProfileModalService);
  });

  it('should initialize with isOpen = false', () => {
    expect(service.isOpen()).toBe(false);
  });

  it('should toggle isOpen on open() and close() and manage activeView', () => {
    service.open();
    expect(service.isOpen()).toBe(true);
    expect(service.activeView()).toBe('profile');

    service.setView('notifications');
    expect(service.activeView()).toBe('notifications');

    service.close();
    expect(service.isOpen()).toBe(false);
    expect(service.activeView()).toBe('profile');

    service.open('notifications');
    expect(service.isOpen()).toBe(true);
    expect(service.activeView()).toBe('notifications');
  });
});
