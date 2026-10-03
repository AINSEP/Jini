/**
 * The injection contract for host-supplied deploy targets.
 *
 * A host (an app, a plugin loader) may keep its own deploy-target code outside
 * this package and still produce a plain {@link DeployTarget}. It writes each
 * target as a {@link DeployTargetModule}, and hands every module a
 * {@link DeployHostKit}: the outbound `fetch`, timeouts, and this package's
 * generic helpers. A module then needs no imports of its own, so it can ship
 * as a standalone file (for example inside a plugin copied verbatim to disk,
 * where no npm dependency could resolve). The resulting targets bind like any
 * other (`bindMany(DeployTargetToken, ...)` or passed straight to
 * `publishDeploy`). Nothing here names a hosting provider.
 */
import type { assertNotRedirected, redirectGuardInit } from './redirect-guard.js';
import type { safeDnsLabel, safeProjectLabel } from './naming.js';
import type { checkDeploymentUrl, normalizeDeploymentUrl, waitForReachableDeploymentUrl } from './reachability.js';
import type { DeployError, DeployTarget, UnknownRecord } from './types.js';

/**
 * The resolved saved credential a module builds its target from: always a
 * `token`, plus whatever extra fields that host's credential carries (an
 * account id, bucket coordinates, ...).
 */
export type DeployTargetCredential = { readonly token: string } & Readonly<Record<string, string | undefined>>;

/**
 * The per-call timeout classes the kit's `fetch` is used with. Same names as
 * `@jini-ai/platform`'s `FETCH_TIMEOUT_MS`, so a host can pass that object.
 */
export interface DeployFetchTimeouts {
  readonly QUICK: number;
  readonly DEPLOY: number;
  readonly UPLOAD: number;
}

/**
 * What {@link DeployHostKit.createSigV4Client} takes: an access-key pair
 * scoped to one service and region, the shape every SigV4-signed API uses.
 */
export interface SigV4ClientOptions {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly service: string;
  readonly region: string;
}

/**
 * A client whose `fetch` signs each request with AWS Signature Version 4
 * before sending it, retrying a 5xx/429 with backoff.
 */
export interface SigV4Client {
  fetch(requiredArgs: { input: string }, optionalArgs?: { init?: RequestInit }): Promise<Response>;
  /** Signs a request without sending it, so the caller can send it through `DeployHostKit.fetch`. */
  sign(requiredArgs: { input: string }, optionalArgs?: { init?: RequestInit }): Promise<Request>;
}

/** Everything a module may call that is not a runtime builtin. The host builds it and passes it in. */
export interface DeployHostKit {
  /** `fetch`, aborted after `requiredArgs.timeoutMs`. */
  fetch(requiredArgs: { url: string; timeoutMs: number }, optionalArgs?: { init?: RequestInit }): Promise<Response>;
  readonly timeouts: DeployFetchTimeouts;
  /** Delay between poll attempts. Injected so a test never waits in real time. */
  sleep(requiredArgs: { ms: number }): Promise<void>;
  readonly checkDeploymentUrl: typeof checkDeploymentUrl;
  readonly waitForReachableDeploymentUrl: typeof waitForReachableDeploymentUrl;
  readonly normalizeDeploymentUrl: typeof normalizeDeploymentUrl;
  readonly safeDnsLabel: typeof safeDnsLabel;
  readonly safeProjectLabel: typeof safeProjectLabel;
  /** A request built with `redirectGuardInit` never follows a redirect, and
   *  `assertNotRedirected` fails a 3xx instead of sending the token on to another host. */
  readonly redirectGuardInit: typeof redirectGuardInit;
  readonly assertNotRedirected: typeof assertNotRedirected;
  /** A SigV4-signing client (a protocol, not a provider: many object stores speak it). */
  createSigV4Client(options: SigV4ClientOptions): SigV4Client;
  readonly DeployError: typeof DeployError;
}

export interface DeployTargetCreateContext {
  readonly credential: DeployTargetCredential;
  readonly config: UnknownRecord;
  readonly kit: DeployHostKit;
}

/**
 * One credential check's raw outcome. `rejected`: the host answered and
 * refused the credential (it must be replaced). `unreachable`: a transport
 * failure, timeout or unexpected status that says nothing about the
 * credential itself. `accountLabel` is the account's public handle only
 * (never an email, plan or org).
 */
export type DeployCredentialCheck =
  | { readonly ok: true; readonly accountLabel?: string }
  | { readonly ok: false; readonly reason: 'rejected' | 'unreachable'; readonly statusCode?: number };

export interface DeployCredentialCheckContext {
  readonly credential: DeployTargetCredential;
  readonly kit: DeployHostKit;
}

/**
 * A deploy-target module's default export. Only `create` is required; the
 * host supplies defaults for the rest (no config errors, no base path, no
 * credential check).
 */
export interface DeployTargetModule {
  create(context: DeployTargetCreateContext): DeployTarget;
  /** A human-readable config error, or `null` when `config` is usable. */
  validateConfig?(requiredArgs: { config: UnknownRecord }): string | null;
  /** The path prefix the host serves the site from, when it is not the root. */
  basePath?(requiredArgs: { config: UnknownRecord }): string | undefined;
  /** One bounded, read-only authenticated request against the host's own API.
   *  May throw: the caller folds any throw into `unreachable`. Never returns
   *  the credential or a response body. */
  verifyCredential?(context: DeployCredentialCheckContext): Promise<DeployCredentialCheck>;
}
