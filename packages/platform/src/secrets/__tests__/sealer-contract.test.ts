/** Security review A2-F1: one reusable sealer contract, run against every binding this package hands to
 * `SecretsVaultService`, and shown to report the two ways a binding can break it. */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { KeyringPort, SecretSealerPort } from "@jini-ai/core/contracts/vault";
import { AesGcmSecretSealer } from "../secret-sealer.aesgcm.js";
import { FixedRootKeyKeyring } from "../keyring.env.js";
import { InMemoryKeyring } from "../keyring.memory.js";
import { secretSealerContractViolations } from "../sealer-contract.js";
import * as testing from "../testing.js";

function keyed(keyId: string): { keyring: KeyringPort; sealer: SecretSealerPort } {
  const keyring = new InMemoryKeyring({ hkdfSalt: "sealer-contract" }, { keyId });
  return { keyring, sealer: new AesGcmSecretSealer({ keyring }) };
}

const bindings: readonly { name: string; build: () => { keyring: KeyringPort; sealer: SecretSealerPort } }[] = [
  { name: "AES-GCM over an in-memory keyring", build: () => keyed("memory") },
  { name: "AES-GCM over a fixed root key", build: () => {
    const keyring = new FixedRootKeyKeyring({ hex: "11".repeat(32), hkdfSalt: "sealer-contract" });
    return { keyring, sealer: new AesGcmSecretSealer({ keyring }) };
  } },
];

test.each(bindings)("$name opens what it seals and refuses another binding", async ({ build }) => {
  assert.deepEqual(await secretSealerContractViolations(build()), []);
});

test("a binding that seals with one key and opens with another breaks the contract", async () => {
  const previous = keyed("previous"), current = keyed("current");
  const split: SecretSealerPort = { seal: value => current.sealer.seal(value), open: (required, optional) => previous.sealer.open(required, optional) };
  assert.deepEqual(await secretSealerContractViolations({ sealer: split, keyring: current.keyring }), ["opens-what-it-seals"]);
});

test("a binding that returns a different value breaks the contract", async () => {
  const real = keyed("current");
  const lossy: SecretSealerPort = { seal: value => real.sealer.seal(value), open: async (required, optional) => (await real.sealer.open(required, optional)).trim() };
  assert.deepEqual(await secretSealerContractViolations({ sealer: lossy, keyring: real.keyring }), ["opens-what-it-seals"]);
});

test("a binding that opens an envelope under another binding string breaks the contract", async () => {
  const sealed = new Map<string, string>();
  // A fake of the port that ignores the binding on open: nothing ties the envelope to its row.
  const unbound: SecretSealerPort = {
    seal: async ({ plaintext, key }) => {
      const nonce = String(sealed.size);
      sealed.set(nonce, plaintext);
      return { keyId: key.keyId, nonce, ciphertext: "opaque", alg: "aes-256-gcm" };
    },
    open: async ({ sealed: envelope }) => sealed.get(envelope.nonce)!,
  };
  assert.deepEqual(await secretSealerContractViolations({ sealer: unbound, keyring: { activeKey: async () => ({ keyId: "fake" }) } }), ["refuses-another-binding"]);
});

test("hosts reach the contract through the testing subpath", () => {
  assert.equal(testing.secretSealerContractViolations, secretSealerContractViolations);
});
