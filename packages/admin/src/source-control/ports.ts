import { adminPort } from '../core/module/token.js';
import type { SourceControlProvider, SourceControlCredential, SourceControlCredentialInput, SourceControlCredentialPatch, SourceControlRequestOptions } from './models.js';
export interface SourceControlApiPort {
  providers(required: Record<string, never>, optional?: SourceControlRequestOptions): Promise<readonly SourceControlProvider[]>;
  list(required: Record<string, never>, optional?: SourceControlRequestOptions): Promise<readonly SourceControlCredential[]>;
  create(required: SourceControlCredentialInput, optional?: SourceControlRequestOptions): Promise<SourceControlCredential>;
  update(required: { id: string; patch: SourceControlCredentialPatch }, optional?: SourceControlRequestOptions): Promise<SourceControlCredential>;
  /** Idempotent; intentionally not offered by the connection page UI. */
  remove(required: { id: string }, optional?: SourceControlRequestOptions): Promise<void>;
}
export interface SourceControlTransportPort { request<T>(required: { path: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, optional?: SourceControlRequestOptions): Promise<T> }
export const sourceControlApiToken = adminPort<SourceControlApiPort, 'admin.source-control.api'>({ id: 'admin.source-control.api' });
