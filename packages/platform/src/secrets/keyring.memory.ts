import { randomBytes } from "node:crypto";
import { FixedRootKeyKeyring } from "./keyring.env.js";

/** Real HKDF over an ephemeral 32-byte key, with no environment or filesystem resolution. */
export class InMemoryKeyring extends FixedRootKeyKeyring {
  constructor(required: { hkdfSalt: string | Uint8Array }, optional: { keyId?: string } = {}) {
    super({ hex: randomBytes(32).toString("hex"), hkdfSalt: required.hkdfSalt }, optional);
  }
}
