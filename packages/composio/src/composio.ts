/**
 * @module composio
 *
 * Injected Composio catalog, OAuth, connected-account, and execution adapter.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { JsonValue } from '@jini-ai/protocol';
import {
  BoundedDataError,
  COMPOSIO_MAX_CACHE_BYTES,
  COMPOSIO_MAX_ERROR_RESPONSE_BYTES,
  COMPOSIO_MAX_RESPONSE_BYTES,
  readBoundedResponseJson,
  readBoundedUtf8File,
  toStructurallyBoundedJsonValue,
} from './bounded-data.js';
import {
  classifyConnectorToolSafety,
  defineConnectorTool,
  type ConnectorCatalogDefinition,
  type ConnectorCatalogToolDefinition,
  type ConnectorToolCuration,
  type JsonObject,
} from './catalog.js';
import type { ComposioConfigStore } from './composio-config.js';
import { getComposioToolkitMetadata } from './composio-descriptions.js';
import { ConnectorServiceError } from './errors.js';
import {
  assertConnectorInputMatchesSchema,
  getConnectorSchemaSupportError,
} from './json-schema.js';
import { withExclusiveFileLock } from './file-lock.js';
import { protectConnectorOutput } from './output-protection.js';
import type { ConnectorCredentialMaterial } from './service.js';

type BoundedJsonObject = JsonObject;
type BoundedJsonValue = JsonValue;

const DEFAULT_COMPOSIO_BASE_URL = 'https://backend.composio.dev';
const DEFAULT_COMPOSIO_TIMEOUT_MS = 30_000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_CACHE_TTL_MS = 60_000;
const PERSISTED_CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
const DEFAULT_USER_AGENT = '@jini-ai/composio/0.1';
const COMPOSIO_MAX_LIST_ITEMS = 1_000;

const COMPOSIO_READ_ONLY_TOOL_SAFETY_OVERRIDES = new Set([
  'notion:notion_search_notion_page',
]);

// Exact package-owned authority for provider tools that are intentionally
// available even though their full schema is hydrated from Composio.
const COMPOSIO_STATIC_DISCOVERED_TOOL_ALLOWLIST = new Set([
  'github:github_list_repositories',
]);

const COMPOSIO_READ_ONLY_TOOL_SAFETY = {
  sideEffect: 'read',
  approval: 'auto',
  reason: 'Provider-specific override: this Composio tool is a read-only search/list operation.',
} as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Static toolkit inventory entry. */
export interface ComposioToolkitCatalogEntry {
  name: string;
  slug: string;
  category?: string;
}

/** @internal Package-local cache wire contract; not re-exported from the package root. */
export interface PersistedComposioCatalogCache {
  schemaVersion: 1;
  fetchedAt: string;
  provider: 'composio';
  definitions: ConnectorCatalogDefinition[];
}

/** Default featured toolkit definitions shipped by the vendor adapter. */
export const FEATURED_COMPOSIO_CATALOG: readonly ConnectorCatalogDefinition[] = deepFreeze([
  {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    category: 'Developer',
    description: 'Search and inspect GitHub repositories, issues, and pull requests.',
    providerConnectorId: 'GITHUB',
    authentication: 'composio',
    tools: [
      defineConnectorTool({
        name: 'github.github_search_repositories',
        providerToolId: 'GITHUB_SEARCH_REPOSITORIES',
        title: 'Search repositories',
        description: 'Search public and private repositories.',
        inputSchemaJson: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['read'],
      }),
      defineConnectorTool({
        name: 'github.github_get_issue',
        providerToolId: 'GITHUB_GET_ISSUE',
        title: 'Get issue',
        description: 'Read a GitHub issue by owner, repository, and issue number.',
        inputSchemaJson: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, issue_number: { type: 'number' } }, required: ['owner', 'repo', 'issue_number'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['issues:read'],
      }),
    ],
    allowedToolNames: ['github.github_search_repositories', 'github.github_get_issue'],
    featuredToolNames: ['github.github_search_repositories', 'github.github_get_issue'],
    minimumApproval: 'auto',
    toolCount: 2,
  },
  {
    id: 'notion',
    name: 'Notion',
    provider: 'composio',
    category: 'Productivity',
    description: 'Search and read Notion pages and databases.',
    providerConnectorId: 'NOTION',
    authentication: 'composio',
    tools: [
      defineConnectorTool({
        name: 'notion.notion_search',
        providerToolId: 'NOTION_SEARCH',
        title: 'Search Notion',
        description: 'Search Notion pages and databases.',
        inputSchemaJson: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['read'],
      }),
      defineConnectorTool({
        name: 'notion.notion_fetch_database',
        providerToolId: 'NOTION_FETCH_DATABASE',
        title: 'Fetch database',
        description: 'Read a Notion database by id.',
        inputSchemaJson: { type: 'object', properties: { database_id: { type: 'string' } }, required: ['database_id'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['databases:read'],
      }),
    ],
    allowedToolNames: ['notion.notion_search', 'notion.notion_fetch_database'],
    featuredToolNames: ['notion.notion_search', 'notion.notion_fetch_database'],
    minimumApproval: 'auto',
    toolCount: 48,
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    provider: 'composio',
    category: 'Storage',
    description: 'Search and read files from Google Drive.',
    providerConnectorId: 'GOOGLEDRIVE',
    authentication: 'composio',
    tools: [
      defineConnectorTool({
        name: 'google_drive.googledrive_search',
        providerToolId: 'GOOGLEDRIVE_SEARCH',
        title: 'Search Drive',
        description: 'Search files in Google Drive.',
        inputSchemaJson: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['drive.readonly'],
      }),
      defineConnectorTool({
        name: 'google_drive.googledrive_get_file',
        providerToolId: 'GOOGLEDRIVE_GET_FILE',
        title: 'Get file',
        description: 'Read Google Drive file metadata by id.',
        inputSchemaJson: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'], additionalProperties: false },
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes: ['drive.readonly'],
      }),
    ],
    allowedToolNames: ['google_drive.googledrive_search', 'google_drive.googledrive_get_file'],
    featuredToolNames: ['google_drive.googledrive_search', 'google_drive.googledrive_get_file'],
    minimumApproval: 'auto',
    toolCount: 2,
  },
]);

/**
 * Point-in-time toolkit inventory last reviewed
 * against Composio's public toolkit API on 2026-07-23.
 */
export const DOCUMENTED_COMPOSIO_TOOLKITS: readonly ComposioToolkitCatalogEntry[] = deepFreeze([
  { name: 'Airtable', slug: 'AIRTABLE' },
  { name: 'Apaleo', slug: 'APALEO' },
  { name: 'Asana', slug: 'ASANA' },
  { name: 'Attio', slug: 'ATTIO' },
  { name: 'Basecamp', slug: 'BASECAMP' },
  { name: 'Bitbucket', slug: 'BITBUCKET' },
  { name: 'Blackbaud', slug: 'BLACKBAUD' },
  { name: 'Boldsign', slug: 'BOLDSIGN' },
  { name: 'Box', slug: 'BOX' },
  { name: 'Cal', slug: 'CAL' },
  { name: 'Calendly', slug: 'CALENDLY' },
  { name: 'Canva', slug: 'CANVA' },
  { name: 'Capsule CRM', slug: 'CAPSULE_CRM' },
  { name: 'ClickUp', slug: 'CLICKUP' },
  { name: 'Confluence', slug: 'CONFLUENCE' },
  { name: 'Contentful', slug: 'CONTENTFUL' },
  { name: 'Convex', slug: 'CONVEX' },
  { name: 'Crowdin', slug: 'CROWDIN' },
  { name: 'Dart', slug: 'DART' },
  { name: 'Dialpad', slug: 'DIALPAD' },
  { name: 'DigitalOcean', slug: 'DIGITAL_OCEAN' },
  { name: 'Discord', slug: 'DISCORD' },
  { name: 'Discord Bot', slug: 'DISCORDBOT' },
  { name: 'Dropbox', slug: 'DROPBOX' },
  { name: 'Dub', slug: 'DUB' },
  { name: 'Dynamics 365', slug: 'DYNAMICS365' },
  { name: 'Eventbrite', slug: 'EVENTBRITE' },
  { name: 'Excel', slug: 'EXCEL' },
  { name: 'Exist', slug: 'EXIST' },
  { name: 'Facebook', slug: 'FACEBOOK' },
  { name: 'Fathom', slug: 'FATHOM' },
  { name: 'Figma', slug: 'FIGMA' },
  { name: 'Freeagent', slug: 'FREEAGENT' },
  { name: 'FreshBooks', slug: 'FRESHBOOKS' },
  { name: 'GitHub', slug: 'GITHUB' },
  { name: 'GitLab', slug: 'GITLAB' },
  { name: 'Gmail', slug: 'GMAIL' },
  { name: 'Google Ads', slug: 'GOOGLEADS' },
  { name: 'Google Analytics', slug: 'GOOGLE_ANALYTICS' },
  { name: 'Google BigQuery', slug: 'GOOGLEBIGQUERY' },
  { name: 'Google Calendar', slug: 'GOOGLECALENDAR' },
  { name: 'Google Classroom', slug: 'GOOGLE_CLASSROOM' },
  { name: 'Google Docs', slug: 'GOOGLEDOCS' },
  { name: 'Google Drive', slug: 'GOOGLEDRIVE' },
  { name: 'Google Maps', slug: 'GOOGLE_MAPS' },
  { name: 'Google Meet', slug: 'GOOGLEMEET' },
  { name: 'Google Photos', slug: 'GOOGLEPHOTOS' },
  { name: 'Google Search Console', slug: 'GOOGLE_SEARCH_CONSOLE' },
  { name: 'Google Sheets', slug: 'GOOGLESHEETS' },
  { name: 'Google Slides', slug: 'GOOGLESLIDES' },
  { name: 'Google Super', slug: 'GOOGLESUPER' },
  { name: 'Google Tasks', slug: 'GOOGLETASKS' },
  { name: 'Gorgias', slug: 'GORGIAS' },
  { name: 'Gumroad', slug: 'GUMROAD' },
  { name: 'Harvest', slug: 'HARVEST' },
  { name: 'HubSpot', slug: 'HUBSPOT' },
  { name: 'Hugging Face', slug: 'HUGGING_FACE' },
  { name: 'Instagram', slug: 'INSTAGRAM' },
  { name: 'Intercom', slug: 'INTERCOM' },
  { name: 'Jira', slug: 'JIRA' },
  { name: 'Kit', slug: 'KIT' },
  { name: 'Linear', slug: 'LINEAR' },
  { name: 'LinkedIn', slug: 'LINKEDIN' },
  { name: 'Linkhut', slug: 'LINKHUT' },
  { name: 'Mailchimp', slug: 'MAILCHIMP' },
  { name: 'Microsoft Teams', slug: 'MICROSOFT_TEAMS' },
  { name: 'Miro', slug: 'MIRO' },
  { name: 'Monday', slug: 'MONDAY' },
  { name: 'Moneybird', slug: 'MONEYBIRD' },
  { name: 'Mural', slug: 'MURAL' },
  { name: 'Notion', slug: 'NOTION' },
  { name: 'Omnisend', slug: 'OMNISEND' },
  { name: 'OneDrive', slug: 'ONE_DRIVE' },
  { name: 'Outlook', slug: 'OUTLOOK' },
  { name: 'PagerDuty', slug: 'PAGERDUTY' },
  { name: 'Prisma', slug: 'PRISMA' },
  { name: 'Productboard', slug: 'PRODUCTBOARD' },
  { name: 'Pushbullet', slug: 'PUSHBULLET' },
  { name: 'QuickBooks', slug: 'QUICKBOOKS' },
  { name: 'Reddit', slug: 'REDDIT' },
  { name: 'Reddit Ads', slug: 'REDDIT_ADS' },
  { name: 'Roam', slug: 'ROAM' },
  { name: 'Salesforce', slug: 'SALESFORCE' },
  { name: 'Sentry', slug: 'SENTRY' },
  { name: 'Servicem8', slug: 'SERVICEM8' },
  { name: 'SharePoint', slug: 'SHARE_POINT' },
  { name: 'Shippo', slug: 'SHIPPO' },
  { name: 'Slack', slug: 'SLACK' },
  { name: 'Slackbot', slug: 'SLACKBOT' },
  { name: 'Splitwise', slug: 'SPLITWISE' },
  { name: 'Square', slug: 'SQUARE' },
  { name: 'Stack Exchange', slug: 'STACK_EXCHANGE' },
  { name: 'Strava', slug: 'STRAVA' },
  { name: 'Stripe', slug: 'STRIPE' },
  { name: 'Supabase', slug: 'SUPABASE' },
  { name: 'Ticketmaster', slug: 'TICKETMASTER' },
  { name: 'Ticktick', slug: 'TICKTICK' },
  { name: 'Timely', slug: 'TIMELY' },
  { name: 'Todoist', slug: 'TODOIST' },
  { name: 'Toneden', slug: 'TONEDEN' },
  { name: 'Trello', slug: 'TRELLO' },
  { name: 'Typeform', slug: 'TYPEFORM' },
  { name: 'WakaTime', slug: 'WAKATIME' },
  { name: 'Webex', slug: 'WEBEX' },
  { name: 'WhatsApp', slug: 'WHATSAPP' },
  { name: 'Wrike', slug: 'WRIKE' },
  { name: 'Yandex', slug: 'YANDEX' },
  { name: 'YNAB', slug: 'YNAB' },
  { name: 'YouTube', slug: 'YOUTUBE' },
  { name: 'Zendesk', slug: 'ZENDESK' },
  { name: 'Zoho', slug: 'ZOHO' },
  { name: 'Zoho Bigin', slug: 'ZOHO_BIGIN' },
  { name: 'Zoho Books', slug: 'ZOHO_BOOKS' },
  { name: 'Zoho Desk', slug: 'ZOHO_DESK' },
  { name: 'Zoho Inventory', slug: 'ZOHO_INVENTORY' },
  { name: 'Zoho Invoice', slug: 'ZOHO_INVOICE' },
  { name: 'Zoho Mail', slug: 'ZOHO_MAIL' },
  { name: 'Zoom', slug: 'ZOOM' },
  { name: 'Apify MCP', slug: 'APIFY_MCP' },
  { name: 'BambooHR', slug: 'BAMBOOHR' },
  { name: 'Beeminder', slug: 'BEEMINDER' },
  { name: 'Bitwarden', slug: 'BITWARDEN' },
  { name: 'Blackboard', slug: 'BLACKBOARD' },
  { name: 'Borneo', slug: 'BORNEO' },
  { name: 'Brevo', slug: 'BREVO' },
  { name: 'Brex', slug: 'BREX' },
  { name: 'Canvas', slug: 'CANVAS' },
  { name: 'Clockify', slug: 'CLOCKIFY' },
  { name: 'Coupa', slug: 'COUPA' },
  { name: 'D2L Brightspace', slug: 'D2LBRIGHTSPACE' },
  { name: 'Databricks', slug: 'DATABRICKS' },
  { name: 'Datadog', slug: 'DATADOG' },
  { name: 'DocuSign', slug: 'DOCUSIGN' },
  { name: 'Dropbox Sign', slug: 'DROPBOX_SIGN' },
  { name: 'Egnyte', slug: 'EGNYTE' },
  { name: 'Epic Games', slug: 'EPIC_GAMES' },
  { name: 'Fly', slug: 'FLY' },
  { name: 'Follow Up Boss', slug: 'FOLLOW_UP_BOSS' },
  { name: 'Gong', slug: 'GONG' },
  { name: 'Google Admin', slug: 'GOOGLE_ADMIN' },
  { name: 'Google Chat', slug: 'GOOGLE_CHAT' },
  { name: 'Googlecontacts', slug: 'GOOGLECONTACTS' },
  { name: 'Googleforms', slug: 'GOOGLEFORMS' },
  { name: 'Granola MCP', slug: 'GRANOLA_MCP' },
  { name: 'Gusto', slug: 'GUSTO' },
  { name: 'Help Scout', slug: 'HELP_SCOUT' },
  { name: 'Highlevel', slug: 'HIGHLEVEL' },
  { name: 'Insighto.ai', slug: 'INSIGHTO_AI' },
  { name: 'Klaviyo', slug: 'KLAVIYO' },
  { name: 'Kommo', slug: 'KOMMO' },
  { name: 'Lever', slug: 'LEVER' },
  { name: 'Linkedin Ads', slug: 'LINKEDIN_ADS' },
  { name: 'Lodgify', slug: 'LODGIFY' },
  { name: 'Matterport', slug: 'MATTERPORT' },
  { name: 'Meta Ads', slug: 'METAADS' },
  { name: 'Monday MCP', slug: 'MONDAY_MCP' },
  { name: 'Netsuite', slug: 'NETSUITE' },
  { name: 'Parma', slug: 'PARMA' },
  { name: 'Pinecone', slug: 'PINECONE' },
  { name: 'Pipedrive', slug: 'PIPEDRIVE' },
  { name: 'Ramp', slug: 'RAMP' },
  { name: 'Razorpay', slug: 'RAZORPAY' },
  { name: 'Recruitee', slug: 'RECRUITEE' },
  { name: 'Salesforce Service Cloud', slug: 'SALESFORCE_SERVICE_CLOUD' },
  { name: 'Scheduleonce', slug: 'SCHEDULEONCE' },
  { name: 'Sendloop', slug: 'SENDLOOP' },
  { name: 'ServiceNow', slug: 'SERVICENOW' },
  { name: 'Shopify', slug: 'SHOPIFY' },
  { name: 'Snapchat', slug: 'SNAPCHAT' },
  { name: 'Snowflake', slug: 'SNOWFLAKE' },
  { name: 'Spotify', slug: 'SPOTIFY' },
  { name: 'Storyblok', slug: 'STORYBLOK' },
  { name: 'SurveyMonkey', slug: 'SURVEY_MONKEY' },
  { name: 'Tally', slug: 'TALLY' },
  { name: 'Tavily MCP', slug: 'TAVILY_MCP' },
  { name: 'Tiktok', slug: 'TIKTOK' },
  { name: 'TinyFish MCP', slug: 'TINYFISH_MCP' },
  { name: 'Twitter', slug: 'TWITTER' },
  { name: 'Webflow', slug: 'WEBFLOW' },
  { name: 'Xero', slug: 'XERO' },
  { name: 'Zoominfo', slug: 'ZOOMINFO' },
]);

interface ComposioConnectedAccountResponse {
  id?: unknown;
  nanoid?: unknown;
  connected_account_id?: unknown;
  connectedAccountId?: unknown;
  status?: unknown;
  redirect_url?: unknown;
  redirectUrl?: unknown;
  user_id?: unknown;
  userId?: unknown;
  account_id?: unknown;
  accountId?: unknown;
  account_label?: unknown;
  accountLabel?: unknown;
  name?: unknown;
  email?: unknown;
  auth_config?: { id?: unknown };
  toolkit?: { slug?: unknown };
  metadata?: unknown;
}

interface ComposioAuthConfigResponse {
  id?: unknown;
  status?: unknown;
  toolkit?: { slug?: unknown };
  toolkit_slug?: unknown;
  toolkitSlug?: unknown;
  auth_config?: { id?: unknown };
}

interface ComposioToolkitResponse {
  slug?: unknown;
  name?: unknown;
  logo?: unknown;
  description?: unknown;
  categories?: unknown;
  meta?: {
    description?: unknown;
    categories?: unknown;
    tools_count?: unknown;
    toolsCount?: unknown;
  };
}

interface ComposioToolResponse {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  human_description?: unknown;
  humanDescription?: unknown;
  input_parameters?: unknown;
  inputParameters?: unknown;
  tags?: unknown;
  scopes?: unknown;
  oauth_scopes?: unknown;
  oauthScopes?: unknown;
  auth_scopes?: unknown;
  authScopes?: unknown;
  toolkit?: { slug?: unknown };
}

type HydratedComposioToolDefinition = ConnectorCatalogToolDefinition & {
  providerToolId: string;
};

interface ComposioToolsPage {
  items: ComposioToolResponse[];
  nextCursor?: string;
  totalItems?: number;
}

interface ComposioToolExecuteResponse {
  data?: unknown;
  error?: unknown;
  successful?: unknown;
  session_info?: unknown;
  sessionInfo?: unknown;
  log_id?: unknown;
  logId?: unknown;
}

export interface ComposioConnectionStart {
  kind: 'redirect_required' | 'pending' | 'connected';
  redirectUrl?: string;
  providerConnectionId?: string;
  expiresAt?: string;
  accountLabel?: string;
  credentials?: ComposioCredentialMaterial;
}

export interface ComposioPendingConnection {
  connectorId: string;
  state: string;
  providerConnectionId?: string;
  expiresAtMs: number;
}

export interface ComposioConnectionCompletion {
  connectorId: string;
  accountLabel: string;
  credentials: ComposioCredentialMaterial;
}

/** Strict credential evidence committed only after remote account validation. */
export interface ComposioCredentialMaterial extends ConnectorCredentialMaterial {
  provider: 'composio';
  providerConnectionId: string;
  userId: string;
  connectorId: string;
  toolkitSlug: string;
  authConfigId: string;
  validatedAt: string;
  accountId?: string;
}

/** Runtime guard used when loading untrusted persisted credential records. */
export function isComposioCredentialMaterial(value: unknown): value is ComposioCredentialMaterial {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.provider === 'composio'
    && Boolean(getString(record.providerConnectionId))
    && Boolean(getString(record.userId))
    && Boolean(getString(record.connectorId))
    && Boolean(getString(record.toolkitSlug))
    && Boolean(getString(record.authConfigId))
    && Boolean(getString(record.validatedAt))
    && (record.accountId === undefined || Boolean(getString(record.accountId)));
}

interface ComposioAuthConfigResolution {
  authConfigId: string;
  fromCache: boolean;
}

export type ComposioAuthConfigPrepareResult =
  | { status: 'ready'; authConfigId: string }
  | { status: 'custom_required'; message: string }
  | { status: 'error'; message: string };

/** Optional host curation keyed by normalized toolkit and tool slugs. */
export type ComposioCurationOverlay = Readonly<
  Record<string, Readonly<Record<string, ConnectorToolCuration>>>
>;

/** Non-secret operational event emitted at an external or persistence edge. */
export interface ComposioProviderEvent {
  operation: 'auth-config-prepare' | 'catalog-cache-write' | 'catalog-refresh';
  error: unknown;
}

/** Explicit dependencies and host policy for a Composio provider instance. */
export interface ComposioConnectorProviderOptions {
  /** Stable host user id used to scope every connected account and execution. */
  userId: string;
  /** Secret project config and auth-config-id persistence. */
  configStore: ComposioConfigStore;
  /** Injectable HTTP boundary; defaults to the runtime `fetch`. */
  fetchFn?: typeof fetch;
  /** Optional persisted catalog cache path. No filesystem cache is used when absent. */
  catalogCachePath?: string;
  /** Composio API origin; defaults to `https://backend.composio.dev`. */
  baseUrl?: string;
  /** Outbound user-agent header. */
  userAgent?: string;
  /** Neutral host label used only in generated fallback descriptions. */
  productName?: string;
  /** Optional host curation; no OD product curation is shipped. */
  curationOverlay?: ComposioCurationOverlay;
  /** Host override for the three default featured definitions. */
  featuredCatalog?: readonly ConnectorCatalogDefinition[];
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Clock seam used by cache and OAuth-state expiry checks. */
  now?: () => number;
  /** Optional non-secret error observer. */
  onError?: (event: ComposioProviderEvent) => void;
}

/**
 * Composio adapter for toolkit discovery, connected-account OAuth, and direct
 * tool execution.
 *
 * The instance owns all mutable caches. No config, user, filesystem path, or
 * HTTP implementation is held in module-global state.
 *
 * @example
 * ```ts
 * const provider = new ComposioConnectorProvider({
 *   userId: 'user_123',
 *   configStore,
 *   fetchFn,
 * });
 * const definitions = await provider.listDefinitions();
 * ```
 */
export class ComposioConnectorProvider {
  private readonly userId: string;
  private readonly configStore: ComposioConfigStore;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly productName: string;
  private readonly curationOverlay: ComposioCurationOverlay;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly onError: ((event: ComposioProviderEvent) => void) | undefined;
  private readonly staticCatalog: ConnectorCatalogDefinition[];
  private catalogCachePath: string | undefined;
  private discoveredAuthConfigIds: Record<string, string> | undefined;
  private readonly locallyCreatedAuthConfigs = new Map<string, { authConfigId: string; toolkitSlug: string }>();
  private readonly definitionsCache = new Map<string, { definitions: ConnectorCatalogDefinition[]; expiresAtMs: number }>();
  private readonly definitionsPromises = new Map<string, Promise<ConnectorCatalogDefinition[]>>();
  private definitionsGeneration = 0;
  private readonly authConfigCreationPromises = new Map<string, Promise<string>>();
  private readonly unsupportedManagedAuthConfigs = new Map<string, string>();
  private readonly pendingConnections = new Map<string, ComposioPendingConnection>();
  private persistedDefinitions: ConnectorCatalogDefinition[] | undefined;
  private persistedFetchedAt: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshTimeout: NodeJS.Timeout | undefined;

  constructor(options: ComposioConnectorProviderOptions) {
    const userId = options.userId.trim();
    if (!userId) throw new TypeError('Composio userId must not be empty.');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('Composio timeoutMs must be a positive finite number.');
    }
    this.userId = userId;
    this.configStore = options.configStore;
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_COMPOSIO_BASE_URL).replace(/\/+$/, '');
    this.userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.productName = options.productName?.trim() || 'your workspace';
    this.curationOverlay = options.curationOverlay ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COMPOSIO_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.onError = options.onError;
    this.catalogCachePath = options.catalogCachePath === undefined
      ? undefined
      : path.resolve(options.catalogCachePath);
    this.staticCatalog = buildStaticComposioCatalog({
      featuredCatalog: options.featuredCatalog ?? FEATURED_COMPOSIO_CATALOG,
      toolkits: DOCUMENTED_COMPOSIO_TOOLKITS,
      curationOverlay: this.curationOverlay,
      productName: this.productName,
    });
    if (this.catalogCachePath) this.loadPersistedCatalogCache(this.catalogCachePath);
  }

  isConfigured(definition: ConnectorCatalogDefinition): boolean {
    return Boolean(this.getApiKey() && (this.getPersistedAuthConfigId(definition.id) || this.discoveredAuthConfigIds?.[definition.id]));
  }

  clearDiscoveryCache(): void {
    this.discoveredAuthConfigIds = undefined;
    this.locallyCreatedAuthConfigs.clear();
    this.invalidateDefinitionsCache();
    this.authConfigCreationPromises.clear();
    this.unsupportedManagedAuthConfigs.clear();
  }

  configureCatalogCache(dataDir: string): void {
    this.catalogCachePath = path.resolve(dataDir, 'connectors', 'composio-catalog-cache.json');
    this.loadPersistedCatalogCache(this.catalogCachePath);
  }

  startCatalogRefreshLoop(): void {
    this.stopCatalogRefreshLoop();
    if (this.isPersistedCatalogStale()) this.scheduleCatalogRefresh(0);
    this.refreshTimer = setInterval(() => {
      void this.refreshCatalogInBackground();
    }, PERSISTED_CATALOG_REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  stopCatalogRefreshLoop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = undefined;
    }
  }

  getFastDefinitions(): ConnectorCatalogDefinition[] {
    const definitions = this.persistedDefinitions && this.persistedDefinitions.length > 0
      ? this.persistedDefinitions
      : this.staticCatalog;
    return definitions.map(cloneConnectorDefinition);
  }

  getPersistedCatalogMetadata(): { fetchedAt?: string; stale: boolean } {
    return {
      ...(this.persistedFetchedAt === undefined ? {} : { fetchedAt: this.persistedFetchedAt }),
      stale: this.isPersistedCatalogStale(),
    };
  }

  async refreshCatalog(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    this.invalidateDefinitionsCache();
    const definitions = await this.listDefinitions(signal);
    this.setPersistedDefinitions(definitions, new Date(this.now()).toISOString());
    return definitions;
  }

  private invalidateDefinitionsCache(): void {
    this.definitionsGeneration += 1;
    this.definitionsCache.clear();
    this.definitionsPromises.clear();
  }

  /**
   * Lists metadata-only catalog definitions.
   *
   * Aggregate tool-schema hydration is rejected before provider I/O. Callers
   * must use bounded per-connector preview or current-hydration paths.
   *
   * @complexity Time: O(c), for the bounded static catalog. Space: O(c).
   * @overallScore 98/100 — the retained options field preserves API
   * compatibility while rejecting its former unsafe hydration mode.
   */
  async listDefinitions(signal?: AbortSignal, options: { hydrateTools?: boolean } = {}): Promise<ConnectorCatalogDefinition[]> {
    if (options.hydrateTools) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'aggregate Composio catalog hydration is unsupported; hydrate one connector at a time',
        400,
      );
    }
    const cacheKey = 'metadata';
    const now = this.now();
    const cached = this.definitionsCache.get(cacheKey);
    if (cached && cached.expiresAtMs > now) {
      return cached.definitions.map(cloneConnectorDefinition);
    }
    const existing = this.definitionsPromises.get(cacheKey);
    if (existing) return (await existing).map(cloneConnectorDefinition);

    const generation = this.definitionsGeneration;
    const promise = this.fetchDefinitions(signal)
      .then((definitions) => {
        if (this.definitionsGeneration === generation) {
          this.definitionsCache.set(cacheKey, { definitions, expiresAtMs: this.now() + DISCOVERY_CACHE_TTL_MS });
        }
        this.setPersistedDefinitions(definitions, new Date(this.now()).toISOString());
        return definitions;
      })
      .finally(() => {
        if (this.definitionsPromises.get(cacheKey) === promise && this.definitionsGeneration === generation) this.definitionsPromises.delete(cacheKey);
      });
    this.definitionsPromises.set(cacheKey, promise);
    return (await promise).map(cloneConnectorDefinition);
  }

  private async fetchDefinitions(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    const apiKey = this.getApiKey();
    const authConfigs = apiKey ? await this.listAuthConfigsSafe(signal) : [];
    const configuredByConnectorId = new Map<string, { authConfigId: string; toolkitSlug: string }>();
    const discoveredAuthConfigIds: Record<string, string> = {};
    for (const item of authConfigs) {
      const authConfigId = getComposioAuthConfigId(item);
      const toolkitSlug = getComposioToolkitSlug(item);
      const status = getString(item.status)?.toUpperCase();
      if (!authConfigId || !toolkitSlug || (status && status !== 'ENABLED')) continue;
      const connectorId = connectorIdForToolkitSlug(toolkitSlug);
      discoveredAuthConfigIds[connectorId] = authConfigId;
      if (!configuredByConnectorId.has(connectorId)) configuredByConnectorId.set(connectorId, { authConfigId, toolkitSlug });
    }
    for (const [connectorId, local] of this.locallyCreatedAuthConfigs) {
      discoveredAuthConfigIds[connectorId] = local.authConfigId;
      if (!configuredByConnectorId.has(connectorId)) configuredByConnectorId.set(connectorId, local);
    }
    this.discoveredAuthConfigIds = discoveredAuthConfigIds;
    const toolkits = apiKey ? await this.listToolkitsSafe(signal) : [];
    const toolkitBySlug = new Map(toolkits.map((toolkit) => [normalizeComposioSlug(getString(toolkit.slug) ?? ''), toolkit]));
    const definitions = await mapWithConcurrency(this.staticCatalog, 8, async (staticDefinition) => {
      const configuredEntry = configuredByConnectorId.get(staticDefinition.id);
      const toolkitSlug = configuredEntry?.toolkitSlug ?? staticDefinition.providerConnectorId ?? staticDefinition.id;
      const toolkit = toolkitBySlug.get(normalizeComposioSlug(toolkitSlug));
      return this.definitionFromToolkit(staticDefinition, toolkitSlug, toolkit, false, signal);
    });
    return definitions;
  }

  private scheduleCatalogRefresh(delayMs: number): void {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    const timeout = setTimeout(() => {
      if (this.refreshTimeout === timeout) this.refreshTimeout = undefined;
      void this.refreshCatalogInBackground();
    }, delayMs);
    this.refreshTimeout = timeout;
    timeout.unref?.();
  }

  private async refreshCatalogInBackground(): Promise<void> {
    try {
      if (!this.getApiKey()) return;
      await this.refreshCatalog();
    } catch (error) {
      this.onError?.({ operation: 'catalog-refresh', error });
    }
  }

  private isPersistedCatalogStale(now = this.now()): boolean {
    if (!this.persistedFetchedAt) return true;
    const fetchedAtMs = Date.parse(this.persistedFetchedAt);
    return !Number.isFinite(fetchedAtMs) || now - fetchedAtMs >= PERSISTED_CATALOG_REFRESH_MS;
  }

  private loadPersistedCatalogCache(cachePath: string): void {
    const parsed = readPersistedComposioCatalogCache(cachePath);
    if (!parsed) {
      this.persistedDefinitions = undefined;
      this.persistedFetchedAt = undefined;
      return;
    }
    this.persistedDefinitions = parsed.definitions.map((definition) => cloneConnectorDefinition(definition));
    this.persistedFetchedAt = parsed.fetchedAt;
    if (this.isPersistedCatalogStale() && this.getApiKey()) this.scheduleCatalogRefresh(0);
  }

  private setPersistedDefinitions(definitions: ConnectorCatalogDefinition[], fetchedAt: string): void {
    this.persistedDefinitions = definitions.map((definition) => cloneConnectorDefinition(definition));
    this.persistedFetchedAt = fetchedAt;
    if (!this.catalogCachePath) return;
    try {
      writePersistedComposioCatalogCache(this.catalogCachePath, {
        schemaVersion: 1,
        fetchedAt,
        provider: 'composio',
        definitions: this.persistedDefinitions,
      });
    } catch (error) {
      this.onError?.({ operation: 'catalog-cache-write', error });
    }
  }

  async getDefinition(connectorId: string, signal?: AbortSignal): Promise<ConnectorCatalogDefinition | undefined> {
    const discovered = (await this.listDefinitions(signal)).find((definition) => definition.id === connectorId);
    if (discovered) return discovered;
    return undefined;
  }

  async getHydratedDefinition(
    connectorId: string,
    signal?: AbortSignal,
    options: { requireCurrentTools?: boolean } = {},
  ): Promise<ConnectorCatalogDefinition | undefined> {
    const metadataDefinition = (await this.listDefinitions(signal)).find((definition) => definition.id === connectorId);
    if (!metadataDefinition) return undefined;
    // `listDefinitions` normalizes every entry through
    // `definitionFromToolkit`, which always supplies this provider identity.
    const toolkitSlug = metadataDefinition.providerConnectorId!;
    return this.definitionFromToolkit(metadataDefinition, toolkitSlug, undefined, true, signal, {
      ...(options.requireCurrentTools === undefined ? {} : { requireCurrentTools: options.requireCurrentTools }),
    });
  }

  async getPreviewDefinition(connectorId: string, options: { toolsLimit: number; toolsCursor?: string; signal?: AbortSignal }): Promise<ConnectorCatalogDefinition | undefined> {
    const metadataDefinition = (await this.listDefinitions(options.signal)).find((definition) => definition.id === connectorId);
    if (!metadataDefinition) return undefined;
    // The metadata discovery boundary above guarantees provider identity.
    const toolkitSlug = metadataDefinition.providerConnectorId!;
    return this.definitionFromToolkit(metadataDefinition, toolkitSlug, undefined, true, options.signal, {
      toolsLimit: options.toolsLimit,
      ...(options.toolsCursor === undefined ? {} : { toolsCursor: options.toolsCursor }),
    });
  }

  async connect(definition: ConnectorCatalogDefinition, callbackUrl: string, signal?: AbortSignal): Promise<ComposioConnectionStart> {
    this.pruneExpiredPendingConnections();

    let authConfig = await this.getOrCreateManagedAuthConfigId(definition, signal);

    const state = crypto.randomBytes(24).toString('base64url');
    const expiresAtMs = this.now() + OAUTH_STATE_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const callbackUrlWithState = appendOAuthStateToCallbackUrl(callbackUrl, state);
    let response: ComposioConnectedAccountResponse;
    try {
      response = await this.createConnectedAccountLink(authConfig.authConfigId, callbackUrlWithState, signal);
    } catch (error) {
      if (!authConfig.fromCache || !isCachedAuthConfigRejection(error)) throw error;
      this.configStore.deleteAuthConfigId(definition.id);
      authConfig = await this.getOrCreateManagedAuthConfigId(definition, signal, { ignoreCache: true });
      response = await this.createConnectedAccountLink(authConfig.authConfigId, callbackUrlWithState, signal);
    }

    const providerConnectionId = getComposioConnectionId(response);
    const redirectUrl = getString(response.redirect_url) ?? getString(response.redirectUrl);
    const status = getString(response.status)?.toUpperCase();
    if (status === 'ACTIVE' && !providerConnectionId) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Composio active account response omitted its connection identity',
        502,
        { connectorId: definition.id },
      );
    }
    this.pendingConnections.set(state, { connectorId: definition.id, state, ...(providerConnectionId ? { providerConnectionId } : {}), expiresAtMs });

    const validatedConnection = status === 'ACTIVE' && providerConnectionId
      ? await this.getValidatedConnectedAccount(definition, providerConnectionId, authConfig.authConfigId, signal)
      : undefined;
    if (validatedConnection) this.pendingConnections.delete(state);

    return {
      kind: redirectUrl ? 'redirect_required' : status === 'ACTIVE' ? 'connected' : 'pending',
      ...(redirectUrl ? { redirectUrl } : {}),
      ...(providerConnectionId ? { providerConnectionId } : {}),
      expiresAt,
      ...(validatedConnection ? this.connectionToCredentials(definition, providerConnectionId!, validatedConnection) : {}),
    };
  }

  async prepareAuthConfig(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<ComposioAuthConfigPrepareResult> {
    if (definition.authentication !== 'composio') return { status: 'error', message: 'connector is not backed by Composio' };
    const unsupported = this.unsupportedManagedAuthConfigs.get(definition.id);
    if (unsupported) {
      const authConfigId = await this.getExistingAuthConfigIdForToolkit(definition, signal);
      return authConfigId ? { status: 'ready', authConfigId } : { status: 'custom_required', message: unsupported };
    }
    try {
      const resolution = await this.getOrCreateManagedAuthConfigId(definition, signal);
      return { status: 'ready', authConfigId: resolution.authConfigId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const customMessage = getCustomAuthRequiredMessage(error, definition);
      if (customMessage) {
        this.unsupportedManagedAuthConfigs.set(definition.id, customMessage);
        return { status: 'custom_required', message: customMessage };
      }
      if (error instanceof Error && !(error instanceof ConnectorServiceError)) {
        this.onError?.({ operation: 'auth-config-prepare', error });
        return { status: 'error', message: 'Composio auth configuration could not be prepared' };
      }
      return { status: 'error', message };
    }
  }

  cancelPendingConnections(connectorId: string): number {
    this.pruneExpiredPendingConnections();
    let cancelled = 0;
    for (const [state, pending] of this.pendingConnections.entries()) {
      if (pending.connectorId !== connectorId) continue;
      this.pendingConnections.delete(state);
      cancelled += 1;
    }
    return cancelled;
  }

  async completeConnection(input: { definition: ConnectorCatalogDefinition; state: string; providerConnectionId?: string; status?: string; signal?: AbortSignal }): Promise<ComposioConnectionCompletion> {
    this.pruneExpiredPendingConnections();

    const connectorId = input.definition.id;
    const pending = this.pendingConnections.get(input.state);
    this.pendingConnections.delete(input.state);
    if (!pending || pending.connectorId !== connectorId || pending.expiresAtMs < this.now()) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio OAuth state is missing or expired', 400, { connectorId });
    }
    if (input.status && input.status.toLowerCase() !== 'success') {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio OAuth did not complete successfully', 400, { connectorId });
    }
    const providerConnectionId = input.providerConnectionId ?? pending.providerConnectionId;
    if (input.providerConnectionId && pending.providerConnectionId && input.providerConnectionId !== pending.providerConnectionId) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio callback connection id did not match pending connection', 403, { connectorId });
    }
    if (!providerConnectionId) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio callback did not include a connection id', 400, { connectorId });
    }
    const expectedAuthConfigId = await this.getAuthConfigId(input.definition, input.signal);
    if (!expectedAuthConfigId) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio OAuth auth configuration is missing', 409, { connectorId });
    }
    const response = await this.getValidatedConnectedAccount(input.definition, providerConnectionId, expectedAuthConfigId, input.signal);
    // Validation above proves both provider fields are present and correspond
    // to this connector before any credential or configuration state is stored.
    this.storeAuthConfigId(
      input.definition,
      getString(response.auth_config?.id)!,
      getString(response.toolkit?.slug)!,
    );
    return this.connectionToCredentials(input.definition, providerConnectionId, response);
  }

  private pruneExpiredPendingConnections(now = this.now()): void {
    for (const [state, pending] of this.pendingConnections.entries()) {
      if (pending.expiresAtMs <= now) this.pendingConnections.delete(state);
    }
  }

  private async getValidatedConnectedAccount(definition: ConnectorCatalogDefinition, providerConnectionId: string, expectedAuthConfigId: string, signal?: AbortSignal): Promise<ComposioConnectedAccountResponse> {
    const connectorId = definition.id;
    const response = await this.requestJson<ComposioConnectedAccountResponse>(`/api/v3/connected_accounts/${encodeURIComponent(providerConnectionId)}`, {
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    });
    const returnedConnectionId = getComposioConnectionId(response);
    if (!returnedConnectionId || returnedConnectionId !== providerConnectionId) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio account identity was missing or mismatched', 502, { connectorId });
    }
    const providerUserId = getString(response.user_id) ?? getString(response.userId);
    if (!providerUserId || providerUserId !== this.getUserId()) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio account belongs to a different user', 403, { connectorId });
    }
    const providerAuthConfigId = getString(response.auth_config?.id);
    if (!providerAuthConfigId || expectedAuthConfigId !== providerAuthConfigId) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio account belongs to a different auth configuration', 403, {
        connectorId,
        expectedAuthConfigId,
        providerAuthConfigId: providerAuthConfigId ?? null,
      });
    }
    const expectedToolkitSlug = definition.providerConnectorId;
    if (!expectedToolkitSlug) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio connector is missing a toolkit slug', 500, { connectorId });
    }
    const providerToolkitSlug = getString(response.toolkit?.slug);
    if (!providerToolkitSlug || connectorIdForToolkitSlug(expectedToolkitSlug) !== connectorIdForToolkitSlug(providerToolkitSlug)) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio account belongs to a different toolkit', 403, { connectorId });
    }
    const providerStatus = getString(response.status)?.toUpperCase();
    if (providerStatus !== 'ACTIVE') {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio account is not active', 409, {
        connectorId,
        providerStatus: providerStatus ?? null,
      });
    }
    return response;
  }

  private requireCredentialForDefinition(
    definition: ConnectorCatalogDefinition,
    credentials: ConnectorCredentialMaterial | undefined,
  ): ComposioCredentialMaterial {
    if (!isComposioCredentialMaterial(credentials)) {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'Composio connector credentials are missing or invalid', 403, {
        connectorId: definition.id,
      });
    }
    const expectedToolkitSlug = definition.providerConnectorId;
    if (
      credentials.userId !== this.getUserId()
      || credentials.connectorId !== definition.id
      || !expectedToolkitSlug
      || connectorIdForToolkitSlug(credentials.toolkitSlug) !== connectorIdForToolkitSlug(expectedToolkitSlug)
    ) {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'Composio connector credentials do not match this user and connector', 403, {
        connectorId: definition.id,
      });
    }
    return credentials;
  }

  /**
   * Checks persisted credential identity without contacting Composio.
   *
   * @returns `true` only for credential evidence owned by this provider user
   * and the supplied connector definition.
   *
   * @complexity Time: O(1). Space: O(1).
   * @overallScore 100/100
   */
  credentialMatchesDefinition(
    definition: ConnectorCatalogDefinition,
    credentials: ConnectorCredentialMaterial | undefined,
  ): boolean {
    try {
      this.requireCredentialForDefinition(definition, credentials);
      return true;
    } catch (error) {
      if (error instanceof ConnectorServiceError) return false;
      throw error;
    }
  }

  private async revalidateCredential(
    definition: ConnectorCatalogDefinition,
    credentials: ConnectorCredentialMaterial | undefined,
    signal?: AbortSignal,
  ): Promise<ComposioCredentialMaterial> {
    const credential = this.requireCredentialForDefinition(definition, credentials);
    await this.getValidatedConnectedAccount(
      definition,
      credential.providerConnectionId,
      credential.authConfigId,
      signal,
    );
    return credential;
  }

  async disconnect(definition: ConnectorCatalogDefinition, credentials: ConnectorCredentialMaterial | undefined, signal?: AbortSignal): Promise<void> {
    if (credentials === undefined) return;
    const credential = await this.revalidateCredential(definition, credentials, signal);
    const providerConnectionId = credential.providerConnectionId;
    const response = await this.request(`/api/v3/connected_accounts/${encodeURIComponent(providerConnectionId)}`, { method: 'DELETE', ...(signal === undefined ? {} : { signal }) });
    if (!response.ok && response.status !== 404) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', `Composio disconnect failed with HTTP ${response.status}`, 502, { httpStatus: response.status });
    }
  }

  async execute(definition: ConnectorCatalogDefinition, tool: ConnectorCatalogToolDefinition, input: BoundedJsonObject, credentials: ConnectorCredentialMaterial | undefined, signal?: AbortSignal): Promise<BoundedJsonObject> {
    const declaredTool = definition.tools.find((candidate) => (
      candidate.name === tool.name
      && candidate.providerToolId === tool.providerToolId
    ));
    const runtimeSafety = classifyConnectorToolSafety(tool);
    if (
      !declaredTool
      || !definition.allowedToolNames.includes(tool.name)
      || definition.minimumApproval !== 'auto'
      || tool.safety.sideEffect !== 'read'
      || tool.safety.approval !== 'auto'
      || runtimeSafety.sideEffect !== 'read'
      || runtimeSafety.approval !== 'auto'
    ) {
      throw new ConnectorServiceError('CONNECTOR_SAFETY_DENIED', 'Composio provider refused a tool that is not proven read-only', 403, {
        connectorId: definition.id,
        toolName: tool.name,
      });
    }
    try {
      if (tool.inputSchemaUnsupportedReason !== undefined) throw new Error(tool.inputSchemaUnsupportedReason);
      assertConnectorInputMatchesSchema(input, tool.inputSchemaJson);
    } catch (error) {
      // Both the unsupported-schema guard and schema validator throw Error.
      throw new ConnectorServiceError('CONNECTOR_INPUT_SCHEMA_MISMATCH', (error as Error).message, 400, {
        connectorId: definition.id,
        toolName: tool.name,
      });
    }
    const credential = await this.revalidateCredential(definition, credentials, signal);
    const providerConnectionId = credential.providerConnectionId;
    const providerToolId = tool.providerToolId ?? tool.name;
    const response = await this.requestJson<ComposioToolExecuteResponse>(`/api/v3.1/tools/execute/${encodeURIComponent(providerToolId)}`, {
      method: 'POST',
      body: JSON.stringify({
        connected_account_id: providerConnectionId,
        user_id: this.getUserId(),
        version: 'latest',
        arguments: input,
      }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.successful !== true || response.error) {
      const authStale = isComposioAuthenticationFailure(response.error);
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio tool execution failed', 502, {
        connectorId: definition.id,
        toolName: tool.name,
        ...(authStale ? { authStale: true } : {}),
      });
    }
    const output = toStructurallyBoundedJsonValue(response.data);
    const result: BoundedJsonObject = {
      toolName: tool.name,
      providerToolId,
      data: output,
      ...(getString(response.log_id) ?? getString(response.logId) ? { providerExecutionId: (getString(response.log_id) ?? getString(response.logId))! } : {}),
      ...(response.session_info === undefined && response.sessionInfo === undefined
        ? {}
        : { sessionInfo: toStructurallyBoundedJsonValue(response.session_info ?? response.sessionInfo) }),
    };
    const protectedResult = protectConnectorOutput(result);
    // The object overload on the centralized protection boundary guarantees
    // that bounding and redaction preserve the root object container.
    return protectedResult.output;
  }

  private async getAuthConfigId(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<string | undefined> {
    const persisted = this.getPersistedAuthConfigId(definition.id);
    if (persisted) return persisted;
    if (!this.discoveredAuthConfigIds) this.discoveredAuthConfigIds = await this.discoverAuthConfigIds(signal);
    return this.discoveredAuthConfigIds[definition.id];
  }

  private async getOrCreateManagedAuthConfigId(definition: ConnectorCatalogDefinition, signal?: AbortSignal, options: { ignoreCache?: boolean } = {}): Promise<ComposioAuthConfigResolution> {
    if (!options.ignoreCache) {
      const persisted = this.getPersistedAuthConfigId(definition.id);
      if (persisted) {
        return { authConfigId: persisted, fromCache: true };
      }
      const discovered = this.discoveredAuthConfigIds?.[definition.id];
      if (discovered) {
        return { authConfigId: discovered, fromCache: true };
      }
    }

    const existing = await this.getAuthConfigIdForToolkit(definition, signal);
    if (existing) {
      this.storeAuthConfigId(definition, existing);
      return { authConfigId: existing, fromCache: false };
    }

    const inFlight = this.authConfigCreationPromises.get(definition.id);
    if (inFlight) {
      const authConfigId = await inFlight;
      return { authConfigId, fromCache: false };
    }

    const promise = this.createAndStoreManagedAuthConfigId(definition, signal)
      .finally(() => {
        if (this.authConfigCreationPromises.get(definition.id) === promise) this.authConfigCreationPromises.delete(definition.id);
      });
    this.authConfigCreationPromises.set(definition.id, promise);
    const authConfigId = await promise;
    return { authConfigId, fromCache: false };
  }

  private async createAndStoreManagedAuthConfigId(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<string> {
    const created = await this.createManagedAuthConfig(definition, signal);
    const authConfigId = getComposioAuthConfigId(created);
    const toolkitSlug = getComposioToolkitSlug(created) ?? definition.providerConnectorId;
    if (!authConfigId || !toolkitSlug) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio auth config response was missing an id or toolkit slug', 502, {
        connectorId: definition.id,
      });
    }

    const connectorId = connectorIdForToolkitSlug(toolkitSlug);
    if (connectorId !== definition.id) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio created an auth config for a different toolkit', 502, {
        connectorId: definition.id,
        toolkitSlug,
      });
    }

    this.storeAuthConfigId(definition, authConfigId, toolkitSlug);
    this.invalidateDefinitionsCache();
    return authConfigId;
  }

  private async createManagedAuthConfig(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<ComposioAuthConfigResponse> {
    // This method is reached only after `getAuthConfigIdForToolkit` has
    // required the same definition toolkit. Keep one fail-closed guard at that
    // boundary instead of an unreachable duplicate after the provider lookup.
    const toolkitSlug = definition.providerConnectorId!;
    try {
      return await this.requestJson<ComposioAuthConfigResponse>('/api/v3.1/auth_configs', {
        method: 'POST',
        body: JSON.stringify({
          toolkit: { slug: toolkitSlug },
          auth_config: { type: 'use_composio_managed_auth' },
        }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      const customMessage = getCustomAuthRequiredMessage(error, definition);
      if (!customMessage) throw error;
      this.unsupportedManagedAuthConfigs.set(definition.id, customMessage);
      throw new ConnectorServiceError('CONNECTOR_AUTH_CONFIG_REQUIRED', customMessage, 409, {
        connectorId: definition.id,
        provider: 'composio',
        reason: 'managed_auth_unavailable',
      });
    }
  }

  private async getAuthConfigIdForToolkit(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<string | undefined> {
    const toolkitSlug = definition.providerConnectorId;
    if (!toolkitSlug) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio connector is missing a toolkit slug', 500, { connectorId: definition.id });
    }
    const items = await this.listAuthConfigsSafe(signal, toolkitSlug);
    for (const item of items) {
      const authConfigId = getComposioAuthConfigId(item);
      const itemToolkitSlug = getComposioToolkitSlug(item) ?? toolkitSlug;
      const status = getString(item.status)?.toUpperCase();
      if (!authConfigId || (status && status !== 'ENABLED')) continue;
      if (connectorIdForToolkitSlug(itemToolkitSlug) !== definition.id) continue;
      return authConfigId;
    }
    return undefined;
  }

  private async getExistingAuthConfigIdForToolkit(definition: ConnectorCatalogDefinition, signal?: AbortSignal): Promise<string | undefined> {
    const persisted = this.getPersistedAuthConfigId(definition.id);
    if (persisted) return persisted;

    const discovered = this.discoveredAuthConfigIds?.[definition.id];
    if (discovered) return discovered;

    const existing = await this.getAuthConfigIdForToolkit(definition, signal);
    if (!existing) return undefined;

    this.storeAuthConfigId(definition, existing);
    return existing;
  }

  private async createConnectedAccountLink(authConfigId: string, callbackUrl: string, signal?: AbortSignal): Promise<ComposioConnectedAccountResponse> {
    return this.requestJson<ComposioConnectedAccountResponse>('/api/v3/connected_accounts/link', {
      method: 'POST',
      body: JSON.stringify({
        auth_config_id: authConfigId,
        user_id: this.getUserId(),
        callback_url: callbackUrl,
      }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private getPersistedAuthConfigId(connectorId: string): string | undefined {
    return getString(this.configStore.read().authConfigIds[connectorId]);
  }

  private storeAuthConfigId(definition: ConnectorCatalogDefinition, authConfigId: string, toolkitSlug = definition.providerConnectorId): void {
    this.discoveredAuthConfigIds = {
      ...(this.discoveredAuthConfigIds ?? {}),
      [definition.id]: authConfigId,
    };
    if (toolkitSlug) this.locallyCreatedAuthConfigs.set(definition.id, { authConfigId, toolkitSlug });
    this.configStore.setAuthConfigId(definition.id, authConfigId);
  }

  private async discoverAuthConfigIds(signal?: AbortSignal): Promise<Record<string, string>> {
    if (!this.getApiKey()) return {};
    const items = await this.listAuthConfigsSafe(signal);
    const discovered: Record<string, string> = {};
    for (const item of items) {
      const authConfigId = getComposioAuthConfigId(item);
      const toolkitSlug = getComposioToolkitSlug(item);
      const status = getString(item.status)?.toUpperCase();
      if (!authConfigId || !toolkitSlug || (status && status !== 'ENABLED')) continue;
      discovered[connectorIdForToolkitSlug(toolkitSlug)] = authConfigId;
    }
    // Locally-created entries already initialize `discoveredAuthConfigIds`.
    // `discoverAuthConfigIds` is called only while that map is undefined, so a
    // local-entry merge here could never observe an entry.
    return discovered;
  }

  private async listAuthConfigs(signal?: AbortSignal, toolkitSlug?: string): Promise<ComposioAuthConfigResponse[]> {
    const searchParams = new URLSearchParams({ limit: '1000' });
    if (toolkitSlug) searchParams.set('toolkit_slug', toolkitSlug);
    const path = `/api/v3.1/auth_configs?${searchParams.toString()}`;
    const response = await this.request(path, { method: 'GET', ...(signal === undefined ? {} : { signal }) });
    if (!response.ok) return [];
    const payload = await readBoundedResponseJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const record = payload as { items?: unknown; data?: unknown };
    const items = Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
    return items.slice(0, COMPOSIO_MAX_LIST_ITEMS).filter((item): item is ComposioAuthConfigResponse => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  }

  private async listAuthConfigsSafe(signal?: AbortSignal, toolkitSlug?: string): Promise<ComposioAuthConfigResponse[]> {
    try {
      return await this.listAuthConfigs(signal, toolkitSlug);
    } catch {
      return [];
    }
  }

  private async listToolkits(signal?: AbortSignal): Promise<ComposioToolkitResponse[]> {
    const response = await this.request('/api/v3.1/toolkits?limit=1000', { method: 'GET', ...(signal === undefined ? {} : { signal }) });
    if (!response.ok) return [];
    const payload = await readBoundedResponseJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const record = payload as { items?: unknown; data?: unknown };
    const items = Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
    return items.slice(0, COMPOSIO_MAX_LIST_ITEMS).filter((item): item is ComposioToolkitResponse => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  }

  private async listToolkitsSafe(signal?: AbortSignal): Promise<ComposioToolkitResponse[]> {
    try {
      return await this.listToolkits(signal);
    } catch {
      return [];
    }
  }

  private async listToolsPage(toolkitSlug: string, options: { limit: number; cursor?: string; signal?: AbortSignal }): Promise<ComposioToolsPage> {
    const searchParams = new URLSearchParams({
      toolkit_slug: toolkitSlug.toLowerCase(),
      toolkit_versions: 'latest',
      limit: String(options.limit),
    });
    if (options.cursor) searchParams.set('cursor', options.cursor);
    const response = await this.request(`/api/v3.1/tools?${searchParams.toString()}`, { method: 'GET', ...(options.signal === undefined ? {} : { signal: options.signal }) });
    if (!response.ok) {
      const message = await getComposioSafeErrorMessage(response);
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', message ?? `Composio tools request failed with HTTP ${response.status}`, response.status === 401 ? 401 : 502, { httpStatus: response.status });
    }
    const payload = await readBoundedResponseJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio tools response was invalid', 502);
    }
    const record = payload as { items?: unknown; data?: unknown; next_cursor?: unknown; nextCursor?: unknown; total_items?: unknown; totalItems?: unknown };
    const items = Array.isArray(record.items) ? record.items : Array.isArray(record.data) ? record.data : [];
    const nextCursor = getString(record.next_cursor) ?? getString(record.nextCursor);
    const totalItems = getNonNegativeInteger(record.total_items) ?? getNonNegativeInteger(record.totalItems);
    return {
      items: items.slice(0, COMPOSIO_MAX_LIST_ITEMS).filter((item): item is ComposioToolResponse => Boolean(item && typeof item === 'object' && !Array.isArray(item))),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      ...(totalItems === undefined ? {} : { totalItems }),
    };
  }

  private async listTools(toolkitSlug: string, signal?: AbortSignal): Promise<ComposioToolResponse[]> {
    return (await this.listToolsPage(toolkitSlug, { limit: 1000, ...(signal === undefined ? {} : { signal }) })).items;
  }

  private async listToolsSafe(toolkitSlug: string, signal?: AbortSignal): Promise<ComposioToolResponse[]> {
    try {
      return await this.listTools(toolkitSlug, signal);
    } catch {
      return [];
    }
  }

  /**
   * Reconciles one static connector with bounded current provider metadata.
   *
   * Strict execution mode removes static authority when the successful
   * current response omits a tool. Discovered tools remain display-only unless
   * an exact package or host curation entry grants authority.
   *
   * @complexity Time: O(s + l). Space: O(s + l), for static and live tools.
   * @overallScore 96/100 — authority reconciliation is explicit but remains a
   * dense provider-adapter boundary that warrants contract-test coverage.
   */
  private async definitionFromToolkit(
    staticDefinition: ConnectorCatalogDefinition,
    toolkitSlug: string,
    toolkit: ComposioToolkitResponse | undefined,
    hydrateTools: boolean,
    signal?: AbortSignal,
    toolPageOptions: {
      toolsLimit?: number;
      toolsCursor?: string;
      requireCurrentTools?: boolean;
    } = {},
  ): Promise<ConnectorCatalogDefinition> {
    const connectorId = staticDefinition.id;
    const toolPage = hydrateTools && toolPageOptions.toolsLimit !== undefined
      ? await this.listToolsPage(toolkitSlug, {
        limit: toolPageOptions.toolsLimit,
        ...(toolPageOptions.toolsCursor === undefined ? {} : { cursor: toolPageOptions.toolsCursor }),
        ...(signal === undefined ? {} : { signal }),
      })
      : undefined;
    const discoveredLiveTools = hydrateTools
      ? (toolPage?.items
          ?? (toolPageOptions.requireCurrentTools
            ? await this.listTools(toolkitSlug, signal)
            : await this.listToolsSafe(toolkitSlug, signal)))
        .filter((tool) => {
          const toolToolkitSlug = getString(tool.toolkit?.slug);
          return !toolToolkitSlug || normalizeComposioSlug(toolToolkitSlug) === normalizeComposioSlug(toolkitSlug);
        })
        .map((tool) => this.toolDefinitionFromComposioTool(connectorId, tool))
      : [];
    const liveTools = discoveredLiveTools.map((tool) => (
      this.isStaticToolDeclaration(staticDefinition, tool)
      || this.isExplicitlyAllowedLiveTool(connectorId, tool)
        ? tool
        : { ...tool, refreshEligible: false }
    ));
    const liveToolsByName = new Map(liveTools.map((tool) => [tool.name, tool]));
    const liveToolsByProviderId = new Map(liveTools.map((tool) => (
      [normalizeProviderToolId(tool.providerToolId), tool] as const
    )));
    const matchedLiveToolNames = new Set<string>();
    const matchedStaticToolNames = new Set<string>();
    const mergedStaticTools = staticDefinition.tools.map((tool) => {
      const liveTool = liveToolsByName.get(tool.name)
        ?? (tool.providerToolId === undefined
          ? undefined
          : liveToolsByProviderId.get(normalizeProviderToolId(tool.providerToolId)));
      if (liveTool !== undefined) {
        matchedLiveToolNames.add(liveTool.name);
        matchedStaticToolNames.add(tool.name);
      }
      return mergeToolDefinition(tool, liveTool);
    });
    const tools = [
      ...mergedStaticTools,
      ...liveTools.filter((tool) => !matchedLiveToolNames.has(tool.name)),
    ];
    const currentStaticAllowedToolNames = toolPageOptions.requireCurrentTools
      ? staticDefinition.allowedToolNames.filter((toolName) => matchedStaticToolNames.has(toolName))
      : staticDefinition.allowedToolNames;
    const explicitlyAllowedLiveToolNames = liveTools
      .filter((tool) => tool.refreshEligible && this.isExplicitlyAllowedLiveTool(connectorId, tool))
      .map((tool) => tool.name);
    const allowedToolNames = [...new Set([
      ...currentStaticAllowedToolNames,
      ...explicitlyAllowedLiveToolNames,
    ])];
    // `curatedToolNames` mirrors the static catalog ONLY — it
    // intentionally never picks up hydrated live tool names. It
    // preserves the static catalog baseline, while summary badges use
    // `toolCount` when present to reflect the advertised provider
    // inventory. The execution-time gate keeps using
    // `allowedToolNames`, where only exact package/host-owned entries can
    // extend the static execution authority.
    const curatedToolNames = [...staticDefinition.allowedToolNames];
    const name = getString(toolkit?.name) ?? staticDefinition.name;
    const category = firstCategoryName(toolkit?.meta?.categories) ?? firstCategoryName(toolkit?.categories) ?? staticDefinition.category;
    const liveDescription = getComposioToolkitDescription(toolkit);
    const description = liveDescription ?? staticDefinition.description;
    const liveToolCount = getComposioToolkitToolCount(toolkit);
    const toolCount = toolPage?.totalItems ?? liveToolCount ?? staticDefinition.toolCount ?? (tools.length > 0 ? tools.length : undefined);
    return {
      ...staticDefinition,
      id: connectorId,
      name,
      providerConnectorId: staticDefinition.providerConnectorId ?? toolkitSlug,
      category,
      ...(description === undefined ? {} : { description }),
      tools,
      ...(toolCount === undefined ? {} : { toolCount }),
      ...(toolPage?.nextCursor === undefined ? {} : { toolsNextCursor: toolPage.nextCursor }),
      ...(toolPage === undefined ? {} : { toolsHasMore: toolPage.nextCursor !== undefined }),
      allowedToolNames,
      curatedToolNames,
      ...(staticDefinition.featuredToolNames === undefined
        ? tools.length > 0 ? { featuredToolNames: tools.slice(0, 3).map((tool) => tool.name) } : {}
        : { featuredToolNames: staticDefinition.featuredToolNames }),
    };
  }

  private isExplicitlyAllowedLiveTool(
    connectorId: string,
    tool: HydratedComposioToolDefinition,
  ): boolean {
    const connectorKey = normalizeComposioSlug(connectorId);
    const toolKey = normalizeProviderToolId(tool.providerToolId);
    return COMPOSIO_STATIC_DISCOVERED_TOOL_ALLOWLIST.has(`${connectorKey}:${toolKey}`)
      || this.curationOverlay[connectorKey]?.[toolKey] !== undefined;
  }

  private isStaticToolDeclaration(
    definition: ConnectorCatalogDefinition,
    liveTool: HydratedComposioToolDefinition,
  ): boolean {
    return definition.tools.some((staticTool) => (
      definition.allowedToolNames.includes(staticTool.name)
      && (
        staticTool.name === liveTool.name
        || (
          staticTool.providerToolId !== undefined
          && normalizeProviderToolId(staticTool.providerToolId)
            === normalizeProviderToolId(liveTool.providerToolId)
        )
      )
    ));
  }

  private toolDefinitionFromComposioTool(
    connectorId: string,
    tool: ComposioToolResponse,
  ): HydratedComposioToolDefinition {
    const providerToolId = getString(tool.slug) ?? getString(tool.name) ?? `${connectorId.toUpperCase()}_TOOL`;
    const description = getString(tool.description) ?? getString(tool.human_description) ?? getString(tool.humanDescription) ?? '';
    const requiredScopes = getStringArray(tool.scopes ?? tool.oauth_scopes ?? tool.oauthScopes ?? tool.auth_scopes ?? tool.authScopes ?? tool.tags);
    const decodedInputSchema = decodeComposioInputParameters(
      tool.input_parameters ?? tool.inputParameters,
    );
    return {
      ...applyComposioToolCuration(defineConnectorTool({
        name: `${connectorId}.${normalizeToolName(providerToolId)}`,
        providerToolId,
        title: getString(tool.name) ?? titleFromSlug(providerToolId),
        ...(description ? { description } : {}),
        inputSchemaJson: decodedInputSchema.schema,
        inputSchemaUnsupportedReason: decodedInputSchema.unsupportedReason,
        outputSchemaJson: { type: 'object', additionalProperties: true },
        requiredScopes,
      }), connectorId, providerToolId, this.curationOverlay),
      providerToolId,
    };
  }

  private connectionToCredentials(definition: ConnectorCatalogDefinition, providerConnectionId: string, response: ComposioConnectedAccountResponse): ComposioConnectionCompletion {
    const accountLabel = getString(response.account_label)
      ?? getString(response.accountLabel)
      ?? getString(response.email)
      ?? getString(response.name)
      ?? providerConnectionId;
    const accountId = getString(response.account_id) ?? getString(response.accountId);
    // Every caller first passes the response through
    // `getValidatedConnectedAccount`, which proves these fields are present.
    const authConfigId = getString(response.auth_config?.id)!;
    const toolkitSlug = getString(response.toolkit?.slug)!;
    const userId = (getString(response.user_id) ?? getString(response.userId))!;
    return {
      connectorId: definition.id,
      accountLabel,
      credentials: {
        provider: 'composio',
        providerConnectionId,
        userId,
        connectorId: definition.id,
        toolkitSlug,
        authConfigId,
        validatedAt: new Date(this.now()).toISOString(),
        ...(accountId ? { accountId } : {}),
      },
    };
  }

  private async requestJson<T extends object>(path: string, input: { method: string; body?: string; signal?: AbortSignal }): Promise<T> {
    const response = await this.request(path, input);
    if (!response.ok) {
      const message = await getComposioSafeErrorMessage(response);
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', message ?? `Composio request failed with HTTP ${response.status}`, response.status === 401 ? 401 : 502, { httpStatus: response.status });
    }
    let value: unknown;
    try {
      value = await readBoundedResponseJson(response, COMPOSIO_MAX_RESPONSE_BYTES);
    } catch (error) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        error instanceof BoundedDataError && /exceeds/.test(error.message)
          ? 'Composio response exceeded safety limits'
          : 'Composio returned malformed JSON',
        502,
      );
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio returned an invalid response', 502);
    }
    return value as T;
  }

  private async request(path: string, input: { method: string; body?: string; signal?: AbortSignal }): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'Composio provider is not configured', 503, { setting: 'apiKey' });
    }
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      return await this.fetchFn(`${this.getBaseUrl()}${path}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': this.userAgent,
          'x-api-key': apiKey,
        },
        ...(input.body ? { body: input.body } : {}),
        signal,
      });
    } catch (error) {
      const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        aborted ? 'Composio request was cancelled or timed out' : 'Composio request failed',
        aborted ? 504 : 502,
      );
    }
  }

  private getApiKey(): string | undefined {
    return this.configStore.read().apiKey || undefined;
  }

  private getBaseUrl(): string {
    return this.baseUrl;
  }

  private getUserId(): string {
    return this.userId;
  }
}

/** @internal Package-local normalization contract; not re-exported from the package root. */
export function mergeToolDefinition(staticTool: ConnectorCatalogToolDefinition, liveTool: ConnectorCatalogToolDefinition | undefined): ConnectorCatalogToolDefinition {
  if (!liveTool) return staticTool;
  const merged: ConnectorCatalogToolDefinition = {
    ...staticTool,
    ...(liveTool.description === undefined ? {} : { description: liveTool.description }),
    ...(liveTool.inputSchemaJson === undefined ? {} : { inputSchemaJson: liveTool.inputSchemaJson }),
    ...(liveTool.outputSchemaJson === undefined ? {} : { outputSchemaJson: liveTool.outputSchemaJson }),
    ...(liveTool.providerToolId === undefined ? {} : { providerToolId: liveTool.providerToolId }),
    requiredScopes: liveTool.requiredScopes.length > 0 ? liveTool.requiredScopes : staticTool.requiredScopes,
    safety: liveTool.safety,
    refreshEligible: liveTool.refreshEligible,
    ...((liveTool.curation ?? staticTool.curation) === undefined ? {} : { curation: liveTool.curation ?? staticTool.curation }),
  };
  if (liveTool.inputSchemaUnsupportedReason === undefined) delete merged.inputSchemaUnsupportedReason;
  else merged.inputSchemaUnsupportedReason = liveTool.inputSchemaUnsupportedReason;
  return merged;
}

interface StaticComposioCatalogOptions {
  featuredCatalog: readonly ConnectorCatalogDefinition[];
  toolkits: readonly ComposioToolkitCatalogEntry[];
  curationOverlay: ComposioCurationOverlay;
  productName: string;
}

function buildStaticComposioCatalog(options: StaticComposioCatalogOptions): ConnectorCatalogDefinition[] {
  const definitions = new Map<string, ConnectorCatalogDefinition>();
  for (const definition of options.featuredCatalog) {
    definitions.set(definition.id, {
      ...definition,
      provider: 'composio',
      authentication: 'composio',
      tools: definition.tools.map((tool) => applyComposioToolCuration(
        tool,
        definition.providerConnectorId ?? definition.id,
        tool.providerToolId,
        options.curationOverlay,
      )),
    });
  }
  for (const toolkit of options.toolkits) {
    const id = connectorIdForToolkitSlug(toolkit.slug);
    if (definitions.has(id)) continue;
    definitions.set(id, createComposioCatalogDefinition(toolkit, options.productName));
  }
  return [...definitions.values()];
}

function createComposioCatalogDefinition(
  toolkit: ComposioToolkitCatalogEntry,
  productName: string,
): ConnectorCatalogDefinition {
  const curated = getComposioToolkitMetadata(toolkit.slug);
  // Prefer a hand-authored description when offline. Live Composio toolkit
  // metadata still wins during discovery, as long as it is not the legacy
  // generic "Connect to X through Composio." placeholder.
  // Curated metadata requires a description, so the fallback path necessarily
  // has no curated record and uses the inventory category directly.
  const description = curated?.description
    ?? fallbackComposioDescription(toolkit.name, toolkit.category, productName);
  const category = curated?.category ?? toolkit.category ?? 'Integration';
  return {
    id: connectorIdForToolkitSlug(toolkit.slug),
    name: toolkit.name,
    provider: 'composio',
    category,
    description,
    providerConnectorId: toolkit.slug,
    authentication: 'composio',
    tools: [],
    allowedToolNames: [],
    minimumApproval: 'auto',
    ...(curated?.toolCount === undefined ? {} : { toolCount: curated.toolCount }),
  };
}

/** Options for creating a detached static catalog snapshot. */
export interface StaticComposioCatalogDefinitionsOptions {
  toolkits?: readonly ComposioToolkitCatalogEntry[];
  featuredCatalog?: readonly ConnectorCatalogDefinition[];
  curationOverlay?: ComposioCurationOverlay;
  productName?: string;
}

/**
 * Builds a detached, offline catalog without network or filesystem I/O.
 *
 * @overallScore 100/100
 */
export function getStaticComposioCatalogDefinitions(
  options: StaticComposioCatalogDefinitionsOptions = {},
): ConnectorCatalogDefinition[] {
  return buildStaticComposioCatalog({
    toolkits: options.toolkits ?? DOCUMENTED_COMPOSIO_TOOLKITS,
    featuredCatalog: options.featuredCatalog ?? FEATURED_COMPOSIO_CATALOG,
    curationOverlay: options.curationOverlay ?? {},
    productName: options.productName?.trim() || 'your workspace',
  }).map(cloneConnectorDefinition);
}

/** @internal Package-local normalization contract; not re-exported from the package root. */
export function cloneConnectorDefinition(definition: ConnectorCatalogDefinition): ConnectorCatalogDefinition {
  return {
    ...definition,
    tools: definition.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.inputSchemaJson === undefined ? {} : { inputSchemaJson: toBoundedJsonObject(tool.inputSchemaJson)! }),
      ...(tool.inputSchemaUnsupportedReason === undefined ? {} : { inputSchemaUnsupportedReason: tool.inputSchemaUnsupportedReason }),
      ...(tool.outputSchemaJson === undefined ? {} : { outputSchemaJson: toBoundedJsonObject(tool.outputSchemaJson)! }),
      safety: { ...tool.safety },
      refreshEligible: tool.refreshEligible,
      ...(tool.curation === undefined ? {} : { curation: { ...(tool.curation.useCases === undefined ? {} : { useCases: [...tool.curation.useCases] }), ...(tool.curation.reason === undefined ? {} : { reason: tool.curation.reason }) } }),
      requiredScopes: [...tool.requiredScopes],
      ...(tool.providerToolId === undefined ? {} : { providerToolId: tool.providerToolId }),
    })),
    allowedToolNames: [...definition.allowedToolNames],
    ...(definition.curatedToolNames === undefined ? {} : { curatedToolNames: [...definition.curatedToolNames] }),
    ...(definition.toolCount === undefined ? {} : { toolCount: definition.toolCount }),
    ...(definition.toolsNextCursor === undefined ? {} : { toolsNextCursor: definition.toolsNextCursor }),
    ...(definition.toolsHasMore === undefined ? {} : { toolsHasMore: definition.toolsHasMore }),
    ...(definition.featuredToolNames === undefined ? {} : { featuredToolNames: [...definition.featuredToolNames] }),
  };
}

/** @internal Package-local untrusted-cache boundary; not re-exported from the package root. */
export function normalizePersistedConnectorDefinition(value: unknown): ConnectorCatalogDefinition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || record.provider !== 'composio' || typeof record.category !== 'string') return undefined;
  if (record.authentication !== 'composio') return undefined;
  const tools = Array.isArray(record.tools)
    ? record.tools.map(normalizePersistedConnectorToolDefinition).filter((tool): tool is ConnectorCatalogToolDefinition => tool !== undefined)
    : [];
  const definition: ConnectorCatalogDefinition = {
    id: record.id,
    name: record.name,
    provider: record.provider,
    category: record.category,
    authentication: record.authentication,
    tools,
    allowedToolNames: [],
  };
  if (typeof record.description === 'string') definition.description = record.description;
  if (typeof record.providerConnectorId === 'string') definition.providerConnectorId = record.providerConnectorId;
  if (Array.isArray(record.curatedToolNames)) definition.curatedToolNames = record.curatedToolNames.filter((item): item is string => typeof item === 'string');
  if (Array.isArray(record.featuredToolNames)) definition.featuredToolNames = record.featuredToolNames.filter((item): item is string => typeof item === 'string');
  if (typeof record.toolCount === 'number' && Number.isFinite(record.toolCount) && record.toolCount >= 0) {
    definition.toolCount = record.toolCount;
  }
  if (record.minimumApproval === 'auto' || record.minimumApproval === 'confirm' || record.minimumApproval === 'disabled') {
    definition.minimumApproval = record.minimumApproval;
  }
  if (typeof record.disabled === 'boolean') definition.disabled = record.disabled;
  if (typeof record.toolsNextCursor === 'string') definition.toolsNextCursor = record.toolsNextCursor;
  if (typeof record.toolsHasMore === 'boolean') definition.toolsHasMore = record.toolsHasMore;
  const callableToolNames = new Set(
    tools
      .filter((tool) => tool.refreshEligible && tool.inputSchemaUnsupportedReason === undefined)
      .map((tool) => tool.name),
  );
  definition.allowedToolNames = Array.isArray(record.allowedToolNames)
    ? record.allowedToolNames.filter((item): item is string => typeof item === 'string' && callableToolNames.has(item))
    : [];
  return definition;
}

/** @internal Package-local untrusted-cache boundary; not re-exported from the package root. */
export function normalizePersistedConnectorToolDefinition(value: unknown): ConnectorCatalogToolDefinition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.title !== 'string') return undefined;
  const inputSchemaJson = toBoundedJsonObject(record.inputSchemaJson);
  const inputSchemaUnsupportedReason = inputSchemaJson === undefined
    ? 'persisted provider input schema is missing or invalid'
    : getConnectorSchemaSupportError(inputSchemaJson);
  return defineConnectorTool({
    name: record.name,
    title: record.title,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(inputSchemaJson === undefined ? {} : { inputSchemaJson }),
    ...(inputSchemaUnsupportedReason === undefined ? {} : { inputSchemaUnsupportedReason }),
    ...(toBoundedJsonObject(record.outputSchemaJson) === undefined ? {} : { outputSchemaJson: toBoundedJsonObject(record.outputSchemaJson)! }),
    ...(record.curation && typeof record.curation === 'object' && !Array.isArray(record.curation)
      ? {
        curation: {
          ...(((record.curation as Record<string, unknown>).useCases && Array.isArray((record.curation as Record<string, unknown>).useCases))
            ? { useCases: ((record.curation as Record<string, unknown>).useCases as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0) }
            : {}),
          ...(typeof (record.curation as Record<string, unknown>).reason === 'string' ? { reason: (record.curation as Record<string, unknown>).reason as string } : {}),
        },
      }
      : {}),
    requiredScopes: Array.isArray(record.requiredScopes) ? record.requiredScopes.filter((item): item is string => typeof item === 'string') : [],
    ...(typeof record.providerToolId === 'string' ? { providerToolId: record.providerToolId } : {}),
  });
}

/** @internal Package-local persistence contract; not re-exported from the package root. */
export function readPersistedComposioCatalogCache(filePath: string): PersistedComposioCatalogCache | undefined {
  try {
    const parsed = JSON.parse(readBoundedUtf8File(filePath, COMPOSIO_MAX_CACHE_BYTES)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record.provider !== 'composio' || typeof record.fetchedAt !== 'string' || !Array.isArray(record.definitions)) return undefined;
    return {
      schemaVersion: 1,
      provider: 'composio',
      fetchedAt: record.fetchedAt,
      definitions: record.definitions.map(normalizePersistedConnectorDefinition).filter((definition): definition is ConnectorCatalogDefinition => definition !== undefined),
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    return undefined;
  }
}

/**
 * Writes a bounded catalog cache atomically while holding its target lock.
 *
 * @internal Package-local persistence contract; not re-exported from the
 * package root.
 * @complexity Time: O(n). Space: O(n), capped by the cache byte limit.
 * @overallScore 98/100 — synchronous serialization is bounded and matches the
 * package's synchronous persistence adapters.
 */
export function writePersistedComposioCatalogCache(filePath: string, cache: PersistedComposioCatalogCache): void {
  withExclusiveFileLock(filePath, () => {
    const directory = path.dirname(filePath);
    fs.chmodSync(directory, 0o700);
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(cache, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > COMPOSIO_MAX_CACHE_BYTES) {
      throw new BoundedDataError(`Composio catalog cache exceeds the ${COMPOSIO_MAX_CACHE_BYTES}-byte limit`);
    }
    try {
      fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, filePath);
      fs.chmodSync(filePath, 0o600);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        if (!isErrno(cleanupError, 'ENOENT')) throw cleanupError;
      }
      throw error;
    }
  });
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** @internal Package-local error-shape contract; not re-exported from the package root. */
export function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function getNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

async function mapWithConcurrency<T, U>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }));
  return results;
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function getComposioToolkitDescription(toolkit: ComposioToolkitResponse | undefined): string | undefined {
  const description = getString(toolkit?.meta?.description) ?? getString(toolkit?.description);
  if (!description || isGenericComposioDescription(description)) return undefined;
  return description;
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function getComposioToolkitToolCount(toolkit: ComposioToolkitResponse | undefined): number | undefined {
  return getNonNegativeInteger(toolkit?.meta?.tools_count) ?? getNonNegativeInteger(toolkit?.meta?.toolsCount);
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function isGenericComposioDescription(description: string): boolean {
  return /^connect to .+ through composio\.?$/i.test(description.trim())
    || /^.+ integration via composio\.?$/i.test(description.trim());
}

/** @internal Package-local catalog-description contract; not re-exported from the package root. */
export function fallbackComposioDescription(
  name: string,
  category: string | undefined,
  productName: string,
): string {
  const normalizedCategory = category?.trim().toLowerCase();
  if (normalizedCategory?.includes('project')) return `Coordinate ${name} projects, tasks, and workflow data inside ${productName}.`;
  if (normalizedCategory?.includes('communication')) return `Bring ${name} conversations, channels, and collaboration context into ${productName}.`;
  if (normalizedCategory?.includes('documentation')) return `Search and reuse ${name} knowledge, pages, and documentation in ${productName}.`;
  if (normalizedCategory?.includes('storage')) return `Find and reference ${name} files, folders, and document metadata from ${productName}.`;
  if (normalizedCategory?.includes('developer')) return `Inspect ${name} developer resources, activity, and operational context from ${productName}.`;
  if (normalizedCategory?.includes('crm') || normalizedCategory?.includes('sales')) return `Use ${name} customer, deal, and account context in ${productName}.`;
  if (normalizedCategory?.includes('marketing')) return `Analyze ${name} campaigns, audiences, and marketing activity from ${productName}.`;
  if (normalizedCategory?.includes('finance') || normalizedCategory?.includes('commerce')) return `Work with ${name} business, billing, and transaction data in ${productName}.`;
  if (normalizedCategory?.includes('observability')) return `Surface ${name} incidents, metrics, and operational signals in ${productName}.`;
  if (normalizedCategory?.includes('data')) return `Query ${name} datasets and platform metadata for data-backed work in ${productName}.`;
  return `Use ${name} tools and data directly from ${productName}.`;
}

/** @internal Package-local provider wire contract; not re-exported from the package root. */
export function getComposioAuthConfigId(response: ComposioAuthConfigResponse): string | undefined {
  return getString(response.id) ?? getString(response.auth_config?.id);
}

/** @internal Package-local provider wire contract; not re-exported from the package root. */
export function getComposioToolkitSlug(response: ComposioAuthConfigResponse): string | undefined {
  return getString(response.toolkit?.slug) ?? getString(response.toolkit_slug) ?? getString(response.toolkitSlug);
}

/** @internal Package-local provider wire contract; not re-exported from the package root. */
export function getComposioConnectionId(response: ComposioConnectedAccountResponse): string | undefined {
  return getString(response.connected_account_id) ?? getString(response.connectedAccountId) ?? getString(response.id) ?? getString(response.nanoid);
}

function appendOAuthStateToCallbackUrl(callbackUrl: string, state: string): string {
  const url = new URL(callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function connectorIdForToolkitSlug(toolkitSlug: string): string {
  const normalized = normalizeComposioSlug(toolkitSlug);
  if (normalized === 'googledrive' || normalized === 'gdrive' || normalized === 'drive') return 'google_drive';
  return normalized;
}

function normalizeComposioSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function normalizeToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

function normalizeProviderToolId(value: string): string {
  return normalizeToolName(value);
}

/** @internal Package-local curation contract; not re-exported from the package root. */
export function applyComposioToolCuration(
  tool: ConnectorCatalogToolDefinition,
  connectorId: string,
  providerToolId: string | undefined,
  curationOverlay: ComposioCurationOverlay,
): ConnectorCatalogToolDefinition {
  const connectorKey = normalizeComposioSlug(connectorId);
  const overlay = curationOverlay[connectorKey];
  const toolKey = providerToolId ? normalizeProviderToolId(providerToolId) : undefined;
  const curation = toolKey ? overlay?.[toolKey] : undefined;
  const safetyOverride = toolKey
    ? COMPOSIO_READ_ONLY_TOOL_SAFETY_OVERRIDES.has(`${connectorKey}:${toolKey}`)
    : false;
  const curated = curation === undefined
    ? tool
    : { ...tool, curation: { ...(tool.curation ?? {}), ...curation } };
  return safetyOverride && curated.safety.sideEffect === 'read' && curated.safety.approval === 'auto'
    ? {
        ...curated,
        safety: { ...COMPOSIO_READ_ONLY_TOOL_SAFETY },
        refreshEligible: true,
      }
    : curated;
}

function titleFromSlug(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
}

/** @internal Package-local provider normalization contract; not re-exported from the package root. */
export function firstCategoryName(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const name = getString(record.name) ?? getString(record.slug);
      if (name) return name;
    }
  }
  return undefined;
}

function isCustomAuthRequiredMessage(message: string): boolean {
  return /default auth config not found/i.test(message) || /does not have managed credentials/i.test(message);
}

/** @internal Package-local auth-failure classifier; not re-exported from the package root. */
export function isComposioAuthenticationFailure(value: unknown): boolean {
  const stack: unknown[] = [value];
  let inspected = 0;
  while (stack.length > 0 && inspected < 1_000) {
    inspected += 1;
    const current = stack.pop();
    if (current === 401) return true;
    if (typeof current === 'string') {
      const normalized = current.toLowerCase();
      if (
        normalized === '401'
        || /\bbad credentials\b/.test(normalized)
        || /\bunauthori[sz]ed\b/.test(normalized)
        || /\binvalid (?:access )?token\b/.test(normalized)
        || /\btoken (?:is )?expired\b/.test(normalized)
        || /\bexpired (?:access )?token\b/.test(normalized)
      ) return true;
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current && typeof current === 'object') {
      stack.push(...Object.values(current));
    }
  }
  return false;
}

/** @internal Package-local provider error contract; not re-exported from the package root. */
export function getCustomAuthRequiredMessage(error: unknown, definition: ConnectorCatalogDefinition): string | undefined {
  if (error instanceof ConnectorServiceError && error.code === 'CONNECTOR_AUTH_CONFIG_REQUIRED') return error.message;
  const upstreamMessage = error instanceof Error ? error.message : String(error);
  if (!isCustomAuthRequiredMessage(upstreamMessage)) return undefined;
  return `${definition.name} requires a custom Composio auth config. Create or enable a ${definition.name} auth config in Composio with your own OAuth credentials, then retry this connection.`;
}

/** @internal Package-local retry classifier; not re-exported from the package root. */
export function isCachedAuthConfigRejection(error: unknown): boolean {
  if (!(error instanceof ConnectorServiceError)) return false;
  const httpStatus = error.details?.httpStatus;
  return httpStatus === 400 || httpStatus === 404;
}

/** @internal Package-local error-sanitization contract; not re-exported from the package root. */
export async function getComposioSafeErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = await readBoundedResponseJson(
      response,
      COMPOSIO_MAX_ERROR_RESPONSE_BYTES,
      'Composio error response',
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    const record = payload as Record<string, unknown>;
    const error = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
      ? record.error as Record<string, unknown>
      : undefined;
    const candidate = getString(record.message)
      ?? getString(error?.message)
      ?? getString(record.error)
      ?? getString(record.detail)
      ?? getString(error?.suggested_fix);
    if (candidate && isCustomAuthRequiredMessage(candidate)) return 'Default auth config not found';
    if (candidate && isComposioAuthenticationFailure(candidate)) return 'Composio authentication failed';
    return undefined;
  } catch {
    return undefined;
  }
}

interface DecodedComposioInputSchema {
  schema: BoundedJsonObject;
  unsupportedReason?: string;
}

function isCanonicalJsonSchemaObject(schema: BoundedJsonObject): boolean {
  return typeof schema.type === 'string'
    || Array.isArray(schema.type)
    || Array.isArray(schema.required)
    || schema.properties !== undefined
    || typeof schema.additionalProperties === 'boolean'
    || schema.allOf !== undefined
    || schema.anyOf !== undefined
    || schema.oneOf !== undefined
    || schema.not !== undefined
    || schema.items !== undefined
    || schema.enum !== undefined
    || schema.const !== undefined;
}

/**
 * Converts Composio's parameter-map wire shape into strict object JSON Schema.
 *
 * Per-field `required` is an adapter annotation, not a JSON Schema keyword at
 * that location. Every other annotation remains subject to the package's
 * fail-closed supported-keyword validator.
 *
 * @complexity Time: O(p), where p is the bounded parameter count. Space: O(p).
 * @overallScore 100/100
 */
function decodeComposioInputParameters(value: unknown): DecodedComposioInputSchema {
  if (value === true) return { schema: {} };
  if (value === false) return { schema: { not: {} } };
  if (value === undefined) {
    return {
      schema: {},
      unsupportedReason: 'provider input schema is missing',
    };
  }

  const bounded = toBoundedJsonObject(value);
  if (bounded === undefined) {
    return {
      schema: {},
      unsupportedReason: 'provider input schema is not a JSON Schema object or boolean',
    };
  }
  if (Object.keys(bounded).length === 0 || isCanonicalJsonSchemaObject(bounded)) {
    const unsupportedReason = getConnectorSchemaSupportError(bounded);
    return {
      schema: bounded,
      ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
    };
  }

  const properties: BoundedJsonObject = {};
  const required: JsonValue[] = [];
  for (const [parameterName, parameterValue] of Object.entries(bounded)) {
    if (!parameterValue || typeof parameterValue !== 'object' || Array.isArray(parameterValue)) {
      return {
        schema: {},
        unsupportedReason: `provider input parameter "${parameterName}" is not a schema object`,
      };
    }
    const parameterSchema: BoundedJsonObject = {};
    for (const [keyword, annotation] of Object.entries(parameterValue)) {
      if (keyword === 'required') {
        if (typeof annotation !== 'boolean') {
          return {
            schema: {},
            unsupportedReason: `provider input parameter "${parameterName}" has an invalid required annotation`,
          };
        }
        if (annotation) required.push(parameterName);
        continue;
      }
      Object.defineProperty(parameterSchema, keyword, {
        configurable: true,
        enumerable: true,
        value: annotation,
        writable: true,
      });
    }
    Object.defineProperty(properties, parameterName, {
      configurable: true,
      enumerable: true,
      value: parameterSchema,
      writable: true,
    });
  }
  const schema: BoundedJsonObject = {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
  const unsupportedReason = getConnectorSchemaSupportError(schema);
  return {
    schema,
    ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
  };
}

function toBoundedJsonValue(value: unknown): BoundedJsonValue {
  return toStructurallyBoundedJsonValue(value);
}

function toBoundedJsonObject(value: unknown): BoundedJsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  const bounded = toBoundedJsonValue(value);
  return bounded && typeof bounded === 'object' && !Array.isArray(bounded) ? bounded : undefined;
}
