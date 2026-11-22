import type { UUID, JsonObject } from "@jini-ai/core/primitives";
import type { PostStatus } from "../core/index.js";

/**
 * SPEC-005 REQ-05 — the read-only entry snapshot handed to `BeforeSaveHookPort`. Declared
 * structurally here rather than importing the host SDK's `ContentEntryDraft` so `post.ts` stays
 * plugin-ignorant (Module Map): `post` knows it may call one optional function before saving, and
 * nothing about plugins, capabilities, or the hook registry. `Jini/packages/plugins/src/host/hook-registry.ts`'s
 * `runBeforeSave` satisfies this port structurally.
 */
export interface BeforeSaveEntryDraft {
  readonly id: UUID;
  readonly workspaceId: UUID;
  readonly title: string;
  readonly slug: string;
  readonly status: PostStatus;
  readonly bodyJson: Readonly<Record<string, unknown>>;
  readonly ext: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * SPEC-005 C-014/W-003 — the sole plugin-facing surface `post.ts` depends on. Resolves to the
 * merged, already-validated `ext` patch (`{ [pluginId]: { …fields } }`), or throws to abort the
 * whole save (BR-07/EC-10 fail-closed).
 */
export type BeforeSaveHookPort = (entry: BeforeSaveEntryDraft) => Promise<JsonObject>;

/**
 * SPEC-005 CIC U-004-B1/F1 — runs the optional `content.entry.beforeSave` hook and resolves to the
 * patch, or throws. The no-op default (`{}` when no hook is wired) is what keeps the zero-plugin
 * path byte-for-byte unchanged.
 *
 * **This must be awaited BEFORE the final `PostRecord` is constructed and BEFORE the single
 * `deps.repo.save()` call.** If it throws, the throw propagates out of `createPost`/`updatePost`
 * untouched and `repo.save()` is never reached — no partial write, no change set (BR-06/BR-07,
 * EC-10). Do not move this call below `repo.save()`, and do not wrap it in a `try` that swallows.
 */
export async function runBeforeSaveHook(
  { hook, draft }: { hook: BeforeSaveHookPort | undefined; draft: BeforeSaveEntryDraft },
  _optional: Record<string, never> = {}
): Promise<JsonObject> {
  if (!hook) return {};
  return hook(draft);
}

/**
 * Namespace-level merge of the hook's patch onto whatever `ext` the entry already carried.
 *
 * Merging (rather than replacing) is what makes INV-03 hold: a plugin that has since been disabled
 * or uninstalled contributes no patch, so its namespace simply survives untouched instead of being
 * wiped by the next save. Returns `undefined` — not `{}` — when nothing has ever been written, so
 * an entry with no contributing plugin carries no `ext` at all (AC-14).
 */
export function mergeExt({ existingExt, patch }: { existingExt: JsonObject | undefined; patch: JsonObject }, _optional: Record<string, never> = {}): JsonObject | undefined {
  const merged: JsonObject = { ...(existingExt ?? {}), ...patch };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Records an explicit `hideCoverImageInBody` choice in the post-presentation ext namespace,
 * keeping that namespace's other keys; `undefined` leaves the ext as merged. @complexity O(keys). */
export function withCoverPresentation(required: { ext: JsonObject | undefined; hideCoverImageInBody: boolean | undefined }): JsonObject | undefined {
  const { ext, hideCoverImageInBody } = required;
  if (hideCoverImageInBody === undefined) return ext;
  return { ...ext, "post-presentation": { ...(ext?.["post-presentation"] as JsonObject ?? {}), hideCoverImageInBody } };
}
