import { formatAad } from "../aad.js";

const AAD_VERSION = "v1";

/** Stable v1 AAD binding workspace, vendor, and credential identity. */
export function buildVendorCredentialAad(input: { workspaceId: string; vendorId: string; id: string }): string {
  return formatAad({ kind: "vendor-credential-set", version: AAD_VERSION, parts: [input.workspaceId, input.vendorId, input.id] });
}
