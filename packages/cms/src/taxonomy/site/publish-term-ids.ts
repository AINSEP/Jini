import type { AuthorizeFn, OutboxPort } from "@jini-ai/core/contracts/events";
import type { Clock } from "@jini-ai/core/primitives";
import { PublishContentApplyRowError } from "../../publish/transfer/apply-errors.js";

import { assignTerms, unassignTerms, type UnassignableEntryTermRepoPort } from "../assignment-service.js";
import type { EntryTermReadPort, TermPublishReadPort } from "../read-ports.js";
import { toTaxonomyOutbox } from "../repo.memory.js";
import type { EntryTermRepoPort, TermRepoPort, WriteServiceDeps } from "../write-contracts.js";

/**
 * @file Term assignments (categories/tags) travel INSIDE their post, page or collection entry as
 * `state.termIds` (plan §3.7): a separate type would drop them from a section publish.
 *
 * `termIds` is sorted and left OUT of the state when empty, so every row without tags keeps the
 * content hash it had before this field existed. Writes go through Jini's `assignTerms`/
 * `unassignTerms`, the same chokepoint the admin route and the agent tool use.
 */

/**
 * The host's `taxonomy`/`term` publish ports, as far as a term sync reads them: Jini's taxonomy
 * write-service deps minus the gateway fields {@link TermSyncDeps} carries, plus the two reads a sync
 * makes (the current assignment set, and whether an added term is live). A structural slice, so the
 * host's own publish-ports bag satisfies it as-is.
 */
export type TermSyncPorts = Omit<WriteServiceDeps, "authorize" | "clock" | "idGen" | "outbox" | "workspaceId" | "terms" | "entryTerms"> & {
  readonly terms: TermRepoPort & TermPublishReadPort;
  readonly entryTerms: EntryTermRepoPort & UnassignableEntryTermRepoPort & EntryTermReadPort;
};

/** The slice of the host's publish-content deps a term sync reads (structural; the host's full deps
 *  bag satisfies it). `authorize`/`outbox` are optional there and checked here before any write. */
export interface TermSyncDeps {
  readonly workspaceId: string;
  readonly clock: Clock;
  readonly idGen: { newId(): string };
  readonly outbox?: OutboxPort;
  readonly authorize?: AuthorizeFn;
}

/** What a term sync asks `authorize` for. A type that carries `termIds` lists it in `alsoAuthorizes`. */
export const TERM_SYNC_PERMISSION = "admin.taxonomy.manage";

/** The live terms assigned to one piece of content, sorted, or `undefined` when there are none (or
 *  the bag has no taxonomy ports, so terms are not part of it). @complexity one indexed query. */
export async function readTermIds(
  { ports, contentType, contentId }: { ports: TermSyncPorts | undefined; contentType: string; contentId: string },
  _optional = {},
): Promise<string[] | undefined> {
  if (!ports) return undefined;
  const ids = (await ports.entryTerms.listForContent({ contentType, contentId })).map((row) => row.termId).sort();
  return ids.length > 0 ? ids : undefined;
}

/** `state` plus `termIds` when there are any. */
export function withTermIds<T extends Record<string, unknown>>(
  { state, termIds }: { state: T; termIds: readonly string[] | undefined },
  _optional = {},
): T {
  return termIds ? { ...state, termIds: [...termIds] } : state;
}

/** Two closures: `apply` makes the destination's set exactly the wanted one; `revert` puts back the set
 *  read at prepare time. Both are no-ops when nothing differs. */
export interface TermSync {
  readonly apply: () => Promise<void>;
  readonly revert: () => Promise<void>;
}

/**
 * Reads the destination's current set and checks, BEFORE the caller writes its row, everything the
 * assignment would otherwise fail on: the permission and that every wanted term exists and is live
 * here. So a refusal lands as a `blocked` row that wrote nothing, not a row written without its tags.
 *
 * The content row itself must exist when `apply`/`revert` run (Jini resolves it), so the caller runs
 * `apply` after its own write and `revert` before undoing it.
 *
 * @complexity O(t) term reads for t added terms, plus the one current-set read.
 */
export async function prepareTermSync(input: {
  ports: TermSyncPorts | undefined;
  deps: TermSyncDeps;
  entityType: string;
  entityId: string;
  principalId: string;
  contentType: string;
  wanted: unknown;
}): Promise<TermSync> {
  const { ports, deps, entityType, entityId, principalId, contentType } = input;
  const wanted = Array.isArray(input.wanted) ? (input.wanted as string[]) : [];
  const noop: TermSync = { apply: async () => {}, revert: async () => {} };
  if (!ports) {
    if (wanted.length === 0) return noop;
    throw new Error(`publish-content: ${entityType} '${entityId}' carries term assignments, but this deps bag wires no taxonomy ports — wire ports.term.`);
  }
  const current = (await readTermIds({ ports, contentType, contentId: entityId })) ?? [];
  const add = wanted.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !wanted.includes(id));
  if (add.length === 0 && remove.length === 0) return noop;

  const { workspaceId, authorize, outbox } = deps;
  if (!authorize || !outbox) {
    throw new Error(`publish-content: ${entityType}.apply() requires PublishContentDeps.authorize/outbox to sync term assignments.`);
  }
  const allowed = await authorize({ principalId, permission: TERM_SYNC_PERMISSION, workspaceId });
  if (!allowed.allowed) {
    throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: `${entityType} '${entityId}' has category or tag changes, and you need '${TERM_SYNC_PERMISSION}' to publish them (${allowed.reason})` });
  }
  await validateAddedTerms({ ports, termIds: add, entityType, entityId });

  const writeDeps = {
    ...ports,
    clock: deps.clock,
    idGen: deps.idGen,
    workspaceId,
    authorize: (params: { principalId: string; permission: string }) => authorize({ ...params, workspaceId }),
    outbox: toTaxonomyOutbox({ outbox, clock: deps.clock, idGen: deps.idGen, workspaceId }),
  };
  const move = async (assign: readonly string[], unassign: readonly string[]) => {
    const target = { principalId, contentType, contentId: entityId };
    if (assign.length > 0) await assignTerms({ deps: writeDeps, ...target, termIds: [...assign] });
    if (unassign.length > 0) await unassignTerms({ deps: writeDeps, ...target, termIds: [...unassign] });
  };
  return { apply: () => move(add, remove), revert: () => move(remove, add) };
}

async function validateAddedTerms(
  { ports, termIds, entityType, entityId }: {
    ports: TermSyncPorts;
    termIds: readonly string[];
    entityType: string;
    entityId: string;
  },
  _options: Record<string, never> = {}
): Promise<void> {
  for (const termId of termIds) {
    const term = await ports.terms.findAnyById({ id: termId });
    if (!term || term.status === "trash") {
      throw new PublishContentApplyRowError({ rowOutcome: "blocked", message: `${entityType} '${entityId}' is tagged with term '${termId}', which is ${term ? "in the trash" : "missing"} at this destination — publish or restore that term first` });
    }
  }
}
