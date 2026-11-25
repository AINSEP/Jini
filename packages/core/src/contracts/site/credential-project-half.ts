import type { KeyringPort, SecretSealerPort } from "../vault.js";

/** This site's own vault, or the project store every site of the project shares (the host's project database). */
export type CredentialScope = "site" | "project";

/**
 * A store's project half: the same repo shape over the project's own `secrets_vault`, opened with the
 * project's keyring and sealer, under the project's workspace id. Jini derives the sealing key from
 * the store's key and the row's AAD binds its workspace, so a project row opens only with these.
 */
export interface CredentialProjectHalf<R> {
  readonly workspaceId: string;
  readonly repo: R;
  /** Trusted human replacement only; the adapter still requires the current site grant. */
  readonly replaceRepo?: R;
  readonly createRepo?: R;
  readonly sealer: SecretSealerPort;
  readonly keyring: KeyringPort;
}

