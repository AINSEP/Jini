import { adminPort } from '../core/module/token.js';
import type { CredentialKind, CredentialSummary, CredentialProvider, CredentialInput, CredentialPatch, RequestOptions, OtherStoreId, OtherCredentialSummary, RootKeyStatus, RootKeyPreview, RootKeyResult } from './models.js';
/** Separate method groups: connection shapes differ, and deployment and source identities must never merge. */
export interface CredentialStorePort {
  list(required: Record<string, never>, optional?: RequestOptions): Promise<readonly CredentialSummary[]>;
  create(required: CredentialInput, optional?: RequestOptions): Promise<CredentialSummary>;
  update(required: { id: string; patch: CredentialPatch }, optional?: RequestOptions): Promise<CredentialSummary>;
  /** Idempotent, including stale lists and double clicks. */
  remove(required: { id: string }, optional?: RequestOptions): Promise<void>;
}
export interface SecurityApiPort {
  providers(required: Record<string, never>, optional?: RequestOptions): Promise<readonly CredentialProvider[]>;
  readonly publish: CredentialStorePort; readonly sourceControl: CredentialStorePort; readonly custom: CredentialStorePort;
}
/** Other stores keep their own endpoint shapes inside the adapter. No saved material leaves it. */
export interface OtherCredentialsPort {
  list(required: { store: OtherStoreId }, optional?: RequestOptions): Promise<readonly OtherCredentialSummary[]>;
  replace(required: { store: OtherStoreId; id: string; token: string }, optional?: RequestOptions): Promise<void>;
  remove(required: { store: OtherStoreId; id: string }, optional?: RequestOptions): Promise<void>;
}
/** No reveal operation: the host owns storage, encryption, key creation and recovery. */
export interface RootKeyPort {
  status(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyStatus>;
  generate(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyResult>;
  importToken(required: { token: string }, optional?: RequestOptions): Promise<RootKeyResult>;
  previewStartFresh(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyPreview>;
  startFresh(required: { confirm: string }, optional?: RequestOptions): Promise<RootKeyResult>;
}
export const securityApiToken = adminPort<SecurityApiPort, 'admin.security.api'>({ id: 'admin.security.api' });
export const otherCredentialsToken = adminPort<OtherCredentialsPort, 'admin.security.other'>({ id: 'admin.security.other' });
export const rootKeyToken = adminPort<RootKeyPort, 'admin.security.root-key'>({ id: 'admin.security.root-key' });
export interface SecurityTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, optional?: RequestOptions): Promise<T>;
}
