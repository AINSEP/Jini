/**
 * @file The CMS-specific visitor-tools host contract: the one injected bundle (`VisitorToolsHostContract`)
 * the moved management code needs. The shared policy and catalog types live in Core
 * (`@jini-ai/core/contracts/site/site-assistant-visitor-tools-management`); the host keeps the policy
 * parser, its validation error, the stored setting coordinates, permission and limits, binds them once and
 * passes the bundle through each moved function's existing deps/args.
 */
import type { VisitorToolChoice, VisitorToolLimits, VisitorToolPolicy } from "@jini-ai/core/contracts/site/site-assistant-visitor-tools-management";

/** The host's visitor-tools policy contract, bound once by the host and passed as `visitorTools`. */
export interface VisitorToolsHostContract {
  /** Where the policy is stored (`{ namespace, key }`). */
  readonly setting: { readonly namespace: string; readonly key: string };
  /** The dedicated management permission every read and write requires. */
  readonly permission: string;
  readonly defaultLimits: VisitorToolLimits;
  readonly callsPerTurn: number;
  /** The host's validation error: thrown for invalid input, recognised with `instanceof`. */
  readonly ValidationError: new (message: string) => Error;
  /** Require an object, optionally closed to the given keys; throws `ValidationError`. */
  readonly object: (required: { value: unknown; keys?: readonly string[] }) => Record<string, unknown>;
  /** Validate bounded stored JSON or management input; throws `ValidationError`. */
  readonly parsePolicy: (required: { value: unknown }) => VisitorToolPolicy;
  /** The effective choice for one tool under a parsed policy. */
  readonly resolveChoice: (required: { policy: VisitorToolPolicy; toolId: string }) => VisitorToolChoice;
}
