import { orFallback, orFallbackSync } from "@jini-ai/core/errors/idioms";

/**
 * @file D1 (2026-09-24 owner decision, publish-types-plan §6) — the "seed version" of a destination
 * row, the virtual baseline `planner.ts` (`PlanImportDeps.getSeedHash`) and `apply-loop.ts` fall
 * back to when no `publish_content_baselines` row exists yet.
 *
 * Where it runs: on the DESTINATION. `planImport()` and the apply loop both run on the instance that
 * receives the bundle, so "what did this row look like when this instance was first hydrated" is a
 * question only the destination can answer — and it can, because the stock seed it hydrated from
 * ships inside its own image (`builtInContentSeedDbPath()`, `hydrate-content-db-from-seed.ts`).
 *
 * How the hash is obtained: every registered contributor is built against a `PublishContentDeps`
 * whose repos read the SEED database instead of the live one, and its ordinary `inspect(id)` answers.
 * That is the same projection and the same `contentHash()` the live row is inspected through, so the
 * two hashes are comparable by construction — no second hashing path that could drift.
 *
 * Fail-safe: any miss (no seed shipped, entity absent from the seed, type absent, the seed failing
 * to open) answers `null`, which the planner reads as "no seed baseline" — the unchanged, pre-D1
 * `conflict`. This lookup can only ever turn a conflict into an overwrite when the destination row
 * is byte-for-byte what the seed put there.
 */

/** The lookup `PlanImportDeps.getSeedHash` and the apply loop's re-verification both consume. */
export type PublishContentSeedHashFn = (args: { entityType: string; entityId: string }) => Promise<string | null>;

/** The explicit "this instance has no seed" answer — the hermetic composition root and any caller
 *  that must not consult one. Always `null`, so every no-baseline row stays a `conflict`. */
export const NO_PUBLISH_CONTENT_SEED_HASH: PublishContentSeedHashFn = async () => null;

/** The slice of the host's publish-content catalog this lookup reads: one handler per entity type,
 *  each able to `inspect()` a row by id and report its content hash. */
export interface PublishContentSeedCatalog {
  readonly handlerByType: ReadonlyMap<string, {
    inspect(required: { id: string }, optional?: Record<string, never>): Promise<{ hash: string } | null>;
  }>;
}

export interface CreatePublishContentSeedHashInput<TDeps> {
  /**
   * Builds the seed-backed deps bag, or `null` when this instance ships no seed. Called at most
   * once, lazily, on the first lookup — opening the seed costs a file copy and a migration pass, so
   * a process that never plans an import never pays it. A throw is treated exactly like `null`.
   */
  readonly loadSeedDeps: () => TDeps | null;
  /** Builds the host's publish-content catalog over a deps bag (the host binds its type registry's
   *  `buildPublishContentCatalog`). Called on every lookup, never cached — see below. */
  readonly buildCatalog: (deps: TDeps) => PublishContentSeedCatalog;
}

/**
 * Creates the destination's seed-hash lookup. See this file's header.
 *
 * @complexity O(1) per lookup after the first — one contributor build per type (cheap closures) and
 *   one `inspect()` read against the seed. The first lookup additionally pays `loadSeedDeps()` once.
 */
export function createPublishContentSeedHash<TDeps>(input: CreatePublishContentSeedHashInput<TDeps>, _optional = {}): PublishContentSeedHashFn {
  let seedDeps: TDeps | null | undefined;

  function resolveSeedDeps(): TDeps | null {
    if (seedDeps !== undefined) return seedDeps;
    seedDeps = orFallbackSync({ work: () => input.loadSeedDeps(), fallback: null, step: "Read publish seed dependencies" });
    return seedDeps;
  }

  return async ({ entityType, entityId }) => {
    const deps = resolveSeedDeps();
    if (!deps) return null;
    // Read fresh every call, like `planImport()` does — the registry is the one source of which
    // types exist, and a seed lookup for a type the planner no longer knows must not answer.
    const handler = input.buildCatalog(deps).handlerByType.get(entityType);
    if (!handler) return null;
    return orFallback({ work: async () => {
      const found = await handler.inspect({ id: entityId });
      return found ? found.hash : null;
    }, fallback: null, step: "Inspect publish seed hash" });
  };
}
