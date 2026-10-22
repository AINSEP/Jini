import assert from "node:assert/strict";
import { test } from "vitest";

import {
  type ConfirmationTokenRecord,
  InMemoryTokenStore,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  expireToken,
  isRedeemable,
  mintToken,
  redeemToken,
} from "../gated-mutations/token.js";

const NOW = "2026-07-15T00:00:00.000Z";
const TEN_MIN_LATER = "2026-07-15T00:10:00.000Z";
const TEN_MIN_ONE_SEC_LATER = "2026-07-15T00:10:01.000Z";

function baseMintParams(overrides: Partial<Parameters<typeof mintToken>[0]> = {}) {
  return {
    planId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    planHash: "sha256:" + "a".repeat(64),
    scopeId: "workspace-1",
    confirmerPrincipalId: "user-1",
    now: NOW,
    ttlSeconds: 600,
    generateToken: () => "confirmation-token",
    ...overrides,
  };
}

test("AC-14: mintToken sets expiresAt to exactly createdAt + 600 seconds, no jitter", () => {
  const record = mintToken(baseMintParams());
  assert.equal(record.createdAt, NOW);
  assert.equal(record.expiresAt, TEN_MIN_LATER);
  assert.equal(record.status, "minted");
});

test("AC-14: mintToken binds (planHash, scopeId, confirmerPrincipalId) exactly as given", () => {
  const params = baseMintParams();
  const record = mintToken(params);
  assert.equal(record.planHash, params.planHash);
  assert.equal(record.scopeId, params.scopeId);
  assert.equal(record.confirmerPrincipalId, params.confirmerPrincipalId);
});

test("behavior.spec.md §4: token redemption limit is exactly 1 — isRedeemable false once status !== 'minted'", () => {
  const minted = mintToken(baseMintParams());
  assert.equal(isRedeemable({ record: minted, now: NOW }), true);

  const redeemed: ConfirmationTokenRecord = { ...minted, status: "redeemed" };
  assert.equal(isRedeemable({ record: redeemed, now: NOW }), false);

  const expired: ConfirmationTokenRecord = { ...minted, status: "expired" };
  assert.equal(isRedeemable({ record: expired, now: NOW }), false);
});

test("EC (§7): execute() at exact TTL boundary — redeemable at expiresAt itself, not redeemable one second after", () => {
  const minted = mintToken(baseMintParams());
  assert.equal(isRedeemable({ record: minted, now: TEN_MIN_LATER }), true, "boundary instant itself must still be valid");
  assert.equal(isRedeemable({ record: minted, now: TEN_MIN_ONE_SEC_LATER }), false, "one second past the boundary must be expired");
});

test("INV-03: redeemToken on an already-redeemed token throws TokenAlreadyRedeemedError, never re-succeeds", async () => {
  const store = new InMemoryTokenStore({});
  const minted = mintToken(baseMintParams());
  await store.save({ record: minted });

  const first = await redeemToken({ store, token: minted.confirmationToken, now: NOW });
  assert.equal(first.status, "redeemed");

  await assert.rejects(
    redeemToken({ store, token: minted.confirmationToken, now: NOW }),
    (err: unknown) => {
      assert.ok(err instanceof TokenAlreadyRedeemedError);
      return true;
    }
  );
});

test("redeemToken on an expired token throws TokenExpiredError", async () => {
  const store = new InMemoryTokenStore({});
  const minted = mintToken(baseMintParams());
  await store.save({ record: minted });

  await assert.rejects(
    redeemToken({ store, token: minted.confirmationToken, now: TEN_MIN_ONE_SEC_LATER }),
    (err: unknown) => {
      assert.ok(err instanceof TokenExpiredError);
      return true;
    }
  );
});

test("REQ-11 / AC-35: redeemToken on a confirmationToken string never minted by this contract throws TokenExpiredError, never a distinct code", async () => {
  const store = new InMemoryTokenStore({});

  await assert.rejects(
    redeemToken({ store, token: "forged-or-garbage-token-string", now: NOW }),
    (err: unknown) => {
      assert.ok(err instanceof TokenExpiredError, "an unrecognized token must be indistinguishable from an expired one");
      assert.ok(!(err instanceof TokenAlreadyRedeemedError));
      return true;
    }
  );
});

test("no un-redeeming: expireToken never transitions a redeemed token back toward mintable/expired-only-from-minted", async () => {
  const store = new InMemoryTokenStore({});
  const minted = mintToken(baseMintParams());
  await store.save({ record: minted });
  await redeemToken({ store, token: minted.confirmationToken, now: NOW });

  await expireToken({ store, token: minted.confirmationToken, now: TEN_MIN_ONE_SEC_LATER });
  const record = await store.findByToken({ token: minted.confirmationToken });
  assert.equal(record?.status, "redeemed", "expireToken must never overwrite an already-redeemed token's status");
});

test("U-003-B1 / INV-03 (property): under N concurrent redemption attempts on one minted token, exactly one succeeds and N-1 fail with TokenAlreadyRedeemedError", async () => {
  for (const concurrency of [2, 5, 10]) {
    const store = new InMemoryTokenStore({});
    const minted = mintToken(baseMintParams({ planId: `plan-${concurrency}` }));
    await store.save({ record: minted });

    const attempts = Array.from({ length: concurrency }, () =>
      redeemToken({ store, token: minted.confirmationToken, now: NOW })
    );
    const settled = await Promise.allSettled(attempts);

    const succeeded = settled.filter((r) => r.status === "fulfilled");
    const failed = settled.filter((r) => r.status === "rejected");

    assert.equal(succeeded.length, 1, `expected exactly 1 success under ${concurrency}-way concurrent redemption`);
    assert.equal(failed.length, concurrency - 1);
    for (const failure of failed as PromiseRejectedResult[]) {
      assert.ok(
        failure.reason instanceof TokenAlreadyRedeemedError,
        "every losing concurrent redemption attempt must fail with TokenAlreadyRedeemedError, never silently succeed"
      );
    }
  }
});

test("TokenStorePort.tryRedeem itself reports which single caller performed the transition (contract test, C-005)", async () => {
  const store = new InMemoryTokenStore({});
  const minted = mintToken(baseMintParams());
  await store.save({ record: minted });

  const [a, b] = await Promise.all([
    store.tryRedeem({ token: minted.confirmationToken, now: NOW }),
    store.tryRedeem({ token: minted.confirmationToken, now: NOW }),
  ]);

  const redeemedCount = [a, b].filter((r) => r.redeemed).length;
  assert.equal(redeemedCount, 1, "tryRedeem must be a single atomic conditional operation, never letting two callers both win");
});

test('generator and TTL policy can vary without changing stored token shape', () => {
  const short = mintToken(baseMintParams({ ttlSeconds: 30, generateToken: () => 'host-opaque-token' }));
  const long = mintToken(baseMintParams({ ttlSeconds: 600, generateToken: () => 'second-token' }));
  assert.equal(short.confirmationToken, 'host-opaque-token');
  assert.equal(short.expiresAt, '2026-07-15T00:00:30.000Z');
  assert.equal(long.expiresAt, TEN_MIN_LATER);
  assert.deepEqual(Object.keys(short).sort(), [
    'confirmationToken', 'confirmerPrincipalId', 'createdAt', 'expiresAt', 'planHash', 'scopeId', 'status',
  ]);
});

test('invalid TTL, clock and generator values fail before issuing a token', () => {
  for (const ttlSeconds of [0, -1, NaN, Infinity]) {
    assert.throws(() => mintToken(baseMintParams({ ttlSeconds })), RangeError);
  }
  assert.throws(() => mintToken(baseMintParams({ now: 'invalid' })), RangeError);
  assert.throws(() => mintToken(baseMintParams({ generateToken: () => '' })), /token generator must return a non-empty string/);
});

test('save and read snapshots cannot resurrect a redeemed token or change its binding', async () => {
  const store = new InMemoryTokenStore({});
  const minted = mintToken(baseMintParams());
  await store.save({ record: minted });
  minted.planHash = 'mutated outside store';
  const read = await store.findByToken({ token: minted.confirmationToken });
  assert.equal(read?.planHash, 'sha256:' + 'a'.repeat(64));
  read!.status = 'redeemed';
  assert.equal((await store.findByToken({ token: minted.confirmationToken }))?.status, 'minted');
  await redeemToken({ store, token: minted.confirmationToken, now: NOW });
  await assert.rejects(store.save({ record: minted }), /confirmation token already exists/);
  assert.equal((await store.findByToken({ token: minted.confirmationToken }))?.status, 'redeemed');
});

test('atomic expiry and redemption preserve the winner in both concurrent orderings', async () => {
  for (const redemptionFirst of [true, false]) {
    const store = new InMemoryTokenStore({});
    const record = mintToken(baseMintParams());
    await store.save({ record });
    const redeem = () => store.tryRedeem({ token: record.confirmationToken, now: NOW });
    const expire = () => expireToken({ store, token: record.confirmationToken, now: NOW });
    if (redemptionFirst) await Promise.all([redeem(), expire()]);
    else await Promise.all([expire(), redeem()]);
    assert.equal((await store.findByToken({ token: record.confirmationToken }))?.status, redemptionFirst ? 'redeemed' : 'expired');
    await expire();
    assert.equal((await store.findByToken({ token: record.confirmationToken }))?.status, redemptionFirst ? 'redeemed' : 'expired');
  }
  const empty = new InMemoryTokenStore({});
  await expireToken({ store: empty, token: 'unknown', now: NOW });
  assert.equal(await empty.findByToken({ token: 'unknown' }), null);
});
