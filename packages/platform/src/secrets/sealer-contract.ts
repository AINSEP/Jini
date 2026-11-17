import type { KeyringPort, SealedSecret, SecretSealerPort } from "@jini-ai/core/contracts/vault";

/** The two rules every sealer binding handed to `SecretsVaultService` must hold. */
export type SecretSealerContractRule = "opens-what-it-seals" | "refuses-another-binding";

export interface SecretSealerContractSubject {
  readonly sealer: SecretSealerPort;
  readonly keyring: Pick<KeyringPort, "activeKey">;
}

const BINDING = 'sealer-contract:v1:["row"]';
const ANOTHER_BINDING = 'sealer-contract:v1:["another row"]';
/** Empty, padded (the value must come back byte for byte), non-ASCII and multi-block payloads. */
const SAMPLES: readonly string[] = ["{}", ' {"padded":true}\n', JSON.stringify({ token: "contract-sample", note: "naïve ✓ 日本" }), JSON.stringify({ blob: "x".repeat(4096) })];

/** What the binding returns for this envelope, or `undefined` when it refuses. A refusal is the measured
 * outcome here, so the sealer's error is the answer rather than something to report. */
async function opened({ sealer, sealed, aad }: { sealer: SecretSealerPort; sealed: SealedSecret; aad: string }, _options: Record<string, never> = {}): Promise<string | undefined> {
  try { return await sealer.open({ sealed }, { aad }); } catch { return undefined; }
}

/** Runs one binding through the sealer contract: `open(seal(x))` returns exactly `x` under the same
 * binding string, and the same envelope is refused under any other binding string. Runner-agnostic so a
 * host can run it in its own test framework against each `{ sealer, keyring }` pair it builds. A binding
 * that seals with one key and opens with another (a key-switch recovery binding) breaks the first rule:
 * give `rotate` a `sourceOpener` instead.
 * @returns The violated rules in a fixed order; empty when the binding holds the contract.
 * @throws Whatever `keyring.activeKey` or `sealer.seal` throws: a binding that cannot seal has no contract to check.
 * @complexity O(total sample bytes): four seals and eight opens.
 * @example assert.deepEqual(await secretSealerContractViolations({ sealer, keyring }), []);
 */
export async function secretSealerContractViolations(
  { sealer, keyring }: SecretSealerContractSubject,
  _options: Record<string, never> = {},
): Promise<SecretSealerContractRule[]> {
  const key = await keyring.activeKey({});
  const violated = new Set<SecretSealerContractRule>();
  for (const plaintext of SAMPLES) {
    const sealed = await sealer.seal({ plaintext, key, aad: BINDING });
    if (await opened({ sealer, sealed, aad: BINDING }) !== plaintext) violated.add("opens-what-it-seals");
    if (await opened({ sealer, sealed, aad: ANOTHER_BINDING }) !== undefined) violated.add("refuses-another-binding");
  }
  return (["opens-what-it-seals", "refuses-another-binding"] as const).filter(rule => violated.has(rule));
}
