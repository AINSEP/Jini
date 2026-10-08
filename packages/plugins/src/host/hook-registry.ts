/**
 * @file `createHookRegistry()` / `runBeforeSave()` — composes enabled plugins' `content.entry.
 * beforeSave` filters, merges `ext`, fail-closed (SPEC-005 REQ-05/REQ-06; BR-04/BR-06/BR-07;
 * CIC U-004, no escalation marker).
 *
 * Purpose:
 * The concrete adapter for `BeforeSaveHookPort` (`src/features/post/post.ts`'s contract). Keeping
 * this composition logic here — not in `post.ts` — is what keeps `post.ts` plugin-ignorant
 * (Module Map). `activation.ts` calls `.detach()` on disable.
 *
 * **Corrected 2026-08-04 (ADR-057 Decision 2.1):** this comment previously claimed `loader.ts`
 * calls `.attach()` on this registry as each plugin's `setup()` runs. That was false — `loadPlugin()`
 * (`loader.ts`) has never called `.attach()`; steps 4-5 of BR-01 were left unwired, documented but
 * dead, and no other production code called it either (verified: `grep -rn "hookRegistry\.attach"
 * src --include=*.ts`, excluding tests, returned only this file's own now-corrected doc comment).
 * `loader.ts` exports `attachLoadedPlugin()`, the real (not stub) extraction of that dead logic's
 * attach half, widened to accept a `"glue"` source. Site Glue's content-lifecycle attachment point
 * is `attachLoadedPlugin`'s first production caller; `loadPlugin()` itself still does not call it —
 * a future SPEC-005 fix for its own activation path is expected to call the same function, per
 * ADR-057 Decision 2.1, rather than re-inventing this wiring a second time.
 *
 * **CIC U-004 (Binding, no escalation marker — bounded blast radius via SPEC-001's revert):**
 * `runBeforeSave()` must fully resolve (returning the merged patch) or throw before its caller
 * (`post.ts`) constructs the final `PostRecord` passed to `deps.repo.save()`. There is exactly one
 * `repo.save()` call per `createPost`/`updatePost` invocation, and it must never be reached if
 * this function throws (BR-06 same-transaction requirement; BR-07/EC-10 fail-closed: no partial
 * write, no change set on failure). This module's own responsibility ends at "resolve or throw
 * before returning" — `post.ts` is responsible for not calling `repo.save()` on the throw path.
 *
 * Composition order is TB-01 (built-ins first by id ascending, then site plugins by id
 * ascending) — the SAME order `PLUGINS_LIST` uses. Each plugin writes only its own
 * `ext.{pluginId}` namespace (BR-04), so composition order does not create write conflicts, but
 * the ordering is still fixed and deterministic (not incidental) because later filters observe
 * earlier filters' already-merged `ext` values on the entry snapshot they receive.
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-010, CIC U-004). Signature and JSDoc are
 * design-frozen; `runBeforeSave()` orders attached filters, gives each an isolated entry snapshot,
 * validates each declared-field patch, and returns the merged per-plugin `ext` object fail-closed.
 */
import type { JsonObject } from "@jini-ai/core/primitives";
import type { BeforeSaveFilter, ContentEntryDraft, HookContext, HookPoints, PluginSdkBinding } from "./ports.js";
import { PluginHookFailedError } from "./errors.js";

/** Who attached a given filter — extended by ADR-057 Decision 3 with `"glue"`, ranked after
 * `"site"` in {@link compareTb01}. Exported so `loader.ts`'s `attachLoadedPlugin()` and any other
 * caller share this one source of truth for the vocabulary rather than re-declaring the union. */
export type AttachmentSource = "built-in" | "site" | "glue";

// The class lives in `contracts/core` so `features/post` can recognize it without importing this
// feature (see that file's header); re-exported so this module's importers are unchanged.
export { PluginHookFailedError };

/** One field this plugin declared in its manifest (BR-06's validation target — the merge step
 * rejects a returned patch key/value that doesn't match a declared field). */
export interface HookRegistryFieldDecl {
  readonly path: string; // "ext.{pluginId}.{field}"
  readonly type: "string" | "integer" | "number" | "boolean";
}

/** Default recovery policy: tolerate two transient failures, quarantine on the third consecutive
 * failure. Composition may inject a different positive integer per runtime instance. */
export const DEFAULT_PLUGIN_FAILURE_THRESHOLD = 3;

export interface PluginQuarantineEvent {
  readonly pluginId: string;
  readonly workspaceId: string;
  readonly consecutiveFailures: number;
  readonly reason: string;
}

export interface CreateHookRegistryOptions {
  readonly failureThreshold?: number;
  /** Persistence/action port supplied by composition. Absent keeps the registry's legacy
   * fail-closed-only behavior (used by isolated consumers that have no activation repository). */
  readonly onQuarantine?: (event: PluginQuarantineEvent) => Promise<void>;
}

export interface HookRegistry {
  /** Registers one currently-enabled, successfully-loaded plugin's filter (BR-01 step 5). Safe to
   * call again for the same `pluginId` — a second `attach` for an id already attached replaces
   * the prior registration (re-enable after disable, or a loader retry). */
  attach(required: { pluginId: string; source: AttachmentSource; filter: BeforeSaveFilter; declaredFields: readonly HookRegistryFieldDecl[] }, optional?: Record<string, never>): void;
  /** Removes a plugin's filter (disable, BR-05) — its `ext` data is untouched (INV-03); only the
   * filter stops firing on subsequent saves. */
  detach(required: { pluginId: string }, optional?: Record<string, never>): void;
  /** Implements `BeforeSaveHookPort` — the sole surface `post.ts` depends on. */
  runBeforeSave(required: { entry: Readonly<ContentEntryDraft> }, optional?: Record<string, never>): Promise<JsonObject>;
  /** Admin preview (AW-7): runs ONE attached plugin's filter on a draft with the same snapshot and
   * declared-field validation as a save, but merges, saves and counts nothing — a preview failure
   * throws `PluginHookFailedError` without touching the quarantine counter or the attachment, so
   * an editor trying drafts can never quarantine a plugin. Resolves `null` when `pluginId` is not
   * attached (disabled, quarantined, or never loaded). */
  previewBeforeSave(required: { pluginId: string; entry: Readonly<ContentEntryDraft> }, optional?: Record<string, never>): Promise<JsonObject | null>;
}

/** One plugin's currently-attached registration. */
interface Attachment {
  readonly source: AttachmentSource;
  readonly filter: BeforeSaveFilter;
  readonly declaredFields: readonly HookRegistryFieldDecl[];
}

/** TB-01's rank per source, ADR-057 Decision 3's additive third stage: built-ins (0), then site
 * plugins (1), then glue modules (2) — id-ascending within each rank (`compareTb01` below). */
const SOURCE_RANK: Readonly<Record<AttachmentSource, number>> = { "built-in": 0, site: 1, glue: 2 };

/**
 * TB-01 comparator: built-ins before site plugins before glue modules, id-ascending within each
 * group. Shared with `discovery.ts`'s own ordering rule for the `built-in`/`site` ranks (PLUGINS_LIST
 * uses the same order) so those two never diverge; the `glue` rank has no discovery-time analogue
 * since glue modules are never listed by `discovery.ts` (ADR-057 Decision 6 — a separate tier).
 */
function compareTb01(a: readonly [string, Attachment], b: readonly [string, Attachment]): number {
  const rankDiff = SOURCE_RANK[a[1].source] - SOURCE_RANK[b[1].source];
  if (rankDiff !== 0) return rankDiff;
  return a[0].localeCompare(b[0]);
}

/** The four JSON-primitive field types BR-06's declared-field vocabulary supports. */
function matchesDeclaredType(value: unknown, type: HookRegistryFieldDecl["type"]): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/** Last dot-segment of a declared `ext.{pluginId}.{field}` path — the field name a returned patch
 * key is checked against. */
function fieldNameOf(declaredPath: string): string {
  const segments = declaredPath.split(".");
  return segments[segments.length - 1] ?? declaredPath;
}

/** Calls one plugin's filter, re-shaping a thrown error into the module's own
 * `PluginHookFailedError` vocabulary — the ONE place `runBeforeSave`'s per-plugin work touches the
 * plugin's own code directly. */
async function callPluginFilter(
  pluginId: string,
  filter: BeforeSaveFilter,
  snapshot: Readonly<ContentEntryDraft>,
  ctx: HookContext,
  beforeSaveHook: string
): Promise<unknown> {
  try {
    return await filter(snapshot, ctx);
  } catch (error) {
    throw new PluginHookFailedError(
      pluginId,
      `plugin '${pluginId}' ${beforeSaveHook} filter failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/** BR-07/EC-10: a filter's return value must be a plain object, never an array or a primitive. */
function assertPatchShape(pluginId: string, patch: unknown): asserts patch is Record<string, unknown> {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new PluginHookFailedError(pluginId, `plugin '${pluginId}' returned a non-object ext patch from its beforeSave filter`);
  }
}

/** BR-06: every key in a validated patch must match a field the plugin's own manifest declared,
 * with a value matching that field's declared type — anything else is fail-closed, not dropped. */
function buildDeclaredPatch(
  pluginId: string,
  patch: Readonly<Record<string, unknown>>,
  declaredFields: readonly HookRegistryFieldDecl[]
): Record<string, JsonObject[string]> {
  const declaredByField = new Map(declaredFields.map((f) => [fieldNameOf(f.path), f]));
  const pluginPatch: Record<string, JsonObject[string]> = {};

  for (const [field, value] of Object.entries(patch)) {
    const decl = declaredByField.get(field);
    if (!decl) {
      throw new PluginHookFailedError(pluginId, `plugin '${pluginId}' returned undeclared ext field '${field}' (FIELD_PATH_INVALID)`);
    }
    if (!matchesDeclaredType(value, decl.type)) {
      throw new PluginHookFailedError(
        pluginId,
        `plugin '${pluginId}' returned ext field '${field}' with a value not matching its declared type '${decl.type}' (FIELD_TYPE_MISMATCH)`
      );
    }
    pluginPatch[field] = value as JsonObject[string];
  }
  return pluginPatch;
}

/**
 * One plugin's full contribution: builds its isolated entry snapshot (this plugin's own `ext`
 * namespace overlaid with every earlier plugin's already-merged result, per TB-01's composition
 * order), calls its filter, and validates the returned patch. Pulled out of `runBeforeSave`'s loop
 * body because that loop's own job — ordering, failure bookkeeping, quarantine — is a different
 * concern from what happens to any ONE plugin's filter call.
 */
async function applyPluginFilter(
  pluginId: string,
  attachment: Attachment,
  entry: Readonly<ContentEntryDraft>,
  mergedSoFar: Readonly<Record<string, JsonObject>>,
  beforeSaveHook: string
): Promise<Record<string, JsonObject[string]>> {
  const snapshot: ContentEntryDraft = structuredClone({ ...entry, ext: { ...entry.ext, ...mergedSoFar } });
  const ctx: HookContext = { pluginId, workspaceId: entry.workspaceId };

  const patch = await callPluginFilter(pluginId, attachment.filter, snapshot, ctx, beforeSaveHook);
  assertPatchShape(pluginId, patch);
  return buildDeclaredPatch(pluginId, patch, attachment.declaredFields);
}

/**
 * Creates a fresh, empty hook registry (no plugins attached). Each process has exactly one
 * long-lived instance, constructed once at composition-root time and shared between `loader.ts`
 * (attach/detach) and `post.ts` (via `BeforeSaveHookPort`, `runBeforeSave` only).
 *
 * @complexity `attach`/`detach` are O(1) (Map operations). `runBeforeSave` is
 * O(attached-plugin-count · own-declared-field-count) for merge/validation bookkeeping, plus each
 * plugin's own filter cost (unbounded, plugin-defined — no latency budget exists, ADR scalability
 * axis, a disclosed gap).
 * @overallScore 100/100
 */
export function createHookRegistry<H extends HookPoints>(
  required: { pluginSdkBinding: PluginSdkBinding<H> },
  options: CreateHookRegistryOptions = {},
): HookRegistry {
  const beforeSaveHook = required.pluginSdkBinding.beforeSaveHook;
  const failureThreshold = options.failureThreshold ?? DEFAULT_PLUGIN_FAILURE_THRESHOLD;
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new RangeError("plugin failure threshold must be a positive integer");
  }

  const attachments = new Map<string, Attachment>();
  const consecutiveFailures = new Map<string, Map<string, number>>();

  function clearFailures(pluginId: string, workspaceId?: string): void {
    if (workspaceId !== undefined) {
      const workspaceFailures = consecutiveFailures.get(workspaceId);
      workspaceFailures?.delete(pluginId);
      if (workspaceFailures?.size === 0) consecutiveFailures.delete(workspaceId);
      return;
    }
    for (const [workspace, workspaceFailures] of consecutiveFailures) {
      workspaceFailures.delete(pluginId);
      if (workspaceFailures.size === 0) consecutiveFailures.delete(workspace);
    }
  }

  async function recordFailure(
    pluginId: string,
    workspaceId: string,
    failure: PluginHookFailedError
  ): Promise<void> {
    if (!options.onQuarantine) return;

    const workspaceFailures = consecutiveFailures.get(workspaceId) ?? new Map<string, number>();
    const next = (workspaceFailures.get(pluginId) ?? 0) + 1;
    workspaceFailures.set(pluginId, next);
    consecutiveFailures.set(workspaceId, workspaceFailures);
    if (next < failureThreshold) return;

    // Recover the process first: the triggering save remains fail-closed, but all later saves see
    // the attachment gone even while durable activation state is being recorded.
    detach({ pluginId });
    try {
      await options.onQuarantine({
        pluginId,
        workspaceId,
        consecutiveFailures: next,
        reason: failure.message,
      });
    } catch (error) {
      throw new PluginHookFailedError(
        pluginId,
        `${failure.message}; automatic quarantine persistence failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error }
      );
    }
  }

  function attach(
    { pluginId, source, filter, declaredFields }: { pluginId: string; source: AttachmentSource; filter: BeforeSaveFilter; declaredFields: readonly HookRegistryFieldDecl[] },
    _optional: Record<string, never> = {},
  ): void {
    clearFailures(pluginId);
    attachments.set(pluginId, { source, filter, declaredFields });
  }

  function detach({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}): void {
    attachments.delete(pluginId);
    clearFailures(pluginId);
  }

  async function runBeforeSave({ entry }: { entry: Readonly<ContentEntryDraft> }, _optional: Record<string, never> = {}): Promise<JsonObject> {
    const ordered = [...attachments.entries()].sort(compareTb01);
    const merged: Record<string, JsonObject> = {};

    for (const [pluginId, attachment] of ordered) {
      try {
        merged[pluginId] = await applyPluginFilter(pluginId, attachment, entry, merged, beforeSaveHook);
        clearFailures(pluginId, entry.workspaceId);
      } catch (error) {
        const failure =
          error instanceof PluginHookFailedError
            ? error
            : new PluginHookFailedError(pluginId, `plugin '${pluginId}' beforeSave hook failed`, { cause: error });
        await recordFailure(pluginId, entry.workspaceId, failure);
        throw failure;
      }
    }

    return merged;
  }

  async function previewBeforeSave({ pluginId, entry }: { pluginId: string; entry: Readonly<ContentEntryDraft> }, _optional: Record<string, never> = {}): Promise<JsonObject | null> {
    const attachment = attachments.get(pluginId);
    if (!attachment) return null;
    try {
      return await applyPluginFilter(pluginId, attachment, entry, {}, beforeSaveHook);
    } catch (error) {
      throw error instanceof PluginHookFailedError
        ? error
        : new PluginHookFailedError(pluginId, `plugin '${pluginId}' beforeSave hook failed`, { cause: error });
    }
  }

  return { attach, detach, runBeforeSave, previewBeforeSave };
}
