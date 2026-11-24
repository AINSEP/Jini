import type { DurableAttemptStatus } from "@jini-ai/core/contracts/run-attempt";

/**
 * @file Pure decisions a host's agent-daemon entry makes while starting a run: which stored session
 * to resume, whether an agent receives attachment pixels, whether a durable attempt still owns its
 * answer, and which history the prompt carries. Kept outside the entry script so every branch is
 * unit-tested directly — importing that script boots the daemon. No I/O.
 */

/** The agent-definition fields that decide whether attachments reach the agent as images. */
export type ImageDeliveryDef = { readonly imageDelivery?: string; readonly promptInputFormat?: string };

/**
 * Chooses the session id a run may resume, before the concurrency gate applies.
 *
 * Recovery is authoritative about native resume: reconstruction must never quietly use
 * the old locator, which could still be written by an orphaned CLI after daemon death.
 *
 * @returns `null` for reconstruction, the recovery session (or `null`) for native recovery, and the
 * conversation's stored session otherwise.
 * @complexity O(1) time and space.
 */
export function resolveStoredSessionId(
  { recoveryMode, recoverySessionId, priorSessionId }: {
    readonly recoveryMode: "native" | "reconstruction" | undefined;
    readonly recoverySessionId: string | undefined;
    readonly priorSessionId: string | null;
  }, _optional: Record<string, never> = {},
): string | null {
  if (recoveryMode === "reconstruction") return null;
  if (recoveryMode === "native") return recoverySessionId ?? null;
  return priorSessionId;
}

/**
 * Whether claimed attachments are prepared as images for this agent: it accepts native images,
 * reads them from a prompt path, or takes a stream-json prompt. An unknown agent (`null`)
 * gets file access only.
 * @complexity O(1) time and space.
 */
export function agentReceivesImageAttachments({ def }: { readonly def: ImageDeliveryDef | null | undefined }, _optional: Record<string, never> = {}): boolean {
  return def?.imageDelivery === "native" || def?.imageDelivery === "prompt-path" || def?.promptInputFormat === "stream-json";
}

/**
 * Whether a durable execution attempt still owns its answer: it exists, was not cancelled, and its
 * message is still queued or running. Anything else means a newer attempt or a stop took over.
 * @complexity O(1) time and space.
 */
export function durableAttemptOwnsAnswer({ attempt }: { readonly attempt: DurableAttemptStatus | null }, _optional: Record<string, never> = {}): boolean {
  if (!attempt || attempt.cancelReason) return false;
  return ["queued", "running"].includes(attempt.message.runStatus ?? "");
}

/**
 * Selects the history a run's prompt starts from. The browser cannot know whether the daemon still
 * has a native session to resume, so it sends both its bare latest turn (`prompt`) and the full
 * `coldStartContext`; a memory-carrying agent that is NOT resuming needs the full context.
 * @complexity O(1) time and space.
 */
export function selectRunHistoryPrompt(
  { prompt, coldStartContext, resumeSessionId, carriesOwnMemory }: {
    readonly prompt: string;
    readonly coldStartContext: string | undefined;
    readonly resumeSessionId: string | undefined;
    readonly carriesOwnMemory: boolean;
  }, _optional: Record<string, never> = {},
): string {
  return !resumeSessionId && coldStartContext && carriesOwnMemory ? coldStartContext : prompt;
}
