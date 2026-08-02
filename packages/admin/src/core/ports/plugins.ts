/**
 * @file `AdminExtensionsPort` — installed extensions (the reference implementation calls them
 * "plugins") and their
 * enabled/disabled state.
 *
 * ## Why the port is "Extensions" but the DTO and methods say "Plugin"
 *
 * The port interface is named generically because not every host will call this mechanism
 * "plugins" — some call the same concept "add-ons" or "extensions" in their own product copy.
 * The DTO (`AdminPlugin`) and method names (`listPlugins`/`setPluginEnabled`) keep the reference
 * implementation's own vocabulary rather than being renamed to match, because "plugin" is itself
 * already a generic, industry-standard term (not product-specific jargon the way `workspace-local`
 * or `/api/admin/v1` are) and because the calling code this port replaces already uses these exact
 * names — renaming
 * both the port and its members would be a bigger, noisier diff for no behavioral gain. A host
 * that genuinely prefers "extension" throughout is free to alias at the call site.
 *
 * ## `changeSetId` is an opaque audit handle, not a claim every host has "change sets"
 *
 * `setExtensionEnabled`'s response carries a `changeSetId` because the reference implementation
 * versions every mutating admin action through a change-set/revert subsystem. This port keeps the
 * field — real callers may want to link to an audit trail — but treats it as an opaque string a
 * host can use however its own audit mechanism works, not a promise that "change set" is a concept
 * every implementation shares.
 */

/** An installed extension and its trust/validity state. */
export interface AdminPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** `"built-in"` ships with the host itself; `"site"` was installed for this particular
   *  installation/tenant. */
  readonly source: "built-in" | "site";
  /** Trust tier driving how much a panel should warn before enabling this extension — lower
   *  numbers are more trusted. Not ordered numerically on the wire on purpose (host-defined
   *  labels), see `../transport/errors.ts`'s header for the same "vocabulary belongs to the host"
   *  reasoning applied to error codes. */
  readonly tier: "tier-1" | "tier-2" | "tier-3";
  /** Whether the extension currently passes the host's own structural/compatibility checks —
   *  independent of `enabled`. An extension can be `"valid"` and still `enabled: false`, or
   *  `"invalid"`/`"incompatible"` while still `enabled: true` from a prior state the host has not
   *  auto-disabled. */
  readonly status: "valid" | "invalid" | "incompatible";
  readonly enabled: boolean;
  readonly errors: readonly { code: string; file: string | null; message: string }[];
}

/** `setExtensionEnabled`'s response — a trimmed extension summary plus an audit handle, not the
 *  full `AdminPlugin`. See the file header on `changeSetId`. */
export interface AdminExtensionEnabledResult {
  readonly extension: { id: string; version: string; enabled: boolean; updatedAt: string };
  readonly changeSetId: string;
}

export interface AdminExtensionsPort {
  listPlugins(): Promise<readonly AdminPlugin[]>;
  setPluginEnabled(id: string, input: { enabled: boolean }): Promise<AdminExtensionEnabledResult>;
}
