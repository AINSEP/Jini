import type { AgentExecutor } from './contracts.js';
import type { AdmittedLaunch, PreparedLaunch, StagedLaunch } from './launch.js';

type NoOptions = Record<string, never>;
export type RunRequired = Parameters<AgentExecutor['run']>[0];
export type RunOptions = NonNullable<Parameters<AgentExecutor['run']>[1]>;

export interface LaunchPhases {
  admit(required: { requiredArgs: RunRequired; optionalArgs: RunOptions }, optional?: NoOptions): Promise<AdmittedLaunch>;
  prepare(required: { admitted: AdmittedLaunch }, optional?: NoOptions): Promise<PreparedLaunch>;
  stage(required: { prepared: PreparedLaunch }, optional?: NoOptions): Promise<StagedLaunch>;
  handoff(required: { staged: StagedLaunch }, optional?: NoOptions): Promise<void>;
}

/** Sequencing only: admit → prepare → stage → handoff, each awaited in order. Owns no resource. */
export function createLaunchRunner({ phases }: { phases: LaunchPhases }, _optional: NoOptions = {}): AgentExecutor['run'] {
  return async (requiredArgs, optionalArgs = {}) => {
    const admitted = await phases.admit({ requiredArgs, optionalArgs }, {});
    const prepared = await phases.prepare({ admitted }, {});
    const staged = await phases.stage({ prepared }, {});
    await phases.handoff({ staged }, {});
  };
}
