import { MAX_SKILL_BYTES, SkillInputError } from "../validation.js";
import type { SkillFetchPort } from "../ports.js";

export type GitHubJson = (endpoint: string) => Promise<Record<string, unknown>>;

/** The pinned REST origin for validated repository segments. */
export function githubRepoBase({ owner, repo }: { owner: string; repo: string }, _optional: Record<string, never> = {}): string {
  return `https://api.github.com/repos/${owner}/${repo}`;
}

/** One JSON endpoint reader sharing the redirect policy, accept header and deadline. */
export function createGitHubJsonReader({ fetch: fetchImpl, signal }: { fetch: SkillFetchPort; signal: AbortSignal }, _optional: Record<string, never> = {}): GitHubJson {
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

