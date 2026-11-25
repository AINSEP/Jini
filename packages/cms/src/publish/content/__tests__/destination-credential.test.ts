import { describe, it, expect } from "vitest";

import {
  resolvePublishDestinationCredential,
  type DestinationPeerRecord,
  type DestinationSession,
} from "../destination-credential.js";
import { PublishContentPeerNotFoundError } from "../peers.js";

const connected: DestinationPeerRecord = { id: "p1", label: "Far Site", baseUrl: "https://far.example", remoteWorkspaceId: "ws-remote", sealed: null };
const sealedRow: DestinationPeerRecord = { ...connected, sealed: { opaque: true } };
const sealedCredential = { id: "p1", label: "Far Site", baseUrl: "https://far.example", remoteWorkspaceId: "ws-remote", apiKey: "sealed-key" };

function setup(record: DestinationPeerRecord | null, session: DestinationSession = { token: "session-token", identity: { workspaceId: "ws-remote" } }) {
  const calls: string[] = [];
  const opened: unknown[] = [];
  const deps = { repo: { findById: async () => record } };
  return {
    calls, opened,
    run: (input: { workspaceId: string; id: string; backstop?: boolean }) => resolvePublishDestinationCredential({
      deps, input,
      resolveSealedCredential: async () => { calls.push("sealed"); return sealedCredential; },
      openSession: async (args) => { calls.push("session"); opened.push(args.input); return session; },
      workspaceMismatchError: ({ label }) => new Error(`mismatch:${label}`),
    }),
  };
}

describe("resolvePublishDestinationCredential", () => {
  it("throws the peer-not-found error when no row exists", async () => {
    await expect(setup(null).run({ workspaceId: "w", id: "p1" })).rejects.toBeInstanceOf(PublishContentPeerNotFoundError);
  });

  it("opens a sealed row through the injected opener and never mints a session", async () => {
    const t = setup(sealedRow);
    await expect(t.run({ workspaceId: "w", id: "p1" })).resolves.toEqual(sealedCredential);
    expect(t.calls).toEqual(["sealed"]);
  });

  it("uses the session token as the api key for a connected destination and forwards the backstop flag", async () => {
    const t = setup(connected);
    await expect(t.run({ workspaceId: "w", id: "p1", backstop: true })).resolves.toEqual({ ...sealedCredential, apiKey: "session-token" });
    expect(t.opened).toEqual([{ baseUrl: "https://far.example", workspaceId: "w", backstop: true }]);
    const plain = setup(connected);
    await plain.run({ workspaceId: "w", id: "p1" });
    expect(plain.opened).toEqual([{ baseUrl: "https://far.example", workspaceId: "w" }]);
  });

  it("refuses with the host error when the destination now reports a different workspace", async () => {
    const t = setup(connected, { token: "session-token", identity: { workspaceId: "ws-rebuilt" } });
    await expect(t.run({ workspaceId: "w", id: "p1" })).rejects.toThrow("mismatch:Far Site");
  });
});
