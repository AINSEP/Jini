import { useCallback, useMemo, useRef, useState } from "react";
import type { ChatPaneAgent, ChatPaneRuntimeAccess } from "../../../../react/kit.js";

import type { AgentsLoader } from "./agents-inventory.hooks.js";

/**
 * Builds the `runtimeAccess` object `AssistantDock.tsx` passes to `<ChatPane>` — the Local CLI
 * picker's agent list, rescan, and daemon-online poll. Injectable per `INFO.md`'s Components rule 3
 * (real I/O: all three members are `fetch`-backed) — defaulted to the real hook on
 * `AssistantDockProps`.
 *
 * `listAgents` reads through the shared query cache ({@link useAgentsLoader}), so a remounted pane,
 * a conversation switch, or a second screen gets completed inventory without another request.
 * Due reads join one GET for this boot. Pending snapshots use bounded backoff in Jini;
 * `getAgentsRefreshAt` aligns those retries with the shared cache, including across pane remounts.
 * completed catalogs honor server expiry, with a 15-minute maximum and 30-second failure cooldown.
 * A non-2xx or empty answer REJECTS and is never cached (see {@link readAgentsResponse}): `ChatPane` then
 * shows "Connecting to the assistant…" and retries until the daemon answers.
 *
 * `rescanAgents` writes its answer into that cache. It falls back to a plain re-fetch of the same
 * `/api/agents` GET whenever the rescan POST itself gives no usable answer; when that fails too it
 * rejects, and `ChatPane` keeps whatever agents are currently known instead of going blank.
 *
 * @returns The memoized inventory, refresh-deadline, rescan and health access `ChatPane` reads.
 * @example
 * const runtimeAccess = useRuntimeAccess();
 */
export function useRuntimeAccess(
  { useLoader, readDaemonOnline, recordAgents, rescanAgentsInto }: {
    useLoader: (required: Record<string, never>) => AgentsLoader;
    readDaemonOnline: () => Promise<boolean>;
    recordAgents: (required: { agents: ChatPaneAgent[] }) => ChatPaneAgent[];
    rescanAgentsInto: (required: { loader: AgentsLoader }) => Promise<ChatPaneAgent[]>;
  },
  _optional: Record<string, never> = {},
): ChatPaneRuntimeAccess {
  const loader = useLoader({});
  const pendingHealth = useRef<Promise<boolean> | null>(null);
  const daemonOnline = useCallback(() => {
    if (pendingHealth.current) return pendingHealth.current;
    const pending = readDaemonOnline().finally(() => { pendingHealth.current = null; });
    pendingHealth.current = pending;
    return pending;
  }, [readDaemonOnline]);
  return useMemo(
    () => ({
      listAgents: () => loader.load().then(agents => recordAgents({ agents })),
      getAgentsRefreshAt: loader.refreshAt,
      rescanAgents: () => rescanAgentsInto({ loader }),
      // A health probe must reach loopback even when the browser reports no internet connection.
      daemonOnline,
    }),
    [loader, daemonOnline, recordAgents, rescanAgentsInto],
  );
}

/**
 * The inventory `ChatPane` shows before its own `listAgents` call resolves (its `agents` prop, read
 * once per pane mount): the cached live list when this tab already has one, otherwise the last list
 * this browser saw (`readAgentsSnapshot` in `lib/shell-collaborators.ts`), otherwise nothing — the pre-existing
 * "Loading available CLIs" state. Re-read every render so a pane re-keyed by a conversation switch
 * seeds from the live list rather than the snapshot the dock mounted with.
 *
 * @returns The placeholder list, or `undefined` when there is none.
 * @example
 * const agentsPlaceholder = useAgentsPlaceholder();
 */
export function useAgentsPlaceholder(
  { useLoader, readAgentsSnapshot }: { useLoader: (required: Record<string, never>) => AgentsLoader; readAgentsSnapshot: () => readonly ChatPaneAgent[] | undefined },
  _optional: Record<string, never> = {},
): readonly ChatPaneAgent[] | undefined {
  const loader = useLoader({});
  const [snapshot] = useState(readAgentsSnapshot);
  return loader.peek() ?? snapshot;
}

export function useRuntimeAccessSeam({ override, useRuntimeAccessHook }: { override: (() => ChatPaneRuntimeAccess) | undefined; useRuntimeAccessHook: () => ChatPaneRuntimeAccess }, _options: Record<string, never> = {}): ChatPaneRuntimeAccess {
  return (override ?? useRuntimeAccessHook)();
}

function useNoAgentsPlaceholder(): undefined {
  return undefined;
}

/** {@link useAgentsPlaceholder} reads the REAL runtime access's cache, so it only applies when that
 *  real access is in use: an injected `useRuntimeAccess` fake has no cache to seed from. */
export function useAgentsPlaceholderSeam({ runtimeAccessOverride, usePlaceholder }: { runtimeAccessOverride: (() => ChatPaneRuntimeAccess) | undefined; usePlaceholder: () => readonly ChatPaneAgent[] | undefined }, _optional: Record<string, never> = {}
): readonly ChatPaneAgent[] | undefined {
  return (runtimeAccessOverride ? useNoAgentsPlaceholder : usePlaceholder)();
}

