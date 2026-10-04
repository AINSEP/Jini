import { adminPort } from '../core/module/token.js';
/** Optional navigation to the host's single named-credential management home. */
export interface CredentialManagementPort { open(required: { kind: 'source-control' }, optional?: Record<string, never>): void }
export const credentialManagementToken = adminPort<CredentialManagementPort, 'admin.credentials.management'>({ id: 'admin.credentials.management' });
