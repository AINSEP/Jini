import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncIframeProps, type PooledIframeProps } from '../dom-sync.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncIframeProps characterization', () => {
  it('excludes pool, content, style and event props from tracked attributes', () => {
    const frame = document.createElement('iframe');
    const appliedAttributes = new Set<string>();
    const appliedStyleKeys = new Set<string>();
    const onLoad = vi.fn();
    const onError = vi.fn();

    syncIframeProps(frame, {
      cacheKey: 'preview',
      src: 'about:blank',
      style: { width: 12 },
      children: 'ignored child',
      dangerouslySetInnerHTML: { __html: '<p>ignored HTML</p>' },
      onLoad,
      onError,
      title: 'Preview',
    }, appliedAttributes, appliedStyleKeys);

    expect(appliedAttributes).toEqual(new Set(['title']));
    expect(frame.getAttributeNames().sort()).toEqual(['src', 'style', 'title']);
    expect(frame.textContent).toBe('');
    expect(frame.style.width).toBe('12px');
    expect(appliedStyleKeys).toEqual(new Set(['width']));
    frame.dispatchEvent(new Event('error'));
    expect(onError).not.toHaveBeenCalled();
    frame.dispatchEvent(new Event('load'));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it.each(['on', 'onclick', 'once'])('skips the lowercase on-prefix prop %s', (name) => {
    const frame = document.createElement('iframe');
    const appliedAttributes = new Set<string>();
    const props: PooledIframeProps & Record<string, unknown> = {
      cacheKey: 'preview', src: 'about:blank', [name]: 'ignored',
    };

    syncIframeProps(frame, props, appliedAttributes, new Set());

    expect(frame.hasAttribute(name)).toBe(false);
    expect(appliedAttributes).toEqual(new Set());
    expect(frame.getAttribute('src')).toBe('about:blank');
  });

  it('keeps current attributes, removes stale security attributes and preserves untracked ones', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('title', 'old');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('allow', 'camera');
    frame.setAttribute('data-host-owned', 'keep');
    const appliedAttributes = new Set(['title', 'sandbox', 'allow']);

    syncIframeProps(frame, {
      cacheKey: 'preview', src: 'about:blank', title: 'new', 'aria-label': 'Preview',
    }, appliedAttributes, new Set());

    expect(frame.getAttribute('title')).toBe('new');
    expect(frame.getAttribute('aria-label')).toBe('Preview');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(frame.getAttribute('data-host-owned')).toBe('keep');
    expect(appliedAttributes).toEqual(new Set(['title', 'aria-label']));
  });

  it('applies sandbox, styles and the load handler before writing src exactly once', () => {
    const frame = document.createElement('iframe');
    const onLoad = vi.fn();
    const nativeSetAttribute = frame.setAttribute.bind(frame);
    const writes = vi.spyOn(frame, 'setAttribute').mockImplementation((name, value) => {
      if (name === 'src') {
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
        expect(frame.style.width).toBe('5px');
        frame.dispatchEvent(new Event('load'));
      }
      nativeSetAttribute(name, value);
    });
    const appliedAttributes = new Set<string>();

    syncIframeProps(frame, {
      cacheKey: 'preview', src: 'about:blank', sandbox: 'allow-scripts',
      style: { width: 5 }, onLoad,
    }, appliedAttributes, new Set());

    expect(writes.mock.calls.filter(([name]) => name === 'src')).toEqual([['src', 'about:blank']]);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(appliedAttributes).toEqual(new Set(['sandbox']));
  });

  it('reads the current onLoad callback and tolerates its removal before load', () => {
    const frame = document.createElement('iframe');
    const original = vi.fn();
    const replacement = vi.fn();
    const props: PooledIframeProps = { cacheKey: 'preview', src: 'about:blank', onLoad: original };
    const appliedAttributes = new Set<string>();
    syncIframeProps(frame, props, appliedAttributes, new Set());
    props.onLoad = replacement;
    const event = new Event('load');

    frame.dispatchEvent(event);

    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledWith(event);
    delete props.onLoad;
    const listener = frame.onload!;
    expect(() => listener.call(frame, new Event('load'))).not.toThrow();
    expect(replacement).toHaveBeenCalledTimes(1);

    syncIframeProps(frame, props, appliedAttributes, new Set());
    expect(frame.onload).toBeNull();
  });

  it('tracks removed false and undefined attributes until the prop is omitted', () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('hidden', '');
    frame.setAttribute('title', 'old');
    const appliedAttributes = new Set(['hidden', 'title']);
    syncIframeProps(frame, {
      cacheKey: 'preview', src: 'about:blank', hidden: false, title: undefined,
    }, appliedAttributes, new Set());

    expect(frame.hasAttribute('hidden')).toBe(false);
    expect(frame.hasAttribute('title')).toBe(false);
    expect(appliedAttributes).toEqual(new Set(['hidden', 'title']));

    syncIframeProps(frame, { cacheKey: 'preview', src: 'about:blank' }, appliedAttributes, new Set());
    expect(appliedAttributes).toEqual(new Set());
  });

  it('hyphenates referrerPolicy and allowFullScreen into ineffective HTML attributes (reported, not fixed)', () => {
    const frame = document.createElement('iframe');
    const appliedAttributes = new Set<string>();

    syncIframeProps(frame, {
      cacheKey: 'preview', src: 'about:blank', referrerPolicy: 'no-referrer', allowFullScreen: true,
    }, appliedAttributes, new Set());

    expect(frame.getAttribute('referrer-policy')).toBe('no-referrer');
    expect(frame.hasAttribute('referrerpolicy')).toBe(false);
    expect(frame.getAttribute('allow-full-screen')).toBe('');
    expect(frame.hasAttribute('allowfullscreen')).toBe(false);
    expect(appliedAttributes).toEqual(new Set(['referrer-policy', 'allow-full-screen']));
  });
});
