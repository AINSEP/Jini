import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';

/**
 * Injectable bridge for a native (e.g. Electron) shell that can save the
 * exported archive via a native save dialog. When not supplied, the button
 * falls back to a browser download via `exportPath`.
 */
export interface DesktopExportBridge {
  exportDiagnostics(): Promise<
    | { ok: true; path: string }
    | { ok: false; cancelled: true }
    | { ok: false; cancelled: false; message: string }
  >;
}

export const STATUS_CLEAR_MS = 6000;

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

/**
 * Extract a filename from a `Content-Disposition` header, understanding the
 * RFC 5987 `filename*=UTF-8''…`, the quoted `filename="…"`, and the bare
 * `filename=…` forms. Returns null when the header is absent or carries no
 * filename token. The non-null assertion on the alternation is sound: each of
 * the three regex branches captures a non-empty group, so a successful match
 * always yields a defined `raw`.
 */
export function fileNameFromHeader(header: string | null): string | null {
  if (header == null) return null;
  const match = /filename\*=UTF-8''([^;\n]+)|filename="([^"]+)"|filename=([^;\n]+)/i.exec(header);
  if (match == null) return null;
  const raw = (match[1] ?? match[2] ?? match[3])!;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

/** Timestamped `<prefix>-<iso>.zip` name for the browser-download fallback. */
export function fallbackFilename(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.zip`;
}

/**
 * Fetch the archive from a same-origin HTTP endpoint and trigger a browser
 * download via a transient anchor. Resolves with the saved filename; throws an
 * Error (carrying the server message when available) on a non-OK response.
 */
export async function exportViaHttp(
  exportPath: string,
  filenamePrefix: string,
): Promise<{ filename: string }> {
  const res = await fetch(exportPath, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body.message === 'string') message = body.message;
    } catch {
      // ignore body parse errors
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = fileNameFromHeader(res.headers.get('content-disposition')) ?? fallbackFilename(filenamePrefix);
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { filename };
}

export type ExportLabels = Partial<{
  button: string;
  exporting: string;
  success: (path: string) => string;
  failed: (message: string) => string;
}>;

export interface ExportDiagnosticsButtonProps {
  /** HTTP endpoint used when no `desktopBridge` is supplied. */
  exportPath?: string;
  /** Filename prefix for the browser-download fallback. */
  filenamePrefix?: string;
  /** Native-shell export bridge (e.g. Electron's contextBridge API). When
   *  present, used instead of the HTTP fallback. */
  desktopBridge?: DesktopExportBridge;
  labels?: ExportLabels;
}

export const DEFAULT_EXPORT_LABELS = {
  button: 'Export diagnostics',
  exporting: 'Exporting…',
  success: (path: string) => `Exported to ${path}`,
  failed: (message: string) => `Export failed: ${message}`,
};

export type ResolvedExportLabels = typeof DEFAULT_EXPORT_LABELS;

/** Merge host label overrides onto the built-in English defaults. */
export function resolveExportLabels(labels?: ExportLabels): ResolvedExportLabels {
  return { ...DEFAULT_EXPORT_LABELS, ...labels };
}

export interface UseAutoClearStatusResult {
  status: ExportStatus;
  setStatus: (next: ExportStatus) => void;
  /** (Re)arm a timer that returns the status to `idle` after `clearMs`. */
  scheduleClear: () => void;
}

/**
 * Owns the export status plus a single self-cancelling "clear back to idle"
 * timer. Re-arming replaces any pending timer, and the timer is cancelled on
 * unmount so it never fires against an unmounted tree. Exported for isolated
 * testing (drive it with fake timers).
 */
export function useAutoClearStatus(clearMs: number = STATUS_CLEAR_MS): UseAutoClearStatusResult {
  const [status, setStatus] = useState<ExportStatus>({ kind: 'idle' });
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
  }, []);

  const scheduleClear = useCallback(() => {
    if (clearTimer.current != null) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setStatus({ kind: 'idle' }), clearMs);
  }, [clearMs]);

  return { status, setStatus, scheduleClear };
}

export interface UseExportDiagnosticsResult {
  status: ExportStatus;
  busy: boolean;
  labels: ResolvedExportLabels;
  /** Run an export (native bridge if present, else HTTP). No-ops while busy. */
  runExport: () => Promise<void>;
}

/**
 * All of the button's behavior — status transitions, the native/HTTP branch,
 * and the busy re-entrancy guard — with no rendering. The `if (busy) return`
 * guard is unreachable through the rendered button (it's `disabled` while
 * busy) but reachable by calling `runExport` twice through this hook.
 * {@link ExportDiagnosticsButton} is the dumb consumer.
 */
export function useExportDiagnostics(props: ExportDiagnosticsButtonProps): UseExportDiagnosticsResult {
  const {
    exportPath = '/api/diagnostics/export',
    filenamePrefix = 'diagnostics',
    desktopBridge,
    labels,
  } = props;
  const t = resolveExportLabels(labels);
  const { status, setStatus, scheduleClear } = useAutoClearStatus();

  const runExport = useCallback(async () => {
    if (status.kind === 'busy') return;
    setStatus({ kind: 'busy' });
    try {
      if (desktopBridge != null) {
        const result = await desktopBridge.exportDiagnostics();
        if (result.ok) {
          setStatus({ kind: 'success', message: t.success(result.path) });
          scheduleClear();
          return;
        }
        if (result.cancelled) {
          setStatus({ kind: 'idle' });
          return;
        }
        setStatus({ kind: 'error', message: t.failed(result.message) });
        scheduleClear();
        return;
      }
      const { filename } = await exportViaHttp(exportPath, filenamePrefix);
      setStatus({ kind: 'success', message: t.success(filename) });
      scheduleClear();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ kind: 'error', message: t.failed(message) });
      scheduleClear();
    }
  }, [desktopBridge, exportPath, filenamePrefix, scheduleClear, setStatus, status.kind, t]);

  return { status, busy: status.kind === 'busy', labels: t, runExport };
}

/**
 * Renders a labeled button with a short status line below it. Works with
 * either a native shell (via `desktopBridge`) or a browser download
 * (via `exportPath`, a same-origin HTTP endpoint that returns the archive).
 * All logic lives in {@link useExportDiagnostics}; this is a dumb render.
 */
export function ExportDiagnosticsButton(props: ExportDiagnosticsButtonProps) {
  const { status, busy, labels: t, runExport } = useExportDiagnostics(props);
  return (
    <div className="diagnostics-export-row">
      <button
        type="button"
        className="ghost diagnostics-export-button"
        onClick={() => void runExport()}
        disabled={busy}
        data-status={status.kind}
      >
        <Icon name="download" size={14} />
        <span>{busy ? t.exporting : t.button}</span>
      </button>
      {status.kind === 'success' || status.kind === 'error' ? (
        <p className={`diagnostics-export-status ${status.kind}`} role="status">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
