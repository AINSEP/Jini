/**
 * @file `/api/proxy/openai/stream` registration: this provider's request parser and its tool-turn runner call.
 * The daemon's model proxy holds no provider list; the host imports `createOpenAiProxyRegistration` and injects the result.
 */
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { parseToolsProxyRequest, pickDefined, toolsOption, type ParsedToolsProxyRequest } from '@jini-ai/core/contracts/agents/proxy-provider-kit';



/** The OpenAI Chat Completions registration; it shares the OpenAI-shaped request body (shared fields plus optional `tools`). */
export function createOpenAiProxyRegistration(): ProxyProviderRegistration<ParsedToolsProxyRequest> {
  return {
    id: 'openai',
    parse: parseToolsProxyRequest,
    run: (parsed, { toolTurns, onEvent, shared }) =>
      toolTurns.openai(
        { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages, onEvent },
        {
          ...pickDefined({ source: parsed, keys: ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
          ...toolsOption(parsed.tools),
          ...shared,
        },
      ),
  };
}
