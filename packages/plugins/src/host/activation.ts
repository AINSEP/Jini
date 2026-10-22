import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file `setPluginEnabled()` / `getActivation()` — gateway-backed enable/disable feature functions
 * (SPEC-005 REQ-07; BR-05; AC-02/AC-13; INV-03/INV-05).
 *
 * Purpose:
 * Mirrors `src/features/presentation/presentation.ts`'s `setActiveTheme`/`getPresentationSettings`
 * shape exactly (Module Map) — a plain feature function, validated and typed-error-throwing, that
 * the ROUTE layer (`src/server/routes/admin/plugins/set-enabled.ts`, C-016) wraps in
 * `executeCommand` (mirrors `admin/posts/update.ts`'s `executeCommand`-wrapped shape, per the
 * ADR's API/Event Contract Summary) — NOT wrapped here. This function itself performs BR-05's
 * three-step precondition evaluation and, on success, upserts the `PluginActivationRecord` and
 * (on enable) invokes the injected load hook / (on disable) the injected unload hook — it does not
 * call the gateway itself.
 *
 * `ext.{pluginId}` data is never touched by either transition (INV-03) — this module has no
 * dependency on `posts.ext` at all, by construction (it only ever touches `plugin_activations`).
 *
 * Architectural role:
 * TDD-certified implementation (implementation outline C-011/C-012). Signatures and JSDoc are
 * design-frozen; `setPluginEnabled()` runs BR-05's three-step evaluation, upserts the activation
 * row, then invokes the injected `onEnabled`/`onDisabled` side effect. If that side effect throws
 * after the row was saved, `restoreOnSideEffectFailure()` compensates — restoring the prior record,
 * or deleting it for a first-time enable/disable — best-effort, before rethrowing the original
 * error unmasked. `getActivation()` is a thin read. Both satisfy
 * `__tests__/integration/activation.integration.test.ts`.
 */
import type { Clock as ClockPort, UUID } from "@jini-ai/core/primitives";
import type { PluginDiscoveryRecord } from "./discovery-types.js";

/** `plugin_activations` row (durable, behind the gateway) — state.spec.md §2. */
export interface PluginActivationRecord {
  readonly pluginId: string;
  readonly workspaceId: UUID;
  /** The active (enabled) installed version — the "active pointer" (ADR-004). */
  readonly version: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
  /** Present only while automatic quarantine is active. A normal enable/disable save omits these
   * fields, which clears the durable marker and makes re-enable the operator recovery action. */
  readonly quarantinedAt?: string;
  readonly quarantineReason?: string;
  readonly quarantineFailureCount?: number;
}

/** Persistence contract — shaped identically to `PresentationSettingsRepoPort` (rule-of-two, two
 * adapters from day one: `repo.memory.ts` / `repo.sqlite.ts`). */
export interface PluginActivationRepoPort {
  getActivation(required: { workspaceId: UUID; pluginId: string }, optional?: Record<string, never>): Promise<PluginActivationRecord | null>;
  save(record: PluginActivationRecord, optional?: Record<string, never>): Promise<void>;
  deleteActivation(required: { workspaceId: UUID; pluginId: string }, optional?: Record<string, never>): Promise<void>;
  /** Every row across every workspace — used by discovery's `enabled` projection and by any
   * future migration, mirrors `PresentationSettingsRepoPort.listAll`. */
  listAll(required?: Record<string, never>, optional?: Record<string, never>): Promise<PluginActivationRecord[]>;
}

/**
 * Restores the repo to its pre-transition state after a side-effect hook (`onEnabled`/
 * `onDisabled`) throws: writes back the record that existed before this transition, or — for a
 * first-time enable/disable where no prior record existed — deletes the row `setPluginEnabled`
 * just created. Best-effort: a compensation failure must never mask the original side-effect
 * error, so this swallows its own failure and lets the caller rethrow the original.
 *
 * @complexity O(1) — one repo write.
 */
async function restoreOnSideEffectFailure(
  repo: PluginActivationRepoPort,
  existing: PluginActivationRecord | null,
  target: { workspaceId: UUID; pluginId: string }
): Promise<void> {
  try {
    if (existing) {
      await repo.save(existing);
    } else {
      await repo.deleteActivation(target);
    }
  } catch {
    // Compensation is best-effort; its failure must not mask the original side-effect error.
  }
}

export class PluginNotFoundError extends Error {}
export class PluginInvalidError extends Error {}
export class PluginIncompatibleError extends Error {}

/** BR-05 step 2: enabling requires a `"valid"` discovered status — `"incompatible"` gets its own
 *  typed error (a fixable-only-by-an-SDK-upgrade condition) distinct from any other non-`"valid"`
 *  status. Never called for a disable — BR-05 has no validity precondition on that direction. */
function assertPluginEnableAllowed(pluginId: string, status: PluginDiscoveryRecord["status"]): void {
  if (status === "incompatible") {
    throw new PluginIncompatibleError(`plugin '${pluginId}' is incompatible with this runtime's SDK version`);
  }
  if (status !== "valid") {
    throw new PluginInvalidError(`plugin '${pluginId}' failed validation and cannot be enabled`);
  }
}

/** The active-version pointer only ever advances on a genuine enable (REQ-02's "active pointer");
 *  disabling must not silently re-point it to whatever discovery currently reports as latest — it
 *  preserves whichever version was actually active (AC-13: disable's version is unchanged from the
 *  enable it inverts). */
function resolveActivationVersion(enabled: boolean, discoveredVersion: string, existingVersion: string | undefined): string {
  if (enabled) return discoveredVersion;
  return existingVersion ?? discoveredVersion;
}

/** Invokes the enable/disable side effect and, on failure, compensates and rethrows the ORIGINAL
 *  error unmasked — one `try`/`catch` instead of the identical pair an enable/disable if/else used
 *  to each carry, since both directions need exactly the same failure handling. */
async function applyActivationSideEffect(
  deps: SetPluginEnabledDeps,
  input: SetPluginEnabledInput,
  existing: PluginActivationRecord | null,
  target: { workspaceId: UUID; pluginId: string }
): Promise<void> {
  try {
    if (input.enabled) {
      await deps.onEnabled?.(input.pluginId);
    } else {
      deps.onDisabled?.(input.pluginId);
    }
  } catch (error) {
    await restoreOnSideEffectFailure(deps.repo, existing, target);
    throw error;
  }
}

export interface SetPluginEnabledDeps {
  clock: ClockPort;
  repo: PluginActivationRepoPort;
  /** The current discovery snapshot — used to evaluate BR-05's "id present in discovery" and
   * (when enabling) "status 'valid'" preconditions. Callers pass a fresh `discoverPlugins()`
   * result; this function does not call discovery itself (keeps it a pure state-transition step
   * over an already-known snapshot, easier to test deterministically). */
  discovery: readonly PluginDiscoveryRecord[];
  /** Invoked on a successful enable transition, after the activation row is saved — the actual
   * `loadPlugin()`/hook-attach side effect. Optional so this function stays testable without a
   * real loader; a real composition root always supplies one. */
  onEnabled?: (pluginId: string) => Promise<void>;
  /** Invoked on a successful disable transition — detaches the plugin's hooks
   * (`hook-registry.ts`'s `detach`). Optional for the same testability reason as `onEnabled`. */
  onDisabled?: (pluginId: string) => void;
}

export interface SetPluginEnabledInput {
  readonly workspaceId: UUID;
  readonly pluginId: string;
  readonly enabled: boolean;
}

export interface SetPluginEnabledRequired {
  deps: SetPluginEnabledDeps;
  input: SetPluginEnabledInput;
}

export type SetPluginEnabledOptional = Record<string, never>

/**
 * BR-05's three-step evaluation: (1) id present in discovery ⇒ else `PluginNotFoundError`;
 * (2) when enabling, discovered `status` is `"valid"` ⇒ else `PluginInvalidError`/
 * `PluginIncompatibleError`; (3) upsert the activation row and invoke the load/unload side
 * effect. Disable has no validity precondition (BR-05) — a plugin that became invalid after being
 * enabled can always still be disabled.
 *
 * @throws {PluginNotFoundError} the plugin id is not present in the given discovery snapshot.
 * @throws {PluginInvalidError} enabling a plugin whose discovered `status` is `"invalid"`.
 * @throws {PluginIncompatibleError} enabling a plugin whose discovered `status` is `"incompatible"`.
 */
export async function setPluginEnabled(
  required: SetPluginEnabledRequired,
  _optional: SetPluginEnabledOptional = {}
): Promise<{ activation: PluginActivationRecord }> {
  const { deps, input } = required;

  const discovered = deps.discovery.find((record) => record.id === input.pluginId);
  if (!discovered) {
    throw new PluginNotFoundError(`plugin '${input.pluginId}' was not found in the current discovery snapshot`);
  }
  if (input.enabled) assertPluginEnableAllowed(input.pluginId, discovered.status);

  const existing = await deps.repo.getActivation({ workspaceId: input.workspaceId, pluginId: input.pluginId });
  const version = resolveActivationVersion(input.enabled, discovered.version, existing?.version);

  const activation: PluginActivationRecord = {
    pluginId: input.pluginId,
    workspaceId: input.workspaceId,
    version,
    enabled: input.enabled,
    updatedAt: clockNowIso({ clock: deps.clock }),
  };

  await deps.repo.save(activation);
  await applyActivationSideEffect(deps, input, existing, { workspaceId: input.workspaceId, pluginId: input.pluginId });

  return { activation };
}

export interface GetActivationRequired {
  deps: { repo: PluginActivationRepoPort };
  input: { workspaceId: UUID; pluginId: string };
}

export type GetActivationOptional = Record<string, never>

/** Reads current activation state for projection into `PLUGINS_LIST` (state.spec.md §5). `null`
 * means "never enabled" (treated as disabled), not an error. */
export async function getActivation(
  required: GetActivationRequired,
  _optional: GetActivationOptional = {}
): Promise<PluginActivationRecord | null> {
  return required.deps.repo.getActivation(required.input);
}
