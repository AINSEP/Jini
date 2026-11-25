/**
 * @file The minted tool-error id as data: its pattern, the result shape that carries it, and the
 * reader. A leaf with no daemon imports beyond the executor result type, so the redaction layer
 * (which stamps the id), the observation layer (which reuses it) and the delegated-tool route
 * (which checks it) all share it without importing each other — `src/core` is the package's
 * shared tier, so neither the `tool-recovery` <-> `http` domain split nor the
 * redaction <-> observability runtime cycle comes back.
 */
import type { ToolExecutionResult } from "../tool-executor-types.js";

/** Matches a minted error ID anywhere in a string — exported for tests and for a later chat-side
 *  copy button (`ToolCard` matching this against `result.content`, tracked separately). The IDs are
 *  minted by `mintToolErrorId` in `@jini-ai/core/errors/error-id`, the one owner of the format. */
export const TOOL_ERROR_ID_PATTERN = /\bERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}\b/;

/** A `ToolExecutionResult` that may additionally carry the minted error ID — the ONLY field the
 *  redaction decorator ever adds. Every other field is `inner`'s own, untouched. */
export type RedactedToolExecutionResult = ToolExecutionResult & { readonly errorId?: string };

/**
 * Reads the error ID the redaction decorator (`withRedactedToolFailures`) attached, if any.
 *
 * @param result - Any `ToolExecutionResult`, redacted or not.
 * @returns The ID, or `undefined` for a result that decorator never touched (not `failed`,
 *   `errorKind: 'validation'`, or produced upstream of this layer).
 * @complexity O(1).
 */
export function readToolErrorId({ result }: { result: ToolExecutionResult }, _optional = {}): string | undefined {
  const id = (result as RedactedToolExecutionResult).errorId;
  return typeof id === "string" ? id : undefined;
}
