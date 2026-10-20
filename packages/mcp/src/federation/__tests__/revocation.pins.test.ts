import { describe, expect, test } from "vitest";
import { createFederatedConnectionRevocationGate, rosterRefusalFor } from "../approvals/index.js";
import type {
  ConnectionRosterReader, ConnectionRosterSnapshot, FederatedConnectionRefusal, FederatedRevocationDiagnostic,
  FederatedRevocationErrorFactoryPort, FederatedRevocationWebhookPort,
} from "../approvals/index.js";
import type { FederatedCallTarget } from "../ports.js";

// Characterization pins for every branch of approvals/revocation.ts (SEC: the connection gate).
const call: FederatedCallTarget = { remoteName: "write_thing", declaredAnnotations: { readOnlyHint: false }, origin: { kind: "roster", admissionRevision: "revision-1" } };
const row: ConnectionRosterSnapshot = { label: "Service", enabled: true, admissionRevision: "revision-1", disconnected: false, grants: { allowedToolNames: ["write_thing"], writeAllowedToolNames: [] } };

class RefusalError extends Error {
  constructor(readonly refusal: FederatedConnectionRefusal) { super(`refused:${refusal.reason}`); }
}
const errorFactory: FederatedRevocationErrorFactoryPort = { create: refusal => new RefusalError(refusal) };

function roster(result: ConnectionRosterSnapshot | null | Error, seen: { scope?: string | undefined }[] = []): ConnectionRosterReader {
  return {
    findByServerId: async (_required, optional) => {
      seen.push(optional ?? { scope: "<no options object>" });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe("rosterRefusalFor", () => {
  test("a write-declaring tool on the allowlist but absent from the write list is not refused (grants never refuse on hints)", () => {
    expect(rosterRefusalFor({ record: row, call })).toBeNull();
  });

  test("an unknown origin is unverifiable even when no row exists", () => {
    expect(rosterRefusalFor({ record: null, call: { ...call, origin: undefined } })).toBe("unverifiable");
  });

  test("a changed revision wins over disconnected", () => {
    expect(rosterRefusalFor({ record: { ...row, admissionRevision: "revision-2", disconnected: true }, call })).toBe("changed");
  });

  test("turned-off wins over disconnected", () => {
    expect(rosterRefusalFor({ record: { ...row, enabled: false, disconnected: true }, call })).toBe("turned-off");
  });

  test("disconnected wins over a missing grant", () => {
    expect(rosterRefusalFor({ record: { ...row, disconnected: true, grants: { allowedToolNames: [], writeAllowedToolNames: [] } }, call })).toBe("disconnected");
  });
});

describe("createFederatedConnectionRevocationGate", () => {
  test("without a scope the roster read gets an empty options object", async () => {
    const seen: { scope?: string | undefined }[] = [];
    const gate = createFederatedConnectionRevocationGate({ roster: roster(row, seen), errorFactory });
    await expect(gate({ connectionId: "service", call })).resolves.toBeUndefined();
    expect(seen).toEqual([{}]);
  });

  test("a refusal without webhooks or diagnostics still throws the factory error with the row label", async () => {
    const gate = createFederatedConnectionRevocationGate({ roster: roster({ ...row, enabled: false }), errorFactory });
    await expect(gate({ connectionId: "service", call })).rejects.toMatchObject({
      message: "refused:turned-off", refusal: { serverId: "service", label: "Service", remoteName: "write_thing", reason: "turned-off" },
    });
  });

  test("an unknown origin still reads the roster and refuses as unverifiable with the row label", async () => {
    const seen: { scope?: string | undefined }[] = [];
    const gate = createFederatedConnectionRevocationGate({ roster: roster(row, seen), errorFactory });
    await expect(gate({ connectionId: "service", call: { ...call, origin: undefined } })).rejects.toMatchObject({
      refusal: { label: "Service", reason: "unverifiable" },
    });
    expect(seen).toHaveLength(1);
  });

  test("a removed row refuses with a null label", async () => {
    const gate = createFederatedConnectionRevocationGate({ roster: roster(null), errorFactory });
    await expect(gate({ connectionId: "service", call })).rejects.toMatchObject({ refusal: { label: null, reason: "removed" } });
  });

  test("a store failure without onDiagnostic refuses as unverifiable with a null label", async () => {
    const gate = createFederatedConnectionRevocationGate({ roster: roster(new Error("private/db/path")), errorFactory });
    await expect(gate({ connectionId: "service", call })).rejects.toMatchObject({ message: "refused:unverifiable", refusal: { label: null } });
  });

  test("a store failure reports the store stage with the driver error to diagnostics", async () => {
    const driverError = new Error("private/db/path");
    const diagnostics: FederatedRevocationDiagnostic[] = [];
    const gate = createFederatedConnectionRevocationGate({ roster: roster(driverError), errorFactory }, { onDiagnostic: event => { diagnostics.push(event); } });
    await expect(gate({ connectionId: "service", call })).rejects.toThrow("refused:unverifiable");
    expect(diagnostics).toEqual([{ connectionId: "service", stage: "store", error: driverError }]);
  });

  test("a throwing onDiagnostic cannot bypass the refusal", async () => {
    const gate = createFederatedConnectionRevocationGate({ roster: roster(new Error("db")), errorFactory }, {
      onDiagnostic: () => { throw new Error("diagnostic sink down"); },
    });
    await expect(gate({ connectionId: "service", call })).rejects.toThrow("refused:unverifiable");
  });

  test("the refusal webhook receives the refusal and the scope", async () => {
    const sent: [FederatedConnectionRefusal, { scope?: string } | undefined][] = [];
    const webhooks: FederatedRevocationWebhookPort = { connectionRefused: async (refusal, optional) => { sent.push([refusal, optional]); } };
    const gate = createFederatedConnectionRevocationGate({ roster: roster(null), errorFactory }, { scope: "workspace", webhooks });
    await expect(gate({ connectionId: "service", call })).rejects.toThrow("refused:removed");
    expect(sent).toEqual([[{ serverId: "service", label: null, remoteName: "write_thing", reason: "removed" }, { scope: "workspace" }]]);
  });

  test("the refusal webhook gets an empty options object without a scope", async () => {
    const sent: ({ scope?: string } | undefined)[] = [];
    const gate = createFederatedConnectionRevocationGate({ roster: roster(null), errorFactory }, { webhooks: { connectionRefused: async (_r, optional) => { sent.push(optional); } } });
    await expect(gate({ connectionId: "service", call })).rejects.toThrow("refused:removed");
    expect(sent).toEqual([{}]);
  });

  test("a webhook failure is reported at the webhook stage and the refusal still throws", async () => {
    const deliveryError = new Error("delivery failed");
    const diagnostics: FederatedRevocationDiagnostic[] = [];
    const gate = createFederatedConnectionRevocationGate({ roster: roster({ ...row, disconnected: true }), errorFactory }, {
      webhooks: { connectionRefused: async () => { throw deliveryError; } }, onDiagnostic: event => { diagnostics.push(event); },
    });
    await expect(gate({ connectionId: "service", call })).rejects.toThrow("refused:disconnected");
    expect(diagnostics).toEqual([{ connectionId: "service", stage: "webhook", error: deliveryError }]);
  });

  test("an allowed call sends no webhook", async () => {
    let sent = 0;
    const gate = createFederatedConnectionRevocationGate({ roster: roster(row), errorFactory }, { webhooks: { connectionRefused: async () => { sent++; } } });
    await expect(gate({ connectionId: "service", call })).resolves.toBeUndefined();
    expect(sent).toBe(0);
  });
});
