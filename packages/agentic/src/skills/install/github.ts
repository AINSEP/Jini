/** Commit-pinned public GitHub import with one request/body deadline, byte caps and refused redirects. */
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_FILE_BYTES, decodeSkillBase64, SkillInputError, type SkillUploadFile } from "./validation.js";
import type { SkillFetchPort } from "./ports.js";

export interface GitHubSkillSource { readonly githubUrl: string; readonly commit: string }

/** Restricts every request to api.github.com, disallows redirects, pins one immutable commit.
 * @complexity O(files + downloaded bytes), at most 256 file requests and 8 MiB decoded content.
 */
export async function fetchGitHubSkill({ githubUrl, fetch: fetchImpl }: { githubUrl: string; fetch: SkillFetchPort }, _optional: Record<string, never> = {}) {
  let url: URL;
  try { url = new URL(githubUrl); } catch { throw new SkillInputError({ message: "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder." }); }
  let parts: string[];
  try { parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(p => decodeURIComponent(p)); }
  catch { throw new SkillInputError({ message: "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder." }); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || parts.length < 2 || (parts.length > 2 && (parts[2] !== "tree" || parts.length < 4)) || parts.some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === "." || p === "..")) throw new SkillInputError({ message: "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder." });
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");
  if (!repo) throw new SkillInputError({ message: "Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder." });
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  // One deadline for the whole fetch, including streaming response bodies.
  const signal = AbortSignal.timeout(30_000);
  async function json(endpoint: string): Promise<Record<string, unknown>> {
    const response = await fetchImpl({ url: endpoint }, { redirect: "error", signal, headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new SkillInputError({ message: `GitHub could not fetch this skill (HTTP ${response.status}). Use a public repository URL.` });
    if (!response.body) throw new SkillInputError({ message: "GitHub returned an empty response." });
    const reader = response.body.getReader();
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
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new SkillInputError({ message: "GitHub returned an invalid skill response." });
    return result as Record<string, unknown>;
  }
  const commit = (await json(`${base}/commits/${encodeURIComponent(parts[3] ?? "HEAD")}`)).sha;
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) throw new SkillInputError({ message: "GitHub returned an invalid commit." });
  const tree = await json(`${base}/git/trees/${commit}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new SkillInputError({ message: "GitHub repository tree is incomplete. Choose a smaller skill repository." });
  const prefix = parts.length > 4 ? parts.slice(4).join("/") + "/" : "";
  const files: SkillUploadFile[] = [];
  let total = 0;
  let actualBytes = 0;
  for (const row of tree.tree as Record<string, unknown>[]) {
    if (typeof row.path !== "string" || !row.path.startsWith(prefix)) continue;
    const relative = row.path.slice(prefix.length);
    if (!/^(SKILL\.md|README\.md|LICENSE|(?:references|scripts|assets)\/.*)$/.test(relative) || row.type === "tree") continue;
    if (row.type !== "blob" || !["100644", "100755"].includes(String(row.mode))) throw new SkillInputError({ message: "GitHub skills may contain only regular files." });
    if (typeof row.size !== "number" || row.size < 0 || row.size > MAX_SKILL_FILE_BYTES || typeof row.sha !== "string" || !/^[a-f0-9]{40}$/.test(row.sha)) throw new SkillInputError({ message: "GitHub skill file exceeds its size limit or has invalid metadata." });
    total += row.size;
    if (total > MAX_SKILL_BYTES || files.length >= MAX_SKILL_FILES) throw new SkillInputError({ message: "GitHub skill exceeds 8 MiB or 256 files." });
    const blob = await json(`${base}/git/blobs/${row.sha}`);
    if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new SkillInputError({ message: "GitHub returned an invalid skill file." });
    const contentBase64 = blob.content.replace(/\s/g, "");
    actualBytes += decodeSkillBase64({ value: contentBase64 }, { maxBytes: MAX_SKILL_FILE_BYTES }).length;
    if (actualBytes > MAX_SKILL_BYTES) throw new SkillInputError({ message: "GitHub skill exceeds 8 MiB or 256 files." });
    files.push({ path: relative, contentBase64 });
  }
  return { files, source: { githubUrl, commit } satisfies GitHubSkillSource };
}
