/**
 * @file Credential tool orchestration with host-supplied policy, adapters and cards.
 *
 * Requests can mutate an external provider, so the host's write permission gates them; DELETE
 * additionally holds one call for human approval rather than requiring a second model call.
 * Target resolution checks labels and saved hosts before the dialog without decrypting, and
 * an approved DELETE decrypts and sends only after its human answer.
 *
 * Username updates accept only label and username, so an unconfirmed edit cannot carry a token;
 * resolving the label to its row id never decrypts.
 *
 * Secret keystrokes travel browser -> answer route -> exchange -> parked handler -> sealed store,
 * never through model input, results or audit values; absent surface delivery fails closed.
 * The outcome replaces the same form URI after persistence, because delivery alone does not prove
 * sealing succeeded.
 *
 * Rotation resolves its label before opening a card; creation has no existing row to resolve,
 * so the store validates submitted fields and refuses duplicate labels rather than overwriting.
 * File shape, path, size and provider target checks precede decryption; the same provider commits
 * the exact read-only plan it prepared, with abort checked before the commit.
 */
// Mechanical extraction provenance (exact source SHA/path) is in this package's source-map.md.
// Host wiring stays with the consumer; ordering and privacy rationale follow the moved handlers.
import type { CredentialWriteFilesRequest, CredentialToolOperations, CredentialToolActorDeps, CredentialCreatePrefill as CreateCredentialPrefill, CredentialToolSurfaces, CredentialToolSetupFailure } from "./credential-tool-operations.js";
import type { SurfaceCardApp, SecretCardForm } from "@jini-ai/core/contracts/cards";
// ToolInputError marks caller-correctable validation instead of an internal failure that transports redact.
import { decorateWithSchema, ToolInputError, redactSecrets, requireInputRecord, requireString, adaptLegacyAuthorize, requireToolPermission, buildDomainRegistrations, requireNoInput, withSchemaOnRejection } from "@jini-ai/core";
import type { CredentialedRequestPort, CredentialedRequestRequired, CredentialedRequestOptional, CredentialedRequestResult, CredentialSetConnectionInput as CustomProviderConnectionInput, SourceControlFileWritePlan, SourceControlFileWriter, SourceControlWritePort, PluginCredentialCard, CredentialSetSummary as CustomCredentialSummary } from "@jini-ai/core/contracts/credentials";
import type { CustomCredentialToolHost, CredentialCardIdentity, CustomCredentialSecretCards, CustomCredentialToolPorts } from "./credential-tool-host.js";
import { CustomCredentialValidationError, CustomCredentialNotFoundError, CustomCredentialDuplicateLabelError } from "../sets/store.js";
import { buildAuthorizationHeader } from "../credentialed-request.js";
import { callerSafeErrorMessage, withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
// ToolHandler carries core's SurfaceEmission return contract directly rather than a transport implementation type.
import type { ToolExecutionContext, ToolExecutionOptions, ToolHandler, ToolRegistration } from "@jini-ai/core";
import type { CredentialedRequestOutcome } from "../credentialed-request.js";
import { CredentialedRequestValidationError } from "../../contracts/credentialed-request-errors.js";

type ValidatedWriteFilesInput = CredentialWriteFilesRequest & { readonly owner: string; readonly repo: string };

/** Stamps the host's app identity on a card a host builder made; the host's own values keep the same bytes. */
function withCardApp<Spec extends { readonly app?: SurfaceCardApp }>({ spec, app }: { spec: Spec; app: SurfaceCardApp }): Spec {
  return { ...spec, app };
}

/**
 * Decides which of `custom_credential_make_request`'s rejections are the CALLER's to fix — the same
 * schema-decorated validation classification used for caller-correctable input failures: an
 * unclassified rejection reaches `@jini-ai/daemon`'s `ToolExecutor` as `errorKind: 'internal'`, which
 * `@jini-ai/http-kit`'s `delegatedToolExecuteRoute` SEC-005-redacts into a bare `INTERNAL_ERROR` —
 * stripping the one piece of information (WHICH rule refused the call) a caller could actually act on.
 *
 * Two classes:
 * - `CredentialedRequestValidationError` — a bad `method`/`url`/`headers`/`body` shape, OR a `url`
 *   whose origin is not one of the credential's own saved hosts (`resolveAllowedRequestUrl`'s
 *   allowlist refusal — the "off-allowlist host" case).
 * - `EgressRefusedError` — the shared `HttpClientPort` (ADR-038) refused the target before ever
 *   connecting: a non-public resolved address on the first hop or any re-verified redirect hop, a
 *   disallowed scheme, or credentials embedded in the URL.
 *
 * makeCredentialedRequest must preserve EgressRefusedError rather than wrapping it as a
 * transport failure. Otherwise this instanceof classification loses the actionable egress reason
 * and a URL refusal becomes indistinguishable from a DNS/timeout crash.
 *
 * An `EgressRefusedError` reaches the model in its `callerSafeMessage` form only — without the
 * address the hostname resolved to — via {@link makeModelFacingCredentialedRequest}, which every
 * call site uses through the same classification boundary.
 *
 * Deliberately NOT `CredentialedRequestTransportError` (a DNS failure, timeout, or connection error
 * is not a decision this process made, and a different URL does not reliably fix it) and NOT
 * `CustomCredentialNotFoundError` (a different call shape — a wrong label — unrelated to this tool's
 * egress/allowlist boundary and out of scope for this fix).
 *
 * The port's `classifyError` names those two classes `validation` and `egress-refused`.
 *
 * @complexity O(1) — one `classifyError` call.
 */
/**
 * `makeCredentialedRequest` as the model may see it fail: validation and egress rejections schema-decorated
 * using only their classified `callerSafeMessage`. The original rejection is classified once,
 * before any decoration can read its private `.message`.
 *
 * The refusal and requested hostname reach the model; the resolved address stays server-side.
 * A model that can name any host and read back its resolved address can map internal
 * DNS one call at a time (`internal-db.corp` -> `10.0.4.7`). The full message, address included, is
 * kept server-side in the audit entry `makeCredentialedRequest` records (`egressRefusal`).
 *
 * @complexity O(1) beyond `makeCredentialedRequest` itself.
 */
async function makeModelFacingCredentialedRequest({ port, input, catalog, toolId }: { port: CredentialedRequestPort; input: CredentialedRequestRequired & CredentialedRequestOptional; catalog: CustomCredentialToolHost["vocabulary"]["catalog"]; toolId: string }): Promise<CredentialedRequestResult> {
  const { headers, body, ...required } = input;
  try {
    return await port.request(required, { headers, body });
  } catch (error) {
    const classified = port.classifyError({ error });
    if (classified.category === "validation" || classified.category === "egress-refused") {
      throw decorateWithSchema({ toolId, catalog, message: classified.callerSafeMessage });
    }
    throw error;
  }
}

/**
 * The same classification for `custom_credential_write_files`, which validates its whole input
 * (`validateWriteFilesInput`) BEFORE the credential is even resolved. Every rejection from there is
 * `CustomCredentialValidationError`, and every one of them names a rule a different call would
 * satisfy: a bad owner/repo/branch/commitMessage, a path that is absolute, escapes the repository
 * root, nests under `.git`, or duplicates another entry, a file over the per-file cap, or a batch
 * over the file-count or aggregate-byte cap.
 *
 * That class extends plain `Error`, so an undecorated throw reaches `@jini-ai/daemon`'s
 * `ToolExecutor` as `errorKind: 'internal'` and `@jini-ai/http-kit`'s `delegatedToolExecuteRoute`
 * SEC-005-redacts it into a bare `INTERNAL_ERROR` — a model told only "something broke" about a
 * refusal it could have fixed by moving one file out of `.git/`. Deliberately narrow: this predicate
 * runs only around the validation call, so it never reclassifies the resolve/plan/commit failures
 * that follow it.
 *
 * @complexity O(1) — one `instanceof` check.
 */
function isWriteFilesShapeRejection(error: unknown): boolean {
  return error instanceof CustomCredentialValidationError;
}

/** `custom_credential_write_files`'s ENTIRE agent-facing result shape — boolean-plus-reason on every
 *  non-success branch, the same discriminated shape {@link SetTokenResult}/{@link CreateCredentialResult}
 *  use below for the identical reason: nothing here could ever be widened to carry the token, and a
 *  caller can always branch on `executed` alone regardless of which branch produced the result.
 *  `reason: "error"` is this tool's own addition — unlike a form submission, the write itself can fail
 *  at the provider API level AFTER confirmation (a diverged branch, a provider error), which needs a
 *  human-readable `message` the other reasons never carry. That `message` is always caller-safe: a
 *  network failure's detail goes to the server log only, via {@link reportRepositoryWriteFailure}.
 */
type WriteFilesResult =
  | { executed: true; commitSha: string; commitUrl: string; filesWritten: number }
  | { executed: false; cancelled: true }
  | { executed: false; cancelled: false; reason: "expired" | "abandoned" }
  | { executed: false; cancelled: false; reason: "error"; message: string };

/**
 * Commits using the SAME validated provider plan the handler obtained, rather than re-planning.
 * This keeps the tree and branch-freshness checks tied to the read-only reconnaissance result.
 * Keeping the write separate also bounds the handler's branching complexity.
 *
 * @complexity O(1) beyond the provider's `commitFiles`'s own O(files) cost.
 */
async function performRepositoryFilesWrite({ operations, port, provider, resolved, validated, plan }: {
  operations: CredentialToolOperations;
  port: SourceControlWritePort;
  provider: SourceControlFileWriter;
  resolved: { baseUrl: string; connection: CustomProviderConnectionInput };
  validated: ValidatedWriteFilesInput;
  plan: SourceControlFileWritePlan;
}, _optional = {}): Promise<WriteFilesResult> {
  const commitResult = await port.commitFiles({ provider,
    input: { ...writeTarget(resolved, validated), branch: validated.branch, commitMessage: validated.commitMessage, files: validated.files },
    plan });
  if (!commitResult.ok) {
    operations.diagnostics.writeFailure({ phase: "commit", failure: commitResult });
    return { executed: false, cancelled: false, reason: "error", message: commitResult.message };
  }
  return { executed: true, commitSha: commitResult.commitSha, commitUrl: commitResult.commitUrl, filesWritten: validated.files.length };
}

/** Where a write goes: the credential's API plus the `Authorization` header built from its connection. */
function writeTarget(resolved: { baseUrl: string; connection: CustomProviderConnectionInput }, validated: ValidatedWriteFilesInput) {
  return { baseUrl: resolved.baseUrl, authorization: buildAuthorizationHeader({ connection: resolved.connection, schemes: [] }), owner: validated.owner, repo: validated.repo };
}

/** The exact keys `custom_credential_set_username` accepts — nothing else, ever. This is the
 *  structural half of "this tool can never accept a token" promised by the host's tool catalog
 *  description: `additionalProperties: false` on that catalog entry's `inputSchema` is descriptive
 *  only (the kernel "neither parses nor validates" a tool's schema — see `@jini-ai/core`'s own
 *  `ToolDescriptor.inputSchema` doc), so THIS handler-level check is the one that is actually
 *  enforced. */
const SET_USERNAME_ALLOWED_FIELDS: ReadonlySet<string> = new Set(["label", "username"]);

/**
 * Refuses a `custom_credential_set_username` call carrying any field other than `label`/`username` —
 * in particular, a `token`/`connection`/`secret`-shaped field a model might try to smuggle a
 * credential rotation through. This is the property that makes it defensible to leave this tool
 * un-confirmed (see this file's header): there is no field on this call shape capable of carrying a
 * secret, so there is nothing a confirmation dialog would even be protecting against.
 *
 * @throws {CustomCredentialValidationError} `input` carries a key other than `label`/`username`.
 * @complexity O(n) in the number of supplied input keys.
 */
function rejectUnexpectedSetUsernameFields({ input, messages }: { input: Record<string, unknown>; messages: CredentialToolOperations['messages'] }, _optional = {}): void {
  const unexpected = Object.keys(input).filter((key) => !SET_USERNAME_ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) {
    throw new CustomCredentialValidationError(
      messages.unexpectedUsername({ keys: unexpected })
    );
  }
}

/**
 * Reads and validates this tool's required `username` field: a non-empty string to set it, or `null`
 * to explicitly clear it. Unlike `../sets/store.ts`'s own `validateUsernamePatch` (which validates
 * `updateCustomCredential`'s OPTIONAL `username` patch, where omitting the field entirely means "leave
 * unchanged"), omitting the key here is itself a caller error — this tool exists for exactly one job,
 * set-or-clear, so "say nothing" is never a valid call into it. Mirrors that function's own two
 * non-omitted values and their exact wording for the one case they share (a blank string), so the two
 * surfaces never describe the same rule two different ways.
 *
 * @throws {CustomCredentialValidationError} `username` is omitted, or present but neither `null` nor a
 *   non-empty string.
 * @complexity O(1).
 */
function requireUsernameOrClearSentinel({ input, messages }: { input: Record<string, unknown>; messages: CredentialToolOperations['messages'] }, _optional = {}): string | null {
  if (input.username === undefined) {
    throw new CustomCredentialValidationError(messages.missingUsername);
  }
  if (input.username === null) return null;
  if (typeof input.username !== "string" || input.username.trim() === "") {
    throw new CustomCredentialValidationError(messages.invalidUsername);
  }
  return input.username;
}

/** The exact keys `custom_credential_set_token` accepts on the MODEL-ISSUED call — `label`, nothing
 *  else, ever. The API rotation schema supplied by the host already has no `token` property to fill in, but
 *  `additionalProperties: false` is descriptive only (same caveat `SET_USERNAME_ALLOWED_FIELDS`'s own
 *  doc gives) — this is the layer that is actually enforced. */
const SET_TOKEN_ALLOWED_FIELDS: ReadonlySet<string> = new Set(["label"]);

/**
 * Refuses a `custom_credential_set_token` call carrying any field other than `label` — the ONLY
 * gate standing between "the model can never supply a token to this tool" and a future edit that adds
 * a second property to its schema without also widening this check. There is no legitimate reason for
 * this call to ever carry anything else: the token itself can only ever arrive later, through the
 * rendered form's own submission, which this function never sees (it validates the ORIGINAL call that
 * opens the exchange, before any form exists).
 *
 * @throws {CustomCredentialValidationError} `input` carries a key other than `label`.
 * @complexity O(n) in the number of supplied input keys.
 */
function rejectUnexpectedSetTokenFields({ input, messages }: { input: Record<string, unknown>; messages: CredentialToolOperations['messages'] }, _optional = {}): void {
  const unexpected = Object.keys(input).filter((key) => !SET_TOKEN_ALLOWED_FIELDS.has(key));
  if (unexpected.length > 0) {
    throw new CustomCredentialValidationError(
      messages.unexpectedToken({ keys: unexpected })
    );
  }
}

/** `custom_credential_set_token`'s ENTIRE agent-facing result shape — deliberately boolean-plus-reason
 *  and nothing richer, so there is no field this type could ever be widened to carry the submitted
 *  token in (contrast `CustomCredentialSummary`, which `custom_credential_set_username` safely returns
 *  in full because none of its fields are secret).
 */
type SetTokenResult = { saved: true } | { saved: false; reason: "cancelled" | "expired" | "abandoned" | "invalid" | "error"; message?: string };

/** Probe only plugin-owned API cards before sealing, keeping every failure value-free.
 * @throws CustomCredentialValidationError for refusal/unavailability or an origin mismatch.
 * @complexity One bounded GET plus the installed auth-scheme load; no persistence.
 */
async function probeCardBeforeSave({ card, baseUrl, connection, routeDeps, operations, probe, signal }: {
  card?: PluginCredentialCard | undefined; baseUrl: string; connection: { token: string; username?: string };
  routeDeps: CredentialToolActorDeps; operations: CredentialToolOperations; probe: CredentialedRequestPort["probe"]; signal: AbortSignal;
}, { replacing = false }: { replacing?: boolean } = {}): Promise<void> {
  if (!card?.probeUrl) return;
  // Rotation must not send a key to a card's old origin after the saved row was re-pointed.
  if (new URL(card.probeUrl).origin !== new URL(baseUrl).origin) throw new CustomCredentialValidationError(operations.messages.probeOriginMismatch);
  const schemes = await routeDeps.loadAuthSchemes({ workspaceId: routeDeps.workspaceId });
  signal.throwIfAborted();
  const status = await probe({ connection, url: card.probeUrl, schemes });
  signal.throwIfAborted();
  if (status === 'refused' || status === 'unavailable') throw new CustomCredentialValidationError(operations.messages.probeFailure({ status, keyHint: card.keyHint, replacing }));
}

/** Every dependency {@link saveSetToken} needs to seal the submitted token and report the
 *  outcome — bundled so `custom_credential_set_token`'s own `askThenReport` call passes one object
 *  rather than the handler's whole closure.
 */
interface SetTokenAnswerContext {
  readonly routeDeps: CredentialToolActorDeps;
  readonly operations: CredentialToolOperations;
  readonly probe: CredentialedRequestPort["probe"];
  readonly existing: CustomCredentialSummary;
  readonly pluginCard?: PluginCredentialCard | undefined;
}

/**
 * `custom_credential_set_token`'s `askThenReport` answer handling — extracted to a top-level function
 * so its own complexity is measured independently of the handler that opens the exchange and builds
 * the form.
 *
 * `askThenReport`, not `askOnce`: a submitted form's `tools/call` resolves the instant
 * the answer route DELIVERS it to this parked call, before the replacement operation below
 * has even run. Each
 * non-success branch that sends an `outcome` does so because the confirmation-turned-form's own script
 * would otherwise leave a bare "Done." on screen for work that has not actually happened yet; the
 * cancel/no-answer branches send none, because the form's own script already reports "Dismissed."/an
 * expiry locally the moment this call resolves, and that IS the truth for those two cases (nothing
 * asynchronous happens afterward that could still fail).
 *
 * The token itself lives in a single local parameter for the width of this function and is never
 * assigned to any field this function returns, logged, or otherwise retained — the property
 * the host's catalog description promises the model.
 *
 * @complexity O(1) locally, an optional bounded GET, and one `updateCustomCredential` call (validate, seal, write).
 */
// Lifecycle classification and outcome delivery now belong to Jini; this function is only the save port.
async function saveSetToken(
  { token, signal, routeDeps, operations, probe, existing, pluginCard, principalId }: SetTokenAnswerContext & { token: string; signal: AbortSignal; principalId: string }, _optional = {},
): Promise<CustomCredentialSummary> {
  // Paste artifacts are dropped before anything is read or written; see card-token.ts.
  const cleanedToken = operations.policy.cleanToken({ token });
  // Re-reads the username HERE, at write time — never trusts `existing` (captured back when
  // `custom_credential_set_token`'s handler first resolved the label, before the form was even shown
  // to a human who may sit on it for an arbitrarily long time). `custom_credential_set_username` can
  // run against this same row while the form is open; if this handler carried `existing.username`
  // forward as a captured literal, that concurrent change would be silently overwritten with the
  // value the username held before the form opened. `existing.id` is still safe to reuse — it names
  // WHICH row to update and cannot go stale the way a plaintext column value can.
  const current = await operations.sets.describe({ id: existing.id });
  if (!current) throw new CustomCredentialNotFoundError(operations.messages.notFoundId({ id: existing.id }));
  // Half-migrated credentials keep the username only in their sealed connection. Resolve that
  // fallback from the current row, retaining the fresh-read protection against form-open races.
  const resolved = current.username === undefined
    ? await operations.sets.resolve({ label: current.label })
    : null;
  const username = current.username ?? resolved?.connection.username;
  if (signal.aborted) throw new ToolInputError({ message: operations.messages.runEnded });
  const connection = { token: cleanedToken, ...(username !== undefined ? { username } : {}) };
  await probeCardBeforeSave({ card: pluginCard, baseUrl: current.baseUrl, connection, routeDeps, operations, probe, signal }, { replacing: true });
  return await operations.sets.replace(
    {
      id: existing.id,
      signal, principalId, guardRepo: operations.policy.guardRepo,
      // Carries the CURRENT (just re-read) username forward into the fresh connection. Replacing
      // `connection` WITHOUT one would silently CLEAR a saved username — `../sets/store.ts`'s own
      // `updateCustomCredential` doc: "replacing the connection replaces the username ... including
      // clearing it, when the new connection omits one". A token-only fix must never have that side
      // effect, and must never resurrect a value the username has since moved on from either — hence
      // the fresh read above rather than the `existing` snapshot. A row deleted while the form
      // was open is refused before probing; the store also catches deletion after this read.
      connection,
    }
  );
}

/** Reads optional non-secret prefill hints from the model-issued call.
 * Blank strings are absent; unknown category options remain subject to store validation on save.
 * @complexity O(1) — fixed field reads.
 */
function readCreateCredentialPrefill({ input, operations }: { input: Record<string, unknown>; operations: CredentialToolOperations }, _optional = {}): CreateCredentialPrefill {
  const prefill: { label?: string; baseUrl?: string; category?: string; worksFor?: string[] } = {};
  if (input.worksFor !== undefined) {
    try {
      prefill.worksFor = operations.policy.normalizeWorksFor({ value: input.worksFor });
      for (const value of prefill.worksFor) operations.policy.assertFreeField({ value, field: "worksFor" });
    } catch { throw new ToolInputError({ message: operations.messages.invalidWorksFor }); }
  }
  for (const field of ["label", "baseUrl", "category"] as const) {
    if (typeof input[field] === "string" && (input[field] as string).trim() !== "") {
      operations.policy.assertFreeField({ value: input[field] as string, field });
      prefill[field] = input[field] as string;
    }
  }
  return prefill;
}

/** `custom_credential_create`'s ENTIRE agent-facing result shape. On success, the SAME summary shape
 *  `custom_credential_list`/`custom_credential_set_username` already return — safe in full, since
 *  `CustomCredentialSummary` has no field capable of carrying a secret by its public type. Every
 *  failure branch is boolean-plus-reason, the same shape {@link SetTokenResult} uses and for the
 *  identical reason: nothing here could ever be widened to carry the submitted token.
 *  `'duplicate-label'` is this tool's own addition — `custom_credential_set_token` has no equivalent
 *  case, since it always targets a row that is already known to exist.
 */
type CreateCredentialResult =
  | { created: true; credential: Omit<CustomCredentialSummary, "tokenHint"> }
  | { created: false; reason: "cancelled" | "expired" | "abandoned" | "invalid" | "duplicate-label" | "error"; message?: string };

/** Create has no existing row to resolve before the form opens: its target row does not exist
 * until the human submits. The save port receives only its own explicit domain dependencies. */
/** `custom_credential_create`'s five submitted form fields, in their raw `typeof`-guarded form — no
 *  defaulting yet (see {@link deriveCreateCredentialSubmission} for that stage). Split from it so each
 *  function's own complexity is measured independently: this one is pure shape-narrowing, that one is
 *  pure decision-making, and neither has to read the other's reasoning to verify its own.
 *
 *  @complexity O(1) — five fixed field reads. */
interface RawCreateCredentialFields {
  readonly worksFor: unknown;
  readonly label: string;
  readonly baseUrl: string;
  readonly category: string;
  readonly username: string;
  readonly token: string;
}

/**
 * Narrows `custom_credential_create`'s five submitted params to strings, with no defaulting — a
 * missing or non-string field reads as `""`, exactly like every other `answer.params[...]` read in
 * this file; parsing never changes the submitted token bytes.
 *
 * @complexity O(1) — five fixed field reads.
 */
function readRawCreateCredentialFields(params: Record<string, unknown>): RawCreateCredentialFields {
  return {
    worksFor: params.worksFor ?? [],
    label: typeof params["label"] === "string" ? params["label"] : "",
    baseUrl: typeof params["baseUrl"] === "string" ? params["baseUrl"] : "",
    category: typeof params["category"] === "string" ? params["category"] : "",
    username: typeof params["username"] === "string" ? params["username"] : "",
    token: typeof params["token"] === "string" ? params["token"] : "",
  };
}

/** {@link deriveCreateCredentialSubmission}'s output — the fully-defaulted shape the rest of
 *  {@link saveCreateCard} actually acts on.
 */
interface CreateCredentialSubmission {
  readonly additionalHosts?: readonly string[];
  readonly pluginCard?: PluginCredentialCard | undefined;
  readonly worksFor: unknown;
  readonly label: string;
  readonly baseUrl: string;
  readonly category: string;
  readonly username: string | undefined;
  readonly token: string;
  /** `"site"` = saved "only for this site"; omitted = the project store when one is attached. */
  readonly scope?: "site";
  /** A blank `label` still needs a human-readable name for the outcome surface's own "Label" detail
   *  row — `../sets/store.ts`'s own validation error (surfaced via {@link mapCreateCredentialError}) is what
   *  actually refuses the submission; this is display-only. */
  readonly displayLabel: string;
}

/**
 * Applies `custom_credential_create`'s three field defaults on top of {@link readRawCreateCredentialFields}'s
 * raw extraction. Every REAL field validation (non-empty label/baseUrl, a closed category, the
 * `(workspaceId, label)` uniqueness constraint) is still left entirely to `../sets/store.ts`'s own
 * `createCustomCredential` — this function only decides what a blank/missing field DEFAULTS to before
 * that validation ever runs:
 *
 * - `category`: defaults to `"general"` (the closed set's catch-all, same as the admin Access Tokens
 *   page's own "Add custom provider" form) rather than passing a blank string through to `../sets/store.ts`'s
 *   `validateCategory`, which would reject it outright and block the save on a required field the human
 *   had no obvious answer for. Also enforced by the host's own form
 *   default: that default lives in the rendered `<select>`'s pre-selected option, this one covers a
 *   submission that somehow arrives without it. `"general"` is itself a member of the closed set
 *   `validateCategory` enforces, so a caller-supplied INVALID category (anything outside the fixed set)
 *   is still rejected exactly as before — this default never widens what counts as valid.
 * - `username`: a blank string is treated as "omitted", matching `readCreateCredentialPrefill`'s own
 *   identical convention for the same optional field.
 * - `displayLabel`: a blank `label` still needs a human-readable name for the outcome surface (see its
 *   own field doc above); `token` is passed through unchanged — the engine checks blankness before
 *   calling the domain save port.
 *
 * @complexity O(1) — three fixed defaulting decisions.
 */
function safeCredentialLabel({ label, operations }: { label: string; operations: CredentialToolOperations }, _optional = {}): string {
  try { operations.policy.assertFreeField({ value: label, field: 'label' }); return label.trim() === '' ? operations.messages.unlabeled : label; }
  catch { return operations.messages.unlabeled; }
}

function deriveCreateCredentialSubmission({ raw, operations }: { raw: RawCreateCredentialFields; operations: CredentialToolOperations }, _optional = {}): CreateCredentialSubmission {
  return {
    worksFor: raw.worksFor,
    label: raw.label,
    baseUrl: raw.baseUrl,
    category: raw.category.trim() === "" ? operations.policy.defaultCategory : raw.category,
    username: raw.username.trim() === "" ? undefined : raw.username,
    token: raw.token,
    displayLabel: safeCredentialLabel({ label: raw.label, operations }),
  };
}

/** Shared safe failure metadata drives both the model result and the human outcome. Cancel,
 * expiry and abandonment emit no outcome because their state is already rendered locally.
 */
interface CreateCardFailure {
  readonly reason: 'invalid' | 'duplicate-label' | 'error';
  readonly message: string;
}

/**
 * Maps a `createCustomCredential` rejection onto `custom_credential_create`'s own failure shape — the
 * error-type dispatch returns a value instead of writing a transport response.
 *
 * A collision is refused, never silently overwritten — and the refusal names the correct tool for a
 * rotation, so the model does not retry this CREATE-only tool against an existing row. Every other
 * failure's message goes through the same caller-safe allowlist as rotation — never an unlisted
 * `err.message`, which can quote the submitted token.
 *
 * @complexity O(r) in operations.formErrors' rule count.
 */
function mapCreateCredentialError(
  required: { err: unknown; locale: string; label: string; operations: CredentialToolOperations }, _optional = {}
): CreateCardFailure {
  const { err, locale, label, operations } = required;
  if (err instanceof CustomCredentialDuplicateLabelError) {
    if (operations.policy.isProjectConflict({ error: err })) return { reason: 'duplicate-label', message: err.message };
    const message = operations.messages.duplicateLabel({ label });
    return { reason: 'duplicate-label', message };
  }
  const message = operations.locale.translate({ message: callerSafeErrorMessage({ err, rules: operations.formErrors, fallback: operations.messages.formSaveFailure }), locale });
  return { reason: err instanceof CustomCredentialValidationError ? 'invalid' : 'error', message };
}

/**
 * The create card's domain save port stays separate from the engine's exchange lifecycle so its
 * persistence cost is visible. askThenReport, rather than askOnce, keeps the human's submission
 * waiting until the real store operation has finished instead of reporting premature Done.
 *
 * Every real field validation (non-empty label/baseUrl, closed category, workspace/label uniqueness)
 * remains in createCustomCredential. The engine refuses blank tokens before sealConnection; the
 * domain keeps field parsing/defaulting and the error-type mapper for actionable failures.
 *
 * The token lives only in the local submission and the sealed store. It is never returned, logged,
 * or retained in a projection — the property promised by the host's catalog description.
 * Only the save runs within the engine's error boundary, so Nothing was saved remains truthful.
 * @complexity O(1) locally, an optional bounded GET, and one createCustomCredential call (validate, seal, insert).
 */
async function saveCreateCard(
  required: { submission: CreateCredentialSubmission; routeDeps: CredentialToolActorDeps; operations: CredentialToolOperations; probe: CredentialedRequestPort["probe"]; signal: AbortSignal }, _optional = {}
): Promise<CustomCredentialSummary> {
  const { routeDeps, operations, probe, submission, signal } = required;
  await probeCardBeforeSave({ card: submission.pluginCard, baseUrl: submission.baseUrl,
    connection: { token: operations.policy.cleanToken({ token: submission.token }), ...(submission.username !== undefined ? { username: submission.username } : {}) }, routeDeps, operations, probe, signal });
  // Reuse the existing guard, including vault writes after asynchronous sealing.
  // Only persistence sits in the engine's save boundary, so failure copy stays truthful.
  const invalidate = await operations.publish.prepareInvalidation({});
  const saved = await operations.sets.create(
    {
      signal, guardRepo: operations.policy.guardRepo,
      label: submission.label,
      worksFor: submission.worksFor,
      category: submission.category,
      baseUrl: submission.baseUrl,
      ...(submission.additionalHosts === undefined ? {} : { additionalHosts: submission.additionalHosts }),
      ...(submission.scope ? { scope: submission.scope } : {}),
      connection: { token: operations.policy.cleanToken({ token: submission.token }), ...(submission.username !== undefined ? { username: submission.username } : {}) },
    }
  );
  invalidate({ after: saved });
  return saved;
}

/**
 * Opens a create card and saves its submission as a NEW credential row — shared by the generic API
 * card and a plugin's own key card, which differ only in their form and how a submission maps onto
 * the row. Same engine, save port, safe errors and outcome for both.
 * @complexity O(1) locally plus one createCustomCredential call per submission.
 */
async function openCreateCard(required: {
  ctx: ToolExecutionContext; emitSurface: ToolExecutionOptions["emitSurface"];
  routeDeps: CredentialToolActorDeps; operations: CredentialToolOperations; probe: CredentialedRequestPort["probe"]; cards: CustomCredentialSecretCards; surfaces: CredentialToolSurfaces; locale: string; initialLabel: string; cardIdentity: CredentialCardIdentity;
  form: () => SecretCardForm; submissionOf: (values: Readonly<Record<string, unknown>>) => CreateCredentialSubmission;
}, _optional = {}): Promise<CreateCredentialResult> {
  const { ctx, emitSurface, routeDeps, operations, probe, cards, surfaces, locale, initialLabel, cardIdentity, form, submissionOf } = required;
  // Fail closed rather than degrade — the only place a token can enter is the rendered form.
  // A ToolInputError preserves this exact wording; a bare Error would become a redacted 500.
  // The engine checks pre-dialog aborts and uses askThenReport so the save completes before Done.
  // These safe projections are scoped to this invocation, never shared between concurrent cards.
  // The error kind selects this tool's existing reason; the engine still owns error redaction.
  let failure: CreateCardFailure | undefined;
  let displayLabel = safeCredentialLabel({ label: initialLabel, operations });
  const card = cards.defineSecretCardTool<Record<string, never>, CustomCredentialSummary, CreateCredentialResult>({
    toolId: operations.ids.save,
    prepare: async () => ({}),
    form: () => form(),
    save: ({ values, signal }) => {
      // The shared save-result path attaches a submitted project key to this site.
      const submission = submissionOf(values);
      displayLabel = redactSecrets({ input: submission.displayLabel }, { exactSecrets: [submission.token] });
      return saveCreateCard({ submission, routeDeps, operations, probe, signal });
    },
    result: ({ run }) => {
      if (run.status === 'saved') {
        // The summary's token hint is for the human outcome only; strip it before returning to the model.
        const credential = { ...run.saved };
        delete credential.tokenHint;
        return { created: true, credential };
      }
      if (run.status === 'blank') return { created: false, reason: 'invalid', message: operations.locale.text({ id: 'blank', locale }) };
      if (run.status === 'failed') return { created: false, reason: failure?.reason ?? 'error', message: run.safeMessage };
      return { created: false, reason: run.status };
    },
    outcome: ({ run }) => {
      if (run.status === 'saved') {
        const hint = operations.locale.hint({ hint: run.saved.tokenHint, locale });
        return withCardApp({ spec: operations.credentialCardForms.createOutcome({ label: run.saved.label, state: 'success', message: `${hint ? hint + '. ' : ''}${operations.locale.text({ id: 'saved', locale })}` }), app: cardIdentity.appNames.createOutcome });
      }
      if (run.status === 'blank' || run.status === 'failed') return withCardApp({ spec: operations.credentialCardForms.createOutcome({ label: displayLabel, state: 'failure',
        message: run.status === 'blank' ? operations.locale.text({ id: 'blank', locale }) : run.safeMessage }), app: cardIdentity.appNames.createOutcome });
      // Cancel/expiry/abandonment already render locally: no second outcome is emitted.
      return undefined;
    },
  }, {
    uriHost: cardIdentity.uriNamespace,
    text: { noEmitter: operations.messages.noCreateChannel, saveFailure: operations.messages.formSaveFailure },
    safeError: err => {
      failure = mapCreateCredentialError({ err, locale, label: displayLabel, operations });
      return failure.message;
    },
    // Fixed exchange metadata only: exception text, the label, and submitted values are unsafe.
    logFailure: metadata => operations.diagnostics.createFailure({ metadata }),
  });
  return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: cards.askThenReport })(ctx, emitSurface ? { emitSurface } : {});
}

/**
 * API-key cards with every consumed operation supplied by the composing host.
 *
 * @complexity O(1) wiring; each adapter performs the bounded operations documented on its ports.
 */
/** @agent-note create accepts optional label/baseUrl/category/worksFor, rotate requires label and pluginProvider requires provider, while secrets arrive only from human card values. */
export function createCredentialSaveHandlers({ routeDeps, surfaces, host, ports, cards, operations }: { routeDeps: CredentialToolActorDeps; surfaces: CredentialToolSurfaces; host: CustomCredentialToolHost; ports: Pick<CustomCredentialToolPorts, 'credentialedRequest'>; cards: CustomCredentialSecretCards; operations: CredentialToolOperations }, _optional = {}): { create: ToolHandler; rotate: ToolHandler; pluginProvider: ToolHandler } {
  const probe: CredentialedRequestPort["probe"] = (input) => ports.credentialedRequest.probe(input);
  const handlers: { create: ToolHandler; rotate: ToolHandler; pluginProvider: ToolHandler } = {
    // An MCP-UI surface for the SECRET itself — see this file's secret-handling header
    // for the full mechanism and why it holds up "a token must never pass through the model's
    // context" rather than merely "an agent must never write one". Shape validation
    // (`rejectUnexpectedSetTokenFields`) and the label->id resolution both run BEFORE any exchange is
    // opened, same ordering `custom_credential_make_request`'s DELETE gate below uses: a malformed or
    // unresolvable call must never raise a dialog for a human to see. WRITE-gated, same permission
    // `custom_credential_set_username`/`custom_credential_make_request` use.
    rotate: async (ctx, options = {}): Promise<SetTokenResult> => {
      const input = requireInputRecord({ input: ctx.input });
      rejectUnexpectedSetTokenFields({ input, messages: operations.messages });
      const label = requireString({ input, key: "label" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });

      // Non-decrypting label->id resolution — same lookup `custom_credential_set_username` above uses,
      // and for the identical reason: a bad label should never cost a decrypt. Only `existing.id` is
      // load-bearing past this point: `saveSetToken` deliberately re-reads the username itself,
      // fresh, right before writing — see its own header for why trusting THIS snapshot's username
      // would be wrong once the human's answer can arrive an arbitrarily long time later.
      const existing = await operations.sets.byLabel({ label });
      if (!existing) {
        throw new CustomCredentialNotFoundError(operations.messages.notFoundLabel({ label }));
      }

      // Fail closed rather than degrade — and, unlike every OTHER gated tool in this codebase, there is
      // deliberately no fallback second-call shape for this one even in principle: that shape is a
      // fresh MODEL-ISSUED tool call carrying the human's answer as its own input, which is exactly the
      // path this tool exists to make impossible for a secret. See this file's header.
      // A `ToolInputError` with the wording unchanged: a bare `Error` is redacted to a 500 that
      // no allowlist rule can rescue. No code prefix — the per-tool suites pin this exact string.
      // The run ended during the pre-dialog reads: the engine opens no dialog for an aborted run.
      // `askThenReport`, not `askOnce` — the engine waits for save and replaces the same card URI.
      const locale = await operations.locale.resolve({ principalId: ctx.principal.id });
      const pluginCard = await operations.pluginCards.find({ workspaceId: routeDeps.workspaceId, saveKind: 'api', target: label });
      let errorSummary = "";
      const card = cards.defineSecretCardTool<{ label: string }, CustomCredentialSummary, SetTokenResult>({
        toolId: operations.ids.save,
        prepare: async () => ({ label }),
        form: ({ prep }) => operations.credentialCardForms.applyPlugin({ card: pluginCard, form: withCardApp({ spec: operations.credentialCardForms.rotate(prep), app: host.cardIdentity.appNames.setToken }) }),
        save: ({ values, signal }) => saveSetToken({ token: values.token as string, signal, routeDeps, operations, probe, existing, pluginCard, principalId: ctx.principal.id }),
        result: ({ run }) => {
          // Token hints belong on the human's card, never in the model-facing result or audit output.
          if (run.status === "saved") return { saved: true };
          if (run.status === "blank") return { saved: false, reason: "invalid", message: operations.locale.text({ id: "blank", locale }) };
          if (run.status === "failed") return { saved: false, reason: "error", message: run.safeMessage };
          return { saved: false, reason: run.status };
        },
        outcome: ({ run }) => {
          if (run.status === "saved") {
            const hint = operations.locale.hint({ hint: run.saved.tokenHint, locale });
            return withCardApp({ spec: operations.credentialCardForms.rotateOutcome({ label, state: "success", message: `${hint ? hint + ". " : ""}${operations.locale.text({ id: "saved", locale })}` }), app: host.cardIdentity.appNames.setTokenOutcome });
          }
          if (run.status === "blank" || run.status === "failed") return withCardApp({ spec: operations.credentialCardForms.rotateOutcome({ label, state: "failure",
            message: run.status === "blank" ? operations.locale.text({ id: "blank", locale }) : run.safeMessage }), app: host.cardIdentity.appNames.setTokenOutcome });
          return undefined;
        },
      }, {
        uriHost: host.cardIdentity.uriNamespace,
        text: { noEmitter: operations.messages.noRotateChannel },
        safeError: err => {
          // Never `err.message`: it can quote the token just submitted. See operations.formErrors.
          errorSummary = operations.diagnostics.describeError({ error: err });
          return operations.locale.translate({ message: callerSafeErrorMessage({ err, rules: operations.formErrors, fallback: operations.messages.formSaveFailure }), locale });
        },
        logFailure: ({ toolId, exchangeId }) => operations.diagnostics.rotateFailure({ toolId, exchangeId, credentialId: existing.id, errorSummary }),
      });
      return card.handler({ surfaceExchanges: surfaces.surfaceExchanges, askThenReport: cards.askThenReport })(ctx, options);
    },

    // Creates a brand-new credential row — see this file's creation-ordering header for the
    // full mechanism and the incident it closes. Unlike every other write handler in this domain, there
    // is no existing row to resolve or fail closed on before opening the form: a CREATE's row does not
    // exist yet, so the only pre-form checks are the permission gate and the `emitSurface` fail-closed
    // guard below. All three prefill fields are optional and non-secret by schema
    // in the host's API creation schema — a call with none of them is a normal, valid call.
    create: async (ctx, { emitSurface } = {}): Promise<CreateCredentialResult> => {
      // `requireInputRecord` refuses `undefined` outright, but this tool's schema has no required
      // field at all (same `required: []` shape `custom_credential_list`'s own `NO_INPUT_SCHEMA`
      // documents) — a model-issued call with no arguments at all is a normal, valid call here, not a
      // malformed one, so it is treated the same as an explicit `{}` rather than rejected.
      const input = ctx.input === undefined ? {} : requireInputRecord({ input: ctx.input });
      const prefill = readCreateCredentialPrefill({ input, operations });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });

      const providers = await operations.publish.loadProviders({});
      const locale = await operations.locale.resolve({ principalId: ctx.principal.id });
      return openCreateCard({ ctx, emitSurface, routeDeps, operations, probe, cards, surfaces, locale, initialLabel: prefill.label ?? '', cardIdentity: host.cardIdentity,
        form: () => withCardApp({ spec: operations.credentialCardForms.create({ prefill, providers }), app: host.cardIdentity.appNames.create }),
        submissionOf: values => deriveCreateCredentialSubmission({ raw: readRawCreateCredentialFields(values), operations }) });
    },

    // A plugin's own key card (credential_save kind plugin-provider): plugin copy, a masked token
    // and declared public fields, with fixed row metadata resolved on the server. Same
    // permission, save port and outcome as the generic create card. The host supplies these through operations.pluginCards.
    pluginProvider: async (ctx, { emitSurface } = {}): Promise<CreateCredentialResult> => {
      const input = requireInputRecord({ input: ctx.input });
      const providerId = requireString({ input, key: "provider" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });
      const card = (await operations.pluginCards.load({ workspaceId: routeDeps.workspaceId })).find(entry => entry.providerId === providerId);
      if (!card) throw new ToolInputError({ message: operations.messages.missingPluginCard({ providerId }) });
      const locale = await operations.locale.resolve({ principalId: ctx.principal.id });
      return openCreateCard({ ctx, emitSurface, routeDeps, operations, probe, cards, surfaces, locale, initialLabel: card.label, cardIdentity: host.cardIdentity,
        form: () => operations.credentialCardForms.buildPlugin({ card }),
        submissionOf: values => {
          const fields = operations.pluginCards.readValues({ card, values });
          return { ...deriveCreateCredentialSubmission({ raw: readRawCreateCredentialFields({ ...fields, worksFor: [] }), operations }), pluginCard: card,
            ...(fields.additionalHosts === undefined ? {} : { additionalHosts: fields.additionalHosts }) };
        } });
    },
  };
  return withModelFacingErrors({ handlers, rules: operations.modelFacingErrors }) as { create: ToolHandler; rotate: ToolHandler; pluginProvider: ToolHandler };
}

/**
 * Credential tool handlers over required host operations and core-only consumer contracts.
 *
 * @complexity O(t) wiring, plus the bounded costs of each named host operation.
 */
/** @agent-note operations.ids must exactly match catalog, metadata and risk names and the host answer routing. */
export function createCredentialToolRegistrations({ routeDeps, host, ports, operations }: { routeDeps: CredentialToolActorDeps; host: CustomCredentialToolHost; ports: CustomCredentialToolPorts; operations: CredentialToolOperations }, _optional = {}): ToolRegistration[] {
  const { credentialedRequest, sourceControlWrite } = ports;
  const handlers: Record<string, ToolHandler> = {
    // Non-decrypting read-back through the existing store, scoped by the read permission and
    // empty-input contract. Saved origins and usernames reach the model; token hints remain
    // on human surfaces. One workspace read plus O(n + c) projection for saved rows and active cards.
    [operations.ids.list]: async (ctx): Promise<{ credentials: (Omit<CustomCredentialSummary, "tokenHint"> & { pluginId?: string | undefined; usedFor?: readonly string[] })[] }> => {
      requireNoInput({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.read }, { entityType: host.vocabulary.entityType });
      const credentials = await operations.sets.list({});
      const cards = await operations.pluginCards.load({ workspaceId: routeDeps.workspaceId });
      const apiCards = new Map(cards.filter(card => card.saveKind === undefined || card.saveKind === 'api').map(card => [card.ownedApiLabel ?? card.label, card]));
      // Exact owned labels attach display copy only; usedFor never participates in key selection.
      return { credentials: credentials.map(({ tokenHint: _humanHint, ...credential }) => {
        const card = apiCards.get(credential.label);
        return card ? { ...credential, pluginId: card.pluginId, usedFor: card.usedFor ?? [] } : credential;
      }) };
    },

    [operations.ids.verify]: async (ctx) => {
      const input = requireInputRecord({ input: ctx.input });
      const label = requireString({ input, key: "label" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.read }, { entityType: host.vocabulary.entityType });
      return operations.recovery.withSetup({ label, verification: true, invoke: () => credentialedRequest.verify({ workspaceId: routeDeps.workspaceId, label }) }, {});
    },

    // The self-healing FIX half of the 401/403 diagnostic `custom_credential_verify`/
    // `custom_credential_make_request` now carry (`../credentialed-request.ts`'s `AuthFailureDiagnostic`)
    // — see this file's username-update header for the full incident and design.
    // Shape/security validation (`rejectUnexpectedSetUsernameFields`, `requireUsernameOrClearSentinel`)
    // runs BEFORE the permission check, same ordering `custom_credential_make_request` below uses — a
    // malformed call is refused on its own terms regardless of who is asking. WRITE-gated (this durably
    // changes a host-side column), and — by the owner's own standing "no confirm ceremonies" instruction
    // — deliberately NOT wrapped in the DELETE-style confirmation dialog: this field is not a secret,
    // and there is structurally no way for this call to carry one.
    [operations.ids.setUsername]: async (ctx): Promise<CustomCredentialSummary> => {
      const input = requireInputRecord({ input: ctx.input });
      rejectUnexpectedSetUsernameFields({ input, messages: operations.messages });
      const label = requireString({ input, key: "label" });
      const username = requireUsernameOrClearSentinel({ input, messages: operations.messages });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });

      // Non-decrypting label->id resolution — same lookup `resolveRequestTarget` above uses for the
      // identical reason: a bad label should never cost a decrypt, and this update never needs one
      // either (see `CustomCredentialsToolDeps.siteAssistantSecretKeyring`'s own doc).
      const existing = await operations.sets.byLabel({ label });
      if (!existing) {
        throw new CustomCredentialNotFoundError(operations.messages.notFoundLabel({ label }));
      }

      return operations.sets.setUsername({ id: existing.id, username });
    },

    // GET/POST/PUT/PATCH run immediately (no ceremony — parity with the site). DELETE opens an
    // in-chat confirmation and parks until answered; see this file's own header for the full
    // mechanism and why. All shape/security-boundary validation (`method`/`url`/`headers`/`body`,
    // label existence, host allowlist) happens inside `resolveRequestTarget`/`makeCredentialedRequest`
    // themselves — this handler's only job is deciding WHETHER to gate, never re-validating.
    [operations.ids.makeRequest]: async (ctx, { emitSurface } = {}): Promise<CredentialedRequestOutcome | CredentialToolSetupFailure> => {
      ctx = { ...ctx, input: structuredClone(ctx.input), principal: { ...ctx.principal }, run: { ...ctx.run } };
      const input = requireInputRecord({ input: ctx.input });
      const label = requireString({ input, key: "label" });
      const method = requireString({ input, key: "method" });
      const url = requireString({ input, key: "url" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });

      if (method !== "DELETE") {
        return operations.recovery.withSetup({ label, url, invoke: () => makeModelFacingCredentialedRequest({ port: credentialedRequest, input: { workspaceId: routeDeps.workspaceId, label, method, url, headers: input.headers, body: input.body }, catalog: host.vocabulary.catalog, toolId: operations.ids.makeRequest }) }, {});
      }

      // Non-decrypting: a declined/expired/off-allowlist DELETE must never have cost a decrypt.
      // Classify the original preflight rejection once before map-level message publication.
      // Preserve the validation class and existing DELETE text; only caller-safe copy may enter it.
      // Other rejection identities stay unchanged. Schema decoration here would change that text.
      const target = await operations.recovery.withSetup({ label, url, invoke: async () => {
        try { return await credentialedRequest.resolveTarget({ workspaceId: routeDeps.workspaceId, label, url }); }
        catch (error) {
          const classified = credentialedRequest.classifyError({ error });
          if (classified.category === "validation") throw new CredentialedRequestValidationError({ message: classified.callerSafeMessage });
          throw error;
        }
      } }, {});
      if ("credentialSetup" in target) return target;

      // Fail closed rather than degrade — same posture `content_post_delete`'s own handler documents:
      // an execution context that cannot hold this call open cannot run a gated DELETE at all.
      if (!emitSurface) {
        // A `ToolInputError` with the wording unchanged: a bare `Error` is redacted to a 500 that
        // no allowlist rule can rescue. No code prefix — the per-tool suites pin this exact string.
        throw new ToolInputError({ message: operations.messages.noDeleteChannel });
      }

      // A run aborted during reconnaissance must not proceed to the external commit.
      if (ctx.signal.aborted) return { executed: false, cancelled: false, reason: "abandoned" };
      return operations.approval.handler({
        prepare: async () => ({ label: target.label, host: target.url.host, path: `${target.url.pathname}${target.url.search}` }),
        describe: ({ prepared }) => ({ ask: true, description: operations.approval.describeDelete(prepared) }),
        askHuman: (required, optional) => operations.approval.askHuman(required, optional),
        run: async ({ ctx: approvedCtx }) => {
          await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: approvedCtx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });
          if (approvedCtx.signal.aborted) return { executed: false, cancelled: false, reason: "abandoned" };
          const frozen = requireInputRecord({ input: approvedCtx.input });
          return operations.recovery.withSetup({ label, url, invoke: () => makeModelFacingCredentialedRequest({ port: credentialedRequest, input: { workspaceId: routeDeps.workspaceId, label, method: "DELETE", url, headers: frozen.headers, body: frozen.body }, catalog: host.vocabulary.catalog, toolId: operations.ids.makeRequest }) }, {});
        },
        notConfirmed: ({ reason }) => reason === "declined" ? { executed: false, cancelled: true } : { executed: false, cancelled: false, reason },
      })(ctx, { emitSurface }) as Promise<CredentialedRequestOutcome | CredentialToolSetupFailure>;
    },

    // See this file's header for file-write validation, provider-plan and freshness boundaries.
    [operations.ids.writeFiles]: async (ctx): Promise<WriteFilesResult> => {
      const input = requireInputRecord({ input: ctx.input });
      const label = requireString({ input, key: "label" });
      const shapeRejection = { toolId: operations.ids.writeFiles, catalog: host.vocabulary.catalog, isShapeRejection: ({ error }: { error: unknown }) => isWriteFilesShapeRejection(error) };
      const request = await withSchemaOnRejection({ ...shapeRejection, fn: async () =>
        operations.policy.validateWriteFiles({ branch: input.branch, commitMessage: input.commitMessage, files: input.files })
      });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: host.vocabulary.permissions.write }, { entityType: host.vocabulary.entityType });

      // The host first, from the credential's plaintext base URL (no decrypt): its owner/repo rules
      // decide whether this call is well formed at all.
      const summary = await operations.sets.byLabel({ label });
      if (!summary) {
        throw new CustomCredentialNotFoundError(operations.messages.notFoundLabel({ label }));
      }
      const built = await sourceControlWrite.build({ workspaceId: routeDeps.workspaceId, baseUrl: summary.baseUrl });
      if (!built.ok) throw new Error(operations.messages.writeFailure({ message: built.message }));
      const provider = built.provider;
      const target = await withSchemaOnRejection({ ...shapeRejection, fn: async () => sourceControlWrite.validateTarget({ provider, target: { owner: input.owner, repo: input.repo } }) });
      const validated: ValidatedWriteFilesInput = { ...request, ...target };

      // A DECRYPTING resolve: the plan phase's read-only host calls need the token regardless of
      // whether the human goes on to confirm. The row was just seen above; one deleted in between
      // is the same not-found refusal.
      const resolved = await operations.sets.resolve({ label });
      if (!resolved) {
        throw new CustomCredentialNotFoundError(operations.messages.notFoundLabel({ label }));
      }

      const planResult = await sourceControlWrite.planFileWrite({ provider, input: { ...writeTarget(resolved, validated), branch: validated.branch, files: validated.files } });
      if (!planResult.ok) {
        operations.diagnostics.writeFailure({ phase: "plan", failure: planResult });
        throw new Error(operations.messages.writeFailure({ message: planResult.message }));
      }

      // A run aborted during reconnaissance must not proceed to the external commit.
      if (ctx.signal.aborted) return { executed: false, cancelled: false, reason: "abandoned" };
      return performRepositoryFilesWrite({ operations, port: sourceControlWrite, provider, resolved, validated, plan: planResult.plan });
    },
  };

  return buildDomainRegistrations({ metadata: host.vocabulary.metadata,
    domain: host.vocabulary.domain,
    catalogModule: host.vocabulary.catalogModule,
    catalog: host.vocabulary.catalog,
    handlers: withModelFacingErrors({ handlers, rules: operations.modelFacingErrors }),
    derivedRisk: operations.derivedRisk,
  });
}
