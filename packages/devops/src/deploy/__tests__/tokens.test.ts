import { describe, expect, it } from 'vitest';
import { DeployError, type DeployPublishInput, type DeployPublishOptions, type DeployPublishResult, type DeployTarget, type DeploymentUrlCheck } from '../types.js';
import { DeployTargetToken, publishDeploy } from '../tokens.js';

class FakeDeployTarget implements DeployTarget {
  public lastInput: (DeployPublishInput & DeployPublishOptions) | undefined;

  constructor(readonly id: string) {}

  async publish(input: DeployPublishInput, options: DeployPublishOptions = {}): Promise<DeployPublishResult> {
    this.lastInput = { ...input, ...options };
    return { targetId: this.id, url: `https://${input.projectName}.example`, status: 'ready' };
  }

  async checkReachability(_args: { url: string }): Promise<DeploymentUrlCheck> {
    return { reachable: true, statusCode: 200 };
  }
}

describe('DeployTargetToken', () => {
  it('is a many-cardinality token so multiple targets can bind against it', () => {
    expect(DeployTargetToken.cardinality).toBe('many');
    expect(DeployTargetToken.id).toBe('jini.deployTarget');
  });
});

describe('publishDeploy', () => {
  it('dispatches to the target matching targetId and forwards files/projectName/metadata', async () => {
    const targetA = new FakeDeployTarget('target-a');
    const targetB = new FakeDeployTarget('target-b');

    const result = await publishDeploy(
      { targetId: 'target-b', files: [{ file: 'index.html', data: 'x' }], projectName: 'demo', targets: [targetA, targetB] },
      { metadata: { a: 1 } },
    );

    expect(result).toEqual({ targetId: 'target-b', url: 'https://demo.example', status: 'ready' });
    expect(targetB.lastInput).toEqual({ files: [{ file: 'index.html', data: 'x' }], projectName: 'demo', metadata: { a: 1 } });
    expect(targetA.lastInput).toBeUndefined();
  });

  it('throws a 404 DeployError when no bound target matches targetId', async () => {
    const call = publishDeploy({ targetId: 'unknown-provider', files: [], projectName: 'demo', targets: [new FakeDeployTarget('target-a')] });
    await expect(call).rejects.toThrow(DeployError);
    await expect(call).rejects.toThrow('Unknown deploy target: unknown-provider');
    await call.catch((err) => {
      expect(err).toBeInstanceOf(DeployError);
      expect((err as DeployError).status).toBe(404);
    });
  });

  it('handles an empty bound-target list (no providers configured)', async () => {
    await expect(publishDeploy({ targetId: 'target-a', files: [], projectName: 'demo', targets: [] })).rejects.toThrow(DeployError);
  });
});
