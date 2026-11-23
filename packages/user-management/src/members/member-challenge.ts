import { decideChallenge, verifyChallengeCode, type AuthChallengeRecord, type ChallengeStorePort } from "../server/auth-challenge.js";
import type { MagicLinkTokenRepoPort, MemberSignInInput, MembersWriteServiceDeps } from "./ports.js";
import { MemberAuthError, type MagicLinkTokenRecord, type MemberRecord } from "./types.js";
import { dummyPasswordHash, hashToken, isoPlusMs, memberPasswordHasher } from "./member-credentials.js";

export const INVALID_SIGN_IN_CREDENTIAL = "sign-in credential is invalid" as const;

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Member-table adapter for Jini's challenge contract. Issuance supplies host identity metadata;
 * reads retain that metadata for deferred signup. Realm is implicit in this dedicated table.
 * @complexity O(1) indexed operations; repository CAS owns concurrent consumption/attempts.
 */
export function memberChallengeStore(required: {
  repo: MagicLinkTokenRepoPort;
  identity?: Pick<MagicLinkTokenRecord, "memberId" | "email" | "createdAt">;
}, _options: Record<string, never> = {}): ChallengeStorePort {
  const { repo, identity } = required;
  return {
    save: async record => {
      if (!identity || record.realm !== "member") throw new Error("Member challenge issuance requires member identity");
      await repo.save({ ...identity, id: record.id, workspaceId: record.workspaceId,
        purpose: record.purpose as MagicLinkTokenRecord["purpose"], tokenHash: record.tokenHash,
        codeHash: record.codeHash ?? undefined, failedAttempts: record.failedAttempts,
        expiresAt: record.expiresAt, consumedAt: record.consumedAt ?? undefined });
    },
    findById: async input => asChallenge({ record: await repo.findById(input) }),
    findByTokenHash: async input => asChallenge({ record: await repo.findByTokenHash(input) }),
    reserveCodeAttempt: input => repo.reserveCodeAttempt(input, { maxAttempts: input.maxAttempts }),
    consume: async input => {
      try {
        await repo.consume({ workspaceId: input.workspaceId, id: input.id, consumedAt: input.nowIso });
        return true;
      } catch (error) {
        // Only the repo's known single-use rejections are invalid credentials. Outages must surface.
        const prefix = `magic link token '${input.id}' `;
        if (error instanceof Error && ["was not found", "has expired", "was already consumed"]
          .some(reason => error.message === prefix + reason)) return false;
        throw error;
      }
    },
  };
}

/** Legacy link-only rows normalize to Jini's nullable code hash and zero spent attempts. */
function asChallenge({ record }: { record: MagicLinkTokenRecord | null }, _optional = {}): AuthChallengeRecord | null {
  return record && { ...record, realm: "member", codeHash: record.codeHash ?? null, failedAttempts: record.failedAttempts ?? 0 };
}

/** Persist only challenge hashes and the deferred member identity; O(1) adapter calls. */
export async function saveMemberChallenge(required: {
  deps: MembersWriteServiceDeps; member: MemberRecord | null; email: string;
  purpose: "signin" | "password_reset"; challengeId: string; nowIso: string; workspaceId: string;
  tokenHash: string; codeHash: string | null;
}, _options: Record<string, never> = {}): Promise<void> {
  const { deps, member, email, purpose, challengeId, nowIso, workspaceId, tokenHash, codeHash } = required;
  const store = memberChallengeStore({ repo: deps.magicLinks, identity: {
    memberId: member?.id ?? deps.ids.newId(), createdAt: nowIso, ...(member ? {} : { email }),
  } });
  await store.save({ id: challengeId, workspaceId, realm: "member", purpose,
    tokenHash, failedAttempts: 0, codeHash,
    expiresAt: isoPlusMs({ nowIso, ms: MAGIC_LINK_TTL_MS }) });
}

/**
 * Purpose-bound completion: reserve attempts before checking a code, then CAS-consume.
 * All invalid credentials (including lost races) give the same MemberAuthError.
 * @complexity O(1) indexed operations and at most one password verification.
 */
export async function consumeMemberChallenge(required: {
  deps: MembersWriteServiceDeps; input: MemberSignInInput; purpose: "signin" | "password_reset"; nowIso: string;
}, _options: Record<string, never> = {}): Promise<MagicLinkTokenRecord> {
  const { deps, input, purpose, nowIso } = required;
  const store = memberChallengeStore({ repo: deps.magicLinks });
  const scope = { workspaceId: input.workspaceId, realm: "member", purpose };
  const record = input.token !== undefined
    ? await store.findByTokenHash({ ...scope, tokenHash: hashToken({ rawToken: input.token }) })
    : await store.findById({ ...scope, id: input.challengeId });
  const hasher = memberPasswordHasher({ deps });
  if (decideChallenge({ ...scope, record, nowIso }) !== "ok" || !record) {
    // Disabled/trashed addresses get unstored handles: spend the same verify so timing cannot tell.
    if (input.token === undefined) await verifyChallengeCode({ code: input.code, hash: await dummyPasswordHash({ hasher }), hasher });
    throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  }
  if (input.token === undefined) {
    if (!await store.reserveCodeAttempt({ ...scope, id: record.id, nowIso })) throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
    if (!await verifyChallengeCode({ code: input.code, hash: record.codeHash, hasher })) throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  }
  if (!await store.consume({ ...scope, id: record.id, nowIso })) throw new MemberAuthError(INVALID_SIGN_IN_CREDENTIAL);
  // The host adapter preserves memberId/email/createdAt while normalizing challenge metadata.
  return record as AuthChallengeRecord & MagicLinkTokenRecord;
}
