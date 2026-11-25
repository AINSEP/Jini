import { describe, expect, it } from "vitest";
import type { MutationActor } from "@jini-ai/core/contracts/events";
import { InMemoryChangeSetRepo } from "../../../core/commands/repo.memory.js";
import { MissingMutationActorError } from "../../../core/mutation-actor.js";
import { createRepoPublishHandler } from "../repo-handler.js";
import type { PublishContentDeps } from "../type-registry.js";

/**
 * FIX 19 / H2: a repo-handler write that runs inside `executeCommand` (the `undo` path) records the
 * apply run's trusted actor, and with none it is refused before anything is written — never stamped
 * with a guessed `user` kind.
 */
type Row = { id: string; title: string; version: number };
type Ports = { rows: Map<string, Row> };

const contributor = createRepoPublishHandler<Row, Ports, { thing: Ports }>({
  entityType: "thing",
  permission: "thing.write",
  ports: ({ deps }) => deps.ports.thing,
  list: async ({ ports }) => [...ports.rows.values()],
  find: async ({ ports, id }) => ports.rows.get(id) ?? null,
  fields: { id: "provenance", title: "transferred", version: "provenance" },
  write: async ({ ports, id, state }) => {
    ports.rows.set(id, { id, title: state.title as string, version: 1 });
    return { version: 1 };
  },
  undo: { restore: async ({ ctx, prior }) => { ctx.ports.rows.set(prior.id, prior); }, remove: async ({ ports, id }) => { ports.rows.delete(id); } },
});

function setup(mutationActor: MutationActor | undefined) {
  const rows = new Map<string, Row>();
  const changeSets = new InMemoryChangeSetRepo();
  const deps: PublishContentDeps<{ thing: Ports }> = {
    workspaceId: "ws", ports: { thing: { rows } }, clock: { nowMs: () => 0 }, idGen: { newId: (() => { let n = 0; return () => `id-${++n}`; })() },
    changeSets, outbox: { enqueue: async () => {} } as never, authorize: async () => ({ allowed: true, reason: "test" }),
    ...(mutationActor ? { mutationActor } : {}),
  };
  const handler = contributor.build(deps);
  const entity = { entityType: "thing", id: "t-1", state: { title: "Hello" }, schemaVersion: 1, contentHash: "h", hashVersion: 1, requiredBlobs: [] };
  const apply = () => handler.apply({ entity, principalId: "u-1", idempotencyKey: "k", expectedVersion: undefined } as never);
  return { rows, changeSets, apply };
}

describe("createRepoPublishHandler — the write's actor (FIX 19 / H2)", () => {
  it("records the apply run's trusted actor on the change set", async () => {
    const f = setup({ id: "u-1", kind: "agent" });
    await f.apply();
    expect(f.rows.get("t-1")?.title).toBe("Hello");
    const [changeSet] = await f.changeSets.listByWorkspace({ workspaceId: "ws" });
    expect(changeSet?.actor).toEqual({ id: "u-1", kind: "agent" });
  });

  it("refuses a write with no trusted actor before anything is written", async () => {
    const f = setup(undefined);
    await expect(f.apply()).rejects.toBeInstanceOf(MissingMutationActorError);
    expect(f.rows.size).toBe(0);
    expect(await f.changeSets.listByWorkspace({ workspaceId: "ws" })).toEqual([]);
  });
});
