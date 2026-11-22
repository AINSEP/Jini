/** Parse and bound one inbound AG-UI run request (`RunAgentInput`) for a host route.
 * Pure: the history bound and the id generator are host inputs, so no host default or Node
 * built-in lives here. The route that calls this owns authentication and the HTTP answer. */

/** One history turn a run may carry: only user and assistant text survives parsing. */
export interface AgUiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A validated run request. `threadId`, `runId` and `requestId` are always present; the three
 *  forwarded fields are `undefined` when the caller sent none or sent a malformed one. */
export interface AgUiRunInput {
  frontendBindToken: string | undefined;
  frontendTabId: string | undefined;
  threadId: string;
  runId: string;
  requestId: string;
  agentId: string | undefined;
  messages: AgUiChatMessage[];
  secretRedacted: boolean;
}

/** The raw request body: every field is untrusted until parsed here. */
export interface AgUiRunBody {
  threadId?: unknown;
  runId?: unknown;
  messages?: unknown;
  forwardedProps?: unknown;
}

/** Mints the ids a caller left out. The host injects it, so tests pin ids and this file stays universal. */
export interface AgUiRunIdPort {
  newId(): string;
}

function isPlainMessage(value: unknown): value is { role: unknown; content: unknown } {
  return typeof value === 'object' && value !== null;
}

/** Validates one raw history entry, same fail-soft posture as `resolveAgUiMessages`'s own doc:
 *  `null` for anything malformed rather than throwing, since history is passive background context,
 *  not something the caller just authored this instant. Split out of `resolveAgUiMessages` so the
 *  per-entry branching is scored in this function's own complexity budget, not the loop's. */
function parseAgUiMessage({ entry }: { entry: unknown }, _optional: Record<string, never> = {}): AgUiChatMessage | null {
  if (!isPlainMessage(entry)) return null;
  const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
  const content = typeof entry.content === 'string' ? entry.content : null;
  if (role === null || content === null || content.length === 0) return null;
  return { role, content };
}

/** Validates and bounds the client-supplied `messages` array: malformed entries are dropped, not
 *  refused (history is passive background context, not something the caller just authored this
 *  instant), and only the trailing `maxHistoryMessages` are kept. The bound is the host's: each turn
 *  re-sends its whole history, so an unbounded one makes every later message in a long chat more
 *  expensive than the last.
 *  @complexity O(h) time and space in the supplied history. */
export function resolveAgUiMessages(
  { raw, maxHistoryMessages }: { raw: unknown; maxHistoryMessages: number },
  _optional: Record<string, never> = {},
): AgUiChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: AgUiChatMessage[] = [];
  for (const entry of raw) {
    const message = parseAgUiMessage({ entry });
    if (message) messages.push(message);
  }
  return messages.slice(-maxHistoryMessages);
}

/** `value` when it's a non-empty string, else `undefined` — the shared shape behind `threadId`,
 *  `runId`, and `agentId`'s "caller-supplied or minted" resolution below. */
function resolveNonEmptyString({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `RunAgentInput.forwardedProps` has no declared shape of its own (`z.ZodAny` in `@ag-ui/core`) —
 *  it's the schema's documented passthrough extension point, and a host's agent-selector value rides
 *  there as `forwardedProps.agentId` (there is no top-level `agentId` field on a real
 *  `RunAgentInput`; that's a separate, unrelated `AgentConfig`-level concept in `@ag-ui/client`). */
function resolveForwardedAgentId({ forwardedProps }: { forwardedProps: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (typeof forwardedProps !== 'object' || forwardedProps === null) return undefined;
  return resolveNonEmptyString({ value: (forwardedProps as { agentId?: unknown }).agentId });
}

/** Read only the bounded attachment identity fields, never a surface id or tool handler. The
 * daemon's registry verifies the token against the authenticated principal and originating tab.
 * @complexity O(1) time and space. */
function resolveForwardedBindingField(
  { forwardedProps, field }: { forwardedProps: unknown; field: 'frontendBindToken' | 'frontendTabId' },
  _optional: Record<string, never> = {},
): string | undefined {
  if (typeof forwardedProps !== 'object' || forwardedProps === null) return undefined;
  const value = (forwardedProps as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

/** Only the literal `true` counts: the request carries a boolean signal, never the redacted text. */
function resolveSecretRedacted({ forwardedProps }: { forwardedProps: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof forwardedProps === 'object' && forwardedProps !== null
    && (forwardedProps as { secretRedacted?: unknown }).secretRedacted === true;
}

/** Validates and normalizes one AG-UI run request body, or `null` when it fails the one hard
 *  requirement: a non-empty `messages` array ending in a user turn. A caller-supplied `threadId` /
 *  `runId` is echoed as given (AG-UI expects the caller to own them); an absent or empty one is
 *  minted so a well-formed-but-partial request still gets a coherent stream. Ids are minted in the
 *  order thread, run, request.
 * @complexity O(h) time and space in the supplied history; attachment fields are constant work. */
export function resolveAgUiRunInput(
  { body, maxHistoryMessages, ids }: { body: AgUiRunBody; maxHistoryMessages: number; ids: AgUiRunIdPort },
  _optional: Record<string, never> = {},
): AgUiRunInput | null {
  const messages = resolveAgUiMessages({ raw: body.messages, maxHistoryMessages });
  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') return null;
  const { forwardedProps } = body;
  return {
    threadId: resolveNonEmptyString({ value: body.threadId }) ?? ids.newId(),
    runId: resolveNonEmptyString({ value: body.runId }) ?? ids.newId(),
    requestId: ids.newId(),
    agentId: resolveForwardedAgentId({ forwardedProps }),
    frontendBindToken: resolveForwardedBindingField({ forwardedProps, field: 'frontendBindToken' }),
    frontendTabId: resolveForwardedBindingField({ forwardedProps, field: 'frontendTabId' }),
    secretRedacted: resolveSecretRedacted({ forwardedProps }),
    messages,
  };
}
