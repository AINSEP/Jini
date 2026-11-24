import { executeCommand } from "../../core/index.js";
import type { JsonObject } from "@jini-ai/core/primitives";

import { PublishContentApplyRowError } from "../transfer/index.js";
import { contentHash, CONTENT_HASH_VERSION } from "./content-hash.js";
import { addressHeldByOther, addressHeldInTrash, changedSincePlan, notWired, trashedAtDestination } from "./precheck-reasons.js";
import type { PublishContentContributor, PublishContentDeps, PublishContentHandler, PublishContentReference, MediaSourceReplacement } from "./type-registry.js";
import type { PackedEntity } from "../transfer/index.js";

/**
 * @file Slice F1 of `ADS-memory/.local-artifacts/plan-publish-all-types-2026-09-25.md` (§2): the
 * generic `PublishContentHandler` factory. It owns what every repo-backed handler (post/page, media,
 * menu, redirect) repeats: the trash skip on pack, the second-address and trashed-destination
 * prechecks, the three version (CAS) checks at apply, domain-error-to-row-outcome mapping, and the
 * optional `executeCommand` wrapping with compensating rollback. A type supplies only a config.
 *
 * Imports only `type-registry.ts` TYPES plus the zero-import helpers, the same dependency shape as a
 * hand-written `features/<type>/publish-content.ts`, so a config built on it sits at the same place in
 * the module graph (see `type-registry.ts`'s header for the cycle this avoids).
 */

/** `"transferred"` is packed and hashed; `"provenance"` is packed but not hashed (a value the
 *  destination cannot be made to hold identically); `"local"` never leaves the row. */
export type FieldDisposition = "transferred" | "provenance" | "local";

type ErrorClass = abstract new (...args: never[]) => Error;

/** What {@link RepoPublishTypeConfig.write} and `undo` receive. `existing` is the destination row,
 *  already version-checked. */
export interface RepoWriteContext<Row, Ports, P> {
  readonly ports: Ports;
  readonly deps: PublishContentDeps<P>;
  readonly workspaceId: string;
  readonly id: string;
  readonly state: Record<string, unknown>;
  readonly existing: Row | null;
  readonly expectedVersion: number | undefined;
  readonly principalId: string;
  readonly sourceReplacement?: MediaSourceReplacement;
  /** With `undo`: registers an undo for a side effect of `write` beyond the row (e.g. post's term
   *  assignments). The gateway's rollback runs these, last first, before `restore`/`remove`. */
  readonly onRollback: (required: { undo: () => Promise<void> }, optional?: Record<string, never>) => void;
}

/** What `write` may return. `version` is the row's version after the write (the change set's revert
 *  guard when `undo` is set); other fields pass through on `apply()`'s result (media's `blobWritten`). */
export interface RepoWriteResult {
  readonly changeSetId?: string;
  readonly version?: number;
  readonly [extra: string]: unknown;
}

/** One publishable type's config for {@link createRepoPublishHandler} (plan §2.1). */
export interface RepoPublishTypeConfig<Row, Ports, P> {
  readonly coversTables?: readonly string[];
  readonly coversRoots?: readonly string[];
  readonly entityType: string;
  /** Defaults to 1. */
  readonly schemaVersion?: number;
  /** The type's own write permission: the handler's `permission` and, with `undo`, the command's. */
  readonly permission: string;
  /** The other permissions `write` asks for ({@link PublishContentHandler.alsoAuthorizes}). */
  readonly alsoAuthorizes?: readonly string[];
  /** Types that must apply first. Only references the destination validates at write time. */
  readonly dependsOn?: readonly string[];

  /** `undefined` = not wired on this instance: pack yields nothing, inspect is `null`, precheck
   *  refuses, apply throws. */
  readonly ports: (required: { deps: PublishContentDeps<P> }, optional?: Record<string, never>) => Ports | undefined;
  /** The `PublishContentDeps.ports` key the not-wired messages name. Defaults to `entityType`. */
  readonly portsKey?: string;
  readonly list: (required: { ports: Ports; workspaceId: string }, optional?: Record<string, never>) => Promise<readonly Row[]>;
  /** Must also return a trashed row, so precheck can refuse it rather than plan a create. */
  readonly find: (required: { ports: Ports; workspaceId: string; id: string }, optional?: Record<string, never>) => Promise<Row | null>;
  /** Defaults to `row.id`. */
  readonly idOf?: (required: { row: Row }, optional?: Record<string, never>) => string;
  /** Defaults to `row.version`. */
  readonly versionOf?: (required: { row: Row }, optional?: {}) => number;
  /** Pack filter beyond trash (kind, active status, excluded keys). */
  readonly include?: (required: { row: Row }, optional?: Record<string, never>) => boolean;
  /** Pack skips a trashed row; precheck refuses a trashed destination row. */
  readonly isTrashed?: (required: { row: Row }, optional?: {}) => boolean;
  /** e.g. parent-first for a tree-shaped type. */
  readonly packOrder?: (required: { rows: readonly Row[] }, optional?: {}) => readonly Row[];

  /** Every field of `Row`, so a new column fails to compile until classified. */
  readonly fields: Record<Extract<keyof Row, string>, FieldDisposition>;
  /** Fields left out of the state while `undefined` (instead of packed as `null`), so a field added
   *  later keeps every existing hash of a row that has no value for it (e.g. `termIds`). */
  readonly omitWhenAbsent?: readonly string[];
  /** Only for a MIGRATED type whose existing `contentHash` must stay byte-identical (plan §7): replaces
   *  the default hash input (the `"transferred"` fields). A new type never sets it. */
  readonly legacyHashState?: (required: { row: Row; packedState: Record<string, unknown> }, optional?: Record<string, never>) => Record<string, unknown>;
  /** Defaults to `[]`. */
  readonly requiredBlobs?: (required: { row: Row }, optional?: {}) => readonly string[];
  /** A better on-screen name than any packed field (`PackedEntity.displayLabel`). Display only:
   *  never hashed or applied. `undefined` leaves the row named from its state. */
  readonly displayLabel?: (required: { row: Row }, optional?: Record<string, never>) => string | undefined;

  /** A second unique address (slug, key, name). Precheck refuses when `holder` returns a row with a
   *  different `idOf`. An empty value is not checked. When the address stays held by a trashed row,
   *  `holder` must return that row too (and `isTrashed` say so), or the create collides at apply. */
  readonly address?: {
    readonly field: string;
    readonly holder: (required: { ports: Ports; workspaceId: string; value: string; state: Record<string, unknown> }, optional?: Record<string, never>) => Promise<Row | null>;
  };
  /** What a packed entity uses, carried along by a scoped publish ({@link PublishContentHandler.references}). */
  readonly references?: (required: { entity: PackedEntity }, optional?: Record<string, never>) => readonly PublishContentReference[];
  /** Type-specific refusals, after the generic ones. Returns a reason or `null`. */
  readonly validate?: (input: { ports: Ports; workspaceId: string; entity: PackedEntity; existing: Row | null }, optional?: {}) => ReturnType<PublishContentHandler["precheck"]>;

  /** The one write. Throws domain errors, which `errors` maps. Without `undo`, a returned
   *  `changeSetId` is the report's (else the packed id); with `undo`, the gateway's id wins. */
  readonly write: (ctx: RepoWriteContext<Row, Ports, P>, optional?: {}) => Promise<RepoWriteResult | void>;
  /** When set, `write` runs inside `executeCommand` (inverse = the prior row; rollback = `restore`
   *  or, for a create, `remove`). When unset, the domain write keeps its own revision (redirect, menu). */
  readonly undo?: {
    readonly restore: (required: { ctx: RepoWriteContext<Row, Ports, P>; prior: Row }, optional?: Record<string, never>) => Promise<void>;
    readonly remove: (ctx: RepoWriteContext<Row, Ports, P>, optional?: {}) => Promise<void>;
    /** Defaults to `Import <type> '<id>' via publish-content`. `ctx.existing` is not read yet. */
    readonly summary?: (ctx: RepoWriteContext<Row, Ports, P>, optional?: {}) => string | Promise<string>;
  };
  /** `blocked` keeps the error's message; `conflict` wraps it in {@link changedSincePlan}. Anything
   *  else rethrows and aborts the run. `conflict` is matched first, so `blocked` may name a base class
   *  (e.g. Jini's `ToolInputError`) that a conflict class also extends. */
  readonly errors?: { readonly blocked?: readonly ErrorClass[]; readonly conflict?: readonly ErrorClass[] };
  /** Builds every conflict this type reports (the version checks and `errors.conflict`). Defaults to a
   *  plain `PublishContentApplyRowError`; a migrated type may keep its own exported subclass. */
  readonly conflictError?: (required: { message: string }, optional?: Record<string, never>) => PublishContentApplyRowError;

  /** Type-specific handler methods, passed through unchanged. */
  readonly extend?: (ctx: { deps: PublishContentDeps<P>; ports: () => Ports | undefined }, optional?: {}) => Partial<
    Pick<PublishContentHandler, "planRetire" | "retire" | "referencesTo" | "repointReferences" | "verifyApplied" | "seedHash" | "listSkipped" | "isApplyConflict">
  >;
}

/** For a `write` that calls a domain service which runs its own `executeCommand` (no `undo`): the
 *  gateway deps that service needs, or a loud error naming the missing ones. The apply bag
 *  (`apply-loop.ts`'s `PublishContentApplyDeps`) always carries them. */
export function gatewayDeps<P>({ deps, entityType }: { deps: PublishContentDeps<P>; entityType: string }, _optional = {}) {
  const { clock, idGen, changeSets, authorize, outbox } = deps;
  if (!changeSets || !authorize || !outbox) {
    throw new Error(`publish-content: ${entityType}.apply() requires PublishContentDeps.changeSets/authorize/outbox — wire it from the apply-loop composition root (features/publish-content/apply-loop.ts).`);
  }
  return { clock, idGen, changeSets, authorize, outbox };
}

/** Unwraps a Jini-style `Result`, throwing its error for `errors` to map. */
export function okOrThrow<T>({ result }: { result: { ok: true; value: T } | { ok: false; error: Error } }, _optional = {}): T {
  if (!result.ok) throw result.error;
  return result.value;
}

type RepoApplyInput = Parameters<PublishContentHandler["apply"]>[0];

/** What a config fixes before any `deps` exist: the field lists, the hash and the error mapping. */
interface RepoCodec<Row, Ports, P> {
  readonly config: RepoPublishTypeConfig<Row, Ports, P>;
  readonly entityType: string;
  readonly permission: string;
  readonly portsKey: string;
  readonly schemaVersion: number;
  readonly dependsOn: readonly string[];
  readonly idOf: (required: { row: Row }, optional?: Record<string, never>) => string;
  readonly versionOf: (required: { row: Row }, optional?: {}) => number;
  readonly packedFields: readonly string[];
  readonly pick: (required: { row: Row; fields: readonly string[] }, optional?: {}) => Record<string, unknown>;
  readonly hashOf: (required: { row: Row }, optional?: {}) => string;
  readonly conflict: (required: { id: string; detail: string }, optional?: Record<string, never>) => PublishContentApplyRowError;
  readonly toRowError: (required: { err: unknown; id: string }, optional?: Record<string, never>) => unknown;
}

/** A codec bound to one `deps` bag: what every step of one built handler reads. `ports` reads the bag
 *  again each time it is called, so a port wired later is seen. */
interface RepoEnv<Row, Ports, P> extends RepoCodec<Row, Ports, P> {
  readonly deps: PublishContentDeps<P>;
  readonly workspaceId: string;
  readonly ports: () => Ports | undefined;
}

/** One `apply()` call: its input, its ports, and the side-effect undos `write` registered. */
interface RepoApplyRun<Row, Ports, P> {
  readonly env: RepoEnv<Row, Ports, P>;
  readonly ports: Ports;
  readonly input: RepoApplyInput;
  readonly rollbacks: Array<() => Promise<void>>;
}

function fieldsWhere({ fields, keep }: { fields: Record<string, FieldDisposition>; keep: (d: FieldDisposition) => boolean }, _optional = {}) {
  return Object.entries<FieldDisposition>(fields).filter(([, d]) => keep(d)).map(([field]) => field);
}

function createRepoCodec<Row, Ports, P>({ config }: { config: RepoPublishTypeConfig<Row, Ports, P> }, _optional = {}): RepoCodec<Row, Ports, P> {
  const { entityType } = config;
  const packedFields = fieldsWhere({ fields: config.fields, keep: (d) => d !== "local" });
  const hashedFields = fieldsWhere({ fields: config.fields, keep: (d) => d === "transferred" });

  /** Missing values become `null`, so an unset column and SQL `NULL` pack and hash alike, except an
   *  `omitWhenAbsent` field, which is left out. */
  const omittable = new Set(config.omitWhenAbsent ?? []);
  const pick = ({ row, fields }: { row: Row; fields: readonly string[] }, _optional = {}) =>
    Object.fromEntries(
      fields
        .filter((field) => !(omittable.has(field) && (row as Record<string, unknown>)[field] === undefined))
        .map((field) => [field, (row as Record<string, unknown>)[field] ?? null])
    );
  const hashOf = ({ row }: { row: Row }, _optional = {}) =>
    contentHash({ entityType, state: config.legacyHashState ? config.legacyHashState({ row, packedState: pick({ row, fields: packedFields }) }) : pick({ row, fields: hashedFields }) });

  const conflict = ({ id, detail }: { id: string; detail: string }, _optional = {}) => {
    const message = changedSincePlan({ entityType, id, detail });
    return config.conflictError?.({ message }) ?? new PublishContentApplyRowError({ rowOutcome: "conflict", message });
  };

  function toRowError({ err, id }: { err: unknown; id: string }, _optional = {}): unknown {
    if (err instanceof PublishContentApplyRowError || !(err instanceof Error)) return err;
    if (config.errors?.conflict?.some((cls) => err instanceof cls)) {
      return conflict({ id, detail: err.message });
    }
    if (config.errors?.blocked?.some((cls) => err instanceof cls)) return new PublishContentApplyRowError({ rowOutcome: "blocked", message: err.message });
    return err;
  }

  return {
    config,
    entityType,
    permission: config.permission,
    portsKey: config.portsKey ?? entityType,
    schemaVersion: config.schemaVersion ?? 1,
    dependsOn: config.dependsOn ?? [],
    idOf: config.idOf ?? (({ row }: { row: Row }, _optional = {}) => (row as { id: string }).id),
    versionOf: config.versionOf ?? (({ row }: { row: Row }, _optional = {}) => (row as { version: number }).version),
    packedFields,
    pick,
    hashOf,
    conflict,
    toRowError,
  };
}

async function* packRepoEntity<Row, Ports, P>({ env }: { env: RepoEnv<Row, Ports, P> }, _optional = {}): AsyncIterable<PackedEntity> {
  const { config, workspaceId } = env;
  const p = env.ports();
  if (!p) return;
  const rows = (await config.list({ ports: p, workspaceId })).filter((row) => !config.isTrashed?.({ row }) && (config.include?.({ row }) ?? true));
  for (const row of config.packOrder ? config.packOrder({ rows }) : rows) {
    const displayLabel = config.displayLabel?.({ row });
    yield {
      entityType: env.entityType,
      id: env.idOf({ row }),
      schemaVersion: env.schemaVersion,
      contentHash: env.hashOf({ row }),
      hashVersion: CONTENT_HASH_VERSION,
      requiredBlobs: config.requiredBlobs?.({ row }) ?? [],
      state: env.pick({ row, fields: env.packedFields }),
      ...(displayLabel ? { displayLabel } : {}),
    };
  }
}

async function inspectRepoEntity<Row, Ports, P>(
  { env, id }: { env: RepoEnv<Row, Ports, P>; id: string },
  _optional = {}
): Promise<{ version: number; hash: string } | null> {
  const p = env.ports();
  const row = p ? await env.config.find({ ports: p, workspaceId: env.workspaceId, id }) : null;
  return row ? { version: env.versionOf({ row }), hash: env.hashOf({ row }) } : null;
}

async function precheckRepoAddress<Row, Ports, P>(
  { env, entity, p }: { env: RepoEnv<Row, Ports, P>; entity: PackedEntity; p: Ports },
  _options = {}
): Promise<string | null> {
  const { address } = env.config;
  const value = address ? entity.state[address.field] : undefined;
  if (address && typeof value === "string" && value) {
    const holder = await address.holder({ ports: p, workspaceId: env.workspaceId, value, state: entity.state });
    if (holder && env.idOf({ row: holder }) !== entity.id) {
      const held = env.config.isTrashed?.({ row: holder }) ? addressHeldInTrash : addressHeldByOther;
      return held({ entityType: env.entityType, field: address.field, value, holderId: env.idOf({ row: holder }) });
    }
  }
  return null;
}

/** Order (plan §2.2): not wired, address held, destination trashed, then `validate`. */
async function precheckRepoEntity<Row, Ports, P>(
  { env, entity }: { env: RepoEnv<Row, Ports, P>; entity: PackedEntity },
  _optional = {}
): ReturnType<PublishContentHandler["precheck"]> {
  const { config, entityType, workspaceId } = env;
  const p = env.ports();
  if (!p) return notWired({ entityType, id: entity.id, portName: `${env.portsKey} port` });
  const addressReason = await precheckRepoAddress({ env, entity, p });
  if (addressReason !== null) return addressReason;
  const existing = await config.find({ ports: p, workspaceId, id: entity.id });
  if (existing && config.isTrashed?.({ row: existing })) return trashedAtDestination({ entityType, id: entity.id });
  return (await config.validate?.({ ports: p, workspaceId, entity, existing })) ?? null;
}

function unwiredApply({ entityType, what }: { entityType: string; what: string }, _optional = {}): Error {
  return new Error(`publish-content: ${entityType}.apply() requires ${what} — wire it from the apply-loop composition root (features/publish-content/apply-loop.ts).`);
}

function repoWriteContext<Row, Ports, P>(
  { run, existing }: { run: RepoApplyRun<Row, Ports, P>; existing: Row | null },
  _optional = {}
): RepoWriteContext<Row, Ports, P> {
  const { env, input } = run;
  return {
    ports: run.ports,
    deps: env.deps,
    workspaceId: env.workspaceId,
    id: input.entity.id,
    state: input.entity.state,
    existing,
    expectedVersion: input.expectedVersion,
    principalId: input.principalId,
    ...(input.sourceReplacement ? { sourceReplacement: input.sourceReplacement } : {}),
    onRollback: ({ undo }: { undo: () => Promise<void> }, _optional = {}): void => { run.rollbacks.push(undo); },
  };
}

/** The version mismatch (plan §2.2 step 2), or `false` when the destination is as the plan saw it. */
function versionMismatch({ expectedVersion, found }: { expectedVersion: number | undefined; found: number | null }, _optional = {}): string | false {
  if (expectedVersion === undefined) return found !== null && `expected no existing row, found version ${found}`;
  if (found === null) return `expected version ${expectedVersion}, but the row is gone`;
  return found !== expectedVersion && `expected version ${expectedVersion}, found version ${found}`;
}

/** The three CAS failures (plan §2.2 step 2), then the write with its errors mapped. */
async function writeRepoRow<Row, Ports, P>(
  { run, existing }: { run: RepoApplyRun<Row, Ports, P>; existing: Row | null },
  _optional = {}
): Promise<RepoWriteResult> {
  const { env, input } = run;
  const mismatch = versionMismatch({ expectedVersion: input.expectedVersion, found: existing ? env.versionOf({ row: existing }) : null });
  if (mismatch) throw env.conflict({ id: input.entity.id, detail: mismatch });
  try {
    return (await env.config.write(repoWriteContext({ run, existing }))) ?? {};
  } catch (err) {
    throw env.toRowError({ err, id: input.entity.id });
  }
}

/** Compensation for a failed command: the registered side-effect undos (last first), then the row. */
async function rollbackRepoWrite<Row, Ports, P>(
  { run, undo, prior }: { run: RepoApplyRun<Row, Ports, P>; undo: NonNullable<RepoPublishTypeConfig<Row, Ports, P>["undo"]>; prior: Row | null },
  _optional = {}
): Promise<void> {
  for (const sideEffect of run.rollbacks.reverse()) await sideEffect();
  await (prior ? undo.restore({ ctx: repoWriteContext({ run, existing: prior }), prior }) : undo.remove(repoWriteContext({ run, existing: null })));
}

/** `write` inside `executeCommand`: the inverse is the row read in the gateway, so the CAS check and the
 *  inverse are the same, freshest read. */
async function applyRepoWithUndo<Row, Ports, P>(
  { run, undo }: { run: RepoApplyRun<Row, Ports, P>; undo: NonNullable<RepoPublishTypeConfig<Row, Ports, P>["undo"]> },
  _optional = {}
): Promise<{ changeSetId: string }> {
  const { env, input } = run;
  const { changeSets, authorize, outbox } = env.deps;
  if (!changeSets || !authorize || !outbox) throw unwiredApply({ entityType: env.entityType, what: "PublishContentDeps.changeSets/authorize/outbox" });

  const { entity, expectedVersion } = input;
  let prior: Row | null = null;
  const { result, changeSetId } = await executeCommand<RepoWriteResult>({
    deps: { clock: env.deps.clock, idGen: env.deps.idGen, changeSets, outbox, authorize },
    command: {
      workspaceId: env.workspaceId,
      actor: { id: input.principalId, kind: "user" },
      summary: (await undo.summary?.(repoWriteContext({ run, existing: null }))) ?? `Import ${env.entityType} '${entity.id}' via publish-content`,
      permission: env.permission,
      idempotencyKey: input.idempotencyKey,
    },
    mutation: {
      entityType: env.entityType,
      entityId: entity.id,
      operation: expectedVersion === undefined ? "create" : "update",
      // Read inside the gateway so the CAS check and the inverse are the same, freshest read.
      captureInverse: async () => {
        prior = await env.config.find({ ports: run.ports, workspaceId: env.workspaceId, id: entity.id });
        return prior ? ({ ...prior } as unknown as JsonObject) : null;
      },
      execute: () => writeRepoRow({ run, existing: prior }),
      captureEntityVersion: ({ result: written }) => written.version ?? null,
      rollback: () => rollbackRepoWrite({ run, undo, prior }),
    },
  });
  return { ...result, changeSetId };
}

async function applyRepoEntity<Row, Ports, P>(
  { env, input }: { env: RepoEnv<Row, Ports, P>; input: RepoApplyInput },
  _optional = {}
): Promise<{ changeSetId: string }> {
  const p = env.ports();
  if (!p) throw unwiredApply({ entityType: env.entityType, what: `PublishContentDeps.ports.${env.portsKey}` });
  const run: RepoApplyRun<Row, Ports, P> = { env, ports: p, input, rollbacks: [] };
  const { undo } = env.config;
  if (undo) return applyRepoWithUndo({ run, undo });
  const written = await writeRepoRow({ run, existing: await env.config.find({ ports: p, workspaceId: env.workspaceId, id: input.entity.id }) });
  return { ...written, changeSetId: written.changeSetId ?? input.entity.id };
}

function buildRepoHandler<Row, Ports, P>({ codec, deps }: { codec: RepoCodec<Row, Ports, P>; deps: PublishContentDeps<P> }, _optional = {}): PublishContentHandler {
  const { config } = codec;
  const env: RepoEnv<Row, Ports, P> = { ...codec, deps, workspaceId: deps.workspaceId, ports: () => config.ports({ deps }) };
  const references = config.references;
  return {
    entityType: codec.entityType,
    schemaVersion: codec.schemaVersion,
    permission: codec.permission,
    ...(config.alsoAuthorizes ? { alsoAuthorizes: config.alsoAuthorizes } : {}),
    dependsOn: codec.dependsOn,
    pack: () => packRepoEntity({ env }),
    inspect: ({ id }: { id: string }, _optional = {}) => inspectRepoEntity({ env, id }),
    precheck: ({ entity }: { entity: PackedEntity }, _optional = {}) => precheckRepoEntity({ env, entity }),
    apply: (input: RepoApplyInput) => applyRepoEntity({ env, input }),
    ...(references ? { references: ({ entity }: { entity: PackedEntity }) => references({ entity }) } : {}),
    ...config.extend?.({ deps, ports: env.ports }),
  };
}

/** Builds a `PublishContentContributor` from a {@link RepoPublishTypeConfig}. */
export function createRepoPublishHandler<Row, Ports, P>(config: RepoPublishTypeConfig<Row, Ports, P>, _optional = {}): PublishContentContributor<P> {
  const codec = createRepoCodec({ config });
  return {
    entityType: codec.entityType,
    dependsOn: codec.dependsOn,
    build: (deps: PublishContentDeps<P>) => buildRepoHandler({ codec, deps }),
    // Omitted (not `undefined`) when absent: the engine package compiles with `exactOptionalPropertyTypes`.
    ...(config.coversTables ? { coversTables: config.coversTables } : {}),
    ...(config.coversRoots ? { coversRoots: config.coversRoots } : {}),
  };
}
