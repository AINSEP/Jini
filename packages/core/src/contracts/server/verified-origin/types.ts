
import { isLoopbackHost } from "./loopback-host.js";

/** Canonical links, redirect checks and egress decisions must use stored trust evidence,
 * never the raw request Host/:authority, which is attacker-controlled. */
export type OriginScheme = "https" | "http";

export type OriginSource = "workspace-setting" | "dev-capability";

/** Stored trust evidence. Public origins use HTTPS; HTTP is limited to explicit development capabilities. */
export interface VerifiedOrigin {
  scheme: OriginScheme;
  host: string;
  port?: number;
  basePath?: string;

  verifiedAt: string;
  source: OriginSource;
}

export class InsecureOriginSourceError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}

/** Missing trust evidence is a hard precondition failure. Callers must fail closed rather than
 * guessing an origin from the request or another unverified value. */
export class OriginNotVerifiedError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}

/** Copy evidence, refusing HTTP public origins and treating public loopback origins as unset.
 * Both writers and registry reads use this boundary, including reads of legacy persisted rows.
 * @throws InsecureOriginSourceError for HTTP public evidence; OriginNotVerifiedError for loopback public evidence.
 * @complexity O(host bytes) time and space; pure, with no ownership or reachability probe.
 * @example createVerifiedOrigin({ scheme: "https", host: "example.com", verifiedAt, source: "workspace-setting" });
 */
export function createVerifiedOrigin(input: VerifiedOrigin, _options: Record<string, never> = {}): VerifiedOrigin {
  // Repositories and other adapters must construct evidence through this function; an object
  // literal can bypass the scheme/source invariant even though it satisfies the structural type.
  if (input.scheme === "http" && input.source !== "dev-capability") {
    throw new InsecureOriginSourceError({
      message: `origin scheme 'http' is only legal for source 'dev-capability' (got source '${input.source}')`
    });
  }
  // Explicit dev capabilities may address a listener; a public site URL never may.
  if (input.source === "workspace-setting" && isLoopbackHost({ host: input.host })) {
    throw new OriginNotVerifiedError({ message: "a loopback host is not a verified public origin" });
  }
  return { ...input };
}
