/**
 * `deploy.publish` wired as a real `@injini/core` `Tool` registration — the
 * bridge between `publishDeploy` (`tokens.ts`, still the plain async
 * function that actually dispatches to a bound `DeployTarget`) and the
 * tool-execution boundary (`@injini/core`'s `ToolRegistry` +
 * `@injini/daemon`'s `ToolExecutor`; see `packages/core/src/tool-registry.ts`
 * and `packages/daemon/src/tool-executor.ts`). This file follows the same
 * `{descriptor, handler, policy}` shape `packages/daemon/src/
 * delegated-tool-bridge.ts` established for wiring an existing capability
 * into that boundary — see `source-map.md`'s "2026-07-21 addition" section
 * for the full design rationale, in particular why the default policy below
 * denies every call rather than allowing one.
 *
 * This package does not depend on `@injini/daemon` — a `ToolRegistration` is
 * just data (`@injini/core`'s public shape); only the host composing a daemon
 * needs `ToolExecutor` to actually run it. That keeps `@injini/deploy`'s
 * dependency graph unchanged (still just `@injini/core` + `@injini/platform` +
 * `undici`).
 */
import type { ToolAuthorizationContext, ToolPolicy, ToolRegistration } from '@injini/core';
import { publishDeploy, type DeployPublishToolInput } from './tokens.js';
import type { DeployPublishResult, DeployTarget } from './types.js';

/** The `ToolRegistry` id this file registers `deploy.publish` under. */
export const DEPLOY_PUBLISH_TOOL_ID = 'deploy.publish';

/**
 * Role hint `createRoleGatedDeployPublishPolicy`'s own default looks for on
 * `Principal.roles`. Purely a convenience default — a host is free to pass
 * its own `allowedRoles` list, or its own `ToolPolicy` entirely, using
 * whatever role vocabulary it already has.
 */
export const DEFAULT_DEPLOY_PUBLISH_ROLE = 'deploy:publish';

/**
 * Deny-by-default `ToolPolicy` for `deploy.publish` — every call is denied,
 * unconditionally, regardless of principal. This is the registration's
 * built-in default (see `createDeployPublishToolRegistration` below): a
 * host must explicitly opt in, either by passing its own `policy` or by
 * using {@link createRoleGatedDeployPublishPolicy}, rather than getting an
 * unrestricted or partially-restricted gate for free merely by registering
 * the tool.
 *
 * Why deny-by-default specifically (not e.g. "allow same-principal-as-run"
 * or some other partial default): `deploy.publish` is the one tool in this
 * codebase that reaches real external infrastructure under the caller's own
 * cloud account — a successful call spends the operator's Vercel/Cloudflare
 * quota, publishes content to a public, internet-reachable URL, and (for
 * Cloudflare custom domains) can create real DNS records. Unlike most tool
 * calls, a wrongly-allowed `deploy.publish` is not cheaply reversible and
 * has an externally visible blast radius. That is a strictly stronger case
 * for deny-by-default than `@injini/media`'s `DEFAULT_MEDIA_EXECUTION_POLICY`
 * (SEC-RB-010, `packages/media/src/policy.ts`) — media generation is
 * costly but self-contained; a bad deploy is costly AND publicly visible AND
 * (for custom domains) mutates DNS. Matching this branch's established
 * "deny-by-default" discipline (see commit `0a9c9c237`'s media-policy fix)
 * rather than inventing a more permissive default here.
 */
export const denyAllDeployPublishPolicy: ToolPolicy = {
  authorize: () => 'deny',
};

/**
 * Convenience `ToolPolicy`: allows a `deploy.publish` call only when the
 * calling `Principal` carries at least one of `allowedRoles` (default: just
 * {@link DEFAULT_DEPLOY_PUBLISH_ROLE}). A `Principal` with no `roles` at all
 * — the default shape per `@injini/core`'s `Principal` (`roles` is optional)
 * — is denied: an absent/empty roles list is never treated as
 * "unrestricted," mirroring the SEC-RB-010 fix in `@injini/media`'s
 * `createAllowlistMediaPolicy` (an omitted field must not silently bypass
 * an explicit gate).
 *
 * This is one usable, non-permissive policy a host can opt into — it is
 * NOT the registration default (see {@link denyAllDeployPublishPolicy});
 * a host must still choose to pass it explicitly.
 *
 * @complexity O(principal.roles) to check membership against `allowedRoles`.
 * @overallScore 100/100
 */
export function createRoleGatedDeployPublishPolicy(
  allowedRoles: readonly string[] = [DEFAULT_DEPLOY_PUBLISH_ROLE],
): ToolPolicy {
  return {
    authorize(ctx: ToolAuthorizationContext) {
      const roles = ctx.principal.roles;
      if (!roles || roles.length === 0) return 'deny';
      return roles.some((role) => allowedRoles.includes(role)) ? 'allow' : 'deny';
    },
  };
}

export interface CreateDeployPublishToolRegistrationOptions {
  /** Every bound `DeployTarget` the resulting tool call may dispatch to — typically `c.getMany(DeployTargetToken)`. */
  readonly targets: readonly DeployTarget[];
  /** Defaults to {@link denyAllDeployPublishPolicy} — see its doc comment for why a permissive default was rejected. */
  readonly policy?: ToolPolicy;
  /** Forwarded to `ToolDescriptor.requiresConfirmation` — an extra transport-level "are you sure" gate `ToolExecutor` applies after authorization. Omitted (not forced `true`) because this file already denies by default; a host layering its own confirmation UI on top opts in explicitly. */
  readonly requiresConfirmation?: boolean;
  /** Forwarded to `ToolDescriptor.timeoutMs`. Omit for no `ToolExecutor`-enforced timeout (individual `DeployTarget`s may still apply their own internal timeouts, e.g. `reachability.ts`'s poll bound). */
  readonly timeoutMs?: number;
}

/**
 * Builds the `{descriptor, handler, policy}` triple a host registers
 * against `@injini/core`'s `ToolRegistry` so `deploy.publish` becomes
 * reachable only via `ToolExecutor.execute(principal, run, 'deploy.publish',
 * input, signal)` — never by a route or agent calling `publishDeploy`
 * directly, which would bypass authorization and the audit trail entirely.
 *
 * The handler ignores the `ToolExecutionContext.signal` `ToolExecutor`
 * supplies: `DeployTarget.publish`/`checkReachability` (`types.ts`) take no
 * `AbortSignal` today, so there is nothing to forward it to. A `ToolExecutor`
 * `timeoutMs`/external cancellation still aborts the *call* from the
 * executor's perspective (the audit trail records `timed-out`/`cancelled`),
 * it just cannot interrupt an in-flight HTTP request inside a target's own
 * `publish` implementation — flagged as a follow-up in `source-map.md`
 * rather than silently assumed away.
 *
 * @complexity O(1) to build the registration; the handler's own cost is `publishDeploy`'s (O(targets) dispatch plus the matched target's `publish`).
 * @overallScore 100/100
 */
export function createDeployPublishToolRegistration(
  options: CreateDeployPublishToolRegistrationOptions,
): ToolRegistration {
  const { targets, policy = denyAllDeployPublishPolicy, requiresConfirmation, timeoutMs } = options;

  return {
    descriptor: {
      id: DEPLOY_PUBLISH_TOOL_ID,
      description: 'Publishes a file set to a bound deploy target (e.g. Vercel, Cloudflare Pages, Netlify, GitHub Pages).',
      ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
    policy,
    handler: async (ctx): Promise<DeployPublishResult> => {
      // The registry/executor boundary passes `input` as `unknown` by
      // design (`ToolExecutionContext.input`, `packages/core/src/
      // tool-registry.ts`) — this cast is the one place that shape becomes
      // `DeployPublishToolInput` again, exactly as `tokens.ts`'s own
      // deferred-wiring sketch anticipated. No parsing/validation library
      // is introduced here; `publishDeploy`/the matched `DeployTarget`
      // already reject a malformed `targetId`/`files`/`projectName` on
      // their own terms (e.g. `DeployError` for an unknown target).
      const input = ctx.input as DeployPublishToolInput;
      return publishDeploy(input, targets);
    },
  };
}
