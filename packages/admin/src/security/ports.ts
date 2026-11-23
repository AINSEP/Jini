import { adminPort } from '@jini-ai/core/contracts/admin-module';
import type { AdminPublishConnectionInput, AdminPublishCredentialsSnapshot, AdminPublishCredentialSummary, AdminPublishCredentialVerification } from '@jini-ai/core/contracts/site/api-security-api-types';
import type { CredentialStoreSnapshot, CredentialSummary, CredentialProvider, CredentialInput, CredentialPatch, RequestOptions, OtherStoreId, OtherCredentialSummary, RootKeyStatus, RootKeyPreview, RootKeyResult, RootKeyReveal } from './models.js';
/** Separate method groups: connection shapes differ, and deployment and source identities must never merge. */
export interface CredentialStorePort {
  list(required: Record<string, never>, optional?: RequestOptions): Promise<readonly CredentialSummary[]>;
  create(required: CredentialInput, optional?: RequestOptions): Promise<CredentialSummary>;
  update(required: { id: string; patch: CredentialPatch }, optional?: RequestOptions): Promise<CredentialSummary>;
  /** Idempotent, including stale lists and double clicks. */
  remove(required: { id: string }, optional?: RequestOptions): Promise<void>;
  /** The list plus store-level facts. Optional: a port with only `list` still loads. */
  snapshot?(required: Record<string, never>, optional?: RequestOptions): Promise<CredentialStoreSnapshot>;
  /** Publish only: re-checks one saved credential at its provider now. A failed check still resolves with its status. */
  verify?(required: { id: string }, optional?: RequestOptions): Promise<AdminPublishCredentialVerification>;
}
type PublishCredentialWrite = { credential: AdminPublishCredentialSummary; verification?: AdminPublishCredentialVerification };
type PublishCredentialBody = { label: string; connection: AdminPublishConnectionInput; isDefault?: boolean; worksFor?: string[] };
/** The publish credential client Deployment and Security share (W1–W5). Requests keep the host wire byte for byte. */
export interface PublishCredentialsPort {
  listPublishCredentials(required?: Record<string, never>, optional?: RequestOptions): Promise<AdminPublishCredentialsSnapshot>;
  /** An omitted `isDefault` lets the server apply its own default rule; it is never sent as `false`. */
  createPublishCredential(required: PublishCredentialBody, optional?: RequestOptions): Promise<PublishCredentialWrite>;
  /** Omitting `connection` keeps the stored secret; `worksFor: []` clears compatibility without a connection. */
  updatePublishCredential(required: { id: string; input: Partial<PublishCredentialBody> }, optional?: RequestOptions): Promise<PublishCredentialWrite>;
  deletePublishCredential(required: { id: string }, optional?: RequestOptions): Promise<void>;
  verifyPublishCredential(required: { id: string }, optional?: RequestOptions): Promise<{ verification: AdminPublishCredentialVerification }>;
}
export interface SecurityApiPort {
  /** Each kind is served from its own endpoint so one catalog failing cannot hide the other; no `kind` returns both. */
  providers(required: { kind?: 'publish' | 'source-control' }, optional?: RequestOptions): Promise<readonly CredentialProvider[]>;
  readonly publish: CredentialStorePort; readonly sourceControl: CredentialStorePort; readonly custom: CredentialStorePort;
}
/** Other stores keep their own endpoint shapes inside the adapter. No saved material leaves it. */
export interface OtherCredentialsPort {
  list(required: { store: OtherStoreId }, optional?: RequestOptions): Promise<readonly OtherCredentialSummary[]>;
  replace(required: { store: OtherStoreId; id: string; token: string }, optional?: RequestOptions): Promise<void>;
  remove(required: { store: OtherStoreId; id: string }, optional?: RequestOptions): Promise<void>;
}
/** The host owns storage, encryption, key creation and recovery. `reveal` is optional and human-only:
 * a host that omits it gets no reveal control, and the revealed value never enters a snapshot. */
export interface RootKeyPort {
  status(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyStatus>;
  generate(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyResult>;
  importToken(required: { token: string }, optional?: RequestOptions): Promise<RootKeyResult>;
  previewStartFresh(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyPreview>;
  startFresh(required: { confirm: string }, optional?: RequestOptions): Promise<RootKeyResult>;
  reveal?(required: Record<string, never>, optional?: RequestOptions): Promise<RootKeyReveal>;
}
export const securityApiToken = adminPort<SecurityApiPort, 'admin.security.api'>({ id: 'admin.security.api' });
export const otherCredentialsToken = adminPort<OtherCredentialsPort, 'admin.security.other'>({ id: 'admin.security.other' });
export const rootKeyToken = adminPort<RootKeyPort, 'admin.security.root-key'>({ id: 'admin.security.root-key' });
export interface SecurityTransportPort {
  request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, optional?: RequestOptions): Promise<T>;
}
