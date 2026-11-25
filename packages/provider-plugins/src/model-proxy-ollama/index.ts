/**
 * @file `/api/proxy/ollama/stream` registration: this provider's request parser and its tool-turn runner call.
 * The daemon's model proxy holds no provider list; the host imports `createOllamaProxyRegistration` and injects the result.
 */
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { parseToolsProxyRequest, pickDefined, toolsOption, type ParsedToolsProxyRequest } from '@jini-ai/core/contracts/agents/proxy-provider-kit';



/** The Ollama native `/api/chat` registration (`apiKey` required: the default target is Ollama Cloud); it shares the OpenAI-shaped request body (shared fields plus optional `tools`). */
export function createOllamaProxyRegistration(): ProxyProviderRegistration<ParsedToolsProxyRequest> {
  return {
    id: 'ollama',
    parse: parseToolsProxyRequest,
    run: (parsed, { toolTurns, onEvent, shared }) =>
      toolTurns.ollama(
        { apiKey: parsed.apiKey, model: parsed.model, messages: parsed.messages, onEvent },
        {
          ...pickDefined({ source: parsed, keys: ['baseUrl', 'temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
          ...toolsOption(parsed.tools),
          ...shared,
        },
      ),
  };
}
