import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserVersionManagerClipboard,
  createDefaultVersionManagerDependencies,
  createFakeVersionManagerPort,
  defaultVersionManagerDependencies,
} from '../dependencies.js';
import type { VersionRecord } from '../types.js';

const FILE_REF = { scopeId: 'proj-1', name: 'index.html' };

function version(overrides: Partial<VersionRecord> & { id: string; version: number }): VersionRecord {
  return { createdAt: 0, current: false, source: 'ai', ...overrides };
}

describe('createFakeVersionManagerPort', () => {
  it('returns an empty list when unseeded', async () => {
    const port = createFakeVersionManagerPort();
    await expect(port.listVersions(FILE_REF)).resolves.toEqual([]);
  });

  it('lists versions seeded for a matching scopeId+name', async () => {
    const seeded = version({ id: 'v1', version: 1 });
    const port = createFakeVersionManagerPort(new Map([['proj-1:index.html', [seeded]]]));
    await expect(port.listVersions(FILE_REF)).resolves.toEqual([seeded]);
  });

  it('does not leak versions seeded under a different key', async () => {
    const seeded = version({ id: 'v1', version: 1 });
    const port = createFakeVersionManagerPort(new Map([['other-proj:index.html', [seeded]]]));
    await expect(port.listVersions(FILE_REF)).resolves.toEqual([]);
  });

  it('fetchVersionContent returns null for an unknown version', async () => {
    const port = createFakeVersionManagerPort();
    await expect(port.fetchVersionContent(FILE_REF, 'ghost')).resolves.toBeNull();
  });

  it('loads seeded content with scope isolation and a detached seed snapshot', async () => {
    const content = new Map([['proj-1:index.html:v1', '<p>first</p>'], ['proj-1:index.html:v2', '']]);
    const port = createFakeVersionManagerPort(undefined, { content });
    content.set('proj-1:index.html:v1', 'changed later');
    await expect(port.fetchVersionContent(FILE_REF, 'v1')).resolves.toBe('<p>first</p>');
    await expect(port.fetchVersionContent(FILE_REF, 'v2')).resolves.toBe('');
    await expect(port.fetchVersionContent({ ...FILE_REF, scopeId: 'other' }, 'v1')).resolves.toBeNull();
    await expect(port.fetchVersionContent({ ...FILE_REF, name: 'other.html' }, 'v1')).resolves.toBeNull();
  });

  it('restoreVersion marks the restored version current and clears the others', async () => {
    const v1 = version({ id: 'v1', version: 1, current: true });
    const v2 = version({ id: 'v2', version: 2, current: false });
    const port = createFakeVersionManagerPort(new Map([['proj-1:index.html', [v1, v2]]]));
    const result = await port.restoreVersion(FILE_REF, v2);
    expect(result?.version).toEqual(v2);
    const list = (await port.listVersions(FILE_REF))!; // the fake never returns null
    expect(list.find((v) => v.id === 'v2')?.current).toBe(true);
    expect(list.find((v) => v.id === 'v1')?.current).toBe(false);
  });

  it('restoreVersion on an unseeded scope succeeds with an empty resulting list', async () => {
    const port = createFakeVersionManagerPort();
    const v1 = version({ id: 'v1', version: 1 });
    const result = await port.restoreVersion(FILE_REF, v1);
    expect(result?.version).toEqual(v1);
    await expect(port.listVersions(FILE_REF)).resolves.toEqual([]);
  });

  it('resolvePreviewDocument passes content through unchanged', () => {
    const port = createFakeVersionManagerPort();
    expect(port.resolvePreviewDocument(FILE_REF, '<p>hi</p>')).toBe('<p>hi</p>');
  });

  it('does not expose openPreviewInNewTab', () => {
    const port = createFakeVersionManagerPort();
    expect(port.openPreviewInNewTab).toBeUndefined();
  });
});

describe('createBrowserVersionManagerClipboard', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('copies text via the real browser clipboard API', async () => {
    const clipboard = createBrowserVersionManagerClipboard();
    await expect(clipboard.copyText('hello')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });
});

describe('createDefaultVersionManagerDependencies', () => {
  it('returns a fresh fake port + clipboard pair', () => {
    const deps = createDefaultVersionManagerDependencies();
    expect(deps.versions).toBeDefined();
    expect(deps.clipboard).toBeDefined();
  });

  it('produces independent instances on each call', () => {
    const a = createDefaultVersionManagerDependencies();
    const b = createDefaultVersionManagerDependencies();
    expect(a.versions).not.toBe(b.versions);
  });
});

describe('defaultVersionManagerDependencies', () => {
  it('is one shared module-level singleton', () => {
    expect(defaultVersionManagerDependencies.versions).toBeDefined();
    expect(defaultVersionManagerDependencies.clipboard).toBeDefined();
  });
});
