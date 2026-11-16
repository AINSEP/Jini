/** @file Native tool policy vocabulary: capability dimensions, the run's policy input and the launch plan. Types only. */
/** Independent native CLI dimensions; hosts own identity, defaults and persistence. */
export interface NativeCapabilities {
  shell: boolean;
  fileWrite: boolean;
  userMcp: boolean;
  subagents: boolean;
  userSettings: boolean;
  web: boolean;
  workflows: boolean;
  loginEnvironment: boolean;
}

/** Current run limits, shared by launch enforcement and browser preflight. */
export interface NativeToolPolicyInput {
  nativeToolAccess?: boolean;
  nativeCapabilities?: Partial<NativeCapabilities>;
  cliParity?: boolean;
  permissionMode?: 'bypass' | 'restricted';
}

/** Consent keys are the existing master switch and independently stored native capabilities. */
export type RunConsentKey = 'enabled' | keyof NativeCapabilities;
export type RunPlan =
  | { verdict: 'RUN'; loadsOwn: boolean; bridged: boolean }
  | { verdict: 'ASK'; keys: RunConsentKey[]; why?: 'isolation_blocked' }
  | { verdict: 'SETUP'; reason: 'not_installed' | 'not_signed_in' | 'host_locked'; keys?: RunConsentKey[]; lock?: string };

export interface RunPlanHost {
  installed?: boolean;
  auth?: 'ok' | 'missing' | 'unknown';
  locked?: string;
  isolationBlocked?: boolean;
}
