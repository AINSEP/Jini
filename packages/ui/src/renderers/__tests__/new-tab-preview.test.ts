import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSandboxedPreviewPage, openSandboxedPreviewInNewTab } from '../new-tab-preview.js';

describe('buildSandboxedPreviewPage', () => {
  it('embeds the sandboxed document as the inner iframe srcdoc', () => {
    const page = buildSandboxedPreviewPage('<p>hi</p>', 'My Title');
    expect(page).toContain('<title>My Title</title>');
    expect(page).toContain('sandbox="allow-scripts"');
    expect(page).toContain('data-jini-sandbox-shim');
  });

  it('falls back to "Preview" for an empty title', () => {
    const page = buildSandboxedPreviewPage('<p>hi</p>', '');
    expect(page).toContain('<title>Preview</title>');
  });

  it('escapes a title containing HTML-special characters', () => {
    const page = buildSandboxedPreviewPage('<p>hi</p>', 'A & B "quote"');
    expect(page).toContain('<title>A &amp; B &quot;quote&quot;</title>');
  });

  it('adds allow-modals to the sandbox attribute when requested', () => {
    const page = buildSandboxedPreviewPage('<p>hi</p>', 'T', { allowModals: true });
    expect(page).toContain('sandbox="allow-scripts allow-modals"');
  });

  it('passes SandboxedDocumentOptions through to the inner document', () => {
    const page = buildSandboxedPreviewPage('<p>hi</p>', 'T', { baseHref: 'https://cdn.test/' });
    expect(page).toContain('&lt;base href=&quot;https://cdn.test/&quot;&gt;');
  });
});

describe('openSandboxedPreviewInNewTab', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens a blob URL in a new tab and returns true', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const fakeWindowHandle = {} as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindowHandle);

    const result = openSandboxedPreviewInNewTab('<p>hi</p>', 'T');

    expect(result).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('blob:fake-url', '_blank', 'noopener,noreferrer');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    openSpy.mockRestore();
  });

  it('returns false when window.open is blocked (returns null)', () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const result = openSandboxedPreviewInNewTab('<p>hi</p>', 'T');

    expect(result).toBe(false);
    openSpy.mockRestore();
  });

  it('returns false without attempting to open when URL.createObjectURL is unavailable', () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });
    const openSpy = vi.spyOn(window, 'open');

    const result = openSandboxedPreviewInNewTab('<p>hi</p>', 'T');

    expect(result).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('returns false when there is no window (SSR guard)', () => {
    vi.stubGlobal('window', undefined);
    const result = openSandboxedPreviewInNewTab('<p>hi</p>', 'T');
    expect(result).toBe(false);
  });
});
