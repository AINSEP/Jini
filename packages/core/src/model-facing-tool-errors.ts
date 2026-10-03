/**
 * Ordered domain-owned allowlists for safe model-facing failures. Unknown throws are unchanged.
 * Rule evaluation is O(r); container wrapping O(n), with no I/O or reporting dependencies.
 */
// Tool transports redact unknown throws as internal failures. Leaving known domain refusals there
// made validation/not-found/permission errors look like identical crashes, preventing recovery.
// Domains explicitly own which classes/messages are safe to expose, including anonymous callers:
// stacks, internal paths, SQL, credentials, and another tenant's data must remain unlisted/redacted.
import { ToolInputError, type ToolHandler, type ToolRegistration } from "./tool-registry.js";

// Stable code prefixes let callers match failure kinds without parsing mutable prose. Guidance is
// only needed when the next action is unclear (such as rereading a conflicted version).
export interface ModelFacingErrorRule {
  // Constructor shape is open so domains can list classes with additional constructor fields.
  readonly error: abstract new (...args: never[]) => Error;
  readonly code: string;
  // A safe class KIND can still wrap unsafe driver/sealer/keyring text. Supply fixed text for it;
  // omission is correct only when all construction sites build safe messages from caller-owned input.
  // Thrown failures need the same override as returned failures, or an operator-fixable kind would
  // remain INTERNAL_ERROR solely because its original message could disclose secrets or paths.
  readonly message?: string;
  readonly guidance?: string;
}

export function forbiddenRule(required: { domainPrefix: string; error: ModelFacingErrorRule["error"] }): ModelFacingErrorRule {
  return { error: required.error, code: `${required.domainPrefix}_FORBIDDEN` };
}

// First match wins: list subclasses before superclasses. Unmatched values must retain identity so
// the transport's redaction remains the default; already-classified ToolInputError also stays intact
// to avoid doubling a prefix attached by schema/recovery wrapping.
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
export interface CallerSafeErrorRule {
  readonly error: abstract new (...args: never[]) => Error;
  // Publish fixed safe text if a useful error kind embeds another component's unsafe message.
  readonly message?: string;
}

// Unknown classes, raw driver errors, and non-Error throws get fixed fallback text, never raw error
// content. The fallback itself must not be derived from err; first matching rule still wins.
export function callerSafeErrorMessage(required: { err: unknown; rules: readonly CallerSafeErrorRule[]; fallback: string }): string {
  const { err, rules, fallback } = required;
  for (const rule of rules) {
    if (err instanceof rule.error) return rule.message ?? err.message;
  }
  return fallback;
}

