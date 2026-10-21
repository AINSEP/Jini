import { describe, expect, it, vi } from 'vitest';
import {
  parkIframeElement,
  propNameToAttributeName,
  setAttribute,
  setForwardedRef,
  syncIframeProps,
  syncStyle,
} from './dom-sync.js';

describe('propNameToAttributeName', () => {
  it('maps React-only prop names to their HTML attribute names', () => {
    expect(propNameToAttributeName('className')).toBe('class');
    expect(propNameToAttributeName('htmlFor')).toBe('for');
    expect(propNameToAttributeName('srcDoc')).toBe('srcdoc');
    expect(propNameToAttributeName('tabIndex')).toBe('tabindex');
  });

  it('passes data-/aria- attributes through unchanged', () => {
    expect(propNameToAttributeName('data-testid')).toBe('data-testid');
    expect(propNameToAttributeName('aria-label')).toBe('aria-label');
  });

  it('kebab-cases any other camelCase prop name', () => {
    expect(propNameToAttributeName('allowFullScreen')).toBe('allowfullscreen');
    expect(propNameToAttributeName('title')).toBe('title');
  });
});

describe('setAttribute', () => {
  it('removes the attribute for null/undefined/false', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'x');
    setAttribute(frame, 'title', null);
    expect(frame.hasAttribute('title')).toBe(false);
    frame.setAttribute('title', 'x');
    setAttribute(frame, 'title', undefined);
    expect(frame.hasAttribute('title')).toBe(false);
    frame.setAttribute('title', 'x');
    setAttribute(frame, 'title', false);
    expect(frame.hasAttribute('title')).toBe(false);
  });

  it('sets an empty-string boolean attribute for true', () => {
    const frame = document.createElement('iframe');
    setAttribute(frame, 'allowfullscreen', true);
    expect(frame.getAttribute('allowfullscreen')).toBe('');
  });

  it('stringifies and sets other values, skipping a redundant write', () => {
    const frame = document.createElement('iframe');
    setAttribute(frame, 'width', 200);
    expect(frame.getAttribute('width')).toBe('200');
    const spy = vi.spyOn(frame, 'setAttribute');
    setAttribute(frame, 'width', 200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('syncStyle', () => {
  it('clears all style when style is undefined', () => {
    const frame = document.createElement('iframe');
    frame.style.setProperty('color', 'red');
    const applied = new Set(['color']);
    syncStyle(frame, undefined, applied);
    expect(frame.hasAttribute('style')).toBe(false);
    expect(applied.size).toBe(0);
  });

  it('removes previously-applied keys no longer present', () => {
    const frame = document.createElement('iframe');
    const applied = new Set(['color']);
    frame.style.setProperty('color', 'red');
    syncStyle(frame, { width: 10 }, applied);
    expect(frame.style.getPropertyValue('color')).toBe('');
    expect(applied.has('color')).toBe(false);
    expect(applied.has('width')).toBe(true);
    expect(frame.style.getPropertyValue('width')).toBe('10px');
  });

  it('appends px to a numeric length value but not to a known unitless property', () => {
    const frame = document.createElement('iframe');
    const applied = new Set<string>();
    syncStyle(frame, { width: 10, opacity: 0.5, zIndex: 3 }, applied);
    expect(frame.style.getPropertyValue('width')).toBe('10px');
    expect(frame.style.getPropertyValue('opacity')).toBe('0.5');
    expect(frame.style.getPropertyValue('z-index')).toBe('3');
  });

  it('appends px to a zero numeric value like any other length number', () => {
    const frame = document.createElement('iframe');
    const applied = new Set<string>();
    syncStyle(frame, { width: 0 }, applied);
    expect(frame.style.getPropertyValue('width')).toBe('0px');
  });

  it('clears a property whose new value is null/undefined', () => {
    const frame = document.createElement('iframe');
    const applied = new Set<string>();
    syncStyle(frame, { width: null as unknown as number }, applied);
    expect(frame.style.getPropertyValue('width')).toBe('');
  });

  it('kebab-cases camelCase style keys', () => {
    const frame = document.createElement('iframe');
    const applied = new Set<string>();
    syncStyle(frame, { backgroundColor: 'blue' }, applied);
    expect(frame.style.getPropertyValue('background-color')).toBe('blue');
  });
});

describe('syncIframeProps', () => {
  it('applies plain attributes, skips reserved/event props, and drops stale ones', () => {
    const frame = document.createElement('iframe');
    const appliedAttributes = new Set<string>();
    const appliedStyleKeys = new Set<string>();
    syncIframeProps(
      frame,
      { cacheKey: 'k', src: 'about:blank', title: 'first', style: { width: 5 } },
      appliedAttributes,
      appliedStyleKeys,
    );
    expect(frame.getAttribute('title')).toBe('first');
    expect(frame.getAttribute('src')).toBe('about:blank');
    expect(frame.style.getPropertyValue('width')).toBe('5px');

    syncIframeProps(
      frame,
      { cacheKey: 'k', src: 'about:blank' },
      appliedAttributes,
      appliedStyleKeys,
    );
    expect(frame.hasAttribute('title')).toBe(false);
  });

  it('wires onLoad through onload and clears it when omitted', () => {
    const frame = document.createElement('iframe');
    const appliedAttributes = new Set<string>();
    const appliedStyleKeys = new Set<string>();
    const onLoad = vi.fn();
    syncIframeProps(frame, { cacheKey: 'k', src: 'about:blank', onLoad }, appliedAttributes, appliedStyleKeys);
    expect(frame.onload).toBeTypeOf('function');
    (frame.onload as (e: Event) => void)(new Event('load'));
    expect(onLoad).toHaveBeenCalledTimes(1);

    syncIframeProps(frame, { cacheKey: 'k', src: 'about:blank' }, appliedAttributes, appliedStyleKeys);
    expect(frame.onload).toBeNull();
  });
});

describe('setForwardedRef', () => {
  it('calls a function ref', () => {
    const ref = vi.fn();
    const frame = document.createElement('iframe');
    setForwardedRef(ref, frame);
    expect(ref).toHaveBeenCalledWith(frame);
  });

  it('assigns an object ref', () => {
    const ref = { current: null as HTMLIFrameElement | null };
    const frame = document.createElement('iframe');
    setForwardedRef(ref, frame);
    expect(ref.current).toBe(frame);
  });

  it('is a no-op when ref is undefined', () => {
    expect(() => setForwardedRef(undefined, document.createElement('iframe'))).not.toThrow();
  });
});

describe('parkIframeElement', () => {
  it('strips interaction hooks and hides the frame from a11y/tab order', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-testid', 'x');
    frame.onload = () => {};
    parkIframeElement(frame);
    expect(frame.onload).toBeNull();
    expect(frame.hasAttribute('data-testid')).toBe(false);
    expect(frame.getAttribute('data-pool-active')).toBe('false');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.getAttribute('tabindex')).toBe('-1');
  });
});
