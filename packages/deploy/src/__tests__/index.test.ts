import { describe, expect, it } from 'vitest';
import {
  checkDeploymentUrl,
  DeployError,
  DeployTargetToken,
  normalizeDeploymentUrl,
  publishDeploy,
  safeDnsLabel,
  safeProjectLabel,
  waitForReachableDeploymentUrl,
  type DeployPublishToolInput,
  type DeployTarget,
} from '../index.js';

describe('@injini/deploy barrel', () => {
  it('re-exports the full public surface from a single entry point', () => {
    expect(typeof safeProjectLabel).toBe('function');
    expect(typeof safeDnsLabel).toBe('function');
    expect(typeof normalizeDeploymentUrl).toBe('function');
    expect(typeof checkDeploymentUrl).toBe('function');
    expect(typeof waitForReachableDeploymentUrl).toBe('function');
    expect(typeof publishDeploy).toBe('function');
    expect(DeployError).toBeInstanceOf(Function);
    expect(DeployTargetToken).toBeDefined();
  });

  it('publishDeploy resolves through a bound target found by id', async () => {
    const target: DeployTarget = {
      id: 'fixture',
      publish: async () => ({ targetId: 'fixture', url: 'https://example.test', status: 'ready' }),
      checkReachability: async () => ({ reachable: true }),
    };
    const input: DeployPublishToolInput = { targetId: 'fixture', files: [], projectName: 'p' };
    const result = await publishDeploy(input, [target]);
    expect(result).toMatchObject({ targetId: 'fixture', url: 'https://example.test', status: 'ready' });
  });

  it('publishDeploy throws a DeployError for an unknown target id', async () => {
    const input: DeployPublishToolInput = { targetId: 'missing', files: [], projectName: 'p' };
    await expect(publishDeploy(input, [])).rejects.toThrow(DeployError);
  });
});
