import { publishEntry, unpublishEntry, type PublishUnpublishEntryRequired } from "./write-service.js";
import type { Result } from "@jini-ai/core/primitives";
import type { EntryRecord } from "./types.js";

/**
 * @file Entry publish/unpublish `op` dispatch (the closed-union-dispatch convention, same
 * shape as `features/content-types/lifecycle-dispatch.ts`).
 */

export const ENTRY_LIFECYCLE_OP_NAMES = ["publish", "unpublish"] as const;
export type EntryLifecycleOp = (typeof ENTRY_LIFECYCLE_OP_NAMES)[number];

/** Narrows an untrusted `op` string to {@link EntryLifecycleOp}, or `null` if it isn't one. */
export function parseEntryLifecycleOp(requiredArgs: { op: unknown }, optionalArgs: Record<string, never> = {}): EntryLifecycleOp | null {
  const { op } = requiredArgs;
  return typeof op === "string" && (ENTRY_LIFECYCLE_OP_NAMES as readonly string[]).includes(op) ? (op as EntryLifecycleOp) : null;
}

export type EntryLifecycleHandler = (required: PublishUnpublishEntryRequired) => Promise<Result<{ entry: EntryRecord }, Error>>;

const entryLifecycleOps = {
  publish: (required: PublishUnpublishEntryRequired) => publishEntry(required),
  unpublish: (required: PublishUnpublishEntryRequired) => unpublishEntry(required),
} satisfies Record<EntryLifecycleOp, EntryLifecycleHandler>;

export const ENTRY_LIFECYCLE_OPS: Record<EntryLifecycleOp, EntryLifecycleHandler> = Object.assign(
  Object.create(null) as Record<EntryLifecycleOp, EntryLifecycleHandler>,
  entryLifecycleOps
);
