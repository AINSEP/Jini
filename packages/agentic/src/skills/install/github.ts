/** Commit-pinned public GitHub import with one request/body deadline, byte caps and refused redirects. */
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, decodeSkillBase64, SkillInputError, type SkillUploadFile } from "./validation.js";
import type { SkillFetchPort } from "./ports.js";

export interface GitHubSkillSource { readonly githubUrl: string; readonly commit: string }

const URL_HELP = "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder.";
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SEGMENT_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const SKILL_FILE_PATTERN = /^(SKILL\.md|README\.md|LICENSE|(?:references|scripts|assets)\/.*)$/;
const REGULAR_FILE_MODES = ["100644", "100755"];
type GitHubJson = (endpoint: string) => Promise<Record<string, unknown>>;

/** Restricts every request to api.github.com, disallows redirects, pins one immutable commit.
 * @complexity O(files + downloaded bytes), at most 256 file requests and 8 MiB decoded content.
 */
export async function fetchGitHubSkill({ githubUrl, fetch: fetchImpl }: { githubUrl: string; fetch: SkillFetchPort }, _optional: Record<string, never> = {}) {
  const { owner, repo, ref, prefix } = parseGitHubSkillUrl({ githubUrl });
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  // One deadline for the whole fetch, including streaming response bodies.
  const json = createGitHubJsonReader({ fetch: fetchImpl, signal: AbortSignal.timeout(30_000) });
  const commit = (await json(`${base}/commits/${encodeURIComponent(ref)}`)).sha;
  if (typeof commit !== "string" || !SHA_PATTERN.test(commit)) throw new SkillInputError({ message: "GitHub returned an invalid commit." });
  const tree = await json(`${base}/git/trees/${commit}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new SkillInputError({ message: "GitHub repository tree is incomplete. Choose a smaller skill repository." });
  const files = await downloadSkillFiles({ rows: tree.tree as Record<string, unknown>[], prefix, base, json });
  return { files, source: { githubUrl, commit } satisfies GitHubSkillSource };
}

/** Accepts only https://github.com/owner/repo[/tree/ref[/folder…]] with plain segments; refuses before any request. */
function parseGitHubSkillUrl({ githubUrl }: { githubUrl: string }) {
  let url: URL;
  let parts: string[];
  try {
    url = new URL(githubUrl);
    parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(p => decodeURIComponent(p));
  } catch (error) { throw new SkillInputError({ message: URL_HELP }, { cause: error }); }
  if (!isGitHubOrigin({ url }) || !isSkillRepoPath({ parts })) throw new SkillInputError({ message: URL_HELP });
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!repo) throw new SkillInputError({ message: URL_HELP });
  return { owner: parts[0]!, repo, ref: parts[3] ?? "HEAD", prefix: parts.length > 4 ? parts.slice(4).join("/") + "/" : "" };
}

/** Plain https://github.com with no port, credentials, query or fragment. */
function isGitHubOrigin({ url }: { url: URL }): boolean {
  return url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password && !url.search && !url.hash;
}

/** owner/repo, or owner/repo/tree/ref[/folder…]; every decoded segment is plain and never `.`/`..`. */
function isSkillRepoPath({ parts }: { parts: readonly string[] }): boolean {
  const shapeOk = parts.length === 2 || (parts.length >= 4 && parts[2] === "tree");
  return shapeOk && parts.every(p => SEGMENT_PATTERN.test(p) && p !== "." && p !== "..");
}

/** One JSON endpoint reader sharing the redirect policy, accept header and deadline. */
function createGitHubJsonReader({ fetch: fetchImpl, signal }: { fetch: SkillFetchPort; signal: AbortSignal }): GitHubJson {
  return async endpoint => {
    const response = await fetchImpl({ url: endpoint }, { redirect: "error", signal, headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new SkillInputError({ message: `GitHub could not fetch this skill (HTTP ${response.status}). Use a public repository URL.` });
    if (!response.body) throw new SkillInputError({ message: "GitHub returned an empty response." });
    const result: unknown = JSON.parse((await readBoundedBody({ body: response.body })).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new SkillInputError({ message: "GitHub returned an invalid skill response." });
    return result as Record<string, unknown>;
  };
}

/** Streams a response body up to 16 MiB and always releases the reader. */
async function readBoundedBody({ body }: { body: ReadableStream<Uint8Array> }): Promise<Buffer> {
  const reader = body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_SKILL_BYTES * 2) throw new SkillInputError({ message: "GitHub skill response exceeds its size limit." });
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

/** Checks each selected row, then fetches its blob, in tree order, under declared and decoded budgets. */
async function downloadSkillFiles({ rows, prefix, base, json }: { rows: readonly Record<string, unknown>[]; prefix: string; base: string; json: GitHubJson }): Promise<SkillUploadFile[]> {
  const files: SkillUploadFile[] = [];
  const budget = { declared: 0, actual: 0 };
  for (const row of rows) {
    const relative = selectSkillRow({ row, prefix });
    if (relative === undefined) continue;
    const { size, sha } = readRegularBlobRow({ row });
    budget.declared += size;
    if (budget.declared > MAX_SKILL_BYTES || files.length >= MAX_SKILL_FILES) throw new SkillInputError({ message: "GitHub skill exceeds 8 MiB or 256 files." });
    files.push({ path: relative, contentBase64: await downloadBlob({ url: `${base}/git/blobs/${sha}`, json, budget }) });
  }
  return files;
}

/** Path relative to the skill folder when the row is an allowed skill file, else undefined (skipped). */
function selectSkillRow({ row, prefix }: { row: Record<string, unknown>; prefix: string }): string | undefined {
  if (typeof row.path !== "string" || !row.path.startsWith(prefix)) return undefined;
  const relative = row.path.slice(prefix.length);
  if (!SKILL_FILE_PATTERN.test(relative) || row.type === "tree") return undefined;
  return relative;
}

/** Refuses non-regular entries (submodules, symlinks) and missing or oversized metadata. */
function readRegularBlobRow({ row }: { row: Record<string, unknown> }): { size: number; sha: string } {
  if (row.type !== "blob" || !REGULAR_FILE_MODES.includes(String(row.mode))) throw new SkillInputError({ message: "GitHub skills may contain only regular files." });
  if (typeof row.size !== "number" || row.size < 0 || row.size > MAX_SKILL_FILE_BYTES || typeof row.sha !== "string" || !SHA_PATTERN.test(row.sha)) throw new SkillInputError({ message: "GitHub skill file exceeds its size limit or has invalid metadata." });
  return { size: row.size, sha: row.sha };
}

/** Fetches one base64 blob, enforcing the 1 MiB file cap and 8 MiB decoded total. */
async function downloadBlob({ url, json, budget }: { url: string; json: GitHubJson; budget: { actual: number } }): Promise<string> {
  const blob = await json(url);
  if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new SkillInputError({ message: "GitHub returned an invalid skill file." });
  const contentBase64 = blob.content.replace(/\s/g, "");
  budget.actual += decodeSkillBase64({ value: contentBase64 }, { maxBytes: MAX_SKILL_FILE_BYTES }).length;
  if (budget.actual > MAX_SKILL_BYTES) throw new SkillInputError({ message: "GitHub skill exceeds 8 MiB or 256 files." });
  return contentBase64;
}
