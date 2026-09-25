/**
 * `public/sandbox_proxy.html` is a literal, static-file duplicate of `@jini-ai/ui`'s
 * `SANDBOX_PROXY_HTML` (from its `mcp-ui/surfaces` subpath) — Vite's `public/` mechanism needs an
 * actual file on disk, and `@jini-ai/ui` exports the canonical version as a string a real host (like
 * Tovu) mounts dynamically instead. Two copies of the same handful of lines is an acceptable
 * trade-off for local verification ONLY if they cannot silently drift apart — this test is that
 * guarantee. If it fails, `public/sandbox_proxy.html` needs to be updated to match
 * `SANDBOX_PROXY_HTML` (or vice versa, if the canonical version changed for a real reason).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SANDBOX_PROXY_HTML } from '@jini-ai/ui/mcp-ui/surfaces';

describe('public/sandbox_proxy.html stays in sync with @jini-ai/ui SANDBOX_PROXY_HTML', () => {
  it('is byte-for-byte identical', () => {
    const publicFilePath = fileURLToPath(new URL('../public/sandbox_proxy.html', import.meta.url));
    const onDisk = readFileSync(publicFilePath, 'utf8').replace(/\n$/, '');
    expect(onDisk).toBe(SANDBOX_PROXY_HTML);
  });
});
