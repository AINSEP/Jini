/** Compile-time proof that the agent runtime's helpers fit chat's ports without a cast (the host binds them this way). */
import { classifyAgentServiceFailure, startupFailureMessage } from '@jini-ai/agent-runtime';
import { concreteModelOptions, modelIdentityKind, modelReasoningOptions } from '@jini-ai/agent-runtime/model-selection';
import { assessNativeToolPolicy } from '@jini-ai/agent-runtime/native-tool-policy';
import type { ChatAgentFailurePort, ChatAgentPolicyPort } from '../agents-port.js';

export const policy = {
  modelIdentityKind: ({ id }) => modelIdentityKind({ id }),
  concreteModelOptions: required => concreteModelOptions(required),
  modelReasoningOptions: required => modelReasoningOptions(required),
  assessNativeToolPolicy: required => assessNativeToolPolicy(required),
} satisfies ChatAgentPolicyPort;

export const failures = {
  classifyServiceFailure: ({ text }) => classifyAgentServiceFailure({ text }),
  startupFailureMessage: (required, optional = {}) => startupFailureMessage(required, optional),
} satisfies ChatAgentFailurePort;
