import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedLoader, useFetchQuery } from "../../react/kit.js";
import { useAdminBootScope } from "../../shell/lib/admin-boot-scope.js";
import { subscribeToSettingsRefresh } from "../../shell/lib/settings-refresh-bus.js";
import type {
  VisitorToolLimits, VisitorToolMode, VisitorToolsPort, VisitorToolsView, VisitorToolView,
} from "@jini-ai/core/contracts/site/api-ai-assistant-api-types";

const queryKey = ["ai-assistant", "visitor-tools"] as const;
export type VisitorToolsNotice = { kind: "conflict" | "error"; message: string } | null;
export type VisitorToolChange = { toolId: string; mode?: VisitorToolMode; limits?: Partial<VisitorToolLimits> };
export type LimitsDraft = { perIpPerHour: string; perSitePerDay: string };
/** What the host binds: its settings-ledger namespace for the policy, how it recognises the 409
 * revision conflict, and its own error-to-copy rule. */
export interface VisitorToolsDependencies {
  port: VisitorToolsPort;
  namespace: string;
  isConflict: (required: { error: unknown }, optional?: Record<string, never>) => boolean;
  describeError: (required: { error: unknown; fallback: string }, optional?: Record<string, never>) => string;
}
const LIMIT_KEYS = ["perIpPerHour", "perSitePerDay"] as const;

/** Server sources in display order; a heading is drawn only when more than one is present.
 * @complexity O(n) over the bounded (≤128) catalog. */
export function groupVisitorTools(required: { tools: readonly VisitorToolView[] }, _optional = {}) {
  const order: VisitorToolView["source"][] = ["builtin", "plugin", "created", "unavailable"];
  return order.map(source => ({ source, tools: required.tools.filter(tool => tool.source === source) }))
    .filter(group => group.tools.length > 0);
}

/** A tool can only be raised when its source contract is available and the stored policy is readable.
 * Off stays clickable for an unavailable tool: the server accepts that one change for it.
 * @complexity O(1). */
export function modeDisabled(required: { tool: VisitorToolView; mode: VisitorToolMode; invalid: boolean; busy: boolean }, _optional = {}) {
  if (required.busy || required.invalid) return true;
  return required.mode !== "off" && !required.tool.availability.available;
}

/** Parses a limits draft into only the dimensions that changed. Quotas are positive safe integers
 * (zero is invalid, never "unlimited"), matching the server's own parser.
 * @returns `{ error }` for any bad field, else `{ patch }` (empty when nothing changed).
 * @complexity O(1) for the two fixed dimensions. */
export function parseLimitsDraft(required: { draft: LimitsDraft; current: VisitorToolLimits }, _optional = {}):
  { error: true } | { error: false; patch: Partial<VisitorToolLimits> } {
  const patch: Partial<VisitorToolLimits> = {};
  for (const key of LIMIT_KEYS) {
    const text = required.draft[key].trim();
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < 1) return { error: true };
    if (value !== required.current[key]) patch[key] = value;
  }
  return { error: false, patch };
}

export function limitsToDraft(required: { limits: VisitorToolLimits }, _optional = {}): LimitsDraft {
  return { perIpPerHour: String(required.limits.perIpPerHour), perSitePerDay: String(required.limits.perSitePerDay) };
}

// The namespace and the conflict/error rules arrive with the port (VisitorToolsDependencies).
/**
 * Visitor tools tab controller: the same service the chat's `visitor_tools_list`/`visitor_tool_configure`
 * use, read through Jini's query cache and refetched when the shared settings feed names
 * `site.assistant` (a chat write lands here without a reload).
 *
 * Every write carries the view's `revisionSeq`. A 409 means someone (another tab, the chat) saved
 * first: refetch and say so, never retry — a silent retry could re-publish over a change the
 * operator has not seen. One write at a time; a second click while saving is ignored.
 * @param required - Injected port and translation.
 * @complexity O(1) per change plus one bounded request.
 */
export function useVisitorTools(required: VisitorToolsDependencies & { t: (key: string) => string }, _optional = {}) {
  const { port, t, namespace, isConflict, describeError } = required;
  const { queryScope, checking } = useAdminBootScope();
  const key = useMemo(() => [...queryKey, queryScope], [queryScope]);
  const fetchView = useCallback(() => port.list({}), [port]);
  const query = useFetchQuery({ key, fetch: fetchView }, { enabled: !checking, staleTime: Infinity });
  const loader = useCachedLoader({ key, fetch: fetchView }, { staleTime: Infinity });
  const refetch = query.refetch;
  useEffect(() => subscribeToSettingsRefresh(namespaces => {
    if (namespaces === null || namespaces.includes(namespace)) refetch();
  }), [refetch, namespace]);
  const locked = useRef(false);
  const [busyToolId, setBusyToolId] = useState<string | null>(null);
  const [notice, setNotice] = useState<VisitorToolsNotice>(null);
  const view: VisitorToolsView | null = query.data ?? null;

  /** @returns true when the server accepted the change. */
  async function configure(change: VisitorToolChange, _options = {}): Promise<boolean> {
    if (locked.current || !view) return false;
    locked.current = true; setBusyToolId(change.toolId); setNotice(null);
    try {
      loader.replace({ value: await port.configure({ ...change, expectedRevisionSeq: view.revisionSeq }) });
      return true;
    } catch (error) {
      if (isConflict({ error })) {
        setNotice({ kind: "conflict", message: t("Changed somewhere else. Showing the latest — try again.") });
        refetch();
      } else setNotice({ kind: "error", message: describeError({ error, fallback: t("Could not save.") }) });
      return false;
    } finally { locked.current = false; setBusyToolId(null); }
  }

  return {
    view, loading: !view && !query.error, loadError: query.error ? describeError({ error: query.error, fallback: t("Could not load visitor tools.") }) : null,
    invalid: view?.policyState === "invalid", busyToolId, notice, configure, retry: refetch,
    /** The only write an unreadable policy accepts: every tool Off, no limits, no approval card. */
    repair: () => configure({ toolId: "site", mode: "off" }),
  };
}
export type VisitorToolsController = ReturnType<typeof useVisitorTools>;

/** Per-row limits draft: typing, change and blur only touch local state; only `save()` (bound to an
 * explicit Save click) sends a PUT (security review F2 — a page fill must never publish).
 * @complexity O(1). */
export function useVisitorToolLimitsDraft(required: { tool: VisitorToolView; configure: VisitorToolsController["configure"] }, _optional = {}) {
  const { tool, configure } = required;
  const [draft, setDraft] = useState<LimitsDraft | null>(null);
  const shown = draft ?? limitsToDraft({ limits: tool.limits });
  const parsed = parseLimitsDraft({ draft: shown, current: tool.limits });
  const dirty = !parsed.error && Object.keys(parsed.patch).length > 0;
  return {
    draft: shown, invalid: parsed.error, dirty,
    edit: ({ key, value }: { key: keyof LimitsDraft; value: string }, _options: Record<string, never> = {}) => setDraft({ ...shown, [key]: value }),
    reset: () => setDraft(null),
    save: async () => {
      if (parsed.error || !dirty) return;
      if (await configure({ toolId: tool.id, limits: parsed.patch })) setDraft(null);
    },
  };
}
