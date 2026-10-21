import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('resource source selection pins', () => {
  let teardown: () => void;

  beforeEach(() => {
    vi.resetModules();
    teardown = () => undefined;
  });

  afterEach(() => {
    teardown();
    vi.unstubAllGlobals();
  });

  it.each(['link', 'script', 'img', 'iframe', 'source', 'track', 'audio', 'video'] as const)(
    'reads the resolved URL property for %s and preserves the complete event', async (tag) => {
      const { installResourceErrorObserver } = await import('../resource-error.js');
      const reporter = vi.fn();
      teardown = installResourceErrorObserver({ reporter });
      const target = document.createElement(tag);
      const property = tag === 'link' ? 'href' : 'src';
      target.setAttribute(property, 'https://cdn.test/missing');
      target.setAttribute('async', 'false');
      target.setAttribute('defer', '');
      target.setAttribute('crossorigin', 'anonymous');
      // Pin the target without triggering an actual resource fetch.
      const event = new Event('error');
      Object.defineProperty(event, 'target', { value: target });
      window.dispatchEvent(event);
      expect(reporter.mock.calls).toEqual([['client_resource_error', {
        tag, async_attr: true, defer_attr: true, crossorigin: 'anonymous',
        url: 'https://cdn.test/missing',
      }]]);
    },
  );

  it.each([
    ['raw src', 'relative.png', 'fallback.png', '/relative.png'],
    ['raw href', null, 'fallback.png', '/fallback.png'],
    ['missing attributes', null, null, null],
    ['empty src blocks href fallback', '', 'fallback.png', null],
    ['empty href', null, '', null],
    ['whitespace src', ' ', null, null],
  ])('preserves fallback selection: %s', async (_name, src, href, expected) => {
    const { installResourceErrorObserver } = await import('../resource-error.js');
    const reporter = vi.fn();
    teardown = installResourceErrorObserver({ reporter });
    // A tracked XML element is an Element without any HTML resource subclass.
    const target = document.createElementNS('urn:resource-pin', 'IMG');
    if (src !== null) target.setAttribute('src', src!);
    if (href !== null) target.setAttribute('href', href!);
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
    const calls = expected === null ? [] : [['client_resource_error', {
      tag: 'img', async_attr: false, defer_attr: false, crossorigin: null, url: expected,
    }]];
    expect(reporter.mock.calls).toEqual(calls);
  });

  it.each([undefined, null, 42, ''])('rejects an invalid resolved src: %j', async (src) => {
    const { installResourceErrorObserver } = await import('../resource-error.js');
    const reporter = vi.fn();
    teardown = installResourceErrorObserver({ reporter });
    const target = document.createElement('img');
    Object.defineProperty(target, 'src', { value: src });
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
    expect(reporter.mock.calls).toEqual([]);
  });

  it('removes URL credentials, queries and fragments from resource events', async () => {
    const { installResourceErrorObserver } = await import('../resource-error.js');
    const reporter = vi.fn();
    teardown = installResourceErrorObserver({ reporter });
    const target = document.createElement('img');
    target.src = 'https://user:password@cdn.test/a?token=secret#private';
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
    expect(reporter.mock.calls).toEqual([['client_resource_error', {
      tag: 'img', async_attr: false, defer_attr: false, crossorigin: null,
      url: 'https://cdn.test/a',
    }]]);
  });
});
