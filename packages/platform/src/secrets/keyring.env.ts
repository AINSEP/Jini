import { defaultPlatformMessages, type PlatformMessages } from "../messages.js";
/** Env/file root-key adapter and uncached inspection helpers. Raw keys never enter sealed records.
 * HKDF salts and source locations belong to the host. File generation refuses existing paths.
 */
import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { KeyringPort } from "./ports.js";

const DERIVED_SECRET_LENGTH_BYTES = 32;
const ROOT_KEY_LENGTH_BYTES = 32;

/** Environment access belongs to the host; the library never reads ambient process state. */
export interface RootKeyEnvironmentPort {
  read(required: { name: string }): string | undefined;
}

/** Host configuration has no implicit env name, file path, permissions, or HKDF salt. */
export interface EnvOrFileKeyringRequired {
  /** Live environment reader; key material is resolved and cached on first derivation. */
  env: RootKeyEnvironmentPort;
  /** Explicit permission to read the configured file when env material is absent. */
  allowFileFallback: boolean;
  /** Explicit permission to create a missing file; fallback must also be enabled. */
  allowFileAutoGenerate: boolean;
  /** Wire constant supplied by the host; changing it changes every derived key. */
  hkdfSalt: string | Uint8Array;
  /** Name of an env var containing at least 32 bytes of hex-encoded key material. */
  envVarName: string;
  /** Explicit path to the file fallback. No runtime-mode or home-directory policy. */
  keyFilePath: string;
}

export interface EnvOrFileKeyringOptions {
  messages?: PlatformMessages;
  /** Root-key generation identity; defaults to "v1". */
  keyId?: string;
}

/** Resolves injected env first, then explicitly permitted files; caches the root per instance.
 * Missing source permissions throw TypeError at construction, before file access.
 * Derivation rejects absent/invalid material; only explicit fallback plus generation writes a file.
 * @complexity Construction is O(1); first derivation parses O(k) key characters and caches them.
 * @example new EnvOrFileKeyring({ env, envVarName, keyFilePath, hkdfSalt, allowFileFallback: false, allowFileAutoGenerate: false })
 */
export class EnvOrFileKeyring implements KeyringPort {
  private readonly messages: PlatformMessages;
  private readonly env: RootKeyEnvironmentPort;
  private readonly envVarName: string;
  private readonly keyFilePath: string;
  private readonly keyId: string;
  private readonly allowFileFallback: boolean;
  private readonly allowFileAutoGenerate: boolean;
  private readonly hkdfSalt: string | Uint8Array;
  private cachedRootKey: Buffer | undefined;

  constructor(required: EnvOrFileKeyringRequired, optional: EnvOrFileKeyringOptions = {}) {
    requireHostOption(required?.envVarName, "envVarName");
    requireHostOption(required?.keyFilePath, "keyFilePath");
    requireHostOption(required?.hkdfSalt, "hkdfSalt");
    if (typeof required.env?.read !== "function") throw new TypeError("env.read is required");
    if (typeof required.allowFileFallback !== "boolean") throw new TypeError("allowFileFallback must be an explicit boolean");
    if (typeof required.allowFileAutoGenerate !== "boolean") throw new TypeError("allowFileAutoGenerate must be an explicit boolean");
    this.messages = optional.messages ?? defaultPlatformMessages;
    this.env = required.env;
    this.hkdfSalt = required.hkdfSalt;
    this.envVarName = required.envVarName;
    this.keyFilePath = required.keyFilePath;
    this.keyId = optional.keyId ?? "v1";
    this.allowFileFallback = required.allowFileFallback;
    this.allowFileAutoGenerate = required.allowFileAutoGenerate;
  }

  async activeKey(_required: Record<string, never>): Promise<{ readonly keyId: string }> {
    return { keyId: this.keyId };
  }

  async deriveSigningSecret(input: {
    workspaceId: string;
    subscriptionId: string;
    version: number;
  }): Promise<Uint8Array> {
    return deriveSigningSecretFromRootKey({ rootKey: this.resolveRootKey(), input, hkdfSalt: this.hkdfSalt });
  }

  async derive(input: { workspaceId: string; purpose: string; info: string }): Promise<Uint8Array> {
    return deriveFromRootKey({ rootKey: this.resolveRootKey(), input, hkdfSalt: this.hkdfSalt });
  }

  private resolveRootKey(): Buffer {
    // Validate env and file through the same parser used by inspection; a status screen and
    // the sealer must never disagree about whether configured material is a usable root key.
    // Buffer.from(raw, 'hex') alone can turn malformed text into empty bytes that HKDF accepts,
    // yielding keys computable from public constants rather than a real root secret.
    if (this.cachedRootKey) return this.cachedRootKey;

    const fromEnv = this.env.read({ name: this.envVarName });
    if (fromEnv) {
      this.cachedRootKey = this.parseEnvRootKey(fromEnv);
      return this.cachedRootKey;
    }

    if (!this.allowFileFallback) {
      throw new Error(
        `no root key: ${this.envVarName} is not set and allowFileFallback is disabled`
      );
    }

    if (existsSync(this.keyFilePath)) {
      this.cachedRootKey = this.parseFileRootKey(readFileSync(this.keyFilePath, "utf8"));
      return this.cachedRootKey;
    }

    if (!this.allowFileAutoGenerate) {
      throw new Error(
        `no root key: ${this.envVarName} is not set, no key file exists at ${this.keyFilePath}, and this instance does not auto-generate one — set the env var, or call generateFileRootKey() explicitly`
      );
    }

    const generated = randomBytes(ROOT_KEY_LENGTH_BYTES);
    mkdirSync(dirname(this.keyFilePath), { recursive: true });
    writeFileSync(this.keyFilePath, generated.toString("hex"), { mode: 0o600 });
    this.cachedRootKey = generated;
    return this.cachedRootKey;
  }

  private parseEnvRootKey(raw: string): Buffer {
    // Legacy env parsing rejected malformed hex but could accept short material: only that
    // rejection needs the warning that existing credentials may already use these bytes.
    const parsed = parseRootKeyHex({ raw });
    if (parsed.ok) return Buffer.from(parsed.hex, "hex");
    throw new UnusableRootKeyError({
      source: "env",
      reason: parsed.reason,
      message: unusableRootKeyMessage({
        messages: this.messages,
        subject: this.envVarName,
        detail: describeRootKeyRejection(parsed),
        sealedWarningSubject: parsed.reason === "too-short" ? "this value" : undefined,
      }),
    });
  }

  private parseFileRootKey(raw: string): Buffer {
    // Legacy file decoding accepted arbitrary content, so every rejected file may have been
    // used to seal data. Never rewrite or repair it here: replacing bytes orphans those rows.
    const parsed = parseRootKeyHex({ raw });
    if (parsed.ok) return Buffer.from(parsed.hex, "hex");
    throw new UnusableRootKeyError({
      source: "file",
      reason: parsed.reason,
      message: unusableRootKeyMessage({
        messages: this.messages,
        subject: `the root key file at ${this.keyFilePath}`,
        detail: describeRootKeyRejection(parsed),
        sealedWarningSubject: "this file",
      }),
    });
  }
}

/** SHA-256 HKDF, 32 bytes, with info `${workspaceId}:${subscriptionId}:v${version}`. */
// Both installed and candidate keyrings use this derivation so checking a candidate tests the
// exact secret that persisted root material would produce, not a parallel approximation.
export function deriveSigningSecretFromRootKey({ rootKey, input, hkdfSalt }: { rootKey: Uint8Array; input: { workspaceId: string; subscriptionId: string; version: number }; hkdfSalt: string | Uint8Array }): Uint8Array {
  const info = `${input.workspaceId}:${input.subscriptionId}:v${input.version}`;
  return new Uint8Array(hkdfSync("sha256", rootKey, hkdfSalt, info, DERIVED_SECRET_LENGTH_BYTES));
}

/** SHA-256 HKDF, 32 bytes, with info `${purpose}:${workspaceId}:${info}`. */
// purpose is part of HKDF info, not display metadata: it separates generic uses from signing secrets.
export function deriveFromRootKey({ rootKey, input, hkdfSalt }: { rootKey: Uint8Array; input: { workspaceId: string; purpose: string; info: string }; hkdfSalt: string | Uint8Array }): Uint8Array {
  const effectiveInfo = `${input.purpose}:${input.workspaceId}:${input.info}`;
  return new Uint8Array(hkdfSync("sha256", rootKey, hkdfSalt, effectiveInfo, DERIVED_SECRET_LENGTH_BYTES));
}

/** Derives from a validated candidate key without reading or writing any host source. */
export class FixedRootKeyKeyring implements KeyringPort {
  private readonly rootKey: Buffer;

  private readonly keyId: string;
  private readonly hkdfSalt: string | Uint8Array;

  constructor(required: { hex: string; hkdfSalt: string | Uint8Array }, optional: { keyId?: string } = {}) {
    requireHostOption(required?.hkdfSalt, "hkdfSalt");
    this.hkdfSalt = required.hkdfSalt;
    this.keyId = optional.keyId ?? "v1";
    const parsed = parseRootKeyHex({ raw: required.hex });
    if (!parsed.ok) throw new Error(`FixedRootKeyKeyring: not a valid root key (${parsed.reason})`);
    this.rootKey = Buffer.from(parsed.hex, "hex");
  }

  async activeKey(_required: Record<string, never>): Promise<{ readonly keyId: string }> {
    return { keyId: this.keyId };
  }

  async deriveSigningSecret(input: { workspaceId: string; subscriptionId: string; version: number }): Promise<Uint8Array> {
    return deriveSigningSecretFromRootKey({ rootKey: this.rootKey, input, hkdfSalt: this.hkdfSalt });
  }

  async derive(input: { workspaceId: string; purpose: string; info: string }): Promise<Uint8Array> {
    return deriveFromRootKey({ rootKey: this.rootKey, input, hkdfSalt: this.hkdfSalt });
  }
}

const HEX_KEY_PATTERN = /^[0-9a-f]+$/i;

export type RootKeyRejection = "empty" | "not-hex" | "odd-length" | "too-short";

export type ParsedRootKeyHex =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly reason: RootKeyRejection; readonly hexDigits: number };

/** Validates trimmed hex of at least 32 bytes without disclosing rejected material. */
export function parseRootKeyHex({ raw }: { raw: string }): ParsedRootKeyHex {
  const hex = raw.trim();
  if (hex.length === 0) return { ok: false, reason: "empty", hexDigits: 0 };
  if (!HEX_KEY_PATTERN.test(hex)) return { ok: false, reason: "not-hex", hexDigits: hex.length };
  if (hex.length % 2 !== 0) return { ok: false, reason: "odd-length", hexDigits: hex.length };
  if (hex.length < ROOT_KEY_LENGTH_BYTES * 2) return { ok: false, reason: "too-short", hexDigits: hex.length };
  return { ok: true, hex };
}

const ROOT_KEY_REJECTION_DETAIL: Record<RootKeyRejection, (hexDigits: number) => string> = {
  empty: () => "it is empty",
  "not-hex": () =>
    'it contains characters that are not hex digits (only 0-9 and a-f are allowed; a "0x" prefix, whitespace inside the value, or a base64 or PEM body all fail this)',
  "odd-length": (hexDigits) =>
    `it has an odd number of hex digits (${hexDigits}), so it does not describe whole bytes — usually a partial write or a truncated copy`,
  "too-short": (hexDigits) =>
    `it is ${hexDigits / 2} bytes (${hexDigits} hex digits); a root key must be at least ${ROOT_KEY_LENGTH_BYTES} bytes (${ROOT_KEY_LENGTH_BYTES * 2} hex digits) — usually a truncated copy`,
};

function describeRootKeyRejection(parsed: { reason: RootKeyRejection; hexDigits: number }): string {
  return ROOT_KEY_REJECTION_DETAIL[parsed.reason](parsed.hexDigits);
}

function unusableRootKeyMessage(input: { subject: string; detail: string; sealedWarningSubject: string | undefined; messages?: PlatformMessages }): string {
  const refusal = `${input.subject} is not usable as a root key: ${input.detail}. The keyring refuses to derive any key material from it rather than sealing under a shortened or empty key.`;
  if (input.sealedWarningSubject === undefined) return refusal;
  return (
    `${refusal} ${(input.messages ?? defaultPlatformMessages).rootKeySealedWarning({ subject: input.sealedWarningSubject })}` +
    `not from a real ${ROOT_KEY_LENGTH_BYTES}-byte key, so those stored credentials are not protected as intended — with empty or very short material the derived key is computable from published constants. ` +
    `Replacing or regenerating the key will NOT restore them; it will make them unreadable. ` +
    `Do not overwrite, delete or regenerate this key until you have decided what to do with the credentials already stored.`
  );
}

export class UnusableRootKeyError extends Error {
  readonly source: "env" | "file";
  readonly reason: RootKeyRejection;

  constructor(input: { source: "env" | "file"; reason: RootKeyRejection; message: string }) {
    super(input.message);
    this.name = "UnusableRootKeyError";
    this.source = input.source;
    this.reason = input.reason;
  }
}

/** SHA-256 of decoded bytes, truncated to 12 hex digits; never a usable secret. */
export function fingerprintRootKeyHex({ hex }: { hex: string }): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex").slice(0, 12);
}

export interface RootKeyStatus {
  readonly active: boolean;
  readonly source: "env" | "file" | "none";
  /** Present only when usable key material exists. */
  readonly fingerprint?: string;
  /** A present source failed validation; this differs from an absent source. */
  readonly invalid?: boolean;
  readonly reason?: RootKeyRejection;
  readonly keyFilePath: string;
}

export interface InspectRootKeyMaterialOptions {
  env: RootKeyEnvironmentPort;
  envVarName: string;
  keyFilePath: string;
}

type ActiveRootKeyMaterial = { source: "env" | "file" | "none"; hex?: string; invalid?: boolean; reason?: RootKeyRejection };

function readActiveRootKeyMaterial(input: {
  env: RootKeyEnvironmentPort;
  envVarName: string;
  keyFilePath: string;
}): ActiveRootKeyMaterial {
  const fromEnv = input.env.read({ name: input.envVarName });
  if (fromEnv) return toActiveRootKeyMaterial("env", fromEnv);
  if (existsSync(input.keyFilePath)) return toActiveRootKeyMaterial("file", readFileSync(input.keyFilePath, "utf8"));
  return { source: "none" };
}

function toActiveRootKeyMaterial(source: "env" | "file", raw: string): ActiveRootKeyMaterial {
  const parsed = parseRootKeyHex({ raw });
  return parsed.ok ? { source, hex: parsed.hex } : { source, invalid: true, reason: parsed.reason };
}

/** Fresh injected env/file status read, without caching, writes or exposing key material.
 * @complexity O(k) time/space for k key characters; at most one file read.
 * @example inspectRootKeyMaterial({ env, envVarName, keyFilePath })
 */
export function inspectRootKeyMaterial(options: InspectRootKeyMaterialOptions): RootKeyStatus {
  const envVarName = options.envVarName;
  const keyFilePath = options.keyFilePath;
  const raw = readActiveRootKeyMaterial({ env: options.env, envVarName, keyFilePath });

  if (raw.hex) return { active: true, source: raw.source, fingerprint: fingerprintRootKeyHex({ hex: raw.hex }), keyFilePath };
  return { active: false, source: raw.source, ...invalidFields(raw), keyFilePath };
}

function invalidFields(raw: ActiveRootKeyMaterial): { invalid?: true; reason?: RootKeyRejection } {
  return raw.invalid ? { invalid: true, reason: raw.reason! } : {};
}

export interface RootKeyReveal extends RootKeyStatus {
  readonly hex?: string;
}

/** Explicit sensitive read through host env/file sources; returns usable key material in the clear.
 * @complexity O(k) time/space for k key characters; at most one file read and no writes.
 * @example revealRootKeyMaterial({ env, envVarName, keyFilePath })
 */
export function revealRootKeyMaterial(options: InspectRootKeyMaterialOptions): RootKeyReveal {
  const envVarName = options.envVarName;
  const keyFilePath = options.keyFilePath;
  const raw = readActiveRootKeyMaterial({ env: options.env, envVarName, keyFilePath });

  if (raw.hex) return { active: true, source: raw.source, hex: raw.hex, fingerprint: fingerprintRootKeyHex({ hex: raw.hex }), keyFilePath };
  return { active: false, source: raw.source, ...invalidFields(raw), keyFilePath };
}

export class RootKeyFileAlreadyExistsError extends Error {
  constructor({ keyFilePath }: { keyFilePath: string }) {
    super(`a root key file already exists at ${keyFilePath} — generate never overwrites an existing key`);
    this.name = "RootKeyFileAlreadyExistsError";
  }
}

export interface GeneratedFileRootKey {
  readonly hex: string;
  readonly fingerprint: string;
  readonly keyFilePath: string;
}

/** Creates a 32-byte root key at mode 0600; throws RootKeyFileAlreadyExistsError on collisions. */
export function generateFileRootKey(options: { keyFilePath: string }): GeneratedFileRootKey {
  const keyFilePath = options.keyFilePath;
  const generated = randomBytes(ROOT_KEY_LENGTH_BYTES);
  const hex = generated.toString("hex");
  mkdirSync(dirname(keyFilePath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(keyFilePath, hex, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (isAlreadyExistsError(err)) throw new RootKeyFileAlreadyExistsError({ keyFilePath });
    throw err;
  }
  return { hex, fingerprint: fingerprintRootKeyHex({ hex }), keyFilePath };
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "EEXIST" || code === "ELOOP";
}

function requireHostOption(value: unknown, name: string): void {
  if (value === undefined || value === null) throw new TypeError(`${name} is required`);
}
