// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EXPORT_LABELS,
  ExportDiagnosticsButton,
  exportViaHttp,
  fallbackFilename,
  fileNameFromHeader,
  resolveExportLabels,
  STATUS_CLEAR_MS,
  useAutoClearStatus,
  useExportDiagnostics,
} from '../../components/ExportDiagnosticsButton.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Pure helpers: fileNameFromHeader ──────────────────────────────────────
describe('fileNameFromHeader', () => {
  it('returns null for a null header or a header with no filename token', () => {
    expect(fileNameFromHeader(null)).toBeNull();
    expect(fileNameFromHeader('attachment')).toBeNull();
  });

  it('reads the quoted filename="…" form', () => {
    expect(fileNameFromHeader('attachment; filename="report.zip"')).toBe('report.zip');
  });

  it("reads the RFC5987 filename*=UTF-8'' form and percent-decodes it", () => {
    expect(fileNameFromHeader("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.zip")).toBe('résumé.zip');
  });

  it('reads the bare unquoted filename=… form', () => {
    expect(fileNameFromHeader('attachment; filename=plain.zip')).toBe('plain.zip');
  });

  it('returns the raw (trimmed) value when percent-decoding fails', () => {
    expect(fileNameFromHeader('attachment; filename="bad-%E0%A4.zip"')).toBe('bad-%E0%A4.zip');
  });
});

// ── Pure helpers: fallbackFilename / resolveExportLabels ───────────────────
describe('fallbackFilename & resolveExportLabels', () => {
  it('fallbackFilename returns a timestamped zip name with the given prefix', () => {
    expect(fallbackFilename('diag')).toMatch(/^diag-[\dTZ-]+\.zip$/);
  });

  it('resolveExportLabels merges overrides onto the defaults', () => {
    expect(resolveExportLabels().button).toBe(DEFAULT_EXPORT_LABELS.button);
    const merged = resolveExportLabels({ button: 'Save logs' });
    expect(merged.button).toBe('Save logs');
    expect(merged.exporting).toBe(DEFAULT_EXPORT_LABELS.exporting); // untouched default
  });
});

// ── Pure helper: exportViaHttp ────────────────────────────────────────────
describe('exportViaHttp', () => {
  const stubUrl = () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    return { createObjectURL, revokeObjectURL };
  };

  it('downloads via a transient anchor and returns the content-disposition filename', async () => {
    const blob = new Blob(['zip-bytes']);
    const headers = new Headers({ 'content-disposition': 'attachment; filename="from-header.zip"' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchMock);
    const { createObjectURL, revokeObjectURL } = stubUrl();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await exportViaHttp('/custom/export', 'diag');

    expect(result.filename).toBe('from-header.zip');
    expect(fetchMock).toHaveBeenCalledWith('/custom/export', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    expect(document.querySelector('a')).toBeNull(); // anchor removed after click
  });

  it('falls back to a timestamped filename when there is no content-disposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), blob: () => Promise.resolve(new Blob()) }),
    );
    stubUrl();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = await exportViaHttp('/p', 'diag');
    expect(result.filename).toMatch(/^diag-[\dTZ-]+\.zip$/);
  });

  it('throws the JSON body message on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false, status: 503, statusText: 'Unavailable',
        json: () => Promise.resolve({ message: 'maintenance window' }),
      }),
    );
    await expect(exportViaHttp('/p', 'diag')).rejects.toThrow('maintenance window');
  });

  it('throws the status text when the JSON body has no string message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false, status: 500, statusText: 'Server Error',
        json: () => Promise.resolve({ code: 7 }),
      }),
    );
    await expect(exportViaHttp('/p', 'diag')).rejects.toThrow('500 Server Error');
  });

  it('throws the status text when the JSON body is null (falsy)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false, status: 502, statusText: 'Bad Gateway',
        json: () => Promise.resolve(null),
      }),
    );
    await expect(exportViaHttp('/p', 'diag')).rejects.toThrow('502 Bad Gateway');
  });

  it('throws the status text when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false, status: 500, statusText: 'Server Error',
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    await expect(exportViaHttp('/p', 'diag')).rejects.toThrow('500 Server Error');
  });
});

// ── useAutoClearStatus ────────────────────────────────────────────────────
describe('useAutoClearStatus', () => {
  it('defaults to the shared clear delay constant', () => {
    expect(STATUS_CLEAR_MS).toBe(6000);
  });

  it('schedules an auto-clear back to idle and re-arms (cancelling the prior timer)', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result } = renderHook(() => useAutoClearStatus(1000));
    expect(result.current.status).toEqual({ kind: 'idle' });

    act(() => result.current.setStatus({ kind: 'success', message: 'x' }));
    act(() => result.current.scheduleClear()); // first arm: clearTimer null -> no clearTimeout
    const afterFirst = clearSpy.mock.calls.length;
    act(() => result.current.setStatus({ kind: 'error', message: 'y' }));
    act(() => result.current.scheduleClear()); // re-arm: clearTimer set -> clearTimeout called
    expect(clearSpy.mock.calls.length).toBe(afterFirst + 1);

    act(() => vi.advanceTimersByTime(1000)); // timer callback -> back to idle
    expect(result.current.status).toEqual({ kind: 'idle' });
  });

  it('cancels a pending clear timer on unmount', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useAutoClearStatus());
    act(() => result.current.scheduleClear());
    unmount(); // cleanup: clearTimer set -> clearTimeout
    expect(clearSpy).toHaveBeenCalled();
  });

  it('unmounts cleanly when no timer is pending', () => {
    const { unmount } = renderHook(() => useAutoClearStatus());
    expect(() => unmount()).not.toThrow(); // cleanup: clearTimer null -> skip
  });
});

// ── useExportDiagnostics (orchestrator) ───────────────────────────────────
describe('useExportDiagnostics', () => {
  it('ignores a re-entrant runExport while an export is in flight (busy guard)', async () => {
    let release: ((v: { ok: false; cancelled: true }) => void) | undefined;
    const exportDiagnostics = vi.fn(
      () => new Promise<{ ok: false; cancelled: true }>((r) => { release = r; }),
    );
    const { result } = renderHook(() =>
      useExportDiagnostics({ desktopBridge: { exportDiagnostics } }),
    );

    act(() => { void result.current.runExport(); }); // first call -> busy
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.runExport(); }); // second call -> early return
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);

    await act(async () => { release?.({ ok: false, cancelled: true }); });
    expect(result.current.busy).toBe(false);
  });

  it('reports a non-Error rejection via String(error)', async () => {
    const { result } = renderHook(() =>
      useExportDiagnostics({ desktopBridge: { exportDiagnostics: vi.fn().mockRejectedValue('boom') } }),
    );
    await act(async () => { await result.current.runExport(); });
    expect(result.current.status).toEqual({ kind: 'error', message: 'Export failed: boom' });
  });
});

// ── Component (dumb render) ───────────────────────────────────────────────
describe('ExportDiagnosticsButton', () => {
  it('uses the desktopBridge when supplied, instead of fetch', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const desktopBridge = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/diag.zip' }),
    };
    render(<ExportDiagnosticsButton desktopBridge={desktopBridge} />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Exported to /tmp/diag.zip');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the exporting label and disables the button while an export is in flight', async () => {
    const user = userEvent.setup();
    let release: ((v: { ok: true; path: string }) => void) | undefined;
    const desktopBridge = {
      exportDiagnostics: () => new Promise<{ ok: true; path: string }>((r) => { release = r; }),
    };
    render(<ExportDiagnosticsButton desktopBridge={desktopBridge} />);
    const button = screen.getByRole('button');
    await user.click(button);
    expect(button.textContent).toContain('Exporting…');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-status', 'busy');
    await act(async () => { release?.({ ok: true, path: '/tmp/x.zip' }); });
    expect(button).not.toBeDisabled();
    expect(button.textContent).toContain('Export diagnostics');
  });

  it('shows an error message when the desktop bridge reports failure', async () => {
    const user = userEvent.setup();
    const desktopBridge = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: false, cancelled: false, message: 'disk full' }),
    };
    render(<ExportDiagnosticsButton desktopBridge={desktopBridge} />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Export failed: disk full');
  });

  it('does nothing (no status) when the desktop dialog is cancelled', async () => {
    const user = userEvent.setup();
    const desktopBridge = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: false, cancelled: true }),
    };
    render(<ExportDiagnosticsButton desktopBridge={desktopBridge} />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(desktopBridge.exportDiagnostics).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('falls back to an HTTP export against exportPath when no bridge is supplied', async () => {
    const user = userEvent.setup();
    const blob = new Blob(['zip-bytes']);
    const headers = new Headers({ 'content-disposition': 'attachment; filename="diag-123.zip"' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, headers, blob: () => Promise.resolve(blob) }),
    );
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    render(<ExportDiagnosticsButton exportPath="/custom/export" />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Exported to diag-123.zip');
    expect(globalThis.fetch).toHaveBeenCalledWith('/custom/export', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
  });

  it('reports the HTTP status text on a failed export request', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.reject() }),
    );
    render(<ExportDiagnosticsButton />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Export failed: 500 Server Error');
  });

  it('applies host label overrides', async () => {
    const user = userEvent.setup();
    const desktopBridge = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/diag.zip' }),
    };
    render(
      <ExportDiagnosticsButton
        desktopBridge={desktopBridge}
        labels={{ button: 'Save logs', success: (p) => `Saved: ${p}` }}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('Save logs');
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('Saved: /tmp/diag.zip');
  });
});
