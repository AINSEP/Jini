import { SiteShareRefusal, archiveRefusalName } from "./share-refusal.js";
import { warnCredentialContent, addCredentialWarning, type CredentialWarning, type CredentialRedactor } from "./credential-warnings.js";

/** Host policy the share file rules need. Every member is REQUIRED: the engine carries no host defaults. */
export interface ShareFilePolicyDeps {
  /** The host secret-shape redactor (engine diagnostics rules plus any host key shapes). */
  redactSecretShapes: CredentialRedactor;
  /** The host's tree-path check; returns a refusal reason or null. */
  checkTreePath: (required: { relPath: string }) => string | null;
  /** The share's maximum path depth. */
  maxPathSegments: number;
}

/** The seven-segment root of an installed plugin package payload (matched against the lowercased path). */
const PACKAGE_CONTENT_ROOT = /^agent-plugins\/ws\/[^/]+\/[^/]+\/package\/sha256\/[a-f0-9]{64}\//;
/** Names an installed package ships as content (MCP declarations, credential schemes), never runtime secrets. */
const PACKAGE_MANIFEST_NAMES = ["mcp.json", "jini-credential-schemes.json"];

/** Archive digest -> (package-relative path -> SHA-256 of the bytes) for every package THIS build
 *  ships (`package-file-inventory.ts`). The only proof a package-shaped path is the installer's. */
export type PackageFileInventory = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** The plugin memory a share carries. Every other folder under a plugin's `memory/` is private runtime
 *  state: export excludes it ({@link excludedSharePath}) and import refuses it (`archive-manifest.ts`). */
export const SHARED_PLUGIN_MEMORY = String.raw`memory\/(?:notes|learned)`;
const PRIVATE_PLUGIN_MEMORY = String.raw`memory\/(?!(?:notes|learned)(?:\/|$))`;
const AGENT_PLUGIN_RUNTIME = new RegExp(String.raw`^agent-plugins\/ws\/[^/]+\/[^/]+\/(?:data(?:\/|$)|${PRIVATE_PLUGIN_MEMORY})`);

function excludedRuntimeSharePath({ path, parts }: { path: string; parts: string[] }, _options = {}): boolean {
  // Plugin runtime data/memory have fixed roots. A package's src/data or docs/notes is content.
  // A site plugin needs no rule here: the share walks only the files Jini lists as its package
  // (`sources.ts` walkSitePlugins), so its data/ and private memory are never reached.
  const roots = [
    /^agent-plugins\/ws\/[^/]+\/(?:data|staging)(?:\/|$)/,
    AGENT_PLUGIN_RUNTIME,
    /^uploads\/chat-attachments(?:\/|$)/,
  ];
  return roots.some(root => root.test(path)) ||
    parts.some(part => /^chat\.db(?:$|[.-])/.test(part));
}

/** A name that only hints at a secret; below a package root the file's bytes are scanned too (see requireShareSecretFree). */
const CREDENTIAL_NAME = /(?:credential|vault|keyring|site-key|private[-_]?key)/;

/** Non-credential private/runtime names that still refuse; credential names produce warnings only. */
function suspiciousSharePart({ part }: { part: string }, _options = {}): boolean {
  const names = [".git", "node_modules", ".publish-staging", ".publish-previous", ".ds_store", "_share", ".fs-custom-root.json"];
  const prefixes = [".share-", "restore-point-", "superseded-"];
  return names.includes(part) || prefixes.some(prefix => part.startsWith(prefix)) || /\.(?:db|sqlite|sqlite3)(?:$|[.-])/.test(part);
}

/** Credential names produce warnings; traversal and containment remain validation errors.
 * Package manifests and credential labels are public package metadata, not runtime stores.
 */
function secretSharePath({ deps, path: candidate, packageContent = false }: { deps: ShareFilePolicyDeps; path: string; packageContent?: boolean }): boolean {
  const required = { path: candidate };
  if (deps.redactSecretShapes({ text: required.path }, { vendorOnly: true }).redactions > 0) return true;
  const p = required.path.toLowerCase();
  const root = PACKAGE_CONTENT_ROOT.test(p);
  return p.split("/").some((part, index) => {
    const inPackage = root && index >= 7;
    if (inPackage && PACKAGE_MANIFEST_NAMES.includes(part)) return false;
    // A package's credential LABEL name is allowed; key-file rules (.pem, id_rsa…) still apply.
    return credentialFileName({ part }, { credentialNameAllowed: inPackage && packageContent });
  });
}

/** Fixed name rules are independent of path containment and package execution trust. */
function credentialFileName(required: { part: string }, { credentialNameAllowed = false } = {}): boolean {
  const rules = [/^\.env/, /^\.(?:npmrc|netrc|storage-secret\.json)$/, /^mcp\.json$/,
    /^\.mcp(?:\..*)?\.json$/, /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/, /\.(?:pem|key|p12|pfx)(?:[.-]|$)/];
  return (!credentialNameAllowed && CREDENTIAL_NAME.test(required.part)) || rules.some(rule => rule.test(required.part));
}

/** Excludes private runtime trees, preserving credential-looking files. */
function excludedSharePath(required: { path: string }, _optional: { notices?: string[] } = {}): boolean {
  const p = required.path.toLowerCase(), packageRoot = PACKAGE_CONTENT_ROOT.test(p);
  if (excludedRuntimeSharePath({ path: p, parts: p.split("/") })) return true;
  const unsafe = p.split("/").some((part, index) => {
    if (packageRoot && index >= 7 && PACKAGE_MANIFEST_NAMES.includes(part)) return false;
    return suspiciousSharePart({ part });
  });
  if (unsafe) {
    throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: `Share refuses suspicious required path '${archiveRefusalName({ name: required.path })}'. Remove it before sharing.` });
  }
  return false;
}

/** True for a spelling some supported recipient filesystem rejects, rewrites or aliases. O(path). */
function hasUnportableSpelling(required: { path: string; maxPathSegments: number }): boolean {
  const p = required.path;
  const parts = p.split("/");
  if (/[:%\x00-\x1f\x7f\\]/.test(p) || p.normalize("NFC") !== p || p.normalize("NFKC") !== p || /[<>"|?*]/.test(p)) return true;
  return parts.some(part => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) ||
    parts.length > required.maxPathSegments || parts.some(part => /[. ]$/.test(part));
}

/** A ZIP path has one canonical spelling on every supported recipient filesystem. O(path). */
function validateSharePath(deps: ShareFilePolicyDeps, required: { path: string }): void {
  const p = required.path;
  // This one exact path is produced by trusted projection, never by a filesystem walk.
  // The publish owner mixes secret names with path-shape checks. Mask only credential
  // names here, retaining separators, dot segments and length for structural checks.
  const structural = p.split("/").map(part => secretSharePath({ deps, path: part }) ? "x".repeat(part.length) : part).join("/");
  const reason = ["database/content.db", "content.db"].includes(p) ? null : deps.checkTreePath({ relPath: structural });
  if (reason || hasUnportableSpelling({ path: p, maxPathSegments: deps.maxPathSegments })) {
    const shownPath = archiveRefusalName({ name: p });
    // A callback treats archive '$&'/'$`' spellings as text, never replacement tokens.
    const suffix = reason ? `: ${reason.replaceAll(structural, () => shownPath)}` : ".";
    throw new SiteShareRefusal({ code: "UNSAFE_PATH", message: `Share path '${shownPath}' is unsafe${suffix}` });
  }
}

/** Record content/name warnings and always include the file. Path integrity is checked separately.
 * `shownPath` is the portable archive location, never the synthetic runtime scan path.
 * Package identity remains an execution-trust concern, independent of content warnings.
 * @complexity O(bytes + accumulated warnings); no I/O or source mutation.
 */
function requireShareSecretFree(deps: ShareFilePolicyDeps, required: { path: string; bytes: Uint8Array }, optional: RequireSecretFreeOptions = {}): true {
  const { redactSecretShapes } = deps;
  const credentialWarnings = optional.credentialWarnings ?? [];
  const path = optional.shownPath ?? required.path;
  warnCredentialContent({ path, text: Buffer.from(required.bytes).toString("latin1"), credentialWarnings, redactSecretShapes }, { codeAware: /\.(?:js|mjs|cjs|ts|tsx|jsx)$/i.test(required.path) });
  if (!required.path.startsWith("media/") && secretSharePath({ deps, path: required.path })) {
    addCredentialWarning({ path, kind: "credential filename", credentialWarnings, redactSecretShapes });
  }
  return true;
}

function unsafeSharePath({ message }: { message: string }, _optional: Record<string, never> = {}): never { throw new SiteShareRefusal({ code: "UNSAFE_PATH", message }); }

/** Upper/lower expansion also catches sharp-s/SS and final-sigma aliases, including ancestors. */
export function sharePathAlias(required: { path: string }, _options: Record<string, never> = {}): string { return required.path.normalize("NFKC").toUpperCase().toLowerCase().normalize("NFC"); }

/** Reject aliases, including aliases in directory ancestors, before any content is read.
 * Mutates only the caller's per-archive claim sets; throws UNSAFE_PATH on conflicts.
 * @complexity O(path depth² + prior claims), bounded by 32 segments and 2,000 ZIP entries.
 */
function claimSharePath(deps: ShareFilePolicyDeps, required: ClaimSharePathInput): void {
  validateSharePath(deps, { path: required.path });
  const parts = required.path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const spelling = parts.slice(0, index).join("/");
    const alias = sharePathAlias({ path: spelling });
    const prior = required.aliases.get(alias);
    if (prior !== undefined && prior !== spelling) unsafeSharePath({ message: "ZIP contains unsafe case or Unicode aliases." });
    required.aliases.set(alias, spelling);
    if (index < parts.length && required.files.has(alias)) unsafeSharePath({ message: "ZIP file/directory collision." });
  }
  const key = sharePathAlias(required);
  if (!required.directory) {
    if (required.files.has(key) || [...required.aliases.keys()].some(alias => alias.startsWith(key + "/"))) unsafeSharePath({ message: "Duplicate file or file/directory collision." });
    required.files.add(key);
  }
}


type RequireSecretFreeOptions = { packageFiles?: PackageFileInventory | undefined; bundledImportPluginIds?: ReadonlySet<string> | undefined; shownPath?: string | undefined; notices?: string[] | undefined; credentialWarnings?: CredentialWarning[] | undefined };
type ClaimSharePathInput = { path: string; directory: boolean; aliases: Map<string, string>; files: Set<string> };

/** The share file policy bound to the host's redactor, tree-path check and depth limit. */
export interface ShareFilePolicy {
  secretSharePath(required: { path: string }, optional?: { packageContent?: boolean }): boolean;
  excludedSharePath(required: { path: string }, optional?: { notices?: string[] }): boolean;
  validateSharePath(required: { path: string }, optional?: Record<string, never>): void;
  requireShareSecretFree(required: { path: string; bytes: Uint8Array }, optional?: RequireSecretFreeOptions): true;
  claimSharePath(required: ClaimSharePathInput, optional?: Record<string, never>): void;
}

/** Binds the share path/secret rules to REQUIRED host policy (see {@link ShareFilePolicyDeps}). */
export function createShareFilePolicy(deps: ShareFilePolicyDeps, _optional: Record<string, never> = {}): ShareFilePolicy {
  return {
    secretSharePath: (required, { packageContent = false } = {}) => secretSharePath({ deps, path: required.path, packageContent }),
    excludedSharePath: (required, optional = {}) => excludedSharePath(required, optional),
    validateSharePath: (required) => validateSharePath(deps, required),
    requireShareSecretFree: (required, optional = {}) => requireShareSecretFree(deps, required, optional),
    claimSharePath: (required) => claimSharePath(deps, required),
  };
}
