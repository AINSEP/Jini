import { expect, test } from 'vitest';
import { executeSavedRequest } from '../execute.js';
import { definition, fixture } from './fixtures.js';
import type { SavedRequestDeps } from '../types.js';

test('credential description and resolution agree on the approved credential without legacy additional hosts', async () => {
  const f = fixture();
  f.state.credential = { ...f.state.credential!, additionalHosts: ['legacy.example'] };
  const execute = f.deps.executeCredentialedRequest;
  let described: unknown;
  let resolved: unknown;
  const deps: SavedRequestDeps = { ...f.deps, executeCredentialedRequest: async (required, optional) => {
    described = await required.deps.resolver.describe({ workspaceId: 'workspace-1', label: 'credential-1' });
    resolved = await required.deps.resolver.resolve({ workspaceId: 'workspace-1', label: 'credential-1' });
    return execute(required, optional);
  } };
  const result = await executeSavedRequest({ deps, workspaceId: 'workspace-1', definition: definition(), input: { query: 'tea' } });
  expect(described).toEqual({ ...f.state.credential, additionalHosts: [] });
  expect(resolved).toBe(described);
  expect(result).toEqual({ trust: 'untrusted', items: [{ title: 'Public' }] });
  expect(f.state.credential.additionalHosts).toEqual(['legacy.example']);
  expect(f.calls).toHaveLength(1);
});
