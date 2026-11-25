/**
 * @file `/api/proxy/google/stream` registration: this provider's request parser and its tool-turn runner call.
 * The daemon's model proxy holds no provider list; the host imports `createGoogleProxyRegistration` and injects the result.
 */
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { SYSTEM_CHECK, TOOLS_CHECK, extendParsed, isNumber, parseCommon, pickDefined, toolsOption, type OptionalFieldCheck, type ParsedProxyCommon } from '@jini-ai/core/contracts/agents/proxy-provider-kit';
import type { Result } from '@jini-ai/core/contracts/server';

export interface ParsedGoogleProxyRequest extends ParsedProxyCommon {
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxOutputTokens?: number;
}

const GOOGLE_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  SYSTEM_CHECK,
  TOOLS_CHECK,
  ['maxOutputTokens', isNumber, 'maxOutputTokens must be a number when provided'],
];

/** `parsed.messages` carries Gemini's own `contents: [{role, parts}]` shape at the call site below (cast, same convention as `parsed.messages`) — the HTTP JSON body schema stays uniform across all five providers; only each turn-runner's own field name differs. */
export function parseGoogleProxyRequest(body: unknown): Result<ParsedGoogleProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  return extendParsed<ParsedGoogleProxyRequest>({ base: common.value, record: body as Record<string, unknown>, checks: GOOGLE_OPTIONAL_CHECKS });
}

/** The Google (Gemini) registration: the body's `messages` travel to the runner as Gemini `contents`. */
export function createGoogleProxyRegistration(): ProxyProviderRegistration<ParsedGoogleProxyRequest> {
  return {
    id: 'google',
    parse: parseGoogleProxyRequest,
    run: (parsed, { toolTurns, onEvent, shared }) =>
      toolTurns.google(
        { apiKey: parsed.apiKey, model: parsed.model, contents: parsed.messages, onEvent },
        {
          ...pickDefined({ source: parsed, keys: ['baseUrl', 'system', 'temperature', 'maxOutputTokens', 'maxToolTurns', 'extraHeaders'] }),
          ...toolsOption(parsed.tools),
          ...shared,
        },
      ),
  };
}
