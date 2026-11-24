/**
 * @file Per-call host context for a tool call the agent daemon sends to this server over the tool
 * RPC (`POST /internal/tool-executions`, ADR-070). The daemon owns the run, so only it knows the
 * run's conversation, the attachment refs on the message that started it, and which tool ids it
 * runs itself (frontend control). It sends them as the wire `context`; the route runs the call
 * inside {@link runWithDaemonCallContext}, and the server-side readers below pick them up.
 *
 * Absent context means the call did not come from the daemon (a BYOK turn): readers then behave as
 * before this existed.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface DaemonCallContext {
  readonly conversationId?: string;
  readonly attachmentRefs?: readonly string[];
  readonly localToolIds?: readonly string[];
}

const storage = new AsyncLocalStorage<DaemonCallContext>();

function stringList({ value }: { value: unknown }, _optional = {}): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

/** Keeps only well-typed fields of the daemon's opaque wire context; anything else is dropped. */
export function parseDaemonCallContext({ value }: { value: unknown }, _optional = {}): DaemonCallContext {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const attachmentRefs = stringList({ value: raw.attachmentRefs });
  const localToolIds = stringList({ value: raw.localToolIds });
  return {
    ...(typeof raw.conversationId === "string" ? { conversationId: raw.conversationId } : {}),
    ...(attachmentRefs ? { attachmentRefs } : {}),
    ...(localToolIds ? { localToolIds } : {}),
  };
}

/** Runs `fn` with `context` visible to {@link readDaemonCallContext} for every await inside it. */
export function runWithDaemonCallContext<T>({ context, fn }: { context: DaemonCallContext; fn: () => Promise<T> }, _optional = {}): Promise<T> {
  return storage.run(context, fn);
}

/** The current daemon call's context, or `undefined` outside a daemon call. */
export function readDaemonCallContext(_required = {}, _optional = {}): DaemonCallContext | undefined {
  return storage.getStore();
}
