/** Security review A2: every fresh seal is opened again before it is written, a key switch reads the
 * stored row through an explicit source opener, and a refusal says which step failed without leaking. */
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { SecretsVaultService, InMemoryVaultRepo, VaultResealRefusedError, buildVaultAad, createVaultMetaParsers,
  type VaultPutInput } from "../credential-sets/index.js";
import { VaultError, type KeyringPort, type SecretSealerPort, type VaultIdentity, type VaultRepoPort } from "@jini-ai/core/contracts/vault";

const context: VaultIdentity = { workspaceId: "ws", id: "a", kind: "site-assistant", ownerKey: "assistant", principalId: null, binding: null };
const secret = "abcdefghijkl";
const input: VaultPutInput = { ...context, expectedRevision: null, provider: "example", label: "Main",
  meta: { model: "model-1", baseUrl: null }, payload: { token: secret }, hintToken: secret };

function keyed(keyId: string) {
  const keyring = new InMemoryKeyring({ hkdfSalt: "reseal-tests" }, { keyId });
  return { keyring, sealer: new AesGcmSecretSealer({ keyring }) };
}
function serviceOver({ repo, keyring, sealer }: { repo: VaultRepoPort; keyring: KeyringPort; sealer: SecretSealerPort }) {
  return new SecretsVaultService({ repo, keyring, sealer, metaParsers: createVaultMetaParsers({}), authorize: async () => {},
    now: () => "2026-11-16T00:00:00.000Z", newId: () => "generated" });
}
/** One row sealed under the previous key, and a service bound to the current key over the same store. */
async function switchedKeys() {
  const repo = new InMemoryVaultRepo({});
  const previous = keyed("previous"), current = keyed("current");
  await serviceOver({ repo, ...previous }).put(input);
  return { repo, previous, current, service: serviceOver({ repo, ...current }), before: (await repo.find(context))! };
}
/** Everything a refusal must never carry: the plaintext, either envelope's bytes, and the binding string. */
function assertRedacted(error: VaultResealRefusedError, forbidden: readonly (string | undefined)[]): void {
  const rendered = [error.message, String(error.stack), JSON.stringify(error), JSON.stringify({ ...error })].join("\n");
  for (const value of [secret, buildVaultAad(context), ...forbidden]) if (value) assert.equal(rendered.includes(value), false, `refusal leaked ${value.slice(0, 8)}…`);
}

test("rotation with a source opener moves a row sealed under the previous key onto the current key", async () => {
  const { repo, previous, current, service, before } = await switchedKeys();
  const rotated = await service.rotate({ ...context, expectedRevision: 1 }, { sourceOpener: previous.sealer });
  assert.equal(rotated.revision, 2);
  const after = (await repo.find(context))!;
  assert.equal(after.sealed?.keyId, "current");
  assert.notEqual(after.sealed?.ciphertext, before.sealed?.ciphertext);
  assert.equal(await current.sealer.open({ sealed: after.sealed! }, { aad: buildVaultAad(context) }), JSON.stringify(input.payload));
  await assert.rejects(previous.sealer.open({ sealed: after.sealed! }, { aad: buildVaultAad(context) }));
  assert.deepEqual((await service.get(context))?.payload, input.payload);
});

test("the source opener only reads the stored row; the new envelope is verified by the service's own sealer", async () => {
  const { previous, current, service, before } = await switchedKeys();
  const sourceOpen = vi.fn((required: Parameters<SecretSealerPort["open"]>[0], optional?: Parameters<SecretSealerPort["open"]>[1]) => previous.sealer.open(required, optional));
  const ownOpen = vi.spyOn(current.sealer, "open");
  await service.rotate({ ...context, expectedRevision: 1 }, { sourceOpener: { open: sourceOpen } });
  assert.deepEqual(sourceOpen.mock.calls.map(([required]) => required.sealed), [before.sealed]);
  assert.equal(ownOpen.mock.calls.length, 1);
  assert.equal(ownOpen.mock.calls[0]![0].sealed.keyId, "current");
});

test("without a source opener a row sealed under another key is not rotated and stays untouched", async () => {
  const { repo, service, before } = await switchedKeys();
  await assert.rejects(service.rotate({ ...context, expectedRevision: 1 }));
  assert.deepEqual(await repo.find(context), before);
});

test("a sealer bound to open with the previous key is still refused: the fresh seal must open under the service's own sealer", async () => {
  const { repo, previous, current, before } = await switchedKeys();
  const split = serviceOver({ repo, keyring: current.keyring, sealer: { seal: value => current.sealer.seal(value), open: (required, optional) => previous.sealer.open(required, optional) } });
  await assert.rejects(split.rotate({ ...context, expectedRevision: 1 }), (error: unknown) =>
    error instanceof VaultResealRefusedError && error.code === "invalid-record" && error.step === "open-new-envelope");
  assert.deepEqual(await repo.find(context), before);
});

test("a refused re-seal names the failing step, the active key and a redacted cause, and says nothing was changed", async () => {
  const repo = new InMemoryVaultRepo({});
  const current = keyed("current");
  const service = serviceOver({ repo, ...current });
  await service.put(input);
  const before = (await repo.find(context))!;
  const seal = current.sealer.seal.bind(current.sealer);
  let fresh: Awaited<ReturnType<SecretSealerPort["seal"]>> | undefined;
  vi.spyOn(current.sealer, "seal").mockImplementationOnce(async value => (fresh = await seal({ ...value, aad: buildVaultAad({ ...context, id: "other" }) })));
  const unopenable = await service.rotate({ ...context, expectedRevision: 1 }).then(() => null, (error: unknown) => error);
  assert.ok(unopenable instanceof VaultResealRefusedError && unopenable instanceof VaultError);
  assert.equal(unopenable.code, "invalid-record");
  assert.equal(unopenable.name, "VaultError");
  assert.equal(unopenable.step, "open-new-envelope");
  assert.equal(unopenable.keyId, "current");
  assert.equal(typeof unopenable.causeName, "string");
  assert.match(unopenable.message, /could not be opened again/);
  assert.match(unopenable.message, /stored secret was not changed/);
  assertRedacted(unopenable, [fresh?.ciphertext, fresh?.nonce, before.sealed?.ciphertext]);
  vi.spyOn(current.sealer, "seal").mockImplementationOnce(async value => (fresh = await seal({ ...value, plaintext: JSON.stringify({ token: "swapped-value" }) })));
  const different = await service.rotate({ ...context, expectedRevision: 1 }).then(() => null, (error: unknown) => error);
  assert.ok(different instanceof VaultResealRefusedError);
  assert.equal(different.step, "plaintext-mismatch");
  assert.equal(different.causeName, undefined);
  assert.match(different.message, /opened to a different value/);
  assert.match(different.message, /stored secret was not changed/);
  assertRedacted(different, [fresh?.ciphertext, "swapped-value"]);
  assert.deepEqual(await repo.find(context), before);
});

test("a key store failure while opening the new envelope is reported by name and code only", async () => {
  const repo = new InMemoryVaultRepo({});
  const current = keyed("current");
  const service = serviceOver({ repo, ...current });
  await service.put(input);
  const before = (await repo.find(context))!;
  const open = current.sealer.open.bind(current.sealer);
  // The stored row opens; the key store then fails on the fresh envelope with a message that quotes a secret.
  vi.spyOn(current.sealer, "open").mockImplementation(async (required, optional) => {
    if (required.sealed.ciphertext === before.sealed!.ciphertext) return open(required, optional);
    throw Object.assign(new Error(`key store offline while reading ${secret}`), { name: "KeyStoreUnavailable", code: "EKEYSTORE" });
  });
  const refusal = await service.rotate({ ...context, expectedRevision: 1 }).then(() => null, (error: unknown) => error);
  assert.ok(refusal instanceof VaultResealRefusedError);
  assert.deepEqual([refusal.step, refusal.keyId, refusal.causeName, refusal.causeCode], ["open-new-envelope", "current", "KeyStoreUnavailable", "EKEYSTORE"]);
  assertRedacted(refusal, [before.sealed?.ciphertext]);
  assert.deepEqual(await repo.find(context), before);
});

test("an active key the opener does not know refuses the rotation and names that key", async () => {
  const repo = new InMemoryVaultRepo({});
  const current = keyed("current");
  await serviceOver({ repo, ...current }).put(input);
  const before = (await repo.find(context))!;
  // Fakes of both ports: the keyring announces a generation the sealer can seal under but cannot open.
  const keyring: KeyringPort = { ...current.keyring, activeKey: async () => ({ keyId: "not-yet-readable" }),
    derive: value => current.keyring.derive(value), deriveSigningSecret: value => current.keyring.deriveSigningSecret(value) };
  const sealer: SecretSealerPort = { seal: async value => ({ ...(await current.sealer.seal({ ...value, key: { keyId: "current" } })), keyId: value.key.keyId }),
    open: async (required, optional) => {
      if (required.sealed.keyId !== "current") throw Object.assign(new Error("unknown key generation"), { name: "UnknownKeyGeneration" });
      return current.sealer.open(required, optional);
    } };
  const refusal = await serviceOver({ repo, keyring, sealer }).rotate({ ...context, expectedRevision: 1 }).then(() => null, (error: unknown) => error);
  assert.ok(refusal instanceof VaultResealRefusedError);
  assert.deepEqual([refusal.step, refusal.keyId, refusal.causeName, refusal.causeCode], ["open-new-envelope", "not-yet-readable", "UnknownKeyGeneration", undefined]);
  assert.deepEqual(await repo.find(context), before);
});

test("a cause whose name or code is not a plain identifier is dropped rather than quoted", async () => {
  const repo = new InMemoryVaultRepo({});
  const current = keyed("current");
  const service = serviceOver({ repo, ...current });
  await service.put(input);
  const before = (await repo.find(context))!;
  const open = current.sealer.open.bind(current.sealer);
  vi.spyOn(current.sealer, "open").mockImplementation(async (required, optional) => {
    if (required.sealed.ciphertext === before.sealed!.ciphertext) return open(required, optional);
    throw Object.assign(new Error("boom"), { name: `leak ${secret}`, code: { nested: secret } });
  });
  const refusal = await service.rotate({ ...context, expectedRevision: 1 }).then(() => null, (error: unknown) => error);
  assert.ok(refusal instanceof VaultResealRefusedError);
  assert.deepEqual([refusal.causeName, refusal.causeCode], [undefined, undefined]);
  assertRedacted(refusal, []);
});

test("a put whose fresh seal does not open is refused and nothing is written", async () => {
  const repo = new InMemoryVaultRepo({});
  const current = keyed("current");
  const service = serviceOver({ repo, ...current });
  const seal = current.sealer.seal.bind(current.sealer);
  vi.spyOn(current.sealer, "seal").mockImplementationOnce(async value => seal({ ...value, aad: buildVaultAad({ ...context, id: "other" }) }));
  await assert.rejects(service.put(input), (error: unknown) => error instanceof VaultResealRefusedError && error.step === "open-new-envelope");
  assert.equal(await repo.find(context), null);
});

test("copy with overwrite leaves the target row untouched when the fresh seal does not open", async () => {
  const site = (workspaceId: string) => {
    const repo = new InMemoryVaultRepo({});
    const key = keyed(workspaceId);
    const siteContext = { workspaceId, kind: "vendor" as const, ownerKey: "feature", principalId: null, binding: null };
    return { repo, ...key, service: serviceOver({ repo, ...key }), siteContext, put: { ...siteContext, id: "same-id", provider: "host", label: "Main",
      meta: { credentialType: "vendor", worksFor: ["host"] }, payload: { token: secret }, hintToken: secret, expectedRevision: null } satisfies VaultPutInput };
  };
  const source = site("source"), target = site("target");
  await source.service.put(source.put);
  await target.service.put({ ...target.put, payload: { token: "target-value-123" } });
  const before = (await target.repo.find({ workspaceId: "target", id: "same-id" }))!;
  const seal = target.sealer.seal.bind(target.sealer);
  vi.spyOn(target.sealer, "seal").mockImplementationOnce(async value => seal({ ...value, plaintext: JSON.stringify({ token: "swapped-value" }) }));
  const copied = await target.service.copyToSite({ source: source.service, sourceContext: source.siteContext, targetContext: target.siteContext, ids: ["same-id"], overwrite: true });
  assert.deepEqual(copied, [{ kind: "vendor", id: "same-id", status: "failed", reasonCode: "invalid-record" }]);
  assert.deepEqual(await target.repo.find({ workspaceId: "target", id: "same-id" }), before);
});
