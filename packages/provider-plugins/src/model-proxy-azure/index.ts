/**
 * @file `/api/proxy/azure/stream` registration: this provider's request parser and its tool-turn runner call.
 * The daemon's model proxy holds no provider list; the host imports `createAzureProxyRegistration` and injects the result.
 */
import type { ProxyProviderRegistration } from '@jini-ai/core/contracts/agents/proxy-provider';
import { TOOLS_CHECK, extendParsed, nonEmptyString, parseCommon, pickDefined, requiredFieldError, toolsOption, type ParsedProxyCommon } from '@jini-ai/core/contracts/agents/proxy-provider-kit';
import { err, type Result } from '@jini-ai/core/contracts/server';

export interface ParsedAzureProxyRequest extends ParsedProxyCommon {
  /** Required for Azure, unlike the other four providers — every Azure OpenAI resource has its own endpoint (see `@jini-ai/agent-runtime`'s `azure-chat.ts`). */
  readonly baseUrl: string;
  /** Required for Azure — no sane global default exists at the HTTP-request-shape level either (the turn-runner itself does have a `'2024-10-21'` fallback, but this route requires the caller be explicit). */
  readonly apiVersion: string;
  readonly tools?: unknown[];
}

export function parseAzureProxyRequest(body: unknown): Result<ParsedAzureProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  const record = body as Record<string, unknown>;
  const { baseUrl } = common.value;
  // Truthiness only, unlike `apiVersion`'s trim check: a whitespace-only baseUrl passes here and
  // fails inside the turn-runner instead (pinned as "reported, not fixed").
  if (!baseUrl) {
    return err({ error: requiredFieldError({ path: 'baseUrl', message: 'baseUrl must be a non-empty string', issue: 'required non-empty string' }) });
  }
  const apiVersion = nonEmptyString(record.apiVersion);
  if (!apiVersion) {
    return err({ error: requiredFieldError({ path: 'apiVersion', message: 'apiVersion must be a non-empty string', issue: 'required non-empty string' }) });
  }
  return extendParsed<ParsedAzureProxyRequest>({ base: common.value, record, checks: [TOOLS_CHECK] }, { required: { baseUrl, apiVersion } });
}

/** The Azure OpenAI registration: `baseUrl` and `apiVersion` are required, every Azure resource having its own endpoint. */
export function createAzureProxyRegistration(): ProxyProviderRegistration<ParsedAzureProxyRequest> {
  return {
    id: 'azure',
    parse: parseAzureProxyRequest,
    run: (parsed, { toolTurns, onEvent, shared }) =>
      toolTurns.azure(
        { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl, model: parsed.model, messages: parsed.messages, onEvent },
        {
          apiVersion: parsed.apiVersion,
          ...pickDefined({ source: parsed, keys: ['temperature', 'maxTokens', 'maxToolTurns', 'extraHeaders'] }),
          ...toolsOption(parsed.tools),
          ...shared,
        },
      ),
  };
}
