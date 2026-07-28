import { manyToken } from '@injini/core';
import { DeployError, type DeployFile, type DeployPublishResult, type DeployTarget, type JsonObject } from './types.js';

/**
 * Many-bound composition token for deploy providers, per extraction-plan.md
 * §2.2's own worked example (`DeployTarget = manyToken<DeployProvider>
 * ('jini.deployTarget')`, `bindMany(DeployTarget, netlifyTarget)`). A host
 * composition binds every deploy provider it wants available against this
 * one token:
 *
 * ```ts
 * bindings().bindMany(DeployTargetToken, new VercelDeployTarget(vercelConfig))
 *            .bindMany(DeployTargetToken, new CloudflarePagesDeployTarget(cfConfig))
 * ```
 *
 * A pack then resolves `c.getMany(DeployTargetToken)` to get every bound
 * target without this package (or `@injini/core`) needing to know how many
 * providers exist or which ones a given host chose.
 */
export const DeployTargetToken = manyToken<DeployTarget>('jini.deployTarget');

/**
 * Input to the `deploy.publish` capability: which bound target to use, plus
 * the same `DeployPublishInput` shape every `DeployTarget.publish` takes.
 */
export interface DeployPublishToolInput {
  targetId: string;
  files: DeployFile[];
  projectName: string;
  metadata?: JsonObject;
}

/**
 * `deploy.publish` as a plain async function.
 *
 * This is deliberately **not** wired into a real tool-execution boundary
 * yet — `@injini/core`'s `ToolRegistry`/`ToolExecutor` (extraction-plan.md §8
 * task 6, §2.5) doesn't exist yet. Once it does, the intended shape is:
 *
 * ```ts
 * toolRegistry.register({
 *   descriptor: { id: 'deploy.publish', ... },
 *   handler: (principal, run, input, signal) => publishDeploy(input, targets),
 *   policy: { ... }, // e.g. requires confirmation before an external publish
 * });
 * ```
 *
 * so callers only ever reach it through `ToolExecutor.execute(principal,
 * run, 'deploy.publish', input, signal)` — never by holding a direct
 * reference to a handler. Until task 6 lands, this function is the whole
 * surface: a pack's app-service can call it directly.
 *
 * @param input - Which bound target to publish through, plus the file set/project name/metadata.
 * @param targets - The full set of `DeployTarget`s a composition bound (typically `c.getMany(DeployTargetToken)`).
 * @returns The chosen target's publish result.
 * @throws {DeployError} (status 404) if no bound target matches `input.targetId`.
 * @complexity O(targets) to find the match, then whatever the target's own `publish` costs.
 * @overallScore 100/100
 */
export async function publishDeploy(input: DeployPublishToolInput, targets: readonly DeployTarget[]): Promise<DeployPublishResult> {
  const target = targets.find((candidate) => candidate.id === input.targetId);
  if (!target) {
    throw new DeployError(`Unknown deploy target: ${input.targetId}`, 404, { errorCode: 'deploy_target_not_found' });
  }
  return target.publish({
    files: input.files,
    projectName: input.projectName,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}
