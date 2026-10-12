import { formatAad } from "../aad.js";
import type { VaultIdentity, VaultOptions } from "./vault.types.js";

/** JSON tuple encoding prevents colons or separators in host identifiers aliasing another row. */
export function buildVaultAad(input: VaultIdentity, _options: VaultOptions = {}): string {
  return formatAad({ kind: "secrets-vault", version: "v1", parts: [JSON.stringify([
    input.workspaceId, input.id, input.kind, input.ownerKey, input.principalId, input.binding,
  ])] });
}
