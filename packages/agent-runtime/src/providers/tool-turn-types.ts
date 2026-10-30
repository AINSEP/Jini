import type { runAnthropicToolTurn, AnthropicToolDef } from './anthropic-messages.js';
import type { runOpenAiToolTurn, OpenAiFunctionToolDef } from './openai-chat.js';
import type { runAzureToolTurn, AzureFunctionToolDef } from './azure-chat.js';
import type { runGoogleToolTurn, GoogleToolDef } from './google-messages.js';
import type { ProviderToolSnapshotOptions, ProviderSchemaFallback, ProviderProtocol } from './provider-tool-policy.js';

export type { ProviderToolSnapshotOptions, ProviderSchemaFallback, ProviderProtocol } from './provider-tool-policy.js';
type RefreshableAdapter<Required, Optional, Result, Tool> = (required: Required, optional?: Optional & {
  /** Read immediately before each request, including a recognized schema downgrade. */
  readonly getTools?: (options?: ProviderToolSnapshotOptions) => readonly Tool[];
  readonly onSchemaFallback?: (event: ProviderSchemaFallback) => void;
}) => Result;
type AnthropicAdapter = typeof runAnthropicToolTurn;
type OpenAiAdapter = typeof runOpenAiToolTurn;
type AzureAdapter = typeof runAzureToolTurn;
type GoogleAdapter = typeof runGoogleToolTurn;
/** Existing adapters remain assignable; refresh-aware loops consume the optional projection hook. */
export interface ProviderTurnAdapters {
  readonly anthropic: RefreshableAdapter<Parameters<AnthropicAdapter>[0], Parameters<AnthropicAdapter>[1], ReturnType<AnthropicAdapter>, AnthropicToolDef>;
  readonly openai: RefreshableAdapter<Parameters<OpenAiAdapter>[0], Parameters<OpenAiAdapter>[1], ReturnType<OpenAiAdapter>, OpenAiFunctionToolDef>;
  readonly azure: RefreshableAdapter<Parameters<AzureAdapter>[0], Parameters<AzureAdapter>[1], ReturnType<AzureAdapter>, AzureFunctionToolDef>;
  readonly google: RefreshableAdapter<Parameters<GoogleAdapter>[0], Parameters<GoogleAdapter>[1], ReturnType<GoogleAdapter>, GoogleToolDef>;
}

/** Structural descriptors keep host registries out of the runtime dependency graph. */
export interface ProviderToolDescriptor {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  /** Preserve a wire name already assigned by the run's core exposure snapshot. */
  readonly wireName?: string;
}
export interface ProviderChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Shared attachment pixels, translated only at the existing wire adapter seam. */
  readonly images?: readonly { readonly mimeType: string; readonly data: string }[];
}
export type ProviderTurnEvent = {
  readonly type: "status";
  readonly label: string;
} | {
  readonly type: "text_delta";
  readonly delta: string;
} | {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
} | {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
} | {
  readonly type: "usage";
  readonly usage: Record<string, unknown> | null;
} | {
  readonly type: "error";
  readonly message: string;
} | {
  readonly type: "end";
  readonly reason: string;
};
export interface ProviderToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export type ProviderToolResultBlock = {
  readonly type: "text";
  readonly text: string;
} | {
  readonly type: "image";
  readonly mimeType: string;
  readonly data: string;
};
export interface ProviderToolResult {
  readonly content: string | readonly ProviderToolResultBlock[];
  readonly isError?: boolean;
}
export type ProviderToolExecutor = (call: ProviderToolCall) => Promise<ProviderToolResult>;
/** Raw provider call metadata: an unpublished wire name has no canonical tool ID or decoder. */
export interface ProviderUnexposedToolCall {
  readonly toolName: string;
  readonly callId: string;
  readonly input: unknown;
  readonly protocol: ProviderProtocol;
}
/** Refusal wording only; no result content, success flag, or execution capability is accepted. */
export interface ProviderToolRefusal { readonly text: string }
/** May audit the denied attempt; throws/rejections propagate and never authorize execution. */
export type ProviderUnexposedToolCallHandler = (call: ProviderUnexposedToolCall) =>
  ProviderToolRefusal | undefined | Promise<ProviderToolRefusal | undefined>;
export interface ProviderToolTurnInput {
  readonly protocol: ProviderProtocol;
  readonly adapters: ProviderTurnAdapters;
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly messages: readonly ProviderChatMessage[];
  readonly tools: readonly ProviderToolDescriptor[];
  readonly executeTool: ProviderToolExecutor;
  readonly onEvent: (event: ProviderTurnEvent) => void;
}
export interface ProviderToolTurnResult {
  readonly stopReason: string | null;
  readonly toolTurns: number;
}

/** Optional turn controls; dependencies belong in the required input object. */
export interface ProviderToolTurnOptions {
  /** Audit and word an unpublished call's refusal. Undefined retains the built-in text.
   * The result is always an error; this callback must never execute a tool handler.
   * @example onUnexposedToolCall: async ({ toolName, callId }) => {
   *   await auditDeniedAttempt({ toolName, callId });
   *   return { text: 'This tool is unavailable.' };
   * }
   */
  readonly onUnexposedToolCall?: ProviderUnexposedToolCallHandler;
  /** Current run-scoped descriptors; adapters refresh the projection before every request. */
  readonly getToolSnapshot?: () => readonly ProviderToolDescriptor[];
  /** Value-free diagnostic only; execution must still validate through the host executor. */
  readonly onSchemaFallback?: (event: ProviderSchemaFallback) => void;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly maxToolTurns?: number;
  readonly signal?: AbortSignal;
}
