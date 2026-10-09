import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  let component: IconComponent;
  let fixture: ComponentFixture<IconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IconComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(IconComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render SVG for a valid icon name with custom size and class', () => {
    fixture.componentRef.setInput('name', 'coins');
    fixture.componentRef.setInput('size', 24);
    fixture.componentRef.setInput('className', 'custom-coin');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.style.width).toBe('24px');
    expect(svg.style.height).toBe('24px');
    expect(svg.classList.contains('custom-coin')).toBe(true);
    expect(svg.innerHTML).toContain('circle');
  });

  it('should support accessible labels', () => {
    fixture.componentRef.setInput('name', 'owned');
    fixture.componentRef.setInput('ariaLabel', 'Owned item');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg');
    expect(svg.getAttribute('aria-label')).toBe('Owned item');
    expect(svg.getAttribute('role')).toBe('img');
  });
});
