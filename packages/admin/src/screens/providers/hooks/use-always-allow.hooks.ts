import { useEffect, useState } from "react";

import type { useFetchMutation as UseFetchMutationHook, useFetchQuery as UseFetchQueryHook } from "../../../react/kit.js";
import { ALWAYS_ALLOW_KEYS, formatGrantedAt, groupAlwaysAllow, type AlwaysAllowGroup } from "../always-allow-rules.js";
import type { AlwaysAllowPort } from "../always-allow-ports.js";

/**
 * @file Everything the Integrations "Always allow" tab does, so `AlwaysAllowPanel.tsx` is only
 * markup: load the saved approvals (labelled from the roster), and revoke one.
 *
 * No confirm step (owner call 2026-09-28): revoking is reversible — the tool just asks again.
 * A revoke that 404s means the row is already gone (another tab, or the server was removed), which
 * is the outcome the owner asked for, so it refreshes the list rather than showing an error.
 *
 * A revoked row is hidden at once rather than after the list's refetch lands, so it never sits
 * there looking un-revoked; the next load of the list (which already reflects the revoke) clears
 * that local state. The list always revalidates on mount and on window focus: a grant happens on
 * a chat card, in any window, so no write on this page could invalidate it.
 */

export interface AlwaysAllowController {
  /** `null` until the first load finishes. */
  groups: AlwaysAllowGroup[] | null;
  loadError: string | null;
  revokeError: string | null;
  /** `serverId` + `toolName` of the revoke in flight, so only that row's button disables. */
  pendingKey: string | null;
  revoke: (input: { serverId: string; toolName: string }, options?: Record<string, never>) => void;
  /** Stable row key, shared by `pendingKey` and the markup. */
  rowKey: (input: { serverId: string; toolName: string }, options?: Record<string, never>) => string;
  formatDate: (input: { grantedAt: string }, options?: Record<string, never>) => string;
  t: (key: string) => string;
}

/** The host's request error carries the HTTP status; a 404 means the approval is already gone, whichever error class the host uses. */
function isNotFound(error: unknown, _optional: Record<string, never> = {}): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 404;
}

const rowKey = ({ serverId, toolName }: { serverId: string; toolName: string }, _options: Record<string, never> = {}): string => JSON.stringify([serverId, toolName]);

/**
 * @complexity O(a + s + g log g) per render, from {@link groupAlwaysAllow}.
 */
export function useAlwaysAllow({ port, t, locale, useFetchQuery, useFetchMutation }: { port: AlwaysAllowPort; t: (key: string) => string; locale: string; useFetchQuery: typeof UseFetchQueryHook; useFetchMutation: typeof UseFetchMutationHook }, _options: Record<string, never> = {}): AlwaysAllowController {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(() => new Set());

  const list = useFetchQuery({
    key: ALWAYS_ALLOW_KEYS.list,
    fetch: async () => {
      const [{ approvals }, { servers }] = await Promise.all([port.listExternalMcpToolApprovals(), port.listExternalMcpServers()]);
      return { approvals, servers };
    },
  }, {
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  useEffect(() => setRevoked(new Set()), [list.data]);

  const revokeMutation = useFetchMutation({
    run: async ({ input: { serverId, toolName } }: { input: { serverId: string; toolName: string } }) => {
      try {
        return await port.revokeExternalMcpToolApproval({ serverId, toolName });
      } catch (error) {
        if (isNotFound(error)) return { removed: false };
        throw error;
      }
    },
  }, {
    invalidates: [ALWAYS_ALLOW_KEYS.list],
  });

  function revoke({ serverId, toolName }: { serverId: string; toolName: string }, _options: Record<string, never> = {}): void {
    setRevokeError(null);
    const key = rowKey({ serverId, toolName });
    setPendingKey(key);
    revokeMutation
      .mutate({ input: { serverId, toolName } })
      .then(() => setRevoked((current) => new Set(current).add(key)))
      .catch(() => setRevokeError(t("Couldn't revoke. Try again.")))
      .finally(() => setPendingKey(null));
  }

  const approvals = list.data?.approvals.filter((row) => !revoked.has(rowKey({ serverId: row.serverId, toolName: row.toolName })));

  return {
    groups: list.data && approvals ? groupAlwaysAllow(approvals, list.data.servers) : null,
    loadError: list.error && !list.data ? t("Couldn't load this list.") : null,
    revokeError,
    pendingKey,
    revoke,
    rowKey,
    formatDate: ({ grantedAt }, _options = {}) => formatGrantedAt({ grantedAt, locale }),
    t,
  };
}
