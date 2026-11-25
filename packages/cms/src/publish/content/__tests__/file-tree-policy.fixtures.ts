/** Neutral secret-scanner fixture injected into the file-tree policy under test. */
import type { TextSecretScanner } from "../file-tree-policy.js";

const KEY_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key (sk-ant-)"],
  [/ghp_[A-Za-z0-9]{36}/, "GitHub personal access token"],
  [/-----BEGIN PRIVATE KEY-----/, "PEM private key block"],
  [/sk-[A-Za-z0-9]{32,}/, "generic secret key"],
];

/** The per-file byte cap a host injects into `checkTreeFiles` (50 MiB, the document ceiling the host used before it became an injected value). */
export const TEST_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Returns one hit per matching key pattern; the first hit's name appears in the tree's refusal reason. */
export const fakeScanTextForSecrets: TextSecretScanner = ({ text }) =>
  KEY_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, patternName]) => ({ patternName }));
