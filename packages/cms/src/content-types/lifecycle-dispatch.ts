import type { ClockPort } from "../core/ports.js";
import { deprecateContentType, reactivateContentType, tombstoneContentType } from "./lifecycle.js";
import type { AuthorizeFn, ContentTypeRepoPort, OutboxPort } from "./write-service.js";
import type { TeardownIndexProvisionerPort } from "./lifecycle.js";
import type { ActorPrincipalKind, ContentTypeRecord, Result } from "./types.js";

/**
 * @file Content-type lifecycle `op` dispatch (ADR-042's closed-union-dispatch convention,
 * `features/settings/definitions-dispatch.ts`'s pattern reused verbatim for this domain).
 *
 * Purpose:
 * The admin lifecycle route (`routes/admin/content-types/lifecycle.ts`) accepts an untrusted `op`
 * string in the request body. Per ADR-042 item 2's binding rule, that string is narrowed to this
 * closed 3-entry union at the parse boundary (`parseContentTypeLifecycleOp`) BEFORE any dispatch
 * table lookup — never a raw `Record<string, Handler>` keyed by the unparsed value.
 */

export const CONTENT_TYPE_LIFECYCLE_OP_NAMES = ["deprecate", "reactivate", "tombstone"] as const;
export type ContentTypeLifecycleOp = (typeof CONTENT_TYPE_LIFECYCLE_OP_NAMES)[number];

/** Narrows an untrusted `op` string to {@link ContentTypeLifecycleOp}, or `null` if it isn't one. */
export function parseContentTypeLifecycleOp(op: unknown): ContentTypeLifecycleOp | null {
  return typeof op === "string" && (CONTENT_TYPE_LIFECYCLE_OP_NAMES as readonly string[]).includes(op)
    ? (op as ContentTypeLifecycleOp)
    : null;
}

export interface LifecycleDispatchDeps {
  repo: ContentTypeRepoPort;
  clock: ClockPort;
  authorize: AuthorizeFn;
  outbox: OutboxPort;
  indexProvisioner: TeardownIndexProvisionerPort;
}

export interface LifecycleDispatchInput {
  workspaceId: string;
  actorId: string;
  key: string;
  expectedVersion: number;
  /** Threaded straight through to {@link LifecycleTransitionInput.principalKind} — the audit provenance stamped on the revision row. */
  principalKind?: ActorPrincipalKind;
}

export type ContentTypeLifecycleHandler = (
  deps: LifecycleDispatchDeps,
  input: LifecycleDispatchInput
) => Promise<Result<{ contentType: ContentTypeRecord }, Error>>;

/** Op name -> handler, keyed only by {@link ContentTypeLifecycleOp}, `Object.create(null)`-based
 * (defense-in-depth against a prototype-chain key ever resolving, matching the settings
 * dispatch table's own convention). */
const contentTypeLifecycleOps = {
  deprecate: (deps, input) => deprecateContentType({ deps, input }),
  reactivate: (deps, input) => reactivateContentType({ deps: { repo: deps.repo, clock: deps.clock, authorize: deps.authorize }, input }),
  tombstone: (deps, input) => tombstoneContentType({ deps, input }),
} satisfies Record<ContentTypeLifecycleOp, ContentTypeLifecycleHandler>;

export const CONTENT_TYPE_LIFECYCLE_OPS: Record<ContentTypeLifecycleOp, ContentTypeLifecycleHandler> = Object.assign(
  Object.create(null) as Record<ContentTypeLifecycleOp, ContentTypeLifecycleHandler>,
  contentTypeLifecycleOps
);
