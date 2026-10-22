/**
 * Browser transport defaults stay here rather than importing a Node package.
 * Preserve a caller's cancellation alongside the deadline; fetch keeps its native ABI.
 */
export function requestWithTimeout(
  { url, timeoutMs }: { url: string | URL; timeoutMs: number },
  { fetch, init = {} }: { fetch?: typeof globalThis.fetch; init?: RequestInit } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return (fetch ?? globalThis.fetch)(url, { ...init, signal });
}
