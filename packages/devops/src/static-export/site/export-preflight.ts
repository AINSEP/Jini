import { parse, type DefaultTreeAdapterMap } from "parse5";

/**
 * @file Export/publish pre-flight checks over the rendered page HTML (A421, A400). Pure detectors
 * plus a per-export collector; the exporter feeds it every page it writes and folds the result into
 * the report's existing `consentWarning` field, the only warning channel that already reaches the
 * publish outcome (admin card and assistant message). Warnings never block: the owner decides.
 */

export interface ExportPreflightCopy {
  readonly contactEmailPlaceholder: string;
  readonly placeholderWarning: (
    required: { pages: number },
    optional?: Record<string, never>,
  ) => string | undefined;
  // Why a warning and not an automatic block: a script written into a page is the owner's own code and the
  // banner cannot tell optional trackers from needed ones, so it is told, not rewritten (A400).
  readonly thirdPartyWarning: (
    required: { pages: number; hosts: readonly string[] },
    optional?: Record<string, never>,
  ) => string | undefined;
}

type Node = DefaultTreeAdapterMap["childNode"];

const MAX_SAMPLE_BYTES = 1_000_000;

/** Whether the page still carries the privacy template's contact placeholder. @complexity O(n) in page bytes. */
export function findContactEmailPlaceholder({ html, placeholder }: { html: string; placeholder: string }, _optional = {}): boolean {
  return html.includes(placeholder);
}

function hostOf({ value }: { value: unknown }, _optional = {}): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return new URL(value, "https://site.invalid").host.toLowerCase(); } catch { return undefined; }
}

/** The other-origin host a hand-written `<script src>` loads from; declared (consent-managed) scripts are skipped. */
function authoredScriptHost({ node, ownHosts }: { node: DefaultTreeAdapterMap["element"]; ownHosts: ReadonlySet<string> }, _optional = {}): string | undefined {
  if (node.tagName !== "script") return undefined;
  const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
  const src = attrs.get("src");
  if (!src || attrs.has("data-jini-declared-script")) return undefined;
  try {
    const url = new URL(src, "https://site.invalid");
    const host = url.host.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:") && host !== "site.invalid" && !ownHosts.has(host) ? host : undefined;
  } catch { return undefined; }
}

/**
 * Hosts of external scripts written straight into a page. Relative and same-site sources are
 * first-party; templates are inert authored content and are not entered.
 * @complexity O(sample bytes), at most 1 MB per page.
 */
export function findThirdPartyScriptHosts({ html, ownHosts }: { html: string; ownHosts: ReadonlySet<string> }, _optional = {}): string[] {
  if (!html.toLowerCase().includes("<script")) return [];  // HTML tag names are case-insensitive; the parser sorts the rest.
  const hosts = new Set<string>();
  const nodes: Node[] = [...parse(html.slice(0, MAX_SAMPLE_BYTES)).childNodes];
  while (nodes.length) {
    const node = nodes.pop();
    if (node === undefined || !("tagName" in node)) continue;
    const host = authoredScriptHost({ node, ownHosts });
    if (host !== undefined) hosts.add(host);
    if (node.tagName !== "template") nodes.push(...node.childNodes);
  }
  return [...hosts].sort();
}

/** One export's collector. State lives in this closure, created per export, never at module level. */
export function createExportPreflight({ ownOrigins, copy }: { ownOrigins: readonly unknown[]; copy: ExportPreflightCopy }, _optional = {}) {
  const ownHosts = new Set(ownOrigins.flatMap(value => hostOf({ value }) ?? []));
  const found = { placeholderPages: 0, thirdPartyPages: 0, hosts: new Set<string>(), consentConfigured: false };
  return {
    observePage({ html }: { html: string }, _optional = {}): void {
      if (findContactEmailPlaceholder({ html, placeholder: copy.contactEmailPlaceholder })) found.placeholderPages += 1;
      const hosts = findThirdPartyScriptHosts({ html, ownHosts });
      if (hosts.length === 0) return;
      found.thirdPartyPages += 1;
      for (const host of hosts) found.hosts.add(host);
    },
    /** Third-party scripts only matter once a cookie banner is promising to manage consent. */
    setConsentConfigured({ configured }: { configured: boolean }, _optional = {}): void { found.consentConfigured = configured; },
    /** The existing warning with this export's pre-flight warnings appended; undefined when there are none. */
    joinWarnings({ existing }: { existing: string | undefined }, _optional = {}): string | undefined {
      const warnings = [existing, copy.placeholderWarning({ pages: found.placeholderPages }),
        found.consentConfigured ? copy.thirdPartyWarning({ pages: found.thirdPartyPages, hosts: [...found.hosts].sort() }) : undefined]
        .filter((warning): warning is string => warning !== undefined && warning !== "");
      return warnings.length === 0 ? undefined : warnings.join(" ");
    },
  };
}
