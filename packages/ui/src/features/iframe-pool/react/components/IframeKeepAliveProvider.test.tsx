// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IframeKeepAliveProvider } from './IframeKeepAliveProvider.js';
import { useIframeKeepAlivePool } from '../hooks/useIframeKeepAlivePool.js';
import type { IframeKeepAlivePoolValue } from '../../types.js';

function PoolCapture({ onReady }: { onReady: (pool: IframeKeepAlivePoolValue) => void }) {
  const pool = useIframeKeepAlivePool();
  onReady(pool);
  return null;
}

function renderWithPool(maxMounted?: number) {
  let pool!: IframeKeepAlivePoolValue;
  const utils = render(
    <IframeKeepAliveProvider maxMounted={maxMounted}>
      <PoolCapture onReady={(p) => { pool = p; }} />
    </IframeKeepAliveProvider>,
  );
  return { ...utils, getPool: () => pool };
}

describe('IframeKeepAliveProvider', () => {
  it('renders a hidden parked-host div alongside children', () => {
    const { container } = renderWithPool();
    const parked = container.querySelector('div.jini-iframe-keep-alive-pool');
    expect(parked).not.toBeNull();
    expect(parked?.getAttribute('aria-hidden')).toBe('true');
  });

  it('attach() creates on first use and reuses the same element after', () => {
    const { getPool } = renderWithPool();
    const host = document.createElement('div');
    let created = 0;
    const create = () => { created++; return document.createElement('iframe'); };
    const first = getPool().attach('a', host, create);
    const second = getPool().attach('a', host, create);
    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  it('release() parks the element off the host into the pool container instead of destroying it', () => {
    const { getPool, container } = renderWithPool();
    const host = document.createElement('div');
    const el = getPool().attach('a', host, () => document.createElement('iframe'));
    act(() => getPool().release('a'));
    expect(host.contains(el)).toBe(false);
    const parked = container.querySelector('div.jini-iframe-keep-alive-pool');
    expect(parked?.contains(el)).toBe(true);
    expect(el.getAttribute('data-pool-active')).toBe('false');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('re-attaching a released key reuses the parked element (no reload)', () => {
    const { getPool } = renderWithPool();
    const host = document.createElement('div');
    let created = 0;
    const create = () => { created++; return document.createElement('iframe'); };
    const el = getPool().attach('a', host, create);
    act(() => getPool().release('a'));
    const reattached = getPool().attach('a', host, create);
    expect(reattached).toBe(el);
    expect(created).toBe(1);
    expect(host.contains(reattached)).toBe(true);
  });

  it('evicts least-recently-used parked entries once over maxMounted, never an active one', () => {
    const { getPool } = renderWithPool(1);
    const host = document.createElement('div');
    const elA = getPool().attach('a', host, () => document.createElement('iframe'));
    act(() => getPool().release('a'));
    const elB = getPool().attach('b', host, () => document.createElement('iframe'));
    // Releasing b triggers enforceLimit(): pool now has 2 entries, over the
    // limit of 1, and 'a' is the only inactive (parked) one available to evict.
    act(() => getPool().release('b'));
    expect(host.contains(elA)).toBe(false);
    expect(host.contains(elB)).toBe(false);

    // 'a' should have been evicted (destroyed), so re-attaching it creates fresh.
    let created = 0;
    getPool().attach('a', host, () => { created++; return document.createElement('iframe'); });
    expect(created).toBe(1);
  });

  it('evict() removes an entry (active or parked) immediately', () => {
    const { getPool } = renderWithPool();
    const host = document.createElement('div');
    const el = getPool().attach('a', host, () => document.createElement('iframe'));
    act(() => getPool().evict('a'));
    expect(host.contains(el)).toBe(false);
  });

  it('evict() on an unknown key is a no-op', () => {
    const { getPool } = renderWithPool();
    expect(() => act(() => getPool().evict('nope'))).not.toThrow();
  });

  it('evictMatching() defaults to parked-only entries', () => {
    const { getPool } = renderWithPool();
    const host = document.createElement('div');
    const active = getPool().attach('active', host, () => document.createElement('iframe'));
    const parked = getPool().attach('parked', host, () => document.createElement('iframe'));
    act(() => getPool().release('parked'));
    act(() => getPool().evictMatching(() => true));
    expect(host.contains(active)).toBe(true);
    expect(host.contains(parked)).toBe(false);
  });

  it('evictMatching({ includeActive: true }) also removes active entries', () => {
    const { getPool } = renderWithPool();
    const host = document.createElement('div');
    const active = getPool().attach('active', host, () => document.createElement('iframe'));
    act(() => getPool().evictMatching(() => true, { includeActive: true }));
    expect(host.contains(active)).toBe(false);
  });

  it('cleans up every entry on unmount', () => {
    let pool!: IframeKeepAlivePoolValue;
    const { unmount } = render(
      <IframeKeepAliveProvider>
        <PoolCapture onReady={(p) => { pool = p; }} />
      </IframeKeepAliveProvider>,
    );
    const host = document.createElement('div');
    const el = pool.attach('a', host, () => document.createElement('iframe'));
    unmount();
    expect(host.contains(el) || document.body.contains(el)).toBe(false);
  });
});
