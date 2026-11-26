import { ToolInputError } from '@jini-ai/core';
import type { CredentialStoreErrorClasses } from '../credential-routes-shared.js';

export function knownPublishCredentialListRefusal({ err, storeErrors }: { err: unknown; storeErrors: CredentialStoreErrorClasses }, _optional = {}): { status: number; body: { error: string; detail: string } } | undefined {
  if (err instanceof ToolInputError) return { status: 409, body: { error: 'KEY_IN_USE', detail: err.message } };
  const rows: [abstract new (...args: never[]) => Error, number, string][] = [
    [storeErrors.validation, 400, 'VALIDATION'],
    [storeErrors.duplicateLabel, 409, 'DUPLICATE_LABEL'],
    [storeErrors.notFound, 404, 'NOT_FOUND'],
    [storeErrors.secretStoreUnconfigured, 503, 'SECRET_STORE_UNCONFIGURED'],
  ];
  const row = rows.find(([type]) => err instanceof type);
  return row ? { status: row[1], body: { error: row[2], detail: (err as Error).message } } : undefined;
}

