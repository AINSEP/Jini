import { hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import {
  PUBLISH_PRINCIPAL_ID_PREFIX,
  deriveInstallationId,
  derivePublishSigningKey,
  publishPrincipalIdFor,
  verifyPublishSignature,
} from "../keys.js";

/** One recorded `derive` request. */
interface RecordedDerive {
  readonly workspaceId: string;
  readonly purpose: string;
  readonly info: string;
}

/**
 * A faithful keyring double: HKDF-SHA256, 32 bytes, with `purpose`, workspace and `info` all bound
 * into the HKDF info string over a fixed site key. A double that ignored one of those inputs would
 * let a domain-separation bug pass here and fail in production. `activeKey` and
 * `deriveSigningSecret` throw: the trust code must only ever call `derive`.
 */
function fixedKeyring(siteKeyHex: string): { keyring: KeyringPort; derives: RecordedDerive[] } {
  const siteKey = Buffer.from(siteKeyHex, "hex");
  const derives: RecordedDerive[] = [];
  const keyring: KeyringPort = {
    activeKey: async () => {
      throw new Error("the publishing trust code must not ask for the active key");
    },
    deriveSigningSecret: async () => {
      throw new Error("the publishing trust code must not derive a webhook signing secret");
    },
    derive: async (input) => {
      derives.push({ workspaceId: input.workspaceId, purpose: input.purpose, info: input.info });
      const info = `${input.purpose}:${input.workspaceId}:${input.info}`;
      return new Uint8Array(hkdfSync("sha256", siteKey, Buffer.alloc(0), info, 32));
    },
  };
  return { keyring, derives };
}

const SITE_KEY_HEX = "0b".repeat(32);
const WORKSPACE = "ws-pin";
const TARGET_ORIGIN = "https://dest.example";

/** The installation id the fixed keyring gives `WORKSPACE`. 16 bytes, base64url. Derived values are
 *  identity: a changed purpose string silently re-identifies every install, so only a byte pin sees it. */
const PINNED_INSTALLATION_ID = "M1tMc8XzZE7tdgMu70hQZQ";
/** The Ed25519 public key for (`PINNED_INSTALLATION_ID`, `TARGET_ORIGIN`, generation 1). */
const PINNED_PUBLIC_KEY = "xhb7t91QM_vTtKjYYLw1qvL6UTcuQwqTwISAkDqAFYI";
/** Ed25519 is deterministic, so the signature over the message "m" is a fixed value too. */
const PINNED_SIGNATURE = "pAnk_cEL2FbOcY3I7P0U0pdM27u144pQkvwL6F_gXfch8dchcj2iapfpAeRxq7AoXdR6xwdJkqSwBza1wBnKDQ";

function signingKeyFor(overrides: { targetOrigin?: string; generation?: number; workspaceId?: string } = {}) {
  const { keyring, derives } = fixedKeyring(SITE_KEY_HEX);
  return derivePublishSigningKey({
    keyring,
    workspaceId: overrides.workspaceId ?? WORKSPACE,
    sourceInstallationId: PINNED_INSTALLATION_ID,
    targetOrigin: overrides.targetOrigin ?? TARGET_ORIGIN,
    generation: overrides.generation ?? 1,
  }).then((key) => ({ key, derives }));
}

describe("publishing trust key derivation", () => {
  it("derives the installation id as the pinned 16-byte value, bound to its HKDF purpose", async () => {
    const { keyring, derives } = fixedKeyring(SITE_KEY_HEX);

    const id = await deriveInstallationId({ keyring, workspaceId: WORKSPACE });

    expect(id).toBe(PINNED_INSTALLATION_ID);
    expect(Buffer.from(id, "base64url")).toHaveLength(16);
    expect(derives).toEqual([{ workspaceId: WORKSPACE, purpose: "publish-trust-installation-id", info: "self" }]);
  });

  it("gives another workspace on the same site key another installation id", async () => {
    const { keyring } = fixedKeyring(SITE_KEY_HEX);

    expect(await deriveInstallationId({ keyring, workspaceId: "ws-other" })).not.toBe(PINNED_INSTALLATION_ID);
  });

  it("derives the pinned signing public key and signature, with the origin and generation in the HKDF info", async () => {
    const { key, derives } = await signingKeyFor();

    expect(key.publicKeyB64u).toBe(PINNED_PUBLIC_KEY);
    expect(key.generation).toBe(1);
    expect(key.sign({ message: "m" })).toBe(PINNED_SIGNATURE);
    expect(derives).toEqual([
      { workspaceId: WORKSPACE, purpose: "publish-trust-signing-key", info: `${PINNED_INSTALLATION_ID}:${TARGET_ORIGIN}:v1` },
    ]);
  });

  it("gives each target origin, generation and workspace its own key", async () => {
    const base = (await signingKeyFor()).key.publicKeyB64u;

    expect((await signingKeyFor({ targetOrigin: "https://other.example" })).key.publicKeyB64u).not.toBe(base);
    expect((await signingKeyFor({ generation: 2 })).key.publicKeyB64u).not.toBe(base);
    expect((await signingKeyFor({ workspaceId: "ws-other" })).key.publicKeyB64u).not.toBe(base);
  });

  it("prefixes the stable publishing principal id", () => {
    expect(PUBLISH_PRINCIPAL_ID_PREFIX).toBe("pub:");
    expect(publishPrincipalIdFor({ sourceInstallationId: "abc" })).toBe("pub:abc");
  });
});

describe("verifyPublishSignature", () => {
  it("accepts a genuine signature and refuses another message", async () => {
    const { key } = await signingKeyFor();
    const signatureB64u = key.sign({ message: "hello" });

    expect(verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "hello", signatureB64u })).toBe(true);
    expect(verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "other", signatureB64u })).toBe(false);
  });

  it("refuses a signature made for another target origin", async () => {
    const { key } = await signingKeyFor();
    const other = (await signingKeyFor({ targetOrigin: "https://other.example" })).key;

    expect(
      verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "m", signatureB64u: other.sign({ message: "m" }) }),
    ).toBe(false);
  });

  it("refuses malformed key or signature material before the injected crypto effect runs", async () => {
    const { key } = await signingKeyFor();
    const signatureB64u = key.sign({ message: "m" });
    let effectCalls = 0;
    const optional = { verifyDecoded: () => { effectCalls += 1; return true; } };

    for (const badKey of ["", "not-base64url-!!!", key.publicKeyB64u.slice(0, 10)]) {
      expect(verifyPublishSignature({ publicKeyB64u: badKey, message: "m", signatureB64u }, optional)).toBe(false);
    }
    for (const badSignature of ["", "not-base64url-!!!", signatureB64u.slice(0, 10)]) {
      expect(verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "m", signatureB64u: badSignature }, optional)).toBe(false);
    }
    expect(effectCalls).toBe(0);

    expect(verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "m", signatureB64u }, optional)).toBe(true);
    expect(effectCalls).toBe(1);
  });

  it("fails closed when the crypto effect throws on well-formed material", async () => {
    const { key } = await signingKeyFor();
    const optional = { verifyDecoded: () => { throw new Error("provider failure"); } };

    expect(
      verifyPublishSignature({ publicKeyB64u: key.publicKeyB64u, message: "m", signatureB64u: key.sign({ message: "m" }) }, optional),
    ).toBe(false);
  });
});
