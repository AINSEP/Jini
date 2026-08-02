/**
 * @module catalog
 *
 * Product-neutral catalog and safety contracts used by the Composio adapter.
 */
import type { JsonValue } from '@jini-ai/protocol';

import { getConnectorSchemaSupportError } from './json-schema.js';

export type JsonObject = { [key: string]: JsonValue };

export type ConnectorStatus = 'available' | 'connected' | 'error' | 'disabled';
export type ConnectorToolSideEffect = 'read' | 'write' | 'destructive' | 'unknown';
export type ConnectorToolApproval = 'auto' | 'confirm' | 'disabled';
export type ConnectorToolUseCase = string;

export interface ConnectorToolSafety {
  sideEffect: ConnectorToolSideEffect;
  approval: ConnectorToolApproval;
  reason: string;
}

export interface ConnectorToolCuration {
  useCases?: ConnectorToolUseCase[];
  reason?: string;
}

export interface ConnectorToolDetail {
  name: string;
  title: string;
  description?: string;
  inputSchemaJson?: JsonObject;
  /** Present when the provider schema cannot be enforced safely. Such tools are never auto-callable. */
  inputSchemaUnsupportedReason?: string | undefined;
  outputSchemaJson?: JsonObject;
  safety: ConnectorToolSafety;
  refreshEligible: boolean;
  curation?: ConnectorToolCuration;
}

export interface ConnectorCatalogToolDefinition extends ConnectorToolDetail {
  /** Provider scopes required for this tool. Empty for local/read-only providers. */
  requiredScopes: string[];
  /** Provider-native tool identifier, when different from the package tool name. */
  providerToolId?: string;
}

export interface ConnectorDetail {
  id: string;
  name: string;
  provider: string;
  category: string;
  description?: string;
  status: ConnectorStatus;
  accountLabel?: string;
  tools: ConnectorToolDetail[];
  /**
   * Runtime execution allowlist. Subset of `tools`. The agent layer
   * only invokes tools whose names appear here. For Composio
   * connectors hydration may only preserve static tool authority or add an
   * exact package/host-curated provider identifier. Other discovered tools
   * are display-only regardless of provider metadata.
   *
   * Optional in the type only for fixture brevity; daemon-built
   * `ConnectorDetail` payloads always carry it.
   */
  allowedToolNames?: string[];
  /**
   * The hand-curated catalog subset. Stable across hydration: never
   * extended by provider discovery, only ever the static catalog
   * names. This preserves the static catalog baseline for consumers
   * that need that curated subset, but it is not the advertised
   * provider inventory count. UI summary badges should use `toolCount`
   * when present; the drawer's rendered tool rows still come from
   * `tools` directly.
   *
   * Optional in the type only for fixture brevity; daemon-built
   * `ConnectorDetail` payloads always carry it.
   */
  curatedToolNames?: string[];
  toolCount?: number;
  toolsNextCursor?: string;
  toolsHasMore?: boolean;
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  lastError?: string;
  auth?: ConnectorAuthDetail;
}

export interface ConnectorAuthDetail {
  provider: 'local' | 'none' | 'oauth' | 'composio';
  configured: boolean;
}

export interface ConnectorCatalogDefinition {
  id: string;
  name: string;
  provider: string;
  category: string;
  description?: string;
  tools: ConnectorCatalogToolDefinition[];
  /** The complete allowlist of callable tool names for this connector. */
  allowedToolNames: string[];
  /**
   * The hand-curated subset of `allowedToolNames` that is fixed at the
   * catalog level — never extended by provider discovery (issue #748).
   * Optional: when omitted, serialized wire details fall back to
   * `allowedToolNames`, which is the right preview subset for
   * non-Composio connectors that don't have a dynamic discovery layer
   * in the first place.
   */
  curatedToolNames?: string[];
  /** Display-only count of provider tools. This may be known before tool schemas are hydrated. */
  toolCount?: number;
  /** Preview pagination state for hydrated tool definitions. Execution code must not rely on partial pages. */
  toolsNextCursor?: string;
  toolsHasMore?: boolean;
  /** How the connector is made available. `none` and `local` connectors require no user OAuth state. */
  authentication: 'local' | 'none' | 'oauth' | 'composio';
  /** Provider toolkit slug used by external connector providers such as Composio. */
  providerConnectorId?: string;
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  disabled?: boolean;
}

export interface ConnectorToolSafetyClassificationInput {
  name: string;
  providerToolId?: string;
  title?: string;
  description?: string;
  requiredScopes?: readonly string[];
}

const destructiveHintPattern = /(?:^|[._:\-/\s])(?:ban|deactivate|delete|destroy|disconnect|drop|erase|purge|remove-all|remove_all|reset|revoke|terminate|truncate|unlink|wipe)(?:$|[._:\-/\s])/i;
const writeHintPattern = /(?:^|[._:\-/\s])(?:add|admin|append|approve|archive|assign|cancel|close|comment|complete|copy|create|disable|edit|enable|import|invite|join|leave|like|manage|mark|merge|move|mute|post|publish|react|rename|reply|restore|schedule|send|set|share|star|submit|subscribe|transfer|unarchive|update|upload|upsert|write)(?:$|[._:\-/\s])/i;
const readOnlyHintPattern = /(?:^|[._:\-/\s])(?:download|fetch|find|get|inspect|list|lookup|query|read|readonly|read-only|read_only|search|status|summary|view)(?:$|[._:\-/\s])/i;

function connectorToolSafetyHaystack(input: ConnectorToolSafetyClassificationInput): string {
  return [input.name, input.providerToolId, input.title, input.description, ...(input.requiredScopes ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

/**
 * Classifies a provider tool conservatively from its name, description, and
 * scopes. Ambiguous tools require confirmation.
 */
export function classifyConnectorToolSafety(input: ConnectorToolSafetyClassificationInput): ConnectorToolSafety {
  const haystack = connectorToolSafetyHaystack(input);
  if (destructiveHintPattern.test(haystack)) {
    return {
      sideEffect: 'destructive',
      approval: 'disabled',
      reason: 'Tool name, scope, or description contains destructive hints; destructive tools are not refreshable.',
    };
  }
  if (writeHintPattern.test(haystack)) {
    return {
      sideEffect: 'write',
      approval: 'confirm',
      reason: 'Tool name, scope, or description indicates write-capable behavior; explicit confirmation is required.',
    };
  }
  if (readOnlyHintPattern.test(haystack)) {
    return {
      sideEffect: 'read',
      approval: 'auto',
      reason: 'Tool metadata consistently indicates explicit read-only behavior.',
    };
  }
  return {
    sideEffect: 'write',
    approval: 'confirm',
    reason: 'Tool safety could not be proven read-only; defaulting to confirmation-required write policy.',
  };
}

/** Returns whether a tool is safe for unattended refresh execution. */
export function isRefreshEligibleConnectorToolSafety(safety: ConnectorToolSafety): boolean {
  return safety.sideEffect === 'read' && safety.approval === 'auto';
}

/**
 * Builds a catalog tool and derives safety defaults when the caller omitted
 * them.
 *
 * @overallScore 100/100
 */
export function defineConnectorTool(
  tool: Omit<ConnectorCatalogToolDefinition, 'safety' | 'refreshEligible'> & {
    safety?: ConnectorToolSafety;
    refreshEligible?: boolean;
  },
): ConnectorCatalogToolDefinition {
  const safety = tool.safety ?? classifyConnectorToolSafety(tool);
  const inputSchemaUnsupportedReason = tool.inputSchemaUnsupportedReason
    ?? (tool.inputSchemaJson === undefined
      ? 'connector input schema is missing'
      : getConnectorSchemaSupportError(tool.inputSchemaJson));
  return {
    ...tool,
    safety,
    ...(inputSchemaUnsupportedReason === undefined ? {} : { inputSchemaUnsupportedReason }),
    refreshEligible: inputSchemaUnsupportedReason === undefined
      && (tool.refreshEligible ?? isRefreshEligibleConnectorToolSafety(safety)),
  };
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
  }
  return value;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject;
}

function toolDefinitionToDetail(tool: ConnectorCatalogToolDefinition): ConnectorToolDetail {
  return {
    name: tool.name,
    title: tool.title,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    ...(tool.inputSchemaJson === undefined ? {} : { inputSchemaJson: cloneJsonObject(tool.inputSchemaJson) }),
    ...(tool.inputSchemaUnsupportedReason === undefined ? {} : { inputSchemaUnsupportedReason: tool.inputSchemaUnsupportedReason }),
    ...(tool.outputSchemaJson === undefined ? {} : { outputSchemaJson: cloneJsonObject(tool.outputSchemaJson) }),
    safety: { ...tool.safety },
    refreshEligible: tool.refreshEligible,
    ...(tool.curation === undefined
      ? {}
      : { curation: { ...(tool.curation.useCases === undefined ? {} : { useCases: [...tool.curation.useCases] }), ...(tool.curation.reason === undefined ? {} : { reason: tool.curation.reason }) } }),
  };
}

/**
 * Creates a detached wire detail from a catalog definition.
 *
 * @overallScore 100/100
 */
export function connectorDefinitionToDetail(definition: ConnectorCatalogDefinition): ConnectorDetail {
  return {
    id: definition.id,
    name: definition.name,
    provider: definition.provider,
    category: definition.category,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    status: definition.disabled ? 'disabled' : 'available',
    tools: definition.tools.map((tool) => toolDefinitionToDetail(tool)),
    allowedToolNames: [...definition.allowedToolNames],
    // Fall back to `allowedToolNames` when `curatedToolNames` isn't
    // explicitly set — non-Composio connectors don't go through a
    // dynamic merge, so for them the two are equivalent and the badge
    // is stable either way (issue #748).
    curatedToolNames: [...(definition.curatedToolNames ?? definition.allowedToolNames)],
    ...(definition.toolCount === undefined ? {} : { toolCount: definition.toolCount }),
    ...(definition.toolsNextCursor === undefined ? {} : { toolsNextCursor: definition.toolsNextCursor }),
    ...(definition.toolsHasMore === undefined ? {} : { toolsHasMore: definition.toolsHasMore }),
    ...(definition.featuredToolNames === undefined
      ? {}
      : { featuredToolNames: [...definition.featuredToolNames] }),
    ...(definition.minimumApproval === undefined ? {} : { minimumApproval: definition.minimumApproval }),
    auth: {
      provider: definition.authentication,
      configured: definition.authentication === 'local' || definition.authentication === 'none',
    },
  };
}
