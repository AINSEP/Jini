import { VaultError, type VaultOptions } from "@jini-ai/core/contracts/vault";

/** Which half of the open-back check refused the fresh seal. */
export type VaultResealRefusalStep = "open-new-envelope" | "plaintext-mismatch";

/** Error names and codes are quoted only when they are plain identifiers; anything else could carry data. */
const PLAIN_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

function plainIdentifier({ value }: { value: unknown }, _options: VaultOptions = {}): string | undefined {
  return typeof value === "string" && PLAIN_IDENTIFIER.test(value) ? value : undefined;
}

function property({ source, key }: { source: unknown; key: string }, _options: VaultOptions = {}): unknown {
  return source !== null && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

const STEP_WORDS: Readonly<Record<VaultResealRefusalStep, string>> = {
  "open-new-envelope": "the newly sealed secret could not be opened again",
  "plaintext-mismatch": "the newly sealed secret opened to a different value",
};

/** A freshly sealed secret failed its open-back check, so nothing was written and the stored secret is
 * exactly as it was. Keeps the fixed public `invalid-record` code and the `VaultError` name, and adds
 * only redacted facts: the failing step, the key generation the seal used, and the name and code of the
 * sealer's own error. It never carries an envelope, a binding string, a plaintext or an error message,
 * and the original error is deliberately NOT kept as `cause` (its message is free text).
 * @example catch (error) { if (error instanceof VaultResealRefusedError) log({ step: error.step, keyId: error.keyId }); }
 */
export class VaultResealRefusedError extends VaultError {
  readonly step: VaultResealRefusalStep;
  readonly keyId: string;
  readonly causeName: string | undefined;
  readonly causeCode: string | undefined;

  constructor({ step, keyId }: { step: VaultResealRefusalStep; keyId: string }, { cause }: { cause?: unknown } = {}) {
    super({ code: "invalid-record" });
    this.step = step;
    this.keyId = keyId;
    this.causeName = plainIdentifier({ value: property({ source: cause, key: "name" }) });
    this.causeCode = plainIdentifier({ value: property({ source: cause, key: "code" }) });
    const facts = [`key ${keyId}`, ...[this.causeName, this.causeCode].filter(part => part !== undefined).map(part => `sealer reported ${part}`)];
    this.message = `Secrets vault: invalid-record: ${STEP_WORDS[step]} (${facts.join("; ")}). Nothing was written: the stored secret was not changed.`;
  }
}
