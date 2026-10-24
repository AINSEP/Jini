import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { providerOk, providerRejected, providerUnknown, type ProviderResult } from "@jini-ai/core/provider-registry";
import type { MailProviderCallContext } from "../provider.js";
import { isDomainReadPermissionRefused, readMailDomain, type MailDomainReadCredentialPort } from "../domain-read.js";

function context(): MailProviderCallContext {
  return Object.freeze({ workspaceId: "ws", mode: "live", credential: Object.freeze({ token: "sending", baseUrl: "https://sending.example" }), httpClient: { send: async () => { throw new Error("no network"); } } });
}

const forbidden = providerRejected({ code: "forbidden", message: "sending access only" });

describe("domain reads", () => {
  test("returns a successful first read without opening the account credential", async () => {
    const ctx = context();
    const answer = providerOk({ value: "verified" });
    let lookups = 0;
    assert.equal(await readMailDomain({ ctx, providerId: "mailer", read: async input => { assert.equal(input, ctx); return answer; }, resolveDomainReadCredential: async () => { lookups++; return { token: "account" }; } }), answer);
    assert.equal(lookups, 0);
    assert.equal(isDomainReadPermissionRefused({ result: answer }), false);
  });

  test("only rejected/forbidden permits an account lookup, ordered after the sending read", async () => {
    const refusals: ProviderResult<string>[] = [
      forbidden,
      providerRejected({ code: "unauthorized", message: "bad key" }),
      providerRejected({ code: "not_found", message: "missing" }),
      providerRejected({ code: "rate_limited", message: "wait" }),
      providerUnknown({ code: "timeout", message: "late" }),
      providerUnknown({ code: "network", message: "offline" }),
    ];
    for (const refusal of refusals) {
      const ctx = context();
      const effects: unknown[] = [];
      const credential = Object.freeze({ token: "account", baseUrl: "https://account.example" });
      const answer = providerOk({ value: "verified" });
      const result = await readMailDomain({ ctx, providerId: "mailer",
        read: async input => { effects.push({ read: input }); return input === ctx ? refusal : answer; },
        resolveDomainReadCredential: async input => { effects.push({ lookup: input }); return credential; },
      });
      const retry = refusal === forbidden;
      assert.equal(isDomainReadPermissionRefused({ result: refusal }), retry);
      assert.equal(result, retry ? answer : refusal);
      assert.deepEqual(effects, retry ? [{ read: ctx }, { lookup: { id: "mailer" } }, { read: { ...ctx, credential } }] : [{ read: ctx }]);
      assert.deepEqual(ctx.credential, { token: "sending", baseUrl: "https://sending.example" });
    }
  });

  test("retains the original refusal when no account port or credential is available", async () => {
    const unavailable: (MailDomainReadCredentialPort | undefined)[] = [undefined, async () => null, async () => { throw new Error("vault unavailable"); }];
    for (const resolveDomainReadCredential of unavailable) {
      let reads = 0;
      assert.equal(await readMailDomain({ ctx: context(), providerId: "mailer", read: async () => { reads++; return forbidden; }, ...(resolveDomainReadCredential ? { resolveDomainReadCredential } : {}) }), forbidden);
      assert.equal(reads, 1);
    }
  });

  test("returns a second refusal unchanged and never retries a third time", async () => {
    let reads = 0;
    let lookups = 0;
    const second = providerRejected({ code: "forbidden", message: "account refused" });
    assert.equal(await readMailDomain({ ctx: context(), providerId: "mailer", read: async () => ++reads === 1 ? forbidden : second, resolveDomainReadCredential: async () => { lookups++; return { token: "account" }; } }), second);
    assert.equal(reads, 2);
    assert.equal(lookups, 1);
  });

  test("propagates a thrown first read without looking up an account key", async () => {
    let lookups = 0;
    await assert.rejects(readMailDomain({ ctx: context(), providerId: "mailer", read: async () => { throw new Error("network timeout"); }, resolveDomainReadCredential: async () => { lookups++; return { token: "account" }; } }), { message: "network timeout" });
    assert.equal(lookups, 0);
  });

  test("propagates a thrown account read after exactly one lookup", async () => {
    let reads = 0;
    let lookups = 0;
    await assert.rejects(readMailDomain({ ctx: context(), providerId: "mailer", read: async () => { if (++reads === 1) return forbidden; throw new Error("account offline"); }, resolveDomainReadCredential: async () => { lookups++; return { token: "account" }; } }), { message: "account offline" });
    assert.equal(reads, 2);
    assert.equal(lookups, 1);
  });
});
