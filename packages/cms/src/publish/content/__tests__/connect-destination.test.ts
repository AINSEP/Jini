/**
 * @file Regression cover for sol's 2026-09-20 review, Medium finding 5 — "connect/disconnect split
 * required state across two unbound writes".
 *
 * Connecting writes an authorisation grant into committed deploy config AND a peer row into
 * SQLite; disconnecting removes both. The two live in different persistence systems, so no
 * transaction can span them — the answer is compensation, not a shared unit of work (unlike the
 * two-SQLite-writes case `features/trash`'s `TransactionRunner` solves).
 *
 * Before this file, neither half compensated. Connect wrote the grant and then saved the row: if
 * the row write failed, the request reported failure and the UI said "disconnected" while a
 * durable grant sat in the deploy config, ready to become live on the next deploy. Disconnect
 * reversed the grant and then deleted the row: if the delete failed, the UI kept saying
 * "connected" while the authorisation was already gone, so the next publish failed for no reason
 * the operator could see.
 *
 * What this file pins is not "the second write never fails" — it is that a failed second write
 * leaves the two systems agreeing with each other.
 */
import { describe, it, expect } from "vitest";

import { connectAndRecordDestination, disconnectAndForgetDestination } from "../connect-destination.js";
import { type PublishContentPeerRecord, type PublishContentPeerRepoPort } from "../peer-registry.js";

/** node:assert-shaped helpers over vitest's `expect`, so the pinned assertions keep their strength and failure messages. */
const assert = {
  equal: (actual: unknown, expected: unknown, message?: string) => expect(actual, message).toBe(expected),
  deepEqual: (actual: unknown, expected: unknown, message?: string) => expect(actual, message).toStrictEqual(expected),
  rejects: async (fn: () => Promise<unknown>, pattern: RegExp, message?: string) => { await expect(fn(), message).rejects.toThrow(pattern); },
};

/** Map-backed peer repo: the registry's own vault facade is exercised by `peer-registry.test.ts`. */
class InMemoryPublishContentPeerRepo implements PublishContentPeerRepoPort {
  readonly vault = {} as never;
  readonly binding = {} as never;
  private readonly rows = new Map<string, PublishContentPeerRecord>();
  async insert({ record }: { record: PublishContentPeerRecord }) { this.rows.set(`${record.workspaceId}/${record.id}`, record); }
  async update({ record }: { record: PublishContentPeerRecord }) { this.rows.set(`${record.workspaceId}/${record.id}`, record); }
  async findById({ workspaceId, id }: { workspaceId: string; id: string }) { return this.rows.get(`${workspaceId}/${id}`) ?? null; }
  async listByWorkspace({ workspaceId }: { workspaceId: string }) { return [...this.rows.values()].filter((row) => row.workspaceId === workspaceId); }
  async delete({ workspaceId, id }: { workspaceId: string; id: string }) { this.rows.delete(`${workspaceId}/${id}`); }
}

describe("connect/disconnect compensation", () => {
const WORKSPACE = "ws-1";
const SITE = "https://site-a.example";
const REMOTE_WORKSPACE = "remote-a";

/** Records which grant writes happened, in order, so a test can assert the grant was put back. */
class RecordingProvisioning {
  readonly calls: string[] = [];
  readonly grantRequests: { baseUrl: string; entityTypes: readonly string[] }[] = [];
  readonly target = { kind: "test", path: "deploy.json", nextStep: "Deploy this site once more." };

  async readProvisioned() {
    return { ok: true as const, grant: null, target: this.target };
  }

  async connect() {
    this.calls.push("connect");
    return { ok: true as const, changed: true, target: this.target };
  }

  async disconnect() {
    this.calls.push("disconnect");
    return { ok: true as const, changed: true, target: this.target };
  }
}

function connectedRow(): PublishContentPeerRecord {
  return {
    workspaceId: WORKSPACE,
    id: "peer-1",
    label: "site-a.example",
    baseUrl: SITE,
    remoteWorkspaceId: REMOTE_WORKSPACE,
    sealed: null,
    masked: null,
    aadVersion: 1,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  };
}

/** A repo whose chosen write always fails, to drive the second half of each pair off the rails. */
function repoFailingOn(
  method: "insert" | "update" | "delete",
  message: string
): PublishContentPeerRepoPort & { readonly inner: InMemoryPublishContentPeerRepo } {
  const inner = new InMemoryPublishContentPeerRepo();
  return {
    inner,
    vault: inner.vault,
    insert: async ({ record }) => {
      if (method === "insert") throw new Error(message);
      return inner.insert({ record });
    },
    update: async ({ record }) => {
      if (method === "update") throw new Error(message);
      return inner.update({ record });
    },
    findById: (input) => inner.findById(input),
    listByWorkspace: (input) => inner.listByWorkspace(input),
    delete: async (input) => {
      if (method === "delete") throw new Error(message);
      return inner.delete(input);
    },
  };
}

function connectDeps(repo: PublishContentPeerRepoPort, provisioning: RecordingProvisioning) {
  return {
    repo,
    clock: { nowMs: () => Date.parse("2026-09-20T12:00:00.000Z") },
    idGen: { newId: () => "peer-1" },
    // The grant half is already written by the time the peer row is saved, so these tests inject
    // the completed handshake result rather than standing up a fake destination server.
    connectGrant: async (input: { baseUrl: string; entityTypes: readonly string[] }, _options: Record<string, never> = {}) => {
      provisioning.grantRequests.push(structuredClone(input));
      return {
      identity: { workspaceId: REMOTE_WORKSPACE, generation: 1 },
      baseUrl: SITE,
      changed: true,
      target: provisioning.target,
      nextStep: "Deploy this site once more.",
      };
    },
    reverseGrant: async () => {
      provisioning.calls.push("disconnect");
      return { changed: true, target: provisioning.target };
    },
  };
}

it("a failed peer-row write during connect reverses the grant instead of leaving it armed", async () => {
  const provisioning = new RecordingProvisioning();
  const repo = repoFailingOn("insert", "sqlite: disk I/O error");

  await expect(connectAndRecordDestination({ deps: connectDeps(repo, provisioning), input: { workspaceId: WORKSPACE, baseUrl: SITE, entityTypes: ["post"] } })).rejects.toThrow(/sqlite: disk I\/O error/);

  assert.deepEqual(
    provisioning.calls,
    ["disconnect"],
    "the grant written moments earlier must be reversed — a durable authorisation must not outlive a connect the operator was told failed"
  );
  assert.deepEqual(await repo.inner.listByWorkspace({ workspaceId: WORKSPACE }), []);
});

it("a failed grant reversal during disconnect puts the peer row back", async () => {
  const provisioning = new RecordingProvisioning();
  const inner = new InMemoryPublishContentPeerRepo();
  await inner.insert({ record: connectedRow() });

  const deps = {
    repo: inner,
    clock: { nowMs: () => Date.parse("2026-09-20T12:00:00.000Z") },
    idGen: { newId: () => "peer-2" },
    reverseGrant: async (): Promise<never> => {
      throw new Error("This site's publishing settings could not be saved: config file is read-only");
    },
  };

  await assert.rejects(
    () => disconnectAndForgetDestination({ deps, input: { workspaceId: WORKSPACE } }),
    /config file is read-only/
  );

  const rows = await inner.listByWorkspace({ workspaceId: WORKSPACE });
  assert.deepEqual(
    rows.map((row) => row.baseUrl),
    [SITE],
    "the grant is still live, so the peer row must still say so — a disconnect that failed must not read as one that worked"
  );
});

it("a clean disconnect removes both halves", async () => {
  const provisioning = new RecordingProvisioning();
  const inner = new InMemoryPublishContentPeerRepo();
  await inner.insert({ record: connectedRow() });

  const result = await disconnectAndForgetDestination(
    {
      deps: {
        repo: inner,
        clock: { nowMs: () => Date.parse("2026-09-20T12:00:00.000Z") },
        idGen: { newId: () => "peer-2" },
        reverseGrant: async () => {
          provisioning.calls.push("disconnect");
          return { changed: true, target: provisioning.target };
        },
      },
      input: { workspaceId: WORKSPACE }
    }
  );

  assert.equal(result.site?.baseUrl, SITE);
  assert.equal(result.changed, true);
  assert.deepEqual(await inner.listByWorkspace({ workspaceId: WORKSPACE }), []);
  assert.deepEqual(provisioning.calls, ["disconnect"]);
});

it("a clean connect writes both halves and reports the saved row", async () => {
  const provisioning = new RecordingProvisioning();
  const inner = new InMemoryPublishContentPeerRepo();

  const result = await connectAndRecordDestination({
                                                     deps: connectDeps(inner, provisioning),
                                                     input: {
      workspaceId: WORKSPACE,
      baseUrl: SITE,
      entityTypes: ["post"],
    }
                                                   });

  assert.equal(result.site.baseUrl, SITE);
  assert.equal(result.site.hasCredential, false);
  assert.deepEqual(provisioning.grantRequests, [{ baseUrl: SITE, entityTypes: ["post"] }]);
  assert.deepEqual(provisioning.calls, [], "a successful connect must never reverse its own grant");
  const rows = await inner.listByWorkspace({ workspaceId: WORKSPACE });
  assert.deepEqual(rows.map((row) => row.baseUrl), [SITE]);
});

it("when both the peer-row write and the grant reversal fail during connect, the row-write failure is what is reported", async () => {
  const provisioning = new RecordingProvisioning();
  const repo = repoFailingOn("insert", "sqlite: disk I/O error");
  const deps = { ...connectDeps(repo, provisioning), reverseGrant: async (): Promise<never> => { provisioning.calls.push("disconnect"); throw new Error("config file is read-only"); } };

  await assert.rejects(
    () => connectAndRecordDestination({ deps, input: { workspaceId: WORKSPACE, baseUrl: SITE, entityTypes: ["post"] } }),
    /sqlite: disk I\/O error/,
  );
  assert.deepEqual(provisioning.calls, ["disconnect"], "the reversal was still attempted");
});

it("when the grant reversal and the peer-row restore both fail during disconnect, the reversal failure is what is reported", async () => {
  const repo = repoFailingOn("insert", "restore failed too");
  await repo.inner.insert({ record: connectedRow() });
  const deps = {
    repo,
    clock: { nowMs: () => Date.parse("2026-09-20T12:00:00.000Z") },
    idGen: { newId: () => "peer-2" },
    reverseGrant: async (): Promise<never> => { throw new Error("config file is read-only"); },
  };

  await assert.rejects(() => disconnectAndForgetDestination({ deps, input: { workspaceId: WORKSPACE } }), /config file is read-only/);
  assert.deepEqual(await repo.inner.listByWorkspace({ workspaceId: WORKSPACE }), [], "the failed restore leaves the row gone, as before this fix");
});

it("disconnecting a computer that was not connected still reverses any grant and reports no site", async () => {
  const provisioning = new RecordingProvisioning();
  const deps = connectDeps(new InMemoryPublishContentPeerRepo(), provisioning);
  const result = await disconnectAndForgetDestination({ deps, input: { workspaceId: WORKSPACE } });
  assert.deepEqual(result, { site: null, changed: true, target: provisioning.target });
  assert.deepEqual(provisioning.calls, ["disconnect"]);

  const failing = { ...deps, reverseGrant: async (): Promise<never> => { throw new Error("config file is read-only"); } };
  await assert.rejects(() => disconnectAndForgetDestination({ deps: failing, input: { workspaceId: WORKSPACE } }), /config file is read-only/);
});

});
