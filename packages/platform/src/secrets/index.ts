export type { SealedSecret } from "./types.js";
export type { RootKeyHandle, KeyringPort, SecretSealerPort } from "./ports.js";
export { AesGcmSecretSealer } from "./secret-sealer.aesgcm.js";
export {
  EnvOrFileKeyring, FixedRootKeyKeyring, UnusableRootKeyError, RootKeyFileAlreadyExistsError,
  parseRootKeyHex, fingerprintRootKeyHex, inspectRootKeyMaterial, revealRootKeyMaterial,
  generateFileRootKey, deriveFromRootKey, deriveSigningSecretFromRootKey,
} from "./keyring.env.js";
export type {
  EnvOrFileKeyringRequired, RootKeyEnvironmentPort,
  EnvOrFileKeyringOptions, RootKeyRejection, ParsedRootKeyHex, RootKeyStatus,
  RootKeyReveal, InspectRootKeyMaterialOptions, GeneratedFileRootKey,
} from "./keyring.env.js";
export { formatAad } from "./aad.js";

export { defaultPlatformMessages } from "../messages.js";
export type { PlatformMessages } from "../messages.js";
