/**
 * @file Pure declared-host extensions for a page's report-only security policy.
 */

export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
export type SecurityHeaderSet = Readonly<Record<string, string>>;

/** Exact HTTP(S) origins a page declared, per policy directive. */
export interface DeclaredPageHosts {
  readonly script: readonly string[];
  readonly frame: readonly string[];
  readonly connect: readonly string[];
}

const HOST_DIRECTIVES: ReadonlyArray<readonly [keyof DeclaredPageHosts, string]> = [["script", "script-src"], ["frame", "frame-src"], ["connect", "connect-src"]];

/**
 * Adds declared hosts to the directives they belong to. Anything but an exact origin is
 * dropped, so a declaration can never become policy syntax.
 * @returns The extended policy; a policy without a directive is left without it. O(directives × hosts), no I/O.
 */
export function addDeclaredHostsToPolicy({ policy, hosts }: { policy: string; hosts: DeclaredPageHosts }, _optional: Record<string, never> = {}): string {
  return policy.split("; ").map(directive => {
    const kind = HOST_DIRECTIVES.find(([, name]) => directive === name || directive.startsWith(`${name} `))?.[0];
    if (!kind) return directive;
    const present = directive.split(" ");
    return [directive, ...[...new Set(hosts[kind])].filter(host => isDeclaredOrigin({ value: host }) && !present.includes(host))].join(" ");
  }).join("; ");
}

/** A header set with `hosts` added to its report-only policy; the rest is unchanged. O(addDeclaredHostsToPolicy). */
export function withDeclaredHosts({ headers, hosts }: { headers: SecurityHeaderSet; hosts: DeclaredPageHosts }, _optional: Record<string, never> = {}): SecurityHeaderSet {
  const policy = headers[CSP_REPORT_ONLY_HEADER];
  return policy === undefined ? headers : { ...headers, [CSP_REPORT_ONLY_HEADER]: addDeclaredHostsToPolicy({ policy, hosts }) };
}

/** An exact HTTP(S) origin string (no path, no policy syntax). */
export function isDeclaredOrigin({ value }: { value: string }, _optional: Record<string, never> = {}): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
  } catch { return false; }
}
