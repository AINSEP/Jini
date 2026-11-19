// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createConsoleLogger } from '@jini-ai/core';
import grapesjs from 'grapesjs';
import { useAssetGridLiveUpdates } from '../features/asset-grid/react/hooks/useAssetGridLiveUpdates.js';
import type { AssetGridLiveUpdateHandlers } from '../features/asset-grid/ports.js';
import { useConnectorCatalog } from '../features/connectors/hooks/useConnectorCatalog.js';
import { createFakeConnectorsDependencies } from '../features/connectors/dependencies.js';
import { prepareEditorSource } from '../features/html-editor/editor-blocks.js';
import { serializeEditorSource } from '../features/html-editor/editor-serialization.js';
import { useSettingsSlice } from '../features/panel-kit/hooks/use-settings-slice.hooks.js';
import { useSketchSaveWorkflow } from '../features/sketch-editor/react/hooks/useSketchSaveWorkflow.js';
import { createFakeSketchEditorEngine } from '../features/sketch-editor/react/dependencies-fake.js';
import { emptySketchScene } from '../features/sketch-editor/rules.js';

const secret = 'SENTINEL_PRIVATE_N';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('reports a failed ingest once and retries a full reconciliation on the next event', async () => {
  vi.useFakeTimers();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cause = new Error(secret), diagnostics: unknown[] = [];
  const report = createConsoleLogger({ prefix: '' }, { diagnostics: record => diagnostics.push(record.error) });
  let handlers!: AssetGridLiveUpdateHandlers;
  const reload = vi.fn(async () => {});
  renderHook(() => useAssetGridLiveUpdates({ active: true, filtersActive: false,
    liveUpdates: { subscribe: next => { handlers = next; return () => {}; } }, fetchAssetById: () => Promise.reject(cause),
    setAssets: () => {}, reload, coalesceMs: 1, report }));
  act(() => handlers.onIngest('asset'));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(error).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  act(() => handlers.onIngest('asset'));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(diagnostics).toEqual([cause]);
  expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
});

it('retains the connector catalog on failed refresh and settles loading with a safe diagnostic', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const deps = createFakeConnectorsDependencies();
  let fail = false;
  const port = { ...deps.data, fetchConnectors: () => fail ? Promise.reject(new Error(secret)) : deps.data.fetchConnectors() };
  const report = createConsoleLogger({ prefix: '' });
  const { result, rerender } = renderHook(({ refreshKey }) => useConnectorCatalog(port, { unlocked: false, refreshKey, report }), { initialProps: { refreshKey: 0 } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const before = result.current.connectors;
  fail = true; rerender({ refreshKey: 1 });
  await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
  expect(result.current.loading).toBe(false);
  expect(result.current.connectors).toBe(before);
  expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
});

it('returns the full serialized document when a splice falls back, with fixed copy', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const html = '<p>Original</p>', plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error('test source rejected');
  const editor = grapesjs.init({ headless: true, autorender: false, components: html, storageManager: false });
  try {
    editor.getWrapper()!.components().models[0]!.components('Changed');
    const output = serializeEditorSource({ editor, html, edits: new Map(), sourcePlan: plan }, { structuralChange: secret, report: createConsoleLogger({ prefix: '' }) });
    expect(output).toBe(editor.getWrapper()!.getInnerHTML());
    expect(output).toContain('Changed');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('falling back to full re-serialization');
    expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
  } finally { await editor.destroy(); }
});

it('keeps the final unmount save queued and reports its rejection once', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const save = vi.fn(() => Promise.reject(new Error(secret)));
  const { result, unmount } = renderHook(() => useSettingsSlice({ defaultValue: 'default', load: async () => 'loaded', save,
    refreshPort: { publish: () => {}, subscribe: () => () => {} }, report: createConsoleLogger({ prefix: '' }) }, {}));
  await waitFor(() => expect(result.current.value).toBe('loaded'));
  act(() => result.current.onChange('edited'));
  expect(save).not.toHaveBeenCalled(); unmount();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls.flat().join(' ')).not.toContain(secret);
});

it('reports sketch export failures once and retains the error toast', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useSketchSaveWorkflow({ dirty: false, saving: false, fileName: 'scene.excalidraw', currentScene: () => emptySketchScene('scene.excalidraw'), onSave: () => {}, onExportImage: () => true,
    engine: createFakeSketchEditorEngine({ exportToBlob: () => Promise.reject(new Error(secret)) }), t: key => key, report: createConsoleLogger({ prefix: '' }) }));
  await act(async () => result.current.handleExportImage());
  expect(result.current).toMatchObject({ exporting: false, toast: { message: 'Could not export image', tone: 'error' } });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls.flat().join(' ')).not.toContain(secret);
});

it('warns once when the default icon stylesheet is missing and releases its marker', async () => {
  vi.resetModules();
  const { ensureRemixIconStylesheet, REMIXICON_STYLESHEET_MARKER } = await import('../react/components/RemixIcon.stylesheet.js');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const report = createConsoleLogger({ prefix: '' });
  document.querySelectorAll(`[${REMIXICON_STYLESHEET_MARKER}]`).forEach(element => element.remove());
  ensureRemixIconStylesheet({}, { report });
  const link = document.querySelector(`[${REMIXICON_STYLESHEET_MARKER}]`)!;
  link.dispatchEvent(new Event('error')); link.dispatchEvent(new Event('error'));
  ensureRemixIconStylesheet({}, { report });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(document.querySelector(`[${REMIXICON_STYLESHEET_MARKER}]`)).toBeNull();
});
