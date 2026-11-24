import { randomBytes } from "node:crypto";
import { FixedRootKeyKeyring } from "./keyring.env.js";

/** An in-memory `KeyringPort` test/dev double: real HKDF over an ephemeral 32-byte key, with no
 * environment or filesystem resolution. One random root key is generated per instance and held only in
 * memory, so a hermetic composition (every route test) exercises the real signer/HKDF derivation path
 * without reading an env var or touching the filesystem the way the env/file keyring does. */
export class InMemoryKeyring extends FixedRootKeyKeyring {
  constructor(required: { hkdfSalt: string | Uint8Array }, optional: { keyId?: string } = {}) {
    super({ hex: randomBytes(32).toString("hex"), hkdfSalt: required.hkdfSalt }, optional);
  }
}
