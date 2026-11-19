/** Credential-shape vocabulary for secret-only redaction; no I/O or host dependencies. */

export interface SecretShapePattern {
  readonly name: string;
  readonly pattern: RegExp;
}

// Named once and reused (by SECRET_SHAPE_PATTERNS here and by the guard's ALLOWLIST) rather than repeated
// as a literal in multiple places.
export const PEM_PATTERN_NAME = "PEM private key block";

const PRIVATE_KEY_HEADER = /-----BEGIN ([A-Z ]*)PRIVATE KEY-----/;
// Consume the body before any token/label rule can erase the delimiters. A missing footer
// masks through EOF; a different key type's footer cannot close this block.
const PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/;

// Share data between static scans and runtime redactors without importing a CLI entry point:
// top-level argv/path handling in a scanner can crash a daemon that imports it. Keeping the
// vocabulary dependency-free also avoids making core redaction depend on feature code.
// Match each vendor's actual alphabet. Fixed-length patterns need lookaround boundaries so a
// credential-shaped substring of a longer inert value is not mistaken for a complete secret.
export const SECRET_SHAPE_PATTERNS: readonly SecretShapePattern[] = [
  { name: "Google API key (AIza)", pattern: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/ },
  { name: "Anthropic API key (sk-ant-)", pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{90,}/ },
  { name: "generic sk- secret key (OpenAI-shaped)", pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{40,}/ },
  { name: "GitHub personal access token (classic, ghp_)", pattern: /(?<!\w)ghp_\w{36}(?!\w)/ },
  { name: "GitHub OAuth token (gho_)", pattern: /(?<!\w)gho_\w{36}(?!\w)/ },
  { name: "GitHub fine-grained PAT", pattern: /(?<!\w)github_pat_\w{80,}/ },
  { name: "npm access token", pattern: /(?<!\w)npm_\w{36}(?!\w)/ },
  { name: "Slack token", pattern: /(?<![A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{12,}/ },
  { name: "AWS access key ID", pattern: /(?<![0-9A-Z])AKIA[0-9A-Z]{16}(?![0-9A-Z])/ },
  { name: "Fastmail app password (fm2_)", pattern: /(?<![A-Za-z0-9+/=])fm2_[A-Za-z0-9+/=]{20,}/ },
  { name: PEM_PATTERN_NAME, pattern: PRIVATE_KEY_BLOCK },
];

/**
 * Suppress PEM bodies across complete, ordered text lines before other redactors run.
 * @param _required No ambient state; create one instance per framed output stream.
 * @param _options Reserved optional policy inputs.
 * @returns A line redactor and an EOF reset. Call reset after flushing the final line so a
 * replacement child cannot inherit an unterminated block. Does not frame raw chunks or do I/O.
 * @complexity O(n) per line; O(h) retained state for the open header's key type of length h.
 * @example const keys = createPrivateKeyLineRedactor({}, {}); keys.redact({ text: line }, {});
 */
export function createPrivateKeyLineRedactor(_required: Record<string, never>, _options = {}): {
  redact(required: { text: string }, optional?: Record<string, never>): string;
  reset(required: Record<string, never>, optional?: Record<string, never>): void;
} {
  let footer: string | undefined;
  return {
    redact({ text }, _optional = {}) {
      let remaining = text;
      let out = '';
      while (remaining) {
        if (footer !== undefined) {
          const end = remaining.indexOf(footer);
          if (end === -1) return out;
          remaining = remaining.slice(end + footer.length);
          footer = undefined;
        }
        const header = PRIVATE_KEY_HEADER.exec(remaining);
        if (!header) return out + remaining;
        out += remaining.slice(0, header.index) + '[REDACTED:credential]';
        footer = `-----END ${header[1]}PRIVATE KEY-----`;
        remaining = remaining.slice(header.index + header[0].length);
      }
      return out;
    },
    reset(_input, _optional = {}) { footer = undefined; },
  };
}

/** Broad token shapes for agent-failure text; consumers retain their plain [REDACTED] pipeline. */
const AGENT_FAILURE_TOKEN_SHAPES: readonly RegExp[] = [
  /AIza[\w-]+/, // Google API key
  /AQ\.[\w.\/-]+/, // AI Studio key
  /sk-[\w.-]+/, // OpenAI-style secret key
  /gh[pousr]_\w+/, // GitHub token
  /github_pat_\w+/, // GitHub fine-grained token
  /ya29\.[\w.-]+/, // Google OAuth access token
  /eyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/, // JWT
];
export const AGENT_FAILURE_SECRET_SHAPE_RE = new RegExp(`\\b(?:${AGENT_FAILURE_TOKEN_SHAPES.map((shape) => shape.source).join('|')})`, 'g');

/**
 * Exact path SEGMENT names refused at any depth, matched case-insensitively against each segment
 * of the caller-supplied path (never a substring — a directory named `not-secrets-actually` is not
 * a match). `secrets` is the owner's explicit example: whatever a site or app tree names its
 * credentials folder (`sites/**\/secrets/`, `app/**\/secrets/`, or anywhere else), it never
 * becomes reachable through this domain. A denied segment is refused by the guarded reader
 * AND skipped entirely by the `fs_list_files` walk — its contents are never even enumerated,
 * not merely refused once named. Besides `secrets`, the set names the
 * well-known credential-store directories a home-directory `custom` root can expose: `.aws`
 * (`credentials`), `.docker` (`config.json` with registry auth), `.kube` (`config`), and
 * `gcloud`/`gh` for `.config/gcloud/application_default_credentials.json` and
 * `.config/gh/hosts.yml`. Denied by SEGMENT rather than by leaf filename on purpose: `config`,
 * `config.json`, and `hosts.yml` are generic names that appear harmlessly elsewhere, so denying the
 * directory is the narrower of the two mistakes.
 *
 * A host's install-wide site-key directory (2026-09-24) needs the same protection; the host appends it.
 * Production stores it beside individual site folders on a durable volume; local/dev stores
 * it below the home directory, reachable through an operator-set `custom` root. Its key backs
 * site-key administration, webhook/newsletter signing secrets, and permission checks, so the
 * agent must never read it from disk. Denying the whole directory segment, rather than only
 * a generated key filename, also prevents `fs_list_files` from enumerating its contents — the
 * same "never even advertise it" property `secrets` gets above.
 */
// Generic credential-store segments only. A host adds its own product-specific key directory
// (e.g. its install-wide site-key folder) when it builds its deny-list; core stays product-neutral.
export const CREDENTIAL_FILE_DENY_SEGMENTS: readonly string[] = ["secrets", ".aws", ".docker", ".kube", "gcloud", "gh"];

// A local tunnel has a loopback socket and may rewrite Host; refuse marker presence, even empty.
export const LOCAL_OWNER_PROXY_MARKER_PREFIXES: readonly string[] = ["x-forwarded-", "x-envoy-", "x-ms-"];
export const LOCAL_OWNER_PROXY_MARKER_HEADERS: readonly string[] = [
  "forwarded", "x-real-ip", "via", "cf-connecting-ip", "true-client-ip", "x-original-host",
  "x-client-ip", "x-cluster-client-ip", "fastly-client-ip", "tailscale-user-login", "x-original-forwarded-for",
];
