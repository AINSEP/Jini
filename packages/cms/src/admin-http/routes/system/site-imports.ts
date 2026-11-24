/**
 * @file The framework-neutral decisions behind the admin site-import routes: which step a request
 * belongs to, how a failed step maps to its HTTP answer, the fixed refusal bodies of the shared gate,
 * the owner-setup response contract and the owner-setup body check.
 *
 * Express registration, socket handling (upload deadlines, the single upload lane) and body parsers
 * stay with the host's adapter: they depend on the host's process and socket policy, and the host's
 * parsers differ in how they inflate bodies. This module sees plain values only. The host's refusal
 * class and byte formatter are injected as {@link SiteImportFailureCollaborators}.
 */

/** One HTTP answer: status plus the JSON body. */
export interface SiteImportReply {
  readonly status: number;
  readonly body: unknown;
}

/** What the host injects to classify and format a failed import step. Method syntax on purpose. */
export interface SiteImportFailureCollaborators {
  /** The host's own refusal (a deliberate, user-facing rejection), or `undefined` for anything else. */
  asRefusal(required: { error: unknown }): { readonly code: string; readonly message: string } | undefined;
  /** Human-readable byte size for the parser's limit (`300 MiB`). */
  formatByteSize(required: { bytes: number }): string;
}

/** The fields a host reports for an unexpected (non-refusal) failure of a step. */
export interface SiteImportIncident {
  readonly operation: string;
  readonly code: "IMPORT_FAILED";
  readonly message: string;
  readonly field: "message";
}

const STEPS: Readonly<Record<string, string>> = {
  "GET ": "Import history",
  "POST ": "Archive verification",
  "POST /uploads": "ZIP upload",
  "GET /:importId/owner": "Import owner setup",
  "POST /:importId/owner": "Imported site creation",
};

/** Body-parser refusals that are bad uploads (400), keyed by the parser's error `type`. */
const PARSER_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["encoding.unsupported", "send an uncompressed request body."],
  ["entity.parse.failed", "the request body could not be parsed."],
  ["request.aborted", "the request ended before the complete body arrived."],
  ["request.size.invalid", "the body size does not match the Content-Length header."],
]);

const OWNER_BODY_KEYS: readonly string[] = ["adminPassword", "savedKeysPassword"];

/**
 * Each import boundary reports its own step while keeping provider diagnostics private.
 *
 * @param method - the request's HTTP method.
 * @param routePath - the matched route's registered path (empty when none matched).
 * @complexity O(1).
 */
export function importStep({ method, routePath }: { method: string; routePath: string }, _optional = {}): string {
  const suffix = routePath.split("site-imports")[1] ?? "";
  return STEPS[`${method} ${suffix}`] ?? "Site import";
}

/**
 * Maps a failed import step onto its HTTP answer: refusals and parser errors are 4xx. `undefined`
 * means an internal incident, which the host reports through its own failure sink using
 * {@link importIncident} — never a 400.
 *
 * @complexity O(1).
 */
export function mapImportFailure(
  { step, error, collaborators }: { step: string; error: unknown; collaborators: SiteImportFailureCollaborators },
  _optional = {},
): SiteImportReply | undefined {
  const refusal = collaborators.asRefusal({ error });
  if (refusal) return { status: refusal.code === "NOT_FOUND" ? 404 : 400, body: { code: refusal.code, message: `${step} failed: ${refusal.message}` } };
  // entity.too.large carries the parser's configured byte limit, independent of the step label.
  const { type, limit } = (error ?? {}) as { type?: string; limit: number };
  const tooLarge = type === "entity.too.large";
  // Parser refusals are bad uploads; a backend failure is an internal incident, never a 400.
  const parserMessage = PARSER_MESSAGES.get(type ?? "");
  if (!tooLarge && !parserMessage) return undefined;
  return {
    status: tooLarge ? 413 : 400,
    body: { code: tooLarge ? "LIMIT_EXCEEDED" : "IMPORT_FAILED",
      message: `${step} failed: ${tooLarge ? `the request is over the ${collaborators.formatByteSize({ bytes: limit })} limit for this step.` : parserMessage}` },
  };
}

/** What a host reports when {@link mapImportFailure} has no answer for a step. @complexity O(1). */
export function importIncident({ step }: { step: string }, _optional = {}): SiteImportIncident {
  return { operation: `site-import:${step}`, code: "IMPORT_FAILED", message: `${step} failed. No existing site was changed.`, field: "message" };
}

/** The shared gate's answer when the URL's workspace is not this server's. @complexity O(1). */
export function workspaceUnavailableReply({ step }: { step: string }, _optional = {}): SiteImportReply {
  return { status: 404, body: { code: "NOT_FOUND", message: `${step} failed: this workspace is not available.` } };
}

/** The shared gate's answer when no import backend is configured. @complexity O(1). */
export function importUnavailableReply({ step }: { step: string }, _optional = {}): SiteImportReply {
  return { status: 503, body: { code: "UNAVAILABLE", message: `${step} requires local site creation and a configured sites home.` } };
}

/** The answer to a second ZIP upload while the single upload lane is held. @complexity O(1). */
export function uploadBusyReply(_required: Record<string, never> = {}, _optional = {}): SiteImportReply {
  return { status: 409, body: { code: "BUSY", message: "Another ZIP upload is running." } };
}

/**
 * The owner-setup contract `GET …/owner` returns beside the import view: how the separately-owned UI
 * must submit the new owner password. Saved keys get their own field only when the import has them.
 *
 * @complexity O(1) besides copying the view.
 */
export function ownerSetupBody<T extends { readonly hasEncryptedKeys?: boolean }>({ imported }: { imported: T }, _optional = {}): T & { readonly ownerSetup: Readonly<Record<string, unknown>> } {
  return { ...imported, ownerSetup: { method: "POST", field: "adminPassword", username: "admin", sessionRequired: true, ...(imported.hasEncryptedKeys ? { savedKeysPasswordField: "savedKeysPassword" } : {}) } };
}

/** The owner-setup request body once validated: only the two password fields are ever accepted. */
export interface OwnerSetupInput {
  readonly adminPassword: string;
  readonly savedKeysPassword?: string;
}

/**
 * Checks the owner-setup body carries no field beyond the new owner password and the optional saved
 * keys password. A refusal is returned as `{ refusal }` for the host to raise as its own refusal type.
 *
 * @complexity O(keys).
 */
export function parseOwnerSetupBody({ body }: { body: unknown }, _optional = {}): { readonly input: OwnerSetupInput } | { readonly refusal: string } {
  if (!body || Object.keys(body).some(key => !OWNER_BODY_KEYS.includes(key))) return { refusal: "Only the new owner password and optional saved keys password are accepted." };
  const fields = body as { adminPassword: string; savedKeysPassword?: string };
  return { input: { adminPassword: fields.adminPassword, ...(fields.savedKeysPassword === undefined ? {} : { savedKeysPassword: fields.savedKeysPassword }) } };
}
