import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { SecurityPortsContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary } from '../../models.js';

const providers: CredentialProvider[] = [{ kind: 'publish', id: 'cdn', label: 'CDN', vendorLabel: 'CDN vendor', category: 'hosting', tokenField: 'token', fields: [] }];
const verification = { status: 'invalid' as const, message: 'Rejected', checkedAt: 't' };
const rows: CredentialSummary[] = [{ kind: 'publish', id: '2', providerId: 'cdn', label: 'Deploy', configured: true, isDefault: true, createdAt: 'today', updatedAt: 'today', credentialType: 'vendor', worksFor: ['git'], lastVerification: verification }];

describe('useAccessTokensTab publish facts (SEC-8)', () => {
  it('exposes the server executionMode and each row verification', async () => {
    const securityApi = createMemorySecurityApi({ providers, rows, executionMode: 'hosted-api-only' });
    const wrapper = ({ children }: { children: ReactNode }) => <SecurityPortsContext.Provider value={{ securityApi }}>{children}</SecurityPortsContext.Provider>;
    const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: ['security.read'] }), { wrapper });
    await waitFor(() => expect(view.result.current.executionMode).toBe('hosted-api-only'));
    expect(view.result.current.rows[0]?.verification).toEqual(verification);
  });
});
