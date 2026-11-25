import { scanTextForSecrets } from "./secret-scan.js";

export interface SecretScanViolation {
  /** Repo-root-relative path, forward slashes. */
  file: string;
  patternName: string;
  /** 1-based line number, or "binary" when the file's content is not text (a NUL byte was found in
   *  its first 8000 bytes — the same heuristic `git`/`grep -I` use to classify binaries), or "path"
   *  when the match sits in the file or directory NAME itself. */
  line: number | "binary" | "path";
}

function lineNumberAt({ text, index }: { text: string; index: number }, _optional = {}): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** One tracked file's (or historical blob's) already-read, latin1-decoded content, ready to scan. */
interface ScannableContent {
  readonly text: string;
  readonly isBinary: boolean;
}

/** Stands in for every credential-shaped substring of a reported path. */
const REDACTED = "[redacted]";

/** A report must never repeat the value it found: redact credential-shaped substrings of a path. */
function redactPath({ file }: { file: string }, _optional: Record<string, never> = {}): string {
  let redacted = file;
  for (const hit of scanTextForSecrets({ text: file })) redacted = redacted.split(hit.value).join(REDACTED);
  return redacted;
}

/** A file or directory NAME can carry a credential too (an empty file still has one), so every
 *  tracked and historical path is scanned before extension filtering or blob dedupe. */
function scanPathForViolations({ file, policy }: { file: string; policy: Parameters<typeof scanTrackedRepo>[0]["policy"] }, _optional: Record<string, never> = {}): SecretScanViolation[] {
  return scanTextForSecrets({ text: file })
    .filter((hit) => !policy.isAllowlisted({ file, patternName: hit.patternName, value: hit.value }))
    .map((hit) => ({ file: redactPath({ file }), patternName: hit.patternName, line: "path" as const }));
}

/** Scans one already-read file's content for secret-shaped hits, filtering out allowlisted ones
 *  and shaping each remaining hit into a reportable {@link SecretScanViolation}. Shared by the
 *  tip scan ({@link scanRepoForSecrets}) and the history scan ({@link scanGitHistoryForSecrets}). */
function scanContentForViolations(
  { file, content, policy }: { file: string; content: ScannableContent; policy: Parameters<typeof scanTrackedRepo>[0]["policy"] },
  _optional = {}
): SecretScanViolation[] {
  const violations: SecretScanViolation[] = [];
  for (const hit of scanTextForSecrets({ text: content.text })) {
    if (policy.isAllowlisted({ file, patternName: hit.patternName, value: hit.value })) continue;
    violations.push({
      file: redactPath({ file }),
      patternName: hit.patternName,
      line: content.isBinary ? "binary" : lineNumberAt({ text: content.text, index: hit.index }),
    });
  }
  return violations;
}

// A single NUL character, built via fromCharCode rather than an inline escape literal so this
// file's own source never embeds a raw control byte.
const NUL_CHAR = String.fromCharCode(0);

/** Converts one historical blob's raw latin1-decoded content into {@link ScannableContent}, or
 *  `null` when it's missing (shouldn't happen — `readBlobContents` was given this exact sha) or
 *  over the size cap (see file header's size-cap rationale). */
function toScannableBlob({ text, policy }: { text: string | undefined; policy: Parameters<typeof scanTrackedRepo>[0]["policy"] }, _optional = {}): ScannableContent | null {
  if (text === undefined || text.length > policy.maxScanBytes) return null;
  return { text, isBinary: text.slice(0, 8000).includes(NUL_CHAR) };
}

export function scanTrackedRepo({ ports, policy }: {
  ports: {
    trackedPaths: () => readonly string[];
    readTracked: (required: { file: string }) => ScannableContent | null;
  };
  policy: {
    selectPath: (required: { file: string }) => boolean;
    maxScanBytes: number;
    isAllowlisted: (required: { file: string; patternName: string; value: string }) => boolean;
  };
}, _optional: Record<string, never> = {}): SecretScanViolation[] {
  const violations: SecretScanViolation[] = [];
  for (const relFile of ports.trackedPaths()) {
    violations.push(...scanPathForViolations({ file: relFile, policy }));
    if (!policy.selectPath({ file: relFile })) continue;
    const content = ports.readTracked({ file: relFile });
    if (!content || content.text.length > policy.maxScanBytes) continue;
    violations.push(...scanContentForViolations({ file: relFile, content, policy }));
  }
  return violations;
}

export function scanRepoHistory({ ports, policy }: {
  ports: {
    historicalPaths: () => readonly string[];
    historicalBlobs: () => readonly { sha: string; path: string }[];
    readBlobContents: (required: { shas: readonly string[] }) => ReadonlyMap<string, string>;
  };
  policy: Parameters<typeof scanTrackedRepo>[0]["policy"];
}, _optional: Record<string, never> = {}): SecretScanViolation[] {
  const violations: SecretScanViolation[] = ports.historicalPaths().flatMap((file) => scanPathForViolations({ file, policy }));

  const blobs = ports.historicalBlobs().filter(
    (b) => policy.selectPath({ file: b.path }),
  );
  const contents = ports.readBlobContents({ shas: blobs.map((b) => b.sha) });

  for (const { path: relPath, sha } of blobs) {
    const content = toScannableBlob({ text: contents.get(sha), policy });
    if (!content) continue;
    violations.push(...scanContentForViolations({ file: relPath, content, policy }));
  }
  return violations;
}
