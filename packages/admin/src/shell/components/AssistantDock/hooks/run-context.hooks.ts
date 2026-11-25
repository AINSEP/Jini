import { adminFrontendTabId } from "../../../lib/admin-frontend-session.js";
import type { SelectedComposerSkill } from "../../../../screens/plugins/selected-skills.js";
import { useMemo } from "react";
import type { FrontendSessionBridge } from "../../../../react/kit.js";

import { readAgentScreenContext, type AgentScreenContext } from "../../../lib/agent-screen-context.js";

/** `value === undefined ? {} : { [key]: value }` as a named helper — same complexity-budget
 *  rationale as `use-external-mcp.hooks.ts`'s `includeIfDefined`: moves this branch out of
 *  {@link resolveRunContext}'s own scope without changing what it sends on the wire. */
function includeIfDefined<K extends string, V>({ key, value }: { key: K; value: V | undefined }, _options: Record<string, never> = {}): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** `typeof value === "string" && value.length > 0 ? { [key]: value } : {}` as a named helper —
 *  same rationale as {@link includeIfDefined}: each of {@link resolveRunContext}'s "send only when
 *  a real value is present" string fields was its own two-branch (`&&` + ternary) contributor to
 *  that function's own complexity. Same value, same "absent means default" behavior.
 *
 *  `null` is accepted alongside `undefined` and treated identically — `conversationId` is
 *  `chats.activeId`, which is `null` (not `undefined`) between chats. The `typeof` guard already
 *  excluded it; only the parameter type had not said so. */
function includeIfNonEmptyString<K extends string>({ key, value }: { key: K; value: string | null | undefined }, _options: Record<string, never> = {}): { [P in K]?: string } {
  return (typeof value === "string" && value.length > 0 ? { [key]: value } : {}) as { [P in K]?: string };
}

/** Same rationale as {@link includeIfNonEmptyString}, for `pluginRefIds` — a non-empty readonly
 *  array rather than a non-empty string. */
function includeIfNonEmptyArray<K extends string, V>({ key, value }: { key: K; value: readonly V[] | undefined }, _options: Record<string, never> = {}): { [P in K]?: readonly V[] } {
  return (value && value.length > 0 ? { [key]: value } : {}) as { [P in K]?: readonly V[] };
}

/**
 * Builds the per-call run context the daemon reads `frontendBindToken`/`model` out of
 * (`assistant-transport.ts`'s `contextRef` wiring). Omits each key entirely when absent, rather
 * than sending it as `undefined` or an empty string, matching the daemon's own "absent means
 * default" contract for both fields.
 *
 * `model` is forwarded opaque and unfiltered — including the `'default'` sentinel
 * (`DEFAULT_MODEL_OPTION.id`, `@jini-ai/agent-runtime`) that `ChatPane`'s own selection resolution
 * falls back to when nothing else is picked. Every agent def's `buildArgs` (and
 * `resolveModelForAgent`) already treats `'default'`/absent identically as "omit `--model`, defer
 * to the CLI's own config" — that is the one place this decision is made; duplicating the check
 * here would only be a second copy of it to keep in sync.
 *
 * @param input.bindToken - The current tab's page-control bind token, or `undefined` if unbound.
 * @param input.model - The Local CLI picker's live model selection, or `undefined` before a
 *   selection has resolved (e.g. no agents detected yet).
 * @param input.pluginRefIds - {@link UseSelectedAgentPlugins.selectedPluginRefIds} — the
 *   composer's currently-pinned Agent Plugin chips.
 * @param input.conversationId - `chats.activeId` (`useChatsSeam`) — the same id already passed to
 *   `<ChatPane conversationId={...}>` for message persistence. Lets `agent-daemon-server.ts`'s
 *   `onStarted` key its per-conversation agent-CLI session lookup (`Jini packages/daemon/src/session-coordination.ts`,
 *   `RunEndPayload.sessionRef`'s round trip) — see that file's own doc. `undefined` before any
 *   conversation is active (e.g. `chats.activeId` is `null` right after "New chat").
 * @returns The context object to merge into a run's `contextRef`.
 * @example
 * const context = resolveRunContext({ bindToken: agentBridge?.bindToken(), model: selection.model, pluginRefIds, conversationId });
 */
export function resolveRunContext(
  { bindToken, model, reasoning, pluginRefIds, selectedSkills, conversationId, pageContext }: {
    bindToken: string | undefined;
    model?: string | undefined;
    reasoning?: string | undefined;
    pluginRefIds?: readonly string[] | undefined;
    selectedSkills?: readonly SelectedComposerSkill[] | undefined;
    conversationId?: string | null | undefined;
    /** `readAgentScreenContext()` at send time — the screen "this page" refers to. */
    pageContext?: AgentScreenContext | undefined;
  },
): {
  frontendBindToken?: string;
  model?: string;
  reasoning?: string;
  pluginRefIds?: readonly string[];
    selectedSkills?: readonly SelectedComposerSkill[];
  conversationId?: string;
  pageContext?: AgentScreenContext;
} {
  return {
    ...includeIfDefined({ key: "frontendBindToken", value: bindToken }),
    ...includeIfNonEmptyString({ key: "model", value: model }),
    // The Execution tab's persisted "Reasoning effort" pick, carried on exactly the same terms as
    // `model` — including the empty-string omission, since `""` is the ledger's own "no explicit
    // effort" and sending it would mean the same thing as sending nothing while looking like a
    // real selection on the wire.
    ...includeIfNonEmptyString({ key: "reasoning", value: reasoning }),
    // Omitted entirely when empty, same "absent means none" convention as the two fields above —
    // a run with no pinned plugin carries no key for it, matching `attachmentIds`'s own posture in
    // `assistant-transport.ts`'s `buildLocalCliContextRef`.
    ...includeIfNonEmptyArray({ key: "pluginRefIds", value: pluginRefIds }),
    ...includeIfNonEmptyArray({ key: "selectedSkills", value: selectedSkills }),
    ...includeIfNonEmptyString({ key: "conversationId", value: conversationId }),
    ...includeIfDefined({ key: "pageContext", value: pageContext }),
  };
}

/**
 * Builds the `runContext` callback `AssistantDock.tsx` passes to `<ChatPane>` — a thin memoized
 * wrapper around {@link resolveRunContext}. Pure derivation, not I/O of its own (`agentBridge` is
 * caller-owned, `model` is a plain string); no `INFO.md` rule-3 seam.
 *
 * A function, and the token read *inside* it via `agentBridge?.bindToken()`, because `EventSource`
 * reconnects on its own — a daemon restart, a sleeping laptop, an ordinary blip — and every reattach
 * mints a new session and a new token. Capturing the value once would keep sending a dead one, and
 * the only symptom would be the agent being told "no frontend is bound to this run" on every page
 * call, long after the reconnect that caused it.
 *
 * Depends on `agentBridge` identity rather than reading a ref: the bridge object is stable for the
 * tab's lifetime, so this rebuilds only when page control genuinely appears or goes away. Also
 * depends on `model` (not the whole `localCliSelection` object, which would rebuild on every
 * keystroke-equivalent picker interaction that leaves the model alone) so a run started right after
 * a model pick carries it — {@link useLocalCliSelection} owns the picker's live value, and this is
 * the one place that value needs to leave React state.
 *
 * @param input.agentBridge - This tab's page-control connection, or `null`/`undefined` if unbound.
 * @param input.model - {@link UseLocalCliSelection.localCliSelection}`.model`, the live picker
 *   value.
 * @param input.reasoning - The selected agent's persisted reasoning effort
 *   (`selectedLocalCliReasoning`, `lib/execution-settings.ts`). Read from the ledger rather than
 *   from a dock-local picker because the Execution tab owns that control; same "rebuild when it
 *   changes" posture as `model`, so flipping the effort takes effect on the NEXT message.
 * @param input.pluginRefIds - {@link UseSelectedAgentPlugins.selectedPluginRefIds}, read fresh on
 *   every rebuild — same "never captured, always the live value" posture as `model`, so pinning or
 *   removing a chip mid-session takes effect on the NEXT message without forcing a new callback
 *   identity mid-render.
 * @param input.conversationId - {@link resolveRunContext}'s own `conversationId` doc — forwarded
 *   straight through, same "rebuild when it changes" posture as `model`/`pluginRefIds`.
 * @param input.readScreenContext - Reads the admin screen the operator is on; called inside the
 *   callback, like `bindToken()`, because navigation does not rebuild this callback. Defaults to
 *   `lib/agent-screen-context.ts`'s real store; a test passes its own.
 * @returns The memoized `runContext` callback.
 * @example
 * const runContext = useRunContext({ agentBridge, model: localCliSelection.model, pluginRefIds: selectedPluginRefIds, conversationId: chats.activeId });
 */
export function useRunContext(
  { agentBridge, model, reasoning, pluginRefIds, selectedSkills, conversationId, readScreenContext = readAgentScreenContext }: {
    agentBridge: FrontendSessionBridge | null | undefined;
    model?: string | undefined;
    reasoning?: string | undefined;
    pluginRefIds?: readonly string[] | undefined;
    selectedSkills?: readonly SelectedComposerSkill[] | undefined;
    conversationId?: string | null | undefined;
    readScreenContext?: () => AgentScreenContext | undefined;
  },
): () => {
  frontendTabId: string;
  frontendBindToken?: string;
  model?: string;
  reasoning?: string;
  pluginRefIds?: readonly string[];
    selectedSkills?: readonly SelectedComposerSkill[];
  conversationId?: string;
  pageContext?: AgentScreenContext;
} {
  return useMemo(
    () => () =>
      ({ ...resolveRunContext({
        bindToken: agentBridge?.bindToken(),
        model,
        reasoning,
        pluginRefIds,
        selectedSkills,
        conversationId,
        pageContext: readScreenContext(),
      }), frontendTabId: adminFrontendTabId }),
    [agentBridge, model, reasoning, pluginRefIds, selectedSkills, conversationId, readScreenContext],
  );
}

