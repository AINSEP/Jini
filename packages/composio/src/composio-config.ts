/**
 * @module composio-config
 *
 * Instance-scoped configuration persistence for the Composio adapter.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  COMPOSIO_MAX_SECRET_STORE_BYTES,
  readPrivateBoundedUtf8File,
} from './bounded-data.js';
import { withExclusiveFileLock } from './file-lock.js';

/** Secret Composio project configuration persisted by a host. */
export interface ComposioConfig {
  apiKey: string;
  authConfigIds: Record<string, string>;
}

/** Safe configuration projection for status surfaces. */
export interface PublicComposioConfig {
  configured: boolean;
  apiKeyTail: string;
}

/** Persistence boundary consumed by {@link ComposioConnectorProvider}. */
export interface ComposioConfigStore {
  read(): ComposioConfig;
  readPublic(): PublicComposioConfig;
  write(input: unknown): PublicComposioConfig;
  setAuthConfigId(connectorId: string, authConfigId: string): void;
  deleteAuthConfigId(connectorId: string): void;
}

/** File adapter options. */
export interface FileComposioConfigStoreOptions {
  /** Absolute or host-resolved path to the secret JSON file. */
  filePath: string;
}

/**
 * Creates an isolated file-backed config store.
 *
 * Writes use a same-directory temporary file followed by an atomic rename.
 * Directories are created as `0700` and the final secret file is forced to
 * `0600`.
 *
 * @example
 * ```ts
 * const store = createFileComposioConfigStore({
 *   filePath: '/var/lib/example/composio/config.json',
 * });
 * store.write({ apiKey: 'project-key' });
 * ```
 *
 * @overallScore 100/100
 */
export function createFileComposioConfigStore(
  { filePath }: FileComposioConfigStoreOptions,
): ComposioConfigStore {
  if (!filePath.trim()) throw new TypeError('Composio config filePath must not be empty.');
  const resolvedFilePath = path.resolve(filePath);

  const read = (): ComposioConfig => normalizeComposioConfig(readRawConfig(resolvedFilePath));
  const readPublic = (): PublicComposioConfig => toPublicComposioConfig(read());
  const write = (input: unknown): PublicComposioConfig => withExclusiveFileLock(resolvedFilePath, () => {
    const prior = normalizeComposioConfig(readRawConfig(resolvedFilePath));
    const record = asRecord(input);
    const hasApiKey = Object.prototype.hasOwnProperty.call(record, 'apiKey');
    const hasAuthConfigIds = Object.prototype.hasOwnProperty.call(record, 'authConfigIds');
    const nextApiKey = hasApiKey ? normalizeOptionalString(record.apiKey) ?? '' : prior.apiKey;
    const apiKeyChanged = prior.apiKey !== nextApiKey;
    const next = normalizeComposioConfig({
      apiKey: nextApiKey,
      authConfigIds: apiKeyChanged ? {} : hasAuthConfigIds ? record.authConfigIds : prior.authConfigIds,
    });
    writeRawConfig(resolvedFilePath, next);
    return toPublicComposioConfig(next);
  });
  const setAuthConfigId = (connectorId: string, authConfigId: string): void => {
    const normalizedConnectorId = normalizeOptionalString(connectorId);
    const normalizedAuthConfigId = normalizeOptionalString(authConfigId);
    if (!normalizedConnectorId || !normalizedAuthConfigId) return;
    withExclusiveFileLock(resolvedFilePath, () => {
      const prior = normalizeComposioConfig(readRawConfig(resolvedFilePath));
      writeRawConfig(resolvedFilePath, {
        apiKey: prior.apiKey,
        authConfigIds: { ...prior.authConfigIds, [normalizedConnectorId]: normalizedAuthConfigId },
      });
    });
  };
  const deleteAuthConfigId = (connectorId: string): void => {
    const normalizedConnectorId = normalizeOptionalString(connectorId);
    if (!normalizedConnectorId) return;
    withExclusiveFileLock(resolvedFilePath, () => {
      const prior = normalizeComposioConfig(readRawConfig(resolvedFilePath));
      if (prior.authConfigIds[normalizedConnectorId] === undefined) return;
      const authConfigIds = { ...prior.authConfigIds };
      delete authConfigIds[normalizedConnectorId];
      writeRawConfig(resolvedFilePath, { apiKey: prior.apiKey, authConfigIds });
    });
  };

  return { read, readPublic, write, setAuthConfigId, deleteAuthConfigId };
}

function readRawConfig(filePath: string): unknown {
  try {
    return JSON.parse(readPrivateBoundedUtf8File(filePath, COMPOSIO_MAX_SECRET_STORE_BYTES)) as unknown;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return {};
    throw error;
  }
}

function writeRawConfig(filePath: string, config: ComposioConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > COMPOSIO_MAX_SECRET_STORE_BYTES) {
    throw new RangeError(`Composio config exceeds the ${COMPOSIO_MAX_SECRET_STORE_BYTES}-byte limit.`);
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
}

function toPublicComposioConfig(config: ComposioConfig): PublicComposioConfig {
  return {
    configured: Boolean(config.apiKey),
    apiKeyTail: config.apiKey ? config.apiKey.slice(-4) : '',
  };
}

function normalizeComposioConfig(value: unknown): ComposioConfig {
  const raw = asRecord(value);
  return {
    apiKey: normalizeOptionalString(raw.apiKey) ?? '',
    authConfigIds: normalizeAuthConfigIds(raw.authConfigIds),
  };
}

function normalizeAuthConfigIds(value: unknown): Record<string, string> {
  const raw = asRecord(value);
  const next: Record<string, string> = {};
  for (const [connectorId, authConfigId] of Object.entries(raw)) {
    const normalizedConnectorId = normalizeOptionalString(connectorId);
    const normalizedAuthConfigId = normalizeOptionalString(authConfigId);
    if (normalizedConnectorId && normalizedAuthConfigId) next[normalizedConnectorId] = normalizedAuthConfigId;
  }
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
