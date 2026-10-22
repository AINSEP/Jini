import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VersionManagerDependencies, VersionManagerPort } from '../../../ports.js';
import type { VersionManagerFileRef, VersionRecord, VersionRestoreResult } from '../../../types.js';
import { useVersionManager, useWiredVersionManager } from '../../../react/hooks/useVersionManager.js';

const FILE_REF: VersionManagerFileRef = { scopeId: 'proj-1', name: 'index.html' };

function makeVersion(overrides: Partial<VersionRecord> & { id: string; version: number }): VersionRecord {
  return { createdAt: 1000, current: false, source: 'ai', ...overrides };
}

interface PortOverrides {
  versions?: VersionRecord[] | null;
  content?: Map<string, string>;
  restoreResult?: VersionRestoreResult<VersionRecord> | null;
  openPreviewInNewTab?: VersionManagerPort<VersionRecord>['openPreviewInNewTab'];
}

function createTestPort(overrides: PortOverrides = {}): VersionManagerPort<VersionRecord> {
  const content = overrides.content ?? new Map<string, string>();
  return {
    listVersions: vi.fn(async () => (overrides.versions === undefined ? [] : overrides.versions)),
    fetchVersionContent: vi.fn(async (_fileRef, versionId) => content.get(versionId) ?? null),
    restoreVersion: vi.fn(async () => (overrides.restoreResult === undefined ? {} : overrides.restoreResult)),
    resolvePreviewDocument: vi.fn((_fileRef, versionContent) => `<doc>${versionContent}</doc>`),
    ...(overrides.openPreviewInNewTab ? { openPreviewInNewTab: overrides.openPreviewInNewTab } : {}),
  };
}

function createTestDependencies(port: VersionManagerPort<VersionRecord>): VersionManagerDependencies<VersionRecord> {
  return {
    versions: port,
    clipboard: { copyText: vi.fn(async () => true) },
  };
}

describe('useVersionManager', () => {
  it('starts loading and populates versions, selecting the current one', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1 });
    const v2 = makeVersion({ id: 'v2', version: 2, current: true });
    const port = createTestPort({ versions: [v1, v2] });
    const deps = createTestDependencies(port);

    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(result.current.selectedVersion?.id).toBe('v2');
  });

  it('sets an error when listVersions fails', async () => {
    const port = createTestPort({ versions: null });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.versions).toEqual([]);
  });

  it('seeds the current version content from currentContent with no fetch', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const port = createTestPort({ versions: [current] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>live</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.selectedContent).toBe('<p>live</p>'));
    expect(port.fetchVersionContent).not.toHaveBeenCalled();
  });

  it('fetches content on selection when not cached, tracking loadingContent', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2 body</p>']]);
    const port = createTestPort({ versions: [v1, v2], content });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.selectVersion('v2');
    });
    expect(result.current.loadingContent).toBe(true);
    await waitFor(() => expect(result.current.loadingContent).toBe(false));
    expect(result.current.selectedContent).toBe('<p>v2 body</p>');
    expect(result.current.previewDocument).toBe('<doc><p>v2 body</p></doc>');
  });

  it('sets an error and clears content when the version content fetch fails', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2 });
    const port = createTestPort({ versions: [v1, v2], content: new Map() });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));
    expect(result.current.selectedContent).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('prefetches content on hover without changing the selection', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const port = createTestPort({ versions: [v1, v2], content });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.prefetchVersion('v2');
    });
    await waitFor(() => expect(port.fetchVersionContent).toHaveBeenCalledWith(FILE_REF, 'v2'));
    expect(result.current.selectedVersion?.id).toBe('v1');

    // Selecting it afterward should now be an instant cache hit (no
    // loadingContent flip), proving the prefetch actually warmed the cache.
    act(() => {
      result.current.selectVersion('v2');
    });
    expect(result.current.loadingContent).toBe(false);
    expect(result.current.selectedContent).toBe('<p>v2</p>');
  });

  it('deduplicates concurrent prefetch + selection fetches for the same version', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const port = createTestPort({ versions: [v1, v2], content });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.prefetchVersion('v2');
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));
    expect(port.fetchVersionContent).toHaveBeenCalledTimes(1);
  });

  it('filters visibleVersions by search once past the threshold', async () => {
    const versions = Array.from({ length: 5 }, (_, i) =>
      makeVersion({ id: `v${i}`, version: i + 1, label: i === 2 ? 'special footer fix' : `change ${i}` }),
    );
    const port = createTestPort({ versions });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.showSearch).toBe(true);

    act(() => {
      result.current.setSearch('footer');
    });
    expect(result.current.visibleVersions).toHaveLength(1);
    expect(result.current.visibleVersions[0]?.label).toBe('special footer fix');
  });

  it('does not show search below the threshold', async () => {
    const versions = [makeVersion({ id: 'v1', version: 1 }), makeVersion({ id: 'v2', version: 2 })];
    const port = createTestPort({ versions });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.showSearch).toBe(false);
    expect(result.current.visibleVersions).toEqual(result.current.versions);
  });

  it('restore: calls onRestored and onRestoredCleanly on a clean success', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const older = makeVersion({ id: 'v2', version: 2 - 1 });
    const target = makeVersion({ id: 'v3', version: 2 });
    const content = new Map([['v3', '<p>v3</p>']]);
    const restoredVersion = makeVersion({ id: 'v4', version: 3, source: 'restore', restoreFromVersionId: 'v3' });
    const port = createTestPort({
      versions: [target, current, older],
      content,
      restoreResult: { version: restoredVersion },
    });
    const deps = createTestDependencies(port);
    const onRestored = vi.fn();
    const onRestoredCleanly = vi.fn();
    const { result } = renderHook(() =>
      useVersionManager(deps, {
        fileRef: FILE_REF,
        currentContent: '<p>current</p>',
        onRestored,
        onRestoredCleanly,
      }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.selectVersion('v3');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));
    expect(result.current.restoreDisabled).toBe(false);

    await act(async () => {
      await result.current.restore();
    });

    expect(port.restoreVersion).toHaveBeenCalledWith(FILE_REF, target);
    expect(onRestored).toHaveBeenCalledWith('<p>v3</p>', restoredVersion);
    expect(onRestoredCleanly).toHaveBeenCalledTimes(1);
  });

  it('restore: falls back to the restored-from version when the port omits `version` on a clean success', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const target = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const port = createTestPort({ versions: [target, current], content, restoreResult: {} });
    const deps = createTestDependencies(port);
    const onRestored = vi.fn();
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(onRestored).toHaveBeenCalledWith('<p>v2</p>', target);
  });

  it('restore: falls back to the restored-from version id when reloading after a warning with no `version` in the result', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const target = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const port = createTestPort({
      versions: [target, current],
      content,
      restoreResult: { warning: { message: 'A snapshot capture failed.' } },
    });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(port.listVersions).toHaveBeenLastCalledWith(FILE_REF);
    expect(result.current.error).toBe('A snapshot capture failed.');
  });

  it('restore: sets an error and does not call onRestoredCleanly when the port returns null', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const target = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const port = createTestPort({ versions: [target, current], content, restoreResult: null });
    const deps = createTestDependencies(port);
    const onRestoredCleanly = vi.fn();
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn(), onRestoredCleanly }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(result.current.error).toBeTruthy();
    expect(onRestoredCleanly).not.toHaveBeenCalled();
    expect(result.current.restoring).toBe(false);
  });

  it('restore: keeps the modal open and surfaces the warning message when the restore warns', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const target = makeVersion({ id: 'v2', version: 2 });
    const content = new Map([['v2', '<p>v2</p>']]);
    const restoredVersion = makeVersion({ id: 'v3', version: 3, current: true });
    const port = createTestPort({
      versions: [target, current],
      content,
      restoreResult: { version: restoredVersion, warning: { message: 'A snapshot capture failed.' } },
    });
    // After the warning path reloads, the list should reflect the new current version.
    port.listVersions = vi.fn(async () => [restoredVersion, target, current]);
    const deps = createTestDependencies(port);
    const onRestoredCleanly = vi.fn();
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>current</p>', onRestored: vi.fn(), onRestoredCleanly }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.selectVersion('v2');
    });
    await waitFor(() => expect(result.current.loadingContent).toBe(false));

    await act(async () => {
      await result.current.restore();
    });

    expect(result.current.error).toBe('A snapshot capture failed.');
    expect(onRestoredCleanly).not.toHaveBeenCalled();
  });

  it('restore: is a no-op when disabled (e.g. no selected version)', async () => {
    const port = createTestPort({ versions: [] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.restore();
    });
    expect(port.restoreVersion).not.toHaveBeenCalled();
  });

  it('openInNewTab is null when the port omits it', async () => {
    const port = createTestPort({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>x</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.openInNewTab).toBeNull();
  });

  it('openInNewTab calls the port with the selected version content and title', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const openPreviewInNewTab = vi.fn();
    const port = createTestPort({ versions: [current], openPreviewInNewTab });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>x</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.selectedContent).toBe('<p>x</p>'));

    act(() => {
      result.current.openInNewTab?.();
    });
    expect(openPreviewInNewTab).toHaveBeenCalledWith(FILE_REF, '<p>x</p>', `${FILE_REF.name} · v1`);
  });

  it('openInNewTab is a no-op while content is still loading', async () => {
    const current = makeVersion({ id: 'v1', version: 1, current: true });
    const other = makeVersion({ id: 'v2', version: 2 });
    const openPreviewInNewTab = vi.fn();
    const port = createTestPort({ versions: [current, other], openPreviewInNewTab, content: new Map() });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: '<p>x</p>', onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.selectVersion('v2');
    });
    expect(result.current.loadingContent).toBe(true);
    act(() => {
      result.current.openInNewTab?.();
    });
    expect(openPreviewInNewTab).not.toHaveBeenCalled();
  });

  it('changes viewport', async () => {
    const port = createTestPort({ versions: [] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewport).toBe('desktop');
    act(() => {
      result.current.setViewport('mobile');
    });
    expect(result.current.viewport).toBe('mobile');
  });

  it('describeVersion includes version number, prompt, label, source, date, and restoredFrom', async () => {
    const source = makeVersion({ id: 'v1', version: 1 });
    const restored = makeVersion({
      id: 'v2',
      version: 2,
      source: 'restore',
      restoreFromVersionId: 'v1',
      prompt: 'make it blue',
      label: 'blue theme',
    });
    const port = createTestPort({ versions: [restored, source] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const description = result.current.describeVersion(restored);
    expect(description).toContain('v2');
    expect(description).toContain('make it blue');
    expect(description).toContain('blue theme');
    expect(description).toContain('v1');

    // A version with neither prompt, label, nor a restore source exercises
    // the `?? ''`/restoredFrom-null fallbacks describeVersion(restored) above
    // never touches.
    const bareDescription = result.current.describeVersion(source);
    expect(bareDescription).toContain('v1');
    expect(bareDescription).not.toContain('undefined');

    // The controller's own `restoredFrom` wrapper (not just the underlying
    // rules.ts function, already covered directly in rules.test.ts).
    expect(result.current.restoredFrom(restored)?.id).toBe('v1');
    expect(result.current.restoredFrom(source)).toBeNull();
  });

  it('falls back to "desktop" when given an empty viewportPresets list', async () => {
    const port = createTestPort({ versions: [] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useVersionManager(deps, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn(), viewportPresets: [] }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewport).toBe('desktop');
  });

  it('re-fetches the version list when currentContent changes identity', async () => {
    const port = createTestPort({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    const deps = createTestDependencies(port);
    const { result, rerender } = renderHook(
      ({ currentContent }: { currentContent: string | null }) =>
        useVersionManager(deps, { fileRef: FILE_REF, currentContent, onRestored: vi.fn() }),
      { initialProps: { currentContent: '<p>a</p>' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(port.listVersions).toHaveBeenCalledTimes(1);

    rerender({ currentContent: '<p>b</p>' });
    await waitFor(() => expect(port.listVersions).toHaveBeenCalledTimes(2));
  });

  it('useWiredVersionManager binds the default dependencies when none are given', async () => {
    const { result } = renderHook(() =>
      useWiredVersionManager({ fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.versions).toEqual([]);
  });

  it('useWiredVersionManager accepts explicit dependencies', async () => {
    const port = createTestPort({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    const deps = createTestDependencies(port);
    const { result } = renderHook(() =>
      useWiredVersionManager({ fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }, deps),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.versions).toHaveLength(1);
  });
});

describe('useVersionManager list and restore characterization (L204)', () => {
  it.each([
    { name: 'empty list', versions: [], selectedId: null },
    { name: 'newest without a current version', versions: [makeVersion({ id: 'older', version: 1 }), makeVersion({ id: 'newer', version: 2 })], selectedId: 'newer' },
    { name: 'current ahead of newest', versions: [makeVersion({ id: 'current', version: 1, current: true }), makeVersion({ id: 'newer', version: 2 })], selectedId: 'current' },
  ])('selects $name when listing', async ({ versions, selectedId }) => {
    const port = createTestPort({ versions });
    const dependencies = createTestDependencies(port);
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent: null, onRestored: vi.fn() }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedId).toBe(selectedId);
    expect(result.current.versions.map((version) => version.version)).toEqual(versions.map((version) => version.version).sort((a, b) => b - a));
  });

  it.each([
    { currentContent: null, expectedContent: 'fetched', expectedFetches: 1 },
    { currentContent: '', expectedContent: '', expectedFetches: 0 },
    { currentContent: 'seeded', expectedContent: 'seeded', expectedFetches: 0 },
  ])('seeds current content $currentContent without replacing empty strings', async ({ currentContent, expectedContent, expectedFetches }) => {
    const current = makeVersion({ id: 'current', version: 1, current: true });
    const port = createTestPort({ versions: [current], content: new Map([[current.id, 'fetched']]) });
    const dependencies = createTestDependencies(port);
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent, onRestored: vi.fn() }));
    await waitFor(() => expect(result.current.selectedId).toBe(current.id));
    await waitFor(() => expect(result.current.loadingContent).toBe(false));
    expect(result.current.selectedContent).toBe(expectedContent);
    expect(port.fetchVersionContent).toHaveBeenCalledTimes(expectedFetches);
  });

  it('keeps the cached current body after currentContent changes (reported, not fixed)', async () => {
    const current = makeVersion({ id: 'current', version: 1, current: true });
    const port = createTestPort({ versions: [current] });
    const dependencies = createTestDependencies(port);
    const { result, rerender } = renderHook(
      ({ currentContent }) => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent, onRestored: vi.fn() }),
      { initialProps: { currentContent: 'first body' } },
    );
    await waitFor(() => expect(result.current.selectedContent).toBe('first body'));
    rerender({ currentContent: 'updated body' });
    await waitFor(() => expect(port.listVersions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selectedContent).toBe('first body');
    expect(result.current.previewDocument).toBe('<doc>first body</doc>');
    expect(port.fetchVersionContent).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'returned version', returnedId: 'restored', expectedId: 'restored' },
    { name: 'omitted version', returnedId: undefined, expectedId: 'target' },
    { name: 'missing preferred version', returnedId: 'absent', expectedId: 'current' },
    { name: 'empty preferred id', returnedId: '', expectedId: 'current' },
  ])('preserves warning and selection for $name', async ({ returnedId, expectedId }) => {
    const current = makeVersion({ id: 'current', version: 3, current: true });
    const target = makeVersion({ id: 'target', version: 1 });
    const restored = makeVersion({ id: 'restored', version: 2, source: 'restore' });
    const returnedVersion = returnedId === undefined ? undefined : { ...restored, id: returnedId };
    const restoreResult: VersionRestoreResult = { warning: { message: 'Snapshot warning' }, ...(returnedVersion ? { version: returnedVersion } : {}) };
    const port = createTestPort({ versions: [target, current, restored], content: new Map([[target.id, 'target body']]), restoreResult });
    const dependencies = createTestDependencies(port);
    const onRestored = vi.fn();
    const onRestoredCleanly = vi.fn();
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent: 'current body', onRestored, onRestoredCleanly }));
    await waitFor(() => expect(result.current.selectedContent).toBe('current body'));
    act(() => result.current.selectVersion(target.id));
    await waitFor(() => expect(result.current.selectedContent).toBe('target body'));
    await act(async () => { await result.current.restore(); });
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith('target body', returnedVersion ?? target);
    expect(onRestoredCleanly).not.toHaveBeenCalled();
    expect(result.current.selectedId).toBe(expectedId);
    expect(result.current.selectedContent).toBe(expectedId === 'current' ? 'current body' : 'target body');
    expect(result.current.error).toBe('Snapshot warning');
    expect(result.current.restoring).toBe(false);
    expect(port.listVersions).toHaveBeenCalledTimes(2);
    expect(port.fetchVersionContent).toHaveBeenCalledTimes(1);
  });

  it('blocks restore for current content and while another selection is loading', async () => {
    const current = makeVersion({ id: 'current', version: 2, current: true });
    const target = makeVersion({ id: 'target', version: 1 });
    let finishFetch: (content: string | null) => void = () => { throw new Error('Fetch has not started'); };
    const port = createTestPort({ versions: [current, target] });
    port.fetchVersionContent = vi.fn(() => new Promise<string | null>((resolve) => { finishFetch = resolve; }));
    const dependencies = createTestDependencies(port);
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent: 'current body', onRestored: vi.fn() }));
    await waitFor(() => expect(result.current.selectedContent).toBe('current body'));
    await act(async () => { await result.current.restore(); });
    expect(port.restoreVersion).not.toHaveBeenCalled();
    act(() => result.current.selectVersion(target.id));
    expect(result.current.loadingContent).toBe(true);
    expect(result.current.selectedContent).toBe('current body');
    await act(async () => { await result.current.restore(); });
    expect(port.restoreVersion).not.toHaveBeenCalled();
    await act(async () => { finishFetch(''); });
    expect(result.current.selectedContent).toBe('');
    expect(result.current.restoreDisabled).toBe(true);
    await act(async () => { await result.current.restore(); });
    expect(port.restoreVersion).not.toHaveBeenCalled();
  });

  it('resets restoring and propagates a rejected host callback', async () => {
    const target = makeVersion({ id: 'target', version: 1 });
    const port = createTestPort({ versions: [target], content: new Map([[target.id, 'body']]) });
    const dependencies = createTestDependencies(port);
    const failure = new Error('Host rejected restore');
    const onRestored = vi.fn(async () => { throw failure; });
    const onRestoredCleanly = vi.fn();
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent: null, onRestored, onRestoredCleanly }));
    await waitFor(() => expect(result.current.restoreDisabled).toBe(false));
    await act(async () => { await expect(result.current.restore()).rejects.toBe(failure); });
    expect(result.current.restoring).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onRestoredCleanly).not.toHaveBeenCalled();
  });

  it('keeps restoring true after clean success without a close callback (reported, not fixed)', async () => {
    const target = makeVersion({ id: 'target', version: 1 });
    const port = createTestPort({ versions: [target], content: new Map([[target.id, 'body']]) });
    const dependencies = createTestDependencies(port);
    const onRestored = vi.fn();
    const { result } = renderHook(() => useVersionManager(dependencies, { fileRef: FILE_REF, currentContent: null, onRestored }));
    await waitFor(() => expect(result.current.restoreDisabled).toBe(false));
    await act(async () => { await result.current.restore(); });
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith('body', target);
    expect(result.current.restoring).toBe(true);
    expect(result.current.restoreDisabled).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
