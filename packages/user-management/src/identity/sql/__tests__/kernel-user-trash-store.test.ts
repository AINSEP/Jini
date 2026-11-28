import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, test, vi } from "vitest";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { bindKernelUserTrashAdapter } from "../kernel-user-trash-store.js";

const input = { workspaceId: "site", entityId: "member", at: "now", expectedVersion: null };

async function fixture() {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  await kernel.execute(sql`CREATE TABLE principals (workspace_id TEXT, id TEXT, status TEXT, display_name TEXT, disabled_at TEXT)`);
  await kernel.execute(sql`CREATE TABLE identity_users (workspace_id TEXT, principal_id TEXT, username TEXT)`);
  await kernel.execute(sql`CREATE TABLE sessions (workspace_id TEXT, principal_id TEXT)`);
  await kernel.execute(sql`CREATE TABLE outbox_events (type TEXT, payload TEXT)`);
  await kernel.execute(sql`INSERT INTO principals VALUES ('site','member','active','Member',NULL)`);
  await kernel.execute(sql`INSERT INTO sessions VALUES ('site','member')`);
  const assertAccountAction = vi.fn(async () => {});
  const purgeUser = vi.fn();
  const eventValues = (event: { name: string; payload: unknown }) => ({ type: event.name, payload: JSON.stringify(event.payload) });
  const createUserTrashAdapter = bindKernelUserTrashAdapter({ entityType: "user", kernelFor: () => () => kernel });
  const adapter = createUserTrashAdapter({ db: kernel, assertAccountAction, purge: { purgeUser }, eventValues,
    idGen: { next: () => "event" }, clock: { nowIso: () => "now" } });
  return { kernel, adapter, assertAccountAction, purgeUser };
}

test("a status change after the initial read refuses a stale hide without sessions or event writes", async () => {
  const f = await fixture();
  try {
    f.assertAccountAction.mockImplementation(async () => { await f.kernel.execute(sql`UPDATE principals SET status = 'suspended'`); });
    expect(await f.adapter.hide(input)).toEqual({ ok: false, reason: "version-changed" });
    expect(await f.kernel.query(sql`SELECT status FROM principals`)).toEqual([{ status: "suspended" }]);
    expect(await f.kernel.query(sql`SELECT * FROM sessions`)).toHaveLength(1);
    expect(await f.kernel.query(sql`SELECT * FROM outbox_events`)).toEqual([]);
  } finally { await f.kernel.close(); }
});

test("an outbox failure rolls back both the disabled marker and session revocation", async () => {
  const f = await fixture();
  try {
    await f.kernel.execute(sql`CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox_events BEGIN SELECT RAISE(ABORT, 'outbox failed'); END`);
    await expect(f.adapter.hide(input)).rejects.toThrow("outbox failed");
    expect(await f.kernel.query(sql`SELECT status, disabled_at FROM principals`)).toEqual([{ status: "active", disabled_at: null }]);
    expect(await f.kernel.query(sql`SELECT * FROM sessions`)).toHaveLength(1);
  } finally { await f.kernel.close(); }
});

test("hide disables and revokes sessions; restore revives no session and uses status CAS", async () => {
  const f = await fixture();
  try {
    await f.kernel.execute(sql`INSERT INTO sessions VALUES ('site','other-member'), ('other-site','member')`);
    const readSessions = sql`SELECT workspace_id, principal_id FROM sessions ORDER BY workspace_id, principal_id`;
    const remainingSessions = [{ workspace_id: "other-site", principal_id: "member" }, { workspace_id: "site", principal_id: "other-member" }];
    expect(await f.adapter.hide(input)).toEqual({ ok: true, version: null, priorMarker: "active" });
    expect(await f.kernel.query(sql`SELECT status, disabled_at FROM principals`)).toEqual([{ status: "disabled", disabled_at: "now" }]);
    expect(await f.kernel.query(readSessions)).toEqual(remainingSessions);
    const run = f.kernel.run.bind(f.kernel);
    let reads = 0;
    const runSpy = vi.spyOn(f.kernel, "run").mockImplementation(async fn => {
      const result = await run(fn);
      if (++reads === 1) await f.kernel.execute(sql`UPDATE principals SET status = 'suspended'`);
      return result;
    });
    try {
      expect(await f.adapter.unhide(input, { priorMarker: "active" })).toEqual({ ok: false, reason: "version-changed" });
    } finally { runSpy.mockRestore(); }
    expect(await f.kernel.query(sql`SELECT status FROM principals`)).toEqual([{ status: "suspended" }]);
    expect(await f.kernel.query(readSessions)).toEqual(remainingSessions);
    await f.kernel.execute(sql`UPDATE principals SET status = 'disabled'`);
    expect(await f.adapter.unhide(input, { priorMarker: "active" })).toEqual({ ok: true, version: null });
    expect(await f.kernel.query(sql`SELECT status, disabled_at FROM principals`)).toEqual([{ status: "active", disabled_at: null }]);
    expect(await f.kernel.query(readSessions)).toEqual(remainingSessions);
  } finally { await f.kernel.close(); }
});

test("active users cannot be purged and the injected account guard protects disabled users", async () => {
  const f = await fixture();
  try {
    expect(await f.adapter.purge(input)).toBe("version-changed");
    expect(f.purgeUser).not.toHaveBeenCalled();
    await f.kernel.execute(sql`UPDATE principals SET status = 'disabled'`);
    f.assertAccountAction.mockRejectedValue(new Error("protected account"));
    await expect(f.adapter.purge(input)).rejects.toThrow("protected account");
    expect(f.purgeUser).not.toHaveBeenCalled();
    expect(await f.kernel.query(sql`SELECT * FROM principals`)).toHaveLength(1);
  } finally { await f.kernel.close(); }
});

test("a missing principal is reported as absent by every operation and nothing is written", async () => {
  const f = await fixture();
  try {
    const ghost = { ...input, entityId: "ghost" };
    expect(await f.adapter.hide(ghost)).toEqual({ ok: false, reason: "not-found" });
    expect(await f.adapter.unhide(ghost)).toEqual({ ok: false, reason: "not-found" });
    expect(await f.adapter.purge(ghost)).toBe("already-gone");
    expect(f.assertAccountAction).not.toHaveBeenCalled();
    expect(await f.kernel.query(sql`SELECT * FROM outbox_events`)).toEqual([]);
  } finally { await f.kernel.close(); }
});

test("events carry the login username when one exists, and a restore to disabled leaves disabled_at as it was", async () => {
  const f = await fixture();
  try {
    await f.kernel.execute(sql`INSERT INTO identity_users VALUES ('site','member','member-login'), ('other-site','member','elsewhere')`);
    await f.adapter.hide(input);
    await f.kernel.execute(sql`UPDATE principals SET status = 'suspended'`);
    expect(await f.adapter.unhide(input)).toEqual({ ok: true, version: null });
    expect(await f.kernel.query(sql`SELECT status, disabled_at FROM principals`)).toEqual([{ status: "disabled", disabled_at: "now" }]);
    const events = (await f.kernel.query<{ type: string; payload: string }>(sql`SELECT type, payload FROM outbox_events`))
      .map(row => [row.type, (JSON.parse(row.payload) as { username: string }).username]);
    expect(events).toEqual([["identity.user.trashed", "member-login"], ["identity.user.restored", "member-login"]]);
  } finally { await f.kernel.close(); }
});
