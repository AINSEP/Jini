export type { SealedSecret } from "./types.js";
export type { KeyringPort, SecretSealerPort } from "./ports.js";
export { AesGcmSecretSealer } from "./secret-sealer.aesgcm.js";
export { EnvOrFileKeyring } from "./keyring.env.js";
export type { EnvOrFileKeyringRequired, EnvOrFileKeyringOptions } from "./keyring.env.js";

// Canonical public names; the implementation bindings retain compatibility for direct consumers.
export type { RootKeyHandle as SiteKeyHandle } from "./ports.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { FixedRootKeyKeyring as FixedSiteKeyKeyring } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { UnusableRootKeyError as UnusableSiteKeyError } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { RootKeyFileAlreadyExistsError as SiteKeyFileAlreadyExistsError } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { parseRootKeyHex as parseSiteKeyHex } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { fingerprintRootKeyHex as fingerprintSiteKeyHex } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { inspectRootKeyMaterial as inspectSiteKeyMaterial } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { revealRootKeyMaterial as revealSiteKeyMaterial } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { generateFileRootKey as generateFileSiteKey } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { deriveFromRootKey as deriveFromSiteKey } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export { deriveSigningSecretFromRootKey as deriveSigningSecretFromSiteKey } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { RootKeyEnvironmentPort as SiteKeyEnvironmentPort } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { RootKeyRejection as SiteKeyRejection } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { ParsedRootKeyHex as ParsedSiteKeyHex } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { RootKeyStatus as SiteKeyStatus } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { RootKeyReveal as SiteKeyReveal } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { InspectRootKeyMaterialOptions as InspectSiteKeyMaterialOptions } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01
export type { GeneratedFileRootKey as GeneratedFileSiteKey } from "./keyring.env.js"; // site-key-legacy: implementation binding; remove on/after 2026-11-01

// Temporary aliases preserve imports and constructor/function identity across the rename.
/** @deprecated use SiteKeyHandle */
export type { RootKeyHandle } from "./ports.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use FixedSiteKeyKeyring */
export { FixedRootKeyKeyring } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use UnusableSiteKeyError */
export { UnusableRootKeyError } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use SiteKeyFileAlreadyExistsError */
export { RootKeyFileAlreadyExistsError } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use parseSiteKeyHex */
export { parseRootKeyHex } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use fingerprintSiteKeyHex */
export { fingerprintRootKeyHex } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use inspectSiteKeyMaterial */
export { inspectRootKeyMaterial } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use revealSiteKeyMaterial */
export { revealRootKeyMaterial } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use generateFileSiteKey */
export { generateFileRootKey } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use deriveFromSiteKey */
export { deriveFromRootKey } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use deriveSigningSecretFromSiteKey */
export { deriveSigningSecretFromRootKey } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use SiteKeyEnvironmentPort */
export type { RootKeyEnvironmentPort } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use SiteKeyRejection */
export type { RootKeyRejection } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use ParsedSiteKeyHex */
export type { ParsedRootKeyHex } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use SiteKeyStatus */
export type { RootKeyStatus } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use SiteKeyReveal */
export type { RootKeyReveal } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use InspectSiteKeyMaterialOptions */
export type { InspectRootKeyMaterialOptions } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
/** @deprecated use GeneratedFileSiteKey */
export type { GeneratedFileRootKey } from "./keyring.env.js"; // site-key-legacy: deprecated alias; remove on/after 2026-11-01
export { formatAad } from "./aad.js";
export { defaultPlatformMessages } from "../messages.js";
export type { PlatformMessages } from "../messages.js";
