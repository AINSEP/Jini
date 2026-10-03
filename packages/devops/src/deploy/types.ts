/**
 * Provider-agnostic shapes for publishing a static file set to a hosting
 * target (any host-supplied adapter). None of these
 * types know what a "project" is — the caller (a pack, a tool handler, a
 * CLI command) resolves its own file set and hands over plain
 * `DeployFile[]`. See the archived extraction source map for what was dropped
 * from the OD origin file to get here.
 */

/** Loose provider option bag; values need not be JSON-serializable. */
export type UnknownRecord = Record<string, unknown>;

/**
 * One file to publish, keyed by its deploy-relative path.
 *
 * `sourcePath` is optional provenance the caller may attach (e.g. the path
 * in its own file model) purely for diagnostics/logging — this package
 * never reads it.
 */
export interface DeployFile {
  file: string;
  data: Buffer | Uint8Array | string;
  contentType?: string;
  sourcePath?: string;
}

/**
 * Coarse status of a deployment's public URL. `link-delayed` means the
 * provider accepted the deploy but the URL is not yet reachable (DNS/CDN
 * propagation); `protected` means the provider is gating the URL behind
 * its own auth wall (e.g. a deployment-protection login page).
 */
export type DeployLinkStatus = 'ready' | 'protected' | 'failed' | 'link-delayed';

/** Result of probing a deployment URL over HTTP. */
export interface DeploymentUrlCheck {
  reachable: boolean;
  status?: DeployLinkStatus;
  statusCode?: number;
  statusMessage?: string;
}

/**
 * Input to `DeployTarget.publish`. Deliberately narrow: a file set plus a
 * human/DNS-safe label the target may use to derive a provider-side
 * project/deployment name. In the separate optional-arguments object,
 * `metadata` is an escape hatch for target-specific
 * options (e.g. custom-domain selection) that do not belong in
 * the shared shape — each target documents the metadata keys it reads and
 * ignores everything else.
 *
 * `responseHeaders` is the header set the caller wants every published page
 * served with (e.g. security headers). Each target renders it into its own
 * host format (a `_headers` file, a host config file, ...) or ignores it
 * where the host offers no way to set headers.
 */
export interface DeployPublishInput {
  files: DeployFile[];
  projectName: string;
}

/** Optional publish settings, passed separately from the file set and project name. */
export interface DeployPublishOptions {
  metadata?: UnknownRecord;
  responseHeaders?: ResponseHeaderSet;
}

/** HTTP response headers by name, as a caller asks a target to serve them. */
export type ResponseHeaderSet = Readonly<Record<string, string>>;

/** Result of a successful (or partially successful) publish call. */
export interface DeployPublishResult {
  targetId: string;
  url: string;
  deploymentId?: string;
  status: DeployLinkStatus;
  statusMessage?: string;
  reachableAt?: number;
  /** Target-specific extras (e.g. a custom-domain/DNS outcome). */
  providerMetadata?: UnknownRecord;
}

/**
 * The port every deploy provider implements. Bound many-to-one against the
 * `DeployTarget` many-token in `tokens.ts` (`bindMany(DeployTargetToken, ...)`)
 * so any number of hosting targets can register against
 * the same capability without a central union type.
 */
export interface DeployTarget {
  readonly id: string;
  publish(requiredArgs: DeployPublishInput, optionalArgs?: DeployPublishOptions): Promise<DeployPublishResult>;
  checkReachability(requiredArgs: { url: string }): Promise<DeploymentUrlCheck>;
}

export type DeployErrorDetails = UnknownRecord | string | undefined;

/**
 * Thrown by target implementations for both caller-input problems (bad
 * config, missing token) and upstream provider failures (HTTP error,
 * malformed response). `status` mirrors HTTP semantics so a transport layer
 * can map it directly onto a response code.
 */
export class DeployError extends Error {
  status: number;
  details: DeployErrorDetails;
  code?: string | undefined;

  constructor({ message }: { message: string }, {
    status = 400, details, code,
  }: { status?: number; details?: DeployErrorDetails; code?: string } = {}) {
    super(message);
    this.name = 'DeployError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}
