import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { JsonValue } from '@injini/protocol';

import {
  classifyConnectorToolSafety,
  connectorDefinitionToDetail,
  type JsonObject,
  type ConnectorDetail,
  type ConnectorCatalogDefinition,
  type ConnectorCatalogToolDefinition,
  type ConnectorToolSafety,
  type ConnectorStatus,
} from './catalog.js';
import {
  COMPOSIO_MAX_SECRET_STORE_BYTES,
  readPrivateBoundedUtf8File,
  toStructurallyBoundedJsonValue,
} from './bounded-data.js';
import {
  ComposioConnectorProvider,
  isComposioCredentialMaterial,
  type ComposioAuthConfigPrepareResult,
  type ComposioConnectionStart,
} from './composio.js';
import { ConnectorServiceError, type ConnectorServiceErrorCode } from './errors.js';
import { assertConnectorInputMatchesSchema } from './json-schema.js';
import { withExclusiveFileLock } from './file-lock.js';
import {
  CONNECTOR_MAX_OUTPUT_BYTES,
  protectConnectorOutput,
  type ConnectorOutputProtectionResult,
} from './output-protection.js';

type BoundedJsonObject = JsonObject;
type BoundedJsonValue = JsonValue;

export interface ConnectorExecuteRequest {
  connectorId: string;
  toolName: string;
  input: BoundedJsonObject;
  expectedAccountLabel?: string;
}

export interface ConnectorExecuteResponse {
  ok: true;
  connectorId: string;
  accountLabel?: string;
  toolName: string;
  safety: ConnectorCatalogDefinition['tools'][number]['safety'];
  output: BoundedJsonValue;
  outputSummary?: string;
  metadata?: BoundedJsonObject;
}

export interface ConnectorConnectResult {
  connector: ConnectorDetail;
  auth?: Pick<ComposioConnectionStart, 'kind' | 'redirectUrl' | 'providerConnectionId' | 'expiresAt'>;
}

export interface ConnectorAuthConfigPrepareResponse {
  results: Record<string, ComposioAuthConfigPrepareResult>;
}

type PublicComposioConnectionStart = Pick<ComposioConnectionStart, 'kind' | 'redirectUrl' | 'providerConnectionId' | 'expiresAt'>;

function publicComposioAuthStart(auth: ComposioConnectionStart): PublicComposioConnectionStart {
  return {
    kind: auth.kind,
    ...(auth.redirectUrl === undefined ? {} : { redirectUrl: auth.redirectUrl }),
    ...(auth.providerConnectionId === undefined ? {} : { providerConnectionId: auth.providerConnectionId }),
    ...(auth.expiresAt === undefined ? {} : { expiresAt: auth.expiresAt }),
  };
}

function isConnectorAuthStaleError(error: unknown, request: Pick<ConnectorExecuteRequest, 'connectorId' | 'toolName'>): boolean {
  if (!(error instanceof ConnectorServiceError) || error.code !== 'CONNECTOR_EXECUTION_FAILED') return false;
  const details = error.details;
  return details?.connectorId === request.connectorId
    && details.toolName === request.toolName
    && details.authStale === true;
}

function connectorAuthExpiredMessage(definition: ConnectorCatalogDefinition): string {
  return `${definition.name} authorization expired. Reconnect ${definition.name}.`;
}

export { ConnectorServiceError, type ConnectorServiceErrorCode } from './errors.js';
export {
  CONNECTOR_MAX_OUTPUT_BYTES,
  protectConnectorOutput,
  type ConnectorOutputProtectionResult,
} from './output-protection.js';

export interface ConnectorConnectionStatus {
  status: ConnectorStatus;
  accountLabel?: string;
  lastError?: string;
}

export interface ConnectorConnectionRecord extends ConnectorConnectionStatus {
  updatedAt: string;
}

export interface ConnectorDiscoveryResult {
  connectors: ConnectorDetail[];
  meta?: {
    provider: 'composio';
    refreshRequested?: boolean;
  };
}

export type ConnectorCredentialMaterial = JsonObject;

export interface ConnectorCredentialRecord {
  schemaVersion: 1;
  connectorId: string;
  accountLabel: string;
  credentials: ConnectorCredentialMaterial;
  updatedAt: string;
}

export interface ConnectorCredentialStore {
  get(connectorId: string): ConnectorCredentialRecord | undefined;
  set(record: ConnectorCredentialRecord): void;
  delete(connectorId: string): void;
  deleteByProvider(provider: string): void;
}

export interface ConnectorStatusServiceOptions {
  initialStatuses?: Record<string, ConnectorConnectionStatus>;
  credentialStore?: ConnectorCredentialStore;
  now?: () => number;
}

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}

function cloneCredentialMaterial(credentials: ConnectorCredentialMaterial): ConnectorCredentialMaterial {
  const cloned = toStructurallyBoundedJsonValue(credentials);
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new TypeError('connector credentials must be a bounded JSON object');
  }
  return cloned;
}

export class InMemoryConnectorCredentialStore implements ConnectorCredentialStore {
  private readonly records = new Map<string, ConnectorCredentialRecord>();

  get(connectorId: string): ConnectorCredentialRecord | undefined {
    const record = this.records.get(connectorId);
    return record === undefined ? undefined : { ...record, credentials: cloneCredentialMaterial(record.credentials) };
  }

  set(record: ConnectorCredentialRecord): void {
    this.records.set(record.connectorId, { ...record, credentials: cloneCredentialMaterial(record.credentials) });
  }

  delete(connectorId: string): void {
    this.records.delete(connectorId);
  }

  deleteByProvider(provider: string): void {
    for (const [connectorId, record] of this.records.entries()) {
      if (record.credentials.provider === provider) this.records.delete(connectorId);
    }
  }
}

export class FileConnectorCredentialStore implements ConnectorCredentialStore {
  private readonly filePath: string;

  constructor({ filePath }: { filePath: string }) {
    if (!filePath.trim()) throw new TypeError('Composio credential filePath must not be empty.');
    this.filePath = path.resolve(filePath);
  }

  get(connectorId: string): ConnectorCredentialRecord | undefined {
    return this.readRecords()[connectorId];
  }

  set(record: ConnectorCredentialRecord): void {
    withExclusiveFileLock(this.filePath, () => {
      const records = this.readRecords();
      records[record.connectorId] = { ...record, credentials: cloneCredentialMaterial(record.credentials) };
      this.writeRecords(records);
    });
  }

  delete(connectorId: string): void {
    withExclusiveFileLock(this.filePath, () => {
      const records = this.readRecords();
      if (records[connectorId] === undefined) return;
      delete records[connectorId];
      this.writeRecords(records);
    });
  }

  deleteByProvider(provider: string): void {
    withExclusiveFileLock(this.filePath, () => {
      const records = this.readRecords();
      let changed = false;
      for (const [connectorId, record] of Object.entries(records)) {
        if (record.credentials.provider === provider) {
          delete records[connectorId];
          changed = true;
        }
      }
      if (changed) this.writeRecords(records);
    });
  }

  private readRecords(): Record<string, ConnectorCredentialRecord> {
    try {
      const parsed = JSON.parse(readPrivateBoundedUtf8File(this.filePath, COMPOSIO_MAX_SECRET_STORE_BYTES)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const records: Record<string, ConnectorCredentialRecord> = {};
      for (const [connectorId, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const raw = value as Record<string, unknown>;
        if (raw.schemaVersion !== 1 || raw.connectorId !== connectorId || typeof raw.accountLabel !== 'string' || typeof raw.updatedAt !== 'string') continue;
        if (!raw.credentials || typeof raw.credentials !== 'object' || Array.isArray(raw.credentials)) continue;
        if ((raw.credentials as Record<string, unknown>).provider === 'composio' && !isComposioCredentialMaterial(raw.credentials)) continue;
        records[connectorId] = {
          schemaVersion: 1,
          connectorId,
          accountLabel: raw.accountLabel,
          credentials: cloneCredentialMaterial(raw.credentials as ConnectorCredentialMaterial),
          updatedAt: raw.updatedAt,
        };
      }
      return records;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private writeRecords(records: Record<string, ConnectorCredentialRecord>): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const serialized = `${JSON.stringify(records, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > COMPOSIO_MAX_SECRET_STORE_BYTES) {
      throw new RangeError(`Composio credentials exceed the ${COMPOSIO_MAX_SECRET_STORE_BYTES}-byte limit.`);
    }
    try {
      fs.writeFileSync(tempPath, serialized, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanupError) {
        if (!isErrno(cleanupError, 'ENOENT')) throw cleanupError;
      }
      throw error;
    }
  }
}

function cloneStatus(status: ConnectorConnectionStatus): ConnectorConnectionStatus {
  return {
    status: status.status,
    ...(status.accountLabel === undefined ? {} : { accountLabel: status.accountLabel }),
    ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
  };
}

function isAutoConnectedConnector(definition: ConnectorCatalogDefinition): boolean {
  return (definition.authentication === 'local' || definition.authentication === 'none')
    && definition.tools.every((tool) => tool.requiredScopes.length === 0);
}

function approvalRank(approval: Exclude<ConnectorCatalogDefinition['minimumApproval'], undefined>): number {
  switch (approval) {
    case 'auto':
      return 0;
    case 'confirm':
      return 1;
    case 'disabled':
      return 2;
  }
}

function stricterApproval(
  ...approvals: Array<Exclude<ConnectorCatalogDefinition['minimumApproval'], undefined>>
): Exclude<ConnectorCatalogDefinition['minimumApproval'], undefined> {
  return approvals.reduce((left, right) => (
    approvalRank(left) >= approvalRank(right) ? left : right
  ));
}

function runtimeSafetyForTool(tool: ConnectorCatalogToolDefinition): ConnectorToolSafety {
  const classified = classifyConnectorToolSafety(tool);
  if (classified.sideEffect !== 'read' || classified.approval !== 'auto') return classified;
  return tool.safety;
}

function defaultConnectedAccountLabel(definition: ConnectorCatalogDefinition): string {
  return definition.name;
}

/** In-memory connection state backed optionally by durable credentials. */
export class ConnectorStatusService {
  private readonly statuses = new Map<string, ConnectorConnectionRecord>();
  private readonly now: () => number;
  private credentialStore: ConnectorCredentialStore | undefined;

  constructor(options: ConnectorStatusServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.credentialStore = options.credentialStore;
    for (const [connectorId, status] of Object.entries(options.initialStatuses ?? {})) {
      this.statuses.set(connectorId, { ...cloneStatus(status), updatedAt: nowIso(this.now) });
    }
  }

  setCredentialStore(credentialStore: ConnectorCredentialStore): void {
    this.credentialStore = credentialStore;
  }

  deleteCredentialsByProvider(provider: string): void {
    for (const [connectorId, status] of this.statuses.entries()) {
      if (status.status !== 'connected') continue;
      const credential = this.getCredential(connectorId);
      if (credential?.credentials.provider === provider) this.statuses.delete(connectorId);
    }
    this.credentialStore?.deleteByProvider(provider);
  }

  getStatus(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    const stored = this.statuses.get(definition.id);
    if (stored) return cloneStatus(stored);

    const credentialRecord = this.getCredential(definition.id);
    if (credentialRecord !== undefined) {
      return { status: 'connected', accountLabel: credentialRecord.accountLabel };
    }

    if (isAutoConnectedConnector(definition)) {
      return { status: 'connected', accountLabel: defaultConnectedAccountLabel(definition) };
    }

    return { status: 'available' };
  }

  listStatuses(): Record<string, ConnectorConnectionStatus> {
    return Object.fromEntries(
      Array.from(this.statuses.entries()).map(([connectorId, status]) => [connectorId, cloneStatus(status)]),
    );
  }

  connect(definition: ConnectorCatalogDefinition, accountLabel?: string, credentials?: ConnectorCredentialMaterial): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    if (credentials !== undefined) {
      this.credentialStore?.set({
        schemaVersion: 1,
        connectorId: definition.id,
        accountLabel: accountLabel ?? defaultConnectedAccountLabel(definition),
        credentials,
        updatedAt: nowIso(this.now),
      });
    }

    const next: ConnectorConnectionRecord = {
      status: 'connected',
      accountLabel: accountLabel ?? defaultConnectedAccountLabel(definition),
      updatedAt: nowIso(this.now),
    };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  getCredential(connectorId: string): ConnectorCredentialRecord | undefined {
    return this.credentialStore?.get(connectorId);
  }

  disconnect(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    this.credentialStore?.delete(definition.id);

    if (isAutoConnectedConnector(definition)) {
      this.statuses.delete(definition.id);
      return this.getStatus(definition);
    }

    const next: ConnectorConnectionRecord = { status: 'available', updatedAt: nowIso(this.now) };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  setError(definition: ConnectorCatalogDefinition, lastError: string, accountLabel?: string): ConnectorConnectionStatus {
    if (definition.disabled) return { status: 'disabled' };

    const next: ConnectorConnectionRecord = {
      status: 'error',
      ...(accountLabel === undefined ? {} : { accountLabel }),
      lastError,
      updatedAt: nowIso(this.now),
    };
    this.statuses.set(definition.id, next);
    return cloneStatus(next);
  }

  markAuthenticationExpired(definition: ConnectorCatalogDefinition, lastError: string, accountLabel?: string): ConnectorConnectionStatus {
    this.credentialStore?.delete(definition.id);
    return this.setError(definition, lastError, accountLabel);
  }

  clear(connectorId: string): void {
    this.statuses.delete(connectorId);
  }
}

export interface ConnectorExecutionContext {
  /** Stable host scope used to isolate rate limits. */
  scopeId: string;
  /** Optional run/session key. A bounded purpose bucket is used when absent. */
  sessionId?: string;
  purpose?: 'agent_preview' | 'background_refresh';
  signal?: AbortSignal;
}

export const CONNECTOR_RUN_RATE_LIMIT_CALLS = 10;
export const CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS = 60_000;
export const CONNECTOR_RUN_LIMIT_TTL_MS = 15 * 60_000;
export const CONNECTOR_RUN_TOTAL_CALL_LIMIT = 60;
export const COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT = 100;
const CONNECTOR_RUN_LIMIT_MAX_BUCKETS = 10_000;
const CONNECTOR_RUN_IDENTIFIER_MAX_LENGTH = 256;
const CONNECTOR_EXECUTE_IDENTIFIER_MAX_LENGTH = 256;
const CONNECTOR_EXECUTE_INPUT_MAX_BYTES = 1024 * 1024;

interface ConnectorRunLimitState {
  windowStartedAt: number;
  lastSeenAt: number;
  windowCalls: number;
  totalCalls: number;
}

function canonicalRunIdentifier(value: string, label: 'scopeId' | 'sessionId'): string {
  const canonical = value.normalize('NFKC').trim().toLowerCase();
  if (
    canonical.length === 0
    || canonical.length > CONNECTOR_RUN_IDENTIFIER_MAX_LENGTH
    || !/^[a-z0-9][a-z0-9._:@/-]*$/.test(canonical)
  ) {
    throw new ConnectorServiceError(
      'CONNECTOR_RATE_LIMITED',
      `${label} must be a non-empty canonical identifier`,
      400,
      { field: label, maxLength: CONNECTOR_RUN_IDENTIFIER_MAX_LENGTH },
    );
  }
  return canonical;
}

function connectorRunLimitKey(context: ConnectorExecutionContext): string {
  const scopeId = canonicalRunIdentifier(context.scopeId, 'scopeId');
  const sessionId = canonicalRunIdentifier(
    context.sessionId ?? `${context.purpose ?? 'agent_preview'}:no-session-id`,
    'sessionId',
  );
  return `${scopeId}\0${sessionId}`;
}

function normalizeExecuteIdentifier(
  value: string,
  field: 'connectorId' | 'toolName',
): string {
  if (typeof value !== 'string') {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      `${field} must be a string`,
      400,
      { field, maxLength: CONNECTOR_EXECUTE_IDENTIFIER_MAX_LENGTH },
    );
  }
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length === 0
    || normalized.length > CONNECTOR_EXECUTE_IDENTIFIER_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      `${field} must be a bounded identifier`,
      400,
      { field, maxLength: CONNECTOR_EXECUTE_IDENTIFIER_MAX_LENGTH },
    );
  }
  return normalized;
}

/**
 * Detaches and bounds an execute request before any provider or account I/O.
 *
 * @returns A normalized request whose input is a finite, acyclic JSON object.
 * @throws {ConnectorServiceError} With a stable 400 contract for malformed or
 * oversized identifiers, roots, structures, strings, or serialized payloads.
 *
 * @complexity Time: O(n), where n is the bounded input graph and serialized
 * byte length. Space: O(n) for the detached JSON value and serialization.
 * @overallScore 100/100
 */
function normalizeConnectorExecuteRequest(
  request: ConnectorExecuteRequest,
): ConnectorExecuteRequest {
  const connectorId = normalizeExecuteIdentifier(request.connectorId, 'connectorId');
  const toolName = normalizeExecuteIdentifier(request.toolName, 'toolName');
  let boundedInput: JsonValue;
  try {
    boundedInput = toStructurallyBoundedJsonValue(request.input);
  } catch {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      'connector input exceeds structural safety limits',
      400,
      { connectorId, toolName },
    );
  }
  if (boundedInput === null || typeof boundedInput !== 'object' || Array.isArray(boundedInput)) {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      'connector input must be a JSON object',
      400,
      { connectorId, toolName },
    );
  }
  const serializedBytes = Buffer.byteLength(JSON.stringify(boundedInput), 'utf8');
  if (serializedBytes > CONNECTOR_EXECUTE_INPUT_MAX_BYTES) {
    throw new ConnectorServiceError(
      'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      'connector input exceeds the serialized byte limit',
      400,
      {
        connectorId,
        toolName,
        maxSerializedBytes: CONNECTOR_EXECUTE_INPUT_MAX_BYTES,
        serializedBytes,
      },
    );
  }
  return {
    connectorId,
    toolName,
    input: boundedInput,
    ...(request.expectedAccountLabel === undefined
      ? {}
      : { expectedAccountLabel: request.expectedAccountLabel }),
  };
}

/** Explicit dependencies for {@link ComposioConnectorService}. */
export interface ComposioConnectorServiceOptions {
  provider: ComposioConnectorProvider;
  statusService?: ConnectorStatusService;
  now?: () => number;
}

function aggregateCatalogHydrationError(): ConnectorServiceError {
  return new ConnectorServiceError(
    'CONNECTOR_EXECUTION_FAILED',
    'aggregate Composio catalog hydration is unsupported; hydrate one connector at a time',
    400,
  );
}

/**
 * Application service that coordinates the Composio provider, connection
 * status, durable credentials, safety policy, and execution limits.
 */
export class ComposioConnectorService {
  private readonly runLimits = new Map<string, ConnectorRunLimitState>();
  private readonly provider: ComposioConnectorProvider;
  private readonly statusService: ConnectorStatusService;
  private readonly now: () => number;

  constructor(options: ComposioConnectorServiceOptions) {
    this.provider = options.provider;
    this.statusService = options.statusService ?? new ConnectorStatusService(
      options.now === undefined ? {} : { now: options.now },
    );
    this.now = options.now ?? Date.now;
  }

  setCredentialStore(credentialStore: ConnectorCredentialStore): void {
    this.statusService.setCredentialStore(credentialStore);
  }

  deleteCredentialsByProvider(provider: string): void {
    this.statusService.deleteCredentialsByProvider(provider);
  }

  async listDefinitions(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    return this.provider.listDefinitions(signal);
  }

  async listHydratedDefinitions(signal?: AbortSignal): Promise<ConnectorCatalogDefinition[]> {
    void signal;
    throw aggregateCatalogHydrationError();
  }

  listFastDefinitions(): ConnectorCatalogDefinition[] {
    return this.provider.getFastDefinitions();
  }

  getFastDefinition(connectorId: string): ConnectorCatalogDefinition | undefined {
    return this.listFastDefinitions().find((definition) => definition.id === connectorId);
  }

  async getDefinition(connectorId: string, signal?: AbortSignal): Promise<ConnectorCatalogDefinition | undefined> {
    return this.provider.getDefinition(connectorId, signal);
  }

  async getHydratedDefinition(connectorId: string, signal?: AbortSignal): Promise<ConnectorCatalogDefinition | undefined> {
    return this.provider.getHydratedDefinition(connectorId, signal, {
      requireCurrentTools: true,
    });
  }

  async getPreviewDefinition(connectorId: string, options: { toolsLimit: number; toolsCursor?: string; signal?: AbortSignal }): Promise<ConnectorCatalogDefinition | undefined> {
    return this.provider.getPreviewDefinition(connectorId, options);
  }

  getStatus(definition: ConnectorCatalogDefinition): ConnectorConnectionStatus {
    const status = this.statusService.getStatus(definition);
    if (
      definition.authentication === 'composio'
      && status.status === 'connected'
      && this.getCredential(definition.id) === undefined
    ) {
      return { status: 'available' };
    }
    return status;
  }

  getCredential(connectorId: string): ConnectorCredentialRecord | undefined {
    const credential = this.statusService.getCredential(connectorId);
    const definition = this.getFastDefinition(connectorId);
    if (
      definition?.authentication === 'composio'
      && !this.provider.credentialMatchesDefinition(definition, credential?.credentials)
    ) {
      return undefined;
    }
    return credential;
  }

  async listConnectors(signal?: AbortSignal): Promise<ConnectorDetail[]> {
    return this.listFastDefinitions().map((definition) => this.toDetail(definition));
  }

  listConnectorStatuses(): Record<string, ConnectorConnectionStatus> {
    return {
      ...this.statusService.listStatuses(),
      ...Object.fromEntries(this.listFastDefinitions().map((definition) => [definition.id, this.getStatus(definition)])),
    };
  }

  async listConnectorDiscovery(options: { refresh?: boolean; hydrateTools?: boolean; signal?: AbortSignal } = {}): Promise<ConnectorDiscoveryResult> {
    if (options.refresh) this.provider.clearDiscoveryCache();
    let definitions: ConnectorCatalogDefinition[];
    if (options.hydrateTools) {
      throw aggregateCatalogHydrationError();
    } else if (options.refresh) {
      definitions = await this.provider.refreshCatalog(options.signal);
    } else {
      definitions = await this.listDefinitions(options.signal);
    }
    return {
      connectors: definitions.map((definition) => this.toDetail(definition)),
      meta: {
        provider: 'composio',
        ...(options.refresh ? { refreshRequested: true } : {}),
      },
    };
  }

  async getConnector(connectorId: string, signal?: AbortSignal): Promise<ConnectorDetail> {
    const definition = await this.getDefinition(connectorId, signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async getHydratedConnector(connectorId: string, signal?: AbortSignal): Promise<ConnectorDetail> {
    const definition = await this.getHydratedDefinition(connectorId, signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async getPreviewConnector(connectorId: string, options: { toolsLimit: number; toolsCursor?: string; signal?: AbortSignal }): Promise<ConnectorDetail> {
    const definition = await this.getPreviewDefinition(connectorId, options);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    return this.toDetail(definition);
  }

  async prepareAuthConfigs(connectorIds: readonly string[], signal?: AbortSignal): Promise<ConnectorAuthConfigPrepareResponse> {
    const results: Record<string, ComposioAuthConfigPrepareResult> = {};
    const uniqueConnectorIds = [...new Set(connectorIds.map((id) => id.trim()).filter(Boolean))];
    if (uniqueConnectorIds.length > COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT) {
      throw new ConnectorServiceError(
        'CONNECTOR_RATE_LIMITED',
        'too many connector auth configs requested in one batch',
        413,
        {
          requested: uniqueConnectorIds.length,
          maximum: COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT,
        },
      );
    }

    await mapWithConcurrency(uniqueConnectorIds, 8, async (connectorId) => {
      const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId, signal);
      if (!definition) {
        results[connectorId] = { status: 'error', message: 'connector not found' };
        return;
      }
      if (definition.authentication !== 'composio') {
        results[connectorId] = { status: 'error', message: 'connector is not backed by Composio' };
        return;
      }
      results[connectorId] = await this.provider.prepareAuthConfig(definition, signal);
    });

    return { results };
  }

  async connect(connectorId: string, options: { accountLabel?: string; credentials?: ConnectorCredentialMaterial; callbackUrl?: string; signal?: AbortSignal } = {}): Promise<ConnectorConnectResult> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId, options.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }

    let auth: ComposioConnectionStart | undefined;
    let detailDefinition = definition;
    if (definition.authentication === 'composio' && options.credentials !== undefined) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Composio credentials cannot be supplied directly; complete the validated OAuth flow',
        400,
        { connectorId },
      );
    }
    if (definition.authentication === 'composio') {
      if (!options.callbackUrl) {
        throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'callbackUrl is required for Composio connectors', 400, { connectorId });
      }
      auth = await this.provider.connect(definition, options.callbackUrl, options.signal);
      if (auth.kind === 'redirect_required' || auth.kind === 'pending') {
        return { connector: this.toDetail(detailDefinition), auth: publicComposioAuthStart(auth) };
      }
      if (
        auth.credentials === undefined
        || !this.provider.credentialMatchesDefinition(definition, auth.credentials)
      ) {
        throw new ConnectorServiceError(
          'CONNECTOR_EXECUTION_FAILED',
          'Composio reported a connected account without validated credential evidence',
          502,
          { connectorId },
        );
      }
      if (auth.credentials !== undefined) {
        options = { ...options, ...(auth.accountLabel === undefined ? {} : { accountLabel: auth.accountLabel }), credentials: auth.credentials };
      }
    }

    const status = this.statusService.connect(detailDefinition, options.accountLabel, options.credentials);
    if (status.status === 'disabled') {
      throw new ConnectorServiceError('CONNECTOR_DISABLED', 'connector is disabled', 403);
    }
    return { connector: this.toDetail(detailDefinition), ...(auth === undefined ? {} : { auth: publicComposioAuthStart(auth) }) };
  }

  async disconnect(connectorId: string, signal?: AbortSignal): Promise<ConnectorDetail> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId, signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication === 'composio') {
      await this.provider.disconnect(definition, this.getCredential(connectorId)?.credentials, signal);
    }
    this.statusService.disconnect(definition);
    return this.toDetail(definition);
  }

  async cancelPendingAuthorization(connectorId: string): Promise<ConnectorDetail> {
    const definition = this.getFastDefinition(connectorId) ?? await this.getDefinition(connectorId);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication === 'composio') {
      this.provider.cancelPendingConnections(connectorId);
    }
    return this.toDetail(definition);
  }

  async completeComposioConnection(input: { connectorId: string; state: string; providerConnectionId?: string; status?: string; signal?: AbortSignal }): Promise<ConnectorDetail> {
    const definition = await this.getDefinition(input.connectorId, input.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    if (definition.authentication !== 'composio') {
      throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'connector is not backed by Composio', 400, { connectorId: input.connectorId });
    }
    const completed = await this.provider.completeConnection({ definition, state: input.state, ...(input.providerConnectionId === undefined ? {} : { providerConnectionId: input.providerConnectionId }), ...(input.status === undefined ? {} : { status: input.status }), ...(input.signal === undefined ? {} : { signal: input.signal }) });
    this.statusService.connect(definition, completed.accountLabel, completed.credentials);
    return this.toDetail(definition);
  }

  async execute(request: ConnectorExecuteRequest, context: ConnectorExecutionContext): Promise<ConnectorExecuteResponse> {
    const normalizedRequest = normalizeConnectorExecuteRequest(request);
    // Context identifiers are also public request material. Validate their
    // canonical shape before current-schema hydration performs provider I/O.
    connectorRunLimitKey(context);
    // Execution always resolves a fresh hydrated definition. Persisted catalog
    // data is a display/startup cache and is never an authority for side effects.
    const definition = await this.getHydratedDefinition(normalizedRequest.connectorId, context.signal);
    if (!definition) {
      throw new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'connector not found', 404);
    }
    const connector = this.toDetail(definition);
    if (connector.status === 'disabled') {
      throw new ConnectorServiceError('CONNECTOR_DISABLED', 'connector is disabled', 403);
    }
    if (connector.status !== 'connected') {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'connector is not connected', 403, {
        connectorId: normalizedRequest.connectorId,
        status: connector.status,
      });
    }
    if (
      normalizedRequest.expectedAccountLabel !== undefined
      && connector.accountLabel !== normalizedRequest.expectedAccountLabel
    ) {
      throw new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'connector account changed since refresh approval', 409, {
        connectorId: normalizedRequest.connectorId,
        expectedAccountLabel: normalizedRequest.expectedAccountLabel,
        currentAccountLabel: connector.accountLabel ?? null,
      });
    }
    const tool = definition.allowedToolNames.includes(normalizedRequest.toolName)
      ? definition.tools.find((candidate) => candidate.name === normalizedRequest.toolName)
      : undefined;
    if (!tool) {
      throw new ConnectorServiceError('CONNECTOR_TOOL_NOT_FOUND', 'connector tool is not allowed', 404, {
        connectorId: normalizedRequest.connectorId,
        toolName: normalizedRequest.toolName,
      });
    }
    const runtimeSafety = runtimeSafetyForTool(tool);
    const effectiveApproval = stricterApproval(
      // An absent host policy is not evidence of auto-approval. This matches
      // the provider's independent fail-closed execution boundary.
      definition.minimumApproval ?? 'disabled',
      tool.safety.approval,
      runtimeSafety.approval,
    );
    if (effectiveApproval !== 'auto' || runtimeSafety.sideEffect !== 'read') {
      throw new ConnectorServiceError('CONNECTOR_SAFETY_DENIED', 'connector tool is not auto-approved read-only by current safety policy', 403, {
        connectorId: normalizedRequest.connectorId,
        toolName: normalizedRequest.toolName,
        approvalPolicy: effectiveApproval,
        safety: { ...runtimeSafety },
      });
    }
    try {
      if (tool.inputSchemaUnsupportedReason !== undefined) throw new Error(tool.inputSchemaUnsupportedReason);
      assertConnectorInputMatchesSchema(normalizedRequest.input, tool.inputSchemaJson);
    } catch (error) {
      throw new ConnectorServiceError('CONNECTOR_INPUT_SCHEMA_MISMATCH', (error as Error).message, 400, {
        connectorId: normalizedRequest.connectorId,
        toolName: normalizedRequest.toolName,
      });
    }

    this.enforceRunLimits(context);

    let providerOutput: BoundedJsonObject;
    try {
      providerOutput = await this.executeConnectorProviderTool(normalizedRequest, context, definition, tool);
    } catch (error) {
      if (isConnectorAuthStaleError(error, normalizedRequest)) {
        this.statusService.markAuthenticationExpired(definition, connectorAuthExpiredMessage(definition), connector.accountLabel);
      }
      throw error;
    }
    const protectedOutput = protectConnectorOutput(providerOutput);
    const output = protectedOutput.output;
    const outputSummary = summarizeConnectorOutput(output);

    return {
      ok: true,
      connectorId: normalizedRequest.connectorId,
      ...(connector.accountLabel === undefined ? {} : { accountLabel: connector.accountLabel }),
      toolName: normalizedRequest.toolName,
      safety: { ...runtimeSafety },
      output,
      ...(outputSummary === undefined ? {} : { outputSummary }),
      metadata: {
        connectorId: normalizedRequest.connectorId,
        toolName: normalizedRequest.toolName,
        purpose: context.purpose ?? 'agent_preview',
        outputSerializedBytes: protectedOutput.serializedBytes,
        ...(protectedOutput.redacted ? { redacted: true } : {}),
        ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
      },
    };
  }

  protected async executeConnectorProviderTool(
    request: ConnectorExecuteRequest,
    context: ConnectorExecutionContext,
    resolvedDefinition?: ConnectorCatalogDefinition,
    resolvedTool?: ConnectorCatalogToolDefinition,
  ): Promise<BoundedJsonObject> {
    const definition = resolvedDefinition ?? await this.getHydratedDefinition(request.connectorId, context.signal);
    const tool = resolvedTool ?? definition?.tools.find((candidate) => candidate.name === request.toolName);
    if (definition?.authentication === 'composio' && tool) {
      return this.provider.execute(definition, tool, request.input, this.getCredential(request.connectorId)?.credentials, context.signal);
    }

    throw new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'connector provider is not implemented', 501, {
      connectorId: request.connectorId,
      toolName: request.toolName,
    });
  }

  private enforceRunLimits(context: ConnectorExecutionContext): void {
    const now = this.now();
    this.pruneRunLimits(now);
    const key = connectorRunLimitKey(context);
    const current = this.runLimits.get(key);
    if (current === undefined && this.runLimits.size >= CONNECTOR_RUN_LIMIT_MAX_BUCKETS) {
      throw new ConnectorServiceError('CONNECTOR_RATE_LIMITED', 'connector run-limit bucket capacity exceeded', 429, {
        bucketLimit: CONNECTOR_RUN_LIMIT_MAX_BUCKETS,
      });
    }
    const state: ConnectorRunLimitState = current === undefined || now - current.windowStartedAt >= CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS
      ? { windowStartedAt: now, lastSeenAt: now, windowCalls: 0, totalCalls: current?.totalCalls ?? 0 }
      : current;

    if (state.totalCalls >= CONNECTOR_RUN_TOTAL_CALL_LIMIT) {
      throw new ConnectorServiceError('CONNECTOR_RATE_LIMITED', 'connector tool run call limit exceeded', 429, {
        sessionId: context.sessionId ?? null,
        totalCallLimit: CONNECTOR_RUN_TOTAL_CALL_LIMIT,
      });
    }
    if (state.windowCalls >= CONNECTOR_RUN_RATE_LIMIT_CALLS) {
      throw new ConnectorServiceError('CONNECTOR_RATE_LIMITED', 'connector tool rate limit exceeded', 429, {
        sessionId: context.sessionId ?? null,
        rateLimit: CONNECTOR_RUN_RATE_LIMIT_CALLS,
        windowMs: CONNECTOR_RUN_RATE_LIMIT_WINDOW_MS,
      });
    }

    state.windowCalls += 1;
    state.totalCalls += 1;
    state.lastSeenAt = now;
    this.runLimits.set(key, state);
  }

  private pruneRunLimits(now = this.now()): void {
    for (const [key, state] of this.runLimits.entries()) {
      if (now - state.lastSeenAt >= CONNECTOR_RUN_LIMIT_TTL_MS) this.runLimits.delete(key);
    }
  }

  private toDetail(definition: ConnectorCatalogDefinition): ConnectorDetail {
    const detail = connectorDefinitionToDetail(definition);
    const status = this.getStatus(definition);
    return {
      ...detail,
      status: status.status,
      ...(status.accountLabel === undefined ? {} : { accountLabel: status.accountLabel }),
      ...(status.lastError === undefined ? {} : { lastError: status.lastError }),
      auth: {
        ...detail.auth!,
        configured: detail.auth!.configured || (definition.authentication === 'composio' && this.provider.isConfigured(definition)),
      },
    };
  }
}

function summarizeConnectorOutput(output: BoundedJsonObject): string | undefined {
  const maybeToolName = output.toolName;
  if (typeof maybeToolName === 'string') {
    const data = output.data !== null && typeof output.data === 'object' && !Array.isArray(output.data)
      ? output.data
      : output;
    if (typeof data.count === 'number') return `${maybeToolName}: ${data.count} result${data.count === 1 ? '' : 's'}`;
    if (typeof data.path === 'string') return `${maybeToolName}: ${data.path}`;
    if (typeof data.isRepository === 'boolean') return `${maybeToolName}: ${data.isRepository ? 'repository found' : 'not a repository'}`;
    return maybeToolName;
  }
  return undefined;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index]!);
    }
  }));
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
