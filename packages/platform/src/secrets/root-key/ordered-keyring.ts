import type { KeyringPort } from '@jini-ai/core/contracts/vault';
import { createSiteKeyringErrors } from './site-keyring-errors.js';
import { dirname } from "node:path";
import { FixedRootKeyKeyring, fingerprintRootKeyHex, type parseRootKeyHex, type generateFileRootKey } from "../keyring.env.js";
import { firstPresentSiteKey, inspectSiteKeyMaterial, revealSiteKeyMaterial, type SiteKeySource, type SiteKeySourceMaterial } from "./material.js";

export function createOrderedSiteKeyring(required: {
  sources: readonly SiteKeySource[]; keyId: string; hkdfSalt: string | Uint8Array;
  env: () => Record<string, string | undefined>;
  readSourceMaterial: (required: { source: SiteKeySource; env: Record<string, string | undefined> }) => SiteKeySourceMaterial | undefined;
  describeSource: (source: SiteKeySource) => string;
  unusableSiteKeyError: (required: { source: SiteKeySource; rejection: { reason: "empty" | "not-hex" | "odd-length" | "too-short"; hexDigits: number } }) => Error;
}, optional: { FixedSiteKeyKeyring?: new (required: { hex: string; hkdfSalt: string | Uint8Array }, optional?: { keyId?: string }) => KeyringPort } = {}) {
  return {
    activeKey: async (_required = {}, _optional = {}) => ({ keyId: required.keyId }),
    deriveSigningSecret: async (input: { workspaceId: string; subscriptionId: string; version: number }) => { return await resolveKeyring(required, optional.FixedSiteKeyKeyring ?? FixedRootKeyKeyring).deriveSigningSecret(input); },
    derive: async (input: { workspaceId: string; purpose: string; info: string }) => { return await resolveKeyring(required, optional.FixedSiteKeyKeyring ?? FixedRootKeyKeyring).derive(input); },
  };
}

/** Ordered site sources are host policy. Reread them for each derive so recovery takes effect
 * immediately; a present invalid source throws before trying any other source.
 * @complexity O(sources), with one small env/file read per attempted source.
 */
function resolveKeyring(required: Parameters<typeof createOrderedSiteKeyring>[0], FixedSiteKeyKeyring: new (required: { hex: string; hkdfSalt: string | Uint8Array }, optional?: { keyId?: string }) => KeyringPort): KeyringPort {
  // Present-but-invalid wins and throws: falling through could seal data under a different
  // key than the operator configured. Ordered sources are readers only; ensureSiteKey owns minting.
  const present = firstPresentSiteKey({ sources: required.sources, env: required.env(), readSiteKeySourceMaterial: required.readSourceMaterial });
  if (present === undefined) {
    throw new Error(`no site key: none of the configured sources resolved (${required.sources.map(required.describeSource).join(", ")})`);
  }
  if (present.parsed.ok) return new FixedSiteKeyKeyring({ hex: present.parsed.hex, hkdfSalt: required.hkdfSalt }, { keyId: required.keyId });
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

export function bindSiteKeyrings(required: Omit<Parameters<typeof createOrderedSiteKeyring>[0], 'sources' | 'keyId' | 'unusableSiteKeyError'> & Parameters<typeof createSiteKeyringErrors>[0] & {
  defaultKeyId: string;
  FixedSiteKeyKeyring: new (required: { hex: string; hkdfSalt: string | Uint8Array }, optional?: { keyId?: string }) => KeyringPort;
  InMemoryKeyring: new (required: { hkdfSalt: string | Uint8Array }, optional?: { keyId?: string }) => KeyringPort & { activeKey(): ReturnType<KeyringPort['activeKey']> };
  SiteKeyFileAlreadyExistsError: abstract new (...args: never[]) => Error;
  parseSiteKeyHex: typeof parseRootKeyHex;
  fingerprintSiteKeyHex: typeof fingerprintRootKeyHex;
  generateFileSiteKey: typeof generateFileRootKey;
  prepareDirectory(required: { keyFilePath: string }): void;
  siteKeyFilePathFrom: Parameters<typeof inspectSiteKeyMaterial>[0]['siteKeyFilePathFrom'];
}, _optional = {}) {
  const errors = createSiteKeyringErrors(required);
  const InMemoryKeyring: new (required?: Record<string, never>, optional?: { keyId?: string }) => KeyringPort & { activeKey(): ReturnType<KeyringPort['activeKey']> } = class InMemoryKeyring extends required.InMemoryKeyring {
    constructor(_required: Record<string, never> = {}, optional: { keyId?: string } = {}) { super({ hkdfSalt: required.hkdfSalt }, optional); }
  };
  const FixedSiteKeyKeyring: new (required: { hex: string }, optional?: { keyId?: string }) => KeyringPort & { activeKey(): ReturnType<KeyringPort['activeKey']> } = class FixedSiteKeyKeyring {
    private readonly keyring: KeyringPort;
    constructor({ hex }: { hex: string }, { keyId = required.defaultKeyId }: { keyId?: string } = {}) { this.keyring = new required.FixedSiteKeyKeyring({ hex, hkdfSalt: required.hkdfSalt }, { keyId }); }
    activeKey() { return this.keyring.activeKey({}); }
    deriveSigningSecret(input: Parameters<KeyringPort['deriveSigningSecret']>[0]) { return this.keyring.deriveSigningSecret(input); }
    derive(input: Parameters<KeyringPort['derive']>[0]) { return this.keyring.derive(input); }
  };
  const EnvOrFileKeyring: new (options: { keyId?: string; sources: readonly SiteKeySource[] }, deps?: { env?: () => Record<string, string | undefined> }) => KeyringPort & { activeKey(): ReturnType<KeyringPort['activeKey']> } = class EnvOrFileKeyring {
    private readonly keyring: ReturnType<typeof createOrderedSiteKeyring>;
    constructor(options: { keyId?: string; sources: readonly SiteKeySource[] }, deps: { env?: () => Record<string, string | undefined> } = {}) {
      this.keyring = createOrderedSiteKeyring({ ...required, sources: options.sources, keyId: options.keyId ?? required.defaultKeyId, env: deps.env ?? required.env, unusableSiteKeyError: errors.unusableSiteKeyError }, { FixedSiteKeyKeyring: required.FixedSiteKeyKeyring });
    }
    activeKey() { return this.keyring.activeKey(); }
    async deriveSigningSecret(input: Parameters<KeyringPort['deriveSigningSecret']>[0]) { try { return await this.keyring.deriveSigningSecret(input); } catch (error) { return errors.rethrowKeyringError({ error }); } }
    async derive(input: Parameters<KeyringPort['derive']>[0]) { try { return await this.keyring.derive(input); } catch (error) { return errors.rethrowKeyringError({ error }); } }
  };
  return { InMemoryKeyring, FixedSiteKeyKeyring, EnvOrFileKeyring, UnusableSiteKeyError: errors.UnusableSiteKeyError, SiteKeyFileAlreadyExistsError: errors.SiteKeyFileAlreadyExistsError, isNoSiteKeyError,
    parseSiteKeyHex: required.parseSiteKeyHex, fingerprintSiteKeyHex: required.fingerprintSiteKeyHex,
    inspectSiteKeyMaterial: (options: { sources: readonly SiteKeySource[] }, deps: { env?: () => Record<string, string | undefined> } = {}): ReturnType<typeof inspectSiteKeyMaterial> & { readonly envVarName?: string } => inspectSiteKeyMaterial({ ...required, ...options, env: deps.env ?? required.env, readSiteKeySourceMaterial: required.readSourceMaterial }),
    revealSiteKeyMaterial: (options: { sources: readonly SiteKeySource[] }, deps: { env?: () => Record<string, string | undefined> } = {}): ReturnType<typeof revealSiteKeyMaterial> & { readonly envVarName?: string } => revealSiteKeyMaterial({ ...required, ...options, env: deps.env ?? required.env, readSiteKeySourceMaterial: required.readSourceMaterial }),
    generateFileSiteKey: (options: { keyFilePath: string }, _optional = {}) => {
      required.prepareDirectory(options);
      try { return required.generateFileSiteKey(options); }
      catch (error) {
        if (error instanceof required.SiteKeyFileAlreadyExistsError || isAlreadyExistsError({ err: error })) throw new errors.SiteKeyFileAlreadyExistsError(options);
        throw error;
      }
    },
  };
}
