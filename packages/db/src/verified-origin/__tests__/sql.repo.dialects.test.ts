import assert from "node:assert/strict";
import { afterAll, describe, test } from "vitest";
import { createVerifiedOrigin, type VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import type { KyselyKernel } from "../../kernel/port.js";
import { registerConfiguredOrigin } from "../register.js";
import { SqlOriginSettingRepo } from "../repo.sql.js";
import { openOriginKernel, setAllowlists, TABLES } from "./support/origin-table.fixture.js";

/**
 * @file The verified-origin SQL repo and its operator-origin writer on every embedded dialect: one query body
 * serves SQLite and PGlite. Reads are workspace-scoped; the writer inserts, reports `unchanged` without a second
 * write, corrects the origin columns only and leaves both allowlists alone.
 */

const STAMP = "2026-11-18T00:00:00.000Z";
const origin = (over: Partial<VerifiedOrigin> = {}): VerifiedOrigin =>
  createVerifiedOrigin({ scheme: "https", host: "example.com", verifiedAt: STAMP, source: "workspace-setting", ...over });

const opened: KyselyKernel<unknown>[] = [];
afterAll(async () => { for (const kernel of opened) await kernel.close(); });

describe.each(["sqlite", "postgres"] as const)("verified origin sql [%s]", (dialect) => {
  async function make(): Promise<{ kernel: KyselyKernel<unknown>; repo: SqlOriginSettingRepo }> {
    const kernel = await openOriginKernel({ dialect });
    opened.push(kernel);
    return { kernel, repo: new SqlOriginSettingRepo({ kernel, tables: TABLES }, {}) };
  }
  const register = (kernel: KyselyKernel<unknown>, workspaceId: string, value: VerifiedOrigin) =>
    registerConfiguredOrigin({ kernel, tables: TABLES, workspaceId, origin: value }, {});

  test("reads return only the asked workspace's origin and allowlists; an unknown workspace gets null and empty lists", async () => {
    const { kernel, repo } = await make();
    await register(kernel, "ws-a", origin({ host: "a.example.com" }));
    await register(kernel, "ws-b", origin({ host: "b.example.com", port: 8443, basePath: "/site" }));
    await setAllowlists({ kernel, workspaceId: "ws-a", redirect: ["r.a"], egress: ["e.a"] });
    await setAllowlists({ kernel, workspaceId: "ws-b", redirect: ["r.b"], egress: ["e.b"] });
    assert.equal((await repo.findByWorkspaceId({ workspaceId: "ws-a" }))?.host, "a.example.com");
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-b" }), origin({ host: "b.example.com", port: 8443, basePath: "/site" }));
    assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: "ws-a" }), ["r.a"]);
    assert.deepEqual(await repo.findEgressAllowlist({ workspaceId: "ws-b" }), ["e.b"]);
    assert.equal(await repo.findByWorkspaceId({ workspaceId: "ws-c" }), null);
    assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: "ws-c" }), []);
    assert.deepEqual(await repo.findEgressAllowlist({ workspaceId: "ws-c" }), []);
  });

  test("an origin without port or base path reads back without those keys", async () => {
    const { kernel, repo } = await make();
    await register(kernel, "ws-a", origin());
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-a" }), { scheme: "https", host: "example.com", verifiedAt: STAMP, source: "workspace-setting" });
  });

  test("register: inserted, then unchanged for the same origin (verifiedAt ignored), then updated for a changed one", async () => {
    const { kernel, repo } = await make();
    assert.equal(await register(kernel, "ws-a", origin()), "inserted");
    assert.equal(await register(kernel, "ws-a", origin({ verifiedAt: "2027-01-01T00:00:00.000Z" })), "unchanged");
    assert.equal((await repo.findByWorkspaceId({ workspaceId: "ws-a" }))?.verifiedAt, STAMP);
    assert.equal(await register(kernel, "ws-a", origin({ host: "new.example.com", verifiedAt: "2027-01-01T00:00:00.000Z" })), "updated");
    assert.deepEqual(await repo.findByWorkspaceId({ workspaceId: "ws-a" }), origin({ host: "new.example.com", verifiedAt: "2027-01-01T00:00:00.000Z" }));
  });

  test("register corrects the origin columns only and preserves both allowlists", async () => {
    const { kernel, repo } = await make();
    await register(kernel, "ws-a", origin());
    await setAllowlists({ kernel, workspaceId: "ws-a", redirect: ["r.a"], egress: ["e.a"] });
    await register(kernel, "ws-a", origin({ host: "new.example.com" }));
    assert.deepEqual(await repo.findRedirectAllowlist({ workspaceId: "ws-a" }), ["r.a"]);
    assert.deepEqual(await repo.findEgressAllowlist({ workspaceId: "ws-a" }), ["e.a"]);
  });

  test("register re-validates the origin: an insecure scheme with a non-loopback source is refused and writes nothing", async () => {
    const { kernel, repo } = await make();
    const handBuilt = { scheme: "http", host: "example.com", verifiedAt: STAMP, source: "workspace-setting" } as VerifiedOrigin;
    await assert.rejects(register(kernel, "ws-a", handBuilt));
    assert.equal(await repo.findByWorkspaceId({ workspaceId: "ws-a" }), null);
  });

  test("reads wait for the boot write passed as `after`, and fail with it", async () => {
    const { kernel } = await make();
    let release: () => void = () => undefined;
    const after = new Promise<void>((resolve) => { release = resolve; });
    const repo = new SqlOriginSettingRepo({ kernel, tables: TABLES }, { after });
    let settled = false;
    const read = repo.findByWorkspaceId({ workspaceId: "ws-a" }).then((value) => { settled = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    release();
    assert.equal(await read, null);
    const failing = new SqlOriginSettingRepo({ kernel, tables: TABLES }, { after: Promise.reject(new Error("boot write failed")) });
    await assert.rejects(failing.findByWorkspaceId({ workspaceId: "ws-a" }), /boot write failed/);
  });
});
