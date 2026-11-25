import { describe, expect, it } from "vitest";
import { createBackstopService, mayUseBackstop } from "../backstop-service.js";
import type { BackstopServicePolicy } from "../backstop-service.js";
import type { BackstopAuditRecord, BackstopAuditPort, PackedEntity } from "../../transfer/index.js";

const policy: BackstopServicePolicy = {
  checkRawValues: ({ values }) => (Object.values(values).some((v) => typeof v === "string" && v.includes("sk-live")) ? "looks like a key" : null),
  gapLabelFor: ({ item }) => (item.entityType === "raw-row" ? `table:${item.table}` : `folder:${item.relPath}`),
  limits: { rows: 200, files: 50, bytes: 50 * 1024 * 1024 },
  copy: { selectionLimit: "Choose at most 200 rows and 50 files per send.", bundleLimit: "Choose at most 200 rows and 50 files totaling at most 50 MB per send." },
};
const redact = ({ text }: { text: string }) => ({ text: text.replace(/sk-live-\w+/g, "[redacted]") });
const { validateBackstopRequest, runAuditedBackstop, readBackstopMetadata } = createBackstopService({ policy, redact });

describe("backstop service", () => {
  it("wrong typed host and a short reason are rejected with plain exact text", () => {
    const body = { reason: "Emergency footer fix", typedHost: "wrong.example", rows: [{ table: "p_widgets", pk: { id: "x" } }], files: [] };
    expect(validateBackstopRequest({ body, destinationHost: "live.example" })).toEqual({ error: "Type live.example to confirm where this send will go." });
    expect(validateBackstopRequest({ body: { ...body, typedHost: "live.example", reason: "short" }, destinationHost: "live.example" })).toEqual({ error: "Explain why you need this send in at least 10 characters." });
    expect(validateBackstopRequest({ body: { ...body, typedHost: "live.example" }, destinationHost: "live.example" })).toEqual({
      request: { reason: body.reason, typedHost: "live.example", selection: { rows: body.rows, files: [] } },
    });
  });

  it("an omitted rows or files list is read as an empty list, not a malformed body", () => {
    const rows = [{ table: "p_widgets", pk: { id: "x" } }];
    expect(validateBackstopRequest({ body: { reason: "Emergency footer fix", typedHost: "live.example", rows }, destinationHost: "live.example" })).toEqual({
      request: { reason: "Emergency footer fix", typedHost: "live.example", selection: { rows, files: [] } },
    });
    expect(validateBackstopRequest({ body: { reason: "Emergency footer fix", typedHost: "live.example", files: ["snippets/a.html"] }, destinationHost: "live.example" })).toEqual({
      request: { reason: "Emergency footer fix", typedHost: "live.example", selection: { rows: [], files: ["snippets/a.html"] } },
    });
  });

  it("row/file/byte caps and duplicate selections cannot widen the send", () => {
    const body = { reason: "Emergency footer fix", typedHost: "live.example", rows: [], files: Array.from({ length: 51 }, (_, i) => `snippets/${i}.html`) };
    expect(validateBackstopRequest({ body, destinationHost: "live.example" })).toEqual({ error: "Choose at most 200 rows and 50 files per send." });
    expect("error" in validateBackstopRequest({ body: { ...body, rows: Array(201).fill({ table: "p_widgets", pk: { id: "x" } }), files: [] }, destinationHost: "live.example" })).toBe(true);
  });

  it("only the owner and built-in admin qualify; custom wildcard roles cannot bypass this", async () => {
    const roles = { list: async () => [{ isBuiltin: false, name: "admin" }] };
    expect(await mayUseBackstop({ actorId: "editor", ownerId: "owner", roles })).toBe(false);
    expect(await mayUseBackstop({ actorId: "owner", ownerId: "owner", roles })).toBe(true);
    expect(await mayUseBackstop({ actorId: "admin", ownerId: "owner", roles: { list: async () => [{ isBuiltin: true, name: "admin" }] } })).toBe(true);
  });

  it("source audit persists success AND failure, including the destination run id", async () => {
    const records = new Map<string, BackstopAuditRecord>();
    const audit: BackstopAuditPort = {
      ready: async () => true, save: async ({ record }) => { records.set(record.id, record); },
      get: async ({ id }) => records.get(id) ?? null, gaps: async () => [],
    };
    const record: BackstopAuditRecord = { id: "send-1", workspaceId: "ws", direction: "source", actorId: "admin", destination: "live.example", reason: "Emergency footer fix",
      at: "2026-10-04T00:00:00.000Z", items: [], gapLabels: ["table:p_widgets"], result: "pending", runId: null, details: {}, inverses: [] };
    const success = await runAuditedBackstop({ audit, record, work: async () => ({ runId: "run-dest", value: 42 }) });
    expect(success.value).toBe(42);
    expect(records.get("send-1")?.result).toBe("success");
    expect(records.get("send-1")?.runId).toBe("run-dest");
    await expect(runAuditedBackstop({ audit, record: { ...record, id: "send-2" }, work: async () => { throw new Error("destination refused"); } })).rejects.toThrow(/destination refused/);
    expect(records.get("send-2")?.result).toBe("failure");
    expect(records.get("send-2")?.details.error).toBe("destination refused");
  });

  it("missing audit storage stops before any outbound write", async () => {
    let called = false;
    await expect(runAuditedBackstop({ audit: { ready: async () => false } as BackstopAuditPort, record: {} as BackstopAuditRecord,
      work: async () => { called = true; return {}; } })).rejects.toThrow(/audit storage/);
    expect(called).toBe(false);
  });

  it("a built-in owner role also qualifies; a built-in role with another name does not", async () => {
    expect(await mayUseBackstop({ actorId: "co-owner", ownerId: "owner", roles: { list: async () => [{ isBuiltin: true, name: "owner" }] } })).toBe(true);
    expect(await mayUseBackstop({ actorId: "editor", ownerId: "owner", roles: { list: async () => [{ isBuiltin: true, name: "editor" }] } })).toBe(false);
  });

  it("audit keeps the planned run id when the work returns none, and records a non-Error failure with fixed text", async () => {
    const records = new Map<string, BackstopAuditRecord>();
    const audit: BackstopAuditPort = {
      ready: async () => true, save: async ({ record }) => { records.set(record.id, record); },
      get: async ({ id }) => records.get(id) ?? null, gaps: async () => [],
    };
    const record: BackstopAuditRecord = { id: "send-3", workspaceId: "ws", direction: "source", actorId: "admin", destination: "live.example", reason: "Emergency footer fix",
      at: "2026-10-04T00:00:00.000Z", items: [], gapLabels: [], result: "pending", runId: "run-planned", details: {}, inverses: [] };
    await runAuditedBackstop({ audit, record, work: async () => ({ planned: true }), successResult: "planned" });
    expect(records.get("send-3")?.result).toBe("planned");
    expect(records.get("send-3")?.runId).toBe("run-planned");
    const thrown = { code: "NOT_AN_ERROR" };
    await expect(runAuditedBackstop({ audit, record: { ...record, id: "send-4" }, work: async () => { throw thrown; } })).rejects.toBe(thrown);
    expect(records.get("send-4")?.details.error).toBe("This send failed.");
  });

  it("applies the injected redactor to a failure before it reaches the audit sink", async () => {
    const records = new Map<string, BackstopAuditRecord>();
    const audit: BackstopAuditPort = {
      ready: async () => true, save: async ({ record }) => { records.set(record.id, record); },
      get: async ({ id }) => records.get(id) ?? null, gaps: async () => [],
    };
    const record = { id: "send-5", workspaceId: "ws", direction: "source", actorId: "a", destination: "live.example", reason: "Emergency footer fix",
      at: "2026-10-04T00:00:00.000Z", items: [], gapLabels: [], result: "pending", runId: null, details: {}, inverses: [] } as BackstopAuditRecord;
    await expect(runAuditedBackstop({ audit, record, work: async () => { throw new Error("rejected key sk-live-abc123"); } })).rejects.toThrow();
    expect(records.get("send-5")?.details.error).toBe("rejected key [redacted]");
  });

  it("the injected value scan and copy decide request and bundle refusals", () => {
    const body = { reason: "Emergency footer fix sk-live-abc", typedHost: "live.example", rows: [{ table: "t", pk: { id: 1 } }] };
    expect(validateBackstopRequest({ body, destinationHost: "live.example" })).toEqual({ error: "looks like a key" });
    const file = (id: string, size: number) => ({ entityType: "raw-file", id, state: { size }, backstop: { mode: "backstop", reason: "Emergency footer fix", sourceActor: "a", destinationHost: "live.example" } }) as unknown as PackedEntity;
    expect(() => readBackstopMetadata({ entities: [file("a.txt", 51 * 1024 * 1024)] })).toThrow(policy.copy.bundleLimit);
    expect(readBackstopMetadata({ entities: [file("a.txt", 1)] })?.gapLabels).toEqual(["folder:a.txt"]);
  });
});
