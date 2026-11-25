import { describe, expect, it } from 'vitest';
import { createSiteSavedKeys } from '../saved-keys.js';

describe('owner keys are excluded from exports', () => {
  it('retired saved-key capture refuses before touching owner or site storage', async () => {
    let reads = 0;
    const keys = createSiteSavedKeys({ workspaceId: 'workspace-local',
      openSnapshot: async () => { reads++; throw new Error('must not open'); },
      captureProject: async () => { reads++; throw new Error('must not open'); },
    } as never);
    await expect(keys.capture({ snapshot: Buffer.alloc(0), shareId: 'share', workspaceId: 'workspace-local' })).rejects.toThrow(/no longer include saved keys/);
    expect(reads).toBe(0);
  });
});
