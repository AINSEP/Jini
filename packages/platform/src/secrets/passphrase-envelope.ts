import { randomBytes, scrypt } from "node:crypto";

import { FixedRootKeyKeyring } from "./keyring.env.js";
import { AesGcmSecretSealer } from "./secret-sealer.aesgcm.js";
import type { SealedSecret } from "./types.js";

const FORMAT = "jini-passphrase-envelope";
const HKDF_SALT = "jini-passphrase-envelope-v1";
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 24 * 1024 * 1024;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;

interface ScryptHeader {
  name: "scrypt";
  salt: string;
  N: number;
  r: number;
  p: number;
}

interface Envelope {
  header: { format: typeof FORMAT; version: 1; kdf: ScryptHeader };
  sealed: SealedSecret;
}

/** Optional randomness port for reproducible wire fixtures; production uses Node's CSPRNG. */
export interface PassphraseEnvelopeOptions {
  randomBytesFn?: (input: { byteLength: number }) => Uint8Array;
}

/** Encrypts a UTF-8 payload (up to 16 MiB) into portable JSON, without host key material.
 * Uses asynchronous scrypt and the existing sealer; performs no filesystem or environment I/O.
 * Rejects invalid inputs or randomness. Passphrases are not normalized; only an empty one is refused,
 * because sealing under "" turns the export into obfuscation (strength policy stays with the host).
 * @complexity O(n + N*r*p) time and O(n + N*r) space for n payload bytes and bounded KDF costs.
 */
export async function sealWithPassphrase(
  { payload, passphrase }: { payload: string; passphrase: string },
  options: PassphraseEnvelopeOptions = {},
): Promise<string> {
  assertText(payload, MAX_PAYLOAD_BYTES);
  assertText(passphrase, MAX_PAYLOAD_BYTES);
  if (passphrase === "") throw new TypeError("Passphrase envelope: passphrase must not be empty");
  const randomBytesFn = options.randomBytesFn ?? (({ byteLength }) => randomBytes(byteLength));
  const salt = Buffer.from(randomBytesFn({ byteLength: 16 }));
  if (salt.length !== 16) throw new TypeError("Passphrase envelope: salt must contain exactly 16 bytes");
  const header: Envelope["header"] = {
    format: FORMAT, version: 1,
    kdf: { name: "scrypt", salt: salt.toString("hex"), N: 32768, r: 8, p: 1 },
  };
  const keyring = await deriveKeyring({ passphrase, kdf: header.kdf });
  const sealer = new AesGcmSecretSealer({ keyring }, { randomBytesFn });
  const sealed = await sealer.seal({
    plaintext: payload, key: await keyring.activeKey({}), aad: JSON.stringify(header),
  });
  return JSON.stringify({ header, sealed });
}

/** Authenticates a portable JSON envelope before returning its exact UTF-8 payload.
 * Rejects malformed/oversized envelopes and unsupported KDF costs before deriving a key.
 * Wrong passphrases and modified ciphertext/header reject without returning partial plaintext.
 * @complexity O(n + N*r*p) time and O(n + N*r) space with fixed size and KDF ceilings.
 */
export async function openWithPassphrase(
  { envelope, passphrase }: { envelope: string; passphrase: string },
  _options: Record<string, never> = {},
): Promise<string> {
  assertText(passphrase, MAX_PAYLOAD_BYTES);
  const parsed = parseEnvelope({ envelope });
  const keyring = await deriveKeyring({ passphrase, kdf: parsed.header.kdf });
  const sealer = new AesGcmSecretSealer({ keyring });
  try {
    return await sealer.open({ sealed: parsed.sealed }, { aad: JSON.stringify(parsed.header) });
  } catch {
    // Never include the passphrase, payload, or crypto-library error context in recovery errors.
    throw new Error("Passphrase envelope: authentication failed");
  }
}

/** The format fixes r/p and accepts only bounded power-of-two N costs, preventing KDF DoS.
 * The full header is AAD, including additional fields, so metadata cannot be silently modified.
 */
function parseEnvelope({ envelope }: { envelope: string }): Envelope {
  assertText(envelope, MAX_ENVELOPE_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new TypeError("Passphrase envelope: invalid JSON");
  }
  if (!isRecord(parsed) || !isRecord(parsed.header)) throw invalidEnvelope();
  if (parsed.header.format !== FORMAT || parsed.header.version !== 1) throw invalidEnvelope();
  assertKdf(parsed.header.kdf);
  assertSealed(parsed.sealed);
  return parsed as unknown as Envelope;
}

function assertKdf(kdf: unknown): void {
  if (!isRecord(kdf)) throw invalidEnvelope();
  if (kdf.name !== "scrypt" || typeof kdf.salt !== "string") throw invalidEnvelope();
  if (!/^[a-f0-9]{32}$/i.test(kdf.salt)) throw invalidEnvelope();
  if (![16384, 32768, 65536].includes(kdf.N as number) || kdf.r !== 8 || kdf.p !== 1) {
    throw invalidEnvelope();
  }
}

function assertSealed(sealed: unknown): void {
  if (!isRecord(sealed)) throw invalidEnvelope();
  if (sealed.alg !== "aes-256-gcm" || sealed.keyId !== "v1") throw invalidEnvelope();
  assertBase64(sealed.nonce, 12, 12);
  assertBase64(sealed.ciphertext, 16, MAX_PAYLOAD_BYTES + 16);
}

function assertBase64(value: unknown, minBytes: number, maxBytes: number): void {
  if (typeof value !== "string") throw invalidEnvelope();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString("base64") !== value) {
    throw invalidEnvelope();
  }
}

function assertText(value: unknown, maxBytes: number): asserts value is string {
  if (typeof value !== "string") throw new TypeError("Passphrase envelope: expected a string");
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new RangeError("Passphrase envelope: size limit exceeded");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidEnvelope(): TypeError {
  return new TypeError("Passphrase envelope: invalid or unsupported envelope");
}

/** scrypt supplies only a temporary root; the existing keyring owns HKDF domain separation. */
async function deriveKeyring({ passphrase, kdf }: { passphrase: string; kdf: ScryptHeader }): Promise<FixedRootKeyKeyring> {
  const root = await new Promise<Buffer>((resolve, reject) => {
    scrypt(passphrase, Buffer.from(kdf.salt, "hex"), 32,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: SCRYPT_MAX_MEMORY },
      (error, key) => error ? reject(error) : resolve(key));
  });
  try {
    return new FixedRootKeyKeyring({ hex: root.toString("hex"), hkdfSalt: HKDF_SALT });
  } finally {
    // The keyring copies the derived bytes; do not retain the temporary scrypt buffer as well.
    root.fill(0);
  }
}
