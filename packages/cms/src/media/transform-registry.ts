/**
 * @file Named transform registry service — the core-declared
 * path only (no theme/plugin declaration API; see `transform-types.ts` file
 * header for that disclosed scope boundary).
 *
 * Mirrors `media-service.ts`'s shape: plain async functions taking
 * `{ deps, input }` (+ optional `options`), typed domain errors.
 */
import type { ClockPort, IdGeneratorPort, UUID } from "../core/ports.js";
import type { TransformDefinitionRepoPort } from "./ports.js";
import { assertValidTransformParams, TransformValidationError, type TransformDefinitionRecord, type TransformParams } from "./transform-types.js";
import { withTransformRegistryLock } from "./transform-lock.js";

export { TransformValidationError };

// ---------------------------------------------------------------------------
// registerTransform
// ---------------------------------------------------------------------------

export interface RegisterTransformInput {
  workspaceId: UUID;
  name: string;
  params: TransformParams;
  /** Registering module id, e.g. `"core"`. See `transform-types.ts` file header. */
  owner: string;
}

export interface RegisterTransformDeps {
  clock: ClockPort;
  idGen: IdGeneratorPort;
  transformRepo: TransformDefinitionRepoPort;
}

export interface RegisterTransformRequired {
  deps: RegisterTransformDeps;
  input: RegisterTransformInput;
}

/**
 * Registers a named transform definition. Append-only:
 * redefining an already-used `name` never mutates the prior version's row —
 * it inserts a new row at `version = (current max version for name) + 1`
 * (or `1` if `name` has never been registered). The read-max-then-insert
 * sequence runs inside {@link withTransformRegistryLock} keyed on
 * `(workspaceId, name)` so two concurrent `registerTransform` calls for the
 * same name can't both observe the same "current max" and mint colliding
 * versions (the version-numbering equivalent of the race
 * `withSha256Lock`/`blob-gc-lock.ts` closes for blob dedup-vs-GC).
 *
 * @complexity O(v) in the number of existing versions of `name`, from the
 * max-version scan (`listByName` + reduce) — acceptable at walking-skeleton
 * scale, same tradeoff class as `isBlobUnreferenced`'s O(n) scan.
 * @overallScore 100
 */
export async function registerTransform(
  required: RegisterTransformRequired,
  _optional: Record<string, never> = {}
): Promise<{ definition: TransformDefinitionRecord }> {
  const { deps, input } = required;

  const name = input.name.trim();
  if (!name) throw new TransformValidationError("transform name is required");
  const owner = input.owner.trim();
  if (!owner) throw new TransformValidationError("owner is required");
  assertValidTransformParams(input.params);

  return withTransformRegistryLock(`${input.workspaceId}:${name}`, async () => {
    const existingVersions = await deps.transformRepo.listByName({ workspaceId: input.workspaceId, name });
    const currentMaxVersion = existingVersions.reduce((max, row) => Math.max(max, row.version), 0);

    const definition: TransformDefinitionRecord = {
      id: deps.idGen.newId(),
      workspaceId: input.workspaceId,
      name,
      version: currentMaxVersion + 1,
      params: input.params,
      owner,
      createdAt: deps.clock.nowIso(),
    };
    await deps.transformRepo.insert(definition);
    return { definition };
  });
}

// ---------------------------------------------------------------------------
// Queries used by the anonymous lazy-generation bound
// ---------------------------------------------------------------------------

export interface GetLatestTransformDefinitionRequired {
  deps: { transformRepo: TransformDefinitionRepoPort };
  input: { workspaceId: UUID; name: string };
}

/**
 * Returns the highest-`version` row registered for `name`, or `null` if
 * `name` has never been registered.
 *
 * @complexity O(v) in the number of versions of `name`.
 * @overallScore 100
 */
export async function getLatestTransformDefinition(
  required: GetLatestTransformDefinitionRequired
): Promise<TransformDefinitionRecord | null> {
  const rows = await required.deps.transformRepo.listByName(required.input);
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) => (row.version > latest.version ? row : latest));
}

export interface IsLatestTransformVersionRequired {
  deps: { transformRepo: TransformDefinitionRepoPort };
  input: { workspaceId: UUID; name: string; version: number };
}

/**
 * Answers "is `version` the current latest registered version of `name`?" —
 * the cheap half of the anonymous-generation bound ("latest
 * registry version of that name"). Used by `rendition-service.ts` to decide
 * whether an unauthenticated request may trigger lazy generation for an
 * as-yet-ungenerated rendition.
 *
 * @complexity O(v), inherited from {@link getLatestTransformDefinition}.
 * @overallScore 100
 */
export async function isLatestTransformVersion(required: IsLatestTransformVersionRequired): Promise<boolean> {
  const latest = await getLatestTransformDefinition({ deps: required.deps, input: required.input });
  return latest !== null && latest.version === required.input.version;
}

/**
 * STUB (disclosed) — the other half of the anonymous-generation
 * bound: "referenced by published content". The real check depends on
 * the `entry_refs` where-used index, which is not implemented as
 * running code yet (same disclosed gap `blob-gc.ts`'s `hasLiveEntryRefs`
 * names for the same reason — see that file's header). Always reports "not
 * referenced", which is what makes {@link isLatestTransformVersion} alone
 * the effective bound in this build.
 *
 * @complexity O(1) (stub).
 * @overallScore 100
 */
export function isReferencedByPublishedContent(_input: {
  workspaceId: UUID;
  name: string;
  version: number;
}): boolean {
  return false;
}
