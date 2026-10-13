/**
 * @file `retireBundledAgentPlugins()` — removes bundled Agent Plugins the host no longer ships from a
 * workspace, and moves their users onto the plugin that absorbed them. Runs on every boot from
 * `seed-bundled.ts`, after seeding, and is a no-op once a workspace has been migrated.
 *
 * ---------------------------------------------------------------------------
 * Why a retirement step exists
 * ---------------------------------------------------------------------------
 * Deleting `content/agent-plugins/<id>/` stops the seeder installing a plugin, but it removes nothing
 * a workspace already has: the installed package stays under `packages/sha256/`, its activation
 * record stays in `activations.json`, and its digest stays in `bundled-digests.json`. An ENABLED
 * leftover keeps its skill in every prompt, now duplicating (and slowly contradicting) the successor
 * that carries the same content. And the operator cannot remove it: `uninstall.ts` refuses a
 * bundled plugin because it would be re-seeded, which is exactly what stops being true here. Owner
 * rule: the user never fixes anything by hand, so the boot does it.
 *
 * ---------------------------------------------------------------------------
 * What happens per retired id (idempotent)
 * ---------------------------------------------------------------------------
 * 1. Nothing installed and no activation record: nothing to do (the second boot after a migration).
 *    A leftover ledger entry is still dropped.
 * 1a. Otherwise EVERY successor must be usable first: installed at the digest `bundled-digests.json`
 *    records for it (the build's own seed — the same trust `trusted-plugin-files.ts` demands before
 *    core takes a contribution from it), whether it seeded this boot or on an earlier one. If any
 *    is not, the retired plugin is KEPT and the outcome is `failed` with the reason; the next boot
 *    retries. Without this a successor whose seed failed (a broken `plugin.json`, a full disk) left
 *    the retired plugin removed and only an activation record for the successor — a switch with no
 *    code behind it (R6, 2026-10-12). A plugin split into several (`deploy` -> `fly`, `render`, ...)
 *    is kept until all of them are usable: one working successor must not cost the others' capability.
 * 2. The retired plugin was ENABLED (explicitly, or by the "absent means active" default while its
 *    package is installed): the successor is switched on — unless an operator explicitly turned the
 *    successor off, which is left exactly as it is and reported in the outcome. No silent override.
 * 3. The retired plugin's package(s) and activation record are removed through `uninstall.ts`
 *    (`retiredBundled: true` skips only its bundled refusal). A record with no package left is
 *    deleted directly.
 * 4. The retired id is dropped from `bundled-digests.json`.
 *
 * A malformed or unreadable activation record for the retired id stops that id's retirement with a
 * `failed` outcome and changes nothing: whether the operator had it enabled cannot be established,
 * so neither enabling the successor nor deleting the record is safe. The next boot retries.
 *
 * Out of scope on purpose: nothing a retired plugin could own survives it. Agent Plugins have no
 * per-plugin settings store (a workspace's `data/<pluginId>` directory has no production writer),
 * and custom credentials (a saved `fly.io` token, say) belong to the workspace, not to a plugin.
 *
 * Architectural role:
 * Composition over `activation.ts`, `uninstall.ts`, and `bundled-digests.ts`. Never throws: every
 * failure is captured per id, exactly like `seed-bundled.ts`'s own outcomes, so one stuck retirement
 * cannot stop a workspace from booting.
 */
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type {  BundledAgentPluginEnableOutcome } from "./activation.js";
import { createActivationModule } from "./activation.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import type { AgentPluginLayout } from "./layout.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import { createUninstallModule } from "./uninstall.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

/** What happened to the successor. `not-needed`: the retired plugin was off, so the successor was
 *  left as it was. The other three are {@link BundledAgentPluginEnableOutcome}. */
export type RetiredAgentPluginSuccessorOutcome = BundledAgentPluginEnableOutcome | "not-needed";

/** `successorId` is the (first) successor; `successorIds` is present only when the map entry lists
 *  several, and then names every one in map order. */
interface RetiredAgentPluginSuccessors {
  readonly successorId: string;
  readonly successorIds?: readonly string[] | undefined;
}

export type RetiredAgentPluginOutcome =
  | (RetiredAgentPluginSuccessors & { readonly pluginId: string; readonly status: "absent" })
  | (RetiredAgentPluginSuccessors & {
      readonly pluginId: string;
      readonly status: "retired";

      /** Every installed archive digest removed; empty when only a record or ledger entry was left. */
  readonly removedDigests: readonly string[];
      readonly activationRemoved: boolean;
      readonly ledgerEntryRemoved: boolean;

      /** `left-disabled-by-operator` is the one case a caller should surface: the retired plugin was
       *  on, its successor was explicitly turned off, and this step did not override that. */
  readonly successor: RetiredAgentPluginSuccessorOutcome;

      /** Present only with `successorIds`: each successor's own outcome. `successor` is the first's. */
  readonly successors?: Readonly<Record<string, RetiredAgentPluginSuccessorOutcome>> | undefined;
    })
  | (RetiredAgentPluginSuccessors & { readonly pluginId: string; readonly status: "failed"; readonly reason: string });

export interface RetireBundledAgentPluginsRequired {

  /** The INSTANCE-level layout, for the same reason `seed-bundled.ts` takes one. */
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
}

export interface RetireBundledAgentPluginsOptional {

  /** Defaults to the host's `retiredBundledPlugins` port; tests pass their own. A value lists
   *  several successors when the retired plugin was split across them. */
  readonly retired?: (ReadonlyMap<string, string | readonly string[]>) | undefined;
  readonly now?: ((required: Record<string, never>) => Date) | undefined;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const { deleteAgentPluginActivation, enableBundledAgentPluginUnlessOperatorDisabled, readAgentPluginActivations, resolveAgentPluginActivation } = createActivationModule(ports);
  const { readBundledAgentPluginDigests, removeBundledAgentPluginDigest } = createBundledDigestsModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
  const { uninstallAgentPlugin } = createUninstallModule(ports);
  /**
 * Retires every id in `retired` from one workspace. See this file's header for the steps.
 *
 * @returns One outcome per retired id, in map order.
 * @throws Nothing.
 * @complexity O(r) retired ids, each one `listInstalledPlugins` walk plus a few small file writes.
 */
  async function retireBundledAgentPlugins(
    required: RetireBundledAgentPluginsRequired,
    optional: RetireBundledAgentPluginsOptional = {},
  ): Promise<readonly RetiredAgentPluginOutcome[]> {
    const outcomes: RetiredAgentPluginOutcome[] = [];
    for (const [pluginId, successor] of optional.retired ?? ports.retiredBundledPlugins) {
      const successorIds: readonly string[] = typeof successor === "string" ? [successor] : successor;
      const ids = { successorId: successorIds[0] ?? "", ...(typeof successor === "string" ? {} : { successorIds }) };
      try {
        outcomes.push(await retireOne(required, optional, pluginId, ids));
      } catch (error) {
        outcomes.push({ pluginId, ...ids, status: "failed", reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcomes;
  }

  // The successor first: if a later step fails, the operator keeps the capability, and the next boot
// (which finds this step already done) retries only what is left.
  async function retireOne(
    required: RetireBundledAgentPluginsRequired,
    optional: RetireBundledAgentPluginsOptional,
    pluginId: string,
    ids: RetiredAgentPluginSuccessors,
  ): Promise<RetiredAgentPluginOutcome> {
    const workspaceLayout = required.layout.forWorkspace({ workspaceId: required.workspaceId });
    const workspaceRoot = workspaceLayout.root;
    const successorIds = ids.successorIds ?? [ids.successorId];

    const verdict = await resolveAgentPluginActivation(workspaceRoot, pluginId);
    if (verdict.verdict === "undetermined") {
      return { pluginId, ...ids, status: "failed", reason: `cannot tell whether '${pluginId}' was enabled: ${verdict.reason}` };
    }

    const allInstalled = await listInstalledPlugins(workspaceLayout.root);
    const installed = allInstalled.filter((plugin) => plugin.pluginId === pluginId);
    const hasRecord = Object.hasOwn((await readAgentPluginActivations(workspaceRoot)).plugins, pluginId);

    if (installed.length === 0 && !hasRecord) {
      const ledgerEntryRemoved = await removeBundledAgentPluginDigest({ workspaceRoot, pluginId });
      if (!ledgerEntryRemoved) return { pluginId, ...ids, status: "absent" };
      return { pluginId, ...ids, status: "retired", removedDigests: [], activationRemoved: false, ledgerEntryRemoved, successor: "not-needed", ...(ids.successorIds ? { successors: {} } : {}) };
    }

    const unusable = await unusableSuccessor(workspaceRoot, allInstalled, successorIds);
    if (unusable !== undefined) {
      return { pluginId, ...ids, status: "failed", reason: `'${pluginId}' is kept until every successor is usable: ${unusable}` };
    }

    const successors: Record<string, RetiredAgentPluginSuccessorOutcome> = {};
    for (const successorId of successorIds) {
      successors[successorId] =
        verdict.verdict === "active"
          ? await enableBundledAgentPluginUnlessOperatorDisabled({
              workspaceRoot,
              pluginId: successorId,
              actor: `system:retire-${pluginId}`,
              ...(optional.now !== undefined ? { now: optional.now } : {}),
            })
          : "not-needed";
    }
    const successor = successors[ids.successorId] ?? "not-needed";

    let removedDigests: readonly string[] = [];
    if (installed.length > 0) {
      removedDigests = (
        await uninstallAgentPlugin({ layout: required.layout, workspaceId: required.workspaceId, pluginId }, { retiredBundled: true })
      ).removedDigests;
    } else {
      await deleteAgentPluginActivation({ workspaceRoot, pluginId });
    }

    const ledgerEntryRemoved = await removeBundledAgentPluginDigest({ workspaceRoot, pluginId });
    return { pluginId, ...ids, status: "retired", removedDigests, activationRemoved: hasRecord, ledgerEntryRemoved, successor, ...(ids.successorIds ? { successors } : {}) };
  }

  /** Why one of `successorIds` cannot take over yet, or `undefined` when every one is installed at the
 *  digest the ledger records for it (this file's header, step 1a).
 *  @complexity O(s * n) for s successors over n installed packages; both are small bundled counts. */
  async function unusableSuccessor(
    workspaceRoot: string,
    allInstalled: readonly { readonly pluginId: string; readonly archiveDigest: string }[],
    successorIds: readonly string[],
  ): Promise<string | undefined> {
    const ledger = await readBundledAgentPluginDigests(workspaceRoot);
    for (const successorId of successorIds) {
      const digest = ledger.get(successorId);
      if (digest === undefined) return `successor '${successorId}' has never been seeded into this workspace`;
      if (!allInstalled.some((plugin) => plugin.pluginId === successorId && plugin.archiveDigest === digest)) {
        return `successor '${successorId}' is not installed at its seeded digest`;
      }
    }
    return undefined;
  }

  return { retireBundledAgentPlugins };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createRetireBundledModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
