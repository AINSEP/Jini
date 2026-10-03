import type { runAnthropicToolTurn } from './anthropic-messages.js';
import type { runOpenAiToolTurn } from './openai-chat.js';
import type { runAzureToolTurn } from './azure-chat.js';
import type { runGoogleToolTurn } from './google-messages.js';
/** Adapter ports retain each existing provider's request and tool-loop contract. */
export interface ProviderTurnAdapters {
  readonly anthropic: typeof runAnthropicToolTurn;
  readonly openai: typeof runOpenAiToolTurn;
  readonly azure: typeof runAzureToolTurn;
  readonly google: typeof runGoogleToolTurn;
}

/** Structural descriptors keep host registries out of the runtime dependency graph. */
export interface ProviderToolDescriptor { readonly id: string; readonly description?: string; readonly inputSchema?: unknown; }
export type ProviderProtocol = "anthropic" | "openai" | "azure" | "google";
export interface ProviderChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
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
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly maxToolTurns?: number;
  readonly signal?: AbortSignal;
}
