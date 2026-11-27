import { describe, expect, it, vi } from 'vitest';
import { PAGE_CAPABILITIES } from '../../page-capabilities.js';
import type { PageDriver } from '../../page-driver.js';
import { createDriverPagePort } from '../page-port.js';

describe('createDriverPagePort', () => {
  it('serves exactly the shared page capability ids, in order', () => {
    const port = createDriverPagePort({ driver: {} as PageDriver });
    expect(port.capabilityIds).toEqual(PAGE_CAPABILITIES.map((capability) => capability.id));
    expect(port.capabilityIds).toContain('page.highlight');
  });

  it('runs a capability through the shared executor against the bound driver', async () => {
    const highlight = vi.fn(async () => {});
    const port = createDriverPagePort({ driver: { highlight } as unknown as PageDriver });
    await port.execute({ capabilityId: 'page.highlight', input: { handle: 'el-1' } });
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledWith(expect.objectContaining({ handle: 'el-1' }));
  });

  it('refuses an unknown capability before touching the driver', async () => {
    const highlight = vi.fn(async () => {});
    const port = createDriverPagePort({ driver: { highlight } as unknown as PageDriver });
    await expect(port.execute({ capabilityId: 'page.teleport', input: {} })).rejects.toThrow('unknown page capability: page.teleport');
    expect(highlight).not.toHaveBeenCalled();
  });
});
