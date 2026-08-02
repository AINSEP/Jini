import { useCallback, useEffect, useMemo, useState } from 'react';
import { createFakeMcpIntegrationsPort } from '../../dependencies.js';
import type { McpIntegrationsPort } from '../../ports.js';

export interface CodexInstallToggleController {
  /** `null` while the initial status fetch is in flight; `false` once
   *  resolved with no port support or the fetch failed. */
  available: boolean | null;
  installed: boolean;
  busy: boolean;
  error: string | null;
  /**
   * Set once, right after a successful install/uninstall — origin:
   * `CodexInstallToggle`'s `message` state (`{ kind: 'success', text:
   * t('settings.mcpCodex{Install,Uninstall}Success') }`), shown next to the
   * button until the next toggle. Cleared at the start of every `toggle()`
   * call, same as `error`.
   */
  successKind: 'installed' | 'uninstalled' | null;
  toggle: () => void;
}

/**
 * One-click Codex MCP install/uninstall: queries whether the host's daemon
 * exposes Codex install support at all (`available`), and if so, whether
 * this server is currently registered (`installed`). Origin:
 * `CodexInstallToggle` in `SettingsDialog.tsx` — the daemon-transport calls
 * (`fetch('/api/mcp/install/codex...')`) are now routed through the
 * injected `McpIntegrationsPort`'s optional Codex methods.
 */
export function useCodexInstallToggle(
  port: Pick<McpIntegrationsPort, 'fetchCodexInstallStatus' | 'installCodexMcp' | 'uninstallCodexMcp'>,
): CodexInstallToggleController {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successKind, setSuccessKind] = useState<'installed' | 'uninstalled' | null>(null);

  const refresh = useCallback(async () => {
    if (!port.fetchCodexInstallStatus) {
      setAvailable(false);
      setInstalled(false);
      return;
    }
    try {
      const status = await port.fetchCodexInstallStatus();
      setAvailable(status.available);
      setInstalled(status.installed);
    } catch {
      // Daemon unreachable or endpoint missing — hide the toggle entirely
      // rather than surface a permanent error for an optional feature.
      setAvailable(false);
      setInstalled(false);
    }
    // `port` is host-supplied once; re-creating this callback per render
    // would refetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      setSuccessKind(null);
      const wasInstalled = installed;
      try {
        if (wasInstalled) {
          await port.uninstallCodexMcp?.();
        } else {
          await port.installCodexMcp?.();
        }
        await refresh();
        setSuccessKind(wasInstalled ? 'uninstalled' : 'installed');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed, refresh]);

  return { available, installed, busy, error, successKind, toggle };
}

/**
 * Zero-arg wirer: `useCodexInstallToggle` bound to this feature's own
 * `dependencies.ts` concrete port. Per this repo's `useX`/`useWiredX`
 * convention, this is the only export in this file allowed to import
 * `dependencies.ts` — a host with its own daemon should call
 * `useCodexInstallToggle` directly with its own `McpIntegrationsPort`
 * instead. Since this feature ships no real transport (see `ports.ts`), the
 * "concrete" port wired here is the same in-memory fake `useWiredMcpInstallInfo`
 * wires in.
 */
export function useWiredCodexInstallToggle(): CodexInstallToggleController {
  const port = useMemo(() => createFakeMcpIntegrationsPort(), []);
  return useCodexInstallToggle(port);
}
