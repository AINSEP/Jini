import { expect, it, vi } from 'vitest';
import { resolveDelegatedToolPrincipal } from '../builtin-features.js';

const request = { runId: 'run', toolUseId: 'use', toolId: 'tool', input: {} };

it('refuses delegated execution without a host identity resolver', () => {
  expect(() => resolveDelegatedToolPrincipal({ request, resolvePrincipal: undefined }))
    .toThrow('Delegated tool calls require a host principal resolver');
});

it('passes the original request to the host identity owner', async () => {
  const principal = { id: 'host-principal' };
  const resolvePrincipal = vi.fn(async () => principal);
  expect(await resolveDelegatedToolPrincipal({ request, resolvePrincipal })).toBe(principal);
  expect(resolvePrincipal).toHaveBeenCalledTimes(1);
  expect(resolvePrincipal).toHaveBeenCalledWith(request);
});
