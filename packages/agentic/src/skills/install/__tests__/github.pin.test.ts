// Characterization pins for fetchGitHubSkill: URL allow-listing happens before any request,
// every request goes to api.github.com with redirects refused, and every metadata, size and
// count refusal keeps its exact message.
import { describe, expect, it } from 'vitest';
import { fetchGitHubSkill } from '../github.js';
import { MAX_SKILL_BYTES, MAX_SKILL_FILE_BYTES, SkillInputError } from '../validation.js';
import type { SkillFetchPort } from '../ports.js';

const URL_HELP = 'Use an HTTPS GitHub repository URL, optionally ending in /tree/ref/skill-folder.';
const COMMIT = 'c'.repeat(40);
const API = 'https://api.github.com/repos/owner/repo';
type Row = Record<string, unknown>;

function blobSha(index: number) { return index.toString(16).padStart(40, '0'); }
function row(path: string, content: string | number, overrides: Row = {}): Row {
  const size = typeof content === 'number' ? content : Buffer.byteLength(content);
  return { path, type: 'blob', mode: '100644', size, sha: blobSha(Buffer.from(path).reduce((a, b) => a * 31 + b, 7) % 1e9), ...overrides };
}

/** Typed fake transport: answers commit/tree/blob endpoints from tables and records every call. */
function github(options: { tree?: Row[]; treeBody?: unknown; commitBody?: unknown; blobs?: Record<string, unknown>; respond?: (url: string) => Response | undefined } = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const blobs = new Map<string, unknown>();
  for (const r of options.tree ?? []) if (typeof r.sha === 'string') blobs.set(r.sha, { encoding: 'base64', content: Buffer.alloc(Math.max(0, Number(r.size) || 0), 'a').toString('base64') });
  for (const [sha, body] of Object.entries(options.blobs ?? {})) blobs.set(sha, body);
  const fetch: SkillFetchPort = async ({ url }, init) => {
    calls.push({ url, init });
    const custom = options.respond?.(url);
    if (custom) return custom;
    if (url.startsWith(`${API}/commits/`)) return Response.json(options.commitBody ?? { sha: COMMIT });
    if (url === `${API}/git/trees/${COMMIT}?recursive=1`) return Response.json(options.treeBody ?? { truncated: false, tree: options.tree ?? [] });
    const sha = url.slice(`${API}/git/blobs/`.length);
    if (blobs.has(sha)) return Response.json(blobs.get(sha));
    throw new Error(`unexpected request ${url}`);
  };
  return { fetch, calls };
}

async function refuse(githubUrl: string, transport = github()) {
  const error = await fetchGitHubSkill({ githubUrl, fetch: transport.fetch }).then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(SkillInputError);
  return (error as Error).message;
}

describe('fetchGitHubSkill URL allow-list', () => {
  it.each([
    'not a url', 'https://github.com/owner/%E0%A4%A', 'http://github.com/owner/repo', 'https://api.github.com/owner/repo',
    'https://github.com.evil.test/owner/repo', 'https://127.0.0.1/owner/repo', 'https://github.com:444/owner/repo',
    'https://user@github.com/owner/repo', 'https://user:pass@github.com/owner/repo', 'https://github.com/owner/repo?x=1',
    'https://github.com/owner/repo#readme', 'https://github.com/owner', 'https://github.com/', 'https://github.com/owner/repo/blob/main',
    'https://github.com/owner/repo/tree', 'https://github.com/owner/repo/extra/x', 'https://github.com/own%20er/repo',
    'https://github.com/owner/re%2Fpo', 'https://github.com/owner//repo', 'https://github.com/owner/repo/tree/main/%2E%2E%2Fx',
    'https://github.com/owner/.git', 'file:///etc/passwd', 'https://github.com/owner/repo//',
  ])('refuses %j before any request', async githubUrl => {
    const transport = github();
    expect(await refuse(githubUrl, transport)).toBe(URL_HELP);
    expect(transport.calls).toEqual([]);
  });

  it('keeps the URL parser failure as the cause of the refusal', async () => {
    await expect(fetchGitHubSkill({ githubUrl: 'not a url', fetch: github().fetch })).rejects.toMatchObject({ message: URL_HELP, cause: expect.any(TypeError) });
  });

  it('pins a bare repository to HEAD and strips one trailing slash and a .git suffix', async () => {
    const transport = github({ tree: [row('SKILL.md', 'x')] });
    const result = await fetchGitHubSkill({ githubUrl: 'https://github.com/owner/repo.git/', fetch: transport.fetch });
    expect(transport.calls.map(call => call.url)).toEqual([`${API}/commits/HEAD`, `${API}/git/trees/${COMMIT}?recursive=1`, `${API}/git/blobs/${transport.calls[2]!.url.split('/').pop()}`]);
    expect(result).toEqual({ files: [{ path: 'SKILL.md', contentBase64: Buffer.from('a').toString('base64') }], source: { githubUrl: 'https://github.com/owner/repo.git/', commit: COMMIT } });
  });

  it('sends every request with refused redirects, the GitHub accept header and one shared signal', async () => {
    const transport = github({ tree: [row('SKILL.md', 'x')] });
    await fetchGitHubSkill({ githubUrl: 'https://github.com/owner/repo/tree/v1.0', fetch: transport.fetch });
    expect(transport.calls[0]!.url).toBe(`${API}/commits/v1.0`);
    for (const { init } of transport.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toEqual({ Accept: 'application/vnd.github+json' });
      expect(init?.signal).toBe(transport.calls[0]!.init?.signal);
    }
  });

  it('selects only allowed files under the requested folder and strips its prefix', async () => {
    const tree = [
      row('skills/ops/SKILL.md', 'x'), row('skills/ops/references/a.md', 'yy'), row('skills/ops/scripts/run.sh', 'z'), row('skills/ops/assets/i.png', 'p'),
      row('skills/ops/README.md', 'r'), row('skills/ops/LICENSE', 'l'), row('skills/ops/other.md', 'o'), row('skills/opsx/SKILL.md', 'n'),
      row('SKILL.md', 'root'), { path: 7 }, { path: 'skills/ops/references', type: 'tree' }, { ...row('skills/ops/references/dir', 0), type: 'tree' },
      row('skills/ops/scripts/x.sh', 'm', { mode: 100755 }),
    ];
    const transport = github({ tree });
    const { files } = await fetchGitHubSkill({ githubUrl: 'https://github.com/owner/repo/tree/main/skills/ops', fetch: transport.fetch });
    expect(files.map(file => file.path)).toEqual(['SKILL.md', 'references/a.md', 'scripts/run.sh', 'assets/i.png', 'README.md', 'LICENSE', 'scripts/x.sh']);
    expect(transport.calls).toHaveLength(2 + 7);
  });

  it('removes whitespace from blob content', async () => {
    const r = row('SKILL.md', 3);
    const transport = github({ tree: [r], blobs: { [String(r.sha)]: { encoding: 'base64', content: 'YW\nJj\n' } } });
    expect((await fetchGitHubSkill({ githubUrl: 'https://github.com/owner/repo', fetch: transport.fetch })).files).toEqual([{ path: 'SKILL.md', contentBase64: 'YWJj' }]);
  });
});

describe('fetchGitHubSkill response refusals', () => {
  const url = 'https://github.com/owner/repo';
  it('refuses a non-200 response with its status', async () => {
    expect(await refuse(url, github({ respond: () => new Response('nope', { status: 404 }) }))).toBe('GitHub could not fetch this skill (HTTP 404). Use a public repository URL.');
  });
  it('refuses an empty body', async () => {
    expect(await refuse(url, github({ respond: () => new Response(null, { status: 200 }) }))).toBe('GitHub returned an empty response.');
  });
  it('refuses a body larger than 16 MiB while streaming', async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(MAX_SKILL_BYTES)); },
      cancel() { cancelled++; },
    });
    expect(await refuse(url, github({ respond: () => new Response(body) }))).toBe('GitHub skill response exceeds its size limit.');
    expect(cancelled).toBe(1);
  });
  it('accepts a body of exactly 16 MiB', async () => {
    const big = JSON.stringify({ sha: COMMIT, pad: 'x'.repeat(MAX_SKILL_BYTES * 2 - 60) });
    const padded = big + ' '.repeat(MAX_SKILL_BYTES * 2 - Buffer.byteLength(big));
    const transport = github({ respond: u => (u.includes('/commits/') ? new Response(padded) : undefined), tree: [] });
    expect((await fetchGitHubSkill({ githubUrl: url, fetch: transport.fetch })).files).toEqual([]);
  });
  it.each([null, [], 1, 'text'])('refuses a non-object JSON body %j', async body => {
    expect(await refuse(url, github({ commitBody: body === null ? undefined : body, respond: u => (body === null && u.includes('/commits/') ? new Response('null') : undefined) }))).toBe('GitHub returned an invalid skill response.');
  });
  it('lets a malformed JSON body escape as a raw SyntaxError (reported, not fixed)', async () => {
    const transport = github({ respond: () => new Response('{') });
    await expect(fetchGitHubSkill({ githubUrl: url, fetch: transport.fetch })).rejects.toThrow(SyntaxError);
  });
  it.each([{}, { sha: 'C'.repeat(40) }, { sha: 'c'.repeat(39) }, { sha: 7 }])('refuses invalid commit %j', async commitBody => {
    expect(await refuse(url, github({ commitBody }))).toBe('GitHub returned an invalid commit.');
  });
  it.each([{ truncated: true, tree: [] }, { truncated: false }, { tree: {} }])('refuses incomplete tree %j', async treeBody => {
    expect(await refuse(url, github({ treeBody }))).toBe('GitHub repository tree is incomplete. Choose a smaller skill repository.');
  });
  it('lets a null tree row escape as a raw TypeError (reported, not fixed)', async () => {
    await expect(fetchGitHubSkill({ githubUrl: url, fetch: github({ treeBody: { tree: [null] } }).fetch })).rejects.toThrow(TypeError);
  });
  it.each([{ type: 'commit' }, { mode: '120000' }, { mode: '040000' }, { type: undefined }])('refuses non-regular file %j', async overrides => {
    expect(await refuse(url, github({ tree: [row('SKILL.md', 'x', overrides)] }))).toBe('GitHub skills may contain only regular files.');
  });
  it.each([{ size: '1' }, { size: -1 }, { size: MAX_SKILL_FILE_BYTES + 1 }, { sha: 'z'.repeat(40) }, { sha: undefined }])('refuses invalid file metadata %j', async overrides => {
    expect(await refuse(url, github({ tree: [row('SKILL.md', 'x', overrides)] }))).toBe('GitHub skill file exceeds its size limit or has invalid metadata.');
  });
  it('refuses when declared sizes pass 8 MiB before fetching that blob', async () => {
    const tree = Array.from({ length: 9 }, (_, i) => row(`references/${i}.md`, MAX_SKILL_FILE_BYTES));
    const transport = github({ tree });
    expect(await refuse(url, transport)).toBe('GitHub skill exceeds 8 MiB or 256 files.');
    expect(transport.calls).toHaveLength(2 + 8);
  });
  it('refuses the 257th file', async () => {
    const tree = Array.from({ length: 257 }, (_, i) => row(`references/${i}.md`, 0));
    const transport = github({ tree });
    expect(await refuse(url, transport)).toBe('GitHub skill exceeds 8 MiB or 256 files.');
    expect(transport.calls).toHaveLength(2 + 256);
  });
  it('refuses when decoded content passes 8 MiB despite small declared sizes', async () => {
    const tree = Array.from({ length: 9 }, (_, i) => row(`references/${i}.md`, 0));
    const blobs = Object.fromEntries(tree.map(r => [String(r.sha), { encoding: 'base64', content: Buffer.alloc(MAX_SKILL_FILE_BYTES).toString('base64') }]));
    expect(await refuse(url, github({ tree, blobs }))).toBe('GitHub skill exceeds 8 MiB or 256 files.');
  });
  it.each([{ encoding: 'utf-8', content: 'x' }, { encoding: 'base64', content: 1 }])('refuses invalid blob %j', async blob => {
    const r = row('SKILL.md', 1);
    expect(await refuse(url, github({ tree: [r], blobs: { [String(r.sha)]: blob } }))).toBe('GitHub returned an invalid skill file.');
  });
  it('refuses a blob that decodes past 1 MiB', async () => {
    const r = row('SKILL.md', 1);
    expect(await refuse(url, github({ tree: [r], blobs: { [String(r.sha)]: { encoding: 'base64', content: Buffer.alloc(MAX_SKILL_FILE_BYTES + 1).toString('base64') } } }))).toBe('Skill upload exceeds its size limit.');
  });
  it('refuses a blob with malformed base64', async () => {
    const r = row('SKILL.md', 1);
    expect(await refuse(url, github({ tree: [r], blobs: { [String(r.sha)]: { encoding: 'base64', content: 'a' } } }))).toBe('Skill upload must use valid base64.');
  });
});
