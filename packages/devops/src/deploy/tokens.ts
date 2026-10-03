import { manyToken } from '@jini-ai/core';
import { DeployError, type DeployFile, type DeployPublishOptions, type DeployPublishResult, type DeployTarget, type UnknownRecord } from './types.js';

/**
 * Many-bound composition token for deploy providers, per extraction-plan.md
 * §2.2's own worked example (`DeployTarget = manyToken<DeployProvider>
 * ('jini.deployTarget')`, `bindMany(DeployTarget, someTarget)`, paraphrased). A host
 * composition binds every deploy provider it wants available against this
 * one token:
 *
 * ```ts
 * bindings().bindMany(DeployTargetToken, hostTargetA)
 *            .bindMany(DeployTargetToken, hostTargetB)
 * ```
 *
 * A pack then resolves `c.getMany(DeployTargetToken)` to get every bound
 * target without this package (or `@jini-ai/core`) needing to know how many
 * providers exist or which ones a given host chose.
 */
export const DeployTargetToken = manyToken<DeployTarget>({ id: 'jini.deployTarget' });

/**
 * Input to the `deploy.publish` capability: which bound target to use, plus
 * the same `DeployPublishInput` shape every `DeployTarget.publish` takes.
 */
export interface DeployPublishToolInput {
  targetId: string;
  files: DeployFile[];
  projectName: string;
  metadata?: UnknownRecord;
}

/**
 * `deploy.publish` as a plain async function.
 *
 * Tool wiring is implemented by `createDeployPublishToolRegistration` in
 * `tool.ts`, using `@jini-ai/core`'s `ToolRegistry` and `@jini-ai/daemon`'s
 * `ToolExecutor` (extraction-plan.md §8 task 6, §2.5). The registration shape is:
 *
 * ```ts
 * toolRegistry.register({
 *   descriptor: { id: 'deploy.publish', ... },
 *   handler: (ctx) => publishDeploy({ ...ctx.input, targets }),
 *   policy: { ... }, // e.g. requires confirmation before an external publish
 * });
 * ```
 *
 * so callers only ever reach it through `ToolExecutor.execute(principal,
 * run, 'deploy.publish', input, signal)` — never by holding a direct
 * reference to a handler. This plain function remains available to trusted
 * composition code; routes and agents use the registration so they cannot
 * bypass authorization and the audit trail. The registration denies by default.
 *
 * @param requiredArgs - Target id, file set, project name and injected bound targets.
 * @param options - Optional metadata and response headers forwarded to the selected target.
 * @returns The chosen target's publish result.
 * @throws {DeployError} (status 404) if no bound target matches `input.targetId`.
 * @complexity O(targets) to find the match, then whatever the target's own `publish` costs.
 * @overallScore 100/100
 */
export async function publishDeploy(
  { targets, ...input }: Omit<DeployPublishToolInput, 'metadata'> & { targets: readonly DeployTarget[] },
  options: DeployPublishOptions = {},
): Promise<DeployPublishResult> {
  const target = targets.find((candidate) => candidate.id === input.targetId);
  if (!target) {
    throw new DeployError({ message: `Unknown deploy target: ${input.targetId}` }, { status: 404, details: { errorCode: 'deploy_target_not_found' } });
  }
  return target.publish({
    files: input.files,
    projectName: input.projectName,
  }, options);
}
