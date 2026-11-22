/**
 * @file Host binding of `extractHtmlEntryRefs` (the cms widgets module): an UNINDEXED-reference warning goes to
 * the server console, where operators look for it. Html pages are written through
 * the host's SQLite pages html-document store (`PagesHtmlDocumentStore`, ADR-056 CIC-3), which calls this.
 * Forms definitions: safe-delete follows page -> widget -> form definition; see
 * the host's embed-type inventory architecture doc. `extractEntryRefs` is imported from Jini directly.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { extractHtmlEntryRefs as extractJiniHtmlEntryRefs, type EntryRefRow } from "../index.js";

/** Same input and rows as Jini's; a rejected marker is warned on the console with its source entry id. */
export function extractHtmlEntryRefs(input: {
  readonly workspaceId: UUID;
  readonly sourceEntryId: UUID;
  readonly html: string;
}, _optional: Record<string, never> = {}): readonly EntryRefRow[] {
  return extractJiniHtmlEntryRefs(input, { report: ({ message, sourceEntryId }) => console.warn(message, { sourceEntryId }) });
}
