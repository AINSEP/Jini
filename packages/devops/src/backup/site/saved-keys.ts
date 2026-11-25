import { type SecretSealerPort } from "@jini-ai/core/contracts/vault";
import { SiteShareRefusal } from "./share-refusal.js";
import type { SiteSavedKeysPort } from "./saved-keys-port.js";

export interface SiteSavedKeysDeps {
  workspaceId: string;
  sealer: SecretSealerPort;
  /** Host-owned AAD domain. It is persisted inside every sealed share password, so the host must keep
   * passing the exact string its existing exports were sealed with. */
  passwordAadDomain: string;
}
/** Authenticate both registry identity dimensions so rows cannot be swapped between exports. */
function passwordAad({ shareId, workspaceId, domain }: { shareId: string; workspaceId: string; domain: string }): string {
  // Tuple encoding cannot alias IDs containing separators, and the domain prevents vault reuse.
  return JSON.stringify([domain, 1, workspaceId, shareId]);
}
/** An imported site never inherits authority from a portable key payload or reference. No sealer
 * involved, so a host with no site of its own (a local-import CLI) reports the same notice.
 * @complexity O(1), no I/O.
 */
export const leaveSavedKeysOut: SiteSavedKeysPort["restore"] = async (_input, options = {}) => {
  options.signal?.throwIfAborted();
  return { notices: ["Saved keys were left out. Use a saved key to approve fresh access on the imported site."] };
};

/** The retired transport validated the complete bounded payload before opening a recipient,
 * used host-owned definitions instead of archive-supplied schemas, and committed settings/keys
 * together. Even that cannot authorize a new site: both capture and automatic restore are closed.
 */
/** CMS compatibility boundary for historical exports, which used 24 random password bytes and
 * a site-sealed password. New exports cannot capture credentials; imports require fresh grants.
 * @returns Refusal/notice for retired operations and owner-only reveal for historical exports.
 * @complexity O(1), except opening one historical sealed password.
 */
export function createSiteSavedKeys(deps: SiteSavedKeysDeps, _options: Record<string, never> = {}): SiteSavedKeysPort {
  return {
    async capture() {
      throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Exports no longer include saved keys. Grant saved keys separately on the imported site. Details: P25_SAVED_KEYS_EXPORT_REMOVED; secret values omitted." });
    },
    async reveal(input) {
      if (input.workspaceId !== deps.workspaceId) throw new Error("Saved keys workspace mismatch");
      return { password: await deps.sealer.open({ sealed: input.sealedPassword }, { aad: passwordAad({ shareId: input.shareId, workspaceId: input.workspaceId, domain: deps.passwordAadDomain }) }) };
    },
    restore: leaveSavedKeysOut,
  };
}
