import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";

import { createBootSessionTokenStore, mintBootSessionToken, redeemBootSessionToken, isBootSessionTokenArmed } from "../boot-session-token.js";

/**
 * @file Coverage for the boot-session token store.
 *
 * Every assertion here is a negative one about authorization, because that is where this module can
 * actually hurt someone: a store that answers `true` when it should not turns every launch of the host
 * into an open admin. The unarmed case is tested against the inputs a naive `===` would let
 * through, and the single-use property is tested by replaying a token that genuinely worked once.
 */

test("an unarmed store refuses EVERYTHING — there is no permissive arm", () => {
  const store = createBootSessionTokenStore();
  assert.equal(store.isArmed(), false);

  for (const candidate of ["", "anything", "null", null, undefined, 0, {}, [], true]) {
    assert.equal(store.redeem({ rawToken: candidate }), false, `unarmed store accepted ${JSON.stringify(candidate)}`);
  }
});

test("mints a 256-bit token and redeems it exactly once", () => {
  const store = createBootSessionTokenStore();
  const token = store.mint();

  assert.equal(typeof token, "string");
  // 32 random bytes as base64url.
  assert.ok(token.length >= 43, `expected a 256-bit token, got ${token.length} chars`);
  assert.equal(store.isArmed(), true);

  assert.equal(store.redeem({ rawToken: token }), true);
  assert.equal(store.isArmed(), false, "a redeemed token must not stay armed");
});

test("a REPLAY of a token that already worked fails", () => {
  const store = createBootSessionTokenStore();
  const token = store.mint();
  assert.equal(store.redeem({ rawToken: token }), true);
  assert.equal(store.redeem({ rawToken: token }), false, "the same token was accepted twice");
});

test("a wrong token does NOT burn the real one", () => {
  // Burning on a bad guess would let any local process disarm the launcher's one redemption.
  const store = createBootSessionTokenStore();
  const token = store.mint();

  assert.equal(store.redeem({ rawToken: "not-the-token" }), false);
  assert.equal(store.redeem({ rawToken: `${token}x` }), false);
  assert.equal(store.redeem({ rawToken: token.slice(0, -1) }), false);
  assert.equal(store.isArmed(), true, "a failed guess must leave the real token usable");
  assert.equal(store.redeem({ rawToken: token }), true);
});

test("two stores never accept each other's tokens", () => {
  const a = createBootSessionTokenStore();
  const b = createBootSessionTokenStore();
  const tokenA = a.mint();
  b.mint();

  assert.equal(b.redeem({ rawToken: tokenA }), false);
  assert.equal(a.redeem({ rawToken: tokenA }), true);
});

test("minting again replaces the previous token rather than accumulating", () => {
  const store = createBootSessionTokenStore();
  const first = store.mint();
  const second = store.mint();

  assert.notEqual(first, second);
  assert.equal(store.redeem({ rawToken: first }), false, "a superseded token must not be redeemable");
  assert.equal(store.redeem({ rawToken: second }), true);
});

test("a short input does not throw — timingSafeEqual would, on unequal lengths", () => {
  const store = createBootSessionTokenStore();
  store.mint();
  assert.doesNotThrow(() => store.redeem({ rawToken: "x" }));
  assert.equal(store.redeem({ rawToken: "x" }), false);
});

test("the production process wrappers share one armed single-use store", () => {
  const token = mintBootSessionToken();
  onTestFinished(() => { redeemBootSessionToken({ rawToken: token }); });
  assert.equal(isBootSessionTokenArmed(), true);
  assert.equal(redeemBootSessionToken({ rawToken: "wrong-token" }), false);
  assert.equal(isBootSessionTokenArmed(), true);
  assert.equal(redeemBootSessionToken({ rawToken: token }), true);
  assert.equal(isBootSessionTokenArmed(), false);
  assert.equal(redeemBootSessionToken({ rawToken: token }), false);
  assert.equal(redeemBootSessionToken({ rawToken: "" }), false);
});

test("an ARMED store refuses empty and non-string tokens without throwing and without burning the real one", () => {
  const store = createBootSessionTokenStore();
  const token = store.mint();
  for (const candidate of ["", 0, 1234, null, undefined, {}, [token], Buffer.from(token), true]) {
    assert.equal(store.redeem({ rawToken: candidate }), false, `armed store accepted ${JSON.stringify(candidate)}`);
  }
  assert.equal(store.isArmed(), true);
  assert.equal(store.redeem({ rawToken: token }), true);
});
