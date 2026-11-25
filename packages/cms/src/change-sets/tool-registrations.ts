import { toolMetadata } from '@jini-ai/core/tool-metadata/change-sets';
import { type Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { AGENT_TOOL_PRINCIPAL_KIND, ToolInputError } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, optionalNumber, requireInputRecord, requireString, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import {
  type AuthorizeFn,
  type ChangeSetRecord,
  type OutboxPort,
  type ChangeSetRepoPort,
} from "@jini-ai/core/contracts/events";

import type { ToolContributor } from "@jini-ai/core";
import {
  ChangeSetInvalidStatusError,
  ChangeSetNotFoundError,
  RevertConflictError,
  RevertNotPossibleError,
  revertChangeSet,
  type RevertRegistry,
} from "../core/commands/index.js";

import {
  CHANGE_SET_READ_PERMISSION,
  CHANGE_SET_REVERT_PERMISSION,
  CHANGE_SETS_DEFAULT_LIST_LIMIT,
  CHANGE_SETS_MAX_LIST_LIMIT,
  getChangeSetsAgentToolCatalog,
} from "./agent-tools.js";

/**
 * @file `change_sets_list` + `change_sets_revert` (F7b option A, S6, 2026-09-24) — the agent-callable
 * half of the Recovery page's own list/revert routes, wired directly onto `core/commands`'
 * `listByWorkspace`/`revertChangeSet` the same way `server/inbound/admin-http/routes/change-sets/
 * {list,revert}.ts` already are. Read `agent-tools.ts`'s own header first for the scope this pass
 * deliberately holds to (post/page create/update/delete only) and why `force` is not a parameter
 * here at all.
 *
 * Own domain (files, not folded into an existing one): this surface shares no validator with any
 * other domain's tools — it reads/writes `change_sets`/`change_set_items` only, through the same
 * `ChangeSetRepoPort`/`RevertRegistry` the HTTP routes already depend on.
 *
 * Error mapping (mirrors `change-sets/revert.ts`'s `sendChangeSetRevertError`, adapted from HTTP
 * status codes to what a model can act on directly):
 * - `RevertConflictError` is NOT re-thrown — it becomes a `{ reverted: false, code:
 *   "REVERT_CONFLICT", currentVersion }` result, because "someone changed it since" is not a
 *   different-input problem an agent can fix by retrying; the tool's own note tells it to defer to
 *   a human instead.
 * - `ChangeSetNotFoundError` / `ChangeSetInvalidStatusError` / `RevertNotPossibleError` ARE
 *   different-input problems (a wrong id, a change set that was never applied or already reverted,
 *   or one this codebase cannot invert) — each becomes a `ToolInputError` carrying the domain's own
 *   message, so the model sees exactly why and does not retry the identical call.
 * - `RevertForbiddenError` is not caught here at all: this handler always sends `force: false`, and
 *   that error can only fire when `force: true` — see `revertChangeSet`'s own precondition order.
 */

/**
 * The exact slice of the route-deps bag this domain's tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) for the same back-edge reason
 * `ThemeToolDeps` gives — `server/routes/*` satisfies this structurally by passing its existing
 * `RouteDeps` object; nothing there changes.
 */
export interface ChangeSetToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  changeSets: ChangeSetRepoPort;
  /** The SAME registry `change-sets/revert.ts`'s HTTP route reverts through — one shared instance,
   *  so an agent revert and a human revert can never disagree on what a change set's inverse is. */
  revertRegistry: RevertRegistry;
  clock: Clock;
  idGen: { newId(): string };
  outbox: OutboxPort;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration. Built per call so no module-level map is shared between hosts.
 */
export function changeSetsDerivedRisk(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): DerivedRiskByToolId {
  return new Map<string, AgentToolSideEffect>([
    // -> changeSets.listByWorkspace(): a read against the change_sets table, no write.
    ["change_sets_list", "none"],
    // -> revertChangeSet(): applies one or more inverse writes through the registered reverters
    //    (e.g. postRepo.save()), plus a change-set status update. Durable.
    ["change_sets_revert", "mutates-durable-state"],
  ]);
}

/**
 * Model-facing change-set view, shared with `admin-http/http/change-sets.ts#toChangeSetHeaderResponse`,
 * which delegates here.
 * `inversePayload` is never exposed here either, for the identical reason that file's own header
 * gives — it may hold full content snapshots.
 */
export function toChangeSetView({ changeSet }: { changeSet: ChangeSetRecord }, _optional: Record<string, never> = {}) {
  return {
    id: changeSet.id,
    workspaceId: changeSet.workspaceId,
    actorId: changeSet.actorId ?? null,
    status: changeSet.status,
    summary: changeSet.summary,
    intentRef: changeSet.intentRef ?? null,
    createdAt: changeSet.createdAt,
    appliedAt: changeSet.appliedAt ?? null,
    revertedAt: changeSet.revertedAt ?? null,
  };
}

    async function listChangeSets(routeDeps: ChangeSetToolDeps, ctx: Parameters<ToolHandler>[0]) {
      const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: CHANGE_SET_READ_PERMISSION }, { entityType: "change_set" });

      const requested = optionalNumber({ input: input, key: "limit" }) ?? CHANGE_SETS_DEFAULT_LIST_LIMIT;
      const limit = Math.min(Math.max(requested, 1), CHANGE_SETS_MAX_LIST_LIMIT);

      const all = await routeDeps.changeSets.listByWorkspace({ workspaceId: routeDeps.workspaceId });
      // `listByWorkspace` makes no ordering promise a caller should rely on (the SQLite adapter
      // sorts ascending by `createdAt`, oldest first) — newest-first is this tool's OWN contract, so
      // it sorts explicitly rather than trusting the port's incidental order.
      const newestFirst = [...all].sort((a, b) => {
        if (a.createdAt < b.createdAt) return 1;
        return a.createdAt > b.createdAt ? -1 : 0;
      });

      return { changeSets: newestFirst.slice(0, limit).map((changeSet) => toChangeSetView({ changeSet })) };
    }


    async function revertToolChangeSet(routeDeps: ChangeSetToolDeps, ctx: Parameters<ToolHandler>[0]) {
      const input = requireInputRecord({ input: ctx.input });
      const changeSetId = requireString({ input: input, key: "changeSetId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: CHANGE_SET_REVERT_PERMISSION }, { entityType: "change_set", entityId: changeSetId });

      try {
        const reverted = await revertChangeSet({
          deps: {
            changeSets: routeDeps.changeSets,
            registry: routeDeps.revertRegistry,
            clock: routeDeps.clock,
            idGen: routeDeps.idGen,
            outbox: routeDeps.outbox,
          },
          input: {
            workspaceId: routeDeps.workspaceId,
            changeSetId,
            // No `force` parameter exists on this tool's schema at all — see `agent-tools.ts`'s own
            // header. `principalKind: "agent"` is what makes `revertChangeSet` enforce that as an
            // unconditional rule rather than merely a convention this handler follows.
            force: false,
            principalKind: "agent",
            // Reaching a tool handler IS the agent path; the principal id stays the acting user's.
            actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
          },
        });
        return { reverted: true, changeSet: toChangeSetView({ changeSet: reverted }) };
      } catch (err) {
        if (err instanceof RevertConflictError) {
          return {
            reverted: false,
            code: "REVERT_CONFLICT",
            currentVersion: err.currentVersion,
            note: "someone edited it since; ask the human to revert from the Recovery page if they still want it",
          };
        }
        if (
          err instanceof ChangeSetNotFoundError ||
          err instanceof ChangeSetInvalidStatusError ||
          err instanceof RevertNotPossibleError
        ) {
          throw new ToolInputError({ message: err.message });
        }
        throw err;
      }
    }



export function buildChangeSetsRegistrations(routeDeps: ChangeSetToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    change_sets_list: (ctx) => listChangeSets(routeDeps, ctx),
    change_sets_revert: (ctx) => revertToolChangeSet(routeDeps, ctx),
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "change-sets",
    catalogModule: "@jini-ai/cms/change-sets/agent-tools",
    catalog: indexCatalogById({ catalog: getChangeSetsAgentToolCatalog() }),
    handlers,
    derivedRisk: changeSetsDerivedRisk(),
  });
}

/**
 * Contributes `change_sets_list`/`change_sets_revert` to the assistant's catalog — called once by
 * the host's tool-catalog manifest's `installFirstPartyToolContributors()`.
 * Domain key `"change-sets"` — its own key, since the tool-contribution registry replaces a
 * domain's ENTIRE contribution on re-registration by that key.
 */
export function contributeChangeSetsTools(): ToolContributor<ChangeSetToolDeps, unknown> {
  return { domain: "change-sets", build: buildChangeSetsRegistrations, risk: changeSetsDerivedRisk() };
}
