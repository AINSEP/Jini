import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { EditMediaPanel } from '../components/EditMediaPanel.js';
import { useEditMediaPanel } from '../hooks/EditMediaPanel.hooks.js';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import type { MediaAsset } from '../../models.js';
import type { MediaApiPort } from '../../ports.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function asset(required: Partial<MediaAsset>, _optional: Record<string, never> = {}): MediaAsset {
  return {
    id: 'asset-a', title: 'Original title', slug: 'saved-slug', alt: 'Original alt',
    caption: 'Original caption', credit: 'Original credit', sha256: 'sha256-original',
    contentType: 'image/png', publicUrl: 'https://cdn.example.test/m/server-location',
    width: null, height: null, cssClass: null, htmlAttributes: null, status: 'active',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', version: 1,
    ...required,
  };
}
function fixture(required: { item?: MediaAsset } = {}, _optional: Record<string, never> = {}) {
  const item = required.item ?? asset({});
  const api = createMemoryMediaApi({ assets: [item] });
  const update = vi.spyOn(api, 'update');
  const originalUrl = vi.spyOn(api, 'originalUrl');
  const onSaved = vi.fn();
  const onClose = vi.fn();
  return { item, api, update, originalUrl, onSaved, onClose };
}
function deferred<T>(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('legacy metadata fields and partial patches', () => {
  it('prefills separate title and slug fields and sends slug alone without changing title', async () => {
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    expect(screen.getByLabelText('Title')).toHaveValue(context.item.title);
    expect(screen.getByLabelText('Slug')).toHaveValue(context.item.slug);
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new-slug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: { slug: 'new-slug' } });
    expect((await context.api.list({}))[0]?.title).toBe(context.item.title);
  });
  it('renaming only title never derives a new slug or sends untouched native-size fields', async () => {
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renamed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: { title: 'Renamed title' } });
    expect((await context.api.list({}))[0]?.slug).toBe('saved-slug');
  });
  it('sends numeric dimensions and verbatim CSS/HTML values from their own fields', async () => {
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    expect(screen.getByLabelText('Width (px)')).toHaveValue(null);
    expect(screen.getByLabelText('Height (px)')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText('Width (px)'), { target: { value: '320' } });
    fireEvent.change(screen.getByLabelText('Height (px)'), { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText('CSS class (optional)'), { target: { value: 'hero wide' } });
    fireEvent.change(screen.getByLabelText('HTML attributes (optional)'), { target: { value: 'data-motion="fade-in"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: {
      width: 320, height: 240, cssClass: 'hero wide', htmlAttributes: 'data-motion="fade-in"',
    } });
  });
  it('clears existing dimensions, CSS class and HTML attributes with explicit null', async () => {
    const context = fixture({ item: asset({ width: 320, height: 240, cssClass: 'hero', htmlAttributes: 'loading=lazy' }) });
    render(<EditMediaPanel {...context} />);
    for (const label of ['Width (px)', 'Height (px)', 'CSS class (optional)', 'HTML attributes (optional)'])
      fireEvent.change(screen.getByLabelText(label), { target: { value: label.includes('(px)') ? '' : '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: {
      width: null, height: null, cssClass: null, htmlAttributes: null,
    } });
  });
  it('retains a frozen edit baseline when the same asset prop advances after another operator edits alt', async () => {
    // A live item prop is not the draft's baseline. Diffing against it would send stale,
    // untouched alt as a change and silently revert the other operator's committed write.
    const context = fixture();
    const view = render(<EditMediaPanel {...context} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Local title' } });
    const remote = await context.api.update({ id: context.item.id, patch: { alt: 'Remote alt' } });
    context.update.mockClear();
    view.rerender(<EditMediaPanel {...context} item={remote} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Local title');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: { title: 'Local title' } });
    expect((await context.api.list({}))[0]?.alt).toBe('Remote alt');
  });
  it('reseeds the keyed form on an unsaved A-to-B edit switch and patches only the changed B field', async () => {
    // Key the form content, not a reused draft: two ordinary row clicks once wrote A's
    // title/alt/caption to B because a useState initializer did not rerun for the new target.
    const a = asset({});
    const b = asset({ id: 'asset-b', title: 'B title', slug: 'b-slug', alt: 'B alt', caption: 'B caption' });
    const api = createMemoryMediaApi({ assets: [a, b] });
    const update = vi.spyOn(api, 'update');
    const onSaved = vi.fn();
    const props = { api, onSaved, onClose: vi.fn() };
    const view = render(<EditMediaPanel key={a.id} {...props} item={a} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved A title' } });
    view.rerender(<EditMediaPanel key={b.id} {...props} item={b} />);
    expect(screen.getByLabelText('Title')).toHaveValue('B title');
    expect(document.querySelector<HTMLInputElement>('[data-agent-element="media-edit-alt"]')!).toHaveValue('B alt');
    expect(screen.getByLabelText('Caption')).toHaveValue('B caption');
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-agent-element="media-edit-alt"]')!, { target: { value: 'Edited B alt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toEqual({ id: b.id, patch: { alt: 'Edited B alt' } });
  });
});

describe('legacy server-authoritative save failures', () => {
  it('shows the live attribute error but still sends all dirty fields and surfaces the server rejection', async () => {
    // Regression: an early return on the hint prevented ANY patch from reaching the server,
    // including independently edited title/alt. The server owns atomic rejection.
    const context = fixture();
    context.update.mockRejectedValueOnce(new Error('400: onerror is not allowed; nothing was written'));
    render(<EditMediaPanel {...context} />);
    fireEvent.change(screen.getByLabelText('HTML attributes (optional)'), { target: { value: 'onerror="alert(1)"' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dirty title' } });
    // The empty entry is the replace control's persistent sr-only success live region.
    expect(screen.getAllByRole('status').map(el => el.textContent)).toEqual(["Event handler attributes like 'onerror' are not allowed.", '']);
    expect(screen.getByLabelText('HTML attributes (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('400: onerror is not allowed; nothing was written');
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: {
      title: 'Dirty title', htmlAttributes: 'onerror="alert(1)"',
    } });
    expect(context.onSaved).not.toHaveBeenCalled();
    expect((await context.api.list({}))[0]?.title).toBe(context.item.title);
  });
  it.each([
    '409: slug conflict with another asset',
    '400: server rejected data-motion independently of the client hint',
    '503: metadata service unavailable',
  ])('shows full server error %s for client-valid metadata', async (message) => {
    const context = fixture();
    context.update.mockRejectedValueOnce(new Error(message));
    render(<EditMediaPanel {...context} />);
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'other-slug' } });
    fireEvent.change(screen.getByLabelText('HTML attributes (optional)'), { target: { value: 'data-motion="fade-in"' } });
    // No attribute hint: only the replace control's empty persistent success live region remains.
    expect(screen.getAllByRole('status').map(el => el.textContent)).toEqual(['']);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(context.onSaved).not.toHaveBeenCalled();
  });
});

describe('legacy public references and original handles', () => {
  it('passes through the server public URL verbatim and never calls the authenticated original URL builder', () => {
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    expect(screen.getByText(context.item.publicUrl!)).toHaveTextContent(context.item.publicUrl!);
    expect(context.originalUrl).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy URL' })).toHaveAttribute('data-agent-element', 'media-edit-copy-url');
  });
  it('hides a null public URL but displays the saved-slug embed even when the draft slug is changed', () => {
    const context = fixture({ item: asset({ publicUrl: null }) });
    render(<EditMediaPanel {...context} />);
    expect(screen.queryByText('File URL')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy URL' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'unsaved-draft-slug' } });
    expect(screen.getByText(`<div data-embed-config='{"type":"media","slug":"saved-slug"}'></div>`)).toBeInTheDocument();
    expect(context.originalUrl).not.toHaveBeenCalled();
  });
  it('attaches legacy handles to the actual fillable fields and save/cancel actions', async () => {
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    const changes = {
      title: 'Handle title', slug: 'handle-slug', alt: 'Handle alt', caption: 'Handle caption',
      credit: 'Handle credit', width: '320', height: '240',
      'css-class': 'handle-class', 'html-attributes': 'loading=lazy',
    };
    for (const [handle, value] of Object.entries(changes)) {
      // Native kit dialogs portal into document.body, outside the render container.
      const field = document.querySelector(`[data-agent-element="media-edit-${handle}"]`);
      expect(field?.tagName).toBe('INPUT');
      fireEvent.change(field!, { target: { value } });
      expect(field).toHaveValue(handle === 'width' ? 320 : handle === 'height' ? 240 : value);
    }
    expect(document.querySelector('[data-agent-element="media-edit-panel"]')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-agent-element', 'media-edit-dialog');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-agent-element', 'media-edit-cancel');
    const save = document.querySelector('[data-agent-element="media-edit-save"]');
    expect(save?.tagName).toBe('BUTTON');
    fireEvent.click(save!);
    await waitFor(() => expect(context.onSaved).toHaveBeenCalledTimes(1));
    expect(context.update.mock.calls[0]?.[0]).toEqual({ id: context.item.id, patch: {
      title: 'Handle title', slug: 'handle-slug', alt: 'Handle alt', caption: 'Handle caption',
      credit: 'Handle credit', width: 320, height: 240, cssClass: 'handle-class', htmlAttributes: 'loading=lazy',
    } });
  });
  it.each(['missing', 'disabled'] as const)('hides replacement when the capability is %s', (mode) => {
    const context = fixture();
    const { replace: _replace, ...withoutReplace } = context.api;
    const api: MediaApiPort = mode === 'missing' ? withoutReplace
      : { ...context.api, replaceSupported: false };
    render(<EditMediaPanel {...context} api={api} />);
    expect(screen.queryByRole('button', { name: 'Replace file' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('legacy clipboard feedback', () => {
  // Legacy shows the same visible "Copy"/"Copied" text on every row; each button's
  // accessible name keeps its own noun in both states, so the three stay distinguishable.
  const copyCases = [
    { id: 'url', text: 'https://cdn.example.test/m/server-location', label: 'Copy URL', copiedLabel: 'Copied URL' },
    { id: 'embed', text: `<div data-embed-config='{"type":"media","slug":"saved-slug"}'></div>`, label: 'Copy embed code', copiedLabel: 'Copied embed code' },
    { id: 'hash', text: 'sha256-original', label: 'Copy hash', copiedLabel: 'Copied hash' },
  ];
  const rowOf = (copies: readonly { id: string; buttonLabel: string; attrs: Record<string, unknown> }[], id: string) => {
    const row = copies.find((candidate) => candidate.id === id)!;
    return { text: row.buttonLabel, name: row.attrs['aria-label'] };
  };
  it.each(copyCases)('waits for successful $id copy, then clears only its feedback after 1500 ms', async ({ id, text, label, copiedLabel }) => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const writeText = vi.fn(() => pending.promise);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const context = fixture();
    const { result } = renderHook(() => useEditMediaPanel(context));
    let copying!: Promise<void>;
    act(() => { copying = result.current.copies.find((row) => row.id === id)!.copy(); });
    expect(writeText.mock.calls).toEqual([[text]]);
    expect(rowOf(result.current.copies, id)).toEqual({ text: 'Copy', name: label });
    await act(async () => { pending.resolve(); await copying; });
    expect(rowOf(result.current.copies, id)).toEqual({ text: 'Copied', name: copiedLabel });
    expect(result.current.copies.filter((row) => row.id !== id).map((row) => row.buttonLabel)).not.toContain('Copied');
    act(() => { vi.advanceTimersByTime(1499); });
    expect(rowOf(result.current.copies, id)).toEqual({ text: 'Copied', name: copiedLabel });
    act(() => { vi.advanceTimersByTime(1); });
    expect(rowOf(result.current.copies, id)).toEqual({ text: 'Copy', name: label });
  });
  it.each(copyCases)('keeps $id selectable with no false Copied feedback when clipboard access is denied', async ({ id, text, label }) => {
    // Clipboard denial must degrade to selecting the already-visible value manually,
    // without pretending a copy succeeded or hiding the only remaining way to get it.
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const context = fixture();
    render(<EditMediaPanel {...context} />);
    const button = document.querySelector(`[data-agent-element="media-edit-copy-${id}"]`)!;
    fireEvent.click(button);
    await waitFor(() => expect(writeText.mock.calls).toEqual([[text]]));
    expect(button).toHaveTextContent('Copy');
    expect(button).toHaveAccessibleName(label);
    expect(screen.queryByRole('button', { name: /^Copied/ })).toBeNull();
    expect(screen.getByText(text).tagName).toBe(id === 'url' ? 'A' : 'CODE');
    if (id === 'url') expect(screen.getByText(text)).toHaveAttribute('href', text);
  });
  it('tracks each copy independently when multiple values are copied at different times', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const context = fixture();
    const { result } = renderHook(() => useEditMediaPanel(context));
    await act(async () => { await result.current.copies.find((row) => row.id === 'hash')!.copy(); });
    act(() => { vi.advanceTimersByTime(500); });
    await act(async () => { await result.current.copies.find((row) => row.id === 'url')!.copy(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(rowOf(result.current.copies, 'hash')).toEqual({ text: 'Copy', name: 'Copy hash' });
    expect(rowOf(result.current.copies, 'url')).toEqual({ text: 'Copied', name: 'Copied URL' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(rowOf(result.current.copies, 'url')).toEqual({ text: 'Copy', name: 'Copy URL' });
  });
  it('does not schedule feedback updates when a pending clipboard write resolves after unmount', async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(() => pending.promise) } });
    const context = fixture();
    const { result, unmount } = renderHook(() => useEditMediaPanel(context));
    let copying!: Promise<void>;
    act(() => { copying = result.current.copies.find((row) => row.id === 'hash')!.copy(); });
    unmount();
    await act(async () => { pending.resolve(); await copying; });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an already-scheduled copied-feedback timer when unmounted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const context = fixture();
    const { result, unmount } = renderHook(() => useEditMediaPanel(context));
    await act(async () => { await result.current.copies.find((row) => row.id === 'hash')!.copy(); });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
