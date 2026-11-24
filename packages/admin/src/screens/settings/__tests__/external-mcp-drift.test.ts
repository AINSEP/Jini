import { describe, expect, it } from "vitest";
import type { AdminExternalMcpAdmissionsSnapshot, AdminFederatedAdmissionEntry } from "@jini-ai/core/contracts/hosted-mcp";
import { describeAdmissionDrift } from "../external-mcp-connection-drift.js";
import type { ExternalMcpDriftCopy } from "../external-mcp-drift-types.js";
import { admissionRestartHelps, describeConnectionDrift, describeDriftHeadline, grantWriteFieldValue, parseSavedToolNames } from "../external-mcp-tool-drift.js";
import { describeProbeUnreachable } from "../external-mcp-tool-picker-rules.js";

/** Every key distinct and nothing like shipped English, so a test fails if the code reads any string of its own. */
const COPY: ExternalMcpDriftCopy = {
  refusal: {
    "remote-declares-not-read-only": { kind: "needs-write-grant", key: "k:write" },
    "remote-declares-destructive": { kind: "destructive", key: "k:destructive" },
    "missing-or-invalid-input-schema": { kind: "server-side-defect", key: "k:schema" },
    "invalid-remote-tool-name": { kind: "server-side-defect", key: "k:name" },
    "duplicate-remote-tool-name": { kind: "server-side-defect", key: "k:dup" },
    "connection-tool-cap-reached": { kind: "server-side-defect", key: "k:cap" },
  },
  refusedFallback: "k:refused",
  notOffered: "k:not-offered",
  inertWriteGrant: "k:inert {name}",
  stillLive: "k:still-live",
  notRunning: "k:not-running",
  disabledButRunning: "k:disabled-running",
  removedButStillRunning: "k:removed",
  decryptFailed: "k:decrypt",
  failedToStart: "k:failed {reason}",
  launcherMissing: "k:launcher",
  restartHeadline: "k:restart",
  noRestartHeadline: "k:no-restart",
  needsSignIn: "k:sign-in",
};

function entry(overrides: Partial<AdminFederatedAdmissionEntry> = {}): AdminFederatedAdmissionEntry {
  return { connectionId: "c1", isPreset: false, admitted: [], refused: [], allowlistedButAbsent: [], writeAllowedButNotAllowlisted: [], ...overrides } as AdminFederatedAdmissionEntry;
}
const messageKeys = (drift: ReturnType<typeof describeConnectionDrift>) => drift?.entries.map((e) => e.messageKey);

describe("describeConnectionDrift words every entry from the injected copy", () => {
  it("refusals read the injected table (kind and key), the fallback for an unknown reason, and skip the routine one", () => {
    const refused = [
      { remoteName: "a", reason: "remote-declares-destructive" },
      { remoteName: "b", reason: "not-in-operator-allowlist" },
      { remoteName: "c", reason: "brand-new-reason" },
    ] as unknown as AdminFederatedAdmissionEntry["refused"];
    const drift = describeConnectionDrift({ entry: entry({ refused }), savedAllowedToolNames: undefined, copy: COPY });
    expect(drift?.entries.map((e) => [e.remoteName, e.kind, e.messageKey])).toEqual([
      ["a", "destructive", "k:destructive"],
      ["c", "server-side-defect", "k:refused"],
    ]);
  });

  it("absent, inert-write and still-live entries read their injected keys", () => {
    const drift = describeConnectionDrift({
      entry: entry({ allowlistedButAbsent: ["gone"], writeAllowedButNotAllowlisted: ["w"], admitted: [{ remoteName: "live" }] as never }),
      savedAllowedToolNames: "gone",
      copy: COPY,
    });
    expect(messageKeys(drift)).toEqual(["k:not-offered", "k:inert {name}", "k:still-live"]);
  });
});

describe("describeAdmissionDrift words connection-level entries from the injected copy", () => {
  const saved = (overrides = {}) => ({ allowedToolNames: "t", enabled: true, ...overrides });
  const snapshot = (overrides: Partial<AdminExternalMcpAdmissionsSnapshot> = {}) => ({ connections: [], ...overrides }) as AdminExternalMcpAdmissionsSnapshot;
  const only = (savedById: Record<string, ReturnType<typeof saved>>, snap = snapshot()) => describeAdmissionDrift({ snapshot: snap, savedById, copy: COPY })[0]?.entries[0];

  it("not running, needing sign-in, failing to start, decrypt failure and missing launcher", () => {
    expect(only({ c1: saved() })?.messageKey).toBe("k:not-running");
    expect(only({ c1: saved({ needsSignIn: true }) })?.messageKey).toBe("k:sign-in");
    const fail = (reason: string, s = saved()) => only({ c1: s }, snapshot({ configFailures: [{ connectionId: "c1", reason }] as never }));
    expect(fail("boom")).toMatchObject({ messageKey: "k:failed {reason}", messageVars: { reason: "boom" } });
    expect(fail("secret could not be decrypted")?.messageKey).toBe("k:decrypt");
    expect(fail("spawn /bin/x ENOENT", saved({ transport: "stdio", command: "/bin/x" }))?.messageKey).toBe("k:launcher");
  });

  it("disabled-but-running and removed-but-still-running", () => {
    const live = entry({ admitted: [{ remoteName: "t" }] as never });
    expect(only({ c1: saved({ enabled: false }) }, snapshot({ connections: [live] }))?.messageKey).toBe("k:disabled-running");
    expect(only({}, snapshot({ connections: [live] }))?.messageKey).toBe("k:removed");
  });
});

describe("headline, restart and write-grant helpers", () => {
  const conn = (kind: string) => ({ connectionId: "c", liveToolCount: 0, notLoaded: [], savedToolCount: 0, entries: [{ connectionId: "c", remoteName: null, kind, messageKey: "", messageVars: {} }] }) as never;
  it("picks the restart or no-restart headline from the injected copy by whether a restart can help", () => {
    expect(admissionRestartHelps({ connections: [conn("not-running")] })).toBe(true);
    expect(describeDriftHeadline({ connections: [conn("not-running")], copy: COPY })).toBe("k:restart");
    expect(describeDriftHeadline({ connections: [conn("destructive")], copy: COPY })).toBe("k:no-restart");
  });
  it("parseSavedToolNames trims and drops blanks; grantWriteFieldValue appends once", () => {
    expect(parseSavedToolNames({ value: " a, ,b ," })).toEqual(["a", "b"]);
    expect(grantWriteFieldValue({ currentWriteAllowedToolNames: "a", remoteName: "b" })).toBe("a, b");
    expect(grantWriteFieldValue({ currentWriteAllowedToolNames: "a, b", remoteName: "b" })).toBe("a, b");
  });
});

describe("describeProbeUnreachable uses the injected request-error vocabulary", () => {
  const t = (key: string) => `t(${key})`;
  const errors = { isApiError: (e: unknown): e is { code?: string } => typeof e === "object" && e !== null && "code" in e, describeApiError: ({ fallback }: { e: unknown; fallback: string }) => `rendered:${fallback}` };
  it("treats the host's error with the unsupported-transport code specially and delegates every other failure to the host renderer", () => {
    expect(describeProbeUnreachable({ error: { code: "PROBE_UNSUPPORTED_TRANSPORT" }, t, errors })).toMatch(/^t\(This server runs as a local command/);
    expect(describeProbeUnreachable({ error: { code: "OTHER" }, t, errors })).toMatch(/^rendered:t\(Could not reach/);
    expect(describeProbeUnreachable({ error: new Error("x"), t, errors })).toMatch(/^rendered:/);
  });
});
