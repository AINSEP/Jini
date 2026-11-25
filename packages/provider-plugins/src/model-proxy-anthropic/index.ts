/**
 * @file `/api/proxy/anthropic/stream` registration: this provider's request parser and its tool-turn runner call.
 * The daemon's model proxy holds no provider list; the host imports `createAnthropicProxyRegistration` and injects the result.
 */
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { COMMON_OPTIONAL_CHECKS, SYSTEM_CHECK, TOOLS_CHECK, extendParsed, isString, parseCommon, pickDefined, requiredFieldError, toolsOption, type OptionalFieldCheck, type ParsedProxyCommon } from '@jini-ai/core/contracts/agents/proxy-provider-kit';
import { err, type Result } from '@jini-ai/core/contracts/server';

export interface ParsedAnthropicProxyRequest extends ParsedProxyCommon {
  readonly apiVersion?: string;
  readonly system?: string;
  readonly tools?: unknown[];
  readonly maxTokens: number;
}

const ANTHROPIC_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  ['apiVersion', isString, 'apiVersion must be a string when provided'],
  SYSTEM_CHECK,
  TOOLS_CHECK,
];

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function parseAnthropicProxyRequest(body: unknown): Result<ParsedAnthropicProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;
  if (!isPositiveFiniteNumber(record.maxTokens)) {
    return err({ error: requiredFieldError({ path: 'maxTokens', message: 'maxTokens must be a positive number', issue: 'required positive number' }) });
  }
  return extendParsed<ParsedAnthropicProxyRequest>({ base: common.value, record, checks: ANTHROPIC_OPTIONAL_CHECKS }, { required: { maxTokens: record.maxTokens } });
}

/** The Anthropic Messages registration: `maxTokens` is required (the API demands it), everything else forwards only when the request carried it. */
export function createAnthropicProxyRegistration(): ProxyProviderRegistration<ParsedAnthropicProxyRequest> {
  return {
    id: 'anthropic',
    parse: parseAnthropicProxyRequest,
    run: (parsed, { toolTurns, onEvent, shared }) =>
      toolTurns.anthropic(
        { apiKey: parsed.apiKey, model: parsed.model, maxTokens: parsed.maxTokens, messages: parsed.messages, onEvent },
        {
          ...pickDefined({ source: parsed, keys: ['baseUrl', 'apiVersion', 'system', 'temperature', 'maxToolTurns', 'extraHeaders'] }),
          ...toolsOption(parsed.tools),
          ...shared,
        },
      ),
  };
}
