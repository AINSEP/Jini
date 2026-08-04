import type { JsonValue } from "../core/ports.js";
import { DefinitionInvalidError, SecretNotSupportedError } from "./errors.js";
import type { SettingsRepoPort } from "./ports.js";
import {
  SCOPE_BIT,
  type SettingDefinitionRecord,
  type SettingOwnerKind,
  type SettingScopeContext,
  type SettingValueRecord,
  type SettingValueSchema,
} from "./types.js";

/**
 * @file The settings resolver + pure definition-registration validation
 * (REQ-02, REQ-03, REQ-09; "one evaluator").
 *
 * Purpose:
 * `validateDefinitionInput` is pure (no I/O) — the write-side chokepoint in
 * `write-service.ts` calls it before persisting. `getEffective`/`getLayer`/
 * `resolveDefinition` are read-only against `SettingsRepoPort`. Neither
 * mutates anything; every mutation goes through `write-service.ts`.
 */

export interface DefinitionInput {
  namespace: string;
  key: string;
  ownerKind: SettingOwnerKind;
  workspaceId: string | null;
  ownerId?: string | null | undefined;
  schema: SettingValueSchema;
  defaultValue: JsonValue | null;
  scopes: number;
  secret: boolean;
}

const NAMESPACE_FENCE: Record<SettingOwnerKind, (input: DefinitionInput) => boolean> = {
  core: (input) => input.namespace.startsWith("core.") && input.workspaceId === null,
  theme: (input) => input.namespace.startsWith("theme.") && input.workspaceId === null,
  site: (input) => input.namespace.startsWith("site.") && input.workspaceId !== null,
};

/**
 * REQ-02/REQ-09/INV-05/INV-08 — the pure half of `registerDefinitions`.
 * Never throws; returns a discriminated result so the chokepoint decides how
 * to surface the failure (matches `ValueValidationFailedError`'s pattern of
 * keeping I/O out of validation).
 *
 * @complexity O(1) per definition.
 * @overallScore 100
 */
export function validateDefinitionInput(
  input: DefinitionInput
): { valid: true } | { valid: false; error: DefinitionInvalidError | SecretNotSupportedError } {
  if (input.secret) {
    return {
      valid: false,
      error: new SecretNotSupportedError(
        "secret:true definitions are not supported in the core-only subset (REQ-09/INV-08)"
      ),
    };
  }

  if (!NAMESPACE_FENCE[input.ownerKind](input)) {
    return {
      valid: false,
      error: new DefinitionInvalidError(
        `namespace '${input.namespace}' does not match the owner fence for owner_kind '${input.ownerKind}' (REQ-02)`
      ),
    };
  }

  if (input.scopes < 1 || input.scopes > 7) {
    return {
      valid: false,
      error: new DefinitionInvalidError(`scopes bitmask ${input.scopes} is out of range 1..7`),
    };
  }

  // INV-05: a site-owned def (workspace_id NOT NULL) may never declare the global scope bit.
  if (input.workspaceId !== null && (input.scopes & SCOPE_BIT.global) !== 0) {
    return {
      valid: false,
      error: new DefinitionInvalidError(
        "a site-owned definition may not declare the global scope bit (INV-05)"
      ),
    };
  }

  // Totality (behavior.spec §3): every non-secret def needs a non-null default so
  // getEffective is always total (INV-02) and factory-reset is provably bootable.
  if (input.defaultValue === null) {
    return {
      valid: false,
      error: new DefinitionInvalidError(
        "non-secret definitions require a non-null default_json (totality, INV-02)"
      ),
    };
  }

  return { valid: true };
}

export function validateValueAgainstSchema(schema: SettingValueSchema, value: JsonValue): boolean {
  if (value === null) return schema.nullable === true;
  switch (schema.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && schema.values.includes(value);
    case "json":
      // ADR-PIPE-008 Decision §3: any JSON value is accepted; internal shape/
      // length validation is the registering feature's own write-path job.
      return true;
  }
}

/** Identity-registry of total coercers keyed by `coercionTag` (EC-08). `"identity"` is always registered. */
const coercers = new Map<string, (value: JsonValue) => JsonValue>([["identity", (v) => v]]);

export function registerCoercer(tag: string, fn: (value: JsonValue) => JsonValue): void {
  coercers.set(tag, fn);
}

/**
 * Workspace-qualified definition cache (SPEC-007 REQ-12, AC-20; ADR-028 §8
 * "Cache, definition cache, and API").
 *
 * ## There is no per-layer VALUE cache here. Do not add one without reading this note.
 *
 * ADR-028 §8 also specifies a value cache keyed
 * `settings:{global | ws:{wsId} | user:{wsId}:{pid}}:{ns}`, invalidated by the write that owned
 * each key. It is correct for a single-process host and NOT correct once a second process shares
 * the same store: a `WeakMap<SettingsRepoPort, ...>`-held cache is scoped to one repo instance in
 * one OS process, and its invalidation is a `set()` call against that SAME instance. Any host that
 * runs a second process against the same underlying storage (a background daemon, a worker, a
 * second server instance) will observe stale reads with no TTL to bound them — this is not a
 * theoretical risk, it is the exact bug a value cache produced in the host this library was
 * extracted from: a background process wrote a new value, the row on disk was correct, and a
 * different process's cached read kept answering the old value across full page reloads, worse
 * than a constant failure because it reproduced only when that process happened to hold the key
 * cached.
 *
 * What replaces it: nothing. Layer reads go straight to the repo. These are indexed primary-key
 * lookups, at most three per resolved key. Correctness across any number of processes is worth
 * more than that.
 *
 * ## The DEFINITION cache below is kept, and the asymmetry is deliberate
 *
 * It is workspace-qualified (`{wsId|"platform"}:{ns}:{key}`) — site-owned defs are per-workspace
 * data, so ADR-007 applies to it too — and invalidated lazily by a per-namespace epoch folded into
 * the key, so old-epoch entries are never looked up again rather than being enumerated.
 *
 * It carries the same cross-process exposure in principle, and it is kept anyway because its
 * writers are different in kind: definitions are registered at boot and mutated only by
 * definition-lifecycle admin routes, and `settings_register_definitions` is permanently excluded
 * from agent callability. A host that only ever writes definitions from its main process never
 * observes staleness here. That is a judgement about likelihood, not a proof of safety: if
 * definition writes ever become reachable from a second process for a given host, this cache has
 * to go the same way the value cache did.
 */
interface SettingsCacheStore {
  /** `def:{workspaceId|"platform"}:{namespace}:{key}:e{epoch}` -> resolved definition (or null = confirmed absent). */
  definitions: Map<string, SettingDefinitionRecord | null>;
  /** namespace -> epoch, bumped by any definition-lifecycle write against that namespace. */
  epoch: Map<string, number>;
}

const cacheByRepo = new WeakMap<SettingsRepoPort, SettingsCacheStore>();

function getCacheStore(repo: SettingsRepoPort): SettingsCacheStore {
  let store = cacheByRepo.get(repo);
  if (!store) {
    store = { definitions: new Map(), epoch: new Map() };
    cacheByRepo.set(repo, store);
  }
  return store;
}

function namespaceEpoch(store: SettingsCacheStore, namespace: string): number {
  return store.epoch.get(namespace) ?? 0;
}

function workspaceCachePart(workspaceId: string | null | undefined): string {
  return workspaceId ?? "platform";
}

function definitionCacheKey(workspaceId: string | null, namespace: string, key: string, epoch: number): string {
  return `def:${workspaceCachePart(workspaceId)}:${namespace}:${key}:e${epoch}`;
}

/**
 * Bumps the namespace's definition-cache epoch (ADR-028 §8's lazy
 * invalidation) — every previously-cached definition-cache entry for this
 * namespace (across every workspace) becomes unreachable on the next read,
 * without needing to enumerate tenants. Call after any write that changes a
 * definition's identity/shape/status in this namespace: register, rename
 * (both the old and new namespace), retype, deprecate, tombstone.
 */
export function invalidateDefinitionNamespaceCache(repo: SettingsRepoPort, namespace: string): void {
  const store = getCacheStore(repo);
  store.epoch.set(namespace, namespaceEpoch(store, namespace) + 1);
}

/**
 * Purge support — now a no-op, deliberately kept rather than deleted.
 *
 * This cleared the workspace- and user-scope layer-cache entries a tenant/principal teardown
 * invalidated, because a purge deletes an unbounded number of value rows across an unknown set of
 * namespaces and per-namespace single-key invalidation was not practical for it. With the layer
 * cache gone (see this module's cache header) there is nothing left to clear: the rows are deleted,
 * and the next read goes to the repo and sees them gone.
 *
 * Kept as an explicit no-op instead of removed because of what it guards. `purge-service.ts` calls
 * it as the last step of deleting a tenant's settings, and its correctness question — "can a purged
 * value still be read back?" — is exactly the kind that must be answered again if anyone
 * reintroduces caching. Deleting the call site would remove the place that question is asked. A
 * cache added without restoring a purge hook is a tenant-teardown leak, so this stays as the seam.
 */
export function invalidateWorkspaceSettingsCache(_repo: SettingsRepoPort, _workspaceId: string, _principalId?: string): void {
  // Intentionally empty — see doc above. Do not delete without re-reading `purge-service.ts`.
}

/**
 * Follows an alias marker (depth <=1) to the current row and returns it as
 * stored — status intact, including `tombstone`. `resolveDefinition` (below)
 * is the read-path wrapper that collapses tombstone to typed-absent (EC-10);
 * `write-service.ts` uses this raw form directly so it can report
 * `DEFINITION_TOMBSTONED` distinctly from "not found".
 */
export async function resolveDefinitionRaw(
  deps: { repo: SettingsRepoPort },
  input: { namespace: string; key: string; workspaceId: string | null }
): Promise<SettingDefinitionRecord | null> {
  // Namespace fencing (REQ-02) makes `site.*` (non-null workspace_id) and
  // `core.*`/`theme.*` (null workspace_id) disjoint by construction, so a
  // caller resolving inside a workspace context may still be asking for a
  // platform definition. Try the caller's own partition first, then fall
  // back to the platform (null) partition.
  const found =
    (await deps.repo.findActiveDefinition(input)) ??
    (input.workspaceId !== null
      ? await deps.repo.findActiveDefinition({ ...input, workspaceId: null })
      : null);
  if (!found) return null;
  if (found.status === "alias") {
    if (found.aliasOfNamespace == null || found.aliasOfKey == null) return null;
    return resolveDefinitionRaw(deps, {
      namespace: found.aliasOfNamespace,
      key: found.aliasOfKey,
      workspaceId: input.workspaceId,
    });
  }
  return found;
}

/**
 * REQ-03 — the read-path resolver: typed-absent (`null`) for a tombstoned or
 * missing key (EC-10). Cached (AC-19/AC-20, ADR-028 §8) — keyed by
 * `(workspaceId, namespace, key, namespace-epoch)`, so it is workspace-
 * qualified by construction (AC-20) and invalidated wholesale by
 * `invalidateDefinitionNamespaceCache` on any definition-lifecycle write
 * (register/rename/retype/deprecate/tombstone). `resolveDefinitionRaw`
 * itself stays uncached — the write chokepoint (`write-service.ts`) calls it
 * directly so authorization/validation decisions are always made against
 * live data, never a cached read.
 */
export async function resolveDefinition(
  deps: { repo: SettingsRepoPort },
  input: { namespace: string; key: string; workspaceId: string | null }
): Promise<SettingDefinitionRecord | null> {
  const store = getCacheStore(deps.repo);
  const epoch = namespaceEpoch(store, input.namespace);
  const cacheKey = definitionCacheKey(input.workspaceId, input.namespace, input.key, epoch);
  if (store.definitions.has(cacheKey)) return store.definitions.get(cacheKey)!;

  const found = await resolveDefinitionRaw(deps, input);
  const resolved = !found || found.status === "tombstone" ? null : found;
  store.definitions.set(cacheKey, resolved);
  return resolved;
}

export interface ResolvedSetting {
  value: JsonValue | null;
  sourceLayer: "user" | "workspace" | "global" | "default";
  defVersion: number;
}

/**
 * REQ-03/INV-02 — total for a live key: never throws, never returns
 * undefined. Precedence `user ?? workspace ?? global ?? default`. A
 * `cleared` row is treated as absent at that layer (behavior.spec §1.2).
 *
 * Per-layer reads go straight to the repo (see this module's cache header for
 * why the per-layer value cache that used to wrap these three calls does not
 * exist here).
 *
 * @complexity O(1) — up to 3 layer reads + 1 definition read.
 * @overallScore 100
 */
export async function getEffective(
  deps: { repo: SettingsRepoPort },
  input: { namespace: string; key: string; scopeContext: SettingScopeContext }
): Promise<ResolvedSetting | null> {
  const definition = await resolveDefinition(deps, {
    namespace: input.namespace,
    key: input.key,
    workspaceId: input.scopeContext.workspaceId ?? null,
  });
  if (!definition) return null;

  const coerce = (value: JsonValue, defVersion: number): JsonValue => {
    if (defVersion === definition.version) return value;
    const coercer = coercers.get(definition.coercionTag ?? "identity") ?? coercers.get("identity")!;
    return coercer(value);
  };

  // Every layer read below goes straight to the repo. See this module's cache header for why there
  // is no per-layer cache wrapping these three calls.
  if (input.scopeContext.workspaceId && input.scopeContext.principalId) {
    const workspaceId = input.scopeContext.workspaceId;
    const principalId = input.scopeContext.principalId;
    const userValue = await deps.repo.getUserValue({ workspaceId, principalId, settingId: definition.settingId });
    if (userValue && userValue.state === "set") {
      return {
        value: coerce(userValue.valueJson, userValue.defVersion),
        sourceLayer: "user",
        defVersion: definition.version,
      };
    }
  }

  if (input.scopeContext.workspaceId) {
    const workspaceId = input.scopeContext.workspaceId;
    const workspaceValue = await deps.repo.getWorkspaceValue({ workspaceId, settingId: definition.settingId });
    if (workspaceValue && workspaceValue.state === "set") {
      return {
        value: coerce(workspaceValue.valueJson, workspaceValue.defVersion),
        sourceLayer: "workspace",
        defVersion: definition.version,
      };
    }
  }

  const globalValue = await deps.repo.getGlobalValue(definition.settingId);
  if (globalValue && globalValue.state === "set") {
    return {
      value: coerce(globalValue.valueJson, globalValue.defVersion),
      sourceLayer: "global",
      defVersion: definition.version,
    };
  }

  return { value: definition.defaultValue, sourceLayer: "default", defVersion: definition.version };
}
