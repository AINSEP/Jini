import { describe, expect, it, vi } from 'vitest';
import {
  denyAllWorkspaceRoots,
  resolveWorkspaceRoot,
  WorkspaceRootDeniedError,
  type WorkspaceRootResolver,
} from '../workspace-root.js';

describe('@jini-ai/http-kit — workspace-root — denyAllWorkspaceRoots', () => {
  it('resolves to null for any request', () => {
    expect(denyAllWorkspaceRoots({ request: { resourceRef: 'anything' } })).toBeNull();
  });
});

describe('@jini-ai/http-kit — workspace-root — resolveWorkspaceRoot', () => {
  it('throws WorkspaceRootDeniedError when no resolver is supplied (the conservative default)', async () => {
    await expect(resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } })).rejects.toBeInstanceOf(WorkspaceRootDeniedError);
  });

  it('the thrown error carries the resourceRef and a descriptive default message', async () => {
    try {
      await resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } });
      expect.unreachable('expected resolveWorkspaceRoot to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceRootDeniedError);
      const denied = error as WorkspaceRootDeniedError;
      expect(denied.resourceRef).toBe('proj-1');
      expect(denied.name).toBe('WorkspaceRootDeniedError');
      expect(denied.message).toBe('no workspace root available for resource "proj-1"');
    }
  });

  it('a custom reason string overrides the default message while keeping resourceRef', async () => {
    const resolver: WorkspaceRootResolver = () => {
      throw new WorkspaceRootDeniedError({ resourceRef: 'proj-1' }, { reason: 'caller is not permitted to open this project' });
    };
    await expect(async () => {
      const root = await resolver({ request: { resourceRef: 'proj-1' } });
      if (root == null) throw new WorkspaceRootDeniedError({ resourceRef: 'proj-1' }, { reason: 'caller is not permitted to open this project' });
    }).rejects.toMatchObject({ message: 'caller is not permitted to open this project', resourceRef: 'proj-1' });
  });

  it('resolves the path a synchronous resolver returns', async () => {
    const resolver: WorkspaceRootResolver = vi.fn(() => '/home/user/projects/proj-1');
    const root = await resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } }, { resolver });
    expect(root).toBe('/home/user/projects/proj-1');
    expect(resolver).toHaveBeenCalledWith({ request: { resourceRef: 'proj-1' } });
  });

  it('resolves the path an async resolver returns', async () => {
    const resolver: WorkspaceRootResolver = async () => '/home/user/projects/proj-1';
    const root = await resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } }, { resolver });
    expect(root).toBe('/home/user/projects/proj-1');
  });

  it('passes an optional detail field through to the resolver', async () => {
    const resolver: WorkspaceRootResolver = vi.fn(() => '/root');
    await resolveWorkspaceRoot({ request: { resourceRef: 'proj-1', detail: 'src/index.ts' } }, { resolver });
    expect(resolver).toHaveBeenCalledWith({ request: { resourceRef: 'proj-1', detail: 'src/index.ts' } });
  });

  it('throws when the resolver returns undefined', async () => {
    const resolver: WorkspaceRootResolver = () => undefined;
    await expect(resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } }, { resolver })).rejects.toBeInstanceOf(
      WorkspaceRootDeniedError,
    );
  });

  it('throws when the resolver returns null (an explicit "no root for this resource")', async () => {
    const resolver: WorkspaceRootResolver = () => null;
    await expect(resolveWorkspaceRoot({ request: { resourceRef: 'unknown' } }, { resolver })).rejects.toBeInstanceOf(
      WorkspaceRootDeniedError,
    );
  });

  it('throws when the resolver returns an empty string, never treating it as a valid root', async () => {
    const resolver: WorkspaceRootResolver = () => '';
    await expect(resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } }, { resolver })).rejects.toBeInstanceOf(
      WorkspaceRootDeniedError,
    );
  });

  it('a resolver that itself throws propagates the rejection rather than being swallowed', async () => {
    const resolver: WorkspaceRootResolver = () => {
      throw new Error('lookup backend unavailable');
    };
    await expect(resolveWorkspaceRoot({ request: { resourceRef: 'proj-1' } }, { resolver })).rejects.toThrow(
      'lookup backend unavailable',
    );
  });
});
