import { useEffect, useMemo, useState } from 'react';
import { createFakeMcpIntegrationsPort } from '../../dependencies.js';
import type { McpIntegrationsPort } from '../../ports.js';
import type { McpInstallInfo } from '../../types.js';

export interface McpInstallInfoController {
  info: McpInstallInfo | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetches `McpInstallInfo` once on mount via the injected port. Errors
 * surface as a plain message string (not thrown) so the tab can render a
 * clear inline error instead of a half-built snippet that would silently
 * fail when pasted.
 */
export function useMcpInstallInfo(port: Pick<McpIntegrationsPort, 'fetchInstallInfo'>): McpInstallInfoController {
  const [info, setInfo] = useState<McpInstallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    port
      .fetchInstallInfo()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `port` is expected to be a stable dependency (host-supplied once);
    // re-running on every render would refetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { info, error, loading };
}

/**
 * Zero-arg wirer: `useMcpInstallInfo` bound to this feature's own
 * `dependencies.ts` concrete port. Per this repo's `useX`/`useWiredX`
 * convention, this is the only export in this file allowed to import
 * `dependencies.ts` — a host with its own daemon should call `useMcpInstallInfo`
 * directly with its own `McpIntegrationsPort` instead. Since this feature
 * ships no real transport (the origin's `/api/mcp/install-info` endpoint is
 * genuinely host-specific — see `ports.ts`), the "concrete" port wired here
 * is the in-memory fake also used for this package's own tests/demos.
 */
export function useWiredMcpInstallInfo(): McpInstallInfoController {
  const port = useMemo(() => createFakeMcpIntegrationsPort(), []);
  return useMcpInstallInfo(port);
}
