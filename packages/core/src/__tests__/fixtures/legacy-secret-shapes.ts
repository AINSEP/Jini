/** Credential-shape vocabulary for secret-only redaction; no I/O or host dependencies. */

export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

// Named once and reused (by LEGACY_SECRET_SHAPE_PATTERNS here and by the guard's ALLOWLIST) rather than repeated
// as a literal in multiple places.
export const PEM_PATTERN_NAME = "PEM private key block";

// Share data between static scans and runtime redactors without importing a CLI entry point:
// top-level argv/path handling in a scanner can crash a daemon that imports it. Keeping the
// vocabulary dependency-free also avoids making core redaction depend on feature code.
// Match each vendor's actual alphabet. Fixed-length patterns need lookaround boundaries so a
// credential-shaped substring of a longer inert value is not mistaken for a complete secret.
export const LEGACY_SECRET_SHAPE_PATTERNS: readonly SecretPattern[] = [
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
  { name: PEM_PATTERN_NAME, pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
