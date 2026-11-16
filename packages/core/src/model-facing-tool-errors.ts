/**
 * Ordered domain-owned allowlists for safe model-facing failures. Unknown throws are unchanged.
 * Rule evaluation is O(r); container wrapping O(n), with no I/O or reporting dependencies.
 */
// Tool transports redact unknown throws as internal failures. Leaving known domain refusals there
// made validation/not-found/permission errors look like identical crashes, preventing recovery.
// Domains explicitly own which classes/messages are safe to expose, including anonymous callers:
// stacks, internal paths, SQL, credentials, and another tenant's data must remain unlisted/redacted.
import { redactSecrets } from "./redact.js";
import { ToolInputError, type ToolHandler, type ToolRegistration } from "./tool-registry.js";

// Stable code prefixes let callers match failure kinds without parsing mutable prose. Guidance is
// only needed when the next action is unclear (such as rereading a conflicted version).
/**
 * One entry in a domain's allowlist: an error class, and the stable code prefix its message is
 * published to the model under.
 *
 * The code is prepended before a `: ` separator (`MEMBERS_NOT_FOUND: member 'x' was not found`) so
 * a model — and a test — can match on a stable token without parsing prose, mirroring the prefix
 * convention `features/widgets/tool-registrations.ts` already shipped.
 *
 * `guidance`, when present, is appended after the message. Use it only for a failure where the
 * caller's next action is not obvious from the message alone (a version conflict that needs a
 * re-read, say); a not-found needs no coaching.
 */
// Constructor shape is open so domains can list classes with additional constructor fields.
// A safe class KIND can still wrap unsafe driver/sealer/keyring text. Supply fixed text for it;
// omission is correct only when all construction sites build safe messages from caller-owned input.
// Thrown failures need the same override as returned failures, or an operator-fixable kind would
// remain INTERNAL_ERROR solely because its original message could disclose secrets or paths.
export interface ModelFacingErrorRule {
  /** The class to match with `instanceof`. Declared to accept any constructor shape so a domain can
   *  list an error class whose constructor takes extra fields. */
  readonly error: abstract new (...args: never[]) => Error;
  /** The stable code published before `: `. Conventionally `<DOMAIN>_<REASON>`, SCREAMING_SNAKE. */
  readonly code: string;
  /** Published INSTEAD of the error's own message. Set it for a class whose KIND is the actionable
   *  reason a caller needs but whose TEXT is not safe to publish — one that wraps another
   *  component's error (a sealer's, a driver's, a keyring's), which can carry plaintext, an internal
   *  address, an env var name or an absolute path. Omit it to publish the class's own message
   *  verbatim, which is only correct when every construction site builds that message from fixed
   *  text and the caller's own input.
   *
   *  The same field, for the same reason, as {@link CallerSafeErrorRule.message} — these two
   *  allowlists are the RETURNED-result and THROWN-rejection halves of one policy, and a class whose
   *  kind is safe to name on one half is safe to name on the other. They drifted until 2026-09-18:
   *  `features/custom-credentials` listed `CustomCredentialSecretStoreUnconfiguredError` with a fixed
   *  message in its `CallerSafeErrorRule` allowlist, but could not list it here at all, because the
   *  only thing this shape could publish was the very text that had to stay in. A missing site root
   *  key — the one operator-fixable failure in that domain — therefore reached the model as a bare
   *  `INTERNAL_ERROR` on every credential-using tool. */
  readonly message?: string;
  /** Optional recovery guidance appended after the message. */
  readonly guidance?: string;
}

/**
 * The code every domain publishes an authorization refusal under, parameterized by domain prefix.
 *
 * Exists because `ForbiddenError` is the ONE class in this ladder that no domain declares: the kit's
 * `requireToolPermission` throws it on every domain's behalf. Deriving the rule here rather than
 * retyping `{ error: ForbiddenError, code: "X_FORBIDDEN" }` in six files means a later decision to
 * reconcile this code with the HTTP arm's own `FORBIDDEN` is a one-line change here, not a sweep.
 *
 * NOTE (2026-09-16): the model-facing and HTTP arms disagree on this code today — the HTTP mappers
 * return `FORBIDDEN` while the model-facing arm returns `<DOMAIN>_FORBIDDEN`. That drift predates
 * this file (see `features/widgets/tool-registrations.ts`'s `toModelFacingWidgetsError` doc, which
 * documented it for Widgets) and is owned elsewhere. This helper deliberately matches the SHIPPED
 * model-facing convention rather than inventing a third spelling.
 *
 * The refusal message `requireToolPermission` builds names the principal, the permission, and the
 * `authorize()` reason — no data, no internals. Surfacing it tells a model whether to stop asking
 * or to ask a human for access; redacting it tells it only that something broke.
 *
 * @param required.domainPrefix - The domain's SCREAMING_SNAKE prefix, e.g. `MEMBERS`.
 * @param required.error - The consumer's permission-error class; core has no CMS dependency.
 * @returns The rule to place in that domain's allowlist.
 * @complexity O(1).
 */
export function forbiddenRule(required: { domainPrefix: string; error: ModelFacingErrorRule["error"] }): ModelFacingErrorRule {
  return { error: required.error, code: `${required.domainPrefix}_FORBIDDEN` };
}

// First match wins: list subclasses before superclasses. Unmatched values must retain identity so
// the transport's redaction remains the default; already-classified ToolInputError also stays intact
// to avoid doubling a prefix attached by schema/recovery wrapping.
/**
 * Re-classifies one rejection against a domain's allowlist, so a listed domain error reaches the
 * model as a `ToolInputError` carrying its real message instead of a redacted `INTERNAL_ERROR`.
 *
 * Rules are evaluated IN ORDER and the first `instanceof` match wins, so a domain listing both a
 * subclass and its superclass must place the subclass first — the same ordering discipline any
 * hand-written `instanceof` ladder carries, made explicit here because an array hides it less than
 * a chain of `if`s does.
 *
 * A matched rule publishes the error's own message, or {@link ModelFacingErrorRule.message} instead
 * when the rule sets one — see that field for which classes need it and why.
 *
 * An already-`ToolInputError` rejection is returned untouched: it is already correctly classified,
 * and re-wrapping it would double a code prefix that a `withSchemaOnRejection` wrap may have
 * already attached.
 *
 * @param required.err - The rejection, of unknown type — anything a handler can throw.
 * @param required.rules - The domain's allowlist. Anything unmatched is returned UNCHANGED and stays
 * redacted; see this file's header for why that default is the security-relevant half.
 * @returns The value to re-throw: a `ToolInputError` for a matched rule, otherwise `err` itself.
 * @complexity O(r) in the rule count, on the failure path only.
 */
export function reclassifyToolError(required: { err: unknown; rules: readonly ModelFacingErrorRule[] }): unknown {
  const { err, rules } = required;
  if (err instanceof ToolInputError) return err;
  for (const rule of rules) {
    if (err instanceof rule.error) {
      const message = `${rule.code}: ${rule.message ?? err.message}`;
      return new ToolInputError({ message: rule.guidance ? `${message}. ${rule.guidance}` : message });
    }
  }
  return err;
}

// Wrap the whole map once: a correct per-handler converter previously reached only one handler
// while sibling operations still leaked into the internal-error redactor. Central wrapping has no
// omitted call-site arm, and successful results pass through untouched.
/**
 * Wraps EVERY handler in a domain's map with {@link reclassifyToolError}, returning a new map.
 *
 * Wrapping the whole map once — rather than reclassifying at each call site — is the point. This
 * codebase's dominant defect is a correct primitive with an unwired call site, and a per-call-site
 * reshape is exactly that defect waiting to happen: `features/post/tool-registrations.ts` had a
 * correct `toModelFacingUpdateError` wired into ONE of its handlers while its siblings kept
 * throwing the same class straight through to the redactor. A map-level wrap cannot have a missed
 * arm, because it has no arms.
 *
 * The wrap is transparent on the success path: the handler's own return value is passed through
 * untouched, and only the `catch` does work.
 *
 * @param required.handlers - The domain's handler map, keyed by tool id.
 * @param rules - The domain's allowlist, applied identically to every handler.
 * @returns A new map with the same keys; the input map is not mutated.
 * @complexity O(h) handlers wrapped once at build time; O(r) per failed call, none per successful one.
 */
export function withModelFacingErrors(
  required: { handlers: Readonly<Record<string, ToolHandler>>; rules: readonly ModelFacingErrorRule[] }
): Record<string, ToolHandler> {
  const { handlers, rules } = required;
  return Object.fromEntries(
    Object.entries(handlers).map(([toolId, handler]) => [
      toolId,
      async (ctx: Parameters<ToolHandler>[0], optional: Parameters<ToolHandler>[1] = {}) => {
        try {
          return await handler(ctx, optional);
        } catch (err) {
          throw reclassifyToolError({ err, rules });
        }
      },
    ])
  );
}

// Registration-array builders need the same blanket coverage as handler maps. Preserve descriptor,
// policy, ordering, and successful results; only the rejection path is reclassified.
/**
 * Wraps EVERY registration's handler in a domain's `ToolRegistration[]` with
 * {@link reclassifyToolError}, returning a new array. The `ToolRegistration[]`-shaped sibling of
 * {@link withModelFacingErrors} — for the registry-converted domains whose `build*Registrations`
 * returns an array of `{descriptor, handler, policy}` (see `assistant/tool-contribution-registry.ts`'s
 * `ToolContributor.build`) rather than a `Record<toolId, handler>`. `features/entries`,
 * `features/content-types`, `features/navigation` and `features/workspace` are re-exported Jini
 * builders of exactly this shape — see each one's `contribute*Tools`.
 *
 * Same transparency guarantee as {@link withModelFacingErrors}: only the `catch` arm does work, and
 * every other field of each registration (`descriptor`, `policy`) passes through unchanged.
 *
 * @param required.registrations - The domain's registrations, in whatever order `build*Registrations`
 * returned them.
 * @param rules - The domain's allowlist, applied identically to every registration.
 * @returns A new array with the same length and order; the input array is not mutated.
 * @complexity O(n) registrations wrapped once at build time; O(r) per failed call, none per successful one.
 */
export function withModelFacingRegistrationErrors(
  required: { registrations: readonly ToolRegistration[]; rules: readonly ModelFacingErrorRule[] }
): ToolRegistration[] {
  const { registrations, rules } = required;
  return registrations.map((registration) => ({
    ...registration,
    handler: (async (ctx: Parameters<ToolHandler>[0], optional: Parameters<ToolHandler>[1] = {}) => {
      try {
        return await registration.handler(ctx, optional);
      } catch (err) {
        throw reclassifyToolError({ err, rules });
      }
    }) as ToolHandler,
  }));
}

// Returned failure objects bypass transport throw-redaction, so they require the same explicit
// class allowlist. No code prefix: these results already carry a reason and may render to a human.
/**
 * One entry in a structured-result allowlist — see {@link callerSafeErrorMessage}.
 *
 * No `code`: a structured result already carries its own `reason` discriminant, and its message is
 * often rendered to a human as-is, so no prefix is added.
 */
// Publish fixed safe text if a useful error kind embeds another component's unsafe message.
export interface CallerSafeErrorRule {
  /** The class to match with `instanceof`. Same constructor shape as {@link ModelFacingErrorRule.error}. */
  readonly error: abstract new (...args: never[]) => Error;
  /** Published INSTEAD of the error's own message. Set it for a class whose KIND is safe and worth
   *  naming but whose message is not — one that embeds another error's text. Omit it to publish the
   *  class's own message verbatim, which is only correct when every construction site builds that
   *  message from fixed text and the caller's own input. */
  readonly message?: string;
}

// Unknown classes, raw driver errors, and non-Error throws get fixed fallback text, never raw error
// content. The fallback itself must not be derived from err; first matching rule still wins.
/**
 * The message a RETURNED failure result may carry for `err`: a listed class's message (or its fixed
 * replacement), otherwise `fallback`.
 *
 * Unknown means redacted. An error class added tomorrow, a raw driver error, or a non-`Error` throw
 * all get `fallback`, never their own text. Rules are evaluated in order; the first `instanceof`
 * match wins.
 *
 * @param required.err - The caught value, of unknown type.
 * @param required.rules - The allowlist.
 * @param required.fallback - Fixed text for everything unlisted. Must not be built from `err`.
 * @returns The message to publish.
 * @complexity O(r) in the rule count.
 */
export function callerSafeErrorMessage(required: { err: unknown; rules: readonly CallerSafeErrorRule[]; fallback: string }): string {
  const { err, rules, fallback } = required;
  for (const rule of rules) {
    if (err instanceof rule.error) return rule.message ?? err.message;
  }
  return fallback;
}
/** A constant token: the only shape a registered code may have (checked once, at registration). */
const CONSTANT_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
/** A class label: an identifier, checked once when a describer is built. */
const CLASS_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// Codes are approved by listing, never by shape: an uppercase run is not evidence that a value is a
// code (a token or key can look exactly like one). A package adds its own constants through
// `createErrorDescriber`, which builds a separate describer and never mutates this built-in list.
const LOGGABLE_CODES: ReadonlySet<string> = new Set<string>([
  // Node system errors: every libuv errno name (`util.getSystemErrorMap()`), plus dns's ENOTFOUND.
  // why: owner ruling 2026-11-15: errno names are fixed vocabulary, not user text. Kept as a list,
  // not an `E[A-Z0-9_]+` rule, because a thrown value's `code` is caller text and could be a secret.
  "E2BIG", "EACCES", "EADDRINUSE", "EADDRNOTAVAIL", "EAFNOSUPPORT", "EAGAIN", "EAI_ADDRFAMILY", "EAI_AGAIN",
  "EAI_BADFLAGS", "EAI_BADHINTS", "EAI_CANCELED", "EAI_FAIL", "EAI_FAMILY", "EAI_MEMORY", "EAI_NODATA",
  "EAI_NONAME", "EAI_OVERFLOW", "EAI_PROTOCOL", "EAI_SERVICE", "EAI_SOCKTYPE", "EALREADY", "EBADF", "EBUSY",
  "ECANCELED", "ECHARSET", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EDESTADDRREQ", "EEXIST", "EFAULT",
  "EFBIG", "EFTYPE", "EHOSTDOWN", "EHOSTUNREACH", "EILSEQ", "EINTR", "EINVAL", "EIO", "EISCONN", "EISDIR",
  "ELOOP", "EMFILE", "EMLINK", "EMSGSIZE", "ENAMETOOLONG", "ENETDOWN", "ENETUNREACH", "ENFILE", "ENOBUFS",
  "ENODATA", "ENODEV", "ENOENT", "ENOEXEC", "ENOMEM", "ENONET", "ENOPROTOOPT", "ENOSPC", "ENOSYS",
  "ENOTCONN", "ENOTDIR", "ENOTEMPTY", "ENOTFOUND", "ENOTSOCK", "ENOTSUP", "ENOTTY", "ENXIO", "EOF",
  "EOVERFLOW", "EPERM", "EPIPE", "EPROTO", "EPROTONOSUPPORT", "EPROTOTYPE", "ERANGE", "EREMOTEIO", "EROFS",
  "ESHUTDOWN", "ESOCKTNOSUPPORT", "ESPIPE", "ESRCH", "ETIMEDOUT", "ETXTBSY", "EUNATCH", "EXDEV",
  // Node and undici (fetch)
  "ABORT_ERR", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE", "ERR_INVALID_CHAR", "ERR_INVALID_URL",
  "ERR_SOCKET_CLOSED", "ERR_STREAM_PREMATURE_CLOSE", "UND_ERR_ABORTED", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
  // SQLite
  "SQLITE_BUSY", "SQLITE_CANTOPEN", "SQLITE_CONSTRAINT", "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CORRUPT",
  "SQLITE_FULL", "SQLITE_IOERR", "SQLITE_LOCKED", "SQLITE_READONLY",
]);

/** The built-in approved codes `describeErrorForLog` may print. Never written after load. */
export const LOGGABLE_ERROR_CODES: ReadonlySet<string> = LOGGABLE_CODES;

type ErrorClass = abstract new (...args: never[]) => Error;

/** Built-in classes, most specific first. The label is a literal, never read from the value: a
 *  class's or an instance's `name` is caller-controlled text and can carry a credential. */
const BUILT_IN_ERROR_LABELS: readonly (readonly [ErrorClass, string])[] = [
  [ToolInputError, "ToolInputError"],
  [AggregateError, "AggregateError"],
  [TypeError, "TypeError"],
  [RangeError, "RangeError"],
  [SyntaxError, "SyntaxError"],
  [ReferenceError, "ReferenceError"],
  [URIError, "URIError"],
  [EvalError, "EvalError"],
];

/** `name` values worth naming (DOMException and Node abort/timeout errors). Printed only when the
 *  value equals one of these fixed strings. */
const WELL_KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set(["AbortError", "TimeoutError"]);

/** A registered error class and the fixed label it is logged as. */
type LabelledErrorClass = { readonly error: ErrorClass; readonly label: string };

/** What a describer may print: approved codes and package-supplied classes (checked newest first so a subclass listed after its base wins). */
interface ErrorVocabulary {
  readonly codes: ReadonlySet<string>;
  readonly classes: readonly LabelledErrorClass[];
}

/** One package's additions to what a describer may print. */
export interface ErrorDescriberVocabulary {
  /** Constant codes the package's own errors set (`PLUGIN_ID_CONFLICT`). */
  readonly codes?: readonly string[];
  /** The package's own error classes and the fixed label each is logged as. */
  readonly classes?: readonly LabelledErrorClass[];
}

/** The describers returned by {@link createErrorDescriber}. */
export interface ErrorDescriber {
  describeErrorParts(required: { err: unknown }, _optional?: Record<string, never>): ErrorLogParts;
  describeErrorForLog(required: { err: unknown }, _optional?: Record<string, never>): string;
}

const BUILT_IN_VOCABULARY: ErrorVocabulary = { codes: LOGGABLE_CODES, classes: [] };

/** Fixed text logged when an error object cannot even be inspected. */
const UNDESCRIBABLE_ERROR = "[diagnostic unavailable]";
/** A field whose getter threw. */
const UNREADABLE = Symbol("unreadable field");

// A log call sits inside a catch block. If describing the error throws (a throwing getter, a revoked
// Proxy), the logger replaces the real failure with its own, so every read of the caught value is
// guarded HERE, once — callers must not wrap this in try/catch. Each field is read at most once, so a
// getter cannot pass a check with one value and be printed with another.
/** One field of a caught error, read once; `UNREADABLE` when its getter throws. */
function readFieldOnce({ value, key }: { readonly value: Error; readonly key: "code" | "name" | "cause" }): unknown {
  try {
    return (value as unknown as Record<string, unknown>)[key];
  } catch {
    return UNREADABLE;
  }
}

/** A fixed label chosen by class checks. Throws only when `instanceof` itself throws. */
function errorClassLabel({ value, vocabulary }: { readonly value: Error; readonly vocabulary: ErrorVocabulary }): string {
  for (let index = vocabulary.classes.length - 1; index >= 0; index -= 1) {
    const entry = vocabulary.classes[index];
    if (entry !== undefined && value instanceof entry.error) return entry.label;
  }
  const builtIn = BUILT_IN_ERROR_LABELS.find(([errorClass]) => value instanceof errorClass);
  if (builtIn !== undefined) return builtIn[1];
  const name = readFieldOnce({ value, key: "name" });
  return typeof name === "string" && WELL_KNOWN_ERROR_NAMES.has(name) ? name : "Error";
}

/** The fixed class label and approved code of one value, as {@link describeErrorForLog} prints them. */
export interface ErrorLogParts {
  /** A fixed class label (`TypeError`, a registered label), `typeof` for a non-`Error`, or `[diagnostic unavailable]`. */
  readonly label: string;
  /** An approved code (`ECONNREFUSED`); absent when the value has none. */
  readonly code?: string;
}

/** Label and approved code for one thrown value, plus its direct cause when asked for. Never throws. */
function readErrorParts({ value, vocabulary }: { readonly value: unknown; readonly vocabulary: ErrorVocabulary }, { withCause = false }: { readonly withCause?: boolean } = {}): ErrorLogParts & { readonly cause?: unknown } {
  try {
    if (!(value instanceof Error)) return { label: typeof value };
    const label = errorClassLabel({ value, vocabulary });
    const code = readFieldOnce({ value, key: "code" });
    const parts = typeof code === "string" && vocabulary.codes.has(code) ? { label, code } : { label };
    return withCause ? { ...parts, cause: readFieldOnce({ value, key: "cause" }) } : parts;
  } catch {
    return { label: UNDESCRIBABLE_ERROR };
  }
}

/** Longest message a log line carries; a stack-sized message is cut, not dropped. */
const MAX_LOGGED_MESSAGE_CHARS = 300;

/** The message of an Error, secret-redacted and truncated; `undefined` when empty or unreadable. Never throws. */
function redactedMessage({ value }: { readonly value: unknown }): string | undefined {
  try {
    if (!(value instanceof Error)) return undefined;
    const raw = value.message;
    if (typeof raw !== "string" || raw.length === 0) return undefined;
    // why: the message is what says what failed ("EACCES: permission denied", "offline"); the shared
    // credential policy masks tokens/keys, and the cut keeps one failure from flooding a log line.
    const clean = redactSecrets({ input: raw.length > MAX_LOGGED_MESSAGE_CHARS ? `${raw.slice(0, MAX_LOGGED_MESSAGE_CHARS)}…` : raw });
    return clean.replace(/\s+/g, " ").trim() || undefined;
  } catch {
    return undefined; // why: a throwing message getter must not replace the failure being logged; label + code still print.
  }
}

/** `Label(CODE): message` for one thrown value, plus its direct cause when asked for. Never throws. */
function describeValueForLog({ value, vocabulary }: { readonly value: unknown; readonly vocabulary: ErrorVocabulary }, { withCause = false }: { readonly withCause?: boolean } = {}): { readonly text: string; readonly cause?: unknown } {
  const { label, code, cause } = readErrorParts({ value, vocabulary }, { withCause });
  const head = code === undefined ? label : `${label}(${code})`;
  const message = redactedMessage({ value });
  const text = message === undefined ? head : `${head}: ${message}`;
  return withCause ? { text, cause } : { text };
}

/**
 * The same fixed class label and approved code {@link describeErrorForLog} prints, as fields, without
 * the cause. For a caller that needs one low-cardinality label (a telemetry `error.type`) rather than a
 * log line, so it never parses `Label(CODE) cause=…`. Same guarantee: no message, no raw `name`, no
 * unapproved code.
 * @param required.err - The caught value.
 * @returns `{ label }` or `{ label, code }`. Never throws.
 * @complexity O(registered classes).
 */
export function describeErrorParts(required: { err: unknown }, _optional: Record<string, never> = {}): ErrorLogParts {
  return partsFor({ err: required.err, vocabulary: BUILT_IN_VOCABULARY });
}

function partsFor({ err, vocabulary }: { readonly err: unknown; readonly vocabulary: ErrorVocabulary }): ErrorLogParts {
  const { label, code } = readErrorParts({ value: err, vocabulary });
  return code === undefined ? { label } : { label, code };
}

/**
 * What a log line may say about an error whose message is NOT known to be safe: a fixed class label
 * (built-in classes, core's `ToolInputError`, classes packages registered, or the well-known
 * `AbortError`/`TimeoutError` names), an approved `code`, and the same for its direct `cause`. Never
 * the message, the stack, the class's or instance's own `name`, or any other field: they can quote
 * a secret — `JSON.parse` quotes its input, a sealer is handed plaintext, a class name is just text.
 *
 * Use it wherever the raw message could carry a credential. Where a class's message is designed for
 * logs (`EgressRefusedError.message`), log that instead.
 *
 * @param required.err - The caught value.
 * Never throws: an error that cannot be inspected is described as `[diagnostic unavailable]` (an
 * unreadable cause as `cause=[diagnostic unavailable]`, an unreadable code is left out), so call it
 * directly inside a catch block. Full detail belongs to a host sink, which receives the error object.
 *
 * @returns e.g. `Error(SQLITE_BUSY)`, or `TypeError cause=Error(ECONNREFUSED)`.
 * @complexity O(registered classes); reads only the value and its direct cause, each field once.
 */
export function describeErrorForLog(required: { err: unknown }, _optional: Record<string, never> = {}): string {
  return lineFor({ err: required.err, vocabulary: BUILT_IN_VOCABULARY });
}

function lineFor({ err, vocabulary }: { readonly err: unknown; readonly vocabulary: ErrorVocabulary }): string {
  const head = describeValueForLog({ value: err, vocabulary }, { withCause: true });
  if (head.cause === undefined) return head.text;
  const cause = head.cause === UNREADABLE ? UNDESCRIBABLE_ERROR : describeValueForLog({ value: head.cause, vocabulary }).text;
  return `${head.text} cause=${cause}`;
}

/**
 * Builds a describer that also names a package's own error classes and constant codes. The built-in
 * describers are untouched: the returned one reads a new set (built-in codes plus `codes`), so a
 * code added for one describer is not loggable through another. Nothing a caught value carries can
 * extend the vocabulary.
 * @param required.codes Constant tokens (`[A-Z][A-Z0-9_]*`, at most 64 chars).
 * @param required.classes Error classes with an identifier label.
 * @returns `{ describeErrorParts, describeErrorForLog }` over the extended vocabulary.
 * @throws TypeError for a code or label of any other shape (a programming error).
 * @complexity O(codes + classes) to build; O(classes) per described value.
 */
export function createErrorDescriber(required: ErrorDescriberVocabulary, _optional: Record<string, never> = {}): ErrorDescriber {
  const { codes = [], classes = [] } = required;
  const badCode = codes.find(code => !CONSTANT_TOKEN.test(code));
  if (badCode !== undefined) throw new TypeError("createErrorDescriber: a code must be a constant token like PLUGIN_ID_CONFLICT.");
  if (classes.some(entry => !CLASS_LABEL.test(entry.label))) throw new TypeError("createErrorDescriber: a class label must be an identifier.");
  const vocabulary: ErrorVocabulary = { codes: new Set([...LOGGABLE_CODES, ...codes]), classes: [...classes] };
  return {
    describeErrorParts: (args, _optional = {}) => partsFor({ err: args.err, vocabulary }),
    describeErrorForLog: (args, _optional = {}) => lineFor({ err: args.err, vocabulary }),
  };
}
