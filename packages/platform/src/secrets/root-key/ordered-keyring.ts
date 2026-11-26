import { dirname } from "node:path";
import { FixedRootKeyKeyring, fingerprintRootKeyHex } from "../keyring.env.js";
import { firstPresentSiteKey, type SiteKeySource, type SiteKeySourceMaterial } from "./material.js";

export function createOrderedSiteKeyring(required: {
  sources: readonly SiteKeySource[]; keyId: string; hkdfSalt: string | Uint8Array;
  env: () => Record<string, string | undefined>;
  readSourceMaterial: (required: { source: SiteKeySource; env: Record<string, string | undefined> }) => SiteKeySourceMaterial | undefined;
  describeSource: (source: SiteKeySource) => string;
  unusableSiteKeyError: (required: { source: SiteKeySource; rejection: { reason: "empty" | "not-hex" | "odd-length" | "too-short"; hexDigits: number } }) => Error;
}, _optional = {}) {
  return {
    activeKey: async (_required = {}, _optional = {}) => ({ keyId: required.keyId }),
    deriveSigningSecret: async (input: { workspaceId: string; subscriptionId: string; version: number }) => { return await resolveKeyring(required).deriveSigningSecret(input); },
    derive: async (input: { workspaceId: string; purpose: string; info: string }) => { return await resolveKeyring(required).derive(input); },
  };
}

/** Ordered site sources are host policy. Reread them for each derive so recovery takes effect
 * immediately; a present invalid source throws before trying any other source.
 * @complexity O(sources), with one small env/file read per attempted source.
 */
function resolveKeyring(required: Parameters<typeof createOrderedSiteKeyring>[0]): FixedRootKeyKeyring {
  // Present-but-invalid wins and throws: falling through could seal data under a different
  // key than the operator configured. Ordered sources are readers only; ensureSiteKey owns minting.
  const present = firstPresentSiteKey({ sources: required.sources, env: required.env(), readSiteKeySourceMaterial: required.readSourceMaterial });
  if (present === undefined) {
    throw new Error(`no site key: none of the configured sources resolved (${required.sources.map(required.describeSource).join(", ")})`);
  }
  if (present.parsed.ok) return new FixedRootKeyKeyring({ hex: present.parsed.hex, hkdfSalt: required.hkdfSalt }, { keyId: required.keyId });
  throw required.unusableSiteKeyError({ source: present.source, rejection: present.parsed });
}

export function isNoSiteKeyError({ error }: { error: unknown }, _optional: Record<string, never> = {}): boolean {
  return error instanceof Error && (error.message === "no site key" || error.message.startsWith("no site key: none of the configured sources resolved ("));
}

export function createExclusiveSiteKeyGenerator(required: {
  fs: Pick<typeof import("node:fs"), "mkdirSync" | "writeFileSync">;
  randomBytes: (size: number) => Buffer; directoryMode: number; fileMode: number;
  alreadyExistsError: (required: { keyFilePath: string }) => Error;
}, _optional = {}) {
  return function generateFileSiteKey({ keyFilePath }: { keyFilePath: string }, _optional = {}) {
    required.fs.mkdirSync(dirname(keyFilePath), { recursive: true, mode: required.directoryMode });
    const generated = required.randomBytes(32);
    const hex = generated.toString("hex");
    required.fs.mkdirSync(dirname(keyFilePath), { recursive: true, mode: required.directoryMode });
    try {
      required.fs.writeFileSync(keyFilePath, hex, { mode: required.fileMode, flag: "wx" });
    } catch (error) {
      if (isAlreadyExistsError({ err: error })) throw required.alreadyExistsError({ keyFilePath });
      throw error;
    }
    return { hex, fingerprint: fingerprintRootKeyHex({ hex }), keyFilePath };
  };
}

/** Whether a failed exclusive create failed BECAUSE the path was taken (`EEXIST`), as opposed to a
 *  genuine I/O or permission fault that must keep propagating. `ELOOP` is the same answer wearing a
 *  different errno: a symlink chain the kernel refused to follow is still "something is there". */
function isAlreadyExistsError({ err }: { err: unknown }, _optional = {}): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "EEXIST" || code === "ELOOP";
}
