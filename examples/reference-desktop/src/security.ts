import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface RendererFrameIdentity {
  origin: string;
  url: string;
  parent: unknown | null;
}

const TRUSTED_RENDERER_ORIGINS = new Set([
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);

/** Rejects environment overrides that leave the fixed local dev origins. */
export function resolveTrustedRendererUrl(candidate: string): URL {
  const url = new URL(candidate);
  if (!TRUSTED_RENDERER_ORIGINS.has(url.origin)) {
    throw new Error('Renderer URL must use the trusted local playground origin');
  }
  return url;
}

/** Returns true only for the trusted top-level renderer origin. */
export function isTrustedRendererFrame(
  frame: RendererFrameIdentity | null,
  trustedOrigin: string,
): boolean {
  if (!frame || frame.parent !== null || frame.origin !== trustedOrigin) return false;
  try {
    return new URL(frame.url).origin === trustedOrigin;
  } catch {
    return false;
  }
}

/** Resolves a dialog/check path against the known repository root. */
export function resolveDesktopWorkingDirectory(repoRoot: string, requestedPath: string): string {
  return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(repoRoot, requestedPath);
}

/** Restricts renderer-requested normalization to declared sample roots. */
export function normalizeSampleWorkingDirectory(
  repoRoot: string,
  requestedPath: unknown,
): string | null {
  if (typeof requestedPath !== 'string' || isAbsolute(requestedPath)) return null;
  const samplesRoot = resolve(repoRoot, 'examples/sample-projects');
  const candidate = resolve(samplesRoot, relative('examples/sample-projects', requestedPath));
  const fromRoot = relative(samplesRoot, candidate);
  if (
    fromRoot.length === 0
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) return null;
  return candidate;
}

/**
 * Exchanges a native main-process selection for a daemon-lifetime grant.
 * The high-entropy secret is supplied only by the root launcher environment.
 */
export async function grantNativeWorkingDirectory({
  daemonUrl,
  secret,
  directory,
  fetchImpl = fetch,
}: {
  daemonUrl: string;
  secret: string | undefined;
  directory: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (!secret) throw new Error('Working-directory grants are unavailable');
  const response = await fetchImpl(`${daemonUrl}/api/playground/working-directory-grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-jini-grant-secret': secret,
    },
    body: JSON.stringify({ directory }),
  });
  if (!response.ok) throw new Error('Working-directory grant was rejected');
  const body = (await response.json()) as { directory?: unknown };
  if (typeof body.directory !== 'string') {
    throw new Error('Working-directory grant returned an invalid path');
  }
  return body.directory;
}
