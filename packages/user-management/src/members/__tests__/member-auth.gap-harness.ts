/**
 * Gap-fill harness for the member sign-in / password workflows: real in-memory repositories, a
 * deterministic fake password hasher, a settable clock and recording principal/observer ports.
 * Used only by the `*.gap.test.ts` files beside it.
 */
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { PositionalMailer } from "@jini-ai/core/contracts/mail";
import type { PasswordHasherPort } from "../../core/index.js";
import { hashToken, issueMemberSession } from "../member-credentials.js";
import { saveMemberChallenge } from "../member-challenge.js";
import type { MembersWriteServiceDeps } from "../ports.js";
import {
  createInMemoryCredentialLifecycle, InMemoryMagicLinkTokenRepo, InMemoryMemberRepo, InMemoryMemberSessionRepo,
  InMemoryMemberSubscriptionRepo, InMemoryMemberTierRepo,
} from "../repo.memory.js";
import type { MemberRecord } from "../types.js";

export const WS = "ws-1";
export const T0 = "2026-01-01T00:00:00.000Z";

/** The fake hasher's stored form: the test can recompute it to assert exactly what was written. */
export const fakeHash = (password: string): string => `h:${password}`;

export function memberRow(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return { id: "m-1", workspaceId: WS, email: "ada@example.com", status: "active", createdAt: T0, updatedAt: T0, version: 1, ...overrides };
}

export type HasherCall = { op: "hash" | "verify"; password: string; hash?: string };

export function memberAuthHarness(options: { lifecycle?: boolean; members?: MemberRecord[] } = {}) {
  let now = Date.parse(T0);
  let next = 0;
  const hasherCalls: HasherCall[] = [];
  const hooks: { onHash?: () => Promise<void> | void; onVerify?: () => Promise<void> | void } = {};
  const passwordHasher: PasswordHasherPort = {
    hash: async ({ password }) => { hasherCalls.push({ op: "hash", password }); await hooks.onHash?.(); return fakeHash(password); },
    verify: async ({ hash, password }) => {
      hasherCalls.push({ op: "verify", password, hash });
      await hooks.onVerify?.();
      return hash === fakeHash(password);
    },
  };
  const order: string[] = [];
  const principalSaves: unknown[] = [];
  const created: unknown[] = [];
  const members = new InMemoryMemberRepo({}, { initialRows: options.members ?? [] });
  const sessions = new InMemoryMemberSessionRepo();
  const magicLinks = new InMemoryMagicLinkTokenRepo();
  const mailer: PositionalMailer = {
    capabilities: () => { throw new Error("mail is not part of this flow"); },
    send: async () => { throw new Error("mail is not part of this flow"); },
    sendBatch: async () => { throw new Error("mail is not part of this flow"); },
  };
  const deps: MembersWriteServiceDeps = {
    orFallbackSync,
    onMemberCreated: (event) => { order.push("created-event"); created.push(event); },
    ...(options.lifecycle === false ? {} : { credentialLifecycle: createInMemoryCredentialLifecycle() }),
    clock: { nowMs: () => now } as unknown as MembersWriteServiceDeps["clock"],
    ids: { newId: () => `id-${++next}` } as MembersWriteServiceDeps["ids"],
    members,
    tiers: new InMemoryMemberTierRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    sessions,
    magicLinks,
    passwordHasher,
    mailer,
    principals: { save: async (row: unknown) => { order.push("principal"); principalSaves.push(row); } } as unknown as MembersWriteServiceDeps["principals"],
  };
  const originalSave = members.save.bind(members);
  members.save = async (record) => { order.push(`member:${record.status}`); await originalSave(record); };
  return {
    deps, members, sessions, magicLinks, hasherCalls, hooks, order, principalSaves, created,
    setNow: (iso: string) => { now = Date.parse(iso); },
    /** Store a challenge exactly as the request flow does: link digest plus fake-hashed six-digit code. */
    seedChallenge: async (seed: { purpose: "signin" | "password_reset"; member: MemberRecord | null; email?: string; challengeId?: string; rawToken?: string; code?: string }) => {
      await saveMemberChallenge({ deps, member: seed.member, email: seed.email ?? seed.member?.email ?? "new@example.com",
        purpose: seed.purpose, challengeId: seed.challengeId ?? "c-1", nowIso: new Date(now).toISOString(), workspaceId: WS,
        tokenHash: hashToken({ rawToken: seed.rawToken ?? "raw-link" }), codeHash: fakeHash(seed.code ?? "123456") });
    },
    /** Mint a real session (raw token + stored digest) for the /me password flows. */
    signIn: async (member: MemberRecord) => issueMemberSession({ deps, member, nowIso: new Date(now).toISOString() }),
  };
}
