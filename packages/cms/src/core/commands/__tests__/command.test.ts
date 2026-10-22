import { describe, expect, test } from "vitest";
import type { DomainEvent, OutboxPort } from "../../ports.js";
import type { ChangeSetItemRecord, ChangeSetRecord, ChangeSetRepoPort } from "../change-set.js";
import {
  DuplicateCommandError,
  ForbiddenError,
  executeCommand,
  type AuthorizeFn,
  type CommandEnvelope,
  type CommandMutation,
  type ExecuteCommandDeps,
} from "../command.js";

type InsertCall = {
  required: { record: ChangeSetRecord; items: ChangeSetItemRecord[] };
  optional: { event?: DomainEvent | undefined } | undefined;
};

const WINNER: ChangeSetRecord = { id: "winner", workspaceId: "ws-1", status: "applied", summary: "Prior", createdAt: "t0" };

function harness(overrides: { insertError?: unknown; replayed?: ChangeSetRecord | null; winner?: ChangeSetRecord | null } = {}) {
  let nextId = 0;
  let executions = 0;
  let rollbacks = 0;
  let idempotencyQueries = 0;
  const inserts: InsertCall[] = [];
  const changeSets: ChangeSetRepoPort = {
    insert: async (required, optional) => {
      if ("insertError" in overrides) throw overrides.insertError;
      inserts.push({ required, optional });
    },
    findById: async () => null,
    findByIdempotencyKey: async () => {
      idempotencyQueries++;
      return idempotencyQueries === 1 ? overrides.replayed ?? null : overrides.winner ?? null;
    },
    listByWorkspace: async () => [],
    save: async () => {},
  };
  const deps: ExecuteCommandDeps = {
    clock: { nowMs: () => Date.parse("2026-10-02T00:00:00.000Z") },
    idGen: { newId: () => `id-${nextId++}` },
    changeSets,
  };
  const mutation: CommandMutation<{ version: number }> = {
    entityType: "entry",
    entityId: "entity-1",
    operation: "update",
    captureInverse: async () => ({ value: "before" }),
    execute: async () => {
      executions++;
      return { version: 7 };
    },
    rollback: async () => {
      rollbacks++;
    },
  };
  const command: CommandEnvelope = { workspaceId: "ws-1", actor: { id: "actor-1", kind: "user" }, summary: "Update" };
  return {
    deps,
    mutation,
    command,
    inserts,
    executions: () => executions,
    rollbacks: () => rollbacks,
    idempotencyQueries: () => idempotencyQueries,
  };
}

function fakeOutbox(): OutboxPort {
  return {
    enqueue: async () => {},
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
}

const PARTIAL_WIRING =
  "executeCommand: command.permission and deps.authorize must be supplied together " +
  "— partial wiring would silently skip or misapply authorization";

describe("executeCommand authorization", () => {
  test("refuses a permission without an authorize gate before running the mutation", async () => {
    const h = harness();
    await expect(executeCommand({ ...h, command: { ...h.command, permission: "content.write" } })).rejects.toThrow(PARTIAL_WIRING);
    expect(h.executions()).toBe(0);
  });

  test("refuses an authorize gate without a permission before running the mutation", async () => {
    const h = harness();
    const authorize: AuthorizeFn = async () => ({ allowed: true, reason: "granted" });
    await expect(executeCommand({ ...h, deps: { ...h.deps, authorize } })).rejects.toThrow(PARTIAL_WIRING);
    expect(h.executions()).toBe(0);
  });

  test("asks authorize about the actor, permission, workspace and target entity", async () => {
    const h = harness();
    const asked: Array<Parameters<AuthorizeFn>[0]> = [];
    const authorize: AuthorizeFn = async (params) => {
      asked.push(params);
      return { allowed: true, reason: "granted" };
    };
    await executeCommand({ ...h, deps: { ...h.deps, authorize }, command: { ...h.command, permission: "content.write" } });
    expect(asked).toEqual([
      { principalId: "actor-1", permission: "content.write", workspaceId: "ws-1", entityType: "entry", entityId: "entity-1" },
    ]);
    expect(h.executions()).toBe(1);
  });

  test("a denied caller gets ForbiddenError naming the principal, permission and reason", async () => {
    const h = harness();
    const authorize: AuthorizeFn = async () => ({ allowed: false, reason: "no_grant" });
    const run = executeCommand({ ...h, deps: { ...h.deps, authorize }, command: { ...h.command, permission: "content.write" } });
    await expect(run).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run).rejects.toMatchObject({
      message: "principal 'actor-1' is not authorized for 'content.write' (no_grant)",
      permission: "content.write",
      reason: "no_grant",
    });
    expect(h.executions()).toBe(0);
  });

  test("a denied caller replaying a used idempotency key never learns about the prior change set", async () => {
    const h = harness({ replayed: WINNER });
    const authorize: AuthorizeFn = async () => ({ allowed: false, reason: "no_grant" });
    await expect(
      executeCommand({ ...h, deps: { ...h.deps, authorize }, command: { ...h.command, permission: "p", idempotencyKey: "key" } })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(h.idempotencyQueries()).toBe(0);
  });
});

describe("executeCommand idempotency pre-check", () => {
  test("a replayed idempotency key throws DuplicateCommandError with the prior change set and skips the mutation", async () => {
    const h = harness({ replayed: WINNER });
    const run = executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key" } });
    await expect(run).rejects.toBeInstanceOf(DuplicateCommandError);
    await expect(run).rejects.toMatchObject({
      message: "command with idempotency key 'key' was already executed",
      changeSetId: "winner",
    });
    expect(h.executions()).toBe(0);
    expect(h.inserts).toEqual([]);
  });

  test("a command without an idempotency key never queries for a replay", async () => {
    const h = harness();
    await executeCommand(h);
    expect(h.idempotencyQueries()).toBe(0);
  });
});

describe("executeCommand change-set record", () => {
  test("records one applied single-item change set built from the envelope and mutation", async () => {
    const h = harness();
    const done = await executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key", intentRef: "msg-1" } });
    expect(done).toEqual({ result: { version: 7 }, changeSetId: "id-0" });
    expect(h.inserts).toEqual([
      {
        required: {
          record: {
            id: "id-0",
            workspaceId: "ws-1",
            actorId: "actor-1",
            status: "applied",
            summary: "Update",
            idempotencyKey: "key",
            intentRef: "msg-1",
            createdAt: "2026-10-02T00:00:00.000Z",
            appliedAt: "2026-10-02T00:00:00.000Z",
          },
          items: [
            {
              id: "id-2",
              changeSetId: "id-0",
              entityType: "entry",
              entityId: "entity-1",
              operation: "update",
              inversePayload: { value: "before" },
              entityVersionAtApply: undefined,
              position: 0,
            },
          ],
        },
        optional: { event: undefined },
      },
    ]);
  });

  test("passes the change-set.applied event to insert when an outbox is wired", async () => {
    const h = harness();
    await executeCommand({ ...h, deps: { ...h.deps, outbox: fakeOutbox() } });
    expect(h.inserts[0]!.optional).toEqual({
      event: {
        id: "id-1",
        name: "change-set.applied",
        occurredAt: "2026-10-02T00:00:00.000Z",
        aggregateId: "id-0",
        workspaceId: "ws-1",
        actorId: "actor-1",
        changeSetId: "id-0",
        payload: { changeSetId: "id-0", entityType: "entry", entityId: "entity-1" },
      },
    });
  });

  test("a null inverse is recorded as an absent inverse payload", async () => {
    const h = harness();
    h.mutation.captureInverse = async () => null;
    await executeCommand(h);
    expect(h.inserts[0]!.required.items[0]!.inversePayload).toBeUndefined();
  });

  test("a null captured entity version is recorded as an absent version", async () => {
    const h = harness();
    h.mutation.captureEntityVersion = () => null;
    await executeCommand(h);
    expect(h.inserts[0]!.required.items[0]!.entityVersionAtApply).toBeUndefined();
  });
});

describe("executeCommand insert failures", () => {
  test("a unique conflict on a command without an idempotency key rethrows the raw error", async () => {
    const insertError = Object.assign(new Error("unique"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
    const h = harness({ insertError });
    await expect(executeCommand(h)).rejects.toBe(insertError);
    expect(h.rollbacks()).toBe(1);
    expect(h.idempotencyQueries()).toBe(0);
  });

  test("a unique conflict whose winner cannot be found rethrows the raw error", async () => {
    const insertError = Object.assign(new Error("unique"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
    const h = harness({ insertError, winner: null });
    await expect(executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key" } })).rejects.toBe(insertError);
    expect(h.idempotencyQueries()).toBe(2);
  });

  test("an insert error with a different code is not treated as a duplicate", async () => {
    const insertError = Object.assign(new Error("busy"), { code: "SQLITE_BUSY" });
    const h = harness({ insertError, winner: WINNER });
    await expect(executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key" } })).rejects.toBe(insertError);
    expect(h.idempotencyQueries()).toBe(1);
  });

  test("a thrown non-object insert failure is rethrown unchanged", async () => {
    const h = harness({ insertError: "disk full", winner: WINNER });
    await expect(executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key" } })).rejects.toBe("disk full");
    expect(h.idempotencyQueries()).toBe(1);
  });

  test("a thrown null insert failure is rethrown unchanged", async () => {
    const h = harness({ insertError: null, winner: WINNER });
    await expect(executeCommand({ ...h, command: { ...h.command, idempotencyKey: "key" } })).rejects.toBeNull();
    expect(h.idempotencyQueries()).toBe(1);
  });
});
