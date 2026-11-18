/** @file What chat needs from an agent runtime, as ports the host binds. Chat states the shapes with vocabulary from
 * `@jini-ai/core/contracts/agents`; it does not pick the runtime. */
import type { AgentServiceFailureCode, ModelIdentityKind, NativeToolPolicyInput, RuntimeModelOption, RuntimeReasoningOption } from '@jini-ai/core/contracts/agents';

/** Model-selection and native-tool policy are the agent runtime's domain rules; chat receives them (React: through the chat kit's `agents` slot). */
export interface ChatAgentPolicyPort {
  modelIdentityKind(required: { id: string }): ModelIdentityKind;
  concreteModelOptions(required: { models?: readonly RuntimeModelOption[]; supportsConcreteModelSelection?: boolean; defaultModelResolution?: { status: string; id?: string } }): RuntimeModelOption[];
  modelReasoningOptions(required: { agent: { reasoningOptions?: readonly RuntimeReasoningOption[]; reasoningInModelId?: { levels: readonly RuntimeReasoningOption[] } }; model?: Pick<RuntimeModelOption, 'reasoning'> | undefined }): RuntimeReasoningOption[];
  /** A plain-words refusal to show before sending, or `null` when the policy allows the run. */
  assessNativeToolPolicy(required: { def: { name: string; supportsNativeToolAccess?: boolean; fullCliAccessOnly?: boolean }; policy: NativeToolPolicyInput }): string | null;
}

/** Server side: durable-run recovery classifies saved failures. */
export interface ChatAgentFailurePort {
  /** `null` for an ordinary failure that belongs to no service class. */
  classifyServiceFailure(required: { text: string }): AgentServiceFailureCode | null;
  startupFailureMessage(required: { stage: string; error: unknown }, optional?: { exactSecrets?: readonly string[]; notice?: string }): string;
}
