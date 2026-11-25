import { readAgentPluginChatState } from '../agent-plugin-chat-state.js';
import { latestUserPromptFromHistory } from "../transcript.js";
import type { ChatMessage } from "../messages.js";
import type { RunHandlers, StartRunInput } from "../transport.js";
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";
import { historyForTranscript, newestUserMessage, resolveLocalCliPrompt, runPrompt } from "./transport-prompt.js";
import { capturePluginUsage, consumeByokStream, subscribeToRun, type TransportCtx } from "./transport-stream.js";
import type { AssistantExecutionConfig, AssistantTransportOptions } from "./transport.js";

/** Client-minted, not server-minted — see module doc's path-2 section: a BYOK run has no server-side
 *  run record to name it. Prefixed so `stopRun`/`fetchRunStatus`/`reattachRun` below can tell a
 *  BYOK-run id apart from a daemon-run id without any other context. */
function mintByokRunId({ transport }: { transport: TransportCtx }): string { return `${transport.ports.byokRunIdPrefix}${transport.ports.mintId({}, {})}`; }

/**
 * The provider-bound history of one BYOK turn: only turns the agent actually answered, never an
 * empty one, each carrying its redaction signal.
 */
function byokMessages({ history }: { history: readonly ChatMessage[] }, _optional: Record<string, never>): Array<Record<string, unknown>> {
  // `historyForTranscript` first (Defect 3, 2026-09-11): the empty-content filter below already
  // hides a failed run that produced nothing, but NOT one that emitted a few tokens before dying —
  // that partial output would be sent to the provider as if it were the assistant's answer. This is
  // the same defect as on the Local CLI path, reachable by a second route.
  return historyForTranscript({ history })
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content,
      ...(message.secretRedaction?.secretRedacted ? { secretRedacted: true } : {}),
    }));
}

/** The credential block of a BYOK turn; an empty base URL and an unset token cap are omitted. */
function byokCredentials({ byok }: { byok: AssistantExecutionConfig["byok"] }, _optional: Record<string, never>): Record<string, unknown> {
  return {
    protocol: byok.protocol,
    apiKey: byok.apiKey,
    ...(byok.baseUrl ? { baseUrl: byok.baseUrl } : {}),
    model: byok.model,
    ...(byok.maxTokens !== undefined ? { maxTokens: byok.maxTokens } : {}),
  };
}

/** The JSON body `POST byokTurnUrl` carries for one turn. */
function byokTurnBody(
  { input, byok }: { input: StartRunInput; byok: AssistantExecutionConfig["byok"] },
  _optional: Record<string, never>,
): Record<string, unknown> {
  return {
    messages: byokMessages({ history: input.history }, {}),
    ...attachmentIdsField(input),
    ...(input.folders?.length ? { folders: input.folders } : {}),
    ...conversationIdField(input),
    agentPluginState: input.context?.["agentPluginState"],
    userPrompt: input.context?.["userPrompt"],
    ...pluginRefIdsField(input),
    // The admin screen, as on the Local CLI path (`buildLocalCliContextRef`): the server puts it
    // in front of the newest message so a BYOK turn knows the open page and where drawings go.
    ...pageContextField(input),
    byok: byokCredentials({ byok }, {}),
  };
}

/**
 * The error for a refused request: `<action> (<status>)`, plus up to 300 characters of the
 * response body when it has one — shared by the BYOK start, Local CLI start and cancel refusals.
 */
export async function refusalError({ action, response }: { action: string; response: Response }, _optional: Record<string, never>): Promise<Error> {
  // A response whose body stream errors out (e.g. a dropped connection) must not turn "the server
  // rejected the request" into "the client crashed reading the rejection".
  const detail = await response.text().catch(() => "");
  const suffix = detail ? ": " + detail.slice(0, 300) : "";
  return new Error(`${action} (${response.status})${suffix}`);
}

/**
 * The BYOK run path (2026-08-04) — one held-open `POST` to `assistant-byok.ts`, no separate
 * `EventSource`/reattach. See module doc's path-2 section for why this shape differs from
 * `subscribeToRun`'s daemon-path pattern, and what it costs (no reattach after a reload; `stopRun`
 * works via the abort-controller map above instead of a server-side cancel endpoint).
 *
 * @complexity Dominated by the network/stream cost of the turn itself; per-frame parsing is O(1).
 * @overallScore 100
 */
async function startByokRun(
  { transport, input, handlers, byok }: { transport: TransportCtx; input: StartRunInput; handlers: RunHandlers; byok: AssistantExecutionConfig["byok"] },
  _optional: Record<string, never> = {},
): Promise<{ runId: string }> {
  const runId = mintByokRunId({ transport });
  const controller = new AbortController();
  transport.byokAbortControllers.set(runId, controller);
  // Conversation adoption may have yielded while the subscription was torn down.
  if (input.signal?.aborted) controller.abort();
  else input.signal?.addEventListener("abort", () => controller.abort());

  let response: Response;
  try {
    response = await transport.ports.fetch(transport.ports.byokTurnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(byokTurnBody({ input, byok }, {})),
      signal: controller.signal,
    });
  } catch (error) {
    transport.byokAbortControllers.delete(runId);
    throw error instanceof Error ? error : new Error(String(error));
  }

  if (!response.ok || !response.body) {
    transport.byokAbortControllers.delete(runId);
    throw await refusalError({ action: "BYOK turn failed to start", response }, {});
  }

  const collected: AgentEvent[] = [];
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    transport.byokAbortControllers.delete(runId);
    handlers.onDone(collected);
  };

  // Deliberately not awaited: `startRun`'s contract (matching the daemon path immediately above)
  // is to resolve `{runId}` once the turn has STARTED, not once it has finished — the response
  // headers (hence this function reaching this point at all) arrive as soon as
  // `assistant-byok.ts` calls `beginStream`, well before generation completes.
  void consumeByokStream({ transport, body: response.body, ctx: { runId, collected, handlers, finish, controller } });

  return { runId };
}

/**
 * Which browser tab a Local CLI run should be allowed to drive, from `ChatPane`'s `runContext` prop
 * (`AssistantDock.tsx` supplies it from the live `FrontendSessionBridge`).
 *
 * Read by name rather than spreading the whole `input.context` blob: `contextRef` is a shared
 * envelope that the host's proxy also writes `principalId` into (the host app's `src/server/runtime/composition/modules/assistant.ts`),
 * and a spread would let any future `runContext` key silently shadow it — an identity field being
 * overwritten by a UI prop is not a failure mode worth leaving open to save one line.
 *
 * The tab id accompanies the token so the host can verify the session owner before binding.
 * @complexity O(1) time and space.
 * @overallScore 100
 * Returns `{}` (omitting the fields entirely) when absent, which is a normal state, not an error:
 * the daemon treats a run with no bind token as one with no screen to drive
 * (`agent-daemon-server.ts`).
 */
function frontendBindingFields(input: StartRunInput): Record<string, unknown> {
  const frontendBindToken = input.context?.["frontendBindToken"];
  const frontendTabId = input.context?.["frontendTabId"];
  return {
    ...(typeof frontendBindToken === "string" && frontendBindToken.length > 0 ? { frontendBindToken } : {}),
    ...(typeof frontendTabId === "string" && frontendTabId.length > 0 ? { frontendTabId } : {}),
  };
}

/**
 * The Local CLI picker's live model selection, from `ChatPane`'s `runContext` prop
 * (`AssistantDock.tsx`'s `resolveRunContext`). Same "read by name, not spread" reasoning as
 * {@link frontendBindingFields} above, and the same "omit when absent" convention. Forwarded as an
 * opaque string — `agent-daemon-server.ts` forwards it the same way, and `AgentExecutor.run()`'s
 * def-level `buildArgs` is what decides what an absent or `'default'` value means for a given CLI
 * (`@jini-ai/agent-runtime`'s `models.ts`/`resolveModelForAgent`).
 */
function modelField(input: StartRunInput): Record<string, unknown> {
  const model = input.context?.["model"];
  return typeof model === "string" && model.length > 0 ? { model } : {};
}

/**
 * The Execution tab's "Reasoning effort" pick, from the same `runContext` seam as {@link modelField}
 * above and forwarded with the identical "opaque string, omit when absent" convention. What turns it
 * into real argv is the def's own `buildArgs` on the daemon side (`claude --effort <level>`, codex's
 * `-c model_reasoning_effort=...`) — nothing here interprets it, and a runtime whose effort is
 * encoded in the model id (antigravity) never sends it at all, because its level is already inside
 * `model`.
 */
function reasoningField(input: StartRunInput): Record<string, unknown> {
  const reasoning = input.context?.["reasoning"];
  return typeof reasoning === "string" && reasoning.length > 0 ? { reasoning } : {};
}

/**
 * Opaque `attachment:<uuid>` capability ids (`ChatAttachment.path` — never a real filesystem path
 * this early; see `@jini-ai/http-kit`'s `attachments.ts` trust-model doc), not the attachments
 * themselves — `contextRef` is the one channel `prompt`/`frontendBindToken` already ride on to reach
 * `agent-daemon-server.ts`'s `onStarted`, which is where these ids get exchanged for real,
 * re-validated paths via `AttachmentStore.claim()`. Nothing on this side of the wire is trusted; the
 * id is inert until the daemon claims it.
 *
 * Returns `{}`, same convention as {@link frontendBindingFields} above — a run with no attachments
 * is the overwhelmingly common case and should not carry a key for it.
 */
function attachmentIdsField(input: StartRunInput): Record<string, unknown> {
  return input.attachments && input.attachments.length > 0
    ? { attachmentIds: input.attachments.map((attachment) => attachment.path) }
    : {};
}

/**
 * Opaque Agent Plugin ids (`plugin.json`'s own `name`, e.g. `"ui-ux-design"`) the operator has
 * pinned as composer chips — `AssistantDock.tsx`'s `useSelectedAgentPlugins`, threaded here via
 * `ChatPane`'s `runContext` prop the same way {@link frontendBindingFields}/{@link modelField}
 * above already are. Same "read by name, not spread" and "omit when absent" conventions as those
 * two fields: this is not the plugin's CONTENT, only a reference to it —
 * `agent-daemon-server.ts`'s `onStarted` is where a ref gets resolved against the real installed
 * package on disk and its own text prepended to the prompt (see that function's own doc for the
 * resolution/failure rules). Filtered to non-empty strings for the same reason `attachmentIds` is
 * filtered on the decode side (`run-start-context.ts`'s `parseRunStartContextRef`) — this is the
 * encode side of the same wire value, and a malformed entry here should not silently become a
 * malformed one there.
 */
function pluginRefIdsField(input: StartRunInput): Record<string, unknown> {
  const pluginRefIds = input.context?.["pluginRefIds"];
  if (!Array.isArray(pluginRefIds)) return {};
  const filtered = pluginRefIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return filtered.length > 0 ? { pluginRefIds: filtered } : {};
}

/**
 * The active conversation id, from `ChatPane`'s `runContext` prop (`AssistantDock.tsx`'s
 * `chats.activeId`, the same `useRunContext` seam {@link frontendBindingFields}/{@link modelField}/
 * {@link pluginRefIdsField} above already ride). Lets `agent-daemon-server.ts`'s `onStarted` resume
 * this conversation's agent-CLI session across turns instead of spawning cold every time
 * (`server/inbound/assistant/agent-session-resume.ts`) — see that file's own doc. Returns `{}`, same
 * convention as every other optional field here: a run started before any conversation exists yet
 * (or from a future daemon client that never sends one) just gets no session-resume behavior, not
 * an error.
 */
function conversationIdField(input: StartRunInput, resolvedConversationId?: string): Record<string, unknown> {
  const conversationId = resolvedConversationId ?? input.context?.["conversationId"];
  return typeof conversationId === "string" && conversationId.length > 0 ? { conversationId } : {};
}

/**
 * The admin screen this message was sent from (`lib/agent-screen-context.ts`, read by
 * `AssistantDock.hooks.tsx`'s `useRunContext` at send time), so the agent knows what "this page"
 * means. Forwarded as-is when it is a plain object — the daemon's `run-page-context.ts` owns
 * validating and capping its fields, the same split `attachmentIds` has — and omitted otherwise.
 */
function pageContextField(input: StartRunInput): Record<string, unknown> {
  const pageContext = input.context?.["pageContext"];
  return typeof pageContext === "object" && pageContext !== null && !Array.isArray(pageContext) ? { pageContext } : {};
}

/**
 * Assembles the Local CLI path's `contextRef` — everything `startRun`'s daemon branch sends besides
 * `agentId` itself. Pulled out of `startRun` (2026-08-06, complexity pass, second pass) as its own
 * pure function, then split again (2026-09-04, complexity pass) into one pure field-helper per
 * optional field, each above: six independent, unrelated fields, none sharing state or order
 * dependence, each read from `input` by name and included only when present (see each helper's own
 * doc for why). Kept as six separate functions rather than grouped, on purpose — the fields have no
 * conceptual relationship to group them by (identity, execution config, and content all mixed
 * together), and inventing a grouping would obscure the very independence each field's own doc
 * argues for. A plain object in, a plain object out — directly testable with a `StartRunInput`
 * fixture, no `fetch`/`EventSource` involved.
 *
 * @param prompt - The already-built transcript string ({@link runPrompt}'s result) — this function
 *   only decides which of the six OPTIONAL fields ride alongside it, not how the prompt itself is
 *   built.
 * @param resolvedConversationId - {@link resolveRunConversationId}'s answer, when `startRun` had to
 *   adopt a conversation because `input.context` named none (the first turn of a chat). Omitted by
 *   every caller that already has an id on `input.context`, and by this function's own unit tests —
 *   in which case the `context` field is read exactly as before.
 * The bounded `coldStartContext` is the complete prompt, including the current request. The
 * daemon selects it instead of the resume tail when native resume is unavailable.
 */
export function buildLocalCliContextRef(
  { transport, input, prompt, resolvedConversationId }: { transport: TransportCtx; input: StartRunInput; prompt: string; resolvedConversationId?: string | undefined },
  _optional: Record<string, never> = {},
): Record<string, unknown> {
  return {
    prompt: transport.ports.projectPrompt({ prompt, context: input.context }, {}),
    // Select one complete transcript after binding; concatenating it with the tail repeats turns.
    coldStartContext: transport.ports.projectPrompt({ prompt: runPrompt({ history: input.history }), context: input.context }, {}),
    // The transcript is already sanitized; retain only the CURRENT user's signal across the
    // daemon JSON boundary. Replaying an old signal reports another paste on every later turn.
    ...(newestUserMessage({ history: input.history }, {})?.secretRedaction?.secretRedacted ? { secretRedacted: true } : {}),
    assistantMessageId: (input as StartRunInput & { assistantMessageId?: string }).assistantMessageId,
    ...frontendBindingFields(input),
    ...modelField(input),
    ...reasoningField(input),
    ...attachmentIdsField(input),
    ...(input.folders?.length ? { folders: input.folders } : {}),
    ...pluginRefIdsField(input),
    agentPluginState: input.context?.["agentPluginState"],
    userPrompt: input.context?.["userPrompt"],
    ...conversationIdField(input, resolvedConversationId),
    ...pageContextField(input),
  };
}

/**
 * The conversation id this run must carry, adopting one if the caller had none.
 *
 * @param input - `startRun`'s own input; `input.context.conversationId` wins whenever it is a
 *   non-empty string, so turn 2 onward never touches {@link ensureConversationId} and never issues a
 *   redundant `POST /conversations`.
 * @param ensureConversationId - `AssistantTransportOptions.ensureConversationId`, or
 *   `undefined` for a transport built without it (every test and any non-dock consumer).
 * @returns The id to put on the wire, or `undefined` to omit the key entirely — including when
 *   adoption failed. The `.catch` is load-bearing: `ensureConversationId`'s own contract promises
 *   `null` over a rejection, and this makes that promise safe to depend on even if a future
 *   implementation breaks it, rather than failing the user's turn over a lost session id.
 * @complexity O(1) plus at most one conversation-creation round trip, on the first turn only.
 */
async function resolveRunConversationId(
  input: StartRunInput,
  ensureConversationId: ((required: Record<string, never>, optional: Record<string, never>) => Promise<string | null>) | undefined,
): Promise<string | undefined> {
  const fromContext = input.context?.["conversationId"];
  if (typeof fromContext === "string" && fromContext.length > 0) return fromContext;
  if (!ensureConversationId) return undefined;
  const adopted = await ensureConversationId({}, {}).catch(() => null);
  return typeof adopted === "string" && adopted.length > 0 ? adopted : undefined;
}

/**
 * Writes the newest user turn to durable storage before its run is dispatched, and never fails the
 * turn over it.
 *
 * Defect 2 of the 2026-09-11 chat-lifecycle repair. Message persistence is a client-side
 * `Promise.all` driven by `onMessagesChange` deltas (`use-assistant-chats.hooks.ts`'s `flush`) and
 * run dispatch is a separate `POST /api/runs` here — nothing orders them and nothing makes them
 * atomic, so a browser or daemon death in the window between them could leave a dispatched run whose
 * prompt existed nowhere durable. Await the same PUT when a delta has already scheduled it;
 * acceptance also carries the exact user message and commits it with the assistant stub when
 * browser persistence fails, so sending does not depend on a successful separate PUT.
 *
 * The idempotency key is the message's own id — `assistant-chats.ts`'s `saveMessage` PUTs to
 * `/messages/<id>`, so this write and the `flush` that will race it converge on one row rather than
 * two, and a retry of the same content is free. `useAssistantChats`'s own `persistUserTurn` also
 * marks the id written, so in practice `flush` skips it entirely.
 *
 * @param message - The newest `role: "user"` message in `startRun`'s history — what gets written.
 *   `startRun` has already refused a history without one, so it is always present here.
 * @param conversationId - The already-resolved conversation (see `resolveRunConversationId`), or
 *   `undefined` when adoption failed — there is no row to write into in that case.
 * @param persistUserTurn - `AssistantTransportOptions.persistUserTurn`, or `undefined`
 *   for a transport built without it (every test and any non-dock consumer).
 * @returns Nothing, always. The `.catch` keeps a failed browser PUT from refusing the user's turn;
 *   durable acceptance is now responsible for committing its copy before dispatch.
 * @complexity O(1) plus one PUT.
 */
async function persistUserTurnBeforeDispatch(
  { message, conversationId }: { message: ChatMessage; conversationId: string | undefined },
  { persistUserTurn }: { persistUserTurn?: AssistantTransportOptions["persistUserTurn"] },
): Promise<void> {
  // Pending composer input is persisted by atomic run acceptance. An earlier PUT could save a
  // rejected (409) draft as a user turn; confirmed/legacy callers retain their existing ordering.
  if (message.inputPending || conversationId === undefined || persistUserTurn === undefined) return;
  await persistUserTurn({ conversationId, message }, {}).catch(() => undefined);
}

/**
 * Turns `startRun`'s Local CLI `POST /api/runs` response into either a thrown, detailed error or a
 * subscribed run — the two outcomes once the request lands. Pulled out of `startRun` (2026-09-04,
 * complexity pass) as its own step: `response.ok` in, `{runId}` or a thrown `Error` out. The
 * `.text().catch(() => "")` is load-bearing, not decorative — see {@link refusalError}'s inline comment.
 */
async function finishLocalCliRun(
  { transport, response, handlers, signal }: { transport: TransportCtx; response: Response; handlers: RunHandlers; signal: AbortSignal | undefined },
  _optional: Record<string, never> = {},
): Promise<{ runId: string }> {
  if (!response.ok) throw await refusalError({ action: "agent run failed to start", response }, {});

  const { run, messageId, conversationId } = (await response.json()) as { run: { id: string }; messageId?: string; conversationId?: string };
  if (messageId && conversationId) transport.ports.bindRun({ runId: run.id, binding: { messageId, conversationId } }, {});
  subscribeToRun({ transport, runId: run.id, handlers, signal });
  return { runId: run.id };
}

/**
 * The Local CLI path of `startRun`: durable user turn, then acceptance, then the followed run.
 *
 * @param input - `startRun`'s input with its conversation identity already merged into `context`.
 * @param userMessage - The newest user message; acceptance carries it verbatim.
 * @param conversationId - The resolved conversation, or `undefined` when adoption failed.
 */
async function startLocalCliRun(
  { transport, input, handlers, userMessage, conversationId }: { transport: TransportCtx; input: StartRunInput; handlers: RunHandlers; userMessage: ChatMessage; conversationId: string | undefined },
  { options }: { options: AssistantTransportOptions },
): Promise<{ runId: string }> {
  // Local CLI path below. `resolveLocalCliPrompt`'s own doc has the full contract for why an
  // unresolved/absent agentId fails open to the full transcript rather than the bare message.
  const prompt = resolveLocalCliPrompt({ input, resumeCapableAgentIds: options.getResumeCapableAgentIds?.({}, {}) });
  // Also before the POST, and for the same reason it is awaited rather than fired off: the
  // user's turn must be durable before a run that can fail to deliver it exists at all
  // (Defect 2, 2026-09-11). Ordered after conversation adoption because it needs the id that
  // adoption produces. BYOK and AG-UI share the identity above; neither writes a durable
  // user turn ahead of dispatch; those transports retain their own persistence behavior.
  await persistUserTurnBeforeDispatch({ message: userMessage, conversationId }, { persistUserTurn: options.persistUserTurn });
  // Acceptance commits the question and stub together even if the separate browser PUT fails
  // or the tab disappears. Carry the exact message ID/payload, never the rendered prompt.
  const base = buildLocalCliContextRef({ transport, input, prompt, resolvedConversationId: conversationId });
  const contextRef = { ...base, userMessage };

  const response = await transport.ports.acceptRun({
    ...(input.cancelSignal === undefined ? {} : { signal: input.cancelSignal }),
    requestSignal: input.cancelSignal ?? input.signal,
    body: { contextRef: JSON.stringify(contextRef), agentId: input.agentId, idempotencyKey: base.assistantMessageId },
    messageId: base.assistantMessageId,
    ...(conversationId === undefined ? {} : { conversationId }),
  }, {});

  return finishLocalCliRun({ transport, response, handlers, signal: input.signal });
}

/** Rejects a history with no user turn, then merges the adopted conversation identity into `context`. */
async function adoptRunIdentity(
  { input: startInput, options }: { input: StartRunInput; options: AssistantTransportOptions },
  _optional: Record<string, never> = {},
): Promise<{ input: StartRunInput; userMessage: ChatMessage; conversationId: string | undefined }> {
  let input = startInput;
  // Guard on the newest USER turn, not on the assembled transcript: a history containing only
  // assistant messages would still produce a non-empty transcript, and sending that as a
  // prompt asks the agent to reply to itself. Shared by both paths below, and reused (rather than
  // recomputed) by the Local CLI branch's own resume-capable check further down.
  const latestUserPrompt = latestUserPromptFromHistory({ history: input.history as ChatMessage[] });
  const userMessage = newestUserMessage({ history: input.history }, {});
  if (!latestUserPrompt || userMessage === undefined) {
    throw new Error("no user message to send");
  }

  // Adopt identity before either runtime branch so first-turn decisions survive a reload.
  const conversationId = await resolveRunConversationId(input, options.ensureConversationId);
  input = { ...input, context: { ...input.context, ...(conversationId ? { conversationId, agentPluginState: readAgentPluginChatState({ conversationId }) } : {}), userPrompt: latestUserPrompt } };
  return { input, userMessage, conversationId };
}

export async function startTransportRun(
  { transport, input: startInput, handlers }: { transport: TransportCtx; input: StartRunInput; handlers: RunHandlers },
  { options = {} }: { options?: AssistantTransportOptions } = {},
): Promise<{ runId: string }> {
  const { input, userMessage, conversationId } = await adoptRunIdentity({ input: startInput, options }, {});
  const executionConfig = options.getExecutionConfig?.({}, {});
  // Dispatches on MODE alone, not on whether a key is typed in this browser right now
  // (2026-08-05). `executionConfig.byok.apiKey` is write-only server-side — it is empty on
  // every fresh load even when a credential IS stored — so gating on it here would make BYOK
  // mode permanently unable to dispatch for exactly the case the server-side store exists to
  // support. `assistant-byok.ts`'s route already resolves the credential correctly either way
  // (a locally-typed key wins when present; an empty/omitted one falls back to this admin's own
  // stored row), so an empty `byok.apiKey` is a legitimate turn, not a reason to fall through to
  // the Local CLI path. A turn with genuinely no usable credential anywhere still fails, just one
  // level down — the route's own 400 `"no usable BYOK credential..."` — which is a real,
  // actionable answer instead of the mode picker silently refusing to try.
  if (executionConfig?.mode === "byok") {
    return startByokRun({ transport, input: transport.ports.projectInput({ input }, {}), handlers: capturePluginUsage({ handlers }), byok: executionConfig.byok }, {});
  }

  // AG-UI canary path (ADR-059) — a host-supplied toggle, independent of `executionConfig.mode`
  // (Jini's own closed union, never extended for this). Checked AFTER the byok branch above:
  // BYOK's single-request shape never touches the daemon at all, so there is nothing for this
  // path (which wraps the daemon specifically) to intercept there — the toggle only ever
  // diverts the Local CLI branch below.
  if (options.getAgUiEnabled?.({}, {})) {
    // `historyForTranscript` here rather than inside `startAgUiRun`: that module importing this
    // one would be a cycle, and this is its only caller. Same rule as the BYOK and Local CLI paths.
    return transport.ports.agUi.startAgUiRun({ input: transport.ports.projectInput({ input: { ...input, history: historyForTranscript({ history: input.history as ChatMessage[] }) } }, {}), handlers: capturePluginUsage({ handlers }) }, {});
  }

  return startLocalCliRun({ transport, input, handlers, userMessage, conversationId }, { options });
  }
